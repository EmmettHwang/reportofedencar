/* =====================================================
   db.js - LocalStorage 기반 데이터 저장소
   ===================================================== */

const DB = (() => {
  const KEYS = {
    vehicles:  'driveLog_vehicles',
    clients:   'driveLog_clients',
    settings:  'driveLog_settings',
    logs:      'driveLog_logs',      // { [vehicleId_YYYYMM]: rows[] }
  };

  // ---- 기본 CRUD 헬퍼 ----
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  }
  function loadObj(key, def = {}) {
    try { return JSON.parse(localStorage.getItem(key)) || def; }
    catch { return def; }
  }
  function save(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---- 차량 ----
  const Vehicles = {
    getAll: () => load(KEYS.vehicles),
    getById: (id) => load(KEYS.vehicles).find(v => v.id === id) || null,
    add(data) {
      const list = load(KEYS.vehicles);
      const item = { id: genId(), ...data, createdAt: new Date().toISOString() };
      list.push(item);
      save(KEYS.vehicles, list);
      return item;
    },
    update(id, data) {
      const list = load(KEYS.vehicles).map(v => v.id === id ? { ...v, ...data } : v);
      save(KEYS.vehicles, list);
    },
    delete(id) {
      save(KEYS.vehicles, load(KEYS.vehicles).filter(v => v.id !== id));
    }
  };

  // ---- 거래처 ----
  const Clients = {
    getAll: () => load(KEYS.clients),
    getById: (id) => load(KEYS.clients).find(c => c.id === id) || null,
    add(data) {
      const list = load(KEYS.clients);
      const item = { id: genId(), ...data, createdAt: new Date().toISOString() };
      list.push(item);
      save(KEYS.clients, list);
      return item;
    },
    update(id, data) {
      const list = load(KEYS.clients).map(c => c.id === id ? { ...c, ...data } : c);
      save(KEYS.clients, list);
    },
    delete(id) {
      save(KEYS.clients, load(KEYS.clients).filter(c => c.id !== id));
    }
  };

  // ---- 설정 ----
  const Settings = {
    get: () => loadObj(KEYS.settings, {
      commuteDist: 22,
      commuteVariance: 2,
      commuteDaysPerWeek: 2,
      annualKm: 7000,
      vehicleId: '',
      fixSeed: false,
      commuteSpread: 'random',
      includeSat: false
    }),
    save: (data) => save(KEYS.settings, data)
  };

  // ---- 운행 로그 ----
  const Logs = {
    _key: (vehicleId, year, month) => `${KEYS.logs}_${vehicleId}_${year}_${String(month).padStart(2,'0')}`,

    save(vehicleId, year, month, rows, meta = {}) {
      const key = this._key(vehicleId, year, month);
      const data = {
        vehicleId, year, month, rows,
        savedAt: new Date().toISOString(),
        ...meta
      };
      localStorage.setItem(key, JSON.stringify(data));
      // 인덱스 갱신
      const idx = loadObj(KEYS.logs + '_index', []);
      const idxKey = `${vehicleId}_${year}_${String(month).padStart(2,'0')}`;
      const exists = idx.findIndex(i => i.key === idxKey);
      const summary = {
        key: idxKey,
        vehicleId, year, month,
        totalKm:    rows.reduce((s,r) => s + (Number(r.driven) || 0), 0),
        commuteKm:  rows.reduce((s,r) => s + (Number(r.commute) || 0), 0),
        bizKm:      rows.reduce((s,r) => s + (Number(r.biz) || 0), 0),
        savedAt:    data.savedAt,
        ...meta
      };
      if (exists >= 0) idx[exists] = summary;
      else idx.push(summary);
      save(KEYS.logs + '_index', idx);
    },

    get(vehicleId, year, month) {
      const key = this._key(vehicleId, year, month);
      try { return JSON.parse(localStorage.getItem(key)) || null; }
      catch { return null; }
    },

    getAllIndex: () => loadObj(KEYS.logs + '_index', []),

    delete(vehicleId, year, month) {
      const key = this._key(vehicleId, year, month);
      localStorage.removeItem(key);
      const idxKey = `${vehicleId}_${year}_${String(month).padStart(2,'0')}`;
      const idx = loadObj(KEYS.logs + '_index', []).filter(i => i.key !== idxKey);
      save(KEYS.logs + '_index', idx);
    }
  };

  return { Vehicles, Clients, Settings, Logs };
})();
