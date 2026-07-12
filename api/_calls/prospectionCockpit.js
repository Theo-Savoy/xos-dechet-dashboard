import { canViewTeamPerf, trackingModeFor } from "../_config/access.js";
import {
  computeHubKpis,
  getParisDateRange,
  getParisRangeFor,
  isValidScheduledFor,
  todayParisDate,
} from "./http.js";
import { getProfile } from "./profileCache.js";

const HEATMAP_DAYS = 42;

function parisDayKey(iso) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function shiftParisDate(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + deltaDays, 12));
  return date.toISOString().slice(0, 10);
}

function buildHeatmap(calledRows, endDateStr) {
  const counts = new Map();
  for (const row of calledRows) {
    if (!row.called_at) continue;
    const key = parisDayKey(row.called_at);
    if (!counts.has(key)) counts.set(key, { calls: 0, rdv: 0 });
    const bucket = counts.get(key);
    bucket.calls++;
    if (row.outcome === "RDV planifié") bucket.rdv++;
  }

  const heatmap = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const date = shiftParisDate(endDateStr, -i);
    const bucket = counts.get(date) || { calls: 0, rdv: 0 };
    heatmap.push({
      date,
      label: dayLabel(date),
      calls: bucket.calls,
      rdv: bucket.rdv,
    });
  }
  return heatmap;
}

function emptyKpis() {
  return computeHubKpis([]);
}

function labelFromProfile(profile) {
  return profile.full_name || profile.email || profile.sf_user_id || profile.id;
}

function person(profileById, userId) {
  const profile = profileById.get(userId);
  if (!profile) {
    return { user_id: userId, sf_user_id: null, label: "Inconnu" };
  }
  return {
    user_id: profile.id,
    sf_user_id: profile.sf_user_id || null,
    label: labelFromProfile(profile),
  };
}

function personFromSf(sfLabelById, sfUserId) {
  if (!sfUserId) return { sf_user_id: null, label: "—" };
  return {
    sf_user_id: sfUserId,
    label: sfLabelById.get(sfUserId) || sfUserId,
  };
}

/**
 * Cockpit manager : perfs séances équipe + attribution RDV.
 * GET ?resource=prospection_cockpit&period=day|week|month&anchor=YYYY-MM-DD
 */
export async function handleProspectionCockpit({ url, user, client, headers }) {
  const profileResult = await getProfile(client, user.id);
  if (profileResult.error) {
    return new Response(JSON.stringify({ error: profileResult.error }), { status: 500, headers });
  }
  if (!canViewTeamPerf(profileResult.role)) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
  }

  const rawPeriod = url.searchParams.get("period");
  const periodParam = rawPeriod === "month" || rawPeriod === "day" ? rawPeriod : "week";
  const rawAnchor = url.searchParams.get("anchor");
  const anchorParam = isValidScheduledFor(rawAnchor) ? rawAnchor : null;

  let rangeStart;
  let rangeEnd;
  if (anchorParam) {
    const anchored = getParisRangeFor(periodParam, anchorParam);
    rangeStart = anchored.start;
    rangeEnd = anchored.end;
  } else {
    const { todayStart, tomorrowStart, weekStart, monthStart } = getParisDateRange();
    rangeStart = periodParam === "month" ? monthStart : periodParam === "day" ? todayStart : weekStart;
    rangeEnd = tomorrowStart;
  }

  const todayStr = todayParisDate();
  const heatmapEndStr =
    anchorParam && anchorParam > todayStr ? anchorParam : todayStr;
  const heatmapStartStr = shiftParisDate(heatmapEndStr, -(HEATMAP_DAYS - 1));
  const rangePayload = {
    start: rangeStart.toISOString(),
    end: rangeEnd.toISOString(),
    anchor: anchorParam,
  };

  const { data: profiles, error: profilesError } = await client
    .from("profiles")
    .select("id, full_name, email, sf_user_id, role")
    .not("sf_user_id", "is", null)
    .order("full_name", { ascending: true });

  if (profilesError) {
    return new Response(JSON.stringify({ error: "profiles_lookup_failed" }), { status: 500, headers });
  }

  const profileList = profiles || [];
  const profileById = new Map(profileList.map((row) => [row.id, row]));
  const sfLabelById = new Map(
    profileList
      .filter((row) => row.sf_user_id)
      .map((row) => [row.sf_user_id, labelFromProfile(row)]),
  );

  // Enrich labels from sf_user_map for users without a profile login yet.
  const { data: mapRows } = await client.from("sf_user_map").select("email, sf_user_id");
  for (const row of mapRows || []) {
    if (!row.sf_user_id || sfLabelById.has(row.sf_user_id)) continue;
    const local = String(row.email || "").split("@")[0] || row.sf_user_id;
    const label = local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || row.sf_user_id;
    sfLabelById.set(row.sf_user_id, label);
  }

  const ownerIds = profileList.map((row) => row.id);
  if (ownerIds.length === 0) {
    return new Response(
      JSON.stringify({
        view: "team",
        period: periodParam,
        range: rangePayload,
        heatmap: buildHeatmap([], heatmapEndStr),
        team_kpis: emptyKpis(),
        by_caller: [],
        by_day: [],
        by_rdv_owner: [],
        sessions: [],
        rdv_attributions: [],
      }),
      { status: 200, headers },
    );
  }

  const { data: sessions, error: sessionsError } = await client
    .from("call_sessions")
    .select("id, owner, name, status, created_at, scheduled_for, session_type, completed_at")
    .in("owner", ownerIds)
    .order("created_at", { ascending: false })
    .limit(200);

  if (sessionsError) {
    return new Response(JSON.stringify({ error: "sessions_lookup_failed" }), { status: 500, headers });
  }

  const sessionList = sessions || [];
  const sessionIds = sessionList.map((session) => session.id);
  const sessionById = new Map(sessionList.map((session) => [session.id, session]));

  let contacts = [];
  if (sessionIds.length > 0) {
    const { data: contactRows, error: contactsError } = await client
      .from("call_session_contacts")
      .select(
        "id, session_id, contact_name, account_name, status, outcome, called_at, marked_npa, sf_event_id, rdv_owner_sf_user_id, logged_by",
      )
      .in("session_id", sessionIds);

    if (contactsError) {
      return new Response(JSON.stringify({ error: "contacts_lookup_failed" }), { status: 500, headers });
    }
    contacts = contactRows || [];
  }

  const inPeriod = (iso) => {
    if (!iso) return false;
    const date = new Date(iso);
    return date >= rangeStart && date < rangeEnd;
  };

  const calledInPeriod = contacts.filter(
    (row) => row.status === "called" && inPeriod(row.called_at),
  );
  const team_kpis = computeHubKpis(calledInPeriod);

  const memberResult = sessionIds.length
    ? await client.from("call_session_members").select("session_id, user_id").in("session_id", sessionIds)
    : { data: [] };
  const memberCountBySession = new Map();
  for (const row of memberResult?.data || []) {
    memberCountBySession.set(row.session_id, (memberCountBySession.get(row.session_id) || 0) + 1);
  }

  // Sessions touched in period (at least one call) OR still active.
  const sessionIdsWithCalls = new Set(calledInPeriod.map((row) => row.session_id));
  const visibleSessions = sessionList.filter(
    (session) => sessionIdsWithCalls.has(session.id) || session.status === "active",
  );

  const contactsBySession = new Map();
  for (const contact of contacts) {
    if (!contactsBySession.has(contact.session_id)) contactsBySession.set(contact.session_id, []);
    contactsBySession.get(contact.session_id).push(contact);
  }

  const sessionsPayload = visibleSessions.map((session) => {
    const rows = contactsBySession.get(session.id) || [];
    const periodRows = rows.filter((row) => row.status === "called" && inPeriod(row.called_at));
    const counts = { total: rows.length, called: 0, skipped: 0, pending: 0 };
    for (const row of rows) {
      if (row.status === "called") counts.called++;
      else if (row.status === "skipped") counts.skipped++;
      else counts.pending++;
    }
    return {
      id: session.id,
      name: session.name,
      status: session.status,
      session_type: session.session_type || "prospection",
      scheduled_for: session.scheduled_for || null,
      created_at: session.created_at,
      completed_at: session.completed_at || null,
      owner: person(profileById, session.owner),
      counts,
      kpis: computeHubKpis(periodRows),
      shared: (memberCountBySession.get(session.id) || 0) > 0,
      member_count: memberCountBySession.get(session.id) || 0,
    };
  });

  function creditUserId(row) {
    if (row.logged_by) return row.logged_by;
    return sessionById.get(row.session_id)?.owner || null;
  }

  const calledInHeatmap = contacts.filter((row) => {
    if (row.status !== "called" || !row.called_at) return false;
    const key = parisDayKey(row.called_at);
    return key >= heatmapStartStr && key <= heatmapEndStr;
  });
  const heatmap = buildHeatmap(calledInHeatmap, heatmapEndStr);

  const byCallerMap = new Map();
  for (const profile of profileList) {
    byCallerMap.set(profile.id, {
      user_id: profile.id,
      sf_user_id: profile.sf_user_id || null,
      label: labelFromProfile(profile),
      role: profile.role || "commercial",
      tracking: trackingModeFor(profile.sf_user_id),
      sessions_active: 0,
      sessions_completed: 0,
      kpis: emptyKpis(),
      _rows: [],
    });
  }
  for (const session of sessionList) {
    const bucket = byCallerMap.get(session.owner);
    if (!bucket) continue;
    if (session.status === "active") bucket.sessions_active++;
    if (session.status === "completed") bucket.sessions_completed++;
  }
  for (const row of calledInPeriod) {
    const credited = creditUserId(row);
    if (!credited) continue;
    const bucket = byCallerMap.get(credited);
    if (!bucket) continue;
    bucket._rows.push(row);
  }
  const by_caller = [...byCallerMap.values()]
    .map((bucket) => {
      const { _rows, ...rest } = bucket;
      return { ...rest, kpis: computeHubKpis(_rows) };
    })
    .filter((row) => row.kpis.calls > 0 || row.sessions_active > 0)
    .sort((a, b) => b.kpis.rdv - a.kpis.rdv || b.kpis.calls - a.kpis.calls);

  // Agrégat par jour Paris (appels + relances du jour, toutes séances).
  const byDayMap = new Map();
  for (const row of calledInPeriod) {
    if (!row.called_at) continue;
    const key = parisDayKey(row.called_at);
    if (!byDayMap.has(key)) {
      byDayMap.set(key, { date: key, label: dayLabel(key), _rows: [], _byCaller: new Map() });
    }
    const day = byDayMap.get(key);
    day._rows.push(row);
    const credited = creditUserId(row);
    if (!credited) continue;
    if (!day._byCaller.has(credited)) {
      const profile = profileById.get(credited);
      day._byCaller.set(credited, {
        user_id: credited,
        label: profile ? labelFromProfile(profile) : credited,
        _rows: [],
      });
    }
    day._byCaller.get(credited)._rows.push(row);
  }
  const by_day = [...byDayMap.values()]
    .map((day) => ({
      date: day.date,
      label: day.label,
      kpis: computeHubKpis(day._rows),
      by_caller: [...day._byCaller.values()]
        .map((bucket) => ({
          user_id: bucket.user_id,
          label: bucket.label,
          kpis: computeHubKpis(bucket._rows),
        }))
        .sort((a, b) => b.kpis.rdv - a.kpis.rdv || b.kpis.calls - a.kpis.calls),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const rdvRows = calledInPeriod.filter((row) => row.outcome === "RDV planifié");

  // Backfill missing rdv_owner from action_journal for older events.
  const missingOwnerIds = rdvRows
    .filter((row) => !row.rdv_owner_sf_user_id)
    .map((row) => row.id);
  const ownerFromJournal = new Map();
  if (missingOwnerIds.length > 0) {
    const { data: journalRows } = await client
      .from("action_journal")
      .select("changes, targets")
      .eq("action_type", "call_session_event")
      .order("at", { ascending: false })
      .limit(500);
    for (const entry of journalRows || []) {
      const contactId = entry.targets?.[0]?.session_contact_id;
      const ownerId = entry.changes?.owner_sf_user_id;
      if (contactId && ownerId && !ownerFromJournal.has(contactId)) {
        ownerFromJournal.set(contactId, ownerId);
      }
    }
  }

  const rdv_attributions = rdvRows
    .map((row) => {
      const session = sessionById.get(row.session_id);
      const ownerSf = row.rdv_owner_sf_user_id || ownerFromJournal.get(row.id) || null;
      const assignee = personFromSf(sfLabelById, ownerSf);
      return {
        session_id: row.session_id,
        session_name: session?.name || "Séance",
        session_contact_id: row.id,
        contact_name: row.contact_name,
        account_name: row.account_name || null,
        called_at: row.called_at,
        sf_event_id: row.sf_event_id || null,
        caller: (() => {
          const credited = creditUserId(row);
          return credited
            ? person(profileById, credited)
            : (session ? person(profileById, session.owner) : { user_id: null, sf_user_id: null, label: "—" });
        })(),
        rdv_owner_sf_user_id: ownerSf,
        rdv_owner_label: assignee.label,
      };
    })
    .sort((a, b) => String(b.called_at || "").localeCompare(String(a.called_at || "")));

  const byRdvOwnerMap = new Map();
  for (const attr of rdv_attributions) {
    const key = attr.rdv_owner_sf_user_id || "__unknown__";
    if (!byRdvOwnerMap.has(key)) {
      byRdvOwnerMap.set(key, {
        sf_user_id: attr.rdv_owner_sf_user_id,
        label: attr.rdv_owner_label,
        rdv: 0,
        from_sdr: 0,
      });
    }
    const bucket = byRdvOwnerMap.get(key);
    bucket.rdv++;
    if (
      attr.caller.sf_user_id
      && attr.rdv_owner_sf_user_id
      && attr.caller.sf_user_id !== attr.rdv_owner_sf_user_id
    ) {
      bucket.from_sdr++;
    }
  }
  const by_rdv_owner = [...byRdvOwnerMap.values()].sort((a, b) => b.rdv - a.rdv);

  return new Response(
    JSON.stringify({
      view: "team",
      period: periodParam,
      range: rangePayload,
      heatmap,
      team_kpis,
      by_caller,
      by_day,
      by_rdv_owner,
      sessions: sessionsPayload,
      rdv_attributions,
    }),
    { status: 200, headers },
  );
}
