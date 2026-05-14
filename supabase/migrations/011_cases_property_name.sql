-- ============================================================
-- 011_cases_property_name.sql
-- cases テーブルに property_name テキスト列を追加
-- property_id JOIN が null の場合のフォールバック用
-- ============================================================

ALTER TABLE cases ADD COLUMN IF NOT EXISTS property_name text;
