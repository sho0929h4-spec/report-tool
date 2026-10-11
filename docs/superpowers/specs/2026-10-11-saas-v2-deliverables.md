# 現場報告SaaS v2 設計成果物（指示書v1.0 §15対応）

作成日: 2026-10-11
元設計書: `docs/superpowers/specs/2026-10-11-case-management-saas-design.md`（基本アーキテクチャ・コスト試算・PWA方針はそちらが正）
調査結果・再利用方針・リスク一覧: `docs/existing-system-audit.md`

本書は指示書v1.0で追加された要件（工程テンプレート / タスク停滞判定 / 外部共有 / 帳票2種 / データ台帳 / 権限マトリクス）を既存設計に統合した成果物。

---

## 1. 新旧システム構成図（成果物2）

```mermaid
flowchart TD
  subgraph 既存["既存（一切変更しない）"]
    OLD["report-tool/index.html<br>報告書作成ツール<br>IndexedDB完結"]
    FROZEN["凍結: public/ + worker/ + supabase/<br>別系統の案件管理システム<br>（Cloudflare Worker + Supabase既存PJ + R2）"]
  end

  subgraph 新規["新規: app/（GitHub Pages 同一リポジトリ）"]
    HOME["ホーム（ダッシュボード）"]
    LIST["案件一覧"]
    CASE["案件詳細<br>概要/工程/タスク/写真/報告/原価"]
    REP["report.html<br>= index.html のコピー<br>+ 案件連携モード"]
    SHARE["外部共有ページ<br>share/?token"]
    STORE["shared/store.js<br>（データ窓口・唯一の入口）"]
  end

  subgraph BE["計画2で新設（Supabase 新規プロジェクト）"]
    AUTH["Supabase Auth<br>メール+PW"]
    PG[("PostgreSQL + RLS<br>正規データベース<br>Single Source of Truth")]
    EF["Edge Functions<br>sign-photo / share-view / purge-expired"]
    R2[("Cloudflare R2<br>写真・PDF<br>非公開バケット")]
  end

  HOME & LIST & CASE & REP --> STORE
  STORE -->|"計画1: モック<br>計画2: Supabase"| PG
  STORE --> AUTH
  STORE -->|署名URL| EF --> R2
  SHARE -->|"token検証は<br>サーバー側"| EF --> PG
  OLD -.->|"単独報告書を後から<br>案件へ関連付け可"| PG
```

- 画面は `store.js` 経由でのみデータに触れる（画面ごとの別保存先を禁止＝指示書§8）。
- 外部共有の権限判定・非公開項目の除去は Edge Function（サーバー側）で実施。クライアントに高権限キーは置かない（指示書§9・§12）。

## 2. 画面一覧・画面遷移図（成果物3）

| ID | 画面 | 利用者 | 実装時期 |
|----|------|--------|---------|
| R1 | 報告書作成ツール（既存・無変更） | 現場担当 | 稼働中 |
| A1 | ホーム＝管理ダッシュボード（今日の現場 / 進行中・遅延・承認待ち・緊急の件数 / 担当者別未処理 / 長時間停滞） | 管理者・現場担当（表示縮退） | 計画1 |
| A2 | 案件一覧（検索・状態チップ・期限アラート） | 管理者・現場担当 | 計画1 |
| A3 | 案件詳細（タブ: 概要 / 工程・タスク / 写真 / 報告 / 原価※権限者のみ） | 管理者・現場担当（原価タブ非表示） | 計画1 |
| A4 | report.html（既存コピー＋案件連携モード＋選択式入力＋撮影チェックリスト） | 現場担当 | 計画1（連携は計画2） |
| A5 | 設定（ロール切替プレビュー・標準単価・モック初期化） | 管理者 | 計画1 |
| A6 | 工程テンプレート管理（一覧・複製・版管理） | 管理者 | 計画3 |
| A7 | 帳票プレビュー（社内日報 / クライアント報告書、下書き→承認→公開） | 管理者 | 計画3 |
| A8 | 外部共有ページ（配送追跡風の工程表示） | 元請・管理会社・オーナー・入居者 | 計画4 |
| A9 | 共有設定（案件別公開範囲・URL発行/失効） | 管理者 | 計画4 |

```mermaid
flowchart LR
  A1[A1 ホーム] --> A2[A2 案件一覧] --> A3[A3 案件詳細]
  A1 -->|今日の現場カード| A3
  A3 -->|報告書作成| A4[A4 report.html]
  A3 -->|共有URL発行| A9[A9 共有設定] -->|token URL| A8[A8 外部共有]
  A3 -->|帳票| A7[A7 帳票プレビュー]
  A1 --> A5[A5 設定]
  A5 --> A6[A6 テンプレ管理]
  R1[R1 既存ツール<br>単独利用] -.後から関連付け.-> A3
```

## 3. ER図（成果物4）

指示書§8のエンティティ名 → 採用名の対応:

| 指示書 | 採用名 | 備考 |
|---|---|---|
| organizations | **tenants** | テナント＝契約企業。retention_months / plan / 共有既定値を保持 |
| users | **profiles** | auth.users 1:1。role と原価閲覧権限は別フラグ（指示書§9） |
| projects | **cases** | 案件 |
| project_members | **case_members** | 計画3で追加（計画1〜2は assigned_to で代替） |
| workflow_templates / workflow_steps | 同名 | テンプレは版管理。案件作成時に **case_steps へ複製**（既存案件へ自動反映しない＝指示書§4） |
| tasks / task_events | 同名 | 停滞判定の中核。†下記 |
| work_sessions | 同名 | 作業開始/終了打刻。サーバー時刻と端末暫定時刻を区別 |
| reports / report_entries / report_documents | **case_reports** | type(日報/クライアント)・status(下書き/承認/公開/提出済)・version で1テーブルに統合。entries は content jsonb に内包 |
| attachments | **photos** | 撮影項目・公開承認フラグ付き |
| material_master | 同名 | 材料マスタ |
| labor_rates | **worker_rates** | 原価権限者のみRLSで閲覧可 |
| cost_entries | **costs** | 自動行（打刻×単価）+ 手動行 |
| share_policies / share_links | 同名 | 会社既定 + 案件別例外。会社ロック項目は案件でも開けない |
| audit_logs | 同名 | 通知・承認・変更履歴 |

```mermaid
erDiagram
  tenants ||--o{ profiles : ""
  tenants ||--o{ cases : ""
  tenants ||--o{ workflow_templates : ""
  tenants ||--o{ material_master : ""
  tenants ||--o{ share_policies : ""
  workflow_templates ||--o{ workflow_steps : "版ごと"
  cases ||--o{ case_steps : "テンプレ複製"
  case_steps ||--o{ tasks : ""
  tasks ||--o{ task_events : "状態遷移履歴"
  cases ||--o{ work_sessions : "打刻"
  cases ||--o{ photos : ""
  cases ||--o{ costs : ""
  cases ||--o{ case_reports : "日報/提出用"
  cases ||--o{ share_links : ""
  cases ||--o{ case_members : ""
  profiles ||--o| worker_rates : "原価権限者のみ"
  tenants ||--o{ audit_logs : ""

  cases {
    uuid id PK
    uuid tenant_id FK
    text case_no
    text property_name
    text room_no
    text address
    text status "scheduled|in_progress|submitted|confirmed"
    text work_type
    timestamptz scheduled_at
    date due_date
    text instructions
    text cause
    text next_actions
    uuid assigned_to FK
    int invoice_amount "整数円・原価権限のみ"
    uuid template_version FK
  }
  tasks {
    uuid id PK
    uuid case_id FK
    uuid step_id FK
    text title
    uuid assignee FK
    text assignee_company "協力会社名"
    text status "todo|doing|waiting_approval|waiting_other|waiting_schedule|on_hold|done"
    timestamptz due_at
    timestamptz started_at
    timestamptz completed_at
    text stall_reason
    uuid depends_on FK
    timestamptz updated_at
  }
  task_events {
    uuid id PK
    uuid task_id FK
    text from_status
    text to_status
    uuid actor FK
    timestamptz at
    text note
  }
  work_sessions {
    uuid id PK
    uuid case_id FK
    uuid user_id FK
    timestamptz started_at
    timestamptz ended_at
    text time_source "server|client_provisional"
    bool billable "現場滞在と請求対象を区別"
  }
  photos {
    uuid id PK
    uuid case_id FK
    text phase "before|during|after"
    text checklist_item "撮影項目"
    text caption
    text object_key "R2キー"
    bool approved_for_client "外部公開承認"
    uuid uploaded_by FK
    timestamptz created_at
  }
  costs {
    uuid id PK
    uuid case_id FK
    text category "labor|material|subcontract|travel|other"
    text label
    numeric qty
    int unit_price "整数円"
    int amount "整数円"
    bool is_auto "打刻×単価の自動行"
  }
  case_reports {
    uuid id PK
    uuid case_id FK
    text type "daily|client"
    text status "draft|approved|published|submitted"
    int version "提出済みの版を保持"
    jsonb content
    text pdf_key
    uuid approved_by FK
  }
  share_links {
    uuid id PK
    uuid case_id FK
    text token UK
    text role_key "motouke|kanri|owner|resident"
    timestamptz expires_at
    timestamptz revoked_at
  }
```

† **期限超過は保存しない派生状態**: `due_at < now() かつ 未完了` で判定（ビュー/計算層）。保存すると実時刻とずれるため。
† **停滞時間の定義**: 現状態での滞留 = now − 最後の task_events.at ／ 期限超過時間 = now − due_at ／ 保留時間 = task_events の on_hold 区間合計。計算は calc 層に隔離し、将来の営業時間カレンダー注入に対応。

## 4. データ台帳（成果物5・抜粋＝機密区分が要る項目を網羅。全項目版は計画2のマイグレーションと同時に自動生成）

機密区分: **公** = 外部共有可（案件設定に従う）/ **社** = 社内全員 / **密** = 原価閲覧権限者のみ

| 項目 | 型 | 正規取得元 | 更新責任 | 利用先 | 区分 | 帳票出力 |
|---|---|---|---|---|---|---|
| 物件名・号室 | text | cases | 管理者 | 全画面・両帳票 | 公 | 日報/提出用 |
| 住所 | text | cases | 管理者 | 案件詳細・report.html | 公(入居者には号室まで等設定可) | 日報/提出用 |
| 作業予定日・期限 | timestamptz | cases | 管理者 | ホーム・一覧・外部共有 | 公 | 日報/提出用 |
| 注意事項 | text | cases.instructions | 管理者 | 案件詳細・report.html | 社 | 日報のみ |
| 工程・進捗状態 | text | case_steps.status | システム/担当 | ホーム・外部共有 | 公 | 提出用 |
| タスク担当・停滞理由 | text | tasks | 担当者 | ダッシュボード | 社 | 日報のみ |
| 開始・終了打刻 | timestamptz | work_sessions | システム(サーバー時刻) | 原価自動行・日報 | 社 | 日報のみ |
| 写真（全） | R2 key | photos | 現場担当 | 案件詳細 | 社 | 日報 |
| 写真（承認済） | R2 key | photos.approved_for_client | 管理者が承認 | 外部共有・提出用 | 公 | 提出用 |
| 漏水原因・調査結果 | text | cases.cause | 現場担当→管理者確認 | 両帳票 | 公 | 日報/提出用 |
| 今後の対応 | text | cases.next_actions | 管理者 | 外部共有・提出用 | 公 | 日報/提出用 |
| 労務単価 | int | worker_rates | 原価権限者 | 原価計算のみ | 密 | 出力禁止 |
| 材料単価・数量 | int/numeric | material_master, costs | 原価権限者 | 原価タブ | 密(数量は日報に出す場合のみ社) | 日報(数量のみ) |
| 外注費・経費 | int | costs | 原価権限者 | 原価タブ | 密 | 出力禁止 |
| 受注金額（請求額） | int | cases.invoice_amount | 原価権限者 | 原価タブ | 密 | 出力禁止 |
| 粗利益・粗利率 | 計算値 | calc層(costs+invoice) | ― | 原価タブ | 密 | 出力禁止 |
| 内部メモ | text | audit_logs/notes | 各自 | 社内のみ | 社 | 出力禁止 |

**運用則（指示書§8）**: 新機能はこの台帳と store.js（共通サービス層）を必ず経由。台帳にない項目を画面から直接保存しない。

## 5. 権限マトリクス（成果物6）

○=可 / △=案件別設定で可（会社ロックで禁止可） / ×=不可（サーバー側で遮断）

| リソース | 管理者+原価権限 | 管理者 | 現場担当 | 元請 | 管理会社 | オーナー | 入居者 |
|---|---|---|---|---|---|---|---|
| 案件作成・編集 | ○ | ○ | ×(報告のみ) | × | × | × | × |
| 案件基本情報（物件・住所・予定） | ○ | ○ | ○(担当案件) | △ | △ | △ | △(限定) |
| 工程進捗（追跡UI） | ○ | ○ | ○ | △ | △ | △ | △ |
| タスク詳細・停滞状況 | ○ | ○ | ○(自分の分) | × | × | × | × |
| 写真（全） | ○ | ○ | ○(担当案件) | × | × | × | × |
| 写真（承認済のみ） | ○ | ○ | ○ | △ | △ | △ | × |
| 社内日報 | ○ | ○ | ○(自分の分) | × | × | × | × |
| クライアント報告書 | ○ | ○ | △ | △ | △ | △ | × |
| 原価・単価・粗利・請求額 | **○** | **×** | × | × | × | × | × |
| 原価の編集・単価マスタ | ○ | × | × | × | × | × | × |
| テンプレ・共有設定・ユーザー管理 | ○ | ○ | × | × | × | × | × |
| 監査ログ | ○ | ○ | × | × | × | × | × |

- **管理者ロールと原価閲覧権限は分離**（profiles.can_view_cost）。
- 外部4ロールは share_links.role_key + share_policies で判定。**判定と項目除去はサーバー側**（Edge Function がレスポンスから非公開項目を含めずに返す）。
- テナント境界: 全テーブル tenant_id + RLS で強制（別企業のデータは取得不能）。

## 6. 段階的実装計画（成果物8）

| 指示書Phase | 内容 | 対応する実行計画 | 状態 |
|---|---|---|---|
| **Phase 0** | 既存調査・バックアップ・現状テスト | 本成果物 + backupタグ + 本番200確認 | ✅ 完了 |
| **Phase 2・3のUI** | 親画面＋現場UIのプロトタイプ（モックデータ） | **計画1（改訂版）**: `docs/superpowers/plans/2026-10-11-app-ui-prototype-plan.md` を指示書に合わせ改訂 → ①白基調Stripe風 ②ホームに停滞・承認待ちウィジェット ③タスクに担当/期限/状態/停滞理由 ④report.html に選択式入力・撮影チェックリスト | **承認後すぐ着手** |
| **Phase 1** | 正規DB・共通API・認証・権限 | 計画2: Supabase新規PJ + R2 + RLS + Edge Functions + store.js をモック→実DBに差し替え + 打刻のサーバー時刻化 + オフライン再送 + 既存IndexedDB移行 | UIプロト確認後 |
| **Phase 4** | 社内日報・提出用PDF自動生成 | 計画3: case_reports + 既存jsPDF処理の再利用 + 承認フロー | 計画2後 |
| **Phase 5** | 外部共有・公開範囲 | 計画4: share_policies / share_links / 追跡UI / URL失効 | 計画3後 |
| **Phase 6** | 原価確定・停滞アラート・統合テスト | 計画5: 指示書§13の14項目を一括回帰 | 最終 |

**UI先行の理由（指示書Phase1→2の順と異なる点）**: ①本人方針「実際の操作画面を見ながら修正」 ②全画面が store.js 窓口しか知らないため、DB差し替えでUIに手戻りが出ない ③指示書§14「最初からすべてを一度に書き換えない」と整合。

**毎計画共通の回帰テスト**: `git diff origin/main -- index.html` が空であること（既存ツール無変更の機械的証明）+ 既存URLでPDF出力までの手動スモーク。

## 7. テスト割付（指示書§13 → 実行計画）

| テスト | 計画 |
|---|---|
| 既存URLで報告書作成が動く / 既存PDFが壊れていない | 全計画共通（回帰） |
| スマホで入力できる / 選択式の条件分岐 | 計画1 |
| 開始・終了時刻の記録 / 写真の案件関連付け / 通信切断と再送 | 計画2 |
| 状態遷移 / 停滞・期限超過時間の計算 | 計画1（calc層の単体テスト）+ 計画2（実DB） |
| 日報と提出用の情報分離 / 外部から原価取得不可 | 計画3・4（サーバー側テスト） |
| 別企業の案件取得不可 / 公開URL失効 | 計画2・4 |
| 既存データ移行・後方互換 | 計画2 |
