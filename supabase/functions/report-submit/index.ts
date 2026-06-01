// supabase/functions/report-submit/index.ts
// 報告書送信後の通知処理（メール / Slack / LINE）
// Phase 3 実装対象。Phase 1-2 の段階ではこのファイルのデプロイは任意。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SLACK_WEBHOOK_URL  = Deno.env.get('SLACK_WEBHOOK_URL') || '';
const LINE_CHANNEL_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || '';
const APP_BASE_URL       = Deno.env.get('APP_BASE_URL') || '';
const ADMIN_EMAIL        = Deno.env.get('ADMIN_EMAIL') || '';
// Gmail SMTP（独自ドメイン不要・任意の宛先に送信可・添付OK）
const GMAIL_USER         = Deno.env.get('GMAIL_USER') || '';
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') || '';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Gmail SMTP でメール送信。attachments: [{ filename, base64, contentType }]
async function sendMail(opts: { to: string; subject: string; html: string; attachments?: Array<{ filename: string; base64: string; contentType: string }> }): Promise<string> {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return 'skipped(no gmail creds)';
  const client = new SMTPClient({
    connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD } },
  });
  try {
    await client.send({
      from: `作業報告システム <${GMAIL_USER}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      attachments: (opts.attachments || []).map(a => ({
        filename: a.filename, encoding: 'base64', content: a.base64, contentType: a.contentType,
      })),
    });
    await client.close();
    return 'ok';
  } catch (e) {
    try { await client.close(); } catch (_) { /* noop */ }
    return `failed(${String((e as Error)?.message || e)})`;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  try {
    const { reportId, caseId, pdfBase64, pdfFilename } = await req.json();
    if (!reportId || !caseId) return error('reportId と caseId が必要です');

    // 全データ取得
    const { data: caseRow } = await sb.from('cases').select(`
      *,
      property:properties(name),
      client:clients(name, email, slack_webhook, line_user_id),
      vendor:vendors(name, email, contact_name)
    `).eq('id', caseId).single();
    if (!caseRow) return error('案件が見つかりません');

    const { data: report } = await sb.from('reports').select('*').eq('id', reportId).single();
    if (!report) return error('報告書が見つかりません');

    const client = caseRow.client;
    const propFull = [caseRow.property?.name, caseRow.room].filter(Boolean).join('　');
    const reportUrl = `${APP_BASE_URL}/report/index.html?token=${caseRow.access_token}`;
    const workDate = report.work_date ? new Date(report.work_date + 'T00:00:00').toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric' }) : '';

    const results: Record<string, string> = {};

    // ================================================================
    // 1. メール送信（Gmail SMTP）
    // ================================================================
    if (client?.email) {
      const emailHtml = buildEmailHtml({ caseRow, report, propFull, workDate, reportUrl });
      results.email = await sendMail({
        to: client.email,
        subject: `【作業完了報告】${propFull} ${caseRow.work_type} — ${workDate}`,
        html: emailHtml,
      });
    }

    // ================================================================
    // 2. Slack 通知
    // ================================================================
    const slackWebhook = client?.slack_webhook || SLACK_WEBHOOK_URL;
    if (slackWebhook) {
      const slackBody = {
        text: `✅ *作業完了報告*`,
        blocks: [
          { type:'header', text:{ type:'plain_text', text:'✅ 作業完了報告', emoji:true } },
          { type:'section', fields:[
            { type:'mrkdwn', text:`*物件*\n${propFull}` },
            { type:'mrkdwn', text:`*作業区分*\n${caseRow.work_type}` },
            { type:'mrkdwn', text:`*作業日*\n${workDate}` },
            { type:'mrkdwn', text:`*業者*\n${caseRow.vendor?.name || '—'}` },
          ]},
          { type:'section', text:{ type:'mrkdwn', text:`📄 *<${reportUrl}|報告書を確認する>*` } },
        ],
      };
      const res = await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackBody),
      });
      results.slack = res.ok ? 'ok' : `failed(${res.status})`;
    }

    // ================================================================
    // 3. LINE Messaging API（Push Message）
    // ================================================================
    if (LINE_CHANNEL_TOKEN && client?.line_user_id) {
      const lineBody = {
        to: client.line_user_id,
        messages: [{
          type: 'flex',
          altText: `作業完了報告: ${propFull}`,
          contents: {
            type: 'bubble',
            header: {
              type: 'box', layout: 'vertical',
              backgroundColor: '#1a3a5c',
              contents: [{ type:'text', text:'✅ 作業完了報告', color:'#ffffff', weight:'bold', size:'lg' }]
            },
            body: {
              type: 'box', layout: 'vertical', spacing: 'sm',
              contents: [
                { type:'text', text: propFull, weight:'bold', size:'md', wrap:true },
                { type:'text', text: `${caseRow.work_type}　${workDate}`, color:'#64748b', size:'sm' },
                { type:'separator', margin:'md' },
                { type:'text', text: '業者: ' + (caseRow.vendor?.name || '—'), color:'#64748b', size:'sm' },
              ]
            },
            footer: {
              type: 'box', layout: 'vertical',
              contents: [{
                type: 'button', style: 'primary', color: '#1a3a5c',
                action: { type:'uri', label:'報告書を確認する', uri: reportUrl }
              }]
            }
          }
        }]
      };
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LINE_CHANNEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(lineBody),
      });
      results.line = res.ok ? 'ok' : `failed(${res.status}: ${await res.text()})`;
    }

    // ================================================================
    // 4. billing_items に自動 INSERT
    // ================================================================
    const { error: billingErr } = await sb.from('billing_items').insert({
      case_id:   caseId,
      client_id: caseRow.client_id,
      work_date: report.work_date,
      work_type: caseRow.work_type,
      memo:      `${propFull} ${caseRow.case_no}`,
    });
    results.billing = billingErr ? `failed(${billingErr.message})` : 'ok';

    // ================================================================
    // 5. 管理者への通知メール（報告書PDF添付）
    // ================================================================
    if (ADMIN_EMAIL) {
      const adminHtml = buildAdminNotifyHtml({ caseRow, report, propFull, workDate, reportUrl });
      results.adminEmail = await sendMail({
        to: ADMIN_EMAIL,
        subject: `【報告書到着】${propFull} — ${workDate}`,
        html: adminHtml,
        attachments: pdfBase64
          ? [{ filename: pdfFilename || '報告書.pdf', base64: pdfBase64, contentType: 'application/pdf' }]
          : [],
      });
    }

    // ================================================================
    // 6. 業者への完了確認メール
    // ================================================================
    const vendor = caseRow.vendor;
    if (vendor?.email) {
      const vendorEmailHtml = buildVendorCompleteHtml({ caseRow, propFull, workDate });
      results.vendorEmail = await sendMail({
        to: vendor.email,
        subject: `【報告書受付完了】${propFull} ${caseRow.work_type} — ${workDate}`,
        html: vendorEmailHtml,
      });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });

  } catch (e) {
    console.error(e);
    return error(String(e));
  }
});

// ============================================================ HELPERS
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}
function error(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function buildAdminNotifyHtml({ caseRow, report, propFull, workDate, reportUrl }: any): string {
  const checked = (report.checked_items || []).join('、') || '—';
  const nextAction = report.next_action || '—';
  const estimateTiming = report.estimate_by
    ? (report.estimate_by === 'それ以降（日付指定）' && report.estimate_by_date ? `${report.estimate_by_date} まで` : report.estimate_by)
    : '';
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:'Hiragino Kaku Gothic ProN',sans-serif;background:#f0f4f8;margin:0;padding:24px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.1);">
  <div style="background:#1a3a5c;color:#fff;padding:20px 28px;">
    <div style="font-size:18px;font-weight:700;">📋 報告書が提出されました</div>
    <div style="font-size:13px;margin-top:4px;opacity:.8;">${propFull}</div>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      ${row('物件・号室', propFull)}
      ${row('作業区分', caseRow.work_type)}
      ${row('作業日', workDate)}
      ${row('業者', caseRow.vendor?.name || '—')}
      ${row('実施項目', checked)}
      ${row('次の対応', nextAction)}
      ${estimateTiming ? row('見積回答の目安', estimateTiming) : ''}
    </table>
    ${report.f1 ? `<div style="background:#f8fafc;border-left:4px solid #1a3a5c;padding:12px 16px;border-radius:4px;margin-bottom:16px;font-size:14px;line-height:1.7;white-space:pre-wrap;">${esc(report.f1)}</div>` : ''}
    <div style="text-align:center;margin-top:24px;">
      <a href="${reportUrl}" style="display:inline-block;background:#1a3a5c;color:#fff;padding:13px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">📄 報告書を確認する</a>
    </div>
  </div>
  <div style="background:#f8fafc;padding:14px 28px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">案件No: ${caseRow.case_no}</div>
</div></body></html>`;
}

function buildEmailHtml({ caseRow, report, propFull, workDate, reportUrl }: any): string {
  const checked = (report.checked_items || []).join('、') || '—';
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:'Hiragino Kaku Gothic ProN',sans-serif;background:#f0f4f8;margin:0;padding:24px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.1);">
  <div style="background:#1a3a5c;color:#fff;padding:24px 28px;">
    <div style="font-size:20px;font-weight:700;letter-spacing:.1em;">作業完了報告</div>
    <div style="font-size:13px;margin-top:4px;opacity:.8;">${propFull}</div>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      ${row('物件・号室', propFull)}
      ${row('作業区分', caseRow.work_type)}
      ${row('作業日', workDate)}
      ${row('業者', caseRow.vendor?.name || '—')}
      ${row('実施項目', checked)}
    </table>
    ${report.f1 ? `<div style="background:#f8fafc;border-left:4px solid #1a3a5c;padding:12px 16px;border-radius:4px;margin-bottom:16px;font-size:14px;line-height:1.7;white-space:pre-wrap;">${esc(report.f1)}</div>` : ''}
    <div style="text-align:center;margin-top:24px;">
      <a href="${reportUrl}" style="display:inline-block;background:#1a3a5c;color:#fff;padding:13px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">📄 報告書を確認する</a>
    </div>
  </div>
  <div style="background:#f8fafc;padding:14px 28px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">
    このメールは自動送信されています。<br>案件No: ${caseRow.case_no}
  </div>
</div></body></html>`;
}

function buildVendorCompleteHtml({ caseRow, propFull, workDate }: any): string {
  return `<!DOCTYPE html><html lang="ja"><body style="font-family:'Hiragino Kaku Gothic ProN',sans-serif;background:#f0f4f8;margin:0;padding:24px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.1);">
  <div style="background:#166534;color:#fff;padding:24px 28px;">
    <div style="font-size:18px;font-weight:700;">報告書を受け付けました</div>
    <div style="font-size:13px;opacity:.8;margin-top:4px;">担当者が内容を確認します</div>
  </div>
  <div style="padding:24px 28px;">
    <p style="margin:0 0 16px;font-size:14px;color:#334155;">${esc(caseRow.vendor?.contact_name || caseRow.vendor?.name || '')} 様<br><br>報告書を受け付けました。ありがとうございます。</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${row('案件No', caseRow.case_no)}
      ${row('物件・号室', propFull)}
      ${row('作業区分', caseRow.work_type)}
      ${row('作業日', workDate)}
    </table>
  </div>
  <div style="background:#f0f4f8;padding:14px 28px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">このメールは自動送信されています。</div>
</div></body></html>`;
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:8px 12px;background:#eef3f9;font-weight:700;color:#1a3a5c;white-space:nowrap;border:1px solid #c8d6e5;width:100px;">${label}</td><td style="padding:8px 12px;border:1px solid #c8d6e5;">${esc(value)}</td></tr>`;
}
function esc(s: string): string {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
