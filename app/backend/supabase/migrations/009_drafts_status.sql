-- 送信待ちメッセージ下書き: status 列・stakeholder_id・source_id を追加
-- テーブルを再作成（本番データなし。RLS・インデックスも再設定）
drop table if exists message_drafts;

create table message_drafts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants,
  case_id        uuid not null references cases on delete cascade,
  trigger_type   text not null check (trigger_type in ('preVisit','reportReady','siteReport')),
  sh_role        text not null check (sh_role in ('resident','manager','owner','contractor')),
  sh_name        text not null,
  body           text not null,
  stakeholder_id uuid references stakeholders on delete cascade,
  source_id      uuid,
  status         text not null default 'draft' check (status in ('draft','sent','dismissed')),
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);

-- preVisit/reportReady: 同一案件×トリガー×関係者ID で1通のみ
create unique index md_uniq_main on message_drafts (case_id, trigger_type, stakeholder_id)
  where trigger_type in ('preVisit','reportReady');

-- siteReport: 同一案件×トリガー×関係者ID×元報告ID で1通のみ
create unique index md_uniq_sr on message_drafts (case_id, trigger_type, stakeholder_id, source_id)
  where trigger_type = 'siteReport';

alter table message_drafts enable row level security;

-- admin 専用（worker は参照不可）
create policy md_all on message_drafts for all
  using  (tenant_id = my_tenant() and my_role() = 'admin')
  with check (tenant_id = my_tenant() and my_role() = 'admin');
