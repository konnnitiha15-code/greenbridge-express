-- ============================================================
-- GreenBridge — Migration 020: モジュール表示フラグ（会社単位の機能ON/OFF）
--   companies.module_flags JSONB。
--   空 {} = 全モジュールON（既定）。例: {"filings": false, "visa": false} = 非表示。
--   未指定キーは「ON」とみなす（フロントの isModuleOn 既定ON と一致）。
--   既存データは変更しない（ADD COLUMN のみ）。
-- ============================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS module_flags JSONB NOT NULL DEFAULT '{}'::jsonb;
