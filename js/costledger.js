/* =====================================================
   costledger.js  v2
   - 1~12월 전체를 한 화면에 렌더
   - 회색 RECOMMEND 값 → Tab 키로 확정 입력
   - 주유 기록 + 다음 주유 예측
   - 영수증 첨부 (이미지/PDF → base64 LocalStorage)
   ===================================================== */
const CostLedger = (() => {
  const MONTH_NAMES = ['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DAY_KO      = ['일','월','화','수','목','금','토'];

  /* ---- 현재 상태 ---- */
  let curVehicleId = '';
  let curYear      = 0;
  // yearData[month] = { rows: [...], fuelRows: [...] }
  let yearData     = {};
  // 영수증 모달 컨텍스트
  let receiptCtx   = { month:0, rowKey:'', files:[] };

  /* =================================================================
     헬퍼
     ================================================================= */
  const CostDB = () => DB.CostData;

  function fmt(n) { return Number(n||0).toLocaleString(); }

  /* 주유 소모 예측: 총 km, 연비 → 필요 리터 → 금액 */
  function calcFuelRecommend(km, fuelEff, fuelPrice) {
    if (!fuelEff || !km) return 0;
    return Math.round(km / fuelEff * (fuelPrice||0));
  }

  /* =================================================================
     연도 전체 데이터 초기화 / 로드
     ================================================================= */
  async function loadYearData(vehicleId, year) {
    try {
      const saved = await DB.CostData.get(vehicleId, year);
      if (saved && saved.data) {
        const d = saved.data;
        // yearData[0] 없으면 초기화
        if (!d[0]) d[0] = { fuelLogs: [] };
        return d;
      }
    } catch{}
    const result = { 0: { fuelLogs: [] } };
    for (let m = 1; m <= 12; m++) result[m] = { rows: [] };
    return result;
  }

  /* =================================================================
     운행일지 기반 RECOMMEND 행 생성 (회색 표시용)
     - 실제 입력은 사용자가 직접
     ================================================================= */
  async function buildRecommendRows(vehicleId, year, month) {
    let logData = null;
    try { logData = await DB.Logs.get(vehicleId, year, month); } catch{}
    if (!logData) return [];

    const vehicle   = await DB.Vehicles.getById(vehicleId).catch(()=>null);
    const settings  = await DB.Settings.get(vehicleId).catch(()=>({}));
    const annual    = await DB.CostData.getAnnual(vehicleId, year).catch(()=>({carTax:0,insurance:0,loanInterest:0,repairMonthly:0}));
    const fuelEff   = Number(vehicle?.fuelEff)   || 0;
    const fuelPrice = Number(vehicle?.fuelPrice) || 0;
    const commuteToll = Number(settings.commuteToll) || 0;

    const carTaxPerMonth       = Math.round((Number(annual.carTax)       || 0) / 12);
    const insurancePerMonth    = Math.round((Number(annual.insurance)    || 0) / 12);
    const loanInterestPerMonth = Math.round((Number(annual.loanInterest) || 0) / 12);
    const repairMonthly        = Number(annual.repairMonthly) || 0;

    const recs = [];
    let fixedUsed = false;
    // 클라이언트 목록 미리 로드 (async 처리)
    const allClients = await DB.Clients.getAll().catch(()=>[]);

    for (const r of logData.rows) {
      if (r.isNonWork) continue;

      // 통행료
      let tollRec = 0;
      let tollNote = '';
      if (r.rowType === 'commute' && commuteToll > 0) {
        tollRec  = commuteToll * 2;
        tollNote = `출퇴근통행료${commuteToll.toLocaleString()}×2`;
      } else if (r.rowType === 'biz' && r.memo) {
        const client = allClients.find(c => c.name === r.memo);
        if (client) {
          const toll    = (Number(client.toll)    || 0) * 2;
          const parking = Number(client.parking) || 0;
          tollRec  = toll + parking;
          if (toll > 0 && parking > 0)  tollNote = `통행료${(toll/2).toLocaleString()}×2+주차${parking.toLocaleString()}`;
          else if (toll > 0)             tollNote = `통행료${(toll/2).toLocaleString()}×2`;
          else if (parking > 0)          tollNote = `주차${parking.toLocaleString()}`;
        }
      }

      // 유류비 추천 (이 날 실제 km 기반 — 참고용)
      const fuelRec = calcFuelRecommend(r.driven, fuelEff, fuelPrice);

      // 고정비 첫 운행일에
      let carTaxRec = 0, insuranceRec = 0, loanRec = 0, repairRec = 0;
      if (!fixedUsed) {
        carTaxRec    = carTaxPerMonth;
        insuranceRec = insurancePerMonth;
        loanRec      = loanInterestPerMonth;
        repairRec    = repairMonthly;
        fixedUsed    = true;
      }

      recs.push({
        date:    `${month}/${r.date}`,
        dateNum: r.date,
        rowType: r.rowType,
        driven:  Number(r.driven) || 0,   // 소진 계산용
        memo:    r.rowType === 'commute' ? '출퇴근' : (r.memo || ''),
        // RECOMMEND 값 (회색)
        rec: {
          fuel:        fuelRec,
          repair:      repairRec,
          carTax:      carTaxRec,
          insurance:   insuranceRec,
          tollPark:    tollRec,
          loanInterest:loanRec,
          tollNote
        }
      });
    }
    return recs;
  }

  /* =================================================================
     yearData 초기화 (운행일지 로드 후)
     ================================================================= */
  async function initYearData(vehicleId, year) {
    let saved = null;
    try { saved = await DB.CostData.get(vehicleId, year); } catch{}
    const base  = (saved && saved.data) ? saved.data : {};

    const result = {};
    for (let m = 1; m <= 12; m++) {
      // 추천 행 생성
      const recs = await buildRecommendRows(vehicleId, year, m);
      // 저장된 사용자 입력 행 (key: month_dateNum_rowType)
      const savedRows = (base[m] && base[m].rows) ? base[m].rows : [];

      result[m] = {
        rows: recs.map(rec => {
          const rowKey = `${m}_${rec.dateNum}_${rec.rowType}_${rec.memo}`;
          const userRow = savedRows.find(s => s.rowKey === rowKey);
          return {
            ...rec,
            rowKey,
            // 사용자 입력값 (없으면 null = 추천값 표시)
            val: userRow ? userRow.val : {
              fuel: null, repair: null, carTax: null,
              insurance: null, tollPark: null, loanInterest: null
            },
            receipts: userRow ? (userRow.receipts || []) : []
          };
        })
      };
    }
    return result;
  }

  /* =================================================================
     화면 렌더 — 전체 1~12월
     ================================================================= */
  async function renderAll() {
    const container = document.getElementById('cost-months-container');
    if (!container) return;
    if (!curVehicleId) {
      container.innerHTML = '<div class="empty-cost-msg card" style="text-align:center;padding:40px;color:#9ca3af;">차량과 연도를 선택 후 <strong>"📂 불러오기"</strong>를 눌러주세요.</div>';
      return;
    }

    const vehicle = await DB.Vehicles.getById(curVehicleId).catch(()=>null);
    const v = vehicle || {};

    // 헤더
    document.getElementById('cost-doc-header').style.display = 'block';
    document.getElementById('cost-doc-title').textContent =
      `(주)이든푸드 업무용 승용차 비용 명세서 — ${curYear}년`;
    document.getElementById('cost-doc-meta').textContent =
      `${v.regno||''} (${v.model||''}) | 연비 ${v.fuelEff||0}km/L | 유가 ${fmt(v.fuelPrice)}원/L`;

    let html = '';

    for (let m = 1; m <= 12; m++) {
      const mData = yearData[m];
      if (!mData) continue;
      const rows = mData.rows;

      // 월 합계 (사용자 입력 우선, 없으면 추천값)
      const getVal = (row, field) => {
        const v2 = row.val[field];
        return (v2 !== null && v2 !== undefined) ? Number(v2) : (Number(row.rec[field]) || 0);
      };
      const sumFuel  = rows.reduce((s,r) => s + getVal(r,'fuel'), 0);
      const sumRep   = rows.reduce((s,r) => s + getVal(r,'repair'), 0);
      const sumTax   = rows.reduce((s,r) => s + getVal(r,'carTax'), 0);
      const sumIns   = rows.reduce((s,r) => s + getVal(r,'insurance'), 0);
      const sumToll  = rows.reduce((s,r) => s + getVal(r,'tollPark'), 0);
      const sumLoan  = rows.reduce((s,r) => s + getVal(r,'loanInterest'), 0);
      const sumTotal = sumFuel + sumRep + sumTax + sumIns + sumToll + sumLoan;

      const hasLog = rows.length > 0;

      html += `
      <div class="cost-month-block card" id="cost-block-${m}" style="margin-bottom:12px;padding:0;overflow:hidden;">
        <div class="cost-month-header">
          <span class="cost-month-label">${MONTH_NAMES[m]}</span>
          <span class="cost-month-total">월 합계: <strong>${fmt(sumTotal)}원</strong>
            <small>(유류비 ${fmt(sumFuel)} | 통행·주차 ${fmt(sumToll)} | 수선 ${fmt(sumRep)} | 세금 ${fmt(sumTax)} | 보험 ${fmt(sumIns)} | 이자 ${fmt(sumLoan)})</small>
          </span>
          <button class="btn-month-toggle" data-month="${m}" title="접기/펼치기">▲</button>
        </div>
        <div class="cost-month-body" id="cost-body-${m}">`;

      if (!hasLog) {
        html += `<div style="padding:14px;color:#9ca3af;font-size:13px;">운행일지 없음 — 운행일지 탭에서 먼저 생성·저장하세요.</div>`;
      } else {
        html += `
          <div class="table-scroll">
          <table class="cost-table cost-annual-table">
            <thead>
              <tr>
                <th class="cth-date">일자</th>
                <th class="cth-type">구분</th>
                <th class="cth-num">유류비(원)</th>
                <th class="cth-num">수선비(원)</th>
                <th class="cth-num">자동차세(원)</th>
                <th class="cth-num">보험료(원)</th>
                <th class="cth-num">주차·통행료(원)</th>
                <th class="cth-num">할부이자(원)</th>
                <th class="cth-num cth-total">1일 計(원)</th>
                <th class="cth-memo">비고·영수증</th>
              </tr>
            </thead>
            <tbody>`;

        rows.forEach((row, idx) => {
          const rowClass = row.rowType === 'commute' ? 'cost-row-com'
                         : row.rowType === 'biz'     ? 'cost-row-biz' : '';
          const recTotal = (Number(row.rec.fuel)||0)+(Number(row.rec.repair)||0)+
                           (Number(row.rec.carTax)||0)+(Number(row.rec.insurance)||0)+
                           (Number(row.rec.tollPark)||0)+(Number(row.rec.loanInterest)||0);
          const valTotal = ['fuel','repair','carTax','insurance','tollPark','loanInterest']
                            .reduce((s,f) => s + ((row.val[f]!==null&&row.val[f]!==undefined)?Number(row.val[f]):Number(row.rec[f]||0)), 0);
          const recCount = row.receipts ? row.receipts.length : 0;

          html += `<tr class="${rowClass}" data-month="${m}" data-idx="${idx}">
            <td class="cth-date" style="font-weight:600;">${row.date}</td>
            <td class="cth-type"><span class="cat-badge cat-${row.rowType}">${row.rowType==='commute'?'출퇴근':row.rowType==='biz'?'업무':'일반'}</span></td>
            ${makeCostInputCell(m, idx, 'fuel',         row, 'cth-num')}
            ${makeCostInputCell(m, idx, 'repair',       row, 'cth-num')}
            ${makeCostInputCell(m, idx, 'carTax',       row, 'cth-num')}
            ${makeCostInputCell(m, idx, 'insurance',    row, 'cth-num')}
            ${makeCostInputCell(m, idx, 'tollPark',     row, 'cth-num')}
            ${makeCostInputCell(m, idx, 'loanInterest', row, 'cth-num')}
            <td class="cth-total cost-daily-total" id="daily-${m}-${idx}">${fmt(valTotal)}</td>
            <td class="cth-memo">
              <input type="text" class="cost-memo-input" value="${row.memo||''}"
                data-month="${m}" data-idx="${idx}" data-field="memo"
                onchange="CostLedger.onMemoChange(this)" placeholder="비고" />
              <button class="btn-receipt ${recCount>0?'has-receipt':''}" title="영수증 첨부"
                onclick="CostLedger.openReceiptModal(${m},${idx})"
              >📎${recCount>0?'<sup class=\'rec-badge\'>'+recCount+'</sup>':''}</button>
            </td>
          </tr>`;
        });

        html += `
            </tbody>
            <tfoot>
              <tr class="cost-sum-row" id="sum-row-${m}">
                <td colspan="2" style="font-weight:700;">합 계</td>
                <td class="cth-num sum-fuel"><strong>${fmt(sumFuel)}</strong></td>
                <td class="cth-num sum-repair"><strong>${fmt(sumRep)}</strong></td>
                <td class="cth-num sum-cartax"><strong>${fmt(sumTax)}</strong></td>
                <td class="cth-num sum-ins"><strong>${fmt(sumIns)}</strong></td>
                <td class="cth-num sum-toll"><strong>${fmt(sumToll)}</strong></td>
                <td class="cth-num sum-loan"><strong>${fmt(sumLoan)}</strong></td>
                <td class="cth-total sum-total"><strong>${fmt(sumTotal)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          </div>`;
      }

      html += `</div></div>`; // cost-month-body, cost-month-block
    }

    // 연간 합계 카드
    let grandFuel=0,grandRep=0,grandTax=0,grandIns=0,grandToll=0,grandLoan=0;
    for (let m=1;m<=12;m++) {
      const rows = (yearData[m]||{}).rows||[];
      rows.forEach(row => {
        const gv = f => (row.val[f]!==null&&row.val[f]!==undefined)?Number(row.val[f]):Number(row.rec[f]||0);
        grandFuel+=gv('fuel'); grandRep+=gv('repair'); grandTax+=gv('carTax');
        grandIns+=gv('insurance'); grandToll+=gv('tollPark'); grandLoan+=gv('loanInterest');
      });
    }
    const grandTotal = grandFuel+grandRep+grandTax+grandIns+grandToll+grandLoan;
    html += `
    <div class="card cost-grand-total" style="background:#fff9c4;border:2px solid #fde047;margin-top:8px;">
      <h3 style="color:#1a4fa0;margin-bottom:12px;">📊 ${curYear}년 연간 비용 합계</h3>
      <div class="grand-total-grid">
        <div class="gt-item"><span class="gt-label">유류비</span><span class="gt-val" style="color:#1a4fa0;">${fmt(grandFuel)}원</span></div>
        <div class="gt-item"><span class="gt-label">수선비</span><span class="gt-val" style="color:#7c3aed;">${fmt(grandRep)}원</span></div>
        <div class="gt-item"><span class="gt-label">자동차세</span><span class="gt-val" style="color:#dc2626;">${fmt(grandTax)}원</span></div>
        <div class="gt-item"><span class="gt-label">보험료</span><span class="gt-val" style="color:#c026a1;">${fmt(grandIns)}원</span></div>
        <div class="gt-item"><span class="gt-label">주차·통행료</span><span class="gt-val" style="color:#0369a1;">${fmt(grandToll)}원</span></div>
        <div class="gt-item"><span class="gt-label">할부이자</span><span class="gt-val" style="color:#b45309;">${fmt(grandLoan)}원</span></div>
        <div class="gt-item gt-grand"><span class="gt-label">🏆 연간 합계</span><span class="gt-val grand-num">${fmt(grandTotal)}원</span></div>
      </div>
    </div>`;

    container.innerHTML = html;

    // 접기/펼치기 버튼 이벤트
    container.querySelectorAll('.btn-month-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const m   = btn.dataset.month;
        const body= document.getElementById(`cost-body-${m}`);
        const collapsed = body.style.display === 'none';
        body.style.display = collapsed ? '' : 'none';
        btn.textContent    = collapsed ? '▲' : '▼';
      });
    });

    // Tab키 핸들러
    attachTabHandlers();
  }

  /* 비용 입력 셀 생성 */
  function makeCostInputCell(month, idx, field, row, cls) {
    const recVal = Number(row.rec[field]) || 0;
    const usrVal = row.val[field];
    const isRec  = (usrVal === null || usrVal === undefined);
    const displayVal = isRec ? (recVal || '') : Number(usrVal);

    // 추천값이면 placeholder로 표시 (회색), 실제 입력이면 value
    if (isRec) {
      return `<td class="${cls}">
        <input type="number" min="0" step="100"
          class="cost-input cost-input-rec"
          placeholder="${recVal > 0 ? recVal.toLocaleString() : ''}"
          data-month="${month}" data-idx="${idx}" data-field="${field}" data-rec="${recVal}"
          onchange="CostLedger.onCostChange(this)"
          onkeydown="CostLedger.onTabAccept(event,this)" />
      </td>`;
    } else {
      return `<td class="${cls}">
        <input type="number" min="0" step="100"
          class="cost-input cost-input-entered"
          value="${Number(usrVal)}"
          data-month="${month}" data-idx="${idx}" data-field="${field}" data-rec="${recVal}"
          onchange="CostLedger.onCostChange(this)"
          onkeydown="CostLedger.onTabAccept(event,this)" />
      </td>`;
    }
  }

  /* Tab 키로 추천값 확정 */
  function onTabAccept(e, input) {
    if (e.key !== 'Tab') return;
    if (input.value === '' && input.placeholder !== '') {
      e.preventDefault();
      const recVal = Number(input.dataset.rec) || 0;
      input.value  = recVal;
      input.classList.remove('cost-input-rec');
      input.classList.add('cost-input-entered');
      input.placeholder = '';
      // 데이터 저장
      onCostChange(input);
      // 다음 셀로 포커스
      const allInputs = [...document.querySelectorAll('.cost-input')];
      const nextIdx   = allInputs.indexOf(input) + 1;
      if (nextIdx < allInputs.length) allInputs[nextIdx].focus();
    }
  }

  /* =================================================================
     유류비 소진 로직
     - 특정 날에 연료비(원)를 입력하면
       (입력금액 / 유가) × 연비 = 주행가능 km 계산
     - 이후 날짜의 driven km 을 누적하여 해당 km 를 초과하는
       시점까지의 모든 행의 fuel 을 0 (공백)으로 처리
     - '소진 완료' 이후 날은 다시 추천값(null) 으로 복원
     ================================================================= */
  async function applyFuelExhaustion(startMonth, startIdx) {
    const vehicle   = await DB.Vehicles.getById(curVehicleId).catch(()=>null);
    const fuelEff   = Number(vehicle?.fuelEff)   || 0;
    const fuelPrice = Number(vehicle?.fuelPrice) || 0;
    if (!fuelEff || !fuelPrice) return;   // 연비/유가 없으면 처리 불가

    const startRow  = (yearData[startMonth]||{rows:[]}).rows[startIdx];
    if (!startRow) return;
    const fuelAmt   = Number(startRow.val.fuel) || 0;
    if (fuelAmt <= 0) {
      // 유류비를 0 또는 빈값으로 바꾼 경우 → 이후 소진 공백 전부 null(추천) 복원
      _restoreFuelFromRow(startMonth, startIdx + 1);
      return;
    }

    // 주행 가능 거리 (리터 환산 후 × 연비)
    const liters        = fuelAmt / fuelPrice;
    let   kmRemaining   = liters * fuelEff;
    let   exhausted     = false;   // 소진 완료 시점 지났는가

    // 전체 행 순서대로 순회 (startIdx 다음 행부터)
    let passedStart = false;
    for (let m = startMonth; m <= 12; m++) {
      const rows = (yearData[m] || {rows:[]}).rows;
      for (let i = 0; i < rows.length; i++) {
        // startIdx 다음부터 처리
        if (m === startMonth && i <= startIdx) { passedStart = true; continue; }
        if (!passedStart) continue;

        const row = rows[i];
        if (!exhausted) {
          // 아직 소진 중 → 이 날 유류비는 0 (공백)
          row.val.fuel = 0;
          // DOM 업데이트
          _updateFuelInput(m, i, 0, true /* isExhausted */);
          // km 차감
          const driven = Number(row.driven || 0);
          kmRemaining -= driven;
          if (kmRemaining <= 0) {
            exhausted = true;  // 이 날로 소진 완료
          }
        } else {
          // 소진 이후 → 추천값(null) 복원
          if (row.val.fuel === 0) {
            row.val.fuel = null;
            _updateFuelInput(m, i, null, false);
          }
          // 소진 후 다음 주유 입력이 있으면 거기서 멈춤
          if (row.val.fuel !== null && row.val.fuel > 0) break;
        }
        // 다음 주유 입력이 있으면 이 로직 중단 (다음 주유가 처리)
        if (!exhausted && row.val.fuel !== null && row.val.fuel > 0 && i !== startIdx) break;
      }
      passedStart = true;
    }

    // 월 합계 재계산 (변경된 모든 월)
    for (let m = startMonth; m <= 12; m++) updateMonthSum(m);
  }

  /* 특정 위치부터 fuel=0 인 행들을 null(추천값) 로 복원 */
  function _restoreFuelFromRow(startMonth, startIdx) {
    for (let m = startMonth; m <= 12; m++) {
      const rows = (yearData[m] || {rows:[]}).rows;
      const from  = (m === startMonth) ? startIdx : 0;
      for (let i = from; i < rows.length; i++) {
        const row = rows[i];
        if (row.val.fuel === 0) {
          row.val.fuel = null;
          _updateFuelInput(m, i, null, false);
        } else if (row.val.fuel > 0) {
          break;  // 다음 주유가 있으면 거기부터는 그 주유가 관리
        }
      }
      updateMonthSum(m);
    }
  }

  /* DOM의 fuel input 셀 업데이트 */
  function _updateFuelInput(month, idx, val, isExhausted) {
    const input = document.querySelector(
      `.cost-input[data-month="${month}"][data-idx="${idx}"][data-field="fuel"]`
    );
    if (!input) return;
    if (val === null) {
      // 추천값 복원
      const recVal = Number(input.dataset.rec) || 0;
      input.value = '';
      input.placeholder = recVal > 0 ? recVal.toLocaleString() : '';
      input.classList.remove('cost-input-entered', 'cost-input-exhausted');
      input.classList.add('cost-input-rec');
    } else if (isExhausted) {
      // 소진 공백 (0 = 진한 회색, 소진 표시)
      input.value = '';
      input.placeholder = '소진';
      input.classList.remove('cost-input-rec', 'cost-input-entered');
      input.classList.add('cost-input-exhausted');
    } else {
      input.value = val;
      input.classList.remove('cost-input-rec', 'cost-input-exhausted');
      input.classList.add('cost-input-entered');
    }
    // 1일 계 업데이트
    const row = (yearData[month]||{rows:[]}).rows[idx];
    if (!row) return;
    const total = ['fuel','repair','carTax','insurance','tollPark','loanInterest']
      .reduce((s,f) => {
        const v = row.val[f];
        return s + ((v!==null&&v!==undefined)?Number(v):Number(row.rec[f]||0));
      }, 0);
    const dailyEl = document.getElementById(`daily-${month}-${idx}`);
    if (dailyEl) dailyEl.textContent = fmt(total);
  }

  /* 비용 입력 변경 */
  function onCostChange(input) {
    const month = parseInt(input.dataset.month);
    const idx   = parseInt(input.dataset.idx);
    const field = input.dataset.field;
    if (!yearData[month] || !yearData[month].rows[idx]) return;

    const row = yearData[month].rows[idx];
    const newVal = input.value === '' ? null : Number(input.value);
    row.val[field] = newVal;

    // 유류비 입력 → 소진 로직 실행
    if (field === 'fuel') {
      // 입력 셀 스타일 즉시 반영
      if (newVal === null || newVal === 0) {
        input.classList.remove('cost-input-entered', 'cost-input-exhausted');
        input.classList.add('cost-input-rec');
      } else {
        input.classList.remove('cost-input-rec', 'cost-input-exhausted');
        input.classList.add('cost-input-entered');
      }
      applyFuelExhaustion(month, idx);
    }

    // 1일 계 업데이트
    const total = ['fuel','repair','carTax','insurance','tollPark','loanInterest']
      .reduce((s,f) => s + ((row.val[f]!==null&&row.val[f]!==undefined)?Number(row.val[f]):Number(row.rec[f]||0)), 0);
    const dailyEl = document.getElementById(`daily-${month}-${idx}`);
    if (dailyEl) dailyEl.textContent = fmt(total);

    // 합계 행 업데이트
    updateMonthSum(month);
  }

  /* 비고 변경 */
  function onMemoChange(input) {
    const month = parseInt(input.dataset.month);
    const idx   = parseInt(input.dataset.idx);
    if (!yearData[month] || !yearData[month].rows[idx]) return;
    yearData[month].rows[idx].memo = input.value;
  }

  /* 월 합계 재계산 */
  function updateMonthSum(month) {
    const rows = (yearData[month] || {}).rows || [];
    let sumFuel=0,sumRep=0,sumTax=0,sumIns=0,sumToll=0,sumLoan=0;
    rows.forEach(row => {
      const gv = f => (row.val[f]!==null&&row.val[f]!==undefined)?Number(row.val[f]):Number(row.rec[f]||0);
      sumFuel+=gv('fuel'); sumRep+=gv('repair'); sumTax+=gv('carTax');
      sumIns+=gv('insurance'); sumToll+=gv('tollPark'); sumLoan+=gv('loanInterest');
    });
    const total = sumFuel+sumRep+sumTax+sumIns+sumToll+sumLoan;

    const s = document.getElementById(`sum-row-${month}`);
    if (!s) return;
    const cells = s.querySelectorAll('td');
    if (cells[2]) cells[2].innerHTML = `<strong>${fmt(sumFuel)}</strong>`;
    if (cells[3]) cells[3].innerHTML = `<strong>${fmt(sumRep)}</strong>`;
    if (cells[4]) cells[4].innerHTML = `<strong>${fmt(sumTax)}</strong>`;
    if (cells[5]) cells[5].innerHTML = `<strong>${fmt(sumIns)}</strong>`;
    if (cells[6]) cells[6].innerHTML = `<strong>${fmt(sumToll)}</strong>`;
    if (cells[7]) cells[7].innerHTML = `<strong>${fmt(sumLoan)}</strong>`;
    if (cells[8]) cells[8].innerHTML = `<strong>${fmt(total)}</strong>`;

    // 헤더의 합계도 업데이트
    const hdr = document.querySelector(`#cost-block-${month} .cost-month-total strong`);
    if (hdr) hdr.textContent = `${fmt(total)}원`;
  }

  /* Tab 핸들러 일괄 등록 */
  function attachTabHandlers() {
    // 이미 onkeydown이 inline으로 붙어 있으므로 추가 작업 불필요
  }

  /* =================================================================
     주유 기록 & RECOMMEND 패널
     ================================================================= */
  async function renderFuelPanel(vehicleId, year) {
    const panel = document.getElementById('fuel-panel');
    const body  = document.getElementById('fuel-panel-body');
    if (!panel || !body) return;
    panel.style.display = 'block';

    const vehicle   = await DB.Vehicles.getById(vehicleId).catch(()=>null);
    const fuelEff   = Number(vehicle?.fuelEff)   || 0;
    const fuelPrice = Number(vehicle?.fuelPrice) || 0;
    // fuelLogs는 yearData[0]에 저장 (연간 주유 기록)
    const curFuelLogs = (yearData[0]?.fuelLogs) || [];

    // 연간 총 주행 km (운행일지 합산)
    let totalKm = 0;
    for (let m=1; m<=12; m++) {
      try {
        const ld = await DB.Logs.get(vehicleId, year, m);
        if (ld) totalKm += ld.rows.reduce((s,r)=>s+(r.driven||0),0);
      } catch{}
    }
    const totalFuelNeeded = fuelEff > 0 ? Math.ceil(totalKm / fuelEff) : 0;
    const totalFuelCost   = Math.round(totalFuelNeeded * fuelPrice);

    // 주유 기록 목록
    const logHtml = curFuelLogs.length ? curFuelLogs.map((fl, i) => `
      <tr>
        <td>${fl.date}</td>
        <td>${fmt(fl.amount)}원</td>
        <td>${fl.liters ? fmt(fl.liters)+'L' : fuelPrice>0 ? Math.round(fl.amount/fuelPrice)+'L(추정)' : '-'}</td>
        <td>${fl.odo ? fmt(fl.odo)+'km' : '-'}</td>
        <td style="color:#6b7280;font-size:12px;">${fl.memo||''}</td>
        <td><button class="btn btn-delete" style="padding:3px 8px;font-size:11px;" onclick="CostLedger.deleteFuelLog(${i})">삭제</button></td>
      </tr>`).join('') :
      '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:12px;">주유 기록 없음</td></tr>';

    // 다음 주유 예측
    let nextFuelHtml = '';
    if (curFuelLogs.length > 0 && fuelEff > 0) {
      const last = curFuelLogs[curFuelLogs.length-1];
      const lastLiters = last.liters || (fuelPrice>0 ? last.amount/fuelPrice : 0);
      const kmPerFull  = Math.round(lastLiters * fuelEff);
      nextFuelHtml = `<div class="fuel-recommend-box">
        <strong>⛽ 다음 주유 예측</strong>
        <span>마지막 주유: ${last.date} (${fmt(last.amount)}원 / ${Math.round(lastLiters)}L)</span>
        <span>연비 ${fuelEff}km/L → <strong>약 ${fmt(kmPerFull)}km</strong> 후 주유 예상</span>
        ${last.odo ? `<span>다음 주유 예상 누적거리: <strong>${fmt(Number(last.odo)+kmPerFull)}km</strong></span>` : ''}
      </div>`;
    } else if (fuelEff > 0 && totalKm > 0) {
      nextFuelHtml = `<div class="fuel-recommend-box">
        <strong>⛽ 연간 주유 추산 (RECOMMEND)</strong>
        <span>연간 총 주행: <strong>${fmt(totalKm)}km</strong> | 연비: ${fuelEff}km/L</span>
        <span>필요 유량: <strong>약 ${fmt(totalFuelNeeded)}L</strong> | 예상 유류비: <strong>${fmt(totalFuelCost)}원</strong></span>
        <small style="color:#6b7280;">* 실제 주유 기록을 입력하면 정확한 예측이 가능합니다</small>
      </div>`;
    }

    body.innerHTML = `
      ${nextFuelHtml}
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;margin-top:10px;">
        <div class="form-group inline" style="min-width:90px;">
          <label>날짜</label>
          <input type="date" id="fl-date" value="${new Date().toISOString().slice(0,10)}" style="padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:13px;" />
        </div>
        <div class="form-group inline" style="min-width:100px;">
          <label>주유금액 (원)</label>
          <input type="number" id="fl-amount" placeholder="예: 50000" min="0" style="padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:13px;width:110px;" />
        </div>
        <div class="form-group inline" style="min-width:80px;">
          <label>리터 (L, 선택)</label>
          <input type="number" id="fl-liters" placeholder="자동계산" min="0" step="0.1" style="padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:13px;width:100px;" />
        </div>
        <div class="form-group inline" style="min-width:90px;">
          <label>주유시 누적(km)</label>
          <input type="number" id="fl-odo" placeholder="선택" min="0" style="padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:13px;width:110px;" />
        </div>
        <div class="form-group inline" style="min-width:100px;">
          <label>메모</label>
          <input type="text" id="fl-memo" placeholder="주유소명 등" maxlength="30" style="padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:13px;width:120px;" />
        </div>
        <button class="btn btn-success" onclick="CostLedger.addFuelLog()">+ 주유 기록 추가</button>
      </div>
      <table class="data-table" style="font-size:12px;">
        <thead><tr><th>날짜</th><th>금액</th><th>리터</th><th>누적km</th><th>메모</th><th>삭제</th></tr></thead>
        <tbody>${logHtml}</tbody>
      </table>`;
  }

  /* 주유 기록 추가 */
  async function addFuelLog() {
    const date   = document.getElementById('fl-date').value;
    const amount = parseInt(document.getElementById('fl-amount').value) || 0;
    const liters = parseFloat(document.getElementById('fl-liters').value) || null;
    const odo    = parseInt(document.getElementById('fl-odo').value) || null;
    const memo   = document.getElementById('fl-memo').value.trim();

    if (!amount) { App.toast('주유금액을 입력하세요.', 'error'); return; }
    if (!yearData[0]) yearData[0] = { fuelLogs: [] };
    const logs = yearData[0].fuelLogs || [];
    logs.push({ date, amount, liters, odo, memo });
    logs.sort((a,b) => a.date.localeCompare(b.date));
    yearData[0].fuelLogs = logs;
    await renderFuelPanel(curVehicleId, curYear);
    App.toast('주유 기록 추가됨 (저장 버튼을 눌러 저장하세요)', 'success');
  }

  async function deleteFuelLog(idx) {
    if (!yearData[0]?.fuelLogs) return;
    yearData[0].fuelLogs.splice(idx, 1);
    await renderFuelPanel(curVehicleId, curYear);
    App.toast('주유 기록 삭제됨', 'default');
  }

  /* =================================================================
     불러오기
     ================================================================= */
  async function loadCostData() {
    const vehicleId = document.getElementById('cost-vehicle').value;
    const year      = parseInt(document.getElementById('cost-year').value);
    if (!vehicleId) { App.toast('차량을 선택해주세요.', 'error'); return; }

    curVehicleId = vehicleId;
    curYear      = year;

    App.showLoading(`${year}년 비용 명세서 불러오는 중...`, {progress:true, sub:'데이터 초기화 중...'});
    App.updateProgress(5, '연간 데이터 초기화 중...');
    await new Promise(r=>setTimeout(r,30));

    try {
      yearData = await initYearData(vehicleId, year);
      App.updateProgress(45, '화면 렌더링 중...');
      await new Promise(r=>setTimeout(r,30));

      await renderAll();
      App.updateProgress(80, '주유 패널 불러오는 중...');
      await new Promise(r=>setTimeout(r,30));

      await renderFuelPanel(vehicleId, year);
      App.updateProgress(100, '완료!');
      await new Promise(r=>setTimeout(r,350));

      App.hideLoading();
      App.toast(`${year}년 비용 명세서 로드 완료!`, 'success');
    } catch(e) {
      App.hideLoading();
      App.toast('불러오기 실패: ' + e.message, 'error');
    }
  }

  /* 전체 yearData 에서 fuel > 0 인 첫 입력 행부터 소진 로직 재적용 */
  function _reapplyAllFuelExhaustion() {
    for (let m = 1; m <= 12; m++) {
      const rows = (yearData[m] || {rows:[]}).rows;
      for (let i = 0; i < rows.length; i++) {
        const fv = rows[i].val && rows[i].val.fuel;
        if (fv !== null && fv !== undefined && Number(fv) > 0) {
          applyFuelExhaustion(m, i);
        }
      }
    }
  }

  /* =================================================================
     저장
     ================================================================= */
  async function saveCostData() {
    if (!curVehicleId) { App.toast('먼저 불러오기를 눌러주세요.', 'error'); return; }
    // yearData를 직렬화 가능한 형태로 변환
    const toSave = {};
    // 주유기록 (yearData[0])
    if (yearData[0]) {
      toSave[0] = { fuelLogs: yearData[0].fuelLogs || [] };
    }
    for (let m = 1; m <= 12; m++) {
      if (!yearData[m]) continue;
      toSave[m] = {
        rows: yearData[m].rows.map(r => ({
          rowKey:   r.rowKey,
          date:     r.date,
          dateNum:  r.dateNum,
          rowType:  r.rowType,
          memo:     r.memo,
          val:      r.val,
          receipts: r.receipts || []
        }))
      };
    }
    App.showLoading(`${curYear}년 비용 명세서 저장 중...`);
    DB.CostData.save(curVehicleId, curYear, toSave).then(()=>{
      App.hideLoading();
      App.toast(`${curYear}년 비용 명세서 저장 완료!`, 'success');
    }).catch(e => { App.hideLoading(); App.toast('저장 실패: '+e.message,'error'); });
  }

  /* =================================================================
     영수증 모달
     ================================================================= */
  function openReceiptModal(month, rowIdx) {
    if (!yearData[month] || !yearData[month].rows[rowIdx]) return;
    const row   = yearData[month].rows[rowIdx];
    receiptCtx  = { month, rowIdx, rowKey: row.rowKey };

    // 기존 첨부 미리보기
    const previewList = document.getElementById('receipt-preview-list');
    if (previewList) renderReceiptPreviews(row.receipts || []);

    document.getElementById('receipt-modal').style.display = 'flex';
  }

  function renderReceiptPreviews(files) {
    const el = document.getElementById('receipt-preview-list');
    if (!el) return;
    if (!files.length) {
      el.innerHTML = '<span style="color:#9ca3af;font-size:13px;">첨부된 영수증 없음</span>';
      return;
    }
    el.innerHTML = files.map((f,i) => `
      <div class="receipt-thumb" style="position:relative;">
        ${f.type === 'application/pdf'
          ? `<div style="width:80px;height:80px;background:#fee2e2;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:11px;font-weight:700;color:#dc2626;">PDF</div>`
          : `<img src="${f.data}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid #d1d5db;" />`
        }
        <button onclick="CostLedger.deleteReceiptItem(${i})"
          style="position:absolute;top:-6px;right:-6px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;line-height:1;">✕</button>
        <div style="font-size:10px;text-align:center;color:#6b7280;margin-top:2px;">${f.name||'파일'}</div>
      </div>`).join('');
  }

  function deleteReceiptItem(idx) {
    const { month, rowIdx } = receiptCtx;
    if (!yearData[month]) return;
    const row = yearData[month].rows[rowIdx];
    if (!row) return;
    row.receipts.splice(idx, 1);
    renderReceiptPreviews(row.receipts);
  }

  function handleReceiptFiles(fileList) {
    const { month, rowIdx } = receiptCtx;
    if (!yearData[month] || !yearData[month].rows[rowIdx]) return;
    const row = yearData[month].rows[rowIdx];
    if (!row.receipts) row.receipts = [];

    Array.from(fileList).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        row.receipts.push({ name: file.name, type: file.type, data: e.target.result });
        renderReceiptPreviews(row.receipts);
      };
      reader.readAsDataURL(file);
    });
  }

  function saveReceiptModal() {
    const { month, rowIdx, rowKey } = receiptCtx;
    if (!yearData[month] || !yearData[month].rows[rowIdx]) return;
    const receipts = yearData[month].rows[rowIdx].receipts || [];
    // LocalStorage에도 별도 저장
    DB.CostData.saveReceipt(curVehicleId, curYear, month, rowKey, receipts);
    document.getElementById('receipt-modal').style.display = 'none';
    // 버튼 업데이트
    renderAll(); // 영수증 뱃지 반영 위해 재렌더 (가벼운 경우)
    App.toast('영수증 저장됨', 'success');
  }

  /* =================================================================
     연도 셀렉트 초기화
     ================================================================= */
  function initYearSelect() {
    const sel = document.getElementById('cost-year');
    if (!sel) return;
    const now = new Date();
    sel.innerHTML = '';
    for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 2; y++) {
      const o = document.createElement('option');
      o.value = y; o.textContent = `${y}년`;
      if (y === now.getFullYear()) o.selected = true;
      sel.appendChild(o);
    }
  }

  /* =================================================================
     init
     ================================================================= */
  function init() {
    initYearSelect();

    document.getElementById('btn-cost-load').addEventListener('click', loadCostData);
    document.getElementById('btn-cost-save').addEventListener('click', saveCostData);
    document.getElementById('btn-cost-excel').addEventListener('click', () => {
      if (typeof CostExport !== 'undefined') CostExport.exportCostYear(curVehicleId, curYear);
    });
    document.getElementById('btn-cost-pdf').addEventListener('click', () => {
      if (typeof CostExport !== 'undefined') CostExport.exportCostPDF();
    });

    // 영수증 모달
    const receiptModal = document.getElementById('receipt-modal');
    document.getElementById('receipt-modal-close').addEventListener('click', () => receiptModal.style.display='none');
    document.getElementById('receipt-modal-cancel').addEventListener('click', () => receiptModal.style.display='none');
    document.getElementById('receipt-modal-save').addEventListener('click', saveReceiptModal);

    document.getElementById('receipt-upload-file').addEventListener('change', e => handleReceiptFiles(e.target.files));
    document.getElementById('receipt-camera').addEventListener('change', e => handleReceiptFiles(e.target.files));
  }

  /* =================================================================
     외부 접근
     ================================================================= */
  function getCurVehicleId() { return curVehicleId; }
  function getCurYear()      { return curYear; }
  function getYearData()     { return yearData; }

  // costexport.js 에서 사용하는 calcCostSum (월별 rows 기준)
  function calcCostSum(rows) {
    let fuel=0,repair=0,carTax=0,insurance=0,tollPark=0,loanInterest=0;
    rows.forEach(row => {
      const gv = f => (row.val[f]!==null&&row.val[f]!==undefined)?Number(row.val[f]):Number(row.rec[f]||0);
      fuel+=gv('fuel'); repair+=gv('repair'); carTax+=gv('carTax');
      insurance+=gv('insurance'); tollPark+=gv('tollPark'); loanInterest+=gv('loanInterest');
    });
    const daily = fuel+repair+carTax+insurance+tollPark+loanInterest;
    return { fuel, repair, carTax, insurance, tollPark, loanInterest, daily };
  }

  // costexport.js 호환용
  function buildCostRows(vehicleId, year, month, annualCosts) {
    return buildRecommendRows(vehicleId, year, month);
  }

  return {
    init,
    loadCostData, saveCostData,
    onCostChange, onMemoChange, onTabAccept,
    addFuelLog, deleteFuelLog,
    openReceiptModal, deleteReceiptItem, saveReceiptModal,
    renderFuelPanel,
    getCurVehicleId, getCurYear, getYearData,
    calcCostSum, buildCostRows,
    CostDB: () => DB.CostData
  };
})();
