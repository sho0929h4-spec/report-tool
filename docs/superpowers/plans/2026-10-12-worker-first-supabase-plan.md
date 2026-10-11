# 作業者ファースト実装（計画2・スライス1）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UIプロトタイプ（app/）を Supabase+R2 の本物のバックエンドにつなぎ、作業担当者がスマホで「今日の現場→打刻→撮影→漏水調査報告→送信」まで実運用できるようにする。

**Architecture:** 画面は window.Store の窓口だけを使う設計（計画1で確立済み）。本計画では `app/shared/store.js` の中身を supabase-js 実装に差し替え、画面側の変更は最小限（認証起動・写真のFile渡し・報告フォームの区分対応）に留める。バックエンドは新規 Supabase プロジェクト（CLI作業は `app/backend/` 配下。repo 直下の既存 supabase/ には一切触れない）＋ Cloudflare R2。

**Tech Stack:** Supabase (Auth/Postgres/RLS/Edge Functions/pg_cron), Cloudflare R2 (S3互換・aws4fetch署名), supabase-js v2 (CDN), 素のHTML/JS（ビルドなし）, node --test

**Spec:** `docs/superpowers/specs/2026-10-12-worker-first-supabase-design.md`（親: `2026-10-11-case-management-saas-design.md`）

## Global Constraints

- root `index.html`・`public/`・`worker/`・repo直下 `supabase/`（migrations 001〜024含む）は**一切変更しない**
- 新コードは `app/` 配下のみ（バックエンド関連は `app/backend/`）
- コミットは `feat(app): ...` / `test(app): ...` / `chore(app): ...`。**rootの未コミット変更（6月の別作業）は絶対に git add しない**（ファイル名指定でaddする）
- 鍵類（DBパスワード・service_role・R2鍵）は `app/backend/.env` のみ。**コミット禁止**（gitignore必須）。anonキーは公開前提なので config.js にコミットしてよい
- UI文言は日本語。既存の `app/shared/style.css` のデザインを踏襲
- 既存テスト `node --test tests/calc.test.js`（12件）を常にグリーンに保つ（`node --test tests/` はNode24で動かない。ファイル直指定すること）
- DB の work_type は日本語4値: `漏水調査` `原状回復` `復旧工事` `設備等原因工事`
- Supabase 新プロジェクトの org: `bagituyehozynbtqryeo`、リージョン: 東京（ap-northeast-1）
- 作業は隔離ワークツリーで行う（superpowers:using-git-worktrees）。ただし Supabase/Cloudflare への CLI 操作はクラウド側に即反映される点に注意

## ファイル構成

```
app/
├ backend/                     ← 新規（バックエンド一式）
│ ├ .env                       ← 鍵類（gitignore対象・コミットしない）
│ ├ seed.mjs                   ← 初期アカウント・テナント投入スクリプト
│ ├ tests/rls.test.mjs         ← RLS越境テスト（node --test・実APIを叩く）
│ └ supabase/                  ← supabase init で生成（app/backend で実行）
│   ├ migrations/001_init.sql  ← 全スキーマ＋RLS＋トリガー
│   ├ migrations/002_cron.sql  ← pg_cron キープアライブ
│   └ functions/sign-photo/index.ts ← R2署名URL発行
├ shared/
│ ├ config.js                  ← SUPABASE_URL / ANON_KEY を追記
│ └ store.js                   ← 中身を全面差し替え（モック→supabase-js）
├ login.html                   ← 新規（メール+PWログイン）
├ new-case.html                ← 新規（管理者の最小案件登録フォーム）
├ report.html                  ← 区分4ボタン＋漏水調査フォーマット改修
├ case.html / index.html / list.html / settings.html ← 小改修（認証・写真・打刻検証）
```

**実行順序: Task 1→2→3→4→5→6→7→8→9→10（依存順。並列不可）**

---

### Task 1: Supabase 新プロジェクト作成＋backend足場

**Files:**
- Create: `app/backend/.env`（コミットしない）
- Create: `app/backend/supabase/`（supabase init）
- Modify: `.gitignore`（repo直下。既存内容に追記のみ）

**Interfaces:**
- Produces: `.env` のキー `SUPABASE_PROJECT_REF` / `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_PASSWORD`（後続タスク全てが参照）

- [ ] **Step 1: gitignore 追記**

`.gitignore` の末尾に追記（既存行は変更しない）:

```
# app/backend 秘匿情報
app/backend/.env
app/backend/supabase/.temp/
```

- [ ] **Step 2: プロジェクト作成**

```bash
cd "app/backend"
DB_PASS=$(openssl rand -hex 16)
supabase projects create genba-app --org-id bagituyehozynbtqryeo --region ap-northeast-1 --db-password "$DB_PASS"
```

出力の `REFERENCE ID`（例: abcdefghijklmnop）を控える。

- [ ] **Step 3: APIキー取得・.env 作成**

```bash
supabase projects api-keys --project-ref <REF>
```

`app/backend/.env` を作成:

```
SUPABASE_PROJECT_REF=<REF>
SUPABASE_URL=https://<REF>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SUPABASE_DB_PASSWORD=<DB_PASS>
```

- [ ] **Step 4: init＋link**

```bash
cd "app/backend" && supabase init
supabase link --project-ref <REF> --password "$DB_PASS"
```

※ cwd が app/backend なので repo 直下の既存リンク（zalgyrgjwjdgvklqhdrg）には影響しない。プロジェクト作成直後は provisioning 中で link が失敗することがある → 1〜2分待って再試行。

- [ ] **Step 5: 検証**

```bash
cd "app/backend" && supabase projects list | grep genba-app
```

Expected: genba-app の行に LINKED マーク（●）。

- [ ] **Step 6: Commit**

```bash
git add .gitignore app/backend/supabase/config.toml
git commit -m "chore(app): Supabase新プロジェクト genba-app の足場（backend/）"
```

---

### Task 2: スキーマ＋RLS＋ワーカー制限トリガー（migration 001）

**Files:**
- Create: `app/backend/supabase/migrations/001_init.sql`

**Interfaces:**
- Produces: テーブル `tenants / profiles / cases / photos / costs / worker_rates`、関数 `my_tenant() / my_role()`、トリガー `guard_case_update`。後続の seed・Store・Edge Function 全てが依存

- [ ] **Step 1: migration ファイル作成**

`app/backend/supabase/migrations/001_init.sql`:

```sql
-- ========== テーブル ==========
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  retention_months int not null default 36,
  default_hourly_rate numeric default 3000,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table profiles (
  user_id uuid primary key references auth.users on delete cascade,
  tenant_id uuid not null references tenants,
  display_name text not null,
  role text not null check (role in ('admin','worker')),
  created_at timestamptz not null default now()
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants,
  case_no text,
  property_name text not null,
  room_no text,
  address text,
  scheduled_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled','in_progress','submitted','confirmed')),
  work_type text not null default '漏水調査'
    check (work_type in ('漏水調査','原状回復','復旧工事','設備等原因工事')),
  due_date date,
  instructions text,
  tasks jsonb not null default '[]',
  cause text,
  next_actions text,
  assigned_to uuid references profiles,
  created_by uuid references profiles,
  work_started_at timestamptz,
  work_ended_at timestamptz,
  invoice_amount numeric,
  report jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cases_tenant_sched on cases (tenant_id, scheduled_at desc);

create table photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants,
  case_id uuid not null references cases on delete cascade,
  phase text,
  check_item text,           -- 撮影チェックリスト項目: zenkei/kinkei/sokutei/after/null
  caption text,
  sort_order int not null default 0,
  object_key text not null,
  thumb_key text,
  size_bytes int,
  created_at timestamptz not null default now()
);
create index photos_case on photos (case_id, sort_order);

create table costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants,
  case_id uuid not null references cases on delete cascade,
  category text not null check (category in ('labor','material','subcontract','other')),
  label text,
  qty numeric,
  unit_price numeric,
  amount numeric,
  is_auto boolean not null default false,
  created_by uuid references profiles,
  created_at timestamptz not null default now()
);

create table worker_rates (
  user_id uuid primary key references profiles,
  tenant_id uuid not null references tenants,
  hourly_rate numeric
);

-- ========== ヘルパー（RLS用。security definer で profiles 参照） ==========
create function my_tenant() returns uuid
language sql stable security definer set search_path = public as
$$ select tenant_id from profiles where user_id = auth.uid() $$;

create function my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where user_id = auth.uid() $$;

-- ========== RLS ==========
alter table tenants enable row level security;
alter table profiles enable row level security;
alter table cases enable row level security;
alter table photos enable row level security;
alter table costs enable row level security;
alter table worker_rates enable row level security;

create policy t_sel on tenants for select using (id = my_tenant());
create policy t_upd on tenants for update using (id = my_tenant() and my_role() = 'admin');

create policy p_sel on profiles for select using (tenant_id = my_tenant());

create policy c_sel on cases for select using (tenant_id = my_tenant());
create policy c_ins on cases for insert
  with check (tenant_id = my_tenant() and my_role() = 'admin');
create policy c_upd on cases for update
  using (tenant_id = my_tenant() and (my_role() = 'admin' or assigned_to = auth.uid()));
create policy c_del on cases for delete
  using (tenant_id = my_tenant() and my_role() = 'admin');

create policy ph_sel on photos for select using (tenant_id = my_tenant());
create policy ph_ins on photos for insert with check (
  tenant_id = my_tenant() and exists (
    select 1 from cases c where c.id = case_id and c.tenant_id = my_tenant()
      and (my_role() = 'admin' or c.assigned_to = auth.uid())));
create policy ph_del on photos for delete using (
  tenant_id = my_tenant() and exists (
    select 1 from cases c where c.id = case_id
      and (my_role() = 'admin' or c.assigned_to = auth.uid())));

-- 原価・単価は admin のみ（worker には一切見せない）
create policy k_all on costs for all
  using (tenant_id = my_tenant() and my_role() = 'admin')
  with check (tenant_id = my_tenant() and my_role() = 'admin');
create policy wr_all on worker_rates for all
  using (tenant_id = my_tenant() and my_role() = 'admin')
  with check (tenant_id = my_tenant() and my_role() = 'admin');

-- ========== worker 制限トリガー ==========
-- worker は: confirmed にできない / 担当・指示・請求額・予定・区分の書換不可 /
-- 遷移は scheduled→in_progress→submitted のみ
create function guard_case_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if my_role() is distinct from 'admin' then
    if new.status = 'confirmed' then
      raise exception 'worker cannot confirm';
    end if;
    if new.status is distinct from old.status then
      if not ( (old.status = 'scheduled'   and new.status = 'in_progress')
            or (old.status = 'in_progress' and new.status = 'submitted') ) then
        raise exception 'invalid status transition for worker: % -> %', old.status, new.status;
      end if;
    end if;
    if new.assigned_to    is distinct from old.assigned_to
    or new.instructions   is distinct from old.instructions
    or new.invoice_amount is distinct from old.invoice_amount
    or new.scheduled_at   is distinct from old.scheduled_at
    or new.due_date       is distinct from old.due_date then
      raise exception 'worker cannot modify admin-only fields';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger trg_guard_case_update before update on cases
  for each row execute function guard_case_update();
```

- [ ] **Step 2: push**

```bash
cd "app/backend" && supabase db push
```

Expected: `Applying migration 001_init.sql... Finished supabase db push.`

- [ ] **Step 3: スキーマ確認**

```bash
cd "app/backend" && supabase migration list
```

Expected: 001 が Local/Remote 両方に並ぶ。

- [ ] **Step 4: Commit**

```bash
git add app/backend/supabase/migrations/001_init.sql
git commit -m "feat(app): スキーマ＋RLS＋worker制限トリガー（migration 001）"
```

---

### Task 3: 初期アカウント投入スクリプト（seed.mjs）

**Files:**
- Create: `app/backend/seed.mjs`

**Interfaces:**
- Consumes: `.env`（Task 1）、スキーマ（Task 2）
- Produces: テナント2つと4ユーザー。メール/パスワードは実行時にコンソール出力
  - 自社テナント「現場管理（自社）」: `admin@genba.test`(admin・監督) / `minami@genba.test`(worker・南) / `tanaka@genba.test`(worker・田中)
  - 他社テナント「RLSテスト他社」: `other@genba.test`(admin) ※越境テスト専用
  - サンプル案件1件（南 担当・今日の日付・漏水調査）

- [ ] **Step 1: seed.mjs 作成**

`app/backend/seed.mjs`（依存パッケージなし。fetch 直叩き）:

```js
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
```

- [ ] **Step 2: 実行**

```bash
cd "app/backend" && node seed.mjs
```

Expected: 4ユーザーのパスワードが表示され「seed 完了」。**表示されたパスワードを控えてユーザーに渡す。**

- [ ] **Step 3: 再実行して冪等性確認**

```bash
cd "app/backend" && node seed.mjs
```

Expected: 全行「既存: ...」でエラーなし。

- [ ] **Step 4: Commit**

```bash
git add app/backend/seed.mjs
git commit -m "feat(app): 初期テナント・アカウント投入スクリプト"
```

---

### Task 4: RLS 越境テスト（実APIを叩く自動テスト）

**Files:**
- Create: `app/backend/tests/rls.test.mjs`

**Interfaces:**
- Consumes: seed 済みの4ユーザー。**パスワードが必要**なため、テストは専用ユーザーを service_role で毎回作り直す方式にする（seed のパスワードに依存しない）

- [ ] **Step 1: テスト作成**

`app/backend/tests/rls.test.mjs`:

```js
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
```

- [ ] **Step 2: 実行**

```bash
cd "app/backend" && node --test tests/rls.test.mjs
```

Expected: 全テスト pass。**fail した場合は 001_init.sql のポリシー/トリガーを修正して `supabase db push` からやり直す（勝手にRLSを緩めない）。**

- [ ] **Step 3: 既存テストも確認**

```bash
node --test tests/calc.test.js
```

Expected: 12 pass。

- [ ] **Step 4: Commit**

```bash
git add app/backend/tests/rls.test.mjs
git commit -m "test(app): RLS越境・worker権限の実APIテスト"
```

---

### Task 5: 認証フロント（config.js・login.html・CDN読込）

**Files:**
- Modify: `app/shared/config.js`
- Create: `app/login.html`
- Modify: `app/index.html` `app/list.html` `app/case.html` `app/settings.html` `app/report.html`（scriptタグのみ）

**Interfaces:**
- Produces: `CONFIG.SUPABASE_URL` / `CONFIG.SUPABASE_ANON_KEY`、ページ共通の supabase-js グローバル `window.supabase`。Task 6 の store.js が依存
- 注意: anon キーは公開前提の鍵なのでコミットしてよい（RLSが防御壁）

- [ ] **Step 1: config.js を書き換え**

```js
// app/shared/config.js — 設定値はここに一元化（Capacitor化対応のため分散禁止）
window.CONFIG = {
  appName: '現場管理',
  version: '0.3.0',
  SUPABASE_URL: 'https://<REF>.supabase.co',        // Task 1 の値
  SUPABASE_ANON_KEY: '<anon key>',                   // Task 1 の値
};
```

- [ ] **Step 2: 各ページに supabase-js CDN を追加**

まず現状の script 読込を確認:

```bash
grep -n "shared/.*\.js" app/*.html
```

5ページ（index/list/case/settings/report）それぞれで、`shared/config.js` の **直前** に1行追加し、`shared/mock-data.js` の行を**削除**する:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

（mock-data.js ファイル自体は残す。読み込みだけ外す）

- [ ] **Step 3: login.html 作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>ログイン | 現場管理</title>
<link rel="stylesheet" href="shared/style.css">
<meta name="theme-color" content="#16304d">
</head>
<body>
<div style="max-width:480px;margin:0 auto;padding:48px 20px;">
  <div style="text-align:center;margin-bottom:28px;">
    <div style="font-size:22px;font-weight:800;color:#16304d;">現場管理</div>
    <div style="font-size:13px;color:#667;margin-top:4px;">メールアドレスでログイン</div>
  </div>
  <div class="card" style="padding:20px;display:flex;flex-direction:column;gap:14px;">
    <input id="email" type="email" autocomplete="username" placeholder="メールアドレス"
      style="padding:12px;border:1.5px solid #d6dbe4;border-radius:10px;font-size:16px;">
    <input id="pw" type="password" autocomplete="current-password" placeholder="パスワード"
      style="padding:12px;border:1.5px solid #d6dbe4;border-radius:10px;font-size:16px;">
    <div id="err" style="display:none;color:#c0392b;font-size:13px;"></div>
    <button id="go" style="padding:14px;border:none;border-radius:10px;background:#16304d;color:#fff;
      font-size:16px;font-weight:700;cursor:pointer;">ログイン</button>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="shared/config.js"></script>
<script>
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
sb.auth.getSession().then(({ data: { session } }) => { if (session) location.href = 'index.html'; });
async function doLogin() {
  const btn = document.getElementById('go'); btn.disabled = true; btn.textContent = '確認中…';
  const { error } = await sb.auth.signInWithPassword({
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('pw').value });
  if (error) {
    const e = document.getElementById('err');
    e.style.display = 'block'; e.textContent = 'メールアドレスかパスワードが正しくありません';
    btn.disabled = false; btn.textContent = 'ログイン'; return;
  }
  location.href = 'index.html';
}
document.getElementById('go').onclick = doLogin;
document.getElementById('pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
</script>
</body>
</html>
```

- [ ] **Step 4: 検証（ログイン画面のみ）**

開発サーバー（ワークツリー直下で）: `python3 -m http.server 8090 --directory <ワークツリー> &`
ブラウザで `http://localhost:8090/app/login.html`:
- 誤パスワード → 赤エラー表示
- seed の admin@genba.test + 控えたパスワード → index.html に遷移（この時点では index はモック表示のままで良い）

- [ ] **Step 5: Commit**

```bash
git add app/shared/config.js app/login.html app/index.html app/list.html app/case.html app/settings.html app/report.html
git commit -m "feat(app): Supabase認証（config・ログイン画面・CDN読込）"
```

---

### Task 6: store.js を Supabase 実装に全面差し替え

**Files:**
- Modify: `app/shared/store.js`（中身を下記で全置換）

**Interfaces:**
- Consumes: `CONFIG.SUPABASE_URL/ANON_KEY`、`window.supabase`（Task 5）
- Produces: 画面が使う既存シグネチャを**全て維持**: `session() / listCases / getToday / listStalledTasks / getCase / saveCase / updateStatus / toggleTask / saveTask / listPhotos / addPhoto / deletePhoto / saveReport`＋スタブ群（costs/rates/contacts/estimate/questions）。新規: `init() / login後のlogout() / listMembers()`
- 写真メソッドはこのタスクでは一時スタブ（Task 8 で本実装）

- [ ] **Step 1: store.js 全置換**

```js
// app/shared/store.js — データ窓口（Supabase実装）。画面はこの窓口だけを使う。
(function () {
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  let SES = null;
  const isLogin = /login\.html$/.test(location.pathname);
  const ready = (async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { if (!isLogin) location.replace('login.html'); return false; }
    const { data: p, error } = await sb.from('profiles').select('*')
      .eq('user_id', session.user.id).single();
    if (error || !p) { await sb.auth.signOut(); location.replace('login.html'); return false; }
    SES = { userId: p.user_id, name: p.display_name, role: p.role, tenantId: p.tenant_id };
    return true;
  })();

  const SEL = '*, assignee:profiles!cases_assigned_to_fkey(display_name)';
  const toCase = r => r && ({
    id: r.id, caseNo: r.case_no || '', propertyName: r.property_name, roomNo: r.room_no || '',
    address: r.address || '', scheduledAt: r.scheduled_at, status: r.status, workType: r.work_type,
    dueDate: r.due_date, instructions: r.instructions || '', tasks: r.tasks || [],
    cause: r.cause || '', nextActions: r.next_actions || '',
    assignedTo: r.assigned_to, assignedName: (r.assignee && r.assignee.display_name) || '',
    workStartedAt: r.work_started_at, workEndedAt: r.work_ended_at,
    invoiceAmount: r.invoice_amount, report: r.report, createdAt: r.created_at,
    contacts: [], estimate: null, questions: [],
  });
  const fromCase = o => {
    const m = { caseNo: 'case_no', propertyName: 'property_name', roomNo: 'room_no', address: 'address',
      scheduledAt: 'scheduled_at', status: 'status', workType: 'work_type', dueDate: 'due_date',
      instructions: 'instructions', tasks: 'tasks', cause: 'cause', nextActions: 'next_actions',
      assignedTo: 'assigned_to', workStartedAt: 'work_started_at', workEndedAt: 'work_ended_at',
      invoiceAmount: 'invoice_amount', report: 'report' };
    const out = {};
    for (const k of Object.keys(o)) if (m[k] && o[k] !== undefined) out[m[k]] = o[k];
    return out;
  };
  const isToday = iso => iso && new Date(iso).toDateString() === new Date().toDateString();
  const todayYmd = () => new Date().toISOString().slice(0, 10);
  const die = e => { throw new Error(e.message || String(e)); };

  window.Store = {
    init() { return ready; },
    session() { return SES; },
    async logout() { await sb.auth.signOut(); location.replace('login.html'); },
    // 互換スタブ（モック時代のAPI。実機能なし）
    setRole() {}, resetMock() {},

    async listMembers() {
      await ready;
      const { data, error } = await sb.from('profiles').select('user_id, display_name, role');
      if (error) die(error);
      return data.map(p => ({ userId: p.user_id, name: p.display_name, role: p.role }));
    },
    async listCases() {
      await ready;
      let q = sb.from('cases').select(SEL).order('scheduled_at', { ascending: false, nullsFirst: false });
      if (SES.role === 'worker') q = q.eq('assigned_to', SES.userId);
      const { data, error } = await q;
      if (error) die(error);
      return data.map(toCase);
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
        awaiting: SES.role === 'admin' ? all.filter(c => c.status === 'submitted') : [],
      };
    },
    async listStalledTasks(thresholdH) {
      const th = thresholdH ?? 24;
      const now = new Date().toISOString();
      const out = [];
      for (const c of await this.listCases()) {
        for (const t of (c.tasks || [])) {
          if (t.status === 'done') continue;
          const stall = Calc.stallHours(t.updatedAt, now);
          const over = Calc.isOverdue(t.dueAt, now, t.status);
          if ((stall != null && stall >= th) || over) {
            out.push({ ...t, caseId: c.id, propertyName: c.propertyName, roomNo: c.roomNo,
              stallH: stall, overdue: over });
          }
        }
      }
      return out.sort((a, b) => (b.stallH || 0) - (a.stallH || 0));
    },
    async getCase(id) {
      await ready;
      const { data, error } = await sb.from('cases').select(SEL).eq('id', id).maybeSingle();
      if (error) die(error);
      return toCase(data);
    },
    async saveCase(obj) {
      await ready;
      if (obj.id) {
        const { data, error } = await sb.from('cases').update(fromCase(obj))
          .eq('id', obj.id).select(SEL).single();
        if (error) die(error);
        return toCase(data);
      }
      const row = { tenant_id: SES.tenantId, created_by: SES.userId, ...fromCase(obj) };
      const { data, error } = await sb.from('cases').insert(row).select(SEL).single();
      if (error) die(error);
      return toCase(data);
    },
    async updateStatus(id, status) {
      const c = await this.getCase(id); if (!c) return null;
      const patch = { status };
      if (status === 'in_progress' && !c.workStartedAt) patch.workStartedAt = new Date().toISOString();
      if (status === 'submitted' && !c.workEndedAt) patch.workEndedAt = new Date().toISOString();
      return this.saveCase({ id, ...patch });
    },
    async toggleTask(id, index) {
      const c = await this.getCase(id); if (!c || !c.tasks[index]) return null;
      const t = c.tasks[index];
      t.status = t.status === 'done' ? 'todo' : 'done';
      t.updatedAt = new Date().toISOString();
      return this.saveCase({ id, tasks: c.tasks });
    },
    async saveTask(caseId, task) {
      const c = await this.getCase(caseId); if (!c) return null;
      const tasks = c.tasks || [];
      if (task.id) {
        const i = tasks.findIndex(x => x.id === task.id);
        tasks[i] = { ...tasks[i], ...task, updatedAt: new Date().toISOString() };
      } else {
        task.id = 't' + Math.random().toString(36).slice(2, 9);
        task.updatedAt = new Date().toISOString(); tasks.push(task);
      }
      await this.saveCase({ id: caseId, tasks });
      return task;
    },
    async saveReport(caseId, report) {
      return this.saveCase({ id: caseId, report });
    },

    // ---- 写真（Task 8 で本実装。ここでは空動作） ----
    async listPhotos() { return []; },
    async addPhoto() { throw new Error('写真アップロードは未実装（Task 8）'); },
    async deletePhoto() {},

    // ---- 後続スライス（原価・連絡・見積・AI質問）: 空スタブ ----
    async listCosts() { return []; },
    async saveCost() { return null; },
    async deleteCost() {},
    async rates() { return { defaultRate: null, byUser: {} }; },
    async saveRates() {},
    async listContacts() { return []; },
    async saveContact() { return null; },
    async deleteContact() {},
    async getEstimate() { return null; },
    async saveEstimate() { return null; },
    async listQuestions() { return []; },
    async addQuestion() { return null; },
    async listEscalated() { return []; },
    async answerQuestion() { return null; },
  };
})();
```

- [ ] **Step 2: session() の同期呼び出し監査**

```bash
grep -n "Store.session()" app/*.html
```

各呼び出し箇所が「`await Store.〜` の後」で実行されているか確認する。ページ読み込み直後に同期で呼んでいる箇所があれば、その関数の先頭に `await Store.init();` を1行足す（関数が async でなければ async 化）。

- [ ] **Step 3: 動作検証（ブラウザ）**

`http://localhost:8090/app/` で:
- 未ログイン → login.html へ自動遷移すること
- minami@genba.test でログイン → 「今日」にサンプル案件（パレス目黒東 502・10:00）が出る。他の案件が無いこと
- admin@genba.test → 全件表示＋承認待ちセクションが出る
- 案件詳細 → タスク追加・チェック → リロードしても残る（DB保存の確認）
- [作業開始] → ステータスが対応中に変わる
- コンソールにエラーが無いこと

- [ ] **Step 4: 回帰テスト**

```bash
node --test tests/calc.test.js && cd "app/backend" && node --test tests/rls.test.mjs
```

Expected: 全部 pass。

- [ ] **Step 5: Commit**

```bash
git add app/shared/store.js app/index.html app/list.html app/case.html app/settings.html app/report.html
git commit -m "feat(app): Storeをモック→Supabase実装に差し替え（案件・タスク・打刻・報告が実DB化）"
```

---

### Task 7: 管理者の最小案件登録フォーム new-case.html

**Files:**
- Create: `app/new-case.html`
- Modify: `app/index.html` `app/list.html`（FABのリンク先）

**Interfaces:**
- Consumes: `Store.saveCase / Store.listMembers / Store.session`（Task 6）
- Produces: 登録→ `case.html?id=<新ID>` へ遷移。作業者の「今日」ホームに即反映

- [ ] **Step 1: new-case.html 作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>新規案件 | 現場管理</title>
<link rel="stylesheet" href="shared/style.css">
<meta name="theme-color" content="#16304d">
</head>
<body>
<div class="app">
  <header class="appbar"><a href="list.html" style="color:#fff;text-decoration:none;">←</a>
    <span style="font-weight:700;">新規案件</span></header>
  <main style="padding:14px;display:flex;flex-direction:column;gap:14px;">
    <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px;">
      <label class="fld">物件名 <span style="color:#c0392b;font-size:11px;">必須</span>
        <input id="f-prop" placeholder="〇〇マンション"></label>
      <label class="fld">号室 <input id="f-room" placeholder="502"></label>
      <label class="fld">住所 <input id="f-addr" placeholder="東京都〇〇区…"></label>
      <label class="fld">対応日時 <input id="f-when" type="datetime-local"></label>
      <div class="fld">区分
        <div id="wt-btns" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;"></div>
      </div>
      <label class="fld">担当者 <select id="f-assignee"></select></label>
      <label class="fld">現地対応指示 <textarea id="f-inst" rows="3"
        placeholder="入室方法・注意事項・確認してほしい箇所など"></textarea></label>
    </div>
    <button id="btn-save" style="padding:15px;border:none;border-radius:12px;background:#16304d;
      color:#fff;font-size:16px;font-weight:700;">登録する</button>
  </main>
</div>
<style>
.fld{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:700;color:#334;}
.fld input,.fld select,.fld textarea{padding:11px;border:1.5px solid #d6dbe4;border-radius:10px;
  font-size:16px;font-family:inherit;font-weight:400;}
.wt-btn{padding:12px 4px;border:1.5px solid #d6dbe4;border-radius:10px;background:#fff;
  font-size:14px;font-weight:700;color:#334;cursor:pointer;}
.wt-btn.on{border-color:#16304d;background:#16304d;color:#fff;}
</style>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="shared/config.js"></script>
<script src="shared/calc.js"></script>
<script src="shared/store.js"></script>
<script src="shared/ui.js"></script>
<script>
const WTYPES = ['漏水調査', '原状回復', '復旧工事', '設備等原因工事'];
let workType = WTYPES[0];
(async () => {
  if (!(await Store.init())) return;
  if (Store.session().role !== 'admin') { location.replace('index.html'); return; }
  const wrap = document.getElementById('wt-btns');
  wrap.innerHTML = WTYPES.map(w =>
    `<button type="button" class="wt-btn${w === workType ? ' on' : ''}" data-w="${w}">${w}</button>`).join('');
  wrap.onclick = e => {
    const b = e.target.closest('.wt-btn'); if (!b) return;
    workType = b.dataset.w;
    wrap.querySelectorAll('.wt-btn').forEach(x => x.classList.toggle('on', x.dataset.w === workType));
  };
  const members = await Store.listMembers();
  document.getElementById('f-assignee').innerHTML =
    '<option value="">— 未定 —</option>' +
    members.map(m => `<option value="${m.userId}">${m.name}（${m.role === 'admin' ? '管理' : '作業'}）</option>`).join('');
  document.getElementById('btn-save').onclick = async () => {
    const prop = document.getElementById('f-prop').value.trim();
    if (!prop) { UI.toast('物件名を入力してください'); return; }
    const when = document.getElementById('f-when').value;
    const c = await Store.saveCase({
      propertyName: prop,
      roomNo: document.getElementById('f-room').value.trim(),
      address: document.getElementById('f-addr').value.trim(),
      scheduledAt: when ? new Date(when).toISOString() : null,
      workType,
      assignedTo: document.getElementById('f-assignee').value || null,
      instructions: document.getElementById('f-inst').value.trim(),
    });
    UI.toast('登録しました');
    setTimeout(() => location.href = `case.html?id=${c.id}`, 500);
  };
})();
</script>
</body>
</html>
```

※ `.appbar` 等のクラスが style.css に無い場合は近い既存クラスに合わせる（Step 2 で実物を確認して調整）。

- [ ] **Step 2: FAB のリンク先を設定**

```bash
grep -n "fab\|FAB\|＋" app/index.html app/list.html
```

admin のみ表示される既存 FAB の遷移先を `new-case.html` にする（FABが無ければ list.html に追加: `<a class="fab" href="new-case.html">＋</a>`、worker ロール時は非表示）。

- [ ] **Step 3: 検証**

- admin でログイン → FAB → フォーム入力（担当: 田中）→ 登録 → case.html に遷移
- tanaka@genba.test でログイン → 「今日」/一覧に新案件が見える（対応日時を今日にした場合）
- minami には見えないこと
- worker で new-case.html を直接開く → index.html に弾かれること

- [ ] **Step 4: Commit**

```bash
git add app/new-case.html app/index.html app/list.html
git commit -m "feat(app): 管理者の最小案件登録フォーム（作業者への自動引き継ぎ）"
```

---

### Task 8: R2 バケット＋sign-photo Edge Function＋写真アップロード本実装

**Files:**
- Create: `app/backend/supabase/functions/sign-photo/index.ts`
- Modify: `app/shared/store.js`（写真3メソッドのスタブを本実装に置換）
- Modify: `app/case.html`（写真タブ: dataUrl渡し→File渡し）

**Interfaces:**
- Consumes: `.env` に R2 の鍵4つを追加（下記 Step 1-2）
- Produces: `Store.addPhoto(caseId, {file, phase, checkItem, caption})` / `Store.listPhotos(caseId)`（署名URL付き）/ `Store.photoUrl(caseId, objectKey)`（原寸表示用）。Task 9 の報告フォームが依存

- [ ] **Step 1: 【ユーザー作業】Cloudflare ログイン＋R2 APIトークン**

ユーザーに依頼（ここで一時停止）:
1. ターミナルで `npx wrangler@latest login` → ブラウザで承認
2. Cloudflare ダッシュボード → R2 → 「R2 API トークンの管理」→ トークン作成（権限: オブジェクト読み取りと書き込み）→ **アクセスキーID / シークレットアクセスキー / アカウントID** の3つを受け取る

- [ ] **Step 2: バケット作成＋CORS＋.env追記**

```bash
npx wrangler@latest r2 bucket create genba-photos
cat > /tmp/r2-cors.json <<'EOF'
[{ "AllowedOrigins": ["*"], "AllowedMethods": ["GET", "PUT"],
   "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
EOF
npx wrangler@latest r2 bucket cors set genba-photos --file /tmp/r2-cors.json
```

`app/backend/.env` に追記:

```
R2_ACCOUNT_ID=<アカウントID>
R2_ACCESS_KEY_ID=<アクセスキーID>
R2_SECRET_ACCESS_KEY=<シークレット>
R2_BUCKET=genba-photos
```

- [ ] **Step 3: Edge Function 作成**

`app/backend/supabase/functions/sign-photo/index.ts`:

```ts
// R2 署名URL発行。JWT→本人確認→担当/テナント確認→presigned URL（期限10分）
import { AwsClient } from "npm:aws4fetch@1.0.20";

const SUPA = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ACC = Deno.env.get("R2_ACCOUNT_ID")!;
const BUCKET = Deno.env.get("R2_BUCKET")!;
const r2 = new AwsClient({
  accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
  secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  service: "s3", region: "auto",
});
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const auth = req.headers.get("authorization") ?? "";
  const ur = await fetch(`${SUPA}/auth/v1/user`, { headers: { apikey: ANON, authorization: auth } });
  if (!ur.ok) return json({ error: "unauthorized" }, 401);
  const user = await ur.json();

  const { caseId, keys } = await req.json() as
    { caseId: string; keys: { key: string; method: "PUT" | "GET" }[] };
  if (!caseId || !Array.isArray(keys) || keys.length === 0 || keys.length > 120)
    return json({ error: "bad request" }, 400);

  const sH = { apikey: SRK, authorization: `Bearer ${SRK}` };
  const prof = await (await fetch(
    `${SUPA}/rest/v1/profiles?user_id=eq.${user.id}&select=tenant_id,role`, { headers: sH })).json();
  const kase = await (await fetch(
    `${SUPA}/rest/v1/cases?id=eq.${caseId}&select=tenant_id,assigned_to`, { headers: sH })).json();
  if (!prof[0] || !kase[0] || kase[0].tenant_id !== prof[0].tenant_id)
    return json({ error: "forbidden" }, 403);
  if (prof[0].role !== "admin" && kase[0].assigned_to !== user.id)
    return json({ error: "forbidden" }, 403);

  const prefix = `${prof[0].tenant_id}/${caseId}/`;
  const out: { key: string; url: string }[] = [];
  for (const k of keys) {
    if (!(k.key.startsWith(prefix) || k.key.startsWith(`thumb/${prefix}`)))
      return json({ error: `invalid key: ${k.key}` }, 400);
    const url = `https://${ACC}.r2.cloudflarestorage.com/${BUCKET}/${k.key}?X-Amz-Expires=600`;
    const signed = await r2.sign(new Request(url, { method: k.method }), { aws: { signQuery: true } });
    out.push({ key: k.key, url: signed.url });
  }
  return json({ keys: out });
});
```

- [ ] **Step 4: secrets 設定＋デプロイ**

```bash
cd "app/backend"
supabase secrets set R2_ACCOUNT_ID=<値> R2_ACCESS_KEY_ID=<値> R2_SECRET_ACCESS_KEY=<値> R2_BUCKET=genba-photos
supabase functions deploy sign-photo
```

- [ ] **Step 5: Function 単体検証（curl）**

```bash
# ログインしてトークン取得（minami）
TOK=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "content-type: application/json" \
  -d '{"email":"minami@genba.test","password":"<控えたPW>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
# 担当案件のIDで署名URL発行
curl -s "$SUPABASE_URL/functions/v1/sign-photo" -H "authorization: Bearer $TOK" \
  -H "content-type: application/json" \
  -d '{"caseId":"<南の担当案件ID>","keys":[{"key":"<tenant_id>/<caseId>/test.jpg","method":"PUT"}]}'
```

Expected: `{"keys":[{"key":"...","url":"https://...r2.cloudflarestorage.com/..."}]}`。
さらに **他人の案件ID**（田中担当）で同じリクエスト → `403 forbidden` を確認。

- [ ] **Step 6: store.js の写真3メソッドを本実装に置換**

スタブ（`// ---- 写真（Task 8 で本実装...`のブロック）を以下に置換:

```js
    // ---- 写真（R2 署名URL経由） ----
    async _sign(caseId, items) {
      const { data, error } = await sb.functions.invoke('sign-photo', { body: { caseId, keys: items } });
      if (error) die(error);
      return Object.fromEntries(data.keys.map(k => [k.key, k.url]));
    },
    async _compress(file, max, q) {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      return new Promise(r => cv.toBlob(r, 'image/jpeg', q));
    },
    async addPhoto(caseId, { file, phase, checkItem, caption }) {
      await ready;
      const main = await this._compress(file, 1600, 0.82);
      const thumb = await this._compress(file, 320, 0.7);
      const uid = crypto.randomUUID();
      const key = `${SES.tenantId}/${caseId}/${uid}.jpg`;
      const tkey = `thumb/${SES.tenantId}/${caseId}/${uid}.jpg`;
      const urls = await this._sign(caseId, [{ key, method: 'PUT' }, { key: tkey, method: 'PUT' }]);
      for (const [k, blob] of [[key, main], [tkey, thumb]]) {
        const r = await fetch(urls[k], { method: 'PUT', body: blob,
          headers: { 'content-type': 'image/jpeg' } });
        if (!r.ok) throw new Error(`アップロード失敗 (${r.status})`);
      }
      const { data, error } = await sb.from('photos').insert({
        tenant_id: SES.tenantId, case_id: caseId, phase: phase || 'before',
        check_item: checkItem || null, caption: caption || '',
        object_key: key, thumb_key: tkey, size_bytes: main.size,
      }).select('*').single();
      if (error) die(error);
      return { id: data.id, phase: data.phase, caption: data.caption,
        checkItem: data.check_item, dataUrl: URL.createObjectURL(thumb), objectKey: key };
    },
    async listPhotos(caseId) {
      await ready;
      const { data, error } = await sb.from('photos').select('*')
        .eq('case_id', caseId).order('sort_order').order('created_at');
      if (error) die(error);
      if (!data.length) return [];
      const urls = await this._sign(caseId,
        data.map(r => ({ key: r.thumb_key || r.object_key, method: 'GET' })));
      return data.map(r => ({ id: r.id, phase: r.phase, caption: r.caption || '',
        checkItem: r.check_item, dataUrl: urls[r.thumb_key || r.object_key], objectKey: r.object_key }));
    },
    async photoUrl(caseId, objectKey) {
      const urls = await this._sign(caseId, [{ key: objectKey, method: 'GET' }]);
      return urls[objectKey];
    },
    async deletePhoto(caseId, photoId) {
      await ready;
      const { error } = await sb.from('photos').delete().eq('id', photoId);
      if (error) die(error);
      // R2オブジェクトは残す（purge-expired が将来掃除する方針）
    },
```

- [ ] **Step 7: case.html 写真タブを File 渡しに変更**

```bash
grep -n "addPhoto\|FileReader\|file-input\|files" app/case.html
```

既存の「file input → FileReader → dataUrl → Store.addPhoto」の流れを、以下の形に置換（関数名・要素IDは実物に合わせる）:

```js
async function onPhotoFiles(files, phase) {
  for (const f of files) {
    try {
      UI.toast('アップロード中…');
      await Store.addPhoto(CASE_ID, { file: f, phase });
    } catch (e) { UI.toast('アップロード失敗。電波の良い場所で再試行してください'); }
  }
  await renderPhotoTab(); // 既存の写真一覧再描画関数を呼ぶ
}
```

- [ ] **Step 8: 検証**

- ブラウザ（8090）で admin → 案件 → 写真タブ → 画像追加 → サムネ表示
- リロード後も表示される（= R2＋DB保存の確認）
- `npx wrangler@latest r2 object list genba-photos | head` でオブジェクト存在確認（コマンドが無いCLIバージョンならダッシュボードで確認）
- `node --test tests/calc.test.js` → 12 pass

- [ ] **Step 9: Commit**

```bash
git add app/backend/supabase/functions/sign-photo/index.ts app/shared/store.js app/case.html
git commit -m "feat(app): 写真アップロード本実装（R2署名URL・端末内圧縮・サムネ）"
```

---

### Task 9: report.html 区分4ボタン＋漏水調査フォーマット＋送信

**Files:**
- Modify: `app/report.html`（既存の上書きレイヤー方式を踏襲。旧ツール由来の行は変更せず、末尾の `<script>` に追記）

**Interfaces:**
- Consumes: `Store.getCase / saveReport / updateStatus / addPhoto`（Task 6・8）
- Produces: `cases.report` に設計書 §4 の JSON を保存し、送信でステータス submitted＋終了打刻

- [ ] **Step 1: 現状の上書きレイヤーを確認**

```bash
grep -n "x-quick\|x-checklist\|runGenerate\|case=" app/report.html | head -30
```

既存: 選択式クイック入力（x-leakspot 等）・撮影チェックリスト（zenkei/kinkei/sokutei/after）・送信前ガード。これらは**残して活かす**。

- [ ] **Step 2: 区分4ボタン化**

末尾の上書き script に追記:

```js
/* 区分4ボタン: 旧 select（調査/作業報告）を隠し、4区分ボタンに置換 */
const WTYPES4 = ['漏水調査', '原状回復', '復旧工事', '設備等原因工事'];
WTYPES4.forEach(w => { WTYPE_MODE[w] = (w === '漏水調査') ? 'investigate' : 'work'; });
const wtSel = document.getElementById('f-worktype');
wtSel.innerHTML = WTYPES4.map(w => `<option value="${w}">${w}</option>`).join('');
wtSel.style.display = 'none';
wtSel.insertAdjacentHTML('afterend', `
  <div id="wt4" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
    ${WTYPES4.map(w => `<button type="button" class="wt4-btn" data-w="${w}"
      style="padding:12px 4px;border:1.5px solid var(--border);border-radius:10px;background:#fff;
      font-size:13.5px;font-weight:700;font-family:inherit;cursor:pointer;">${w}</button>`).join('')}
  </div>`);
function paintWt4() {
  document.querySelectorAll('.wt4-btn').forEach(b => {
    const on = b.dataset.w === wtSel.value;
    b.style.borderColor = on ? '#16304d' : 'var(--border)';
    b.style.background = on ? '#16304d' : '#fff';
    b.style.color = on ? '#fff' : 'var(--text)';
  });
}
document.getElementById('wt4').addEventListener('click', e => {
  const b = e.target.closest('.wt4-btn'); if (!b) return;
  wtSel.value = b.dataset.w; onModeChange(); paintWt4();
});
wtSel.value = '漏水調査'; onModeChange(); paintWt4();
```

- [ ] **Step 3: 漏水調査フォーマットの追加フィールド**

同 script に追記。**(a) 原因箇所チップ**（f2 の直前に挿入・f2 ラベルは「原因と判断した理由」へ変更）、**(b) 水漏れ2択大ボタン**（旧 f-leak select を隠して同期）、**(c) 今後対応チップ**（f4 の直前に挿入）:

```js
/* (a) 原因箇所（場所）チップ＋自由入力 */
const LOC_CHIPS = ['キッチン', '浴室', '洗面', 'トイレ', '給湯器', '天井裏', 'PS', '外部・共用部', '不明'];
document.getElementById('f2-wrap').insertAdjacentHTML('beforebegin', `
  <div class="field" id="causeloc-wrap">
    <label>原因箇所（場所）</label>
    <div id="loc-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0;">
      ${LOC_CHIPS.map(c => `<button type="button" class="loc-chip" data-v="${c}"
        style="padding:8px 12px;border:1.5px solid var(--border);border-radius:999px;background:#fff;
        font-size:13px;font-family:inherit;cursor:pointer;">${c}</button>`).join('')}
    </div>
    <input id="f-causeloc-free" placeholder="補足（例：UB天井点検口から見て左奥の給湯管）"
      style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;
      font-size:14px;font-family:inherit;box-sizing:border-box;">
  </div>`);
const locSel = new Set();
document.getElementById('loc-chips').addEventListener('click', e => {
  const b = e.target.closest('.loc-chip'); if (!b) return;
  const v = b.dataset.v;
  locSel.has(v) ? locSel.delete(v) : locSel.add(v);
  b.style.background = locSel.has(v) ? '#16304d' : '#fff';
  b.style.color = locSel.has(v) ? '#fff' : 'var(--text)';
  b.style.borderColor = locSel.has(v) ? '#16304d' : 'var(--border)';
});
document.getElementById('lbl-f2').childNodes[0].textContent = '原因と判断した理由';
document.getElementById('hint-f2').textContent = 'なぜその箇所が原因と判断したか（テスト結果・目視状況など）';

/* (b) 水漏れは止まっているか: 2択大ボタン（旧selectと同期） */
const leakSel = document.getElementById('f-leak');
leakSel.style.display = 'none';
leakSel.insertAdjacentHTML('afterend', `
  <div id="leak2" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
    <button type="button" class="leak-btn" data-v="止まっている"
      style="padding:14px 4px;border:1.5px solid var(--border);border-radius:10px;background:#fff;
      font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;">止まっている</button>
    <button type="button" class="leak-btn" data-v="止まっていない"
      style="padding:14px 4px;border:1.5px solid var(--border);border-radius:10px;background:#fff;
      font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;">止まっていない</button>
  </div>
  <div id="leak-reason-wrap" style="display:none;margin-top:8px;">
    <textarea id="f-leak-reason" rows="2" placeholder="止まっていない理由（例：給水を止められない・原因箇所未特定）"
      style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;
      font-size:14px;font-family:inherit;box-sizing:border-box;"></textarea>
  </div>`);
document.getElementById('leak2').addEventListener('click', e => {
  const b = e.target.closest('.leak-btn'); if (!b) return;
  const stopped = b.dataset.v === '止まっている';
  leakSel.value = stopped ? '止まっている' : '漏れている（継続的）'; // 旧ロジック互換
  onLeakChange(); // 旧の応急対応selectの表示制御を流用
  document.getElementById('leak-reason-wrap').style.display = stopped ? 'none' : 'block';
  document.querySelectorAll('.leak-btn').forEach(x => {
    const on = x === b;
    x.style.background = on ? (stopped ? '#0d9488' : '#c0392b') : '#fff';
    x.style.color = on ? '#fff' : 'var(--text)';
    x.style.borderColor = on ? 'transparent' : 'var(--border)';
  });
  b.dataset.on = '1';
});

/* (c) 今後必要な対応チップ */
const NEXT_CHIPS = ['再調査', '開口補修の手配', '配管修繕の手配', '内装復旧の手配', '保険対応', '見積作成', '要相談'];
document.getElementById('f4-wrap').insertAdjacentHTML('afterbegin', `
  <div id="next-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0;">
    ${NEXT_CHIPS.map(c => `<button type="button" class="next-chip" data-v="${c}"
      style="padding:8px 12px;border:1.5px solid var(--border);border-radius:999px;background:#fff;
      font-size:13px;font-family:inherit;cursor:pointer;">${c}</button>`).join('')}
  </div>`);
const nextSel = new Set();
document.getElementById('next-chips').addEventListener('click', e => {
  const b = e.target.closest('.next-chip'); if (!b) return;
  const v = b.dataset.v;
  nextSel.has(v) ? nextSel.delete(v) : nextSel.add(v);
  b.style.background = nextSel.has(v) ? '#16304d' : '#fff';
  b.style.color = nextSel.has(v) ? '#fff' : 'var(--text)';
  b.style.borderColor = nextSel.has(v) ? '#16304d' : 'var(--border)';
});
```

※ 漏水調査以外の区分では `MODES.work`（showLeak/showF2/showF4=false）により (a)(b)(c) の親要素が隠れることを確認し、隠れない場合は `onModeChange` 後に `causeloc-wrap` の表示を `f2-wrap` と同期させる1行を足す。

- [ ] **Step 4: 案件連携＋送信**

同 script に追記:

```js
/* 案件連携: ?case=<id> で物件情報を引き継ぎ、送信で報告済みにする */
const CASE_ID = new URLSearchParams(location.search).get('case');
(async () => {
  if (!(await Store.init())) return;
  if (!CASE_ID) return;
  const c = await Store.getCase(CASE_ID);
  if (!c) return;
  document.getElementById('f-prop').value = c.propertyName || '';
  document.getElementById('f-room').value = c.roomNo || '';
  document.getElementById('f-caseno').value = c.caseNo || '';
  const addr = document.getElementById('f-address'); if (addr) addr.value = c.address || '';
  if (WTYPES4.includes(c.workType)) { wtSel.value = c.workType; onModeChange(); paintWt4(); }
  if (c.report) restoreReport(c.report); // 下書き復元（Step 5）
  /* 送信ボタンを追加（PDF出力ボタンの隣） */
  const pdfBtn = document.querySelector('#btn-generate, .btn-generate') ||
    document.querySelector('button[onclick*="runGenerate"]');
  pdfBtn.insertAdjacentHTML('afterend',
    `<button id="btn-submit" style="margin-top:10px;width:100%;padding:15px;border:none;
     border-radius:12px;background:#0d9488;color:#fff;font-size:16px;font-weight:700;">
     報告を送信（作業終了）</button>`);
  document.getElementById('btn-submit').onclick = submitReport;
})();

function collectReport() {
  const wt = wtSel.value;
  const items = [...document.querySelectorAll('#checklist-wrap .chip.on')].map(x => x.textContent.trim());
  const base = { format: wt, survey_items: items,
    survey_items_other: document.getElementById('f-other').value.trim(),
    survey_detail: document.getElementById('f-f1').value.trim() };
  if (wt !== '漏水調査') return base;
  const stopped = leakSel.value === '止まっている';
  return { ...base,
    cause_location_chips: [...locSel],
    cause_location_free: document.getElementById('f-causeloc-free').value.trim(),
    cause_reason: document.getElementById('f-f2').value.trim(),
    leak_stopped: stopped ? '止まっている' : '止まっていない',
    leak_not_stopped_reason: stopped ? '' : document.getElementById('f-leak-reason').value.trim(),
    emergency_action: stopped ? '' : (document.getElementById('f-leakaction').value || ''),
    next_action_chips: [...nextSel],
    next_action_free: document.getElementById('f-f4').value.trim() };
}

async function submitReport() {
  if (!document.getElementById('f-f1').value.trim()) {
    showToast('調査内容（作業実施内容）を入力してください'); return; }
  const missingReq = CHECK_ITEMS.filter(it => it.req && !photos.some(p => p.checkItem === it.k));
  if (missingReq.length &&
      !confirm(`必須の撮影が残っています：\n${missingReq.map(i => '・' + i.label).join('\n')}\nこのまま送信しますか？`)) return;
  const btn = document.getElementById('btn-submit');
  btn.disabled = true; btn.textContent = '送信中…';
  try {
    /* 未アップ写真をR2へ（撮影時に失敗した分の再試行を兼ねる） */
    for (const p of photos.filter(x => !x.uploaded)) {
      if (!p.file) continue;
      await Store.addPhoto(CASE_ID, { file: p.file, phase: p.phase,
        checkItem: p.checkItem, caption: p.caption });
      p.uploaded = true;
    }
    await Store.saveReport(CASE_ID, collectReport());
    await Store.updateStatus(CASE_ID, 'submitted');
    showToast('報告を送信しました');
    setTimeout(() => location.href = `case.html?id=${CASE_ID}`, 700);
  } catch (e) {
    showToast('送信失敗。電波の良い場所で再試行してください');
    btn.disabled = false; btn.textContent = '報告を送信（作業終了）';
  }
}
```

- [ ] **Step 5: 撮影→即アップ＋下書き復元**

既存の上書きレイヤー内 `window.addFiles = function ...` ブロック（計画1で追加した撮影チェックリスト対応版。旧ツール由来の行ではないので編集可）を以下で**置換**:

```js
window.addFiles = function (files) {
  const item = pendingItem; pendingItem = null;
  const def = CHECK_ITEMS.find(x => x.k === item);
  files.forEach(f => {
    const r = new FileReader();
    r.onload = async ev => {
      const p = { id: Date.now() + Math.random(), dataUrl: ev.target.result,
        caption: def ? def.label : '', phase: def ? def.phase : '', checkItem: item || '',
        file: f, uploaded: false };
      photos.push(p); renderPhotos();
      if (CASE_ID) {   // 撮影直後に即アップ（失敗しても送信時に再送される）
        try {
          await Store.addPhoto(CASE_ID, { file: f, phase: p.phase,
            checkItem: p.checkItem, caption: p.caption });
          p.uploaded = true;
        } catch { showToast('アップロード失敗。送信時に再送します'); }
      }
    };
    r.readAsDataURL(f);
  });
};
```

`restoreReport(r)` を追記（`collectReport` の逆。チップ復元は click() でスタイルも同期させる）:

```js
function restoreReport(r) {
  if (!r) return;
  if (WTYPES4.includes(r.format)) { wtSel.value = r.format; onModeChange(); paintWt4(); }
  document.querySelectorAll('#checklist-wrap .chip').forEach(ch => {
    if ((r.survey_items || []).includes(ch.textContent.trim())) ch.classList.add('on');
  });
  document.getElementById('f-other').value = r.survey_items_other || '';
  document.getElementById('f-f1').value = r.survey_detail || '';
  if (r.format !== '漏水調査') return;
  (r.cause_location_chips || []).forEach(v => {
    const b = document.querySelector(`.loc-chip[data-v="${v}"]`); if (b) b.click();
  });
  document.getElementById('f-causeloc-free').value = r.cause_location_free || '';
  document.getElementById('f-f2').value = r.cause_reason || '';
  if (r.leak_stopped) {
    const b = document.querySelector(`.leak-btn[data-v="${r.leak_stopped}"]`); if (b) b.click();
    document.getElementById('f-leak-reason').value = r.leak_not_stopped_reason || '';
    if (r.emergency_action) {
      document.getElementById('f-leakaction').value = r.emergency_action;
      onLeakActionChange();
    }
  }
  (r.next_action_chips || []).forEach(v => {
    const b = document.querySelector(`.next-chip[data-v="${v}"]`); if (b) b.click();
  });
  document.getElementById('f-f4').value = r.next_action_free || '';
}
```

- [ ] **Step 6: 検証（一連の現場フロー）**

minami でログインして:
1. 今日の現場 → 案件 → [作業開始] → 対応中
2. 報告書タブ → report.html?case=… → 物件名・号室・住所が自動で入っている
3. 区分ボタンが「漏水調査」選択状態。「原状回復」を押すと漏水系フィールドが消える
4. 漏水調査に戻し、必須撮影2点＋実施項目＋調査内容＋原因箇所チップ＋理由＋[止まっていない]→理由欄表示→[止まっている]に変更＋今後対応チップを入力
5. [報告を送信] → case.html に戻りステータス「報告済み」
6. admin でログイン → 承認待ちに表示され、報告書タブで内容・写真が見える
7. report.html を再度開く → 入力内容が復元されている（下書き復元）
8. PDF出力も1回成功すること（既存機能の回帰確認）

- [ ] **Step 7: Commit**

```bash
git add app/report.html
git commit -m "feat(app): 報告フォーム区分4ボタン＋漏水調査フォーマット＋送信（打刻・報告済み化）"
```

---

### Task 10: settings（ログアウト）＋pg_cron＋実機統合確認

**Files:**
- Modify: `app/settings.html`
- Create: `app/backend/supabase/migrations/002_cron.sql`

- [ ] **Step 1: settings.html をアカウント表示＋ログアウトに改修**

役割切替 select（モック用）とリセットボタンを削除し、先頭にアカウントカードを追加。単価カードは「原価管理は後日追加予定」の empty 表示に変更:

```js
(async () => {
  if (!(await Store.init())) return;
  const s = Store.session();
  // アカウントカード（既存の役割切替カードを置換）
  document.getElementById('role-card').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div><div style="font-weight:800;font-size:16px;">${s.name}</div>
        <div style="font-size:12px;color:#667;">${s.role === 'admin' ? '管理者' : '作業担当'}</div></div>
      <button id="btn-logout" style="padding:10px 16px;border:1.5px solid #c0392b;border-radius:10px;
        background:#fff;color:#c0392b;font-weight:700;font-family:inherit;cursor:pointer;">ログアウト</button>
    </div>`;
  document.getElementById('btn-logout').onclick = () => Store.logout();
  // 単価カード
  document.getElementById('rateCard').innerHTML =
    '<div class="empty">原価・単価管理は後日追加予定</div>';
})();
```

（要素IDは実物を `grep -n "rateCard\|role\|reset" app/settings.html` で確認して合わせる）

- [ ] **Step 2: pg_cron キープアライブ**

`app/backend/supabase/migrations/002_cron.sql`:

```sql
-- 無料枠の7日自動停止対策: 毎日1回DBアクティビティを発生させる
-- （将来 purge-expired の起動に差し替える）
create extension if not exists pg_cron;
select cron.schedule('keep-alive-daily', '17 3 * * *', $$ select 1 $$);
```

```bash
cd "app/backend" && supabase db push
```

- [ ] **Step 3: 全テスト＋全画面巡回**

```bash
node --test tests/calc.test.js
cd "app/backend" && node --test tests/rls.test.mjs
```

ブラウザで login → index → list → case（全タブ）→ report → new-case → settings を巡回し、コンソールエラーゼロを確認。

- [ ] **Step 4: Commit**

```bash
git add app/settings.html app/backend/supabase/migrations/002_cron.sql
git commit -m "feat(app): ログアウト＋pg_cronキープアライブ"
```

- [ ] **Step 5: 【ユーザー確認】スマホ実機テスト**

1. Mac の LAN IP を取得: `ipconfig getifaddr en0`
2. main 合流後、常駐サーバー（port 8080・root を配信中）で `http://<LAN IP>:8080/app/login.html` をユーザーのスマホ（同一Wi-Fi）で開いてもらう
3. minami アカウントで: 今日の現場 → 作業開始 → カメラ撮影（必須2点）→ 調査フォーム入力 → 送信
4. admin アカウント（PC/スマホ）で報告内容・写真の確認
5. フィードバックを受けて詳細調整（これが「詳細を詰める」サイクルの起点）

- [ ] **Step 6: finishing-a-development-branch スキルで完了処理**

テスト緑 → main へ合流 → ワークツリー掃除（push は現在認証なしのため行わない）。

---

## 実行メモ

- **ユーザー作業が必要な箇所は2つ**: Task 8 Step 1（wrangler login＋R2 APIトークン作成）と Task 10 Step 5（スマホ実機テスト）。それぞれの直前で一時停止してユーザーに依頼する
- Task 5 以降、モックに依存する画面（原価タブ・連絡タブ・share.html）は空表示になるが、スライス1では仕様どおり（壊れていなければよい。JSエラーが出る場合のみ最小修正）
- seed のパスワードはタスク3完了時にユーザーへ報告する
- サーバーの cleanUrls 問題（`/app/index.html`→`/app` リダイレクト）に注意: 開発確認は python http.server（問題なし）を使う

