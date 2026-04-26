// ── Telegram WebApp init ──────────────────────────────────────────────────────

// git add .
// git commit -m "fix db connection"
// git push
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0a0a0f');
  tg.setBackgroundColor('#0a0a0f');
}

// ── API ───────────────────────────────────────────────────────────────────────
const API = 'https://adsway.up.railway.app/api';

async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(API + path, {
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-init-data': tg?.initData || '',
      },
      ...options,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      errData.__error = true;
      errData.status = res.status;
      return errData;
    }
    return await res.json();
  } catch (err) {
    showToast('⚠️ Нет связи с сервером', 'error');
    return null;
  }
}

// ── Валюты ────────────────────────────────────────────────────────────────────
const CURRENCIES = {
  RUB:   { symbol: '₽',  name: 'RUB',   label: 'Российский рубль' },
  KZT:   { symbol: '₸',  name: 'KZT',   label: 'Казахстанский тенге' },
  TON:   { symbol: 'ꘜ',  name: 'TON',   label: 'Toncoin' },
  USD:   { symbol: '$',  name: 'USD',   label: 'Доллар США' },
  STARS: { symbol: '⭐️', name: 'Stars', label: 'Telegram Stars' },
};

const ALL_CURRENCIES = ['RUB', 'KZT', 'TON', 'USD', 'STARS'];

let userCurrencyPrimary = 'RUB';
let userCurrencyExtra   = [];

// ── Data ──────────────────────────────────────────────────────────────────────
let CHANNELS = [];
let favorites = JSON.parse(localStorage.getItem('adhub_favs') || '[]');
let currentSort  = 'default';
let currentFcat  = 'all';
let currentFcurr = 'all';
let selectedAmount = 250;
let showFavPage = false;
let editingChannelId = null;

// ── Категории ─────────────────────────────────────────────────────────────────
const CAT_NAMES = {
  tech:'Технологии', business:'Бизнес', games:'Игры', art:'Творчество',
  finance:'Финансы', news:'Новости', entertainment:'Развлечения',
  edu:'Образование', other:'Другое'
};

// ── Регистрация пользователя ──────────────────────────────────────────────────
async function registerUser() {
  const user = tg?.initDataUnsafe?.user;
  if (!user) return;
  await apiFetch('/users', {
    method: 'POST',
    body: JSON.stringify({
      id:         user.id,
      username:   user.username || '',
      first_name: user.first_name || '',
      last_name:  user.last_name || '',
    }),
  });
}

// ── Загрузка каналов из БД ────────────────────────────────────────────────────
async function loadChannels(category = null, currency = null) {
  let url = '/channels';
  const params = [];
  if (category && category !== 'all') params.push(`category=${category}`);
  if (currency  && currency  !== 'all') params.push(`currency=${currency}`);
  if (params.length) url += '?' + params.join('&');
  const data = await apiFetch(url);
  if (!data || data.__error) return;
  CHANNELS = data.map(mapChannel);
}

function mapChannel(ch) {
  let extras = ch.owner_currency_extra;
  if (typeof extras === 'string') { try { extras = JSON.parse(extras); } catch { extras = []; } }
  if (!Array.isArray(extras)) extras = [];

  return {
    id:                 ch.id,
    name:               ch.name,
    usname:             ch.usname,
    username:           '@' + ch.usname,
    cat:                ch.category,
    subs:               ch.subscribers || 0,
    desc:               ch.desc || '',
    price24:            ch.pricead_24  || null,
    price48:            ch.pricead_48  || null,
    price72:            ch.pricead_72  || null,
    priceAll:           ch.pricead_all || null,
    price:              parseFloat(ch.pricead_24) || 0,
    collab:             ch.collab ?? false,
    verified:           ch.verified ?? false,
    avatar:             ch.avatar_url || null,
    owner_id:           ch.owner_id,
    currency:           ch.owner_currency_primary || ch.currency || 'RUB',
    ownerCurrencyExtra: extras,
  };
}

// ── Загрузка статистики ───────────────────────────────────────────────────────
async function loadStats() {
  const data = await apiFetch('/stats');
  if (!data || data.__error) return;
  document.getElementById('statChannels').textContent = fmt(parseInt(data.total_channels) || 0);
  document.getElementById('statSubs').textContent     = fmt(parseInt(data.total_subscribers) || 0);
  document.getElementById('statPremium').textContent  = fmt(parseInt(data.premium_channels) || 0);
  document.getElementById('totalCount').textContent   = data.total_channels || 0;
}

// ── Page navigation ───────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  showFavPage = false;
  if (name === 'search')   doSearch();
  if (name === 'home')     renderHome('all');
  if (name === 'settings') initSettings();
  if (name === 'manage')   renderManagePage();
  if (tg) tg.HapticFeedback?.impactOccurred('light');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(-6px)';
    t.style.transition = '.3s';
    setTimeout(() => t.remove(), 300);
  }, 2200);
}

// ── Format numbers ────────────────────────────────────────────────────────────
function fmt(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'М';
  if (n >= 1000) return (n/1000).toFixed(n >= 10000 ? 0 : 1) + 'К';
  return n.toString();
}

// ── Получить символ валюты канала ─────────────────────────────────────────────
function getCurrSymbol(currCode) {
  return CURRENCIES[currCode]?.symbol || currCode || '₽';
}

// ── Получить все принимаемые валюты канала ────────────────────────────────────
function getChannelPayCurrencies(ch) {
  const extras = Array.isArray(ch.ownerCurrencyExtra) ? ch.ownerCurrencyExtra : [];
  const all = [ch.currency, ...extras.filter(c => c !== ch.currency)];
  return all.filter(c => CURRENCIES[c]);
}

// ── Отобразить цену (поддержка '-') ──────────────────────────────────────────
function displayPrice(val, sym, suffix) {
  if (!val || val === '') return null;
  if (val === '-') return `—/${suffix}`;
  return `${val}${sym}/${suffix}`;
}

// ── Channel card HTML ─────────────────────────────────────────────────────────
function buildCard(ch) {
  const sym     = getCurrSymbol(ch.currency);
  const price24 = displayPrice(ch.price24, sym, '24ч');
  const priceAll= displayPrice(ch.priceAll, sym, '∞');
  const priceStr = [price24, priceAll].filter(Boolean).join(' · ') || '—';
  return `
  <div class="ch-card" onclick="openModal(${ch.id})">
    <div class="ch-top">
      <div class="ch-avatar">
        ${ch.avatar
          ? `<img src="${ch.avatar}" style="width:100%;height:100%;border-radius:12px;object-fit:cover;" onerror="this.parentNode.innerHTML='📢'">`
          : '📢'
        }
      </div>
      <div class="ch-info">
        <div class="ch-name-row">
          <span class="ch-name">${ch.name}</span>
          ${ch.verified ? '<span class="badge-verified" title="Верифицирован">✓</span>' : ''}
        </div>
        <div class="ch-username">${ch.username}</div>
        <div class="ch-tags">
          <span class="tag">${CAT_NAMES[ch.cat] || ch.cat}</span>
          ${ch.collab ? '<span class="tag green">🤝 ВП</span>' : ''}
        </div>
      </div>
    </div>
    ${ch.desc ? `<div class="ch-desc">${ch.desc}</div>` : ''}
    <div class="ch-metrics">
      <div class="metric"><span>👥</span><strong>${fmt(ch.subs)}</strong></div>
      <div class="metric"><strong>ВП ${ch.collab ? '✅' : '❌'}</strong></div>
      <div class="metric"><span>📋</span><strong>Реклама</strong></div>
    </div>
    <div class="ch-bottom">
      <div class="price-badge">💰 ${priceStr}</div>
      <div class="ch-action-btns">
        <button class="ch-btn ch-btn-primary" onclick="event.stopPropagation();contactChannel(${ch.id})">📩 Связаться</button>
      </div>
    </div>
  </div>`;
}

// ── HOME ──────────────────────────────────────────────────────────────────────
async function renderHome(cat) {
  const list = document.getElementById('homeList');
  list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-title">Загрузка…</div></div>';

  await loadChannels(cat);

  list.innerHTML = CHANNELS.length
    ? CHANNELS.map(buildCard).join('')
    : emptyState('Нет каналов', 'Попробуйте другую категорию');
}

document.getElementById('homeCats').addEventListener('click', e => {
  const pill = e.target.closest('.cat-pill');
  if (!pill) return;
  document.querySelectorAll('#homeCats .cat-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  renderHome(pill.dataset.cat);
});

// ── SEARCH ────────────────────────────────────────────────────────────────────
async function doSearch() {
  if (CHANNELS.length === 0) await loadChannels();

  const q        = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
  const subsMin  = parseInt(document.getElementById('subsMin')?.value)    || 0;
  const subsMax  = parseInt(document.getElementById('subsMax')?.value)    || Infinity;
  const priceMin = parseFloat(document.getElementById('priceMin')?.value) || 0;
  const priceMax = parseFloat(document.getElementById('priceMax')?.value) || Infinity;
  const networkSearch = document.getElementById('networkSearch')?.value.toLowerCase().trim() || '';

  let data = CHANNELS.filter(c => {
    if (currentFcat !== 'all' && c.cat !== currentFcat) return false;

    if (q) {
      const currSymbol = getCurrSymbol(c.currency).toLowerCase();
      const currName   = (CURRENCIES[c.currency]?.name || '').toLowerCase();
      const textMatch  = c.name.toLowerCase().includes(q)
                      || c.username.toLowerCase().includes(q)
                      || (c.desc || '').toLowerCase().includes(q)
                      || currSymbol.includes(q)
                      || currName.includes(q)
                      || c.currency.toLowerCase().includes(q);
      if (!textMatch) return false;
    }

    if (c.subs < subsMin || c.subs > subsMax) return false;
    if (c.price < priceMin || c.price > priceMax) return false;

    if (currentFcurr !== 'all') {
      const payCurrs = getChannelPayCurrencies(c);
      if (!payCurrs.includes(currentFcurr)) return false;
    }

    return true;
  });

  if (currentSort === 'subs')  data = [...data].sort((a,b) => b.subs - a.subs);
  if (currentSort === 'price') data = [...data].sort((a,b) => a.price - b.price);
  if (currentSort === 'er')    data = [...data].sort((a,b) => (b.er||0) - (a.er||0));

  const list = document.getElementById('searchList');
  if (list) {
    list.innerHTML = data.length
      ? data.map(buildCard).join('')
      : emptyState('Ничего не найдено', 'Попробуйте изменить запрос или фильтры');
  }
  const info = document.getElementById('resultsInfo');
  if (info) {
    info.textContent = `Найдено ${data.length} кан${data.length===1?'ал':data.length<5?'ала':'алов'}`;
  }

  // Поиск по сеткам
  if (networkSearch) {
    renderNetworkSearchResults(networkSearch);
  } else {
    const nr = document.getElementById('networkSearchResults');
    if (nr) nr.innerHTML = '';
  }
}

let _allUserNetworks = [];

async function renderNetworkSearchResults(q) {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) return;

  if (_allUserNetworks.length === 0) {
    const nets = await apiFetch(`/user/${user.id}/networks`);
    if (nets && !nets.__error) _allUserNetworks = nets;
  }

  const matched = _allUserNetworks.filter(n =>
    n.name.toLowerCase().includes(q) ||
    (n.channels || []).some(c => c.name.toLowerCase().includes(q) || c.usname.toLowerCase().includes(q))
  );

  const nr = document.getElementById('networkSearchResults');
  if (!nr) return;

  if (matched.length === 0) {
    nr.innerHTML = `<div class="filter-label" style="margin-top:12px;color:var(--text3)">Сетки не найдены по запросу «${q}»</div>`;
    return;
  }

  nr.innerHTML = `
    <div class="filter-label" style="margin-top:12px">🗂 Найденные сетки</div>
    ${matched.map(n => `
      <div class="manage-ch-item" style="margin-bottom:8px">
        <div class="manage-ch-info">
          <div class="manage-ch-name">🗂 ${n.name}</div>
          <div class="manage-ch-meta">${(n.channels||[]).length} каналов</div>
          <div class="manage-ch-prices">
            ${(n.channels||[]).slice(0,3).map(c => `<span class="tag">@${c.usname}</span>`).join('')}
            ${(n.channels||[]).length > 3 ? `<span class="tag">+${n.channels.length - 3}</span>` : ''}
          </div>
        </div>
      </div>`).join('')}
  `;
}

function setSort(el) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentSort = el.dataset.sort;
  doSearch();
}

function setFcat(el) {
  document.querySelectorAll('.fcat').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentFcat = el.dataset.fcat;
  doSearch();
}

function setFcurr(el) {
  document.querySelectorAll('.fcurr').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentFcurr = el.dataset.fcurr;
  const label = document.getElementById('priceCurrLabel');
  if (label) {
    const sym = currentFcurr === 'all' ? '₽/ꘜ/$…' : getCurrSymbol(currentFcurr);
    label.textContent = `Цена рекламы 24ч (мин – макс, ${sym})`;
  }
  doSearch();
}

function toggleFilters() {
  const p = document.getElementById('filterPanel');
  const btn = document.getElementById('filterToggle');
  p.classList.toggle('open');
  btn.classList.toggle('active');
  btn.textContent = p.classList.contains('open') ? '⚙️ Скрыть' : '⚙️ Фильтры';
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
async function contactChannel(channelId) {
  const user = tg?.initDataUnsafe?.user;

  if (!user?.id) {
    showToast('⚠️ Откройте приложение через бота', 'error');
    return;
  }

  const result = await apiFetch('/send-message', {
    method: 'POST',
    body: JSON.stringify({
      user_id:    user.id,
      channel_id: channelId,
    }),
  });

  if (result?.ok) {
    showToast('📩 Сообщение отправлено в бот!', 'success');
    if (tg) tg.HapticFeedback?.notificationOccurred('success');
  }
}

function openModal(id) {
  const ch = CHANNELS.find(c => c.id === id);
  if (!ch) return;

  const sym = getCurrSymbol(ch.currency);

  const fmtP = (v) => {
    if (!v || v === '') return '—';
    if (v === '-') return '—';
    return `${v}${sym}`;
  };

  const payCurrs = getChannelPayCurrencies(ch);
  const payHtml  = payCurrs.length
    ? `<div class="modal-pay-row">
        <span class="modal-pay-label">Возможно оплатить:</span>
        <div class="modal-pay-currs">
          ${payCurrs.map((c, i) => `
            <span class="curr-pill ${i === 0 ? 'primary' : ''}" title="${CURRENCIES[c]?.label || c}">
              ${CURRENCIES[c]?.symbol || c}
            </span>`).join('')}
        </div>
      </div>`
    : '';

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-ch-header">
      <div class="modal-avatar">
        ${ch.avatar
          ? `<img src="${ch.avatar}" style="width:100%;height:100%;border-radius:16px;object-fit:cover;" onerror="this.parentNode.innerHTML='📢'">`
          : '📢'
        }
      </div>
      <div>
        <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:800;display:flex;align-items:center;gap:7px">
          ${ch.name} ${ch.verified?'<span class="badge-verified">✓</span>':''}
        </div>
        <div style="color:var(--text3);font-size:13px;margin:3px 0">${ch.username}</div>
        <span class="tag">${CAT_NAMES[ch.cat]||ch.cat}</span>
        ${ch.collab?'<span class="tag green" style="margin-left:5px">🤝 ВП</span>':''}
      </div>
    </div>
    <div class="modal-stat-grid">
      <div class="modal-stat">
        <div class="modal-stat-val">${fmt(ch.subs)}</div>
        <div class="modal-stat-key">Подписчиков</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-val">${ch.collab ? '✅ Да' : '❌ Нет'}</div>
        <div class="modal-stat-key">Взаимопиар</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-val">${fmtP(ch.price24)}</div>
        <div class="modal-stat-key">Реклама 24ч</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-val">${fmtP(ch.price48)}</div>
        <div class="modal-stat-key">Реклама 48ч</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-val">${fmtP(ch.price72)}</div>
        <div class="modal-stat-key">Реклама 72ч</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-val">${fmtP(ch.priceAll)}</div>
        <div class="modal-stat-key">Навсегда</div>
      </div>
    </div>
    ${payHtml}
    ${ch.desc ? `<p class="modal-desc">${ch.desc}</p>` : ''}
    <div class="modal-btns">
      <button class="modal-btn modal-btn-primary" onclick="contactChannel(${ch.id});closeModal()">
        📩 Написать администратору
      </button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('open');
  if (tg) tg.HapticFeedback?.impactOccurred('medium');
}

function closeModal(e) {
  if (!e || e.target === document.getElementById('modalOverlay')) {
    document.getElementById('modalOverlay').classList.remove('open');
  }
}

// ── MANAGE PAGE ───────────────────────────────────────────────────────────────
async function renderManagePage() {
  document.getElementById('manageFormCard').innerHTML = `
    <div class="manage-form-title" id="manageFormTitle">➕ Добавить канал</div>
    <div class="form-group">
      <label class="form-label">Username (без @) *</label>
      <input class="form-input" id="fUsname" placeholder="techpulse">
    </div>
    <div class="form-group">
      <label class="form-label">Категория *</label>
      <select class="form-input" id="fCategory">
        <option value="">— Выберите —</option>
        <option value="tech">🖥️ Технологии</option>
        <option value="business">💼 Бизнес</option>
        <option value="finance">📈 Финансы</option>
        <option value="games">🎮 Игры</option>
        <option value="art">🎨 Творчество</option>
        <option value="news">📰 Новости</option>
        <option value="entertainment">🎬 Развлечения</option>
        <option value="edu">🎓 Образование</option>
        <option value="other">🌍 Другое</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Валюта</label>
      <select class="form-input" id="fCurrency" onchange="updatePriceLabels()">
        <option value="RUB">₽ RUB</option>
        <option value="KZT">₸ KZT</option>
        <option value="TON">ꘜ TON</option>
        <option value="USD">$ USD</option>
        <option value="STARS">⭐️ Stars</option>
      </select>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label" id="label24">Цена 24ч</label>
        <input class="form-input" id="fPrice24" placeholder="500 или -">
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label" id="label48">Цена 48ч</label>
        <input class="form-input" id="fPrice48" placeholder="800 или -">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label" id="label72">Цена 72ч</label>
        <input class="form-input" id="fPrice72" placeholder="1200 или -">
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label" id="labelAll">Цена навсегда</label>
        <input class="form-input" id="fPriceAll" placeholder="2000 или -">
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="formCancelBtn" onclick="resetForm()" style="display:none">Отмена</button>
      <button class="btn btn-primary" id="formSubmitBtn" onclick="submitChannel()" style="flex:1;justify-content:center">➕ Добавить</button>
    </div>
  `;

  resetForm();
  const user = tg?.initDataUnsafe?.user;
  const userId = user?.id;
  const list = document.getElementById('myChannelsList');

  if (!userId) {
    list.innerHTML = emptyState('Войдите через Telegram', 'Откройте приложение через бота');
    return;
  }

  list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-title">Загрузка…</div></div>';
  const data = await apiFetch(`/user/${userId}/channels`);

  if (!data || data.__error || data.length === 0) {
    list.innerHTML = emptyState('Нет каналов', 'Добавьте первый канал выше');
    return;
  }

  const sym = getCurrSymbol(userCurrencyPrimary || 'RUB');
  list.innerHTML = data.map(ch => {
    const prices = [
      ch.pricead_24  ? `24ч: ${ch.pricead_24  === '-' ? '—' : ch.pricead_24  + sym}` : null,
      ch.pricead_48  ? `48ч: ${ch.pricead_48  === '-' ? '—' : ch.pricead_48  + sym}` : null,
      ch.pricead_72  ? `72ч: ${ch.pricead_72  === '-' ? '—' : ch.pricead_72  + sym}` : null,
      ch.pricead_all ? `∞: ${ch.pricead_all  === '-' ? '—' : ch.pricead_all + sym}` : null,
    ].filter(Boolean);
    return `
    <div class="manage-ch-item">
      <div class="manage-ch-info">
        <div class="manage-ch-name">${ch.name}</div>
        <div class="manage-ch-meta">@${ch.usname} · ${CAT_NAMES[ch.category] || ch.category} · ${fmt(ch.subscribers || 0)} подп.</div>
        <div class="manage-ch-prices">
          ${prices.map(p => `<span class="tag">${p}</span>`).join('')}
          <span class="tag" style="background:rgba(108,99,255,.1);color:var(--accent2)">${sym} ${userCurrencyPrimary || ch.currency || 'RUB'}</span>
        </div>
      </div>
      <div class="manage-ch-btns">
        <button class="ch-btn ch-btn-ghost" onclick="editChannel(${ch.id})">✏️</button>
        <button class="ch-btn ch-btn-danger" onclick="deleteChannel(${ch.id}, '${ch.name.replace(/'/g,"\\'")}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function updatePriceLabels() {
  const sel = document.getElementById('fCurrency');
  if (!sel) return;
  const sym = getCurrSymbol(sel.value);
  const labels = {
    label24: `Цена 24ч (${sym})`,
    label48: `Цена 48ч (${sym})`,
    label72: `Цена 72ч (${sym})`,
    labelAll: `Цена навсегда (${sym})`,
  };
  Object.entries(labels).forEach(([id, txt]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  });
}

// ── Добавить / обновить канал ─────────────────────────────────────────────────
async function submitChannel() {
  const user     = tg?.initDataUnsafe?.user;
  const usname   = document.getElementById('fUsname')?.value.trim().replace('@','');
  const category = document.getElementById('fCategory')?.value;
  const price24  = document.getElementById('fPrice24')?.value.trim();
  const price48  = document.getElementById('fPrice48')?.value.trim();
  const price72  = document.getElementById('fPrice72')?.value.trim();
  const priceAll = document.getElementById('fPriceAll')?.value.trim();
  const currency = document.getElementById('fCurrency')?.value || 'RUB';

  if (!usname || !category) {
    showToast('⚠️ Заполните обязательные поля', 'error');
    return;
  }

  if (editingChannelId) {
    const data = await apiFetch(`/channels/${editingChannelId}`);
    const body = {
      name: data.name, usname, category,
      pricead_24:  price24  || null,
      pricead_48:  price48  || null,
      pricead_72:  price72  || null,
      pricead_all: priceAll || null,
      owner_id: user?.id || 0,
      user_id:  user?.id,
      currency,
    };
    const result = await apiFetch(`/channels/${editingChannelId}`, {
      method: 'PUT', body: JSON.stringify(body)
    });
    if (result && !result.__error) {
      showToast('✅ Канал обновлён!', 'success');
      resetForm();
      renderManagePage();
      loadStats();
    } else {
      showToast(`❌ ${result?.error || result?.message || 'Ошибка'}`, 'error');
    }
    return;
  }

  showVerifyStep(usname, {
    usname, category, currency,
    name: '',
    pricead_24:  price24  || null,
    pricead_48:  price48  || null,
    pricead_72:  price72  || null,
    pricead_all: priceAll || null,
    owner_id: user?.id || 0
  });
}

// ── Шаг верификации ───────────────────────────────────────────────────────────
function showVerifyStep(usname, channelData) {
  const botUsername = 'adsway_bot';

  document.getElementById('manageFormCard').innerHTML = `
    <div class="manage-form-title">🔐 Подтверждение владения</div>
    <div class="verify-steps">
      <div class="verify-step">
        <div class="verify-step-num">1</div>
        <div class="verify-step-text">
          Добавь бота <strong>@${botUsername}</strong> в канал <strong>@${usname}</strong>
          как администратора (можно убрать все разрешения)
        </div>
      </div>
      <div class="verify-step">
        <div class="verify-step-num">2</div>
        <div class="verify-step-text">
          Нажми кнопку «Проверить» — мы убедимся что ты владелец
        </div>
      </div>
    </div>
    <div class="form-actions" style="margin-top:16px">
      <button class="btn btn-secondary" onclick="renderManagePage()">Назад</button>
      <button class="btn btn-primary" id="verifyBtn" onclick="verifyAndSave()" style="flex:1;justify-content:center">
        🔍 Проверить
      </button>
    </div>
  `;

  window._pendingChannel = channelData;
}

// ── Проверить и сохранить ─────────────────────────────────────────────────────
async function verifyAndSave() {
  const user = tg?.initDataUnsafe?.user;
  const channelData = window._pendingChannel;
  if (!channelData || !user) { showToast('⚠️ Ошибка — попробуйте снова', 'error'); return; }

  const btn = document.getElementById('verifyBtn');
  btn.textContent = '⏳ Проверяем…';
  btn.disabled = true;

  const verify = await apiFetch('/verify-channel', {
    method: 'POST',
    body: JSON.stringify({ usname: channelData.usname, user_id: user.id }),
  });

  if (!verify || verify.__error || !verify.verified) {
    btn.textContent = '🔍 Проверить';
    btn.disabled = false;
    showToast(verify?.error || verify?.message || '❌ Проверка не пройдена', 'error');
    return;
  }

  channelData.name        = verify.name || channelData.usname;
  channelData.subscribers = verify.subscribers || 0;
  channelData.avatar_url  = verify.avatar_url || null;

  const result = await apiFetch('/channels', {
    method: 'POST',
    body: JSON.stringify(channelData),
  });

  if (!result || result.__error) {
    btn.textContent = '🔍 Проверить';
    btn.disabled = false;
    if (result?.status === 409) {
      showToast('❌ Этот канал уже добавлен другим пользователем', 'error');
    } else {
      showToast(`❌ ${result?.message || result?.error || 'Ошибка сохранения'}`, 'error');
    }
    return;
  }

  if (user?.id) {
    await apiFetch('/user_admin', {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, channel_id: result.id, premium: false }),
    });
  }

  showToast(`✅ Канал "${channelData.name}" добавлен!`, 'success');
  renderManagePage();
  loadStats();
  window._pendingChannel = null;
}

// ── Редактировать канал ───────────────────────────────────────────────────────
async function editChannel(id) {
  const data = await apiFetch(`/channels/${id}`);
  if (!data || data.__error) return;

  editingChannelId = id;

  if (document.getElementById('fUsname'))   document.getElementById('fUsname').value   = data.usname || '';
  if (document.getElementById('fCategory')) document.getElementById('fCategory').value = data.category || '';
  if (document.getElementById('fPrice24'))  document.getElementById('fPrice24').value  = data.pricead_24  || '';
  if (document.getElementById('fPrice48'))  document.getElementById('fPrice48').value  = data.pricead_48  || '';
  if (document.getElementById('fPrice72'))  document.getElementById('fPrice72').value  = data.pricead_72  || '';
  if (document.getElementById('fPriceAll')) document.getElementById('fPriceAll').value = data.pricead_all || '';
  if (document.getElementById('fCurrency')) document.getElementById('fCurrency').value = data.currency || 'RUB';

  updatePriceLabels();

  const title = document.getElementById('manageFormTitle');
  if (title) title.textContent = '✏️ Редактировать канал';

  const submitBtn = document.getElementById('formSubmitBtn');
  if (submitBtn) submitBtn.textContent = '💾 Сохранить';

  const cancelBtn = document.getElementById('formCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'block';

  document.getElementById('manageFormCard').scrollIntoView({ behavior: 'smooth' });
  if (tg) tg.HapticFeedback?.impactOccurred('medium');
}

// ── Удалить канал ─────────────────────────────────────────────────────────────
async function deleteChannel(id, name) {
  if (!confirm(`Удалить канал "${name}"?`)) return;
  const user = tg?.initDataUnsafe?.user;
  const result = await apiFetch(`/channels/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ user_id: user?.id })
  });
  if (result && !result.__error) {
    showToast('🗑 Канал удалён', 'success');
    // Сбрасываем кэш сеток чтобы при следующем открытии они обновились
    _allUserNetworks = [];
    renderManagePage();
    loadStats();
  } else {
    showToast(`❌ ${result?.error || 'Ошибка удаления'}`, 'error');
  }
}

function resetForm() {
  editingChannelId = null;
  ['fUsname','fCategory','fPrice24','fPrice48','fPrice72','fPriceAll'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const fCur = document.getElementById('fCurrency');
  if (fCur) fCur.value = 'RUB';

  const title     = document.getElementById('manageFormTitle');
  const submitBtn = document.getElementById('formSubmitBtn');
  const cancelBtn = document.getElementById('formCancelBtn');
  if (title)     title.textContent     = '➕ Добавить канал';
  if (submitBtn) submitBtn.textContent = '➕ Добавить';
  if (cancelBtn) cancelBtn.style.display = 'none';
  updatePriceLabels();
}

// ── Collab settings ───────────────────────────────────────────────────────────
async function renderCollabSettings() {
  const user = tg?.initDataUnsafe?.user;
  const list = document.getElementById('collabSettingsList');
  if (!list) return;

  if (!user?.id) {
    list.innerHTML = '<div class="empty-state" style="padding:20px"><div class="empty-title" style="font-size:13px">Войдите через бота</div></div>';
    return;
  }

  const data = await apiFetch(`/user/${user.id}/channels`);
  if (!data || data.__error || data.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:20px"><div class="empty-title" style="font-size:13px">Нет каналов</div></div>';
    return;
  }

  list.innerHTML = `
    <div class="settings-section">
      ${data.map(ch => `
        <div class="setting-item">
          <div class="set-icon">
            ${ch.avatar_url
              ? `<img src="${ch.avatar_url}" style="width:100%;height:100%;border-radius:12px;object-fit:cover;" onerror="this.parentNode.innerHTML='📢'">`
              : '📢'
            }
          </div>
          <div class="set-text">
            <div class="set-title">${ch.name}</div>
            <div class="set-sub">@${ch.usname}</div>
          </div>
          <div class="set-right">
            <span style="font-size:11px;color:var(--text3);margin-right:6px">ВП</span>
            <div class="toggle ${ch.collab ? 'on' : ''}"
                 id="collab-${ch.id}"
                 onclick="toggleCollab(${ch.id}, this)">
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function toggleCollab(channelId, el) {
  const user  = tg?.initDataUnsafe?.user;
  const isOn  = el.classList.contains('on');
  const newVal= !isOn;

  el.classList.toggle('on', newVal);
  if (tg) tg.HapticFeedback?.impactOccurred('light');

  const result = await apiFetch(`/channels/${channelId}/collab`, {
    method: 'PATCH',
    body: JSON.stringify({ collab: newVal, user_id: user?.id }),
  });

  if (result && !result.__error) {
    showToast(newVal ? '✅ ВП включён' : '❌ ВП выключен', newVal ? 'success' : '');
    const ch = CHANNELS.find(c => c.id === channelId);
    if (ch) ch.collab = newVal;
  } else {
    el.classList.toggle('on', isOn);
  }
}

// ── SETTINGS — Валюта ─────────────────────────────────────────────────────────
let _tempPrimary = 'RUB';
let _tempExtras  = [];

async function renderCurrencySettings() {
  const block = document.getElementById('currencySettingsBlock');
  if (!block) return;

  const user = tg?.initDataUnsafe?.user;

  if (user?.id) {
    const data = await apiFetch(`/users/${user.id}/currency`);
    if (data && !data.__error) {
      userCurrencyPrimary = data.currency_primary || 'RUB';
      userCurrencyExtra   = Array.isArray(data.currency_extra) ? data.currency_extra : [];
    }
  }

  _tempPrimary = userCurrencyPrimary;
  _tempExtras  = [...userCurrencyExtra];

  renderCurrencySettingsUI(block);
}

function renderCurrencySettingsUI(block) {
  block.innerHTML = `
    <div class="currency-settings-card">
      <div class="currency-settings-section">
        <div class="currency-settings-label">🌟 Основная валюта</div>
        <div class="currency-options" id="primaryCurrOptions">
          ${ALL_CURRENCIES.map(c => `
            <div class="currency-option ${c === _tempPrimary ? 'selected' : ''}"
                 data-action="primary" data-code="${c}">
              <span class="curr-opt-symbol">${CURRENCIES[c].symbol}</span>
              <div class="curr-opt-info">
                <span class="curr-opt-name">${CURRENCIES[c].name}</span>
                <span class="curr-opt-label">${CURRENCIES[c].label}</span>
              </div>
              <span class="curr-opt-check" style="${c === _tempPrimary ? '' : 'opacity:0'}">✓</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="currency-settings-section" style="margin-top:16px">
        <div class="currency-settings-label">➕ Дополнительные валюты</div>
        <div class="currency-options" id="extraCurrOptions">
          ${ALL_CURRENCIES.filter(c => c !== _tempPrimary).map(c => `
            <div class="currency-option extra ${_tempExtras.includes(c) ? 'selected' : ''}"
                 data-action="extra" data-code="${c}">
              <span class="curr-opt-symbol">${CURRENCIES[c].symbol}</span>
              <div class="curr-opt-info">
                <span class="curr-opt-name">${CURRENCIES[c].name}</span>
                <span class="curr-opt-label">${CURRENCIES[c].label}</span>
              </div>
              <span class="curr-opt-check" style="${_tempExtras.includes(c) ? '' : 'opacity:0'}">✓</span>
            </div>`).join('')}
        </div>
      </div>

      <button class="btn btn-primary" id="saveCurrBtn"
              style="width:100%;justify-content:center;margin-top:16px;padding:13px">
        💾 Сохранить настройки валют
      </button>
    </div>
  `;

  block.addEventListener('click', _onCurrencyClick);
}

function _onCurrencyClick(e) {
  if (e.target.closest('#saveCurrBtn')) {
    saveCurrencySettings();
    return;
  }

  const option = e.target.closest('.currency-option[data-action]');
  if (!option) return;

  const code   = option.dataset.code;
  const action = option.dataset.action;

  if (action === 'primary') {
    _tempPrimary = code;
    _tempExtras  = _tempExtras.filter(c => c !== code);
  } else if (action === 'extra') {
    if (_tempExtras.includes(code)) {
      _tempExtras = _tempExtras.filter(c => c !== code);
    } else {
      _tempExtras.push(code);
    }
  }

  if (tg) tg.HapticFeedback?.impactOccurred('light');

  const block = document.getElementById('currencySettingsBlock');
  if (block) {
    block.removeEventListener('click', _onCurrencyClick);
    renderCurrencySettingsUI(block);
  }
}

async function saveCurrencySettings() {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) {
    showToast('⚠️ Войдите через Telegram', 'error');
    return;
  }

  const result = await apiFetch(`/users/${user.id}/currency`, {
    method: 'PUT',
    body: JSON.stringify({
      currency_primary: _tempPrimary,
      currency_extra:   _tempExtras,
    }),
  });

  if (result && !result.__error) {
    userCurrencyPrimary = _tempPrimary;
    userCurrencyExtra   = _tempExtras;
    showToast('✅ Валюты сохранены!', 'success');
    if (tg) tg.HapticFeedback?.notificationOccurred('success');
  }
}

// ── SETTINGS — Сетки каналов ──────────────────────────────────────────────────
let _networks = [];
let _editingNetworkId = null;
let _networkChannelPickerOpen = false;

async function renderNetworkSettings() {
  const user = tg?.initDataUnsafe?.user;
  const block = document.getElementById('networkSettingsBlock');
  if (!block) return;

  if (!user?.id) {
    block.innerHTML = '<div class="empty-state" style="padding:20px"><div class="empty-title" style="font-size:13px">Войдите через бота</div></div>';
    return;
  }

  block.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:13px">Загрузка…</div>';

  const nets = await apiFetch(`/user/${user.id}/networks`);
  _networks = (nets && !nets.__error) ? nets : [];

  renderNetworkSettingsUI();
}

function renderNetworkSettingsUI() {
  const block = document.getElementById('networkSettingsBlock');
  if (!block) return;

  block.innerHTML = `
    <div class="settings-section" style="margin-bottom:0">
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:12px"
              onclick="openNetworkEditor(null)">
        ➕ Создать сетку каналов
      </button>
      ${_networks.length === 0 ? '<div style="padding:8px;color:var(--text3);font-size:13px;text-align:center">Сеток пока нет</div>' : ''}
      ${_networks.map(net => `
        <div class="manage-ch-item" style="margin-bottom:10px">
          <div class="manage-ch-info" style="flex:1">
            <div class="manage-ch-name">🗂 ${net.name}</div>
            <div class="manage-ch-meta">${(net.channels||[]).length} каналов</div>
            <div class="manage-ch-prices">
              ${(net.channels||[]).map(c => `
                <span class="tag" style="display:inline-flex;align-items:center;gap:4px">
                  ${c.avatar_url ? `<img src="${c.avatar_url}" style="width:14px;height:14px;border-radius:3px;object-fit:cover">` : '📢'}
                  @${c.usname}
                </span>`).join('')}
            </div>
          </div>
          <div class="manage-ch-btns">
            <button class="ch-btn ch-btn-ghost" onclick="openNetworkEditor(${net.id})">✏️</button>
            <button class="ch-btn ch-btn-danger" onclick="deleteNetwork(${net.id}, '${net.name.replace(/'/g,"\\'")}')">🗑</button>
          </div>
        </div>`).join('')}
    </div>
  `;
}

// Открыть редактор сетки (null = создать новую)
async function openNetworkEditor(netId) {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) { showToast('⚠️ Войдите через бота', 'error'); return; }

  _editingNetworkId = netId;

  const net = netId ? _networks.find(n => n.id === netId) : null;

  // Загрузить каналы пользователя
  const userChannels = await apiFetch(`/user/${user.id}/channels`);
  const myChannels = (userChannels && !userChannels.__error) ? userChannels : [];

  const currentChannels = net ? (net.channels || []) : [];

  const block = document.getElementById('networkSettingsBlock');
  block.innerHTML = `
    <div class="manage-form-card" style="margin-bottom:0">
      <div class="manage-form-title">${netId ? '✏️ Редактировать сетку' : '➕ Создать сетку'}</div>
      <div class="form-group">
        <label class="form-label">Название сетки</label>
        <input class="form-input" id="networkNameInput" placeholder="Моя сетка" value="${net?.name || ''}">
      </div>

      <div class="form-group">
        <label class="form-label">Каналы в сетке</label>
        <div id="networkChannelsList" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
          ${currentChannels.map(c => `
            <div class="tag" style="display:inline-flex;align-items:center;gap:5px;padding:5px 8px;cursor:default">
              ${c.avatar_url ? `<img src="${c.avatar_url}" style="width:14px;height:14px;border-radius:3px;object-fit:cover">` : '📢'}
              @${c.usname}
              ${netId ? `<span style="cursor:pointer;color:var(--danger);margin-left:2px"
                onclick="removeChannelFromNetwork(${netId},${c.id})">✕</span>` : ''}
            </div>`).join('')}
          ${currentChannels.length === 0 ? '<span style="color:var(--text3);font-size:13px">Нет каналов</span>' : ''}
        </div>

        <div class="form-label" style="margin-bottom:6px">Добавить канал:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="networkChannelPicker">
          ${myChannels
            .filter(c => !currentChannels.find(cc => cc.id === c.id))
            .map(c => `
              <div class="tag" style="cursor:pointer;padding:6px 10px;display:inline-flex;align-items:center;gap:5px"
                   onclick="addChannelToNetwork(${netId || 'null'},${c.id},'${c.name.replace(/'/g,"\\'")}')">
                ${c.avatar_url ? `<img src="${c.avatar_url}" style="width:14px;height:14px;border-radius:3px;object-fit:cover">` : '📢'}
                + @${c.usname}
              </div>`).join('')}
          ${myChannels.filter(c => !currentChannels.find(cc => cc.id === c.id)).length === 0
            ? '<span style="color:var(--text3);font-size:13px">Все ваши каналы уже в сетке</span>'
            : ''}
        </div>
      </div>

      <div class="form-actions" style="margin-top:12px">
        <button class="btn btn-secondary" onclick="renderNetworkSettings()">Назад</button>
        <button class="btn btn-primary" id="saveNetworkBtn"
                onclick="saveNetwork()" style="flex:1;justify-content:center">
          ${netId ? '💾 Сохранить' : '➕ Создать'}
        </button>
      </div>
    </div>
  `;

  // Если создаём новую — храним временные каналы
  window._pendingNetworkChannels = [...currentChannels.map(c => c.id)];
}

async function addChannelToNetwork(netId, channelId, channelName) {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) return;

  if (netId) {
    // Уже существующая сетка — добавляем сразу
    const result = await apiFetch(`/networks/${netId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, channel_id: channelId }),
    });
    if (result && !result.__error) {
      // Обновляем локально
      const net = _networks.find(n => n.id === netId);
      if (net) {
        const ch = await apiFetch(`/channels/${channelId}`);
        if (ch && !ch.__error) {
          net.channels = [...(net.channels || []), ch];
        }
      }
      showToast(`✅ @${channelName || channelId} добавлен в сетку`, 'success');
      openNetworkEditor(netId);
    } else {
      showToast(`❌ ${result?.error || 'Ошибка'}`, 'error');
    }
  } else {
    // Новая сетка — добавляем во временный список
    if (!window._pendingNetworkChannels.includes(channelId)) {
      window._pendingNetworkChannels.push(channelId);
    }
    openNetworkEditorWithPending();
  }
}

async function removeChannelFromNetwork(netId, channelId) {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) return;

  const result = await apiFetch(`/networks/${netId}/channels/${channelId}`, {
    method: 'DELETE',
    body: JSON.stringify({ user_id: user.id }),
  });

  if (result && !result.__error) {
    const net = _networks.find(n => n.id === netId);
    if (net) net.channels = (net.channels || []).filter(c => c.id !== channelId);
    showToast('🗑 Канал удалён из сетки', 'success');
    openNetworkEditor(netId);
  } else {
    showToast(`❌ ${result?.error || 'Ошибка'}`, 'error');
  }
}

// Для новой сетки — перерисовать редактор с учётом pending каналов
async function openNetworkEditorWithPending() {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) return;

  const userChannels = await apiFetch(`/user/${user.id}/channels`);
  const myChannels = (userChannels && !userChannels.__error) ? userChannels : [];

  const pendingIds = window._pendingNetworkChannels || [];
  const currentChannels = myChannels.filter(c => pendingIds.includes(c.id));

  const block = document.getElementById('networkSettingsBlock');
  const nameVal = document.getElementById('networkNameInput')?.value || '';

  block.innerHTML = `
    <div class="manage-form-card" style="margin-bottom:0">
      <div class="manage-form-title">➕ Создать сетку</div>
      <div class="form-group">
        <label class="form-label">Название сетки</label>
        <input class="form-input" id="networkNameInput" placeholder="Моя сетка" value="${nameVal}">
      </div>

      <div class="form-group">
        <label class="form-label">Каналы в сетке</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
          ${currentChannels.map(c => `
            <div class="tag" style="display:inline-flex;align-items:center;gap:5px;padding:5px 8px">
              ${c.avatar_url ? `<img src="${c.avatar_url}" style="width:14px;height:14px;border-radius:3px;object-fit:cover">` : '📢'}
              @${c.usname}
              <span style="cursor:pointer;color:var(--danger);margin-left:2px"
                onclick="removePendingChannel(${c.id})">✕</span>
            </div>`).join('')}
          ${currentChannels.length === 0 ? '<span style="color:var(--text3);font-size:13px">Нет каналов</span>' : ''}
        </div>

        <div class="form-label" style="margin-bottom:6px">Добавить канал:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${myChannels
            .filter(c => !pendingIds.includes(c.id))
            .map(c => `
              <div class="tag" style="cursor:pointer;padding:6px 10px;display:inline-flex;align-items:center;gap:5px"
                   onclick="addChannelToNetwork(null,${c.id},'${c.name.replace(/'/g,"\\'")}')">
                ${c.avatar_url ? `<img src="${c.avatar_url}" style="width:14px;height:14px;border-radius:3px;object-fit:cover">` : '📢'}
                + @${c.usname}
              </div>`).join('')}
          ${myChannels.filter(c => !pendingIds.includes(c.id)).length === 0
            ? '<span style="color:var(--text3);font-size:13px">Все ваши каналы уже добавлены</span>'
            : ''}
        </div>
      </div>

      <div class="form-actions" style="margin-top:12px">
        <button class="btn btn-secondary" onclick="renderNetworkSettings()">Назад</button>
        <button class="btn btn-primary" onclick="saveNetwork()" style="flex:1;justify-content:center">
          ➕ Создать
        </button>
      </div>
    </div>
  `;
}

function removePendingChannel(channelId) {
  window._pendingNetworkChannels = (window._pendingNetworkChannels || []).filter(id => id !== channelId);
  openNetworkEditorWithPending();
}

async function saveNetwork() {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) { showToast('⚠️ Войдите через бота', 'error'); return; }

  const name = document.getElementById('networkNameInput')?.value.trim() || 'Моя сетка';

  if (_editingNetworkId) {
    // Обновить название
    const result = await apiFetch(`/networks/${_editingNetworkId}`, {
      method: 'PUT',
      body: JSON.stringify({ user_id: user.id, name }),
    });
    if (result && !result.__error) {
      const net = _networks.find(n => n.id === _editingNetworkId);
      if (net) net.name = name;
      showToast('✅ Сетка обновлена!', 'success');
      _allUserNetworks = []; // сбрасываем поисковый кэш
    } else {
      showToast(`❌ ${result?.error || 'Ошибка'}`, 'error');
    }
  } else {
    // Создать новую
    const result = await apiFetch('/networks', {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, name }),
    });
    if (!result || result.__error) {
      showToast(`❌ ${result?.error || 'Ошибка создания'}`, 'error');
      return;
    }

    // Добавить pending каналы
    const pending = window._pendingNetworkChannels || [];
    for (const chId of pending) {
      await apiFetch(`/networks/${result.id}/channels`, {
        method: 'POST',
        body: JSON.stringify({ user_id: user.id, channel_id: chId }),
      });
    }

    // Перезагрузить сетки
    const nets = await apiFetch(`/user/${user.id}/networks`);
    _networks = (nets && !nets.__error) ? nets : [];
    _allUserNetworks = [];

    showToast('✅ Сетка создана!', 'success');
    window._pendingNetworkChannels = [];
  }

  renderNetworkSettings();
}

async function deleteNetwork(netId, name) {
  if (!confirm(`Удалить сетку "${name}"?`)) return;
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) return;

  const result = await apiFetch(`/networks/${netId}`, {
    method: 'DELETE',
    body: JSON.stringify({ user_id: user.id }),
  });

  if (result && !result.__error) {
    _networks = _networks.filter(n => n.id !== netId);
    _allUserNetworks = [];
    showToast('🗑 Сетка удалена', 'success');
    renderNetworkSettingsUI();
  } else {
    showToast(`❌ ${result?.error || 'Ошибка'}`, 'error');
  }
}

// ── Settings init ──────────────────────────────────────────────────────────────
const settings = JSON.parse(localStorage.getItem('adhub_settings') || '{"notifNew":true,"notifCollab":true,"notifPrice":false}');

async function initSettings() {
  const user = tg?.initDataUnsafe?.user;
  document.getElementById('profileName').textContent = user
    ? (user.first_name + (user.last_name ? ' ' + user.last_name : ''))
    : 'Пользователь';
  document.getElementById('profileId').textContent = user
    ? `ID: ${user.id} · @${user.username || '—'}`
    : 'Открыто в браузере';

  Object.keys(settings).forEach(k => {
    const el = document.getElementById(k);
    if (el) el.classList.toggle('on', !!settings[k]);
  });

  renderCollabSettings();
  renderCurrencySettings();
  renderNetworkSettings();
}

function toggleSetting(key) {
  settings[key] = !settings[key];
  const el = document.getElementById(key);
  if (el) el.classList.toggle('on', settings[key]);
  localStorage.setItem('adhub_settings', JSON.stringify(settings));
  showToast(settings[key] ? '✅ Включено' : '❌ Выключено');
  if (tg) tg.HapticFeedback?.impactOccurred('light');
}

// ── Send to bot ───────────────────────────────────────────────────────────────
function sendToBot(data) {
  if (tg) {
    try { tg.sendData(JSON.stringify(data)); } catch(e) {}
  }
}

// ── Donate ────────────────────────────────────────────────────────────────────
function selectAmount(val, el) {
  document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  const customRow = document.getElementById('customAmountRow');
  if (val === 'custom') {
    if (customRow) customRow.style.display = 'flex';
    selectedAmount = null;
    const btn = document.getElementById('donateBtnAmount');
    if (btn) btn.textContent = 'Stars';
  } else {
    if (customRow) customRow.style.display = 'none';
    selectedAmount = val;
    const btn = document.getElementById('donateBtnAmount');
    if (btn) btn.textContent = val + ' Stars';
  }
}

function sendDonate() {
  let amount = selectedAmount;
  if (!amount) {
    amount = parseInt(document.getElementById('customInput')?.value);
    if (!amount || amount < 1 || amount > 10000) {
      showToast('⚠️ Введите корректную сумму (1–10000)', 'error');
      return;
    }
  }
  sendToBot({ action: 'donate', amount });
  showToast(`💎 Спасибо за ${amount} Stars! ❤️`, 'success');
  if (tg) tg.HapticFeedback?.notificationOccurred('success');
}

// ── Empty state ───────────────────────────────────────────────────────────────
function emptyState(title, sub) {
  return `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">${title}</div><div class="empty-sub">${sub}</div></div>`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
registerUser();
loadStats();
renderHome('all');
doSearch();
initSettings();