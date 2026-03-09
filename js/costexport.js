/* =====================================================
   costexport.js - 비용 명세서 엑셀 & PDF 출력 v3
   ExcelJS 기반 완전 스타일 지원
   - 월별 비용 시트 (색상, 콤마, 헤더, 병합 완벽 적용)
   - 연간 종합 비용 시트
   - PDF: html2canvas → jsPDF (화면 그대로)
   ===================================================== */

const CostExport = (() => {

  /* =====================================================
     색상 상수 (ARGB: FF + RRGGBB)
     ===================================================== */
  const C = {
    HEADER_BG:  'FF1E3A5F',
    HEADER_FG:  'FFFFFFFF',
    META_BG:    'FFDBEAFE',
    META_FG:    'FF1E3A5F',
    SUM_BG:     'FFFFF9C4',
    SUM_FG:     'FF1F2937',
    EVEN_BG:    'FFF8FAFF',
    ODD_BG:     'FFFFFFFF',
    TOTAL_BG:   'FFFFF9C4',
    REC_BG:     'FFF3F4F6',
    REC_FG:     'FF9CA3AF',
    FUEL_FG:    'FF1A4FA0',
    REPAIR_FG:  'FF7C3AED',
    CARTAX_FG:  'FFDC2626',
    INS_FG:     'FFC026A1',
    TOLL_FG:    'FF0369A1',
    LOAN_FG:    'FFB45309',
    TOTAL_FG:   'FF1F2937',
    COM_BG:     'FFF0FDF4',
    COM_FG:     'FF15803D',
    BIZ_BG:     'FFFEFCE8',
    BIZ_FG:     'FF92400E',
    DIV:        'FFE2E8F0',
    BORDER:     'FFBFCFE8',
    MONTH_COLORS: [
      'FFDC2626','FFE65C00','FFB45309','FF065F46','FF1D4ED8','FF7C3AED',
      'FFDC2626','FFC026A1','FF0369A1','FF4D7C0F','FFB45309','FF1E40AF'
    ],
  };

  /* =====================================================
     ExcelJS 스타일 헬퍼
     ===================================================== */
  function mkFill(argb) {
    if (!argb) return { type:'pattern', pattern:'none' };
    return { type:'pattern', pattern:'solid', fgColor:{ argb } };
  }
  function mkFont(argb, bold=false, size=10, italic=false) {
    return { name:'맑은 고딕', size, bold, italic, color:{ argb } };
  }
  function mkBorder(argb=C.BORDER) {
    const s = { style:'thin', color:{ argb } };
    return { top:s, bottom:s, left:s, right:s };
  }
  function mkAlign(h='center', v='middle', wrap=false) {
    return { horizontal:h, vertical:v, wrapText:wrap };
  }

  function styleCell(cell, bgArgb, fgArgb, {bold=false, sz=10, align='center', numFmt=null, italic=false, wrap=false}={}) {
    cell.fill      = mkFill(bgArgb);
    cell.font      = mkFont(fgArgb, bold, sz, italic);
    cell.border    = mkBorder();
    cell.alignment = mkAlign(align, 'middle', wrap);
    if (numFmt) cell.numFmt = numFmt;
  }

  /* =====================================================
     yearData 행에서 실제 값 추출 (사용자 입력 우선, 없으면 추천값)
     ===================================================== */
  function getEffectiveVal(row, field) {
    const v = row.val ? row.val[field] : undefined;
    if (v !== null && v !== undefined) return Number(v);
    return Number((row.rec && row.rec[field]) || 0);
  }

  function isRec(row, field) {
    if (!row.val) return true;
    return row.val[field] === null || row.val[field] === undefined;
  }

  /* yearData[month].rows 배열에서 월 합산 계산 */
  function calcRowsSum(rows) {
    let fuel=0, repair=0, carTax=0, insurance=0, tollPark=0, loanInterest=0;
    (rows||[]).forEach(row => {
      fuel        += getEffectiveVal(row, 'fuel');
      repair      += getEffectiveVal(row, 'repair');
      carTax      += getEffectiveVal(row, 'carTax');
      insurance   += getEffectiveVal(row, 'insurance');
      tollPark    += getEffectiveVal(row, 'tollPark');
      loanInterest+= getEffectiveVal(row, 'loanInterest');
    });
    const daily = fuel + repair + carTax + insurance + tollPark + loanInterest;
    return { fuel, repair, carTax, insurance, tollPark, loanInterest, daily };
  }

  /* =====================================================
     월별 비용 워크시트 생성 (ExcelJS)
     ===================================================== */
  async function buildCostMonthSheet(wb, vehicleId, year, month, yearDataArg) {
    const vehicle = await DB.Vehicles.getById(vehicleId);
    if (!vehicle) return null;

    const mData = yearDataArg && yearDataArg[month];
    const rows  = (mData && mData.rows) ? mData.rows : [];
    if (!rows.length) return null;

    const sum      = calcRowsSum(rows);
    const regno    = vehicle.regno || '';
    const model    = vehicle.model || '';
    const fuelEff  = vehicle.fuelEff   || 0;
    const fuelPrice= vehicle.fuelPrice || 0;
    const mm2      = String(month).padStart(2,'0');
    const lastDay  = new Date(year, month, 0).getDate();

    const ws = wb.addWorksheet(`${month}월비용`);
    ws.columns = [
      {width:9}, {width:10}, {width:13}, {width:13}, {width:13},
      {width:13}, {width:15}, {width:13}, {width:13}, {width:22}
    ];

    let R = 1;

    /* ── 타이틀 ── */
    ws.getRow(R).height = 30;
    const t1 = ws.getCell(R, 1);
    t1.value = `(주)이든푸드 ${year}년 ${month}월 업무용 승용차 비용 명세서`;
    styleCell(t1, C.HEADER_BG, C.HEADER_FG, {bold:true, sz:15});
    for (let c=2; c<=10; c++) styleCell(ws.getCell(R,c), C.HEADER_BG, C.HEADER_FG, {});
    ws.mergeCells(R,1,R,10); R++;

    /* ── 차량 정보 ── */
    ws.getRow(R).height = 18;
    const m1 = ws.getCell(R,1);
    m1.value = `■ 차량등록번호: ${regno}  (${model})  |  연비: ${fuelEff}km/L  |  유가: ${Number(fuelPrice).toLocaleString()}원/L`;
    styleCell(m1, C.META_BG, C.META_FG, {bold:true, align:'left', sz:10});
    for (let c=2; c<=10; c++) styleCell(ws.getCell(R,c), C.META_BG, C.META_FG, {});
    ws.mergeCells(R,1,R,10); R++;

    /* ── 집계기간 ── */
    ws.getRow(R).height = 18;
    const m2 = ws.getCell(R,1);
    m2.value = `■ 집계기간: ${year}년 ${mm2}월 01일  ~  ${mm2}월 ${lastDay}일`;
    styleCell(m2, C.META_BG, C.META_FG, {align:'left', sz:10});
    for (let c=2; c<=10; c++) styleCell(ws.getCell(R,c), C.META_BG, C.META_FG, {});
    ws.mergeCells(R,1,R,10); R++;

    /* ── 월 합계 미리보기 ── */
    ws.getRow(R).height = 18;
    const m3 = ws.getCell(R,1);
    m3.value = `■ 월 합계: 유류비 ${sum.fuel.toLocaleString()}원 | 수선비 ${sum.repair.toLocaleString()}원 | 자동차세 ${sum.carTax.toLocaleString()}원 | 보험료 ${sum.insurance.toLocaleString()}원 | 주차·통행료 ${sum.tollPark.toLocaleString()}원 | 할부이자 ${sum.loanInterest.toLocaleString()}원 | 합계 ${sum.daily.toLocaleString()}원`;
    styleCell(m3, C.META_BG, C.META_FG, {align:'left', sz:10});
    for (let c=2; c<=10; c++) styleCell(ws.getCell(R,c), C.META_BG, C.META_FG, {});
    ws.mergeCells(R,1,R,10); R++;

    /* ── 헤더 ── */
    ws.getRow(R).height = 22;
    const HDR_R = R;
    const hdrLabels = ['구분','일 자','유류비(원)','수선비(원)','자동차세(원)','보험료(원)','주차·통행료(원)','할부이자(원)','1일 計(원)','비 고'];
    hdrLabels.forEach((txt, i) => {
      const hc = ws.getCell(R, i+1);
      hc.value = txt;
      styleCell(hc, C.HEADER_BG, C.HEADER_FG, {bold:true, sz:10});
    });
    R++;

    /* ── 데이터 행 ── */
    rows.forEach(row => {
      ws.getRow(R).height = 17;
      let bgArgb = C.ODD_BG, fgArgb = C.TOTAL_FG;
      if (row.rowType === 'commute') { bgArgb = C.COM_BG; fgArgb = C.COM_FG; }
      else if (row.rowType === 'biz') { bgArgb = C.BIZ_BG; fgArgb = C.BIZ_FG; }

      const category = row.rowType === 'commute' ? '출퇴근' : (row.rowType === 'biz' ? '업무' : '일반');
      const catCell = ws.getCell(R, 1);
      catCell.value = category;
      styleCell(catCell, bgArgb, fgArgb, {bold:true, sz:10});

      const dateCell = ws.getCell(R, 2);
      dateCell.value = row.date;
      styleCell(dateCell, bgArgb, fgArgb, {sz:10});

      const fields = [
        ['fuel',         C.FUEL_FG],
        ['repair',       C.REPAIR_FG],
        ['carTax',       C.CARTAX_FG],
        ['insurance',    C.INS_FG],
        ['tollPark',     C.TOLL_FG],
        ['loanInterest', C.LOAN_FG],
      ];

      fields.forEach(([field, defaultFg], i) => {
        const nc = ws.getCell(R, i+3);
        const val = getEffectiveVal(row, field);
        nc.value = val;
        const rec = isRec(row, field);
        const fgColor = rec ? C.REC_FG : defaultFg;
        const bgColor = rec ? C.REC_BG : bgArgb;
        styleCell(nc, bgColor, fgColor, {align:'right', sz:10, numFmt:'#,##0', italic:rec});
      });

      // 1일 합계
      const fuelVal   = getEffectiveVal(row, 'fuel');
      const repairVal = getEffectiveVal(row, 'repair');
      const taxVal    = getEffectiveVal(row, 'carTax');
      const insVal    = getEffectiveVal(row, 'insurance');
      const tollVal   = getEffectiveVal(row, 'tollPark');
      const loanVal   = getEffectiveVal(row, 'loanInterest');
      const daily     = fuelVal + repairVal + taxVal + insVal + tollVal + loanVal;

      const dailyCell = ws.getCell(R, 9);
      dailyCell.value = daily;
      styleCell(dailyCell, bgArgb, C.TOTAL_FG, {bold:true, align:'right', sz:11, numFmt:'#,##0'});

      const memoCell = ws.getCell(R, 10);
      memoCell.value = row.memo || '';
      styleCell(memoCell, bgArgb, fgArgb, {align:'left', sz:10});

      R++;
    });

    /* ── 합계 행 ── */
    ws.getRow(R).height = 22;
    const s1 = ws.getCell(R, 1); s1.value = '합 계';
    styleCell(s1, C.SUM_BG, C.SUM_FG, {bold:true, sz:11});
    const s2 = ws.getCell(R, 2); s2.value = '';
    styleCell(s2, C.SUM_BG, C.SUM_FG, {bold:true, sz:11});
    ws.mergeCells(R, 1, R, 2);

    const sumFields = [
      [sum.fuel,         C.FUEL_FG],
      [sum.repair,       C.REPAIR_FG],
      [sum.carTax,       C.CARTAX_FG],
      [sum.insurance,    C.INS_FG],
      [sum.tollPark,     C.TOLL_FG],
      [sum.loanInterest, C.LOAN_FG],
    ];
    sumFields.forEach(([val, fg], i) => {
      const nc = ws.getCell(R, i+3);
      nc.value = val;
      styleCell(nc, C.SUM_BG, fg, {bold:true, align:'right', sz:11, numFmt:'#,##0'});
    });

    const stot = ws.getCell(R, 9);
    stot.value = sum.daily;
    styleCell(stot, C.SUM_BG, C.TOTAL_FG, {bold:true, align:'right', sz:12, numFmt:'#,##0'});

    const smemo = ws.getCell(R, 10);
    smemo.value = '';
    styleCell(smemo, C.SUM_BG, C.SUM_FG, {bold:true, sz:11});
    R++;

    /* ── 안내 메모 ── */
    ws.getRow(R).height = 16;
    const note = ws.getCell(R, 1);
    note.value = '※ 회색 기울임 값은 시스템 추천값입니다. 실제 입력값은 일반 색상으로 표시됩니다.';
    styleCell(note, C.REC_BG, C.REC_FG, {align:'left', sz:9, italic:true});
    for (let c=2; c<=10; c++) styleCell(ws.getCell(R,c), C.REC_BG, C.REC_FG, {sz:9});
    ws.mergeCells(R, 1, R, 10);
    R++;

    return ws;
  }

  /* =====================================================
     연간 종합 비용 워크시트 (ExcelJS)
     ===================================================== */
  async function buildCostSummarySheet(wb, vehicleId, year, yearDataArg) {
    const vehicle = await DB.Vehicles.getById(vehicleId);
    if (!vehicle) return null;
    const regno   = vehicle.regno || '';
    const model   = vehicle.model || '';
    const annual  = await DB.CostData.getAnnual(vehicleId, year);

    const ws = wb.addWorksheet('연간종합비용');
    ws.columns = [
      {width:8},{width:14},{width:13},{width:13},{width:13},
      {width:15},{width:13},{width:14},{width:15},{width:16}
    ];

    let R = 1;

    /* ── 타이틀 ── */
    ws.getRow(R).height = 32;
    const t1 = ws.getCell(R,1);
    t1.value = `(주)이든푸드 ${year}년 업무용 승용차 비용 명세서 (연간 종합)`;
    styleCell(t1, C.HEADER_BG, C.HEADER_FG, {bold:true, sz:16});
    for (let c=2; c<=10; c++) styleCell(ws.getCell(R,c), C.HEADER_BG, C.HEADER_FG, {});
    ws.mergeCells(R,1,R,10); R++;

    /* ── 차량 정보 ── */
    ws.getRow(R).height = 20;
    const vm = ws.getCell(R,1);
    vm.value = `■ 차량등록번호: ${regno}  (${model})  |  연비: ${vehicle.fuelEff||0}km/L  |  유가: ${Number(vehicle.fuelPrice||0).toLocaleString()}원/L`;
    styleCell(vm, C.META_BG, C.META_FG, {bold:true, align:'left', sz:11});
    for (let c=2; c<=10; c++) styleCell(ws.getCell(R,c), C.META_BG, C.META_FG, {});
    ws.mergeCells(R,1,R,10); R++;

    /* ── 연간 고정비 ── */
    ws.getRow(R).height = 18;
    const ann = annual;
    const am = ws.getCell(R,1);
    am.value = `■ 연간 고정비  |  자동차세: ${(Number(ann.carTax)||0).toLocaleString()}원  |  보험료: ${(Number(ann.insurance)||0).toLocaleString()}원  |  할부이자: ${(Number(ann.loanInterest)||0).toLocaleString()}원  |  월 수선비 기본: ${(Number(ann.repairMonthly)||0).toLocaleString()}원`;
    styleCell(am, C.META_BG, C.META_FG, {align:'left', sz:10});
    for (let c=2; c<=10; c++) styleCell(ws.getCell(R,c), C.META_BG, C.META_FG, {});
    ws.mergeCells(R,1,R,10); R++;

    /* ── 빈 행 ── */
    ws.getRow(R).height = 8;
    for(let c=1;c<=10;c++) styleCell(ws.getCell(R,c), 'FFF8FAFF', 'FFF8FAFF', {});
    ws.mergeCells(R,1,R,10); R++;

    /* ── 헤더 ── */
    ws.getRow(R).height = 24;
    const hdrLabels = ['월','유류비(원)','수선비(원)','자동차세(원)','보험료(원)','주차·통행료(원)','할부이자(원)','월 합계(원)','누계(원)','비 고'];
    hdrLabels.forEach((txt, i) => {
      const hc = ws.getCell(R, i+1);
      hc.value = txt;
      styleCell(hc, C.HEADER_BG, C.HEADER_FG, {bold:true, sz:11});
    });
    R++;

    /* ── 월별 데이터 ── */
    let grandFuel=0, grandRepair=0, grandTax=0, grandIns=0, grandToll=0, grandLoan=0, grandTotal=0;
    let cumTotal = 0;

    for (let m=1; m<=12; m++) {
      ws.getRow(R).height = 22;
      const fg  = C.MONTH_COLORS[m-1];
      const bg  = m % 2 === 0 ? C.EVEN_BG : C.ODD_BG;

      const mnCell = ws.getCell(R,1);
      mnCell.value = `${m}월`;
      styleCell(mnCell, bg, fg, {bold:true, sz:11});

      const mData = yearDataArg && yearDataArg[m];
      const rows  = (mData && mData.rows) ? mData.rows : [];

      if (!rows.length) {
        for(let c=2; c<=9; c++){
          const nc = ws.getCell(R,c);
          nc.value = 0;
          styleCell(nc, bg, fg, {align:'right', sz:11, numFmt:'#,##0'});
        }
        const noData = ws.getCell(R,10);
        noData.value = '비용 데이터 없음';
        styleCell(noData, bg, fg, {align:'left', sz:10});
      } else {
        const sum = calcRowsSum(rows);
        grandFuel   += sum.fuel;
        grandRepair += sum.repair;
        grandTax    += sum.carTax;
        grandIns    += sum.insurance;
        grandToll   += sum.tollPark;
        grandLoan   += sum.loanInterest;
        grandTotal  += sum.daily;
        cumTotal    += sum.daily;

        const numData = [
          [sum.fuel,         C.FUEL_FG],
          [sum.repair,       C.REPAIR_FG],
          [sum.carTax,       C.CARTAX_FG],
          [sum.insurance,    C.INS_FG],
          [sum.tollPark,     C.TOLL_FG],
          [sum.loanInterest, C.LOAN_FG],
          [sum.daily,        C.TOTAL_FG],
          [cumTotal,         'FF1A4FA0'],
        ];
        numData.forEach(([val, numFg], i) => {
          const nc = ws.getCell(R, i+2);
          nc.value = val;
          const isTot = i === 6 || i === 7;
          styleCell(nc, bg, numFg, {bold:isTot, align:'right', sz:isTot?11:11, numFmt:'#,##0'});
        });

        const memoCell = ws.getCell(R,10);
        memoCell.value = '';
        styleCell(memoCell, bg, fg, {align:'left', sz:10});
      }
      R++;
    }

    /* ── 구분선 ── */
    ws.getRow(R).height = 6;
    for(let c=1;c<=10;c++) styleCell(ws.getCell(R,c), C.DIV, C.DIV, {});
    ws.mergeCells(R,1,R,10); R++;

    /* ── 합계 행 ── */
    ws.getRow(R).height = 36;
    const lbl = ws.getCell(R,1);
    lbl.value = '연간합계';
    styleCell(lbl, C.TOTAL_BG, C.TOTAL_FG, {bold:true, sz:13, wrap:true});
    lbl.alignment = {horizontal:'center', vertical:'middle', wrapText:true};

    const totData = [
      [grandFuel,    C.FUEL_FG],
      [grandRepair,  C.REPAIR_FG],
      [grandTax,     C.CARTAX_FG],
      [grandIns,     C.INS_FG],
      [grandToll,    C.TOLL_FG],
      [grandLoan,    C.LOAN_FG],
      [grandTotal,   C.TOTAL_FG],
      [grandTotal,   'FF1A4FA0'],
    ];
    totData.forEach(([val, fg], i) => {
      const nc = ws.getCell(R, i+2);
      nc.value = val;
      styleCell(nc, C.TOTAL_BG, fg, {bold:true, align:'right', sz:13, numFmt:'#,##0'});
    });

    const totMemo = ws.getCell(R,10);
    totMemo.value = '';
    styleCell(totMemo, C.TOTAL_BG, C.TOTAL_FG, {bold:true, sz:12});
    R++;

    return ws;
  }

  /* =====================================================
     연간 비용 엑셀 다운로드 (ExcelJS)
     ===================================================== */
  async function exportCostYear(vehicleId, year) {
    if (!vehicleId) vehicleId = CostLedger.getCurVehicleId();
    if (!year)      year      = CostLedger.getCurYear() || new Date().getFullYear();

    App.showLoading(`${year}년 비용 명세서 엑셀 생성 중...`, {progress:true, sub:'데이터 준비 중...'});
    try {
      App.updateProgress(5, '차량 정보 확인 중...');
      await new Promise(r=>setTimeout(r,20));

      const v = await DB.Vehicles.getById(vehicleId);
      if (!v) { App.hideLoading(); App.toast('차량 정보가 없습니다.', 'error'); return; }
      const regno = v.regno;

      // yearData 가져오기
      App.updateProgress(15, '비용 데이터 불러오는 중...');
      await new Promise(r=>setTimeout(r,20));
      let yearData = {};
      const curVid = CostLedger.getCurVehicleId();
      const curYr  = CostLedger.getCurYear();
      if (curVid === vehicleId && curYr === year) {
        yearData = CostLedger.getYearData();
      } else {
        yearData = await buildYearDataFromDB(vehicleId, year);
      }

      App.updateProgress(25, '워크북 생성 중...');
      await new Promise(r=>setTimeout(r,20));
      const wb = new ExcelJS.Workbook();
      wb.creator  = '이든푸드 차량관리시스템';
      wb.created  = new Date();
      wb.modified = new Date();

      /* 연간 종합 시트 (맨 앞) */
      App.updateProgress(30, '연간종합 시트 생성 중...');
      await new Promise(r=>setTimeout(r,20));
      await buildCostSummarySheet(wb, vehicleId, year, yearData);

      /* 월별 시트 (1~12월) */
      for (let m = 1; m <= 12; m++) {
        const pct = Math.round(35 + m/12 * 55);
        App.updateProgress(pct, `${m}월 비용 시트 생성 중... (${m}/12)`);
        await new Promise(r=>setTimeout(r,15));
        await buildCostMonthSheet(wb, vehicleId, year, m, yearData);
      }

      App.updateProgress(92, '파일 생성 중...');
      await new Promise(r=>setTimeout(r,20));
      const buffer = await wb.xlsx.writeBuffer();
      const blob   = new Blob([buffer], {
        type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `비용명세서_${regno}_${year}년.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      App.updateProgress(100, '다운로드 완료!');
      await new Promise(r=>setTimeout(r,400));
      App.hideLoading();
      App.toast(`${year}년 연간 비용 명세서 엑셀 다운로드 완료!`, 'success');
    } catch(e) {
      App.hideLoading();
      App.toast('엑셀 생성 실패: ' + e.message, 'error');
      console.error(e);
    }
  }

  /* DB에서 yearData 구조 재구성 */
  async function buildYearDataFromDB(vehicleId, year) {
    const saved = await DB.CostData.get(vehicleId, year);
    if (saved && saved.data) return saved.data;
    const result = {};
    for (let m = 1; m <= 12; m++) result[m] = { rows: [] };
    return result;
  }

  /* =====================================================
     연간 비용 내보내기 (엑셀 출력 탭에서 호출)
     ===================================================== */
  async function exportCostAll() {
    const vehicleId = document.getElementById('exp-cost-vehicle').value;
    const year      = parseInt(document.getElementById('exp-cost-year').value);
    if (vehicleId === 'all') {
      const allV = await DB.Vehicles.getAll();
      const vids = (Array.isArray(allV) ? allV : []).map(v => v.id);
      if (!vids.length) { App.toast('등록된 차량이 없습니다.', 'warning'); return; }
      for (const vid of vids) await exportCostYear(vid, year);
    } else {
      await exportCostYear(vehicleId, year);
    }
  }

  /* =====================================================
     PDF 출력: html2canvas → jsPDF (화면 그대로)
     ===================================================== */
  async function exportCostPDF() {
    const printArea = document.getElementById('cost-print-area');
    if (!printArea) { App.toast('출력 영역이 없습니다.', 'error'); return; }
    if (!CostLedger.getCurVehicleId()) { App.toast('먼저 비용 데이터를 불러오세요.', 'error'); return; }

    App.showLoading('PDF 생성 중...');
    try {
      const canvas = await html2canvas(printArea, {
        scale:           2,
        useCORS:         true,
        logging:         false,
        backgroundColor: '#ffffff',
        width:           printArea.scrollWidth,
        height:          printArea.scrollHeight,
        windowWidth:     printArea.scrollWidth + 60
      });

      const imgData = canvas.toDataURL('image/png');
      const imgW    = canvas.width;
      const imgH    = canvas.height;

      const { jsPDF } = window.jspdf;
      const pageW  = 297;
      const pageH  = 210;
      const margin = 10;
      const printW = pageW - margin * 2;
      const printH = Math.round(printW * imgH / imgW);
      const pageCount = Math.ceil(printH / (pageH - margin * 2));

      const pdf = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });

      for (let i = 0; i < pageCount; i++) {
        if (i > 0) pdf.addPage();
        const srcY   = i * (pageH - margin * 2) * imgW / printW;
        const srcH   = (pageH - margin * 2) * imgW / printW;
        const sliceH = Math.min(srcH, imgH - srcY);
        if (sliceH <= 0) break;

        const sc  = document.createElement('canvas');
        sc.width  = imgW;
        sc.height = Math.round(sliceH);
        const ctx = sc.getContext('2d');
        ctx.drawImage(canvas, 0, -srcY);
        const sd  = sc.toDataURL('image/png');
        const srH = Math.min(pageH - margin * 2, printH - i * (pageH - margin * 2));
        pdf.addImage(sd, 'PNG', margin, margin, printW, srH);
      }

      const vehicleId = CostLedger.getCurVehicleId();
      const year      = CostLedger.getCurYear();
      const veh       = await DB.Vehicles.getById(vehicleId);
      const regno     = veh ? veh.regno : 'unknown';
      pdf.save(`비용명세서_${regno}_${year}년_연간.pdf`);
      App.hideLoading();
      App.toast('PDF 다운로드 시작!', 'success');
    } catch (e) {
      App.hideLoading();
      console.error('PDF 생성 오류:', e);
      App.toast('PDF 생성 실패: ' + e.message, 'error');
    }
  }

  /* =====================================================
     운행일지 PDF 출력
     ===================================================== */
  async function exportLogPDF() {
    const printArea = document.querySelector('#tab-logbook .table-card');
    if (!printArea) { App.toast('출력 영역이 없습니다.', 'error'); return; }

    App.showLoading('운행일지 PDF 생성 중...');
    try {
      const canvas = await html2canvas(printArea, {
        scale:           2,
        useCORS:         true,
        logging:         false,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/png');
      const imgW    = canvas.width;
      const imgH    = canvas.height;

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
      const pageW = 297, pageH = 210, margin = 10;
      const printW = pageW - margin * 2;
      const printH = Math.round(printW * imgH / imgW);
      const pageCount = Math.ceil(printH / (pageH - margin * 2));

      for (let i = 0; i < pageCount; i++) {
        if (i > 0) pdf.addPage();
        const srcY   = i * (pageH - margin * 2) * imgW / printW;
        const srcH   = (pageH - margin * 2) * imgW / printW;
        const sliceH = Math.min(srcH, imgH - srcY);
        if (sliceH <= 0) break;

        const sc  = document.createElement('canvas');
        sc.width  = imgW;
        sc.height = Math.round(sliceH);
        const ctx = sc.getContext('2d');
        ctx.drawImage(canvas, 0, -srcY);
        const sd  = sc.toDataURL('image/png');
        const srH = Math.min(pageH - margin * 2, printH - i * (pageH - margin * 2));
        pdf.addImage(sd, 'PNG', margin, margin, printW, srH);
      }

      const meta  = LogbookManager.getCurrentMeta();
      const veh   = await DB.Vehicles.getById(meta.vehicleId);
      const regno = veh ? veh.regno : 'vehicle';
      pdf.save(`운행일지_${regno}_${meta.year}년${String(meta.month).padStart(2,'0')}월.pdf`);
      App.hideLoading();
      App.toast('운행일지 PDF 다운로드!', 'success');
    } catch (e) {
      App.hideLoading();
      console.error('PDF 오류:', e);
      App.toast('PDF 생성 실패: ' + e.message, 'error');
    }
  }

  /* =====================================================
     비용 출력 탭의 셀렉트 박스 갱신
     ===================================================== */
  async function refreshCostExportSelects() {
    const expCostVehicle = document.getElementById('exp-cost-vehicle');
    const expCostYear    = document.getElementById('exp-cost-year');
    if (!expCostVehicle || !expCostYear) return;

    const vehiclesRaw = await DB.Vehicles.getAll().catch(()=>[]);
    const vehicles = Array.isArray(vehiclesRaw) ? vehiclesRaw : [];
    const vOpts    = vehicles.map(v => `<option value="${v.id}">${v.regno} (${v.model})</option>`).join('');
    const curV     = expCostVehicle.value;
    expCostVehicle.innerHTML = '<option value="all">전체 차량</option>' + vOpts;
    if (curV) expCostVehicle.value = curV;

    if (expCostYear.options.length === 0) {
      const now = new Date();
      for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 2; y++) {
        const o = document.createElement('option');
        o.value = y; o.textContent = `${y}년`;
        if (y === now.getFullYear()) o.selected = true;
        expCostYear.appendChild(o);
      }
    }
  }

  /* =====================================================
     init
     ===================================================== */
  function init() {
    const btnExpCost = document.getElementById('btn-export-cost');
    if (btnExpCost) btnExpCost.addEventListener('click', exportCostAll);

    const btnLogPdf = document.getElementById('btn-log-pdf');
    if (btnLogPdf) btnLogPdf.addEventListener('click', exportLogPDF);

    refreshCostExportSelects();
  }

  return {
    init,
    exportCostYear,
    exportCostAll,
    exportCostPDF,
    exportLogPDF,
    refreshCostExportSelects,
    buildCostMonthSheet,
    buildCostSummarySheet
  };
})();
