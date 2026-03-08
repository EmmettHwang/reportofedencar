/* =====================================================
   app.js - 앱 진입점, 공통 유틸
   ===================================================== */

const App = (() => {
  let confirmCallback = null;

  // ---- Toast 알림 ----
  function toast(msg, type = 'default') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = `toast ${type}`;
    // 강제 reflow로 트랜지션 재시작
    void el.offsetHeight;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // ---- 확인 모달 ----
  function confirm(message, onConfirm) {
    confirmCallback = onConfirm;
    document.getElementById('modal-title').textContent  = '확인';
    document.getElementById('modal-body').textContent   = message;
    document.getElementById('modal-confirm').textContent = '확인';
    document.getElementById('modal-cancel').style.display = 'inline-flex';
    document.getElementById('modal-overlay').style.display = 'flex';
  }

  // ---- 알림 모달 ----
  function alert(message, title = '알림') {
    confirmCallback = null;
    document.getElementById('modal-title').textContent  = title;
    document.getElementById('modal-body').innerHTML     = message;
    document.getElementById('modal-confirm').textContent = '확인';
    document.getElementById('modal-cancel').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'flex';
  }

  // ---- 탭 전환 ----
  function switchTab(tabId) {
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');
    const btn = document.querySelector(`[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
  }

  // ---- 차량 셀렉트 전체 갱신 ----
  function refreshVehicleSelects() {
    const vehicles = DB.Vehicles.getAll();
    const opts = '<option value="">-- 차량 선택 --</option>' +
      vehicles.map(v => `<option value="${v.id}">${v.regno} (${v.model})</option>`).join('');

    const lbSel  = document.getElementById('lb-vehicle-select');
    const sVSel  = document.getElementById('s-vehicle-select');

    const prevLb = lbSel.value;
    const prevSv = sVSel.value;

    lbSel.innerHTML = opts;
    if (prevLb) lbSel.value = prevLb;

    sVSel.innerHTML = '<option value="">-- 차량을 선택하세요 --</option>' +
      vehicles.map(v => `<option value="${v.id}">${v.regno} (${v.model})</option>`).join('');
    if (prevSv) sVSel.value = prevSv;

    // 엑셀 출력 탭 차량 셀렉트
    const expSel = document.getElementById('exp-vehicle');
    if (expSel) {
      const prevExp = expSel.value;
      expSel.innerHTML = '<option value="all">전체 차량</option>' +
        vehicles.map(v => `<option value="${v.id}">${v.regno} (${v.model})</option>`).join('');
      if (prevExp) expSel.value = prevExp;
    }

    // 설정 요약 갱신
    SettingsManager.renderSummary();
  }

  // ---- 초기화 ----
  function init() {
    // 탭 클릭
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        switchTab(tabId);
        if (tabId === 'tab-settings') SettingsManager.reload();
        if (tabId === 'tab-export')   ExportManager.renderSavedList();
      });
    });

    // 모달 닫기
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });
    document.getElementById('modal-confirm').addEventListener('click', () => {
      closeModal();
      if (confirmCallback) { confirmCallback(); confirmCallback = null; }
    });

    // 모듈 초기화
    VehicleManager.init();
    ClientManager.init();
    SettingsManager.init();
    LogbookManager.init();
    ExportManager.init();

    // 차량 셀렉트 갱신
    refreshVehicleSelects();

    // 시작 odo 자동 바인딩
    document.getElementById('lb-vehicle-select').addEventListener('change', () => {
      const v = DB.Vehicles.getById(document.getElementById('lb-vehicle-select').value);
      if (v) document.getElementById('lb-start-odo').value = v.odometer;
    });

    // 최초 샘플 데이터 안내
    const vehicles = DB.Vehicles.getAll();
    if (!vehicles.length) {
      setTimeout(() => {
        showWelcome();
      }, 500);
    }

    console.log('🚗 업무용 승용차 운행기록부 초기화 완료');
  }

  function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    confirmCallback = null;
  }

  // ---- 환영 안내 ----
  function showWelcome() {
    App.alert(`
      <div style="line-height:1.9; font-size:14px;">
        <strong style="color:#1a4fa0; font-size:16px;">👋 처음 방문하셨군요!</strong><br><br>
        아래 순서대로 설정해 주세요:<br><br>
        <span style="background:#e8f0fc;padding:2px 8px;border-radius:4px;">① 🚗 차량 관리</span> 탭에서 차량 등록<br>
        <span style="background:#e8f0fc;padding:2px 8px;border-radius:4px;">② 🏢 거래처 관리</span> 탭에서 거래처 등록<br>
        <span style="background:#e8f0fc;padding:2px 8px;border-radius:4px;">③ ⚙️ 운행 설정</span> 탭에서 출퇴근 거리 등 설정<br>
        <span style="background:#e8f0fc;padding:2px 8px;border-radius:4px;">④ 📅 운행일지 작성</span> 탭에서 자동 생성<br>
        <span style="background:#e8f0fc;padding:2px 8px;border-radius:4px;">⑤ 📊 엑셀 출력</span> 탭에서 다운로드<br><br>
        <button onclick="App.loadSampleData()" class="btn btn-success" style="margin-top:8px;width:100%;">
          🎯 샘플 데이터로 바로 시작하기 (첨부파일 동일 데이터)
        </button><br>
        <small style="color:#6b7280;">모든 데이터는 브라우저에 자동 저장됩니다.</small>
      </div>
    `, '🚗 업무용 차량 운행기록부 시작하기');
  }

  // ---- 샘플 데이터 로드 (첨부파일 기준) ----
  function loadSampleData() {
    closeModal();
    // 차량 등록
    const v = DB.Vehicles.add({
      regno: '159러1358',
      model: '현대 소나타',
      year: 2022,
      odometer: 34576,
      memo: '업무용 승용차'
    });
    // 거래처 등록 (첨부파일 비고란 참조)
    DB.Clients.add({ name: '토부리',      distance: 42, variance: 3, visits: 4, memo: '' });
    DB.Clients.add({ name: '청라감자탕',  distance: 25, variance: 2, visits: 4, memo: '' });
    DB.Clients.add({ name: '두리감자탕',  distance: 41, variance: 3, visits: 3, memo: '' });
    DB.Clients.add({ name: '상미욱',      distance: 57, variance: 4, visits: 3, memo: '' });
    DB.Clients.add({ name: '토부리삼산',  distance: 35, variance: 3, visits: 3, memo: '' });
    // 설정 저장
    DB.Settings.save({
      commuteDist: 22,
      commuteVariance: 2,
      commuteDaysPerWeek: 2,
      annualKm: 7000,
      vehicleId: v.id,
      fixSeed: true,
      commuteSpread: 'random',
      includeSat: false
    });
    // 화면 갱신
    VehicleManager.render();
    ClientManager.render();
    SettingsManager.reload();
    refreshVehicleSelects();
    // 운행일지 탭으로 이동하고 자동 설정
    switchTab('tab-logbook');
    document.getElementById('lb-vehicle-select').value = v.id;
    document.getElementById('lb-year').value  = 2025;
    document.getElementById('lb-month').value = 1;
    document.getElementById('lb-start-odo').value = 34576;
    toast('✅ 샘플 데이터가 로드되었습니다! 자동 생성 버튼을 눌러보세요.', 'success');
  }

  return { init, toast, confirm, alert, switchTab, refreshVehicleSelects, loadSampleData };
})();

// DOM 로드 완료 후 초기화
document.addEventListener('DOMContentLoaded', App.init);
