/**
 * GreenBridge — Worker 打刻モジュール
 * /public/js/worker/attendance.js
 */

const Attendance = (() => {
  let record = null  // 今日の attendance_records 行

  // ── ユーティリティ ───────────────────────────────────────────
  function todayLabel() {
    const d  = new Date()
    const dw = ['日','月','火','水','木','金','土'][d.getDay()]
    return `${d.getMonth() + 1}/${d.getDate()}（${dw}）`
  }

  function fmtTime(iso) {
    if (!iso) return '--:--'
    return new Date(iso).toLocaleTimeString('ja-JP', {
      hour:     '2-digit',
      minute:   '2-digit',
      timeZone: 'Asia/Tokyo',
    })
  }

  // ── 状態取得 ─────────────────────────────────────────────────
  async function fetchToday() {
    try {
      const res  = await fetch('/worker/api/clock/today')
      const json = await res.json()
      if (json.ok) record = json.data
      renderUI()
    } catch (e) {
      console.error('[attendance] fetchToday:', e)
    }
  }

  // ── UI 反映 ─────────────────────────────────────────────────
  function renderUI() {
    const statusEl = document.getElementById('cw-status')
    const inEl     = document.getElementById('cw-in')
    const outEl    = document.getElementById('cw-out')
    const dateEl   = document.getElementById('cw-date')
    const btnIn    = document.getElementById('cw-btn-in')
    const btnOut   = document.getElementById('cw-btn-out')

    if (dateEl) dateEl.textContent = todayLabel()
    if (!btnIn || !btnOut) return

    const clockedIn  = !!record?.clock_in
    const clockedOut = !!record?.clock_out

    if (!clockedIn) {
      // 未出勤：出勤ボタン ON / 退勤ボタン OFF
      if (statusEl) { statusEl.className = 'bdg ba'; statusEl.textContent = (window.gbLabel ? window.gbLabel('attNotIn','未出勤') : '未出勤') }
      if (inEl)  inEl.textContent  = '--:--'
      if (outEl) outEl.textContent = '--:--'
      btnIn.disabled  = false; btnIn.style.opacity  = '1'
      btnOut.disabled = true;  btnOut.style.opacity = '.4'

    } else if (clockedIn && !clockedOut) {
      // 出勤中：出勤ボタン OFF / 退勤ボタン ON
      if (statusEl) { statusEl.className = 'bdg bg'; statusEl.textContent = (window.gbLabel ? window.gbLabel('attWorking','出勤中') : '出勤中') }
      if (inEl)  inEl.textContent  = fmtTime(record.clock_in)
      if (outEl) outEl.textContent = '--:--'
      btnIn.disabled  = true;  btnIn.style.opacity  = '.4'
      btnOut.disabled = false; btnOut.style.opacity = '1'

    } else {
      // 退勤済み：両方 OFF
      if (statusEl) { statusEl.className = 'bdg bb'; statusEl.textContent = (window.gbLabel ? window.gbLabel('attDone','退勤済み') : '退勤済み') }
      if (inEl)  inEl.textContent  = fmtTime(record.clock_in)
      if (outEl) outEl.textContent = fmtTime(record.clock_out)
      btnIn.disabled  = true; btnIn.style.opacity  = '.4'
      btnOut.disabled = true; btnOut.style.opacity = '.4'
    }
  }

  // ── 打刻共通処理 ─────────────────────────────────────────────
  async function clockRequest(type) {
    const btnIn  = document.getElementById('cw-btn-in')
    const btnOut = document.getElementById('cw-btn-out')
    if (btnIn)  btnIn.disabled  = true
    if (btnOut) btnOut.disabled = true

    try {
      const res  = await fetch('/worker/api/clock', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type }),
      })
      const json = await res.json()

      if (json.ok) {
        await fetchToday()
        if (typeof toast === 'function') {
          toast(
            type === 'in' ? '✓ 出勤しました' : '✓ 退勤しました',
            fmtTime(json.time),
            'g'
          )
        }
      } else {
        if (typeof toast === 'function') toast('エラー', json.error, 'r')
        renderUI()
      }
    } catch (e) {
      if (typeof toast === 'function') toast('エラー', '通信エラーが発生しました', 'r')
      renderUI()
    }
  }

  return {
    init:     fetchToday,
    refresh:  renderUI,
    clockIn:  () => clockRequest('in'),
    clockOut: () => clockRequest('out'),
  }
})()

// worker.ejs の onclick から呼べるようグローバル公開
function clockIn()  { Attendance.clockIn()  }
function clockOut() { Attendance.clockOut() }
