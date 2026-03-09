/* =====================================================
   logbook.js - 월별 운행일지 자동생성 & 편집 v3
   (MariaDB API 비동기 기반)
   ===================================================== */

const LogbookManager = (() => {
  const DAY_KO = ['일','월','화','수','목','금','토'];
  let currentRows = [];
  let currentMeta = {};

  /* ---- 시드 기반 난수 ---- */
  function seededRand(seed) {
    let s = seed >>> 0;
    return function() {
      s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
      s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
      s ^= s >>> 16;
      return (s >>> 0) / 0xFFFFFFFF;
    };
  }
  function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  /* ---- 근무일 목록 (법정공휴일 포함) ---- */
  function getWorkDays(year, month, includeSat) {
    const total = new Date(year, month, 0).getDate();
    const days  = [];
    for (let d = 1; d <= total; d++) {
      if (!Holidays.isNonWorkday(year, month, d, includeSat)) {
        days.push({ date: d, dow: new Date(year, month-1, d).getDay() });
      }
    }
    return days;
  }

  /* ---- 주차별 그룹화 ---- */
  function groupByWeek(workDays) {
    const weeks = [];
    let week = [];
    workDays.forEach(d => {
      week.push(d);
      if (d.dow === 5 || d.dow === 6) { weeks.push([...week]); week = []; }
    });
    if (week.length) weeks.push(week);
    return weeks;
  }

  /* =====================================================
     핵심: 단일 월 생성 (clients 배열을 파라미터로 받음)
     ===================================================== */
  function generateMonth(vehicleId, year, month, startOdo, settings, clients, seedOffset=0, remainKm=null) {
    const includeSat    = settings.includeSat    || false;
    const commuteDpW    = settings.commuteDaysPerWeek || 2;
    const commuteDist   = settings.commuteDist   || 22;
    const commuteVar    = settings.commuteVariance || 0;
    const commuteSpread = settings.commuteSpread || 'random';

    const vidHash = vehicleId.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
    const seed    = settings.fixSeed
      ? (year * 100 + month) * 997 + vidHash + seedOffset
      : (Date.now() + seedOffset) >>> 0;
    const rng = seededRand(seed);

    const workDays = getWorkDays(year, month, includeSat);

    /* 출퇴근 날짜 배치 */
    const weeks = groupByWeek(workDays);
    const commuteDates = new Set();
    weeks.forEach(week => {
      let pool = [...week];
      if (commuteSpread === 'early') {
        let p2 = week.filter(d=>d.dow>=1&&d.dow<=2);
        if (p2.length < commuteDpW) p2 = week.filter(d=>d.dow>=1&&d.dow<=3);
        if (p2.length >= 1) pool = p2;
      } else if (commuteSpread === 'late') {
        let p2 = week.filter(d=>d.dow>=4&&d.dow<=5);
        if (p2.length < commuteDpW) p2 = week.filter(d=>d.dow>=3&&d.dow<=5);
        if (p2.length >= 1) pool = p2;
      }
      for (let i=pool.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
      pool.slice(0, Math.min(commuteDpW, pool.length)).forEach(d=>commuteDates.add(d.date));
    });

    /* 거래처 방문 배치 */
    const bizMap = {};
    if (clients && clients.length) {
      const avail = [...workDays.map(d=>d.date)];
      for (let i=avail.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[avail[i],avail[j]]=[avail[j],avail[i]];}
      let slotIdx = 0;
      clients.forEach(client => {
        const cnt = Math.min(client.visits||1, avail.length - slotIdx);
        for (let i=0;i<cnt;i++) { if (slotIdx<avail.length) { bizMap[avail[slotIdx]]=client.id; slotIdx++; } }
      });
    }

    /* 전체 달력 행 생성 */
    const totalDays = new Date(year, month, 0).getDate();
    const rows = [];
    let odo = startOdo;

    const clientMap = {};
    (clients||[]).forEach(c => { clientMap[c.id] = c; });

    for (let d=1; d<=totalDays; d++) {
      const dow       = new Date(year, month-1, d).getDay();
      const isNonWork = Holidays.isNonWorkday(year, month, d, includeSat);
      const isRed     = Holidays.isRedDay(year, month, d);
      const isSat     = (dow === 6);
      const holName   = Holidays.getHolidayName(year, month, d);

      let driven=0, commute=0, biz=0, memo='', rowType='none';

      if (!isNonWork) {
        const isComm   = commuteDates.has(d);
        const clientId = bizMap[d];
        if (isComm) {
          const v_ = commuteVar>0 ? randInt(rng,-commuteVar,commuteVar) : 0;
          commute = Math.max(1, Math.round(commuteDist + v_));
          driven  = commute;
          rowType = 'commute';
        } else if (clientId) {
          const c = clientMap[clientId];
          if (c) {
            const v_ = c.variance>0 ? randInt(rng,-c.variance,c.variance) : 0;
            biz    = Math.max(1, Math.round(c.distance + v_));
            driven = biz;
            memo   = c.name;
            rowType= 'biz';
          }
        }
      }

      /* 연간 목표거리 초과 방지 */
      if (remainKm !== null && driven > 0) {
        const cumSoFar = odo - startOdo + driven;
        if (cumSoFar > remainKm) {
          driven  = Math.max(0, remainKm - (odo - startOdo));
          commute = (rowType==='commute') ? driven : 0;
          biz     = (rowType==='biz')     ? driven : 0;
          if (driven <= 0) { driven=0; commute=0; biz=0; rowType='none'; memo=''; }
        }
      }

      const before = odo;
      const after  = odo + driven;
      odo = after;

      rows.push({ date:d, dow, before, after, driven, commute, biz, memo, rowType,
                  isNonWork, isRed, isSat, holName });
    }
    return rows;
  }

  /* 1~12월 일괄 생성 */
  function generateYear(vehicleId, year, startOdo, settings, clients) {
    const annualKm  = settings.annualKm || 0;
    const allMonths = {};
    let odo = startOdo;
    let usedKm = 0;
    for (let m=1; m<=12; m++) {
      const remainKm = annualKm > 0 ? Math.max(0, annualKm - usedKm) : null;
      const rows = generateMonth(vehicleId, year, m, odo, settings, clients, m, remainKm);
      allMonths[m] = rows;
      const monthDriven = rows.reduce((s,r)=>s+(r.driven||0),0);
      usedKm += monthDriven;
      odo = rows[rows.length-1]?.after ?? odo;
    }
    return allMonths;
  }

  /* ---- 합계 ---- */
  function calcSummary(rows) {
    return {
      totalDriven:  rows.reduce((s,r)=>s+(r.driven||0), 0),
      totalCommute: rows.reduce((s,r)=>s+(r.commute||0), 0),
      totalBiz:     rows.reduce((s,r)=>s+(r.biz||0), 0),
      startOdo:     rows[0]?.before ?? 0,
      endOdo:       rows[rows.length-1]?.after ?? 0,
    };
  }

  /* ---- 화면 테이블 렌더 ---- */
  function renderTable(rows, year, month) {
    const tbody = document.getElementById('logbook-tbody');
    const tfoot = document.getElementById('logbook-tfoot');
    if (!tbody) return;

    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-row">데이터가 없습니다.</td></tr>';
      if (tfoot) tfoot.innerHTML = '';
      return;
    }

    const sum = calcSummary(rows);

    tbody.innerHTML = rows.map((r, idx) => {
      const dayLabel = `${month}/${r.date}`;
      const dowLabel = DAY_KO[r.dow];
      let rowClass = '';
      if (r.isRed)   rowClass = 'day-red';
      else if (r.isSat) rowClass = 'day-sat';
      else if (r.rowType==='biz')     rowClass = 'row-biz';
      else if (r.rowType==='commute') rowClass = 'row-commute';
      const dateStyle = r.isRed ? 'style="color:#dc2626;font-weight:700;"'
                      : r.isSat ? 'style="color:#2563ea;font-weight:700;"' : '';
      const editTxt = (val, field) =>
        `<input type="text" value="${val||''}" maxlength="20"
          data-idx="${idx}" data-field="${field}"
          onchange="LogbookManager.onCellChange(this)"
          ${r.isNonWork ? 'disabled' : ''} />`;
      const memoVal = r.holName || r.memo || '';
      return `<tr class="${rowClass}">
        <td ${dateStyle}>${dayLabel}</td>
        <td ${dateStyle}>${dowLabel}</td>
        <td>${r.isNonWork ? '' : r.before.toLocaleString()}</td>
        <td>${r.isNonWork ? '' : r.after.toLocaleString()}</td>
        <td>${r.isNonWork ? '' : (r.driven||'0')}</td>
        <td>${r.isNonWork ? '' : (r.commute||'0')}</td>
        <td>${r.isNonWork ? '' : (r.biz||'0')}</td>
        <td>${r.isNonWork
              ? `<span class="holiday-label">${r.isRed&&r.holName?r.holName:(r.isRed?'일요일':r.isSat?'토요일':'')}</span>`
              : editTxt(memoVal,'memo')}</td>
      </tr>`;
    }).join('');

    if (tfoot) tfoot.innerHTML = `
      <tr class="sum-row">
        <td colspan="2">합 계</td><td></td><td></td>
        <td class="sum-driven">${sum.totalDriven.toLocaleString()}</td>
        <td class="sum-commute">${sum.totalCommute.toLocaleString()}</td>
        <td class="sum-biz">${sum.totalBiz.toLocaleString()}</td>
        <td></td>
      </tr>`;
  }

  /* ---- 셀 변경 ---- */
  function onCellChange(input) {
    const idx   = parseInt(input.dataset.idx);
    const field = input.dataset.field;
    const row   = currentRows[idx];
    if (!row) return;
    if (field === 'memo') { row.memo = input.value; return; }
    row[field] = Number(input.value) || 0;
    if (field==='commute'||field==='biz') {
      row.driven = (row.commute||0) + (row.biz||0);
      row.after  = row.before + row.driven;
      for (let i=idx+1;i<currentRows.length;i++){
        currentRows[i].before = currentRows[i-1].after;
        currentRows[i].after  = currentRows[i].before + (currentRows[i].driven||0);
      }
      renderTable(currentRows, currentMeta.year, currentMeta.month);
    }
  }

  /* ---- 년도 셀렉트 초기화 ---- */
  function initYearSelects() {
    const now = new Date();
    [document.getElementById('lb-year'),
     document.getElementById('lb-bulk-year')].forEach(sel => {
      if (!sel) return;
      sel.innerHTML = '';
      for (let y=now.getFullYear()-1; y<=now.getFullYear()+2; y++) {
        const o=document.createElement('option');
        o.value=y; o.textContent=`${y}년`;
        if (y===now.getFullYear()) o.selected=true;
        sel.appendChild(o);
      }
    });
    const mSel = document.getElementById('lb-month');
    if (mSel) mSel.value = now.getMonth()+1;
  }

  /* ---- 초기화 ---- */
  function init() {
    initYearSelects();

    // 차량 변경 시 odo 자동 (비동기)
    ['lb-vehicle-select','lb-bulk-vehicle'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', async () => {
        const v = await DB.Vehicles.getById(el.value);
        if (!v) return;
        if (id==='lb-vehicle-select') document.getElementById('lb-start-odo').value = v.odometer;
        if (id==='lb-bulk-vehicle')   document.getElementById('lb-bulk-odo').value  = v.odometer;
      });
    });

    document.getElementById('btn-generate-log').addEventListener('click', generateSingle);
    document.getElementById('btn-clear-log').addEventListener('click', () => {
      if (!currentRows.length) return;
      App.confirm('현재 일지를 초기화하시겠습니까?', () => {
        currentRows=[]; currentMeta={};
        renderTable([]);
        document.getElementById('logbook-save-area').style.display='none';
        document.getElementById('generate-info').style.display='none';
        App.toast('초기화되었습니다.');
      });
    });
    document.getElementById('btn-save-log').addEventListener('click', saveSingle);
    document.getElementById('btn-bulk-generate').addEventListener('click', generateBulk);
  }

  /* ---- 단월 생성 (비동기) ---- */
  async function generateSingle() {
    const vehicleId = document.getElementById('lb-vehicle-select').value;
    const year      = parseInt(document.getElementById('lb-year').value);
    const month     = parseInt(document.getElementById('lb-month').value);
    const startOdo  = parseInt(document.getElementById('lb-start-odo').value);

    if (!vehicleId) { App.toast('차량을 선택해주세요.','error'); return; }
    if (!startOdo)  { App.toast('시작 누적거리를 입력해주세요.','error'); return; }

    // 설정 기반 거래처 필터 적용 (선택된 거래처만)
    let clients = [];
    try {
      if (typeof SettingsManager !== 'undefined') {
        clients = await SettingsManager.getClientsForVehicle(vehicleId);
      } else {
        clients = await DB.Clients.getAll();
      }
    } catch{}
    if (!clients.length) App.toast('⚠️ 운행설정에서 거래처를 선택해야 업무용 운행이 생성됩니다.','warning');

    // 이전 달 이월
    let actualOdo = startOdo;
    if (month > 1) {
      try {
        const prev = await DB.Logs.get(vehicleId, year, month-1);
        if (prev && prev.rows) {
          const lastAfter = prev.rows[prev.rows.length-1]?.after;
          if (lastAfter) { actualOdo = lastAfter; document.getElementById('lb-start-odo').value=lastAfter; }
        }
      } catch{}
    }

    // 차량별 실제 설정값 로드 (annualKm 기본값을 충분히 크게 설정)
    let settings = { commuteDist:22, commuteDaysPerWeek:2, commuteVariance:2, annualKm:30000, fixSeed:true, commuteSpread:'random', includeSat:false };
    try {
      const saved = await DB.Settings.get(vehicleId);
      if (saved) settings = { ...settings, ...saved };
    } catch{}

    /* 단월 생성 시 연간 목표거리 초과 방지: 이미 저장된 월 합산 */
    let usedKmBeforeThisMonth = 0;
    if (settings.annualKm > 0) {
      try {
        for (let m2=1; m2<month; m2++) {
          const prev2 = await DB.Logs.get(vehicleId, year, m2);
          if (prev2?.rows) usedKmBeforeThisMonth += prev2.rows.reduce((s,r)=>s+(r.driven||0),0);
        }
      } catch{}
    }
    const remainKm = settings.annualKm > 0
      ? Math.max(0, settings.annualKm - usedKmBeforeThisMonth)
      : null;

    currentRows = generateMonth(vehicleId, year, month, actualOdo, settings, clients, 0, remainKm);
    currentMeta = { vehicleId, year, month };

    renderTable(currentRows, year, month);
    document.getElementById('logbook-save-area').style.display='flex';

    const sum = calcSummary(currentRows);
    const workDays = currentRows.filter(r=>!r.isNonWork&&r.driven>0).length;
    document.getElementById('generate-info-text').textContent =
      `✅ ${year}년 ${month}월 | 운행일수:${workDays}일 | 총:${sum.totalDriven}km (출퇴근:${sum.totalCommute}km + 업무용:${sum.totalBiz}km)`;
    document.getElementById('generate-info').style.display='block';
    App.toast(`${year}년 ${month}월 일지 생성 완료!`,'success');
  }

  /* ---- 단월 저장 (비동기) ---- */
  async function saveSingle() {
    if (!currentRows.length) { App.toast('저장할 데이터가 없습니다.','error'); return; }
    const { vehicleId, year, month } = currentMeta;
    App.showLoading(`${year}년 ${month}월 일지 저장 중...`);
    try {
      const v = await DB.Vehicles.getById(vehicleId);
      await DB.Logs.save(vehicleId, year, month, currentRows, { regno:v?.regno||'', model:v?.model||'' });
      App.hideLoading();
      App.toast(`${year}년 ${month}월 일지가 저장되었습니다.`,'success');
      await ExportManager.renderSavedList();
      if (typeof Dashboard !== 'undefined') Dashboard.silentUpdate();
    } catch(e) { App.hideLoading(); App.toast('저장 실패: ' + e.message, 'error'); }
  }

  /* ---- 연간 일괄 생성 (비동기) ---- */
  async function generateBulk() {
    const vehicleId = document.getElementById('lb-bulk-vehicle').value;
    const year      = parseInt(document.getElementById('lb-bulk-year').value);
    const startOdo  = parseInt(document.getElementById('lb-bulk-odo').value);

    if (!vehicleId) { App.toast('차량을 선택해주세요.','error'); return; }
    if (!startOdo)  { App.toast('1월 시작 누적거리를 입력해주세요.','error'); return; }

    // 설정 기반 거래처 필터 적용 (선택된 거래처만)
    let clients = [];
    try {
      if (typeof SettingsManager !== 'undefined') {
        clients = await SettingsManager.getClientsForVehicle(vehicleId);
      } else {
        clients = await DB.Clients.getAll();
      }
    } catch{}
    if (!clients.length) {
      // 거래처 선택 없음 → 출퇴근만 생성 (업무용 0)으로 계속 진행
      App.alert('⚠️ 운행 설정에서 거래처가 선택되지 않았습니다.<br>업무용 운행 없이 <strong>출퇴근만</strong> 생성됩니다.<br><br>업무용 운행을 포함하려면:<br>① 거래처 관리 탭에서 거래처 등록<br>② 차량 관리 탭 → 운행설정 서브탭에서 거래처 체크 후 저장');
      // 경고 후에도 생성은 계속 진행
    }

    // 차량별 실제 설정값 로드 (annualKm 기본값을 충분히 크게 설정)
    let settings = { commuteDist:22, commuteDaysPerWeek:2, commuteVariance:2, annualKm:30000, fixSeed:true, commuteSpread:'random', includeSat:false };
    try {
      const saved = await DB.Settings.get(vehicleId);
      if (saved) settings = { ...settings, ...saved };
    } catch{}

    let v = null;
    try { v = await DB.Vehicles.getById(vehicleId); } catch{}

    App.showLoading(`${year}년 연간 일지 생성 중...`, {progress:true, sub:'운행 데이터 생성 중...'});
    App.updateProgress(5, '운행 데이터 생성 중...');
    await new Promise(r=>setTimeout(r,30));

    const allMonths = generateYear(vehicleId, year, startOdo, settings, clients);

    // 월별 순차 저장 (각 월마다 프로그레스 업데이트)
    try {
      for (let m=1; m<=12; m++) {
        const pct = Math.round(10 + (m / 12) * 70);
        App.updateProgress(pct, `${m}월 저장 중... (${m}/12)`);
        await DB.Logs.save(vehicleId, year, m, allMonths[m], { regno:v?.regno||'', model:v?.model||'' });
        await new Promise(r=>setTimeout(r,20));
      }
    } catch(e) {
      App.hideLoading();
      App.toast('일부 저장 실패: ' + e.message, 'error');
      return;
    }

    App.updateProgress(88, '결과 정리 중...');
    await new Promise(r=>setTimeout(r,30));

    // 결과 표시
    let grandDriven=0, grandCommute=0, grandBiz=0;
    const monthNames=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    let prevBodyHTML = '';
    for (let m=1;m<=12;m++) {
      const sum=calcSummary(allMonths[m]);
      grandDriven  +=sum.totalDriven;
      grandCommute +=sum.totalCommute;
      grandBiz     +=sum.totalBiz;
      const ratio = sum.totalDriven>0?(sum.totalBiz/sum.totalDriven*100).toFixed(1):'0.0';
      const rColor = parseFloat(ratio)>=60?'#15803d':parseFloat(ratio)>=40?'#d97706':'#dc2626';
      prevBodyHTML += `<tr>
        <td><strong>${monthNames[m]}</strong></td>
        <td>${(allMonths[m][0]?.before??0).toLocaleString()}</td>
        <td>${(allMonths[m][allMonths[m].length-1]?.after??0).toLocaleString()}</td>
        <td>${sum.totalDriven.toLocaleString()}</td>
        <td>${sum.totalCommute.toLocaleString()}</td>
        <td>${sum.totalBiz.toLocaleString()}</td>
        <td><strong style="color:${rColor}">${ratio}%</strong></td>
      </tr>`;
    }
    const grandRatio = grandDriven>0?(grandBiz/grandDriven*100).toFixed(1):'0.0';
    document.getElementById('bulk-preview-tbody').innerHTML = prevBodyHTML;
    document.getElementById('bulk-preview-tfoot').innerHTML = `
      <tr style="background:#fff9c4;font-weight:700;">
        <td>합 계</td><td></td><td></td>
        <td style="color:#1a4fa0">${grandDriven.toLocaleString()}</td>
        <td style="color:#15803d">${grandCommute.toLocaleString()}</td>
        <td style="color:#92400e">${grandBiz.toLocaleString()}</td>
        <td style="color:${parseFloat(grandRatio)>=60?'#15803d':'#d97706'}">${grandRatio}%</td>
      </tr>`;
    document.getElementById('bulk-preview').style.display='block';
    document.getElementById('bulk-result').style.display='block';
    document.getElementById('bulk-result-text').textContent =
      `✅ ${year}년 1~12월 생성 완료! 연간 총 주행: ${grandDriven.toLocaleString()}km | 업무비율: ${grandRatio}%`;

    App.updateProgress(98, '목록 갱신 중...');
    await ExportManager.renderSavedList();
    App.updateProgress(100, '완료!');
    await new Promise(r=>setTimeout(r,350));

    App.hideLoading();
    App.toast(`${year}년 12개월 일지 생성 & 저장 완료!`,'success');
    if (typeof Dashboard !== 'undefined') Dashboard.silentUpdate();
  }

  /* ---- 외부 호출용 (비동기) ---- */
  async function loadLog(vehicleId, year, month) {
    try {
      const data = await DB.Logs.get(vehicleId, year, month);
      if (!data) { App.toast('저장된 일지가 없습니다.','error'); return; }
      currentRows = data.rows;
      currentMeta = { vehicleId, year, month };
      App.switchTab('tab-logbook');
      document.getElementById('lb-vehicle-select').value = vehicleId;
      const lbYear = document.getElementById('lb-year');
      if (![...lbYear.options].find(o=>parseInt(o.value)===year)) {
        const o=document.createElement('option'); o.value=year; o.textContent=`${year}년`; lbYear.appendChild(o);
      }
      lbYear.value = year;
      document.getElementById('lb-month').value = month;
      renderTable(currentRows, year, month);
      document.getElementById('logbook-save-area').style.display='flex';
      App.toast(`${year}년 ${month}월 일지 불러옴`,'success');
    } catch(e) { App.toast('일지 로드 실패: ' + e.message, 'error'); }
  }

  function getCurrentRows() { return currentRows; }
  function getCurrentMeta() { return currentMeta; }
  function getCalcSummary(rows) { return calcSummary(rows); }

  return { init, generateSingle, generateBulk, saveSingle, loadLog, onCellChange,
           getCurrentRows, getCurrentMeta, getCalcSummary, generateMonth, generateYear, calcSummary };
})();
