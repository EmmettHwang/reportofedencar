/* =====================================================
   client.js - 거래처 CRUD
   ===================================================== */

const ClientManager = (() => {
  let editId = null;

  function render() {
    const list = DB.Clients.getAll();
    const tbody = document.getElementById('client-tbody');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-row">등록된 거래처가 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((c, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${c.name}</strong></td>
        <td>${c.distance} km</td>
        <td>± ${c.variance || 0} km</td>
        <td>월 ${c.visits}회</td>
        <td>${c.memo || '-'}</td>
        <td>
          <button class="btn btn-edit" onclick="ClientManager.edit('${c.id}')">✏️ 수정</button>
          <button class="btn btn-delete" onclick="ClientManager.remove('${c.id}')">🗑️ 삭제</button>
        </td>
      </tr>
    `).join('');
  }

  function showForm(show) {
    document.getElementById('client-form-card').style.display = show ? 'block' : 'none';
  }

  function clearForm() {
    ['c-name','c-distance','c-variance','c-visits','c-memo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = id === 'c-variance' ? '0' : '';
    });
    editId = null;
    document.getElementById('client-form-title').textContent = '거래처 등록';
  }

  function init() {
    document.getElementById('btn-add-client').addEventListener('click', () => {
      clearForm();
      showForm(true);
      document.getElementById('c-name').focus();
    });

    document.getElementById('btn-cancel-client').addEventListener('click', () => {
      clearForm();
      showForm(false);
    });

    document.getElementById('btn-save-client').addEventListener('click', () => {
      const name     = document.getElementById('c-name').value.trim();
      const distance = parseFloat(document.getElementById('c-distance').value);
      const variance = parseFloat(document.getElementById('c-variance').value) || 0;
      const visits   = parseInt(document.getElementById('c-visits').value);
      const memo     = document.getElementById('c-memo').value.trim();

      if (!name)           { App.toast('거래처명을 입력해주세요.', 'error'); return; }
      if (!distance || distance <= 0) { App.toast('왕복거리를 올바르게 입력해주세요.', 'error'); return; }
      if (!visits || visits <= 0)     { App.toast('월 방문횟수를 올바르게 입력해주세요.', 'error'); return; }
      if (visits > 22) { App.toast('월 방문횟수는 22회 이하로 입력해주세요.', 'error'); return; }

      const data = { name, distance, variance, visits, memo };

      if (editId) {
        DB.Clients.update(editId, data);
        App.toast('거래처 정보가 수정되었습니다.', 'success');
      } else {
        DB.Clients.add(data);
        App.toast('거래처가 등록되었습니다.', 'success');
      }

      clearForm();
      showForm(false);
      render();
    });

    render();
  }

  function edit(id) {
    const c = DB.Clients.getById(id);
    if (!c) return;
    editId = id;
    document.getElementById('c-name').value     = c.name;
    document.getElementById('c-distance').value = c.distance;
    document.getElementById('c-variance').value = c.variance || 0;
    document.getElementById('c-visits').value   = c.visits;
    document.getElementById('c-memo').value     = c.memo || '';
    document.getElementById('client-form-title').textContent = '거래처 수정';
    showForm(true);
    document.getElementById('c-name').focus();
    document.getElementById('client-form-card').scrollIntoView({ behavior: 'smooth' });
  }

  function remove(id) {
    const c = DB.Clients.getById(id);
    if (!c) return;
    App.confirm(`"${c.name}" 거래처를 삭제하시겠습니까?`, () => {
      DB.Clients.delete(id);
      render();
      App.toast('거래처가 삭제되었습니다.');
    });
  }

  return { init, render, edit, remove };
})();
