-- ============================================================================
-- セキュリティ修正の本体: anon の直接アクセスを全廃。
-- 以後 cases/reports/... へは Worker が service_role で接続して操作する。
-- フロントの匿名キーは不要になりHTMLから削除する。
-- ⚠️ このSQLを当てる前に、フロントのWorker経由化(ステップ2)を完了させること。
--    先に当てると anon キーで動く既存画面が即停止する。
-- ============================================================================

-- cases
DROP POLICY IF EXISTS "anon_select_cases"  ON cases;
DROP POLICY IF EXISTS "anon_insert_cases"  ON cases;

-- reports
DROP POLICY IF EXISTS "anon_select_reports" ON reports;
DROP POLICY IF EXISTS "anon_insert_reports" ON reports;
DROP POLICY IF EXISTS "anon_update_reports" ON reports;

-- report_photos
DROP POLICY IF EXISTS "anon_select_photos" ON report_photos;
DROP POLICY IF EXISTS "anon_insert_photos" ON report_photos;

-- clients
DROP POLICY IF EXISTS "anon_insert_clients" ON clients;
DROP POLICY IF EXISTS "anon_select_clients" ON clients;

-- properties
DROP POLICY IF EXISTS "anon_insert_properties" ON properties;
DROP POLICY IF EXISTS "anon_select_properties" ON properties;

-- vendors
DROP POLICY IF EXISTS "anon_select_vendors" ON vendors;

-- estimates
DROP POLICY IF EXISTS "anon_estimates_insert"      ON estimates;
DROP POLICY IF EXISTS "anon_estimates_select"      ON estimates;
DROP POLICY IF EXISTS "anon_estimate_items_insert" ON estimate_items;
DROP POLICY IF EXISTS "anon_estimate_items_select" ON estimate_items;

-- schedule_submissions
DROP POLICY IF EXISTS "anon_insert_schedule" ON schedule_submissions;
DROP POLICY IF EXISTS "anon_select_schedule" ON schedule_submissions;

-- storage.objects (旧Supabase Storage anon許可)
DROP POLICY IF EXISTS "anon upload reports"  ON storage.objects;
DROP POLICY IF EXISTS "anon read reports"    ON storage.objects;
DROP POLICY IF EXISTS "anon_reports_insert"  ON storage.objects;
DROP POLICY IF EXISTS "anon_reports_select"  ON storage.objects;

-- 管理者(authenticated)のFOR ALLポリシーは維持 → admin画面はそのまま動く。
