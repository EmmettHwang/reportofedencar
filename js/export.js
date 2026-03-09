/* =====================================================
   export.js - 엑셀 출력 v3 (ExcelJS 기반 완전 스타일 지원)
   - 월별 시트 (법정공휴일/토/일 색상 반영)
   - 연간종합 시트
   - 천단위 콤마, 병합 셀, 행높이, 컬럼너비 완벽 지원
   ===================================================== */

const ExportManager = (() => {
  const DAY_KO = ['일','월','화','수','목','금','토'];

  /* =================================================
     색상 상수 (argb 형식: FF + RRGGBB)
     ================================================= */
  const C = {
    HEADER_BG:  'FF1A4FA0',
    HEADER_FG:  'FFFFFFFF',
    META_BG:    'FFDBEAFE',
    META_FG:    'FF1E3A5F',
    RED_BG:     'FFFFF0F0',
    RED_FG:     'FFDC2626',
    SAT_BG:     'FFEFF6FF',
    SAT_FG:     'FF2563EA',
    COM_BG:     'FFF0FDF4',
    COM_FG:     'FF15803D',
    BIZ_BG:     'FFFEFCE8',
    BIZ_FG:     'FF92400E',
    SUM_BG:     'FFFFF9C4',
    SUM_FG:     'FF1F2937',
    TOTAL_BG:   'FFFFF9C4',
    EVEN_BG:    'FFF8FAFF',
    ODD_BG:     'FFFFFFFF',
    RATIO_HI:   'FF16A34A',
    RATIO_MID:  'FFD97706',
    RATIO_LO:   'FFDC2626',
    BORDER:     'FFBFCFE8',
    BORDER_MED: 'FF6B8EB8',
    WHITE:      'FFFFFFFF',
    EMPTY:      'FFF8FAFF',
    DIV:        'FFE2E8F0',
    MONTH_COLORS: [
      'FFDC2626','FFE65C00','FFB45309','FF065F46','FF1D4ED8','FF7C3AED',
      'FFDC2626','FFC026A1','FF0369A1','FF4D7C0F','FFB45309','FF1E40AF'
    ],
  };

  /* =================================================
     ExcelJS 스타일 헬퍼
     ================================================= */
  function mkFill(argb) {
    if (!argb) return { type:'pattern', pattern:'none' };
    return { type:'pattern', pattern:'solid', fgColor:{ argb } };
  }
  function mkFont(argb, bold=false, size=10, name='맑은 고딕') {
    return { name, size, bold, color:{ argb } };
  }
  function mkBorder(style='thin', argb=C.BORDER) {
    const s = { style, color:{ argb } };
    return { top:s, bottom:s, left:s, right:s };
  }
  function mkAlign(h='center', v='middle', wrap=false) {
    return { horizontal:h, vertical:v, wrapText:wrap };
  }
  function mkNumFmt(ws, cell) {
    cell.numFmt = '#,##0';
    return cell;
  }

  /* 셀에 스타일 일괄 적용 */
  function applyStyle(cell, { fill, font, border, align, numFmt, wrapText }) {
    if (fill)   cell.fill   = fill;
    if (font)   cell.font   = font;
    if (border) cell.border = border;
    if (align)  cell.alignment = align;
    if (numFmt) cell.numFmt = numFmt;
  }

  function styleCell(cell, bgArgb, fgArgb, bold=false, h='center', sz=10, numFmt=null) {
    cell.fill      = mkFill(bgArgb);
    cell.font      = mkFont(fgArgb, bold, sz);
    cell.border    = mkBorder('thin', C.BORDER);
    cell.alignment = mkAlign(h, 'middle', false);
    if (numFmt) cell.numFmt = numFmt;
  }

  /* =================================================
     월별 워크시트 생성 (ExcelJS Worksheet)
     ================================================= */
  async function buildMonthSheet(wb, vehicleId, year, month) {
    const logData = await DB.Logs.get(vehicleId, year, month);
    if (!logData) return null;
    const rows   = logData.rows;
    const v      = await DB.Vehicles.getById(vehicleId);
    const regno  = v ? v.regno : vehicleId;
    const model  = v ? v.model : '';

    const sum    = LogbookManager.calcSummary(rows);
    const mm2    = String(month).padStart(2,'0');
    const lastDay= new Date(year, month, 0).getDate();
    const bizRatio = sum.totalDriven > 0
      ? (sum.totalBiz / sum.totalDriven * 100).toFixed(2) : '0.00';

    const ws = wb.addWorksheet(`${month}월`);

    /* 컬럼 너비 */
    ws.columns = [
      { width: 9  },  // A 일자
      { width: 6  },  // B 요일
      { width: 13 },  // C 주행전
      { width: 13 },  // D 주행후
      { width: 13 },  // E 주행거리
      { width: 13 },  // F 출퇴근
      { width: 13 },  // G 업무용
      { width: 22 },  // H 비고
    ];

    let R = 1;  // ExcelJS는 1-based

    /* ── 타이틀 행 ── */
    ws.getRow(R).height = 28;
    const t1 = ws.getCell(R, 1);
    t1.value = '업무용 승용차 운행기록부';
    styleCell(t1, C.HEADER_BG, C.HEADER_FG, true, 'center', 16);
    ws.mergeCells(R, 1, R, 8);
    R++;

    /* ── 메타 3행 ── */
    const metaLines = [
      `■ 차량등록번호 : ${regno}  (${model})`,
      `■ 차량운행 작성일자 : ${year} 년  ${mm2} 월  01 일  ~  ${mm2} 월  ${lastDay} 일`,
      `■ 업무용 사용비율 : ${bizRatio}%  (출퇴근: ${sum.totalCommute.toLocaleString()} km / 업무용: ${sum.totalBiz.toLocaleString()} km / 총: ${sum.totalDriven.toLocaleString()} km)`,
    ];
    for (const txt of metaLines) {
      ws.getRow(R).height = 18;
      const mc = ws.getCell(R, 1);
      mc.value = txt;
      styleCell(mc, C.META_BG, C.META_FG, R===2, 'left', 10);
      for (let c=2; c<=8; c++) styleCell(ws.getCell(R,c), C.META_BG, C.META_FG, false, 'center', 10);
      ws.mergeCells(R, 1, R, 8);
      R++;
    }

    /* ── 헤더 행 1 ── */
    ws.getRow(R).height = 22;
    const hdr1 = [['일자',1,1],['(요일)',2,2],['운 행 내 역',3,5],['사용 거리 (km)',6,7],['비 고',8,8]];
    hdr1.forEach(([txt, s, e]) => {
      const hc = ws.getCell(R, s);
      hc.value = txt;
      styleCell(hc, C.HEADER_BG, C.HEADER_FG, true, 'center', 10);
      for (let c=s+1; c<=e; c++) styleCell(ws.getCell(R,c), C.HEADER_BG, C.HEADER_FG, true, 'center', 10);
      if (s < e) ws.mergeCells(R, s, R, e);
    });
    const HDR1 = R; R++;

    /* ── 헤더 행 2 ── */
    ws.getRow(R).height = 18;
    const hdr2Labels = ['','','주행전(km)','주행후(km)','주행거리(km)','출퇴근(km)','업무용(km)',''];
    hdr2Labels.forEach((txt, i) => {
      const hc = ws.getCell(R, i+1);
      hc.value = txt;
      styleCell(hc, C.HEADER_BG, C.HEADER_FG, true, 'center', 10);
    });
    /* 헤더 병합 */
    ws.mergeCells(HDR1, 1, R, 1);   // 일자
    ws.mergeCells(HDR1, 2, R, 2);   // 요일
    ws.mergeCells(HDR1, 8, R, 8);   // 비고
    R++;

    /* ── 데이터 행 ── */
    const DATA_START = R;
    rows.forEach(row => {
      ws.getRow(R).height = 16;
      let bgArgb = C.ODD_BG, fgArgb = 'FF1F2937';
      if (row.isRed)                    { bgArgb=C.RED_BG; fgArgb=C.RED_FG; }
      else if (row.isSat)               { bgArgb=C.SAT_BG; fgArgb=C.SAT_FG; }
      else if (row.rowType==='commute') { bgArgb=C.COM_BG; fgArgb=C.COM_FG; }
      else if (row.rowType==='biz')     { bgArgb=C.BIZ_BG; fgArgb=C.BIZ_FG; }

      const bold = row.isRed || row.isSat;
      const dayCell = ws.getCell(R, 1);
      dayCell.value = `${month}/${row.date}`;
      styleCell(dayCell, bgArgb, fgArgb, bold, 'center', 10);

      const dowCell = ws.getCell(R, 2);
      dowCell.value = DAY_KO[row.dow];
      styleCell(dowCell, bgArgb, fgArgb, bold, 'center', 10);

      if (row.isNonWork) {
        for (let c=3; c<=7; c++) {
          styleCell(ws.getCell(R,c), bgArgb, fgArgb, false, 'center', 10);
        }
        const memo = row.holName || (row.isRed ? '일요일' : row.isSat ? '토요일' : '');
        const memoCell = ws.getCell(R, 8);
        memoCell.value = memo;
        styleCell(memoCell, bgArgb, fgArgb, false, 'left', 10);
      } else {
        const nums = [row.before, row.after, row.driven, row.commute, row.biz];
        nums.forEach((val, i) => {
          const nc = ws.getCell(R, i+3);
          nc.value = val || 0;
          styleCell(nc, bgArgb, fgArgb, false, 'right', 10, '#,##0');
        });
        const memoCell = ws.getCell(R, 8);
        memoCell.value = row.holName || row.memo || '';
        styleCell(memoCell, bgArgb, fgArgb, false, 'left', 10);
      }
      R++;
    });

    /* ── 합계 행 ── */
    ws.getRow(R).height = 20;
    const sumMerge = ws.getCell(R, 1);
    sumMerge.value = '합  계';
    styleCell(sumMerge, C.SUM_BG, C.SUM_FG, true, 'center', 11);
    for (let c=2; c<=4; c++) styleCell(ws.getCell(R,c), C.SUM_BG, C.SUM_FG, true, 'center', 11);
    ws.mergeCells(R, 1, R, 4);

    [[sum.totalDriven,'FF1A4FA0'],[sum.totalCommute,'FF15803D'],[sum.totalBiz,'FF92400E']].forEach(([val,fg],i)=>{
      const nc = ws.getCell(R, 5+i);
      nc.value = val;
      styleCell(nc, C.SUM_BG, fg, true, 'right', 12, '#,##0');
    });
    styleCell(ws.getCell(R, 8), C.SUM_BG, C.SUM_FG, true, 'center', 11);
    R++;

    return ws;
  }

  /* =================================================
     연간 종합 워크시트
     ================================================= */
  async function buildSummarySheet(wb, vehicleId, year) {
    const v     = await DB.Vehicles.getById(vehicleId);
    const regno = v ? v.regno : vehicleId;
    const model = v ? v.model : '';

    const ws = wb.addWorksheet('연간종합');
    ws.columns = [
      {width:12},{width:14},{width:14},{width:14},
      {width:15},{width:15},{width:4},{width:12}
    ];

    let R = 1;

    /* 타이틀 */
    ws.getRow(R).height = 34;
    const t1 = ws.getCell(R,1);
    t1.value = `${year}년 업무용 승용차 운행기록부`;
    styleCell(t1, C.HEADER_BG, C.HEADER_FG, true, 'center', 18);
    ws.mergeCells(R,1,R,8); R++;

    /* 공백 */
    ws.getRow(R).height = 8;
    for(let c=1;c<=8;c++) styleCell(ws.getCell(R,c), C.EMPTY, C.EMPTY);
    ws.mergeCells(R,1,R,8); R++;

    /* 메타 3행 */
    const metaLines2 = [
      `■ 차 량 등 록 번 호 :  ${regno}  (${model})`,
      `■ 차량운행 작성일자 :  ${year} 년  01 월  ~  12 월`,
      `■ 업무용 사용비율 계산`,
    ];
    for (const txt of metaLines2) {
      ws.getRow(R).height = 20;
      const mc = ws.getCell(R,1);
      mc.value = txt;
      styleCell(mc, C.META_BG, C.META_FG, true, 'left', 11);
      for (let c=2;c<=8;c++) styleCell(ws.getCell(R,c), C.META_BG, C.META_FG);
      ws.mergeCells(R,1,R,8); R++;
    }

    /* 공백 */
    ws.getRow(R).height = 8;
    for(let c=1;c<=8;c++) styleCell(ws.getCell(R,c), C.EMPTY, C.EMPTY);
    ws.mergeCells(R,1,R,8); R++;

    /* 헤더 3행 */
    ws.getRow(R).height = 22;
    const HDR_R1 = R;
    // 헤더 행 1
    [['구분(월)',1,1],['주행전(km)',2,2],['주행후(km)',3,3],['주행거리(km)',4,4],
     ['운 행 내 역',5,7],['비율',8,8]].forEach(([txt,s,e])=>{
      const hc = ws.getCell(R,s);
      hc.value = txt;
      styleCell(hc, C.HEADER_BG, C.HEADER_FG, true, 'center', 11);
      for(let c=s+1;c<=e;c++) styleCell(ws.getCell(R,c), C.HEADER_BG, C.HEADER_FG, true,'center',11);
      if(s<e) ws.mergeCells(R,s,R,e);
    });
    R++;

    ws.getRow(R).height = 18;
    ['','','','','사용 거리 (km)','','',''].forEach((txt,i)=>{
      const hc=ws.getCell(R,i+1); hc.value=txt;
      styleCell(hc, C.HEADER_BG, C.HEADER_FG, true,'center',11);
    });
    ws.mergeCells(R,5,R,7); R++;

    ws.getRow(R).height = 18;
    ['','','','','출퇴근(km)','업무용(km)','',''].forEach((txt,i)=>{
      const hc=ws.getCell(R,i+1); hc.value=txt;
      styleCell(hc, C.HEADER_BG, C.HEADER_FG, true,'center',11);
    });
    // 헤더 병합 (구분월 3행 span)
    ws.mergeCells(HDR_R1, 1, R, 1);
    ws.mergeCells(HDR_R1, 2, R, 2);
    ws.mergeCells(HDR_R1, 3, R, 3);
    ws.mergeCells(HDR_R1, 4, R, 4);
    ws.mergeCells(HDR_R1, 8, R, 8);
    R++;

    /* 월별 데이터 */
    const MONTH_START = R;
    const monthNames = ['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    let grandTotal=0, grandCommute=0, grandBiz=0;
    let prevEndOdo=null;

    for (let m=1; m<=12; m++) {
      ws.getRow(R).height = 22;
      const logData = await DB.Logs.get(vehicleId, year, m);
      const fg = C.MONTH_COLORS[m-1];
      const bg = m%2===0 ? C.EVEN_BG : C.ODD_BG;

      const mnCell = ws.getCell(R,1);
      mnCell.value = monthNames[m];
      styleCell(mnCell, bg, fg, true, 'center', 11);

      if (!logData) {
        for(let c=2;c<=8;c++){
          const dc=ws.getCell(R,c); dc.value='-';
          styleCell(dc, bg, fg, false,'center',11);
        }
      } else {
        const sum = LogbookManager.calcSummary(logData.rows);
        const ratio = sum.totalDriven>0
          ? parseFloat((sum.totalBiz/sum.totalDriven*100).toFixed(2)) : 0;
        grandTotal   += sum.totalDriven;
        grandCommute += sum.totalCommute;
        grandBiz     += sum.totalBiz;

        const startOdo = logData.rows[0]?.before ?? (prevEndOdo??0);
        const endOdo   = logData.rows[logData.rows.length-1]?.after ?? startOdo;
        prevEndOdo     = endOdo;

        const ratioFg = ratio>=60 ? C.RATIO_HI : ratio>=40 ? C.RATIO_MID : C.RATIO_LO;

        [[startOdo,bg,fg],[endOdo,bg,fg],[sum.totalDriven,bg,fg],
         [sum.totalCommute,bg,fg],[sum.totalBiz,bg,fg]].forEach(([val,bg2,fg2],i)=>{
          const nc=ws.getCell(R,i+2);
          nc.value=val;
          styleCell(nc, bg2, fg2, false, 'right', 11, '#,##0');
        });

        // 열6 (빈칸)
        styleCell(ws.getCell(R,7), bg, fg, false,'center',11);

        // 비율
        const ratioCell = ws.getCell(R,8);
        ratioCell.value = `${ratio.toFixed(2)}%`;
        styleCell(ratioCell, bg, ratioFg, true, 'right', 11);
      }
      R++;
    }

    /* 구분선 */
    ws.getRow(R).height = 6;
    for(let c=1;c<=8;c++) styleCell(ws.getCell(R,c), C.DIV, C.DIV);
    ws.mergeCells(R,1,R,8); R++;

    /* 합계 레이블 행 */
    const totalRatio = grandTotal>0 ? (grandBiz/grandTotal*100).toFixed(1) : '0.0';
    const ratioArgb = grandTotal>0&&(grandBiz/grandTotal>=0.6) ? C.RATIO_HI : C.RATIO_MID;

    ws.getRow(R).height = 36;
    const lbl1 = ws.getCell(R,1);
    lbl1.value = '기간 총주행거리(km) [A]';
    styleCell(lbl1, C.TOTAL_BG, 'FF1A4FA0', true,'center',11);
    lbl1.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
    for(let c=2;c<=4;c++) styleCell(ws.getCell(R,c), C.TOTAL_BG, 'FF1A4FA0', true,'center',11);
    ws.mergeCells(R,1,R,4);

    const lbl2 = ws.getCell(R,5);
    lbl2.value = '기간 출퇴근 사용거리(km)';
    styleCell(lbl2, C.TOTAL_BG, 'FF15803D', true,'center',11);
    lbl2.alignment = { horizontal:'center', vertical:'middle', wrapText:true };

    const lbl3 = ws.getCell(R,6);
    lbl3.value = '기간 업무용 사용거리(km) [B]';
    styleCell(lbl3, C.TOTAL_BG, 'FF92400E', true,'center',11);
    lbl3.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
    styleCell(ws.getCell(R,7), C.TOTAL_BG, 'FF92400E', true,'center',11);
    ws.mergeCells(R,6,R,7);

    const lbl4 = ws.getCell(R,8);
    lbl4.value = '업무용비율 [B/A]';
    styleCell(lbl4, C.TOTAL_BG, ratioArgb, true,'center',11);
    lbl4.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
    R++;

    /* 합계 수치 행 */
    ws.getRow(R).height = 38;
    const v1 = ws.getCell(R,1);
    v1.value = grandTotal;
    styleCell(v1, C.TOTAL_BG, 'FF1A4FA0', true,'center',14,'#,##0');
    for(let c=2;c<=4;c++) styleCell(ws.getCell(R,c), C.TOTAL_BG, 'FF1A4FA0', true,'center',14);
    ws.mergeCells(R,1,R,4);

    const v2 = ws.getCell(R,5);
    v2.value = grandCommute;
    styleCell(v2, C.TOTAL_BG, 'FF15803D', true,'center',14,'#,##0');

    const v3 = ws.getCell(R,6);
    v3.value = grandBiz;
    styleCell(v3, C.TOTAL_BG, 'FF92400E', true,'center',14,'#,##0');
    styleCell(ws.getCell(R,7), C.TOTAL_BG, 'FF92400E', true,'center',14);
    ws.mergeCells(R,6,R,7);

    const v4 = ws.getCell(R,8);
    v4.value = `${totalRatio}%`;
    styleCell(v4, C.TOTAL_BG, ratioArgb, true,'center',14);
    R++;

    return ws;
  }

  /* =================================================
     저장목록 렌더
     ================================================= */
  async function renderSavedList() {
    const list   = await DB.Logs.getAllIndex();
    const tbody  = document.getElementById('saved-log-tbody');
    const expSel = document.getElementById('exp-vehicle');
    const expYear= document.getElementById('exp-year');

    const years = [...new Set(list.map(l=>l.year))].sort((a,b)=>b-a);
    const curY  = expYear.value;
    expYear.innerHTML = years.length
      ? years.map(y=>`<option value="${y}" ${y==curY?'selected':''}>${y}년</option>`).join('')
      : `<option value="${new Date().getFullYear()}">${new Date().getFullYear()}년</option>`;

    const vids = [...new Set(list.map(l=>l.vehicleId))];
    const curV = expSel.value;
    const vehicleMap = {};
    await Promise.all(vids.map(async id => {
      try { vehicleMap[id] = await DB.Vehicles.getById(id); } catch{}
    }));
    expSel.innerHTML = '<option value="all">전체 차량</option>' +
      vids.map(id=>{
        const v=vehicleMap[id];
        return `<option value="${id}" ${id===curV?'selected':''}>${v?`${v.regno}(${v.model})`:id}</option>`;
      }).join('');

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-row">저장된 운행일지가 없습니다.</td></tr>';
      return;
    }

    const grouped = {};
    list.forEach(item=>{
      const yk=`${item.vehicleId}_${item.year}`;
      if (!grouped[yk]) grouped[yk]={vehicleId:item.vehicleId,year:item.year,months:[]};
      grouped[yk].months.push(item);
    });

    tbody.innerHTML = Object.values(grouped)
      .sort((a,b)=>b.year-a.year||a.vehicleId.localeCompare(b.vehicleId))
      .map(g=>{
        const v = vehicleMap[g.vehicleId];
        const regno=v?v.regno:g.vehicleId;
        const model=v?`(${v.model})`:'';
        const months=g.months.sort((a,b)=>a.month-b.month);
        const saved=months.map(m=>m.month+'월').join(', ');
        const totalKm=months.reduce((s,m)=>s+(m.totalKm||0),0);
        const bizKm=months.reduce((s,m)=>s+(m.bizKm||0),0);
        const ratio=totalKm>0?(bizKm/totalKm*100).toFixed(1):0;
        return `
          <tr>
            <td><strong>${regno}</strong>${model}</td>
            <td>${g.year}년</td>
            <td>${months.length}개월 (${saved})</td>
            <td>${totalKm.toLocaleString()} km</td>
            <td>${bizKm.toLocaleString()} km</td>
            <td><span class="ratio-badge">${ratio}%</span></td>
            <td>${new Date(months[months.length-1].savedAt).toLocaleDateString('ko-KR')}</td>
            <td>
              <button class="btn btn-download" onclick="ExportManager.exportYear('${g.vehicleId}',${g.year})">📥 엑셀 다운로드</button>
              <button class="btn btn-delete"   onclick="ExportManager.deleteYear('${g.vehicleId}',${g.year})">🗑️ 삭제</button>
            </td>
          </tr>`;
      }).join('');
  }

  /* =================================================
     연간 엑셀 다운로드 (ExcelJS)
     ================================================= */
  async function exportYear(vehicleId, year) {
    App.showLoading(`${year}년 엑셀 생성 중...`, {progress:true, sub:'데이터 확인 중...'});
    try {
      const list = await DB.Logs.getYearIndex(vehicleId, year);
      if (!list.length) { App.hideLoading(); App.toast('저장된 데이터가 없습니다.','error'); return; }

      const v     = await DB.Vehicles.getById(vehicleId);
      const regno = v ? v.regno : vehicleId;

      App.updateProgress(10, '워크북 생성 중...');
      await new Promise(r=>setTimeout(r,20));

      const wb = new ExcelJS.Workbook();
      wb.creator  = '이든푸드 차량관리시스템';
      wb.created  = new Date();
      wb.modified = new Date();

      /* 연간종합 시트 (맨 앞) */
      App.updateProgress(15, '연간종합 시트 생성 중...');
      await new Promise(r=>setTimeout(r,20));
      await buildSummarySheet(wb, vehicleId, year);

      /* 월별 시트 */
      const months = list.sort((a,b)=>a.month-b.month);
      for (let i=0; i<months.length; i++) {
        const item = months[i];
        const pct = Math.round(20 + (i+1)/months.length * 60);
        App.updateProgress(pct, `${item.month}월 시트 생성 중... (${i+1}/${months.length})`);
        await new Promise(r=>setTimeout(r,20));
        await buildMonthSheet(wb, item.vehicleId, item.year, item.month);
      }

      /* 다운로드 */
      App.updateProgress(88, '파일 생성 중...');
      await new Promise(r=>setTimeout(r,20));
      const buffer = await wb.xlsx.writeBuffer();
      const blob   = new Blob([buffer], {
        type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `운행기록부_${regno}_${year}년.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      App.updateProgress(100, '다운로드 완료!');
      await new Promise(r=>setTimeout(r,400));
      App.hideLoading();
      App.toast(`${year}년 연간 엑셀 다운로드 완료!`, 'success');
    } catch(e) {
      App.hideLoading();
      App.toast('엑셀 생성 실패: ' + e.message, 'error');
      console.error(e);
    }
  }

  /* 일괄 내보내기 */
  async function exportAll() {
    const vehicleId = document.getElementById('exp-vehicle').value;
    const year      = parseInt(document.getElementById('exp-year').value);
    if (vehicleId === 'all') {
      const allIdx = await DB.Logs.getAllIndex();
      const vids = [...new Set(allIdx.filter(i=>i.year===year).map(i=>i.vehicleId))];
      if (!vids.length) { App.toast('해당 연도 데이터 없음','warning'); return; }
      for (const vid of vids) await exportYear(vid, year);
    } else {
      await exportYear(vehicleId, year);
    }
  }

  /* 연도별 전체 삭제 */
  async function deleteYear(vehicleId, year) {
    App.confirm(`${year}년 전체 운행일지를 삭제하시겠습니까?`, async ()=>{
      App.showLoading('삭제 중...');
      try {
        const items = await DB.Logs.getYearIndex(vehicleId, year);
        await Promise.all(items.map(item=>DB.Logs.delete(item.vehicleId,item.year,item.month)));
        App.hideLoading();
        await renderSavedList();
        App.toast('삭제되었습니다.');
      } catch(e) { App.hideLoading(); App.toast('삭제 실패: '+e.message,'error'); }
    });
  }

  function init() {
    const expYear = document.getElementById('exp-year');
    if (expYear) {
      const now = new Date();
      for(let y=now.getFullYear()-1;y<=now.getFullYear()+2;y++){
        const o=document.createElement('option');
        o.value=y; o.textContent=`${y}년`;
        if(y===now.getFullYear()) o.selected=true;
        expYear.appendChild(o);
      }
    }
    // btn-export-all removed (table row buttons handle individual downloads)
    renderSavedList().catch(()=>{});
  }

  return { init, renderSavedList, exportYear, exportAll, deleteYear, buildMonthSheet, buildSummarySheet };
})();
