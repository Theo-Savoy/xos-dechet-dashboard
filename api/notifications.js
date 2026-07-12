import { createClient } from "@supabase/supabase-js";
import { respond, verifyJWT } from "./_auth.js";

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

export async function GET(request) {
  const user = await verifyJWT(request);
  if (!user) return respond(401, { error: "unauthorized" });
  const client = getServiceClient();
  if (!client) return respond(500, { error: "server_error" });

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limitRaw = Number(url.searchParams.get("limit") || 40);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 40;

  let query = client
    .from("user_notifications")
    .select("id, kind, title, body, payload, created_at, read_at")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unreadOnly) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error) return respond(500, { error: "notifications_lookup_failed" });

  const { count: unreadCount, error: countError } = await client
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .is("read_at", null);
  if (countError) return respond(500, { error: "notifications_count_failed" });

  return respond(200, {
    notifications: data || [],
    unread_count: unreadCount ?? 0,
  });
}

export async function POST(request) {
  const user = await verifyJWT(request);
  if (!user) return respond(401, { error: "unauthorized" });
  const client = getServiceClient();
  if (!client) return respond(500, { error: "server_error" });

  let body;
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || !body.action) {
    return respond(400, { error: "invalid_body" });
  }

  if (body.action === "mark_read") {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => Number.isInteger(id) && id > 0) : null;
    const markAll = body.all === true;
    if (!markAll && (!ids || ids.length === 0)) {
      return respond(400, { error: "invalid_ids" });
    }
    const now = new Date().toISOString();
    let query = client
      .from("user_notifications")
      .update({ read_at: now })
      .eq("recipient_id", user.id)
      .is("read_at", null);
    if (!markAll) query = query.in("id", ids);
    const { error } = await query;
    if (error) return respond(500, { error: "notifications_update_failed" });
    return respond(200, { ok: true });
  }

  if (body.action === "react") {
    const ALLOWED_EMOJIS = new Set(["👏", "🔥", "💪"]);
    const notificationId = body.notification_id;
    const emoji = body.emoji;
    if (!Number.isInteger(notificationId) || notificationId < 1) {
      return respond(400, { error: "invalid_notification_id" });
    }
    if (typeof emoji !== "string" || !ALLOWED_EMOJIS.has(emoji)) {
      return respond(400, { error: "invalid_emoji" });
    }

    const { data: original, error: lookupError } = await client
      .from("user_notifications")
      .select("id, kind, payload, recipient_id")
      .eq("id", notificationId)
      .eq("recipient_id", user.id)
      .maybeSingle();
    if (lookupError) return respond(500, { error: "notifications_lookup_failed" });
    if (!original || original.kind !== "session_goal_hit") {
      return respond(404, { error: "not_found" });
    }

    const payload = original.payload && typeof original.payload === "object" ? original.payload : {};
    const actorId = typeof payload.actor_id === "string" ? payload.actor_id : null;
    if (!actorId || actorId === user.id) {
      return respond(400, { error: "invalid_actor" });
    }

    const { data: reactorProfile } = await client
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    const reactorLabel =
      reactorProfile?.full_name || user.user_metadata?.full_name || user.email || "Quelqu'un";

    const reactions = Array.isArray(payload.reactions) ? [...payload.reactions] : [];
    reactions.push({
      emoji,
      from_id: user.id,
      from_label: reactorLabel,
      at: new Date().toISOString(),
    });
    const { error: updateError } = await client
      .from("user_notifications")
      .update({ payload: { ...payload, reactions } })
      .eq("id", notificationId)
      .eq("recipient_id", user.id);
    if (updateError) return respond(500, { error: "notifications_update_failed" });

    await insertUserNotification(client, {
      recipientId: actorId,
      kind: "goal_reaction",
      title: `${reactorLabel} réagit`,
      body: emoji,
      payload: {
        emoji,
        session_id: payload.session_id ?? null,
        from_notification_id: notificationId,
        reactor_id: user.id,
        reactor_label: reactorLabel,
      },
    });

    return respond(200, { ok: true });
  }

  return respond(400, { error: "invalid_action" });
}

/** Best-effort insert used by call logging (service role). */
export async function insertUserNotification(client, {
  recipientId,
  kind,
  title,
  body,
  payload = {},
}) {
  if (!client || !recipientId || !kind || !title || !body) return;
  try {
    const { error } = await client.from("user_notifications").insert({
      recipient_id: recipientId,
      kind,
      title,
      body,
      payload,
    });
    if (error) console.error("Failed to insert user_notification:", error);
  } catch (err) {
    console.error("Failed to insert user_notification:", err);
  }
}
