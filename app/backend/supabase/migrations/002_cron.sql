-- 無料枠の7日自動停止対策: 毎日1回DBアクティビティを発生させる
-- （将来 purge-expired の起動に差し替える）
create extension if not exists pg_cron;
select cron.schedule('keep-alive-daily', '17 3 * * *', $$ select 1 $$);
