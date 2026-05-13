-- 見積書テーブル
CREATE TABLE estimates (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id       uuid REFERENCES cases(id) ON DELETE CASCADE,
  vendor_id     uuid REFERENCES vendors(id),
  file_path     text,
  file_name     text,
  total_amount  integer,
  status        text DEFAULT 'pending' CHECK (status IN ('pending','ordered','lost','conditional')),
  condition_note text,
  decided_at    timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- 見積明細テーブル
CREATE TABLE estimate_items (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id  uuid REFERENCES estimates(id) ON DELETE CASCADE,
  item_name    text NOT NULL,
  unit_price   integer NOT NULL,
  quantity     numeric NOT NULL DEFAULT 1,
  amount       integer NOT NULL
);

-- RLS
ALTER TABLE estimates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_items ENABLE ROW LEVEL SECURITY;

-- 管理者（authenticated）: 全操作
CREATE POLICY "admin_estimates_all"      ON estimates      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_estimate_items_all" ON estimate_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 業者（anon）: 挿入のみ（token検証はEdge Functionで行う）
CREATE POLICY "anon_estimates_insert"      ON estimates      FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_estimate_items_insert" ON estimate_items FOR INSERT TO anon WITH CHECK (true);

-- 業者が自分の見積を読めるようにする（案件tokenで紐付け）
CREATE POLICY "anon_estimates_select" ON estimates FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM cases
      WHERE cases.id = estimates.case_id
    )
  );

CREATE POLICY "anon_estimate_items_select" ON estimate_items FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = estimate_items.estimate_id
    )
  );
