/** Target list (ex /api/calls-list) — absorbed into /api/calls. */
import mapping from "../_crm/mapping.js";
import {
  buildTargetQuery,
  boundedLimit,
  fetchOpportunityAccountIdSets,
  fetchSFToken,
  filterByOpportunityAccounts,
  filterTargetContacts,
  hasOpportunityQueryFilters,
  hasRelanceQueryFilters,
  parisToday,
  searchContacts,
  SOQL_FETCH_CAP,
} from "../_crm/salesforce.js";
import { buildPreviewContactList } from "./selection.js";
import { getProfile } from "./profileCache.js";

const MAX_PER_COMPANY_OPTIONS = [1, 2, 3, 5];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseListContactsBody(body) {
  if (!isObject(body)) return { error: "invalid_body" };
  if (!isObject(body.filters)) return { error: "invalid_filters" };
  for (const family of ["entreprise", "contact", "relance"]) {
    if (body.filters[family] !== undefined && !isObject(body.filters[family])) {
      return { error: "invalid_filters" };
    }
  }
  if (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1)) {
    return { error: "invalid_limit" };
  }
  if (body.preset_id !== undefined && (!Number.isInteger(body.preset_id) || body.preset_id < 1)) {
    return { error: "invalid_preset_id" };
  }
  if (
    body.max_per_company !== undefined
    && body.max_per_company !== null
    && (!Number.isInteger(body.max_per_company) || !MAX_PER_COMPANY_OPTIONS.includes(body.max_per_company))
  ) {
    return { error: "invalid_max_per_company" };
  }
  return {
    filters: { ...body.filters, limit: body.limit ?? body.filters.limit },
    maxPerCompany: body.max_per_company ?? null,
    countOnly: body.count_only === true,
  };
}

function normalizeContacts(records) {
  const contact = mapping.objects.contact.fields;
  const account = mapping.objects.account.fields;
  const task = mapping.objects.task;
  // ActivityDate est un date literal SOQL (YYYY-MM-DD) : comparaison de chaînes,
  // en date Paris pour ne pas basculer une tentative du jour dans le futur après minuit.
  const today = parisToday();
  return records
    .filter((record) => typeof record?.[contact.id] === "string")
    .map((record) => {
      const tasks = record[task.childRelationship];
      const lastCall = Array.isArray(tasks?.records)
        ? tasks.records.find((record) => {
          const activityDate = record[task.fields.activityDate];
          return typeof activityDate === "string" && activityDate.slice(0, 10) <= today;
        })
        : null;
      return {
        sf_contact_id: record[contact.id],
        sf_account_id: record.Account?.[account.id] ?? record[contact.accountId] ?? null,
        contact_name: record[contact.name] || "",
        account_name: record.Account?.[account.name] ?? null,
        // Prefer mobile for dialing — filter "a_telephone" means has MobilePhone.
        phone: record[contact.mobilePhone] ?? record[contact.phone] ?? null,
        title: record[contact.title] ?? null,
        linkedin_url: record[contact.linkedin] ?? null,
        email: record[contact.email] ?? null,
        mobile_phone: record[contact.mobilePhone] ?? null,
        ...(lastCall?.[task.fields.activityDate] ? { last_call_at: lastCall[task.fields.activityDate] } : {}),
        ...(typeof tasks?.totalSize === "number" ? { call_count: tasks.totalSize } : {}),
      };
    });
}

async function findDedup(client, contactIds) {
  if (!contactIds.length) return [];
  const { data: sessions, error: sessionsError } = await client
    .from("call_sessions")
    .select("id, owner")
    .eq("status", "active");
  if (sessionsError || !sessions?.length) return [];
  const sessionIds = sessions.map((session) => session.id);
  const { data: sessionContacts, error: contactsError } = await client
    .from("call_session_contacts")
    .select("sf_contact_id, session_id")
    .in("session_id", sessionIds)
    .in("sf_contact_id", contactIds);
  if (contactsError || !sessionContacts?.length) return [];
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const owners = [...new Set(sessions.map((session) => session.owner))];
  const { data: profiles } = await client.from("profiles").select("id, full_name, email").in("id", owners);
  const ownerLabels = new Map((profiles || []).map((profile) => [profile.id, profile.full_name || profile.email || profile.id]));
  const dedup = new Map();
  for (const row of sessionContacts) {
    if (!dedup.has(row.sf_contact_id)) {
      const session = sessionById.get(row.session_id);
      dedup.set(row.sf_contact_id, ownerLabels.get(session.owner) || session.owner);
    }
  }
  return [...dedup].map(([sf_contact_id, in_session_of]) => ({ sf_contact_id, in_session_of }));
}

/** Returns { contacts, dedup } or { count, capped } or { error, status }. */
export async function listContacts(client, userId, body) {
  const parsed = parseListContactsBody(body);
  if (parsed.error) return { error: parsed.error, status: 400 };

  const profile = await getProfile(client, userId);
  if (profile.error) return { error: profile.error, status: 500 };

  const tokenResult = await fetchSFToken();
  if (tokenResult.error) return { error: tokenResult.error, status: 502 };

  const maxPerCompany = parsed.maxPerCompany;
  const requestedLimit = boundedLimit(parsed.filters.limit);
  const countOnly = parsed.countOnly;
  const opportunityFilters = hasOpportunityQueryFilters(parsed.filters);
  const wideFetch = countOnly || hasRelanceQueryFilters(parsed.filters) || opportunityFilters || maxPerCompany !== null;
  const queryFilters = wideFetch ? { ...parsed.filters, limit: SOQL_FETCH_CAP } : parsed.filters;
  const includeTasks = !countOnly || hasRelanceQueryFilters(parsed.filters);

  const soql = buildTargetQuery(queryFilters, mapping, profile.sfUserId, { includeTasks });
  const [search, opportunitySetsResult] = await Promise.all([
    searchContacts(tokenResult.accessToken, soql),
    opportunityFilters
      ? fetchOpportunityAccountIdSets(tokenResult.accessToken, mapping, parsed.filters)
      : Promise.resolve(null),
  ]);
  if (search.error) {
    return { error: search.error, message: search.message, status: 502 };
  }

  let opportunitySets = null;
  if (opportunitySetsResult) {
    if (opportunitySetsResult.error) {
      return { error: opportunitySetsResult.error, message: opportunitySetsResult.message, status: 502 };
    }
    opportunitySets = opportunitySetsResult;
  }

  let filtered = filterTargetContacts(search.records, parsed.filters, mapping);
  if (opportunitySets) {
    filtered = filterByOpportunityAccounts(filtered, parsed.filters, mapping, opportunitySets);
  }
  if (countOnly) {
    return {
      count: filtered.length,
      capped: filtered.length >= SOQL_FETCH_CAP || (search.records?.length ?? 0) >= SOQL_FETCH_CAP,
    };
  }

  const normalized = normalizeContacts(filtered);
  const contacts = maxPerCompany !== null
    ? buildPreviewContactList(normalized, requestedLimit, maxPerCompany)
    : hasRelanceQueryFilters(parsed.filters)
      ? normalized.slice(0, requestedLimit)
      : normalized;
  const dedup = await findDedup(client, contacts.map((contact) => contact.sf_contact_id));
  return { contacts, dedup };
}
