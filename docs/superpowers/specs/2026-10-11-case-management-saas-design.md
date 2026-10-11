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
- **スマホアプリベース UI（PWA）**: 全画面モバイルファースト・底タブナビ・ホーム画面に追加でアプリとして起動。PC は同 UI を中央寄せ表示
- Supabase 導入（認証・DB・RLS）
- 写真を Cloudflare R2 に保存（署名 URL は Supabase Edge Function が発行）
- **「今日」ホーム**: 現場監督が今日の現場・必要な対応・期限・進捗を一目で確認
- 案件一覧・案件詳細・現場モード（打刻・現地写真アップ・報告送信）
- **原価計算**: 人件費（打刻×単価で自動）＋材料費等の手入力＋請求額→粗利・粗利率を自動表示（admin のみ閲覧可）
- ロール2種（admin=現場監督 / worker=作業担当）
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
フロント（静的 PWA・GitHub Pages 続投）
app/          ← 新アプリはすべてこの下。旧ツール（root index.html）は無変更で並走
├ index.html  「今日」ホーム（PWA 起動点。現場・期限・進捗。role で範囲切替）
├ list.html   案件一覧（検索・フィルタ・カード UI）
├ case.html   案件詳細（タブ: 概要/タスク/写真/報告書/原価※admin）
├ report.html 報告書フォーム（root index.html のコピーを改修・case 連携）
├ settings.html 設定（保存期間・単価・メンバー・ログアウト）
├ manifest.json + sw.js（PWA: アイコン・全画面起動・シェルキャッシュ）
└ shared/     config.js・Store（データ窓口）・共通CSS（底タブ）

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
- **UI は全画面スマホアプリ基準**: 底タブナビ [今日][案件][設定]＋admin のみ[＋新規]FAB。PC は max-width 480px 中央寄せで同一 UI（別レイアウトを作らない）
- **将来のストアアプリ化を妨げない作り**: 設定値は shared/config.js に一元化・リンクは相対パスのみ → Capacitor（App Store）/ TWA（Google Play）でそのままラップ可能。課金はストア外（Web/Stripe）で行い手数料15〜30%を回避する方針

## 5. データモデル

```sql
tenants
  id uuid PK, name text,
  retention_months int default 36,   -- 保存期間（変更可能）
  default_hourly_rate numeric,       -- 人件費の既定単価（円/時）
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
  due_date date,                     -- 対応期限（「今日」ホームの期限表示に使用）
  instructions text,                 -- 現地対応指示・注意事項
  tasks jsonb default '[]',          -- [{text, done, due?}] 期限付きタスク可
  cause text,                        -- 漏水原因
  next_actions text,                 -- 今後の必要な対応
  assigned_to uuid → profiles, created_by uuid,
  work_started_at timestamptz,       -- 開始打刻
  work_ended_at timestamptz,         -- 終了打刻
  invoice_amount numeric,            -- 請求額（税抜・admin 入力）
  report jsonb,                      -- 報告フォーム全項目
  created_at, updated_at

photos
  id uuid PK, tenant_id, case_id → cases ON DELETE CASCADE,
  phase text,                        -- before / during / after
  caption text, sort_order int,
  object_key text, thumb_key text, size_bytes int, created_at

costs                                -- 原価明細（admin 専用）
  id uuid PK, tenant_id, case_id → cases ON DELETE CASCADE,
  category text CHECK (category in
    ('labor','material','subcontract','other')),
  label text, qty numeric, unit_price numeric, amount numeric,
  is_auto boolean default false,     -- true=打刻から自動生成した人件費行
  created_by, created_at

worker_rates                         -- 職人別単価（admin 専用・profiles と分離して秘匿）
  user_id uuid PK → profiles, tenant_id,
  hourly_rate numeric                -- 未設定なら tenants.default_hourly_rate を使用
```

**原価計算ロジック**
- 人件費: `(work_ended_at − work_started_at) × 単価`。admin が原価タブを開いた時に自動行（is_auto=true）を生成/再同期。打刻が修正されれば追従。手動上書きも可（上書き時 is_auto=false）
- 粗利 = `invoice_amount − Σcosts.amount`、粗利率も表示（保存せず表示時に計算）

## 6. 権限（RLS）

- 共通: 全テーブル `tenant_id = (profiles で自分の tenant_id)` を USING に強制。1000社同居でも相互不可視
- `tenants`: 参照=自テナント、`retention_months` 更新=admin のみ
- `cases`:
  - admin: 自テナント全行の全操作
  - worker: 参照=自テナント全行（一覧はシンプル表示だが閲覧は可）。更新=自分が `assigned_to` の行のみ。トリガーで worker の禁止操作を遮断（`confirmed` への変更、`instructions`/`assigned_to` の書換等）
  - ステータス遷移: scheduled→in_progress→submitted は worker 可。confirmed は admin のみ
- `photos`: 追加/削除=担当 worker か admin。参照=自テナント
- `costs`・`worker_rates`・`cases.invoice_amount`: **admin のみ**（worker には原価・請求・単価を一切見せない。worker_rates を profiles と分離したのはこのため）
- Edge Function `sign-photo`: JWT 検証→対象 case が自テナントか・担当か確認→署名URL返却。R2 認証情報は Function の secret に置きフロントへ出さない
- 注: `cases.invoice_amount` は行単位 RLS では列を隠せないため、worker 向けは invoice_amount を除いた VIEW `cases_worker` を参照させる（または列権限 REVOKE）。実装時にどちらかを採用

## 7. 画面設計（全画面スマホアプリ基準・底タブナビ）

```
底タブ: [🏠 今日] [📋 案件] [⚙ 設定]  ＋ admin のみ右下 FAB [＋新規案件]
```

### 「今日」ホーム app/index.html（アプリの起動画面）
現場監督（admin）が今日の動きを一目で掴む画面。worker は自分の担当分のみ。
```
┌──────────────────────┐
│ 今日 10/11(土)                │
│ ⚠ 期限超過 2件 / 本日期限 1件   │← タップで該当案件へ
├──────────────────────┤
│ ― 今日の現場（時刻順）―        │
│ ┌──────────────────┐│
│ │ 10:00 パレス目黒東 502       ││
│ │ 調査 ●対応中  担当:南        ││
│ │ タスク ☑3/5  📷12枚         ││
│ └──────────────────┘│
├──────────────────────┤
│ ― ボールが自分にある案件 ―     │
│ ・報告済→確認待ち 3件（admin）  │
├──────────────────────┤
│ [🏠今日] [📋案件] [⚙設定]      │
└──────────────────────┘
```
- 「必要な対応」= 案件カードに現地対応指示の先頭行とタスク完了率を表示
- 「期限」= due_date・期限付きタスクを集計して上部アラート
- 「進捗」= ステータスバッジ＋タスク ☑n/m

### 案件一覧 list.html
- カード型リスト（テーブルは作らない。PC も同じカード UI）
- カード内容: 物件名+号室 / 住所 / 対応日 / 作業区分 / ステータス / 担当 / 期限（近い・超過時のみ赤表示）
- 上部: 検索（物件名・住所）＋ステータスのフィルタチップ（横スクロール）
- 並び: 対応日降順。admin=全件、worker=自分の担当のみ
- 意図的に入れないもの: 次回連絡・依頼元（CRM の領分）

### 案件詳細 case.html（タブ切替）
```
[概要] [タスク] [写真] [報告書] [原価†]   † admin のみ表示
```
- **概要**: ステータス・物件/住所（地図起動）・対応日時・期限・担当・現地対応指示・漏水原因・今後の必要な対応・打刻時刻（admin は手修正可）・確認済み化（admin）
- **タスク**: チェックリスト（期限付き可）。worker もチェック可
- **写真**: フェーズ別ギャラリー（サムネ→タップで原寸）。現場モードの撮影→圧縮→逐次アップもここ
- **報告書**: 報告内容の閲覧・編集（index.html のフォームへ）・PDF 出力・関係者への共有（PDF ダウンロード/共有シート）
- **原価（admin のみ）**: 人件費自動行＋材料費/外注費/その他の明細追加、請求額入力 → 原価合計・粗利・粗利率を即時表示
- **worker の現場フロー**は概要タブ上の大ボタンで誘導:
  [作業開始]（打刻→対応中）→ 写真タブ → 報告書タブ → [作業終了・送信]（打刻→報告済）

### 報告書フォーム app/report.html（root index.html のコピーを改修。元は無変更）
- 保存先を IndexedDB → Supabase に変更（通信失敗時は localStorage に退避し再送）
- 「住所」フィールドを追加
- 案件から遷移した場合は物件名・号室・住所等を自動引継ぎ
- 案件を経由せず単体で開いて保存した場合は、新規 case を自動作成して紐付ける（一覧に必ず現れる＝宙に浮く報告書を作らない）
- 旧ツールの IndexedDB 履歴の「クラウドへ移行」ボタン（全件→cases へ一括登録）
- PDF 出力は既存ロジックそのまま

### 設定タブ（Phase 1 は最小）
- 保存期間（retention_months）変更・既定単価/職人別単価（admin）・メンバー一覧・ログアウト
- メンバー追加は Phase 1 では Supabase ダッシュボードから手動作成で可とする

### PWA
- manifest.json（アイコン・スタンドアロン起動・テーマ色）＋ sw.js（アプリシェルのキャッシュのみ。データのオフライン同期は Phase 1 ではやらない）
- iOS/Android とも「ホーム画面に追加」で全画面アプリとして起動

## 8. 保存期間の自動削除

- pg_cron（毎日1回）→ Edge Function `purge-expired`
- 対象: `scheduled_at < now() - (retention_months || ' months')::interval` の cases
- 順序: R2 オブジェクト削除（本体+サムネ）→ photos 行 → cases 行
- 削除前フラグや猶予は設けない（Phase 1）。将来必要なら「削除予定一覧」を足す

## 9. 既存資産の扱い

- **旧ツール（root `index.html`）は一切変更しない。** GitHub Pages で従来どおり使い続けられる
- 新アプリは `app/` フォルダに分離。報告書フォームは root `index.html` を `app/report.html` にコピーして改修
- 旧→新の移行: 新アプリが安定したら旧ツール利用をやめる（IndexedDB 履歴の移行ボタンは app 側に用意）
- 6月の未コミット作業（public/ 以下・worker/・supabase/migrations 015-024）には一切触れない
- Supabase プロジェクトは新規作成（既存 zalgyrgjwjdgvklqhdrg と分離）
- 新アプリのログインは Supabase Auth（旧ツールの localStorage rauth はそのまま）

## 10. テスト方針

- RLS: 2テナント・3ユーザー（admin/worker/他社）を作り、SQL で越境アクセスが全て拒否されることを確認するテストスクリプト
- **原価の秘匿**: worker で costs / worker_rates / invoice_amount が読めないことを SQL で確認
- Edge Function: sign-photo の権限チェック（他テナント case 指定で 403）
- 打刻・ステータス遷移: worker が confirmed にできないこと
- 原価計算: 打刻2h×単価3,000円→人件費6,000円の自動行、打刻修正→再同期、粗利計算の検算
- 写真: 圧縮後サイズ・アップ失敗→再試行の動作（スマホ実機）
- PWA: ホーム画面追加→スタンドアロン起動・底タブ動作（iOS Safari / Android Chrome 実機）
- 削除ジョブ: retention_months を 0 にしたテストテナントで即日削除を確認

## 11. リスク

| リスク | 対策 |
|--------|------|
| Supabase 無料枠の7日停止 | pg_cron 日次実行＋GitHub Actions ping。早期に Pro 化 |
| 現場の電波不安定で写真アップ失敗 | 逐次アップ＋失敗キュー＋再試行ボタン。全滅時は送信前に警告 |
| 写真50枚×複数現場で R2 無料枠超過 | 約12ヶ月の猶予。超過後も月数百円→課金で回収 |
| worker の誤操作（打刻やり直し） | admin が打刻時刻を手修正できる欄を用意 |
| IndexedDB 移行時の重複 | 移行済みフラグを localStorage に記録し二重実行を防止 |
| App Store 審査（将来のラップ時） | 「Webを包んだだけ」却下リスク → プッシュ通知・カメラ連携等のネイティブ機能を足して申請 |

## 12. ストアアプリ化ロードマップ（Phase 2 以降・参考）

| 段階 | 方法 | UI コード | 備考 |
|------|------|-----------|------|
| Phase 1（今回） | PWA（ホーム画面に追加） | — | 審査なし・即配布・GitHub Pages 続投 |
| Google Play | TWA（Bubblewrap） | そのまま | 工数小。PWA をほぼ無改修で登録 |
| App Store | Capacitor ラップ | そのまま | プッシュ通知等を足して審査対策。$99/年 |
| 完全ネイティブ | React Native 等 | 書き直し | UI のみ作り直し。Supabase/R2/RLS は全て流用可 |

- 外販時の課金は**ストア外（Web で Stripe 契約→アプリはログインのみ）**とし、ストア手数料15〜30%を回避する
- Phase 1 から守る制約: 設定値は shared/config.js に一元化・リンクは相対パスのみ（Capacitor 化を妨げない）
