import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const {
      caseId, vendorId, filePath, fileName, totalAmount, items,
      caseNo, vendorName, propertyName, room, workType,
    } = await req.json();

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. estimates レコード挿入
    const { data: estimate, error: estErr } = await sbAdmin
      .from('estimates')
      .insert({ case_id: caseId, vendor_id: vendorId, file_path: filePath, file_name: fileName, total_amount: totalAmount })
      .select()
      .single();
    if (estErr) throw new Error('estimates insert: ' + estErr.message);

    // 2. estimate_items 挿入
    if (items?.length) {
      const rows = items.map((it: any) => ({ ...it, estimate_id: estimate.id }));
      const { error: itemErr } = await sbAdmin.from('estimate_items').insert(rows);
      if (itemErr) throw new Error('estimate_items insert: ' + itemErr.message);
    }

    const slackWebhook = Deno.env.get('SLACK_WEBHOOK_URL');
    const adminUrl = Deno.env.get('APP_BASE_URL') || '';

    // 3. 単価異常検知: 同業者・同項目名で単価が異なる過去記録を検索
    const anomalies: string[] = [];
    if (vendorId && items?.length) {
      for (const item of items) {
        const { data: pastItems } = await sbAdmin
          .from('estimate_items')
          .select('unit_price, estimate_id')
          .eq('item_name', item.item_name)
          .neq('estimate_id', estimate.id);

        if (!pastItems?.length) continue;

        // 同業者の案件に紐づくものだけ絞り込む
        const pastEstimateIds = pastItems.map((p: any) => p.estimate_id);
        const { data: pastEstimates } = await sbAdmin
          .from('estimates')
          .select('id, vendor_id')
          .in('id', pastEstimateIds)
          .eq('vendor_id', vendorId);

        if (!pastEstimates?.length) continue;

        const matchedIds = new Set(pastEstimates.map((e: any) => e.id));
        const sameVendorItems = pastItems.filter((p: any) => matchedIds.has(p.estimate_id));

        for (const past of sameVendorItems) {
          if (past.unit_price !== item.unit_price) {
            anomalies.push(`「${item.item_name}」単価: 過去 ¥${past.unit_price.toLocaleString()} → 今回 ¥${item.unit_price.toLocaleString()}`);
            break;
          }
        }
      }
    }

    // 4. Slack通知（見積受領）
    if (slackWebhook) {
      const propLabel = [propertyName, room].filter(Boolean).join(' ');
      const blocks: any[] = [
        {
          type: 'header',
          text: { type: 'plain_text', text: '📄 見積書が届きました', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*業者*\n${vendorName}` },
            { type: 'mrkdwn', text: `*案件No*\n${caseNo}` },
            { type: 'mrkdwn', text: `*物件*\n${propLabel}` },
            { type: 'mrkdwn', text: `*作業区分*\n${workType}` },
            { type: 'mrkdwn', text: `*合計金額*\n¥${totalAmount.toLocaleString()}` },
            { type: 'mrkdwn', text: `*ファイル*\n${fileName || '（なし）'}` },
          ],
        },
      ];

      if (items?.length) {
        const itemLines = items.map((it: any) =>
          `• ${it.item_name}　単価 ¥${it.unit_price.toLocaleString()} × ${it.quantity} = ¥${it.amount.toLocaleString()}`
        ).join('\n');
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*明細*\n${itemLines}` } });
      }

      if (adminUrl) {
        blocks.push({
          type: 'actions',
          elements: [{
            type: 'button',
            text: { type: 'plain_text', text: '管理画面で確認する', emoji: true },
            url: `${adminUrl}/admin/index.html`,
            style: 'primary',
          }],
        });
      }

      await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
      });

      // 5. 単価異常があれば別途アラート送信
      if (anomalies.length) {
        await fetch(slackWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blocks: [
              {
                type: 'header',
                text: { type: 'plain_text', text: '⚠️ 単価の変更を検知しました', emoji: true },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*業者:* ${vendorName}　*案件:* ${caseNo}\n\n` +
                    anomalies.map(a => `• ${a}`).join('\n'),
                },
              },
            ],
          }),
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, estimateId: estimate.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
