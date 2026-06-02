# URL 連携マップ

最終更新: 2026-05-21

---

## 全体フロー図

```mermaid
flowchart TD

  %% ─── 人物 ───
  ADMIN["👤 管理者"]
  VENDOR["🔨 業者（職人）"]
  CLIENT["👔 依頼元"]
  RESIDENT["🏠 入居者"]
  EXT["🏢 外部取引先"]

  %% ─── 画面 ───
  A["admin/\n管理者ダッシュボード\n（Google OAuth）"]
  C["case/?token\n作業報告フォーム\n（スマホ）"]
  R["report/?token\n報告書閲覧・PDF\n（依頼元）"]
  E["estimate/?token\n見積書提出"]
  VE["vendor/estimates/\n見積一覧\n（業者ポータル）"]
  REG["register/?token\n案件登録依頼\n（外部取引先）"]
  SCH["schedule/?token\n希望日程登録\n（入居者）"]

  %% ─── Supabase ───
  DB[("Supabase DB\ncases / reports\nestimates")]
  FN_NOTIFY["Edge Function\nvendor-notify"]
  FN_SUBMIT["Edge Function\nreport-submit"]
  FN_EST["Edge Function\nestimate-submit\nestimate-decision"]
  FN_REG["Edge Function\nregister-confirm"]
  STORAGE["Supabase Storage\nreports/{case_id}/"]

  %% ─── 通知 ───
  LINE["LINE / メール"]
  SLACK["Slack 通知"]

  %% ─── フロー ───

  ADMIN -->|"Googleログイン"| A
  EXT -->|"?token 付きURL"| REG
  RESIDENT -->|"?token 付きURL"| SCH

  A -->|"案件作成"| DB
  A -->|"vendor-notify 呼び出し"| FN_NOTIFY
  FN_NOTIFY -->|"case URL をメール送信"| LINE
  LINE -->|"受け取る"| VENDOR

  VENDOR -->|"フォーム入力・写真"| C
  C -->|"写真アップロード"| STORAGE
  C -->|"送信"| DB
  C -->|"report-submit 呼び出し"| FN_SUBMIT
  FN_SUBMIT -->|"report URL をメール/LINE送信"| LINE
  FN_SUBMIT -->|"Slack 通知"| SLACK
  LINE -->|"受け取る"| CLIENT
  SLACK -->|"受け取る"| ADMIN

  CLIENT -->|"URLを開く"| R
  R -->|"データ取得"| DB
  R -->|"写真取得"| STORAGE

  A -->|"確認済み → 見積URL発行"| FN_EST
  FN_EST -->|"estimate URL をメール送信"| LINE
  LINE -->|"受け取る"| VENDOR
  VENDOR -->|"見積入力"| E
  E -->|"提出"| DB
  VENDOR -->|"ログインして確認"| VE

  REG -->|"案件登録依頼を保存"| DB
  REG -->|"register-confirm 呼び出し"| FN_REG
  FN_REG -->|"管理者へ通知"| SLACK

  SCH -->|"希望日程を保存"| DB
```

---

## URL 一覧

| URL | 対象 | 認証 | 役割 |
|-----|------|------|------|
| `admin/` | 管理者 | Google OAuth | 案件管理・全機能 |
| `case/?token=xxx` | 業者 | URLトークン | 作業報告フォーム |
| `report/?token=xxx` | 依頼元 | URLトークン | 報告書閲覧・PDF出力 |
| `estimate/?token=xxx` | 業者 | URLトークン | 見積書提出 |
| `vendor/estimates/` | 業者 | メール/パスワード | 自社見積一覧 |
| `register/?token=xxx` | 外部取引先 | URLトークン（存在確認のみ） | 案件登録依頼 |
| `schedule/?token=xxx` | 入居者 | URLトークン | 希望日程登録 |

---

## トークンの流れ

```
cases.access_token（UUID v4）
  │
  ├─ case/?token=     ← 業者が作業報告に使う
  ├─ estimate/?token= ← 業者が見積提出に使う
  └─ report/?token=   ← 依頼元が報告書閲覧に使う

同一 token で 3つの URL を共有。
admin/ から各URLを発行・コピー・通知できる。
```

---

## ステータス遷移

```
pending（未着手）
  └─ 業者が case/ で報告送信
       ↓
submitted（提出済）
  └─ 管理者が admin/ で確認済みにする
       ↓
reviewed（確認済）
```
