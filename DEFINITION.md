# 施工・漏水調査 報告管理システム 定義書

最終更新: 2026-05-21

---

## 1. システム概要

施工業者（職人）が現場で作業報告書・写真を提出し、管理者がそれを確認・管理するWebアプリ。  
業者向けと管理者向けで画面を分離し、URLトークンによるアクセス制御を採用。

---

## 2. ツール一覧

| ツール名 | URL | 対象ユーザー | 認証 |
|----------|-----|------------|------|
| 管理者ツール | `https://sho0929h4-spec.github.io/report-tool/admin/` | 管理者 | Google OAuth |
| 業者 作業報告フォーム | `.../case/?token=xxx` | 職人 | URLトークン |
| 報告書閲覧・PDF出力 | `.../report/?token=xxx` | 依頼元・管理者 | URLトークン |
| 見積書提出 | `.../estimate/?token=xxx` | 職人 | URLトークン |
| 案件登録依頼 | `.../register/?token=xxx` | 取引先 | URLトークン（有無チェック） |
| 希望日程登録 | `.../schedule/?token=xxx` | 入居者 | URLトークン |
| 業者 見積一覧 | `.../vendor/estimates/` | 業者 | メール/パスワード |

> `token=xxx` のURLは管理者ツールで案件ごとに発行・確認できる。

---

## 3. インフラ・ホスティング

| 項目 | 内容 |
|------|------|
| ホスティング | GitHub Pages（`main` ブランチのルートを公開） |
| リポジトリ | `https://github.com/sho0929h4-spec/report-tool` |
| バックエンド | Supabase（`https://zalgyrgjwjdgvklqhdrg.supabase.co`） |
| 認証 | Supabase Auth（管理者のみ Google OAuth） |
| ファイルストレージ | Supabase Storage（`reports` バケット） |
| メール通知 | Resend |
| サーバーレス関数 | Supabase Edge Functions（Deno） |

---

## 4. ファイル構成

```
report-tool/
├── admin/
│   └── index.html          # 管理者画面（認証必須）
├── case/
│   └── index.html          # 業者：作業報告フォーム
├── report/
│   └── index.html          # 報告書閲覧・PDF出力
├── estimate/
│   └── index.html          # 業者：見積書提出フォーム
├── register/
│   └── index.html          # 取引先（外部）案件登録フォーム
├── schedule/
│   └── index.html          # 入居者：希望日程登録フォーム
├── vendor/
│   └── estimates/
│       └── index.html      # 業者：見積一覧
├── supabase/
│   ├── migrations/         # DBマイグレーション（001〜011）
│   └── functions/          # Edge Functions（Deno）
│       ├── estimate-submit/
│       ├── estimate-decision/
│       ├── vendor-notify/
│       ├── report-submit/
│       ├── register-confirm/
│       └── billing-batch/
├── index.html              # 旧スタンドアロンツール（非推奨・削除候補）
├── DEFINITION.md
├── DESIGN.md
├── WIREFRAMES.md
└── serve.sh                # ローカル開発サーバー起動スクリプト（port 8080）
```

---

## 5. 各ツールの定義

### 5-1. 管理者ツール（admin/）

**目的:** 案件の登録・管理・確認。全機能の起点。

**主な機能:**
- 案件登録（物件・取引先・業者・作業区分を指定）
- 案件一覧（ステータス: `pending` / `submitted` / `reviewed`）
- 業者へURL通知（LINE or メール）
- 依頼元へ報告書URL送付
- 見積書の承認・却下
- フォローアップ管理（次回連絡日・メモ）
- マスタ管理（物件・取引先・業者）
- 請求管理

**認証:** Google OAuth（許可メール: `sho0929h4@gmail.com` のみ）

**URL生成:** `VENDOR_ORIGIN` 定数を使用（`location.origin` 禁止）

```javascript
const VENDOR_ORIGIN = 'https://sho0929h4-spec.github.io/report-tool';
```

---

### 5-2. 業者 作業報告フォーム（case/?token=xxx）

**目的:** 職人がスマホから作業報告・写真を提出する。

**主な機能:**
- 案件情報の確認（物件名・号室・作業区分 ※読み取り専用）
- 施工業者情報入力（業者名・担当者名）
- 作業日時の入力（今日/明日/その他 + 30分刻み時間）
- 調査実施項目チェック（タップ複数選択）
- 状況・原因・内容・方針のテキスト入力（音声入力対応）
- 写真アップロード（フェーズ・コメント付き、ドラッグ並び替え可）
- 自動下書き保存（Supabase）
- 提出前チェックリスト（品番写真・清掃・鍵返却）
- フォローアップ入力（管理者への申し送り `next_action`）

**バリデーション:**
- 作業日: 必須
- 状況（f1）: 必須
- 写真フェーズ・コメント: 必須（未入力は送信不可）
- 写真0枚: 警告のみ（確認後送信可）

**提出後:** 管理者にSlack通知、依頼元にLINE or メール自動通知

**URL生成:** `VENDOR_ORIGIN` 定数を使用（`location.origin` 禁止）

---

### 5-3. 報告書閲覧・PDF出力（report/?token=xxx）

**目的:** 依頼元が進捗を確認し、提出後はPDFをダウンロードする。

**主な機能:**
- ステータスバナー表示（`cases.status` を読み取り）
  - `pending` → 「現場対応の準備中です」（グレー）
  - `in_progress` → 「現在対応中です」（青）※要マイグレーション 012
  - `submitted` → 「報告書が届きました」（緑）
  - `reviewed` → 「確認済みです」（グレー）
- 案件情報表示（報告書未提出時もバナーと案件名は表示）
- 案件情報・作業結果の表示（提出後）
- 現場写真（フェーズラベル・コメント付き）（提出後）
- 📥 PDFダウンロードボタン（提出後のみ表示）

**認証:** URLトークンのみ（ログイン不要）

---

### 5-4. 見積書提出（estimate/?token=xxx）

**目的:** 職人が見積書を提出する。

**主な機能:**
- 見積項目の入力（品名・数量・単価）
- よくある項目プリセット
- 消費税10%自動計算
- 合計金額の自動計算
- 提出後、管理者に通知（Edge Function `estimate-submit`）

---

### 5-5. 案件登録依頼（register/?token=xxx）

**目的:** 取引先が直接案件を登録依頼する。

**主な機能:**
- 3ステップフォーム（会社情報 → 依頼内容 → 確認・送信）
- 取引先・物件・案件情報を Supabase に直接 INSERT
- 確認メール送信（Edge Function `register-confirm`）

**アクセス制御:** `?token` パラメータなしアクセスはエラー画面表示

---

### 5-6. 希望日程登録（schedule/?token=xxx）

**目的:** 入居者が作業希望日程を登録する。

**主な機能:**
- 候補日程を1〜5件登録（日付・時間帯選択）
- `schedule_submissions` テーブルに保存

---

### 5-7. 業者 見積一覧（vendor/estimates/）

**目的:** 業者が自社提出の見積一覧を確認する。

**認証:** Supabase Auth メール/パスワード（他画面のURLトークン方式とは異なる）

---

## 6. データベース設計

### `properties`（物件）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| name | text NOT NULL | 物件名 |
| address | text | 住所 |
| notes | text | メモ |

### `clients`（取引先）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| name | text NOT NULL | 会社名 |
| contact_name | text | 担当者名 |
| email | text | メールアドレス |
| slack_webhook | text | Slack Webhook URL |
| line_user_id | text | LINE ユーザーID |
| freee_partner_id | integer | freee 取引先ID |

### `vendors`（業者）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| name | text NOT NULL | 業者名 |
| contact_name | text | 担当者名 |
| phone | text | 電話番号 |
| email | text | メールアドレス |

### `cases`（案件）— 中心テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| access_token | uuid UNIQUE | URLトークン |
| case_no | text | 案件番号（例: 260514-01） |
| property_id | uuid FK | 物件 |
| property_name | text | 物件名テキスト（JOINフォールバック用） |
| client_id | uuid FK | 取引先 |
| vendor_id | uuid FK | 担当業者 |
| room | text | 号室（代表） |
| rooms | jsonb | 複数号室情報 |
| work_type | text | 作業区分 |
| scheduled_date | date | 作業予定日 |
| address | text | 現地住所 |
| instructions | text | 職人への指示 |
| status | text | `pending` / `submitted` / `reviewed`（※`in_progress`は要マイグレーション） |
| next_contact_date | date | 次回連絡日 |
| next_contact_note | text | 次回連絡内容 |

### `reports`（報告書）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| case_id | uuid UNIQUE FK | |
| work_date | date | 作業日 |
| time_start / time_end | time | 作業時間 |
| work_mode | text | `investigate` / `repair` / `both` |
| checked_items | text[] | チェックリスト |
| f1〜f4 | text | 状況・原因・内容・方針 |
| leak_status | text | 漏水状況 |
| leak_amount | text[] | 漏水量・状況（複数） |
| next_action | text | 管理者への申し送り（PDF非掲載） |
| vendor_company | text | 施工業者名 |
| vendor_contact_name | text | 施工業者担当者名 |
| checklist | jsonb | 提出前チェックリスト回答 |
| submitted_at | timestamptz | 提出日時（null = 下書き） |

### `report_photos`（写真）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| report_id | uuid FK | |
| storage_path | text | Supabase Storageパス |
| phase | text | `before` / `investigating` / `after-inv` / `before-work` / `working` / `done` |
| caption | text | コメント（必須） |
| sort_order | int | 並び順 |

### `estimates`（見積書）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| case_id | uuid FK | |
| vendor_id | uuid FK | |
| total_amount | integer | 合計金額（税込） |
| status | text | `pending` / `ordered` / `lost` / `conditional` |

### `estimate_items`（見積明細）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| estimate_id | uuid FK | |
| item_name | text | 項目名 |
| unit_price | integer | 単価（税抜） |
| quantity | integer | 数量 |
| amount | integer | 小計（税抜） |

### `schedule_submissions`（入居者希望日程）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| case_id | uuid FK | |
| date | date | 希望日 |
| period | text | 時間帯（午前/午後/終日） |

---

## 7. フェーズバッジ カラー定義

| フェーズ値 | 表示名 | カラー |
|-----------|--------|--------|
| `before` | 対応前 | 青 `#2563eb` |
| `investigating` | 調査中 | オレンジ `#ea580c` |
| `after-inv` | 調査後 | 緑 `#16a34a` |
| `before-work` | 施工前 | 紫 `#7c3aed` |
| `working` | 施工中 | 黄 `#d97706` |
| `done` | 完了 | ティール `#0d9488` |

---

## 8. セキュリティ（RLS）

| テーブル | anon権限 |
|----------|---------|
| cases | SELECT（全件。クライアント側で `access_token` フィルタ） |
| reports | INSERT / SELECT / UPDATE |
| report_photos | INSERT / SELECT |
| properties | SELECT / INSERT |
| clients | SELECT / INSERT |
| vendors | SELECT |
| estimates | INSERT / SELECT |
| estimate_items | INSERT / SELECT |
| schedule_submissions | SELECT / INSERT |

---

## 9. Edge Functions 一覧

| 関数名 | トリガー | 処理 |
|--------|---------|------|
| `vendor-notify` | 案件登録時 | 職人へLINE/メールでURLを送付 |
| `report-submit` | 報告書提出時 | 管理者にSlack通知・依頼元に通知 |
| `estimate-submit` | 見積書提出時 | 管理者に通知 |
| `estimate-decision` | 管理者が承認/却下 | 職人に結果通知 |
| `register-confirm` | 外部案件登録 | 確認メール送信 |
| `billing-batch` | 定期実行 | 請求バッチ処理 |

---

## 10. 作業モード別フィールド定義

### investigate（漏水調査）
| フィールド | ラベル | 必須 |
|-----------|--------|------|
| f1 | 状 況 | ○ |
| f2 | 内 容 | - |
| f3 | 原 因 | - |
| f4 | 次の方針（依頼元向け・PDF掲載） | - |

### repair（修繕工事）
| フィールド | ラベル | 必須 |
|-----------|--------|------|
| f1 | 施工前状況 | - |
| f2 | 施工内容 | ○ |
| f3 | 完了状況 | - |
| f4 | 備 考 | - |

### both（調査＋工事）
| フィールド | ラベル | 必須 |
|-----------|--------|------|
| f1 | 調査状況 | ○ |
| f2 | 調査内容・原因 | - |
| f3 | 施工内容 | - |
| f4 | 完了・備考 | - |

---

## 11. マイグレーション履歴

| ファイル | 内容 |
|----------|------|
| `001_initial_schema.sql` | 初期テーブル・RLS・インデックス |
| `002_anon_register_policy.sql` | anon INSERT/SELECT（cases/clients/properties） |
| `003_schedule_submissions.sql` | 入居者希望日程テーブル |
| `004_add_fields.sql` | reports: leak_status / leak_amount / next_action 等追加 |
| `005_estimates.sql` | estimates / estimate_items テーブル・RLS |
| `006_add_rooms.sql` | cases: rooms JSONB列追加 |
| `007_address_checklist.sql` | cases: address / reports: checklist 追加 |
| `008_anon_update_reports.sql` | anon による reports UPDATE ポリシー追加 |
| `009_anon_read_vendors.sql` | anon SELECT on vendors（案件フォームの JOIN用） |
| `010_reports_vendor_info.sql` | reports: vendor_company / vendor_contact_name 追加 |
| `011_cases_property_name.sql` | cases: property_name テキスト列追加 |

### 予定マイグレーション

| ファイル | 内容 | 状態 |
|----------|------|------|
| `012_cases_status_in_progress.sql` | `cases.status` に `in_progress` 追加 | 未実施 |

---

## 12. ローカル開発

```bash
# サーバー起動（port 8080）
cd "/Users/s/Documents/claude code/report-tool"
bash serve.sh
# → http://127.0.0.1:8080 でアクセス可能

# GitHub へプッシュ（自動でGitHub Pagesに反映）
git add -A && git commit -m "変更内容" && git push origin main

# Supabase Edge Function デプロイ
supabase functions deploy report-submit
supabase functions deploy vendor-notify
```

---

## 13. 未対応・保留事項

| 項目 | 状態 |
|------|------|
| `cases.status` に `in_progress` 追加 | マイグレーション 012 が必要 |
| `register/` のトークンDB検証 | 現在は有無チェックのみ |
| フォローアップ画面の廃止（フォーム内統合） | 設計方針は決定済み・未実装 |
| 依頼元進捗ページ：リアルタイム写真表示 | 未実装 |
| 依頼元進捗ページ：漏水状況バッジ | 未実装 |
| freee 請求連携 | テーブルは実装済み・API未連携 |
| `marurou.com` ドメイン認証（Resend） | Resend側で要設定 |
| 選択肢マスター外部化 | 設計済み・未実装 |
