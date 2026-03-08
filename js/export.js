/* =====================================================
   export.js - 엑셀 출력 (SheetJS)
   ===================================================== */

const ExportManager = (() => {
  const DAY_KO = ['일','월','화','수','목','금','토'];

  // ---- 저장 목록 렌더 ----
  function renderSavedList() {
    const list    = DB.Logs.getAllIndex();
    const tbody   = document.getElementById('saved-log-tbody');
    const expSel  = document.getElementById('exp-vehicle');
    const expYear = document.getElementById('exp-year');

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-row">저장된 운행일지가 없습니다.</td></tr>';
      return;
    }

    // 연도 옵션
    const years = [...new Set(list.map(l => l.year))].sort((a,b) => b-a);
    const curExpYear = expYear.value;
    expYear.innerHTML = years.map(y => `<option value="${y}" ${y==curExpYear?'selected':''}>${y}년</option>`).join('');

    // 차량 옵션
    const vids = [...new Set(list.map(l => l.vehicleId))];
    const curVid = expSel.value;
    expSel.innerHTML = '<option value="all">전체 차량</option>' +
      vids.map(id => {
        const v = DB.Vehicles.getById(id);
        const label = v ? `${v.regno} (${v.model})` : id;
        return `<option value="${id}" ${id===curVid?'selected':''}>${label}</option>`;
      }).join('');

    // 내림차순 정렬
    const sorted = [...list].sort((a,b) => {
      if (b.year !== a.year) return b.year - a.year;
      return b.month - a.month;
    });

    tbody.innerHTML = sorted.map(item => {
      const v = DB.Vehicles.getById(item.vehicleId);
      const regno = v ? v.regno : item.vehicleId;
      const model = v ? `(${v.model})` : '';
      return `
        <tr>
          <td><strong>${regno}</strong>${model}</td>
          <td>${item.year}년 ${item.month}월</td>
          <td>${(item.totalKm||0).toLocaleString()} km</td>
          <td>${(item.commuteKm||0).toLocaleString()} km</td>
          <td>${(item.bizKm||0).toLocaleString()} km</td>
          <td>${new Date(item.savedAt).toLocaleString('ko-KR')}</td>
          <td>
            <button class="btn btn-edit" onclick="LogbookManager.loadLog('${item.vehicleId}',${item.year},${item.month})">✏️ 수정</button>
            <button class="btn btn-download" onclick="ExportManager.exportOne('${item.vehicleId}',${item.year},${item.month})">📥 엑셀</button>
            <button class="btn btn-delete" onclick="ExportManager.deleteLog('${item.vehicleId}',${item.year},${item.month})">🗑️ 삭제</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ---- 엑셀 셀 스타일 헬퍼 ----
  function cellStyle(opts = {}) {
    return {
      font:      { name: '맑은 고딕', sz: opts.sz || 10, bold: opts.bold || false, color: opts.color ? { rgb: opts.color } : undefined },
      alignment: { horizontal: opts.align || 'center', vertical: 'center', wrapText: opts.wrap || false },
      fill:      opts.fill ? { fgColor: { rgb: opts.fill }, patternType: 'solid' } : undefined,
      border: {
        top:    { style: 'thin', color: { rgb: 'B0B0B0' } },
        bottom: { style: 'thin', color: { rgb: 'B0B0B0' } },
        left:   { style: 'thin', color: { rgb: 'B0B0B0' } },
        right:  { style: 'thin', color: { rgb: 'B0B0B0' } },
      }
    };
  }

  // ---- 단일 일지 엑셀 생성 ----
  function buildWorksheet(vehicleId, year, month) {
    const data = DB.Logs.get(vehicleId, year, month);
    if (!data) return null;
    const rows  = data.rows;
    const v     = DB.Vehicles.getById(vehicleId);
    const regno = v ? v.regno : vehicleId;
    const model = v ? v.model : '';

    // 합계
    const totalDriven  = rows.reduce((s,r) => s + (Number(r.driven)||0), 0);
    const totalCommute = rows.reduce((s,r) => s + (Number(r.commute)||0), 0);
    const totalBiz     = rows.reduce((s,r) => s + (Number(r.biz)||0), 0);
    const lastAfter    = rows[rows.length-1]?.after || 0;

    // --- aoa (array of arrays) ---
    const aoa = [];

    // 행 1: 타이틀
    aoa.push(['업무용 승용차 운행기록부', '', '', '', '', '', '', '']);
    // 행 2: 차량번호
    aoa.push([`■ 차량등록번호 : ${regno}`, '', '', '', '', '', '', '']);
    // 행 3: 작성일자
    const m2 = String(month).padStart(2,'0');
    const lastDay = new Date(year, month, 0).getDate();
    aoa.push([`■ 차량운행 작성일자 : ${year} 년  ${m2} 월  01 일  ~  ${m2} 월  ${lastDay} 일`, '', '', '', '', '', '', '']);
    // 행 4: 업무사용비율
    aoa.push(['■ 업무용 사용비율 계산', '', '', '', '', '', '', '']);

    // 헤더행 1 (병합예정)
    aoa.push(['일자', '(요일)', '운 행 내 역', '', '', '사용 거리', '', '비 고']);
    // 헤더행 2
    aoa.push(['', '', '주행전(km)', '주행후(km)', '주행거리(km)', '출퇴근(km)', '업무용(km)', '']);

    // 데이터 행
    rows.forEach(r => {
      const mm2 = String(month).padStart(2,'0');
      const dd  = String(r.date).padStart(2,'0');
      const dateLabel = `${parseInt(mm2)}/${dd.replace(/^0/,'')}`;
      const dowLabel  = DAY_KO[r.dow];
      if (r.isHoliday) {
        aoa.push([dateLabel, dowLabel, '', '', '', '', '', '']);
      } else {
        aoa.push([
          dateLabel,
          dowLabel,
          r.driven ? r.before : '',
          r.driven ? r.after  : '',
          r.driven || '',
          r.commute || '',
          r.biz     || '',
          r.memo    || ''
        ]);
      }
    });

    // 합계 행
    aoa.push(['합 계', '', '', '', totalDriven, totalCommute, totalBiz, '']);

    // --- SheetJS 워크시트 생성 ---
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // 컬럼 너비 설정
    ws['!cols'] = [
      { wch: 9 },   // 일자
      { wch: 6 },   // 요일
      { wch: 12 },  // 주행전
      { wch: 12 },  // 주행후
      { wch: 12 },  // 주행거리
      { wch: 12 },  // 출퇴근
      { wch: 12 },  // 업무용
      { wch: 18 },  // 비고
    ];

    // 행 높이
    const rowHeights = [];
    rowHeights[0] = { hpt: 28 }; // 타이틀
    rowHeights[4] = { hpt: 22 }; // 헤더1
    rowHeights[5] = { hpt: 18 }; // 헤더2
    ws['!rows'] = rowHeights;

    // 병합 설정
    ws['!merges'] = [
      // 타이틀: A1:H1
      { s:{r:0,c:0}, e:{r:0,c:7} },
      // 차량번호: A2:H2
      { s:{r:1,c:0}, e:{r:1,c:7} },
      // 작성일자: A3:H3
      { s:{r:2,c:0}, e:{r:2,c:7} },
      // 업무비율: A4:H4
      { s:{r:3,c:0}, e:{r:3,c:7} },
      // 헤더 일자: A5:A6
      { s:{r:4,c:0}, e:{r:5,c:0} },
      // 헤더 요일: B5:B6
      { s:{r:4,c:1}, e:{r:5,c:1} },
      // 운행내역: C5:E5
      { s:{r:4,c:2}, e:{r:4,c:4} },
      // 사용거리: F5:G5
      { s:{r:4,c:5}, e:{r:4,c:6} },
      // 비고: H5:H6
      { s:{r:4,c:7}, e:{r:5,c:7} },
      // 합계: A마지막:B마지막
      { s:{r:aoa.length-1,c:0}, e:{r:aoa.length-1,c:1} },
    ];

    // ---- 셀 스타일 적용 ----
    const numRows = aoa.length;
    const numCols = 8;
    const HEADER_ROW1 = 4; // 0-based
    const HEADER_ROW2 = 5;
    const DATA_START  = 6;

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const addr = XLSX.utils.encode_cell({r,c});
        if (!ws[addr]) ws[addr] = { t:'s', v:'' };

        if (r === 0) {
          // 타이틀
          ws[addr].s = cellStyle({ bold:true, sz:16, fill:'1A4FA0', color:'FFFFFF', align:'center' });
        } else if (r >= 1 && r <= 3) {
          // 메타 정보
          ws[addr].s = cellStyle({ sz:10, align:'left', fill:'DBEAFE', bold: c===0 });
        } else if (r === HEADER_ROW1 || r === HEADER_ROW2) {
          // 헤더
          ws[addr].s = cellStyle({ bold:true, sz:10, fill:'1A4FA0', color:'FFFFFF', align:'center' });
        } else if (r === numRows - 1) {
          // 합계 행
          ws[addr].s = cellStyle({ bold:true, sz:11, fill:'FFF9C4', align:'center' });
        } else {
          // 데이터 행
          const rowData = aoa[r];
          const dow = rows[r - DATA_START]?.dow;
          const isHoliday = rows[r - DATA_START]?.isHoliday;
          let fill = 'FFFFFF';
          let color = '1F2937';
          if (dow === 0) { fill = 'FEF2F2'; color = 'DC2626'; }
          else if (dow === 6) { fill = 'EFF6FF'; color = '2563EA'; }
          else if (rows[r - DATA_START]?.rowType === 'biz') fill = 'FEFCE8';
          else if (rows[r - DATA_START]?.rowType === 'commute') fill = 'F0FDF4';

          ws[addr].s = cellStyle({ sz:10, align:'center', fill, color });
          // 비고(마지막 컬럼)는 좌정렬
          if (c === 7) ws[addr].s = cellStyle({ sz:10, align:'left', fill, color });
        }
      }
    }

    return ws;
  }

  // ---- 단일 다운로드 ----
  function exportOne(vehicleId, year, month) {
    const ws = buildWorksheet(vehicleId, year, month);
    if (!ws) { App.toast('데이터를 찾을 수 없습니다.', 'error'); return; }
    const wb = XLSX.utils.book_new();
    const sheetName = `${month}월 운행일지`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const v = DB.Vehicles.getById(vehicleId);
    const regno = v ? v.regno : vehicleId;
    const filename = `운행기록부_${regno}_${year}년${String(month).padStart(2,'0')}월.xlsx`;
    XLSX.writeFile(wb, filename);
    App.toast(`${year}년 ${month}월 엑셀 파일이 다운로드됩니다.`, 'success');
  }

  // ---- 현재 편집 중인 일지 즉시 다운로드 ----
  function exportCurrent() {
    const rows = LogbookManager.getCurrentRows();
    const meta = LogbookManager.getCurrentMeta();
    if (!rows.length) { App.toast('생성된 일지가 없습니다.', 'error'); return; }
    // 임시 저장 후 다운로드
    const { vehicleId, year, month } = meta;
    const v = DB.Vehicles.getById(vehicleId);
    DB.Logs.save(vehicleId, year, month, rows, {
      regno: v?.regno || '', model: v?.model || ''
    });
    exportOne(vehicleId, year, month);
  }

  // ---- 전체/연도별 일괄 다운로드 ----
  function exportAll() {
    const vehicleId = document.getElementById('exp-vehicle').value;
    const year      = parseInt(document.getElementById('exp-year').value);

    let list = DB.Logs.getAllIndex().filter(i => i.year === year);
    if (vehicleId !== 'all') list = list.filter(i => i.vehicleId === vehicleId);

    if (!list.length) { App.toast('해당 조건의 저장된 일지가 없습니다.', 'warning'); return; }

    const wb = XLSX.utils.book_new();
    list.sort((a,b) => a.month - b.month).forEach(item => {
      const ws = buildWorksheet(item.vehicleId, item.year, item.month);
      if (ws) {
        const sheetName = `${item.month}월`;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
    });

    const v = vehicleId !== 'all' ? DB.Vehicles.getById(vehicleId) : null;
    const regno = v ? v.regno : '전체';
    const filename = `운행기록부_${regno}_${year}년.xlsx`;
    XLSX.writeFile(wb, filename);
    App.toast(`${year}년 엑셀 파일 (${list.length}개월)이 다운로드됩니다.`, 'success');
  }

  // ---- 삭제 ----
  function deleteLog(vehicleId, year, month) {
    App.confirm(`${year}년 ${month}월 운행일지를 삭제하시겠습니까?`, () => {
      DB.Logs.delete(vehicleId, year, month);
      renderSavedList();
      App.toast('운행일지가 삭제되었습니다.');
    });
  }

  function init() {
    document.getElementById('btn-export-all').addEventListener('click', exportAll);

    // 연도 셀렉트 초기화
    const expYear = document.getElementById('exp-year');
    const now = new Date();
    for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = `${y}년`;
      if (y === now.getFullYear()) opt.selected = true;
      expYear.appendChild(opt);
    }

    renderSavedList();
  }

  return { init, renderSavedList, exportOne, exportAll, exportCurrent, deleteLog };
})();
