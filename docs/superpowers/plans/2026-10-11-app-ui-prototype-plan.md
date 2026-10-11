# 現場管理アプリ UIプロトタイプ（計画1/2） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `app/` 配下にスマホアプリ基準のPWA（今日ホーム・案件一覧・案件詳細5タブ・報告書フォーム・設定）をモックデータで完動させ、GitHub Pages で実機確認できる状態にする。

**Architecture:** 静的マルチページ。全ページは `window.Store`（データ窓口・モック実装）経由でのみデータに触れる。計画2で Store の中身だけを Supabase+R2 に差し替える（画面コードは不変）。原価計算は純関数 `Calc` に分離して node:test でユニットテスト。

**Tech Stack:** 素のHTML/CSS/JS（外部依存ゼロ）、node:test（計算ロジックのみ）、GitHub Pages、PWA（manifest+Service Worker）

**Spec:** `docs/superpowers/specs/2026-10-11-case-management-saas-design.md`

## Global Constraints

- **旧ツール（root `index.html`）・`public/`・`worker/`・`supabase/` には一切触れない**（spec §9）
- 新規ファイルはすべて `app/` 配下（テストは `app/tests/`）
- UI は max-width 480px のスマホ基準・底タブ `[今日][案件][設定]`＋admin のみ FAB（spec §4,7）
- リンク・参照は**相対パスのみ**、設定値は `shared/config.js` に一元化（spec §4: Capacitor化を妨げない）
- ページから MOCK 直接参照禁止。必ず `Store` 経由（計画2の差し替えを保証する唯一のルール）
- 原価・請求・単価 UI は `session.role==='admin'` のときだけ DOM に生成（spec §6）
- UI文言は日本語。ステータス表記: scheduled=予定 / in_progress=対応中 / submitted=報告済 / confirmed=確認済
- コミットは各タスク末尾で必ず行う。メッセージは `feat(app): ...` 形式

## File Structure

```
app/
├ index.html          今日ホーム（PWA起動点）
├ list.html           案件一覧
├ case.html           案件詳細（概要/タスク/写真/報告書/原価タブ）
├ report.html         報告書フォーム（root index.html のコピー＋最小改修）
├ settings.html       設定（roleプレビュー切替・単価・モックリセット）
├ manifest.json / sw.js / icons/
├ shared/
│ ├ config.js         定数
│ ├ style.css         デザイントークン・共通UI
│ ├ calc.js           原価計算 純関数（node/ブラウザ両用）
│ ├ mock-data.js      モックデータ（日付は常に今日基準で生成）
│ ├ store.js          window.Store（モック実装・localStorage永続）
│ └ ui.js             底タブ・バッジ・日付整形・認可ヘルパ
└ tests/
  └ calc.test.js      node:test
```

---

### Task 1: 足場 — 共通CSS・config・ui.js・今日ホームの殻

**Files:**
- Create: `app/shared/config.js`, `app/shared/style.css`, `app/shared/ui.js`, `app/index.html`

**Interfaces:**
- Produces: `CONFIG.appName` / `UI.tabbar(active)` / `UI.esc(s)` / `UI.fmtDate(iso)` / `UI.fmtTime(iso)` / `UI.statusBadge(status)` / `UI.fmtYen(n)` — 後続全タスクが使用

- [ ] **Step 1: config.js を作成**

```js
// app/shared/config.js — 設定値はここに一元化（Capacitor化対応のため分散禁止）
window.CONFIG = {
  appName: '現場管理',
  version: '0.1.0',
};
```

- [ ] **Step 2: style.css を作成**（デザイントークンは既存ツールのネイビー基調を踏襲）

```css
/* app/shared/style.css */
:root{
  --navy:#16304d; --navy2:#1e3a5f; --bg:#eef2f7; --card:#fff;
  --line:#e3e9f1; --text:#17283d; --sub:#64748b; --accent:#2563eb;
  --ok:#16a34a; --warn:#d97706; --danger:#dc2626; --radius:14px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;}
body{max-width:480px;margin:0 auto;padding-bottom:76px;min-height:100vh;
  -webkit-tap-highlight-color:transparent;}
header.app{position:sticky;top:0;z-index:20;background:var(--navy);color:#fff;
  padding:14px 16px;display:flex;align-items:center;justify-content:space-between;}
header.app h1{font-size:17px;margin:0;font-weight:700;}
main{padding:12px 12px 0;}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:14px;margin-bottom:10px;box-shadow:0 1px 2px rgba(23,40,61,.04);}
.card.tappable:active{transform:scale(.985);}
a.cardlink{text-decoration:none;color:inherit;display:block;}
.row{display:flex;align-items:center;gap:8px;}
.row.between{justify-content:space-between;}
.title{font-size:15px;font-weight:700;}
.sub{font-size:12.5px;color:var(--sub);}
.badge{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;
  padding:3px 9px;color:#fff;vertical-align:middle;}
.badge.scheduled{background:#94a3b8}.badge.in_progress{background:var(--warn)}
.badge.submitted{background:var(--accent)}.badge.confirmed{background:var(--ok)}
.badge.type{background:#475569}
.due-danger{color:var(--danger);font-weight:700;}
.section-label{font-size:12px;font-weight:700;color:var(--sub);margin:16px 4px 8px;}
.alertbar{background:#fef2f2;border:1px solid #fecaca;color:var(--danger);
  border-radius:var(--radius);padding:10px 14px;font-size:13px;font-weight:700;
  margin-bottom:10px;display:block;text-decoration:none;}
.empty{color:var(--sub);text-align:center;padding:32px 0;font-size:13px;}
.tabbar{position:fixed;bottom:0;left:0;right:0;z-index:30;background:#fff;
  border-top:1px solid var(--line);display:flex;max-width:480px;margin:0 auto;
  padding-bottom:env(safe-area-inset-bottom);}
.tabbar a{flex:1;text-align:center;padding:9px 0 7px;font-size:10.5px;
  color:var(--sub);text-decoration:none;line-height:1.2;}
.tabbar a .ic{display:block;font-size:20px;}
.tabbar a.active{color:var(--accent);font-weight:700;}
.fab{position:fixed;right:16px;bottom:86px;z-index:30;width:56px;height:56px;
  border-radius:50%;background:var(--accent);color:#fff;font-size:28px;border:none;
  box-shadow:0 4px 12px rgba(37,99,235,.4);display:flex;align-items:center;
  justify-content:center;text-decoration:none;}
.chiprow{display:flex;gap:8px;overflow-x:auto;padding:2px 0 10px;-webkit-overflow-scrolling:touch;}
.chip{flex:none;border:1px solid var(--line);background:#fff;border-radius:999px;
  padding:6px 14px;font-size:12.5px;color:var(--sub);}
.chip.active{background:var(--navy);border-color:var(--navy);color:#fff;font-weight:700;}
.search{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;
  font-size:14px;margin-bottom:10px;background:#fff;}
.btn{display:block;width:100%;border:none;border-radius:12px;padding:14px;
  font-size:15px;font-weight:700;text-align:center;text-decoration:none;}
.btn.primary{background:var(--accent);color:#fff;}
.btn.start{background:var(--warn);color:#fff;}
.btn.finish{background:var(--ok);color:#fff;}
.btn.ghost{background:#fff;border:1px solid var(--line);color:var(--text);}
.btn:disabled{opacity:.4}
.tabs{display:flex;background:#fff;border-bottom:1px solid var(--line);
  position:sticky;top:49px;z-index:10;}
.tabs button{flex:1;border:none;background:none;padding:11px 0;font-size:12.5px;
  color:var(--sub);border-bottom:2px solid transparent;}
.tabs button.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:700;}
.field{margin-bottom:12px;}
.field label{display:block;font-size:12px;color:var(--sub);font-weight:700;margin-bottom:4px;}
.field input,.field select,.field textarea{width:100%;border:1px solid var(--line);
  border-radius:10px;padding:10px 12px;font-size:14px;background:#fff;}
.kv{display:flex;padding:9px 0;border-bottom:1px solid var(--line);font-size:13.5px;}
.kv dt{flex:none;width:92px;color:var(--sub);}
.kv dd{margin:0;flex:1;white-space:pre-wrap;word-break:break-word;}
.check{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--line);font-size:14px;}
.check input{width:20px;height:20px;}
.photo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
.photo-grid img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;}
.money{font-variant-numeric:tabular-nums;}
.total-box{background:var(--navy);color:#fff;border-radius:var(--radius);padding:14px;}
.total-box .row{justify-content:space-between;padding:4px 0;font-size:14px;}
.toast{position:fixed;bottom:84px;left:50%;transform:translateX(-50%);z-index:40;
  background:#0f172a;color:#fff;padding:10px 18px;border-radius:999px;font-size:13px;
  opacity:0;transition:opacity .25s;pointer-events:none;max-width:90%;}
.toast.show{opacity:.95;}
```

- [ ] **Step 3: ui.js を作成**

```js
// app/shared/ui.js — 共通UIヘルパ。ページはこれと Store だけに依存する
window.UI = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const STATUS = { scheduled:'予定', in_progress:'対応中', submitted:'報告済', confirmed:'確認済' };
  const fmtDate = iso => { if(!iso) return '—'; const d=new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`; };
  const fmtTime = iso => { if(!iso) return ''; const d=new Date(iso);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`; };
  const fmtYen = n => n==null||n==='' ? '—' : '¥'+Number(n).toLocaleString('ja-JP');
  const statusBadge = s => `<span class="badge ${esc(s)}">${STATUS[s]||s}</span>`;
  function tabbar(active){
    const t=[['index.html','🏠','今日'],['list.html','📋','案件'],['settings.html','⚙️','設定']];
    document.body.insertAdjacentHTML('beforeend',
      `<nav class="tabbar">${t.map(([href,ic,label])=>
        `<a href="${href}" class="${label===active?'active':''}"><span class="ic">${ic}</span>${label}</a>`).join('')}</nav>`);
  }
  let toastEl;
  function toast(msg){ if(!toastEl){ toastEl=document.createElement('div');
      toastEl.className='toast'; document.body.appendChild(toastEl); }
    toastEl.textContent=msg; toastEl.classList.add('show');
    setTimeout(()=>toastEl.classList.remove('show'),2200); }
  const qs = k => new URLSearchParams(location.search).get(k);
  return { esc, fmtDate, fmtTime, fmtYen, statusBadge, tabbar, toast, qs, STATUS };
})();
```

- [ ] **Step 4: index.html（今日ホームの殻。データ表示は Task 3）**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>今日 — 現場管理</title>
<link rel="stylesheet" href="shared/style.css">
</head>
<body>
<header class="app"><h1 id="hd">今日</h1><span class="sub" id="who" style="color:#cbd5e1"></span></header>
<main id="main"><div class="empty">読み込み中…</div></main>
<script src="shared/config.js"></script>
<script src="shared/ui.js"></script>
<script>
  document.getElementById('hd').textContent = `今日 ${UI.fmtDate(new Date().toISOString())}`;
  UI.tabbar('今日');
</script>
</body>
</html>
```

- [ ] **Step 5: ローカルで目視確認**

Run: `cd "/Users/s/Desktop/claude code/claude code/report-tool" && python3 -m http.server 3031`
ブラウザで `http://localhost:3031/app/` を開き確認:
- ネイビーのヘッダに「今日 10/11(土)」形式の表示
- 画面下に固定の底タブ3つ、[今日]がアクティブ色
- 横幅480px中央寄せ（PCでも崩れない）

- [ ] **Step 6: Commit**

```bash
git add app/ && git commit -m "feat(app): 足場 — 共通CSS/UIヘルパ/今日ホームの殻"
```

---

### Task 2: 原価計算の純関数（TDD）＋モックデータ＋Store

**Files:**
- Create: `app/shared/calc.js`, `app/tests/calc.test.js`, `app/shared/mock-data.js`, `app/shared/store.js`

**Interfaces:**
- Produces（全ページがこれだけに依存。計画2で store.js の中身のみ Supabase 実装に差し替え）:
  - `Calc.calcLaborAmount(startIso, endIso, hourlyRate) -> number|null`
  - `Calc.sumCosts(costs) -> number` / `Calc.grossProfit(invoiceAmount, costs) -> {total, gross|null, rate|null}`
  - `Store.session() -> {userId,tenantId,name,role}`（同期） / `Store.setRole('admin'|'worker')` / `Store.resetMock()`
  - `Store.listCases() -> Promise<Case[]>`（workerは担当分のみ・対応日降順）
  - `Store.getToday() -> Promise<{todays:Case[], overdue:Case[], dueToday:Case[], awaiting:Case[]}>`
  - `Store.getCase(id)` / `Store.saveCase(obj) -> Case`（id無しは新規） / `Store.updateStatus(id, status) -> Case`（in_progress で workStartedAt、submitted で workEndedAt を自動打刻）
  - `Store.toggleTask(id, index)` / `Store.listPhotos(caseId)` / `Store.addPhoto(caseId,{dataUrl,phase,caption})` / `Store.deletePhoto(caseId, photoId)`
  - `Store.listCosts(caseId)` / `Store.saveCost(caseId, cost)` / `Store.deleteCost(caseId, costId)` / `Store.rates() -> {defaultRate, byUser}` / `Store.saveRates(r)`
  - `Store.saveReport(caseId, report)`
  - Case 形: `{id, caseNo, propertyName, roomNo, address, scheduledAt, status, workType, dueDate, instructions, tasks:[{text,done,due?}], cause, nextActions, assignedTo, assignedName, workStartedAt, workEndedAt, invoiceAmount, report, createdAt}`

- [ ] **Step 1: 失敗するテストを書く**

```js
// app/tests/calc.test.js
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
```

- [ ] **Step 2: 失敗を確認**

Run: `cd "/Users/s/Desktop/claude code/claude code/report-tool/app" && node --test tests/`
Expected: FAIL（`Cannot find module '../shared/calc.js'`）

- [ ] **Step 3: calc.js を実装**

```js
// app/shared/calc.js — 原価計算の純関数。node/ブラウザ両用（DOM禁止）
(function (global) {
  function calcLaborAmount(startIso, endIso, hourlyRate) {
    if (!startIso || !endIso || hourlyRate == null) return null;
    const ms = new Date(endIso) - new Date(startIso);
    if (!(ms > 0)) return null;
    return Math.round(ms / 3600000 * Number(hourlyRate));
  }
  function sumCosts(costs) {
    return (costs || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  }
  function grossProfit(invoiceAmount, costs) {
    const total = sumCosts(costs);
    if (invoiceAmount == null || invoiceAmount === '') return { total, gross: null, rate: null };
    const inv = Number(invoiceAmount);
    const gross = inv - total;
    const rate = inv > 0 ? Math.round(gross / inv * 1000) / 10 : null;
    return { total, gross, rate };
  }
  const api = { calcLaborAmount, sumCosts, grossProfit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd "/Users/s/Desktop/claude code/claude code/report-tool/app" && node --test tests/`
Expected: 7 pass / 0 fail

- [ ] **Step 5: mock-data.js を作成**（日付は常に「今日」基準で生成＝いつ見てもデモが生きている）

```js
// app/shared/mock-data.js — モック。計画2でこのファイルは読み込まなくなる
(function () {
  const at = (days, hm) => { const t = new Date(); t.setDate(t.getDate() + days);
    const [h, m] = (hm || '09:00').split(':'); t.setHours(+h, +m, 0, 0); return t.toISOString(); };
  const day = d => at(d, '12:00').slice(0, 10);
  window.MOCK = {
    sessions: {
      admin:  { userId:'u-admin',  tenantId:'t1', name:'監督A', role:'admin'  },
      worker: { userId:'u-minami', tenantId:'t1', name:'南',    role:'worker' },
    },
    rates: { defaultRate: 3000, byUser: { 'u-minami': 3500 } },
    cases: [
      { id:'c1', caseNo:'261011-01', propertyName:'パレステュディオ目黒東', roomNo:'502',
        address:'東京都目黒区中目黒1-2-3', scheduledAt:at(0,'10:00'), status:'in_progress',
        workType:'調査', dueDate:day(3), instructions:'305号室天井の漏水。原因特定のため耐圧テスト実施。管理人に声かけしてから入室。',
        tasks:[{text:'管理人へ挨拶',done:true},{text:'耐圧テスト（給水）',done:true},{text:'耐圧テスト（給湯）',done:true},{text:'天井開口の写真',done:false},{text:'入居者へ結果説明',done:false}],
        cause:'', nextActions:'', assignedTo:'u-minami', assignedName:'南',
        workStartedAt:at(0,'10:05'), workEndedAt:null, invoiceAmount:null, report:null, createdAt:at(-2) },
      { id:'c2', caseNo:'261011-02', propertyName:'森ビル', roomNo:'301',
        address:'東京都港区六本木3-4-5', scheduledAt:at(0,'15:00'), status:'scheduled',
        workType:'作業報告', dueDate:day(0), instructions:'前回調査の補修作業。養生必須。',
        tasks:[{text:'養生',done:false},{text:'補修作業',done:false},{text:'作業後写真',done:false}],
        cause:'給湯管ピンホール', nextActions:'', assignedTo:'u-minami', assignedName:'南',
        workStartedAt:null, workEndedAt:null, invoiceAmount:null, report:null, createdAt:at(-3) },
      { id:'c3', caseNo:'261008-01', propertyName:'レジデンス福島', roomNo:'603',
        address:'大阪府大阪市福島区福島5-6-7', scheduledAt:at(-3,'13:00'), status:'submitted',
        workType:'調査', dueDate:day(-1), instructions:'603→503への漏水調査',
        tasks:[{text:'現地調査',done:true},{text:'報告書作成',done:true}],
        cause:'洗濯機排水ホース外れ', nextActions:'503号室の天井クロス張替え見積もり',
        assignedTo:'u-tanaka', assignedName:'田中',
        workStartedAt:at(-3,'13:00'), workEndedAt:at(-3,'15:30'), invoiceAmount:55000,
        report:{ company:'TJ株式会社', workDate:day(-3) }, createdAt:at(-5) },
      { id:'c4', caseNo:'261001-01', propertyName:'セオリー大阪ハーバー', roomNo:'302',
        address:'大阪府大阪市港区築港2-8-9', scheduledAt:at(-10,'09:00'), status:'confirmed',
        workType:'調査', dueDate:null, instructions:'',
        tasks:[], cause:'ユニットバス防水切れ', nextActions:'完了',
        assignedTo:'u-minami', assignedName:'南',
        workStartedAt:at(-10,'09:00'), workEndedAt:at(-10,'11:00'), invoiceAmount:38000,
        report:{ company:'TJ株式会社', workDate:day(-10) }, createdAt:at(-12) },
      { id:'c5', caseNo:'261015-01', propertyName:'グリタァ六角橋', roomNo:'509',
        address:'神奈川県横浜市神奈川区六角橋1-10-11', scheduledAt:at(4,'11:00'), status:'scheduled',
        workType:'調査', dueDate:day(7), instructions:'410号室への漏水。まず目視調査。',
        tasks:[{text:'目視調査',done:false}], cause:'', nextActions:'',
        assignedTo:'u-tanaka', assignedName:'田中',
        workStartedAt:null, workEndedAt:null, invoiceAmount:null, report:null, createdAt:at(-1) },
    ],
    costs: {
      c3: [
        { id:'k1', category:'labor', label:'作業員（田中 2.5h）', qty:2.5, unitPrice:3000, amount:7500, isAuto:true },
        { id:'k2', category:'material', label:'止水テープ等', qty:1, unitPrice:2800, amount:2800, isAuto:false },
      ],
    },
    photos: {
      c1: [
        { id:'p1', phase:'before', caption:'天井染み（対応前）', dataUrl:'' },
        { id:'p2', phase:'during', caption:'耐圧テスト中', dataUrl:'' },
      ],
    },
  };
})();
```

- [ ] **Step 6: store.js を実装**

```js
// app/shared/store.js — データ窓口（モック実装）。
// 計画2ではこのファイルの中身だけを Supabase+R2 実装に置き換える。画面は触らない。
(function () {
  const KEY = 'genba-mockdb-v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const seed = () => { const db = { cases: MOCK.cases, costs: MOCK.costs, rates: MOCK.rates };
    localStorage.setItem(KEY, JSON.stringify(db)); return db; };
  let db = load() || seed();
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  // 写真の dataUrl は容量が大きいので localStorage に入れない（ページ遷移で消える・モック限定の割切り）
  const memPhotos = JSON.parse(JSON.stringify(MOCK.photos));
  const uid = p => p + Math.random().toString(36).slice(2, 9);
  const sortByScheduled = cs => [...cs].sort((a, b) => (b.scheduledAt || '').localeCompare(a.scheduledAt || ''));
  const isToday = iso => iso && new Date(iso).toDateString() === new Date().toDateString();
  const todayYmd = () => new Date().toISOString().slice(0, 10);

  window.Store = {
    session() { const role = localStorage.getItem('mockRole') || 'admin'; return MOCK.sessions[role]; },
    setRole(role) { localStorage.setItem('mockRole', role); },
    resetMock() { localStorage.removeItem(KEY); db = seed(); },

    async listCases() {
      const s = this.session();
      const cs = s.role === 'worker' ? db.cases.filter(c => c.assignedTo === s.userId) : db.cases;
      return sortByScheduled(cs);
    },
    async getToday() {
      const all = await this.listCases();
      const active = all.filter(c => c.status !== 'confirmed');
      const t = todayYmd();
      return {
        todays: active.filter(c => isToday(c.scheduledAt))
          .sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || '')),
        overdue: active.filter(c => c.dueDate && c.dueDate < t),
        dueToday: active.filter(c => c.dueDate === t),
        awaiting: this.session().role === 'admin' ? all.filter(c => c.status === 'submitted') : [],
      };
    },
    async getCase(id) { return db.cases.find(c => c.id === id) || null; },
    async saveCase(obj) {
      if (obj.id) { const i = db.cases.findIndex(c => c.id === obj.id);
        db.cases[i] = { ...db.cases[i], ...obj }; save(); return db.cases[i]; }
      const c = { id: uid('c'), caseNo: '', propertyName: '', roomNo: '', address: '',
        scheduledAt: null, status: 'scheduled', workType: '調査', dueDate: null,
        instructions: '', tasks: [], cause: '', nextActions: '',
        assignedTo: null, assignedName: '', workStartedAt: null, workEndedAt: null,
        invoiceAmount: null, report: null, createdAt: new Date().toISOString(), ...obj };
      db.cases.unshift(c); save(); return c;
    },
    async updateStatus(id, status) {
      const c = await this.getCase(id); if (!c) return null;
      c.status = status;
      if (status === 'in_progress' && !c.workStartedAt) c.workStartedAt = new Date().toISOString();
      if (status === 'submitted' && !c.workEndedAt) c.workEndedAt = new Date().toISOString();
      save(); return c;
    },
    async toggleTask(id, index) {
      const c = await this.getCase(id); if (!c || !c.tasks[index]) return null;
      c.tasks[index].done = !c.tasks[index].done; save(); return c;
    },
    async listPhotos(caseId) { return memPhotos[caseId] || []; },
    async addPhoto(caseId, { dataUrl, phase, caption }) {
      const p = { id: uid('p'), phase: phase || 'before', caption: caption || '', dataUrl };
      (memPhotos[caseId] = memPhotos[caseId] || []).push(p); return p;
    },
    async deletePhoto(caseId, photoId) {
      memPhotos[caseId] = (memPhotos[caseId] || []).filter(p => p.id !== photoId);
    },
    async listCosts(caseId) { return db.costs[caseId] || []; },
    async saveCost(caseId, cost) {
      const list = (db.costs[caseId] = db.costs[caseId] || []);
      if (cost.id) { const i = list.findIndex(k => k.id === cost.id); list[i] = { ...list[i], ...cost }; }
      else { cost.id = uid('k'); list.push(cost); }
      save(); return cost;
    },
    async deleteCost(caseId, costId) {
      db.costs[caseId] = (db.costs[caseId] || []).filter(k => k.id !== costId); save();
    },
    async rates() { return db.rates; },
    async saveRates(r) { db.rates = { ...db.rates, ...r }; save(); },
    async saveReport(caseId, report) {
      const c = await this.getCase(caseId); if (!c) return null;
      c.report = report; save(); return c;
    },
  };
})();
```

- [ ] **Step 7: 再度テスト実行（リグレッション確認）**

Run: `cd "/Users/s/Desktop/claude code/claude code/report-tool/app" && node --test tests/`
Expected: 7 pass

- [ ] **Step 8: Commit**

```bash
git add app/ && git commit -m "feat(app): 原価計算の純関数(TDD)・モックデータ・Storeデータ窓口"
```

---

### Task 3: 今日ホーム（アラート・今日の現場・確認待ち）

**Files:**
- Modify: `app/index.html`

**Interfaces:**
- Consumes: `Store.getToday()`, `Store.session()`, `UI.*`

- [ ] **Step 1: index.html の `<main>` 描画スクリプトを実装**（Task 1 の `<script>` ブロックを置き換え）

```html
<script src="shared/config.js"></script>
<script src="shared/calc.js"></script>
<script src="shared/mock-data.js"></script>
<script src="shared/store.js"></script>
<script src="shared/ui.js"></script>
<script>
(async () => {
  const s = Store.session();
  document.getElementById('hd').textContent = `今日 ${UI.fmtDate(new Date().toISOString())}`;
  document.getElementById('who').textContent = `${s.name}（${s.role === 'admin' ? '管理者' : '作業担当'}）`;
  const { todays, overdue, dueToday, awaiting } = await Store.getToday();
  const caseCard = c => `
    <a class="cardlink" href="case.html?id=${c.id}"><div class="card tappable">
      <div class="row between">
        <span class="title">${UI.esc(c.propertyName)} ${UI.esc(c.roomNo)}</span>
        ${UI.statusBadge(c.status)}
      </div>
      <div class="sub">${UI.esc(c.address)}</div>
      <div class="row" style="margin-top:6px">
        <span class="sub">🕐 ${UI.fmtTime(c.scheduledAt)}</span>
        <span class="badge type">${UI.esc(c.workType)}</span>
        <span class="sub">👤 ${UI.esc(c.assignedName)}</span>
        <span class="sub">☑ ${c.tasks.filter(t => t.done).length}/${c.tasks.length}</span>
      </div>
      ${c.instructions ? `<div class="sub" style="margin-top:6px">📌 ${UI.esc(c.instructions.split('\n')[0])}</div>` : ''}
    </div></a>`;
  let html = '';
  if (overdue.length || dueToday.length)
    html += `<a class="alertbar" href="list.html?due=alert">⚠ 期限超過 ${overdue.length}件 / 本日期限 ${dueToday.length}件</a>`;
  html += `<div class="section-label">今日の現場（${todays.length}）</div>`;
  html += todays.length ? todays.map(caseCard).join('') : `<div class="empty">今日の現場はありません</div>`;
  if (s.role === 'admin') {
    html += `<div class="section-label">確認待ちの報告（${awaiting.length}）</div>`;
    html += awaiting.length ? awaiting.map(caseCard).join('') : `<div class="empty">確認待ちはありません</div>`;
  }
  document.getElementById('main').innerHTML = html;
  UI.tabbar('今日');
  if (s.role === 'admin')
    document.body.insertAdjacentHTML('beforeend', `<a class="fab" href="case.html?new=1">＋</a>`);
})();
</script>
```

- [ ] **Step 2: 目視確認**

Run: `python3 -m http.server 3031`（起動済みならそのまま）
`http://localhost:3031/app/` で確認:
- 赤いアラート帯「⚠ 期限超過 1件 / 本日期限 1件」（c3 が超過・c2 が本日）
- 「今日の現場（2）」に c1（10:00 対応中・☑3/5）と c2（15:00 予定）が時刻順
- 「確認待ちの報告（1）」に c3
- 右下に青い[＋]FAB
- DevTools Console で `Store.setRole('worker'); location.reload()` → ヘッダが「南（作業担当）」になり、確認待ちセクションと FAB が消える
- `Store.setRole('admin'); location.reload()` で戻ることを確認

- [ ] **Step 3: Commit**

```bash
git add app/index.html && git commit -m "feat(app): 今日ホーム — 期限アラート・今日の現場・確認待ち"
```

---

### Task 4: 案件一覧（カード・検索・フィルタチップ）

**Files:**
- Create: `app/list.html`

**Interfaces:**
- Consumes: `Store.listCases()`, `UI.*`
- URL 規約: `list.html?due=alert` は期限超過+本日期限のみ表示（今日ホームのアラート帯から遷移）

- [ ] **Step 1: list.html を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>案件一覧 — 現場管理</title>
<link rel="stylesheet" href="shared/style.css">
</head>
<body>
<header class="app"><h1>案件一覧</h1><span class="sub" id="count" style="color:#cbd5e1"></span></header>
<main>
  <input class="search" id="q" type="search" placeholder="物件名・住所で検索">
  <div class="chiprow" id="chips"></div>
  <div id="listing"></div>
</main>
<script src="shared/config.js"></script>
<script src="shared/calc.js"></script>
<script src="shared/mock-data.js"></script>
<script src="shared/store.js"></script>
<script src="shared/ui.js"></script>
<script>
(async () => {
  const FILTERS = [['all','すべて'],['scheduled','予定'],['in_progress','対応中'],['submitted','報告済'],['confirmed','確認済']];
  let filter = 'all', q = '', dueAlert = UI.qs('due') === 'alert';
  const all = await Store.listCases();
  const t = new Date().toISOString().slice(0, 10);

  function dueLabel(c) {
    if (!c.dueDate || c.status === 'confirmed') return '';
    if (c.dueDate < t) return `<span class="due-danger">⚠ 期限超過 ${c.dueDate.slice(5).replace('-', '/')}</span>`;
    if (c.dueDate === t) return `<span class="due-danger">本日期限</span>`;
    return '';
  }
  function card(c) {
    return `<a class="cardlink" href="case.html?id=${c.id}"><div class="card tappable">
      <div class="row between">
        <span class="title">${UI.esc(c.propertyName)} ${UI.esc(c.roomNo)}</span>
        ${UI.statusBadge(c.status)}
      </div>
      <div class="sub">${UI.esc(c.address)}</div>
      <div class="row" style="margin-top:6px">
        <span class="sub">📅 ${UI.fmtDate(c.scheduledAt)}</span>
        <span class="badge type">${UI.esc(c.workType)}</span>
        <span class="sub">👤 ${UI.esc(c.assignedName)}</span>
        ${dueLabel(c)}
      </div>
    </div></a>`;
  }
  function render() {
    let cs = all;
    if (dueAlert) cs = cs.filter(c => c.dueDate && c.dueDate <= t && c.status !== 'confirmed');
    if (filter !== 'all') cs = cs.filter(c => c.status === filter);
    if (q) cs = cs.filter(c => (c.propertyName + c.roomNo + c.address).includes(q));
    document.getElementById('listing').innerHTML =
      cs.length ? cs.map(card).join('') : '<div class="empty">該当する案件がありません</div>';
    document.getElementById('count').textContent = `${cs.length}件`;
    document.getElementById('chips').innerHTML = FILTERS.map(([k, label]) =>
      `<button class="chip ${k === filter ? 'active' : ''}" data-k="${k}">${label}</button>`).join('');
  }
  document.getElementById('chips').addEventListener('click', e => {
    const k = e.target.dataset.k; if (!k) return; filter = k; dueAlert = false; render();
  });
  document.getElementById('q').addEventListener('input', e => { q = e.target.value.trim(); render(); });
  render();
  UI.tabbar('案件');
  if (Store.session().role === 'admin')
    document.body.insertAdjacentHTML('beforeend', `<a class="fab" href="case.html?new=1">＋</a>`);
})();
</script>
</body>
</html>
```

- [ ] **Step 2: 目視確認**

`http://localhost:3031/app/list.html` で確認:
- 5件のカードが対応日降順
- 検索「目黒」→ c1 のみ。クリア → 5件
- チップ[報告済] → c3 のみ、[すべて]で戻る
- c3・c2 カードに赤い期限表示が出る
- `list.html?due=alert` で開くと期限系2件のみ
- worker 切替（settings 未実装のため Console で `Store.setRole('worker'); location.reload()`）→ 南の担当3件のみ・FAB消滅

- [ ] **Step 3: Commit**

```bash
git add app/list.html && git commit -m "feat(app): 案件一覧 — カード・検索・ステータスフィルタ・期限表示"
```

---

### Task 5: 案件詳細 — 概要タブ・タスクタブ・現場モード（打刻）

**Files:**
- Create: `app/case.html`

**Interfaces:**
- Consumes: `Store.getCase/saveCase/updateStatus/toggleTask`, `UI.*`
- Produces: タブ骨格（`#tab-overview #tab-tasks #tab-photos #tab-report #tab-costs` のコンテナと `switchTab(name)`）— Task 6, 8 がタブ中身を実装
- URL 規約: `case.html?id=X`（既存） / `case.html?new=1`（admin 新規作成）

- [ ] **Step 1: case.html を作成**（概要・タスクタブまで実装。写真/報告書/原価タブは空コンテナ）

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>案件 — 現場管理</title>
<link rel="stylesheet" href="shared/style.css">
</head>
<body>
<header class="app">
  <h1 id="hd" style="font-size:15px">案件</h1>
  <a href="javascript:history.back()" style="color:#cbd5e1;text-decoration:none;font-size:13px">← 戻る</a>
</header>
<div class="tabs" id="tabs"></div>
<main id="main"></main>
<script src="shared/config.js"></script>
<script src="shared/calc.js"></script>
<script src="shared/mock-data.js"></script>
<script src="shared/store.js"></script>
<script src="shared/ui.js"></script>
<script>
let CASE = null;
const S = Store.session();
const isAdmin = S.role === 'admin';
const isNew = UI.qs('new') === '1';
const TABS = [['overview','概要'],['tasks','タスク'],['photos','写真'],['report','報告書']]
  .concat(isAdmin ? [['costs','原価']] : []);
let active = 'overview';

function renderTabs() {
  document.getElementById('tabs').innerHTML = TABS.map(([k, label]) =>
    `<button class="${k === active ? 'active' : ''}" data-k="${k}">${label}</button>`).join('');
}
document.getElementById('tabs').addEventListener('click', e => {
  if (e.target.dataset.k) switchTab(e.target.dataset.k);
});
function switchTab(name) {
  active = name; renderTabs();
  ({ overview: renderOverview, tasks: renderTasks,
     photos: renderPhotos, report: renderReport, costs: renderCosts }[name])();
}

/* ---------- 概要タブ ---------- */
const STATUS_NEXT = { scheduled: ['in_progress', '▶ 作業開始（打刻）', 'start'],
                      in_progress: ['submitted', '✅ 作業終了・送信（打刻）', 'finish'] };
function mapsLink(addr) {
  return `<a href="https://maps.apple.com/?q=${encodeURIComponent(addr)}" style="color:var(--accent)">${UI.esc(addr)} 🗺</a>`;
}
function workDuration() {
  if (!CASE.workStartedAt) return '—';
  const end = CASE.workEndedAt ? UI.fmtTime(CASE.workEndedAt) : '…';
  let dur = '';
  if (CASE.workEndedAt) {
    const m = Math.round((new Date(CASE.workEndedAt) - new Date(CASE.workStartedAt)) / 60000);
    dur = `（${Math.floor(m / 60)}時間${m % 60}分)`;
  }
  return `${UI.fmtTime(CASE.workStartedAt)} 〜 ${end} ${dur}`;
}
function renderOverview() {
  const c = CASE;
  const next = STATUS_NEXT[c.status];
  const actionBtn = next && (isAdmin || c.assignedTo === S.userId)
    ? `<button class="btn ${next[2]}" id="statusBtn" style="margin:4px 0 12px">${next[1]}</button>` : '';
  const confirmBtn = isAdmin && c.status === 'submitted'
    ? `<button class="btn primary" id="confirmBtn" style="margin:4px 0 12px">✔ 確認済みにする</button>` : '';
  document.getElementById('main').innerHTML = `
    ${actionBtn}${confirmBtn}
    <div class="card"><dl style="margin:0">
      <div class="kv"><dt>状況</dt><dd>${UI.statusBadge(c.status)}</dd></div>
      <div class="kv"><dt>物件</dt><dd>${UI.esc(c.propertyName)} ${UI.esc(c.roomNo)}</dd></div>
      <div class="kv"><dt>住所</dt><dd>${c.address ? mapsLink(c.address) : '—'}</dd></div>
      <div class="kv"><dt>対応日時</dt><dd>${UI.fmtDate(c.scheduledAt)} ${UI.fmtTime(c.scheduledAt)}</dd></div>
      <div class="kv"><dt>期限</dt><dd>${c.dueDate || '—'}</dd></div>
      <div class="kv"><dt>区分</dt><dd>${UI.esc(c.workType)}</dd></div>
      <div class="kv"><dt>担当</dt><dd>${UI.esc(c.assignedName) || '—'}</dd></div>
      <div class="kv"><dt>作業時間</dt><dd>${workDuration()}</dd></div>
      <div class="kv"><dt>現地対応指示</dt><dd>${UI.esc(c.instructions) || '—'}</dd></div>
      <div class="kv"><dt>漏水原因</dt><dd>${UI.esc(c.cause) || '—'}</dd></div>
      <div class="kv"><dt>今後の対応</dt><dd>${UI.esc(c.nextActions) || '—'}</dd></div>
    </dl></div>
    ${isAdmin ? '<button class="btn ghost" id="editBtn">✏️ 編集</button>' : ''}`;
  const sb = document.getElementById('statusBtn');
  if (sb) sb.onclick = async () => { CASE = await Store.updateStatus(c.id, next[0]);
    UI.toast(next[0] === 'in_progress' ? '作業を開始しました' : '報告を送信しました'); renderOverview(); };
  const cb = document.getElementById('confirmBtn');
  if (cb) cb.onclick = async () => { CASE = await Store.updateStatus(c.id, 'confirmed');
    UI.toast('確認済みにしました'); renderOverview(); };
  const eb = document.getElementById('editBtn');
  if (eb) eb.onclick = renderEditForm;
}
/* ---------- 編集フォーム（admin。新規作成も共用） ---------- */
function renderEditForm() {
  const c = CASE || {};
  const f = (label, id, val, type = 'text', ph = '') =>
    `<div class="field"><label>${label}</label><input id="${id}" type="${type}" value="${UI.esc(val ?? '')}" placeholder="${ph}"></div>`;
  const dtLocal = iso => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  document.getElementById('main').innerHTML = `<div class="card">
    ${f('物件名（必須）', 'f-prop', c.propertyName, 'text', '〇〇マンション')}
    ${f('号室', 'f-room', c.roomNo, 'text', '502')}
    ${f('住所', 'f-addr', c.address, 'text', '東京都…')}
    ${f('対応日時', 'f-when', '', 'datetime-local')}
    ${f('期限', 'f-due', c.dueDate, 'date')}
    <div class="field"><label>区分</label><select id="f-type">
      <option${c.workType === '調査' ? ' selected' : ''}>調査</option>
      <option${c.workType === '作業報告' ? ' selected' : ''}>作業報告</option></select></div>
    <div class="field"><label>担当</label><select id="f-assign">
      <option value="">未定</option>
      <option value="u-minami"${c.assignedTo === 'u-minami' ? ' selected' : ''}>南</option>
      <option value="u-tanaka"${c.assignedTo === 'u-tanaka' ? ' selected' : ''}>田中</option></select></div>
    <div class="field"><label>現地対応指示・注意事項</label><textarea id="f-inst" rows="3">${UI.esc(c.instructions ?? '')}</textarea></div>
    <div class="field"><label>漏水原因</label><textarea id="f-cause" rows="2">${UI.esc(c.cause ?? '')}</textarea></div>
    <div class="field"><label>今後の必要な対応</label><textarea id="f-next" rows="2">${UI.esc(c.nextActions ?? '')}</textarea></div>
    <button class="btn primary" id="saveBtn">保存</button>
    <button class="btn ghost" id="cancelBtn" style="margin-top:8px">キャンセル</button>
  </div>`;
  document.getElementById('f-when').value = dtLocal(c.scheduledAt);
  document.getElementById('saveBtn').onclick = async () => {
    const prop = document.getElementById('f-prop').value.trim();
    if (!prop) { UI.toast('物件名は必須です'); return; }
    const assignSel = document.getElementById('f-assign');
    CASE = await Store.saveCase({
      ...(CASE ? { id: CASE.id } : {}),
      propertyName: prop,
      roomNo: document.getElementById('f-room').value.trim(),
      address: document.getElementById('f-addr').value.trim(),
      scheduledAt: document.getElementById('f-when').value ? new Date(document.getElementById('f-when').value).toISOString() : null,
      dueDate: document.getElementById('f-due').value || null,
      workType: document.getElementById('f-type').value,
      assignedTo: assignSel.value || null,
      assignedName: assignSel.options[assignSel.selectedIndex].text.replace('未定', ''),
      instructions: document.getElementById('f-inst').value,
      cause: document.getElementById('f-cause').value,
      nextActions: document.getElementById('f-next').value,
    });
    history.replaceState(null, '', `case.html?id=${CASE.id}`);
    setHeader(); UI.toast('保存しました'); renderOverview();
  };
  document.getElementById('cancelBtn').onclick = () => CASE ? renderOverview() : history.back();
}
/* ---------- タスクタブ ---------- */
function renderTasks() {
  const list = CASE.tasks.map((t, i) => `
    <label class="check"><input type="checkbox" data-i="${i}" ${t.done ? 'checked' : ''}>
      <span>${UI.esc(t.text)}${t.due ? ` <span class="sub">(期限 ${t.due.slice(5).replace('-', '/')})</span>` : ''}</span></label>`).join('');
  document.getElementById('main').innerHTML = `<div class="card">
    ${CASE.tasks.length ? list : '<div class="empty">タスクはありません</div>'}
    ${isAdmin ? `<div class="row" style="margin-top:10px">
      <input id="newTask" class="search" style="margin:0" placeholder="タスクを追加">
      <button class="btn primary" id="addTask" style="width:72px;padding:10px">追加</button></div>` : ''}
  </div>`;
  document.getElementById('main').querySelectorAll('input[type=checkbox]').forEach(cb =>
    cb.onchange = async () => { CASE = await Store.toggleTask(CASE.id, +cb.dataset.i); });
  const ab = document.getElementById('addTask');
  if (ab) ab.onclick = async () => {
    const v = document.getElementById('newTask').value.trim(); if (!v) return;
    CASE.tasks.push({ text: v, done: false });
    CASE = await Store.saveCase({ id: CASE.id, tasks: CASE.tasks }); renderTasks();
  };
}
/* ---------- プレースホルダ（Task 6, 8 で実装） ---------- */
function renderPhotos() { document.getElementById('main').innerHTML = '<div class="empty">写真タブは Task 6 で実装</div>'; }
function renderReport() { document.getElementById('main').innerHTML = '<div class="empty">報告書タブは Task 6 で実装</div>'; }
function renderCosts()  { document.getElementById('main').innerHTML = '<div class="empty">原価タブは Task 8 で実装</div>'; }

function setHeader() {
  document.getElementById('hd').textContent =
    CASE ? `${CASE.propertyName} ${CASE.roomNo}` : '新規案件';
}
(async () => {
  if (!isNew) CASE = await Store.getCase(UI.qs('id'));
  setHeader(); renderTabs();
  if (isNew) { if (!isAdmin) { document.getElementById('main').innerHTML = '<div class="empty">権限がありません</div>'; return; }
    renderEditForm(); }
  else if (!CASE) document.getElementById('main').innerHTML = '<div class="empty">案件が見つかりません</div>';
  else renderOverview();
})();
</script>
</body>
</html>
```

- [ ] **Step 2: 目視・操作確認**

`http://localhost:3031/app/case.html?id=c2` で確認:
- タブが[概要][タスク][写真][報告書][原価]（admin時）
- 概要: 住所が地図リンク、現地対応指示表示、[▶ 作業開始（打刻）]ボタン
- [作業開始]タップ → バッジが「対応中」・作業時間に開始時刻 → [✅ 作業終了・送信]に変化 → タップ → 「報告済」＋[✔ 確認済みにする]出現（admin）→ タップで「確認済」
- タスクタブ: チェックON/OFFが list 再訪後も保持（localStorage永続）
- [✏️ 編集] → フォーム → 物件名変更 → 保存 → 反映
- `case.html?new=1` → 空フォーム → 物件名入れ保存 → 一覧に新案件が現れる
- Console で `Store.setRole('worker'); location.reload()` → 原価タブ非表示・編集ボタン非表示・c2（担当:南）では打刻ボタンあり
- 確認後 `Store.setRole('admin')` に戻し、`Store.resetMock(); location.reload()` でモック初期化

- [ ] **Step 3: Commit**

```bash
git add app/case.html && git commit -m "feat(app): 案件詳細 — 概要/タスクタブ・打刻によるステータス遷移・admin編集/新規作成"
```

---

### Task 6: 写真タブ（撮影→圧縮→サムネ→ギャラリー）＋報告書タブ

**Files:**
- Modify: `app/case.html`（`renderPhotos` / `renderReport` プレースホルダを置換、`<input type=file>` 用スクリプト追加）

**Interfaces:**
- Consumes: `Store.listPhotos/addPhoto/deletePhoto`, `Store.getCase`
- Produces: `compressImage(file, maxEdge) -> Promise<dataUrl>`（report.html でも将来利用）

- [ ] **Step 1: renderPhotos と画像圧縮を実装**（case.html の該当プレースホルダ関数を置換）

```js
/* ---------- 写真タブ ---------- */
const PHASES = [['before', '対応前'], ['during', '対応中'], ['after', '対応後']];
function compressImage(file, maxEdge = 1600, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
async function renderPhotos() {
  const photos = await Store.listPhotos(CASE.id);
  const canEdit = isAdmin || CASE.assignedTo === S.userId;
  const grid = ph => {
    const list = photos.filter(p => p.phase === ph);
    return list.length ? `<div class="photo-grid">${list.map(p => `
      <div style="position:relative">
        <img src="${p.dataUrl || 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23cbd5e1%22/><text x=%2250%22 y=%2255%22 font-size=%2210%22 text-anchor=%22middle%22 fill=%22%23475569%22>サンプル</text></svg>'}"
             data-cap="${UI.esc(p.caption)}" class="ph">
        ${canEdit ? `<button data-del="${p.id}" style="position:absolute;top:2px;right:2px;border:none;background:rgba(0,0,0,.55);color:#fff;border-radius:50%;width:22px;height:22px;font-size:11px">✕</button>` : ''}
      </div>`).join('')}</div>` : '<div class="empty" style="padding:12px 0">まだありません</div>';
  };
  document.getElementById('main').innerHTML = PHASES.map(([ph, label]) => `
    <div class="section-label">${label}（${photos.filter(p => p.phase === ph).length}）</div>
    <div class="card">${grid(ph)}
      ${canEdit ? `<label class="btn ghost" style="margin-top:10px">📷 ${label}の写真を追加
        <input type="file" accept="image/*" capture="environment" multiple data-phase="${ph}" style="display:none"></label>` : ''}
    </div>`).join('');
  document.getElementById('main').querySelectorAll('input[type=file]').forEach(inp =>
    inp.onchange = async () => {
      for (const file of inp.files) {
        const dataUrl = await compressImage(file);
        await Store.addPhoto(CASE.id, { dataUrl, phase: inp.dataset.phase, caption: '' });
      }
      UI.toast(`${inp.files.length}枚追加しました`); renderPhotos();
    });
  document.getElementById('main').querySelectorAll('[data-del]').forEach(b =>
    b.onclick = async () => { await Store.deletePhoto(CASE.id, b.dataset.del); renderPhotos(); });
  document.getElementById('main').querySelectorAll('img.ph').forEach(img =>
    img.onclick = () => {  // 原寸ビューア（簡易）
      const v = document.createElement('div');
      v.style.cssText = 'position:fixed;inset:0;background:#000;z-index:50;display:flex;align-items:center;justify-content:center';
      v.innerHTML = `<img src="${img.src}" style="max-width:100%;max-height:100%">`;
      v.onclick = () => v.remove(); document.body.appendChild(v);
    });
}
/* ---------- 報告書タブ ---------- */
function renderReport() {
  const r = CASE.report;
  document.getElementById('main').innerHTML = `
    <div class="card">
      ${r ? `<div class="kv"><dt>状態</dt><dd>作成済み（${UI.esc(r.workDate || '')}）</dd></div>`
           : '<div class="empty" style="padding:12px 0">報告書はまだ作成されていません</div>'}
    </div>
    <a class="btn primary" href="report.html?case=${CASE.id}">${r ? '報告書を開く・編集' : '📝 報告書を作成'}</a>
    ${r ? '<button class="btn ghost" style="margin-top:8px" onclick="UI.toast(\'PDF出力は report.html 側の既存機能を使用\')">📄 PDF・共有</button>' : ''}`;
}
```

- [ ] **Step 2: 目視確認**

`case.html?id=c1` の写真タブ:
- 「対応前（1）」「対応中（1）」にグレーのサンプル枠
- [📷 対応後の写真を追加] → 画像選択 → グリッドに追加・タップで全画面・✕で削除
- DevTools Network/Console でアップ後の dataUrl が JPEG であること（`data:image/jpeg` で始まる）
- 報告書タブ: c1 は「まだ作成されていません」＋[📝 報告書を作成]、c3 は「作成済み」＋[報告書を開く・編集]

- [ ] **Step 3: Commit**

```bash
git add app/case.html && git commit -m "feat(app): 写真タブ（撮影・圧縮・ギャラリー・削除）と報告書タブ"
```

---

### Task 7: 報告書フォーム report.html（旧ツールのコピー＋最小改修）

**Files:**
- Create: `app/report.html`（root `index.html` のコピー。**root は無変更**）

**Interfaces:**
- Consumes: `Store.getCase/saveReport`, `UI.qs`
- URL 規約: `report.html?case=X` で案件連携。クエリ無し単体起動も可（保存時に新規 case 自動作成 — spec §7）

- [ ] **Step 1: root index.html をコピー**

```bash
cd "/Users/s/Desktop/claude code/claude code/report-tool"
cp index.html app/report.html
```

- [ ] **Step 2: app/report.html の `</body>` 直前に連携スクリプトを追記**（既存コードは削除しない。momentum を保つため追記のみで実現する）

まず既存コードの構造を確認する:
Run: `grep -n "function collectData\|function dbSave\|id=\"company\"\|id=\"bukken\|物件名\|号室" app/report.html | head -20`
（フィールド ID と保存関数名を把握。以下のコードの `#…` セレクタ部分を実際の ID に合わせて調整すること）

```html
<script src="shared/config.js"></script>
<script src="shared/calc.js"></script>
<script src="shared/mock-data.js"></script>
<script src="shared/store.js"></script>
<script src="shared/ui.js"></script>
<script>
/* ===== 案件連携アドオン（既存コードへの変更は dbSave のラップのみ） ===== */
(async () => {
  const caseId = UI.qs('case');
  // 1) 住所フィールドを追加（号室の後ろ）— 一覧・案件と住所を共有するため
  const roomInput = document.querySelector('input[placeholder="705号室"]')
    || document.querySelector('input[id*="room" i]');
  if (roomInput) {
    const wrap = roomInput.closest('div');
    wrap.insertAdjacentHTML('afterend',
      `<div class="${wrap.className}"><label>住所</label>
         <input id="x-address" type="text" placeholder="東京都〇〇区…"></div>`);
  }
  // 2) 案件から来た場合はプリフィル
  if (caseId) {
    const c = await Store.getCase(caseId);
    if (c) {
      const setVal = (sel, v) => { const el = document.querySelector(sel); if (el && v) el.value = v; };
      setVal('input[placeholder="〇〇マンション"]', c.propertyName);
      setVal('input[placeholder="705号室"]', c.roomNo);
      const addr = document.getElementById('x-address'); if (addr) addr.value = c.address || '';
    }
  }
  // 3) 既存の履歴保存（dbSave）をラップして Store にも保存
  if (typeof dbSave === 'function') {
    const _dbSave = dbSave;
    window.dbSave = async function (r) {
      const id = await _dbSave(r);
      try {
        r.address = (document.getElementById('x-address') || {}).value || '';
        let cid = caseId;
        if (!cid) {   // 単体起動 → 新規案件を自動作成（宙に浮く報告書を作らない）
          const c = await Store.saveCase({
            propertyName: r.bukken || r.propertyName || '（物件名未設定）',
            roomNo: r.room || '', address: r.address,
            scheduledAt: new Date().toISOString(), status: 'submitted',
            workType: r.workType || '調査',
          });
          cid = c.id;
        }
        await Store.saveReport(cid, r);
        UI.toast('案件に報告書を保存しました');
      } catch (e) { console.warn('Store保存失敗（IndexedDBには保存済み）', e); }
      return id;
    };
  }
})();
</script>
```

**注意:** 上のセレクタ・プロパティ名（`r.bukken` 等）は仮。Step 2 冒頭の grep で実際の ID・保存オブジェクトのキー名を確認して合わせる。既存894行の中身は書き換えない（ラップと追記のみ）。

- [ ] **Step 3: 動作確認**

- `report.html?case=c2` → 物件名「森ビル」・号室「301」・住所がプリフィルされている
- フォームに適当な内容を入れ、既存の保存（履歴保存）を実行 → トースト「案件に報告書を保存しました」→ `case.html?id=c2` の報告書タブが「作成済み」になる
- `report.html`（クエリ無し）で保存 → 一覧に新規案件が自動で現れる
- **旧ツール確認**: `http://localhost:3031/`（root）が以前と同一表示・動作のまま（diff ゼロの確認: `git status` で root index.html が変更されていないこと）

- [ ] **Step 4: Commit**

```bash
git add app/report.html && git commit -m "feat(app): 報告書フォーム — 旧ツールをコピーし案件連携・住所欄・Store保存を追加（旧ツール無変更）"
```

---

### Task 8: 原価タブ（人件費自動行・明細・請求額→粗利）

**Files:**
- Modify: `app/case.html`（`renderCosts` プレースホルダを置換）

**Interfaces:**
- Consumes: `Calc.calcLaborAmount/grossProfit`, `Store.listCosts/saveCost/deleteCost/rates/saveCase`

- [ ] **Step 1: renderCosts を実装**

```js
/* ---------- 原価タブ（admin のみ。タブ自体が worker には出ない） ---------- */
const CAT = { labor: '人件費', material: '材料費', subcontract: '外注費', other: 'その他' };
async function renderCosts() {
  let costs = await Store.listCosts(CASE.id);
  const rates = await Store.rates();
  // 人件費の自動行を打刻から同期（手動上書き行 isAuto=false は触らない）
  const rate = rates.byUser[CASE.assignedTo] ?? rates.defaultRate;
  const auto = Calc.calcLaborAmount(CASE.workStartedAt, CASE.workEndedAt, rate);
  const autoRow = costs.find(k => k.isAuto);
  if (auto != null) {
    const h = Math.round((new Date(CASE.workEndedAt) - new Date(CASE.workStartedAt)) / 360000) / 10;
    const row = { category: 'labor', label: `作業員（${CASE.assignedName} ${h}h）`,
      qty: h, unitPrice: rate, amount: auto, isAuto: true };
    if (autoRow) await Store.saveCost(CASE.id, { ...row, id: autoRow.id });
    else await Store.saveCost(CASE.id, row);
    costs = await Store.listCosts(CASE.id);
  }
  const { total, gross, rate: gRate } = Calc.grossProfit(CASE.invoiceAmount, costs);
  const rows = costs.map(k => `
    <div class="kv"><dt>${CAT[k.category] || k.category}${k.isAuto ? '<span class="sub">(自動)</span>' : ''}</dt>
      <dd class="row between"><span>${UI.esc(k.label)}</span>
        <span class="money">${UI.fmtYen(k.amount)}
          <button data-delc="${k.id}" style="border:none;background:none;color:var(--danger)">✕</button></span>
      </dd></div>`).join('');
  document.getElementById('main').innerHTML = `
    <div class="total-box">
      <div class="row"><span>原価合計</span><span class="money">${UI.fmtYen(total)}</span></div>
      <div class="row"><span>請求額</span><span class="money">${UI.fmtYen(CASE.invoiceAmount)}</span></div>
      <div class="row" style="font-weight:700;font-size:16px"><span>粗利</span>
        <span class="money">${gross == null ? '—（請求額未入力）' : `${UI.fmtYen(gross)}（${gRate}%）`}</span></div>
    </div>
    <div class="section-label">明細</div>
    <div class="card">${rows || '<div class="empty" style="padding:10px 0">明細なし。打刻完了で人件費が自動計上されます</div>'}</div>
    <div class="section-label">明細を追加</div>
    <div class="card">
      <div class="field"><label>区分</label><select id="k-cat">
        ${Object.entries(CAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>内容</label><input id="k-label" placeholder="例: 止水プラグ"></div>
      <div class="row">
        <div class="field" style="flex:1"><label>数量</label><input id="k-qty" type="number" value="1"></div>
        <div class="field" style="flex:1"><label>単価（円）</label><input id="k-price" type="number"></div>
      </div>
      <button class="btn primary" id="k-add">追加</button>
    </div>
    <div class="section-label">請求額</div>
    <div class="card"><div class="field"><label>請求額（税抜・円）</label>
      <input id="k-invoice" type="number" value="${CASE.invoiceAmount ?? ''}"></div>
      <button class="btn ghost" id="k-saveinv">請求額を保存</button></div>`;
  document.getElementById('k-add').onclick = async () => {
    const qty = +document.getElementById('k-qty').value || 1;
    const price = +document.getElementById('k-price').value || 0;
    await Store.saveCost(CASE.id, { category: document.getElementById('k-cat').value,
      label: document.getElementById('k-label').value.trim() || '明細',
      qty, unitPrice: price, amount: Math.round(qty * price), isAuto: false });
    renderCosts();
  };
  document.getElementById('k-saveinv').onclick = async () => {
    const v = document.getElementById('k-invoice').value;
    CASE = await Store.saveCase({ id: CASE.id, invoiceAmount: v === '' ? null : +v });
    UI.toast('請求額を保存しました'); renderCosts();
  };
  document.getElementById('main').querySelectorAll('[data-delc]').forEach(b =>
    b.onclick = async () => { await Store.deleteCost(CASE.id, b.dataset.delc); renderCosts(); });
}
```

- [ ] **Step 2: 動作確認**

`case.html?id=c3`（打刻済み・請求額55,000）の原価タブ:
- 人件費自動行「作業員（田中 2.5h）」¥7,500 ＋ 材料費 ¥2,800 → 原価合計 ¥10,300
- 粗利 ¥44,700（81.3%）がネイビーのボックスに表示
- 明細追加（外注費・1×5,000）→ 合計¥15,300・粗利が即再計算
- 請求額を 60,000 に変更保存 → 粗利再計算
- `Store.setRole('worker'); location.reload()` → c3 を開いても[原価]タブ自体が無い → admin に戻す

- [ ] **Step 3: node テスト再実行（リグレッション）**

Run: `cd app && node --test tests/`
Expected: 7 pass

- [ ] **Step 4: Commit**

```bash
git add app/case.html && git commit -m "feat(app): 原価タブ — 打刻からの人件費自動行・明細CRUD・粗利即時計算"
```

---

### Task 9: 設定画面（roleプレビュー・単価・モック初期化）

**Files:**
- Create: `app/settings.html`

**Interfaces:**
- Consumes: `Store.session/setRole/rates/saveRates/resetMock`

- [ ] **Step 1: settings.html を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>設定 — 現場管理</title>
<link rel="stylesheet" href="shared/style.css">
</head>
<body>
<header class="app"><h1>設定</h1></header>
<main>
  <div class="section-label">表示プレビュー（プロトタイプ用）</div>
  <div class="card">
    <div class="field"><label>ロール切替</label><select id="role">
      <option value="admin">管理者（監督A）</option>
      <option value="worker">作業担当（南）</option></select></div>
    <div class="sub">※本番では Supabase Auth のログインユーザーで自動決定</div>
  </div>
  <div class="section-label">原価設定（管理者のみ）</div>
  <div class="card" id="rateCard">
    <div class="field"><label>既定単価（円/時）</label><input id="defRate" type="number"></div>
    <button class="btn primary" id="saveRate">保存</button>
  </div>
  <div class="section-label">データ</div>
  <div class="card">
    <button class="btn ghost" id="reset">モックデータを初期化</button>
    <div class="sub" style="margin-top:8px">保存期間設定・メンバー管理・ログアウトは計画2（Supabase接続）で実装</div>
  </div>
</main>
<script src="shared/config.js"></script>
<script src="shared/calc.js"></script>
<script src="shared/mock-data.js"></script>
<script src="shared/store.js"></script>
<script src="shared/ui.js"></script>
<script>
(async () => {
  const s = Store.session();
  document.getElementById('role').value = s.role;
  document.getElementById('role').onchange = e => { Store.setRole(e.target.value); location.reload(); };
  if (s.role !== 'admin') document.getElementById('rateCard').innerHTML = '<div class="empty">管理者のみ</div>';
  else {
    document.getElementById('defRate').value = (await Store.rates()).defaultRate;
    document.getElementById('saveRate').onclick = async () => {
      await Store.saveRates({ defaultRate: +document.getElementById('defRate').value || 0 });
      UI.toast('保存しました');
    };
  }
  document.getElementById('reset').onclick = () => {
    Store.resetMock(); UI.toast('初期化しました'); setTimeout(() => location.href = 'index.html', 600);
  };
  UI.tabbar('設定');
})();
</script>
</body>
</html>
```

- [ ] **Step 2: 動作確認**

- 設定タブからロールを「作業担当」へ → 全画面が worker 表示（ホームに確認待ちなし・原価タブなし・一覧が担当分のみ）→「管理者」へ戻す
- 単価を 3500 に変更 → c3 原価タブの自動行が次回表示時に再計算されている（qty×新単価）
- [モックデータを初期化] → c1〜c5 が初期状態に戻る

- [ ] **Step 3: Commit**

```bash
git add app/settings.html && git commit -m "feat(app): 設定画面 — roleプレビュー切替・既定単価・モック初期化"
```

---

### Task 10: PWA（manifest・Service Worker・アイコン）

**Files:**
- Create: `app/manifest.json`, `app/sw.js`, `app/icons/icon-192.png`, `app/icons/icon-512.png`, `app/icons/apple-touch-icon.png`
- Modify: `app/index.html`, `app/list.html`, `app/case.html`, `app/settings.html`, `app/report.html`（head に meta/link 追記）

- [ ] **Step 1: アイコン生成（ネイビー無地・Python標準ライブラリのみでPNG生成）**

```bash
cd "/Users/s/Desktop/claude code/claude code/report-tool/app" && mkdir -p icons && python3 - <<'EOF'
import struct, zlib
def png(path, size, rgb):
    row = b'\x00' + bytes(rgb) * size
    raw = row * size
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c))
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)
navy = (22, 48, 77)
png('icons/icon-192.png', 192, navy)
png('icons/icon-512.png', 512, navy)
png('icons/apple-touch-icon.png', 180, navy)
print('icons generated')
EOF
```
（無地アイコンは仮。見た目のブラッシュアップはUIレビュー時にユーザーと調整）

- [ ] **Step 2: manifest.json を作成**

```json
{
  "name": "現場管理",
  "short_name": "現場管理",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "background_color": "#16304d",
  "theme_color": "#16304d",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 3: sw.js を作成**（シェルキャッシュのみ。開発の邪魔をしないよう github.io でのみ登録）

```js
// app/sw.js — アプリシェルのみキャッシュ。データは対象外（spec §7 PWA）
const VER = 'genba-v1';
const SHELL = ['./', './index.html', './list.html', './case.html', './settings.html',
  './shared/style.css', './shared/config.js', './shared/calc.js',
  './shared/mock-data.js', './shared/store.js', './shared/ui.js', './manifest.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit ||
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VER).then(c => c.put(e.request, copy));
      return res;
    })));
});
```

- [ ] **Step 4: 全HTMLの `<head>` に追記**（5ファイル共通）

```html
<meta name="theme-color" content="#16304d">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

さらに `index.html` の `</body>` 直前に（登録は本番ホストのみ）:

```html
<script>
if ('serviceWorker' in navigator && location.hostname.endsWith('github.io'))
  navigator.serviceWorker.register('sw.js');
</script>
```

- [ ] **Step 5: ローカル最終確認＋テスト再実行**

- `http://localhost:3031/app/` 全5画面をひと通りクリック（Console にエラーゼロ）
- `cd app && node --test tests/` → 7 pass
- `git status` で root index.html・public/・worker/ に変更がないことを確認

- [ ] **Step 6: Commit**

```bash
git add app/ && git commit -m "feat(app): PWA対応 — manifest/Service Worker/アイコン"
```

---

### Task 11: GitHub Pages デプロイ・実機レビュー依頼

**Files:** なし（push のみ）

- [ ] **Step 1: push 前確認**

Run: `git status -sb && git log --oneline origin/main..HEAD`
- 旧ツール（root index.html）に変更が無いこと
- push されるのは spec/plan/app のコミット＋ユーザー自身の10月コミット（4278b7f キーボード対応）のみであること

- [ ] **Step 2: push**

```bash
git push origin main
```

- [ ] **Step 3: 公開確認（Pages ビルドに1〜2分）**

Run: `sleep 90 && curl -s -o /dev/null -w "%{http_code}" https://sho0929h4-spec.github.io/report-tool/app/`
Expected: `200`
旧ツールも確認: `curl -s https://sho0929h4-spec.github.io/report-tool/ | grep -o "<title>[^<]*"` → `作業報告書 作成ツール`（従来どおり）

- [ ] **Step 4: ユーザーへ実機レビュー依頼**

スマホで `https://sho0929h4-spec.github.io/report-tool/app/` を開き:
1. Safari 共有メニュー →「ホーム画面に追加」→ アイコンから全画面起動
2. 今日ホーム → 案件 → 詳細 → 打刻 → 写真 → 原価 → 設定（role切替）をひと通り操作
3. 気になった UI・足りない機能をフィードバック → 修正イテレーションへ

---

## Self-Review 済みメモ

- **Spec coverage**: 今日ホーム(§7)・一覧(§7)・詳細5タブ(§7)・打刻(§7)・原価/粗利(§5,7)・role分離のUI面(§6)・報告書連携(§7)・PWA(§7)・旧ツール無変更(§9) — 計画1でカバー。**Supabase/R2/RLS/認証/保存期間削除/履歴移行(§4,5,6,8)は計画2**（UI確定後に作成）
- **モックの割り切り（明示）**: 写真はページ遷移で消える（メモリ保持）・role切替は設定画面のプレビュー・原価の秘匿はUI非表示のみ（本物の遮断は計画2のRLS）
- **Type consistency**: Store/Calc のシグネチャは Task 2 の Interfaces 定義が唯一の正。Task 3-9 はそれのみ参照
