export async function startSalesforceLink(
  accessToken: string,
  navigate: (url: string) => void = (url) => window.location.assign(url),
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("/api/auth?flow=salesforce-link", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json() as { authorization_url?: string };
  if (!response.ok || !body.authorization_url) throw new Error("sf_link_start_failed");
  navigate(body.authorization_url);
}
