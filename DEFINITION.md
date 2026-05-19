# 施工・漏水調査 報告管理システム 定義書

最終更新: 2026-05-19

---

## 1. システム概要

施工業者が現場で作業報告書を提出し、管理者がそれを確認・管理するWebアプリケーション。  
業者向けと管理者向けで画面を分離し、URLトークンによるアクセス制御を採用。

### 主な機能
- 案件登録・管理（管理者）
- 作業報告書の提出（業者）
- 写真アップロード（業者）
- 見積書の提出（業者）
- 報告書のPDF出力
- フォローアップ管理（管理者）
- 日程調整（入居者希望日程の登録・反映）

---

## 2. 構成・ホスティング

### URL
| 用途 | URL |
|------|-----|
| 業者向け（案件フォーム・報告書・見積） | `https://sho0929h4-spec.github.io/report-tool/` |
| 管理者画面 | `https://sho0929h4-spec.github.io/report-tool/admin/index.html` |
| ローカル開発サーバー | `http://127.0.0.1:3001` |

### リポジトリ
- GitHub: `https://github.com/sho0929h4-spec/report-tool`
- ブランチ: `main`
- GitHub Pages: `main` ブランチのルートを公開

### バックエンド
- Supabase URL: `https://zalgyrgjwjdgvklqhdrg.supabase.co`
- 認証: Supabase Auth（管理者のみ Google OAuth）

---

## 3. ファイル構成

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
├── DEFINITION.md           # 本定義書
└── serve.sh                # ローカル開発サーバー起動スクリプト
```

---

## 4. データベース設計

### テーブル一覧

#### `properties`（物件）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| name | text NOT NULL | 物件名 |
| address | text | 住所 |
| notes | text | メモ |
| created_at | timestamptz | |

#### `clients`（取引先）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| name | text NOT NULL | 会社名 |
| contact_name | text | 担当者名 |
| email | text | メールアドレス |
| slack_webhook | text | Slack Webhook URL |
| line_user_id | text | LINE ユーザーID |
| freee_partner_id | integer | freee 取引先ID |
| notes | text | メモ |

#### `vendors`（業者）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| name | text NOT NULL | 業者名 |
| contact_name | text | 担当者名 |
| phone | text | 電話番号 |
| email | text | メールアドレス |
| notes | text | メモ |

#### `cases`（案件）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| access_token | uuid UNIQUE | URLトークン（業者アクセス用） |
| case_no | text NOT NULL | 案件番号（例: 260514-01） |
| property_id | uuid FK→properties | 物件ID |
| property_name | text | 物件名テキスト（JOINフォールバック用） |
| client_id | uuid FK→clients | 取引先ID |
| vendor_id | uuid FK→vendors | 業者ID |
| room | text | 号室（代表） |
| rooms | jsonb | 複数号室情報（`[{room, resident_name, phone}]`） |
| work_type | text | 作業区分（漏水調査/修繕工事など） |
| scheduled_date | date | 作業予定日 |
| address | text | 現地住所（物件住所と別途） |
| instructions | text | 担当者からの指示 |
| resident_name | text | 入居者名 |
| status | text | `pending` / `submitted` / `reviewed` |
| next_contact_date | date | 次回連絡日 |
| next_contact_note | text | 次回連絡内容 |
| created_at | timestamptz | |
| updated_at | timestamptz | トリガーで自動更新 |

#### `reports`（報告書）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| case_id | uuid UNIQUE FK→cases | |
| work_date | date NOT NULL | 作業日 |
| time_start | time | 開始時間 |
| time_end | time | 終了時間 |
| work_mode | text | `investigate` / `repair` / `both` |
| checked_items | text[] | チェック済み実施項目 |
| f1 | text | フィールド1（状況/施工前状況/調査状況） |
| f2 | text | フィールド2（詳細内容/施工内容/調査内容）※調査モードでは非表示 |
| f3 | text | フィールド3（原因/完了状況/施工内容） |
| f4 | text | フィールド4（次の方針/備考/完了備考） |
| leak_status | text | 漏水状況（止まっている/漏れている） |
| leak_amount | text[] | 漏水量・状況（複数選択） |
| leak_amount_note | text | 漏水量その他詳細 |
| next_action | text | 次の対応方針 |
| vendor_company | text | 施工業者名（管理者のみ表示・PDF非出力） |
| vendor_contact_name | text | 施工業者担当者名（管理者のみ表示） |
| checklist | jsonb | 提出前チェックリスト回答 |
| submitted_at | timestamptz | 提出日時（nullは下書き） |
| created_at | timestamptz | |

#### `report_photos`（写真）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| report_id | uuid FK→reports | |
| sort_order | integer | 並び順 |
| storage_path | text NOT NULL | Supabase Storage パス |
| phase | text | フェーズ（対応前/調査中/調査後/施工前/施工中/完了） |
| caption | text | キャプション |

#### `estimates`（見積書）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| case_id | uuid FK→cases | |
| vendor_id | uuid FK→vendors | |
| total_amount | integer | 合計金額（税込・円） |
| file_path | text | 添付ファイルパス |
| file_name | text | 添付ファイル名 |
| status | text | `pending` / `ordered` / `lost` / `conditional` |
| created_at | timestamptz | |

#### `estimate_items`（見積明細）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| estimate_id | uuid FK→estimates | |
| item_name | text | 項目名 |
| unit_price | integer | 単価（税抜・円） |
| quantity | integer | 数量 |
| amount | integer | 小計（税抜・円） |

#### `billing_items`（請求項目）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| case_id | uuid FK→cases | |
| client_id | uuid FK→clients | |
| work_date | date | 作業日 |
| work_type | text | 作業区分 |
| amount | integer | 金額（円） |
| memo | text | メモ |
| billed | boolean | 請求済みフラグ |
| freee_invoice_id | text | freee 請求書ID |

#### `schedule_submissions`（入居者希望日程）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid PK | |
| case_id | uuid FK→cases | |
| date | date | 希望日 |
| period | text | 時間帯（午前/午後/終日） |
| created_at | timestamptz | |

---

## 5. セキュリティ（RLS）

### ロール
| ロール | 対象 | 認証方法 |
|--------|------|---------|
| `authenticated` | 管理者 | Google OAuth（`sho0929h4@gmail.com`のみ） |
| `anon` | 業者・入居者 | URLトークン（`access_token`）のみ |

### 主なRLSポリシー
| テーブル | anon権限 |
|----------|---------|
| cases | SELECT（全件。クライアント側でaccess_tokenフィルタ） |
| reports | INSERT / SELECT / UPDATE |
| report_photos | INSERT / SELECT |
| properties | SELECT / INSERT |
| clients | SELECT / INSERT |
| vendors | SELECT（migration 009で追加） |
| estimates | INSERT / SELECT（自案件のみ） |
| estimate_items | INSERT / SELECT |
| schedule_submissions | SELECT / INSERT |

---

## 6. 画面仕様

### 管理者画面（`admin/index.html`）

**認証:** Google OAuth（Supabase Auth）

**主な機能:**
- 案件一覧（物件名・ステータス・次回連絡日）
- 案件登録・編集（物件名/取引先/業者/号室/作業区分/指示事項等）
- 作業URL・見積URLのコピー/表示
- 報告書モーダル閲覧（施工業者情報表示・PDF非対象）
- フォローアップ記録（確認済み処理・次回連絡日設定）
- 見積書一覧・承認/失注
- 請求管理
- マスタ管理（物件・取引先・業者）

**URL生成ルール:**
```javascript
const VENDOR_ORIGIN = 'https://sho0929h4-spec.github.io/report-tool';
// 作業URL: ${VENDOR_ORIGIN}/case/index.html?token=${access_token}
// 見積URL: ${VENDOR_ORIGIN}/estimate/index.html?token=${access_token}
// 報告書URL: ${VENDOR_ORIGIN}/report/index.html?token=${access_token}
```

---

### 業者：作業報告フォーム（`case/index.html?token=...`）

**アクセス:** URLトークンのみ

**フロー:**
1. ローディング → Supabaseから案件データ取得
2. フォーム表示（作業案件情報・施工業者情報・作業日時・漏水状況・実施項目・調査/工事結果・写真）
3. 「報告書を送信」ボタン押下 → バリデーション
4. 提出前チェックリスト画面（写真撮影・型番記録・清掃・鍵返却）
5. 確認画面
6. 送信 → 完了画面

**モード切り替え（work_type別）:**
| モード | work_type | 必須フィールド |
|--------|----------|--------------|
| investigate | 漏水調査・経過確認・その他 | f1（状況） |
| repair | 修繕工事・原因元工事 | f2（施工内容） |
| both | 漏水調査・修繕工事 | f1 |

**バリデーション（送信ボタン時）:**
- 作業日 必須
- モード別必須フィールド入力
- 写真アップロード済みの場合：フェーズ選択必須・キャプション入力必須
- 写真0枚の場合：警告（エラーではなく確認推奨）

**自動保存:** 3秒デバウンス（テキスト変更・チェックボックス変更時）

---

### 業者：見積書提出フォーム（`estimate/index.html?token=...`）

**アクセス:** URLトークンのみ（作業報告と同一token）

**機能:**
- 案件情報表示（物件名・号室・作業区分・業者名）
- 見積明細入力（項目名・単価・数量→小計自動計算）
- よくある項目プリセット（調査基本料金・耐圧テスト等）
- 消費税10%自動計算
- 送信 → Supabase直接INSERT（`estimates` + `estimate_items`）
- Slack通知（Edge Function `estimate-submit` 経由。未デプロイでも失敗しない）

---

### 報告書閲覧・PDF出力（`report/index.html?token=...`）

**アクセス:** URLトークンのみ

**機能:**
- 作業写真報告書の表示（表紙＋写真ページ）
- 会社名印字オプション選択（印刷ボタン押下時ダイアログ表示）
  - 「会社名を印字する」（取引先名）
  - 「変更して印字する」（任意入力）
  - 「印字しない」（空白）
- `window.print()` でPDF保存

---

### 入居者：希望日程フォーム（`schedule/index.html?token=...`）

入居者が希望する作業日程を登録。管理画面・作業フォームで参照。

---

## 7. Edge Functions（Supabase）

| Function | 用途 | トリガー |
|----------|------|---------|
| `vendor-notify` | 案件作成時に業者へメール送信 | 管理者が案件作成 |
| `report-submit` | 報告書提出通知（Slack） | 業者が報告書送信 |
| `estimate-submit` | 見積書受領通知（Slack）・単価異常検知 | 見積提出時（任意） |
| `estimate-decision` | 見積承認/失注の業者通知 | 管理者が決定操作 |
| `register-confirm` | 外部登録フォームの確認メール | 取引先が案件登録 |
| `billing-batch` | 月次請求バッチ | cron（毎月1日） |

**メール送信:** Resend API（`RESEND_API_KEY`）  
**注意:** Resend無料プランは送信先ドメインの認証が必要（`marurou.com`は要認証）

---

## 8. Storageバケット

| バケット | 用途 | アクセス |
|----------|------|---------|
| `reports` | 報告書写真 | anon: `reports/`配下にアップロード・Signed URL取得可 |

写真パス形式: `reports/{case_id}/{timestamp}_{index}.jpg`  
Signed URL有効期限: 7日間（閲覧用）・1日（下書き復元用）

---

## 9. 作業モード別フィールド定義

### investigate（漏水調査）
| フィールド | ラベル | 必須 |
|-----------|--------|------|
| f1 | 状 況 | ○ |
| f2 | 内 容 | - |（非表示） |
| f3 | 原 因 | - |
| f4 | 次の方針 | - |

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

## 10. マイグレーション履歴

| ファイル | 内容 |
|----------|------|
| `001_initial_schema.sql` | 初期テーブル・RLS・インデックス |
| `002_anon_register_policy.sql` | anon INSERT/SELECT（cases/clients/properties） |
| `003_schedule_submissions.sql` | 入居者希望日程テーブル |
| `004_add_fields.sql` | reports: leak_status/leak_amount/next_action等追加 |
| `005_estimates.sql` | estimates/estimate_items テーブル・RLS |
| `006_add_rooms.sql` | cases: rooms JSONB列追加 |
| `007_address_checklist.sql` | cases: address追加 / reports: checklist追加 |
| `008_anon_update_reports.sql` | anon が報告書をUPDATEできるポリシー追加 |
| `009_anon_read_vendors.sql` | anon SELECT on vendors（案件フォームのJOIN用） |
| `010_reports_vendor_info.sql` | reports: vendor_company/vendor_contact_name追加 |
| `011_cases_property_name.sql` | cases: property_name テキスト列追加（JOINフォールバック） |

---

## 11. 物件名の取得ロジック

物件名は2系統で取得し、フォールバック構造をとる：

```javascript
// 優先1: properties テーブルとのJOIN
const propName = caseData.property?.name
// 優先2: cases.property_name テキスト列（直接保存）
             || caseData.property_name
             || '';
```

**背景:** `property_id` が未設定の古い案件や、PostgREST スキーマキャッシュ未更新時でも表示できるよう、`property_name` テキスト列を追加。管理画面で案件を更新すると自動的に `property_name` が保存される。

---

## 12. 未対応・保留事項

| 項目 | 状態 |
|------|------|
| `sminami@marurou.com` へのメール送信 | Resend で `marurou.com` ドメイン認証が必要 |
| Edge Functions のデプロイ確認 | Supabase CLI で要確認（`estimate-submit`等） |
| Supabase スキーマキャッシュ | カラム追加後は `NOTIFY pgrst, 'reload schema';` を実行 |
| 請求機能（freee連携） | billing_items テーブルは実装済み、freee APIは未連携 |

---

## 13. ローカル開発

```bash
# サーバー起動
cd "/Users/s/Desktop/claude code/report-tool"
bash serve.sh
# → http://127.0.0.1:3001 でアクセス可能

# GitHub へプッシュ（自動でGitHub Pagesに反映、数分）
git add -A
git commit -m "変更内容"
git push
```
