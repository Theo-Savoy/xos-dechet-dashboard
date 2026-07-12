import { getProfile } from "./profileCache.js";
import mapping from "../_crm/mapping.js";
import { createEvent, fetchSFToken, logCall, updateContactDoNotCall } from "../_crm/salesforce.js";
import { SF_ID, actorName, assertSessionContact, assertSessionOwner, isValidEventStart, journalAction } from "./http.js";

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

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
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
    if (contact.status && contact.status !== "pending" && !(contact.status === "called" && contact.recall_at)) {
      return new Response(JSON.stringify({ error: "contact_already_processed" }), { status: 409, headers });
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
    const { session_id, contact_id, start, duration_min, invitees } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }
    if (!isValidEventStart(start)) {
      return new Response(JSON.stringify({ error: "invalid_start" }), { status: 400, headers });
    }
    if (!Number.isInteger(duration_min) || duration_min < 1) {
      return new Response(JSON.stringify({ error: "invalid_duration_min" }), { status: 400, headers });
    }
    if (invitees !== undefined && (!Array.isArray(invitees) || invitees.some((id) => typeof id !== "string" || !SF_ID.test(id)))) {
      return new Response(JSON.stringify({ error: "invalid_invitees" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
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

    const tokenResult = await fetchSFToken({ client, userId: user.id });
    if (tokenResult.error) {
      return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
    }

    const sfResult = await createEvent(
      tokenResult.accessToken,
      {
        subject: `RDV — ${contact.contact_name}`,
        startDateTime: start,
        durationMin: duration_min,
        whoId: contact.sf_contact_id,
        whatId: contact.sf_account_id || undefined,
        ownerId: profileResult.sfUserId || undefined,
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
        .update({ sf_event_id: eventId })
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
      changes: { start, duration_min, invitees: invitees || [] },
      targets: [{ id: contact.sf_contact_id, type: "Contact", session_contact_id: contact_id, session_id }],
      result: {
        success: !partialInviteeFailure,
        partial: partialInviteeFailure,
        eventId,
        inviteeError: sfResult.inviteeError,
      },
    });

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

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
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

    const { error: updateError } = await client
      .from("call_session_contacts")
      .update({
        status: "skipped",
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

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
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

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
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

  return null;
}
