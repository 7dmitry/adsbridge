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

  // Нет initData — пропускаем (открыто в браузере или тест)
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

function validateChannelData({ usname, category, pricead_24, pricead_all }) {
  if (!usname || typeof usname !== 'string' || usname.length > 50) {
    return 'Некорректный username';
  }
  if (!/^[a-zA-Z0-9_]{3,50}$/.test(usname)) {
    return 'Username содержит недопустимые символы';
  }
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return 'Недопустимая категория';
  }
  if (pricead_24 && (isNaN(pricead_24) || pricead_24 < 0 || pricead_24 > 100000)) {
    return 'Недопустимая цена 24ч';
  }
  if (pricead_all && (isNaN(pricead_all) || pricead_all < 0 || pricead_all > 100000)) {
    return 'Недопустимая цена навсегда';
  }
  return null; 
}

// ===== STATS ===== node server.js

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

// Создать или обновить пользователя
app.post('/api/users', requireTgAuth, async (req, res) => {
  try {
    const { id, username, first_name, last_name } = req.body;
    const result = await pool.query(`
      INSERT INTO users (id, username, first_name, last_name)
      VALUES ($1, $2, $3, $4)
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
// ===== CHANNELS =====

app.get('/api/channels', async (req, res) => {
  try {
    const { category } = req.query;
    let result;
    if (category && category !== 'all') {
      result = await pool.query(
        'SELECT * FROM channels WHERE category = $1 ORDER BY subscribers DESC',
        [category]
      );
    } else {
      result = await pool.query('SELECT * FROM channels ORDER BY subscribers DESC');
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/channels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM channels WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Канал не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/channels', requireTgAuth, async (req, res) => {
  try {
    const { name, usname, category, subscribers, pricead_24, pricead_all, owner_id, avatar_url } = req.body;
    const result = await pool.query(
      `INSERT INTO channels (name, usname, category, subscribers, pricead_24, pricead_all, owner_id, avatar_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, usname, category, subscribers || 0, pricead_24 || null, pricead_all || null, owner_id, avatar_url || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/channels/:id', requireTgAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, usname, category, subscribers, pricead_24, pricead_all, user_id } = req.body;

    console.log('PUT body:', req.body);

    if (!user_id) {
      return res.status(401).json({ error: 'Не авторизован' });
    }

    // Проверяем что канал принадлежит этому пользователю
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

    const result = await pool.query(
      `UPDATE channels SET name=$1, usname=$2, category=$3, 
       subscribers=$4, pricead_24=$5, pricead_all=$6 
       WHERE id=$7 RETURNING *`,
      [name, usname, category, subscribers, pricead_24, pricead_all, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
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

    const result = await pool.query(
      'DELETE FROM channels WHERE id = $1 AND owner_id = $2 RETURNING *',
      [id, parseInt(user_id)]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({ error: 'Нет доступа или канал не найден' });
    }

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

// ===== ВЕРИФИКАЦИЯ КАНАЛА + получение subscribers =====
app.post('/api/verify-channel', requireTgAuth, async (req, res) => {
  const { usname, user_id } = req.body;
  if (!usname || !user_id) return res.status(400).json({ error: 'Укажи usname и user_id' });

  try {
    // Проверяем владельца
    const memberRes = await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: '@' + usname, user_id }),
      }
    );
    const memberData = await memberRes.json();

    if (!memberData.ok) {
      return res.status(400).json({ verified: false, error: 'Бот не добавлен в канал или канал не найден' });
    }

    const status = memberData.result?.status;
    if (status !== 'creator' && status !== 'administrator') {
      return res.status(403).json({ verified: false, error: 'Вы не являетесь владельцем или администратором' });
    }

    // Получаем subscribers
    const countRes = await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMembersCount`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: '@' + usname }),
      }
    );
    const countData = await countRes.json();
    const subscribers = countData.ok ? countData.result : 0;

    // Получаем аватарку
    const chatRes = await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: '@' + usname }),
      }
    );
    const chatData = await chatRes.json();
    const channelName = chatData.ok ? chatData.result.title : null;
    let avatar_url = null;

    if (chatData.ok && chatData.result.photo) {
      const fileId = chatData.result.photo.big_file_id;
      const fileRes = await fetch(
        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: fileId }),
        }
      );
      const fileData = await fileRes.json();
      if (fileData.ok) {
        avatar_url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileData.result.file_path}`;
      }
    }

    res.json({ verified: true, role: status, subscribers, avatar_url, name: channelName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/send-message', requireTgAuth, async (req, res) => {
  const { user_id, channel_id } = req.body;

  if (!user_id || !channel_id) {
    return res.status(400).json({ error: 'Не хватает параметров' });
  }

  try {
    const result = await pool.query('SELECT * FROM channels WHERE id = $1', [channel_id]);
    const ch = result.rows[0];
    if (!ch) return res.status(404).json({ error: 'Канал не найден' });

    // Ищем владельца — если не найден, используем usname канала
    let ownerUsername = ch.usname; // fallback — пишем в канал напрямую
    if (ch.owner_id) {
      const ownerResult = await pool.query(
        'SELECT username FROM users WHERE id = $1', [ch.owner_id]
      );
      if (ownerResult.rows[0]?.username) {
        ownerUsername = ownerResult.rows[0].username;
      }
    }

    const price24  = ch.pricead_24  ? `$${ch.pricead_24}`  : '—';
    const priceAll = ch.pricead_all ? `$${ch.pricead_all}` : '—';

    const text =
      `📢 *${ch.name}*\n` +
      `@${ch.usname}\n\n` +
      `💰 Реклама 24ч: ${price24}\n` +
      `💰 Реклама навсегда: ${priceAll}\n` +
      `👥 Подписчиков: ${ch.subscribers || 0}\n\n` +
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
            { text: '✍️ Написать администратору', url: `https://t.me/${ownerUsername}` }
          ]]
        }
      }),
    });

    const tgData = await tgRes.json();
    console.log('Telegram response:', tgData);

    if (!tgData.ok) {
      return res.status(500).json({ error: tgData.description });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error('send-message error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/channels/:id/collab', requireTgAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { collab, user_id } = req.body;

    console.log('PATCH collab:', { id, collab, user_id, body: req.body });

    if (!user_id) {
      return res.status(401).json({ error: 'Не авторизован' });
    }

    const check = await pool.query(
      'SELECT owner_id FROM channels WHERE id = $1', [id]
    );

    console.log('owner check:', {   // ← добавь сюда
      owner_id: check.rows[0]?.owner_id, 
      owner_id_type: typeof check.rows[0]?.owner_id,
      user_id, 
      user_id_type: typeof user_id 
    });

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

app.listen(process.env.PORT, () => {
  console.log(`✅ Сервер запущен`);
});
