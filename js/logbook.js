/* =====================================================
   logbook.js - 월별 운행일지 자동생성 & 편집
   ===================================================== */

const LogbookManager = (() => {
  const DAY_KO = ['일','월','화','수','목','금','토'];
  let currentRows = [];   // 현재 편집 중인 행
  let currentMeta = {};

  // ---- 시드 기반 난수 (재현 가능) ----
  function seededRand(seed) {
    let s = seed;
    return function() {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  }

  // ---- 분산 난수: min~max 균등 ----
  function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  // ---- 날짜 목록 생성 ----
  function getDaysInMonth(year, month, includeSat) {
    const days = [];
    const total = new Date(year, month, 0).getDate();
    for (let d = 1; d <= total; d++) {
      const dow = new Date(year, month - 1, d).getDay(); // 0=일,6=토
      if (dow === 0) continue;                            // 일요일 제외
      if (!includeSat && dow === 6) continue;            // 토요일 (설정에 따라)
      days.push({ date: d, dow });
    }
    return days;
  }

  // ---- 주차별 날짜 그룹화 ----
  function groupByWeek(days, year, month) {
    const weeks = [];
    let week = [];
    days.forEach(d => {
      week.push(d);
      // 금요일(5) 또는 토요일(6)이면 주차 종료
      if (d.dow === 5 || d.dow === 6) {
        weeks.push([...week]);
        week = [];
      }
    });
    if (week.length) weeks.push(week);
    return weeks;
  }

  // ---- 운행일지 자동 생성 핵심 로직 ----
  function generateRows(vehicleId, year, month, startOdo, settings) {
    const clients  = DB.Clients.getAll();
    const includeSat = settings.includeSat || false;
    const commuteDaysPerWeek = settings.commuteDaysPerWeek || 2;
    const commuteDist = settings.commuteDist || 22;
    const commuteVar  = settings.commuteVariance || 0;
    const commuteSpread = settings.commuteSpread || 'random';

    // 시드 결정
    const seed = settings.fixSeed
      ? (year * 100 + month) * 997 + vehicleId.split('').reduce((a,c) => a + c.charCodeAt(0), 0)
      : Date.now();
    const rng = seededRand(seed);

    // 근무일 목록
    const workDays = getDaysInMonth(year, month, includeSat);
    if (!workDays.length) return [];

    // ---- 출퇴근 날짜 배치 ----
    const weeks = groupByWeek(workDays, year, month);
    const commuteDates = new Set();
    weeks.forEach(week => {
      const weekDays = [...week];
      let pool = [];
      if (commuteSpread === 'early') {
        // 월~화 우선
        pool = weekDays.filter(d => d.dow >= 1 && d.dow <= 2);
        if (pool.length < commuteDaysPerWeek) pool = weekDays.filter(d => d.dow >= 1 && d.dow <= 3);
        if (pool.length < commuteDaysPerWeek) pool = weekDays;
      } else if (commuteSpread === 'late') {
        // 목~금 우선
        pool = weekDays.filter(d => d.dow >= 4 && d.dow <= 5);
        if (pool.length < commuteDaysPerWeek) pool = weekDays.filter(d => d.dow >= 3 && d.dow <= 5);
        if (pool.length < commuteDaysPerWeek) pool = weekDays;
      } else {
        pool = weekDays;
      }
      // 랜덤 섞기
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const picked = pool.slice(0, Math.min(commuteDaysPerWeek, pool.length));
      picked.forEach(d => commuteDates.add(d.date));
    });

    // ---- 거래처 방문 날짜 배치 ----
    // 각 거래처의 월 방문 횟수만큼 workDays에서 랜덤 선택
    const bizMap = {}; // date -> clientId
    if (clients.length) {
      // 거래처별 방문할 날짜 배치 (한 날짜에 1거래처만)
      const availDates = workDays.map(d => d.date);
      // 셔플
      const shuffled = [...availDates];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      let slotIdx = 0;
      clients.forEach(client => {
        const cnt = Math.min(client.visits || 1, shuffled.length - slotIdx);
        for (let i = 0; i < cnt; i++) {
          if (slotIdx < shuffled.length) {
            bizMap[shuffled[slotIdx]] = client.id;
            slotIdx++;
          }
        }
      });
    }

    // ---- 행 생성 ----
    const rows = [];
    // 전체 달력 (토/일 포함)
    const totalDays = new Date(year, month, 0).getDate();
    let odo = startOdo;

    for (let d = 1; d <= totalDays; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      const isWeekend = (dow === 0) || (dow === 6 && !includeSat);
      const isHoliday = isWeekend;

      let driven = 0;
      let commute = 0;
      let biz = 0;
      let memo = '';
      let rowType = 'none'; // none | commute | biz

      if (!isHoliday) {
        const isCommute = commuteDates.has(d);
        const clientId  = bizMap[d];

        if (isCommute) {
          // 출퇴근 거리 (± 오차)
          const var_ = commuteVar > 0 ? randInt(rng, -commuteVar, commuteVar) : 0;
          commute = Math.max(1, commuteDist + var_);
          driven  = commute;
          rowType = 'commute';
        } else if (clientId) {
          // 거래처 방문
          const c = DB.Clients.getById(clientId);
          if (c) {
            const var_ = c.variance > 0 ? randInt(rng, -c.variance, c.variance) : 0;
            biz    = Math.max(1, c.distance + var_);
            driven = biz;
            memo   = c.name;
            rowType = 'biz';
          }
        }
        // 그 외 날짜는 0 (휴일 미표시)
      }

      const before = odo;
      const after  = odo + driven;
      odo = after;

      rows.push({
        date:    d,
        dow:     dow,
        before:  before,
        after:   after,
        driven:  driven,
        commute: commute,
        biz:     biz,
        memo:    memo,
        rowType: rowType,
        isHoliday: isHoliday
      });
    }

    return rows;
  }

  // ---- 테이블 렌더 ----
  function renderTable(rows, year, month) {
    const tbody = document.getElementById('logbook-tbody');
    const tfoot = document.getElementById('logbook-tfoot');

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-row">데이터가 없습니다.</td></tr>';
      tfoot.innerHTML = '';
      return;
    }

    let totalDriven = 0, totalCommute = 0, totalBiz = 0;

    tbody.innerHTML = rows.map((r, idx) => {
      const mm = String(month).padStart(2,'0');
      const dd = String(r.date).padStart(2,'0');
      const dayLabel = `${mm.replace(/^0/,'')}/${dd.replace(/^0/,'')}`;
      const dowLabel = DAY_KO[r.dow];

      let rowClass = '';
      if (r.dow === 0) rowClass = 'day-sun';
      else if (r.dow === 6) rowClass = 'day-sat';
      else if (r.rowType === 'biz') rowClass = 'row-biz';
      else if (r.rowType === 'commute') rowClass = 'row-commute';

      totalDriven  += r.driven;
      totalCommute += r.commute;
      totalBiz     += r.biz;

      // 수동 편집 가능 셀
      const editableNum = (val, field) =>
        `<input type="number" value="${val}" min="0"
          data-idx="${idx}" data-field="${field}"
          onchange="LogbookManager.onCellChange(this)"
          ${r.isHoliday ? 'disabled' : ''} />`;

      const editableTxt = (val, field) =>
        `<input type="text" value="${val}" maxlength="20"
          data-idx="${idx}" data-field="${field}"
          onchange="LogbookManager.onCellChange(this)"
          ${r.isHoliday ? 'disabled' : ''} />`;

      // 빨간색 날짜 (일요일 or 공휴일)
      const dayStyle = r.dow === 0 ? 'style="color:#dc2626;font-weight:700;"' :
                       r.dow === 6 ? 'style="color:#2563ea;font-weight:700;"' : '';

      // 샘플과 동일: 근무일은 0km도 odo 표시, 주말은 빈칸
      const showOdo = !r.isHoliday;
      return `
        <tr class="${rowClass}">
          <td ${dayStyle}>${dayLabel}</td>
          <td ${dayStyle}>${dowLabel}</td>
          <td>${showOdo ? r.before.toLocaleString() : ''}</td>
          <td>${showOdo ? r.after.toLocaleString()  : ''}</td>
          <td>${showOdo ? (r.driven || '0') : ''}</td>
          <td>${showOdo ? (r.commute || '0') : ''}</td>
          <td>${showOdo ? (r.biz || '0') : ''}</td>
          <td>
            ${r.isHoliday
              ? `<span style="color:#bbb;font-size:11px;">${r.dow===0 ? '일요일' : '토요일'}</span>`
              : editableTxt(r.memo, 'memo')
            }
          </td>
        </tr>
      `;
    }).join('');

    // 합계 행
    const lastRow = rows[rows.length - 1];
    tfoot.innerHTML = `
      <tr>
        <td colspan="2" style="font-weight:700;text-align:center;">합 계</td>
        <td></td>
        <td></td>
        <td style="font-weight:700;color:#1a4fa0;">${totalDriven.toLocaleString()}</td>
        <td style="font-weight:700;color:#16a34a;">${totalCommute.toLocaleString()}</td>
        <td style="font-weight:700;color:#d97706;">${totalBiz.toLocaleString()}</td>
        <td></td>
      </tr>
    `;
  }

  // ---- 셀 변경 핸들러 ----
  function onCellChange(input) {
    const idx   = parseInt(input.dataset.idx);
    const field = input.dataset.field;
    const row   = currentRows[idx];
    if (!row) return;

    if (field === 'memo') {
      row.memo = input.value;
    } else {
      row[field] = Number(input.value) || 0;
    }

    // driven / before / after 재계산 (변경 셀에 따라)
    if (field === 'commute' || field === 'biz') {
      row.driven = (row.commute || 0) + (row.biz || 0);
      // after = before + driven 재계산
      row.after = row.before + row.driven;
      // 이후 행들도 연쇄 갱신
      recomputeOdo(idx);
      renderTable(currentRows, currentMeta.year, currentMeta.month);
    }
  }

  function recomputeOdo(fromIdx) {
    for (let i = fromIdx + 1; i < currentRows.length; i++) {
      const prev = currentRows[i - 1];
      currentRows[i].before = prev.after;
      currentRows[i].after  = prev.after + (currentRows[i].driven || 0);
    }
  }

  // ---- 초기화 ----
  function initYearSelect() {
    const sel = document.getElementById('lb-year');
    const now = new Date();
    sel.innerHTML = '';
    for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = `${y}년`;
      if (y === now.getFullYear()) opt.selected = true;
      sel.appendChild(opt);
    }
    // 현재 월 선택
    document.getElementById('lb-month').value = now.getMonth() + 1;
  }

  function init() {
    initYearSelect();

    // 기본값: 설정의 차량 선택
    const s = DB.Settings.get();
    const vSel = document.getElementById('lb-vehicle-select');
    if (s.vehicleId) vSel.value = s.vehicleId;

    // 시작 누적거리 자동 설정
    vSel.addEventListener('change', () => {
      const v = DB.Vehicles.getById(vSel.value);
      if (v) document.getElementById('lb-start-odo').value = v.odometer;
    });

    // 자동 생성 버튼
    document.getElementById('btn-generate-log').addEventListener('click', generate);

    // 초기화 버튼
    document.getElementById('btn-clear-log').addEventListener('click', () => {
      if (!currentRows.length) return;
      App.confirm('현재 작성 중인 일지를 초기화하시겠습니까?', () => {
        currentRows = [];
        currentMeta = {};
        renderTable([], 1, 1);
        document.getElementById('logbook-save-area').style.display = 'none';
        document.getElementById('generate-info').style.display = 'none';
        App.toast('초기화되었습니다.');
      });
    });

    // 저장 버튼
    document.getElementById('btn-save-log').addEventListener('click', saveLog);
  }

  function generate() {
    const vehicleId = document.getElementById('lb-vehicle-select').value;
    const year      = parseInt(document.getElementById('lb-year').value);
    const month     = parseInt(document.getElementById('lb-month').value);
    const startOdo  = parseInt(document.getElementById('lb-start-odo').value);

    if (!vehicleId) { App.toast('차량을 선택해주세요.', 'error'); return; }
    if (!startOdo)  { App.toast('시작 누적주행거리를 입력해주세요.', 'error'); return; }

    const settings  = DB.Settings.get();
    const clients   = DB.Clients.getAll();

    if (!clients.length) {
      App.toast('⚠️ 거래처를 먼저 등록해주세요.', 'warning');
    }

    currentRows = generateRows(vehicleId, year, month, startOdo, settings);
    currentMeta = { vehicleId, year, month, startOdo };

    renderTable(currentRows, year, month);
    document.getElementById('logbook-save-area').style.display = 'flex';

    // 생성 정보 표시
    const totalDriven  = currentRows.reduce((s,r) => s + r.driven, 0);
    const totalBiz     = currentRows.reduce((s,r) => s + r.biz, 0);
    const totalCommute = currentRows.reduce((s,r) => s + r.commute, 0);
    const workDays     = currentRows.filter(r => !r.isHoliday && r.driven > 0).length;

    const infoEl = document.getElementById('generate-info');
    document.getElementById('generate-info-text').textContent =
      `✅ ${year}년 ${month}월 일지 생성 완료 | 운행일수: ${workDays}일 | 총 주행: ${totalDriven}km (출퇴근 ${totalCommute}km + 업무용 ${totalBiz}km)`;
    infoEl.style.display = 'block';

    App.toast('운행일지가 생성되었습니다. 수동으로 수정 후 저장하세요.', 'success');
  }

  function saveLog() {
    if (!currentRows.length) { App.toast('저장할 데이터가 없습니다.', 'error'); return; }
    const { vehicleId, year, month } = currentMeta;
    const v = DB.Vehicles.getById(vehicleId);
    DB.Logs.save(vehicleId, year, month, currentRows, {
      regno: v ? v.regno : '',
      model: v ? v.model : ''
    });
    App.toast(`${year}년 ${month}월 운행일지가 저장되었습니다.`, 'success');
    ExportManager.renderSavedList();
  }

  function loadLog(vehicleId, year, month) {
    const data = DB.Logs.get(vehicleId, year, month);
    if (!data) return;
    currentRows = data.rows;
    currentMeta = { vehicleId, year, month };

    // 탭 이동
    App.switchTab('tab-logbook');
    document.getElementById('lb-vehicle-select').value = vehicleId;
    document.getElementById('lb-year').value = year;
    document.getElementById('lb-month').value = month;

    renderTable(currentRows, year, month);
    document.getElementById('logbook-save-area').style.display = 'flex';
    App.toast(`${year}년 ${month}월 일지를 불러왔습니다.`, 'success');
  }

  function getCurrentRows() { return currentRows; }
  function getCurrentMeta() { return currentMeta; }

  return { init, generate, saveLog, loadLog, onCellChange, getCurrentRows, getCurrentMeta };
})();
