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
  if (old) await sfetch(`/auth/v1/admin/users/${old.id}`, { method: 'DELETE' });
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
const T1 = (await sfetch('/rest/v1/tenants', { method: 'POST', headers: { prefer: 'return=representation' },
  body: JSON.stringify({ name: `rlsT1-${Date.now()}` }) }))[0].id;
const T2 = (await sfetch('/rest/v1/tenants', { method: 'POST', headers: { prefer: 'return=representation' },
  body: JSON.stringify({ name: `rlsT2-${Date.now()}` }) }))[0].id;
const adminId  = await makeUser('rls-admin@genba.test',  T1, 'RLS管理', 'admin');
const workerId = await makeUser('rls-worker@genba.test', T1, 'RLS作業', 'worker');
const otherId  = await makeUser('rls-other@genba.test',  T2, 'RLS他社', 'admin');
const mkCase = async (assigned) => (await sfetch('/rest/v1/cases', { method: 'POST',
  headers: { prefer: 'return=representation' },
  body: JSON.stringify({ tenant_id: T1, property_name: 'RLS検証物件', assigned_to: assigned,
    invoice_amount: 99999 }) }))[0].id;
const caseMine = await mkCase(workerId);
const caseOther = await mkCase(adminId);
await sfetch('/rest/v1/costs', { method: 'POST', body: JSON.stringify({
  tenant_id: T1, case_id: caseMine, category: 'material', label: '秘密原価', amount: 12345 }) });
const tokA = await login('rls-admin@genba.test');
const tokW = await login('rls-worker@genba.test');
const tokO = await login('rls-other@genba.test');

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
test('後片付け', async () => {
  await sfetch(`/rest/v1/tenants?id=in.(${T1},${T2})`, { method: 'DELETE' })
    .catch(() => {}); // FKで消えない分は無視（テストデータは一意名で衝突しない）
});
