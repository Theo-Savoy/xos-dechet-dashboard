import { createClient } from "@supabase/supabase-js";
import mapping from "../_crm/mapping.js";
import { buildLightningUrl } from "../_crm/salesforce.js";

export const SF_ID = /^[a-zA-Z0-9]{15,18}$/;
const ISO_START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function jsonResponse(status, body, headers) { return new Response(JSON.stringify(body), { status, headers }); }

export function isValidScheduledFor(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year
    && check.getUTCMonth() + 1 === month
    && check.getUTCDate() === day
  );
}

export function todayParisDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
}

const PGRST_NOT_FOUND = "PGRST116";
let serviceClient = null;

export function isNotFoundError(error) {
  return error?.code === PGRST_NOT_FOUND;
}

export function isValidEventStart(start) {
  if (!start || typeof start !== "string" || start.trim() === "") return false;
  const trimmed = start.trim();
  if (!ISO_START_RE.test(trimmed)) return false;

  const parts = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!parts) return false;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = parts[6] ? Number(parts[6]) : 0;
  const zone = parts[7];

  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z") {
    const offsetParts = zone.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!offsetParts) return false;
    const offsetHour = Number(offsetParts[2]);
    const offsetMinute = Number(offsetParts[3]);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }

  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() + 1 !== month
    || calendarCheck.getUTCDate() !== day
  ) {
    return false;
  }

  const parsed = new Date(trimmed);
  return !Number.isNaN(parsed.getTime());
}

export function getFollowUpOutcomes(taskMapping = mapping) {
  const semantic = taskMapping.objects.task.resultSemantic;
  return [semantic.followUpNoAnswer, semantic.followUpVoicemail];
}

export function filterContactsForFollowUp(contacts, followUpOutcomes = getFollowUpOutcomes()) {
  return (Array.isArray(contacts) ? contacts : []).filter((contact) => {
    // Deux cas de follow-up :
    // 1) essayé sans succès (skipped / non-décroché / répondeur) — compteur déjà incrémenté
    // 2) pas essayé (pending) — reporté tel quel, sans incrément
    if (contact?.status === "skipped" || contact?.status === "pending") return true;
    return followUpOutcomes.includes(contact?.outcome);
  });
}

export const SESSION_TYPES = ["prospection", "suivi_opportunites", "suivi_clients", "relance"];

export function isValidSessionType(value) {
  return typeof value === "string" && SESSION_TYPES.includes(value);
}

const PIPE_DECROCHE = ["Appel décroché", "Appel argumenté", "RDV planifié"];
const PIPE_ARGUMENTE = ["Appel argumenté", "RDV planifié"];

/** KPIs hub à partir des lignes contact (status called/skipped + outcome + marked_npa). */
export function computeHubKpis(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const called = list.filter((row) => row?.status === "called");
  const calls = called.length;
  const decroche = called.filter((row) => PIPE_DECROCHE.includes(row?.outcome)).length;
  const argumente = called.filter((row) => PIPE_ARGUMENTE.includes(row?.outcome)).length;
  const rdv = called.filter((row) => row?.outcome === "RDV planifié").length;
  const npa = list.filter((row) => row?.marked_npa === true).length;
  const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

  return {
    calls,
    decroche,
    argumente,
    rdv,
    npa,
    rate_decroche: rate(decroche, calls),
    rate_argumente: rate(argumente, calls),
    rate_rdv_per_decroche: rate(rdv, decroche),
    rate_rdv_per_argumente: rate(rdv, argumente),
  };
}

export function getServiceClient() {
  if (serviceClient) return serviceClient;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) return null;
  serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  return serviceClient;
}

/** Test-only hook to isolate the module-scope service client. */
export function __resetServiceClient() {
  serviceClient = null;
}

export async function journalAction({ actorId, actionType, changes, targets, result }) {
  const supabase = getServiceClient();
  if (!supabase) {
    console.error("_journal: missing Supabase URL or service role key");
    return;
  }
  try {
    await supabase.from("action_journal").insert({
      actor: actorId,
      action_type: actionType,
      changes: changes || {},
      targets: targets || [],
      result: result || {},
    });
  } catch (err) {
    console.error("Failed to write to action_journal:", err);
  }
}

export function actorName(user, profile) {
  return profile?.fullName || user.user_metadata?.full_name || user.email || "Utilisateur Inconnu";
}

export async function assertSessionOwner(client, sessionId, userId) {
  return assertSessionAccess(client, sessionId, userId, { requireOwner: true });
}

/** Soft-claim TTL : laisse le temps d'appeler sans bloquer indéfiniment. */
export const CONTACT_CLAIM_TTL_MS = 4 * 60 * 1000;

export function isClaimActive(claimedAt, now = Date.now()) {
  if (!claimedAt) return false;
  const ts = new Date(claimedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return now - ts < CONTACT_CLAIM_TTL_MS;
}

export async function assertSessionAccess(client, sessionId, userId, { requireOwner = false } = {}) {
  const { data: session, error } = await client
    .from("call_sessions")
    .select("id, owner, name, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (error && !isNotFoundError(error)) return { error: "session_lookup_failed", status: 500 };
  if (!session) return { error: "not_found", status: 404 };
  if (session.owner === userId) return { session, isOwner: true };
  if (requireOwner) return { error: "not_found", status: 404 };

  const { data: membership, error: memberError } = await client
    .from("call_session_members")
    .select("user_id")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberError && !isNotFoundError(memberError)) {
    return { error: "session_lookup_failed", status: 500 };
  }
  if (!membership) return { error: "not_found", status: 404 };
  return { session, isOwner: false };
}

export async function listAccessibleSessionIds(client, userId) {
  const [{ data: owned, error: ownedError }, { data: shared, error: sharedError }] = await Promise.all([
    client.from("call_sessions").select("id").eq("owner", userId),
    client.from("call_session_members").select("session_id").eq("user_id", userId),
  ]);
  if (ownedError) return { error: "sessions_lookup_failed" };
  if (sharedError) return { error: "sessions_lookup_failed" };
  const ids = new Set([
    ...(owned || []).map((row) => row.id),
    ...(shared || []).map((row) => row.session_id),
  ]);
  return { ids: [...ids] };
}

/**
 * Réserve un contact pending pour l'appelant.
 * - Si déjà claimé par un autre et claim frais → 409 contact_claimed
 * - Sinon upsert claim pour userId
 */
export async function claimSessionContact(client, contact, userId) {
  const now = Date.now();
  const claimedByOther =
    contact.claimed_by
    && contact.claimed_by !== userId
    && isClaimActive(contact.claimed_at, now);

  if (claimedByOther) {
    return {
      error: "contact_claimed",
      status: 409,
      claimed_by: contact.claimed_by,
    };
  }

  const claimedAt = new Date().toISOString();
  const { data: updated, error } = await client
    .from("call_session_contacts")
    .update({ claimed_by: userId, claimed_at: claimedAt })
    .eq("id", contact.id)
    .eq("status", "pending")
    .select("id, claimed_by, claimed_at, status")
    .maybeSingle();

  if (error) return { error: "contact_claim_failed", status: 500 };
  if (!updated) {
    // Re-lire pour distinguer already processed vs race claim
    const { data: fresh } = await client
      .from("call_session_contacts")
      .select("id, status, claimed_by, claimed_at")
      .eq("id", contact.id)
      .maybeSingle();
    if (!fresh || fresh.status !== "pending") {
      return { error: "contact_already_processed", status: 409 };
    }
    if (fresh.claimed_by && fresh.claimed_by !== userId && isClaimActive(fresh.claimed_at)) {
      return { error: "contact_claimed", status: 409, claimed_by: fresh.claimed_by };
    }
    return { error: "contact_claim_failed", status: 500 };
  }
  return { contact: { ...contact, claimed_by: userId, claimed_at: claimedAt } };
}

export async function assertSessionContact(client, sessionId, contactId) {
  const { data: contact, error } = await client
    .from("call_session_contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  if (error && !isNotFoundError(error)) return { error: "contact_lookup_failed", status: 500 };
  if (!contact || contact.session_id !== sessionId) return { error: "not_found", status: 404 };
  return { contact };
}

export async function insertSessionWithContacts(client, userId, name, contacts, scheduledFor, options = {}) {
  const sessionType = isValidSessionType(options.sessionType) ? options.sessionType : "prospection";
  const { data: session, error: sessionError } = await client
    .from("call_sessions")
    .insert({
      owner: userId,
      name: name.trim(),
      status: "active",
      scheduled_for: scheduledFor,
      session_type: sessionType,
    })
    .select("id, name, status, created_at, scheduled_for, session_type")
    .single();

  if (sessionError || !session) return { error: "session_creation_failed", status: 500 };

  const contactRows = contacts.map((contact, index) => ({
    session_id: session.id,
    position: index,
    sf_contact_id: contact.sf_contact_id,
    sf_account_id: contact.sf_account_id || null,
    contact_name: contact.contact_name.trim(),
    account_name: contact.account_name || null,
    phone: contact.mobile_phone || contact.phone || null,
    email: contact.email || null,
    title: contact.title || null,
    linkedin_url: contact.linkedin_url || null,
    status: "pending",
    attempt_count: Number.isInteger(contact.attempt_count) && contact.attempt_count >= 0
      ? contact.attempt_count
      : 0,
    marked_npa: false,
  }));

  const { data: insertedContacts, error: contactsError } = await client
    .from("call_session_contacts")
    .insert(contactRows)
    .select("id, position, sf_contact_id, sf_account_id, contact_name, account_name, phone, email, title, linkedin_url, status, outcome, comments, sf_task_id, sf_event_id, called_at, recall_at, attempt_count, marked_npa")
    .order("position", { ascending: true });

  if (contactsError || !insertedContacts?.length) {
    await client.from("call_sessions").delete().eq("id", session.id);
    return { error: "session_contacts_insert_failed", status: 500 };
  }

  return { session, contacts: enrichSessionContacts(insertedContacts) };
}

export function enrichSessionContacts(contacts) {
  return (contacts || []).map((contact) => ({
    ...contact,
    sf_contact_url: buildLightningUrl("Contact", contact.sf_contact_id),
    sf_account_url: contact.sf_account_id ? buildLightningUrl("Account", contact.sf_account_id) : null,
  }));
}

function parisOffsetMs() {
  const now = new Date();
  const parisNowStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const [datePart, timePart] = parisNowStr.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  const parisNowDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Date.now() - parisNowDate.getTime();
}

export function getParisDateRange() {
  const offsetMs = parisOffsetMs();
  const [year, month, day] = todayParisDate().split("-").map(Number);

  const todayStart = new Date(Date.UTC(year, month - 1, day) + offsetMs);
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);

  const dow = todayStart.getUTCDay();
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const weekStart = new Date(todayStart.getTime() - mondayOffset * 86400000);
  const monthStart = new Date(Date.UTC(year, month - 1, 1) + offsetMs);

  return { todayStart, tomorrowStart, weekStart, monthStart };
}

/**
 * Day / week / month range containing an arbitrary Paris calendar date (YYYY-MM-DD).
 * Mirrors getParisDateRange offset logic; week is Mon–Sun, month is calendar month.
 */
export function getParisRangeFor(period, anchorDateStr) {
  const offsetMs = parisOffsetMs();
  const todayStr = todayParisDate();
  const dateStr = isValidScheduledFor(anchorDateStr) ? anchorDateStr : todayStr;
  const [year, month, day] = dateStr.split("-").map(Number);

  const dayStart = new Date(Date.UTC(year, month - 1, day) + offsetMs);
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  if (period === "day") {
    return { start: dayStart, end: dayEnd, anchor: dateStr };
  }

  if (period === "month") {
    const start = new Date(Date.UTC(year, month - 1, 1) + offsetMs);
    const end = new Date(Date.UTC(year, month, 1) + offsetMs);
    return { start, end, anchor: dateStr };
  }

  const dow = dayStart.getUTCDay();
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const start = new Date(dayStart.getTime() - mondayOffset * 86400000);
  const end = new Date(start.getTime() + 7 * 86400000);
  return { start, end, anchor: dateStr };
}
