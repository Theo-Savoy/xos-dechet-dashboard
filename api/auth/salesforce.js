/**
 * Salesforce OAuth start (Phase 8.1 stub).
 *
 * The login UI already points here. Until the full Web Server OAuth flow is
 * wired, redirect back to the SPA with a clear auth_error so the dual-option
 * login screen can surface a friendly message.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const redirect = new URL("/", url.origin);
  redirect.searchParams.set("auth_error", "sf_coming_soon");
  return Response.redirect(redirect.toString(), 302);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
