// 初期データ投入。再実行しても安全（既存メールはスキップ）
// 実行: cd app/backend && node seed.mjs
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL_ = env.SUPABASE_URL, SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SRK, authorization: `Bearer ${SRK}`, 'content-type': 'application/json' };

async function api(path, opt = {}) {
  const r = await fetch(`${URL_}${path}`, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const rest = (path, opt = {}) => api(`/rest/v1${path}`, opt);

async function ensureUser(email, name) {
  const found = await api(`/auth/v1/admin/users?page=1&per_page=100`);
  const hit = (found.users || []).find(u => u.email === email);
  if (hit) { console.log(`既存: ${email}`); return { id: hit.id, pw: '(変更なし)' }; }
  const pw = crypto.randomBytes(6).toString('base64url');
  const u = await api('/auth/v1/admin/users', { method: 'POST',
    body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { name } }) });
  console.log(`作成: ${email} / パスワード: ${pw}`);
  return { id: u.id, pw };
}

async function ensureTenant(name) {
  const hit = await rest(`/tenants?name=eq.${encodeURIComponent(name)}&select=id`);
  if (hit.length) return hit[0].id;
  const t = await rest('/tenants', { method: 'POST', headers: { prefer: 'return=representation' },
    body: JSON.stringify({ name }) });
  return t[0].id;
}

async function ensureProfile(userId, tenantId, name, role) {
  await rest('/profiles', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: userId, tenant_id: tenantId, display_name: name, role }) });
}

const t1 = await ensureTenant('現場管理（自社）');
const t2 = await ensureTenant('RLSテスト他社');
const admin  = await ensureUser('admin@genba.test', '監督');
const minami = await ensureUser('minami@genba.test', '南');
const tanaka = await ensureUser('tanaka@genba.test', '田中');
const other  = await ensureUser('other@genba.test', '他社管理者');
await ensureProfile(admin.id,  t1, '監督', 'admin');
await ensureProfile(minami.id, t1, '南',   'worker');
await ensureProfile(tanaka.id, t1, '田中', 'worker');
await ensureProfile(other.id,  t2, '他社管理者', 'admin');

const cs = await rest(`/cases?tenant_id=eq.${t1}&select=id`);
if (!cs.length) {
  const today = new Date(); today.setHours(10, 0, 0, 0);
  await rest('/cases', { method: 'POST', body: JSON.stringify({
    tenant_id: t1, case_no: 'S1-001', property_name: 'パレス目黒東', room_no: '502',
    address: '東京都目黒区中目黒1-2-3', scheduled_at: today.toISOString(),
    work_type: '漏水調査', instructions: '上階605の床下点検口から確認。管理人在中9-17時。',
    assigned_to: minami.id, created_by: admin.id }) });
  console.log('サンプル案件を作成（担当: 南・今日10:00）');
}
console.log('seed 完了');
