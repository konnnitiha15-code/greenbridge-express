# GreenBridge — プロジェクト運用ルール

## 📋 HANDOFF.md 自動更新ルール（重要）

機能の実装が一段落したら、**指示がなくても自動的に** `HANDOFF.md` を更新すること。
特に以下のタイミングで必ず更新する:

- 新機能の実装が完了し、本番デプロイ（git push → Vercel PROMOTED）した後
- 新しいマイグレーション（0XX_*.sql）を作成・実行した後
- 重要なバグ修正や設計変更を加えた後

### 更新する項目
1. **実装済み機能リスト**（管理者側 / ワーカー側）に追記
2. **Supabase テーブル一覧**（新テーブルがあれば）
3. **マイグレーション履歴**（新しい 0XX を追記し、実行済みか明記）
4. **セッション履歴サマリー**（日付セクションを設けてマイルストーンを追記）
5. **最終更新日** と **最終コミットハッシュ**（`git rev-parse --short HEAD` で取得）
6. **次にやるべきタスク**（完了したものは打ち消し線、新たに見えた課題を追加）

更新は簡潔に。冗長な再記述は避け、差分のみ追記する。

## 🛠 デプロイ手順（確立済み）
1. `git add -A && git commit -m "..."` （末尾に Co-Authored-By: Claude）
2. `git push` → Vercel が自動デプロイ
3. マイグレーションが絡む場合は **Supabase SQL Editor で実行をユーザーに依頼**（SQL全文を提示）
4. 本番ログ確認: `npx vercel logs <url> --since 3m --token <token>`

## 🔑 主要な技術的決定（詳細は HANDOFF.md）
- 完全ステートレス（express-session 廃止、Cookie ベース flash）
- 認証は Cookie のみ（admin: sb-access-token / worker: gb-worker-token）
- Supabase クエリビルダは `.catch()` 不可 → `try { await q } catch {}` を使う
- API 認証失敗は 302 ではなく 401 JSON を返す（middleware/auth.js）
- 新フロント変更時は sw.js の CACHE_VERSION と spa.ejs の ?v= を更新（キャッシュバスト）
- タイムゾーンは Asia/Tokyo 固定

詳細な現状・スキーマ・残タスクは必ず `HANDOFF.md` を参照すること。
