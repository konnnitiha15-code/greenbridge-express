-- ============================================================
-- GreenBridge — Migration 013: 会社情報の拡張（書類生成の精度向上）
-- 雇用契約書・労働条件通知書・誓約書等で必要な事業主情報を companies に追加。
-- すべて任意カラム（NULL許容）。未適用でも基本情報(name/address/phone/email)は保存可能。
-- ============================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS representative       TEXT,  -- 代表者氏名（例：山田 太郎）
  ADD COLUMN IF NOT EXISTS representative_title TEXT,  -- 代表者役職（例：代表取締役）
  ADD COLUMN IF NOT EXISTS registration_no      TEXT,  -- 法人番号 / 許可番号 等
  ADD COLUMN IF NOT EXISTS fax                  TEXT,  -- FAX番号
  ADD COLUMN IF NOT EXISTS postal_code          TEXT;  -- 郵便番号
