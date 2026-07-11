/** Shared preset validation + CRUD helpers for /api/calls. */
export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validatePresetInput(body) {
  if (!body || !isPlainObject(body)) return { error: "invalid_body" };
  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return { error: "invalid_name" };
  }
  if (!isPlainObject(body.filters)) {
    return { error: "invalid_filters" };
  }
  for (const family of ["entreprise", "contact", "relance"]) {
    if (body.filters[family] !== undefined && !isPlainObject(body.filters[family])) {
      return { error: "invalid_filters" };
    }
  }
  if (body.shared !== undefined && typeof body.shared !== "boolean") {
    return { error: "invalid_shared" };
  }
  return {
    name: body.name.trim(),
    filters: body.filters,
    shared: body.shared === true,
  };
}

export function parsePresetId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value === "string") {
    if (!/^[1-9]\d*$/.test(value)) return null;
    if (value.length > String(Number.MAX_SAFE_INTEGER).length) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

export async function listPresets(client, userId) {
  const { data: presets, error } = await client
    .from("call_target_presets")
    .select("id, owner, name, filters, shared, created_at")
    .or(`owner.eq.${userId},shared.eq.true`)
    .order("created_at", { ascending: false });

  if (error) return { error: "preset_lookup_failed" };
  return { presets: presets || [] };
}

export async function savePreset(client, userId, body) {
  const validated = validatePresetInput(body);
  if (validated.error) return { error: validated.error, status: 400 };

  const { data: preset, error } = await client
    .from("call_target_presets")
    .insert({
      owner: userId,
      name: validated.name,
      filters: validated.filters,
      shared: validated.shared,
    })
    .select("id, owner, name, filters, shared, created_at")
    .single();

  if (error || !preset) return { error: "preset_creation_failed", status: 500 };
  return { preset };
}

export async function deletePreset(client, userId, presetId) {
  const id = parsePresetId(presetId);
  if (!id) return { error: "invalid_id", status: 400 };

  const { data: existing, error: lookupError } = await client
    .from("call_target_presets")
    .select("id, owner")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) return { error: "preset_lookup_failed", status: 500 };
  if (!existing || existing.owner !== userId) return { error: "not_found", status: 404 };

  const { error } = await client
    .from("call_target_presets")
    .delete()
    .eq("id", id)
    .eq("owner", userId);

  if (error) return { error: "preset_delete_failed", status: 500 };
  return { ok: true };
}
