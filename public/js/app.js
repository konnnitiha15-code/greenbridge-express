// ══════════════════════════════════════════════════════════════════════════════
// GreenBridge Dashboard — SPA Logic (data injected from server)
// ══════════════════════════════════════════════════════════════════════════════
// WORKERS, DOCS, GB_USER are injected by the server in <script> tags above this file

let IS_ADMIN = (typeof GB_USER !== 'undefined' && GB_USER?.role === 'admin');
let AW=null, AWD=null, AD=null, AG=null, AV=null, AN=null, wFilter='all';
let currentDoc=null, docEditing=false, translating=false;

// ── チャット履歴（Supabase messages テーブルから取得・localStorage廃止） ──────
const HISTORY = {};  // セッション中のメモリキャッシュ（DB が正）
WORKERS.forEach(w => { HISTORY[w.id] = [{t:'sys',txt:'チャット開始'}]; });
function _saveHistory(){} // 廃止（後方互換のため空関数を残す）

// チャットポーリング管理
let _chatPollTimer = null;
let _chatLastTs    = {};  // worker.id → 最後に取得したメッセージのcreated_at
let _rtMsgSub      = null;  // Realtime購読
let _rtShiftsSub   = null;
let _rtGroupSub    = null;

// ── グループ (localStorage永続化) ──────────────────────────────────────────

const TASKS=[
  {id:'t1',title:'新人研修資料の翻訳',priority:'high',due:'2025/01/15',status:'todo',assignees:[{init:'NG',bg:'#d1fae5',tc:'#065f46'}]},
  {id:'t2',title:'安全教育テスト実施',priority:'medium',due:'2025/01/20',status:'progress',assignees:[{init:'SA',bg:'#dbeafe',tc:'#1e40af'},{init:'MR',bg:'#fee2e2',tc:'#991b1b'}]},
  {id:'t3',title:'勤怠データ確認',priority:'low',due:'2025/01/10',status:'review',assignees:[{init:'WA',bg:'#fef3c7',tc:'#92400e'}]},
  {id:'t4',title:'ビザ更新手続き確認',priority:'high',due:'2025/02/01',status:'todo',assignees:[]},
  {id:'t5',title:'宿舎点検',priority:'medium',due:'2025/01/25',status:'done',assignees:[]},
];

// グループ：DBから取得（localStorage廃止）
let GROUPS = [];
let _groupPollTimer = null;
let _gMsgLastTs = {};   // group.id → 最後に取得したメッセージのcreated_at

function _saveGroups(){}  // 廃止（後方互換のため空関数を残す）

async function loadGroups(){
  try{
    const res  = await fetch('/app/api/groups');
    const json = await res.json();
    if(!json.ok) return;
    GROUPS = (json.groups||[]).map(g => ({
      id:      g.id,
      name:    g.name,
      ico:     g.icon     || '👥',
      bg:      g.bg_color || '#e0e7ff',
      desc:    g.description || '',
      members: g.members || [],
      memberCount: g.memberCount || 0,
      unread:  0,
      prev:    '',
      time:    '',
      msgs:    [],
    }));
  }catch(e){ console.warn('[groups] load error:', e); }
}

const VIDEOS=[
  {id:'v1',title:'溶接作業 安全確認手順',cat:'safety',dur:'8:24',views:45,langs:['ja','vi'],emoji:'🔧',desc:'溶接作業前に必ず確認してください。'},
  {id:'v2',title:'緊急時対応フロー',cat:'safety',dur:'5:32',views:52,langs:['ja','vi','id','tl'],emoji:'🚨',desc:'緊急事態発生時の対応手順を説明します。'},
  {id:'v3',title:'入社オリエンテーション',cat:'training',dur:'15:00',views:30,langs:['ja','vi','id','tl','my'],emoji:'📚',desc:'会社のルールと基本情報を説明します。'},
];

let NIPPOS = []; // Supabase daily_reports テーブルから取得

const SHIFT_TABLE_DATA = {};
const SHIFT_COLOR_MAP={
  '早':{bg:'#dcfce7',color:'#166534',label:'早番'},
  '遅':{bg:'#dbeafe',color:'#1e40af',label:'遅番'},
  '夜':{bg:'#fef3c7',color:'#92400e',label:'夜勤'},
  '休':{bg:'#f3f4f6',color:'#6b7280',label:'休み'},
  '有':{bg:'#e0e7ff',color:'#3730a3',label:'有休'},
  '欠':{bg:'#fee2e2',color:'#991b1b',label:'欠勤'},
  niku:{bg:'#dbeafe',color:'#1e40af',label:'日勤'},
  hayaban:{bg:'#dcfce7',color:'#166534',label:'早番'},
  osoi:{bg:'#fef3c7',color:'#92400e',label:'遅番'},
  rest:{bg:'#f3f4f6',color:'#6b7280',label:'休み'}
};

const DOC_TEMPLATES={
  employment:{name:'雇用条件通知書',icon:'📋',description:'雇用条件を通知する書類',
    gen:(w)=>`<div class="title">雇用条件通知書</div>
<table><tr><th colspan="2" style="text-align:center;background:#e6f9f0">被雇用者情報</th></tr>
<tr><th>氏名</th><td>${w.name}</td></tr>
<tr><th>国籍</th><td>${w.nationality||'-'} ${w.flag||''}</td></tr>
<tr><th>在留資格</th><td>${w.visaType||'-'}</td></tr>
<tr><th>在留カード番号</th><td>${w.residenceCard||'-'}</td></tr>
</table>
<table><tr><th colspan="2" style="text-align:center;background:#e6f9f0">雇用条件</th></tr>
<tr><th>職種</th><td>${w.job||'-'}</td></tr>
<tr><th>所属</th><td>${w.dept||'-'}</td></tr>
<tr><th>契約期間</th><td>${w.entryDate||'-'} 〜 ${w.contractEnd||'-'}</td></tr>
<tr><th>月額賃金</th><td>${w.salary||'-'}</td></tr>
<tr><th>保険</th><td>${w.insurance||'-'}</td></tr>
</table>
<p style="margin-top:20px;text-align:right">日付：${new Date().toLocaleDateString('ja-JP')}</p>
<p style="text-align:right">事業主：${typeof GB_COMPANY!=='undefined'?GB_COMPANY:'（会社名）'}</p>`},
  residenceCard:{name:'在留カード届出書',icon:'🪪',description:'在留カードの届出書類',
    gen:(w)=>`<div class="title">在留カード届出書</div>
<table>
<tr><th>氏名</th><td>${w.name}</td></tr>
<tr><th>国籍</th><td>${w.nationality||'-'}</td></tr>
<tr><th>在留カード番号</th><td>${w.residenceCard||'-'}</td></tr>
<tr><th>在留資格</th><td>${w.visaType||'-'}</td></tr>
<tr><th>在留期限</th><td>${w.residenceExpire||'-'}</td></tr>
<tr><th>住所</th><td>${w.address||'-'}</td></tr>
</table>
<p style="margin-top:20px;text-align:right">届出日：${new Date().toLocaleDateString('ja-JP')}</p>`},
  attendance:{name:'出勤簿',icon:'📊',description:'月次の出勤記録',
    gen:(w)=>{
      const now=new Date();const y=now.getFullYear();const m=now.getMonth();
      const mName=`${y}年${m+1}月`;
      const days=new Date(y,m+1,0).getDate();
      const dayNames=['日','月','火','水','木','金','土'];
      let rows='';
      for(let i=1;i<=days;i++){
        const dt=new Date(y,m,i);const dn=dayNames[dt.getDay()];
        const isHoliday=dt.getDay()===0||dt.getDay()===6;
        rows+=`<tr style="${isHoliday?'background:#f9fafb':''}"><td>${i}</td><td>${dn}</td><td>${isHoliday?'休':'8:00'}</td><td>${isHoliday?'休':'17:00'}</td><td>${isHoliday?'':'8:00'}</td><td>${isHoliday?'':'0:00'}</td><td></td></tr>`;
      }
      return `<div class="title">出勤簿 — ${mName}</div>
<table><tr><th>氏名</th><td>${w.name}</td><th>所属</th><td>${w.dept||'-'}</td></tr></table>
<table><tr><th>日</th><th>曜日</th><th>出勤</th><th>退勤</th><th>実働</th><th>残業</th><th>備考</th></tr>${rows}</table>
<p style="margin-top:12px;text-align:right">確認者：＿＿＿＿＿＿　印</p>`;
    }}
};

// ── UI制御 ──────────────────────────────────────────────────────────────────
const _TOAST_CFG = {
  g: { bg:'var(--gbg)', border:'var(--glt)', icon:'#059669', ico:'✓', titleColor:'var(--gd)' },
  r: { bg:'var(--rbg)', border:'var(--rbd)', icon:'var(--red)', ico:'✕', titleColor:'var(--red)' },
  a: { bg:'var(--abg)', border:'var(--abd)', icon:'var(--amb)', ico:'!', titleColor:'#92400e' },
  b: { bg:'var(--bbg)', border:'var(--bbd)', icon:'var(--blu)', ico:'i', titleColor:'var(--blu)' },
};
function toast(title, msg, type){
  const c = _TOAST_CFG[type||'g'] || _TOAST_CFG.g;
  const d = document.createElement('div');
  d.className = 'toast';
  d.style.cssText = `background:${c.bg};border-color:${c.border}`;
  d.innerHTML = `
    <div class="toast-ico" style="background:${c.icon};color:#fff;font-size:13px;font-weight:700">${c.ico}</div>
    <div class="toast-body">
      <div class="toast-title" style="color:${c.titleColor}">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--t3);font-size:16px;padding:0;line-height:1;flex-shrink:0;align-self:flex-start">×</button>`;
  const container = document.getElementById('toasts');
  if(container) container.appendChild(d);
  setTimeout(()=>{d.style.animation='tout .18s ease forwards';setTimeout(()=>d.remove(),200);}, 4000);
}

// 通知パネル
function showNotif(){
  const alerts = checkExpireAlerts();
  const urgent = alerts.filter(a=>a.level==='expired'||a.level==='urgent');
  if(!alerts.length){
    openModal('通知センター',
      `<div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M20 4A12 12 0 008 16v8L6 28h28l-2-4v-8A12 12 0 0020 4z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 32a4 4 0 008 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <h3>通知はありません</h3><p>在留期限や申請があるとここに表示されます</p>
      </div>`);
    return;
  }
  const dot = document.getElementById('notif-dot');
  if(dot) dot.style.display='none';
  const rows = alerts.slice(0,10).map(a=>{
    const cls=a.level==='expired'?'br':a.level==='urgent'?'ba':'bb';
    const lbl=a.level==='expired'?`期限切れ（${Math.abs(a.days)}日経過）`:`あと${a.days}日`;
    return `<div class="alert-row" onclick="closeModal();SP('workers');setTimeout(()=>openWD(WORKERS.find(x=>x.id==='${a.worker.id}')),100)">
      <div style="width:36px;height:36px;border-radius:50%;background:${a.worker.bg};color:${a.worker.tc};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${a.worker.init}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;font-weight:600">${a.worker.name}</div>
        <div style="font-size:12px;color:var(--t3)">${a.worker.flag} ${a.worker.lLabel} · 在留期限：${a.worker.residenceExpire}</div>
      </div>
      <span class="badge ${cls}">${lbl}</span>
    </div>`;
  }).join('');
  openModal(`通知 (${alerts.length}件)`,`<div style="margin:-20px">${rows}</div>`);
}

function openModal(title,body,foot=''){
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-body').innerHTML=body;
  document.getElementById('modal-foot').innerHTML=foot||'<button class="btn" onclick="closeModal()">閉じる</button>';
  document.getElementById('modal-bg').classList.add('on');
}
function closeModal(e){if(e&&e.target&&e.target.id!=='modal-bg')return;document.getElementById('modal-bg').classList.remove('on');}

function toggleAdmin(){IS_ADMIN=!IS_ADMIN;toast(IS_ADMIN?'管理者モード':'閲覧モード','');}

// ── モバイル サイドバー ────────────────────────────────────────────────────
function toggleSidebar(){
  const sb=document.querySelector('.sidebar');
  if(!sb)return;
  sb.classList.toggle('open');
  // オーバーレイ
  let ov=document.querySelector('.sb-overlay');
  if(!ov){
    ov=document.createElement('div');ov.className='sb-overlay';
    ov.onclick=()=>sb.classList.remove('open');
    document.body.appendChild(ov);
  }
}

// ── ページ遷移 ──────────────────────────────────────────────────────────────
function SP(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  const el=document.getElementById('page-'+id);if(el)el.classList.add('on');
  document.querySelectorAll('.sb-item').forEach(s=>{
    const sid=s.id?s.id.replace('nav-',''):'';
    s.classList.toggle('on',sid===id);
  });
  const titles={home:'ホーム',chat:'チャット',workers:'実習生管理',docs:'書類・翻訳管理',tasks:'タスク管理',gchat:'グループチャット',videos:'動画マニュアル',nippo:'日報・報告',shift:'シフト管理',attend:'勤怠管理',roles:'権限管理',settings:'設定'};
  const tb=document.getElementById('tb-title');if(tb)tb.textContent=titles[id]||id;
  if(id==='workers') renderWL();
  if(id==='docs'){initDocFilters();renderDL();renderDocPanel();}
  if(id==='chat'){
    renderCL();
    // 現在開いているチャットがあればDBから最新メッセージ取得
    if(AW && AW.authUserId) _loadChatHistory(AW).then(()=>renderMessages());
  }
  if(id==='gchat') renderGCL();
  if(id==='videos') renderVL();
  if(id==='nippo'){ AN=null; loadAndRenderNPL(); }  // タブを開くたびに未確認優先で自動選択
  if(id==='tasks') renderKanban();
  if(id==='home'){
    refreshHomeKPIs();
    loadAttendStats();        // 勤怠統計も最新化
    loadDashboardStats();     // 申請待ち件数・未読通知 + Action Bar 再構築
    loadActivityFeed();       // 最近の活動 Feed
  }
  if(id==='shift') rerenderShiftTable();
  if(id==='attend') initAttendPage();
  if(id==='roles') loadRoleUsers();
  if(id==='payroll') initPayrollPage();
}

// ── 通知センター ────────────────────────────────────────────────
async function openNotificationCenter(){
  try{
    const res  = await fetch('/app/api/notifications');
    const json = await res.json();
    if(!json.ok) return toast('エラー', '通知の取得に失敗しました', 'r');
    const list = json.notifications || [];
    if(!list.length){
      openModal('🔔 通知センター', '<div class="empty-state" style="padding:24px 0"><p>通知はありません ✅</p></div>',
        '<button class="btn" onclick="closeModal()">閉じる</button>');
      return;
    }
    const iconMap = {info:'ℹ️', alert:'🚨', approval:'✅'};
    const rows = list.map(n => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:11px 12px;border-bottom:1px solid var(--bd);${n.is_read?'opacity:.6':''}">
        <div style="font-size:20px">${iconMap[n.type] || '🔔'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;${n.is_read?'':'color:var(--gn)'}">${n.title}</div>
          <div style="font-size:12px;color:var(--t3);margin-top:2px;word-break:break-word">${n.body || ''}</div>
          <div style="font-size:10.5px;color:var(--t3);margin-top:3px">${new Date(n.created_at).toLocaleString('ja-JP')}</div>
        </div>
        ${n.is_read ? '' : '<span class="badge bg" style="font-size:9.5px;flex-shrink:0">新着</span>'}
      </div>`).join('');
    openModal('🔔 通知センター',
      `<div style="max-height:60vh;overflow-y:auto">${rows}</div>`,
      `<button class="btn" onclick="markAllNotificationsRead()">すべて既読</button>
       <button class="btn btn-g" onclick="closeModal()">閉じる</button>`
    );
  }catch(e){ toast('エラー','ネットワークエラー','r'); }
}

async function markAllNotificationsRead(){
  try{
    await fetch('/app/api/notifications/read-all', {method: 'POST'});
    closeModal();
    loadDashboardStats();
    toast('既読化', 'すべての通知を既読にしました', 'g');
  }catch{ toast('エラー','処理に失敗しました','r'); }
}

// ── ダッシュボード統計 (申請待ち、未読通知、勤怠率) ───────────────
async function loadDashboardStats(){
  try{
    const res  = await fetch('/app/api/dashboard/stats');
    if(!res.ok) return;
    const json = await res.json();
    if(!json.ok) return;
    const s = json.stats || {};

    // 出勤率
    if(s.attendance){
      const el = document.getElementById('kpi-attendance-rate');
      if(el) el.textContent = (s.attendance.rate || 0) + '%';
      const sub = document.getElementById('kpi-attendance-sub');
      if(sub) sub.textContent = `出勤 ${s.attendance.present}/${s.attendance.total}`;
    }

    // 申請待ち件数（シフト+日報）
    const pendingTotal = (s.pending?.shiftRequests || 0) + (s.pending?.dailyReports || 0);
    const pendEl = document.getElementById('kpi-pending-val');
    if(pendEl) pendEl.textContent = pendingTotal;
    const pendSub = document.getElementById('kpi-pending-sub');
    if(pendSub) pendSub.textContent = pendingTotal > 0 ? `${pendingTotal}件` : 'OK';

    // 未読通知
    const unreadEl = document.getElementById('kpi-unread-val');
    if(unreadEl) unreadEl.textContent = s.unread?.notifications || 0;
    const unreadSub = document.getElementById('kpi-unread-sub');
    if(unreadSub) unreadSub.textContent = (s.unread?.notifications || 0) + '件';

    // 未読メッセージ
    const msgVal = document.getElementById('kpi-msg-val');
    if(msgVal) msgVal.textContent = s.unread?.messages || 0;
    const unreadKpi = document.getElementById('unread-val');
    if(unreadKpi) unreadKpi.textContent = s.unread?.messages || 0;

    // 本日の日報総数
    const nippoVal = document.getElementById('kpi-nippo-val');
    if(nippoVal) nippoVal.textContent = s.today?.nippoCount || 0;

    // ナビバッジ
    const navBadge = document.getElementById('nav-pending-badge');
    if(navBadge){
      if(pendingTotal > 0){
        navBadge.textContent = pendingTotal;
        navBadge.style.display = '';
      } else {
        navBadge.style.display = 'none';
      }
    }

    // ★ Action Bar (今日対応すべきこと) を再構築
    renderActionBar(s);
    // ★ 今日の申請 / 最近の異常 / 在留期限pill も同タイミングで更新
    renderTodayApplications(s);
    renderRecentAnomalies(s);
    renderExpirePill();
  }catch(e){ console.warn('[dashboard] stats error:', e); }
}

// ── 在留期限 PILL: 件数で見た目を変える ───────────────────────────
function renderExpirePill(){
  const pill = document.getElementById('home-expire-pill');
  const sub  = document.getElementById('expire-pill-sub');
  if (!pill || !sub) return;
  const alerts = (typeof checkExpireAlerts === 'function') ? checkExpireAlerts() : [];
  const urgent = alerts.filter(a => a.level === 'expired' || a.level === 'urgent').length;
  const warn   = alerts.filter(a => a.level === 'warn').length;

  pill.classList.remove('warn', 'alert');
  if (urgent > 0) {
    pill.classList.add('alert');
    sub.textContent = `⚠️ 緊急 ${urgent}件 — 即対応が必要です`;
  } else if (warn > 0) {
    pill.classList.add('warn');
    sub.textContent = `期限間近 ${warn}件・要確認`;
  } else {
    sub.textContent = '正常 — 期限超過・期限間近なし ✓';
  }
}

// ── 今日の申請カード: 申請内訳をリスト化 ───────────────────────────
function renderTodayApplications(stats){
  const wrap = document.getElementById('home-today-applications');
  if (!wrap) return;
  const shift  = stats?.pending?.shiftRequests || 0;
  const report = stats?.pending?.dailyReports || 0;
  const items = [
    { ico: '🗓', label: 'シフト変更申請', sub: '承認待ち',     count: shift,  onclick: "SP('shift')",  color: shift  > 0 ? 'amber' : null },
    { ico: '📝', label: '日報・ヒヤリ',     sub: 'レビュー待ち', count: report, onclick: "SP('nippo')",  color: report > 0 ? 'amber' : null },
  ];
  if (items.every(i => i.count === 0)) {
    wrap.innerHTML = '<div class="empty-row">本日の未対応はありません</div>';
    return;
  }
  wrap.innerHTML = items.map(it => `
    <div class="action-row ${it.color || ''} ${it.count > 0 ? 'has' : ''}" onclick="${it.onclick}">
      <div class="action-row-ico">${it.ico}</div>
      <div class="action-row-text">
        <div class="action-row-title">${it.label}</div>
        <div class="action-row-sub">${it.sub}</div>
      </div>
      <div class="action-row-count">${it.count}</div>
    </div>
  `).join('');
}

// ── 最近の異常カード: 遅刻/未打刻/未返信などを列挙 ─────────────────
function renderRecentAnomalies(stats){
  const wrap = document.getElementById('home-anomalies');
  if (!wrap) return;
  const items = [];
  const late      = stats?.attendance?.late      || 0;
  const absent    = stats?.attendance?.absent    || 0;
  const unpunched = stats?.attendance?.unpunched || 0;
  const unrMsg    = stats?.unread?.messages      || 0;
  if (late > 0)      items.push({ ico: '⏰', label: '遅刻',          sub: '本日',    count: late,      color: 'amber', onclick: "SP('attend')" });
  if (absent > 0)    items.push({ ico: '✗',  label: '欠勤',          sub: '本日',    count: absent,    color: 'red',   onclick: "SP('attend')" });
  if (unpunched > 0) items.push({ ico: '⏱', label: '未打刻',        sub: '出勤情報なし', count: unpunched, color: 'amber', onclick: "SP('attend')" });
  if (unrMsg > 0)    items.push({ ico: '💬', label: '未返信チャット', sub: 'ワーカー発', count: unrMsg,    color: 'blue',  onclick: "SP('chat')" });

  if (!items.length) {
    wrap.innerHTML = '<div class="empty-row">本日の異常は検知されていません</div>';
    return;
  }
  wrap.innerHTML = items.map(it => `
    <div class="action-row ${it.color} has" onclick="${it.onclick}">
      <div class="action-row-ico">${it.ico}</div>
      <div class="action-row-text">
        <div class="action-row-title">${it.label}</div>
        <div class="action-row-sub">${it.sub}</div>
      </div>
      <div class="action-row-count">${it.count}</div>
    </div>
  `).join('');
}

// ── Action Bar: 今日対応すべき項目を動的生成 ────────────────────
function renderActionBar(stats){
  const bar = document.getElementById('home-action-bar');
  if (!bar) return;
  const items = [];

  const pendingTotal = (stats?.pending?.shiftRequests || 0) + (stats?.pending?.dailyReports || 0);
  if (pendingTotal > 0) {
    items.push({
      ico: '📋', label: '未承認申請', count: pendingTotal,
      color: 'amber', onclick: "SP('shift')",
    });
  }

  // 在留期限アラート
  const expireAlerts = (typeof checkExpireAlerts === 'function') ? checkExpireAlerts() : [];
  const urgent = expireAlerts.filter(a => a.level === 'expired' || a.level === 'urgent').length;
  if (urgent > 0) {
    items.push({
      ico: '⏰', label: '在留期限が近い', count: urgent,
      color: 'red', onclick: 'showExpireAlerts()',
    });
  }

  const unrNotif = stats?.unread?.notifications || 0;
  if (unrNotif > 0) {
    items.push({
      ico: '🔔', label: '未読通知', count: unrNotif,
      color: 'red', onclick: 'openNotificationCenter()',
    });
  }

  const unrMsg = stats?.unread?.messages || 0;
  if (unrMsg > 0) {
    items.push({
      ico: '💬', label: '未読メッセージ', count: unrMsg,
      color: 'blue', onclick: "SP('chat')",
    });
  }

  if (items.length === 0) {
    bar.innerHTML = '<div class="action-bar-empty">✓ 今日対応すべき項目はありません</div>';
    return;
  }
  bar.innerHTML = items.map(it => `
    <div class="alert-chip ${it.color}" onclick="${it.onclick}">
      <div class="alert-chip-ico">${it.ico}</div>
      <div class="alert-chip-text">
        <span class="alert-chip-label">${it.label}</span>
        <span class="alert-chip-count">${it.count}<span style="font-size:13px;font-weight:600;margin-left:3px;opacity:.7">件</span></span>
      </div>
      <span class="alert-chip-arrow">→</span>
    </div>
  `).join('');
}

// ── タイムライン (Slack風): 勤怠/日報/シフトを統合 ─────────────
async function loadActivityFeed(){
  const feed = document.getElementById('home-activity-feed');
  if (!feed) return;
  try {
    const r = await fetch('/app/api/home/activity');
    const j = await r.json();
    if (!j.ok) return;
    const events = j.events || [];
    if (!events.length) {
      feed.innerHTML = '<div class="empty-state" style="padding:14px 0;color:var(--t3);font-size:12.5px">本日のアクティビティはまだありません</div>';
      return;
    }
    feed.innerHTML = '<div class="timeline">' + events.map((e, i) => {
      const time   = _fmtTime(e.time);
      const actor  = (e.actor  || '').replace(/</g,'&lt;');
      const action = (e.action || '').replace(/</g,'&lt;');
      const meta   = (e.typeLabel || '').replace(/</g,'&lt;');
      const isLast = i === events.length - 1;
      return `<div class="timeline-item">
        <div class="timeline-time">${time}</div>
        <div class="timeline-rail">
          <span class="timeline-dot ${e.color || ''}">${e.icon || '●'}</span>
          ${!isLast ? '<span class="timeline-line"></span>' : ''}
        </div>
        <div class="timeline-body">
          <div class="timeline-text">
            <span class="timeline-actor">${actor}</span><span class="timeline-action">${action}</span>
          </div>
          ${meta ? `<div class="timeline-meta">${meta}</div>` : ''}
        </div>
      </div>`;
    }).join('') + '</div>';
  } catch (e) { console.warn('[timeline]', e); }
}
function _fmtTime(iso){
  try {
    return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  } catch { return ''; }
}
function _fmtAgo(iso){
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'たった今';
  if (diff < 3600000) return Math.floor(diff/60000) + '分前';
  if (diff < 86400000) return Math.floor(diff/3600000) + '時間前';
  if (diff < 604800000) return Math.floor(diff/86400000) + '日前';
  return new Date(iso).toLocaleDateString('ja-JP');
}

// ── ホームKPI ────────────────────────────────────────────────────────────────
function refreshHomeKPIs(){
  // 実習生数
  const active=WORKERS.filter(w=>w.status==='active').length;
  const issue=WORKERS.filter(w=>w.status==='issue').length;
  const el=v=>document.getElementById(v);
  if(el('kpi-workers-val')) el('kpi-workers-val').textContent=WORKERS.length;
  if(el('kpi-workers-sub')) el('kpi-workers-sub').textContent=`稼働 ${active}名`;
  if(el('kpi-workers-detail')) el('kpi-workers-detail').textContent=issue>0?`⚠️ 要確認 ${issue}名`:`全員稼働中`;
  if(el('home-sub')) el('home-sub').textContent=`${new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'})} · 全${WORKERS.length}名の実習生が登録中`;

  // 未読メッセージ
  const unread=WORKERS.reduce((s,w)=>s+(w.unread||0),0);
  if(el('unread-val')) el('unread-val').textContent=unread;
  if(el('unread-kpi')) el('unread-kpi').textContent=unread+'件';
  if(el('chat-bdg')){el('chat-bdg').textContent=unread;el('chat-bdg').style.display=unread>0?'flex':'none';}

  // 書類
  if(el('doc-kpi-val')) el('doc-kpi-val').textContent=DOCS.length;
  if(el('doc-kpi-sub')) el('doc-kpi-sub').textContent=DOCS.length>0?`${DOCS.length}件登録済み`:'書類を追加してください';

  // 在留期限アラート
  const expAlerts=checkExpireAlerts();
  if(el('expire-kpi-val')) el('expire-kpi-val').textContent=expAlerts.length;
  if(el('expire-kpi-badge')) el('expire-kpi-badge').textContent=expAlerts.length+'件';
  if(el('expire-kpi-sub')) el('expire-kpi-sub').textContent=expAlerts.length>0?'クリックで詳細':'問題なし ✅';

  // 通知ドット（期限アラート or 未読がある場合に表示）
  const dot=el('notif-dot');
  if(dot){
    const urgent=expAlerts.filter(a=>a.level==='expired'||a.level==='urgent').length;
    const unread=WORKERS.reduce((s,w)=>s+(w.unread||0),0);
    dot.style.display=(urgent>0||unread>0)?'block':'none';
  }

  // ホーム在留期限リスト
  const hel=el('home-expire-list');
  if(hel){
    if(!expAlerts.length){hel.innerHTML='<div class="empty-state" style="padding:20px 0"><p>期限切れ・期限間近の実習生がいません ✅</p></div>';}
    else{hel.innerHTML=expAlerts.slice(0,5).map(a=>{
      const cls=a.level==='expired'?'br':a.level==='urgent'?'ba':'bb';
      const lbl=a.level==='expired'?`期限切れ（${Math.abs(a.days)}日経過）`:`あと${a.days}日`;
      return `<div class="act-item" style="cursor:pointer" onclick="SP('workers');setTimeout(()=>{openWD(WORKERS.find(x=>x.id==='${a.worker.id}'))},100)">
        <div style="width:36px;height:36px;border-radius:50%;background:${a.worker.bg};color:${a.worker.tc};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${a.worker.init}</div>
        <div class="act-body"><div class="act-title">${a.worker.name}</div><div class="act-sub">在留期限：${a.worker.residenceExpire}</div></div>
        <span class="badge ${cls}">${lbl}</span></div>`}).join('');}
  }

  // 勤怠統計（管理者のみ・非同期で取得）
  if(IS_ADMIN) loadAttendStats();

  // 国籍分布
  const lh=el('home-lang-list');
  if(lh){
    const langMap={};
    WORKERS.forEach(w=>{const k=w.flag+' '+(w.lLabel||w.lang);langMap[k]=(langMap[k]||0)+1;});
    const entries=Object.entries(langMap).sort((a,b)=>b[1]-a[1]);
    lh.innerHTML=entries.length
      ? entries.map(([k,v])=>`
          <div class="flex items-center justify-between">
            <span style="font-size:13px">${k}</span>
            <span class="badge bg">${v}名</span>
          </div>`).join('')
      : '<div class="text-muted text-sm">実習生を追加してください</div>';
  }

  // ステータス分布
  const sh=el('home-status-list');
  if(sh){
    const items=[['在籍中',active,'bg'],['要確認',issue,'ba'],['退職者',WORKERS.filter(w=>w.status==='inactive').length,'bgray']];
    const visible=items.filter(x=>x[1]>0);
    sh.innerHTML=visible.length
      ? visible.map(([l,v,c])=>`
          <div class="flex items-center justify-between">
            <span style="font-size:13px">${l}</span>
            <span class="badge ${c}">${v}名</span>
          </div>`).join('')
      : '<div class="text-muted text-sm">実習生を追加してください</div>';
  }
}

// ── 在留期限チェック ──────────────────────────────────────────────────────────
function checkExpireAlerts(){
  const now=new Date();const alerts=[];
  WORKERS.forEach(w=>{
    if(!w.residenceExpire)return;
    const diff=(new Date(w.residenceExpire)-now)/(1000*60*60*24);
    if(diff<0)alerts.push({worker:w,days:Math.ceil(diff),level:'expired'});
    else if(diff<=30)alerts.push({worker:w,days:Math.ceil(diff),level:'urgent'});
    else if(diff<=90)alerts.push({worker:w,days:Math.ceil(diff),level:'warn'});
  });
  return alerts;
}

function showExpireAlerts(){
  const alerts=checkExpireAlerts();
  if(!alerts.length){openModal('在留期限通知','<div style="padding:14px;text-align:center;color:var(--t3)">期限が近い実習生はいません</div>');return;}
  const rows=alerts.map(a=>{
    const cls=a.level==='expired'?'br':a.level==='urgent'?'ba':'bb';
    const lbl=a.level==='expired'?`期限切れ（${Math.abs(a.days)}日経過）`:`あと${a.days}日`;
    return `<div class="alert-row" onclick="closeModal();SP('workers');setTimeout(()=>{openWD(WORKERS.find(x=>x.id==='${a.worker.id}'))},100)">
      <div style="width:36px;height:36px;border-radius:50%;background:${a.worker.bg};color:${a.worker.tc};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${a.worker.init}</div>
      <div style="flex:1"><div style="font-size:13.5px;font-weight:700">${a.worker.name}</div><div style="font-size:12px;color:var(--t3)">在留期限：${a.worker.residenceExpire}</div></div>
      <span class="badge ${cls}">${lbl}</span></div>`;
  }).join('');
  openModal(`⏰ 在留期限通知（${alerts.length}件）`,rows);
}

// ── チャット ─────────────────────────────────────────────────────────────────
function renderCL(search){
  const el=document.getElementById('cl-items');if(!el)return;el.innerHTML='';
  let list=WORKERS;
  if(search){
    const q = search.toLowerCase();
    // 名前 / 職種 / 国籍 / 部署 / 言語ラベル で部分一致
    list = list.filter(w =>
      (w.name||'').toLowerCase().includes(q) ||
      (w.job||'').toLowerCase().includes(q) ||
      (w.nationality||'').toLowerCase().includes(q) ||
      (w.dept||'').toLowerCase().includes(q) ||
      (w.lLabel||'').toLowerCase().includes(q)
    );
  }
  if(!list.length){
    el.innerHTML = `<div style="padding:30px 16px;text-align:center;color:var(--t3);font-size:13px">${search?'該当する実習生がいません':'実習生が登録されていません'}</div>`;
    return;
  }
  list.forEach(w=>{
    const div=document.createElement('div');div.className='pitem'+(AW?.id===w.id?' on':'');div.onclick=()=>openChat(w);
    div.innerHTML=`<div style="width:36px;height:36px;border-radius:50%;background:${w.bg};color:${w.tc};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;position:relative">${w.init}${(w.unread||0)>0?`<div style="position:absolute;top:-2px;right:-2px;background:var(--red);color:#fff;font-size:8px;min-width:14px;height:14px;border-radius:7px;display:flex;align-items:center;justify-content:center">${w.unread}</div>`:''}</div>
    <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${w.name}</div><div style="font-size:11.5px;color:var(--t3)">${w.flag} ${w.lLabel} · ${w.job}</div></div>`;
    el.appendChild(div);
  });
}

async function openChat(w){
  AW=w; renderCL();
  document.getElementById('chat-welcome').style.display='none';
  const actv=document.getElementById('chat-active'); actv.style.display='flex';
  document.getElementById('ch-av').innerHTML=`<div style="width:36px;height:36px;border-radius:50%;background:${w.bg};color:${w.tc};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700">${w.init}</div>`;
  document.getElementById('ch-name').textContent=w.name;
  document.getElementById('ch-sub').textContent=w.flag+' '+w.lLabel+' · '+w.job;
  w.unread=0;
  if(!HISTORY[w.id]) HISTORY[w.id]=[{t:'sys',txt:'チャット開始'}];

  // DB から過去メッセージをロード
  await _loadChatHistory(w);
  renderMessages();
  _startChatPoll(w);
}

async function _loadChatHistory(w){
  if(!w.authUserId) return; // アカウント未紐付けの場合はスキップ
  try{
    const res  = await fetch(`/app/api/messages?worker_user_id=${encodeURIComponent(w.authUserId)}`);
    const json = await res.json();
    if(!json.ok) return;
    HISTORY[w.id] = [{t:'sys',txt:'チャット開始'}];
    (json.messages||[]).forEach(m=>{ HISTORY[w.id].push(_dbMsgToLocal(m, w)); });
    if(json.messages?.length){
      _chatLastTs[w.id] = json.messages.at(-1).created_at;
    }
  }catch(e){ console.warn('[chat] load error:', e); }
}

function _dbMsgToLocal(m, w){
  const time = new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
  const isMe = (m.sender_id !== w.authUserId); // 管理者が送ったもの
  const local = {
    t: isMe?'me':'other',
    txt: m.body || '',
    time,
    read: m.is_read,
    _id: m.id,
    attachment_url:  m.attachment_url  || null,
    attachment_type: m.attachment_type || null,
    attachment_name: m.attachment_name || null,
  };
  // 翻訳テキスト:
  //  - ワーカー発(other): translated はワーカーが付けた日本語訳 → jp に
  //  - 管理者発(me):       translated はワーカー言語訳 → tl に
  if(m.translated && m.translated !== m.body){
    if(isMe) local.tl = m.translated;
    else     local.jp = m.translated;
  }
  return local;
}

function _startChatPoll(w){
  if(_chatPollTimer) clearInterval(_chatPollTimer);
  if(!w.authUserId) return;
  _chatPollTimer = setInterval(async()=>{
    if(!AW || AW.id !== w.id) { clearInterval(_chatPollTimer); return; }
    try{
      // 全件取得して既読ステータスも反映（最新100件）
      const res  = await fetch(`/app/api/messages?worker_user_id=${encodeURIComponent(w.authUserId)}`);
      const json = await res.json();
      if(!json.ok) return;

      // メッセージを再構築（既読状態も最新化）
      const sys = [{t:'sys',txt:'チャット開始'}];
      const fresh = (json.messages||[]).map(m => _dbMsgToLocal(m, w));

      // 内容比較してから差し替え（チラつき防止）
      const oldStr = JSON.stringify((HISTORY[w.id]||[]).map(m => `${m._id||''}-${m.read?1:0}`));
      const newStr = JSON.stringify(fresh.map(m => `${m._id||''}-${m.read?1:0}`));
      if(oldStr !== newStr){
        HISTORY[w.id] = [...sys, ...fresh];
        renderMessages();
      }
      if(json.messages?.length) _chatLastTs[w.id] = json.messages.at(-1).created_at;
    }catch{}
  }, 5000);
}

function renderMessages(){
  if(!AW)return;
  const area=document.getElementById('msgs'); if(!area)return;
  const msgs=HISTORY[AW.id]||[]; area.innerHTML='';
  msgs.forEach(m=>addBub('msgs',m,AW,false));
  area.scrollTop=area.scrollHeight;
}

// ── 管理者チャット: 画像添付 ────────────────────────────────────
let _pendingMsgAttach = null;  // {file, dataUrl, name, mime, size}

function onMsgFilePick(ev){
  const f = ev.target.files && ev.target.files[0];
  if(!f) return;
  if(!f.type.startsWith('image/')){
    toast('エラー','画像ファイルを選択してください','r');
    ev.target.value = ''; return;
  }
  if(f.size > 10 * 1024 * 1024){
    toast('エラー','10MB以下の画像を選択してください','r');
    ev.target.value = ''; return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    _pendingMsgAttach = { file: f, dataUrl: reader.result, name: f.name, mime: f.type, size: f.size };
    const wrap = document.getElementById('msg-attach-preview');
    const img  = document.getElementById('msg-attach-img');
    const nm   = document.getElementById('msg-attach-name');
    if(wrap) wrap.style.display = 'block';
    if(img)  img.src = reader.result;
    if(nm)   nm.textContent = f.name + ' (' + Math.round(f.size/1024) + ' KB)';
  };
  reader.readAsDataURL(f);
  ev.target.value = '';
}

function clearMsgAttach(){
  _pendingMsgAttach = null;
  const wrap = document.getElementById('msg-attach-preview');
  if(wrap) wrap.style.display = 'none';
}

async function _uploadMsgAttachment(file){
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/app/api/chat/upload', { method:'POST', body: fd });
  const j = await r.json();
  if(!j.ok || !j.attachment) throw new Error(j.error || '画像のアップロードに失敗しました');
  return j.attachment;
}

// チャット履歴 CSV 出力
async function exportChatCsv(){
  if(!AW){ toast('対象なし','ワーカーを選択してください','b'); return; }
  if(!AW.authUserId){ toast('注意','このワーカーはアカウント未紐付けです','b'); return; }
  const url = `/app/api/messages/export.csv?worker_user_id=${encodeURIComponent(AW.authUserId)}`;
  // ダウンロード起動
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat_${(AW.name||'worker').replace(/[^\w-]/g,'')}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('✓ CSV出力', AW.name + ' とのチャット履歴をダウンロードします');
}

// ── 管理者用 翻訳ヘルパ（translationService 経由・失敗時は原文）──
// adminTx(text, targetLang, sourceLang='ja')
async function adminTx(text, targetLang, sourceLang='ja'){
  const t = (text==null) ? '' : String(text);
  if(!t.trim() || !targetLang || sourceLang===targetLang) return t;
  try{
    const r = await fetch('/api/translate',{
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({ text: t, source: sourceLang, target: targetLang }),
    });
    const j = await r.json();
    return (j && j.translated) ? j.translated : t;
  }catch(e){ console.warn('[adminTx]', e); return t; }
}

async function sendMsg(){
  const inp=document.getElementById('msg-inp'); if(!inp||!AW)return;
  const txt=inp.value.trim();
  if(!txt && !_pendingMsgAttach) return;  // テキストも添付も無い → 送信しない
  inp.value=''; inp.style.height='auto';
  const time=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});

  // 画像があればアップロード
  let att = null;
  if(_pendingMsgAttach){
    try{
      att = await _uploadMsgAttachment(_pendingMsgAttach.file);
    }catch(e){
      toast('画像アップロード失敗', e.message || '', 'r');
      return;
    }
  }

  // ★ 管理者の日本語 → ワーカー言語へ翻訳（translated として保存）
  //   ワーカーは原文(日本語)+翻訳の両方を受け取れる。ワーカー言語が ja の場合はスキップ。
  let translated = null;
  const wLang = AW.lang || 'ja';
  if(txt && wLang !== 'ja'){
    translated = await adminTx(txt, wLang, 'ja');
  }

  // 楽観的UI更新（管理者画面には日本語+翻訳プレビューを表示）
  HISTORY[AW.id].push({
    t:'me', txt, tl: (translated && translated!==txt) ? translated : null, time, read:false,
    attachment_url:  att?.url  || null,
    attachment_type: att?.type || null,
    attachment_name: att?.name || null,
  });
  renderMessages();

  if(!AW.authUserId){
    toast('注意','このワーカーはアカウントが紐付けられていないため、メッセージはDBに保存されません','b');
    clearMsgAttach();
    return;
  }

  try{
    const payload = { worker_user_id: AW.authUserId, body: txt };
    if(translated && translated !== txt) payload.translated = translated;
    if(att){
      payload.attachment_url   = att.url;
      payload.attachment_path  = att.path;
      payload.attachment_type  = att.type;
      payload.attachment_mime  = att.mime;
      payload.attachment_name  = att.name;
      payload.attachment_size  = att.size;
    }
    const res  = await fetch('/app/api/messages',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if(json.ok && json.message){
      _chatLastTs[AW.id] = json.message.created_at;
      const last = HISTORY[AW.id].at(-1);
      if(last && last.t==='me') last._id = json.message.id;
    }
    clearMsgAttach();
  }catch(e){
    console.warn('[chat] send error:', e);
    toast('送信エラー','メッセージの送信に失敗しました','r');
  }
}

async function doApprove(){
  if(!AW)return;
  const time=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
  HISTORY[AW.id].push({t:'me',txt:'✓ 承認しました。',time,read:true});
  renderMessages();
  // DB送信
  if(AW.authUserId){
    await fetch('/app/api/messages',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ worker_user_id: AW.authUserId, body: '✓ 承認しました。' }),
    }).catch(()=>{});
  }
  toast('承認完了', AW.name+' の申請を承認しました');
}
async function insertQuick(txt){const inp=document.getElementById('msg-inp');if(inp){inp.value=txt;inp.focus();}}

// ── 実習生管理 ──────────────────────────────────────────────────────────────
function setWF(f,el){wFilter=f;document.querySelectorAll('#wl-filters .fc').forEach(c=>c.classList.remove('on'));if(el)el.classList.add('on');renderWL();}

function renderWL(search){
  const el=document.getElementById('wl-items');if(!el)return;el.innerHTML='';
  let list=WORKERS;
  if(wFilter==='active')list=list.filter(w=>w.status==='active');
  if(wFilter==='issue')list=list.filter(w=>w.status==='issue');
  if(['vi','id','tl','my'].includes(wFilter))list=list.filter(w=>w.lang===wFilter);
  if(search)list=list.filter(w=>w.name.toLowerCase().includes(search.toLowerCase())||w.job.includes(search));
  const now=new Date();
  list.forEach(w=>{
    let expBadge='';
    if(w.residenceExpire){
      const diff=(new Date(w.residenceExpire)-now)/(1000*60*60*24);
      if(diff<0)expBadge='<span class="badge br" style="font-size:9px">期限切れ</span>';
      else if(diff<=30)expBadge=`<span class="badge ba" style="font-size:9px">残${Math.ceil(diff)}日</span>`;
      else if(diff<=90)expBadge=`<span class="badge bb" style="font-size:9px">残${Math.ceil(diff)}日</span>`;
    }
    const div=document.createElement('div');div.className='pitem'+(AWD?.id===w.id?' on':'');div.onclick=()=>openWD(w);
    div.innerHTML=`<div style="width:36px;height:36px;border-radius:50%;background:${w.bg};color:${w.tc};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${w.init}</div>
    <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${w.name}</div><div style="font-size:11.5px;color:var(--t3);margin-top:2px;display:flex;gap:4px;flex-wrap:wrap">${w.flag} ${w.job} · ${w.year||'-'} ${expBadge}</div></div>`;
    el.appendChild(div);
  });
}

function openWD(w, forceTab){
  if(forceTab) w._activeTab=forceTab;
  AWD=w;renderWL();
  const p=document.getElementById('wd-panel');if(!p)return;
  const now=new Date();let visaWarn='';
  if(w.residenceExpire){
    const diff=(new Date(w.residenceExpire)-now)/(1000*60*60*24);
    if(diff<0)visaWarn=`<div class="visa-warn err">⚠ 在留期限切れ：${w.residenceExpire}（${Math.abs(Math.ceil(diff))}日経過）</div>`;
    else if(diff<=30)visaWarn=`<div class="visa-warn warn">⏰ 在留期限まであと${Math.ceil(diff)}日（${w.residenceExpire}）</div>`;
    else if(diff<=90)visaWarn=`<div class="visa-warn info">📅 在留期限：${w.residenceExpire}（${Math.ceil(diff)}日後）</div>`;
  }
  const activeTab=w._activeTab||'info';
  p.innerHTML=`
    <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:16px 20px;background:var(--sf);border-bottom:1px solid var(--bd);flex-shrink:0">
        <div class="wd-hero" style="margin-bottom:0">
          <div class="wd-av" style="background:${w.bg};color:${w.tc}">${w.init}</div>
          <div style="flex:1">
            <div class="wd-name">${w.name} <span style="font-size:18px">${w.flag}</span></div>
            <div style="font-size:13px;color:var(--t2)">${w.job} · ${w.dept||'-'} · ${w.year||'-'}</div>
          </div>
          <div style="display:flex;gap:6px">
            ${IS_ADMIN?`<button class="btn btn-sm" onclick="openEditW('${w.id}')">✏️ 編集</button>`:''}
            <button class="btn btn-g btn-sm" onclick="SP('chat');setTimeout(()=>openChat(WORKERS.find(x=>x.id==='${w.id}')),100)">💬 チャット</button>
          </div>
        </div>
        ${visaWarn}
        <div style="display:flex;gap:4px;margin-top:14px;border-bottom:1px solid var(--bd);margin-bottom:-1px">
          <button class="wd-tab ${activeTab==='info'?'on':''}" onclick="switchWDTab('${w.id}','info')">基本情報</button>
          <button class="wd-tab ${activeTab==='visa'?'on':''}" onclick="switchWDTab('${w.id}','visa')">在留情報</button>
          <button class="wd-tab ${activeTab==='docs'?'on':''}" onclick="switchWDTab('${w.id}','docs')">書類 (${(w.workerDocs||[]).length+DOCS.filter(d=>d.workerId===w.id).length})</button>
          <button class="wd-tab ${activeTab==='hist'?'on':''}" onclick="switchWDTab('${w.id}','hist')">履歴</button>
          ${IS_ADMIN?`<button class="wd-tab ${activeTab==='account'?'on':''}" onclick="switchWDTab('${w.id}','account')">👤 アカウント</button>`:''}
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:18px 20px;background:var(--bg)">${renderWDTab(w,activeTab)}</div>
    </div>`;
}

function switchWDTab(wid,tab){const w=WORKERS.find(x=>x.id===wid);if(!w)return;w._activeTab=tab;openWD(w);}

function renderWDInfo(w){
  const row=(lbl,val)=>`<tr><td style="padding:9px 14px;background:#fafbfd;font-weight:600;color:var(--t2);width:35%;border-bottom:1px solid var(--bd)">${lbl}</td><td style="padding:9px 14px;border-bottom:1px solid var(--bd)">${val||'<span style="color:var(--t3)">未設定</span>'}</td></tr>`;
  return `<div class="wd-card"><div class="wd-card-hdr">基本情報</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${row('氏名',w.name)}${row('国籍',w.nationality)}${row('言語',w.flag+' '+w.lLabel)}
      ${row('職種',w.job)}${row('配属部署',w.dept)}${row('担当者',w.supervisor)}
      ${row('給与',w.salary)}${row('住所',w.address)}${row('緊急連絡先',w.emergencyContact)}
    </table></div>`;
}

function renderWDVisa(w){
  const now=new Date();
  const expClass=(date)=>{if(!date)return '';const d=(new Date(date)-now)/(1000*60*60*24);if(d<0)return 'color:var(--red);font-weight:700';if(d<=30)return 'color:var(--amb);font-weight:700';if(d<=90)return 'color:var(--blu);font-weight:600';return '';};
  const expBadge=(date)=>{if(!date)return '';const d=(new Date(date)-now)/(1000*60*60*24);if(d<0)return ` <span class="badge br" style="font-size:10px">期限切れ</span>`;if(d<=30)return ` <span class="badge ba" style="font-size:10px">期限間近</span>`;return '';};
  const row=(lbl,val,style='')=>`<tr><td style="padding:9px 14px;background:#fafbfd;font-weight:600;color:var(--t2);width:35%;border-bottom:1px solid var(--bd)">${lbl}</td><td style="padding:9px 14px;border-bottom:1px solid var(--bd);${style}">${val||'<span style="color:var(--t3)">未設定</span>'}</td></tr>`;
  return `<div class="wd-card"><div class="wd-card-hdr">パスポート情報</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${row('国籍',w.nationality)}
      ${row('パスポート番号',w.passport,'font-family:monospace')}
      ${row('パスポート有効期限',w.passportExpire?(w.passportExpire+expBadge(w.passportExpire)):null,expClass(w.passportExpire))}
    </table></div>
    <div class="wd-card"><div class="wd-card-hdr">在留資格情報</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${row('在留資格',w.visaType)}
      ${row('在留状況',w.visaStatus?`<span class="badge bg">${w.visaStatus}</span>`:null)}
      ${row('在留カード番号',w.residenceCard,'font-family:monospace')}
      ${row('在留期限',w.residenceExpire?(w.residenceExpire+expBadge(w.residenceExpire)):null,expClass(w.residenceExpire))}
      ${row('入国日',w.entryDate)}${row('契約終了日',w.contractEnd,expClass(w.contractEnd))}
      ${row('社会保険',w.insurance)}
    </table></div>`;
}

function renderWDDocs(w){
  // ① テンプレート生成書類（w.workerDocs）
  const tplDocs = w.workerDocs||[];
  // ② 書類管理（DOCS）からこの実習生に紐付いたもの
  const linkedDocs = DOCS.filter(d=>d.workerId===w.id);

  // テンプレート書類一覧
  const tplRows = tplDocs.map((doc,i)=>`
    <div class="wdoc-row">
      <div style="font-size:20px;flex-shrink:0">${doc.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${doc.name}</div>
        <div style="font-size:11.5px;color:var(--t3)">作成日: ${doc.createdAt} · テンプレート</div>
      </div>
      <button class="btn btn-xs" onclick="viewWorkerDoc('${w.id}',${i})">📄 開く</button>
      <button class="btn btn-xs" onclick="downloadWorkerDoc('${w.id}',${i})">⬇ DL</button>
      ${IS_ADMIN?`<button class="btn btn-xs" style="color:var(--red)" onclick="deleteWorkerDoc('${w.id}',${i})">🗑</button>`:''}
    </div>`).join('');

  // 書類管理からの紐付き書類一覧
  const linkedRows = linkedDocs.map(doc=>`
    <div class="wdoc-row">
      <div style="font-size:20px;flex-shrink:0">${doc.ico}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${doc.name}</div>
        <div style="font-size:11.5px;color:var(--t3);margin-top:2px">
          ${doc.updated||'-'} · ${doc.category||''}
          ${doc.fileName?'<span class="badge bb" style="font-size:9px">📎 PDF</span>':''}
          ${doc.expireDate?`<span class="badge ba" style="font-size:9px">期限 ${doc.expireDate}</span>`:''}
        </div>
      </div>
      ${doc.fileUrl?`<button class="btn btn-xs" onclick="viewLinkedDoc('${doc.id}')">📄 表示</button>`:''}
      ${IS_ADMIN?`<button class="btn btn-xs" onclick="editLinkedDoc('${doc.id}')">✏️ 編集</button>`:''}
      ${IS_ADMIN?`<button class="btn btn-xs" style="color:var(--red)" onclick="unlinkDoc('${doc.id}','${w.id}')">✕</button>`:''}
    </div>`).join('');

  const allEmpty = !tplDocs.length && !linkedDocs.length;
  const emptyMsg = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">まだ書類がありません</div>';

  // テンプレートカード
  const tplCards = Object.entries(DOC_TEMPLATES).map(([k,t])=>
    `<div class="tpl-mini" onclick="genDocFromTemplate('${w.id}','${k}')">
       <div style="font-size:24px;margin-bottom:6px">${t.icon}</div>
       <div style="font-size:12px;font-weight:700;margin-bottom:2px">${t.name}</div>
       <div style="font-size:10.5px;color:var(--t3)">${t.description}</div>
     </div>`).join('');

  // 書類管理から選べる未紐付け書類
  const unlinked = DOCS.filter(d=>!d.workerId||d.workerId!==w.id);
  const unlinkedOpts = unlinked.map(d=>`<option value="${d.id}">${d.ico} ${d.name}${d.fileName?' 📎':''}</option>`).join('');

  return `
    <!-- 書類一覧 -->
    <div class="wd-card">
      <div class="wd-card-hdr" style="display:flex;align-items:center;justify-content:space-between">
        <span>📁 ${w.name} の書類（${tplDocs.length+linkedDocs.length}件）</span>
        ${IS_ADMIN?`<div style="display:flex;gap:5px">
          <button class="btn btn-xs btn-g" onclick="openWorkerDocUpload('${w.id}')">📎 ファイルを追加</button>
          ${unlinkedOpts?`<button class="btn btn-xs" onclick="openLinkDoc('${w.id}')">🔗 書類を紐付け</button>`:''}
        </div>`:''}
      </div>
      <div style="padding:4px">${allEmpty?emptyMsg:tplRows+linkedRows}</div>
    </div>

    <!-- テンプレートから作成 -->
    ${IS_ADMIN?`<div class="wd-card">
      <div class="wd-card-hdr">📝 テンプレートから書類を作成</div>
      <div style="padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">${tplCards}</div>
    </div>`:''}`;
}

// ── 書類管理との連携 ──────────────────────────────────────────────────────────

// PDFを新規アップロードしてこの実習生に紐付け
// ファイル種別 → アイコン
function fileIcon(fileName, mimeType){
  const ext=(fileName||'').split('.').pop().toLowerCase();
  if(ext==='pdf'||(mimeType||'').includes('pdf')) return '📕';
  if(['doc','docx'].includes(ext)) return '📝';
  if(['xls','xlsx'].includes(ext)) return '📊';
  if(['png','jpg','jpeg','gif','webp'].includes(ext)) return '🖼️';
  return '📎';
}

function openWorkerDocUpload(workerId){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ操作できます','r');return;}
  const w=WORKERS.find(x=>x.id===workerId);if(!w)return;
  openModal(`📎 ファイルを追加 — ${w.name}`,
    `<div style="display:flex;flex-direction:column;gap:12px">
      <div><div class="modal-label">書類名 <span style="color:var(--red)">*</span></div>
        <input id="wdn" class="modal-inp" placeholder="例：在留カードコピー、健康診断書"></div>
      <div><div class="modal-label">カテゴリ</div>
        <select id="wdc" class="modal-inp">
          <option value="visa">🪪 ビザ・在留</option>
          <option value="contract">📋 契約・規則</option>
          <option value="insurance">🏥 保険・健康</option>
          <option value="salary">💴 給与</option>
          <option value="safety">📒 安全</option>
          <option value="other">📄 その他</option>
        </select>
      </div>
      <div>
        <div class="modal-label">ファイル（PDF・Word・Excel・画像）</div>
        <input type="file" id="wdoc-file"
               accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp"
               style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"
               onchange="previewWDocFile(this)">
        <label for="wdoc-file" id="wdoc-zone"
               style="display:flex;align-items:center;gap:10px;padding:12px;border:2px dashed var(--bd2);border-radius:8px;cursor:pointer;background:var(--s2);user-select:none;transition:border-color .15s">
          <span style="font-size:24px">📎</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--t2)">クリックしてファイルを選択</div>
            <div style="font-size:11.5px;color:var(--t3);margin-top:1px">PDF・Word・Excel・画像 対応 / 最大50MB</div>
          </div>
        </label>
        <div id="wdoc-preview" style="display:none;margin-top:6px;padding:8px 10px;background:var(--gbg);border-radius:6px;font-size:12.5px;color:var(--gn);align-items:center;gap:6px">
          <span id="wdoc-ficon">📄</span>
          <span id="wdoc-fname" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
          <button type="button" onclick="clearWDocFile()" style="background:none;border:none;cursor:pointer;color:var(--t3);font-size:16px;padding:0">✕</button>
        </div>
      </div>
      <div><div class="modal-label">メモ（任意）</div><textarea id="wdm" class="modal-inp" rows="2" placeholder="書類の内容・備考"></textarea></div>
      <div><div class="modal-label">有効期限（任意）</div><input type="date" id="wde" class="modal-inp"></div>
    </div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button>
     <button class="btn btn-g" id="wdoc-submit" onclick="submitWorkerDoc('${workerId}')">追加する</button>`
  );
}
function previewWDocFile(inp){
  const f=inp?.files?.[0];if(!f)return;
  const pr=document.getElementById('wdoc-preview');
  const fn=document.getElementById('wdoc-fname');
  const fi=document.getElementById('wdoc-ficon');
  if(pr){pr.style.display='flex';}
  if(fn){fn.textContent=`${f.name} (${(f.size/1024/1024).toFixed(1)}MB)`;}
  if(fi){fi.textContent=fileIcon(f.name,f.type);}
  const ni=document.getElementById('wdn');
  if(ni&&!ni.value)ni.value=f.name.replace(/\.[^/.]+$/,'');
  const zone=document.getElementById('wdoc-zone');
  if(zone){zone.style.borderColor='var(--gn)';zone.style.background='var(--gbg)';}
}
function clearWDocFile(){
  const inp=document.getElementById('wdoc-file');if(inp)inp.value='';
  const pr=document.getElementById('wdoc-preview');if(pr)pr.style.display='none';
  const zone=document.getElementById('wdoc-zone');
  if(zone){zone.style.borderColor='';zone.style.background='var(--s2)';}
}

async function submitWorkerDoc(workerId){
  const name=document.getElementById('wdn')?.value?.trim();
  if(!name){toast('エラー','書類名を入力してください','r');return;}
  const cat   =document.getElementById('wdc')?.value||'other';
  const notes =document.getElementById('wdm')?.value?.trim()||'';
  const expire=document.getElementById('wde')?.value;
  const file  =document.getElementById('wdoc-file')?.files?.[0];
  const btn   =document.getElementById('wdoc-submit');
  if(btn){btn.disabled=true;btn.textContent=file?'アップロード中...':'追加中...';}

  try{
    const fd=new FormData();
    fd.append('name',name);
    fd.append('category',cat);
    fd.append('worker_id',workerId);
    if(notes)  fd.append('notes',notes);
    if(expire) fd.append('expire_date',expire);
    if(file)   fd.append('file',file);
    fd.append('visible_roles',JSON.stringify(['admin','manager','staff']));

    const r=await fetch('/app/api/documents/upload',{method:'POST',body:fd});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const d=await r.json();

    if(d.ok){
      // サーバーが返した doc を使う（ローカルJSONに保存済みなのでリロード後も残る）
      const newDoc = d.doc;
      // メモリ上の DOCS にも追加（即時反映のため）
      if(newDoc && !DOCS.find(x=>x.id===newDoc.id)) DOCS.push(newDoc);
      closeModal();
      renderDL();
      const w=WORKERS.find(x=>x.id===workerId);
      if(w) openWD(w,'docs');
      toast('追加完了',name+(file?' ('+fileIcon(file.name,file.type)+' ファイルあり)':'')+' を追加しました');
    }else{
      throw new Error(d.error||'サーバーエラー');
    }
  }catch(e){
    console.error('submitWorkerDoc error:', e);
    toast('エラー','追加に失敗しました: '+e.message,'r');
    if(btn){btn.disabled=false;btn.textContent='追加する';}
  }
}

// 既存書類をこの実習生に紐付け
function openLinkDoc(workerId){
  const w=WORKERS.find(x=>x.id===workerId);if(!w)return;
  const unlinked=DOCS.filter(d=>!d.workerId||d.workerId!==workerId);
  if(!unlinked.length){toast('情報','紐付けできる書類がありません','b');return;}
  const rows=unlinked.map(d=>`
    <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--bd);cursor:pointer;transition:background .12s"
         onclick="confirmLinkDoc('${d.id}','${workerId}')"
         onmouseover="this.style.background='var(--gbg)'" onmouseout="this.style.background=''">
      <span style="font-size:18px">${d.ico}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${d.name}</div>
        <div style="font-size:11.5px;color:var(--t3)">${d.category||''} ${d.fileName?'· 📎 PDF':''} ${d.expireDate?'· 期限'+d.expireDate:''}</div>
      </div>
      <span class="badge bg" style="font-size:11px">紐付け</span>
    </div>`).join('');
  openModal(`🔗 書類を紐付け — ${w.name}`,
    `<div style="max-height:60vh;overflow-y:auto;margin:-14px">${rows}</div>`,
    `<button class="btn" onclick="closeModal()">閉じる</button>`
  );
}
function confirmLinkDoc(docId, workerId){
  const doc=DOCS.find(d=>d.id===docId);
  const w=WORKERS.find(x=>x.id===workerId);
  if(!doc||!w)return;
  doc.workerId=workerId; // メモリ上で紐付け
  closeModal();
  openWD(w,'docs');
  toast('紐付け完了',`「${doc.name}」を ${w.name} に紐付けました`);
  // DB更新
  fetch(`/app/api/documents/${docId}/worker`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({worker_id:workerId})}).catch(()=>{});
}

// リンク書類の表示
function viewLinkedDoc(docId){
  const doc=DOCS.find(d=>d.id===docId);if(!doc||!doc.fileUrl)return;
  const isPdf=doc.fileName?.endsWith('.pdf')||(doc.mimeType||'').includes('pdf');
  openModal(doc.name,
    isPdf?`<iframe src="${doc.fileUrl}#toolbar=1" width="100%" height="560" style="border:none;border-radius:6px"></iframe>`
         :`<img src="${doc.fileUrl}" style="max-width:100%;border-radius:6px">`,
    `<a href="${doc.fileUrl}" download="${doc.fileName||'file'}" class="btn btn-b" style="text-decoration:none">⬇ ダウンロード</a>
     <button class="btn" onclick="closeModal()">閉じる</button>`
  );
}

// リンク書類を編集
function editLinkedDoc(docId){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ編集できます','r');return;}
  const doc=DOCS.find(d=>d.id===docId);if(!doc)return;
  openModal(`✏️ 書類を編集 — ${doc.name}`,
    `<div style="display:flex;flex-direction:column;gap:10px">
      <div><div class="modal-label">書類名</div><input id="eld-name" class="modal-inp" value="${doc.name}"></div>
      <div><div class="modal-label">メモ・内容</div><textarea id="eld-notes" class="modal-inp" rows="3">${doc.content||''}</textarea></div>
      <div><div class="modal-label">有効期限</div><input type="date" id="eld-expire" class="modal-inp" value="${doc.expireDate?.replace(/\//g,'-')||''}"></div>
    </div>`,
    `<button class="btn btn-r btn-sm" onclick="_confirmDeleteDoc('${docId}')">🗑 削除</button>
     <button class="btn" onclick="closeModal()">キャンセル</button>
     <button class="btn btn-g" onclick="saveLinkedDocEdit('${docId}')">保存</button>`
  );
}
function saveLinkedDocEdit(docId){
  const doc=DOCS.find(d=>d.id===docId);if(!doc)return;
  doc.name   =document.getElementById('eld-name')?.value?.trim()||doc.name;
  doc.content=document.getElementById('eld-notes')?.value?.trim()||'';
  const exp  =document.getElementById('eld-expire')?.value;
  doc.expireDate=exp?exp.replace(/-/g,'/'):'';
  closeModal();
  const w=WORKERS.find(x=>x.id===doc.workerId);if(w)openWD(w,'docs');
  renderDL();
  toast('保存完了','書類を更新しました');
}

// この実習生との紐付けを外す（書類自体は消えない）
function unlinkDoc(docId, workerId){
  const doc=DOCS.find(d=>d.id===docId);if(!doc)return;
  doc.workerId=null;
  const w=WORKERS.find(x=>x.id===workerId);if(w)openWD(w,'docs');
  toast('解除','書類の紐付けを解除しました','a');
  fetch(`/app/api/documents/${docId}/worker`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({worker_id:null})}).catch(()=>{});
}

function renderWDHist(w){
  const hist=(w.hist||[]).map(h=>`<div class="hist-row"><div class="hist-t">${h.t}</div><div class="hist-txt">${h.txt}</div><span class="badge ${h.type==='g'?'bg':h.type==='r'?'br':h.type==='b'?'bb':'ba'}">${h.type==='g'?'完了':h.type==='r'?'警告':h.type==='b'?'情報':'確認'}</span></div>`).join('')||'<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">履歴がありません</div>';
  return `<div class="wd-card"><div class="wd-card-hdr">📜 アクティビティ履歴</div><div style="padding:6px">${hist}</div></div>`;
}

function renderWDTab(w,tab){
  if(tab==='info')    return renderWDInfo(w);
  if(tab==='visa')    return renderWDVisa(w);
  if(tab==='docs')    return renderWDDocs(w);
  if(tab==='hist')    return renderWDHist(w);
  if(tab==='account') return renderWDAccount(w);
  return '';
}

// ── Worker アカウント管理 ──────────────────────────────────────────────────────

function renderWDAccount(w){
  // スケルトン表示して非同期でステータス取得
  setTimeout(()=>loadWorkerAccountStatus(w), 50);
  return `<div id="wd-account-panel">
    <div class="skeleton" style="height:110px;border-radius:10px;margin-bottom:10px"></div>
    <div class="skeleton" style="height:38px;border-radius:8px;width:60%"></div>
  </div>`;
}

async function loadWorkerAccountStatus(w){
  const panel=document.getElementById('wd-account-panel');
  if(!panel)return;
  try{
    const res  = await fetch(`/app/api/workers/${w.id}/account-status`);
    const json = await res.json();
    const esc  = s=>(s||'').replace(/'/g,"\\'");

    if(json.hasAccount){
      panel.innerHTML=`
        <div class="wd-card">
          <div class="wd-card-hdr">👤 ワーカーアカウント</div>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--gbg);border-radius:9px;border:1px solid var(--glt)">
              <div style="font-size:26px">✅</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13.5px;font-weight:700;color:var(--gn)">アカウント有効・紐付け済</div>
                <div style="font-size:12px;color:var(--t2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${json.email||'—'}</div>
              </div>
              <span class="badge ${json.confirmed?'bg':'ba'}" style="flex-shrink:0">${json.confirmed?'✅ 確認済':'⚠️ 未確認'}</span>
            </div>
            <div style="font-size:12px;color:var(--t3);line-height:1.6">
              ログインURL: <strong>/worker/login</strong><br>
              メール: <strong>${json.email||'—'}</strong>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm" onclick="openResetWorkerPassword('${esc(w.id)}')">
                🔑 パスワード再設定
              </button>
              <button class="btn btn-sm" style="color:var(--red);border-color:var(--red)" onclick="unlinkWorkerAccount('${esc(w.id)}','${esc(w.name)}')">
                🔗 紐付けを解除
              </button>
            </div>
          </div>
        </div>`;
    }else{
      panel.innerHTML=`
        <div class="wd-card">
          <div class="wd-card-hdr">👤 ワーカーアカウント</div>
          <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
            <div style="padding:20px 14px;background:var(--bg2);border-radius:9px;text-align:center;color:var(--t3)">
              <div style="font-size:32px;margin-bottom:8px">🔓</div>
              <div style="font-size:13.5px;font-weight:700;color:var(--tx)">アカウント未作成 / 未紐付け</div>
              <div style="font-size:12px;margin-top:5px;line-height:1.6">
                <strong>${w.name}</strong>さんのログインアカウントが設定されていません
              </div>
            </div>
            <button class="btn btn-g" onclick="openCreateWorkerAccount('${esc(w.id)}','${esc(w.name)}')">
              ➕ 新規アカウントを作成
            </button>
          </div>
        </div>
        <div class="wd-card" style="margin-top:10px">
          <div class="wd-card-hdr">🔗 既存アカウントと紐付け</div>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div style="font-size:12px;color:var(--t3);line-height:1.6">
              すでにアカウントを持っている実習生（テストアカウント等）と紐付けます。<br>
              メールアドレスを入力してください。
            </div>
            <div style="display:flex;gap:8px">
              <input type="email" id="link-email-${w.id}" class="form-inp" placeholder="email@example.com" style="flex:1;font-size:13px" autocomplete="off">
              <button class="btn btn-g btn-sm" onclick="submitLinkAccount('${esc(w.id)}')">紐付け</button>
            </div>
            <div id="link-msg-${w.id}" style="font-size:12px;min-height:16px"></div>
          </div>
        </div>`;
    }
  }catch(e){
    if(panel) panel.innerHTML=`<div class="empty-state"><p>読み込みエラー: ${e.message}</p></div>`;
  }
}

async function submitLinkAccount(workerId){
  const inp = document.getElementById(`link-email-${workerId}`);
  const msg = document.getElementById(`link-msg-${workerId}`);
  const email = inp?.value?.trim();
  if(!email){ if(msg){msg.style.color='var(--red)';msg.textContent='メールアドレスを入力してください';}return; }

  if(msg){ msg.style.color='var(--t3)'; msg.textContent='紐付け中...'; }
  try{
    const res  = await fetch(`/app/api/workers/${workerId}/link-account`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email}),
    });
    const json = await res.json();
    if(!json.ok){ if(msg){msg.style.color='var(--red)';msg.textContent=json.error||'紐付けに失敗しました';} return; }
    toast('紐付け完了',`${json.email} と紐付けました`,'g');
    if(AWD) switchWDTab(AWD.id,'account');
  }catch(e){
    if(msg){msg.style.color='var(--red)';msg.textContent='ネットワークエラー';}
  }
}

async function unlinkWorkerAccount(workerId, workerName){
  if(!confirm(`「${workerName}」のアカウント紐付けを解除しますか？\nワーカーはログインできなくなります。`)) return;
  try{
    const res  = await fetch(`/app/api/workers/${workerId}/link-account`,{method:'DELETE'});
    const json = await res.json();
    if(!json.ok){ toast('エラー',json.error||'解除に失敗しました','r'); return; }
    toast('解除完了','アカウント紐付けを解除しました','b');
    if(AWD) switchWDTab(AWD.id,'account');
  }catch(e){
    toast('エラー','ネットワークエラー','r');
  }
}

function openCreateWorkerAccount(workerId, workerName){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ操作できます','r');return;}
  openModal(`アカウント作成 — ${workerName}`,
    `<div style="display:flex;flex-direction:column;gap:14px">
      <div style="padding:10px 12px;background:var(--bbg);border-radius:8px;font-size:12.5px;color:var(--blu);line-height:1.6">
        ℹ️ 作成後、<strong>${workerName}</strong> さんにメールアドレスとパスワードをお伝えください。<br>
        ログインURL: <strong>${location.origin}/login</strong>
      </div>
      <div class="form-row">
        <label class="form-lbl">メールアドレス <span style="color:var(--red)">*</span></label>
        <input type="email" id="wa-email" class="form-inp" placeholder="worker@example.com" autocomplete="off">
      </div>
      <div class="form-row">
        <label class="form-lbl">パスワード <span style="color:var(--red)">*</span></label>
        <input type="password" id="wa-pass" class="form-inp" placeholder="6文字以上" autocomplete="new-password">
      </div>
      <div class="form-row">
        <label class="form-lbl">パスワード（確認）</label>
        <input type="password" id="wa-pass2" class="form-inp" placeholder="同じパスワードを入力" autocomplete="new-password">
      </div>
    </div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button>
     <button class="btn btn-g" onclick="submitCreateWorkerAccount('${workerId}')">作成する</button>`
  );
}

async function submitCreateWorkerAccount(workerId){
  const email = document.getElementById('wa-email')?.value?.trim();
  const pass  = document.getElementById('wa-pass')?.value;
  const pass2 = document.getElementById('wa-pass2')?.value;

  if(!email)          return toast('エラー','メールアドレスを入力してください','r');
  if(!pass||pass.length<6) return toast('エラー','パスワードは6文字以上にしてください','r');
  if(pass!==pass2)    return toast('エラー','パスワードが一致しません','r');

  try{
    const res  = await fetch(`/app/api/workers/${workerId}/create-account`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email, password:pass}),
    });
    const json = await res.json();
    if(!json.ok) return toast('エラー', json.error||'作成に失敗しました','r');

    closeModal();
    toast('作成完了', `${email} でログインできます`, 'g');
    // アカウントタブを再描画
    if(AWD) switchWDTab(AWD.id, 'account');
  }catch(e){
    toast('エラー','ネットワークエラー','r');
  }
}

function openResetWorkerPassword(workerId){
  openModal('パスワード再設定',
    `<div style="display:flex;flex-direction:column;gap:14px">
      <div class="form-row">
        <label class="form-lbl">新しいパスワード <span style="color:var(--red)">*</span></label>
        <input type="password" id="rp-pass" class="form-inp" placeholder="6文字以上" autocomplete="new-password">
      </div>
      <div class="form-row">
        <label class="form-lbl">パスワード（確認）</label>
        <input type="password" id="rp-pass2" class="form-inp" placeholder="同じパスワードを入力" autocomplete="new-password">
      </div>
    </div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button>
     <button class="btn btn-g" onclick="submitResetWorkerPassword('${workerId}')">変更する</button>`
  );
}

async function submitResetWorkerPassword(workerId){
  const pass  = document.getElementById('rp-pass')?.value;
  const pass2 = document.getElementById('rp-pass2')?.value;

  if(!pass||pass.length<6) return toast('エラー','パスワードは6文字以上にしてください','r');
  if(pass!==pass2)         return toast('エラー','パスワードが一致しません','r');

  try{
    const res  = await fetch(`/app/api/workers/${workerId}/reset-password`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:pass}),
    });
    const json = await res.json();
    if(!json.ok) return toast('エラー', json.error||'変更に失敗しました','r');
    closeModal();
    toast('変更完了','パスワードを変更しました','g');
  }catch(e){
    toast('エラー','ネットワークエラー','r');
  }
}

// ── Worker CRUD ──────────────────────────────────────────────────────────────
function openEditW(id){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ編集できます','r');return;}
  const w=WORKERS.find(x=>x.id===id);if(!w)return;
  const rexp=(w.residenceExpire||'').replace(/\//g,'-');
  const pexp=(w.passportExpire||'').replace(/\//g,'-');
  const edt=(w.entryDate||'').replace(/\//g,'-');
  const cend=(w.contractEnd||'').replace(/\//g,'-');
  openModal(w.name+' を編集',
    `<div style="display:flex;flex-direction:column;gap:8px;max-height:70vh;overflow-y:auto">
      <div style="font-size:12px;font-weight:700;color:var(--gn)">基本情報</div>
      <div class="fg2"><div class="fgc"><label class="form-lbl">名前</label><input class="form-inp" id="en" value="${w.name}"></div>
        <div class="fgc"><label class="form-lbl">職種</label><input class="form-inp" id="ej" value="${w.job}"></div></div>
      <div class="fg2"><div class="fgc"><label class="form-lbl">月額給与</label><input class="form-inp" id="es" value="${w.salary||''}"></div>
        <div class="fgc"><label class="form-lbl">ステータス</label><select class="form-inp" id="est"><option value="active" ${w.status==='active'?'selected':''}>出勤中</option><option value="issue" ${w.status==='issue'?'selected':''}>要確認</option><option value="inactive" ${w.status==='inactive'?'selected':''}>非アクティブ</option></select></div></div>
      <div class="fg2"><div class="fgc"><label class="form-lbl">所属</label><input class="form-inp" id="edept" value="${w.dept||''}"></div>
        <div class="fgc"><label class="form-lbl">担当者</label><input class="form-inp" id="esup" value="${w.supervisor||''}"></div></div>
      <div class="fg1"><label class="form-lbl">住所</label><input class="form-inp" id="eaddr" value="${w.address||''}"></div>
      <div class="fg1"><label class="form-lbl">緊急連絡先</label><input class="form-inp" id="eemg" value="${w.emergencyContact||''}"></div>
      <div style="font-size:12px;font-weight:700;color:var(--gn);margin-top:8px">在留情報</div>
      <div class="fg2"><div class="fgc"><label class="form-lbl">国籍</label><input class="form-inp" id="enat" value="${w.nationality||''}"></div>
        <div class="fgc"><label class="form-lbl">在留資格</label><select class="form-inp" id="evisa">
          <option ${w.visaType==='技能実習1号ロ'?'selected':''}>技能実習1号ロ</option>
          <option ${w.visaType==='技能実習2号ロ'?'selected':''}>技能実習2号ロ</option>
          <option ${w.visaType==='技能実習3号'?'selected':''}>技能実習3号</option>
          <option ${w.visaType==='特定技能1号'?'selected':''}>特定技能1号</option>
          <option ${w.visaType==='特定技能2号'?'selected':''}>特定技能2号</option>
        </select></div></div>
      <div class="fg2"><div class="fgc"><label class="form-lbl">在留カード番号</label><input class="form-inp" id="erc" value="${w.residenceCard||''}"></div>
        <div class="fgc"><label class="form-lbl">在留期限</label><input type="date" class="form-inp" id="erexp" value="${rexp}"></div></div>
      <div class="fg2"><div class="fgc"><label class="form-lbl">パスポート番号</label><input class="form-inp" id="epass" value="${w.passport||''}"></div>
        <div class="fgc"><label class="form-lbl">パスポート期限</label><input type="date" class="form-inp" id="epexp" value="${pexp}"></div></div>
      <div class="fg2"><div class="fgc"><label class="form-lbl">入国日</label><input type="date" class="form-inp" id="eentry" value="${edt}"></div>
        <div class="fgc"><label class="form-lbl">契約終了日</label><input type="date" class="form-inp" id="ecend" value="${cend}"></div></div>
      <div class="fg1"><label class="form-lbl">保険</label><input class="form-inp" id="eins" value="${w.insurance||''}"></div>
    </div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button>
     <button class="btn btn-g" onclick="saveW('${id}')">保存</button>`);
}

function saveW(id){
  const w=WORKERS.find(x=>x.id===id);if(!w)return;
  const v=i=>document.getElementById(i)?.value||'';
  const d2s=i=>{const val=v(i);return val?val.replace(/-/g,'/'):''};
  w.name=v('en')||w.name;w.job=v('ej')||w.job;w.salary=v('es')||w.salary;
  w.status=v('est')||w.status;w.dept=v('edept')||w.dept;w.supervisor=v('esup')||w.supervisor;
  w.address=v('eaddr')||w.address;w.emergencyContact=v('eemg')||w.emergencyContact;
  w.nationality=v('enat')||w.nationality;w.visaType=v('evisa')||w.visaType;
  w.residenceCard=v('erc')||w.residenceCard;w.residenceExpire=d2s('erexp')||w.residenceExpire;
  w.passport=v('epass')||w.passport;w.passportExpire=d2s('epexp')||w.passportExpire;
  w.entryDate=d2s('eentry')||w.entryDate;w.contractEnd=d2s('ecend')||w.contractEnd;
  w.insurance=v('eins')||w.insurance;
  w.init=w.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  closeModal();renderWL();openWD(w);
  // Persist to DB
  fetch(`/workers/${w.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    name:w.name,job_title:w.job,salary:w.salary,status:w.status,department:w.dept,supervisor:w.supervisor,
    address:w.address,emergency_contact:w.emergencyContact,nationality:w.nationality,visa_type:w.visaType,
    residence_card:w.residenceCard,residence_expire:w.residenceExpire,passport_number:w.passport,
    passport_expire:w.passportExpire,entry_date:w.entryDate,contract_end:w.contractEnd,insurance:w.insurance,
    _method:'PUT'
  })}).catch(()=>{});
  toast('保存完了',w.name+' を更新しました');
}

function openAddWorker(){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ追加できます','r');return;}
  openModal('実習生を追加',
    `<div style="display:flex;flex-direction:column;gap:8px">
      <div class="fg2"><div class="fgc"><label class="form-lbl">名前 <span style="color:var(--red)">*</span></label><input class="form-inp" id="an" placeholder="例: Tran Van A"></div>
        <div class="fgc"><label class="form-lbl">言語</label><select class="form-inp" id="al"><option value="vi">🇻🇳 ベトナム語</option><option value="id">🇮🇩 インドネシア語</option><option value="tl">🇵🇭 フィリピン語</option><option value="my">🇲🇲 ミャンマー語</option></select></div></div>
      <div class="fg2"><div class="fgc"><label class="form-lbl">職種</label><input class="form-inp" id="aj" placeholder="例: 溶接工"></div>
        <div class="fgc"><label class="form-lbl">国籍</label><input class="form-inp" id="anat" placeholder="例: ベトナム"></div></div>
      <div class="fg2"><div class="fgc"><label class="form-lbl">在留資格</label><select class="form-inp" id="avisa"><option>技能実習1号ロ</option><option>技能実習2号ロ</option><option>技能実習3号</option><option>特定技能1号</option><option>特定技能2号</option></select></div>
        <div class="fgc"><label class="form-lbl">在留期限</label><input type="date" class="form-inp" id="arexp"></div></div>
    </div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button>
     <button class="btn btn-g" onclick="addW()">追加</button>`);
}

function addW(){
  const name=document.getElementById('an')?.value?.trim();
  if(!name){toast('エラー','名前を入力してください','r');return;}
  const v=i=>document.getElementById(i)?.value||'';
  const d2s=i=>{const val=v(i);return val?val.replace(/-/g,'/'):''};
  const lang=v('al');
  const job=v('aj')||'未設定';
  const flags={vi:'🇻🇳',id:'🇮🇩',tl:'🇵🇭',my:'🇲🇲'};
  const ll={vi:'ベトナム語',id:'インドネシア語',tl:'フィリピン語',my:'ミャンマー語'};
  const cols={vi:['#d1fae5','#065f46'],id:['#dbeafe','#1e40af'],tl:['#fee2e2','#991b1b'],my:['#fef3c7','#92400e']};
  const c=cols[lang]||['#f3f4f6','#374151'];
  const id='w'+Date.now();
  const init=name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const newW={
    id,name,lang,lLabel:ll[lang]||lang,flag:flags[lang]||'🌐',job,year:'1年目',docs:'0/0',
    status:'active',bg:c[0],tc:c[1],init,unread:0,salary:'-',dept:'-',
    nationality:v('anat'),passport:'',passportExpire:null,
    visaType:v('avisa')||'技能実習1号ロ',visaStatus:'在留中',
    residenceCard:'',residenceExpire:d2s('arexp')||null,
    entryDate:null,contractEnd:null,insurance:'',
    emergencyContact:'',address:'',workerDocs:[],hist:[]
  };
  WORKERS.push(newW);HISTORY[id]=[{t:'sys',txt:'チャット開始'}];
  // Persist to DB
  fetch('/workers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    name,language:lang,job_title:job,nationality:v('anat'),visa_type:v('avisa'),
    residence_expire:d2s('arexp')||null,status:'active'
  })}).catch(()=>{});
  closeModal();renderWL();toast('追加完了',name+' を追加しました');
}

// ── 書類 ──────────────────────────────────────────────────────────────────────
function renderDL(search='', workerF='', statusF='') {
  const el = document.getElementById('dl-items');
  if (!el) return;
  el.innerHTML = '';

  // フィルタ適用
  let filtered = DOCS.filter(d => {
    if (DOC_CAT_FILTER !== 'all' && d.category !== DOC_CAT_FILTER) return false;
    if (search && !d.name.toLowerCase().includes(search) && !(d.content||'').toLowerCase().includes(search)) return false;
    if (workerF && d.workerId !== workerF) return false;
    if (statusF && calcDocStatus(d) !== statusF) return false;
    return true;
  });

  // 件数更新
  const countEl = document.getElementById('doc-count-label');
  if (countEl) countEl.textContent = `${filtered.length}件 / 全${DOCS.length}件`;

  if (!filtered.length) {
    el.innerHTML = `<div style="padding:28px 16px;text-align:center;color:var(--t3)">
      <div style="font-size:28px;margin-bottom:8px">📂</div>
      <div style="font-size:13px;font-weight:600">書類がありません</div>
      <div style="font-size:12px;margin-top:4px">フィルタを変更するか「+ 追加」から登録してください</div>
    </div>`;
    return;
  }

  if (DOC_CAT_FILTER === 'all') {
    // カテゴリごとにグループ化して表示
    const catOrder = ['contract','visa','passport','insurance','salary','safety','technical_intern','specified_skilled','tax','other'];
    const groups = {};
    filtered.forEach(d => {
      const c = d.category || 'other';
      if (!groups[c]) groups[c] = [];
      groups[c].push(d);
    });
    const orderedCats = catOrder.filter(c => groups[c]);
    // 定義外カテゴリも追加
    Object.keys(groups).forEach(c => { if (!orderedCats.includes(c)) orderedCats.push(c); });

    orderedCats.forEach(cat => {
      const docs = groups[cat];
      const cfg  = DOC_CATS[cat] || { label: cat, icon:'📄', bg:'#f3f4f6', color:'#374151' };
      // カテゴリヘッダー
      const hdr = document.createElement('div');
      hdr.className = 'doc-cat-hdr';
      hdr.innerHTML = `
        <span style="font-size:15px">${cfg.icon}</span>
        <span style="font-size:12px;font-weight:700;color:var(--tx)">${cfg.label}</span>
        <span class="badge bg" style="font-size:10px;margin-left:auto">${docs.length}</span>`;
      el.appendChild(hdr);
      docs.forEach(d => el.appendChild(_buildDocItem(d)));
    });
  } else {
    // 単一カテゴリ表示
    filtered.forEach(d => el.appendChild(_buildDocItem(d)));
  }
}

// 書類リストアイテム生成
function _buildDocItem(d) {
  const div  = document.createElement('div');
  div.className = 'pitem doc-pitem' + (AD?.id === d.id ? ' on' : '');
  div.onclick   = () => openDoc(d);

  const st   = calcDocStatus(d);
  const stCfg = DOC_STATUS_CFG[st] || DOC_STATUS_CFG.active;

  // 紐付き従業員
  const w = d.workerId ? WORKERS.find(x => x.id === d.workerId) : null;
  const workerBadge = w
    ? `<span style="display:inline-flex;align-items:center;gap:2px;font-size:9.5px;background:${w.bg};color:${w.tc};border-radius:4px;padding:1px 5px;font-weight:600">${w.flag} ${w.name.split(' ')[0]}</span>`
    : '';

  // ファイル種別
  const ext = (d.fileName || '').split('.').pop().toLowerCase();
  const fileTag = d.fileUrl
    ? `<span style="font-size:9.5px;color:var(--blu);font-weight:600">${ext ? ext.toUpperCase() : '📎'}</span>`
    : '';

  const catCfg = DOC_CATS[d.category] || DOC_CATS.other;

  div.innerHTML = `
    <div style="width:34px;height:34px;border-radius:8px;background:${catCfg.bg};display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0">${catCfg.icon}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:12.5px;font-weight:600;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.name}</div>
      <div style="font-size:11px;color:var(--t3);margin-top:2px;display:flex;gap:4px;align-items:center;flex-wrap:wrap">
        ${d.updated || ''}
        ${fileTag}
        ${workerBadge}
      </div>
    </div>
    <span class="badge ${stCfg.cls}" style="font-size:9.5px;flex-shrink:0;align-self:flex-start;margin-top:2px">${stCfg.icon}</span>`;
  return div;
}

function renderDocPanel(){
  if(!AD){const dp=document.getElementById('dd-panel');if(!dp)return;dp.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--t3);background:var(--bg)"><svg width="44" height="44" viewBox="0 0 44 44" fill="none"><rect x="7" y="3" width="30" height="38" rx="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M13 13h18M13 21h18M13 29h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><div style="font-size:16px;font-weight:700">書類を選んでください</div></div>`;}}

function openDoc(doc){
  AD=doc;renderDL();docEditing=false;
  const panel=document.getElementById('dd-panel');
  const now=new Date();

  // 公開期限バナー（色分け）
  let expBanner='';
  if(doc.expireDate){
    const diff=(new Date(doc.expireDate.replace(/\//g,'-'))-now)/(1000*60*60*24);
    if(diff<0)      expBanner=`<div style="background:var(--rbg);border:1px solid #fca5a5;border-radius:8px;padding:8px 12px;font-size:12.5px;color:var(--red);font-weight:600">⛔ 公開期限切れ: ${doc.expireDate}</div>`;
    else if(diff<=30) expBanner=`<div style="background:var(--abg);border:1px solid #fcd34d;border-radius:8px;padding:8px 12px;font-size:12.5px;color:var(--amb);font-weight:600">⚠️ 公開期限まで残${Math.ceil(diff)}日: ${doc.expireDate}</div>`;
    else              expBanner=`<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:8px 12px;font-size:12.5px;color:var(--gn)">📅 公開期限: ${doc.expireDate}</div>`;
  }

  // ロール閲覧制限バッジ
  const roleLabels={admin:'👑 管理者',manager:'🎯 マネージャー',staff:'👤 スタッフ',trainee:'🌏 技能実習生'};
  const visRoles=(doc.visibleRoles||[]);
  const visHtml=visRoles.length?`<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">${visRoles.map(r=>`<span class="badge bgray" style="font-size:10px">${roleLabels[r]||r}</span>`).join('')}</div>`:'';

  // ── ファイルセクション ──────────────────────────────────────────────────────
  let fileSection='';
  if(doc.fileUrl){
    const fn    = doc.fileName||'ファイル';
    const ext   = fn.split('.').pop().toLowerCase();
    const mime  = doc.mimeType||'';
    const isPdf = ext==='pdf'||mime.includes('pdf');
    const isImg = ['png','jpg','jpeg','gif','webp','svg'].includes(ext)||mime.startsWith('image/');
    const sizeTxt = doc.fileSize
      ? (doc.fileSize>1024*1024?(doc.fileSize/1024/1024).toFixed(1)+'MB':Math.round(doc.fileSize/1024)+'KB')
      : '';

    fileSection=`
      <div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#e0f2fe">
          <span style="font-size:22px">${isPdf?'📕':isImg?'🖼️':'📎'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:#0369a1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${fn}">${fn}</div>
            ${sizeTxt?`<div style="font-size:11px;color:#0284c7;margin-top:1px">${sizeTxt}${mime?' · '+mime:''}</div>`:''}
          </div>
          <div style="display:flex;gap:5px;flex-shrink:0">
            <a href="${doc.fileUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-b btn-sm" style="text-decoration:none">🔗 新タブ</a>
            <a href="${doc.fileUrl}" download="${fn}" class="btn btn-sm" style="text-decoration:none">⬇ DL</a>
            ${isPdf||isImg?'<button class="btn btn-g btn-sm" id="pdf-toggle-btn" onclick="togglePdfEmbed()">📄 プレビュー</button>':''}
          </div>
        </div>
        <div id="pdf-embed-area" style="display:none;border-top:1px solid #bae6fd">
          ${isPdf?`
            <iframe
              id="pdf-iframe"
              src="${doc.fileUrl}#toolbar=1&navpanes=0"
              width="100%"
              height="640"
              type="application/pdf"
              style="border:none;display:block"
              title="${fn}"
              loading="lazy"
            ></iframe>`:''}
          ${isImg&&!isPdf?`<div style="padding:12px;text-align:center;background:#fff">
            <img src="${doc.fileUrl}" alt="${fn}" style="max-width:100%;max-height:560px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.1)">
          </div>`:''}
        </div>
      </div>`;
  }

  // 確認状況
  const confs=doc.confs||[];
  const confHtml=confs.length?confs.map(c=>`<div class="conf-row"><div style="width:24px;height:24px;border-radius:50%;background:${c.s==='done'?'var(--gbg)':'var(--s2)'};color:${c.s==='done'?'var(--gn)':'var(--t3)'};display:flex;align-items:center;justify-content:center;font-size:12px">${c.s==='done'?'✓':'—'}</div><div style="flex:1;font-size:13px">${c.name||c.wid}</div><div style="font-size:11.5px;color:var(--t3)">${c.date||'-'}</div><span class="badge ${c.s==='done'?'bg':'bgray'}">${c.s==='done'?'確認済':'未確認'}</span></div>`).join(''):'<div style="padding:14px;font-size:13px;color:var(--t3)">確認記録なし</div>';

  panel.innerHTML=`
    <div style="background:var(--s2);border-bottom:1px solid var(--bd);padding:12px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0;box-shadow:var(--sh)">
      <span style="font-size:22px">${doc.ico}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:700;color:var(--tx)">${doc.name}</div>
        <div style="font-size:12px;color:var(--t3);margin-top:2px">更新日: ${doc.updated||'-'}${doc.category?' · '+doc.category:''}</div>
        ${visHtml}
      </div>
      <div style="display:flex;gap:7px;flex-shrink:0">
        ${IS_ADMIN?`<button class="btn btn-sm" onclick="toggleDocEdit()" id="doc-edit-btn">✏️ 編集</button>`:''}
        ${IS_ADMIN?`<button class="btn btn-sm btn-r" onclick="deleteDoc('${doc.id}')">🗑 削除</button>`:''}
      </div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--bg)">
      ${expBanner}${fileSection}
      <div class="dv-wrap">
        <div class="dv-toolbar"><span style="font-size:12.5px;font-weight:700;color:var(--t2)">📄 書類内容</span></div>
        <div class="dv-content" id="dv-content" contenteditable="false">${doc.content?doc.content.replace(/</g,'&lt;').replace(/\n/g,'<br>'):'<span style="color:var(--t3)">内容なし</span>'}</div>
      </div>
      <div class="card"><div style="padding:11px 14px;font-size:13.5px;font-weight:700;border-bottom:1px solid var(--bd)">確認状況</div>${confHtml}</div>
    </div>`;
}

function togglePdfEmbed(){
  const area=document.getElementById('pdf-embed-area');
  const btn =document.getElementById('pdf-toggle-btn');
  if(!area)return;
  const show=area.style.display==='none';
  area.style.display=show?'block':'none';
  if(btn)btn.textContent=show?'✕ 閉じる':'📄 プレビュー';
}

async function deleteDoc(docId){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ削除できます','r');return;}
  openModal('書類の削除',
    `<div style="padding:8px 0;color:var(--red)">⚠️ この書類を削除しますか？この操作は取り消せません。</div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button>
     <button class="btn btn-r" onclick="_confirmDeleteDoc('${docId}')">削除する</button>`
  );
}
async function _confirmDeleteDoc(docId){
  closeModal();
  const idx=DOCS.findIndex(d=>d.id===docId);
  if(idx>-1) DOCS.splice(idx,1);
  AD=null;
  filterDocs();
  renderDocPanel();
  toast('削除完了','書類を削除しました','a');
  try{ await fetch(`/app/api/documents/${docId}`,{method:'DELETE'}); }catch{}
}

function toggleDocEdit(){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ編集できます','r');return;}
  docEditing=!docEditing;
  const el=document.getElementById('dv-content');const btn=document.getElementById('doc-edit-btn');if(!el)return;
  if(docEditing){el.contentEditable='true';el.focus();el.style.background='var(--sf)';el.style.border='1.5px solid var(--gn)';if(btn)btn.textContent='💾 保存';}
  else{el.contentEditable='false';el.style.background='';el.style.border='';if(AD){AD.content=el.innerText;toast('保存完了','書類を更新しました');}if(btn)btn.textContent='✏️ 編集';}
}

// ── 書類カテゴリ定義（拡張版） ────────────────────────────────────────────────
const DOC_CATS = {
  contract:          { label:'雇用契約書',     icon:'📋', bg:'#e6f9f0', color:'#065f46' },
  visa:              { label:'在留カード',      icon:'🪪', bg:'#fefce8', color:'#713f12' },
  passport:          { label:'パスポート',      icon:'📘', bg:'#eff6ff', color:'#1e40af' },
  insurance:         { label:'保険書類',        icon:'🏥', bg:'#f0fdf4', color:'#14532d' },
  salary:            { label:'給与・賃金',      icon:'💴', bg:'#dbeafe', color:'#1e3a8a' },
  safety:            { label:'安全・研修',      icon:'📒', bg:'#f5f3ff', color:'#4c1d95' },
  technical_intern:  { label:'技能実習関連',   icon:'🏭', bg:'#fce7f3', color:'#831843' },
  specified_skilled: { label:'特定技能関連',   icon:'⭐', bg:'#fef3c7', color:'#78350f' },
  tax:               { label:'税務書類',        icon:'🧾', bg:'#ecfdf5', color:'#064e3b' },
  other:             { label:'その他',          icon:'📄', bg:'#f3f4f6', color:'#374151' },
};
// 後方互換エイリアス（既存 mapDoc の CAT_ICO/CAT_BG と同じ値）
const DOC_CAT_ICONS = Object.fromEntries(Object.entries(DOC_CATS).map(([k,v])=>[k,v.icon]));
const DOC_CAT_BGS   = Object.fromEntries(Object.entries(DOC_CATS).map(([k,v])=>[k,v.bg]));

// ── 書類フィルタ状態 ──────────────────────────────────────────────────────────
let DOC_CAT_FILTER = 'all';

// ステータス計算（DBなし・クライアント計算）
function calcDocStatus(d) {
  if (!d.fileUrl) return 'nofile';
  if (!d.expireDate) return 'active';
  const now  = new Date();
  const exp  = new Date(d.expireDate.replace(/\//g, '-'));
  const diff = (exp - now) / (1000 * 60 * 60 * 24);
  if (diff < 0)   return 'expired';
  if (diff <= 30) return 'expiring';
  return 'active';
}

const DOC_STATUS_CFG = {
  active:   { label:'有効',    cls:'bg',    icon:'✅' },
  expiring: { label:'期限間近', cls:'ba',    icon:'⚠️' },
  expired:  { label:'期限切れ', cls:'br',    icon:'❌' },
  nofile:   { label:'未添付',   cls:'bgray', icon:'📭' },
};

// カテゴリフィルタ切替
function setDocCat(cat, el) {
  DOC_CAT_FILTER = cat;
  document.querySelectorAll('#doc-cat-filters .fc').forEach(f => f.classList.remove('on'));
  if (el) el.classList.add('on');
  filterDocs();
}

// フィルタ適用 → renderDL 呼び出し
function filterDocs() {
  const search  = (document.getElementById('doc-search')?.value || '').toLowerCase();
  const worker  = document.getElementById('doc-worker-filter')?.value || '';
  const status  = document.getElementById('doc-status-filter')?.value || '';
  renderDL(search, worker, status);
}

// 書類フィルタ初期化（従業員セレクト）
function initDocFilters() {
  const sel = document.getElementById('doc-worker-filter');
  if (!sel) return;
  // 既にオプションが入っていれば skip
  if (sel.options.length > 1) return;
  WORKERS.forEach(w => {
    const o = document.createElement('option');
    o.value = w.id; o.textContent = `${w.flag} ${w.name}`;
    sel.appendChild(o);
  });
}

function openAddDoc(){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ書類を追加できます','r');return;}
  const workerOpts = WORKERS.map(w=>`<option value="${w.id}">${w.flag} ${w.name}</option>`).join('');
  openModal('書類を追加',
    `<div style="display:flex;flex-direction:column;gap:12px">
      <div><div class="modal-label">書類名 <span style="color:var(--red)">*</span></div><input id="dn" class="modal-inp" placeholder="例：就業規則（2025年版）"></div>
      <div><div class="modal-label">カテゴリ</div>
        <select id="doc-cat" class="modal-inp">
          <option value="contract">📋 雇用契約書</option>
          <option value="visa">🪪 在留カード</option>
          <option value="passport">📘 パスポート</option>
          <option value="insurance">🏥 保険書類</option>
          <option value="salary">💴 給与・賃金</option>
          <option value="safety">📒 安全・研修</option>
          <option value="technical_intern">🏭 技能実習関連</option>
          <option value="specified_skilled">⭐ 特定技能関連</option>
          <option value="tax">🧾 税務書類</option>
          <option value="other">📄 その他</option>
        </select>
      </div>
      <div><div class="modal-label">対象実習生（任意）</div>
        <select id="doc-worker" class="modal-inp"><option value="">会社共通</option>${workerOpts}</select>
      </div>
      <div>
        <div class="modal-label">ファイル（PDF・Word・Excel・画像）</div>
        <!-- input と label を for= で接続 → HTML標準動作で1回だけダイアログが開く -->
        <input type="file" id="doc-file"
               accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp"
               style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"
               onchange="previewDocFile(this)">
        <label for="doc-file" id="pdf-drop-zone"
               style="display:flex;align-items:center;gap:10px;padding:11px 12px;border:2px dashed var(--bd2);border-radius:8px;cursor:pointer;background:var(--s2);transition:border-color .15s;user-select:none">
          <span style="font-size:22px">📎</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--t2)">クリックしてファイルを選択</div>
            <div style="font-size:11.5px;color:var(--t3);margin-top:1px">PDF・Word・Excel・画像 対応 / 最大50MB</div>
          </div>
        </label>
        <div id="doc-file-preview" style="display:none;margin-top:6px;padding:8px 10px;background:var(--gbg);border-radius:6px;font-size:12.5px;color:var(--gn);align-items:center;gap:6px">
          <span id="doc-file-icon">📄</span><span id="doc-file-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
          <button type="button" onclick="clearDocFile()" style="background:none;border:none;cursor:pointer;color:var(--t3);font-size:16px;flex-shrink:0;padding:0">✕</button>
        </div>
      </div>
      <div><div class="modal-label">メモ</div><textarea id="dc" class="modal-inp" rows="2" placeholder="書類の概要・注意事項など"></textarea></div>
      <div><div class="modal-label">公開期限（任意）</div><input type="date" id="doc-expire" class="modal-inp"></div>
      <div>
        <div class="modal-label">閲覧できるロール（複数選択可）</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer"><input type="checkbox" id="vis-admin"   value="admin"   checked style="accent-color:var(--gn)"> 👑 管理者</label>
          <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer"><input type="checkbox" id="vis-manager" value="manager" checked style="accent-color:var(--gn)"> 🎯 マネージャー</label>
          <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer"><input type="checkbox" id="vis-staff"   value="staff"   checked style="accent-color:var(--gn)"> 👤 スタッフ</label>
          <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer"><input type="checkbox" id="vis-trainee" value="trainee"         style="accent-color:var(--gn)"> 🌏 技能実習生</label>
        </div>
      </div>
    </div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button><button class="btn btn-g" id="add-doc-submit" onclick="addDoc()">追加する</button>`
  );
  // ファイル変更は input の onchange で処理（ダブルダイアログ防止）
}

function previewDocFile(input){
  const file = input?.files?.[0]; if(!file) return;
  const preview = document.getElementById('doc-file-preview');
  const nameEl  = document.getElementById('doc-file-name');
  const iconEl  = document.getElementById('doc-file-icon');
  if(preview) preview.style.display='flex';
  if(nameEl)  nameEl.textContent=`${file.name} (${(file.size/1024/1024).toFixed(1)}MB)`;
  if(iconEl)  iconEl.textContent=fileIcon(file.name, file.type);
  const nameInput = document.getElementById('dn');
  if(nameInput && !nameInput.value) nameInput.value = file.name.replace(/\.[^/.]+$/,'');
  const zone = document.getElementById('pdf-drop-zone');
  if(zone){ zone.style.borderColor='var(--gn)'; zone.style.background='var(--gbg)'; }
}
function clearDocFile(){
  const inp = document.getElementById('doc-file'); if(inp) inp.value='';
  const prev = document.getElementById('doc-file-preview'); if(prev) prev.style.display='none';
}

async function addDoc(){
  const name = document.getElementById('dn')?.value?.trim();
  if(!name){toast('エラー','書類名を入力してください','r');return;}
  const cat      = document.getElementById('doc-cat')?.value || 'other';
  const workerId = document.getElementById('doc-worker')?.value || null;
  const notes    = document.getElementById('dc')?.value?.trim();
  const expire   = document.getElementById('doc-expire')?.value;
  const fileInp  = document.getElementById('doc-file');
  const file     = fileInp?.files?.[0];
  const visibleRoles=['admin','manager','staff','trainee'].filter(r=>document.getElementById('vis-'+r)?.checked);

  const btn = document.getElementById('add-doc-submit');
  if(btn){ btn.disabled=true; btn.textContent=file?'アップロード中...':'追加中...'; }

  try{
    const fd = new FormData();
    fd.append('name', name);
    fd.append('category', cat);
    if(workerId) fd.append('worker_id', workerId);
    if(notes)   fd.append('notes', notes);
    if(expire)  fd.append('expire_date', expire);
    if(file)    fd.append('file', file);
    fd.append('visible_roles', JSON.stringify(visibleRoles));

    const r = await fetch('/app/api/documents/upload', {method:'POST', body:fd});
    const d = await r.json();

    if(d.ok){
      // d.doc は常に返ってくる（ローカルJSON保存済み）
      if(d.doc && !DOCS.find(x=>x.id===d.doc.id)) DOCS.push(d.doc);
      closeModal();filterDocs();
      const ico = file ? fileIcon(file.name, file.type) : '';
      toast('追加完了', name+(file?' ('+ico+' ファイルあり)':'')+' を追加しました');
    }else{
      throw new Error(d.error||'追加に失敗しました');
    }
  }catch(e){
    toast('エラー',e.message,'r');
    if(btn){ btn.disabled=false; btn.textContent='追加する'; }
  }
}

// ── 書類生成 ─────────────────────────────────────────────────────────────────
function genDocFromTemplate(workerId,templateKey){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ生成できます','r');return;}
  const w=WORKERS.find(x=>x.id===workerId);const tpl=DOC_TEMPLATES[templateKey];if(!w||!tpl)return;
  openModal(`${tpl.icon} ${tpl.name}を生成`,
    `<div style="margin-bottom:10px;font-size:13.5px;font-weight:700">対象: ${w.name}</div>
     <div style="border:1px solid var(--bd);border-radius:8px;padding:16px;max-height:360px;overflow-y:auto;background:#fff;font-family:serif;font-size:12.5px;line-height:1.8">${tpl.gen(w)}</div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button><button class="btn btn-g" onclick="confirmGenDoc('${workerId}','${templateKey}')">📄 PDF出力</button>`);
}

function confirmGenDoc(wid,key){
  const w=WORKERS.find(x=>x.id===wid);const tpl=DOC_TEMPLATES[key];if(!w||!tpl)return;
  const htmlContent=tpl.gen(w);
  const now=new Date();const dateStr=now.toLocaleDateString('ja-JP');
  const fileName=tpl.name+'_'+w.name.replace(/\s+/g,'_')+'.pdf';
  if(!w.workerDocs)w.workerDocs=[];
  w.workerDocs.push({name:tpl.name,icon:tpl.icon,fileName,html:htmlContent,createdAt:dateStr,templateKey:key});
  generatePDF(htmlContent,fileName);closeModal();
  setTimeout(()=>openWD(w),200);toast('書類生成完了',tpl.name+' を生成しました');
}

function generatePDF(htmlContent,filename){
  const win=window.open('','','width=800,height=600');if(!win){toast('エラー','ポップアップがブロックされました','r');return;}
  const css='*{margin:0;padding:0;box-sizing:border-box}body{font-family:serif;padding:20mm;font-size:13px;line-height:1.8;color:#111}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #999;padding:6px 10px;text-align:left}th{background:#f0f0f0;font-weight:700}.title{font-size:18px;font-weight:700;text-align:center;margin-bottom:12px}.section{font-size:14px;font-weight:700;margin:14px 0 6px;border-bottom:2px solid #333;padding-bottom:3px}@media print{body{padding:15mm}}';
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+(filename||'document')+'</title><style>'+css+'</style></head><body>'+htmlContent+'</body></html>');
  win.document.close();setTimeout(()=>{win.print();},600);
}

function viewWorkerDoc(workerId,idx){const w=WORKERS.find(x=>x.id===workerId);const doc=w?.workerDocs?.[idx];if(!doc)return;window._previewDoc=doc;openModal(doc.icon+' '+doc.name,'<div style="border:1px solid var(--bd);border-radius:8px;padding:18px;max-height:480px;overflow-y:auto;background:#fff;font-family:serif;font-size:13px;line-height:1.8">'+doc.html+'</div>','<button class="btn" onclick="closeModal()">閉じる</button> <button class="btn btn-g" onclick="generatePDF(window._previewDoc.html,window._previewDoc.fileName)">📄 PDF出力</button>');}
function downloadWorkerDoc(workerId,idx){const w=WORKERS.find(x=>x.id===workerId);const doc=w?.workerDocs?.[idx];if(!doc)return;generatePDF(doc.html,doc.fileName);}
function deleteWorkerDoc(workerId,idx){if(!IS_ADMIN){toast('権限エラー','管理者のみ削除できます','r');return;}const w=WORKERS.find(x=>x.id===workerId);if(!w?.workerDocs?.[idx])return;const docName=w.workerDocs[idx].name;openModal('書類を削除',`<div style="font-size:14px">「${docName}」を削除しますか？</div>`,`<button class="btn" onclick="closeModal()">キャンセル</button><button class="btn btn-r" onclick="const w=WORKERS.find(x=>x.id==='${workerId}');w.workerDocs.splice(${idx},1);closeModal();openWD(w);toast('削除完了','書類を削除しました')">削除する</button>`);}

// ── KANBAN ────────────────────────────────────────────────────────────────────
let TASK_YEAR = new Date().getFullYear();
let TASK_MONTH = new Date().getMonth()+1;
let TASK_MODE = 'all'; // 'all' | 'month'

function taskPrevMonth(){ if(--TASK_MONTH<1){TASK_MONTH=12;TASK_YEAR--;} renderKanban(); }
function taskNextMonth(){ if(++TASK_MONTH>12){TASK_MONTH=1;TASK_YEAR++;} renderKanban(); }
function setTaskMode(m){ TASK_MODE=m; renderKanban(); }

function updateTaskProgress(){
  const total = TASKS.length;
  const done  = TASKS.filter(t=>t.status==='done').length;
  const pct   = total ? Math.round(done/total*100) : 0;
  const bar   = document.getElementById('task-progress-bar');
  const lbl   = document.getElementById('task-progress-pct');
  if(bar) bar.style.width = pct+'%';
  if(lbl) lbl.textContent = pct+'%';
}

function renderKanban(){
  const cols=['todo','progress','review','done'];
  const labels={todo:'📋 未着手',progress:'🔵 進行中',review:'🟡 レビュー',done:'✅ 完了'};
  const borders={todo:'#e53e3e',progress:'#2563eb',review:'#d97706',done:'#059669'};
  const _kb=document.getElementById('kanban-board');if(!_kb)return;

  // 月フィルタ更新
  const mTitle=document.getElementById('task-month-title');
  if(mTitle) mTitle.textContent=TASK_MODE==='all'?'すべてのタスク':`${TASK_YEAR}年${TASK_MONTH}月`;
  const mNav=document.getElementById('task-month-nav');
  if(mNav) mNav.style.opacity=TASK_MODE==='all'?'0.3':'1';

  // フィルタリング
  let visibleTasks=TASKS;
  if(TASK_MODE==='month'){
    visibleTasks=TASKS.filter(t=>{
      if(!t.due||t.due==='-') return true;
      const d=new Date(String(t.due).replace(/\//g,'-'));
      return !isNaN(d)&&d.getFullYear()===TASK_YEAR&&d.getMonth()+1===TASK_MONTH;
    });
  }

  _kb.innerHTML=cols.map(col=>{
    const tasks=visibleTasks.filter(t=>t.status===col);
    return `<div class="k-col"><div class="k-col-hdr" style="border-left-color:${borders[col]}">${labels[col]}<span class="badge bgray">${tasks.length}</span></div>
    <div class="k-col-body">${tasks.length?tasks.map(t=>`<div class="k-card" onclick="openTaskDetail('${t.id}')">
      <div class="k-card-title">${t.title}</div>
      <div class="k-card-meta"><span class="badge ${t.priority==='high'?'br':t.priority==='medium'?'ba':'bgray'}" style="font-size:10px">${t.priority==='high'?'高優先':t.priority==='medium'?'中優先':'低優先'}</span><span style="font-size:11px;color:var(--t3)">${t.due||'-'}締切</span></div>
      <div class="k-avs">${(t.assignees||[]).map(a=>`<div class="k-av" style="background:${a.bg};color:${a.tc}">${a.init}</div>`).join('')}</div>
    </div>`).join(''):'<div style="padding:16px;text-align:center;color:var(--t3);font-size:12.5px">タスクなし</div>'}</div></div>`;
  }).join('');
  updateTaskProgress();
}

function openAddTask(){if(!IS_ADMIN){toast('権限エラー','管理者・リーダーのみ追加できます','r');return;}openModal('タスクを追加',`<div class="form-row"><label class="form-lbl">タスク名</label><input class="form-inp" id="tn" placeholder="例: 安全マニュアルを更新する"></div><div class="form-row"><label class="form-lbl">優先度</label><select class="form-inp" id="tp"><option value="high">高優先</option><option value="medium">中優先</option><option value="low">低優先</option></select></div><div class="form-row"><label class="form-lbl">期限</label><input type="date" class="form-inp" id="td"></div>`,`<button class="btn" onclick="closeModal()">キャンセル</button><button class="btn btn-g" onclick="addTask()">追加</button>`);}
function addTask(){const title=document.getElementById('tn')?.value?.trim();if(!title){toast('エラー','タスク名を入力してください','r');return;}TASKS.push({id:'t'+Date.now(),title,priority:document.getElementById('tp')?.value||'medium',due:document.getElementById('td')?.value||'-',status:'todo',assignees:[]});closeModal();renderKanban();toast('追加完了',title+' を追加しました');}
function openTaskDetail(id){
  const t=TASKS.find(x=>x.id===id);if(!t)return;
  openModal(t.title,
    `<div class="form-row"><label class="form-lbl">ステータス</label>
      <select class="form-inp" id="ts-status">
        <option value="todo"     ${t.status==='todo'    ?'selected':''}>📋 未着手</option>
        <option value="progress" ${t.status==='progress'?'selected':''}>🔵 進行中</option>
        <option value="review"   ${t.status==='review'  ?'selected':''}>🟡 レビュー</option>
        <option value="done"     ${t.status==='done'    ?'selected':''}>✅ 完了</option>
      </select>
    </div>
    <div class="form-row"><label class="form-lbl">優先度</label>
      <select class="form-inp" id="ts-priority">
        <option value="high"   ${t.priority==='high'  ?'selected':''}>高優先</option>
        <option value="medium" ${t.priority==='medium'?'selected':''}>中優先</option>
        <option value="low"    ${t.priority==='low'   ?'selected':''}>低優先</option>
      </select>
    </div>`,
    `<button class="btn btn-r btn-sm" onclick="deleteTask('${id}')">削除</button>
     <button class="btn" onclick="closeModal()">閉じる</button>
     <button class="btn btn-g" onclick="saveTaskStatus('${id}')">更新</button>`
  );
}
function saveTaskStatus(id){
  const t=TASKS.find(x=>x.id===id);
  if(!t) return;
  t.status   = document.getElementById('ts-status')?.value   || t.status;
  t.priority = document.getElementById('ts-priority')?.value || t.priority;
  closeModal();
  renderKanban(); // updateTaskProgress() は renderKanban 内で呼ばれる
  toast('更新完了','ステータスを更新しました');
}
function deleteTask(id){
  const idx=TASKS.findIndex(x=>x.id===id);
  if(idx===-1) return;
  TASKS.splice(idx,1);
  closeModal();
  renderKanban();
  toast('削除','タスクを削除しました','a');
}

// ── GROUP CHAT ────────────────────────────────────────────────────────────────
async function renderGCL(){
  // タブを開くたびに最新取得
  await loadGroups();
  const el=document.getElementById('gc-list');if(!el)return;el.innerHTML='';
  if(!GROUPS.length){
    el.innerHTML='<div style="padding:30px 14px;text-align:center;color:var(--t3);font-size:13px">グループがありません<br><button class="btn btn-g btn-sm" style="margin-top:10px" onclick="openCreateGroup()">＋ 作成</button></div>';
    return;
  }
  GROUPS.forEach(g=>{
    const d=document.createElement('div');d.className='gc-item'+(AG?.id===g.id?' on':'');d.onclick=()=>openGChat(g);
    d.innerHTML=`<div class="gc-ico" style="background:${g.bg}">${g.ico}</div><div style="flex:1;min-width:0"><div class="gc-name">${g.name}</div><div class="gc-prev">${g.prev||g.desc||''}</div><div class="gc-time">${g.time||''}</div></div>${g.unread?`<div class="gc-unread">${g.unread}</div>`:''}`;
    el.appendChild(d);
  });
}

function _gMsgToLocal(m){
  const time = new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
  const isMe = m.sender_id === GB_USER?.id;
  return { t: isMe?'me':'other', txt: m.body, tl: m.translated||'', time, read: true, _id: m.id, sender_id: m.sender_id };
}

async function _loadGroupMessages(g){
  try{
    const res  = await fetch(`/app/api/groups/${g.id}/messages`);
    const json = await res.json();
    if(!json.ok) return;
    g.msgs = (json.messages||[]).map(_gMsgToLocal);
    if(json.messages?.length) _gMsgLastTs[g.id] = json.messages.at(-1).created_at;
  }catch(e){ console.warn('[group] load error:', e); }
}

async function openGChat(g){
  AG=g; g.unread=0; renderGCL();
  document.getElementById('gchat-welcome').style.display='none';
  const ga=document.getElementById('gchat-active'); ga.style.display='flex';
  document.getElementById('gch-ico').textContent=g.ico; document.getElementById('gch-ico').style.background=g.bg;
  document.getElementById('gch-name').textContent=g.name;
  document.getElementById('gch-sub').textContent=`${g.memberCount||g.members?.length||0}名 · ${g.desc||''}`;
  await _loadGroupMessages(g);
  renderMsgs('gchat-msgs', g.msgs||[], {bg:'#f3f4f6',tc:'#374151',init:g.ico});
  _startGroupPoll(g);
}

function _startGroupPoll(g){
  if(_groupPollTimer) clearInterval(_groupPollTimer);
  _groupPollTimer = setInterval(async()=>{
    if(!AG || AG.id !== g.id) { clearInterval(_groupPollTimer); return; }
    try{
      const after = _gMsgLastTs[g.id] || '';
      const url   = `/app/api/groups/${g.id}/messages${after?'?after='+encodeURIComponent(after):''}`;
      const res   = await fetch(url);
      const json  = await res.json();
      if(!json.ok || !json.messages?.length) return;
      json.messages.forEach(m => {
        if(!g.msgs) g.msgs = [];
        g.msgs.push(_gMsgToLocal(m));
        _gMsgLastTs[g.id] = m.created_at;
      });
      renderMsgs('gchat-msgs', g.msgs, {bg:'#f3f4f6',tc:'#374151',init:g.ico});
    }catch{}
  }, 5000);
}

function insertGQuick(txt){const i=document.getElementById('gchat-inp');if(i){i.value=txt;i.focus();}}

async function sendGChat(){
  const inp=document.getElementById('gchat-inp');const txt=inp?.value?.trim();if(!txt||!AG)return;
  inp.value=''; inp.style.height='auto';
  const time=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});

  // 楽観的UI更新
  const m={who:'admin',t:'me',txt,time,read:true};
  if(!AG.msgs) AG.msgs=[];
  AG.msgs.push(m);
  addBub('gchat-msgs', m, {bg:'#f3f4f6',tc:'#374151',init:AG.ico}, true);

  try{
    const res = await fetch(`/app/api/groups/${AG.id}/messages`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({body: txt})
    });
    const json = await res.json();
    if(json.ok && json.message){ _gMsgLastTs[AG.id] = json.message.created_at; }
    toast('送信','グループに送信しました','g');
  }catch(e){ toast('エラー','送信に失敗しました','r'); }
}

const GROUP_ICONS=['💬','👥','🏭','⚙️','📋','🌏','🔧','📊','🇻🇳','🇮🇩','🇵🇭','🇲🇲'];
const GROUP_COLORS=['#f3f4f6','#e0e7ff','#d1fae5','#dbeafe','#fef3c7','#fee2e2','#fce7f3'];

function openCreateGroup(){
  if(!IS_ADMIN){toast('権限エラー','管理者のみグループを作成できます','r');return;}
  const workerOpts=WORKERS.map(w=>`<option value="${w.id}">${w.flag} ${w.name}</option>`).join('');
  openModal('グループを作成',
    `<div class="form-row"><label class="form-lbl">グループ名 *</label><input class="form-inp" id="gn" placeholder="例: 食品加工チーム"></div>
     <div style="display:flex;gap:10px">
       <div style="flex:1"><div class="modal-label">アイコン</div><select class="modal-inp" id="g-ico">${GROUP_ICONS.map(e=>`<option value="${e}">${e}</option>`).join('')}</select></div>
       <div style="flex:1"><div class="modal-label">カラー</div><select class="modal-inp" id="g-color">${GROUP_COLORS.map(c=>`<option value="${c}" style="background:${c}">${c}</option>`).join('')}</select></div>
     </div>
     <div class="form-row"><label class="form-lbl">説明</label><input class="form-inp" id="g-desc" placeholder="このグループの目的"></div>
     <div class="form-row"><label class="form-lbl">初期メンバー（複数可）</label><select class="form-inp" id="g-members" multiple style="height:90px">${workerOpts}</select></div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button><button class="btn btn-g" onclick="createGroup()">作成</button>`
  );
}
async function createGroup(){
  const name=document.getElementById('gn')?.value?.trim();
  if(!name){toast('エラー','グループ名を入力してください','r');return;}
  const ico=document.getElementById('g-ico')?.value||'💬';
  const bg=document.getElementById('g-color')?.value||'#f3f4f6';
  const desc=document.getElementById('g-desc')?.value?.trim()||'';
  const sel=document.getElementById('g-members');
  const selectedWorkerIds = sel?Array.from(sel.selectedOptions).map(o=>o.value):[];
  // worker.id → authUserId に変換（紐付け済みのみ）
  const member_ids = selectedWorkerIds
    .map(wid => WORKERS.find(w => w.id === wid)?.authUserId)
    .filter(Boolean);

  try{
    const res  = await fetch('/app/api/groups', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, icon: ico, bg_color: bg, description: desc, member_ids })
    });
    const json = await res.json();
    if(!json.ok) return toast('エラー', json.error||'作成に失敗しました', 'r');
    closeModal();
    await renderGCL();
    toast('作成完了','「'+name+'」グループを作成しました');
  }catch(e){ toast('エラー','ネットワークエラー','r'); }
}

function openManageGroup(){
  if(!AG){return;}
  // AG.members は authUserId の配列。Worker情報に変換
  const memberUserIds = AG.members || [];
  const memberWorkers = memberUserIds
    .map(uid => WORKERS.find(w => w.authUserId === uid))
    .filter(Boolean);
  const memberWorkerIds = memberWorkers.map(w => w.id);
  const nonMembers = WORKERS.filter(w => w.authUserId && !memberWorkerIds.includes(w.id));
  const memberRows = memberWorkers.map(w => `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--bd)">
      <div style="width:28px;height:28px;border-radius:50%;background:${w.bg};color:${w.tc};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${w.init}</div>
      <div style="flex:1;font-size:13px">${w.flag} ${w.name}</div>
      ${IS_ADMIN?`<button class="btn btn-xs btn-r" onclick="removeGroupMember('${w.authUserId}')">✕ 削除</button>`:''}
    </div>`).join('');
  const addOpts = nonMembers.map(w => `<option value="${w.id}">${w.flag} ${w.name}</option>`).join('');
  openModal(`👥 メンバー管理 — ${AG.name}`,
    `<div style="margin-bottom:10px">
       <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:6px">現在のメンバー (${members.length}名)</div>
       <div id="mgr-member-list">${memberRows||'<div style="padding:8px;color:var(--t3);font-size:13px">メンバーなし</div>'}</div>
     </div>
     ${IS_ADMIN&&nonMembers.length?`<div>
       <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:6px">メンバーを追加</div>
       <div style="display:flex;gap:8px">
         <select class="form-inp" id="mgr-add-sel" style="flex:1">${addOpts}</select>
         <button class="btn btn-g" onclick="addGroupMember()">追加</button>
       </div>
     </div>`:''}`,
    `<button class="btn" onclick="closeModal()">閉じる</button>`
  );
}
async function addGroupMember(){
  if(!AG)return;
  const wid = document.getElementById('mgr-add-sel')?.value; if(!wid) return;
  const w = WORKERS.find(x => x.id === wid);
  if(!w?.authUserId){ toast('エラー','このワーカーはアカウント未紐付けです','r'); return; }
  if(!AG.members) AG.members = [];
  if(AG.members.includes(w.authUserId)){ toast('通知','すでにメンバーです','a'); return; }

  const newMembers = [...AG.members, w.authUserId];
  try{
    const res = await fetch(`/app/api/groups/${AG.id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ member_ids: newMembers })
    });
    const json = await res.json();
    if(!json.ok) return toast('エラー', json.error||'追加に失敗しました', 'r');
    AG.members = newMembers;
    AG.memberCount = newMembers.length;
    openManageGroup();
    _updateGroupSub();
    toast('追加', `${w.name}をグループに追加しました`);
  }catch(e){ toast('エラー','ネットワークエラー','r'); }
}

async function removeGroupMember(userId){
  if(!AG)return;
  const newMembers = (AG.members||[]).filter(m => m !== userId);
  try{
    const res = await fetch(`/app/api/groups/${AG.id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ member_ids: newMembers })
    });
    const json = await res.json();
    if(!json.ok) return toast('エラー', json.error||'削除に失敗しました', 'r');
    AG.members = newMembers;
    AG.memberCount = newMembers.length;
    openManageGroup();
    _updateGroupSub();
    const w = WORKERS.find(x => x.authUserId === userId);
    toast('削除', `${w?.name||''}をグループから削除しました`, 'a');
  }catch(e){ toast('エラー','ネットワークエラー','r'); }
}

function _updateGroupSub(){
  const sub=document.getElementById('gch-sub');
  if(sub&&AG) sub.textContent=`${AG.memberCount||AG.members?.length||0}名 · ${AG.desc||''}`;
}

function openEditGroup(){
  if(!AG)return;
  const icoOpts=GROUP_ICONS.map(e=>`<option value="${e}"${AG.ico===e?' selected':''}>${e}</option>`).join('');
  const clrOpts=GROUP_COLORS.map(c=>`<option value="${c}"${AG.bg===c?' selected':''} style="background:${c}">${c}</option>`).join('');
  openModal(`⚙️ グループ設定 — ${AG.name}`,
    `<div class="form-row"><label class="form-lbl">グループ名</label><input class="form-inp" id="eg-name" value="${AG.name}"></div>
     <div style="display:flex;gap:10px">
       <div style="flex:1"><div class="modal-label">アイコン</div><select class="modal-inp" id="eg-ico">${icoOpts}</select></div>
       <div style="flex:1"><div class="modal-label">カラー</div><select class="modal-inp" id="eg-color">${clrOpts}</select></div>
     </div>
     <div class="form-row"><label class="form-lbl">説明</label><input class="form-inp" id="eg-desc" value="${AG.desc||''}"></div>
     ${IS_ADMIN?`<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--bd)"><button class="btn btn-r btn-sm" onclick="deleteGroup()">🗑 グループを削除</button></div>`:''}`,
    `<button class="btn" onclick="closeModal()">キャンセル</button>
     <button class="btn btn-g" onclick="saveGroupEdit()">保存</button>`
  );
}
async function saveGroupEdit(){
  if(!AG)return;
  const name = document.getElementById('eg-name')?.value?.trim() || AG.name;
  const icon = document.getElementById('eg-ico')?.value || AG.ico;
  const bg_color = document.getElementById('eg-color')?.value || AG.bg;
  const description = document.getElementById('eg-desc')?.value?.trim() || '';
  try{
    const res = await fetch(`/app/api/groups/${AG.id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, icon, bg_color, description })
    });
    const json = await res.json();
    if(!json.ok) return toast('エラー', json.error||'更新に失敗しました', 'r');
    AG.name = name; AG.ico = icon; AG.bg = bg_color; AG.desc = description;
    closeModal();
    document.getElementById('gch-ico').textContent = AG.ico;
    document.getElementById('gch-ico').style.background = AG.bg;
    document.getElementById('gch-name').textContent = AG.name;
    _updateGroupSub();
    renderGCL();
    toast('更新','グループ設定を更新しました');
  }catch(e){ toast('エラー','ネットワークエラー','r'); }
}

async function deleteGroup(){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ削除できます','r');return;}
  if(!confirm(`「${AG.name}」を削除しますか？\nメッセージも全て消えます。`)) return;
  try{
    const res = await fetch(`/app/api/groups/${AG.id}`, {method:'DELETE'});
    const json = await res.json();
    if(!json.ok) return toast('エラー', json.error||'削除に失敗しました', 'r');
    closeModal();
    AG = null;
    document.getElementById('gchat-welcome').style.display='';
    document.getElementById('gchat-active').style.display='none';
    renderGCL();
    toast('削除','グループを削除しました','a');
  }catch(e){ toast('エラー','ネットワークエラー','r'); }
}

// ── VIDEOS ────────────────────────────────────────────────────────────────────
function renderVL(cat){
  const el=document.getElementById('v-list');if(!el)return;el.innerHTML='';
  VIDEOS.filter(v=>!cat||cat==='all'||v.cat===cat).forEach(v=>{
    const d=document.createElement('div');d.className='v-item'+(AV?.id===v.id?' on':'');d.onclick=()=>openVideo(v);
    d.innerHTML=`<div class="v-thumb"><span style="font-size:22px">${v.emoji||'🎬'}</span><div class="v-play"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><polygon points="3,2 13,7 3,12" fill="white"/></svg></div><div class="v-dur">${v.dur}</div></div>
    <div class="v-meta"><div class="v-title">${v.title}</div><div class="v-info">${(v.langs||[]).map(l=>({vi:'🇻🇳',id:'🇮🇩',tl:'🇵🇭',my:'🇲🇲',ja:'🇯🇵'}[l]||l)).join('')} · ${v.dur}</div></div>`;
    el.appendChild(d);
  });
}

function filterVideos(cat,el){document.querySelectorAll('#v-cats .fc').forEach(c=>c.classList.remove('on'));el.classList.add('on');renderVL(cat);}

function openVideo(v){
  AV=v;renderVL();
  const panel=document.getElementById('vd-panel');
  panel.innerHTML=`<div style="flex:1;overflow-y:auto;padding:16px;background:var(--bg)">
    <div class="vd-player" onclick="toast('再生','動画プレーヤーに連携します','b')">
      <div style="position:absolute;font-size:60px;opacity:.3">${v.emoji||'🎬'}</div>
      <div class="vd-play"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><polygon points="6,4 20,11 6,18" fill="white"/></svg></div>
      <div style="position:absolute;bottom:10px;right:14px;color:rgba(255,255,255,.7);font-size:13px">${v.dur}</div>
    </div>
    <div class="card" style="margin-bottom:12px"><div class="card-hdr"><span class="card-title">${v.title}</span></div>
      <div style="padding:12px 14px;font-size:13.5px;color:var(--t2);line-height:1.7">${v.desc||''}</div>
      <div style="padding:8px 14px 12px;display:flex;gap:8px;flex-wrap:wrap">${(v.langs||[]).map(l=>`<span class="badge bgray">${{vi:'🇻🇳 ベトナム語',id:'🇮🇩 インドネシア語',tl:'🇵🇭 フィリピン語',my:'🇲🇲 ミャンマー語',ja:'🇯🇵 日本語'}[l]||l}</span>`).join('')}</div>
    </div>
  </div>`;
}

function openUploadVideo(){if(!IS_ADMIN){toast('権限エラー','管理者のみ動画を追加できます','r');return;}openModal('動画を追加',`<div class="form-row"><label class="form-lbl">タイトル *</label><input class="form-inp" id="vt" placeholder="例：溶接作業 安全確認手順"></div><div class="form-row"><label class="form-lbl">カテゴリ</label><select class="form-inp" id="vc"><option value="safety">安全</option><option value="work">作業</option><option value="training">研修</option></select></div>`,`<button class="btn" onclick="closeModal()">キャンセル</button><button class="btn btn-g" onclick="uploadVideo()">追加する</button>`);}
function uploadVideo(){const title=document.getElementById('vt')?.value?.trim();if(!title){toast('エラー','タイトルを入力してください','r');return;}VIDEOS.push({id:'v'+Date.now(),title,emoji:'🎬',cat:document.getElementById('vc')?.value||'work',dur:'--:--',langs:['ja'],desc:'',views:0});closeModal();renderVL();toast('追加完了',title+' を追加しました');}

// ── NIPPO ─────────────────────────────────────────────────────────────────────
// DB から日報を取得して描画
let _npFilter = 'all';
let _npMonth  = '';   // YYYY-MM（月絞込・空=全期間）

const _NP_ST = {
  pending:  { txt:'確認待ち', cls:'pending'  },
  reviewed: { txt:'確認済',   cls:'reviewed' },
  returned: { txt:'差戻し',   cls:'returned' },
};
function _npEsc(s){ return (s==null?'':String(s)).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function loadAndRenderNPL(opts){
  try {
    const params = new URLSearchParams();
    if (_npMonth && /^\d{4}-\d{2}$/.test(_npMonth)) {
      const [y, m] = _npMonth.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      params.set('from', `${_npMonth}-01`);
      params.set('to',   `${_npMonth}-${String(last).padStart(2,'0')}`);
    }
    const url = '/app/api/daily-reports' + (params.toString() ? '?'+params.toString() : '');
    const res  = await fetch(url);
    const json = await res.json();
    if (json.ok) NIPPOS = json.reports || [];
  } catch(e) {
    console.error('[nippo] load error:', e);
  }
  updateNpStats();
  renderNPL();
  // 初期表示: 未確認優先 → 最新 を自動選択（既に選択中ならそのまま）
  if (opts?.autoselect !== false && !AN) {
    const target = _npAutoTarget();
    if (target) openNippo(target);
  } else if (AN) {
    // 既存選択を最新データで更新
    const fresh = NIPPOS.find(x => x.id === AN.id);
    if (fresh) { /* 詳細は openNippo 内で再fetch */ }
  }
}

function _npAutoTarget(){
  const sorted = [...NIPPOS].sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
  return sorted.find(n => n.status === 'pending') || sorted[0] || null;
}

function updateNpStats(){
  const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tokyo'}); // YYYY-MM-DD
  const ym = today.slice(0,7);
  const norm = d => (d||'').replace(/\//g,'-').slice(0,10);
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('nps-today',   NIPPOS.filter(n=>norm(n.date)===today).length);
  set('nps-pending', NIPPOS.filter(n=>n.status==='pending').length);
  set('nps-hayari',  NIPPOS.filter(n=>n.type==='hayari').length);
  set('nps-month',   NIPPOS.filter(n=>norm(n.date).startsWith(ym)).length);
}

function setNpFilter(el){
  document.querySelectorAll('#np-filters .fc').forEach(d=>d.classList.remove('on'));
  el.classList.add('on');
  _npFilter = el.dataset.f || 'all';
  renderNPL();
}

function _npMatchFilter(n){
  const f=_npFilter;
  if(f==='all') return true;
  if(f==='pending'||f==='reviewed'||f==='returned') return n.status===f;
  if(f==='daily') return n.type==='daily';
  if(f==='hayari') return n.type==='hayari';
  if(f==='image') return (n.imageCount||0)>0;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tokyo'});
  const norm=d=>(d||'').replace(/\//g,'-').slice(0,10);
  if(f==='today') return norm(n.date)===today;
  if(f==='week'){ const d=new Date(); d.setDate(d.getDate()-7); return norm(n.date) >= d.toISOString().slice(0,10); }
  if(f==='month'){ return norm(n.date).startsWith(today.slice(0,7)); }
  return true;
}

// 月選択（任意の月で絞込）→ APIに from/to を渡して再ロード
function setNpMonth(ym){
  _npMonth = ym || '';
  AN = null;
  loadAndRenderNPL();
}

function renderNPL(){
  const el=document.getElementById('np-list');if(!el)return;el.innerHTML='';
  const q=(document.getElementById('np-search')?.value||'').trim().toLowerCase();
  let list=NIPPOS.filter(_npMatchFilter);
  if(q){
    list=list.filter(n =>
      (n.author||'').toLowerCase().includes(q) ||
      (n.title||'').toLowerCase().includes(q) ||
      (n.original||'').toLowerCase().includes(q) ||
      (n.translated||'').toLowerCase().includes(q)
    );
  }
  list=[...list].sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
  if(!list.length){el.innerHTML='<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">該当する日報がありません</div>';return;}
  list.forEach(n=>{
    const w=WORKERS.find(x=>x.id===n.wid);
    const st=_NP_ST[n.status]||_NP_ST.pending;
    const dt=n.created_at ? new Date(n.created_at) : null;
    const dtStr=dt ? `${dt.toLocaleDateString('ja-JP',{month:'2-digit',day:'2-digit'})} ${dt.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}` : (n.date||'');
    const d=document.createElement('div');
    d.className='np-item'+(AN?.id===n.id?' on':'');
    d.onclick=()=>openNippo(n);
    const metaBits=[];
    if((n.imageCount||0)>0) metaBits.push(`📷${n.imageCount}枚`);
    if((n.commentCount||0)>0) metaBits.push(`💬${n.commentCount}件`);
    d.innerHTML=`
      <div class="np-item-av" style="background:${w?.bg||'#f3f4f6'};color:${w?.tc||'#374151'}">${w?.init||'?'}</div>
      <div class="np-item-body">
        <div class="np-item-top">
          <span class="np-item-name">${_npEsc(n.author)}</span>
          <span class="np-item-type ${n.type==='hayari'?'hayari':'daily'}">${n.type==='hayari'?'⚠ ヒヤリ':'📄 日報'}</span>
        </div>
        <div class="np-item-title">${_npEsc(n.title)||'（本文なし）'}</div>
        <div class="np-item-meta">${metaBits.map(b=>`<span>${b}</span>`).join('')}<span>${dtStr}</span></div>
      </div>
      <div class="np-item-right">
        <span class="np-st ${st.cls}">${st.txt}</span>
      </div>`;
    el.appendChild(d);
  });
}

async function openNippo(n){
  AN=n;
  renderNPL(); // 選択ハイライト更新
  const panel=document.getElementById('np-detail');if(!panel)return;
  panel.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--t3)">読み込み中...</div>';

  let detail=null, comments=[], history=[];
  try{
    const res=await fetch(`/app/api/daily-reports/${n.id}`);
    const j=await res.json();
    if(j.ok){ detail=j.report; comments=j.comments||[]; history=j.history||[]; }
  }catch(e){ console.warn('[nippo detail]',e); }
  const r = detail || n;  // 詳細取得失敗時は一覧データで代替
  const w=WORKERS.find(x=>x.id===r.wid);
  const st=_NP_ST[r.status]||_NP_ST.pending;

  // 承認アクションボタン（状態に応じて）
  const btns=[];
  if(IS_ADMIN){
    if(r.status!=='reviewed') btns.push(`<button class="btn btn-g btn-sm" onclick="setReportStatus('${r.id}','reviewed')">✓ 確認済みにする</button>`);
    if(r.status!=='returned') btns.push(`<button class="btn btn-sm" style="border-color:#fca5a5;color:#dc2626" onclick="setReportStatus('${r.id}','returned')">↩ 差戻し</button>`);
    if(r.status!=='pending')  btns.push(`<button class="btn btn-sm" onclick="setReportStatus('${r.id}','pending')">確認待ちに戻す</button>`);
  }

  // 添付画像サムネイル
  const imgs=(r.attachments||[]).filter(a=>a&&a.type==='image');
  const files=(r.attachments||[]).filter(a=>a&&a.type!=='image');
  const thumbs=imgs.map(a=>`<img class="np-thumb" src="${a.url}" onclick="openImgModal('${a.url}')" alt="${_npEsc(a.name||'')}">`).join('');
  const fileLinks=files.map(a=>`<a href="${a.url}" target="_blank" rel="noopener" style="display:inline-block;padding:6px 10px;background:#fff;border:1px solid var(--bd);border-radius:8px;font-size:12px;margin:2px">📎 ${_npEsc(a.name||'ファイル')}</a>`).join('');

  // メタ情報
  const dtStr=r.created_at ? new Date(r.created_at).toLocaleString('ja-JP') : (r.date||'');
  const metaRows=[
    ['種別', r.type==='hayari'?'⚠ ヒヤリ・ハット':'📄 日報'],
    ['作成者', _npEsc(r.author)+(r.department?`（${_npEsc(r.department)}）`:'')],
    ['作成日時', dtStr],
  ];
  if(r.site_name) metaRows.push(['現場名', _npEsc(r.site_name)]);
  if(r.work_content) metaRows.push(['作業内容', _npEsc(r.work_content)]);

  // コメント
  const commentHtml=comments.length
    ? comments.map(c=>`<div class="np-comment">
        <div class="np-comment-av">${_npEsc((c.author_name||'管').charAt(0))}</div>
        <div class="np-comment-body">
          <div><span class="np-comment-name">${_npEsc(c.author_name||'管理者')}</span> <span class="np-comment-time">${new Date(c.created_at).toLocaleString('ja-JP')}</span></div>
          <div class="np-comment-text">${_npEsc(c.body)}</div>
        </div></div>`).join('')
    : '<div style="font-size:12.5px;color:var(--t3);padding:6px 0">まだコメントはありません</div>';

  // 履歴
  const histHtml=history.length
    ? history.map(h=>`<div class="np-hist"><span class="np-hist-dot"></span><span>${new Date(h.created_at).toLocaleString('ja-JP')} — ${_npEsc(h.actor_name||'管理者')} が「${(_NP_ST[h.to_status]||{txt:h.to_status}).txt}」に変更${h.note?'（'+_npEsc(h.note)+'）':''}</span></div>`).join('')
    : '<div style="font-size:11.5px;color:var(--t3);padding:4px 0">履歴なし</div>';

  panel.innerHTML=`
    <div class="np-detail-hdr">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="np-item-av" style="background:${w?.bg||'#f3f4f6'};color:${w?.tc||'#374151'}">${w?.init||'?'}</div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:700">${_npEsc(r.author)} — ${r.type==='hayari'?'ヒヤリ・ハット':'日報'}</div>
          <div style="font-size:11.5px;color:var(--t3)">${dtStr}</div>
        </div>
        <span class="np-st ${st.cls}" style="font-size:12px">${st.txt}</span>
      </div>
      ${btns.length?`<div class="np-detail-actions">${btns.join('')}</div>`:''}
    </div>
    <div style="flex:1;overflow-y:auto;padding:16px;background:var(--bg);display:flex;flex-direction:column;gap:12px">
      <div class="card"><div class="card-hdr"><span class="card-title">基本情報</span></div>
        <div style="padding:14px"><dl class="np-meta-grid">${metaRows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>
      </div>
      ${r.original?`<div class="card"><div class="card-hdr"><span class="card-title">本文（原文）</span></div><div style="padding:14px;font-size:13.5px;line-height:1.8;white-space:pre-wrap">${_npEsc(r.original)}</div></div>`:''}
      ${(r.translated&&r.translated!==r.original)?`<div class="card"><div class="card-hdr"><span class="card-title">日本語</span><span class="badge bg">翻訳</span></div><div style="padding:14px;font-size:13.5px;line-height:1.8">${_npEsc(r.translated)}</div></div>`:''}
      ${imgs.length?`<div class="card"><div class="card-hdr"><span class="card-title">添付画像（${imgs.length}）</span></div><div style="padding:14px"><div class="np-thumbs">${thumbs}</div></div></div>`:''}
      ${files.length?`<div class="card"><div class="card-hdr"><span class="card-title">添付ファイル</span></div><div style="padding:14px">${fileLinks}</div></div>`:''}
      <div class="card"><div class="card-hdr"><span class="card-title">コメント</span></div>
        <div style="padding:12px 14px">
          <div id="np-comments">${commentHtml}</div>
          ${IS_ADMIN?`<div style="display:flex;gap:6px;margin-top:10px">
            <input id="np-comment-input" class="finp" placeholder="コメントを追加..." style="flex:1" onkeydown="if(event.key==='Enter'){addReportComment('${r.id}')}">
            <button class="btn btn-g btn-sm" onclick="addReportComment('${r.id}')">送信</button>
          </div>`:''}
        </div>
      </div>
      <div class="card"><div class="card-hdr"><span class="card-title">承認履歴</span></div>
        <div style="padding:10px 14px">${histHtml}</div>
      </div>
    </div>`;
}

async function setReportStatus(id, status){
  try{
    const res=await fetch(`/app/api/daily-reports/${id}`,{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status}),
    });
    const j=await res.json();
    if(!j.ok) throw new Error(j.error);
    const n=NIPPOS.find(x=>x.id===id); if(n) n.status=status;
    updateNpStats();
    if(AN?.id===id) await openNippo(NIPPOS.find(x=>x.id===id)||AN);
    else renderNPL();
    const lbl=_NP_ST[status]?.txt||status;
    toast('更新完了',`ステータスを「${lbl}」に変更しました`);
  }catch(e){ toast('エラー',e.message||'更新に失敗しました','r'); }
}

async function addReportComment(id){
  const inp=document.getElementById('np-comment-input');
  const body=(inp?.value||'').trim();
  if(!body){ toast('エラー','コメントを入力してください','r'); return; }
  try{
    const res=await fetch(`/app/api/daily-reports/${id}/comments`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({body}),
    });
    const j=await res.json();
    if(!j.ok) throw new Error(j.error);
    const n=NIPPOS.find(x=>x.id===id); if(n) n.commentCount=(n.commentCount||0)+1;
    if(AN?.id===id) await openNippo(NIPPOS.find(x=>x.id===id)||AN);
    renderNPL();
    toast('コメント追加','コメントを保存しました');
  }catch(e){ toast('エラー',e.message||'コメント追加に失敗しました','r'); }
}

function openImgModal(url){
  const m=document.getElementById('img-modal'), img=document.getElementById('img-modal-src');
  if(m&&img){ img.src=url; m.style.display='flex'; }
}
function closeImgModal(){
  const m=document.getElementById('img-modal'); if(m) m.style.display='none';
}
function openNewNippo(){openModal('日報・報告を作成',`<div class="form-row"><label class="form-lbl">種別</label><select class="form-inp" id="nt"><option value="daily">日報</option><option value="hayari">ヒヤリハット</option></select></div><div class="form-row"><label class="form-lbl">内容</label><textarea class="form-inp" id="nc" rows="5" placeholder="本日の作業内容、気になる点..."></textarea></div>`,`<button class="btn" onclick="closeModal()">キャンセル</button><button class="btn btn-g" onclick="submitNippo()">送信</button>`);}
function submitNippo(){const content=document.getElementById('nc')?.value?.trim();if(!content){toast('エラー','内容を入力してください','r');return;}closeModal();const id='n'+Date.now();const now=new Date();NIPPOS.unshift({id,author:typeof GB_USER!=='undefined'?GB_USER.full_name:'担当者',flag:'🇯🇵',wid:'',date:now.toLocaleDateString('ja-JP'),type:document.getElementById('nt')?.value||'daily',status:'review',original:content,translated:'',photos:[]});renderNPL();toast('送信完了','日報を送信しました');}

// ══════════════════════════════════════════════════════════════════════════════
// SHIFT
// ══════════════════════════════════════════════════════════════════════════════
const _now = new Date();
let SHIFT_YEAR  = _now.getFullYear();
let SHIFT_MONTH = _now.getMonth() + 1; // 1-based
let SHIFT_DATA  = {}; // key: `${worker_id}_${date}` → {id, shift_type}
let _shiftPickerEl = null;
let SHIFT_REQUESTS = []; // pending requests

const SHIFT_TYPES = [
  {key:'早', label:'早番', sub:'7-16時',  bg:'#dcfce7', color:'#166534'},
  {key:'日', label:'日勤', sub:'8-17時',  bg:'#dbeafe', color:'#1e40af'},
  {key:'遅', label:'遅番', sub:'13-22時', bg:'#fef3c7', color:'#92400e'},
  {key:'休', label:'休み', sub:'',        bg:'#f3f4f6', color:'#6b7280'},
  {key:'有', label:'有休', sub:'',        bg:'#e0e7ff', color:'#3730a3'},
  {key:'欠', label:'欠勤', sub:'',        bg:'#fee2e2', color:'#991b1b'},
];
const SHIFT_DAYS_OFF = new Set(['休','有','欠']);

// ── データ取得 ─────────────────────────────────────────────────────────────────
// localStorage キー（月単位でまとめて保存）
const shiftLsKey = (y, m) => `gb_shifts_${y}_${String(m).padStart(2,'0')}`;

async function loadShiftData(year, month){
  SHIFT_DATA = {};
  SHIFT_REQUESTS = [];

  // ── サーバーから取得（常にDBを正とする） ──────────────────────────────
  let serverOk = false;
  try{
    const r = await fetch(`/app/api/shifts?year=${year}&month=${month}`);
    const d = await r.json();
    if(!d.error){
      SHIFT_DATA = {};  // 0件でも明示的に空でリセット（削除されたシフトを除去）
      (d.shifts || []).forEach(s=>{ SHIFT_DATA[`${s.worker_id}_${s.date}`]=s; });
      SHIFT_REQUESTS = d.requests || [];
      // 取得結果でlocalStorageキャッシュを上書き保存
      try{ localStorage.setItem(shiftLsKey(year,month), JSON.stringify(SHIFT_DATA)); }catch{}
      serverOk = true;
    }
  }catch(e){
    console.warn('shift API unavailable, falling back to local cache');
  }

  // ── サーバー失敗時のみ localStorage から読む（オフラインフォールバック） ──
  if(!serverOk){
    try{
      const local = JSON.parse(localStorage.getItem(shiftLsKey(year,month))||'{}');
      Object.assign(SHIFT_DATA, local);
    }catch{}
  }
}

// ── メインレンダー ─────────────────────────────────────────────────────────────
function rerenderShiftTable(){
  const titleEl = document.getElementById('shift-month-title');
  if(titleEl) titleEl.textContent = `${SHIFT_YEAR}年${SHIFT_MONTH}月`;
  const container = document.getElementById('shift-table-container');
  if(container) container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3)">読み込み中...</div>';
  loadShiftData(SHIFT_YEAR, SHIFT_MONTH).then(()=>renderShiftTable());
}

function renderShiftTable(){
  const container = document.getElementById('shift-table-container');
  if(!container) return;
  if(!WORKERS.length){
    container.innerHTML='<div style="padding:40px;text-align:center;color:var(--t3)">実習生が登録されていません</div>';
    renderShiftRequests();
    return;
  }

  const year  = SHIFT_YEAR;
  const month = SHIFT_MONTH;
  const days  = new Date(year, month, 0).getDate();
  const dayNames = ['日','月','火','水','木','金','土'];
  // 「今日」マーカーは毎回フレッシュに計算（日付またぎ対策）
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  // ── thead ──────────────────────────────────────────────────────────────────
  let html = '<table class="shift-tbl"><thead><tr>';
  html += '<th style="position:sticky;left:0;z-index:2;background:var(--s2);text-align:left">氏名</th>';
  for(let d=1;d<=days;d++){
    const dt = new Date(year, month-1, d);
    const dn = dayNames[dt.getDay()];
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isSun = dt.getDay()===0, isSat = dt.getDay()===6;
    const isToday = dateStr===todayStr;
    const cls = isToday?'today-col':isSun||isSat?'weekend':'';
    html += `<th class="${cls}" style="min-width:40px;padding:8px 4px">${d}<br><span style="font-size:9px;font-weight:400">${dn}</span></th>`;
  }
  html += '<th style="background:var(--s2);min-width:52px">出勤</th></tr></thead>';

  // ── tbody ──────────────────────────────────────────────────────────────────
  html += '<tbody>';
  WORKERS.forEach(w=>{
    html += '<tr>';
    html += `<td style="position:sticky;left:0;z-index:1;background:#fff;padding:7px 12px;white-space:nowrap;text-align:left">
      <span style="font-size:14px">${w.flag}</span>
      <span style="font-size:12.5px;font-weight:600;margin-left:4px">${w.name.split(/\s+/)[0]}</span>
    </td>`;
    let workDays=0;
    for(let d=1;d<=days;d++){
      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const key = `${w.id}_${dateStr}`;
      const rec = SHIFT_DATA[key];
      const dt  = new Date(year, month-1, d);
      const isWeekend = dt.getDay()===0||dt.getDay()===6;
      const isToday   = dateStr===todayStr;
      const defaultType = isWeekend?'休':'日';
      const shiftType = rec?.shift_type || defaultType;
      const st = SHIFT_TYPES.find(x=>x.key===shiftType)||SHIFT_TYPES[1];
      if(!SHIFT_DAYS_OFF.has(shiftType)) workDays++;
      const tdCls = isToday?'today-col':isWeekend?'weekend':'';
      const canEdit = IS_ADMIN;
      html += `<td class="${tdCls}" style="padding:3px">
        <span class="sc${canEdit?' shift-cell-edit':''}"
          style="background:${st.bg};color:${st.color};min-width:32px;display:inline-flex;align-items:center;justify-content:center"
          onclick="${canEdit?`openShiftPicker(this,'${w.id}','${dateStr}','${shiftType}')`:''}">
          ${st.label}
        </span>
      </td>`;
    }
    html += `<td style="font-weight:700;font-size:13px;text-align:center;background:#f8f9fb">${workDays}</td>`;
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
  renderShiftRequests();
}

// ── 申請一覧 ───────────────────────────────────────────────────────────────────
function renderShiftRequests(){
  const el = document.getElementById('shift-requests');
  if(!el) return;
  const cnt = document.getElementById('shift-req-count');
  const pending = SHIFT_REQUESTS.filter(r=>r.status==='pending');
  if(cnt){cnt.textContent=`${pending.length}件 処理待ち`;cnt.style.display=pending.length>0?'inline-flex':'none';}
  if(!pending.length){
    el.innerHTML='<div style="padding:20px 0;text-align:center;color:var(--t3)">申請はありません ✅</div>';
    return;
  }
  el.innerHTML = pending.map(req=>{
    const w = WORKERS.find(x=>x.id===req.worker_id)||{name:req.worker_name||'不明',flag:'👤',bg:'#e5e7eb',tc:'#374151',init:'?'};
    return `<div class="shift-req-row">
      <div style="width:34px;height:34px;border-radius:50%;background:${w.bg};color:${w.tc};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${w.init}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${w.flag} ${w.name}</div>
        <div style="font-size:12px;color:var(--t3);margin-top:1px">${req.date} — ${req.note||''}</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        <button class="btn btn-g btn-xs" onclick="approveShiftReq('${req.id}',this)">✓ 承認</button>
        <button class="btn btn-xs btn-r" onclick="rejectShiftReq('${req.id}',this)">却下</button>
      </div>
    </div>`;
  }).join('');
}

// ── 月ナビ ─────────────────────────────────────────────────────────────────────
function shiftPrevMonth(){
  if(--SHIFT_MONTH<1){SHIFT_MONTH=12;SHIFT_YEAR--;}
  rerenderShiftTable();
}
function shiftNextMonth(){
  if(++SHIFT_MONTH>12){SHIFT_MONTH=1;SHIFT_YEAR++;}
  rerenderShiftTable();
}

// ── シフトピッカー ─────────────────────────────────────────────────────────────
function openShiftPicker(cellEl, workerId, date, currentType){
  if(!IS_ADMIN) return;
  closeShiftPicker();
  const picker = document.createElement('div');
  picker.id = 'shift-picker';
  SHIFT_TYPES.forEach(st=>{
    const btn = document.createElement('button');
    btn.className='btn btn-xs';
    btn.style.cssText=`background:${st.bg};color:${st.color};border-color:transparent;justify-content:center${currentType===st.key?';outline:2px solid currentColor;outline-offset:1px':''}`;
    btn.textContent=st.label+(st.sub?` (${st.sub})`:'');
    btn.onclick=()=>{saveShift(workerId,date,st.key,cellEl);closeShiftPicker();};
    picker.appendChild(btn);
  });
  const rect = cellEl.getBoundingClientRect();
  picker.style.top  = Math.min(rect.bottom+6, window.innerHeight-160)+'px';
  picker.style.left = Math.min(rect.left-20, window.innerWidth-210)+'px';
  document.body.appendChild(picker);
  _shiftPickerEl = picker;
  setTimeout(()=>document.addEventListener('click', _closePickerOutside), 10);
}
function _closePickerOutside(e){if(_shiftPickerEl&&!_shiftPickerEl.contains(e.target))closeShiftPicker();}
function closeShiftPicker(){
  _shiftPickerEl?.remove(); _shiftPickerEl=null;
  document.removeEventListener('click',_closePickerOutside);
}

// ── シフト保存 ─────────────────────────────────────────────────────────────────
async function saveShift(workerId, date, shiftType, cellEl){
  // 楽観的UI更新
  const st = SHIFT_TYPES.find(x=>x.key===shiftType)||SHIFT_TYPES[1];
  if(cellEl){
    cellEl.textContent=st.label;
    cellEl.style.background=st.bg;
    cellEl.style.color=st.color;
    cellEl.setAttribute('onclick',`openShiftPicker(this,'${workerId}','${date}','${shiftType}')`);
  }
  // メモリ更新
  SHIFT_DATA[`${workerId}_${date}`]={worker_id:workerId,date,shift_type:shiftType};
  // サーバー保存（成功時のみ localStorage にも反映）
  try{
    const r = await fetch('/app/api/shifts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({worker_id:workerId,date,shift_type:shiftType})});
    const d = await r.json();
    if(d.ok || d.local){
      // localStorage キャッシュ更新
      try{
        const cur=JSON.parse(localStorage.getItem(shiftLsKey(SHIFT_YEAR,SHIFT_MONTH))||'{}');
        cur[`${workerId}_${date}`]={worker_id:workerId,date,shift_type:shiftType};
        localStorage.setItem(shiftLsKey(SHIFT_YEAR,SHIFT_MONTH),JSON.stringify(cur));
      }catch{}
      toast('保存', d.local ? 'シフトを保存しました（ローカル）' : 'シフトを更新しました（ワーカー側に反映）');
    } else {
      throw new Error(d.error || '保存に失敗しました');
    }
  }catch(e){
    console.error('[shift] save error:', e);
    toast('保存エラー', e.message || 'シフトの保存に失敗しました', 'r');
    // 楽観的UI更新を巻き戻すなら ここで rerenderShiftTable() 呼ぶ
  }
}

// ── シフト申請 ─────────────────────────────────────────────────────────────────
function openShiftRequest(){
  const workerOpts = WORKERS.map(w=>`<option value="${w.id}">${w.flag} ${w.name}</option>`).join('');
  openModal('シフト希望申請',
    `<div class="form-row"><label class="form-lbl">対象者</label><select class="form-inp" id="sr-wid"><option value="">自分の申請</option>${workerOpts}</select></div>
     <div class="form-row"><label class="form-lbl">希望日</label><input type="date" class="form-inp" id="sr-date"></div>
     <div class="form-row"><label class="form-lbl">希望シフト</label><select class="form-inp" id="sr-type">${SHIFT_TYPES.map(s=>`<option value="${s.key}">${s.label}${s.sub?' ('+s.sub+')':''}</option>`).join('')}</select></div>
     <div class="form-row"><label class="form-lbl">申請理由</label><textarea class="form-inp" id="sr-note" rows="3" placeholder="有給取得、体調不良、etc..."></textarea></div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button><button class="btn btn-g" onclick="submitShiftRequest()">申請する</button>`
  );
}
async function submitShiftRequest(){
  const wid  = document.getElementById('sr-wid')?.value;
  const date = document.getElementById('sr-date')?.value;
  const type = document.getElementById('sr-type')?.value;
  const note = document.getElementById('sr-note')?.value?.trim();
  if(!date){toast('エラー','希望日を選択してください','r');return;}
  closeModal();
  try{
    const r = await fetch('/app/api/shift-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({worker_id:wid||null,date,shift_type:type,note})});
    const d = await r.json();
    if(d.ok){toast('申請完了','シフト希望申請を送信しました');rerenderShiftTable();}
    else toast('エラー',d.error||'申請に失敗しました','r');
  }catch(e){
    // DBなしでもUIだけ更新
    const req={id:'req_'+Date.now(),worker_id:wid||null,worker_name:WORKERS.find(x=>x.id===wid)?.name||'自分',date,shift_type:type,note,status:'pending'};
    SHIFT_REQUESTS.unshift(req);
    renderShiftRequests();
    toast('申請完了','シフト希望を送信しました（ローカル）');
  }
}

async function approveShiftReq(reqId, btn){
  const req = SHIFT_REQUESTS.find(r=>r.id===reqId);
  if(!req) return;
  req.status='approved';
  renderShiftRequests();
  if(req.worker_id&&req.date&&req.shift_type) await saveShift(req.worker_id,req.date,req.shift_type,null);
  toast('承認','シフト申請を承認しました');
  try{await fetch(`/app/api/shift-requests/${reqId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'approved'})});}catch{}
}
async function rejectShiftReq(reqId, btn){
  const req = SHIFT_REQUESTS.find(r=>r.id===reqId);
  if(!req) return;
  req.status='rejected';
  renderShiftRequests();
  toast('却下','申請を却下しました','a');
  try{await fetch(`/app/api/shift-requests/${reqId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'rejected'})});}catch{}
}
// 旧インタフェース互換
function approveShiftReq(el,msg){if(typeof el==='string')return;if(el){el.textContent='✓';el.disabled=true;}toast('承認',msg||'申請を承認しました');}
function rejectReq(el){if(el){el.textContent='✗';el.disabled=true;}toast('却下','申請を却下しました','a');}

// ── 編集モード ──────────────────────────────────────────────────────────────────
function openEditShift(){
  if(!IS_ADMIN){toast('権限エラー','管理者のみシフトを編集できます','r');return;}
  toast('編集モード','セルをクリックするとシフトを変更できます','b');
}

// ── 勤怠CSV出力 ─────────────────────────────────────────────────────────────
function exportAttendanceCsv(){
  const date     = document.getElementById('att-filter-date')?.value     || '';
  const workerId = document.getElementById('att-filter-worker')?.value   || '';
  const status   = document.getElementById('att-filter-status')?.value   || '';

  const params = new URLSearchParams();
  if(date)     { params.set('from', date); params.set('to', date); }
  if(workerId)   params.set('worker_id', workerId);
  if(status)     params.set('status', status);

  const url = '/app/api/attendance/export.csv' + (params.toString() ? '?'+params.toString() : '');
  // ブラウザのナビゲーションでダウンロード（Content-Disposition: attachment）
  window.location.href = url;
  toast('CSV出力', '勤怠データをダウンロードしました', 'g');
}

// ── 日報CSV出力 ────────────────────────────────────────────────────────────
function exportDailyReportsCsv(){
  window.location.href = '/app/api/daily-reports/export.csv';
  toast('CSV出力', '日報データをダウンロードしました', 'g');
}

// ── CSV出力（シフトマトリクス：従来のクライアント側生成） ───────────────────
function exportShiftCSV(){
  const year=SHIFT_YEAR, month=SHIFT_MONTH;
  const days=new Date(year,month,0).getDate();
  const dayNames=['日','月','火','水','木','金','土'];
  const headers=['氏名'];
  for(let d=1;d<=days;d++){
    const dt=new Date(year,month-1,d);
    headers.push(`${d}(${dayNames[dt.getDay()]})`);
  }
  headers.push('出勤数');
  const rows=[headers];
  WORKERS.forEach(w=>{
    const row=[w.name];
    let cnt=0;
    for(let d=1;d<=days;d++){
      const dateStr=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const rec=SHIFT_DATA[`${w.id}_${dateStr}`];
      const dt=new Date(year,month-1,d);
      const def=dt.getDay()===0||dt.getDay()===6?'休':'日';
      const k=rec?.shift_type||def;
      const st=SHIFT_TYPES.find(x=>x.key===k);
      row.push(st?.label||k);
      if(!SHIFT_DAYS_OFF.has(k)) cnt++;
    }
    row.push(cnt);
    rows.push(row);
  });
  const BOM='﻿';
  const csv=BOM+rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`シフト表_${year}年${month}月.csv`;
  document.body.appendChild(a);a.click();a.remove();
  URL.revokeObjectURL(a.href);
  toast('エクスポート',`シフト表（${year}年${month}月）をダウンロードしました`);
}

// ── 勤怠管理 (ATTENDANCE) ────────────────────────────────────────────────────
let ATTEND_DATA = [];

// JST（日本時間）での今日の日付を返す（タイムゾーンズレ防止）
function todayJST(){
  return new Date(Date.now() + 9*60*60*1000).toISOString().slice(0,10);
}

// 従業員フィルタを初期化してデータ読み込み
// SP('attend') が呼ばれるたびに実行される → タブを開くたびに最新データを取得
function initAttendPage(){
  const sel = document.getElementById('att-filter-worker');
  if(sel && sel.options.length <= 1){
    WORKERS.forEach(w=>{
      const o = document.createElement('option');
      o.value = w.id; o.textContent = w.name;
      sel.appendChild(o);
    });
  }
  // 日付フィルターを今日（JST）にリセット
  const df = document.getElementById('att-filter-date');
  if(df) df.value = todayJST();
  loadAttendance();
  loadAttendStats();
}

// 一覧取得
async function loadAttendance(){
  const date     = document.getElementById('att-filter-date')?.value  || '';
  const workerId = document.getElementById('att-filter-worker')?.value || '';
  const status   = document.getElementById('att-filter-status')?.value || '';
  const params   = new URLSearchParams();
  if(date)     params.set('date', date);
  if(workerId) params.set('worker_id', workerId);
  if(status)   params.set('status', status);

  const tbody = document.getElementById('attend-tbody');
  if(tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--t3)">読み込み中...</td></tr>`;

  try{
    const res  = await fetch(`/app/api/attendance?${params}`);
    const json = await res.json();
    if(json.error) throw new Error(json.error);
    ATTEND_DATA = json.records || [];
    renderAttendTable();
    if(json.missing) toast('テーブル未作成','Supabaseにattendance_recordsテーブルを作成してください','a');
  }catch(e){
    if(tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--red)">読み込みエラー: ${e.message}</td></tr>`;
  }
}

const ATT_ST = {
  present: {label:'出勤', cls:'bg', icon:'✅'},
  late:    {label:'遅刻', cls:'ba', icon:'⏰'},
  absent:  {label:'欠勤', cls:'br', icon:'❌'},
  holiday: {label:'休日', cls:'bgray', icon:'🏖️'},
};

function renderAttendTable(){
  const tbody = document.getElementById('attend-tbody');
  if(!tbody) return;
  if(!ATTEND_DATA.length){
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--t3)">
      勤怠記録がありません<br><small style="margin-top:6px;display:block">「+ 勤怠登録」から追加するか、フィルタを変更してください</small>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = ATTEND_DATA.map(r=>{
    const st = ATT_ST[r.status] || {label:r.status, cls:'bgray', icon:'？'};
    const w  = WORKERS.find(x=>x.id === r.worker_id);
    const av = w ? `<div style="width:28px;height:28px;border-radius:50%;background:${w.bg};color:${w.tc};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${w.init}</div>` : '';
    return `<tr style="border-bottom:1px solid var(--bd);transition:background .12s" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
      <td style="padding:10px 14px;white-space:nowrap;color:var(--t2)">${r.work_date}</td>
      <td style="padding:10px 14px"><div style="display:flex;align-items:center;gap:8px">${av}<span style="font-weight:500">${r.workerName}</span></div></td>
      <td style="padding:10px 14px;font-variant-numeric:tabular-nums">${r.clockInStr  || '<span style="color:var(--t3)">—</span>'}</td>
      <td style="padding:10px 14px;font-variant-numeric:tabular-nums">${r.clockOutStr || '<span style="color:var(--t3)">—</span>'}</td>
      <td style="padding:10px 14px">${r.workHours !== '-' ? `<span style="font-weight:600">${r.workHours}</span>` : '<span style="color:var(--t3)">—</span>'}</td>
      <td style="padding:10px 14px"><span class="badge ${st.cls}">${st.icon} ${st.label}</span></td>
      <td style="padding:10px 14px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2)">${r.memo || '<span style="color:var(--t3)">—</span>'}</td>
      <td style="padding:10px 14px;text-align:right;white-space:nowrap">
        <button class="btn btn-sm" onclick="openEditAttend('${r.id}')">編集</button>
        <button class="btn btn-sm btn-r" onclick="deleteAttend('${r.id}')" style="margin-left:4px">削除</button>
      </td>
    </tr>`;
  }).join('');
}

function clearAttendFilters(){
  const d=document.getElementById('att-filter-date');
  const w=document.getElementById('att-filter-worker');
  const s=document.getElementById('att-filter-status');
  if(d)d.value=''; if(w)w.value=''; if(s)s.value='';
  loadAttendance();
}

// 登録モーダル
function openAddAttend(){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ登録できます','r');return;}
  const today = new Date().toISOString().slice(0,10);
  const wOpts = WORKERS.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  _showAttendModal('勤怠登録', wOpts, today, '', '', 'present', '', null);
}

// 編集モーダル
function openEditAttend(id){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ編集できます','r');return;}
  const r = ATTEND_DATA.find(x=>x.id===id);
  if(!r) return;
  const wOpts = WORKERS.map(w=>`<option value="${w.id}"${w.id===r.worker_id?' selected':''}>${w.name}</option>`).join('');
  // サーバーが clockInStr/clockOutStr を JST "HH:MM" で返すのでそれを優先（UTC切り出しの9hズレ防止）
  const toHM = iso => iso ? new Date(iso).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Tokyo'}) : '';
  const ci = r.clockInStr  || toHM(r.clock_in);
  const co = r.clockOutStr || toHM(r.clock_out);
  _showAttendModal('勤怠編集', wOpts, r.work_date, ci, co, r.status, r.memo, id);
}

function _showAttendModal(title, wOpts, date, ci, co, status, memo, editId){
  const stOpts = [['present','✅ 出勤'],['late','⏰ 遅刻'],['absent','❌ 欠勤'],['holiday','🏖️ 休日']]
    .map(([v,l])=>`<option value="${v}"${status===v?' selected':''}>${l}</option>`).join('');
  const saveCall = editId ? `saveAttend('${editId}')` : `saveAttend(null)`;
  openModal(title,
    `<div style="display:flex;flex-direction:column;gap:14px">
      <div class="form-row"><label class="form-lbl">従業員 *</label>
        <select id="att-form-worker" class="form-inp"><option value="">選択してください</option>${wOpts}</select></div>
      <div class="form-row"><label class="form-lbl">日付 *</label>
        <input type="date" id="att-form-date" class="form-inp" value="${date}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-row"><label class="form-lbl">出勤時間</label>
          <input type="time" id="att-form-in" class="form-inp" value="${ci}"></div>
        <div class="form-row"><label class="form-lbl">退勤時間</label>
          <input type="time" id="att-form-out" class="form-inp" value="${co}"></div>
      </div>
      <div class="form-row"><label class="form-lbl">ステータス</label>
        <select id="att-form-status" class="form-inp">${stOpts}</select></div>
      <div class="form-row"><label class="form-lbl">メモ</label>
        <input type="text" id="att-form-memo" class="form-inp" value="${memo||''}" placeholder="備考・理由など"></div>
    </div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button>
     <button class="btn btn-g" onclick="${saveCall}">保存</button>`
  );
}

// 保存（新規 or 更新）
async function saveAttend(editId){
  const workerId = document.getElementById('att-form-worker')?.value;
  const date     = document.getElementById('att-form-date')?.value;
  const timeIn   = document.getElementById('att-form-in')?.value;
  const timeOut  = document.getElementById('att-form-out')?.value;
  const status   = document.getElementById('att-form-status')?.value || 'present';
  const memo     = document.getElementById('att-form-memo')?.value || '';

  if(!workerId) return toast('エラー','従業員を選択してください','r');
  if(!date)     return toast('エラー','日付を入力してください','r');

  // "HH:MM" → ISO 8601 with JST offset（タイムゾーン考慮）
  const toISO = t => t ? `${date}T${t}:00+09:00` : null;

  const body = {
    worker_id: workerId,
    work_date: date,
    clock_in:  toISO(timeIn),
    clock_out: toISO(timeOut),
    status, memo,
  };

  try{
    const url    = editId ? `/app/api/attendance/${editId}` : '/app/api/attendance';
    const method = editId ? 'PUT' : 'POST';
    const res    = await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const json   = await res.json();
    if(!json.ok && !json.missing) return toast('エラー',json.error||'保存に失敗しました','r');
    closeModal();
    toast('保存しました',`${date} の勤怠を${editId?'更新':'登録'}しました`,'g');
    loadAttendance();
    loadAttendStats();
  }catch(e){
    toast('エラー','ネットワークエラー: '+e.message,'r');
  }
}

// 削除
async function deleteAttend(id){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ削除できます','r');return;}
  if(!confirm('この勤怠記録を削除しますか？')) return;
  try{
    const res  = await fetch(`/app/api/attendance/${id}`,{method:'DELETE'});
    const json = await res.json();
    if(!json.ok) return toast('エラー',json.error||'削除に失敗しました','r');
    toast('削除しました','','g');
    ATTEND_DATA = ATTEND_DATA.filter(r=>r.id!==id);
    renderAttendTable();
    loadAttendStats();
  }catch(e){
    toast('エラー','ネットワークエラー','r');
  }
}

// 統計取得（ダッシュボード & 勤怠ページ共用）
async function loadAttendStats(){
  try{
    const res  = await fetch('/app/api/attendance/stats');
    const json = await res.json();
    const total = WORKERS.length;
    const el = id => document.getElementById(id);

    // ダッシュボードKPI
    if(el('home-att-present')) el('home-att-present').textContent = json.present ?? '-';
    if(el('home-att-absent'))  el('home-att-absent').textContent  = json.absent  ?? '-';
    if(el('home-att-late'))    el('home-att-late').textContent    = json.late    ?? '-';
    if(el('home-att-rate')){
      const rate = total > 0 ? Math.round(((json.present||0)+(json.late||0))/total*100) : 0;
      el('home-att-rate').textContent = rate + '%';
    }

    // 勤怠ページ統計カード
    if(el('att-present-count')){
      el('att-present-count').textContent = json.present ?? '-';
      el('att-present-sub').textContent   = `全${total}名中`;
      el('att-absent-count').textContent  = json.absent  ?? '-';
      el('att-absent-sub').textContent    = total>0?`${Math.round((json.absent||0)/total*100)}%`:'—';
      el('att-late-count').textContent    = json.late    ?? '-';
      el('att-late-sub').textContent      = '本日の遅刻者数';
      const rate = total > 0 ? Math.round(((json.present||0)+(json.late||0))/total*100) : 0;
      el('att-rate-count').textContent    = rate + '%';
      el('att-rate-sub').textContent      = '出勤＋遅刻含む';
    }

    // ダッシュボード最近の勤怠
    const recentEl = el('home-att-recent');
    if(recentEl){
      if(!json.recent||!json.recent.length){
        recentEl.innerHTML = '<div class="empty-state" style="padding:16px 0"><p>本日の勤怠記録がありません</p></div>';
      }else{
        recentEl.innerHTML = json.recent.map(r=>{
          const w  = WORKERS.find(x=>x.id===r.worker_id);
          const st = ATT_ST[r.status]||{label:r.status,cls:'bgray',icon:'？'};
          const av = w?`<div style="width:32px;height:32px;border-radius:50%;background:${w.bg};color:${w.tc};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${w.init}</div>`:'';
          return `<div class="act-item">
            ${av}
            <div class="act-body">
              <div class="act-title">${r.workerName}</div>
              <div class="act-sub">${r.clockInStr||'未打刻'}${r.clockInStr&&r.clockOutStr?' 〜 '+r.clockOutStr:''}</div>
            </div>
            <span class="badge ${st.cls}">${st.icon} ${st.label}</span>
          </div>`;
        }).join('');
      }
    }
  }catch(e){
    // stats取得失敗は無視（テーブル未作成時など）
  }
}

// ── ROLES & SETTINGS ──────────────────────────────────────────────────────────
const ROLE_DEF = {
  admin:   {label:'管理者',   ico:'👑', bg:'#fee2e2', badge:'br'},
  manager: {label:'マネージャー',ico:'🎯', bg:'#dbeafe', badge:'bb'},
  staff:   {label:'スタッフ', ico:'👤', bg:'#ecfdf5', badge:'bg'},
  trainee: {label:'技能実習生',ico:'🌏', bg:'#fef3c7', badge:'ba'},
};

// ユーザー一覧をロードして権限ページに表示
let ROLE_USERS = [];
async function loadRoleUsers(){
  try{
    const r = await fetch('/app/api/users');
    const d = await r.json();
    ROLE_USERS = d.users || [];
  }catch(e){ ROLE_USERS = []; }
  renderRoleUsers();
}
function renderRoleUsers(){
  const el = document.getElementById('role-user-list');
  if(!el) return;
  if(!ROLE_USERS.length){
    el.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">ユーザーがいません</div>';
    return;
  }
  el.innerHTML = ROLE_USERS.map(u=>{
    const rd = ROLE_DEF[u.role] || {label:u.role,ico:'👤',bg:'#e5e7eb',badge:'bgray'};
    const isSelf = u.id === GB_USER?.id;
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--bd)">
      <div style="width:34px;height:34px;border-radius:50%;background:${rd.bg};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${rd.ico}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;font-weight:600">${u.full_name||'—'}${isSelf?' <span style="font-size:11px;color:var(--t3)">(自分)</span>':''}</div>
        <span class="badge ${rd.badge}" style="margin-top:3px">${rd.label}</span>
      </div>
      ${IS_ADMIN&&!isSelf?`<button class="btn btn-sm" onclick="openRoleEditUser('${u.id}','${u.role}','${u.full_name||''}')">変更</button>`:''}
    </div>`;
  }).join('');
}
function openRoleEditUser(userId, currentRole, userName){
  if(!IS_ADMIN){toast('権限エラー','管理者のみ変更できます','r');return;}
  const opts = Object.entries(ROLE_DEF).map(([k,v])=>
    `<option value="${k}"${currentRole===k?' selected':''}>${v.ico} ${v.label}</option>`).join('');
  openModal(`権限変更 — ${userName}`,
    `<div class="form-row"><label class="form-lbl">新しいロール</label><select class="form-inp" id="new-role">${opts}</select></div>
     <div style="margin-top:8px;padding:9px 12px;background:var(--abg);border-radius:8px;font-size:12.5px;color:var(--amb)">⚠️ 変更は即時反映されます。管理者は1人以上必要です。</div>`,
    `<button class="btn" onclick="closeModal()">キャンセル</button>
     <button class="btn btn-g" onclick="saveUserRole('${userId}')">変更を保存</button>`
  );
}
async function saveUserRole(userId){
  const role = document.getElementById('new-role')?.value;
  if(!role) return;
  try{
    const r = await fetch(`/app/api/users/${userId}/role`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error);
    closeModal();
    const u = ROLE_USERS.find(x=>x.id===userId);
    if(u) u.role=role;
    renderRoleUsers();
    toast('変更完了','ロールを変更しました');
  }catch(e){
    toast('エラー',e.message,'r');
  }
}
function openAddRole(){if(!IS_ADMIN){toast('権限エラー','管理者のみ操作できます','r');return;}toast('情報','ロールはシステム固定です（管理者・マネージャー・スタッフ・技能実習生）','b');}
function openRoleEdit(role){if(!IS_ADMIN){toast('権限エラー','管理者のみ変更できます','r');return;}toast('情報',role+' の権限はシステム固定です','b');}
const STABS=['account','display','notif','privacy','support','legal'];
function setST(tab){STABS.forEach(t=>{document.getElementById('stab-'+t)?.classList.toggle('on',t===tab);document.getElementById('sni-'+t)?.classList.toggle('on',t===tab);});}

// ── SHARED CHAT HELPERS ───────────────────────────────────────────────────────
function renderMsgs(containerId,msgs,worker){const a=document.getElementById(containerId);if(!a)return;a.innerHTML='';msgs.forEach(m=>addBub(containerId,m,worker,false));a.scrollTop=a.scrollHeight;}
function showTyping(cid,worker){const a=document.getElementById(cid);if(!a)return;const t=document.createElement('div');t.id='typ-'+cid;t.className='typing-r';t.innerHTML=`<div class="mav" style="background:${worker?.bg||'#ddd'};color:${worker?.tc||'#333'}">${worker?.init||'?'}</div><div class="typing-b"><span></span><span></span><span></span></div>`;a.appendChild(t);a.scrollTop=a.scrollHeight;}
function hideTyping(cid){document.getElementById('typ-'+cid)?.remove();}
function autoH(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,110)+'px';}

function addBub(cid,m,worker,scroll=true){
  const a=document.getElementById(cid);if(!a)return;
  const wrap=document.createElement('div');
  if(m.t==='sys'){wrap.innerHTML=`<div class="sys-msg">${m.txt}</div>`;wrap.style.cssText='display:flex;justify-content:center;margin:4px 0';a.appendChild(wrap);if(scroll)a.scrollTop=a.scrollHeight;return;}
  const me=m.t==='me'||m.who==='admin'||m.who==='a';
  wrap.className='mrow'+(me?' r':'');
  const userInit=typeof GB_USER!=='undefined'?GB_USER.full_name?.charAt(0):'田';
  const avHtml=me?`<div class="mav" style="background:#064e3b;color:#6ee7b7">${userInit}</div>`:`<div class="mav" style="background:${worker?.bg||'#ddd'};color:${worker?.tc||'#333'}">${worker?.init||'?'}</div>`;
  let main='';
  // 添付画像があれば最初に表示
  if(m.attachment_url && m.attachment_type === 'image'){
    main += `<a href="${m.attachment_url}" target="_blank" rel="noopener" style="display:block;margin-bottom:${m.txt?'6px':'0'}"><img src="${m.attachment_url}" style="max-width:240px;max-height:300px;border-radius:10px;display:block" alt="${(m.attachment_name||'image').replace(/"/g,'&quot;')}"></a>`;
  } else if(m.attachment_url){
    main += `<a href="${m.attachment_url}" target="_blank" rel="noopener" style="display:inline-block;padding:6px 10px;background:#fff;border:1px solid #d8dce6;border-radius:8px;font-size:12px;margin-bottom:${m.txt?'6px':'0'}">📎 ${m.attachment_name||'ファイル'}</a>`;
  }
  main += m.txt||'';
  if(m.tpl)main=`<div class="tpl-tag">📋 ${m.tpl}</div><br>`+main;
  if(!me&&m.jp)main=`<span class="tl-lbl">【AI翻訳 → 日本語】</span>${m.jp}<span class="orig">原文: ${m.txt}</span>`;
  const tlBub=me&&m.tl?`<div class="bub bai" style="margin-top:2px"><span class="tl-lbl">【翻訳済み】</span>${m.tl}</div>`:'';
  const readDots=me?`<div class="read-dots">${m.read!==false?'既読 ✓✓':'送信済 ✓'}</div>`:'';
  // ワーカー発で日本語訳が無いテキストメッセージ → 「日本語に翻訳」ボタン
  const needTrBtn = !me && !m.jp && (m.txt||'').trim() && m._id;
  const trBtn = needTrBtn
    ? `<button class="msg-tr-btn" data-mid="${m._id}" onclick="translateIncoming('${m._id}', this)">🌐 日本語に翻訳</button>`
    : '';
  wrap.innerHTML=`${!me?avHtml:''}<div class="mcol" style="${me?'align-items:flex-end':''}">${!me&&m.sender?`<div style="font-size:11px;color:var(--t3);padding:0 3px;margin-bottom:1px">${m.sender}</div>`:''}<div class="bub ${me?'br2':'bl'}">${main}</div>${tlBub}${trBtn}${readDots}<div class="mtime">${m.time||(m.t!=='me'&&m.t!=='sys'?m.t:'')||''}</div></div>${me?avHtml:''}`;
  a.appendChild(wrap);if(scroll)a.scrollTop=a.scrollHeight;
}

// 受信メッセージ（ワーカー発）を日本語に翻訳して表示を差し替え
async function translateIncoming(msgId, btn){
  if(!AW) return;
  const hist = HISTORY[AW.id] || [];
  const m = hist.find(x => x._id === msgId);
  if(!m){ return; }
  if(btn){ btn.disabled = true; btn.textContent = '翻訳中...'; }
  // source はワーカー言語、target は日本語
  const src = AW.lang || 'vi';
  const jp = await adminTx(m.txt, 'ja', src);
  m.jp = (jp && jp !== m.txt) ? jp : m.txt;
  renderMessages();
}

// ════════════════════════════════════════════════════════════════
// 💴 給与管理（Payroll）
// ════════════════════════════════════════════════════════════════
let _payrollData = [];   // 現在のプレビュー結果

function _yen(n){ return '¥' + (Math.round(n || 0)).toLocaleString('ja-JP'); }
function _curPeriod(){
  const el = document.getElementById('payroll-period');
  return el && el.value ? el.value : '';
}

function initPayrollPage(){
  const el = document.getElementById('payroll-period');
  if (el && !el.value) {
    // デフォルト: 今月
    const now = new Date();
    el.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  loadPayrollPreview();
}

async function loadPayrollPreview(){
  const period = _curPeriod();
  const tbody = document.getElementById('payroll-tbody');
  if (!period || !tbody) return;
  tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--t3)">計算中...</td></tr>';
  try {
    const r = await fetch('/app/api/payroll/preview?period=' + encodeURIComponent(period));
    const j = await r.json();
    if (!j.ok) { tbody.innerHTML = `<tr><td colspan="11" style="padding:18px;color:var(--red)">${j.error||'取得失敗'}</td></tr>`; return; }
    _payrollData = j.results || [];
    renderPayrollTable();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="11" style="padding:18px;color:var(--red)">${e.message}</td></tr>`;
  }
}

function renderPayrollTable(){
  const tbody = document.getElementById('payroll-tbody');
  const summary = document.getElementById('payroll-summary');
  if (!tbody) return;
  if (!_payrollData.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--t3)">対象ワーカーがいません</td></tr>';
    if (summary) summary.textContent = '—';
    return;
  }
  let totalGross = 0, totalNet = 0, confirmedCount = 0;
  tbody.innerHTML = _payrollData.map(p => {
    totalGross += p.gross_pay; totalNet += p.net_pay;
    const st = p.existing?.status || 'draft';
    if (st !== 'draft') confirmedCount++;
    const statusLabel = { draft:'未確定', confirmed:'確定', published:'公開済' }[st] || st;
    const wageLabel = p.wageConfigured
      ? `<span style="color:var(--t2)">設定済</span>`
      : `<span class="pr-warn">未設定</span>`;
    const actions = [];
    actions.push(`<button class="btn-xs" onclick="openWageModal('${p.worker.id}','${(p.worker.name||'').replace(/'/g,'')}')">賃金</button>`);
    if (p.existing) {
      actions.push(`<button class="btn-xs" onclick="openPayslipDetail('${p.existing.id}')">明細</button>`);
      if (st === 'confirmed') actions.push(`<button class="btn-xs" onclick="publishPayslip('${p.existing.id}')">公開</button>`);
    }
    return `<tr>
      <td class="pr-name">${p.worker.name||'—'}</td>
      <td>${wageLabel}</td>
      <td>${p.work_days}</td>
      <td>${p.regular_hours}</td>
      <td>${p.overtime_hours}</td>
      <td>${p.night_hours}</td>
      <td>${p.holiday_hours}</td>
      <td class="pr-gross">${_yen(p.gross_pay)}</td>
      <td class="pr-net">${_yen(p.net_pay)}</td>
      <td><span class="pr-status ${st}">${statusLabel}</span></td>
      <td style="display:flex;gap:4px;justify-content:flex-end">${actions.join('')}</td>
    </tr>`;
  }).join('');
  if (summary) summary.textContent = `${_payrollData.length}名 / 確定 ${confirmedCount}名 ・ 総支給計 ${_yen(totalGross)} ・ 差引計 ${_yen(totalNet)}`;
}

// ── 賃金設定モーダル ──────────────────────────────────────
async function openWageModal(workerId, workerName){
  try {
    const r = await fetch('/app/api/wage/' + workerId);
    const j = await r.json();
    if (!j.ok) { toast('取得失敗', j.error||'', 'r'); return; }
    const w = j.wage;
    const allowancesRows = (w.allowances||[]).map((a,i)=>wageItemRow('allow',i,a)).join('');
    const deductionsRows = (w.deductions||[]).map((d,i)=>wageItemRow('deduct',i,d)).join('');
    const html = `
      <div class="wage-form" id="wage-form" data-worker="${workerId}">
        <div class="wage-row"><label>賃金体系</label>
          <select class="ss-sel" id="wf-type" onchange="onWageTypeChange()">
            <option value="hourly" ${w.wage_type==='hourly'?'selected':''}>時給制</option>
            <option value="monthly" ${w.wage_type==='monthly'?'selected':''}>月給制</option>
          </select>
        </div>
        <div class="wage-row"><label id="wf-base-lbl">時給（円）</label>
          <input type="number" class="finp" id="wf-base" value="${w.base_amount||0}" min="0"></div>
        <div class="wage-row" id="wf-stdh-row"><label>所定労働時間（月・h）</label>
          <input type="number" class="finp" id="wf-stdh" value="${w.monthly_standard_hours||160}" min="1"></div>
        <div id="wf-type-hint" style="font-size:11px;color:var(--t3);margin:-4px 0 2px;padding:0 2px"></div>
        <div class="wage-row"><label>残業割増率</label>
          <input type="number" step="0.01" class="finp" id="wf-ot" value="${w.overtime_rate||1.25}"></div>
        <div class="wage-row"><label>深夜割増率</label>
          <input type="number" step="0.01" class="finp" id="wf-night" value="${w.night_rate||1.25}"></div>
        <div class="wage-row"><label>休日割増率</label>
          <input type="number" step="0.01" class="finp" id="wf-hol" value="${w.holiday_rate||1.35}"></div>
        <div class="wage-row"><label>休憩控除（分/日）</label>
          <input type="number" class="finp" id="wf-break" value="${w.break_minutes!=null?w.break_minutes:60}" min="0"></div>
        <div class="wage-row"><label>丸め単位（分）</label>
          <input type="number" class="finp" id="wf-round" value="${w.rounding_unit!=null?w.rounding_unit:15}" min="0"></div>
        <div class="wage-row"><label>丸め方法</label>
          <select class="ss-sel" id="wf-roundmode">
            <option value="floor" ${w.rounding_mode==='floor'?'selected':''}>切り捨て</option>
            <option value="round" ${w.rounding_mode==='round'?'selected':''}>四捨五入</option>
            <option value="ceil"  ${w.rounding_mode==='ceil'?'selected':''}>切り上げ</option>
          </select>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">
            <span style="font-size:12.5px;font-weight:600">手当</span>
            <button class="btn-xs" onclick="addWageItem('allow')">＋追加</button>
          </div>
          <div class="wage-list" id="wf-allowances">${allowancesRows}</div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">
            <span style="font-size:12.5px;font-weight:600">控除</span>
            <button class="btn-xs" onclick="addWageItem('deduct')">＋追加</button>
          </div>
          <div class="wage-list" id="wf-deductions">${deductionsRows}</div>
        </div>
        <button class="btn btn-g" onclick="saveWage()" style="margin-top:6px">賃金設定を保存</button>
      </div>`;
    openModal('💴 賃金設定：' + workerName, html);
    onWageTypeChange();  // 賃金体系に応じてラベル・表示を初期反映
  } catch (e) { toast('エラー', e.message, 'r'); }
}

// 賃金体系の切替に応じて UI を変える
function onWageTypeChange(){
  const type = document.getElementById('wf-type')?.value || 'hourly';
  const baseLbl = document.getElementById('wf-base-lbl');
  const stdhRow = document.getElementById('wf-stdh-row');
  const hint    = document.getElementById('wf-type-hint');
  if (type === 'monthly') {
    if (baseLbl) baseLbl.textContent = '月給（円）';
    if (stdhRow) stdhRow.style.display = '';
    if (hint) hint.textContent = '月給制：基本給は固定。残業・休日・深夜は「月給÷所定労働時間」で算出した時間単価に割増を掛けて加算します。';
  } else {
    if (baseLbl) baseLbl.textContent = '時給（円）';
    if (stdhRow) stdhRow.style.display = 'none';   // 時給制では所定時間は不要
    if (hint) hint.textContent = '時給制：基本給＝時給×通常労働時間。残業・休日・深夜は時給に割増を掛けて加算します。';
  }
}

function wageItemRow(kind, i, item){
  return `<div class="wage-list-item" data-kind="${kind}">
    <input class="finp wi-name" placeholder="名称" value="${(item.name||'').replace(/"/g,'&quot;')}">
    <input class="finp wi-amount" type="number" placeholder="金額" value="${item.amount||0}" style="max-width:120px">
    <button class="btn-xs" onclick="this.parentElement.remove()">✕</button>
  </div>`;
}
function addWageItem(kind){
  const wrap = document.getElementById(kind==='allow'?'wf-allowances':'wf-deductions');
  if (!wrap) return;
  const div = document.createElement('div');
  div.innerHTML = wageItemRow(kind, 0, {});
  wrap.appendChild(div.firstElementChild);
}

async function saveWage(){
  const form = document.getElementById('wage-form');
  if (!form) return;
  const workerId = form.dataset.worker;
  const collect = (id) => Array.from(document.querySelectorAll(`#${id} .wage-list-item`)).map(row => ({
    name: row.querySelector('.wi-name').value.trim(),
    amount: Number(row.querySelector('.wi-amount').value) || 0,
  })).filter(x => x.name);
  const payload = {
    wage_type: document.getElementById('wf-type').value,
    base_amount: Number(document.getElementById('wf-base').value) || 0,
    monthly_standard_hours: Number(document.getElementById('wf-stdh').value) || 160,
    overtime_rate: Number(document.getElementById('wf-ot').value) || 1.25,
    night_rate: Number(document.getElementById('wf-night').value) || 1.25,
    holiday_rate: Number(document.getElementById('wf-hol').value) || 1.35,
    break_minutes: Number(document.getElementById('wf-break').value) || 0,
    rounding_unit: Number(document.getElementById('wf-round').value) || 0,
    rounding_mode: document.getElementById('wf-roundmode').value,
    allowances: collect('wf-allowances'),
    deductions: collect('wf-deductions'),
  };
  try {
    const r = await fetch('/app/api/wage/' + workerId, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!j.ok) { toast('保存失敗', j.error||'', 'r'); return; }
    toast('✓ 保存完了', '賃金設定を更新しました', 'g');
    closeModal();
    loadPayrollPreview();
  } catch (e) { toast('エラー', e.message, 'r'); }
}

// ── 確定 ──────────────────────────────────────────────────
async function confirmPayrollAll(){
  const period = _curPeriod();
  if (!period) return;
  const unconfigured = _payrollData.filter(p => !p.wageConfigured).length;
  let msg = `${period} の給与を確定します。\n確定後は明細が保存され、対象の勤怠記録がロックされます。`;
  if (unconfigured > 0) msg += `\n\n⚠️ 賃金未設定が ${unconfigured}名います（スキップされます）。`;
  if (!confirm(msg)) return;
  try {
    const r = await fetch('/app/api/payroll/confirm', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ period }),
    });
    const j = await r.json();
    if (!j.ok) { toast('確定失敗', j.error||'', 'r'); return; }
    toast('✓ 確定完了', `${j.confirmed.length}名を確定（スキップ ${j.skipped.length}名）`, 'g');
    loadPayrollPreview();
  } catch (e) { toast('エラー', e.message, 'r'); }
}

async function publishPayslip(id){
  if (!confirm('この明細をワーカーに公開しますか？')) return;
  try {
    const r = await fetch(`/app/api/payslips/${id}/publish`, { method: 'POST' });
    const j = await r.json();
    if (!j.ok) { toast('公開失敗', j.error||'', 'r'); return; }
    toast('✓ 公開完了', 'ワーカーが閲覧できるようになりました', 'g');
    loadPayrollPreview();
  } catch (e) { toast('エラー', e.message, 'r'); }
}

// ── 明細詳細・印刷 ────────────────────────────────────────
async function openPayslipDetail(id){
  try {
    const r = await fetch('/app/api/payslips/' + id);
    const j = await r.json();
    if (!j.ok) { toast('取得失敗', j.error||'', 'r'); return; }
    const p = j.payslip;
    const html = renderPayslipDoc(p) +
      `<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
         <button class="btn btn-sm" onclick="printPayslip('${id}')">🖨 印刷 / PDF保存</button>
       </div>`;
    openModal('給与明細', html);
  } catch (e) { toast('エラー', e.message, 'r'); }
}

function renderPayslipDoc(p){
  const w = p.workers || {};
  const snap = p.wage_snapshot || {};
  const allowRows = (snap.allowances||[]).map(a => `<tr><th>${a.name}</th><td>${_yen(a.amount)}</td></tr>`).join('');
  const deductRows = (snap.deductions||[]).map(d => `<tr><th>${d.name}</th><td>-${_yen(d.amount)}</td></tr>`).join('');
  return `<div class="payslip-doc">
    <h2>給与明細書</h2>
    <div class="ps-meta">${p.period} ｜ ${w.name||''} ${w.department?('（'+w.department+'）'):''}</div>
    <table>
      <tr><th>勤務日数</th><td>${p.work_days} 日</td></tr>
      <tr><th>通常労働時間</th><td>${p.regular_hours} h</td></tr>
      <tr><th>残業時間</th><td>${p.overtime_hours} h</td></tr>
      <tr><th>深夜時間</th><td>${p.night_hours} h</td></tr>
      <tr><th>休日労働時間</th><td>${p.holiday_hours} h</td></tr>
    </table>
    <table>
      <tr><th>基本給</th><td>${_yen(p.base_pay)}</td></tr>
      <tr><th>残業手当（×${snap.overtime_rate||1.25}）</th><td>${_yen(p.overtime_pay)}</td></tr>
      <tr><th>深夜手当</th><td>${_yen(p.night_pay)}</td></tr>
      <tr><th>休日手当（×${snap.holiday_rate||1.35}）</th><td>${_yen(p.holiday_pay)}</td></tr>
      ${allowRows}
      <tr class="ps-total"><th>総支給額</th><td>${_yen(p.gross_pay)}</td></tr>
      ${deductRows}
      <tr><th>控除合計</th><td>-${_yen(p.deduction_total)}</td></tr>
      <tr class="ps-total ps-net"><th>差引支給額</th><td>${_yen(p.net_pay)}</td></tr>
    </table>
    <div style="font-size:11px;color:var(--t3)">時間単価: ${_yen(snap.hourly_rate_used||0)} ／ 計算基準: ${snap.rounding_unit||0}分${({floor:'切り捨て',round:'四捨五入',ceil:'切り上げ'})[snap.rounding_mode]||''} ／ JST</div>
  </div>`;
}

async function printPayslip(id){
  try {
    const r = await fetch('/app/api/payslips/' + id);
    const j = await r.json();
    if (!j.ok) return;
    const area = document.getElementById('payslip-print-area');
    area.innerHTML = renderPayslipDoc(j.payslip);
    area.style.display = 'block';
    window.print();
    setTimeout(() => { area.style.display = 'none'; }, 500);
  } catch (e) { toast('エラー', e.message, 'r'); }
}

// ── INIT ──────────────────────────────────────────────────────────────────────
SP('home');

// ── 管理者用 統合メッセージポーリング（Realtime のサイレント失敗対策）
// 全ワーカーからの新着メッセージを 5 秒毎に取得して HISTORY/UI に反映する
let _adminLastMsgTs = new Date(Date.now() - 24*60*60*1000).toISOString();  // 起動時は直近24h
async function pollAdminMessages(){
  if(!GB_USER?.id) return;
  try{
    const url = '/app/api/messages/recent?since=' + encodeURIComponent(_adminLastMsgTs);
    const res = await fetch(url);
    const json = await res.json();
    if(!json.ok || !json.messages?.length) return;
    let changed = false;
    let listChanged = false;
    for(const m of json.messages){
      _adminLastMsgTs = m.created_at;
      // ワーカー特定: sender か receiver が認識できるワーカー
      const w = WORKERS.find(x => x.authUserId === m.sender_id || x.authUserId === m.receiver_id);
      if(!w) continue;  // 認識できないワーカー（紐付け前）はスキップ
      if(!HISTORY[w.id]) HISTORY[w.id] = [{t:'sys',txt:'チャット開始'}];
      // 重複排除
      if(HISTORY[w.id].find(x => x._id === m.id)) continue;
      HISTORY[w.id].push(_dbMsgToLocal(m, w));
      _chatLastTs[w.id] = m.created_at;
      if(AW && AW.id === w.id){
        changed = true;
      } else if(m.sender_id !== GB_USER.id){
        // ワーカー発の未読
        w.unread = (w.unread || 0) + 1;
        listChanged = true;
      }
    }
    if(changed) renderMessages();
    if(listChanged && typeof renderCL === 'function') renderCL();
  }catch(e){ console.warn('[admin poll]', e); }
}
// 5秒ごとに統合ポーリング
setInterval(pollAdminMessages, 5000);
setTimeout(pollAdminMessages, 1500);

// ── Realtime 購読（管理者） ─────────────────────────────────────
(async () => {
  if (typeof GBRealtime === 'undefined' || !GB_USER?.id) return;
  try {
    // 1. メッセージ受信 + 既読更新
    _rtMsgSub = await GBRealtime.subscribeMessages(
      GB_USER.id,
      (newMsg) => {
        // ワーカーから管理者への新規メッセージ
        const w = WORKERS.find(x => x.authUserId === newMsg.sender_id);
        if (!w) {
          // WORKERS に未登録 → 強制再フェッチで補完して再描画（次回のpollMessages待ち）
          console.warn('[Realtime] sender not in WORKERS:', newMsg.sender_id);
          return;
        }
        if (!HISTORY[w.id]) HISTORY[w.id] = [{t:'sys',txt:'チャット開始'}];
        // 重複排除
        if (HISTORY[w.id].find(x => x._id === newMsg.id)) return;
        HISTORY[w.id].push(_dbMsgToLocal(newMsg, w));
        _chatLastTs[w.id] = newMsg.created_at;
        if (newMsg.created_at > _adminLastMsgTs) _adminLastMsgTs = newMsg.created_at;
        // 表示中のチャットなら即時描画
        if (AW && AW.id === w.id) renderMessages();
        else { w.unread = (w.unread || 0) + 1; renderCL(); }
      },
      (updatedMsg) => {
        // 自分の送信メッセージの既読更新
        const w = WORKERS.find(x => x.authUserId === updatedMsg.receiver_id);
        if (!w || !HISTORY[w.id]) return;
        const m = HISTORY[w.id].find(x => x._id === updatedMsg.id);
        if (m && m.read !== updatedMsg.is_read) {
          m.read = updatedMsg.is_read;
          if (AW && AW.id === w.id) renderMessages();
        }
      });

    // 2. シフト変更（全社）
    _rtShiftsSub = await GBRealtime.subscribeShifts(null, async (payload) => {
      const screen = document.getElementById('page-shift');
      if (screen && screen.style.display !== 'none') {
        // シフト管理画面表示中なら即時更新
        await loadShiftData(SHIFT_YEAR, SHIFT_MONTH);
        renderShiftTable();
      }
    });

    // 3. グループメッセージ受信
    const groupIds = (GROUPS || []).map(g => g.id);
    if (groupIds.length) {
      _rtGroupSub = await GBRealtime.subscribeGroupMessages(GB_USER.id, groupIds, (newMsg) => {
        const g = GROUPS.find(x => x.id === newMsg.group_id);
        if (!g) return;
        g.msgs = g.msgs || [];
        g.msgs.push(_gMsgToLocal(newMsg));
        _gMsgLastTs[g.id] = newMsg.created_at;
        if (AG && AG.id === g.id) renderMsgs('gchat-msgs', g.msgs, {bg:'#f3f4f6',tc:'#374151',init:g.ico});
        else { g.unread = (g.unread || 0) + 1; renderGCL(); }
      });
    }

    // 4. 通知 (申請・日報など)
    await GBRealtime.subscribeNotifications(async (payload) => {
      if (payload.eventType === 'INSERT') {
        // 新規通知が届いたら即時KPI更新 + トースト
        const n = payload.new;
        toast(n.title || '通知', n.body || '', n.type === 'alert' ? 'r' : 'b');
      }
      loadDashboardStats();
      // ホーム画面が見えていれば活動Feedも更新
      const home = document.getElementById('page-home');
      if (home && home.style.display !== 'none') loadActivityFeed();
    });

    // 5. シフト申請・日報の変更
    await GBRealtime.subscribeShiftRequests(() => { loadDashboardStats(); loadActivityFeed(); });
    await GBRealtime.subscribeDailyReports(() => { loadDashboardStats(); loadActivityFeed(); });

    console.log('[Realtime] admin subscriptions active');
  } catch (e) {
    console.warn('[Realtime] init failed:', e);
  }
})();

// ホームの勤怠統計を60秒ごとに自動更新
setInterval(()=>{
  const homePage = document.getElementById('page-home');
  if(homePage && homePage.style.display !== 'none') loadAttendStats();
}, 60000);

setTimeout(()=>{
  const alerts=checkExpireAlerts();
  if(alerts.length>0){
    const urgent=alerts.filter(a=>a.level==='expired'||a.level==='urgent').length;
    if(urgent>0)toast('⏰ 在留期限警告',`${urgent}名の実習生の在留期限が30日以内です`,'a');
  }
},2500);
