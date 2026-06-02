# 施工・漏水調査 報告管理システム 設計書

最終更新: 2026-05-21

---

## 1. システム構成図

```
┌─────────────────────────────────────────────────────────┐
│                      利用者とアクセス方法                   │
├──────────────┬───────────────┬──────────────────────────┤
│   職人（スマホ） │  依頼元（ブラウザ）│       管理者              │
│               │               │                          │
│ case/?token   │ report/?token │    admin/index.html      │
└──────┬────────┴───────────────┴────────────┬─────────────┘
       │                                     │
       ▼                                     ▼
┌─────────────────────────────────────────────────────────┐
│                    Supabase（バックエンド）                 │
│                                                         │
│  ┌─────────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Edge Functions  │  │  Database   │  │  Storage    │ │
│  │                 │  │             │  │             │ │
│  │ vendor-notify   │  │ cases       │  │ reports/    │ │
│  │ report-submit   │  │ reports     │  │ {case_id}/  │ │
│  │ estimate-*      │  │ report_photos│  │  *.jpg      │ │
│  │ billing-batch   │  │ estimates   │  └─────────────┘ │
│  └─────────────────┘  │ properties  │                   │
│                        │ clients     │                   │
│                        │ vendors     │                   │
│                        └─────────────┘                   │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────┐
│  外部通知（Resend・LINE）  │
└──────────────────────────┘
```

---

## 2. 技術スタック

| 項目 | 技術 |
|------|------|
| フロントエンド | 単一HTMLファイル（フレームワークなし） |
| ホスティング | GitHub Pages |
| DB・Auth | Supabase（PostgreSQL + Auth） |
| ストレージ | Supabase Storage |
| サーバーレス | Supabase Edge Functions（Deno/TypeScript） |
| PDF生成 | html2canvas 1.4.1 + jsPDF 2.5.1（CDN） |
| フォント | Noto Sans JP（Google Fonts CDN） |
| メール | Resend API |

---

## 3. ファイル構成

```
report-tool/
├── admin/
│   └── index.html          # 管理者ツール（Google OAuth必須）
├── case/
│   └── index.html          # 業者 作業報告フォーム
├── report/
│   └── index.html          # 報告書閲覧・PDF出力
├── estimate/
│   └── index.html          # 業者 見積書提出
├── register/
│   └── index.html          # 外部取引先 案件登録（URLトークン必須）
├── schedule/
│   └── index.html          # 入居者 希望日程登録
├── vendor/
│   └── estimates/
│       └── index.html      # 業者 見積一覧（メール/パスワード認証）
├── supabase/
│   ├── migrations/         # DBマイグレーション SQL（001〜011）
│   └── functions/          # Edge Functions（Deno）
│       ├── vendor-notify/
│       ├── report-submit/
│       ├── estimate-submit/
│       ├── estimate-decision/
│       ├── register-confirm/
│       └── billing-batch/
├── index.html              # 旧スタンドアロンツール（IndexedDB・非推奨）
├── DEFINITION.md
├── DESIGN.md
├── WIREFRAMES.md
└── serve.sh                # ローカル開発サーバー（port 8080）
```

> **注意:** `index.html`（ルート）は旧版ツール（パスワード認証・IndexedDB）。新機能は `case/index.html` を使う。

---

## 4. 画面構成（URL一覧）

| URL | 利用者 | 認証方式 | 役割 |
|-----|--------|---------|------|
| `admin/` | 管理者 | Google OAuth | 案件管理・全機能 |
| `case/?token=xxx` | 職人 | URLトークン | 作業報告フォーム |
| `report/?token=xxx` | 依頼元・管理者 | URLトークン | 進捗確認・PDF出力 |
| `estimate/?token=xxx` | 職人 | URLトークン | 見積書提出 |
| `register/?token=xxx` | 取引先 | URLトークン（有無チェックのみ） | 案件登録依頼 |
| `schedule/?token=xxx` | 入居者 | URLトークン | 希望日程登録 |
| `vendor/estimates/` | 業者 | メール/パスワード（Supabase Auth） | 見積一覧 |

---

## 5. URL生成ルール

全画面で `VENDOR_ORIGIN` 定数を使って業者向けURLを生成する。  
`location.origin` は GitHub Pages のサブパスを含まないため使用禁止。

```javascript
// admin/index.html・case/index.html 共通
const VENDOR_ORIGIN = 'https://sho0929h4-spec.github.io/report-tool';

// 生成例
const caseUrl   = `${VENDOR_ORIGIN}/case/index.html?token=${token}`;
const estUrl    = `${VENDOR_ORIGIN}/estimate/index.html?token=${token}`;
const reportUrl = `${VENDOR_ORIGIN}/report/index.html?token=${token}`;
```

---

## 6. 主要フロー

### 6-1. 職人が報告書を提出するフロー

```
1. 管理者が案件登録 (admin/)
      ↓
2. vendor-notify Edge Function
   → 職人にLINE or メールで case/?token=xxx を送付
      ↓
3. 職人がフォームを開き入力 (case/?token=xxx)
   - 写真アップロード → Supabase Storage に自動保存
   - テキスト入力 → 自動保存（デバウンス）
      ↓
4. 「送信」ボタン → バリデーション
      ↓
5. 提出前チェックリスト（3項目）→ 確認画面
      ↓
6. reports INSERT + cases.status = 'submitted'
      ↓
7. report-submit Edge Function
   - 管理者にSlack通知
   - 依頼元にLINE or メール通知（report/?token=xxx のリンク付き）
      ↓
8. 完了画面（フォローアップ入力 → 管理者への申し送り保存）
      ↓
9. 依頼元が report/?token=xxx で報告書確認・PDFダウンロード
```

### 6-2. 依頼元が進捗確認するフロー

```
依頼元が report/?token=xxx を開く
      ↓
cases テーブルから status を取得
      ↓
ステータスバナーを表示
  pending    → 「現場対応の準備中です」（グレー）
  in_progress → 「現在対応中です」（青）※要マイグレーション 012
  submitted  → 「報告書が届きました」（緑）
  reviewed   → 「確認済みです」（グレー）
      ↓
[submitted 以降]
reports データ取得 → 報告書表示 → PDF ダウンロードボタン表示
```

### 6-3. PDF生成フロー（クライアントサイド）

```
「📥 PDFダウンロード」クリック
      ↓
署名付きURL → fetchAsDataUrl() → base64 data URL に変換（CORS回避）
      ↓
html2canvas で .rp-page 要素を canvas に描画（scale: 2）
      ↓
jsPDF に canvas を JPEG で追加（210mm × 297mm）
      ↓
doc.save('【報告書】{物件名}.pdf')
```

---

## 7. 写真ページ レイアウト設計

```
A4縦（297mm × 210mm）、1ページ4枚（2列×2行）

┌─────────────────────────────────────────────┐
│ ヘッダー（会社名・タイトル）                     │
│─────────────────────────────────────────────│
│ ┌──────────────┐ ┌──────────────┐           │
│ │   No.1 写真  │ │   No.2 写真  │  ↑ 121mm  │
│ └──────────────┘ └──────────────┘  ↓        │
│ ┌──────────────┐ ┌──────────────┐           │
│ │   No.3 写真  │ │   No.4 写真  │  ↑ 121mm  │
│ └──────────────┘ └──────────────┘  ↓        │
│─────────────────────────────────────────────│
│ フッター（会社名・ページ番号）                    │
└─────────────────────────────────────────────┘

CSS:
  grid-template-rows: 121mm 121mm;  ← 固定高さ（最終ページでの拡大防止）
  object-fit: contain;              ← 写真全体を表示（トリミングなし）
```

---

## 8. 認証設計

### 管理者（admin/）
- Supabase Google OAuth
- `ALLOWED_EMAILS = ['sho0929h4@gmail.com']` で許可メールを制限
- セッションは `supabase.auth.getSession()` で管理

### 業者・依頼元（case/ report/ estimate/ schedule/）
- `access_token`（UUID v4）をURLパラメータに付与
- DB側で `cases.access_token` と照合
- Supabase RLS: `access_token` が一致する行のみ読み取り許可

### 取引先（register/）
- `?token` パラメータの有無をチェック（存在しない場合エラー画面）
- DB側でのトークン検証は未実装（anon INSERT は RLS で `status='request'` のみ許可）

### 業者ポータル（vendor/estimates/）
- Supabase Auth のメール/パスワード認証
- 他画面と認証方式が異なる点に注意

---

## 9. 環境変数（Supabase Edge Functions）

| キー | 用途 |
|------|------|
| `APP_BASE_URL` | メール内リンクのベースURL（`https://sho0929h4-spec.github.io/report-tool`） |
| `RESEND_API_KEY` | メール送信 |
| `SLACK_WEBHOOK_URL` | Slack通知 |

---

## 10. バリデーション設計（case/index.html）

| 項目 | 動作 |
|------|------|
| 作業日 | 必須エラー（デフォルト：今日の日付を自動入力） |
| f1（状況） | 必須エラー |
| 写真フェーズ | 必須エラー（送信不可） |
| 写真コメント（caption） | 必須エラー（送信不可） |
| 写真0枚 | 警告のみ（確認後送信可） |

---

## 11. ローカル開発

```bash
# 開発用サーバー起動（port 8080）
cd "/Users/s/Documents/claude code/report-tool"
bash serve.sh
# → http://127.0.0.1:8080 でアクセス可能

# Supabase Edge Function デプロイ
supabase functions deploy report-submit
supabase functions deploy vendor-notify

# GitHub Pages デプロイ（git push のみ）
git add -A && git commit -m "update" && git push origin main
```

---

## 12. 技術制約・注意点

| 項目 | 内容 |
|------|------|
| GitHub Pages | 静的ファイルのみ。動的処理はすべてSupabase側 |
| Supabase Edge Functions | Deno ランタイム。npm非対応（esm.sh経由） |
| Signed URL有効期限 | 7日間。依頼元ページは都度再発行が必要 |
| 音声入力 | Web Speech API（ブラウザ標準）。Safari iOS対応あり |
| `location.origin` | GitHub Pages サブパスを含まないため URL 生成に使用禁止。必ず `VENDOR_ORIGIN` 定数を使う |
| 依頼元通知（LINE） | `clients.line_user_id` が設定されている場合のみ送信 |
| 依頼元通知（メール） | `clients.email` が設定されている場合のみ送信（Resend使用） |

---

## 13. 未対応・保留事項

| 項目 | 状態 |
|------|------|
| `cases.status` に `in_progress` 追加 | マイグレーション 012 が必要 |
| `register/` のトークンDB検証 | 現在は有無チェックのみ。`register_tokens` テーブルが必要 |
| フォローアップ画面の廃止（case/内への統合） | 設計方針は決定済み・未実装 |
| 依頼元進捗ページ：リアルタイム写真表示 | 未実装 |
| 依頼元進捗ページ：漏水状況バッジ | 未実装 |
| freee 請求連携 | `billing_items` テーブルは実装済み・freee API未連携 |
| 選択肢マスター外部化 | 設計済み・未実装 |
| `marurou.com` ドメイン認証（Resend） | 要認証 |
