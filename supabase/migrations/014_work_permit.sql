-- ============================================================
-- GreenBridge — Migration 014: 資格外活動許可（在留資格管理 / Phase4）
-- workers に資格外活動許可の有無と期限を追加。任意カラム（NULL許容）。
-- 未適用でも在留カード・パスポート期限の管理は動作する。
-- ============================================================

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS work_permit         BOOLEAN,  -- 資格外活動許可の有無
  ADD COLUMN IF NOT EXISTS work_permit_expire  DATE;     -- 資格外活動許可の期限
