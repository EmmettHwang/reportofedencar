/* =====================================================
   app.js - 앱 진입점 & 공통 유틸 v2.0 (MariaDB)
   ===================================================== */

const App = (() => {
  let confirmCallback = null;

  /* ── Toast ── */
  function toast(msg, type='default') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = `toast ${type}`;
    void el.offsetHeight;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(()=>el.classList.remove('show'), 3000);
  }

  /* ── Confirm 모달 ── */
  function confirm(message, onConfirm) {
    confirmCallback = onConfirm;
    document.getElementById('modal-title').textContent   = '확인';
    document.getElementById('modal-body').textContent    = message;
    document.getElementById('modal-confirm').textContent = '확인';
    document.getElementById('modal-cancel').style.display = 'inline-flex';
    document.getElementById('modal-overlay').style.display = 'flex';
  }

  /* ── Alert 모달 ── */
  function alert(message, title='알림') {
    confirmCallback = null;
    document.getElementById('modal-title').textContent  = title;
    document.getElementById('modal-body').innerHTML     = message;
    document.getElementById('modal-confirm').textContent= '확인';
    document.getElementById('modal-cancel').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'flex';
  }

  /* ── 탭 전환 ── */
  function switchTab(tabId) {
    document.querySelectorAll('.tab-section').forEach(s=>s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');
    const btn = document.querySelector(`[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
    if (tabId==='tab-dashboard') Dashboard.render();
  }

  function switchTabAndSubtab(tabId, subtabId) {
    switchTab(tabId);
    setTimeout(() => {
      document.querySelectorAll('.sub-tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.sub-tab-section').forEach(s=>s.classList.remove('active'));
      const btn = document.querySelector(`[data-subtab="${subtabId}"]`);
      const sec = document.getElementById(subtabId);
      if (btn) btn.classList.add('active');
      if (sec) sec.classList.add('active');
    }, 50);
  }

  /* ── 차량 셀렉트 전체 갱신 ── */
  async function refreshVehicleSelects() {
    const vehicles    = await DB.Vehicles.getAll();
    const baseOpt     = '<option value="">-- 차량 선택 --</option>';
    const vOpts       = vehicles.map(v=>`<option value="${v.id}">${v.regno} (${v.model})</option>`).join('');
    // localStorage에서 선택된 차량 ID 복원 (vehicle.js와 동일한 키)
    const STORAGE_KEY = 'edencar_selected_vehicle_id';
    let savedId = '';
    try { savedId = localStorage.getItem(STORAGE_KEY) || ''; } catch(e) {}
    const resolvedId = (savedId && vehicles.find(v=>v.id===savedId)) ? savedId
      : (vehicles.length ? vehicles[0].id : '');

    ['lb-vehicle-select','lb-bulk-vehicle'].forEach(id=>{
      const sel=document.getElementById(id); if(!sel) return;
      sel.innerHTML=baseOpt+vOpts;
      sel.value = resolvedId || '';
    });
    const sSel=document.getElementById('s-vehicle-select');
    if(sSel){ sSel.innerHTML='<option value="">-- 선택 --</option>'+vOpts; sSel.value=resolvedId||''; }
    // vmgr-vehicle-select는 VehicleManager에서 관리
    const cSel=document.getElementById('cost-vehicle');
    if(cSel){ cSel.innerHTML=baseOpt+vOpts; cSel.value=resolvedId||''; }
    const eSel=document.getElementById('exp-vehicle');
    if(eSel){ eSel.innerHTML='<option value="all">전체 차량</option>'+vOpts; eSel.value=resolvedId||''; }

    // odo 자동 반영 (lb 탭)
    if (resolvedId) {
      const vObj = vehicles.find(v=>v.id===resolvedId);
      if (vObj) {
        const odo1 = document.getElementById('lb-start-odo');
        const odo2 = document.getElementById('lb-bulk-odo');
        if (odo1 && !odo1.value) odo1.value = vObj.odometer;
        if (odo2 && !odo2.value) odo2.value = vObj.odometer;
      }
    }

    await VehicleManager.renderSummary();
    if(typeof CostExport!=='undefined') CostExport.refreshCostExportSelects();
  }

  /* ── 모달 닫기 ── */
  function closeModal() {
    document.getElementById('modal-overlay').style.display='none';
    confirmCallback=null;
  }

  /* ── 로딩 모달 ── */
  function showLoading(msg = '잠시만 기다려 주세요...', {sub='', progress=false}={}) {
    const el   = document.getElementById('loading-modal');
    const txt  = document.getElementById('loading-text');
    const sub_ = document.getElementById('loading-sub-text');
    const wrap = document.getElementById('loading-progress-wrap');
    const bar  = document.getElementById('loading-progress-bar');
    const pct  = document.getElementById('loading-progress-pct');
    if (txt)  txt.textContent  = msg;
    if (sub_) sub_.textContent = sub;
    if (wrap) wrap.style.display = progress ? 'flex' : 'none';
    if (bar)  bar.style.width  = '0%';
    if (pct)  pct.textContent  = '0%';
    if (el)   el.style.display = 'flex';
    /* nav 버튼 차단 */
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.add('nav-blocked'));
  }

  function updateProgress(percent, sub='') {
    const bar  = document.getElementById('loading-progress-bar');
    const pct  = document.getElementById('loading-progress-pct');
    const sub_ = document.getElementById('loading-sub-text');
    const wrap = document.getElementById('loading-progress-wrap');
    if (wrap) wrap.style.display = 'flex';
    const p = Math.min(100, Math.max(0, Math.round(percent)));
    if (bar)  bar.style.width  = p + '%';
    if (pct)  pct.textContent  = p + '%';
    if (sub_) sub_.textContent = sub;
  }

  function updateLoadingText(msg) {
    const txt = document.getElementById('loading-text');
    if (txt) txt.textContent = msg;
  }

  function hideLoading() {
    const el = document.getElementById('loading-modal');
    if (el) el.style.display = 'none';
    /* nav 버튼 복원 */
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('nav-blocked'));
  }

  /* ── 초기화 ── */
  async function init() {
    /* DB 연결 확인 */
    const dbOk = await DB.checkHealth();
    if (!dbOk) {
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                    flex-direction:column;gap:16px;font-family:sans-serif;background:#f3f4f6;">
          <div style="font-size:48px;">⚠️</div>
          <h2 style="color:#dc2626;margin:0;">DB 서버에 연결할 수 없습니다</h2>
          <p style="color:#6b7280;margin:0;">서버를 재시작하거나 관리자에게 문의하세요.</p>
          <button onclick="location.reload()" style="padding:10px 24px;background:#1a4fa0;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">
            🔄 새로고침
          </button>
        </div>`;
      return;
    }

    /* 메인 탭 */
    document.querySelectorAll('.nav-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        switchTab(btn.dataset.tab);
        if(btn.dataset.tab==='tab-export'){
          ExportManager.renderSavedList();
          CostExport.refreshCostExportSelects();
        }
      });
    });

    /* 서브탭 */
    document.querySelectorAll('.sub-tab-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        document.querySelectorAll('.sub-tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.sub-tab-section').forEach(s=>s.classList.remove('active'));
        btn.classList.add('active');
        const t=document.getElementById(btn.dataset.subtab); if(t) t.classList.add('active');
      });
    });

    /* 모달 */
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', e=>{
      if(e.target===document.getElementById('modal-overlay')) closeModal();
    });
    document.getElementById('modal-confirm').addEventListener('click', ()=>{
      const cb = confirmCallback;   // 먼저 캡처
      closeModal();                 // null 초기화
      if(cb) cb();                  // 캡처된 콜백 실행
    });

    /* 모듈 초기화 */
    await VehicleManager.init();   // settings 통합
    await ClientManager.init();
    // SettingsManager는 VehicleManager에 통합됨
    LogbookManager.init();
    ExportManager.init();
    CostLedger.init();
    CostExport.init();
    Dashboard.init();

    await refreshVehicleSelects();

    /* odo 자동 바인딩 */
    document.getElementById('lb-vehicle-select').addEventListener('change', async ()=>{
      const v=await DB.Vehicles.getById(document.getElementById('lb-vehicle-select').value);
      if(v) document.getElementById('lb-start-odo').value=v.odometer;
    });
    document.getElementById('lb-bulk-vehicle').addEventListener('change', async ()=>{
      const v=await DB.Vehicles.getById(document.getElementById('lb-bulk-vehicle').value);
      if(v) document.getElementById('lb-bulk-odo').value=v.odometer;
    });

    /* 연간 일괄 → 즉시 엑셀 */
    document.getElementById('btn-bulk-export').addEventListener('click', ()=>{
      const vehicleId=document.getElementById('lb-bulk-vehicle').value;
      const year     =parseInt(document.getElementById('lb-bulk-year').value);
      if(!vehicleId||!year){ toast('차량과 연도를 선택해주세요.','error'); return; }
      ExportManager.exportYear(vehicleId, year);
    });

    /* 즉시 엑셀 (단월) */
    const qBtn=document.getElementById('btn-quick-export');
    if(qBtn){
      qBtn.addEventListener('click', async ()=>{
        const rows=LogbookManager.getCurrentRows();
        const meta=LogbookManager.getCurrentMeta();
        if(!rows.length){ toast('일지가 없습니다.','error'); return; }
        const { vehicleId, year, month }=meta;
        const v=await DB.Vehicles.getById(vehicleId);
        await DB.Logs.save(vehicleId, year, month, rows, { regno:v?.regno||'', model:v?.model||'' });
        ExportManager.exportYear(vehicleId, year);
      });
    }

    /* 최초 환영 (차량 없을 때) */
    const vs = await DB.Vehicles.getAll();
    if (!vs.length) setTimeout(showWelcome, 500);

    console.log('🚗 (주)이든푸드 차량 운행기록부 v2.0 (MariaDB) 초기화 완료');
  }

  /* ── 환영 모달 ── */
  function showWelcome() {
    App.alert(`
      <div style="line-height:2;font-size:14px;">
        <strong style="color:#1a4fa0;font-size:15px;">👋 처음 방문하셨군요!</strong><br>
        <span style="color:#6b7280;font-size:13px;">아래 순서대로 설정하시면 됩니다</span><br><br>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="background:#e8f0fc;padding:8px 12px;border-radius:6px;border-left:4px solid #1a4fa0;">
            <strong>① 🚗 차량 관리</strong> — 차량 등록번호 및 현재 누적거리 입력
          </div>
          <div style="background:#e8f0fc;padding:8px 12px;border-radius:6px;border-left:4px solid #1a4fa0;">
            <strong>② 🏢 거래처 관리</strong> — 방문 거래처 및 왕복거리 등록
          </div>
          <div style="background:#e8f0fc;padding:8px 12px;border-radius:6px;border-left:4px solid #1a4fa0;">
            <strong>③ ⚙️ 운행 설정</strong> — 출퇴근 거리, 주N회 설정
          </div>
          <div style="background:#dcfce7;padding:8px 12px;border-radius:6px;border-left:4px solid #16a34a;">
            <strong>④ 📅 연간 일괄 생성</strong> — 1~12월 한번에 자동생성!
          </div>
          <div style="background:#fefce8;padding:8px 12px;border-radius:6px;border-left:4px solid #d97706;">
            <strong>⑤ 📊 엑셀 출력</strong> — 종합시트+월별시트 1파일 다운로드
          </div>
        </div>
        <br>
        <div style="display:flex;gap:8px;flex-direction:column;">
          <button onclick="App.loadSampleData()" class="btn btn-success" style="width:100%;padding:12px;">
            🎯 샘플 데이터로 바로 체험하기
          </button>
        </div>
        <br><small style="color:#9ca3af;">모든 데이터는 MariaDB 서버에 저장됩니다.</small>
      </div>
    `, '🚗 업무용 차량 운행기록부 시작하기');
  }

  /* ── 샘플 데이터 ── */
  async function loadSampleData() {
    closeModal();
    try {
      const v = await DB.Vehicles.add({
        regno:'159러1358', model:'현대 소나타', year:2022,
        odometer:34576, fuelEff:12.5, fuelPrice:1650, memo:'업무용'
      });
      await Promise.all([
        DB.Clients.add({ name:'토부리',     category:'식당', distance:42, variance:3, visits:4, toll:1800, parking:3000, memo:'' }),
        DB.Clients.add({ name:'청라감자탕', category:'식당', distance:25, variance:2, visits:4, toll:0,    parking:2000, memo:'' }),
        DB.Clients.add({ name:'두리감자탕', category:'식당', distance:41, variance:3, visits:3, toll:1200, parking:0,    memo:'' }),
        DB.Clients.add({ name:'상미욱',     category:'식당', distance:57, variance:4, visits:3, toll:2500, parking:5000, memo:'' }),
        DB.Clients.add({ name:'토부리삼산', category:'식당', distance:35, variance:3, visits:3, toll:1800, parking:0,    memo:'' }),
      ]);
      await DB.Settings.save(v.id, {
        vehicleId:v.id, commuteDist:22, commuteVariance:2, commuteDaysPerWeek:2,
        annualKm:20000, fixSeed:true, commuteSpread:'random', includeSat:false, commuteToll:0
      });

      await VehicleManager.render();
      await ClientManager.render();
      await VehicleManager.reload();
      await refreshVehicleSelects();

      switchTab('tab-logbook');
      setTimeout(()=>{
        document.querySelectorAll('.sub-tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.sub-tab-section').forEach(s=>s.classList.remove('active'));
        document.querySelector('[data-subtab="subtab-bulk"]').classList.add('active');
        document.getElementById('subtab-bulk').classList.add('active');
        document.getElementById('lb-bulk-vehicle').value = v.id;
        document.getElementById('lb-bulk-year').value   = 2026;
        document.getElementById('lb-bulk-odo').value    = 34576;
        toast('✅ 샘플 데이터 로드! "1~12월 일괄 생성" 버튼을 눌러보세요.','success');
      }, 200);
    } catch(e) { toast('샘플 데이터 로드 실패: ' + e.message, 'error'); }
  }

  return { init, toast, confirm, alert, switchTab, switchTabAndSubtab,
           refreshVehicleSelects, loadSampleData, closeModal,
           showLoading, hideLoading, updateProgress, updateLoadingText };
})();

document.addEventListener('DOMContentLoaded', App.init);
