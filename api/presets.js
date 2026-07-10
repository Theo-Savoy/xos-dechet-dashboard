import { createClient } from "@supabase/supabase-js";
import { verifyJWT } from "./_auth.js";

function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey);
}

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

function parsePresetId(value) {
  const id = typeof value === "string" ? parseInt(value, 10) : value;
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

export async function GET(request) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  const user = await verifyJWT(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  const client = getServiceClient();
  if (!client) {
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }

  const { data: presets, error } = await client
    .from("call_target_presets")
    .select("id, owner, name, filters, shared, created_at")
    .or(`owner.eq.${user.id},shared.eq.true`)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: "preset_lookup_failed" }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ presets: presets || [] }), { status: 200, headers });
}

export async function POST(request) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  const user = await verifyJWT(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers });
  }

  const validated = validatePresetInput(body);
  if (validated.error) {
    return new Response(JSON.stringify({ error: validated.error }), { status: 400, headers });
  }

  const client = getServiceClient();
  if (!client) {
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }

  const { data: preset, error } = await client
    .from("call_target_presets")
    .insert({
      owner: user.id,
      name: validated.name,
      filters: validated.filters,
      shared: validated.shared,
    })
    .select("id, owner, name, filters, shared, created_at")
    .single();

  if (error || !preset) {
    return new Response(JSON.stringify({ error: "preset_creation_failed" }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ preset }), { status: 200, headers });
}

export async function DELETE(request) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  const user = await verifyJWT(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  const url = new URL(request.url);
  let presetId = parsePresetId(url.searchParams.get("id"));

  if (!presetId) {
    try {
      const body = await request.json();
      presetId = parsePresetId(body?.id);
    } catch {
      presetId = null;
    }
  }

  if (!presetId) {
    return new Response(JSON.stringify({ error: "invalid_id" }), { status: 400, headers });
  }

  const client = getServiceClient();
  if (!client) {
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }

  const { data: existing } = await client
    .from("call_target_presets")
    .select("id, owner")
    .eq("id", presetId)
    .maybeSingle();

  if (!existing) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
  }
  if (existing.owner !== user.id) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
  }

  const { error } = await client
    .from("call_target_presets")
    .delete()
    .eq("id", presetId)
    .eq("owner", user.id);

  if (error) {
    return new Response(JSON.stringify({ error: "preset_delete_failed" }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
