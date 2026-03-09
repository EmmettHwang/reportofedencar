/* =====================================================
   db.js v3 - REST API 기반 (MariaDB 백엔드)
   LocalStorage 완전 제거 → /api/* 호출
   ===================================================== */

const DB = (() => {

  /* ─── 공통 fetch 래퍼 ─── */
  async function api(method, url, body) {
    const opt = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opt.body = JSON.stringify(body);
    const res = await fetch(url, opt);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'API Error');
    return json.data;
  }
  const GET    = url       => api('GET',    url);
  const POST   = (url, b)  => api('POST',   url, b);
  const PUT    = (url, b)  => api('PUT',    url, b);
  const DELETE = url       => api('DELETE', url);

  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

  /* ─────────────────────────────────────────
     Vehicles
  ───────────────────────────────────────── */
  const Vehicles = {
    async getAll()      { return await GET('/api/vehicles'); },
    async getById(id)   { try { return await GET(`/api/vehicles/${id}`); } catch { return null; } },
    async add(data)     { return await POST('/api/vehicles', { id: genId(), ...data }); },
    async update(id, d) { await PUT(`/api/vehicles/${id}`, d); return { id, ...d }; },
    async delete(id)    { await DELETE(`/api/vehicles/${id}`); },

    /* 서류 */
    async saveDoc(vehicleId, docType, fileObj) {
      await POST(`/api/vehicles/${vehicleId}/docs/${docType}`, fileObj);
    },
    async getDoc(vehicleId, docType) {
      try { return await GET(`/api/vehicles/${vehicleId}/docs/${docType}`); } catch { return null; }
    },
    async deleteDoc(vehicleId, docType) {
      try { await DELETE(`/api/vehicles/${vehicleId}/docs/${docType}`); } catch {}
    },
  };

  /* ─────────────────────────────────────────
     Clients
  ───────────────────────────────────────── */
  const Clients = {
    async getAll()      { return await GET('/api/clients'); },
    async getById(id)   { try { return await GET(`/api/clients/${id}`); } catch { return null; } },
    async add(data)     { return await POST('/api/clients', { id: genId(), ...data }); },
    async update(id, d) { await PUT(`/api/clients/${id}`, d); return { id, ...d }; },
    async delete(id)    { await DELETE(`/api/clients/${id}`); },

    /* 거래처 서류 */
    async saveDoc(clientId, docType, fileObj) {
      await POST(`/api/clients/${clientId}/docs/${docType}`, fileObj);
    },
    async getDoc(clientId, docType) {
      try { return await GET(`/api/clients/${clientId}/docs/${docType}`); } catch { return null; }
    },
    async deleteDoc(clientId, docType) {
      try { await DELETE(`/api/clients/${clientId}/docs/${docType}`); } catch {}
    },
  };

  /* ─────────────────────────────────────────
     Settings (차량별)
  ───────────────────────────────────────── */
  const Settings = {
    _default() {
      return {
        commuteDist: 22, commuteVariance: 2, commuteDaysPerWeek: 2,
        annualKm: 7000, fixSeed: true, commuteSpread: 'random',
        includeSat: false, commuteToll: 0, selectedClientIds: []
      };
    },
    async get(vehicleId) {
      if (!vehicleId) return this._default();
      try {
        const s = await GET(`/api/settings/${vehicleId}`);
        return s || this._default();
      } catch { return this._default(); }
    },
    async save(vehicleId, data) {
      if (!vehicleId) return;
      await POST(`/api/settings/${vehicleId}`, data);
    },
  };

  /* ─────────────────────────────────────────
     Logs
  ───────────────────────────────────────── */
  const Logs = {
    async save(vehicleId, year, month, rows, meta = {}) {
      await POST(`/api/logs/${vehicleId}/${year}/${month}`, { rows, ...meta });
    },
    async get(vehicleId, year, month) {
      try { return await GET(`/api/logs/${vehicleId}/${year}/${month}`); } catch { return null; }
    },
    async getAllIndex() {
      try { return await GET('/api/logs/index'); } catch { return []; }
    },
    async getYearIndex(vehicleId, year) {
      try { return await GET(`/api/logs/index/${vehicleId}/${year}`); } catch { return []; }
    },
    async delete(vehicleId, year, month) {
      try { await DELETE(`/api/logs/${vehicleId}/${year}/${month}`); } catch {}
    },
  };

  /* ─────────────────────────────────────────
     CostData
  ───────────────────────────────────────── */
  const CostData = {
    async save(vehicleId, year, data) {
      await POST(`/api/costdata/${vehicleId}/${year}`, { data });
    },
    async get(vehicleId, year) {
      try { return await GET(`/api/costdata/${vehicleId}/${year}`); } catch { return null; }
    },

    /* 연간 고정비 */
    async saveAnnual(vehicleId, year, data) {
      await POST(`/api/annual-costs/${vehicleId}/${year}`, data);
    },
    async getAnnual(vehicleId, year) {
      try { return await GET(`/api/annual-costs/${vehicleId}/${year}`); }
      catch { return { carTax:0, insurance:0, loanInterest:0, repairMonthly:0 }; }
    },

    /* 주유 기록 - costData.data 내에 포함 (별도 API 불필요) */
    async saveFuelLog(vehicleId, year, month, logs) {
      const cd = await this.get(vehicleId, year) || { data: {} };
      if (!cd.data) cd.data = {};
      if (!cd.data[month]) cd.data[month] = {};
      cd.data[month].fuelLogs = logs;
      await this.save(vehicleId, year, cd.data);
    },
    async getFuelLogs(vehicleId, year, month) {
      try {
        const cd = await this.get(vehicleId, year);
        return (cd?.data?.[month]?.fuelLogs) || [];
      } catch { return []; }
    },

    /* 영수증 */
    async saveReceipt(vehicleId, year, month, rowKey, fileObj) {
      await POST(`/api/receipts/${vehicleId}/${year}/${month}/${rowKey}`, fileObj);
    },
    async getReceipt(vehicleId, year, month, rowKey) {
      try { return await GET(`/api/receipts/${vehicleId}/${year}/${month}/${rowKey}`); }
      catch { return null; }
    },
    async deleteReceipt(vehicleId, year, month, rowKey) {
      try { await DELETE(`/api/receipts/${vehicleId}/${year}/${month}/${rowKey}`); } catch {}
    },
  };

  /* ─────────────────────────────────────────
     헬스 체크 (앱 시작 시 DB 연결 확인)
  ───────────────────────────────────────── */
  async function checkHealth() {
    try {
      await GET('/api/health');
      return true;
    } catch { return false; }
  }

  return { Vehicles, Clients, Settings, Logs, CostData, checkHealth, genId };
})();
