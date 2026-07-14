/** Shared lookup: contacts already in an active call session (builder + ABM). */
const SESSION_CONTACTS_LIMIT = 5000;

/**
 * Returns [{ sf_contact_id, in_session_of }] for contacts already in a session
 * where status='active' AND (scheduled_for IS NULL OR scheduled_for >= todayIso).
 * Caller passes `todayIso` (Paris date, YYYY-MM-DD) via parisToday() to avoid a
 * UTC cutover flipping a same-day session into "past" after 23h Paris.
 */
export async function findActiveSessionConflicts(client, contactIds, todayIso) {
  if (!contactIds.length) return [];
  const { data: sessions, error: sessionsError } = await client
    .from("call_sessions")
    .select("id, owner")
    .eq("status", "active")
    .or(`scheduled_for.is.null,scheduled_for.gte.${todayIso}`);
  if (sessionsError || !sessions?.length) return [];
  const sessionIds = sessions.map((session) => session.id);
  const { data: sessionContacts, error: contactsError } = await client
    .from("call_session_contacts")
    .select("sf_contact_id, session_id")
    .in("session_id", sessionIds)
    .in("sf_contact_id", contactIds)
    .limit(SESSION_CONTACTS_LIMIT);
  if (contactsError || !sessionContacts?.length) return [];
  if (sessionContacts.length >= SESSION_CONTACTS_LIMIT) {
    console.warn(`findActiveSessionConflicts: session_contacts capped at ${SESSION_CONTACTS_LIMIT} rows`);
  }
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const owners = [...new Set(sessions.map((session) => session.owner))];
  const { data: profiles } = await client.from("profiles").select("id, full_name, email").in("id", owners);
  const ownerLabels = new Map((profiles || []).map((profile) => [profile.id, profile.full_name || profile.email || profile.id]));
  const conflicts = new Map();
  for (const row of sessionContacts) {
    if (!conflicts.has(row.sf_contact_id)) {
      const session = sessionById.get(row.session_id);
      conflicts.set(row.sf_contact_id, ownerLabels.get(session.owner) || session.owner);
    }
  }
  return [...conflicts].map(([sf_contact_id, in_session_of]) => ({ sf_contact_id, in_session_of }));
}
