// vendor-notify Edge Function
// 案件登録時に業者へ作業依頼メールを送信する

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'noreply@example.com';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const body = await req.json();
    const {
      vendorEmail,
      vendorName,
      propertyName,
      room,
      workType,
      caseNo,
      scheduledDate = '',
      instructions = '',
      caseUrl,
    } = body;

    const scheduledRow = scheduledDate
      ? `<tr><td style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;font-weight:700;width:80px;border:1px solid #dde5ef;">予定日</td><td style="padding:8px 12px;border:1px solid #dde5ef;">${scheduledDate}</td></tr>`
      : '';

    const instructionsRow = instructions
      ? `<tr><td style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;font-weight:700;border:1px solid #dde5ef;vertical-align:top;">指示事項</td><td style="padding:8px 12px;border:1px solid #dde5ef;white-space:pre-wrap;">${instructions}</td></tr>`
      : '';

    const html = `
<!DOCTYPE html>
<html lang="ja">
<body style="font-family:'Hiragino Kaku Gothic ProN',sans-serif;background:#f0f4f8;margin:0;padding:20px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.1);">
  <div style="background:#1a3a5c;color:#fff;padding:24px 28px;">
    <div style="font-size:18px;font-weight:700;">作業依頼のご連絡</div>
    <div style="font-size:13px;opacity:.8;margin-top:4px;">以下の案件をご担当いただきます</div>
  </div>
  <div style="padding:28px;">
    <p style="margin:0 0 20px;font-size:14px;color:#334155;">${vendorName} 様<br><br>お世話になっております。<br>下記の作業依頼をお送りします。</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
      <tr><td style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;font-weight:700;width:80px;border:1px solid #dde5ef;">案件No</td><td style="padding:8px 12px;border:1px solid #dde5ef;font-weight:700;">${caseNo}</td></tr>
      <tr><td style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;font-weight:700;border:1px solid #dde5ef;">物件名</td><td style="padding:8px 12px;border:1px solid #dde5ef;">${propertyName}</td></tr>
      <tr><td style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;font-weight:700;border:1px solid #dde5ef;">号室</td><td style="padding:8px 12px;border:1px solid #dde5ef;">${room}</td></tr>
      <tr><td style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;font-weight:700;border:1px solid #dde5ef;">作業区分</td><td style="padding:8px 12px;border:1px solid #dde5ef;">${workType}</td></tr>
      ${scheduledRow}
      ${instructionsRow}
    </table>
    <div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;padding:16px 20px;text-align:center;">
      <div style="font-size:13px;color:#0369a1;font-weight:700;margin-bottom:12px;">報告書入力フォームはこちら</div>
      <a href="${caseUrl}" style="display:inline-block;background:#1a3a5c;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">フォームを開く</a>
      <div style="font-size:11px;color:#64748b;margin-top:10px;word-break:break-all;">${caseUrl}</div>
    </div>
    <p style="font-size:13px;color:#64748b;margin:20px 0 0;">ご不明な点はお電話でお問い合わせください。<br>作業完了後はフォームより報告書をご提出ください。</p>
  </div>
  <div style="background:#f0f4f8;padding:14px 28px;font-size:11px;color:#94a3b8;text-align:center;">
    このメールは自動送信されています。返信はできません。
  </div>
</div>
</body>
</html>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from:    FROM_EMAIL,
        to:      [vendorEmail],
        subject: `【作業依頼】${propertyName} ${room}（${workType}）— 案件No: ${caseNo}`,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Resend API error: ${res.status} ${errText}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}
