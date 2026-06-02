-- ============================================================
-- GreenBridge — Migration 017: 外国人生活サポート（Phase7）
-- life_support: 生活情報（病院/市役所/ゴミ出し/銀行/携帯/FAQ/その他）。
--   会社・地域固有の情報を管理者が登録。company_id=NULL は全社共通の標準ガイド。
--   ワーカーは閲覧のみ（母国語ワンタップ翻訳はフロントの translationService で実施）。
-- ============================================================

CREATE TABLE IF NOT EXISTS life_support (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,  -- NULL=全社共通（標準ガイド）
  category    TEXT NOT NULL DEFAULT 'faq',   -- hospital/cityhall/garbage/bank/mobile/faq/other
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,                 -- 本文（日本語。ワーカー側で翻訳可）
  address     TEXT,                          -- 施設住所（病院・市役所等）
  phone       TEXT,                          -- 連絡先
  map_url     TEXT,                          -- 地図リンク等
  sort_order  INT NOT NULL DEFAULT 0,        -- 表示順
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS life_support_company_idx ON life_support (company_id, category, sort_order);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION life_support_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS life_support_touch_trg ON life_support;
CREATE TRIGGER life_support_touch_trg BEFORE UPDATE ON life_support
  FOR EACH ROW EXECUTE FUNCTION life_support_touch();

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE life_support ENABLE ROW LEVEL SECURITY;

-- admin/staff は自社分を CRUD。閲覧は自社分 + 全社共通(company_id IS NULL)。
DROP POLICY IF EXISTS "life_admin_all"  ON life_support;
DROP POLICY IF EXISTS "life_read"       ON life_support;
CREATE POLICY "life_admin_all" ON life_support
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));
CREATE POLICY "life_read" ON life_support
  FOR SELECT USING (company_id = my_company_id() OR company_id IS NULL);

-- ── 全国共通の標準ガイド（company_id=NULL）初期データ ──────────
INSERT INTO life_support (company_id, category, title, body, sort_order) VALUES
  (NULL, 'bank', '銀行口座の開設', '在留カード・パスポート・印鑑（またはサイン）・住民票を持って銀行窓口へ行きます。会社の在籍証明が必要な場合があります。ゆうちょ銀行は比較的開設しやすいです。', 10),
  (NULL, 'mobile', '携帯電話の契約', '在留カード・銀行口座（またはクレジットカード）・印鑑が必要です。在留期限が短いと契約できないことがあります。格安SIM（楽天モバイル・LINEMO等）は料金が安めです。', 10),
  (NULL, 'garbage', 'ゴミの出し方（基本）', 'ゴミは「燃えるゴミ」「燃えないゴミ」「資源（缶・びん・ペットボトル）」などに分別します。決められた曜日の朝に、指定の袋で出します。詳しい分別ルールは市役所の案内や会社の担当者に確認してください。', 10),
  (NULL, 'hospital', '病院のかかり方', '健康保険証を必ず持参します。初めての病院では問診票を書きます。症状を日本語で伝えるのが難しいときは、翻訳アプリや会社の担当者に相談してください。緊急時は119番（救急車）です。', 10),
  (NULL, 'cityhall', '市役所での手続き', '住所変更（引越し後14日以内）・国民健康保険・マイナンバーなどの手続きは市役所で行います。在留カードを持参してください。', 10),
  (NULL, 'faq', '緊急連絡先', '警察：110番 ／ 火事・救急：119番 ／ 会社の担当者にもすぐ連絡してください。', 1)
ON CONFLICT DO NOTHING;
