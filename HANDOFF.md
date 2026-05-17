# GreenBridge — 引継ぎドキュメント
> 新セッション開始時にこのファイルを最初に読ませてください

---

## プロジェクト概要

**技能実習生管理プラットフォーム「GreenBridge」**

- 管理者側（PC）は実装済み
- 次のタスク：**作業者（実習生）側のスマホアプリ追加**

---

## 技術スタック

| 項目 | 内容 |
|------|------|
| ランタイム | Node.js |
| サーバー | Express.js v4 |
| テンプレート | EJS（サーバーサイドレンダリング） |
| CSS | カスタム Design System v2.0（CSSトークン） |
| JS | バニラJS（フレームワークなし） |
| DB / Auth | Supabase |
| ファイル保存 | ローカルディスク `public/uploads/` + Supabase Storage（オプション） |
| メタデータ | `data/docs_local.json`（DBフォールバック） |
| 開発 | nodemon（`src/` のみ監視） |

---

## プロジェクトパス

```
C:\Users\mayniti\Downloads\greenbridge-express\
```

## サーバー起動

```bash
npm run dev   # nodemon で起動（ポート 3000）
```

---

## ディレクトリ構成

```
greenbridge-express/
├── src/
│   ├── app.js                  # Expressエントリーポイント
│   ├── middleware/
│   │   └── auth.js             # requireAuth ミドルウェア（Supabase Auth）
│   └── routes/
│       ├── auth.js             # ログイン・ログアウト
│       ├── spa.js              # 管理者SPA 全ルート + AJAX API ★メインファイル
│       ├── workers.js          # (旧) workers CRUD
│       ├── documents.js        # (旧) documents CRUD
│       ├── companies.js        # (旧) companies CRUD
│       ├── dashboard.js        # (旧) dashboard
│       └── settings.js        # (旧) settings
├── views/
│   └── spa.ejs                 # 管理者SPA HTML（全画面1ファイル）
├── public/
│   ├── css/style.css           # Design System v2.0
│   ├── js/app.js               # フロントエンドJS（全機能、約2000行）
│   └── uploads/documents/      # アップロードファイル
├── data/
│   └── docs_local.json         # 書類メタデータのローカル永続化
├── .env                        # 環境変数
├── nodemon.json                # src/ のみ監視
└── package.json
```

---

## 環境変数（.env）

```env
SUPABASE_URL=https://lbwiusqlzxlkldtvnquf.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...（既存）
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...（既存）
SESSION_SECRET=greenbridge-secret-2025
PORT=3000
```

---

## Supabase プロジェクト

- **Project ref:** `lbwiusqlzxlkldtvnquf`
- **SQL Editor:** https://supabase.com/dashboard/project/lbwiusqlzxlkldtvnquf/sql/new

---

## DBスキーマ（作成済みテーブル）

```sql
-- 作成済み
profiles           -- ユーザープロフィール（auth.users 拡張）
companies          -- 会社
workers            -- 実習生
documents          -- 書類
attendance_records -- 勤怠記録 ★最近追加

-- シフト（Supabase未作成、localStorageで代替中）
shifts
shift_requests
```

### attendance_records（最近追加）

```sql
CREATE TABLE attendance_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id   UUID NOT NULL REFERENCES workers(id)  ON DELETE CASCADE,
  work_date   DATE NOT NULL,
  clock_in    TIMESTAMPTZ,
  clock_out   TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'absent',  -- present/late/absent/holiday
  memo        TEXT,
  source      TEXT DEFAULT 'admin',  -- admin/worker/qr/gps ★将来拡張用
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
-- UNIQUE: worker_id + work_date（1日1レコード）
```

### RLS ルール（全テーブル共通）

```sql
-- 同じ company_id のユーザーのみアクセス可能
company_id = (SELECT company_id FROM profiles WHERE id = auth.uid())
```

---

## ロール定義

| ロール | 権限 |
|--------|------|
| `admin` | 全機能フルアクセス・ロール変更 |
| `manager` | 管理機能一部・承認 |
| `staff` | 閲覧・書類アップロード |
| `trainee` | 技能実習生（限定閲覧）|

---

## 管理者SPA（実装済み画面）

| 画面 | SP() ID | 機能 |
|------|---------|------|
| ホーム | `home` | KPI・期限アラート・勤怠統計 |
| チャット | `chat` | 個別メッセージ |
| 実習生管理 | `workers` | CRUD・書類タブ |
| 書類管理 | `docs` | カテゴリ分け・フィルタ・PDF閲覧 |
| タスク | `tasks` | カンバン・月ナビ |
| グループチャット | `gchat` | グループ管理 |
| 動画マニュアル | `videos` | 動画一覧 |
| 日報 | `nippo` | 日報管理 |
| シフト | `shift` | 月次シフト表 |
| **勤怠管理** | `attend` | **管理者専用・CRUD** |
| 権限管理 | `roles` | ロール変更 |
| 設定 | `settings` | アカウント・通知 |

---

## API エンドポイント（`/app/api/`）

| Method | Path | 機能 |
|--------|------|------|
| GET/POST | `/api/workers` | 実習生一覧・追加 |
| PUT/DELETE | `/api/workers/:id` | 更新・削除 |
| POST | `/api/documents/upload` | ファイルアップロード（multer） |
| PUT | `/api/documents/:id/worker` | 実習生紐付け |
| DELETE | `/api/documents/:id` | 削除 |
| GET/PUT/DELETE | `/api/shifts` | シフト |
| POST/PUT | `/api/shift-requests` | シフト申請 |
| GET | `/api/attendance` | 勤怠一覧（管理者のみ） |
| GET | `/api/attendance/stats` | 本日の勤怠統計 |
| POST | `/api/attendance` | 勤怠登録（upsert） |
| PUT | `/api/attendance/:id` | 勤怠更新 |
| DELETE | `/api/attendance/:id` | 勤怠削除 |
| GET/PUT | `/api/users` | ユーザー一覧・更新 |
| PUT | `/api/users/:id/role` | ロール変更（admin専用） |

---

## データ永続化戦略

| データ | 保存先 |
|--------|--------|
| 書類ファイル | `public/uploads/documents/` + Supabase Storage（オプション） |
| 書類メタデータ | `data/docs_local.json`（常時） + Supabase `documents`（あれば） |
| シフトデータ | localStorage + Supabase `shifts`（テーブルあれば） |
| チャット履歴 | localStorage（ワーカーIDごと） |
| グループ情報 | localStorage |
| 勤怠データ | Supabase `attendance_records` |

---

## 書類カテゴリ（10種類）

```js
contract, visa, passport, insurance, salary,
safety, technical_intern, specified_skilled, tax, other
```

---

## 次のタスク：作業者側スマホアプリ

### やりたいこと

既存の Express サーバーに `/worker/*` ルートを追加して、
実習生（trainee）が使うモバイルファーストのWebアプリを作る。

### 将来追加予定の機能

- 打刻（出退勤）→ `attendance_records` の source を `'worker'` にする
- QR打刻
- GPS打刻
- シフト確認
- 書類閲覧
- チャット
- 多言語対応（vi/id/tl/my/zh/km）

### 実装方針

1. `src/routes/worker.js` を新規作成
2. `views/worker.ejs` を新規作成（モバイルファーストHTML）
3. `public/css/worker.css` を新規作成（モバイル最適化）
4. `public/js/worker.js` を新規作成
5. `src/app.js` に `app.use('/worker', workerRoutes)` を追加

### 認証方針

- 既存の Supabase Auth（Cookie）をそのまま使う
- `requireAuth` ミドルウェアを流用
- ロールが `trainee` のユーザーが主なターゲット

### DB 追加不要

- `attendance_records` テーブルは作成済み
- `source = 'worker'` にするだけで打刻元を区別できる

---

## CSSデザイントークン（主要変数）

```css
--bg, --bg2     /* 背景 */
--sf, --s2      /* サーフェス */
--bd, --bd2     /* ボーダー */
--tx, --t2, --t3 /* テキスト */
--gn, --gd      /* Primary Green */
--red, --amb, --blu /* セマンティック */
--r, --r-sm, --r-lg, --r-full /* 角丸 */
--sh, --sh-md   /* シャドウ */
```

---

## 注意事項

- `nodemon.json` は `src/` のみ監視（`public/` `data/` は除外）→ アップロード時の無限再起動防止
- `multer` は `memoryStorage` → ローカルディスクに手動保存
- `isTableMissing(err)` でテーブル不在エラーをフォールバック
- 管理者ルートは `req.profile?.role !== 'admin'` でガード

---

*作成日: 2026-05-17*
