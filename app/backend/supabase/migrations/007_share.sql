-- 関係者
create table stakeholders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants,
  case_id uuid not null references cases on delete cascade,
  role text not null check (role in ('resident','manager','owner','contractor')),
  name text not null,
  email text,
  created_at timestamptz not null default now()
);
alter table stakeholders enable row level security;
create policy st_sel on stakeholders for select using (tenant_id = my_tenant());
create policy st_ins on stakeholders for insert with check (tenant_id = my_tenant() and my_role() = 'admin');
create policy st_del on stakeholders for delete using (tenant_id = my_tenant() and my_role() = 'admin');

-- 共有トークンと外部確認
alter table cases add column share_token text unique;
alter table cases add column share_ack jsonb;
alter table tenants add column phone text;

-- guard_case_update 再作成（005ベース + anonパス + share_token/share_ack blacklist）
create or replace function guard_case_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
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
    if new.assigned_to is distinct from old.assigned_to then
      if not (old.assigned_to is null and new.assigned_to = auth.uid()) then
        raise exception 'worker cannot modify admin-only fields';
      end if;
    end if;
    if new.instructions   is distinct from old.instructions
    or new.invoice_amount is distinct from old.invoice_amount
    or new.scheduled_at   is distinct from old.scheduled_at
    or new.due_date       is distinct from old.due_date
    or new.return_note    is distinct from old.return_note
    or new.share_token    is distinct from old.share_token
    or new.share_ack      is distinct from old.share_ack then
      raise exception 'worker cannot modify admin-only fields';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 外部閲覧RPC（security definer・anon 実行可）
create or replace function public_progress(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c cases%rowtype; t tenants%rowtype;
begin
  select * into c from cases where share_token = p_token;
  if not found then return null; end if;
  select * into t from tenants where id = c.tenant_id;
  return jsonb_build_object(
    'propertyName', c.property_name, 'roomNo', c.room_no,
    'workType', c.work_type, 'scheduledAt', c.scheduled_at,
    'status', c.status, 'createdAt', c.created_at,
    'workStartedAt', c.work_started_at, 'workEndedAt', c.work_ended_at,
    'movement', c.movement, 'shareAck', c.share_ack,
    'companyName', t.name, 'companyPhone', t.phone,
    'report', case when c.status in ('submitted','confirmed') and c.report is not null
      then jsonb_build_object(
        'surveyItems',    c.report->'survey_items',
        'surveyDetail',   c.report->>'survey_detail',
        'causeReason',    c.report->>'cause_reason',
        'nextActionChips',c.report->'next_action_chips',
        'nextActionFree', c.report->>'next_action_free')
      else null end);
end $$;

grant execute on function public_progress(text) to anon;

create or replace function public_ack_progress(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update cases set share_ack = jsonb_build_object('at', now())
   where share_token = p_token and status in ('submitted','confirmed') and share_ack is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

grant execute on function public_ack_progress(text) to anon;
