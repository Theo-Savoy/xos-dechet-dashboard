import { apiFetch } from "../lib/apiClient";

export async function startSalesforceLink(
  accessToken: string,
  navigate: (url: string) => void = (url) => window.location.assign(url),
) {
  const body = await apiFetch<{ authorization_url?: string }>(
    accessToken,
    "/api/auth?flow=salesforce-link",
    { method: "POST" },
  ).catch(() => {
    throw new Error("sf_link_start_failed");
  });
  if (!body.authorization_url) throw new Error("sf_link_start_failed");
  navigate(body.authorization_url);
}
