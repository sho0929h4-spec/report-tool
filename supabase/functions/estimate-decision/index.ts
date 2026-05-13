import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUBJECTS: Record<string, string> = {
  ordered:     '【発注】見積書の件について',
  lost:        '【ご連絡】見積書の件について',
  conditional: '【条件付き発注】見積書の件について',
};

function buildEmailHtml(action: string, vendorName: string, caseNo: string, propertyName: string, room: string, workType: string, conditionNote: string, totalAmount: number): string {
  const propLabel = [propertyName, room].filter(Boolean).join(' ');
  let bodyText = '';
  if (action === 'ordered') {
    bodyText = `このたびはご見積書のご提出ありがとうございました。<br><br>
ご提出いただいた内容で<strong>発注</strong>させていただきます。<br>
引き続きよろしくお願いいたします。`;
  } else if (action === 'lost') {
    bodyText = `このたびはご見積書のご提出ありがとうございました。<br><br>
検討の結果、今回は別の業者に依頼することとなりました。<br>
またの機会にお願いできれば幸いです。`;
  } else if (action === 'conditional') {
    bodyText = `このたびはご見積書のご提出ありがとうございました。<br><br>
以下の条件にてご対応いただけますでしょうか。ご確認のうえ、ご返答をお願いいたします。<br><br>
<div style="background:#fffbe6;border-left:4px solid #d97706;padding:14px 18px;border-radius:6px;margin:12px 0;font-size:14px;line-height:1.8;">
${conditionNote.replace(/\n/g, '<br>')}
</div>`;
  }

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:'Hiragino Kaku Gothic ProN',sans-serif;color:#1e293b;font-size:14px;line-height:1.8;background:#f0f4f8;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1);">
  <div style="background:#1a3a5c;color:#fff;padding:20px 28px;">
    <div style="font-size:16px;font-weight:700;">${SUBJECTS[action]}</div>
  </div>
  <div style="padding:28px;">
    <p>${vendorName} 様</p>
    <br>
    <p>${bodyText}</p>
    <br>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
      <tr><td style="background:#eef3f9;color:#1a3a5c;font-weight:700;padding:8px 12px;width:90px;border:1px solid #c8d6e5;">案件No</td><td style="padding:8px 12px;border:1px solid #c8d6e5;">${caseNo}</td></tr>
      <tr><td style="background:#eef3f9;color:#1a3a5c;font-weight:700;padding:8px 12px;border:1px solid #c8d6e5;">物件</td><td style="padding:8px 12px;border:1px solid #c8d6e5;">${propLabel}</td></tr>
      <tr><td style="background:#eef3f9;color:#1a3a5c;font-weight:700;padding:8px 12px;border:1px solid #c8d6e5;">作業区分</td><td style="padding:8px 12px;border:1px solid #c8d6e5;">${workType}</td></tr>
      <tr><td style="background:#eef3f9;color:#1a3a5c;font-weight:700;padding:8px 12px;border:1px solid #c8d6e5;">見積合計</td><td style="padding:8px 12px;border:1px solid #c8d6e5;font-weight:700;">¥${totalAmount.toLocaleString()}</td></tr>
    </table>
    <br>
    <p style="color:#64748b;font-size:12px;">ご不明な点がございましたら、担当者までご連絡ください。</p>
  </div>
</div>
</body></html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { estimateId, action, conditionNote } = await req.json();

    if (!['ordered', 'lost', 'conditional'].includes(action)) {
      throw new Error('invalid action');
    }
    if (action === 'conditional' && !conditionNote?.trim()) {
      throw new Error('conditionNote is required for conditional action');
    }

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 見積 + 関連データ取得
    const { data: estimate, error: estErr } = await sbAdmin
      .from('estimates')
      .select(`
        *,
        case:cases(case_no, room, work_type, property:properties(name)),
        vendor:vendors(name, contact_name, email)
      `)
      .eq('id', estimateId)
      .single();

    if (estErr || !estimate) throw new Error('estimate not found');

    // ステータス更新
    const { error: updateErr } = await sbAdmin
      .from('estimates')
      .update({ status: action, condition_note: conditionNote || null, decided_at: new Date().toISOString() })
      .eq('id', estimateId);
    if (updateErr) throw new Error('update failed: ' + updateErr.message);

    // メール送信
    const vendorEmail = estimate.vendor?.email;
    if (vendorEmail) {
      const vendorName   = estimate.vendor?.contact_name || estimate.vendor?.name || '';
      const caseNo       = estimate.case?.case_no || '';
      const propertyName = estimate.case?.property?.name || '';
      const room         = estimate.case?.room || '';
      const workType     = estimate.case?.work_type || '';
      const totalAmount  = estimate.total_amount || 0;
      const html         = buildEmailHtml(action, vendorName, caseNo, propertyName, room, workType, conditionNote || '', totalAmount);

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    Deno.env.get('FROM_EMAIL'),
          to:      vendorEmail,
          subject: `${SUBJECTS[action]}（${caseNo}）`,
          html,
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
