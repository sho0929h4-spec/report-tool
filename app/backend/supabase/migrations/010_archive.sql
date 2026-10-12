-- 案件アーカイブ: archived_at 列（ZIPダウンロード済みマーク。保存期間経過後の削除対象判定に使う）
alter table cases add column if not exists archived_at timestamptz;

-- guard_case_update 再作成（007ベース + archived_at を worker 変更禁止列に追加）
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
    or new.share_ack      is distinct from old.share_ack
    or new.archived_at    is distinct from old.archived_at then
      raise exception 'worker cannot modify admin-only fields';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
