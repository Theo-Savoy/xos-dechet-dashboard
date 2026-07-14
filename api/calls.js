import { verifyJWT } from "./_auth.js";
import { searchAccounts } from "./_calls/accountsSearch.js";
import { listContacts } from "./_calls/listContacts.js";
import { deletePreset, listPresets, savePreset } from "./_calls/presets.js";
import { handleLogging } from "./_calls/logging.js";
import { handleSessionsRead } from "./_calls/sessionsRead.js";
import { handleSessionWrite } from "./_calls/sessionsWrite.js";
import { getServiceClient, jsonResponse } from "./_calls/http.js";

export {
  SESSION_TYPES,
  SF_ID,
  computeHubKpis,
  filterContactsForFollowUp,
  getFollowUpOutcomes,
  isNotFoundError,
  isValidEventStart,
  isValidScheduledFor,
  isValidSessionType,
  todayParisDate,
} from "./_calls/http.js";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const response = (status, body) => jsonResponse(status, body, headers);

async function authenticatedContext(request) {
  const user = await verifyJWT(request);
  if (!user) return { error: response(401, { error: "unauthorized" }) };
  return { user };
}

function serviceContext(context) {
  const client = getServiceClient();
  if (!client) return { error: response(500, { error: "server_error" }) };
  return { ...context, client };
}

export async function GET(request) {
  const authenticated = await authenticatedContext(request);
  if (authenticated.error) return authenticated.error;
  const context = serviceContext(authenticated);
  if (context.error) return context.error;
  return handleSessionsRead({ ...context, url: new URL(request.url), headers });
}

async function handleBuiltInAction(action, body, user, client) {
  if (action === "list_contacts") {
    const result = await listContacts(client, user.id, body);
    if (result.error) return response(result.status || 500, { error: result.error, ...(result.message ? { message: result.message } : {}) });
    if (typeof result.count === "number") return response(200, { count: result.count, capped: Boolean(result.capped) });
    return response(200, { contacts: result.contacts, dedup: result.dedup, truncated: Boolean(result.truncated) });
  }
  if (action === "accounts_search") {
    const result = await searchAccounts(client, user.id, body);
    if (result.error) return response(result.status || 500, { error: result.error, ...(result.message ? { message: result.message } : {}) });
    return response(200, { accounts: result.accounts, truncated: Boolean(result.truncated) });
  }
  if (action === "list_presets") {
    const result = await listPresets(client, user.id);
    return result.error ? response(500, { error: result.error }) : response(200, { presets: result.presets });
  }
  if (action === "save_preset") {
    const result = await savePreset(client, user.id, body);
    return result.error ? response(result.status || 500, { error: result.error }) : response(200, { preset: result.preset });
  }
  if (action === "delete_preset") {
    const result = await deletePreset(client, user.id, body.id);
    return result.error ? response(result.status || 500, { error: result.error }) : response(200, { ok: true });
  }
  return null;
}

export async function POST(request) {
  const context = await authenticatedContext(request);
  if (context.error) return context.error;
  let body;
  try { body = await request.json(); } catch { return response(400, { error: "invalid_json" }); }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return response(400, { error: "invalid_body" });
  if (!body.action) return response(400, { error: "missing_action" });
  Object.assign(context, serviceContext(context));
  if (context.error) return context.error;
  const args = { action: body.action, body, headers, ...context };
  return (await handleBuiltInAction(body.action, body, context.user, context.client))
    || (await handleSessionWrite(args))
    || (await handleLogging(args))
    || response(400, { error: "invalid_action" });
}

export async function DELETE(request) {
  const authenticated = await authenticatedContext(request);
  if (authenticated.error) return authenticated.error;
  const context = serviceContext(authenticated);
  if (context.error) return context.error;
  const url = new URL(request.url);
  if (url.searchParams.get("resource") !== "presets") return response(400, { error: "invalid_resource" });
  let presetId = url.searchParams.get("id");
  if (!presetId) { try { presetId = (await request.json())?.id; } catch { presetId = null; } }
  const result = await deletePreset(context.client, context.user.id, presetId);
  return result.error ? response(result.status || 500, { error: result.error }) : response(200, { ok: true });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" } });
}
