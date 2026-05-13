// register-confirm Edge Function
// 依頼フォーム送信後に受付完了メールを送信する

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'noreply@example.com';   // Resend で認証済みドメイン
const ADMIN_EMAIL    = Deno.env.get('ADMIN_EMAIL') ?? '';                      // 管理者への通知先

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const body = await req.json();
    const {
      clientEmail,
      clientName,
      contactName,
      propertyName,
      room,
      checkedItems = [],
      comment = '',
    } = body;

    const itemsHtml = checkedItems.length
      ? checkedItems.map((i: string) => `<li style="margin-bottom:4px;">✅ ${i}</li>`).join('')
      : '<li style="color:#999;">なし</li>';

    const commentHtml = comment
      ? `<p style="white-space:pre-wrap;margin:0;">${comment}</p>`
      : '<p style="color:#999;margin:0;">なし</p>';

    // ① 依頼者への受付完了メール
    const clientHtml = `
<!DOCTYPE html>
<html lang="ja">
<body style="font-family:'Hiragino Kaku Gothic ProN',sans-serif;background:#f0f4f8;margin:0;padding:20px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.1);">
  <div style="background:#1a3a5c;color:#fff;padding:24px 28px;">
    <div style="font-size:18px;font-weight:700;">依頼を受け付けました</div>
    <div style="font-size:13px;opacity:.8;margin-top:4px;">内容を確認次第ご連絡いたします</div>
  </div>
  <div style="padding:28px;">
    <p style="margin:0 0 20px;font-size:14px;color:#334155;">${contactName} 様<br><br>この度はご依頼いただきありがとうございます。<br>以下の内容で受け付けました。</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;font-weight:700;width:80px;border:1px solid #dde5ef;">会社名</td><td style="padding:8px 12px;border:1px solid #dde5ef;">${clientName}</td></tr>
      <tr><td style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;font-weight:700;border:1px solid #dde5ef;">物件名</td><td style="padding:8px 12px;border:1px solid #dde5ef;">${propertyName} ${room}</td></tr>
      <tr><td style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;font-weight:700;border:1px solid #dde5ef;vertical-align:top;">依頼内容</td>
          <td style="padding:8px 12px;border:1px solid #dde5ef;"><ul style="margin:0;padding-left:0;list-style:none;">${itemsHtml}</ul></td></tr>
      <tr><td style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;font-weight:700;border:1px solid #dde5ef;vertical-align:top;">コメント</td>
          <td style="padding:8px 12px;border:1px solid #dde5ef;">${commentHtml}</td></tr>
    </table>
    <p style="font-size:13px;color:#64748b;margin:0;">担当者より確認後、折り返しご連絡いたします。<br>ご不明な点はお電話またはメールにてお問い合わせください。</p>
  </div>
  <div style="background:#f0f4f8;padding:14px 28px;font-size:11px;color:#94a3b8;text-align:center;">
    このメールは自動送信されています。返信はできません。
  </div>
</div>
</body>
</html>`;

    // ② 管理者への通知メール
    const adminHtml = `
<!DOCTYPE html>
<html lang="ja">
<body style="font-family:sans-serif;padding:20px;">
<h2 style="color:#1a3a5c;">【新着依頼】${clientName} より</h2>
<table style="border-collapse:collapse;font-size:13px;">
  <tr><td style="padding:6px 10px;background:#eef3f9;font-weight:700;">会社名</td><td style="padding:6px 12px;">${clientName}</td></tr>
  <tr><td style="padding:6px 10px;background:#eef3f9;font-weight:700;">担当者</td><td style="padding:6px 12px;">${contactName}</td></tr>
  <tr><td style="padding:6px 10px;background:#eef3f9;font-weight:700;">メール</td><td style="padding:6px 12px;">${clientEmail}</td></tr>
  <tr><td style="padding:6px 10px;background:#eef3f9;font-weight:700;">物件</td><td style="padding:6px 12px;">${propertyName} ${room}</td></tr>
  <tr><td style="padding:6px 10px;background:#eef3f9;font-weight:700;vertical-align:top;">依頼内容</td><td style="padding:6px 12px;"><ul style="margin:0;padding-left:16px;">${checkedItems.map((i: string)=>`<li>${i}</li>`).join('')}</ul></td></tr>
  <tr><td style="padding:6px 10px;background:#eef3f9;font-weight:700;vertical-align:top;">コメント</td><td style="padding:6px 12px;">${comment||'なし'}</td></tr>
</table>
<p style="margin-top:16px;font-size:13px;color:#64748b;">管理ダッシュボードで承認してください。</p>
</body>
</html>`;

    // Resend 送信（依頼者 + 管理者）
    const sends = [
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to:   [clientEmail],
          subject: `【受付完了】${propertyName} ${room} の作業依頼を受け付けました`,
          html: clientHtml,
        }),
      }),
    ];

    if (ADMIN_EMAIL) {
      sends.push(
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to:   [ADMIN_EMAIL],
            subject: `【新着依頼】${clientName} / ${propertyName} ${room}`,
            html: adminHtml,
          }),
        })
      );
    }

    await Promise.all(sends);

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
