/* =====================================================
   vehicle.js v7 - 차량관리 + 운행설정 통합 모듈
   4개 서브탭: 기본정보 / 운행설정 / 고정비용 / 추가정보
   localStorage로 선택 차량 영속 유지
   ===================================================== */
const VehicleManager = (() => {
  const STORAGE_KEY   = 'edencar_selected_vehicle_id';  // localStorage 키
  let curVehicleId = '';   // 현재 선택된 차량 ID
  let tempRegDoc   = null;
  let tempLicense1 = null;
  let tempLicense2 = null;

  /* ─────────────────────────────────────────
     localStorage 저장 / 복원
  ───────────────────────────────────────── */
  function persistVehicleId(id) {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else    localStorage.removeItem(STORAGE_KEY);
    } catch(e) { /* 프라이빗 모드 등 무시 */ }
  }

  function restoreVehicleId() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch(e) { return ''; }
  }

  /* 다른 탭 차량 셀렉트 동기화 + nav 배지 갱신 */
  function syncAllSelects(vehicleId, vehicleLabel) {
    // 운행일지 / 비용 / 엑셀 탭 셀렉트 동기화
    ['lb-vehicle-select','lb-bulk-vehicle','cost-vehicle'].forEach(id => {
      const sel = document.getElementById(id);
      if (sel && vehicleId && sel.querySelector(`option[value="${vehicleId}"]`)) {
        sel.value = vehicleId;
      }
    });
    // 엑셀 출력 셀렉트
    const eSel = document.getElementById('exp-vehicle');
    if (eSel && vehicleId && eSel.querySelector(`option[value="${vehicleId}"]`)) {
      eSel.value = vehicleId;
    }
    // 시작 누적거리 자동 반영
    if (vehicleId) {
      DB.Vehicles.getById(vehicleId).then(v => {
        if (!v) return;
        const odo1 = document.getElementById('lb-start-odo');
        const odo2 = document.getElementById('lb-bulk-odo');
        if (odo1 && !odo1.value) odo1.value = v.odometer;
        if (odo2 && !odo2.value) odo2.value = v.odometer;
      }).catch(() => {});
    }
    // nav 배지 갱신
    updateNavBadge(vehicleLabel);
  }

  /* 상단 nav에 선택 차량 배지 표시 */
  function updateNavBadge(label) {
    let badge = document.getElementById('nav-vehicle-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'nav-vehicle-badge';
      badge.className = 'nav-vehicle-badge';
      // 차량 관리 nav 버튼 오른쪽에 삽입
      const vehicleNavBtn = document.querySelector('.nav-btn[data-tab="tab-vehicle"]');
      if (vehicleNavBtn) vehicleNavBtn.insertAdjacentElement('afterend', badge);
      else {
        const nav = document.querySelector('.main-nav');
        if (nav) nav.appendChild(badge);
      }
    }
    if (label) {
      badge.textContent = '✅ ' + label;
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }

  /* ─────────────────────────────────────────
     공통: 차량 선택 셀렉트 초기화
  ───────────────────────────────────────── */
  async function initVehicleSelect() {
    const sel = document.getElementById('vmgr-vehicle-select');
    if (!sel) return;
    const vs = await DB.Vehicles.getAll();
    sel.innerHTML = '<option value="">-- 차량을 선택하세요 --</option>' +
      vs.map(v => `<option value="${v.id}">${v.regno} (${v.model})</option>`).join('');

    // ① localStorage에서 이전 선택 복원 시도
    const saved = restoreVehicleId();
    if (saved && vs.find(v => v.id === saved)) {
      curVehicleId = saved;
    } else if (curVehicleId && vs.find(v => v.id === curVehicleId)) {
      // 메모리에 남아 있는 경우 유지
    } else if (vs.length) {
      curVehicleId = vs[0].id;   // 첫 차량 기본 선택
    } else {
      curVehicleId = '';
    }
    sel.value = curVehicleId;
    if (curVehicleId) persistVehicleId(curVehicleId);

    sel.onchange = async () => {
      curVehicleId = sel.value;
      persistVehicleId(curVehicleId);   // 변경 즉시 저장
      await loadAllForVehicle(curVehicleId);
    };
  }

  /* 차량 선택 시 모든 탭 데이터 로드 */
  async function loadAllForVehicle(vehicleId) {
    if (!vehicleId) {
      clearBasicForm();
      clearCostForm();
      clearDocsForm();
      clearSettingsForm();
      await renderClientCheckboxes('');
      await renderSummary('');
      updateNavBadge('');
      // 삭제 버튼 숨기기
      const db = document.getElementById('btn-delete-vehicle');
      if (db) db.style.display = 'none';
      const fTitle = document.getElementById('vehicle-form-title');
      if (fTitle) fTitle.textContent = '🚗 새 차량 등록';
      return;
    }
    // 기본정보 로드
    const v = await DB.Vehicles.getById(vehicleId).catch(() => null);
    if (v) {
      loadBasicForm(v);
      // nav 배지 + 다른 탭 셀렉트 동기화
      const label = `${v.regno} (${v.model})`;
      syncAllSelects(vehicleId, label);
    }

    // 고정비용 로드
    const costYearEl = document.getElementById('v-cost-year');
    const costYear = costYearEl ? parseInt(costYearEl.value) : new Date().getFullYear();
    const annual = await DB.CostData.getAnnual(vehicleId, costYear).catch(() => ({}));
    loadCostForm(annual);

    // 서류 미리보기 로드
    await loadDocsPreview(vehicleId);

    // 운행설정 로드
    const s = await DB.Settings.get(vehicleId).catch(() => null);
    loadSettingsForm(s);
    await renderClientCheckboxes(vehicleId);
    await renderSummary(vehicleId);

    // 삭제 버튼 표시
    const db = document.getElementById('btn-delete-vehicle');
    if (db) db.style.display = 'inline-flex';
    const fTitle = document.getElementById('vehicle-form-title');
    if (fTitle) fTitle.textContent = '🚗 차량 기본 정보';

    // vehicle-cards-container 숨기기 (기존 차량 선택 시)
    const cc = document.getElementById('vehicle-cards-container');
    if (cc) cc.style.display = 'none';
  }

  /* ─────────────────────────────────────────
     기본정보 탭
  ───────────────────────────────────────── */
  function loadBasicForm(v) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('v-regno',      v.regno);
    set('v-model',      v.model);
    set('v-year',       v.year || '');
    set('v-odometer',   v.odometer);
    set('v-fuel-eff',   v.fuelEff || '');
    set('v-fuel-price', v.fuelPrice || '');
    set('v-memo',       v.memo || '');
    // 운전자 정보도 함께
    set('v-driver1-name',    v.driver1Name || '');
    set('v-driver1-license', v.driver1LicenseNo || '');
    set('v-driver2-name',    v.driver2Name || '');
    set('v-driver2-license', v.driver2LicenseNo || '');
  }

  function clearBasicForm() {
    ['v-regno','v-model','v-year','v-odometer','v-fuel-eff','v-fuel-price','v-memo',
     'v-driver1-name','v-driver1-license','v-driver2-name','v-driver2-license'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }

  async function saveBasicInfo() {
    const regno    = document.getElementById('v-regno')?.value.trim();
    const model    = document.getElementById('v-model')?.value.trim();
    const year     = document.getElementById('v-year')?.value.trim();
    const odometer = document.getElementById('v-odometer')?.value.trim();
    const fuelEff  = parseFloat(document.getElementById('v-fuel-eff')?.value) || 0;
    const fuelPrice= parseInt(document.getElementById('v-fuel-price')?.value) || 0;
    const memo     = document.getElementById('v-memo')?.value.trim();

    if (!regno)    { App.toast('차량등록번호를 입력하세요.', 'error'); return; }
    if (!model)    { App.toast('차종을 입력하세요.', 'error'); return; }
    if (!odometer) { App.toast('누적주행거리를 입력하세요.', 'error'); return; }

    const all = await DB.Vehicles.getAll();
    const dup = all.find(v => v.regno === regno && v.id !== curVehicleId);
    if (dup) { App.toast('이미 등록된 차량번호입니다.', 'error'); return; }

    const data = { regno, model, year: Number(year), odometer: Number(odometer),
      fuelEff, fuelPrice, memo,
      driver1Name:       document.getElementById('v-driver1-name')?.value.trim(),
      driver1LicenseNo:  document.getElementById('v-driver1-license')?.value.trim(),
      driver2Name:       document.getElementById('v-driver2-name')?.value.trim(),
      driver2LicenseNo:  document.getElementById('v-driver2-license')?.value.trim(),
    };

    App.showLoading(curVehicleId ? '차량 정보 수정 중...' : '차량 등록 중...');
    try {
      if (curVehicleId) {
        await DB.Vehicles.update(curVehicleId, data);
      } else {
        const newV = await DB.Vehicles.add(data);
        curVehicleId = newV.id;
      }
      App.hideLoading();
      persistVehicleId(curVehicleId);   // 신규 등록 후에도 ID 저장
      await render();
      await App.refreshVehicleSelects();
      // nav 배지 갱신
      const vObj = await DB.Vehicles.getById(curVehicleId).catch(() => null);
      if (vObj) syncAllSelects(curVehicleId, `${vObj.regno} (${vObj.model})`);
      if (typeof Dashboard !== 'undefined') Dashboard.silentUpdate();
      App.toast(curVehicleId ? '차량 정보가 수정되었습니다.' : '차량이 등록되었습니다.', 'success');
    } catch(e) { App.hideLoading(); App.toast('저장 실패: ' + e.message, 'error'); }
  }

  /* ─────────────────────────────────────────
     고정비용 탭
  ───────────────────────────────────────── */
  function initCostYearSelect() {
    const sel = document.getElementById('v-cost-year');
    if (!sel) return;
    const now = new Date().getFullYear();
    sel.innerHTML = '';
    for (let y = now - 1; y <= now + 2; y++) {
      const o = document.createElement('option');
      o.value = y; o.textContent = `${y}년`;
      if (y === now) o.selected = true;
      sel.appendChild(o);
    }
    ['v-cartax','v-insurance','v-loan'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', updateMonthlyHints);
    });
    sel.addEventListener('change', async () => {
      if (!curVehicleId) return;
      const cy = parseInt(sel.value);
      const annual = await DB.CostData.getAnnual(curVehicleId, cy).catch(() => ({}));
      loadCostForm(annual);
    });
  }

  function updateMonthlyHints() {
    [['v-cartax','v-cartax-monthly'],['v-insurance','v-insurance-monthly'],['v-loan','v-loan-monthly']]
    .forEach(([inputId, hintId]) => {
      const val  = parseInt(document.getElementById(inputId)?.value) || 0;
      const hint = document.getElementById(hintId);
      if (hint) hint.textContent = val > 0 ? `월 배분: ${Math.round(val/12).toLocaleString()}원` : '';
    });
  }

  function loadCostForm(annual) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('v-cartax',    annual?.carTax       || '');
    set('v-insurance', annual?.insurance    || '');
    set('v-loan',      annual?.loanInterest || '');
    set('v-repair',    annual?.repairMonthly|| '');
    updateMonthlyHints();
  }

  function clearCostForm() {
    ['v-cartax','v-insurance','v-loan','v-repair'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    ['v-cartax-monthly','v-insurance-monthly','v-loan-monthly'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '';
    });
  }

  async function saveCostInfo() {
    if (!curVehicleId) { App.toast('차량을 먼저 선택하세요.', 'error'); return; }
    const costYear  = parseInt(document.getElementById('v-cost-year')?.value);
    const carTax    = parseInt(document.getElementById('v-cartax')?.value)    || 0;
    const insurance = parseInt(document.getElementById('v-insurance')?.value) || 0;
    const loanInt   = parseInt(document.getElementById('v-loan')?.value)      || 0;
    const repairMon = parseInt(document.getElementById('v-repair')?.value)    || 0;

    App.showLoading('고정비용 저장 중...');
    try {
      await DB.CostData.saveAnnual(curVehicleId, costYear,
        { carTax, insurance, loanInterest: loanInt, repairMonthly: repairMon });
      App.hideLoading();
      App.toast('고정비용이 저장되었습니다.', 'success');
      if (typeof Dashboard !== 'undefined') Dashboard.silentUpdate();
    } catch(e) { App.hideLoading(); App.toast('저장 실패: ' + e.message, 'error'); }
  }

  /* ─────────────────────────────────────────
     추가정보 탭 (운전자/서류)
  ───────────────────────────────────────── */
  function bindFileInput(inputId, previewId, filenameId, clearBtnId, onLoad) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const data = { name: file.name, type: file.type, data: ev.target.result };
        onLoad(data);
        const preview = document.getElementById(previewId);
        if (preview) {
          preview.innerHTML = file.type.startsWith('image/')
            ? `<img src="${ev.target.result}" class="doc-preview-img" />`
            : `<div class="doc-preview-pdf">📄 ${file.name}</div>`;
        }
        const fname = document.getElementById(filenameId);
        if (fname) fname.textContent = file.name;
        const cb = clearBtnId ? document.getElementById(clearBtnId) : null;
        if (cb) cb.style.display = 'inline-block';
      };
      reader.readAsDataURL(file);
    });
  }

  function clearDoc(previewId, filenameId, clearBtnId, fileInputId, cameraInputId, onClear) {
    const preview = document.getElementById(previewId);
    const fname   = document.getElementById(filenameId);
    const cb      = clearBtnId ? document.getElementById(clearBtnId) : null;
    if (preview) preview.innerHTML = '';
    if (fname)   fname.textContent = '';
    if (cb)      cb.style.display = 'none';
    [fileInputId, cameraInputId].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    onClear();
  }

  function clearDocsForm() {
    ['v-regdoc-preview','v-driver1-license-preview','v-driver2-license-preview'].forEach(id => {
      const el = document.getElementById(id); if (el) el.innerHTML = '';
    });
    ['v-regdoc-filename','v-driver1-license-filename','v-driver2-license-filename'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '';
    });
    const cb = document.getElementById('v-regdoc-clear');
    if (cb) cb.style.display = 'none';
    ['v-regdoc-file','v-regdoc-camera','v-driver1-license-file','v-driver1-license-camera',
     'v-driver2-license-file','v-driver2-license-camera'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    tempRegDoc = tempLicense1 = tempLicense2 = null;
  }

  async function loadDocsPreview(vehicleId) {
    const restorePreview = async (docType, previewId, filenameId, clearBtnId) => {
      const doc = await DB.Vehicles.getDoc(vehicleId, docType).catch(() => null);
      if (!doc) return;
      const preview = document.getElementById(previewId);
      if (preview) preview.innerHTML = doc.type?.startsWith('image/')
        ? `<img src="${doc.data}" class="doc-preview-img" />`
        : `<div class="doc-preview-pdf">📄 ${doc.name}</div>`;
      const fname = document.getElementById(filenameId);
      if (fname) fname.textContent = doc.name || '';
      const cb = clearBtnId ? document.getElementById(clearBtnId) : null;
      if (cb) cb.style.display = 'inline-block';
    };
    tempRegDoc = tempLicense1 = tempLicense2 = null;
    await Promise.all([
      restorePreview('regdoc',   'v-regdoc-preview',          'v-regdoc-filename',          'v-regdoc-clear'),
      restorePreview('license1', 'v-driver1-license-preview', 'v-driver1-license-filename', null),
      restorePreview('license2', 'v-driver2-license-preview', 'v-driver2-license-filename', null),
    ]);
  }

  async function saveDocsInfo() {
    if (!curVehicleId) { App.toast('차량을 먼저 선택하세요.', 'error'); return; }
    App.showLoading('서류 저장 중...');
    try {
      // 운전자 정보도 함께 저장
      const v = await DB.Vehicles.getById(curVehicleId);
      if (v) {
        await DB.Vehicles.update(curVehicleId, {
          ...v,
          driver1Name:      document.getElementById('v-driver1-name')?.value.trim(),
          driver1LicenseNo: document.getElementById('v-driver1-license')?.value.trim(),
          driver2Name:      document.getElementById('v-driver2-name')?.value.trim(),
          driver2LicenseNo: document.getElementById('v-driver2-license')?.value.trim(),
        });
      }
      if (tempRegDoc)   await DB.Vehicles.saveDoc(curVehicleId, 'regdoc',   tempRegDoc);
      if (tempLicense1) await DB.Vehicles.saveDoc(curVehicleId, 'license1', tempLicense1);
      if (tempLicense2) await DB.Vehicles.saveDoc(curVehicleId, 'license2', tempLicense2);
      App.hideLoading();
      await render();
      App.toast('운전자 정보 및 서류가 저장되었습니다.', 'success');
    } catch(e) { App.hideLoading(); App.toast('저장 실패: ' + e.message, 'error'); }
  }

  /* ─────────────────────────────────────────
     운행설정 탭 (settings.js 통합)
  ───────────────────────────────────────── */
  function loadSettingsForm(s) {
    const set   = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const check = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
    set('s-commute-dist',   s?.commuteDist        || '');
    set('s-commute-var',    s?.commuteVariance     || 0);
    set('s-commute-days',   s?.commuteDaysPerWeek  || 2);
    set('s-annual-km',      s?.annualKm            || 7000);
    set('s-commute-spread', s?.commuteSpread       || 'random');
    set('s-commute-toll',   s?.commuteToll         || 0);
    check('s-fix-seed',    s?.fixSeed !== false);
    check('s-include-sat', s?.includeSat || false);
  }

  function clearSettingsForm() {
    document.getElementById('s-commute-dist')  && (document.getElementById('s-commute-dist').value   = '');
    document.getElementById('s-commute-var')   && (document.getElementById('s-commute-var').value    = 0);
    document.getElementById('s-commute-days')  && (document.getElementById('s-commute-days').value   = 2);
    document.getElementById('s-annual-km')     && (document.getElementById('s-annual-km').value      = 7000);
    document.getElementById('s-commute-spread')&& (document.getElementById('s-commute-spread').value = 'random');
    document.getElementById('s-commute-toll')  && (document.getElementById('s-commute-toll').value   = 0);
    document.getElementById('s-fix-seed')      && (document.getElementById('s-fix-seed').checked     = true);
    document.getElementById('s-include-sat')   && (document.getElementById('s-include-sat').checked  = false);
  }

  function getSelectedClientIds() {
    return Array.from(document.querySelectorAll('input[name="client-cb"]:checked')).map(cb => cb.value);
  }

  async function saveSettingsInfo() {
    if (!curVehicleId) { App.toast('차량을 먼저 선택하세요.', 'error'); return; }

    const commuteDist        = parseFloat(document.getElementById('s-commute-dist')?.value);
    const commuteVariance    = parseFloat(document.getElementById('s-commute-var')?.value)  || 0;
    const commuteDaysPerWeek = parseInt(document.getElementById('s-commute-days')?.value);
    const annualKm           = parseInt(document.getElementById('s-annual-km')?.value);
    const fixSeed            = document.getElementById('s-fix-seed')?.checked ?? true;
    const commuteSpread      = document.getElementById('s-commute-spread')?.value || 'random';
    const includeSat         = document.getElementById('s-include-sat')?.checked ?? false;
    const commuteToll        = parseInt(document.getElementById('s-commute-toll')?.value) || 0;
    const selectedClientIds  = getSelectedClientIds();

    if (!commuteDist || commuteDist <= 0) { App.toast('출퇴근 왕복거리를 입력하세요.', 'error'); return; }
    if (!annualKm   || annualKm   <= 0)   { App.toast('연간 목표거리를 입력하세요.',   'error'); return; }

    App.showLoading('운행설정 저장 중...');
    try {
      await DB.Settings.save(curVehicleId, {
        vehicleId: curVehicleId,
        commuteDist, commuteVariance, commuteDaysPerWeek,
        annualKm, fixSeed, commuteSpread, includeSat, commuteToll, selectedClientIds
      });
      await renderSummary(curVehicleId);
      App.hideLoading();
      App.toast('운행설정이 저장되었습니다.', 'success');
      if (typeof Dashboard !== 'undefined') Dashboard.silentUpdate();
    } catch(e) { App.hideLoading(); App.toast('저장 실패: ' + e.message, 'error'); }
  }

  async function renderSummary(vehicleId) {
    vehicleId = vehicleId || curVehicleId;
    const el = document.getElementById('settings-summary-content');
    if (!el) return;
    if (!vehicleId) { el.innerHTML = '<div style="color:#9ca3af;font-size:13px;">차량을 선택하세요.</div>'; return; }
    const s  = await DB.Settings.get(vehicleId).catch(() => null);
    const vs = await DB.Vehicles.getAll().catch(() => []);
    const v  = vs.find(x => x.id === vehicleId);
    const selectedClients = (s?.selectedClientIds || []).length;
    const totalClients    = (await DB.Clients.getAll().catch(() => [])).length;
    const items = [
      { label:'기준 차량',      value: v ? `${v.regno} (${v.model})` : '미설정' },
      { label:'출퇴근 왕복',    value: `${s?.commuteDist||0}km ± ${s?.commuteVariance||0}km` },
      { label:'출퇴근 통행료',  value: s?.commuteToll ? `편도 ${Number(s.commuteToll).toLocaleString()}원 (왕복 ${(Number(s.commuteToll)*2).toLocaleString()}원)` : '없음' },
      { label:'주 출퇴근 횟수', value: `주 ${s?.commuteDaysPerWeek||2}회` },
      { label:'연간 목표',      value: `${Number(s?.annualKm||7000).toLocaleString()} km` },
      { label:'토요일',         value: s?.includeSat ? '포함' : '제외' },
      { label:'운행 거래처',    value: `${selectedClients}곳 선택 / 전체 ${totalClients}곳` },
    ];
    el.innerHTML = items.map(i => `
      <div class="summary-item">
        <div class="s-label">${i.label}</div>
        <div class="s-value">${i.value}</div>
      </div>`).join('');
  }

  async function renderClientCheckboxes(vehicleId) {
    const listEl   = document.getElementById('client-checkbox-list');
    const filterEl = document.getElementById('client-cat-filter');
    if (!listEl || !filterEl) return;

    const clients = await DB.Clients.getAll().catch(() => []);
    if (!vehicleId) {
      listEl.innerHTML   = '<p style="color:#9ca3af;font-size:13px;">차량을 선택하면 거래처 목록이 표시됩니다.</p>';
      filterEl.innerHTML = '<button class="cat-filter-btn active" data-cat="all">전체</button>';
      return;
    }

    const s           = await DB.Settings.get(vehicleId).catch(() => null);
    const selectedIds = new Set(s?.selectedClientIds || []);
    const cats        = ['전체', ...new Set(clients.map(c => c.category || '미분류'))].filter(Boolean);

    filterEl.innerHTML = cats.map((cat, i) =>
      `<button class="cat-filter-btn ${i===0?'active':''}" data-cat="${cat==='전체'?'all':cat}">${cat}</button>`
    ).join('');

    filterEl.querySelectorAll('.cat-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filterEl.querySelectorAll('.cat-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.dataset.cat;
        listEl.querySelectorAll('.client-cb-item').forEach(item => {
          item.style.display = (cat==='all' || item.dataset.cat===cat) ? '' : 'none';
        });
      });
    });

    if (!clients.length) {
      listEl.innerHTML = '<p style="color:#9ca3af;font-size:13px;">등록된 거래처가 없습니다.</p>';
      return;
    }

    const allChecked = clients.every(c => selectedIds.has(c.id));
    listEl.innerHTML = `
      <div class="client-cb-select-all">
        <label style="cursor:pointer;font-size:13px;font-weight:600;color:#374151;">
          <input type="checkbox" id="cb-select-all" ${allChecked?'checked':''} style="margin-right:6px;cursor:pointer;" />
          전체 선택 / 해제
        </label>
      </div>
      <div class="client-cb-grid">
        ${clients.map(c => `
          <label class="client-cb-item" data-cat="${c.category||'미분류'}"
            title="${c.distance}km, 월${c.visits}회${c.toll?', 통행료'+Number(c.toll).toLocaleString()+'원':''}">
            <input type="checkbox" name="client-cb" value="${c.id}" ${selectedIds.has(c.id)?'checked':''} />
            <span class="client-cb-cat-badge">${c.category||'미분류'}</span>
            <span class="client-cb-name">${c.name}</span>
            <span class="client-cb-info">${c.distance}km · 월${c.visits}회</span>
          </label>`).join('')}
      </div>`;

    const cbAll = document.getElementById('cb-select-all');
    if (cbAll) cbAll.addEventListener('change', e => {
      listEl.querySelectorAll('input[name="client-cb"]').forEach(cb => cb.checked = e.target.checked);
    });
  }

  /* ─────────────────────────────────────────
     차량 목록 카드 렌더 (기본정보 탭 하단)
  ───────────────────────────────────────── */
  async function render() {
    const list      = await DB.Vehicles.getAll();
    const container = document.getElementById('vehicle-cards-container');
    if (!container) return;

    // 차량 선택 셀렉트 업데이트
    await initVehicleSelect();

    if (!list.length) {
      container.style.display = 'block';
      container.innerHTML = '<div class="empty-row" style="text-align:center;padding:30px;color:#9ca3af;">등록된 차량이 없습니다.<br><small>위에서 기본정보를 입력하고 저장하세요.</small></div>';
      // 신규등록 모드
      const fTitle = document.getElementById('vehicle-form-title');
      if (fTitle) fTitle.textContent = '🚗 새 차량 등록';
      const db = document.getElementById('btn-delete-vehicle');
      if (db) db.style.display = 'none';
      return;
    }

    const curYear = new Date().getFullYear();
    const cardData = await Promise.all(list.map(async (v, i) => {
      const [regdoc, lic1, lic2, annual] = await Promise.all([
        DB.Vehicles.getDoc(v.id, 'regdoc').catch(() => null),
        DB.Vehicles.getDoc(v.id, 'license1').catch(() => null),
        DB.Vehicles.getDoc(v.id, 'license2').catch(() => null),
        DB.CostData.getAnnual(v.id, curYear).catch(() => ({})),
      ]);
      return { v, i, regdoc, lic1, lic2, annual };
    }));

    container.style.display = 'block';
    container.innerHTML = `
      <div class="vmgr-card-list-header">
        <h4 style="margin:0;color:#374151;">📋 등록된 차량 목록 (${list.length}대)</h4>
        <small class="hint">클릭하여 차량을 선택하면 위에서 수정할 수 있습니다.</small>
      </div>` +
    cardData.map(({ v, i, regdoc, lic1, lic2, annual }) => {
      const regThumb  = regdoc  ? (regdoc.type==='application/pdf'  ? `<span class="doc-thumb-pdf">📄 등록증</span>`  : `<img src="${regdoc.data}"  class="doc-thumb-img" title="자동차등록증" />`) : `<span class="doc-thumb-empty">📄 미첨부</span>`;
      const lic1Thumb = lic1    ? (lic1.type==='application/pdf'    ? `<span class="doc-thumb-pdf">📄 면허1</span>`   : `<img src="${lic1.data}"   class="doc-thumb-img" title="${v.driver1Name||'운전자1'} 면허증" />`) : `<span class="doc-thumb-empty">📄 미첨부</span>`;
      const lic2Thumb = lic2    ? (lic2.type==='application/pdf'    ? `<span class="doc-thumb-pdf">📄 면허2</span>`   : `<img src="${lic2.data}"   class="doc-thumb-img" title="${v.driver2Name||'운전자2'} 면허증" />`) : '';
      const hasAnnual = (annual?.carTax || annual?.insurance || annual?.loanInterest || annual?.repairMonthly);
      const isSelected = v.id === curVehicleId;
      return `
      <div class="vehicle-card card ${isSelected?'vehicle-card-selected':''}" id="vcard-${v.id}"
           onclick="VehicleManager.selectVehicle('${v.id}')" style="cursor:pointer;">
        <div class="vehicle-card-header">
          <div class="vehicle-card-main">
            <span class="vehicle-card-num">${i+1}</span>
            <div>
              <div class="vehicle-card-title">
                <strong>${v.regno}</strong>
                <span class="vehicle-card-model">${v.model}</span>
                ${v.year ? `<span class="vehicle-card-year">${v.year}년식</span>` : ''}
                ${isSelected ? '<span class="badge-selected">선택중</span>' : ''}
              </div>
              <div class="vehicle-card-stats">
                <span>🔢 ${Number(v.odometer).toLocaleString()} km</span>
                ${v.fuelEff ? `<span>⛽ 연비 ${v.fuelEff}km/L</span>` : ''}
                ${v.fuelPrice ? `<span>💴 유가 ${Number(v.fuelPrice).toLocaleString()}원/L</span>` : ''}
                ${v.memo ? `<span>📝 ${v.memo}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="vehicle-card-actions" onclick="event.stopPropagation()">
            <button class="btn btn-delete btn-sm" onclick="VehicleManager.remove('${v.id}')">🗑️ 삭제</button>
          </div>
        </div>
        <div class="vehicle-card-body">
          <div class="vehicle-info-section">
            <div class="vis-label">👤 운전자</div>
            <div class="vis-content">
              <div class="driver-row">
                <span class="driver-badge">주1</span>
                <span>${v.driver1Name || '미등록'}</span>
                ${v.driver1LicenseNo ? `<span class="driver-license-no">${v.driver1LicenseNo}</span>` : ''}
                ${lic1Thumb}
              </div>
              ${(v.driver2Name || lic2) ? `<div class="driver-row">
                <span class="driver-badge driver-badge2">주2</span>
                <span>${v.driver2Name || '미등록'}</span>
                ${v.driver2LicenseNo ? `<span class="driver-license-no">${v.driver2LicenseNo}</span>` : ''}
                ${lic2Thumb}
              </div>` : ''}
            </div>
          </div>
          <div class="vehicle-info-section">
            <div class="vis-label">📄 등록증</div>
            <div class="vis-content">${regThumb}</div>
          </div>
          <div class="vehicle-info-section">
            <div class="vis-label">💰 고정비용 (${curYear}년)</div>
            <div class="vis-content">
              ${hasAnnual ? `<div class="fixed-cost-summary">
                ${annual?.carTax       ? `<span>자동차세 ${Number(annual.carTax).toLocaleString()}원</span>` : ''}
                ${annual?.insurance    ? `<span>보험료 ${Number(annual.insurance).toLocaleString()}원</span>` : ''}
                ${annual?.loanInterest ? `<span>할부이자 ${Number(annual.loanInterest).toLocaleString()}원</span>` : ''}
                ${annual?.repairMonthly? `<span>수선비 월${Number(annual.repairMonthly).toLocaleString()}원</span>` : ''}
              </div>` : `<span style="color:#9ca3af;font-size:12px;">미설정</span>`}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    // 선택된 차량이 없으면 첫 번째 선택
    if (!curVehicleId && list.length) {
      await selectVehicle(list[0].id);
    }
  }

  /* 차량 카드 클릭 → 선택 */
  async function selectVehicle(vehicleId) {
    curVehicleId = vehicleId;
    persistVehicleId(vehicleId);   // ← localStorage에 즉시 저장
    const sel = document.getElementById('vmgr-vehicle-select');
    if (sel) sel.value = vehicleId;
    await loadAllForVehicle(vehicleId);
    // 카드 선택 표시 갱신
    document.querySelectorAll('.vehicle-card').forEach(card => {
      card.classList.toggle('vehicle-card-selected', card.id === `vcard-${vehicleId}`);
    });
    document.querySelectorAll('.badge-selected').forEach(b => b.remove());
    const selCard = document.getElementById(`vcard-${vehicleId}`);
    if (selCard) {
      const titleDiv = selCard.querySelector('.vehicle-card-title');
      if (titleDiv && !titleDiv.querySelector('.badge-selected')) {
        titleDiv.insertAdjacentHTML('beforeend', '<span class="badge-selected">선택중</span>');
      }
    }
    // 기본정보 탭으로 이동
    switchVmgrTab('vmgr-tab-info');
    // 스크롤 맨 위로
    document.getElementById('tab-vehicle')?.scrollTo(0, 0);
  }

  /* 서브탭 전환 헬퍼 */
  function switchVmgrTab(tabId) {
    document.querySelectorAll('#vmgr-subtab-bar .sub-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#tab-vehicle .sub-tab-section').forEach(s => s.classList.remove('active'));
    const btn = document.querySelector(`[data-subtab="${tabId}"]`);
    const sec = document.getElementById(tabId);
    if (btn) btn.classList.add('active');
    if (sec) sec.classList.add('active');
  }

  /* ─────────────────────────────────────────
     차량 삭제
  ───────────────────────────────────────── */
  async function remove(id) {
    const v = await DB.Vehicles.getById(id).catch(() => null); if (!v) return;
    App.confirm(`"${v.regno}" 차량을 삭제하시겠습니까?\n(서류 및 설정도 함께 삭제됩니다)`, async () => {
      App.showLoading('차량 삭제 중...');
      try {
        await DB.Vehicles.delete(id);
        await Promise.all([
          DB.Vehicles.deleteDoc(id, 'regdoc').catch(()=>{}),
          DB.Vehicles.deleteDoc(id, 'license1').catch(()=>{}),
          DB.Vehicles.deleteDoc(id, 'license2').catch(()=>{}),
        ]);
        if (curVehicleId === id) curVehicleId = '';
        App.hideLoading();
        await render();
        await App.refreshVehicleSelects();
        App.toast('차량이 삭제되었습니다.');
        if (typeof Dashboard !== 'undefined') Dashboard.silentUpdate();
      } catch(e) { App.hideLoading(); App.toast('삭제 실패: ' + e.message, 'error'); }
    });
  }

  /* ─────────────────────────────────────────
     새 차량 등록 모드 진입
  ───────────────────────────────────────── */
  function enterNewMode() {
    curVehicleId = '';
    persistVehicleId('');   // 새 등록 모드 → localStorage 초기화
    clearBasicForm();
    clearCostForm();
    clearDocsForm();
    clearSettingsForm();
    const sel = document.getElementById('vmgr-vehicle-select');
    if (sel) sel.value = '';
    const fTitle = document.getElementById('vehicle-form-title');
    if (fTitle) fTitle.textContent = '🚗 새 차량 등록';
    const db = document.getElementById('btn-delete-vehicle');
    if (db) db.style.display = 'none';
    const cc = document.getElementById('vehicle-cards-container');
    if (cc) cc.style.display = 'block';
    updateNavBadge('');   // nav 배지 제거
    switchVmgrTab('vmgr-tab-info');
    document.getElementById('v-regno')?.focus();
  }

  /* ─────────────────────────────────────────
     초기화
  ───────────────────────────────────────── */
  async function init() {
    initCostYearSelect();

    // 새 차량 등록 버튼
    document.getElementById('btn-add-vehicle')?.addEventListener('click', enterNewMode);

    // 기본정보 저장
    document.getElementById('btn-save-vehicle')?.addEventListener('click', saveBasicInfo);

    // 삭제 버튼
    document.getElementById('btn-delete-vehicle')?.addEventListener('click', () => {
      if (curVehicleId) remove(curVehicleId);
    });

    // 고정비용 저장
    document.getElementById('btn-save-cost')?.addEventListener('click', saveCostInfo);

    // 운행설정 저장
    document.getElementById('btn-save-settings')?.addEventListener('click', saveSettingsInfo);

    // 추가정보 저장
    document.getElementById('btn-save-docs')?.addEventListener('click', saveDocsInfo);

    // 서류 파일 바인딩
    bindFileInput('v-regdoc-file',            'v-regdoc-preview',          'v-regdoc-filename',          'v-regdoc-clear', d=>{ tempRegDoc=d; });
    bindFileInput('v-regdoc-camera',          'v-regdoc-preview',          'v-regdoc-filename',          'v-regdoc-clear', d=>{ tempRegDoc=d; });
    bindFileInput('v-driver1-license-file',   'v-driver1-license-preview', 'v-driver1-license-filename', null, d=>{ tempLicense1=d; });
    bindFileInput('v-driver1-license-camera', 'v-driver1-license-preview', 'v-driver1-license-filename', null, d=>{ tempLicense1=d; });
    bindFileInput('v-driver2-license-file',   'v-driver2-license-preview', 'v-driver2-license-filename', null, d=>{ tempLicense2=d; });
    bindFileInput('v-driver2-license-camera', 'v-driver2-license-preview', 'v-driver2-license-filename', null, d=>{ tempLicense2=d; });

    const clearBtn = document.getElementById('v-regdoc-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      clearDoc('v-regdoc-preview','v-regdoc-filename','v-regdoc-clear',
               'v-regdoc-file','v-regdoc-camera', ()=>{ tempRegDoc=null; });
    });

    // 서브탭 버튼 이벤트
    document.querySelectorAll('#vmgr-subtab-bar .sub-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchVmgrTab(btn.dataset.subtab);
      });
    });

    // 차량 선택 셀렉트 초기화
    await initVehicleSelect();

    // 차량 목록 렌더
    await render();

    // 차량이 있으면 자동 로드 + 다른 셀렉트 동기화
    if (curVehicleId) {
      await loadAllForVehicle(curVehicleId);
      const vs   = await DB.Vehicles.getAll().catch(() => []);
      const vObj = vs.find(v => v.id === curVehicleId);
      const label = vObj ? `${vObj.regno} (${vObj.model})` : '';
      syncAllSelects(curVehicleId, label);
    }
  }

  /* ─────────────────────────────────────────
     외부 공개 API (settings.js 호환 포함)
  ───────────────────────────────────────── */

  // settings.js 호환: getClientsForVehicle
  async function getClientsForVehicle(vehicleId) {
    const s   = await DB.Settings.get(vehicleId).catch(() => null);
    const ids = s?.selectedClientIds || [];
    const all = await DB.Clients.getAll().catch(() => []);
    if (!ids.length) return all;
    return all.filter(c => ids.includes(c.id));
  }

  // settings.js 호환: getSettings
  async function getSettings(vehicleId) {
    return await DB.Settings.get(vehicleId).catch(() => null);
  }

  // settings.js 호환: reload
  async function reload() {
    await initVehicleSelect();
    if (curVehicleId) {
      const s = await DB.Settings.get(curVehicleId).catch(() => null);
      loadSettingsForm(s);
      await renderClientCheckboxes(curVehicleId);
    }
    await renderSummary(curVehicleId);
  }

  return {
    init, render, remove, selectVehicle,
    reload, renderSummary, renderClientCheckboxes,
    getClientsForVehicle, getSettings,
    // 호환성
    edit: selectVehicle,
  };
})();

/* ─────────────────────────────────────────
   settings.js 호환 심: SettingsManager → VehicleManager 위임
───────────────────────────────────────── */
const SettingsManager = {
  init:                  async () => {},  // app.js에서 따로 호출 불필요
  reload:                (...a) => VehicleManager.reload(...a),
  renderSummary:         (...a) => VehicleManager.renderSummary(...a),
  getClientsForVehicle:  (...a) => VehicleManager.getClientsForVehicle(...a),
  getSettings:           (...a) => VehicleManager.getSettings(...a),
  renderClientCheckboxes:(...a) => VehicleManager.renderClientCheckboxes(...a),
};
