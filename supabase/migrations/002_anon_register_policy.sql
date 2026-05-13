-- ============================================================
-- 002_anon_register_policy.sql
-- 取引先から直接フォーム登録できるよう anon の INSERT/SELECT を許可
-- ============================================================

-- cases テーブル: anon INSERT（status='request' のみ）
CREATE POLICY "anon_insert_cases" ON cases
  FOR INSERT TO anon
  WITH CHECK (status = 'request');

-- clients テーブル: anon INSERT / SELECT
CREATE POLICY "anon_insert_clients" ON clients
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_select_clients" ON clients
  FOR SELECT TO anon
  USING (true);

-- properties テーブル: anon INSERT / SELECT
CREATE POLICY "anon_insert_properties" ON properties
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_select_properties" ON properties
  FOR SELECT TO anon
  USING (true);
