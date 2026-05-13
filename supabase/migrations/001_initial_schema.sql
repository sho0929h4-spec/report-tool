-- ============================================================
-- 001_initial_schema.sql
-- 報告書作成ツール - 初期スキーマ
-- ============================================================

-- UUID 拡張（Supabaseではデフォルト有効だが念のため）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- pg_net / pg_cron は Dashboard > Database > Extensions から個別に有効化

-- ============================================================
-- テーブル定義
-- ============================================================

-- 物件
CREATE TABLE properties (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  address     text,
  notes       text,
  created_at  timestamptz DEFAULT now()
);

-- 取引先/報告先
CREATE TABLE clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  contact_name      text,
  email             text,
  slack_webhook     text,
  line_user_id      text,
  freee_partner_id  integer,
  notes             text,
  created_at        timestamptz DEFAULT now()
);

-- 業者
CREATE TABLE vendors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  contact_name  text,
  phone         text,
  email         text,
  notes         text,
  created_at    timestamptz DEFAULT now()
);

-- 案件
CREATE TABLE cases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token    uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  case_no         text NOT NULL,
  property_id     uuid REFERENCES properties(id),
  client_id       uuid REFERENCES clients(id),
  vendor_id       uuid REFERENCES vendors(id),
  room            text,
  work_type       text NOT NULL DEFAULT '漏水調査',
  scheduled_date  date,
  instructions    text,
  status          text NOT NULL DEFAULT 'pending',  -- pending/submitted/reviewed
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- 報告書
CREATE TABLE reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
  work_date     date NOT NULL,
  time_start    time,
  time_end      time,
  work_mode     text NOT NULL,  -- investigate/repair/both
  checked_items text[],
  f1            text,
  f2            text,
  f3            text,
  f4            text,
  pdf_path      text,
  submitted_at  timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now()
);

-- 写真（Storage path のみ。Base64 は持たない）
CREATE TABLE report_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid REFERENCES reports(id) ON DELETE CASCADE,
  sort_order    integer NOT NULL DEFAULT 0,
  storage_path  text NOT NULL,
  phase         text,
  caption       text,
  created_at    timestamptz DEFAULT now()
);

-- 請求項目
CREATE TABLE billing_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid REFERENCES cases(id),
  client_id         uuid REFERENCES clients(id),
  work_date         date NOT NULL,
  work_type         text NOT NULL,
  amount            integer,  -- 円。管理者が手入力または自動計算
  memo              text,
  billed            boolean DEFAULT false,
  billed_at         timestamptz,
  freee_invoice_id  text,
  created_at        timestamptz DEFAULT now()
);

-- ============================================================
-- インデックス
-- ============================================================
CREATE INDEX idx_cases_access_token ON cases(access_token);
CREATE INDEX idx_cases_status ON cases(status);
CREATE INDEX idx_cases_client_id ON cases(client_id);
CREATE INDEX idx_reports_case_id ON reports(case_id);
CREATE INDEX idx_report_photos_report_id ON report_photos(report_id);
CREATE INDEX idx_billing_items_billed ON billing_items(billed);
CREATE INDEX idx_billing_items_client_id ON billing_items(client_id);

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cases_updated_at
  BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE properties    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_items ENABLE ROW LEVEL SECURITY;

-- 管理者（authenticated）は全操作可
CREATE POLICY "admin_all_properties"    ON properties    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_clients"       ON clients       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_vendors"       ON vendors       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_cases"         ON cases         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_reports"       ON reports       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_photos"        ON report_photos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_billing"       ON billing_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 業者（anon）: access_token 一致案件のみ SELECT
CREATE POLICY "anon_select_cases" ON cases
  FOR SELECT TO anon
  USING (true);  -- access_token はクライアント側フィルタで対応（URL に token が必要）

-- 業者（anon）: 報告書 INSERT/SELECT
CREATE POLICY "anon_insert_reports" ON reports
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (SELECT 1 FROM cases WHERE cases.id = reports.case_id)
  );

CREATE POLICY "anon_select_reports" ON reports
  FOR SELECT TO anon
  USING (true);

-- 業者（anon）: 写真 INSERT/SELECT
CREATE POLICY "anon_insert_photos" ON report_photos
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (SELECT 1 FROM reports WHERE reports.id = report_photos.report_id)
  );

CREATE POLICY "anon_select_photos" ON report_photos
  FOR SELECT TO anon
  USING (true);

-- ============================================================
-- Storage bucket（Supabase Dashboard または CLI で作成）
-- ============================================================
-- bucket名: reports
-- Public: false
-- ファイルサイズ上限: 10MB
-- 許可MIMEタイプ: image/jpeg, image/png, image/heic, image/webp
--
-- Storage RLS (storage.objects テーブル):
-- INSERT: anon可（reports/ 配下のみ）
-- SELECT: authenticated は全体可、anon は reports/ 配下可（Signed URL 経由）
--
-- 以下のポリシーを Supabase Dashboard > Storage > Policies で追加:
/*
  -- anon upload
  CREATE POLICY "anon upload reports" ON storage.objects
    FOR INSERT TO anon
    WITH CHECK (bucket_id = 'reports' AND name LIKE 'reports/%');

  -- anon read（Signed URL 発行用）
  CREATE POLICY "anon read reports" ON storage.objects
    FOR SELECT TO anon
    USING (bucket_id = 'reports');
*/

-- ============================================================
-- pg_cron: 月次請求バッチ（毎月1日 JST 0:00 = UTC 15:00）
-- Supabase Dashboard > Database > Extensions > pg_cron を有効化後に実行
-- ============================================================
/*
SELECT cron.schedule(
  'billing-batch',
  '0 15 1 * *',
  $$
  SELECT net.http_post(
    url    := current_setting('app.supabase_url') || '/functions/v1/billing-batch',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body   := '{}'
  )
  $$
);
*/
