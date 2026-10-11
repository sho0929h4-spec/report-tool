// app/tests/calc.test.js — Calc 純関数のユニットテスト（node:test）
const { test } = require('node:test');
const assert = require('node:assert');
const Calc = require('../shared/calc.js');

test('人件費: 2時間×3000円=6000円', () => {
  assert.strictEqual(Calc.calcLaborAmount(
    '2026-10-11T09:00:00+09:00', '2026-10-11T11:00:00+09:00', 3000), 6000);
});
test('人件費: 90分×3000円=4500円（端数は四捨五入）', () => {
  assert.strictEqual(Calc.calcLaborAmount(
    '2026-10-11T09:00:00+09:00', '2026-10-11T10:30:00+09:00', 3000), 4500);
});
test('人件費: 終了<開始 は null', () => {
  assert.strictEqual(Calc.calcLaborAmount(
    '2026-10-11T11:00:00+09:00', '2026-10-11T09:00:00+09:00', 3000), null);
});
test('人件費: 引数欠落は null', () => {
  assert.strictEqual(Calc.calcLaborAmount(null, '2026-10-11T10:00:00+09:00', 3000), null);
  assert.strictEqual(Calc.calcLaborAmount('2026-10-11T09:00:00+09:00', null, 3000), null);
  assert.strictEqual(Calc.calcLaborAmount('2026-10-11T09:00:00+09:00', '2026-10-11T10:00:00+09:00', null), null);
});
test('粗利: 請求5万・原価1万 → 粗利4万・粗利率80%', () => {
  const r = Calc.grossProfit(50000, [{amount:6000},{amount:4000}]);
  assert.deepStrictEqual(r, { total:10000, gross:40000, rate:80 });
});
test('粗利: 請求未入力なら gross/rate は null、原価合計のみ', () => {
  const r = Calc.grossProfit(null, [{amount:6000}]);
  assert.strictEqual(r.total, 6000);
  assert.strictEqual(r.gross, null);
  assert.strictEqual(r.rate, null);
});
test('粗利率: 小数1桁に丸め', () => {
  const r = Calc.grossProfit(30000, [{amount:10000}]);
  assert.strictEqual(r.rate, 66.7);
});

/* ---- 改訂v2差分B: 停滞・期限・見積 ---- */

test('停滞時間: 26時間前 → 26.0h', () => {
  const now = new Date('2026-10-11T12:00:00+09:00');
  const updated = new Date(now - 26 * 3600000);
  assert.strictEqual(Calc.stallHours(updated.toISOString(), now.toISOString()), 26.0);
});
test('停滞時間: 不正値は null', () => {
  assert.strictEqual(Calc.stallHours(null, new Date().toISOString()), null);
  assert.strictEqual(Calc.stallHours('invalid', new Date().toISOString()), null);
});
test('期限超過: 昨日期限で未完了 → true / done → false', () => {
  const now = '2026-10-11T12:00:00+09:00';
  assert.strictEqual(Calc.isOverdue('2026-10-10T18:00:00+09:00', now, 'doing'), true);
  assert.strictEqual(Calc.isOverdue('2026-10-10T18:00:00+09:00', now, 'done'), false);
  assert.strictEqual(Calc.isOverdue(null, now, 'doing'), false);
});
test('見積合計: qty×unitPrice で再計算して合算', () => {
  assert.strictEqual(Calc.estimateTotal([{qty:2, unitPrice:500}]), 1000);
  assert.strictEqual(Calc.estimateTotal([{qty:1, unitPrice:28000}, {qty:2, unitPrice:500}]), 29000);
  assert.strictEqual(Calc.estimateTotal([]), 0);
});
test('原価→見積: 掛率1.3で材料1万 → 13000円の明細', () => {
  const items = Calc.buildEstimateFromCosts(
    [{category:'material', label:'配管部材', amount:10000}], 1.3);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].amount, 13000);
  assert.strictEqual(items[0].label, '配管部材');
  assert.strictEqual(items[0].qty, 1);
  assert.strictEqual(items[0].unitPrice, 13000);
});
