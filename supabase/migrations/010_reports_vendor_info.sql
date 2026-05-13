-- ============================================================
-- 010_reports_vendor_info.sql
-- 報告書に施工業者名・担当者名を追加（PDF非表示・管理者のみ閲覧）
-- ============================================================

ALTER TABLE reports ADD COLUMN IF NOT EXISTS vendor_company      text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS vendor_contact_name text;
