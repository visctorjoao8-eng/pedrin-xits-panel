const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ============================================================
//  Configuração
// ============================================================
const PORT = process.env.PORT || 3000;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || '';
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const APP_NAME = "Pedrin Xits";
const OWNER_ID = "3616b50c-8ff3-4629-a89b-11c53f3f3643";
const APP_SECRET = "1facb137182890f342db9067b80c779107c29fb1ff3d595934b6bdb01f51fa1d";
const ADMIN_USERNAME = "1";
const ADMIN_PASSWORD = "1";

const app = express();
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  Database Wrapper (sql.js compatibility layer)
// ============================================================
const DB_PATH = path.join(__dirname, 'database.db');
let db;

function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Salvar a cada 30 segundos
setInterval(saveDatabase, 30000);

// Wrapper para preparar statements com API similar ao better-sqlite3
class StmtWrapper {
  constructor(database, sql) {
    this.db = database;
    this.sql = sql;
  }

  get(...params) {
    try {
      const stmt = this.db.prepare(this.sql);
      if (params.length > 0) stmt.bind(params);
      if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result;
      }
      stmt.free();
      return undefined;
    } catch (e) {
      console.error('[DB] get error:', e.message, 'SQL:', this.sql);
      return undefined;
    }
  }

  all(...params) {
    try {
      const results = [];
      const stmt = this.db.prepare(this.sql);
      if (params.length > 0) stmt.bind(params);
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (e) {
      console.error('[DB] all error:', e.message, 'SQL:', this.sql);
      return [];
    }
  }

  run(...params) {
    try {
      this.db.run(this.sql, params);
      return { changes: this.db.getRowsModified() };
    } catch (e) {
      console.error('[DB] run error:', e.message, 'SQL:', this.sql);
      return { changes: 0 };
    }
  }
}

function dbPrepare(sql) {
  return new StmtWrapper(db, sql);
}

// ============================================================
//  Inicializar Database
// ============================================================
async function initDatabase() {
  const SQL = await initSqlJs();

  // Carregar banco existente ou criar novo
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Tabelas
  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      hwid TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT,
      banned INTEGER DEFAULT 0,
      ban_reason TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS license_keys (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      user_id TEXT,
      status TEXT DEFAULT 'unused',
      duration_days INTEGER DEFAULT 30,
      is_lifetime INTEGER DEFAULT 0,
      client_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      activated_at TEXT,
      expires_at TEXT,
      hwid TEXT DEFAULT '',
      max_uses INTEGER DEFAULT 1,
      current_uses INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_by TEXT DEFAULT 'admin',
      paused INTEGER DEFAULT 0,
      paused_at TEXT,
      total_paused_ms INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migrar: adicionar colunas que podem não existir
  function addColumnIfNotExists(table, column, definition) {
    try {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (e) {
      // Coluna já existe, ignorar
    }
  }
  addColumnIfNotExists('license_keys', 'is_lifetime', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('license_keys', 'client_name', "TEXT DEFAULT ''");
  addColumnIfNotExists('license_keys', 'paused', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('license_keys', 'paused_at', 'TEXT');
  addColumnIfNotExists('license_keys', 'total_paused_ms', 'INTEGER DEFAULT 0');

  // Inserir configurações padrão se não existirem
  const insertSetting = dbPrepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  insertSetting.run('app_name', APP_NAME);
  insertSetting.run('owner_id', OWNER_ID);
  insertSetting.run('app_secret', APP_SECRET);

  saveDatabase();
  console.log('[DB] Database initialized successfully');
}

// ============================================================
//  Funções Auxiliares
// ============================================================
function addLog(action, details, ip) {
  dbPrepare('INSERT INTO logs (action, details, ip_address) VALUES (?, ?, ?)').run(action, details || '', ip || '');
}

function generateLicenseKey(clientName, isLifetime, durationDays) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let parts = [];

  if (clientName && clientName.trim()) {
    parts.push(clientName.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''));
  }

  for (let g = 0; g < 3; g++) {
    let block = '';
    for (let i = 0; i < 5; i++) {
      block += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    parts.push(block);
  }

  if (isLifetime) {
    parts.push('LIFE_TIME');
  } else {
    parts.push(durationDays + 'D');
  }

  return parts.join('-');
}

function getExpiryDate(activatedAt, durationDays) {
  if (!activatedAt) return null;
  const d = new Date(activatedAt);
  d.setDate(d.getDate() + durationDays);
  return d.toISOString().split('.')[0] + 'Z';
}

function daysUntilExpiry(expiresAt) {
  if (!expiresAt) return 0;
  const now = new Date();
  const exp = new Date(expiresAt);
  const diff = exp - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ============================================================
//  HMAC Verification
// ============================================================
function verifyHmac(signature, timestamp, payload) {
  try {
    const secretBytes = Buffer.from(APP_SECRET, 'hex');
    const hmac = crypto.createHmac('sha256', secretBytes);
    hmac.update(payload);
    const computed = hmac.digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(computed, 'hex'));
  } catch (e) {
    console.error('[HMAC] Verification error:', e.message);
    return false;
  }
}

// ============================================================
//  Middleware de autenticação admin
// ============================================================
function authAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// ============================================================
//  ROTAS DA API (compatível com C++ client)
// ============================================================

// POST /license/validate
app.post('/license/validate', (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const { license_key, fingerprint, app_name, owner_id } = req.body;
  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];

  console.log(`[API] License validate request - Key: ${license_key ? license_key.substring(0, 8) + '...' : 'null'}`);

  if (!license_key) {
    return res.json({ success: false, message: 'License key is required' });
  }

  if (signature && timestamp) {
    const payload = `${app_name || APP_NAME}|${owner_id || OWNER_ID}|${license_key}|${fingerprint || ''}|${timestamp}`;
    const valid = verifyHmac(signature, timestamp, payload);
    if (!valid) {
      console.log('[API] HMAC verification failed');
      addLog('hmac_fail', `Key: ${license_key}`, clientIp);
    }
  }

  const keyRow = dbPrepare('SELECT * FROM license_keys WHERE key = ?').get(license_key);

  if (!keyRow) {
    addLog('validate_fail', `Key not found: ${license_key}`, clientIp);
    return res.json({ success: false, message: 'Key not found' });
  }

  if (keyRow.status === 'banned') {
    addLog('validate_banned', `Key: ${license_key}`, clientIp);
    return res.json({ success: false, message: 'Key is banned' });
  }

  if (keyRow.paused) {
    addLog('validate_paused', `Key: ${license_key}`, clientIp);
    return res.json({ success: false, message: 'Key is paused' });
  }

  if (keyRow.status === 'unused') {
    const now = new Date().toISOString().split('.')[0] + 'Z';
    let expiresAt = null;
    if (!keyRow.is_lifetime) {
      expiresAt = getExpiryDate(now, keyRow.duration_days);
    }

    dbPrepare(`
      UPDATE license_keys SET 
        status = 'active', 
        activated_at = ?, 
        expires_at = ?, 
        hwid = ?,
        current_uses = 1
      WHERE id = ?
    `).run(now, expiresAt, fingerprint || '', keyRow.id);

    addLog('key_activated', `Key: ${license_key}, HWID: ${fingerprint}`, clientIp);

    const response = {
      success: true,
      message: 'License activated successfully',
      session_token: uuidv4(),
      expires_at: expiresAt || 'lifetime',
      username: keyRow.client_name || license_key
    };

    if (expiresAt && !keyRow.is_lifetime) {
      response.days_left = daysUntilExpiry(expiresAt);
    } else {
      response.days_left = -1;
    }

    return res.json(response);
  }

  if (keyRow.status === 'active') {
    if (!keyRow.is_lifetime && keyRow.expires_at) {
      const now = new Date();
      const exp = new Date(keyRow.expires_at);
      if (now > exp) {
        dbPrepare("UPDATE license_keys SET status = 'expired' WHERE id = ?").run(keyRow.id);
        addLog('key_expired', `Key: ${license_key}`, clientIp);
        return res.json({ success: false, message: 'License has expired' });
      }
    }

    if (keyRow.hwid && fingerprint && keyRow.hwid !== fingerprint) {
      addLog('hwid_mismatch', `Key: ${license_key}, Expected: ${keyRow.hwid}, Got: ${fingerprint}`, clientIp);
      return res.json({ success: false, message: 'HWID mismatch. Reset required.' });
    }

    if (!keyRow.hwid && fingerprint) {
      dbPrepare('UPDATE license_keys SET hwid = ? WHERE id = ?').run(fingerprint, keyRow.id);
    }

    dbPrepare('UPDATE license_keys SET current_uses = current_uses + 1 WHERE id = ?').run(keyRow.id);

    addLog('validate_ok', `Key: ${license_key}`, clientIp);

    const response2 = {
      success: true,
      message: 'License valid',
      session_token: uuidv4(),
      expires_at: keyRow.expires_at || 'lifetime',
      username: keyRow.client_name || license_key
    };

    if (keyRow.expires_at && !keyRow.is_lifetime) {
      response2.days_left = daysUntilExpiry(keyRow.expires_at);
    } else {
      response2.days_left = -1;
    }

    return res.json(response2);
  }

  if (keyRow.status === 'expired') {
    addLog('validate_expired', `Key: ${license_key}`, clientIp);
    return res.json({ success: false, message: 'License has expired' });
  }

  return res.json({ success: false, message: 'Invalid license status' });
});

// POST /license/check
app.post('/license/check', (req, res) => {
  const { license_key } = req.body;
  if (!license_key) {
    return res.json({ success: false, message: 'License key required' });
  }

  const keyRow = dbPrepare('SELECT * FROM license_keys WHERE key = ?').get(license_key);
  if (!keyRow) {
    return res.json({ success: false, message: 'Key not found' });
  }

  let statusInfo = {
    success: true,
    status: keyRow.paused ? 'paused' : keyRow.status,
    is_lifetime: keyRow.is_lifetime ? true : false,
    client_name: keyRow.client_name,
    created_at: keyRow.created_at,
    activated_at: keyRow.activated_at,
    expires_at: keyRow.expires_at,
    uses: keyRow.current_uses,
    paused: keyRow.paused ? true : false
  };

  if (keyRow.status === 'active' && keyRow.expires_at && !keyRow.is_lifetime) {
    statusInfo.days_remaining = daysUntilExpiry(keyRow.expires_at);
  }

  return res.json(statusInfo);
});

// ============================================================
//  ROTAS ADMIN - Autenticação
// ============================================================

// POST /admin/login
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    addLog('admin_login', `Admin logged in`, req.ip);
    return res.json({ success: true, token });
  }

  addLog('admin_login_fail', `Failed login attempt: ${username}`, req.ip);
  return res.json({ success: false, message: 'Invalid credentials' });
});

// ============================================================
//  ROTAS ADMIN - Dashboard
// ============================================================

// GET /admin/dashboard
app.get('/admin/dashboard', authAdmin, (req, res) => {
  const totalKeys = dbPrepare('SELECT COUNT(*) as count FROM license_keys').get().count;
  const activeKeys = dbPrepare("SELECT COUNT(*) as count FROM license_keys WHERE status = 'active' AND paused = 0").get().count;
  const unusedKeys = dbPrepare("SELECT COUNT(*) as count FROM license_keys WHERE status = 'unused'").get().count;
  const expiredKeys = dbPrepare("SELECT COUNT(*) as count FROM license_keys WHERE status = 'expired'").get().count;
  const bannedKeys = dbPrepare("SELECT COUNT(*) as count FROM license_keys WHERE status = 'banned'").get().count;
  const pausedKeys = dbPrepare("SELECT COUNT(*) as count FROM license_keys WHERE paused = 1").get().count;

  const recentLogs = dbPrepare('SELECT * FROM logs ORDER BY id DESC LIMIT 50').all();

  res.json({
    success: true,
    stats: {
      total_keys: totalKeys,
      active_keys: activeKeys,
      unused_keys: unusedKeys,
      expired_keys: expiredKeys,
      banned_keys: bannedKeys,
      paused_keys: pausedKeys
    },
    recent_logs: recentLogs
  });
});

// ============================================================
//  ROTAS ADMIN - Keys (CRUD)
// ============================================================

// GET /admin/keys - Listar todas as keys
app.get('/admin/keys', authAdmin, (req, res) => {
  const { status, search, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM license_keys WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM license_keys WHERE 1=1';
  const params = [];
  const countParams = [];

  if (status) {
    query += ' AND status = ?';
    countQuery += ' AND status = ?';
    params.push(status);
    countParams.push(status);
  }
  if (search) {
    query += ' AND (key LIKE ? OR notes LIKE ? OR client_name LIKE ?)';
    countQuery += ' AND (key LIKE ? OR notes LIKE ? OR client_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const keys = dbPrepare(query).all(...params);
  const total = dbPrepare(countQuery).get(...countParams).count;

  res.json({ success: true, keys, total, page: parseInt(page), limit: parseInt(limit) });
});

// POST /admin/keys - Criar nova key
app.post('/admin/keys', authAdmin, (req, res) => {
  const { count = 1, duration_type = 'days', duration_days = 30, client_name = '' } = req.body;
  const keys = [];
  const isLifetime = duration_type === 'lifetime' ? 1 : 0;
  const days = isLifetime ? 0 : (parseInt(duration_days) || 30);

  for (let i = 0; i < Math.min(count, 100); i++) {
    const id = uuidv4();
    const key = generateLicenseKey(client_name, isLifetime, days);
    dbPrepare(`
      INSERT INTO license_keys (id, key, status, duration_days, is_lifetime, client_name, notes, created_by)
      VALUES (?, ?, 'unused', ?, ?, ?, '', 'admin')
    `).run(id, key, days, isLifetime, client_name || '');
    keys.push(key);
  }

  addLog('keys_created', `Created ${keys.length} keys (${isLifetime ? 'lifetime' : days + 'd'}, client: ${client_name || 'none'})`, req.ip);
  res.json({ success: true, keys, count: keys.length });
});

// PUT /admin/keys/:id - Atualizar key
app.put('/admin/keys/:id', authAdmin, (req, res) => {
  const { id } = req.params;
  const { status, duration_days, notes, hwid } = req.body;

  const keyRow = dbPrepare('SELECT * FROM license_keys WHERE id = ?').get(id);
  if (!keyRow) {
    return res.json({ success: false, message: 'Key not found' });
  }

  const updates = [];
  const params = [];

  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (duration_days !== undefined) { updates.push('duration_days = ?'); params.push(duration_days); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (hwid !== undefined) { updates.push('hwid = ?'); params.push(hwid); }

  if (updates.length === 0) {
    return res.json({ success: false, message: 'No fields to update' });
  }

  params.push(id);
  dbPrepare(`UPDATE license_keys SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  addLog('key_updated', `Key ${keyRow.key} updated: ${JSON.stringify(req.body)}`, req.ip);
  res.json({ success: true, message: 'Key updated' });
});

// DELETE /admin/keys/:id - Deletar key
app.delete('/admin/keys/:id', authAdmin, (req, res) => {
  const { id } = req.params;
  const keyRow = dbPrepare('SELECT * FROM license_keys WHERE id = ?').get(id);
  if (!keyRow) {
    return res.json({ success: false, message: 'Key not found' });
  }

  dbPrepare('DELETE FROM license_keys WHERE id = ?').run(id);
  addLog('key_deleted', `Key ${keyRow.key} deleted`, req.ip);
  res.json({ success: true, message: 'Key deleted' });
});

// POST /admin/keys/:id/reset-hwid
app.post('/admin/keys/:id/reset-hwid', authAdmin, (req, res) => {
  const { id } = req.params;
  const keyRow = dbPrepare('SELECT * FROM license_keys WHERE id = ?').get(id);
  if (!keyRow) {
    return res.json({ success: false, message: 'Key not found' });
  }

  dbPrepare('UPDATE license_keys SET hwid = ? WHERE id = ?').run('', id);
  addLog('hwid_reset', `HWID reset for key ${keyRow.key} (dias mantidos)`, req.ip);
  res.json({ success: true, message: 'HWID reset successfully' });
});

// POST /admin/keys/:id/pause
app.post('/admin/keys/:id/pause', authAdmin, (req, res) => {
  const { id } = req.params;
  const keyRow = dbPrepare('SELECT * FROM license_keys WHERE id = ?').get(id);
  if (!keyRow) {
    return res.json({ success: false, message: 'Key not found' });
  }

  if (keyRow.paused) {
    const pausedAt = new Date(keyRow.paused_at);
    const now = new Date();
    const pausedDuration = now - pausedAt;
    const newTotalPaused = (keyRow.total_paused_ms || 0) + pausedDuration;

    let newExpiresAt = keyRow.expires_at;
    if (keyRow.expires_at && !keyRow.is_lifetime) {
      const currentExpiry = new Date(keyRow.expires_at);
      currentExpiry.setTime(currentExpiry.getTime() + pausedDuration);
      newExpiresAt = currentExpiry.toISOString().split('.')[0] + 'Z';
    }

    dbPrepare('UPDATE license_keys SET paused = 0, paused_at = NULL, total_paused_ms = ?, expires_at = ? WHERE id = ?')
      .run(newTotalPaused, newExpiresAt, id);

    addLog('key_unpaused', `Key ${keyRow.key} unpaused`, req.ip);
    res.json({ success: true, message: 'Key unpaused', action: 'unpaused' });
  } else {
    const now = new Date().toISOString().split('.')[0] + 'Z';
    dbPrepare('UPDATE license_keys SET paused = 1, paused_at = ? WHERE id = ?').run(now, id);

    addLog('key_paused', `Key ${keyRow.key} paused`, req.ip);
    res.json({ success: true, message: 'Key paused', action: 'paused' });
  }
});

// POST /admin/keys/pause-all
app.post('/admin/keys/pause-all', authAdmin, (req, res) => {
  const pausedCount = dbPrepare("SELECT COUNT(*) as count FROM license_keys WHERE paused = 1").get().count;
  const activeCount = dbPrepare("SELECT COUNT(*) as count FROM license_keys WHERE status = 'active' AND paused = 0").get().count;

  if (pausedCount > 0 && activeCount === 0) {
    const pausedKeys = dbPrepare("SELECT * FROM license_keys WHERE paused = 1").all();
    const now = new Date();

    for (const key of pausedKeys) {
      const pausedAt = new Date(key.paused_at);
      const pausedDuration = now - pausedAt;
      const newTotalPaused = (key.total_paused_ms || 0) + pausedDuration;

      let newExpiresAt = key.expires_at;
      if (key.expires_at && !key.is_lifetime) {
        const currentExpiry = new Date(key.expires_at);
        currentExpiry.setTime(currentExpiry.getTime() + pausedDuration);
        newExpiresAt = currentExpiry.toISOString().split('.')[0] + 'Z';
      }

      dbPrepare('UPDATE license_keys SET paused = 0, paused_at = NULL, total_paused_ms = ?, expires_at = ? WHERE id = ?')
        .run(newTotalPaused, newExpiresAt, key.id);
    }

    addLog('keys_unpaused_all', `All ${pausedKeys.length} keys unpaused`, req.ip);
    res.json({ success: true, message: `${pausedKeys.length} keys unpaused`, action: 'unpaused' });
  } else {
    const activeKeys = dbPrepare("SELECT * FROM license_keys WHERE status = 'active' AND paused = 0").all();
    const now = new Date().toISOString().split('.')[0] + 'Z';

    for (const key of activeKeys) {
      dbPrepare('UPDATE license_keys SET paused = 1, paused_at = ? WHERE id = ?').run(now, key.id);
    }

    addLog('keys_paused_all', `All ${activeKeys.length} active keys paused`, req.ip);
    res.json({ success: true, message: `${activeKeys.length} keys paused`, action: 'paused' });
  }
});

// POST /admin/keys/:id/extend
app.post('/admin/keys/:id/extend', authAdmin, (req, res) => {
  const { id } = req.params;
  const { days = 30 } = req.body;

  const keyRow = dbPrepare('SELECT * FROM license_keys WHERE id = ?').get(id);
  if (!keyRow) {
    return res.json({ success: false, message: 'Key not found' });
  }

  if (keyRow.is_lifetime) {
    return res.json({ success: false, message: 'Cannot extend a lifetime key' });
  }

  let newExpiry;
  if (keyRow.expires_at) {
    const current = new Date(keyRow.expires_at);
    current.setDate(current.getDate() + days);
    newExpiry = current.toISOString().split('.')[0] + 'Z';
  } else {
    const now = new Date();
    now.setDate(now.getDate() + days);
    newExpiry = now.toISOString().split('.')[0] + 'Z';
  }

  dbPrepare('UPDATE license_keys SET expires_at = ?, status = ? WHERE id = ?').run(newExpiry, 'active', id);
  addLog('key_extended', `Key ${keyRow.key} extended by ${days} days`, req.ip);
  res.json({ success: true, message: `Extended by ${days} days`, expires_at: newExpiry });
});

// ============================================================
//  ROTAS ADMIN - Logs
// ============================================================
app.get('/admin/logs', authAdmin, (req, res) => {
  const { page = 1, limit = 100, action } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM logs WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM logs WHERE 1=1';
  const params = [];
  const countParams = [];

  if (action) {
    query += ' AND action LIKE ?';
    countQuery += ' AND action LIKE ?';
    params.push(`%${action}%`);
    countParams.push(`%${action}%`);
  }

  query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const logs = dbPrepare(query).all(...params);
  const total = dbPrepare(countQuery).get(...countParams).count;

  res.json({ success: true, logs, total, page: parseInt(page), limit: parseInt(limit) });
});

// DELETE /admin/logs
app.delete('/admin/logs', authAdmin, (req, res) => {
  dbPrepare('DELETE FROM logs').run();
  addLog('logs_cleared', 'All logs cleared', req.ip);
  res.json({ success: true, message: 'Logs cleared' });
});

// ============================================================
//  Rota catch-all
// ============================================================
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/license') && !req.path.includes('.')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

// ============================================================
//  Graceful shutdown - salvar banco
// ============================================================
process.on('SIGINT', () => {
  console.log('\n[DB] Saving database before exit...');
  saveDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[DB] Saving database before exit...');
  saveDatabase();
  process.exit(0);
});

// ============================================================
//  Iniciar servidor
// ============================================================
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║     PEDRIN XITS - Auth Panel v2.0           ║`);
    console.log(`╠══════════════════════════════════════════════╣`);
    console.log(`║  Server:  http://localhost:${PORT}              ║`);
    console.log(`║  Panel:   http://localhost:${PORT}/admin         ║`);
    console.log(`║  API:     http://localhost:${PORT}/license       ║`);
    console.log(`║                                              ║`);
    console.log(`║  Admin:   ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}               ║`);
    console.log(`╚══════════════════════════════════════════════╝\n`);
  });
}).catch(err => {
  console.error('[DB] Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;