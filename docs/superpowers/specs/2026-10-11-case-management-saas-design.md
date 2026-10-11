# 作業報告書ツール 案件管理SaaS化 設計書

作成日: 2026-10-11
対象: GitHub Pages で稼働中の「作業報告書 作成ツール」（リポジトリ root `index.html`）

---

## 1. 背景と目的

現状のツールは静的ページ＋端末内 IndexedDB 保存のため、
- 報告書が作成した端末からしか見えない
- 案件を横断して管理する画面がない

これを「案件一覧を親画面とする現場管理ツール」に発展させ、将来は課金型の外販 SaaS にする。

**SF（Salesforce）は UI・列構成の参考のみ。機能連携は一切しない。データはこのツールの DB で完結する。**

## 2. スコープ

### Phase 1（今回実装）
- Supabase 導入（認証・DB・RLS）
- 写真を Cloudflare R2 に保存（署名 URL は Supabase Edge Function が発行）
- 案件一覧（親画面）・案件詳細・現場モード（打刻・現地写真アップ・報告送信）
- ロール2種（admin / worker）
- 保存期間の自動削除（テナント設定・初期値36ヶ月・変更可）
- 既存 IndexedDB 履歴のクラウド移行ボタン
- 利用はまず自社1テナントのみ（テナント構造は最初から仕込む）

### Phase 2（外販時・今回やらない）
- サインアップ・課金（Stripe 等）・テナント管理画面・招待フロー

### やらないこと
- SF 連携、CRM 機能（次回連絡・完了予定日・依頼元管理）
- report-tool 本体（public/ 以下・worker/・6月の未コミット作業）への変更

## 3. 前提数値（ユーザー確認済み）

| 項目 | 値 |
|------|-----|
| 想定テナント数（最大） | 500〜1000社 |
| 1社あたり現場数 | 月50現場 |
| 1現場あたり写真 | 最大50枚（スマホ撮影） |
| 保存期間 | 36ヶ月（テナントごとに変更可能） |
| 写真圧縮 | 送信前にブラウザで長辺1600px/JPEG ≒300KB、サムネ≒30KB |

**容量・コスト試算（フル規模時）**
- 1社の3年定常: 約29GB → 1000社 ≒ 29TB
- R2: 保存 $435 + 操作 $40 ≒ **月$480（約7万円）**、転送量$0
- S3 比較: ≒ 月$910（約13.6万円）→ R2 採用（ユーザー決定済み）
- 1社あたりインフラ原価 ≒ 月70円 → 課金で余裕で回収可能
- Phase 1（自社のみ月800MB増）: R2 無料枠10GBで約12ヶ月無料。Supabase は無料枠から開始し、必要時に Pro（$25/月）へ

## 4. アーキテクチャ

```
フロント（静的・GitHub Pages 続投・URL 不変）
├ list.html   案件一覧（親画面・role で表示切替）
├ case.html   案件詳細（admin=全情報編集 / worker=現場モード）
├ index.html  報告書フォーム（既存894行を改修・case 連携）
└ shared/     supabase-js 初期化・認証ガード・共通CSS

        │ supabase-js（DB・認証）        │ 写真 PUT/GET（署名URL）
        ▼                               ▼
Supabase（新規プロジェクト）            Cloudflare R2（バケット1つ）
├ Auth: メール+PW                      └ キー: {tenant_id}/{case_id}/{uuid}.jpg
├ Postgres + RLS（テナント分離）             （本体と thumb/ サムネ）
├ Edge Function: sign-photo（R2署名URL発行）
├ Edge Function: purge-expired（期限切れ削除）
└ pg_cron: 毎日 purge-expired を起動
```

- Cloudflare Worker は書かない。サーバーロジックは Supabase Edge Function に集約
- R2 は S3 互換 API。Edge Function が AWS 署名 v4 で presigned URL（PUT/GET、期限10分）を発行
- Supabase 無料枠の「7日無停止」対策: pg_cron の毎日実行が DB アクティビティになるため実質停止しない。保険として GitHub Actions の毎日 ping も設定

## 5. データモデル

```sql
tenants
  id uuid PK, name text,
  retention_months int default 36,   -- 保存期間（変更可能）
  plan text default 'free', created_at

profiles
  user_id uuid PK → auth.users, tenant_id uuid → tenants,
  display_name text,
  role text CHECK (role in ('admin','worker')), created_at

cases
  id uuid PK, tenant_id, case_no text,
  property_name text NOT NULL, room_no text, address text,
  scheduled_at timestamptz,          -- 現場対応日時
  status text CHECK (status in
    ('scheduled','in_progress','submitted','confirmed'))
    default 'scheduled',
  work_type text,                    -- 調査 / 作業報告
  instructions text,                 -- 現地対応指示・注意事項
  tasks jsonb default '[]',          -- [{text, done}]
  cause text,                        -- 漏水原因
  next_actions text,                 -- 今後の必要な対応
  assigned_to uuid → profiles, created_by uuid,
  work_started_at timestamptz,       -- 開始打刻
  work_ended_at timestamptz,         -- 終了打刻
  report jsonb,                      -- 報告フォーム全項目
  created_at, updated_at

photos
  id uuid PK, tenant_id, case_id → cases ON DELETE CASCADE,
  phase text,                        -- before / during / after
  caption text, sort_order int,
  object_key text, thumb_key text, size_bytes int, created_at
```

## 6. 権限（RLS）

- 共通: 全テーブル `tenant_id = (profiles で自分の tenant_id)` を USING に強制。1000社同居でも相互不可視
- `tenants`: 参照=自テナント、`retention_months` 更新=admin のみ
- `cases`:
  - admin: 自テナント全行の全操作
  - worker: 参照=自テナント全行（一覧はシンプル表示だが閲覧は可）。更新=自分が `assigned_to` の行のみ。トリガーで worker の禁止操作を遮断（`confirmed` への変更、`instructions`/`assigned_to` の書換等）
  - ステータス遷移: scheduled→in_progress→submitted は worker 可。confirmed は admin のみ
- `photos`: 追加/削除=担当 worker か admin。参照=自テナント
- Edge Function `sign-photo`: JWT 検証→対象 case が自テナントか・担当か確認→署名URL返却。R2 認証情報は Function の secret に置きフロントへ出さない

## 7. 画面設計

### 案件一覧 list.html（親画面）
- 列6本: 物件名+号室 / 住所 / 現場対応日（デフォルト降順） / 作業区分 / ステータス / 担当
- 検索（物件名・住所）、ステータスのフィルタチップ
- PC=テーブル、スマホ=カード型
- admin: 全件＋[＋新規案件]。worker: 自分の担当のみ・今日の現場が最上部
- 意図的に入れない列: 次回連絡・完了予定日・依頼元（CRM の領分）

### 案件詳細 case.html
- admin ビュー: 状況・打刻時間・写真ギャラリー（サムネ→タップで原寸署名URL）・報告内容・漏水原因・今後の対応・タスク・注意事項の全編集、確認済み化、報告書PDF
- worker ビュー（現場モード・スマホ最適化）:
  1. 住所（タップで地図アプリ起動）・現地対応指示・タスク確認
  2. [作業開始] 打刻 → status=in_progress
  3. 写真アップ（前/中/後、撮影→圧縮→サムネ生成→R2へ逐次送信。失敗時は再試行ボタン）
  4. 報告入力（既存フォーム UI を流用）
  5. [作業終了・送信] → 終了打刻 → status=submitted → 管理者に即反映

### 報告書フォーム index.html（既存改修）
- 保存先を IndexedDB → Supabase に変更（通信失敗時は localStorage に退避し再送）
- 「住所」フィールドを追加
- 案件から遷移した場合は物件名・号室・住所等を自動引継ぎ
- 案件を経由せず単体で開いて保存した場合は、新規 case を自動作成して紐付ける（一覧に必ず現れる＝宙に浮く報告書を作らない）
- 既存履歴の「クラウドへ移行」ボタン（IndexedDB 全件→cases へ一括登録）
- PDF 出力は既存ロジックそのまま

### 設定（Phase 1 は最小・list.html 内モーダル）
- 保存期間（retention_months）変更、メンバー一覧表示
- メンバー追加は Phase 1 では Supabase ダッシュボードから手動作成で可とする

## 8. 保存期間の自動削除

- pg_cron（毎日1回）→ Edge Function `purge-expired`
- 対象: `scheduled_at < now() - (retention_months || ' months')::interval` の cases
- 順序: R2 オブジェクト削除（本体+サムネ）→ photos 行 → cases 行
- 削除前フラグや猶予は設けない（Phase 1）。将来必要なら「削除予定一覧」を足す

## 9. 既存資産の扱い

- リポジトリ: このまま `report-tool`。触るのは root `index.html`・新規ファイルのみ
- 6月の未コミット作業（public/ 以下・worker/・supabase/migrations 015-024）には一切触れない
- Supabase プロジェクトは新規作成（既存 zalgyrgjwjdgvklqhdrg と分離）
- 既存の簡易ログイン（localStorage rauth）は Supabase Auth に置換

## 10. テスト方針

- RLS: 2テナント・3ユーザー（admin/worker/他社）を作り、SQL で越境アクセスが全て拒否されることを確認するテストスクリプト
- Edge Function: sign-photo の権限チェック（他テナント case 指定で 403）
- 打刻・ステータス遷移: worker が confirmed にできないこと
- 写真: 圧縮後サイズ・アップ失敗→再試行の動作（スマホ実機）
- 削除ジョブ: retention_months を 0 にしたテストテナントで即日削除を確認

## 11. リスク

| リスク | 対策 |
|--------|------|
| Supabase 無料枠の7日停止 | pg_cron 日次実行＋GitHub Actions ping。早期に Pro 化 |
| 現場の電波不安定で写真アップ失敗 | 逐次アップ＋失敗キュー＋再試行ボタン。全滅時は送信前に警告 |
| 写真50枚×複数現場で R2 無料枠超過 | 約12ヶ月の猶予。超過後も月数百円→課金で回収 |
| worker の誤操作（打刻やり直し） | admin が打刻時刻を手修正できる欄を用意 |
| IndexedDB 移行時の重複 | 移行済みフラグを localStorage に記録し二重実行を防止 |
