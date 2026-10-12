// R2 署名URL発行。JWT→本人確認→担当/テナント確認→presigned URL（期限10分）
import { AwsClient } from "npm:aws4fetch@1.0.20";

const SUPA = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ACC = Deno.env.get("R2_ACCOUNT_ID")!;
const BUCKET = Deno.env.get("R2_BUCKET")!;
const r2 = new AwsClient({
  accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
  secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  service: "s3", region: "auto",
});
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const auth = req.headers.get("authorization") ?? "";
  const ur = await fetch(`${SUPA}/auth/v1/user`, { headers: { apikey: ANON, authorization: auth } });
  if (!ur.ok) return json({ error: "unauthorized" }, 401);
  const user = await ur.json();

  const { caseId, keys } = await req.json() as
    { caseId: string; keys: { key: string; method: "PUT" | "GET" }[] };
  if (!caseId || !Array.isArray(keys) || keys.length === 0 || keys.length > 120)
    return json({ error: "bad request" }, 400);

  const sH = { apikey: SRK, authorization: `Bearer ${SRK}` };
  const prof = await (await fetch(
    `${SUPA}/rest/v1/profiles?user_id=eq.${user.id}&select=tenant_id,role`, { headers: sH })).json();
  const kase = await (await fetch(
    `${SUPA}/rest/v1/cases?id=eq.${caseId}&select=tenant_id,assigned_to`, { headers: sH })).json();
  if (!prof[0] || !kase[0] || kase[0].tenant_id !== prof[0].tenant_id)
    return json({ error: "forbidden" }, 403);
  if (prof[0].role !== "admin" && kase[0].assigned_to !== user.id)
    return json({ error: "forbidden" }, 403);

  const prefix = `${prof[0].tenant_id}/${caseId}/`;
  const out: { key: string; url: string }[] = [];
  for (const k of keys) {
    if (!(k.key.startsWith(prefix) || k.key.startsWith(`thumb/${prefix}`)))
      return json({ error: `invalid key: ${k.key}` }, 400);
    const url = `https://${ACC}.r2.cloudflarestorage.com/${BUCKET}/${k.key}?X-Amz-Expires=600`;
    const signed = await r2.sign(new Request(url, { method: k.method }), { aws: { signQuery: true } });
    out.push({ key: k.key, url: signed.url });
  }
  return json({ keys: out });
});
