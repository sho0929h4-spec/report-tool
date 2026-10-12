// 下書きメール送信。JWT→admin確認→draft/stakeholder/case取得→Resend送信→status='sent'
const SUPA = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const SUBJ: Record<string, string> = {
  preVisit: "【作業前日のご案内】",
  reportReady: "【報告書完成のお知らせ】",
  siteReport: "【現地調査のご報告】",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const auth = req.headers.get("authorization") ?? "";
  const ur = await fetch(`${SUPA}/auth/v1/user`, { headers: { apikey: ANON, authorization: auth } });
  if (!ur.ok) return json({ error: "unauthorized" }, 401);
  const user = await ur.json();

  const { draftId } = await req.json() as { draftId: string };
  if (!draftId) return json({ error: "bad request" }, 400);

  const sH = { apikey: SRK, authorization: `Bearer ${SRK}` };
  const prof = await (await fetch(
    `${SUPA}/rest/v1/profiles?user_id=eq.${user.id}&select=tenant_id,role`, { headers: sH })).json();
  if (!prof[0] || prof[0].role !== "admin") return json({ error: "forbidden" }, 403);

  const drafts = await (await fetch(
    `${SUPA}/rest/v1/message_drafts?id=eq.${draftId}&select=*`, { headers: sH })).json();
  const draft = drafts[0];
  if (!draft || draft.tenant_id !== prof[0].tenant_id) return json({ error: "not found" }, 404);
  if (draft.status !== "draft") return json({ error: "already handled" }, 400);
  if (!draft.stakeholder_id) return json({ error: "no stakeholder" }, 400);

  const shs = await (await fetch(
    `${SUPA}/rest/v1/stakeholders?id=eq.${draft.stakeholder_id}&select=email,name`, { headers: sH })).json();
  const email = shs[0]?.email;
  if (!email) return json({ error: "no email" }, 400);

  const kases = await (await fetch(
    `${SUPA}/rest/v1/cases?id=eq.${draft.case_id}&select=property_name,room_no`, { headers: sH })).json();
  const kase = kases[0] || {};
  const subject = `${SUBJ[draft.trigger_type] || ""}${kase.property_name || ""}${kase.room_no ? " " + kase.room_no : ""}`;

  const rr = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to: [email], subject, text: draft.body }),
  });
  if (!rr.ok) {
    const detail = await rr.text();
    return json({ error: "send failed", detail }, 502);
  }

  const up = await fetch(`${SUPA}/rest/v1/message_drafts?id=eq.${draftId}`, {
    method: "PATCH",
    headers: { ...sH, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }),
  });
  if (!up.ok) return json({ error: "sent but status update failed" }, 500);
  return json({ ok: true });
});
