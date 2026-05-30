-- ============================================================
-- GreenBridge — Migration 011: 翻訳サービス
-- translationService の優先順位データソース:
--   1. company_dictionaries  会社辞書（会社固有の用語・定型）
--   2. industry_dictionaries 業界辞書（技能実習・製造等の共通用語）
--   3. translation_cache      API結果キャッシュ（同文の再APIを防ぐ）
--   4. （外部プロバイダ: MyMemory 等。DBではない）
-- 定型UI文言はフロントのローカル辞書で管理しDBは使わない。
-- ============================================================

-- ── 1. 翻訳キャッシュ ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS translation_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_lang   TEXT NOT NULL,
  target_lang   TEXT NOT NULL,
  source_hash   TEXT NOT NULL,           -- md5(source_text) で長文も一意化
  source_text   TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT 'mymemory',
  hit_count     INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_lang, target_lang, source_hash)
);
CREATE INDEX IF NOT EXISTS translation_cache_lookup_idx
  ON translation_cache (source_lang, target_lang, source_hash);

-- ── 2. 会社辞書（最優先・会社ごと）───────────────────────────
CREATE TABLE IF NOT EXISTS company_dictionaries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, source_lang, target_lang, source_text)
);
CREATE INDEX IF NOT EXISTS company_dict_lookup_idx
  ON company_dictionaries (company_id, source_lang, target_lang);

-- ── 3. 業界辞書（会社横断・industry 区分）──────────────────────
CREATE TABLE IF NOT EXISTS industry_dictionaries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry    TEXT NOT NULL DEFAULT 'general',  -- general / manufacturing / agriculture 等
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(industry, source_lang, target_lang, source_text)
);
CREATE INDEX IF NOT EXISTS industry_dict_lookup_idx
  ON industry_dictionaries (industry, source_lang, target_lang);

-- updated_at トリガ（cache / company_dict）
CREATE OR REPLACE FUNCTION translation_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS translation_cache_touch ON translation_cache;
CREATE TRIGGER translation_cache_touch BEFORE UPDATE ON translation_cache
  FOR EACH ROW EXECUTE FUNCTION translation_touch();
DROP TRIGGER IF EXISTS company_dict_touch ON company_dictionaries;
CREATE TRIGGER company_dict_touch BEFORE UPDATE ON company_dictionaries
  FOR EACH ROW EXECUTE FUNCTION translation_touch();

-- ── RLS ───────────────────────────────────────────────────────
-- 実運用は service_role（サーバー）経由で読み書きするため緩め。
-- translation_cache / industry は全社共通。company_dict のみ会社スコープ。
ALTER TABLE translation_cache     ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_dictionaries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_dictionaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tcache_read"   ON translation_cache;
CREATE POLICY "tcache_read" ON translation_cache
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "industry_read" ON industry_dictionaries;
CREATE POLICY "industry_read" ON industry_dictionaries
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "company_dict_admin" ON company_dictionaries;
DROP POLICY IF EXISTS "company_dict_read"  ON company_dictionaries;
CREATE POLICY "company_dict_admin" ON company_dictionaries
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));
CREATE POLICY "company_dict_read" ON company_dictionaries
  FOR SELECT USING (company_id = my_company_id());

-- ── 業界辞書 初期シード（技能実習でよく使う安全・業務用語の例）──
-- source は日本語、target は各言語。会社が上書きしたい場合は company_dictionaries で。
INSERT INTO industry_dictionaries (industry, source_lang, target_lang, source_text, target_text) VALUES
  ('general','ja','vi','ヒヤリハット','Sự cố suýt xảy ra'),
  ('general','ja','vi','残業','Làm thêm giờ'),
  ('general','ja','vi','有給休暇','Nghỉ phép có lương'),
  ('general','ja','en','ヒヤリハット','Near-miss incident'),
  ('general','ja','en','残業','Overtime'),
  ('general','ja','en','有給休暇','Paid leave')
ON CONFLICT (industry, source_lang, target_lang, source_text) DO NOTHING;
