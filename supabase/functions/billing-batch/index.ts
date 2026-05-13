// supabase/functions/billing-batch/index.ts
// 月次請求バッチ（毎月1日 JST 0:00 = UTC 15:00 に pg_cron から呼び出し）
// Phase 4 実装対象

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY') || '';
const FREEE_ACCESS_TOKEN = Deno.env.get('FREEE_ACCESS_TOKEN') || '';  // OAuth2 で取得したアクセストークン
const FREEE_COMPANY_ID   = Deno.env.get('FREEE_COMPANY_ID') || '';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  try {
    // 先月の期間を計算
    const now = new Date();
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastOfLastMonth  = new Date(firstOfThisMonth.getTime() - 1);
    const firstOfLastMonth = new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), 1);
    const monthStr = `${lastOfLastMonth.getFullYear()}-${String(lastOfLastMonth.getMonth()+1).padStart(2,'0')}`;

    console.log(`請求バッチ実行: ${monthStr}`);

    // 未請求の billing_items を先月分で取得
    const { data: items, error: itemsErr } = await sb.from('billing_items').select(`
      *,
      client:clients(id, name, email, freee_partner_id)
    `)
    .eq('billed', false)
    .gte('work_date', firstOfLastMonth.toISOString().split('T')[0])
    .lte('work_date', lastOfLastMonth.toISOString().split('T')[0]);

    if (itemsErr) throw new Error('billing_items 取得失敗: ' + itemsErr.message);
    if (!items?.length) {
      console.log('請求項目なし');
      return new Response(JSON.stringify({ ok:true, message:'請求項目なし' }), { headers: corsHeaders() });
    }

    // 取引先ごとにグループ化
    const byClient: Record<string, any[]> = {};
    for (const item of items) {
      const cid = item.client_id;
      if (!byClient[cid]) byClient[cid] = [];
      byClient[cid].push(item);
    }

    const results: any[] = [];

    for (const [clientId, clientItems] of Object.entries(byClient)) {
      const client = clientItems[0].client;
      const totalAmount = clientItems.reduce((sum, i) => sum + (i.amount || 0), 0);

      let freeeInvoiceId: string | null = null;

      // ================================================================
      // freee 請求書作成（freee_partner_id が設定されている場合）
      // ================================================================
      if (FREEE_ACCESS_TOKEN && FREEE_COMPANY_ID && client.freee_partner_id) {
        const lineItems = clientItems.map(i => ({
          name:          `${i.work_type} ${i.memo || ''}`.trim(),
          unit_price:    i.amount || 0,
          quantity:      1,
          description:   i.work_date,
        }));
        const dueDate = new Date(now.getFullYear(), now.getMonth()+1, 0); // 翌月末
        const invoiceBody = {
          company_id:      Number(FREEE_COMPANY_ID),
          partner_id:      client.freee_partner_id,
          issue_date:      now.toISOString().split('T')[0],
          due_date:        dueDate.toISOString().split('T')[0],
          invoice_number:  `INV-${monthStr}-${clientId.slice(0,6)}`,
          title:           `${monthStr.replace('-','年')}月分　作業費`,
          invoice_lines:   lineItems,
          invoice_status:  'draft', // まず下書きで作成
        };
        try {
          const res = await fetch(`https://api.freee.co.jp/api/1/invoices`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${FREEE_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ invoice: invoiceBody }),
          });
          if (res.ok) {
            const data = await res.json();
            freeeInvoiceId = String(data.invoice?.id || '');
            console.log(`freee 請求書作成: ${freeeInvoiceId} (${client.name})`);
          } else {
            console.error(`freee エラー: ${res.status} ${await res.text()}`);
          }
        } catch (e) {
          console.error(`freee 例外: ${e}`);
        }
      }

      // ================================================================
      // billing_items を請求済みに更新
      // ================================================================
      const itemIds = clientItems.map(i => i.id);
      const updatePayload: any = { billed: true, billed_at: new Date().toISOString() };
      if (freeeInvoiceId) updatePayload.freee_invoice_id = freeeInvoiceId;
      await sb.from('billing_items').update(updatePayload).in('id', itemIds);

      // ================================================================
      // 請求通知メール（Resend）
      // ================================================================
      if (RESEND_API_KEY && client.email) {
        const emailHtml = buildBillingEmail({ client, clientItems, totalAmount, monthStr, freeeInvoiceId });
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:    'billing@your-domain.com', // 送信ドメインを設定してください
            to:      [client.email],
            subject: `【請求書】${monthStr.replace('-','年')}月分 — ${totalAmount.toLocaleString()}円`,
            html:    emailHtml,
          }),
        });
        console.log(`メール送信 (${client.name}): ${res.ok ? 'ok' : res.status}`);
      }

      results.push({ client: client.name, items: clientItems.length, total: totalAmount, freeeInvoiceId });
    }

    return new Response(JSON.stringify({ ok:true, month:monthStr, results }), {
      headers: { 'Content-Type':'application/json', ...corsHeaders() },
    });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok:false, error:String(e) }), {
      status:500, headers: { 'Content-Type':'application/json', ...corsHeaders() },
    });
  }
});

// ============================================================ HELPERS
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function buildBillingEmail({ client, clientItems, totalAmount, monthStr, freeeInvoiceId }: any): string {
  const rows = clientItems.map((i: any) =>
    `<tr><td style="padding:7px 12px;border:1px solid #c8d6e5;">${i.work_date||''}</td>
     <td style="padding:7px 12px;border:1px solid #c8d6e5;">${esc(i.memo||'')}</td>
     <td style="padding:7px 12px;border:1px solid #c8d6e5;text-align:right;">${(i.amount||0).toLocaleString()}円</td></tr>`
  ).join('');
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:'Hiragino Kaku Gothic ProN',sans-serif;background:#f0f4f8;margin:0;padding:24px;">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.1);">
  <div style="background:#1a3a5c;color:#fff;padding:24px 28px;">
    <div style="font-size:18px;font-weight:700;">請求書のご案内</div>
    <div style="font-size:13px;margin-top:4px;opacity:.8;">${monthStr.replace('-','年')}月分</div>
  </div>
  <div style="padding:24px 28px;">
    <p style="margin-bottom:16px;">${esc(client.name)} 御中<br><br>${monthStr.replace('-','年')}月分の作業費をご請求申し上げます。</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead><tr>
        <th style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;border:1px solid #c8d6e5;text-align:left;">作業日</th>
        <th style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;border:1px solid #c8d6e5;text-align:left;">内容</th>
        <th style="padding:8px 12px;background:#eef3f9;color:#1a3a5c;border:1px solid #c8d6e5;text-align:right;">金額</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="2" style="padding:10px 12px;border:1px solid #c8d6e5;font-weight:700;text-align:right;">合計</td>
        <td style="padding:10px 12px;border:1px solid #c8d6e5;font-weight:700;text-align:right;color:#1a3a5c;">${totalAmount.toLocaleString()}円</td>
      </tr></tfoot>
    </table>
    ${freeeInvoiceId ? `<p style="font-size:12px;color:#64748b;">freee 請求書ID: ${freeeInvoiceId}</p>` : ''}
  </div>
  <div style="background:#f8fafc;padding:14px 28px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">
    このメールは自動送信されています。
  </div>
</div></body></html>`;
}

function esc(s: string): string {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
