-- ============================================================
-- 012_reports_trouble.sql
-- 報告書にトラブル報告欄（内容・対応）を追加
-- 写真は report_photos の phase='trouble' を流用
-- ============================================================

ALTER TABLE reports ADD COLUMN IF NOT EXISTS trouble_desc   text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS trouble_action text;
