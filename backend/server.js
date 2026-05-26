const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');

// ============================================================
//  Configuração
// ============================================================
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const APP_NAME = "Pedrin Xits";
const OWNER_ID = "3616b50c-8ff3-4629-a89b-11c53f3f3643";
const APP_SECRET = "1facb137182890f342db9067b80c779107c29fb1ff3d595934b6bdb01f51fa1d";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "1";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1";

const app = express();

// Remover header X-Powered-By para não expor tecnologia
app.disable('x-powered-by');

// Segurança HTTP Headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: 'deny',
  },
  noSniff: true,
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
  permissionsPolicy: {
    features: {
      camera: ["'none'"],
      microphone: ["'none'"],
      geolocation: ["'none'"],
      payment: ["'none'"],
      usb: ["'none'"],
      magnetometer: ["'none'"],
      gyroscope: ["'none'"],
      accelerometer: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  Database - PostgreSQL
// ============================================================
// Forcar output imediato
process.stdout.write('[INIT] Server starting...\n');
process.stdout.write('[INIT] NODE_ENV: ' + (process.env.NODE_ENV || 'undefined') + '\n');
process.stdout.write('[INIT] DATABASE_URL exists: ' + (process.env.DATABASE_URL ? 'YES' : 'NO') + '\n');
process.stdout.write('[INIT] DATABASE_URL prefix: ' + (process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 40) : 'UNDEFINED') + '\n');

if (!process.env.DATABASE_URL) {
  process.stderr.write('[DB] ERRO: DATABASE_URL nao definida!\n');
  process.stderr.write('[DB] Adicione manualmente no dashboard do Render > Environment\n');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Tratar erros de conexão inesperados no pool
pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no pool de conexoes:', err.message);
});

// ============================================================
//  Inicializar Database
// ============================================================
let dbConnected = false;

// ============================================================
//  Keep-Alive do Banco de Dados
//  (Impede que o Neon suspenda o compute por inatividade)
// ============================================================
async function keepDatabaseAlive() {
  try {
    const result = await pool.query('SELECT 1');
    if (!dbConnected) {
      console.log('[DB] Conexao com banco reestabelecida!');
      dbConnected = true;
    }
  } catch (err) {
    dbConnected = false;
    console.error('[DB] Keep-alive falhou:', err.message);
  }
}

// Pingar o banco a cada 2 minutos para manter Neon ativo
setInterval(keepDatabaseAlive, 2 * 60 * 1000);

// ============================================================
//  Inicializar Database (com retry)
// ============================================================
async function initDatabase(retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const client = await pool.connect();
    try {
    // Tabelas
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT,
        hwid TEXT DEFAULT '',
        ip_address TEXT DEFAULT '',
        created_at TEXT DEFAULT (now()::text),
        last_login TEXT,
        banned INTEGER DEFAULT 0,
        ban_reason TEXT DEFAULT '',
        notes TEXT DEFAULT ''
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS license_keys (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        user_id TEXT,
        status TEXT DEFAULT 'unused',
        duration_days INTEGER DEFAULT 30,
        is_lifetime INTEGER DEFAULT 0,
        client_name TEXT DEFAULT '',
        created_at TEXT DEFAULT (now()::text),
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at TEXT DEFAULT (now()::text)
      )
    `);

    // Migrar: adicionar colunas que podem não existir
    async function addColumnIfNotExists(table, column, definition) {
      try {
        await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      } catch (e) {
        // Coluna já existe, ignorar
      }
    }
    await addColumnIfNotExists('license_keys', 'is_lifetime', 'INTEGER DEFAULT 0');
    await addColumnIfNotExists('license_keys', 'client_name', "TEXT DEFAULT ''");
    await addColumnIfNotExists('license_keys', 'paused', 'INTEGER DEFAULT 0');
    await addColumnIfNotExists('license_keys', 'paused_at', 'TEXT');
    await addColumnIfNotExists('license_keys', 'total_paused_ms', 'INTEGER DEFAULT 0');

    // Inserir configurações padrão se não existirem
    await client.query(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      ['app_name', APP_NAME]
    );
    await client.query(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      ['owner_id', OWNER_ID]
    );
    await client.query(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      ['app_secret', APP_SECRET]
    );

      dbConnected = true;
      console.log('[DB] PostgreSQL Database initialized successfully');
      return; // Sucesso, sair do loop
    } catch (err) {
      console.error(`[DB] Tentativa ${attempt}/${retries} falhou:`, err.message);
      console.error(`[DB] Erro completo:`, err.code, err.host, err.port);
      if (attempt === retries) {
        throw new Error(`Falha ao inicializar banco apos ${retries} tentativas: ${err.message}`);
      }
      // Esperar antes de tentar novamente (backoff exponencial)
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`[DB] Aguardando ${delay}ms antes da proxima tentativa...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      client.release();
    }
  }
}

// ============================================================
//  Funções Auxiliares
// ============================================================
async function addLog(action, details, ip) {
  try {
    await pool.query('INSERT INTO logs (action, details, ip_address) VALUES ($1, $2, $3)', [action, details || '', ip || '']);
  } catch (err) {
    console.error('[DB] Erro ao adicionar log:', err.message);
  }
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

// ============================================================
//  Health check endpoint (para monitorar e manter vivo)
// ============================================================
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM license_keys');
    const keyCount = parseInt(result.rows[0].count);
    res.json({
      status: 'ok',
      db: 'connected',
      db_connected: dbConnected,
      total_keys: keyCount,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      db: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /license/validate
app.post('/license/validate', async (req, res) => {
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
      await addLog('hmac_fail', `Key: ${license_key}`, clientIp);
    }
  }

    let rows;
    try {
      const result = await pool.query('SELECT * FROM license_keys WHERE key = $1', [license_key]);
      rows = result.rows;
    } catch (dbErr) {
      console.error('[DB] Erro na query validate:', dbErr.message);
      return res.json({ success: false, message: 'Database error, please try again' });
    }
    const keyRow = rows[0];

    if (!keyRow) {
    await addLog('validate_fail', `Key not found: ${license_key}`, clientIp);
    return res.json({ success: false, message: 'Key not found' });
  }

  if (keyRow.status === 'banned') {
    await addLog('validate_banned', `Key: ${license_key}`, clientIp);
    return res.json({ success: false, message: 'Key is banned' });
  }

  if (keyRow.paused) {
    await addLog('validate_paused', `Key: ${license_key}`, clientIp);
    return res.json({ success: false, message: 'Key is paused' });
  }

  if (keyRow.status === 'unused') {
    const now = new Date().toISOString().split('.')[0] + 'Z';
    let expiresAt = null;
    if (!keyRow.is_lifetime) {
      expiresAt = getExpiryDate(now, keyRow.duration_days);
    }

    await pool.query(`
      UPDATE license_keys SET 
        status = 'active', 
        activated_at = $1, 
        expires_at = $2, 
        hwid = $3,
        current_uses = 1
      WHERE id = $4
    `, [now, expiresAt, fingerprint || '', keyRow.id]);

    await addLog('key_activated', `Key: ${license_key}, HWID: ${fingerprint}`, clientIp);

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
        await pool.query("UPDATE license_keys SET status = 'expired' WHERE id = $1", [keyRow.id]);
        await addLog('key_expired', `Key: ${license_key}`, clientIp);
        return res.json({ success: false, message: 'License has expired' });
      }
    }

    if (keyRow.hwid && fingerprint && keyRow.hwid !== fingerprint) {
      await addLog('hwid_mismatch', `Key: ${license_key}, Expected: ${keyRow.hwid}, Got: ${fingerprint}`, clientIp);
      return res.json({ success: false, message: 'HWID mismatch. Reset required.' });
    }

    if (!keyRow.hwid && fingerprint) {
      await pool.query('UPDATE license_keys SET hwid = $1 WHERE id = $2', [fingerprint, keyRow.id]);
    }

    await pool.query('UPDATE license_keys SET current_uses = current_uses + 1 WHERE id = $1', [keyRow.id]);

    await addLog('validate_ok', `Key: ${license_key}`, clientIp);

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
    await addLog('validate_expired', `Key: ${license_key}`, clientIp);
    return res.json({ success: false, message: 'License has expired' });
  }

  return res.json({ success: false, message: 'Invalid license status' });
});

// POST /license/check
app.post('/license/check', async (req, res) => {
  const { license_key } = req.body;
  if (!license_key) {
    return res.json({ success: false, message: 'License key required' });
  }

    let checkRows;
    try {
      const result = await pool.query('SELECT * FROM license_keys WHERE key = $1', [license_key]);
      checkRows = result.rows;
    } catch (dbErr) {
      console.error('[DB] Erro na query check:', dbErr.message);
      return res.json({ success: false, message: 'Database error, please try again' });
    }
    const keyRow = checkRows[0];
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
app.post('/admin/login', async (req, res) => {
  try {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    await addLog('admin_login', `Admin logged in`, req.ip);
    return res.json({ success: true, token });
  }

  await addLog('admin_login_fail', `Failed login attempt: ${username}`, req.ip);
  return res.json({ success: false, message: 'Invalid credentials' });
  } catch (err) {
    console.error('[ADMIN] Erro no login:', err.message);
    return res.json({ success: false, message: 'Server error' });
  }
});

// ============================================================
//  ROTAS ADMIN - Dashboard
// ============================================================

// GET /admin/dashboard
app.get('/admin/dashboard', authAdmin, async (req, res) => {
  try {
  const totalKeys = (await pool.query('SELECT COUNT(*) as count FROM license_keys')).rows[0].count;
  const activeKeys = (await pool.query("SELECT COUNT(*) as count FROM license_keys WHERE status = 'active' AND paused = 0")).rows[0].count;
  const unusedKeys = (await pool.query("SELECT COUNT(*) as count FROM license_keys WHERE status = 'unused'")).rows[0].count;
  const expiredKeys = (await pool.query("SELECT COUNT(*) as count FROM license_keys WHERE status = 'expired'")).rows[0].count;
  const bannedKeys = (await pool.query("SELECT COUNT(*) as count FROM license_keys WHERE status = 'banned'")).rows[0].count;
  const pausedKeys = (await pool.query("SELECT COUNT(*) as count FROM license_keys WHERE paused = 1")).rows[0].count;

  const recentLogs = (await pool.query('SELECT * FROM logs ORDER BY id DESC LIMIT 50')).rows;

  res.json({
    success: true,
    stats: {
      total_keys: parseInt(totalKeys),
      active_keys: parseInt(activeKeys),
      unused_keys: parseInt(unusedKeys),
      expired_keys: parseInt(expiredKeys),
      banned_keys: parseInt(bannedKeys),
      paused_keys: parseInt(pausedKeys)
    },
    recent_logs: recentLogs
  });
  } catch (err) {
    console.error('[ADMIN] Erro no dashboard:', err.message);
    res.json({ success: false, message: 'Database error', stats: { total_keys: 0, active_keys: 0, unused_keys: 0, expired_keys: 0, banned_keys: 0, paused_keys: 0 }, recent_logs: [] });
  }
});

// ============================================================
//  ROTAS ADMIN - Keys (CRUD)
// ============================================================

// GET /admin/keys - Listar todas as keys
app.get('/admin/keys', authAdmin, async (req, res) => {
  try {
  const { status, search, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM license_keys WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM license_keys WHERE 1=1';
  const params = [];
  const countParams = [];
  let paramIndex = 1;
  let countParamIndex = 1;

  if (status) {
    query += ` AND status = $${paramIndex++}`;
    countQuery += ` AND status = $${countParamIndex++}`;
    params.push(status);
    countParams.push(status);
  }
  if (search) {
    query += ` AND (key LIKE $${paramIndex} OR notes LIKE $${paramIndex + 1} OR client_name LIKE $${paramIndex + 2})`;
    countQuery += ` AND (key LIKE $${countParamIndex} OR notes LIKE $${countParamIndex + 1} OR client_name LIKE $${countParamIndex + 2})`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    paramIndex += 3;
    countParamIndex += 3;
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(parseInt(limit), parseInt(offset));

  const keys = (await pool.query(query, params)).rows;
  const total = (await pool.query(countQuery, countParams)).rows[0].count;

  res.json({ success: true, keys, total: parseInt(total), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[ADMIN] Erro ao listar keys:', err.message);
    res.json({ success: false, message: 'Database error', keys: [], total: 0 });
  }
});

// POST /admin/keys - Criar nova key
app.post('/admin/keys', authAdmin, async (req, res) => {
  try {
  const { count = 1, duration_type = 'days', duration_days = 30, client_name = '' } = req.body;
  const keys = [];
  const isLifetime = duration_type === 'lifetime' ? 1 : 0;
  const days = isLifetime ? 0 : (parseInt(duration_days) || 30);

  for (let i = 0; i < Math.min(count, 100); i++) {
    const id = uuidv4();
    const key = generateLicenseKey(client_name, isLifetime, days);
    await pool.query(`
      INSERT INTO license_keys (id, key, status, duration_days, is_lifetime, client_name, notes, created_by)
      VALUES ($1, $2, 'unused', $3, $4, $5, '', 'admin')
    `, [id, key, days, isLifetime, client_name || '']);
    keys.push(key);
  }

  await addLog('keys_created', `Created ${keys.length} keys (${isLifetime ? 'lifetime' : days + 'd'}, client: ${client_name || 'none'})`, req.ip);
  res.json({ success: true, keys, count: keys.length });
  } catch (err) {
    console.error('[ADMIN] Erro ao criar keys:', err.message);
    res.json({ success: false, message: 'Database error' });
  }
});

// PUT /admin/keys/:id - Atualizar key
app.put('/admin/keys/:id', authAdmin, async (req, res) => {
  try {
  const { id } = req.params;
  const { status, duration_days, notes, hwid } = req.body;

  const { rows } = await pool.query('SELECT * FROM license_keys WHERE id = $1', [id]);
  const keyRow = rows[0];
  if (!keyRow) {
    return res.json({ success: false, message: 'Key not found' });
  }

  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (status !== undefined) { updates.push(`status = $${paramIndex++}`); params.push(status); }
  if (duration_days !== undefined) { updates.push(`duration_days = $${paramIndex++}`); params.push(duration_days); }
  if (notes !== undefined) { updates.push(`notes = $${paramIndex++}`); params.push(notes); }
  if (hwid !== undefined) { updates.push(`hwid = $${paramIndex++}`); params.push(hwid); }

  if (updates.length === 0) {
    return res.json({ success: false, message: 'No fields to update' });
  }

  params.push(id);
  await pool.query(`UPDATE license_keys SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);

  await addLog('key_updated', `Key ${keyRow.key} updated: ${JSON.stringify(req.body)}`, req.ip);
  res.json({ success: true, message: 'Key updated' });
  } catch (err) {
    console.error('[ADMIN] Erro ao atualizar key:', err.message);
    res.json({ success: false, message: 'Database error' });
  }
});

// DELETE /admin/keys/:id - Deletar key
app.delete('/admin/keys/:id', authAdmin, async (req, res) => {
  try {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM license_keys WHERE id = $1', [id]);
  const keyRow = rows[0];
  if (!keyRow) {
    return res.json({ success: false, message: 'Key not found' });
  }

  await pool.query('DELETE FROM license_keys WHERE id = $1', [id]);
  await addLog('key_deleted', `Key ${keyRow.key} deleted`, req.ip);
  res.json({ success: true, message: 'Key deleted' });
  } catch (err) {
    console.error('[ADMIN] Erro ao deletar key:', err.message);
    res.json({ success: false, message: 'Database error' });
  }
});

// POST /admin/keys/import - Importar keys de arquivo TXT
app.post('/admin/keys/import', authAdmin, async (req, res) => {
  try {
    const { keys } = req.body;
    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return res.json({ success: false, message: 'Nenhuma key para importar' });
    }

    var imported = 0;
    var skipped = 0;

    for (var i = 0; i < keys.length; i++) {
      var keyStr = keys[i].trim();
      if (!keyStr) continue;

      // Verificar se a key já existe
      var existing = await pool.query('SELECT id FROM license_keys WHERE key = $1', [keyStr]);
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      // Inserir nova key
      var id = uuidv4();
      await pool.query(
        "INSERT INTO license_keys (id, key, status, duration_days, is_lifetime, client_name, notes, created_by) VALUES ($1, $2, 'unused', 30, 0, '', '', 'import')",
        [id, keyStr]
      );
      imported++;
    }

    await addLog('keys_imported', `Imported ${imported} keys (${skipped} skipped)`, req.ip);
    res.json({ success: true, imported: imported, skipped: skipped, message: `${imported} keys importadas, ${skipped} ignoradas` });
  } catch (err) {
    console.error('[ADMIN] Erro ao importar keys:', err.message);
    res.json({ success: false, message: 'Database error' });
  }
});

// DELETE /admin/keys - Deletar todas as keys
app.delete('/admin/keys', authAdmin, async (req, res) => {
  try {
  const countResult = await pool.query('SELECT COUNT(*) as count FROM license_keys');
  const count = countResult.rows[0].count;
  await pool.query('DELETE FROM license_keys');
  await pool.query('DELETE FROM logs');
  await addLog('keys_deleted_all', `All ${count} keys deleted`, req.ip);
  res.json({ success: true, message: `${count} keys deleted`, count: parseInt(count) });
  } catch (err) {
    console.error('[ADMIN] Erro ao deletar todas keys:', err.message);
    res.json({ success: false, message: 'Database error' });
  }
});

// POST /admin/keys/:id/reset-hwid
app.post('/admin/keys/:id/reset-hwid', authAdmin, async (req, res) => {
  try {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM license_keys WHERE id = $1', [id]);
  const keyRow = rows[0];
  if (!keyRow) {
    return res.json({ success: false, message: 'Key not found' });
  }

  await pool.query('UPDATE license_keys SET hwid = $1 WHERE id = $2', ['', id]);
  await addLog('hwid_reset', `HWID reset for key ${keyRow.key} (dias mantidos)`, req.ip);
  res.json({ success: true, message: 'HWID reset successfully' });
  } catch (err) {
    console.error('[ADMIN] Erro ao resetar HWID:', err.message);
    res.json({ success: false, message: 'Database error' });
  }
});

// POST /admin/keys/:id/pause
app.post('/admin/keys/:id/pause', authAdmin, async (req, res) => {
  try {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM license_keys WHERE id = $1', [id]);
  const keyRow = rows[0];
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

    await pool.query('UPDATE license_keys SET paused = 0, paused_at = NULL, total_paused_ms = $1, expires_at = $2 WHERE id = $3',
      [newTotalPaused, newExpiresAt, id]);

    await addLog('key_unpaused', `Key ${keyRow.key} unpaused`, req.ip);
    res.json({ success: true, message: 'Key unpaused', action: 'unpaused' });
  } else {
    const now = new Date().toISOString().split('.')[0] + 'Z';
    await pool.query('UPDATE license_keys SET paused = 1, paused_at = $1 WHERE id = $2', [now, id]);

    await addLog('key_paused', `Key ${keyRow.key} paused`, req.ip);
    res.json({ success: true, message: 'Key paused', action: 'paused' });
  }
  } catch (err) {
    console.error('[ADMIN] Erro ao pausar/despausar key:', err.message);
    res.json({ success: false, message: 'Database error' });
  }
});

// POST /admin/keys/pause-all
app.post('/admin/keys/pause-all', authAdmin, async (req, res) => {
  try {
  const pausedCount = (await pool.query("SELECT COUNT(*) as count FROM license_keys WHERE paused = 1")).rows[0].count;
  const activeCount = (await pool.query("SELECT COUNT(*) as count FROM license_keys WHERE status = 'active' AND paused = 0")).rows[0].count;

  if (parseInt(pausedCount) > 0 && parseInt(activeCount) === 0) {
    const pausedKeys = (await pool.query("SELECT * FROM license_keys WHERE paused = 1")).rows;
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

      await pool.query('UPDATE license_keys SET paused = 0, paused_at = NULL, total_paused_ms = $1, expires_at = $2 WHERE id = $3',
        [newTotalPaused, newExpiresAt, key.id]);
    }

    await addLog('keys_unpaused_all', `All ${pausedKeys.length} keys unpaused`, req.ip);
    res.json({ success: true, message: `${pausedKeys.length} keys unpaused`, action: 'unpaused' });
  } else {
    const activeKeys = (await pool.query("SELECT * FROM license_keys WHERE status = 'active' AND paused = 0")).rows;
    const now = new Date().toISOString().split('.')[0] + 'Z';

    for (const key of activeKeys) {
      await pool.query('UPDATE license_keys SET paused = 1, paused_at = $1 WHERE id = $2', [now, key.id]);
    }

    await addLog('keys_paused_all', `All ${activeKeys.length} active keys paused`, req.ip);
    res.json({ success: true, message: `${activeKeys.length} keys paused`, action: 'paused' });
  }
  } catch (err) {
    console.error('[ADMIN] Erro ao pausar/despausar todas keys:', err.message);
    res.json({ success: false, message: 'Database error' });
  }
});

// POST /admin/keys/:id/extend
app.post('/admin/keys/:id/extend', authAdmin, async (req, res) => {
  try {
  const { id } = req.params;
  const { days = 30 } = req.body;

  const { rows } = await pool.query('SELECT * FROM license_keys WHERE id = $1', [id]);
  const keyRow = rows[0];
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

  await pool.query('UPDATE license_keys SET expires_at = $1, status = $2 WHERE id = $3', [newExpiry, 'active', id]);
  await addLog('key_extended', `Key ${keyRow.key} extended by ${days} days`, req.ip);
  res.json({ success: true, message: `Extended by ${days} days`, expires_at: newExpiry });
  } catch (err) {
    console.error('[ADMIN] Erro ao estender key:', err.message);
    res.json({ success: false, message: 'Database error' });
  }
});

// ============================================================
//  ROTAS ADMIN - Logs
// ============================================================
app.get('/admin/logs', authAdmin, async (req, res) => {
  try {
  const { page = 1, limit = 100, action } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM logs WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM logs WHERE 1=1';
  const params = [];
  const countParams = [];
  let paramIndex = 1;
  let countParamIndex = 1;

  if (action) {
    query += ` AND action LIKE $${paramIndex++}`;
    countQuery += ` AND action LIKE $${countParamIndex++}`;
    params.push(`%${action}%`);
    countParams.push(`%${action}%`);
  }

  query += ` ORDER BY id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(parseInt(limit), parseInt(offset));

  const logs = (await pool.query(query, params)).rows;
  const total = (await pool.query(countQuery, countParams)).rows[0].count;

  res.json({ success: true, logs, total: parseInt(total), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[ADMIN] Erro ao listar logs:', err.message);
    res.json({ success: false, message: 'Database error', logs: [], total: 0 });
  }
});

// DELETE /admin/logs
app.delete('/admin/logs', authAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM logs');
    await addLog('logs_cleared', 'All logs cleared', req.ip);
    res.json({ success: true, message: 'Logs cleared' });
  } catch (err) {
    console.error('[ADMIN] Erro ao limpar logs:', err.message);
    res.json({ success: false, message: 'Database error' });
  }
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
//  Graceful shutdown
// ============================================================
process.on('SIGINT', async () => {
  console.log('\n[DB] Closing database connection...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[DB] Closing database connection...');
  await pool.end();
  process.exit(0);
});

// ============================================================
//  Iniciar servidor
// ============================================================
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║     PEDRIN XITS - Auth Panel v3.1           ║`);
    console.log(`╠══════════════════════════════════════════════╣`);
    console.log(`║  Server:  http://localhost:${PORT}              ║`);
    console.log(`║  Panel:   http://localhost:${PORT}/admin         ║`);
    console.log(`║  API:     http://localhost:${PORT}/license       ║`);
    console.log(`║  Health:  http://localhost:${PORT}/health        ║`);
    console.log(`║                                              ║`);
    console.log(`║  DB:     PostgreSQL (Neon - persistente)     ║`);
    console.log(`║  Keep-Alive: 2 min (Neon anti-suspend)       ║`);
    console.log(`║  Admin:   ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}               ║`);
    console.log(`╚══════════════════════════════════════════════╝\n`);
  });
}).catch(err => {
  console.error('[DB] Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;