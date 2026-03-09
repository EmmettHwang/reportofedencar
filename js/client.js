/* =====================================================
   client.js v6 - 거래처 관리 통합 모듈
   3개 서브탭: 기본정보 / 비용 / 거래처 정보(사업자·담당자·서류)
   ===================================================== */
const ClientManager = (() => {
  let curClientId = '';
  let filterCat   = 'all';
  let searchStr   = '';
  let tempBizCert  = null;   // 사업자등록증
  let tempContract = null;   // 계약서
  let tempEtc      = null;   // 기타 서류

  /* ─────────────────────────────────────────
     공통: 거래처 선택 셀렉트 초기화
  ───────────────────────────────────────── */
  async function initClientSelect() {
    const sel = document.getElementById('cmgr-client-select');
    if (!sel) return;
    const list = await DB.Clients.getAll();
    sel.innerHTML = '<option value="">-- 거래처를 선택하세요 --</option>' +
      list.map(c => `<option value="${c.id}">${c.name} (${c.category||'미분류'})</option>`).join('');

    if (curClientId && list.find(c => c.id === curClientId)) {
      sel.value = curClientId;
    } else if (list.length) {
      curClientId = list[0].id;
      sel.value = curClientId;
    } else {
      curClientId = '';
    }

    sel.onchange = async () => {
      curClientId = sel.value;
      await loadAllForClient(curClientId);
    };
  }

  /* 거래처 선택 시 모든 탭 로드 */
  async function loadAllForClient(clientId) {
    const delBtn   = document.getElementById('btn-delete-client');
    const formTitle = document.getElementById('client-form-title');

    if (!clientId) {
      clearAllForms();
      if (delBtn) delBtn.style.display = 'none';
      if (formTitle) formTitle.textContent = '🏢 새 거래처 등록';
      return;
    }

    const c = await DB.Clients.getById(clientId).catch(() => null);
    if (!c) return;

    loadBasicForm(c);
    loadCostForm(c);
    loadInfoForm(c);
    await loadDocsPreview(clientId);

    if (delBtn) delBtn.style.display = 'inline-flex';
    if (formTitle) formTitle.textContent = '🏢 거래처 기본 정보';

    // 카드 컨테이너 숨기기
    const cc = document.getElementById('client-cards-container');
    if (cc) cc.style.display = 'none';
  }

  /* 서브탭 전환 */
  function switchCmgrTab(tabId) {
    document.querySelectorAll('#cmgr-subtab-bar .sub-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#tab-client .sub-tab-section').forEach(s => s.classList.remove('active'));
    const btn = document.querySelector(`[data-subtab="${tabId}"]`);
    const sec = document.getElementById(tabId);
    if (btn) btn.classList.add('active');
    if (sec) sec.classList.add('active');
  }

  /* ─────────────────────────────────────────
     서브탭 1: 기본정보
  ───────────────────────────────────────── */
  function loadBasicForm(c) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('c-name',     c.name);
    set('c-category', c.category || '');
    set('c-distance', c.distance);
    set('c-variance', c.variance ?? 0);
    set('c-visits',   c.visits);
    set('c-memo',     c.memo || '');
  }

  function clearBasicForm() {
    ['c-name','c-category','c-distance','c-memo'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const varEl = document.getElementById('c-variance'); if (varEl) varEl.value = '0';
    const visEl = document.getElementById('c-visits');   if (visEl) visEl.value = '';
  }

  async function saveBasicInfo() {
    const name     = document.getElementById('c-name')?.value.trim();
    const category = document.getElementById('c-category')?.value.trim() || '미분류';
    const distance = parseFloat(document.getElementById('c-distance')?.value);
    const variance = parseFloat(document.getElementById('c-variance')?.value) || 0;
    const visits   = parseInt(document.getElementById('c-visits')?.value);
    const memo     = document.getElementById('c-memo')?.value.trim();

    if (!name)                      { App.toast('거래처명을 입력하세요.', 'error'); return; }
    if (!distance || distance <= 0) { App.toast('왕복거리를 입력하세요.', 'error'); return; }
    if (!visits   || visits   <= 0) { App.toast('월 방문횟수를 입력하세요.', 'error'); return; }
    if (visits > 22)                { App.toast('월 방문횟수는 22회 이하', 'error'); return; }

    // 기존 비용/정보 필드를 유지한 채 기본정보만 업데이트
    let existing = curClientId ? (await DB.Clients.getById(curClientId).catch(() => null)) : null;
    const data = {
      name, category, distance, variance, visits, memo,
      toll:        existing?.toll        ?? 0,
      parking:     existing?.parking     ?? 0,
      bizNo:       existing?.bizNo       ?? '',
      managerName: existing?.managerName ?? '',
      phone:       existing?.phone       ?? '',
      email:       existing?.email       ?? '',
      address:     existing?.address     ?? '',
    };

    App.showLoading(curClientId ? '거래처 수정 중...' : '거래처 등록 중...');
    try {
      if (curClientId) {
        await DB.Clients.update(curClientId, data);
      } else {
        const newC = await DB.Clients.add(data);
        curClientId = newC.id;
      }
      App.hideLoading();
      await render();
      await refreshCmgrSelect();
      await VehicleManager.renderClientCheckboxes(
        document.getElementById('vmgr-vehicle-select')?.value || ''
      );
      if (typeof Dashboard !== 'undefined') Dashboard.silentUpdate();
      App.toast(curClientId ? '거래처 기본정보 수정됨' : '거래처 등록됨', 'success');
    } catch(e) { App.hideLoading(); App.toast('저장 실패: ' + e.message, 'error'); }
  }

  /* ─────────────────────────────────────────
     서브탭 2: 비용
  ───────────────────────────────────────── */
  function loadCostForm(c) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('c-toll',    c.toll    || '');
    set('c-parking', c.parking || '');
  }

  function clearCostForm() {
    ['c-toll','c-parking'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  }

  async function saveCostInfo() {
    if (!curClientId) { App.toast('거래처를 먼저 선택하세요.', 'error'); return; }
    const c = await DB.Clients.getById(curClientId).catch(() => null);
    if (!c) { App.toast('거래처 정보를 찾을 수 없습니다.', 'error'); return; }

    const toll    = parseInt(document.getElementById('c-toll')?.value)    || 0;
    const parking = parseInt(document.getElementById('c-parking')?.value) || 0;

    App.showLoading('비용 정보 저장 중...');
    try {
      await DB.Clients.update(curClientId, { ...c, toll, parking });
      App.hideLoading();
      App.toast('비용 정보가 저장되었습니다.', 'success');
      if (typeof Dashboard !== 'undefined') Dashboard.silentUpdate();
    } catch(e) { App.hideLoading(); App.toast('저장 실패: ' + e.message, 'error'); }
  }

  /* ─────────────────────────────────────────
     서브탭 3: 거래처 정보 (사업자·담당자·서류)
  ───────────────────────────────────────── */
  function loadInfoForm(c) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('c-biz-no',  c.bizNo       || '');
    set('c-manager', c.managerName || '');
    set('c-phone',   c.phone       || '');
    set('c-email',   c.email       || '');
    set('c-address', c.address     || '');
  }

  function clearInfoForm() {
    ['c-biz-no','c-manager','c-phone','c-email','c-address'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }

  async function saveInfoAndDocs() {
    if (!curClientId) { App.toast('거래처를 먼저 선택하세요.', 'error'); return; }
    const c = await DB.Clients.getById(curClientId).catch(() => null);
    if (!c) { App.toast('거래처 정보를 찾을 수 없습니다.', 'error'); return; }

    const bizNo       = document.getElementById('c-biz-no')?.value.trim()  || '';
    const managerName = document.getElementById('c-manager')?.value.trim() || '';
    const phone       = document.getElementById('c-phone')?.value.trim()   || '';
    const email       = document.getElementById('c-email')?.value.trim()   || '';
    const address     = document.getElementById('c-address')?.value.trim() || '';

    App.showLoading('거래처 정보 및 서류 저장 중...');
    try {
      await DB.Clients.update(curClientId, { ...c, bizNo, managerName, phone, email, address });
      if (tempBizCert)  await DB.Clients.saveDoc(curClientId, 'biz_cert',  tempBizCert);
      if (tempContract) await DB.Clients.saveDoc(curClientId, 'contract',  tempContract);
      if (tempEtc)      await DB.Clients.saveDoc(curClientId, 'etc',       tempEtc);
      tempBizCert = tempContract = tempEtc = null;
      App.hideLoading();
      await render();
      App.toast('거래처 정보 및 서류가 저장되었습니다.', 'success');
    } catch(e) { App.hideLoading(); App.toast('저장 실패: ' + e.message, 'error'); }
  }

  /* ─────────────────────────────────────────
     서류 파일 유틸
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

  function bindClearBtn(clearBtnId, previewId, filenameId, fileIds, onClear) {
    const btn = document.getElementById(clearBtnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const preview = document.getElementById(previewId);
      const fname   = document.getElementById(filenameId);
      if (preview) preview.innerHTML = '';
      if (fname)   fname.textContent = '';
      btn.style.display = 'none';
      fileIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      onClear();
    });
  }

  function clearDocsForm() {
    ['c-biz-cert-preview','c-contract-preview','c-etc-preview'].forEach(id => {
      const el = document.getElementById(id); if (el) el.innerHTML = '';
    });
    ['c-biz-cert-filename','c-contract-filename','c-etc-filename'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '';
    });
    ['c-biz-cert-clear','c-contract-clear','c-etc-clear'].forEach(id => {
      const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    ['c-biz-cert-file','c-biz-cert-camera','c-contract-file','c-contract-camera',
     'c-etc-file','c-etc-camera'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    tempBizCert = tempContract = tempEtc = null;
  }

  async function loadDocsPreview(clientId) {
    const restore = async (docType, previewId, filenameId, clearBtnId) => {
      const doc = await DB.Clients.getDoc(clientId, docType).catch(() => null);
      if (!doc) return;
      const preview = document.getElementById(previewId);
      if (preview) preview.innerHTML = doc.type?.startsWith('image/')
        ? `<img src="${doc.data}" class="doc-preview-img" />`
        : `<div class="doc-preview-pdf">📄 ${doc.name}</div>`;
      const fname = document.getElementById(filenameId);
      if (fname) fname.textContent = doc.name || '';
      const cb = document.getElementById(clearBtnId);
      if (cb) cb.style.display = 'inline-block';
    };
    tempBizCert = tempContract = tempEtc = null;
    await Promise.all([
      restore('biz_cert', 'c-biz-cert-preview', 'c-biz-cert-filename', 'c-biz-cert-clear'),
      restore('contract', 'c-contract-preview',  'c-contract-filename',  'c-contract-clear'),
      restore('etc',      'c-etc-preview',        'c-etc-filename',        'c-etc-clear'),
    ]);
  }

  /* ─────────────────────────────────────────
     전체 폼 초기화
  ───────────────────────────────────────── */
  function clearAllForms() {
    clearBasicForm();
    clearCostForm();
    clearInfoForm();
    clearDocsForm();
  }

  /* ─────────────────────────────────────────
     거래처 목록 카드 렌더
  ───────────────────────────────────────── */
  async function render() {
    let list = await DB.Clients.getAll();
    await initClientSelect();
    await updateCategoryDatalist();

    const container = document.getElementById('client-cards-container');
    if (!container) return;

    if (!list.length) {
      container.style.display = 'block';
      container.innerHTML = '<div class="empty-row" style="text-align:center;padding:30px;color:#9ca3af;">등록된 거래처가 없습니다.<br><small>기본정보를 입력하고 저장하세요.</small></div>';
      const fTitle = document.getElementById('client-form-title');
      if (fTitle) fTitle.textContent = '🏢 새 거래처 등록';
      const db = document.getElementById('btn-delete-client');
      if (db) db.style.display = 'none';
      return;
    }

    // 필터 적용
    let filtered = list;
    if (filterCat !== 'all') filtered = filtered.filter(c => (c.category||'미분류') === filterCat);
    if (searchStr) {
      const q = searchStr.toLowerCase();
      filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || (c.category||'').toLowerCase().includes(q));
    }

    const cats = ['전체', ...new Set(list.map(c => c.category||'미분류'))];

    container.style.display = 'block';
    container.innerHTML = `
      <div class="vmgr-card-list-header">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <h4 style="margin:0;color:#374151;">📋 거래처 목록 (${list.length}곳)</h4>
          <div class="client-cat-filter-bar">
            ${cats.map(cat => {
              const val = cat === '전체' ? 'all' : cat;
              return `<button class="cat-filter-btn ${filterCat===val?'active':''}"
                onclick="ClientManager.setFilter('${val}')">${cat}</button>`;
            }).join('')}
          </div>
          <input type="text" id="client-search-inline" placeholder="🔍 검색"
            value="${searchStr}"
            style="padding:5px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;width:150px;" />
        </div>
        <small class="hint">클릭하여 선택하면 수정할 수 있습니다.</small>
      </div>` +
    filtered.map((c, i) => {
      const isSelected = c.id === curClientId;
      const hasInfo = c.bizNo || c.managerName || c.phone;
      return `
      <div class="client-card card ${isSelected?'vehicle-card-selected':''}"
           id="ccard-${c.id}" onclick="ClientManager.selectClient('${c.id}')" style="cursor:pointer;">
        <div class="client-card-header">
          <div class="client-card-main">
            <span class="vehicle-card-num">${i+1}</span>
            <div>
              <div class="vehicle-card-title">
                <span class="cat-badge">${c.category||'미분류'}</span>
                <strong>${c.name}</strong>
                ${isSelected ? '<span class="badge-selected">선택중</span>' : ''}
              </div>
              <div class="vehicle-card-stats">
                <span>🚗 ${c.distance}km ±${c.variance||0}km</span>
                <span>📅 월 ${c.visits}회</span>
                ${c.toll    ? `<span>🛣️ 통행료 ${Number(c.toll).toLocaleString()}원</span>` : ''}
                ${c.parking ? `<span>🅿️ 주차비 ${Number(c.parking).toLocaleString()}원</span>` : ''}
                ${c.memo    ? `<span>📝 ${c.memo}</span>` : ''}
              </div>
              ${hasInfo ? `<div class="vehicle-card-stats" style="margin-top:3px;">
                ${c.bizNo       ? `<span>🏢 ${c.bizNo}</span>` : ''}
                ${c.managerName ? `<span>👤 ${c.managerName}</span>` : ''}
                ${c.phone       ? `<span>📞 ${c.phone}</span>` : ''}
                ${c.email       ? `<span>✉️ ${c.email}</span>` : ''}
              </div>` : ''}
            </div>
          </div>
          <div class="vehicle-card-actions" onclick="event.stopPropagation()">
            <button class="btn btn-delete btn-sm" onclick="ClientManager.remove('${c.id}')">🗑️ 삭제</button>
          </div>
        </div>
      </div>`;
    }).join('');

    // 인라인 검색 바인딩
    const inlineSearch = document.getElementById('client-search-inline');
    if (inlineSearch) {
      inlineSearch.addEventListener('input', e => { searchStr = e.target.value.trim(); render(); });
    }
  }

  /* 거래처 카드 클릭 → 선택 */
  async function selectClient(clientId) {
    curClientId = clientId;
    const sel = document.getElementById('cmgr-client-select');
    if (sel) sel.value = clientId;
    await loadAllForClient(clientId);
    // 카드 선택 갱신
    document.querySelectorAll('.client-card').forEach(card => {
      card.classList.toggle('vehicle-card-selected', card.id === `ccard-${clientId}`);
    });
    // 뱃지 갱신
    document.querySelectorAll('#client-cards-container .badge-selected').forEach(b => b.remove());
    const selCard = document.getElementById(`ccard-${clientId}`);
    if (selCard) {
      const titleDiv = selCard.querySelector('.vehicle-card-title');
      if (titleDiv && !titleDiv.querySelector('.badge-selected')) {
        titleDiv.insertAdjacentHTML('beforeend', '<span class="badge-selected">선택중</span>');
      }
    }
    switchCmgrTab('cmgr-tab-basic');
    document.getElementById('tab-client')?.scrollTo(0, 0);
  }

  /* 새 거래처 등록 모드 */
  function enterNewMode() {
    curClientId = '';
    clearAllForms();
    const sel = document.getElementById('cmgr-client-select');
    if (sel) sel.value = '';
    const fTitle = document.getElementById('client-form-title');
    if (fTitle) fTitle.textContent = '🏢 새 거래처 등록';
    const db = document.getElementById('btn-delete-client');
    if (db) db.style.display = 'none';
    const cc = document.getElementById('client-cards-container');
    if (cc) cc.style.display = 'block';
    switchCmgrTab('cmgr-tab-basic');
    document.getElementById('c-name')?.focus();
  }

  /* 셀렉트 갱신 */
  async function refreshCmgrSelect() {
    await initClientSelect();
  }

  /* ─────────────────────────────────────────
     거래처 삭제
  ───────────────────────────────────────── */
  async function remove(id) {
    const c = await DB.Clients.getById(id).catch(() => null); if (!c) return;
    App.confirm(`"${c.name}" 거래처를 삭제하시겠습니까?\n(서류도 함께 삭제됩니다)`, async () => {
      App.showLoading('거래처 삭제 중...');
      try {
        await DB.Clients.delete(id);
        if (curClientId === id) curClientId = '';
        App.hideLoading();
        await render();
        await VehicleManager.renderClientCheckboxes(
          document.getElementById('vmgr-vehicle-select')?.value || ''
        );
        App.toast('거래처가 삭제되었습니다.');
        if (typeof Dashboard !== 'undefined') Dashboard.silentUpdate();
      } catch(e) { App.hideLoading(); App.toast('삭제 실패: ' + e.message, 'error'); }
    });
  }

  /* ─────────────────────────────────────────
     카테고리 datalist
  ───────────────────────────────────────── */
  async function updateCategoryDatalist() {
    const dl = document.getElementById('category-list');
    if (!dl) return;
    const list = await DB.Clients.getAll().catch(() => []);
    const cats = [...new Set(list.map(c => c.category).filter(Boolean))];
    dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');
  }

  /* ─────────────────────────────────────────
     초기화
  ───────────────────────────────────────── */
  async function init() {
    // 새 거래처 등록 버튼
    document.getElementById('btn-add-client')?.addEventListener('click', enterNewMode);

    // 기본정보 저장
    document.getElementById('btn-save-client-basic')?.addEventListener('click', saveBasicInfo);

    // 비용 저장
    document.getElementById('btn-save-client-cost')?.addEventListener('click', saveCostInfo);

    // 거래처정보 + 서류 저장
    document.getElementById('btn-save-client-info')?.addEventListener('click', saveInfoAndDocs);

    // 삭제 버튼
    document.getElementById('btn-delete-client')?.addEventListener('click', () => {
      if (curClientId) remove(curClientId);
    });

    // 서브탭 버튼 이벤트
    document.querySelectorAll('#cmgr-subtab-bar .sub-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchCmgrTab(btn.dataset.subtab));
    });

    // 서류 파일 바인딩 (사업자등록증)
    bindFileInput('c-biz-cert-file',   'c-biz-cert-preview', 'c-biz-cert-filename', 'c-biz-cert-clear', d => { tempBizCert = d; });
    bindFileInput('c-biz-cert-camera', 'c-biz-cert-preview', 'c-biz-cert-filename', 'c-biz-cert-clear', d => { tempBizCert = d; });
    bindClearBtn('c-biz-cert-clear', 'c-biz-cert-preview', 'c-biz-cert-filename',
      ['c-biz-cert-file','c-biz-cert-camera'], () => { tempBizCert = null; });

    // 계약서
    bindFileInput('c-contract-file',   'c-contract-preview', 'c-contract-filename', 'c-contract-clear', d => { tempContract = d; });
    bindFileInput('c-contract-camera', 'c-contract-preview', 'c-contract-filename', 'c-contract-clear', d => { tempContract = d; });
    bindClearBtn('c-contract-clear', 'c-contract-preview', 'c-contract-filename',
      ['c-contract-file','c-contract-camera'], () => { tempContract = null; });

    // 기타
    bindFileInput('c-etc-file',   'c-etc-preview', 'c-etc-filename', 'c-etc-clear', d => { tempEtc = d; });
    bindFileInput('c-etc-camera', 'c-etc-preview', 'c-etc-filename', 'c-etc-clear', d => { tempEtc = d; });
    bindClearBtn('c-etc-clear', 'c-etc-preview', 'c-etc-filename',
      ['c-etc-file','c-etc-camera'], () => { tempEtc = null; });

    // 거래처 선택 셀렉트 초기화
    await initClientSelect();

    // 목록 렌더
    await render();

    // 차량이 있으면 첫 번째 자동 선택
    if (curClientId) {
      await loadAllForClient(curClientId);
    }
  }

  /* ─────────────────────────────────────────
     외부 공개 (기존 호환 포함)
  ───────────────────────────────────────── */
  function setFilter(cat) { filterCat = cat; render(); }

  return { init, render, remove, selectClient, setFilter,
    // 기존 client.js edit 호환
    edit: selectClient,
  };
})();
