const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const BOT_TOKEN = process.env.BOT_TOKEN;
require('dotenv').config();
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'есть' : 'нет');
console.log('BOT_TOKEN:', BOT_TOKEN ? 'есть' : 'нет');
const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const rateLimit = require('express-rate-limit');

const defaultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Слишком много запросов, подождите минуту' }
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Слишком много попыток, подождите минуту' }
});

app.use('/api/', defaultLimiter);
app.use('/api/verify-channel', strictLimiter);
app.use('/api/send-message', strictLimiter);

app.use(express.static(path.join(__dirname, 'public')));

const crypto = require('crypto');

// ── Допустимые валюты ─────────────────────────────────────────────────────────
const VALID_CURRENCIES = ['RUB', 'KZT', 'TON', 'USD', 'STARS'];

const CURRENCY_SYMBOLS = {
  RUB: '₽', KZT: '₸', TON: 'ꘜ', USD: '$', STARS: '⭐️'
};

function verifyTelegramInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();

    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return expectedHash === hash;
  } catch {
    return false;
  }
}

function requireTgAuth(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData || initData === '') return next();
  if (!verifyTelegramInitData(initData)) {
    return res.status(401).json({ error: 'Invalid Telegram data' });
  }
  next();
}

const VALID_CATEGORIES = [
  'tech','business','finance','games',
  'art','news','entertainment','edu','other'
];

// Нормализует цену: пустая строка → null, '-' → '-', число → число
function normalizePrice(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str === '' || str === 'null') return null;
  if (str === '-') return '-';
  const num = parseFloat(str);
  if (isNaN(num) || num < 0 || num > 10000000) return null;
  return String(num);
}

function validateChannelData({ usname, category, pricead_24, pricead_48, pricead_72, pricead_all }) {
  if (!usname || typeof usname !== 'string' || usname.length > 50) {
    return 'Некорректный username';
  }
  if (!/^[a-zA-Z0-9_]{3,50}$/.test(usname)) {
    return 'Username содержит недопустимые символы';
  }
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return 'Недопустимая категория';
  }
  // Цены проверяем мягко — normalizePrice обработает
  return null;
}

// ===== STATS =====
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total_channels,
        COALESCE(SUM(subscribers), 0) AS total_subscribers,
        COUNT(*) FILTER (WHERE owner_id IN (
          SELECT user_id FROM user_admin WHERE premium = TRUE
        )) AS premium_channels
      FROM channels
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== USERS =====

app.post('/api/users', requireTgAuth, async (req, res) => {
  try {
    const { id, username, first_name, last_name } = req.body;
    const result = await pool.query(`
      INSERT INTO users (id, username, first_name, last_name, currency_primary, currency_extra)
      VALUES ($1, $2, $3, $4, 'RUB', '[]'::jsonb)
      ON CONFLICT (id) DO UPDATE
      SET username = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name
      RETURNING *
    `, [id, username || '', first_name || '', last_name || '']);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id/currency', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT currency_primary, currency_extra FROM users WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.json({ currency_primary: 'RUB', currency_extra: [] });
    }
    const row = result.rows[0];
    let extras = row.currency_extra;
    if (typeof extras === 'string') {
      try { extras = JSON.parse(extras); } catch { extras = []; }
    }
    res.json({
      currency_primary: row.currency_primary || 'RUB',
      currency_extra:   Array.isArray(extras) ? extras : []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/currency', requireTgAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { currency_primary, currency_extra } = req.body;

    if (!VALID_CURRENCIES.includes(currency_primary)) {
      return res.status(400).json({ error: 'Недопустимая основная валюта' });
    }

    const extras = (Array.isArray(currency_extra) ? currency_extra : [])
      .filter(c => VALID_CURRENCIES.includes(c) && c !== currency_primary);

    const result = await pool.query(
      `UPDATE users
       SET currency_primary = $1, currency_extra = $2::jsonb
       WHERE id = $3
       RETURNING currency_primary, currency_extra`,
      [currency_primary, JSON.stringify(extras), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    await pool.query(
      `UPDATE channels SET currency = $1 WHERE owner_id = $2`,
      [currency_primary, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== CHANNELS =====

app.get('/api/channels', async (req, res) => {
  try {
    const { category, currency } = req.query;

    let whereClause = '';
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      whereClause += ` WHERE c.category = $${params.length}`;
    }

    if (currency && currency !== 'all' && VALID_CURRENCIES.includes(currency)) {
      const connector = whereClause ? ' AND' : ' WHERE';
      params.push(currency);
      whereClause += `${connector} (
        c.currency = $${params.length}
        OR u.currency_extra @> to_jsonb($${params.length}::text)
      )`;
    }

    const result = await pool.query(
      `SELECT c.*,
              COALESCE(u.currency_primary, 'RUB') AS owner_currency_primary,
              COALESCE(u.currency_extra,   '[]'::jsonb) AS owner_currency_extra
       FROM channels c
       LEFT JOIN users u ON c.owner_id = u.id
       ${whereClause}
       ORDER BY c.subscribers DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/channels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT c.*,
              COALESCE(u.currency_primary, 'RUB') AS owner_currency_primary,
              COALESCE(u.currency_extra,   '[]'::jsonb) AS owner_currency_extra
       FROM channels c
       LEFT JOIN users u ON c.owner_id = u.id
       WHERE c.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Канал не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/channels', requireTgAuth, async (req, res) => {
  try {
    const { name, usname, category, subscribers, pricead_24, pricead_48, pricead_72, pricead_all, owner_id, avatar_url, currency } = req.body;
    const channelCurrency = VALID_CURRENCIES.includes(currency) ? currency : 'RUB';

    const p24  = normalizePrice(pricead_24);
    const p48  = normalizePrice(pricead_48);
    const p72  = normalizePrice(pricead_72);
    const pAll = normalizePrice(pricead_all);

    const existing = await pool.query(
      'SELECT id, owner_id FROM channels WHERE usname = $1',
      [usname]
    );

    if (existing.rows.length > 0) {
      const ch = existing.rows[0];
      if (String(ch.owner_id) !== String(owner_id)) {
        return res.status(409).json({ error: 'Этот канал уже добавлен другим пользователем' });
      }
      const result = await pool.query(
        `UPDATE channels SET name=$1, category=$2, subscribers=$3,
         pricead_24=$4, pricead_48=$5, pricead_72=$6, pricead_all=$7, avatar_url=$8, currency=$9
         WHERE usname=$10 RETURNING *`,
        [name, category, subscribers || 0, p24, p48, p72, pAll, avatar_url || null, channelCurrency, usname]
      );
      return res.json(result.rows[0]);
    }

    const result = await pool.query(
      `INSERT INTO channels (name, usname, category, subscribers, pricead_24, pricead_48, pricead_72, pricead_all, owner_id, avatar_url, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [name, usname, category, subscribers || 0, p24, p48, p72, pAll, owner_id, avatar_url || null, channelCurrency]
    );
    res.status(201).json(result.rows[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/channels/:id', requireTgAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, usname, category, subscribers, pricead_24, pricead_48, pricead_72, pricead_all, user_id, currency } = req.body;
    const channelCurrency = VALID_CURRENCIES.includes(currency) ? currency : 'RUB';

    if (!user_id) {
      return res.status(401).json({ error: 'Не авторизован' });
    }

    const check = await pool.query(
      'SELECT owner_id FROM channels WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Канал не найден' });
    }

    if (String(check.rows[0].owner_id) !== String(user_id)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const p24  = normalizePrice(pricead_24);
    const p48  = normalizePrice(pricead_48);
    const p72  = normalizePrice(pricead_72);
    const pAll = normalizePrice(pricead_all);

    const result = await pool.query(
      `UPDATE channels SET name=$1, usname=$2, category=$3,
       pricead_24=$4, pricead_48=$5, pricead_72=$6, pricead_all=$7, currency=$8
       WHERE id=$9 RETURNING *`,
      [name, usname, category, p24, p48, p72, pAll, channelCurrency, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/channels/:id', requireTgAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(401).json({ error: 'Не авторизован' });
    }

    // CASCADE удаляет канал из network_channels автоматически
    const result = await pool.query(
      'DELETE FROM channels WHERE id = $1 AND owner_id = $2 RETURNING *',
      [id, parseInt(user_id)]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({ error: 'Нет доступа или канал не найден' });
    }

    // Удаляем пустые сетки этого пользователя (в которых не осталось каналов)
    await pool.query(`
      DELETE FROM channel_networks cn
      WHERE cn.owner_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM network_channels nc WHERE nc.network_id = cn.id
        )
    `, [parseInt(user_id)]);

    res.json({ message: 'Канал удалён' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== USER_ADMIN =====

app.get('/api/user/:user_id/channels', async (req, res) => {
  try {
    const { user_id } = req.params;
    const result = await pool.query(
      `SELECT c.*, ua.premium, ua.premium_day, ua.added_at
       FROM channels c
       JOIN user_admin ua ON c.id = ua.channel_id
       WHERE ua.user_id = $1`,
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user_admin', requireTgAuth, async (req, res) => {
  try {
    const { user_id, channel_id, premium } = req.body;
    const result = await pool.query(
      `INSERT INTO user_admin (user_id, channel_id, premium) VALUES ($1, $2, $3) RETURNING *`,
      [user_id, channel_id, premium ?? false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/user_admin/:user_id/:channel_id', requireTgAuth, async (req, res) => {
  try {
    const { user_id, channel_id } = req.params;
    const { premium, premium_day } = req.body;
    const result = await pool.query(
      `UPDATE user_admin SET premium=$1, premium_day=$2 WHERE user_id=$3 AND channel_id=$4 RETURNING *`,
      [premium, premium_day, user_id, channel_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/user_admin/:user_id/:channel_id', requireTgAuth, async (req, res) => {
  try {
    const { user_id, channel_id } = req.params;
    await pool.query('DELETE FROM user_admin WHERE user_id=$1 AND channel_id=$2', [user_id, channel_id]);
    res.json({ message: 'Удалено' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== CHANNEL NETWORKS (СЕТКИ) =====

// Получить все сетки пользователя (с каналами)
app.get('/api/user/:user_id/networks', async (req, res) => {
  try {
    const { user_id } = req.params;
    const nets = await pool.query(
      `SELECT * FROM channel_networks WHERE owner_id = $1 ORDER BY created_at DESC`,
      [user_id]
    );

    const result = [];
    for (const net of nets.rows) {
      const channels = await pool.query(
        `SELECT c.id, c.name, c.usname, c.category, c.subscribers, c.avatar_url,
                c.pricead_24, c.pricead_48, c.pricead_72, c.pricead_all,
                COALESCE(u.currency_primary, c.currency, 'RUB') AS currency,
                COALESCE(u.currency_extra, '[]'::jsonb) AS currency_extra
         FROM channels c
         JOIN network_channels nc ON c.id = nc.channel_id
         LEFT JOIN users u ON c.owner_id = u.id
         WHERE nc.network_id = $1
         ORDER BY nc.added_at`,
        [net.id]
      );
      result.push({ ...net, channels: channels.rows });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// !! ВАЖНО: /api/networks/all ДОЛЖЕН быть до /api/networks/:id
// иначе Express трактует 'all' как :id
app.get('/api/networks/all', async (req, res) => {
  try {
    const { category } = req.query;
    const params = [];
    let where = `WHERE cn.is_public = TRUE`;

    if (category && category !== 'all' && VALID_CATEGORIES.includes(category)) {
      params.push(category);
      where += ` AND cn.category = $${params.length}`;
    }

    const nets = await pool.query(
      `SELECT cn.*, u.username AS owner_username
       FROM channel_networks cn
       LEFT JOIN users u ON cn.owner_id = u.id
       ${where}
       ORDER BY cn.created_at DESC`,
      params
    );

    const result = [];
    for (const net of nets.rows) {
      const channels = await pool.query(
        `SELECT c.id, c.name, c.usname, c.category, c.subscribers, c.avatar_url,
                c.pricead_24, c.pricead_48, c.pricead_72, c.pricead_all,
                COALESCE(u2.currency_primary, c.currency, 'RUB') AS currency,
                COALESCE(u2.currency_extra, '[]'::jsonb) AS currency_extra
         FROM channels c
         JOIN network_channels nc ON c.id = nc.channel_id
         LEFT JOIN users u2 ON c.owner_id = u2.id
         WHERE nc.network_id = $1
         ORDER BY nc.added_at`,
        [net.id]
      );
      result.push({ ...net, channels: channels.rows });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/networks', requireTgAuth, async (req, res) => {
  try {
    const { user_id, name, pricead_24, pricead_48, pricead_72, pricead_all, currency, category, is_public } = req.body;
    if (!user_id) return res.status(401).json({ error: 'Не авторизован' });

    const cur = VALID_CURRENCIES.includes(currency) ? currency : 'RUB';
    const cat = VALID_CATEGORIES.includes(category) ? category : null;
    const result = await pool.query(
      `INSERT INTO channel_networks (owner_id, name, pricead_24, pricead_48, pricead_72, pricead_all, currency, category, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [user_id, name || 'Моя сетка',
       normalizePrice(pricead_24), normalizePrice(pricead_48),
       normalizePrice(pricead_72), normalizePrice(pricead_all),
       cur, cat, is_public === true]
    );
    res.status(201).json({ ...result.rows[0], channels: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Обновить сетку
app.put('/api/networks/:id', requireTgAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, name, pricead_24, pricead_48, pricead_72, pricead_all, currency, category, is_public } = req.body;
    if (!user_id) return res.status(401).json({ error: 'Не авторизован' });

    const check = await pool.query('SELECT owner_id FROM channel_networks WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Сетка не найдена' });
    if (String(check.rows[0].owner_id) !== String(user_id)) return res.status(403).json({ error: 'Нет доступа' });

    const cur = VALID_CURRENCIES.includes(currency) ? currency : 'RUB';
    const cat = VALID_CATEGORIES.includes(category) ? category : null;
    const result = await pool.query(
      `UPDATE channel_networks
       SET name=$1, pricead_24=$2, pricead_48=$3, pricead_72=$4, pricead_all=$5,
           currency=$6, category=$7, is_public=$8
       WHERE id=$9 RETURNING *`,
      [name, normalizePrice(pricead_24), normalizePrice(pricead_48),
       normalizePrice(pricead_72), normalizePrice(pricead_all),
       cur, cat, is_public === true, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Удалить сетку
app.delete('/api/networks/:id', requireTgAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    if (!user_id) return res.status(401).json({ error: 'Не авторизован' });

    const check = await pool.query('SELECT owner_id FROM channel_networks WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Сетка не найдена' });
    if (String(check.rows[0].owner_id) !== String(user_id)) return res.status(403).json({ error: 'Нет доступа' });

    await pool.query('DELETE FROM channel_networks WHERE id = $1', [id]);
    res.json({ message: 'Сетка удалена' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Добавить канал в сетку
app.post('/api/networks/:id/channels', requireTgAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, channel_id } = req.body;
    if (!user_id) return res.status(401).json({ error: 'Не авторизован' });

    const check = await pool.query('SELECT owner_id FROM channel_networks WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Сетка не найдена' });
    if (String(check.rows[0].owner_id) !== String(user_id)) return res.status(403).json({ error: 'Нет доступа' });

    // Проверяем что канал принадлежит этому пользователю
    const chCheck = await pool.query('SELECT owner_id FROM channels WHERE id = $1', [channel_id]);
    if (chCheck.rows.length === 0) return res.status(404).json({ error: 'Канал не найден' });
    if (String(chCheck.rows[0].owner_id) !== String(user_id)) return res.status(403).json({ error: 'Это не ваш канал' });

    await pool.query(
      `INSERT INTO network_channels (network_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, channel_id]
    );
    res.json({ message: 'Канал добавлен в сетку' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Удалить канал из сетки
app.delete('/api/networks/:id/channels/:channel_id', requireTgAuth, async (req, res) => {
  try {
    const { id, channel_id } = req.params;
    const { user_id } = req.body;
    if (!user_id) return res.status(401).json({ error: 'Не авторизован' });

    const check = await pool.query('SELECT owner_id FROM channel_networks WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Сетка не найдена' });
    if (String(check.rows[0].owner_id) !== String(user_id)) return res.status(403).json({ error: 'Нет доступа' });

    await pool.query('DELETE FROM network_channels WHERE network_id=$1 AND channel_id=$2', [id, channel_id]);
    res.json({ message: 'Канал удалён из сетки' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== ВЕРИФИКАЦИЯ КАНАЛА =====
app.post('/api/verify-channel', requireTgAuth, async (req, res) => {
  const { usname, user_id } = req.body;
  if (!usname || !user_id) return res.status(400).json({ error: 'Укажи usname и user_id' });

  // ── Нормализация ввода ──────────────────────────────────────────────────────
  // Публичные:  @AdsWay_Official | AdsWay_Official | t.me/AdsWay_Official | https://t.me/AdsWay_Official
  // Приватные:  -1001234567890 | 1001234567890  (числовой ID канала)

  let raw = usname.trim();
  raw = raw.replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '');
  if (raw.startsWith('@')) raw = raw.slice(1);

  // Числовой ID: -1001234567890 или 1001234567890
  const isNumericId = /^-?\d{9,}$/.test(raw);

  let chatId;
  if (isNumericId) {
    chatId = raw.startsWith('-') ? raw : `-${raw}`;
  } else {
    chatId = `@${raw}`;
  }

  try {
    // 1. getChat — проверяем что бот в канале
    const chatRes = await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChat`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId }) }
    );
    const chatData = await chatRes.json();

    if (!chatData.ok) {
      return res.status(400).json({
        verified: false,
        error: isNumericId
          ? `Канал не найден. Проверьте что:\n1. Бот @adsway_bot добавлен в канал как администратор\n2. ID верный: ${chatId}\nОшибка: ${chatData.description}`
          : `Канал не найден или бот не добавлен. Ошибка: ${chatData.description}`
      });
    }

    const chat          = chatData.result;
    const numericChatId = chat.id;
    const channelName   = chat.title || null;
    const finalUsname   = chat.username || String(numericChatId);

    // 2. getChatMember — проверяем роль
    const memberRes = await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: numericChatId, user_id: parseInt(user_id) }) }
    );
    const memberData = await memberRes.json();

    if (!memberData.ok) {
      return res.status(403).json({
        verified: false,
        error: `Не удалось проверить роль: ${memberData.description || 'неизвестная ошибка'}`
      });
    }

    const status = memberData.result?.status;
    if (status !== 'creator' && status !== 'administrator') {
      return res.status(403).json({
        verified: false,
        error: `Вы не являетесь администратором этого канала (статус: ${status})`
      });
    }

    // 3. getChatMemberCount — подписчики
    const countRes = await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMemberCount`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: numericChatId }) }
    );
    const countData   = await countRes.json();
    const subscribers = countData.ok ? countData.result : 0;

    // 4. Аватар
    let avatar_url = null;
    if (chat.photo) {
      const fileRes = await fetch(
        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: chat.photo.big_file_id }) }
      );
      const fileData = await fileRes.json();
      if (fileData.ok) {
        avatar_url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileData.result.file_path}`;
      }
    }

    res.json({ verified: true, role: status, subscribers, avatar_url,
               name: channelName, usname: finalUsname,
               is_private: isNumericId, numeric_id: numericChatId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== SEND MESSAGE =====
app.post('/api/send-message', requireTgAuth, async (req, res) => {
  const { user_id, channel_id } = req.body;

  if (!user_id || !channel_id) {
    return res.status(400).json({ error: 'Не хватает параметров' });
  }

  try {
    const result = await pool.query(
      `SELECT c.*, COALESCE(u.currency_primary,'RUB') as owner_currency_primary,
              COALESCE(u.currency_extra,'[]'::jsonb) as owner_currency_extra
       FROM channels c LEFT JOIN users u ON c.owner_id = u.id
       WHERE c.id = $1`,
      [channel_id]
    );
    const ch = result.rows[0];
    if (!ch) return res.status(404).json({ error: 'Канал не найден' });

    // Строим ссылку для кнопки:
    // 1. Приоритет — tg://user?id=OWNER_ID (работает без username)
    // 2. Запасной — ссылка на сам канал
    let contactUrl = null;

    if (ch.owner_id) {
      // Пробуем через Telegram ID владельца
      contactUrl = `tg://user?id=${ch.owner_id}`;
    }

    if (!contactUrl) {
      // Запасной: ссылка на канал
      const usname = String(ch.usname || '');
      const isNumeric = /^-?\d+$/.test(usname);
      if (!isNumeric && usname) {
        contactUrl = `https://t.me/${usname}`;
      } else if (isNumeric) {
        // Приватный канал — убираем -100 префикс для invite-ссылки
        const cleanId = usname.replace(/^-100/, '');
        contactUrl = `https://t.me/c/${cleanId}/1`;
      }
    }

    if (!contactUrl) {
      return res.status(400).json({ error: 'Не удалось определить способ связи с владельцем' });
    }

    // Берём валюту владельца (owner_currency_primary), а не поле канала
    const ownerCurrency = ch.owner_currency_primary || ch.currency || 'RUB';
    const sym = CURRENCY_SYMBOLS[ownerCurrency] || '₽';
    const formatPrice = (p) => (p && p !== '-') ? `${p}${sym}` : '—';
    const price24  = formatPrice(ch.pricead_24);
    const price48  = formatPrice(ch.pricead_48);
    const price72  = formatPrice(ch.pricead_72);
    const priceAll = formatPrice(ch.pricead_all);

    let extras = ch.owner_currency_extra;
    if (typeof extras === 'string') { try { extras = JSON.parse(extras); } catch { extras = []; } }
    const allCurrs = [ownerCurrency, ...(Array.isArray(extras) ? extras.filter(c => c !== ownerCurrency) : [])];
    const payStr = allCurrs.map(c => CURRENCY_SYMBOLS[c] || c).join(', ');

    const text =
      `📢 *${ch.name}*\n` +
      `@${ch.usname}\n\n` +
      `💰 Реклама 24ч: ${price24}\n` +
      `💰 Реклама 48ч: ${price48}\n` +
      `💰 Реклама 72ч: ${price72}\n` +
      `💰 Реклама навсегда: ${priceAll}\n` +
      `👥 Подписчиков: ${ch.subscribers || 0}\n` +
      `💳 Оплата: ${payStr}\n\n` +
      `Напишите администратору канала 👇`;

    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user_id,
        text,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✍️ Написать администратору', url: contactUrl }
          ]]
        }
      }),
    });

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      return res.status(500).json({ error: tgData.description });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error('send-message error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== SEND NETWORK MESSAGE =====
app.post('/api/send-network-message', requireTgAuth, async (req, res) => {
  const { user_id, network_id } = req.body;
  if (!user_id || !network_id) {
    return res.status(400).json({ error: 'Не хватает параметров' });
  }

  try {
    // Данные сетки + владелец
    const netResult = await pool.query(
      `SELECT cn.*,
              u.username     AS owner_username,
              COALESCE(u.currency_primary, 'RUB') AS owner_currency_primary,
              COALESCE(u.currency_extra,   '[]'::jsonb) AS owner_currency_extra
       FROM channel_networks cn
       LEFT JOIN users u ON cn.owner_id = u.id
       WHERE cn.id = $1`,
      [network_id]
    );
    const net = netResult.rows[0];
    if (!net) return res.status(404).json({ error: 'Сетка не найдена' });

    // Каналы сетки с валютой владельца
    const chResult = await pool.query(
      `SELECT c.id, c.name, c.usname, c.subscribers,
              c.pricead_24, c.pricead_48, c.pricead_72, c.pricead_all,
              COALESCE(u2.currency_primary, c.currency, 'RUB') AS currency
       FROM channels c
       JOIN network_channels nc ON c.id = nc.channel_id
       LEFT JOIN users u2 ON c.owner_id = u2.id
       WHERE nc.network_id = $1
       ORDER BY nc.added_at`,
      [network_id]
    );
    const channels = chResult.rows;

    // Имя владельца для кнопки
    const ownerUsername = net.owner_username || null;
    if (!ownerUsername) {
      return res.status(400).json({ error: 'У владельца сетки нет username в Telegram' });
    }

    // Валюта и символ сетки
    const netSym = CURRENCY_SYMBOLS[net.currency || 'RUB'] || '₽';
    const fmtP = (p) => (p && p !== '-') ? `${p}${netSym}` : '—';

    // Строки по каналам
    const chLines = channels.map(c =>
      `${c.name} (@${c.usname})`
    ).join('\n');

    // Суммарные подписчики
    const totalSubs = channels.reduce((s, c) => s + (parseInt(c.subscribers) || 0), 0);

    // Допвалюты
    let extras = net.owner_currency_extra;
    if (typeof extras === 'string') { try { extras = JSON.parse(extras); } catch { extras = []; } }
    const ownerCur = net.owner_currency_primary || 'RUB';
    const allCurrs = [ownerCur, ...(Array.isArray(extras) ? extras.filter(c => c !== ownerCur) : [])];
    const payStr = allCurrs.map(c => CURRENCY_SYMBOLS[c] || c).join(', ');

    const catNames = {
      tech:'Технологии', business:'Бизнес', finance:'Финансы', games:'Игры',
      art:'Творчество', news:'Новости', entertainment:'Развлечения', edu:'Образование', other:'Другое'
    };
    const catStr = net.category ? ` · ${catNames[net.category] || net.category}` : '';

    const text =
      `📋 *Сетка каналов: ${net.name}*${catStr}\n` +
      `👥 Всего подписчиков: ${totalSubs}\n\n` +
      `💰 Цена рекламы в сетке:\n` +
      `   24ч: ${fmtP(net.pricead_24)} · 48ч: ${fmtP(net.pricead_48)}\n` +
      `   72ч: ${fmtP(net.pricead_72)} · Навсегда: ${fmtP(net.pricead_all)}\n\n` +
      `📋 Каналы в сетке:\n\n${chLines}\n\n` +
      `💳 Оплата: ${payStr}\n\n` +
      `Напишите владельцу сетки 👇`;

    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user_id,
        text,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✍️ Написать владельцу сетки', url: `https://t.me/${ownerUsername}` }
          ]]
        }
      }),
    });

    const tgData = await tgRes.json();
    if (!tgData.ok) return res.status(500).json({ error: tgData.description });

    res.json({ ok: true });
  } catch (err) {
    console.error('send-network-message error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ===== SHARE LINK — generate / resolve =====

// Создать share-ссылку (возвращает deeplink)
app.post('/api/share-link', requireTgAuth, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(401).json({ error: 'Не авторизован' });
  // Ссылка вида https://t.me/adsway_bot?start=share_USER_ID
  const link = `https://t.me/adsway_bot?start=share_${user_id}`;
  res.json({ ok: true, link });
});

// ===== COLLAB =====
app.patch('/api/channels/:id/collab', requireTgAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { collab, user_id } = req.body;

    if (!user_id) {
      return res.status(401).json({ error: 'Не авторизован' });
    }

    const check = await pool.query(
      'SELECT owner_id FROM channels WHERE id = $1', [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Канал не найден' });
    }

    if (String(check.rows[0].owner_id) !== String(user_id)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const result = await pool.query(
      'UPDATE channels SET collab = $1 WHERE id = $2 RETURNING *',
      [collab, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Разрешаем пустую категорию у channels — нужно для автоматической
//    регистрации канала ботом (category заполняется позже владельцем) ─────────
pool.query(`ALTER TABLE channels ALTER COLUMN category DROP NOT NULL;`)
  .then(() => console.log('✅ channels.category теперь nullable'))
  .catch(e => console.error('channels.category migration error:', e));

// ── Таблица pending_channel_ids — очередь уведомлений WebApp об автодобавлении ─
// Канал уже создаётся ботом напрямую в channels/user_admin в момент, когда его
// добавляют администратором. Эта таблица — лёгкий сигнал «обнови список»,
// который забирает поллинг на фронте.
pool.query(`
  CREATE TABLE IF NOT EXISTS pending_channel_ids (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    chat_id      TEXT NOT NULL,
    channel_name TEXT,
    channel_id   BIGINT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE pending_channel_ids ADD COLUMN IF NOT EXISTS channel_id BIGINT;
`).then(() => console.log('✅ pending_channel_ids готова'))
  .catch(e => console.error('pending_channel_ids init error:', e));

// Автоочистка старых записей (старше 10 минут) — раз в 5 минут
setInterval(() => {
  pool.query(`DELETE FROM pending_channel_ids WHERE created_at < NOW() - INTERVAL '10 minutes'`)
    .catch(() => {});
}, 5 * 60 * 1000);

// ── GET /api/verify-channel/pending/:user_id — забирает ОДНУ запись из очереди ─
// Используется WebApp'ом для поллинга на странице «Управление каналами»:
// как только бота добавили админом в канал, отсюда прилетает сигнал
// с channel_id уже готового (сохранённого в БД) канала.
app.get('/api/verify-channel/pending/:user_id', requireTgAuth, async (req, res) => {
  const userId = parseInt(req.params.user_id);
  if (!userId) return res.status(400).json({ error: 'Неверный user_id' });
  try {
    // Берём самую старую запись (FIFO) и сразу удаляем её
    const r = await pool.query(
      `DELETE FROM pending_channel_ids
       WHERE id = (
         SELECT id FROM pending_channel_ids
         WHERE user_id = $1
         ORDER BY created_at ASC
         LIMIT 1
       )
       RETURNING chat_id, channel_name, channel_id`,
      [userId]
    );
    if (r.rows.length === 0) return res.json({ pending: true });
    res.json({
      chat_id:      r.rows[0].chat_id,
      channel_name: r.rows[0].channel_name,
      channel_id:   r.rows[0].channel_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== ANALYTICS =====

// POST /api/analytics/track — записывает просмотр или клик
app.post('/api/analytics/track', async (req, res) => {
  try {
    const { channel_id, event_type, viewer_id } = req.body;
    if (!channel_id || !['view', 'click'].includes(event_type)) {
      return res.status(400).json({ error: 'Неверные параметры' });
    }
    await pool.query(
      `INSERT INTO channel_analytics (channel_id, event_type, viewer_id)
       VALUES ($1, $2, $3)`,
      [channel_id, event_type, viewer_id || null]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/:channelId?user_id=... — статистика для владельца
app.get('/api/analytics/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { user_id } = req.query;

    if (!user_id) return res.status(401).json({ error: 'Не авторизован' });

    const ownerCheck = await pool.query(
      'SELECT owner_id FROM channels WHERE id = $1', [channelId]
    );
    if (ownerCheck.rows.length === 0) return res.status(404).json({ error: 'Канал не найден' });
    if (String(ownerCheck.rows[0].owner_id) !== String(user_id)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const [total, week, today, chart] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'view')  AS total_views,
           COUNT(*) FILTER (WHERE event_type = 'click') AS total_clicks
         FROM channel_analytics WHERE channel_id = $1`,
        [channelId]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'view')  AS week_views,
           COUNT(*) FILTER (WHERE event_type = 'click') AS week_clicks
         FROM channel_analytics
         WHERE channel_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
        [channelId]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'view')  AS today_views,
           COUNT(*) FILTER (WHERE event_type = 'click') AS today_clicks
         FROM channel_analytics
         WHERE channel_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
        [channelId]
      ),
      pool.query(
        `SELECT
           DATE(created_at) AS day,
           COUNT(*) FILTER (WHERE event_type = 'view')  AS views,
           COUNT(*) FILTER (WHERE event_type = 'click') AS clicks
         FROM channel_analytics
         WHERE channel_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
         GROUP BY DATE(created_at)
         ORDER BY day ASC`,
        [channelId]
      ),
    ]);

    res.json({
      total: total.rows[0],
      week:  week.rows[0],
      today: today.rows[0],
      chart: chart.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`✅ Сервер запущен`);
});