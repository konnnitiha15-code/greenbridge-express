-- ============================================================
-- GreenBridge — Migration 018: 労務手続きワークフロー（Phase8）
-- hr_procedures        : 入社/退社などの定型手続きインスタンス（1ワーカー×1手続き）
-- hr_procedure_tasks   : 手続き内の個別ステップ（チェックリスト）
--   標準ステップは src/lib/procedures.js のテンプレートから作成時にコピー。
--   管理者(admin/staff)のみ利用。ワーカー側からは触らない。
-- ============================================================

-- ── 手続きインスタンス ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_procedures (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id    UUID NOT NULL REFERENCES workers(id)   ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'other',   -- onboarding / offboarding / other
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',    -- open / done / canceled
  due_date     DATE,
  note         TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_proc_company_idx ON hr_procedures (company_id, status);
CREATE INDEX IF NOT EXISTS hr_proc_worker_idx  ON hr_procedures (worker_id);

-- ── 手続き内タスク ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_procedure_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id UUID NOT NULL REFERENCES hr_procedures(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES companies(id)     ON DELETE CASCADE,
  label        TEXT NOT NULL,
  category     TEXT,                            -- 契約/在留/社保/給与/安全/総務 等
  status       TEXT NOT NULL DEFAULT 'todo',    -- todo / doing / done / skip
  assignee     TEXT,
  due_date     DATE,
  sort_order   INT NOT NULL DEFAULT 0,
  note         TEXT,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_task_proc_idx ON hr_procedure_tasks (procedure_id, sort_order);

-- ── updated_at 自動更新 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION hr_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS hr_proc_touch_trg ON hr_procedures;
CREATE TRIGGER hr_proc_touch_trg BEFORE UPDATE ON hr_procedures
  FOR EACH ROW EXECUTE FUNCTION hr_touch();

DROP TRIGGER IF EXISTS hr_task_touch_trg ON hr_procedure_tasks;
CREATE TRIGGER hr_task_touch_trg BEFORE UPDATE ON hr_procedure_tasks
  FOR EACH ROW EXECUTE FUNCTION hr_touch();

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE hr_procedures      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_procedure_tasks ENABLE ROW LEVEL SECURITY;

-- admin/staff は自社分のみ全操作可。ワーカーはアクセス不可。
DROP POLICY IF EXISTS "hr_proc_admin_all" ON hr_procedures;
CREATE POLICY "hr_proc_admin_all" ON hr_procedures
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "hr_task_admin_all" ON hr_procedure_tasks;
CREATE POLICY "hr_task_admin_all" ON hr_procedure_tasks
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));
