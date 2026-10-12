create table site_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants,
  case_id uuid not null references cases on delete cascade,
  kind text not null check (kind in ('survey','policy','arrange','resident','other')),
  items jsonb not null default '[]',   -- 選択した内容チップの文字列配列
  note text,                           -- 自由記載
  recipients jsonb not null default '[]', -- ['internal','manager','owner']
  acked boolean not null default false,   -- 管理者確認済み
  created_by uuid not null references profiles,
  by_name text not null,
  created_at timestamptz not null default now()
);
alter table site_reports enable row level security;
create policy sr_sel on site_reports for select using (tenant_id = my_tenant());
create policy sr_ins on site_reports for insert with check (
  tenant_id = my_tenant() and created_by = auth.uid()
  and exists (select 1 from cases c where c.id = case_id and c.tenant_id = my_tenant()
              and (my_role() = 'admin' or c.assigned_to = auth.uid())));
create policy sr_upd on site_reports for update
  using (tenant_id = my_tenant() and my_role() = 'admin');
