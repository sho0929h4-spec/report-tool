// RLS検証: 実プロジェクトのAuth+PostgRESTを直接叩く
// 実行: cd app/backend && node --test tests/rls.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL_ = env.SUPABASE_URL, SRK = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.SUPABASE_ANON_KEY;
const sH = { apikey: SRK, authorization: `Bearer ${SRK}`, 'content-type': 'application/json' };

async function sfetch(path, opt = {}) {
  const r = await fetch(`${URL_}${path}`, { ...opt, headers: { ...sH, ...(opt.headers || {}) } });
  const t = await r.text(); if (!r.ok) throw new Error(`${path}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
async function makeUser(email, tenantId, name, role) {
  const list = await sfetch('/auth/v1/admin/users?per_page=100');
  const old = (list.users || []).find(u => u.email === email);
  if (old) {
    // 古い profiles があればまず削除（FK制約回避）
    await sfetch(`/rest/v1/profiles?user_id=eq.${old.id}`, { method: 'DELETE' }).catch(() => {});
    await sfetch(`/auth/v1/admin/users/${old.id}`, { method: 'DELETE' });
  }
  const u = await sfetch('/auth/v1/admin/users', { method: 'POST',
    body: JSON.stringify({ email, password: 'Rls-test-123', email_confirm: true }) });
  await sfetch('/rest/v1/profiles', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: u.id, tenant_id: tenantId, display_name: name, role }) });
  return u.id;
}
async function login(email) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Rls-test-123' }) });
  return (await r.json()).access_token;
}
const as = tok => (path, opt = {}) => fetch(`${URL_}/rest/v1${path}`,
  { ...opt, headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json',
    prefer: 'return=representation', ...(opt.headers || {}) } });

// --- セットアップ（service_roleでテスト専用データ作成） ---
const testSuffix = Math.random().toString(36).substring(2, 8);
const T1 = (await sfetch('/rest/v1/tenants', { method: 'POST', headers: { prefer: 'return=representation' },
  body: JSON.stringify({ name: `rlsT1-${testSuffix}` }) }))[0].id;
const T2 = (await sfetch('/rest/v1/tenants', { method: 'POST', headers: { prefer: 'return=representation' },
  body: JSON.stringify({ name: `rlsT2-${testSuffix}` }) }))[0].id;
const adminId  = await makeUser(`rls-admin-${testSuffix}@genba.test`,  T1, 'RLS管理', 'admin');
const workerId = await makeUser(`rls-worker-${testSuffix}@genba.test`, T1, 'RLS作業', 'worker');
const otherId  = await makeUser(`rls-other-${testSuffix}@genba.test`,  T2, 'RLS他社', 'admin');
const mkCase = async (assigned) => (await sfetch('/rest/v1/cases', { method: 'POST',
  headers: { prefer: 'return=representation' },
  body: JSON.stringify({ tenant_id: T1, property_name: 'RLS検証物件', assigned_to: assigned,
    invoice_amount: 99999 }) }))[0].id;
const caseMine = await mkCase(workerId);
const caseOther = await mkCase(adminId);
await sfetch('/rest/v1/costs', { method: 'POST', body: JSON.stringify({
  tenant_id: T1, case_id: caseMine, category: 'material', label: '秘密原価', amount: 12345 }) });
const tokA = await login(`rls-admin-${testSuffix}@genba.test`);
const tokW = await login(`rls-worker-${testSuffix}@genba.test`);
const tokO = await login(`rls-other-${testSuffix}@genba.test`);

test('他テナントからは cases が1件も見えない', async () => {
  const r = await as(tokO)(`/cases?select=id&tenant_id=eq.${T1}`);
  assert.deepStrictEqual(await r.json(), []);
});
test('worker は costs / worker_rates を読めない', async () => {
  assert.deepStrictEqual(await (await as(tokW)('/costs?select=id')).json(), []);
  assert.deepStrictEqual(await (await as(tokW)('/worker_rates?select=user_id')).json(), []);
});
test('worker は自分の担当案件だけ更新できる', async () => {
  const ok = await as(tokW)(`/cases?id=eq.${caseMine}`, { method: 'PATCH',
    body: JSON.stringify({ status: 'in_progress' }) });
  assert.strictEqual((await ok.json()).length, 1);
  const ng = await as(tokW)(`/cases?id=eq.${caseOther}`, { method: 'PATCH',
    body: JSON.stringify({ status: 'in_progress' }) });
  assert.deepStrictEqual(await ng.json(), []); // RLSで0行
});
test('worker は confirmed にできない（トリガー）', async () => {
  const r = await as(tokW)(`/cases?id=eq.${caseMine}`, { method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed' }) });
  assert.ok(!r.ok, 'confirmed 化は拒否されるべき');
});
test('worker は指示・請求額を書き換えられない（トリガー）', async () => {
  const r = await as(tokW)(`/cases?id=eq.${caseMine}`, { method: 'PATCH',
    body: JSON.stringify({ instructions: '改ざん' }) });
  assert.ok(!r.ok);
});
test('worker は案件を新規作成できない', async () => {
  const r = await as(tokW)('/cases', { method: 'POST',
    body: JSON.stringify({ tenant_id: T1, property_name: '不正作成' }) });
  assert.ok(!r.ok);
});
test('admin は confirmed にできる', async () => {
  const r = await as(tokA)(`/cases?id=eq.${caseMine}`, { method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed' }) });
  assert.strictEqual((await r.json()).length, 1);
});
test('admin は message_drafts を作成・参照できる', async () => {
  const r = await as(tokA)('/message_drafts', { method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ tenant_id: T1, case_id: caseMine,
      trigger_type: 'preVisit', sh_role: 'manager', sh_name: 'テスト管理会社', body: 'テスト本文' }) });
  assert.ok(r.ok, 'admin insert should succeed: ' + (await r.clone().text()));
  const rows = await r.json();
  assert.strictEqual(rows.length, 1);
  // 参照
  const sel = await as(tokA)(`/message_drafts?case_id=eq.${caseMine}`);
  const all = await sel.json();
  assert.ok(Array.isArray(all) && all.length >= 1);
});
test('worker は message_drafts を参照・作成できない', async () => {
  const selR = await as(tokW)('/message_drafts?select=id');
  assert.deepStrictEqual(await selR.json(), []);
  const insR = await as(tokW)('/message_drafts', { method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ tenant_id: T1, case_id: caseMine,
      trigger_type: 'siteReport', sh_role: 'owner', sh_name: '不正', body: '不正' }) });
  assert.ok(!insR.ok, 'worker insert should be rejected');
});

test('後片付け', async () => {
  try {
    // FK順序: message_drafts → costs → cases → profiles → auth.users → tenants
    await sfetch(`/rest/v1/message_drafts?tenant_id=in.(${T1},${T2})`, { method: 'DELETE' }).catch(() => {});
    // costs の削除
    await sfetch(`/rest/v1/costs?case_id=eq.${caseMine}`, { method: 'DELETE' }).catch(() => {});
    await sfetch(`/rest/v1/costs?case_id=eq.${caseOther}`, { method: 'DELETE' }).catch(() => {});
    // cases の削除
    await sfetch(`/rest/v1/cases?tenant_id=in.(${T1},${T2})`, { method: 'DELETE' });
    // profiles の削除
    await sfetch(`/rest/v1/profiles?user_id=in.(${adminId},${workerId},${otherId})`, { method: 'DELETE' });
    // auth.users の削除
    await sfetch(`/auth/v1/admin/users/${adminId}`, { method: 'DELETE' }).catch(() => {});
    await sfetch(`/auth/v1/admin/users/${workerId}`, { method: 'DELETE' }).catch(() => {});
    await sfetch(`/auth/v1/admin/users/${otherId}`, { method: 'DELETE' }).catch(() => {});
    // tenants の削除
    await sfetch(`/rest/v1/tenants?id=in.(${T1},${T2})`, { method: 'DELETE' });
  } catch (e) {
    console.warn('後片付け失敗:', e.message);
  }
});
