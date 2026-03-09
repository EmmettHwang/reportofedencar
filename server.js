/* =====================================================
   server.js - Express + MariaDB API 서버
   (주)이든푸드 인트라넷 + 차량 운행기록부 v3.0
   ===================================================== */
require('dotenv').config();
const express  = require('express');
const mysql    = require('mysql2/promise');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'edenfood-intranet-secret-2026';

app.use(express.json({ limit: '50mb' }));   // base64 이미지 포함

/* 요청 로그 미들웨어 (404 추적용) */
app.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      console.log(`[${res.statusCode}] ${req.method} ${req.url}`);
    }
  });
  next();
});

// public/ 정적 파일 (랜딩, 로그인, 인트라넷 허브, 영상 등)
app.use(express.static(path.join(__dirname, 'public')));
// 차량 앱 정적 파일 (/car/ prefix 제거 후 루트 기준 서빙)
app.use('/car', express.static(path.join(__dirname)));
// 루트 정적 파일 (js/, css/ 등 공통 자원)
app.use(express.static(path.join(__dirname)));

/* ─────────────────────────────────────────
   DB 연결 설정 (createConnection 기반)
───────────────────────────────────────── */
const dbConfig = {
  host:           process.env.DB_HOST     || 'itedu.synology.me',
  port:           parseInt(process.env.DB_PORT || '3306'),
  user:           process.env.DB_USER     || 'root',
  password:       process.env.DB_PASS     || 'xhRl1004!@#',
  database:       process.env.DB_NAME     || 'edenfood',
  connectTimeout: 15000,
};
const DB_NAME = dbConfig.database;

/* 연결 획득 헬퍼 */
async function getConn() {
  return await mysql.createConnection(dbConfig);
}

/* query 헬퍼: 연결 자동 관리 */
const pool = {
  async query(sql, params) {
    const conn = await getConn();
    try { return await conn.query(sql, params); }
    finally { await conn.end().catch(()=>{}); }
  },
  async getConnection() {
    const conn = await getConn();
    conn.release = () => conn.end().catch(()=>{});
    conn.beginTransaction = () => conn.query('START TRANSACTION');
    conn.commit    = () => conn.query('COMMIT');
    conn.rollback  = () => conn.query('ROLLBACK');
    return conn;
  }
};

/* 연결 확인 */
async function checkDB() {
  try {
    const conn = await getConn();
    const [r] = await conn.query('SELECT VERSION() as v, DATABASE() as db');
    console.log(`✅ MariaDB 연결 성공! 버전: ${r[0].v} | DB: ${r[0].db}`);
    await conn.end();
    return true;
  } catch(e) {
    console.error('❌ DB 연결 실패:', e.message);
    return false;
  }
}

/* ─────────────────────────────────────────
   테이블 초기화 (없으면 자동 생성)
───────────────────────────────────────── */
async function initTables() {
  const conn = await pool.getConnection();
  try {
    // 1. 차량
    await conn.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id           VARCHAR(32)   NOT NULL PRIMARY KEY,
        regno        VARCHAR(20)   NOT NULL,
        model        VARCHAR(50)   NOT NULL,
        year         SMALLINT,
        odometer     INT           DEFAULT 0,
        fuel_eff     DECIMAL(5,2)  DEFAULT 0,
        fuel_price   INT           DEFAULT 0,
        memo         VARCHAR(100),
        driver1_name    VARCHAR(30),
        driver1_license VARCHAR(25),
        driver2_name    VARCHAR(30),
        driver2_license VARCHAR(25),
        created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 2. 차량 서류 (등록증/면허증 base64)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS vehicle_docs (
        id           INT           AUTO_INCREMENT PRIMARY KEY,
        vehicle_id   VARCHAR(32)   NOT NULL,
        doc_type     VARCHAR(20)   NOT NULL COMMENT 'regdoc|license1|license2',
        file_name    VARCHAR(200),
        file_type    VARCHAR(50),
        file_data    LONGTEXT      COMMENT 'base64',
        created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_vdoc (vehicle_id, doc_type),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3. 거래처
    await conn.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id           VARCHAR(32)   NOT NULL PRIMARY KEY,
        name         VARCHAR(50)   NOT NULL,
        category     VARCHAR(30)   DEFAULT '미분류',
        distance     DECIMAL(6,1)  DEFAULT 0,
        variance     DECIMAL(5,1)  DEFAULT 0,
        visits       TINYINT       DEFAULT 1,
        toll         INT           DEFAULT 0,
        parking      INT           DEFAULT 0,
        memo         VARCHAR(100),
        biz_no       VARCHAR(20)   COMMENT '사업자번호',
        manager_name VARCHAR(30)   COMMENT '담당자 성명',
        phone        VARCHAR(30)   COMMENT '전화번호',
        email        VARCHAR(100)  COMMENT '이메일',
        address      VARCHAR(200)  COMMENT '주소',
        sort_order   INT           DEFAULT 0,
        created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3-1. 기존 clients 테이블 컬럼 마이그레이션 (없으면 추가)
    const alterCols = [
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS biz_no      VARCHAR(20)  COMMENT '사업자번호'`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS manager_name VARCHAR(30) COMMENT '담당자'`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone       VARCHAR(30)  COMMENT '전화번호'`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS email       VARCHAR(100) COMMENT '이메일'`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS address     VARCHAR(200) COMMENT '주소'`,
    ];
    for (const sql of alterCols) { try { await conn.query(sql); } catch {} }

    // 3-2. 거래처 서류
    await conn.query(`
      CREATE TABLE IF NOT EXISTS client_docs (
        id           INT           AUTO_INCREMENT PRIMARY KEY,
        client_id    VARCHAR(32)   NOT NULL,
        doc_type     VARCHAR(20)   NOT NULL COMMENT 'biz_cert|contract|etc',
        file_name    VARCHAR(200),
        file_type    VARCHAR(50),
        file_data    LONGTEXT      COMMENT 'base64',
        created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_cdoc (client_id, doc_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4. 차량별 운행 설정
    await conn.query(`
      CREATE TABLE IF NOT EXISTS drive_settings (
        id                  INT         AUTO_INCREMENT PRIMARY KEY,
        vehicle_id          VARCHAR(32) NOT NULL,
        commute_dist        DECIMAL(6,1) DEFAULT 0,
        commute_variance    DECIMAL(5,1) DEFAULT 0,
        commute_days_pw     TINYINT     DEFAULT 2,
        commute_toll        INT         DEFAULT 0,
        commute_spread      VARCHAR(20) DEFAULT 'random',
        annual_km           INT         DEFAULT 7000,
        fix_seed            TINYINT(1)  DEFAULT 1,
        include_sat         TINYINT(1)  DEFAULT 0,
        selected_client_ids TEXT        COMMENT 'JSON array of client ids',
        updated_at          DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_vsetting (vehicle_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5. 운행일지 (월 단위)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS drive_logs (
        id           INT           AUTO_INCREMENT PRIMARY KEY,
        vehicle_id   VARCHAR(32)   NOT NULL,
        year         SMALLINT      NOT NULL,
        month        TINYINT       NOT NULL,
        rows_json    LONGTEXT      NOT NULL COMMENT 'JSON array of daily rows',
        total_km     DECIMAL(8,1)  DEFAULT 0,
        commute_km   DECIMAL(8,1)  DEFAULT 0,
        biz_km       DECIMAL(8,1)  DEFAULT 0,
        start_odo    INT           DEFAULT 0,
        end_odo      INT           DEFAULT 0,
        regno        VARCHAR(20),
        model        VARCHAR(50),
        saved_at     DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_log (vehicle_id, year, month),
        INDEX idx_vehicle_year (vehicle_id, year)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 6. 연간 고정비용
    await conn.query(`
      CREATE TABLE IF NOT EXISTS annual_costs (
        id              INT         AUTO_INCREMENT PRIMARY KEY,
        vehicle_id      VARCHAR(32) NOT NULL,
        year            SMALLINT    NOT NULL,
        car_tax         INT         DEFAULT 0,
        insurance       INT         DEFAULT 0,
        loan_interest   INT         DEFAULT 0,
        repair_monthly  INT         DEFAULT 0,
        updated_at      DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ac (vehicle_id, year)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 7. 비용 명세서 데이터 (월 단위)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS cost_data (
        id           INT           AUTO_INCREMENT PRIMARY KEY,
        vehicle_id   VARCHAR(32)   NOT NULL,
        year         SMALLINT      NOT NULL,
        data_json    LONGTEXT      NOT NULL COMMENT 'JSON cost data by month',
        saved_at     DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_cd (vehicle_id, year)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 8. 주유 기록
    await conn.query(`
      CREATE TABLE IF NOT EXISTS fuel_logs (
        id           INT           AUTO_INCREMENT PRIMARY KEY,
        vehicle_id   VARCHAR(32)   NOT NULL,
        year         SMALLINT      NOT NULL,
        month        TINYINT       NOT NULL,
        log_date     DATE,
        amount       INT           DEFAULT 0  COMMENT '주유금액(원)',
        liters       DECIMAL(6,2)  DEFAULT 0  COMMENT '주유량(L)',
        unit_price   INT           DEFAULT 0  COMMENT '단가(원/L)',
        odometer     INT           DEFAULT 0,
        memo         VARCHAR(100),
        created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_fl (vehicle_id, year, month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 9. 영수증 첨부
    await conn.query(`
      CREATE TABLE IF NOT EXISTS receipts (
        id           INT           AUTO_INCREMENT PRIMARY KEY,
        vehicle_id   VARCHAR(32)   NOT NULL,
        year         SMALLINT      NOT NULL,
        month        TINYINT       NOT NULL,
        row_key      VARCHAR(50)   NOT NULL,
        file_name    VARCHAR(200),
        file_type    VARCHAR(50),
        file_data    LONGTEXT      COMMENT 'base64',
        created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_receipt (vehicle_id, year, month, row_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 10. 사용자 계정
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id           INT           AUTO_INCREMENT PRIMARY KEY,
        username     VARCHAR(50)   NOT NULL UNIQUE,
        password     VARCHAR(100)  NOT NULL COMMENT 'bcrypt hash',
        name         VARCHAR(30)   NOT NULL,
        role         VARCHAR(20)   DEFAULT 'staff' COMMENT 'admin|staff',
        email        VARCHAR(100),
        is_approved  TINYINT(1)    DEFAULT 0 COMMENT '관리자 승인 여부',
        last_login   DATETIME,
        created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 기본 admin 계정 (없으면 생성)
    const [existingAdmin] = await conn.query(`SELECT id FROM users WHERE username = 'admin' LIMIT 1`);
    if (!existingAdmin || existingAdmin.length === 0) {
      const hash = await bcrypt.hash('eden2026!', 10);
      await conn.query(
        `INSERT INTO users (username, password, name, role, is_approved) VALUES (?, ?, ?, 'admin', 1)`,
        ['admin', hash, '관리자']
      );
      console.log('✅ 기본 admin 계정 생성 (ID: admin / PW: eden2026!)');
    }

    console.log('✅ 모든 테이블 준비 완료');
  } finally {
    conn.release();
  }
}

/* ─────────────────────────────────────────
   유틸
───────────────────────────────────────── */
function ok(res, data)    { res.json({ ok: true,  data }); }
function err(res, msg, code=500) { res.status(code).json({ ok: false, error: msg }); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

/* ─────────────────────────────────────────
   JWT 인증 미들웨어
───────────────────────────────────────── */
function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query._token;
  if (!token) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    return res.status(401).json({ ok: false, error: '인증이 만료되었습니다. 다시 로그인하세요.' });
  }
}

/* ─────────────────────────────────────────
   API: 인증 (로그인 / 회원가입)
───────────────────────────────────────── */
// 로그인
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ ok: false, message: '아이디와 비밀번호를 입력하세요.' });

    const [rows] = await pool.query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
    const user = rows[0];
    if (!user) return res.json({ ok: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    if (!user.is_approved) return res.json({ ok: false, message: '관리자 승인 대기 중입니다.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ ok: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    const payload = { id: user.id, username: user.username, name: user.name, role: user.role };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  } catch(e) {
    console.error('로그인 오류:', e);
    err(res, '서버 오류');
  }
});

// 회원가입
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, name, email } = req.body;
    if (!username || !password || !name) return res.status(400).json({ ok: false, message: '필수 항목을 입력하세요.' });
    if (password.length < 6) return res.status(400).json({ ok: false, message: '비밀번호는 6자 이상이어야 합니다.' });

    const [existing] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    if (existing.length > 0) return res.json({ ok: false, message: '이미 사용 중인 아이디입니다.' });

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password, name, email, is_approved) VALUES (?, ?, ?, ?, 0)',
      [username, hash, name, email || null]
    );
    res.json({ ok: true, message: '회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인하세요.' });
  } catch(e) {
    console.error('회원가입 오류:', e);
    err(res, '서버 오류');
  }
});

// 토큰 검증 (인트라넷 진입 시)
app.get('/api/auth/verify', authMiddleware, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// 사용자 목록 (관리자용)
app.get('/api/auth/users', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '권한이 없습니다.' });
    const [rows] = await pool.query('SELECT id, username, name, role, email, is_approved, last_login, created_at FROM users ORDER BY created_at DESC');
    ok(res, rows);
  } catch(e) { err(res, e.message); }
});

// 사용자 승인 (관리자용)
app.post('/api/auth/approve/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '권한이 없습니다.' });
    await pool.query('UPDATE users SET is_approved = 1 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { err(res, e.message); }
});

/* ─────────────────────────────────────────
   API: 차량
───────────────────────────────────────── */
// 목록
app.get('/api/vehicles', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM vehicles ORDER BY created_at');
    ok(res, rows.map(r => ({
      id: r.id, regno: r.regno, model: r.model, year: r.year,
      odometer: r.odometer, fuelEff: parseFloat(r.fuel_eff),
      fuelPrice: r.fuel_price, memo: r.memo,
      driver1Name: r.driver1_name, driver1LicenseNo: r.driver1_license,
      driver2Name: r.driver2_name, driver2LicenseNo: r.driver2_license,
    })));
  } catch(e) { err(res, e.message); }
});

// 단건
app.get('/api/vehicles/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM vehicles WHERE id=?', [req.params.id]);
    if (!rows.length) return err(res, 'Not found', 404);
    const r = rows[0];
    ok(res, { id:r.id, regno:r.regno, model:r.model, year:r.year,
      odometer:r.odometer, fuelEff:parseFloat(r.fuel_eff),
      fuelPrice:r.fuel_price, memo:r.memo,
      driver1Name:r.driver1_name, driver1LicenseNo:r.driver1_license,
      driver2Name:r.driver2_name, driver2LicenseNo:r.driver2_license });
  } catch(e) { err(res, e.message); }
});

// 추가
app.post('/api/vehicles', async (req, res) => {
  try {
    const b = req.body;
    const id = b.id || genId();
    await pool.query(
      `INSERT INTO vehicles (id,regno,model,year,odometer,fuel_eff,fuel_price,memo,
        driver1_name,driver1_license,driver2_name,driver2_license)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, b.regno, b.model, b.year||null, b.odometer||0,
       b.fuelEff||0, b.fuelPrice||0, b.memo||'',
       b.driver1Name||'', b.driver1LicenseNo||'',
       b.driver2Name||'', b.driver2LicenseNo||'']
    );
    const [rows] = await pool.query('SELECT * FROM vehicles WHERE id=?', [id]);
    const r = rows[0];
    ok(res, { id:r.id, regno:r.regno, model:r.model, year:r.year,
      odometer:r.odometer, fuelEff:parseFloat(r.fuel_eff),
      fuelPrice:r.fuel_price, memo:r.memo,
      driver1Name:r.driver1_name, driver1LicenseNo:r.driver1_license,
      driver2Name:r.driver2_name, driver2LicenseNo:r.driver2_license });
  } catch(e) { err(res, e.message); }
});

// 수정
app.put('/api/vehicles/:id', async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `UPDATE vehicles SET regno=?,model=?,year=?,odometer=?,fuel_eff=?,fuel_price=?,
       memo=?,driver1_name=?,driver1_license=?,driver2_name=?,driver2_license=?
       WHERE id=?`,
      [b.regno, b.model, b.year||null, b.odometer||0,
       b.fuelEff||0, b.fuelPrice||0, b.memo||'',
       b.driver1Name||'', b.driver1LicenseNo||'',
       b.driver2Name||'', b.driver2LicenseNo||'',
       req.params.id]
    );
    ok(res, { id: req.params.id });
  } catch(e) { err(res, e.message); }
});

// 삭제
app.delete('/api/vehicles/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // 관련 테이블 데이터 먼저 삭제 (CASCADE 미지원 테이블 대비)
    await Promise.all([
      pool.query('DELETE FROM drive_settings WHERE vehicle_id=?', [id]),
      pool.query('DELETE FROM drive_logs     WHERE vehicle_id=?', [id]),
      pool.query('DELETE FROM annual_costs   WHERE vehicle_id=?', [id]),
      pool.query('DELETE FROM cost_data      WHERE vehicle_id=?', [id]),
      pool.query('DELETE FROM fuel_logs      WHERE vehicle_id=?', [id]),
      pool.query('DELETE FROM receipts       WHERE vehicle_id=?', [id]),
      pool.query('DELETE FROM vehicle_docs   WHERE vehicle_id=?', [id]),
    ]);
    await pool.query('DELETE FROM vehicles WHERE id=?', [id]);
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

/* --- 차량 서류 --- */
app.get('/api/vehicles/:id/docs/:type', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM vehicle_docs WHERE vehicle_id=? AND doc_type=?',
      [req.params.id, req.params.type]
    );
    ok(res, rows.length ? { name:rows[0].file_name, type:rows[0].file_type, data:rows[0].file_data } : null);
  } catch(e) { err(res, e.message); }
});

app.post('/api/vehicles/:id/docs/:type', async (req, res) => {
  try {
    const { name, type, data } = req.body;
    await pool.query(
      `INSERT INTO vehicle_docs (vehicle_id,doc_type,file_name,file_type,file_data)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE file_name=VALUES(file_name),file_type=VALUES(file_type),file_data=VALUES(file_data)`,
      [req.params.id, req.params.type, name, type, data]
    );
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

app.delete('/api/vehicles/:id/docs/:type', async (req, res) => {
  try {
    await pool.query('DELETE FROM vehicle_docs WHERE vehicle_id=? AND doc_type=?',
      [req.params.id, req.params.type]);
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

/* ─────────────────────────────────────────
   API: 거래처
───────────────────────────────────────── */
/* 거래처 공통 매퍼 */
function mapClient(r) {
  return {
    id: r.id, name: r.name, category: r.category,
    distance: parseFloat(r.distance), variance: parseFloat(r.variance),
    visits: r.visits, toll: r.toll, parking: r.parking, memo: r.memo,
    bizNo: r.biz_no || '', managerName: r.manager_name || '',
    phone: r.phone || '', email: r.email || '', address: r.address || ''
  };
}

app.get('/api/clients', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clients ORDER BY sort_order, created_at');
    ok(res, rows.map(mapClient));
  } catch(e) { err(res, e.message); }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clients WHERE id=?', [req.params.id]);
    if (!rows.length) return err(res, 'Not found', 404);
    ok(res, mapClient(rows[0]));
  } catch(e) { err(res, e.message); }
});

app.post('/api/clients', async (req, res) => {
  try {
    const b = req.body;
    const id = b.id || genId();
    await pool.query(
      `INSERT INTO clients (id,name,category,distance,variance,visits,toll,parking,memo,biz_no,manager_name,phone,email,address)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, b.name, b.category||'미분류', b.distance||0, b.variance||0,
       b.visits||1, b.toll||0, b.parking||0, b.memo||'',
       b.bizNo||'', b.managerName||'', b.phone||'', b.email||'', b.address||'']
    );
    const [rows] = await pool.query('SELECT * FROM clients WHERE id=?', [id]);
    ok(res, mapClient(rows[0]));
  } catch(e) { err(res, e.message); }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `UPDATE clients SET name=?,category=?,distance=?,variance=?,visits=?,toll=?,parking=?,memo=?,
       biz_no=?,manager_name=?,phone=?,email=?,address=? WHERE id=?`,
      [b.name, b.category||'미분류', b.distance||0, b.variance||0,
       b.visits||1, b.toll||0, b.parking||0, b.memo||'',
       b.bizNo||'', b.managerName||'', b.phone||'', b.email||'', b.address||'',
       req.params.id]
    );
    ok(res, { id: req.params.id });
  } catch(e) { err(res, e.message); }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM clients WHERE id=?', [req.params.id]);
    await pool.query('DELETE FROM client_docs WHERE client_id=?', [req.params.id]);
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

/* --- 거래처 서류 --- */
app.get('/api/clients/:id/docs/:type', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM client_docs WHERE client_id=? AND doc_type=?',
      [req.params.id, req.params.type]
    );
    ok(res, rows.length ? { name:rows[0].file_name, type:rows[0].file_type, data:rows[0].file_data } : null);
  } catch(e) { err(res, e.message); }
});

app.post('/api/clients/:id/docs/:type', async (req, res) => {
  try {
    const { name, type, data } = req.body;
    await pool.query(
      `INSERT INTO client_docs (client_id,doc_type,file_name,file_type,file_data)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE file_name=VALUES(file_name),file_type=VALUES(file_type),file_data=VALUES(file_data)`,
      [req.params.id, req.params.type, name, type, data]
    );
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

app.delete('/api/clients/:id/docs/:type', async (req, res) => {
  try {
    await pool.query('DELETE FROM client_docs WHERE client_id=? AND doc_type=?',
      [req.params.id, req.params.type]);
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

/* ─────────────────────────────────────────
   API: 운행 설정 (차량별)
───────────────────────────────────────── */
app.get('/api/settings/:vehicleId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM drive_settings WHERE vehicle_id=?', [req.params.vehicleId]);
    if (!rows.length) return ok(res, null);
    const r = rows[0];
    ok(res, {
      vehicleId:          r.vehicle_id,
      commuteDist:        parseFloat(r.commute_dist),
      commuteVariance:    parseFloat(r.commute_variance),
      commuteDaysPerWeek: r.commute_days_pw,
      commuteToll:        r.commute_toll,
      commuteSpread:      r.commute_spread,
      annualKm:           r.annual_km,
      fixSeed:            !!r.fix_seed,
      includeSat:         !!r.include_sat,
      selectedClientIds:  JSON.parse(r.selected_client_ids || '[]'),
    });
  } catch(e) { err(res, e.message); }
});

app.post('/api/settings/:vehicleId', async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `INSERT INTO drive_settings
         (vehicle_id,commute_dist,commute_variance,commute_days_pw,commute_toll,
          commute_spread,annual_km,fix_seed,include_sat,selected_client_ids)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         commute_dist=VALUES(commute_dist), commute_variance=VALUES(commute_variance),
         commute_days_pw=VALUES(commute_days_pw), commute_toll=VALUES(commute_toll),
         commute_spread=VALUES(commute_spread), annual_km=VALUES(annual_km),
         fix_seed=VALUES(fix_seed), include_sat=VALUES(include_sat),
         selected_client_ids=VALUES(selected_client_ids)`,
      [req.params.vehicleId,
       b.commuteDist||0, b.commuteVariance||0, b.commuteDaysPerWeek||2, b.commuteToll||0,
       b.commuteSpread||'random', b.annualKm||7000,
       b.fixSeed ? 1 : 0, b.includeSat ? 1 : 0,
       JSON.stringify(b.selectedClientIds || [])]
    );
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

/* ─────────────────────────────────────────
   API: 운행일지
───────────────────────────────────────── */
// 인덱스 전체 (대시보드용)
app.get('/api/logs/index', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT vehicle_id,year,month,total_km,commute_km,biz_km,start_odo,end_odo,regno,model,saved_at
       FROM drive_logs ORDER BY year,month`);
    ok(res, rows.map(r => ({
      key:       `${r.vehicle_id}_${r.year}_${String(r.month).padStart(2,'0')}`,
      vehicleId: r.vehicle_id, year: r.year, month: r.month,
      totalKm:   parseFloat(r.total_km),
      commuteKm: parseFloat(r.commute_km),
      bizKm:     parseFloat(r.biz_km),
      startOdo:  r.start_odo, endOdo: r.end_odo,
      regno: r.regno, model: r.model, savedAt: r.saved_at
    })));
  } catch(e) { err(res, e.message); }
});

// 차량+연도 인덱스
app.get('/api/logs/index/:vehicleId/:year', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT vehicle_id,year,month,total_km,commute_km,biz_km,start_odo,end_odo,saved_at
       FROM drive_logs WHERE vehicle_id=? AND year=? ORDER BY month`,
      [req.params.vehicleId, req.params.year]);
    ok(res, rows.map(r => ({
      key:`${r.vehicle_id}_${r.year}_${String(r.month).padStart(2,'0')}`,
      vehicleId:r.vehicle_id, year:r.year, month:r.month,
      totalKm:parseFloat(r.total_km), commuteKm:parseFloat(r.commute_km),
      bizKm:parseFloat(r.biz_km), startOdo:r.start_odo, endOdo:r.end_odo,
    })));
  } catch(e) { err(res, e.message); }
});

// 월별 상세
app.get('/api/logs/:vehicleId/:year/:month', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM drive_logs WHERE vehicle_id=? AND year=? AND month=?',
      [req.params.vehicleId, req.params.year, req.params.month]);
    if (!rows.length) return ok(res, null);
    const r = rows[0];
    ok(res, {
      vehicleId: r.vehicle_id, year: r.year, month: r.month,
      rows: JSON.parse(r.rows_json),
      regno: r.regno, model: r.model, savedAt: r.saved_at
    });
  } catch(e) { err(res, e.message); }
});

// 저장
app.post('/api/logs/:vehicleId/:year/:month', async (req, res) => {
  try {
    const b    = req.body;
    const rows = b.rows || [];
    const totalKm   = rows.reduce((s,r)=>s+(Number(r.driven)||0),0);
    const commuteKm = rows.reduce((s,r)=>s+(Number(r.commute)||0),0);
    const bizKm     = rows.reduce((s,r)=>s+(Number(r.biz)||0),0);
    await pool.query(
      `INSERT INTO drive_logs
         (vehicle_id,year,month,rows_json,total_km,commute_km,biz_km,start_odo,end_odo,regno,model)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         rows_json=VALUES(rows_json),total_km=VALUES(total_km),
         commute_km=VALUES(commute_km),biz_km=VALUES(biz_km),
         start_odo=VALUES(start_odo),end_odo=VALUES(end_odo),
         regno=VALUES(regno),model=VALUES(model)`,
      [req.params.vehicleId, req.params.year, req.params.month,
       JSON.stringify(rows), totalKm, commuteKm, bizKm,
       rows[0]?.before||0, rows[rows.length-1]?.after||0,
       b.regno||'', b.model||'']
    );
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

// 삭제
app.delete('/api/logs/:vehicleId/:year/:month', async (req, res) => {
  try {
    await pool.query('DELETE FROM drive_logs WHERE vehicle_id=? AND year=? AND month=?',
      [req.params.vehicleId, req.params.year, req.params.month]);
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

/* ─────────────────────────────────────────
   API: 연간 고정비용
───────────────────────────────────────── */
app.get('/api/annual-costs/:vehicleId/:year', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM annual_costs WHERE vehicle_id=? AND year=?',
      [req.params.vehicleId, req.params.year]);
    if (!rows.length) return ok(res, { carTax:0, insurance:0, loanInterest:0, repairMonthly:0 });
    const r = rows[0];
    ok(res, { carTax:r.car_tax, insurance:r.insurance,
      loanInterest:r.loan_interest, repairMonthly:r.repair_monthly });
  } catch(e) { err(res, e.message); }
});

app.post('/api/annual-costs/:vehicleId/:year', async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `INSERT INTO annual_costs (vehicle_id,year,car_tax,insurance,loan_interest,repair_monthly)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         car_tax=VALUES(car_tax),insurance=VALUES(insurance),
         loan_interest=VALUES(loan_interest),repair_monthly=VALUES(repair_monthly)`,
      [req.params.vehicleId, req.params.year,
       b.carTax||0, b.insurance||0, b.loanInterest||0, b.repairMonthly||0]
    );
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

/* ─────────────────────────────────────────
   API: 비용 명세서
───────────────────────────────────────── */
app.get('/api/costdata/:vehicleId/:year', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM cost_data WHERE vehicle_id=? AND year=?',
      [req.params.vehicleId, req.params.year]);
    if (!rows.length) return ok(res, null);
    ok(res, { vehicleId: req.params.vehicleId, year: parseInt(req.params.year),
      data: JSON.parse(rows[0].data_json) });
  } catch(e) { err(res, e.message); }
});

app.post('/api/costdata/:vehicleId/:year', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO cost_data (vehicle_id,year,data_json) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE data_json=VALUES(data_json)`,
      [req.params.vehicleId, req.params.year, JSON.stringify(req.body.data || {})]
    );
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

/* ─────────────────────────────────────────
   API: 영수증
───────────────────────────────────────── */
app.get('/api/receipts/:vehicleId/:year/:month/:rowKey', async (req, res) => {
  try {
    const { vehicleId, year, month, rowKey } = req.params;
    const [rows] = await pool.query(
      'SELECT * FROM receipts WHERE vehicle_id=? AND year=? AND month=? AND row_key=?',
      [vehicleId, year, month, rowKey]);
    if (!rows.length) return ok(res, null);
    ok(res, { name:rows[0].file_name, type:rows[0].file_type, data:rows[0].file_data });
  } catch(e) { err(res, e.message); }
});

app.post('/api/receipts/:vehicleId/:year/:month/:rowKey', async (req, res) => {
  try {
    const { vehicleId, year, month, rowKey } = req.params;
    const { name, type, data } = req.body;
    await pool.query(
      `INSERT INTO receipts (vehicle_id,year,month,row_key,file_name,file_type,file_data)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE file_name=VALUES(file_name),file_type=VALUES(file_type),file_data=VALUES(file_data)`,
      [vehicleId, year, month, rowKey, name, type, data]
    );
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

app.delete('/api/receipts/:vehicleId/:year/:month/:rowKey', async (req, res) => {
  try {
    const { vehicleId, year, month, rowKey } = req.params;
    await pool.query(
      'DELETE FROM receipts WHERE vehicle_id=? AND year=? AND month=? AND row_key=?',
      [vehicleId, year, month, rowKey]);
    ok(res, null);
  } catch(e) { err(res, e.message); }
});

/* ─────────────────────────────────────────
   API: LocalStorage 마이그레이션
───────────────────────────────────────── */
app.post('/api/migrate', async (req, res) => {
  const { vehicles, clients, settings, logs, costData } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 차량
    for (const v of (vehicles || [])) {
      await conn.query(
        `INSERT IGNORE INTO vehicles
           (id,regno,model,year,odometer,fuel_eff,fuel_price,memo,driver1_name,driver1_license,driver2_name,driver2_license)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [v.id, v.regno, v.model, v.year||null, v.odometer||0,
         v.fuelEff||0, v.fuelPrice||0, v.memo||'',
         v.driver1Name||'', v.driver1LicenseNo||'',
         v.driver2Name||'', v.driver2LicenseNo||'']
      );
    }

    // 거래처
    for (const c of (clients || [])) {
      await conn.query(
        `INSERT IGNORE INTO clients (id,name,category,distance,variance,visits,toll,parking,memo)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [c.id, c.name, c.category||'미분류', c.distance||0, c.variance||0,
         c.visits||1, c.toll||0, c.parking||0, c.memo||'']
      );
    }

    // 설정
    for (const s of (settings || [])) {
      await conn.query(
        `INSERT INTO drive_settings
           (vehicle_id,commute_dist,commute_variance,commute_days_pw,commute_toll,
            commute_spread,annual_km,fix_seed,include_sat,selected_client_ids)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE commute_dist=VALUES(commute_dist)`,
        [s.vehicleId, s.commuteDist||0, s.commuteVariance||0, s.commuteDaysPerWeek||2,
         s.commuteToll||0, s.commuteSpread||'random', s.annualKm||7000,
         s.fixSeed?1:0, s.includeSat?1:0, JSON.stringify(s.selectedClientIds||[])]
      );
    }

    // 운행일지
    for (const l of (logs || [])) {
      const rows = l.rows || [];
      await conn.query(
        `INSERT IGNORE INTO drive_logs
           (vehicle_id,year,month,rows_json,total_km,commute_km,biz_km,start_odo,end_odo,regno,model)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [l.vehicleId, l.year, l.month, JSON.stringify(rows),
         rows.reduce((s,r)=>s+(Number(r.driven)||0),0),
         rows.reduce((s,r)=>s+(Number(r.commute)||0),0),
         rows.reduce((s,r)=>s+(Number(r.biz)||0),0),
         rows[0]?.before||0, rows[rows.length-1]?.after||0,
         l.regno||'', l.model||'']
      );
    }

    await conn.commit();
    ok(res, { migrated: { vehicles: vehicles?.length||0, clients: clients?.length||0,
      settings: settings?.length||0, logs: logs?.length||0 } });
  } catch(e) {
    await conn.rollback();
    err(res, e.message);
  } finally {
    conn.release();
  }
});

/* ─────────────────────────────────────────
   API: 헬스체크
───────────────────────────────────────── */
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    ok(res, { status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch(e) { err(res, 'DB disconnected: ' + e.message); }
});

/* ─────────────────────────────────────────
   SPA fallback - index.html
───────────────────────────────────────── */
app.get('*', (req, res) => {
  const url = req.path;

  // /intranet/* → 인트라넷 허브
  if (url === '/intranet' || url.startsWith('/intranet/')) {
    const intrFile = path.join(__dirname, 'public', 'intranet', 'index.html');
    if (fs.existsSync(intrFile)) return res.sendFile(intrFile);
  }

  // /car/* → 기존 차량 운행기록부 앱
  if (url === '/car' || url.startsWith('/car/')) {
    return res.sendFile(path.join(__dirname, 'index.html'));
  }

  // /login → 로그인 페이지
  if (url === '/login') {
    const loginFile = path.join(__dirname, 'public', 'login.html');
    if (fs.existsSync(loginFile)) return res.sendFile(loginFile);
  }

  // / (랜딩 페이지)
  if (url === '/' || url === '/index.html') {
    const landingFile = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(landingFile)) return res.sendFile(landingFile);
  }

  // 기타 정적 자원 처리
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ─────────────────────────────────────────
   서버 시작
───────────────────────────────────────── */
async function start() {
  const dbOk = await checkDB();
  if (!dbOk) {
    console.error('⚠️  DB 연결 실패. .env 파일과 MariaDB 권한을 확인하세요.');
    process.exit(1);
  }
  await initTables();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚗 이든푸드 차량 운행기록부 서버 시작 - http://0.0.0.0:${PORT}`);
  });
}

start();
