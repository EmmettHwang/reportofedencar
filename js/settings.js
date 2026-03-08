/* =====================================================
   settings.js - 운행 설정
   ===================================================== */

const SettingsManager = (() => {

  function renderSummary() {
    const s = DB.Settings.get();
    const vehicles = DB.Vehicles.getAll();
    const v = vehicles.find(x => x.id === s.vehicleId);
    const el = document.getElementById('settings-summary-content');

    const items = [
      { label: '기준 차량', value: v ? `${v.regno} (${v.model})` : '미설정' },
      { label: '출퇴근 왕복거리', value: `${s.commuteDist} km ± ${s.commuteVariance} km` },
      { label: '주 출퇴근 횟수', value: `주 ${s.commuteDaysPerWeek}회` },
      { label: '연간 목표거리', value: `${Number(s.annualKm).toLocaleString()} km` },
      { label: '토요일 포함', value: s.includeSat ? '포함' : '미포함' },
      { label: '거래처 수', value: `${DB.Clients.getAll().length}곳` },
    ];

    el.innerHTML = items.map(i => `
      <div class="summary-item">
        <div class="s-label">${i.label}</div>
        <div class="s-value">${i.value}</div>
      </div>
    `).join('');
  }

  function loadToForm() {
    const s = DB.Settings.get();
    document.getElementById('s-commute-dist').value  = s.commuteDist || '';
    document.getElementById('s-commute-var').value   = s.commuteVariance || 0;
    document.getElementById('s-commute-days').value  = s.commuteDaysPerWeek || 2;
    document.getElementById('s-annual-km').value     = s.annualKm || 7000;
    document.getElementById('s-fix-seed').checked    = s.fixSeed || false;
    document.getElementById('s-commute-spread').value = s.commuteSpread || 'random';
    document.getElementById('s-include-sat').checked = s.includeSat || false;

    // 차량 셀렉트
    const vsel = document.getElementById('s-vehicle-select');
    const vehicles = DB.Vehicles.getAll();
    vsel.innerHTML = '<option value="">-- 차량을 선택하세요 --</option>' +
      vehicles.map(v => `<option value="${v.id}" ${v.id === s.vehicleId ? 'selected' : ''}>${v.regno} (${v.model})</option>`).join('');
  }

  function init() {
    document.getElementById('btn-save-settings').addEventListener('click', () => {
      const commuteDist = parseFloat(document.getElementById('s-commute-dist').value);
      const commuteVariance = parseFloat(document.getElementById('s-commute-var').value) || 0;
      const commuteDaysPerWeek = parseInt(document.getElementById('s-commute-days').value);
      const annualKm = parseInt(document.getElementById('s-annual-km').value);
      const vehicleId = document.getElementById('s-vehicle-select').value;
      const fixSeed = document.getElementById('s-fix-seed').checked;
      const commuteSpread = document.getElementById('s-commute-spread').value;
      const includeSat = document.getElementById('s-include-sat').checked;

      if (!commuteDist || commuteDist <= 0) { App.toast('출퇴근 왕복거리를 입력해주세요.', 'error'); return; }
      if (!annualKm || annualKm <= 0)       { App.toast('연간 목표거리를 입력해주세요.', 'error'); return; }

      DB.Settings.save({
        commuteDist, commuteVariance, commuteDaysPerWeek,
        annualKm, vehicleId, fixSeed, commuteSpread, includeSat
      });

      renderSummary();
      App.toast('설정이 저장되었습니다.', 'success');
    });

    loadToForm();
    renderSummary();
  }

  function reload() {
    loadToForm();
    renderSummary();
  }

  return { init, reload, renderSummary };
})();
