/* =====================================================
   vehicle.js - 차량 CRUD
   ===================================================== */

const VehicleManager = (() => {
  let editId = null;

  function render() {
    const list = DB.Vehicles.getAll();
    const tbody = document.getElementById('vehicle-tbody');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-row">등록된 차량이 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((v, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${v.regno}</strong></td>
        <td>${v.model}</td>
        <td>${v.year || '-'}</td>
        <td>${Number(v.odometer).toLocaleString()} km</td>
        <td>${v.memo || '-'}</td>
        <td>
          <button class="btn btn-edit" onclick="VehicleManager.edit('${v.id}')">✏️ 수정</button>
          <button class="btn btn-delete" onclick="VehicleManager.remove('${v.id}')">🗑️ 삭제</button>
        </td>
      </tr>
    `).join('');
  }

  function showForm(show) {
    document.getElementById('vehicle-form-card').style.display = show ? 'block' : 'none';
  }

  function clearForm() {
    ['v-regno','v-model','v-year','v-odometer','v-memo'].forEach(id => {
      document.getElementById(id).value = '';
    });
    editId = null;
    document.getElementById('vehicle-form-title').textContent = '차량 등록';
  }

  function init() {
    document.getElementById('btn-add-vehicle').addEventListener('click', () => {
      clearForm();
      showForm(true);
      document.getElementById('v-regno').focus();
    });

    document.getElementById('btn-cancel-vehicle').addEventListener('click', () => {
      clearForm();
      showForm(false);
    });

    document.getElementById('btn-save-vehicle').addEventListener('click', () => {
      const regno    = document.getElementById('v-regno').value.trim();
      const model    = document.getElementById('v-model').value.trim();
      const year     = document.getElementById('v-year').value.trim();
      const odometer = document.getElementById('v-odometer').value.trim();
      const memo     = document.getElementById('v-memo').value.trim();

      if (!regno) { App.toast('차량등록번호를 입력해주세요.', 'error'); return; }
      if (!model) { App.toast('차종을 입력해주세요.', 'error'); return; }
      if (!odometer) { App.toast('현재 누적주행거리를 입력해주세요.', 'error'); return; }

      // 중복 체크 (수정 시 본인 제외)
      const dup = DB.Vehicles.getAll().find(v => v.regno === regno && v.id !== editId);
      if (dup) { App.toast('이미 등록된 차량번호입니다.', 'error'); return; }

      const data = { regno, model, year: Number(year), odometer: Number(odometer), memo };

      if (editId) {
        DB.Vehicles.update(editId, data);
        App.toast('차량 정보가 수정되었습니다.', 'success');
      } else {
        DB.Vehicles.add(data);
        App.toast('차량이 등록되었습니다.', 'success');
      }

      clearForm();
      showForm(false);
      render();
      App.refreshVehicleSelects();
    });

    render();
  }

  function edit(id) {
    const v = DB.Vehicles.getById(id);
    if (!v) return;
    editId = id;
    document.getElementById('v-regno').value    = v.regno;
    document.getElementById('v-model').value    = v.model;
    document.getElementById('v-year').value     = v.year || '';
    document.getElementById('v-odometer').value = v.odometer;
    document.getElementById('v-memo').value     = v.memo || '';
    document.getElementById('vehicle-form-title').textContent = '차량 수정';
    showForm(true);
    document.getElementById('v-regno').focus();
    document.getElementById('vehicle-form-card').scrollIntoView({ behavior: 'smooth' });
  }

  function remove(id) {
    const v = DB.Vehicles.getById(id);
    if (!v) return;
    App.confirm(`"${v.regno} (${v.model})" 차량을 삭제하시겠습니까?\n관련 운행일지 데이터도 함께 삭제됩니다.`, () => {
      DB.Vehicles.delete(id);
      render();
      App.refreshVehicleSelects();
      App.toast('차량이 삭제되었습니다.');
    });
  }

  return { init, render, edit, remove };
})();
