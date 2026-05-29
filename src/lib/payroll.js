// ============================================================
// GreenBridge — 給与計算エンジン
// 打刻データ(attendance_records) + 賃金設定(wage_settings) から
// 月次給与を算出する。労基法準拠の割増を動的計算。
//
// 設計方針:
//  ・タイムゾーンは Asia/Tokyo に固定
//  ・労働時間は丸めルール(15分切り捨て等)を適用
//  ・残業(8h/日超)・深夜(22:00-5:00)・休日 を自動判定
//  ・計算明細(breakdown)を JSON で返し、payslip にスナップショット保存
//  ・純粋関数（DB非依存）→ テスト容易
// ============================================================

const JST_OFFSET_MIN = 9 * 60  // UTC+9

// UTC の Date を JST の {y,m,d,hour,min,totalMin(0時からの分)} に分解
function toJstParts(date) {
  const t = new Date(date)
  // UTC ミリ秒に JST オフセットを足してから UTC ゲッターで読む
  const jst = new Date(t.getTime() + JST_OFFSET_MIN * 60 * 1000)
  return {
    y:    jst.getUTCFullYear(),
    m:    jst.getUTCMonth() + 1,
    d:    jst.getUTCDate(),
    dow:  jst.getUTCDay(),            // 0=日曜
    hour: jst.getUTCHours(),
    min:  jst.getUTCMinutes(),
    totalMin: jst.getUTCHours() * 60 + jst.getUTCMinutes(),
  }
}

// 丸めルール適用（分単位）
function applyRounding(minutes, unit, mode) {
  if (!unit || unit <= 0) return minutes
  const q = minutes / unit
  let rounded
  if (mode === 'ceil')       rounded = Math.ceil(q)
  else if (mode === 'round') rounded = Math.round(q)
  else                       rounded = Math.floor(q)  // default floor
  return rounded * unit
}

// 円未満を四捨五入（金額確定用）
function yen(v) { return Math.round(v) }

// ── 1日分の労働時間を区分ごとに分解 ────────────────────────────
// 返却: { workedMin, regularMin, overtimeMin, nightMin, isHoliday }
//   nightMin は「深夜帯に重なった労働時間」（残業との重複も含む実時間）
function calcDayBreakdown(record, wage) {
  const result = { workedMin: 0, regularMin: 0, overtimeMin: 0, nightMin: 0, isHoliday: false, skipped: false }

  if (!record.clock_in || !record.clock_out) { result.skipped = true; return result }

  const inMs  = new Date(record.clock_in).getTime()
  const outMs = new Date(record.clock_out).getTime()
  if (!(outMs > inMs)) { result.skipped = true; return result }

  // 拘束時間（分）
  let grossMin = Math.round((outMs - inMs) / 60000)
  // 休憩控除
  const breakMin = Math.max(0, wage.break_minutes || 0)
  let netMin = Math.max(0, grossMin - breakMin)
  // 丸め
  netMin = applyRounding(netMin, wage.rounding_unit, wage.rounding_mode)
  result.workedMin = netMin

  // 休日判定: status が 'holiday' か、日曜出勤（簡易）。会社の休日カレンダーは将来拡張。
  const inParts = toJstParts(record.clock_in)
  result.isHoliday = (record.status === 'holiday') || (inParts.dow === 0)

  // 残業: 1日8h(480分)超
  const STD_DAY = 8 * 60
  if (result.isHoliday) {
    // 休日労働は全時間を holiday 扱い（残業計算とは別系統）
    result.regularMin  = 0
    result.overtimeMin = 0
  } else {
    result.regularMin  = Math.min(netMin, STD_DAY)
    result.overtimeMin = Math.max(0, netMin - STD_DAY)
  }

  // 深夜帯(22:00-5:00)に重なる労働時間を算出（分単位スキャン、丸め前のin/outで判定）
  result.nightMin = calcNightMinutes(inMs, outMs, breakMin)

  return result
}

// 深夜帯(22:00-05:00 JST)に重なる労働分数を計算
// 休憩は深夜帯から優先控除しない簡易版（実時間比例ではなく重なり時間で算出）
function calcNightMinutes(inMs, outMs, breakMin) {
  let night = 0
  const stepMs = 60000  // 1分刻み
  for (let t = inMs; t < outMs; t += stepMs) {
    const h = toJstParts(t).hour
    if (h >= 22 || h < 5) night++
  }
  // 休憩分を全体から比例控除（深夜にかかる休憩の概算）
  const totalMin = Math.round((outMs - inMs) / 60000)
  if (totalMin > 0 && breakMin > 0) {
    const ratio = night / totalMin
    night = Math.max(0, night - Math.round(breakMin * ratio))
  }
  return night
}

// ── 月次給与計算 ────────────────────────────────────────────────
// worker:   { id, name, ... }
// wage:     wage_settings 1件
// records:  対象月の attendance_records 配列
// period:   'YYYY-MM'
// 返却: payslip 相当のオブジェクト（金額・時間・breakdown・snapshot）
function calcPayroll({ worker, wage, records, period }) {
  const days = []
  let regularMin = 0, overtimeMin = 0, nightMin = 0, holidayMin = 0, workDays = 0

  for (const rec of (records || [])) {
    const day = calcDayBreakdown(rec, wage)
    if (day.skipped) continue
    workDays++
    if (day.isHoliday) {
      holidayMin += day.workedMin
    } else {
      regularMin  += day.regularMin
      overtimeMin += day.overtimeMin
    }
    nightMin += day.nightMin

    days.push({
      date: rec.work_date,
      status: rec.status,
      isHoliday: day.isHoliday,
      workedMin: day.workedMin,
      regularMin: day.isHoliday ? 0 : day.regularMin,
      overtimeMin: day.isHoliday ? 0 : day.overtimeMin,
      nightMin: day.nightMin,
    })
  }

  // 時間単価を決定（時給 or 月給→時間換算）
  let hourlyRate
  if (wage.wage_type === 'monthly') {
    const std = wage.monthly_standard_hours || 160
    hourlyRate = std > 0 ? (wage.base_amount / std) : 0
  } else {
    hourlyRate = wage.base_amount || 0
  }

  const toH = (min) => min / 60
  const regularHours  = toH(regularMin)
  const overtimeHours = toH(overtimeMin)
  const nightHours    = toH(nightMin)
  const holidayHours  = toH(holidayMin)

  // 金額計算
  let basePay, overtimePay, holidayPay
  if (wage.wage_type === 'monthly') {
    // 月給制: 基本給は固定。残業・休日は時間単価ベースで加算。
    basePay     = wage.base_amount || 0
    overtimePay = yen(hourlyRate * overtimeHours * (wage.overtime_rate || 1.25))
    holidayPay  = yen(hourlyRate * holidayHours  * (wage.holiday_rate  || 1.35))
  } else {
    // 時給制: 通常時間×時給 + 残業 + 休日
    basePay     = yen(hourlyRate * regularHours)
    overtimePay = yen(hourlyRate * overtimeHours * (wage.overtime_rate || 1.25))
    holidayPay  = yen(hourlyRate * holidayHours  * (wage.holiday_rate  || 1.35))
  }
  // 深夜加算（割増の加算分 0.25 等）。night_rate は 1.25 なので加算分は (rate-1)
  const nightExtra = Math.max(0, (wage.night_rate || 1.25) - 1)
  const nightPay   = yen(hourlyRate * nightHours * nightExtra)

  // 手当・控除
  const allowances = Array.isArray(wage.allowances) ? wage.allowances : []
  const deductions = Array.isArray(wage.deductions) ? wage.deductions : []
  const allowanceTotal = allowances.reduce((s, a) => s + (Number(a.amount) || 0), 0)
  const deductionTotal = deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0)

  const grossPay = basePay + overtimePay + nightPay + holidayPay + allowanceTotal
  const netPay   = grossPay - deductionTotal

  // 賃金スナップショット（確定後の不変性のため）
  const wageSnapshot = {
    wage_type: wage.wage_type,
    base_amount: wage.base_amount,
    hourly_rate_used: yen(hourlyRate * 100) / 100,
    overtime_rate: wage.overtime_rate,
    night_rate: wage.night_rate,
    holiday_rate: wage.holiday_rate,
    monthly_standard_hours: wage.monthly_standard_hours,
    break_minutes: wage.break_minutes,
    rounding_unit: wage.rounding_unit,
    rounding_mode: wage.rounding_mode,
    allowances,
    deductions,
  }

  const breakdown = {
    timezone: 'Asia/Tokyo',
    period,
    hourly_rate: wageSnapshot.hourly_rate_used,
    days,
    totals: {
      work_days: workDays,
      regular_hours: round2(regularHours),
      overtime_hours: round2(overtimeHours),
      night_hours: round2(nightHours),
      holiday_hours: round2(holidayHours),
    },
    pay: { basePay, overtimePay, nightPay, holidayPay, allowanceTotal, deductionTotal },
  }

  return {
    company_id: worker.company_id,
    worker_id:  worker.id,
    period,
    work_days:      workDays,
    regular_hours:  round2(regularHours),
    overtime_hours: round2(overtimeHours),
    night_hours:    round2(nightHours),
    holiday_hours:  round2(holidayHours),
    base_pay:        basePay,
    overtime_pay:    overtimePay,
    night_pay:       nightPay,
    holiday_pay:     holidayPay,
    allowance_total: allowanceTotal,
    deduction_total: deductionTotal,
    gross_pay:       grossPay,
    net_pay:         netPay,
    wage_snapshot:   wageSnapshot,
    breakdown,
  }
}

function round2(v) { return Math.round(v * 100) / 100 }

// デフォルト賃金設定（wage_settings 未登録時のフォールバック）
function defaultWage(companyId, workerId) {
  return {
    company_id: companyId,
    worker_id: workerId,
    wage_type: 'hourly',
    base_amount: 0,
    overtime_rate: 1.25,
    night_rate: 1.25,
    holiday_rate: 1.35,
    monthly_standard_hours: 160,
    break_minutes: 60,
    rounding_unit: 15,
    rounding_mode: 'floor',
    allowances: [],
    deductions: [],
  }
}

module.exports = {
  calcPayroll,
  calcDayBreakdown,
  calcNightMinutes,
  applyRounding,
  toJstParts,
  defaultWage,
}
