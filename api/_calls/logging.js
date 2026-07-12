import { insertUserNotification } from "../notifications.js";
import { getProfile } from "./profileCache.js";
import mapping from "../_crm/mapping.js";
import { createEvent, fetchSFToken, logCall, updateContactDoNotCall, buildLightningUrl } from "../_crm/salesforce.js";
import { SF_ID, actorName, assertSessionAccess, assertSessionContact, claimSessionContact, isValidEventStart, journalAction } from "./http.js";

const VALID_RESULTS = mapping.objects.task.results;
const TASK_SEMANTIC = mapping.objects.task.resultSemantic;

export async function handleLogging({ action, body, user, client, headers }) {
  if (action === "log_call") {
    const { session_id, contact_id, resultat, comments, duration_sec, recall_at, do_not_call } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }
    if (!VALID_RESULTS.includes(resultat)) {
      return new Response(JSON.stringify({ error: "invalid_resultat" }), { status: 400, headers });
    }
    if (comments !== undefined && typeof comments !== "string") {
      return new Response(JSON.stringify({ error: "invalid_comments" }), { status: 400, headers });
    }
    if (duration_sec !== undefined && (!Number.isInteger(duration_sec) || duration_sec < 0)) {
      return new Response(JSON.stringify({ error: "invalid_duration_sec" }), { status: 400, headers });
    }
    if (recall_at !== undefined && recall_at !== null) {
      if (typeof recall_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(recall_at)) {
        return new Response(JSON.stringify({ error: "invalid_recall_at" }), { status: 400, headers });
      }
    }
    if (do_not_call !== undefined && typeof do_not_call !== "boolean") {
      return new Response(JSON.stringify({ error: "invalid_do_not_call" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionAccess(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const contactCheck = await assertSessionContact(client, session_id, contact_id);
    if (contactCheck.error) {
      return new Response(JSON.stringify({ error: contactCheck.error }), { status: contactCheck.status, headers });
    }
    const contact = contactCheck.contact;
    // The recalls queue targets its original persisted row, already called but
    // still carrying its scheduled recall. It is the only valid second log.
    const isRecallRelog = contact.status === "called" && contact.recall_at;
    if (contact.status && contact.status !== "pending" && !isRecallRelog) {
      return new Response(JSON.stringify({ error: "contact_already_processed" }), { status: 409, headers });
    }

    // Soft-claim avant l'écriture SF pour éviter le double log concurrent.
    if (!isRecallRelog) {
      const claim = await claimSessionContact(client, contact, user.id);
      if (claim.error) {
        return new Response(
          JSON.stringify({
            error: claim.error,
            ...(claim.claimed_by ? { claimed_by: claim.claimed_by } : {}),
          }),
          { status: claim.status, headers },
        );
      }
    }

    const profileResult = await getProfile(client, user.id);
    if (profileResult.error) {
      return new Response(JSON.stringify({ error: profileResult.error }), { status: 500, headers });
    }

    const tokenResult = await fetchSFToken({ client, userId: user.id });
    if (tokenResult.error) {
      return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
    }

    const callComments = comments || "";
    const sfResult = await logCall(
      tokenResult.accessToken,
      {
        contactId: contact.sf_contact_id,
        accountId: contact.sf_account_id,
        resultat,
        comments: callComments,
        durationSec: duration_sec ?? 0,
        ownerId: profileResult.sfUserId || undefined,
        actorName: actorName(user, profileResult),
      },
      mapping,
    );

    if (sfResult.error) {
      return new Response(
        JSON.stringify({ error: sfResult.error, message: sfResult.message }),
        { status: 502, headers },
      );
    }

    const taskId = sfResult.record?.id;
    const wantsRecall = typeof recall_at === "string" && recall_at;
    let npaFailed = false;

    if (do_not_call === true) {
      try {
        const npaResult = await updateContactDoNotCall(tokenResult.accessToken, contact.sf_contact_id, true, mapping);
        npaFailed = Boolean(npaResult?.error);
      } catch {
        npaFailed = true;
      }
    }

    const { error: updateError } = await client
      .from("call_session_contacts")
      .update({
        status: "called",
        outcome: resultat,
        comments: callComments || null,
        sf_task_id: taskId,
        called_at: new Date().toISOString(),
        recall_at: wantsRecall && do_not_call !== true ? recall_at : null,
        attempt_count: (Number.isInteger(contact.attempt_count) ? contact.attempt_count : 0) + 1,
        marked_npa: do_not_call === true,
        logged_by: user.id,
        claimed_by: null,
        claimed_at: null,
      })
      .eq("id", contact_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "contact_update_failed", sf_task_id: taskId }),
        { status: 500, headers },
      );
    }

    await journalAction({
      actorId: user.id,
      actionType: "call_session_log",
      changes: {
        resultat,
        comments: callComments,
        recall_at: wantsRecall && do_not_call !== true ? recall_at : null,
        do_not_call: do_not_call === true,
      },
      targets: [{ id: contact.sf_contact_id, type: "Contact", session_contact_id: contact_id, session_id }],
      result: { success: true, taskId, npa_failed: npaFailed },
    });

    const response = { ok: true, contact_id, sf_task_id: taskId, ...(npaFailed ? { npa_failed: true } : {}) };
    if (resultat === TASK_SEMANTIC.rdv) {
      response.needs_event = true;
    }

    return new Response(JSON.stringify(response), { status: 200, headers });
  }

  if (action === "log_event") {
    const { session_id, contact_id, start, duration_min, invitees, subject, owner_sf_user_id } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }
    if (!isValidEventStart(start)) {
      return new Response(JSON.stringify({ error: "invalid_start" }), { status: 400, headers });
    }
    const ALLOWED_DURATIONS = [15, 30, 45, 60, 90];
    if (!Number.isInteger(duration_min) || !ALLOWED_DURATIONS.includes(duration_min)) {
      return new Response(JSON.stringify({ error: "invalid_duration_min" }), { status: 400, headers });
    }
    if (invitees !== undefined && (!Array.isArray(invitees) || invitees.some((id) => typeof id !== "string" || !SF_ID.test(id)))) {
      return new Response(JSON.stringify({ error: "invalid_invitees" }), { status: 400, headers });
    }

    const ALLOWED_SUBJECTS = [
      "Rdv découverte prospect",
      "Rdv détection enjeux client",
      "Soutenance",
      "Point suivi client",
      "Point suivi opportunité",
    ];
    if (typeof subject !== "string" || !ALLOWED_SUBJECTS.includes(subject)) {
      return new Response(JSON.stringify({ error: "invalid_subject" }), { status: 400, headers });
    }
    if (
      owner_sf_user_id !== undefined
      && owner_sf_user_id !== null
      && (typeof owner_sf_user_id !== "string" || !SF_ID.test(owner_sf_user_id))
    ) {
      return new Response(JSON.stringify({ error: "invalid_owner_sf_user_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionAccess(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const contactCheck = await assertSessionContact(client, session_id, contact_id);
    if (contactCheck.error) {
      return new Response(JSON.stringify({ error: contactCheck.error }), { status: contactCheck.status, headers });
    }
    const contact = contactCheck.contact;

    const profileResult = await getProfile(client, user.id);
    if (profileResult.error) {
      return new Response(JSON.stringify({ error: profileResult.error }), { status: 500, headers });
    }

    let eventOwnerId = profileResult.sfUserId || undefined;
    if (owner_sf_user_id) {
      const { data: ownerProfile } = await client
        .from("profiles")
        .select("sf_user_id")
        .eq("sf_user_id", owner_sf_user_id)
        .maybeSingle();
      if (ownerProfile?.sf_user_id) {
        eventOwnerId = ownerProfile.sf_user_id;
      } else {
        const { data: mapped } = await client
          .from("sf_user_map")
          .select("sf_user_id")
          .eq("sf_user_id", owner_sf_user_id)
          .maybeSingle();
        if (!mapped?.sf_user_id) {
          return new Response(JSON.stringify({ error: "owner_not_in_team" }), { status: 400, headers });
        }
        eventOwnerId = mapped.sf_user_id;
      }
    }

    const tokenResult = await fetchSFToken({ client, userId: user.id });
    if (tokenResult.error) {
      return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
    }

    const sfResult = await createEvent(
      tokenResult.accessToken,
      {
        subject,
        startDateTime: start,
        durationMin: duration_min,
        whoId: contact.sf_contact_id,
        whatId: contact.sf_account_id || undefined,
        ownerId: eventOwnerId,
        invitees: invitees || [],
      },
      mapping,
    );

    if (sfResult.error && !sfResult.record?.id) {
      return new Response(
        JSON.stringify({ error: sfResult.error, message: sfResult.message, inviteeError: sfResult.inviteeError }),
        { status: 502, headers },
      );
    }

    const eventId = sfResult.record?.id;
    if (eventId) {
      const { error: updateError } = await client
        .from("call_session_contacts")
        .update({
          sf_event_id: eventId,
          ...(eventOwnerId ? { rdv_owner_sf_user_id: eventOwnerId } : {}),
        })
        .eq("id", contact_id);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: "contact_update_failed", sf_event_id: eventId }),
          { status: 500, headers },
        );
      }
    }

    const partialInviteeFailure = Boolean(sfResult.inviteeError);
    await journalAction({
      actorId: user.id,
      actionType: "call_session_event",
      changes: {
        start,
        duration_min,
        invitees: invitees || [],
        subject,
        owner_sf_user_id: eventOwnerId || null,
      },
      targets: [{ id: contact.sf_contact_id, type: "Contact", session_contact_id: contact_id, session_id }],
      result: {
        success: !partialInviteeFailure,
        partial: partialInviteeFailure,
        eventId,
        inviteeError: sfResult.inviteeError,
      },
    });

    // Notifie le commercial propriétaire quand quelqu'un d'autre lui prend un RDV.
    if (
      eventId
      && eventOwnerId
      && profileResult.sfUserId
      && eventOwnerId !== profileResult.sfUserId
    ) {
      const { data: ownerProfile } = await client
        .from("profiles")
        .select("id, full_name")
        .eq("sf_user_id", eventOwnerId)
        .maybeSingle();
      if (ownerProfile?.id) {
        const actor = actorName(user, profileResult);
        const when = new Date(start).toLocaleString("fr-FR", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        await insertUserNotification(client, {
          recipientId: ownerProfile.id,
          kind: "rdv_attributed",
          title: "Nouveau RDV attribué",
          body: `${actor} a planifié « ${subject} » avec ${contact.contact_name}${contact.account_name ? ` (${contact.account_name})` : ""} — ${when}.`,
          payload: {
            sf_event_id: eventId,
            sf_event_url: buildLightningUrl(mapping.objects.event.name, eventId),
            subject,
            contact_name: contact.contact_name,
            account_name: contact.account_name || null,
            start,
            actor_label: actor,
            session_id,
            session_contact_id: contact_id,
          },
        });
      }
    }

    if (partialInviteeFailure) {
      return new Response(
        JSON.stringify({ error: "event_invitee_failed", sf_event_id: eventId, inviteeError: sfResult.inviteeError }),
        { status: 502, headers },
      );
    }

    return new Response(JSON.stringify({ ok: true, sf_event_id: eventId }), { status: 200, headers });
  }

  if (action === "skip_contact") {
    const { session_id, contact_id } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionAccess(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const contactCheck = await assertSessionContact(client, session_id, contact_id);
    if (contactCheck.error) {
      return new Response(JSON.stringify({ error: contactCheck.error }), { status: contactCheck.status, headers });
    }
    if (contactCheck.contact.status && contactCheck.contact.status !== "pending") {
      return new Response(JSON.stringify({ error: "contact_already_processed" }), { status: 409, headers });
    }

    const claim = await claimSessionContact(client, contactCheck.contact, user.id);
    if (claim.error) {
      return new Response(
        JSON.stringify({
          error: claim.error,
          ...(claim.claimed_by ? { claimed_by: claim.claimed_by } : {}),
        }),
        { status: claim.status, headers },
      );
    }

    const { error: updateError } = await client
      .from("call_session_contacts")
      .update({
        status: "skipped",
        logged_by: user.id,
        claimed_by: null,
        claimed_at: null,
        // Non contacté = pas d'essai dans cette séance → pas d'incrément
      })
      .eq("id", contact_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "contact_update_failed" }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  }

  if (action === "remove_contact") {
    const { session_id, contact_id } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionAccess(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const contactCheck = await assertSessionContact(client, session_id, contact_id);
    if (contactCheck.error) {
      return new Response(JSON.stringify({ error: contactCheck.error }), { status: contactCheck.status, headers });
    }

    const status = contactCheck.contact.status || "pending";
    if (status !== "pending" && status !== "skipped") {
      return new Response(JSON.stringify({ error: "contact_not_removable" }), { status: 409, headers });
    }

    const { error: deleteError } = await client
      .from("call_session_contacts")
      .delete()
      .eq("id", contact_id)
      .eq("session_id", session_id);

    if (deleteError) {
      return new Response(JSON.stringify({ error: "contact_delete_failed" }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (action === "update_recall") {
    const { session_id, contact_id, recall_at: recallAtInput } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }
    if (recallAtInput !== null && (typeof recallAtInput !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(recallAtInput))) {
      return new Response(JSON.stringify({ error: "invalid_recall_at" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionAccess(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const contactCheck = await assertSessionContact(client, session_id, contact_id);
    if (contactCheck.error) {
      return new Response(JSON.stringify({ error: contactCheck.error }), { status: contactCheck.status, headers });
    }

    const contact = contactCheck.contact;
    if (contact.status !== "called") {
      return new Response(JSON.stringify({ error: "contact_not_called" }), { status: 409, headers });
    }
    if (recallAtInput === null && !contact.recall_at) {
      return new Response(JSON.stringify({ error: "recall_not_set" }), { status: 409, headers });
    }

    const { error: updateError } = await client
      .from("call_session_contacts")
      .update({ recall_at: recallAtInput })
      .eq("id", contact_id)
      .eq("session_id", session_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "contact_update_failed" }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ ok: true, recall_at: recallAtInput }), { status: 200, headers });
  }

  if (action === "claim_contact") {
    const { session_id, contact_id } = body;
    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionAccess(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }
    const contactCheck = await assertSessionContact(client, session_id, contact_id);
    if (contactCheck.error) {
      return new Response(JSON.stringify({ error: contactCheck.error }), { status: contactCheck.status, headers });
    }
    if (contactCheck.contact.status !== "pending") {
      return new Response(JSON.stringify({ error: "contact_already_processed" }), { status: 409, headers });
    }

    const claim = await claimSessionContact(client, contactCheck.contact, user.id);
    if (claim.error) {
      return new Response(
        JSON.stringify({
          error: claim.error,
          ...(claim.claimed_by ? { claimed_by: claim.claimed_by } : {}),
        }),
        { status: claim.status, headers },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        contact_id,
        claimed_by: user.id,
        claimed_at: claim.contact.claimed_at,
      }),
      { status: 200, headers },
    );
  }

  return null;
}
