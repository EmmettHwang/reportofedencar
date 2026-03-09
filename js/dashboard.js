/* =====================================================
   dashboard.js - 대시보드 모듈 v3 (MariaDB API 기반)
   - 비동기 API 호출로 데이터 로드
   - DB 연결 상태 표시
   - localStorage → MariaDB 마이그레이션 UI
   - 실시간 시계 / KPI / 월별·일별 요약
   ===================================================== */
const Dashboard = (() => {

  let _clockTimer = null;

  function fmt(n)  { return Number(n || 0).toLocaleString(); }
  function fmtKm(n){ return n ? fmt(n) + ' km' : '-'; }

  const WEEK_KO = ['일','월','화','수','목','금','토'];

  /* ─────────────────────────────────────────
     실시간 시계
  ───────────────────────────────────────── */
  function startClock() {
    stopClock();
    function tick() {
      const el = document.getElementById('db-clock');
      if (!el) { stopClock(); return; }
      const now = new Date();
      const yy  = now.getFullYear();
      const mm  = String(now.getMonth()+1).padStart(2,'0');
      const dd  = String(now.getDate()).padStart(2,'0');
      const day = WEEK_KO[now.getDay()];
      const hh  = String(now.getHours()).padStart(2,'0');
      const mi  = String(now.getMinutes()).padStart(2,'0');
      const ss  = String(now.getSeconds()).padStart(2,'0');
      el.innerHTML =
        `<span class="db-clock-date">${yy}-${mm}-${dd}</span>` +
        `<span class="db-clock-day">(${day})</span>` +
        `<span class="db-clock-time">${hh}:${mi}:${ss}</span>`;
    }
    tick();
    _clockTimer = setInterval(tick, 1000);
  }
  function stopClock() {
    if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
  }

  /* ─────────────────────────────────────────
     README 모달
  ───────────────────────────────────────── */
  async function showReadme() {
    const modal = document.getElementById('readme-modal');
    const body  = document.getElementById('readme-modal-body');
    if (!modal || !body) return;
    modal.style.display = 'flex';
    try {
      const res  = await fetch('README.md?' + Date.now());
      const text = await res.text();
      body.innerHTML = markdownToHtml(text);
    } catch {
      body.innerHTML = '<p style="color:#dc2626;padding:20px;">README.md 로드 실패</p>';
    }
  }

  function markdownToHtml(md) {
    return md
      .replace(/```[\w]*\n([\s\S]*?)```/g,'<pre class="readme-pre"><code>$1</code></pre>')
      .replace(/^### (.+)$/gm,'<h3 class="readme-h3">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="readme-h2">$1</h2>')
      .replace(/^# (.+)$/gm,  '<h1 class="readme-h1">$1</h1>')
      .replace(/^---$/gm,'<hr class="readme-hr"/>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/`(.+?)`/g,'<code class="readme-code">$1</code>')
      .replace(/^\|(.+)\|$/gm, line => {
        const cells = line.split('|').filter((c,i,a)=>i>0&&i<a.length-1);
        if (cells.every(c=>/^[-\s:]+$/.test(c))) return '';
        return '<tr>'+cells.map(c=>`<td class="readme-td">${c.trim()}</td>`).join('')+'</tr>';
      })
      .replace(/((?:<tr>.*<\/tr>\n?)+)/g,'<table class="readme-table">$1</table>')
      .replace(/^[-*] (.+)$/gm,'<li>$1</li>')
      .replace(/((?:<li>.*<\/li>\n?)+)/g,'<ul class="readme-ul">$1</ul>')
      .replace(/\n\n/g,'</p><p class="readme-p">')
      .replace(/^/,'<div class="readme-content"><p class="readme-p">')
      .replace(/$/,'</p></div>');
  }

  /* ─────────────────────────────────────────
     일별 운행 요약 빌드
  ───────────────────────────────────────── */
  function buildDailyTable(saved, year, month) {
    if (!saved || !saved.rows || !saved.rows.length) {
      return `<p class="db-empty-msg">${year}년 ${month}월 운행일지가 없습니다.
        <button class="btn btn-primary btn-sm" style="margin-left:8px;"
          onclick="App.switchTab('tab-logbook')">📅 일지 작성</button></p>`;
    }
    const activeRows = saved.rows.filter(r=>(r.driven&&r.driven>0)||(r.memo&&r.memo.trim()));
    if (!activeRows.length) return '<p class="db-empty-msg">이번달 운행 기록이 없습니다.</p>';

    const tableRows = activeRows.map(r => {
      const dd       = String(r.date).padStart(2,'0');
      const dayName  = WEEK_KO[r.dow] || '';
      const dayColor = r.isRed ? 'color:#dc2626;font-weight:700;'
                     : r.isSat ? 'color:#2563c7;font-weight:700;'
                     : 'font-weight:600;';
      const typeLabel = r.rowType==='commute'
        ? `<span class="db-type-badge db-type-commute">출퇴근</span>`
        : r.rowType==='biz'
        ? `<span class="db-type-badge db-type-biz">업무</span>`
        : `<span class="db-type-badge db-type-none">-</span>`;
      const memoTxt = r.holName||r.memo||'';
      return `<tr>
        <td style="${dayColor}">${month}/${dd} (${dayName})</td>
        <td>${typeLabel}</td>
        <td style="text-align:right;font-family:monospace;">${r.before?fmt(r.before):'-'}</td>
        <td style="text-align:right;font-family:monospace;">${r.after ?fmt(r.after) :'-'}</td>
        <td style="text-align:right;font-weight:700;">${r.driven ?fmt(r.driven) :'-'}</td>
        <td style="text-align:right;">${r.commute?fmt(r.commute):'-'}</td>
        <td style="text-align:right;">${r.biz    ?fmt(r.biz)    :'-'}</td>
        <td style="font-size:11px;color:#6b7280;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
            title="${memoTxt}">${memoTxt||'-'}</td>
      </tr>`;
    }).join('');

    const sumDriven  = activeRows.reduce((s,r)=>s+(r.driven||0),0);
    const sumCommute = activeRows.reduce((s,r)=>s+(r.commute||0),0);
    const sumBiz     = activeRows.reduce((s,r)=>s+(r.biz||0),0);
    const bizRatio   = sumDriven>0?Math.round(sumBiz/sumDriven*100):0;

    return `
      <div class="db-daily-meta">
        <span>총 <strong>${activeRows.length}일</strong> 운행</span>
        <span>합계 <strong>${fmt(sumDriven)} km</strong></span>
        <span>출퇴근 <strong>${fmt(sumCommute)} km</strong></span>
        <span>업무 <strong>${fmt(sumBiz)} km</strong></span>
        <span>업무율 <strong>${bizRatio}%</strong></span>
      </div>
      <div class="db-daily-scroll">
        <table class="data-table db-daily-table">
          <thead>
            <tr><th>날짜</th><th>구분</th>
              <th>출발(km)</th><th>도착(km)</th>
              <th>주행(km)</th><th>출퇴근(km)</th><th>업무(km)</th>
              <th>비고</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
          <tfoot>
            <tr class="db-sum-row">
              <td colspan="4"><strong>합계</strong></td>
              <td style="text-align:right;"><strong>${fmt(sumDriven)}</strong></td>
              <td style="text-align:right;"><strong>${fmt(sumCommute)}</strong></td>
              <td style="text-align:right;"><strong>${fmt(sumBiz)}</strong></td>
              <td><span class="ratio-badge">${bizRatio}%</span></td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  /* ─────────────────────────────────────────
     월별 운행 요약 빌드
  ───────────────────────────────────────── */
  function buildMonthlyTable(yearLogs, curMonth) {
    const saved = yearLogs.filter(l=>l.totalKm>0||l.commuteKm>0||l.bizKm>0);
    if (!saved.length) {
      return `<p class="db-empty-msg">저장된 운행일지가 없습니다.
        <button class="btn btn-primary btn-sm" style="margin-left:8px;"
          onclick="App.switchTabAndSubtab('tab-logbook','subtab-bulk')">📋 일괄 생성</button></p>`;
    }
    const rows = saved.map(l => {
      const r = l.totalKm>0?Math.round(l.bizKm/l.totalKm*100):0;
      const isThis = l.month===curMonth;
      return `<tr class="${isThis?'db-row-highlight':''}">
        <td style="font-weight:${isThis?'700':'400'};">
          ${l.month}월${isThis?` <span class="db-this-month-badge">이번달</span>`:''}
        </td>
        <td style="text-align:right;">${fmt(l.totalKm)}</td>
        <td style="text-align:right;">${fmt(l.commuteKm)}</td>
        <td style="text-align:right;">${fmt(l.bizKm)}</td>
        <td><span class="ratio-badge">${r}%</span></td>
      </tr>`;
    }).join('');
    const sumTotal   = saved.reduce((s,l)=>s+(l.totalKm||0),0);
    const sumCommute = saved.reduce((s,l)=>s+(l.commuteKm||0),0);
    const sumBiz     = saved.reduce((s,l)=>s+(l.bizKm||0),0);
    const sumRatio   = sumTotal>0?Math.round(sumBiz/sumTotal*100):0;
    return `
      <table class="data-table" style="font-size:12px;">
        <thead><tr><th>월</th><th>총km</th><th>출퇴근km</th><th>업무km</th><th>업무율</th></tr></thead>
        <tbody>
          ${rows}
          <tr class="db-sum-row">
            <td><strong>합계 (${saved.length}개월)</strong></td>
            <td style="text-align:right;"><strong>${fmt(sumTotal)}</strong></td>
            <td style="text-align:right;"><strong>${fmt(sumCommute)}</strong></td>
            <td style="text-align:right;"><strong>${fmt(sumBiz)}</strong></td>
            <td><span class="ratio-badge" style="background:#d97706;color:#fff;">${sumRatio}%</span></td>
          </tr>
        </tbody>
      </table>`;
  }

  /* ─────────────────────────────────────────
     대시보드 렌더 (비동기)
  ───────────────────────────────────────── */
  async function render() {
    _dirty = false;   // dirty 플래그 초기화
    const root = document.getElementById('dashboard-root');
    if (!root) return;

    // 로딩 표시
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:300px;flex-direction:column;gap:16px;">
        <div style="font-size:32px;">⏳</div>
        <p style="color:#6b7280;font-size:14px;">데이터 로드 중...</p>
        <div class="db-header-right" style="margin-top:8px;">
          <span class="db-clock" id="db-clock"></span>
        </div>
      </div>`;
    startClock();

    try {
      const now      = new Date();
      const curYear  = now.getFullYear();
      const curMonth = now.getMonth() + 1;

      // API 병렬 호출 (실패 시 빈 배열 반환)
      const [vehicles, clients, logIndex] = await Promise.all([
        DB.Vehicles.getAll().catch(()=>[]),
        DB.Clients.getAll().catch(()=>[]),
        DB.Logs.getAllIndex().catch(()=>[]),
      ]);
      // 타입 보장
      const safeVehicles = Array.isArray(vehicles) ? vehicles : [];
      const safeClients  = Array.isArray(clients)  ? clients  : [];
      const safeLogIndex = Array.isArray(logIndex) ? logIndex : [];

      // 기준 차량 (첫 번째 차량)
      const mainVehicle = safeVehicles[0] || null;

      // 설정
      let settings = { commuteDist:0, commuteDaysPerWeek:2, commuteVariance:0, commuteToll:0, annualKm:7000 };
      if (mainVehicle) {
        try { settings = await DB.Settings.get(mainVehicle.id) || settings; } catch{}
      }

      // 올해 로그
      const yearLogs  = safeLogIndex.filter(l => l.year === curYear && l.vehicleId === (mainVehicle?.id||''));
      const allYearLogs = safeLogIndex.filter(l => l.year === curYear);
      const totalKm   = yearLogs.reduce((s,l)=>s+(l.totalKm||0),0);
      const commuteKm = yearLogs.reduce((s,l)=>s+(l.commuteKm||0),0);
      const bizKm     = yearLogs.reduce((s,l)=>s+(l.bizKm||0),0);
      const bizRatio  = totalKm>0?Math.round(bizKm/totalKm*100):0;
      const savedMonths = yearLogs.filter(l=>l.totalKm>0||l.commuteKm>0||l.bizKm>0).length;

      // 이번달 일별 데이터
      const dailyVehicleId = mainVehicle ? mainVehicle.id : '';
      let dailyData = null;
      if (dailyVehicleId) {
        try { dailyData = await DB.Logs.get(dailyVehicleId, curYear, curMonth); } catch{}
      }

      // 연간 목표
      const annualTarget = Number(settings.annualKm) || 7000;
      const progress     = Math.min(100, Math.round(totalKm/annualTarget*100));
      const progressColor = progress>=100?'#16a34a':progress>=70?'#d97706':'#1a4fa0';

      // DB 연결 상태
      let dbStatus = '🔴 확인 중...';
      try {
        const h = await fetch('/api/health');
        const hj = await h.json();
        dbStatus = hj.ok ? '🟢 MariaDB 연결됨' : '🔴 DB 오류';
      } catch { dbStatus = '🔴 서버 연결 실패'; }

      // KPI 카드
      const kpiCards = [
        { icon:'🚗', label:'등록 차량',           value:`${safeVehicles.length}대`,
          sub: safeVehicles.length?safeVehicles.map(v=>v.regno).join(', '):'차량을 등록하세요',
          color:'#1a4fa0', bg:'#e8f0fc', tab:'tab-vehicle' },
        { icon:'🏢', label:'등록 거래처',          value:`${safeClients.length}곳`,
          sub: clients.length?`구분: ${[...new Set(safeClients.map(c=>c.category||'미분류'))].slice(0,3).join(', ')}`:'거래처를 등록하세요',
          color:'#16a34a', bg:'#dcfce7', tab:'tab-client' },
        { icon:'📅', label:`${curYear}년 운행일지`, value:`${savedMonths}개월 저장`,
          sub: savedMonths?`총 ${fmt(totalKm)}km · 업무 ${bizRatio}%`:'운행일지를 생성하세요',
          color:'#d97706', bg:'#fef3c7', tab:'tab-logbook' },
        { icon:'💾', label:'DB 상태',              value:dbStatus,
          sub:'MariaDB edenfood',
          color:'#7c3aed', bg:'#f3e8ff', tab:null },
      ];

      root.innerHTML = `
      <!-- ── 헤더 바 ── -->
      <div class="db-header">
        <div>
          <h2 class="db-title">📊 운행 현황 대시보드</h2>
          <p class="db-subtitle">MariaDB 실시간 연동 · itedu.synology.me / edenfood</p>
        </div>
        <div class="db-header-right">
          <span class="db-clock" id="db-clock"></span>
        </div>
      </div>

      <!-- ── KPI 카드 ── -->
      <div class="db-kpi-grid">
        ${kpiCards.map(k=>`
          <div class="db-kpi-card" style="border-left:4px solid ${k.color};${k.tab?'cursor:pointer;':''}"
               ${k.tab?`onclick="App.switchTab('${k.tab}')"`:''}">
            <div class="db-kpi-icon" style="background:${k.bg};color:${k.color};">${k.icon}</div>
            <div class="db-kpi-body">
              <div class="db-kpi-label">${k.label}</div>
              <div class="db-kpi-value" style="color:${k.color};">${k.value}</div>
              <div class="db-kpi-sub">${k.sub}</div>
            </div>
          </div>`).join('')}
      </div>

      <!-- ── 연간 목표 진행률 ── -->
      ${mainVehicle?`
      <div class="card db-progress-card">
        <div class="db-progress-header">
          <span>🎯 ${curYear}년 연간 목표 주행 진행률 (${mainVehicle.regno})</span>
          <span style="font-size:13px;color:#6b7280;">${fmt(totalKm)} km / ${fmt(annualTarget)} km 목표</span>
        </div>
        <div class="db-progress-bar-bg">
          <div class="db-progress-bar-fill" style="width:${progress}%;background:${progressColor};">
            ${progress}%
          </div>
        </div>
        ${progress>=100?'<p style="color:#16a34a;font-size:12px;margin-top:6px;">✅ 연간 목표 달성!</p>':''}
      </div>`:''}

      <!-- ── 이번달 일별 운행 요약 ── -->
      <div class="card" style="margin-bottom:16px;">
        <div class="db-card-head">
          <h3 class="db-section-title" style="margin-bottom:0;">
            📆 ${curYear}년 ${curMonth}월 일별 운행 요약
            ${mainVehicle?`<span class="db-vehicle-tag">${mainVehicle.regno}</span>`:''}
          </h3>
          ${safeVehicles.length>1?`
          <select id="db-daily-vehicle-sel" class="db-sel" onchange="Dashboard.changeDailyVehicle(this.value)">
            ${safeVehicles.map(v=>`<option value="${v.id}" ${v.id===dailyVehicleId?'selected':''}>${v.regno}</option>`).join('')}
          </select>`:''}
        </div>
        <div id="db-daily-content">
          ${buildDailyTable(dailyData, curYear, curMonth)}
        </div>
      </div>

      <!-- ── 2열 그리드 ── -->
      <div class="db-two-col">

        <!-- 월별 운행 요약 -->
        <div class="card">
          <h3 class="db-section-title">📅 ${curYear}년 월별 운행 요약 <small style="font-weight:400;font-size:11px;color:#9ca3af;">(저장된 월만)</small></h3>
          ${buildMonthlyTable(yearLogs, curMonth)}
        </div>

        <!-- 오른쪽 열 -->
        <div style="display:flex;flex-direction:column;gap:12px;">

          <!-- 빠른 이동 -->
          <div class="card">
            <h3 class="db-section-title">⚡ 빠른 이동</h3>
            <div class="db-quick-links">
              <button class="db-quick-btn" onclick="App.switchTab('tab-vehicle')"><span>🚗</span><span>차량 등록·관리</span></button>
              <button class="db-quick-btn" onclick="App.switchTab('tab-client')"><span>🏢</span><span>거래처 관리</span></button>
              <button class="db-quick-btn" onclick="App.switchTab('tab-settings')"><span>⚙️</span><span>운행 설정</span></button>
              <button class="db-quick-btn" onclick="App.switchTabAndSubtab('tab-logbook','subtab-bulk')"><span>📋</span><span>연간 일괄 생성</span></button>
              <button class="db-quick-btn" onclick="App.switchTab('tab-cost')"><span>💰</span><span>비용 명세서</span></button>
              <button class="db-quick-btn" onclick="App.switchTab('tab-export')"><span>📊</span><span>엑셀 출력</span></button>
            </div>
          </div>

          <!-- 차량 현황 -->
          ${safeVehicles.length?`
          <div class="card">
            <h3 class="db-section-title">🚗 등록 차량 현황</h3>
            ${safeVehicles.map(v => {
              const vLogs = allYearLogs.filter(l=>l.vehicleId===v.id);
              const vKm   = vLogs.reduce((s,l)=>s+(l.totalKm||0),0);
              return `<div class="db-vehicle-row">
                <div class="db-vehicle-info">
                  <strong>${v.regno}</strong>
                  <span style="color:#6b7280;font-size:12px;">${v.model}${v.year?' '+v.year+'년식':''}</span>
                </div>
                <div class="db-vehicle-stats">
                  <span>📍 ${fmt(v.odometer)}km</span>
                  ${v.fuelEff?`<span>⛽ ${v.fuelEff}km/L</span>`:''}
                  <span>📅 ${vKm?fmt(vKm)+'km/':''}${vLogs.length}개월</span>
                </div>
              </div>`;
            }).join('')}
          </div>`:''}

          <!-- 설정 요약 -->
          <div class="card">
            <h3 class="db-section-title">⚙️ 현재 운행 설정</h3>
            ${mainVehicle?`
            <div style="font-size:13px;color:#374151;display:flex;flex-direction:column;gap:6px;">
              <div>🚗 기준 차량: <strong>${mainVehicle.regno} (${mainVehicle.model})</strong></div>
              <div>🏠 출퇴근: <strong>${settings.commuteDist||0}km</strong> ± ${settings.commuteVariance||0}km · 주 ${settings.commuteDaysPerWeek||2}회</div>
              ${settings.commuteToll?`<div>🛣️ 통행료: <strong>편도 ${fmt(settings.commuteToll)}원</strong></div>`:''}
              <div>🎯 연간 목표: <strong>${fmt(annualTarget)}km</strong></div>
            </div>`:
            `<p style="color:#9ca3af;font-size:13px;">설정 없음 —
              <button class="btn btn-primary btn-sm" onclick="App.switchTab('tab-settings')" style="margin-left:6px;">⚙️ 설정하기</button>
            </p>`}
          </div>

        </div>
      </div>`;

      startClock();

    } catch(e) {
      root.innerHTML = `
        <div class="db-header">
          <h2 class="db-title">📊 운행 현황 대시보드</h2>
          <div class="db-header-right">
            <span class="db-clock" id="db-clock"></span>
            <button class="btn btn-secondary" onclick="Dashboard.render()">🔄 새로고침</button>
          </div>
        </div>
        <div class="card" style="padding:24px;text-align:center;">
          <p style="color:#dc2626;font-size:14px;">❌ 데이터 로드 실패: ${e.message}</p>
          <p style="color:#6b7280;font-size:12px;margin-top:8px;">서버 연결 상태를 확인하세요.</p>
          <button class="btn btn-primary" onclick="Dashboard.render()" style="margin-top:12px;">🔄 다시 시도</button>
        </div>`;
      startClock();
    }
  }

  /* ─────────────────────────────────────────
     일별 차량 변경
  ───────────────────────────────────────── */
  async function changeDailyVehicle(vehicleId) {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;
    const el    = document.getElementById('db-daily-content');
    if (!el) return;
    el.innerHTML = '<p style="color:#6b7280;padding:12px;">로드 중...</p>';
    try {
      const data = await DB.Logs.get(vehicleId, year, month);
      el.innerHTML = buildDailyTable(data, year, month);
    } catch {
      el.innerHTML = '<p style="color:#dc2626;padding:12px;">데이터 로드 실패</p>';
    }
    const v = await DB.Vehicles.getById(vehicleId);
    const tag = document.querySelector('.db-vehicle-tag');
    if (tag && v) tag.textContent = v.regno;
  }

  /* ─────────────────────────────────────────
     초기화
  ───────────────────────────────────────── */
  function init() {
    const badge   = document.getElementById('header-version');
    if (badge)   badge.addEventListener('click', showReadme);

    const company = document.getElementById('header-company');
    if (company) company.addEventListener('click', ()=>App.switchTab('tab-dashboard'));

    const readmeModal = document.getElementById('readme-modal');
    const readmeClose = document.getElementById('readme-modal-close');
    const readmeOk    = document.getElementById('readme-modal-ok');
    if (readmeClose) readmeClose.addEventListener('click', ()=>{readmeModal.style.display='none';});
    if (readmeOk)    readmeOk.addEventListener('click',    ()=>{readmeModal.style.display='none';});
    if (readmeModal) readmeModal.addEventListener('click', e=>{
      if (e.target===readmeModal) readmeModal.style.display='none';
    });

  }

  /* ─────────────────────────────────────────
     silentUpdate: CRUD 후 백그라운드 갱신
     - 현재 탭이 대시보드면 즉시 render()
     - 다른 탭이면 dirty 플래그만 세팅
       → 다음에 대시보드 탭으로 올 때 자동 반영
  ───────────────────────────────────────── */
  let _dirty = false;

  function silentUpdate() {
    const dashTab = document.getElementById('tab-dashboard');
    if (dashTab && dashTab.classList.contains('active')) {
      // 이미 대시보드 탭 → 바로 재렌더
      render();
    } else {
      // 다른 탭 → dirty 표시만 (사용자가 대시보드 탭으로 이동할 때 갱신)
      _dirty = true;
    }
  }

  return { init, render, showReadme, changeDailyVehicle, silentUpdate };
})();
