import { verifyJWT, respond } from "./_auth.js";

export async function GET(request) {
  const user = await verifyJWT(request);
  if (!user) {
    return respond(401, { error: "Unauthorized" });
  }
  return respond(200, { user });
}
