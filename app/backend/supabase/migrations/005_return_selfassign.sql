-- 差し戻し理由
alter table cases add column if not exists return_note jsonb;

-- 担当者未定（assigned_to null）の案件は worker も update 可（自己アサイン用）
drop policy if exists c_upd on cases;
create policy c_upd on cases for update
  using (tenant_id = my_tenant()
         and (my_role() = 'admin' or assigned_to = auth.uid() or assigned_to is null));

-- guard: worker の assigned_to 変更は「null → 自分」のみ許可。return_note は worker 変更禁止
create or replace function guard_case_update() returns trigger
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
    if new.assigned_to is distinct from old.assigned_to then
      if not (old.assigned_to is null and new.assigned_to = auth.uid()) then
        raise exception 'worker cannot modify admin-only fields';
      end if;
    end if;
    if new.instructions   is distinct from old.instructions
    or new.invoice_amount is distinct from old.invoice_amount
    or new.scheduled_at   is distinct from old.scheduled_at
    or new.due_date       is distinct from old.due_date
    or new.return_note    is distinct from old.return_note then
      raise exception 'worker cannot modify admin-only fields';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
