import { resolveCallsTeamLabel, shouldUpgradeCallsTeamLabel } from "../_config/access.js";
import { hydrateSessionContactsFromCrm } from "./hydrateContacts.js";
import { listPresets } from "./presets.js";
import mapping from "../_crm/mapping.js";
import { fetchContactContext, fetchSFToken } from "../_crm/salesforce.js";
import {
  assertSessionAccess,
  computeHubKpis,
  enrichSessionContacts,
  getParisDateRange,
  isClaimActive,
  isNotFoundError,
  listAccessibleSessionIds,
} from "./http.js";
import { handleProspectionCockpit } from "./prospectionCockpit.js";

async function loadMembersBySessionIds(client, sessionIds, { withProfiles = true } = {}) {
  if (!sessionIds.length) return new Map();
  const { data: rows } = await client
    .from("call_session_members")
    .select("session_id, user_id")
    .in("session_id", sessionIds);
  const bySession = new Map();
  const userIds = new Set();
  for (const row of rows || []) {
    if (!bySession.has(row.session_id)) bySession.set(row.session_id, []);
    bySession.get(row.session_id).push(row.user_id);
    userIds.add(row.user_id);
  }
  const labels = new Map();
  if (withProfiles && userIds.size > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, full_name, email, sf_user_id")
      .in("id", [...userIds]);
    for (const profile of profiles || []) {
      labels.set(profile.id, {
        user_id: profile.id,
        label: profile.full_name || profile.email || profile.id,
        sf_user_id: profile.sf_user_id || null,
      });
    }
  }
  const result = new Map();
  for (const [sessionId, ids] of bySession) {
    result.set(
      sessionId,
      ids.map((id) => labels.get(id) || { user_id: id, label: id, sf_user_id: null }),
    );
  }
  return result;
}

/** Compteurs par séance via RPC SQL, fallback scan léger. */
async function loadContactCountsBySessionIds(client, sessionIds) {
  const empty = new Map();
  if (!sessionIds.length) return { counts: empty, error: null };

  const { data: rpcRows, error: rpcError } = await client.rpc("call_session_contact_counts", {
    p_session_ids: sessionIds,
  });
  const legacyRpcShape = (rpcRows || []).some((row) => row && "done" in row && !("called" in row));
  if (!rpcError && !legacyRpcShape) {
    const counts = new Map();
    for (const row of rpcRows || []) {
      counts.set(row.session_id, {
        total: Number(row.total) || 0,
        called: Number(row.called) || 0,
        skipped: Number(row.skipped) || 0,
        pending: Number(row.pending) || 0,
      });
    }
    return { counts, error: null };
  }

  const { data: allContacts, error: contactsError } = await client
    .from("call_session_contacts")
    .select("session_id, status")
    .in("session_id", sessionIds);
  if (contactsError) return { counts: empty, error: "contacts_lookup_failed" };

  const counts = new Map();
  for (const contact of allContacts || []) {
    if (!counts.has(contact.session_id)) {
      counts.set(contact.session_id, { total: 0, called: 0, skipped: 0, pending: 0 });
    }
    const bucket = counts.get(contact.session_id);
    bucket.total++;
    if (contact.status === "called") bucket.called++;
    else if (contact.status === "skipped") bucket.skipped++;
    else bucket.pending++;
  }
  return { counts, error: null };
}

async function buildSessionSummaries(client, userId, accessibleIds) {
  if (!accessibleIds.length) return { sessions: [], error: null };

  const { data: sessions, error: sessionsError } = await client
    .from("call_sessions")
    .select("id, owner, name, status, created_at, scheduled_for, session_type")
    .in("id", accessibleIds)
    .order("created_at", { ascending: false });

  if (sessionsError) return { sessions: null, error: "sessions_lookup_failed" };
  if (!sessions || sessions.length === 0) return { sessions: [], error: null };

  const allSessionIds = sessions.map((session) => session.id);
  const [membersBySession, countsResult] = await Promise.all([
    loadMembersBySessionIds(client, allSessionIds, { withProfiles: false }),
    loadContactCountsBySessionIds(client, allSessionIds),
  ]);
  if (countsResult.error) return { sessions: null, error: countsResult.error };

  const result = sessions.map((session) => {
    const counts = countsResult.counts.get(session.id) || {
      total: 0,
      called: 0,
      skipped: 0,
      pending: 0,
    };
    const members = membersBySession.get(session.id) || [];
    return {
      id: session.id,
      name: session.name,
      status: session.status,
      created_at: session.created_at,
      scheduled_for: session.scheduled_for ?? null,
      session_type: session.session_type ?? "prospection",
      is_owner: session.owner === userId,
      shared: members.length > 0,
      member_count: members.length,
      members,
      ...counts,
    };
  });
  return { sessions: result, error: null };
}

async function buildHubStats(client, userId, accessibleIds) {
  const { data: ownedOnly } = await client
    .from("call_sessions")
    .select("id, status")
    .eq("owner", userId);
  const ownedIds = new Set((ownedOnly || []).map((row) => row.id));
  let sessionsActive = 0;
  let sessionsCompleted = 0;
  for (const session of ownedOnly || []) {
    if (session.status === "active") sessionsActive++;
    else if (session.status === "completed") sessionsCompleted++;
  }

  let callsToday = 0;
  let callsWeek = 0;
  let weekRows = [];
  let monthRows = [];

  if (accessibleIds.length > 0) {
    const { todayStart, weekStart, monthStart } = getParisDateRange();
    const { data: calls, error: callsError } = await client
      .from("call_session_contacts")
      .select("status, outcome, called_at, marked_npa, logged_by, session_id")
      .in("session_id", accessibleIds)
      .eq("status", "called")
      .not("called_at", "is", null)
      .gte("called_at", monthStart.toISOString());

    if (callsError) return { stats: null, error: "calls_lookup_failed" };

    for (const call of calls || []) {
      const creditedToMe =
        call.logged_by === userId
        || (!call.logged_by && ownedIds.has(call.session_id));
      if (!creditedToMe) continue;
      const called = new Date(call.called_at);
      if (called >= todayStart) callsToday++;
      if (called >= weekStart) {
        callsWeek++;
        weekRows.push(call);
      }
      if (called >= monthStart) monthRows.push(call);
    }
  }

  return {
    stats: {
      calls_today: callsToday,
      calls_week: callsWeek,
      sessions_active: sessionsActive,
      sessions_completed: sessionsCompleted,
      week: computeHubKpis(weekRows),
      month: computeHubKpis(monthRows),
    },
    error: null,
  };
}

async function countRecalls(client, accessibleIds) {
  if (!accessibleIds.length) return { count: 0, error: null };
  const { count, error } = await client
    .from("call_session_contacts")
    .select("id", { count: "exact", head: true })
    .in("session_id", accessibleIds)
    .eq("status", "called")
    .not("recall_at", "is", null);
  if (error) return { count: 0, error: "recalls_lookup_failed" };
  return { count: count || 0, error: null };
}

export async function handleSessionsRead({ url, user, client, headers }) {
  const sessionIdParam = url.searchParams.get("session_id");
  const statsParam = url.searchParams.get("stats");
  const resource = url.searchParams.get("resource");

  if (resource === "prospection_cockpit") {
    return handleProspectionCockpit({ url, user, client, headers });
  }

  if (resource === "presets") {
    const result = await listPresets(client, user.id);
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500, headers });
    }
    return new Response(JSON.stringify({ presets: result.presets }), { status: 200, headers });
  }

  if (resource === "team") {
    // Union profiles (déjà connectés) + sf_user_map (commerciaux connus même sans login).
    const [profilesResult, mapResult] = await Promise.all([
      client.from("profiles").select("id, full_name, email, sf_user_id").not("sf_user_id", "is", null),
      client.from("sf_user_map").select("email, sf_user_id"),
    ]);
    if (profilesResult.error) {
      return new Response(JSON.stringify({ error: "team_lookup_failed" }), { status: 500, headers });
    }
    const emailBySfId = new Map();
    if (!mapResult.error) {
      for (const row of mapResult.data || []) {
        if (row.sf_user_id && row.email) emailBySfId.set(row.sf_user_id, row.email);
      }
    }
    const bySfId = new Map();
    for (const profile of profilesResult.data || []) {
      if (!profile.sf_user_id) continue;
      const email = profile.email || emailBySfId.get(profile.sf_user_id) || "";
      bySfId.set(profile.sf_user_id, {
        user_id: profile.id,
        label: resolveCallsTeamLabel(
          profile.sf_user_id,
          profile.full_name || email || profile.sf_user_id,
          email,
        ),
        sf_user_id: profile.sf_user_id,
      });
    }
    // Map entries enrichissent la liste (Paul / Christophe même s'ils n'ont pas encore de profil).
    if (!mapResult.error) {
      for (const row of mapResult.data || []) {
        if (!row.sf_user_id) continue;
        const label = resolveCallsTeamLabel(row.sf_user_id, row.sf_user_id, row.email);
        if (bySfId.has(row.sf_user_id)) {
          const existing = bySfId.get(row.sf_user_id);
          if (shouldUpgradeCallsTeamLabel(row.sf_user_id, existing.label)) {
            bySfId.set(row.sf_user_id, {
              ...existing,
              label: resolveCallsTeamLabel(row.sf_user_id, existing.label, row.email),
            });
          }
          continue;
        }
        bySfId.set(row.sf_user_id, {
          user_id: `map:${row.email || row.sf_user_id}`,
          label,
          sf_user_id: row.sf_user_id,
        });
      }
    }
    const team = [...bySfId.values()].sort((a, b) => a.label.localeCompare(b.label, "fr"));
    return new Response(JSON.stringify({ team }), { status: 200, headers });
  }

  if (resource === "hub") {
    const accessible = await listAccessibleSessionIds(client, user.id);
    if (accessible.error) {
      return new Response(JSON.stringify({ error: accessible.error }), { status: 500, headers });
    }
    const ids = accessible.ids;
    const [summaries, statsResult, recallsResult] = await Promise.all([
      buildSessionSummaries(client, user.id, ids),
      buildHubStats(client, user.id, ids),
      countRecalls(client, ids),
    ]);
    if (summaries.error) {
      return new Response(JSON.stringify({ error: summaries.error }), { status: 500, headers });
    }
    if (statsResult.error) {
      return new Response(JSON.stringify({ error: statsResult.error }), { status: 500, headers });
    }
    if (recallsResult.error) {
      return new Response(JSON.stringify({ error: recallsResult.error }), { status: 500, headers });
    }
    return new Response(
      JSON.stringify({
        sessions: summaries.sessions,
        stats: statsResult.stats,
        recall_count: recallsResult.count,
      }),
      { status: 200, headers },
    );
  }

  if (resource === "recalls") {
    const accessible = await listAccessibleSessionIds(client, user.id);
    if (accessible.error) {
      return new Response(JSON.stringify({ error: accessible.error }), { status: 500, headers });
    }
    if (!accessible.ids.length) {
      return new Response(JSON.stringify({ recalls: [] }), { status: 200, headers });
    }
    const { data: ownedSessions, error: sessionsError } = await client
      .from("call_sessions")
      .select("id, name, status, scheduled_for")
      .in("id", accessible.ids);
    if (sessionsError) {
      return new Response(JSON.stringify({ error: "sessions_lookup_failed" }), { status: 500, headers });
    }
    const sessions = ownedSessions || [];
    if (!sessions.length) {
      return new Response(JSON.stringify({ recalls: [] }), { status: 200, headers });
    }
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const { data: rows, error: recallsError } = await client
      .from("call_session_contacts")
      .select("id, session_id, sf_contact_id, sf_account_id, contact_name, account_name, phone, email, title, linkedin_url, recall_at, outcome, attempt_count, status")
      .in("session_id", sessions.map((session) => session.id))
      .not("recall_at", "is", null)
      .order("recall_at", { ascending: true });
    if (recallsError) {
      return new Response(JSON.stringify({ error: "recalls_lookup_failed" }), { status: 500, headers });
    }
    const recalls = (rows || [])
      .filter((row) => row.status === "called" && row.recall_at)
      .map((row) => {
        const session = sessionById.get(row.session_id);
        return {
          id: row.id,
          session_id: row.session_id,
          session_name: session?.name ?? "Séance",
          session_status: session?.status ?? "active",
          sf_contact_id: row.sf_contact_id,
          sf_account_id: row.sf_account_id,
          contact_name: row.contact_name,
          account_name: row.account_name,
          phone: row.phone,
          email: row.email,
          title: row.title,
          linkedin_url: row.linkedin_url,
          recall_at: row.recall_at,
          outcome: row.outcome,
          attempt_count: row.attempt_count,
        };
      });
    return new Response(JSON.stringify({ recalls }), { status: 200, headers });
  }

  if (statsParam === "1") {
    const accessible = await listAccessibleSessionIds(client, user.id);
    if (accessible.error) {
      return new Response(JSON.stringify({ error: accessible.error }), { status: 500, headers });
    }
    const statsResult = await buildHubStats(client, user.id, accessible.ids);
    if (statsResult.error) {
      return new Response(JSON.stringify({ error: statsResult.error }), { status: 500, headers });
    }
    return new Response(JSON.stringify({ stats: statsResult.stats }), { status: 200, headers });
  }

  if (sessionIdParam) {
    const sessionId = parseInt(sessionIdParam, 10);
    if (isNaN(sessionId) || sessionId < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const [
      { data: session, error: sessionError },
      { data: contactsRaw, error: contactsError },
    ] = await Promise.all([
      client
        .from("call_sessions")
        .select("id, owner, name, status, created_at, scheduled_for, session_type")
        .eq("id", sessionId)
        .maybeSingle(),
      client
        .from("call_session_contacts")
        .select("id, position, sf_contact_id, sf_account_id, contact_name, account_name, phone, email, title, linkedin_url, status, outcome, comments, sf_task_id, sf_event_id, called_at, recall_at, attempt_count, marked_npa, logged_by, claimed_by, claimed_at")
        .eq("session_id", sessionId)
        .order("position", { ascending: true }),
    ]);

    if (sessionError && !isNotFoundError(sessionError)) {
      return new Response(JSON.stringify({ error: "session_lookup_failed" }), { status: 500, headers });
    }
    if (!session) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }
    const access = await assertSessionAccess(client, sessionId, user.id);
    if (access.error) {
      return new Response(JSON.stringify({ error: access.error }), { status: access.status, headers });
    }

    if (contactsError) {
      return new Response(JSON.stringify({ error: "contacts_lookup_failed" }), { status: 500, headers });
    }

    let contacts = contactsRaw || [];
    if (contacts.some((contact) => !contact.email || !contact.title)) {
      const tokenResult = await fetchSFToken({ client, userId: user.id });
      if (!tokenResult.error) {
        contacts = await hydrateSessionContactsFromCrm(client, contacts, tokenResult.accessToken, mapping);
      }
    }

    const membersBySession = await loadMembersBySessionIds(client, [sessionId]);
    const members = membersBySession.get(sessionId) || [];
    const claimLabels = new Map();
    const claimerIds = [...new Set(contacts.map((c) => c.claimed_by).filter(Boolean))];
    if (claimerIds.length) {
      const { data: claimers } = await client
        .from("profiles")
        .select("id, full_name, email")
        .in("id", claimerIds);
      for (const profile of claimers || []) {
        claimLabels.set(profile.id, profile.full_name || profile.email || profile.id);
      }
    }

    const enriched = enrichSessionContacts(contacts).map((contact) => {
      const claimActive =
        contact.status === "pending"
        && contact.claimed_by
        && isClaimActive(contact.claimed_at);
      return {
        ...contact,
        claim_active: Boolean(claimActive),
        claimed_by_label:
          claimActive && contact.claimed_by !== user.id
            ? claimLabels.get(contact.claimed_by) || "Collègue"
            : null,
      };
    });

    const { owner, ...sessionData } = session;
    const contextContactId = url.searchParams.get("context_contact_id");
    let context = null;
    if (contextContactId) {
      const row = (contacts || []).find((c) => String(c.id) === String(contextContactId));
      if (!row) {
        return new Response(JSON.stringify({ error: "contact_not_in_session" }), { status: 404, headers });
      }
      const tokenResult = await fetchSFToken({ client, userId: user.id });
      if (tokenResult.error) {
        return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
      }
      const contextLite = url.searchParams.get("context_lite") === "1";
      const ctx = await fetchContactContext(
        tokenResult.accessToken,
        { contactId: row.sf_contact_id, accountId: row.sf_account_id },
        mapping,
        { lite: contextLite },
      );
      if (ctx.error) {
        return new Response(JSON.stringify({ error: ctx.error }), { status: 502, headers });
      }
      context = ctx;
    }

    return new Response(
      JSON.stringify({
        session: {
          ...sessionData,
          is_owner: access.isOwner,
          owner_id: owner,
          members,
        },
        contacts: enriched,
        ...(context ? { context } : {}),
      }),
      { status: 200, headers },
    );
  }

  const accessibleList = await listAccessibleSessionIds(client, user.id);
  if (accessibleList.error) {
    return new Response(JSON.stringify({ error: accessibleList.error }), { status: 500, headers });
  }
  const summaries = await buildSessionSummaries(client, user.id, accessibleList.ids);
  if (summaries.error) {
    return new Response(JSON.stringify({ error: summaries.error }), { status: 500, headers });
  }
  return new Response(JSON.stringify({ sessions: summaries.sessions }), { status: 200, headers });
}
