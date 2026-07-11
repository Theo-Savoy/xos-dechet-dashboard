import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetProfileCache, getProfile } from "./profileCache.js";

function profileClient(result) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { client: { from: vi.fn().mockReturnValue({ select }) }, maybeSingle };
}

describe("getProfile", () => {
  beforeEach(() => __resetProfileCache());

  it("uses one database query for two requests from the same user", async () => {
    const { client, maybeSingle } = profileClient({ data: { sf_user_id: "005", full_name: "Ada Lovelace", role: "manager" }, error: null });

    await expect(getProfile(client, "user-1")).resolves.toEqual({ sfUserId: "005", fullName: "Ada Lovelace", role: "manager" });
    await expect(getProfile(client, "user-1")).resolves.toEqual({ sfUserId: "005", fullName: "Ada Lovelace", role: "manager" });

    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("keeps different users in separate cache entries", async () => {
    const { client, maybeSingle } = profileClient({ data: { sf_user_id: "005", full_name: "Ada Lovelace" }, error: null });

    await getProfile(client, "user-1");
    await getProfile(client, "user-2");

    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it("does not cache lookup errors", async () => {
    const { client, maybeSingle } = profileClient({ data: null, error: { message: "database unavailable" } });

    await expect(getProfile(client, "user-1")).resolves.toEqual({ error: "profile_lookup_failed" });
    await expect(getProfile(client, "user-1")).resolves.toEqual({ error: "profile_lookup_failed" });

    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });
});
