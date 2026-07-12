import { encryptRefreshToken } from "./tokenEncryption.js";

const STATE_TTL_MS = 10 * 60_000;

function callbackUrl(origin) {
  return `${origin}/api/auth?flow=salesforce-callback`;
}

function randomState() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

async function stateHash(state) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  return Buffer.from(digest).toString("base64url");
}

function oauthConfig() {
  const instanceUrl = (process.env.SF_INSTANCE_URL || "https://db0000000d7rdeay.my.salesforce.com").replace(/\/$/, "");
  const loginUrl = (process.env.SF_LOGIN_URL || "").replace(/\/$/, "");
  return {
    clientId: process.env.SF_CLIENT_ID || "",
    clientSecret: process.env.SF_CLIENT_SECRET || "",
    // Authorize on My Domain so users land on the org login page.
    authorizeUrl: instanceUrl,
    // Token endpoint: prefer login host when set, else instance.
    tokenUrl: loginUrl || instanceUrl,
  };
}

async function verifyIdentityAndStore({ client, profile, refreshToken, accessToken, instanceUrl }) {
  let identityResponse;
  try {
    identityResponse = await fetch(`${instanceUrl}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { error: "sf_identity_lookup_failed" };
  }
  if (!identityResponse.ok) return { error: "sf_identity_lookup_failed" };
  const identity = await identityResponse.json();
  const emailMatches = identity.email && profile.email
    && identity.email.toLowerCase() === profile.email.toLowerCase();
  if (!emailMatches || !profile.sf_user_id || identity.user_id !== profile.sf_user_id) {
    return { error: "sf_identity_mismatch" };
  }

  const { error: storeError } = await client.from("profiles").update({
    sf_refresh_token_encrypted: await encryptRefreshToken(refreshToken),
    sf_auth_connected_at: new Date().toISOString(),
  }).eq("id", profile.id);
  return storeError ? { error: "sf_token_store_failed" } : { ok: true };
}

export async function storeSalesforceRefreshToken({ client, user, refreshToken }) {
  const { data: profile, error: lookupError } = await client
    .from("profiles")
    .select("id, email, sf_user_id")
    .eq("id", user.id)
    .maybeSingle();
  if (lookupError || !profile) return { error: "profile_lookup_failed" };

  const { clientId, clientSecret, tokenUrl } = oauthConfig();
  if (!clientId || !clientSecret) return { error: "sf_missing_credentials" };
  let response;
  try {
    response = await fetch(`${tokenUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { error: "sf_auth_error" };
  }
  if (!response.ok) return { error: "sf_auth_error" };
  const tokens = await response.json();
  if (!tokens.access_token || !tokens.instance_url) return { error: "sf_auth_error" };
  return verifyIdentityAndStore({
    client,
    profile,
    refreshToken,
    accessToken: tokens.access_token,
    instanceUrl: tokens.instance_url,
  });
}

export async function startSalesforceOAuth({ client, user, origin }) {
  const { clientId, clientSecret, authorizeUrl } = oauthConfig();
  if (!clientId || !clientSecret) return { error: "sf_missing_credentials" };
  const state = randomState();
  const { error } = await client.from("profiles").update({
    sf_oauth_state_hash: await stateHash(state),
    sf_oauth_state_expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  }).eq("id", user.id);
  if (error) return { error: "sf_state_store_failed" };

  const authorization = new URL("/services/oauth2/authorize", authorizeUrl);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callbackUrl(origin),
    scope: "openid email profile api refresh_token",
    state,
    prompt: "login consent",
  }).toString();
  return { authorizationUrl: authorization.toString() };
}

export async function completeSalesforceOAuth({ client, url }) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return { error: "sf_oauth_invalid_callback" };

  const hash = await stateHash(state);
  const { data: profile, error: lookupError } = await client
    .from("profiles")
    .select("id, email, sf_user_id")
    .eq("sf_oauth_state_hash", hash)
    .gt("sf_oauth_state_expires_at", new Date().toISOString())
    .maybeSingle();
  if (lookupError || !profile) return { error: "sf_oauth_invalid_state" };

  const { error: consumeError } = await client.from("profiles").update({
    sf_oauth_state_hash: null,
    sf_oauth_state_expires_at: null,
  }).eq("id", profile.id).eq("sf_oauth_state_hash", hash);
  if (consumeError) return { error: "sf_state_store_failed" };

  const { clientId, clientSecret, tokenUrl } = oauthConfig();
  if (!clientId || !clientSecret) return { error: "sf_missing_credentials" };
  let tokenResponse;
  try {
    tokenResponse = await fetch(`${tokenUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl(url.origin),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { error: "sf_auth_error" };
  }
  if (!tokenResponse.ok) return { error: "sf_auth_error" };
  const tokens = await tokenResponse.json();
  if (!tokens.access_token || !tokens.refresh_token || !tokens.instance_url) return { error: "sf_refresh_token_missing" };

  return verifyIdentityAndStore({
    client,
    profile,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    instanceUrl: tokens.instance_url,
  });
}
