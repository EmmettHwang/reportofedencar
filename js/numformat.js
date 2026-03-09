/* =====================================================
   numformat.js - 숫자 입력칸 콤마 표시 + 운전면허 자동 하이픈
   모든 number 타입 input에 적용:
     - 포커스 시: 콤마 제거 (편집)
     - 블러 시: 천단위 콤마 표시 (display용 text input)
   실제 저장값은 숫자 그대로 (hidden 또는 dataset).

   운전면허 번호: dd-dd-dddddd-dd 형식 자동 포맷
   ===================================================== */

(function () {
  /* --------------------------------------------------
     숫자 콤마 포맷 (number input을 text처럼 보이게)
     - type="number" 는 콤마 표시 불가 → text로 변환 후 처리
     - data-numeric="true" 속성으로 식별
  -------------------------------------------------- */

  /**
   * 값에서 숫자만 추출
   */
  function rawNum(val) {
    return val.replace(/[^0-9.]/g, '');
  }

  /**
   * 정수 문자열에 천단위 콤마 적용
   */
  function addComma(val) {
    const clean = rawNum(val);
    if (!clean) return '';
    const parts = clean.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  /**
   * number input 하나를 콤마 표시 text input으로 래핑
   */
  function convertNumericInput(input) {
    // 이미 처리된 경우 skip
    if (input.dataset.numFormatted === '1') return;
    // data-no-comma 속성이 있으면 콤마 포맷 적용 안 함 (연식·거리·횟수 등)
    if (input.dataset.noComma !== undefined) return;
    input.dataset.numFormatted = '1';

    // hidden input에 실제 값 저장 (기존 id → hidden으로 이동)
    const origId   = input.id;
    const origName = input.name;
    const origVal  = input.value;
    const min      = input.getAttribute('min');
    const max      = input.getAttribute('max');
    const step     = input.getAttribute('step');
    const placeholder = input.getAttribute('placeholder') || '';
    const cls      = input.className;

    // hidden input 생성
    const hidden = document.createElement('input');
    hidden.type  = 'hidden';
    hidden.id    = origId;          // 기존 id는 hidden으로
    if (origName) hidden.name = origName;
    hidden.value = origVal;
    input.removeAttribute('id');
    input.removeAttribute('name');

    // type을 text로 변경
    input.type        = 'text';
    input.inputMode   = 'numeric';
    input.id          = origId + '_display';
    input.placeholder = placeholder ? addComma(placeholder) : '';
    input.value       = origVal ? addComma(origVal) : '';
    input.setAttribute('autocomplete', 'off');

    // hidden을 input 바로 앞에 삽입
    input.parentNode.insertBefore(hidden, input);

    // 포커스: 콤마 제거
    input.addEventListener('focus', () => {
      input.value = rawNum(input.value);
    });

    // 블러: 콤마 추가 + hidden 업데이트
    input.addEventListener('blur', () => {
      const num = rawNum(input.value);
      input.value  = num ? addComma(num) : '';
      hidden.value = num || '';
      // 유효성 체크 (min/max)
      if (num && min !== null && parseFloat(num) < parseFloat(min)) {
        input.style.borderColor = '#dc2626';
      } else {
        input.style.borderColor = '';
      }
    });

    // 입력 중: 숫자/점 이외 문자 제거
    input.addEventListener('input', () => {
      const pos   = input.selectionStart;
      const clean = rawNum(input.value);
      input.value  = clean;
      hidden.value = clean;
      try { input.setSelectionRange(pos, pos); } catch(e) {}
    });

    // 값 변경 이벤트 연동 (onChange가 있을 경우 onchange를 hidden에도)
    const oc = input.getAttribute('onchange');
    if (oc) {
      // onchange를 display input에서 제거하고 blur 시 hidden에 dispatch
      input.removeAttribute('onchange');
      input.addEventListener('blur', () => {
        const ev = new Event('change', { bubbles: true });
        hidden.dispatchEvent(ev);
      });
    }
  }

  /* --------------------------------------------------
     운전면허 번호 자동 하이픈: dd-dd-dddddd-dd
  -------------------------------------------------- */
  function formatLicense(input) {
    if (input.dataset.licFormatted === '1') return;
    input.dataset.licFormatted = '1';

    input.addEventListener('input', () => {
      let val = input.value.replace(/[^0-9]/g, '');
      if (val.length > 12) val = val.slice(0, 12);
      let result = '';
      if (val.length <= 2)      result = val;
      else if (val.length <= 4) result = val.slice(0,2) + '-' + val.slice(2);
      else if (val.length <= 10) result = val.slice(0,2) + '-' + val.slice(2,4) + '-' + val.slice(4);
      else result = val.slice(0,2) + '-' + val.slice(2,4) + '-' + val.slice(4,10) + '-' + val.slice(10);
      input.value = result;
    });
  }

  /* --------------------------------------------------
     전체 적용 (DOM 준비 후 + MutationObserver로 동적 요소도 처리)
  -------------------------------------------------- */
  function applyAll(root) {
    root = root || document;
    // number input을 text로 전환
    root.querySelectorAll('input[type="number"]:not([data-no-comma])').forEach(input => {
      convertNumericInput(input);
    });
    // 운전면허 번호 필드
    root.querySelectorAll('#v-driver1-license_display, #v-driver2-license_display, [id*="license"]:not([type="file"])').forEach(input => {
      if (input.type === 'text') formatLicense(input);
    });
  }

  // DOM 로드 후 적용
  document.addEventListener('DOMContentLoaded', () => {
    applyAll(document);

    // 동적으로 추가되는 요소 감지
    const observer = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.tagName === 'INPUT' && node.type === 'number') {
            convertNumericInput(node);
          }
          node.querySelectorAll && node.querySelectorAll('input[type="number"]').forEach(convertNumericInput);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  // 전역 노출 (필요 시 수동 호출)
  window.NumFormat = { applyAll, addComma, rawNum };
})();
