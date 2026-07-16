import { nextContinuationName } from "./sessionNaming.js";
import { insertUserNotification } from "../notifications.js";
import { newlyAddedSessionMemberIds, sessionShareNotification } from "./notificationHelpers.js";
import { SF_ID, assertSessionOwner, enrichSessionContacts, filterContactsForFollowUp, insertSessionWithContacts, isValidScheduledFor, isValidSessionType, todayParisDate } from "./http.js";

export async function handleSessionWrite({ action, body, user, client, headers }) {
  if (action === "create_session") {
    const {
      name,
      contacts,
      scheduled_for: scheduledForInput,
      session_type: sessionTypeInput,
      member_user_ids: memberUserIdsInput,
    } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return new Response(JSON.stringify({ error: "invalid_name" }), { status: 400, headers });
    }
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return new Response(JSON.stringify({ error: "invalid_contacts" }), { status: 400, headers });
    }
    let scheduledFor = todayParisDate();
    if (scheduledForInput !== undefined) {
      if (!isValidScheduledFor(scheduledForInput)) {
        return new Response(JSON.stringify({ error: "invalid_scheduled_for" }), { status: 400, headers });
      }
      scheduledFor = scheduledForInput;
    }
    const sessionType = sessionTypeInput === undefined ? "prospection" : sessionTypeInput;
    if (!isValidSessionType(sessionType)) {
      return new Response(JSON.stringify({ error: "invalid_session_type" }), { status: 400, headers });
    }
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      if (!contact || typeof contact !== "object") {
        return new Response(JSON.stringify({ error: "invalid_contacts" }), { status: 400, headers });
      }
      if (!contact.sf_contact_id || typeof contact.sf_contact_id !== "string" || !SF_ID.test(contact.sf_contact_id)) {
        return new Response(JSON.stringify({ error: "invalid_sf_contact_id" }), { status: 400, headers });
      }
      if (!contact.contact_name || typeof contact.contact_name !== "string" || contact.contact_name.trim().length === 0) {
        return new Response(JSON.stringify({ error: "invalid_contact_name" }), { status: 400, headers });
      }
      if (contact.sf_account_id !== undefined && contact.sf_account_id !== null && (typeof contact.sf_account_id !== "string" || !SF_ID.test(contact.sf_account_id))) {
        return new Response(JSON.stringify({ error: "invalid_sf_account_id" }), { status: 400, headers });
      }
    }

    let uniqueMemberIds = [];
    if (memberUserIdsInput !== undefined) {
      if (!Array.isArray(memberUserIdsInput) || memberUserIdsInput.some((id) => typeof id !== "string" || !id)) {
        return new Response(JSON.stringify({ error: "invalid_member_user_ids" }), { status: 400, headers });
      }
      uniqueMemberIds = [...new Set(memberUserIdsInput.filter((id) => id !== user.id && !String(id).startsWith("map:")))];
      if (uniqueMemberIds.length > 0) {
        const { data: profiles, error: profilesError } = await client
          .from("profiles")
          .select("id")
          .in("id", uniqueMemberIds);
        if (profilesError) {
          return new Response(JSON.stringify({ error: "members_lookup_failed" }), { status: 500, headers });
        }
        if ((profiles || []).length !== uniqueMemberIds.length) {
          return new Response(JSON.stringify({ error: "invalid_member_user_ids" }), { status: 400, headers });
        }
      }
    }

    const created = await insertSessionWithContacts(client, user.id, name, contacts, scheduledFor, {
      sessionType,
    });
    if (created.error) {
      return new Response(JSON.stringify({ error: created.error }), { status: created.status, headers });
    }

    let members = [];
    if (uniqueMemberIds.length > 0) {
      const rows = uniqueMemberIds.map((memberId) => ({
        session_id: created.session.id,
        user_id: memberId,
        added_by: user.id,
      }));
      const { error: insertError } = await client.from("call_session_members").insert(rows);
      if (insertError) {
        return new Response(JSON.stringify({ error: "members_update_failed" }), { status: 500, headers });
      }
      const { data: memberProfiles } = await client
        .from("profiles")
        .select("id, full_name, email, sf_user_id")
        .in("id", uniqueMemberIds);
      members = (memberProfiles || []).map((profile) => ({
        user_id: profile.id,
        label: profile.full_name || profile.email || profile.id,
        sf_user_id: profile.sf_user_id || null,
      }));
    }

    return new Response(
      JSON.stringify({
        session: { ...created.session, is_owner: true, members },
        contacts: created.contacts,
      }),
      { status: 200, headers },
    );
  }

  if (action === "create_audience_sessions") {
    const {
      groups,
      session_type: sessionTypeInput,
      scheduled_for: scheduledForInput,
      name_prefix: namePrefixInput,
    } = body;

    if (!Array.isArray(groups) || groups.length === 0) {
      return new Response(JSON.stringify({ error: "invalid_groups" }), { status: 400, headers });
    }
    for (const group of groups) {
      if (!group || typeof group !== "object") {
        return new Response(JSON.stringify({ error: "invalid_groups" }), { status: 400, headers });
      }
      if (
        !Array.isArray(group.account_ids)
        || group.account_ids.length === 0
        || group.account_ids.some((id) => typeof id !== "string" || !SF_ID.test(id))
      ) {
        return new Response(JSON.stringify({ error: "invalid_groups" }), { status: 400, headers });
      }
      if (!Array.isArray(group.contacts) || group.contacts.length === 0) {
        return new Response(JSON.stringify({ error: "invalid_groups" }), { status: 400, headers });
      }
      for (const contact of group.contacts) {
        if (!contact || typeof contact !== "object") {
          return new Response(JSON.stringify({ error: "invalid_groups" }), { status: 400, headers });
        }
        if (!contact.sf_contact_id || typeof contact.sf_contact_id !== "string" || !SF_ID.test(contact.sf_contact_id)) {
          return new Response(JSON.stringify({ error: "invalid_sf_contact_id" }), { status: 400, headers });
        }
        if (!contact.contact_name || typeof contact.contact_name !== "string" || contact.contact_name.trim().length === 0) {
          return new Response(JSON.stringify({ error: "invalid_contact_name" }), { status: 400, headers });
        }
        if (contact.sf_account_id !== undefined && contact.sf_account_id !== null && (typeof contact.sf_account_id !== "string" || !SF_ID.test(contact.sf_account_id))) {
          return new Response(JSON.stringify({ error: "invalid_sf_account_id" }), { status: 400, headers });
        }
      }
    }

    let scheduledFor = todayParisDate();
    if (scheduledForInput !== undefined) {
      if (!isValidScheduledFor(scheduledForInput)) {
        return new Response(JSON.stringify({ error: "invalid_scheduled_for" }), { status: 400, headers });
      }
      scheduledFor = scheduledForInput;
    }
    const sessionType = sessionTypeInput === undefined ? "prospection" : sessionTypeInput;
    if (!isValidSessionType(sessionType)) {
      return new Response(JSON.stringify({ error: "invalid_session_type" }), { status: 400, headers });
    }
    const namePrefix = typeof namePrefixInput === "string" && namePrefixInput.trim()
      ? namePrefixInput.trim()
      : null;

    const createdSessions = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const name = namePrefix ? `${namePrefix} #${i + 1}` : nextContinuationName(`Audience #${i}`);
      const created = await insertSessionWithContacts(client, user.id, name, group.contacts, scheduledFor, {
        sessionType,
      });
      if (created.error) {
        return new Response(
          JSON.stringify({ error: created.error, sessions: createdSessions }),
          { status: created.status, headers },
        );
      }
      createdSessions.push({
        id: created.session.id,
        name: created.session.name,
        contact_count: created.contacts.length,
        account_ids: group.account_ids,
      });
    }

    return new Response(JSON.stringify({ sessions: createdSessions }), { status: 200, headers });
  }

  if (action === "update_session") {
    const { session_id, name, scheduled_for: scheduledForInput, session_type: sessionTypeInput, rdv_goal: rdvGoalInput, engaged_at: engagedAtInput } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const patch = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return new Response(JSON.stringify({ error: "invalid_name" }), { status: 400, headers });
      }
      patch.name = name.trim();
    }
    if (scheduledForInput !== undefined) {
      if (scheduledForInput !== null && !isValidScheduledFor(scheduledForInput)) {
        return new Response(JSON.stringify({ error: "invalid_scheduled_for" }), { status: 400, headers });
      }
      patch.scheduled_for = scheduledForInput;
    }
    if (sessionTypeInput !== undefined) {
      if (!isValidSessionType(sessionTypeInput)) {
        return new Response(JSON.stringify({ error: "invalid_session_type" }), { status: 400, headers });
      }
      patch.session_type = sessionTypeInput;
    }
    if (rdvGoalInput !== undefined) {
      if (!Number.isInteger(rdvGoalInput) || rdvGoalInput < 1 || rdvGoalInput > 8) {
        return new Response(JSON.stringify({ error: "invalid_rdv_goal" }), { status: 400, headers });
      }
      if (sessionCheck.session.rdv_goal != null && rdvGoalInput < sessionCheck.session.rdv_goal) {
        return new Response(JSON.stringify({ error: "rdv_goal_cannot_decrease" }), { status: 409, headers });
      }
      patch.rdv_goal = rdvGoalInput;
    }
    if (engagedAtInput !== undefined) {
      if (typeof engagedAtInput !== "string" || Number.isNaN(Date.parse(engagedAtInput))) {
        return new Response(JSON.stringify({ error: "invalid_engaged_at" }), { status: 400, headers });
      }
      patch.engaged_at = engagedAtInput;
    }
    if (rdvGoalInput !== undefined && sessionCheck.session.engaged_at && !engagedAtInput) {
      patch.engaged_at = sessionCheck.session.engaged_at;
    }
    if (Object.keys(patch).length === 0) {
      return new Response(JSON.stringify({ error: "empty_update" }), { status: 400, headers });
    }

    const { data: updated, error: updateError } = await client
      .from("call_sessions")
      .update(patch)
      .eq("id", session_id)
      .select("id, name, status, created_at, scheduled_for, session_type, rdv_goal, engaged_at")
      .single();

    if (updateError || !updated) {
      return new Response(JSON.stringify({ error: "session_update_failed" }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ ok: true, session: updated }), { status: 200, headers });
  }

  if (action === "delete_session") {
    const { session_id } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const { error: deleteError } = await client.from("call_sessions").delete().eq("id", session_id);
    if (deleteError) {
      return new Response(JSON.stringify({ error: "session_delete_failed" }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (action === "create_follow_up_session") {
    const { session_id } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const { data: sessionContacts, error: contactsLookupError } = await client
      .from("call_session_contacts")
      .select("sf_contact_id, sf_account_id, contact_name, account_name, phone, email, title, linkedin_url, outcome, status, attempt_count")
      .eq("session_id", session_id)
      .order("position", { ascending: true });

    if (contactsLookupError) {
      return new Response(JSON.stringify({ error: "session_contacts_lookup_failed" }), { status: 500, headers });
    }

    const followUpContacts = filterContactsForFollowUp(sessionContacts || []);
    if (followUpContacts.length === 0) {
      return new Response(JSON.stringify({ error: "no_follow_up_contacts" }), { status: 400, headers });
    }

    const created = await insertSessionWithContacts(
      client,
      user.id,
      nextContinuationName(sessionCheck.session.name),
      followUpContacts,
      todayParisDate(),
      { sessionType: "relance" },
    );
    if (created.error) {
      return new Response(JSON.stringify({ error: created.error }), { status: created.status, headers });
    }

    return new Response(
      JSON.stringify({ ok: true, session: created.session, contacts: created.contacts }),
      { status: 200, headers },
    );
  }

  if (action === "defer_contacts") {
    const {
      session_id,
      contact_ids,
      scheduled_for: scheduledForInput,
      target_session_id: targetSessionId,
      name: nameInput,
      session_type: sessionTypeInput,
    } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (!Array.isArray(contact_ids) || contact_ids.length === 0 || contact_ids.some((id) => typeof id !== "number" || !Number.isInteger(id) || id < 1)) {
      return new Response(JSON.stringify({ error: "invalid_contact_ids" }), { status: 400, headers });
    }
    if (!isValidScheduledFor(scheduledForInput)) {
      return new Response(JSON.stringify({ error: "invalid_scheduled_for" }), { status: 400, headers });
    }
    if (
      targetSessionId !== undefined
      && targetSessionId !== null
      && (typeof targetSessionId !== "number" || !Number.isInteger(targetSessionId) || targetSessionId < 1)
    ) {
      return new Response(JSON.stringify({ error: "invalid_target_session_id" }), { status: 400, headers });
    }
    if (
      nameInput !== undefined
      && nameInput !== null
      && (typeof nameInput !== "string" || nameInput.trim().length === 0 || nameInput.trim().length > 120)
    ) {
      return new Response(JSON.stringify({ error: "invalid_name" }), { status: 400, headers });
    }
    if (sessionTypeInput !== undefined && !isValidSessionType(sessionTypeInput)) {
      return new Response(JSON.stringify({ error: "invalid_session_type" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const { data: sourceContacts, error: sourceError } = await client
      .from("call_session_contacts")
      .select("id, sf_contact_id, sf_account_id, contact_name, account_name, phone, email, title, linkedin_url, status, attempt_count")
      .eq("session_id", session_id)
      .in("id", contact_ids);

    if (sourceError) {
      return new Response(JSON.stringify({ error: "contacts_lookup_failed" }), { status: 500, headers });
    }
    if (!sourceContacts || sourceContacts.length !== contact_ids.length) {
      return new Response(JSON.stringify({ error: "contact_not_in_session" }), { status: 404, headers });
    }
    if (sourceContacts.some((contact) => contact.status !== "pending")) {
      return new Response(JSON.stringify({ error: "contact_not_pending" }), { status: 400, headers });
    }

    const { error: skipError } = await client
      .from("call_session_contacts")
      .update({ status: "skipped" })
      .in("id", contact_ids)
      .eq("session_id", session_id);

    if (skipError) {
      return new Response(JSON.stringify({ error: "contact_update_failed" }), { status: 500, headers });
    }

    const payloadContacts = sourceContacts.map((contact) => ({
      sf_contact_id: contact.sf_contact_id,
      sf_account_id: contact.sf_account_id,
      contact_name: contact.contact_name,
      account_name: contact.account_name,
      phone: contact.phone,
      email: contact.email,
      title: contact.title,
      linkedin_url: contact.linkedin_url,
      attempt_count: Number.isInteger(contact.attempt_count) ? contact.attempt_count : 0,
    }));

    let targetSession = null;
    let targetContacts = null;

    if (typeof targetSessionId === "number") {
      const targetCheck = await assertSessionOwner(client, targetSessionId, user.id);
      if (targetCheck.error) {
        return new Response(JSON.stringify({ error: targetCheck.error }), { status: targetCheck.status, headers });
      }
      if (targetCheck.session.status !== "active") {
        return new Response(JSON.stringify({ error: "target_session_not_active" }), { status: 400, headers });
      }
      if (targetSessionId === session_id) {
        return new Response(JSON.stringify({ error: "invalid_target_session_id" }), { status: 400, headers });
      }

      const { data: existingRows, error: existingError } = await client
        .from("call_session_contacts")
        .select("position, sf_contact_id")
        .eq("session_id", targetSessionId)
        .order("position", { ascending: false });

      if (existingError) {
        return new Response(JSON.stringify({ error: "contacts_lookup_failed" }), { status: 500, headers });
      }

      const existingIds = new Set((existingRows || []).map((row) => row.sf_contact_id));
      const toInsert = payloadContacts.filter((contact) => !existingIds.has(contact.sf_contact_id));
      const startPosition = existingRows?.[0]?.position != null ? existingRows[0].position + 1 : 0;

      if (toInsert.length > 0) {
        const rows = toInsert.map((contact, index) => ({
          session_id: targetSessionId,
          position: startPosition + index,
          sf_contact_id: contact.sf_contact_id,
          sf_account_id: contact.sf_account_id || null,
          contact_name: contact.contact_name,
          account_name: contact.account_name || null,
          phone: contact.phone || null,
          email: contact.email || null,
          title: contact.title || null,
          linkedin_url: contact.linkedin_url || null,
          status: "pending",
          attempt_count: contact.attempt_count,
          marked_npa: false,
        }));
        const { error: insertError } = await client.from("call_session_contacts").insert(rows);
        if (insertError) {
          return new Response(JSON.stringify({ error: "session_contacts_insert_failed" }), { status: 500, headers });
        }
      }

      const { data: refreshedTarget, error: refreshError } = await client
        .from("call_sessions")
        .select("id, name, status, created_at, scheduled_for, session_type")
        .eq("id", targetSessionId)
        .single();
      if (refreshError || !refreshedTarget) {
        return new Response(JSON.stringify({ error: "session_lookup_failed" }), { status: 500, headers });
      }
      targetSession = refreshedTarget;
    } else {
      const continuationName = typeof nameInput === "string" && nameInput.trim()
        ? nameInput.trim()
        : nextContinuationName(sessionCheck.session.name);
      const created = await insertSessionWithContacts(
        client,
        user.id,
        continuationName,
        payloadContacts,
        scheduledForInput,
        {
          // Un contact encore jamais appelé reste une prospection reportée,
          // pas une relance. Les contacts déjà essayés restent des relances.
          sessionType: sessionTypeInput || (
            sourceContacts.every((contact) => contact.status === "pending" && !(contact.attempt_count > 0))
              ? "prospection"
              : "relance"
          ),
        },
      );
      if (created.error) {
        return new Response(JSON.stringify({ error: created.error }), { status: created.status, headers });
      }
      targetSession = created.session;
      targetContacts = created.contacts;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        target_session: targetSession,
        contacts: targetContacts,
      }),
      { status: 200, headers },
    );
  }

  if (action === "complete_session") {
    const { session_id } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    if (sessionCheck.session.status === "completed") {
      return new Response(JSON.stringify({ error: "already_completed" }), { status: 400, headers });
    }

    const { error: updateError } = await client
      .from("call_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", session_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "session_update_failed" }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  }

  if (action === "set_session_members") {
    const { session_id, member_user_ids: memberUserIds } = body;
    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (!Array.isArray(memberUserIds) || memberUserIds.some((id) => typeof id !== "string" || !id)) {
      return new Response(JSON.stringify({ error: "invalid_member_user_ids" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const uniqueIds = [...new Set(memberUserIds.filter((id) => id !== user.id && !String(id).startsWith("map:")))];
    if (uniqueIds.length > 0) {
      const { data: profiles, error: profilesError } = await client
        .from("profiles")
        .select("id")
        .in("id", uniqueIds);
      if (profilesError) {
        return new Response(JSON.stringify({ error: "members_lookup_failed" }), { status: 500, headers });
      }
      if ((profiles || []).length !== uniqueIds.length) {
        return new Response(JSON.stringify({ error: "invalid_member_user_ids" }), { status: 400, headers });
      }
    }

    const { data: existingMemberRows, error: existingMembersError } = await client
      .from("call_session_members")
      .select("user_id")
      .eq("session_id", session_id);
    if (existingMembersError) {
      return new Response(JSON.stringify({ error: "session_members_lookup_failed" }), { status: 500, headers });
    }
    const newlyAddedIds = newlyAddedSessionMemberIds(
      (existingMemberRows || []).map((row) => row.user_id),
      uniqueIds,
      user.id,
    );

    const { error: deleteError } = await client
      .from("call_session_members")
      .delete()
      .eq("session_id", session_id);
    if (deleteError) {
      return new Response(JSON.stringify({ error: "members_update_failed" }), { status: 500, headers });
    }

    if (uniqueIds.length > 0) {
      const rows = uniqueIds.map((memberId) => ({
        session_id,
        user_id: memberId,
        added_by: user.id,
      }));
      const { error: insertError } = await client.from("call_session_members").insert(rows);
      if (insertError) {
        return new Response(JSON.stringify({ error: "members_update_failed" }), { status: 500, headers });
      }
    }

    if (newlyAddedIds.length > 0) {
      const actorLabel = user.user_metadata?.full_name || user.email || "Un collègue";
      const notification = sessionShareNotification({
        sessionId: session_id,
        sessionName: sessionCheck.session.name,
        actorId: user.id,
        actorLabel,
      });
      await Promise.all(
        newlyAddedIds.map((recipientId) =>
          insertUserNotification(client, { recipientId, ...notification }),
        ),
      );
    }

    const { data: memberRows } = await client
      .from("call_session_members")
      .select("user_id")
      .eq("session_id", session_id);
    const memberIds = (memberRows || []).map((row) => row.user_id);
    let payload = [];
    if (memberIds.length > 0) {
      const { data: memberProfiles } = await client
        .from("profiles")
        .select("id, full_name, email, sf_user_id")
        .in("id", memberIds);
      payload = (memberProfiles || []).map((profile) => ({
        user_id: profile.id,
        label: profile.full_name || profile.email || profile.id,
        sf_user_id: profile.sf_user_id || null,
      }));
    }

    return new Response(JSON.stringify({ ok: true, members: payload }), { status: 200, headers });
  }

  return null;
}
