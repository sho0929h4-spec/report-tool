-- 送信待ちメッセージ下書きテーブル
create table message_drafts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants,
  case_id      uuid not null references cases on delete cascade,
  trigger_type text not null check (trigger_type in ('preVisit','reportReady','siteReport')),
  sh_role      text not null check (sh_role in ('resident','manager','owner','contractor')),
  sh_name      text not null,
  body         text not null,
  created_at   timestamptz not null default now()
);
-- 同一案件×トリガー×関係者ロールで1通のみ（重複防止）
create unique index message_drafts_uniq
  on message_drafts (case_id, trigger_type, sh_role);

alter table message_drafts enable row level security;
-- admin 専用（worker は参照不可）
create policy md_all on message_drafts for all
  using  (tenant_id = my_tenant() and my_role() = 'admin')
  with check (tenant_id = my_tenant() and my_role() = 'admin');
