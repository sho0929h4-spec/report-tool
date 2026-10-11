// app/shared/calc.js — 計算の純関数。DOM・Store に依存しない（node/browser 両対応）
(function (root) {
  'use strict';

  // 人件費: 開始/終了ISO文字列と時給から金額（円・整数四捨五入）。不正は null
  function calcLaborAmount(startIso, endIso, hourlyRate) {
    if (!startIso || !endIso || hourlyRate == null) return null;
    const s = new Date(startIso).getTime();
    const e = new Date(endIso).getTime();
    if (isNaN(s) || isNaN(e) || e < s) return null;
    return Math.round((e - s) / 3600000 * hourlyRate);
  }

  // 原価合計（amount が数値の行のみ合算）
  function sumCosts(costs) {
    return (costs || []).reduce((t, c) =>
      t + (typeof c.amount === 'number' ? c.amount : 0), 0);
  }

  // 粗利: 請求額と原価リスト → { total, gross, rate(%, 小数1桁) }
  function grossProfit(invoiceAmount, costs) {
    const total = sumCosts(costs);
    if (invoiceAmount == null || invoiceAmount === '') {
      return { total, gross: null, rate: null };
    }
    const gross = invoiceAmount - total;
    const rate = invoiceAmount > 0
      ? Math.round(gross / invoiceAmount * 1000) / 10 : null;
    return { total, gross, rate };
  }

  /* ---- 改訂v2差分B: 停滞・期限・見積 ---- */

  // 停滞時間: 最終更新から現在までの経過時間（h、小数1桁）。不正は null
  function stallHours(updatedAtIso, nowIso) {
    if (!updatedAtIso || !nowIso) return null;
    const u = new Date(updatedAtIso).getTime();
    const n = new Date(nowIso).getTime();
    if (isNaN(u) || isNaN(n) || n < u) return null;
    return Math.round((n - u) / 3600000 * 10) / 10;
  }

  // 期限超過: 期限あり・未完了・期限<現在 のとき true（派生値、保存しない）
  function isOverdue(dueAtIso, nowIso, status) {
    if (!dueAtIso) return false;
    if (status === 'done' || status === 'confirmed') return false;
    const d = new Date(dueAtIso).getTime();
    const n = new Date(nowIso).getTime();
    if (isNaN(d) || isNaN(n)) return false;
    return d < n;
  }

  // 見積合計: 明細の qty×unitPrice を再計算して合算（保存値は信用しない）
  function estimateTotal(items) {
    return (items || []).reduce((t, it) =>
      t + Math.round((it.qty || 0) * (it.unitPrice || 0)), 0);
  }

  // 原価→見積明細: 掛率を掛けて1行ずつ変換（qty=1 式）
  function buildEstimateFromCosts(costs, markup) {
    const m = markup || 1.3;
    return (costs || []).map(c => {
      const price = Math.round((c.amount || 0) * m);
      return {
        label: c.label,
        qty: 1,
        unit: '式',
        unitPrice: price,
        amount: price,
        source: c.category,
      };
    });
  }

  const Calc = {
    calcLaborAmount, sumCosts, grossProfit,
    stallHours, isOverdue, estimateTotal, buildEstimateFromCosts,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
