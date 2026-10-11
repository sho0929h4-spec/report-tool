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
