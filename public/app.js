// ── Telegram WebApp init ──────────────────────────────────────────────────────

// git add .
// git commit -m "fix db connection"
// git push
//11.08.2026
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
    username:           fmtUsname(ch.usname),
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
  if (name !== 'manage') stopPollNewChannels();
  if (name === 'search')   { doSearch(); }
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
// Отображение usname: приватный канал (числовой ID) → '🔒 Приватный'
function fmtUsname(usname) {
  if (!usname) return '';
  const s = String(usname).trim();
  return /^-?\d{6,}$/.test(s) ? '🔒 Приватный' : '@' + s.replace(/^@/, '');
}

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
}

let _allUserNetworks  = [];  // свои сетки
let _allPublicNetworks = []; // все публичные
let _netTab = 'my';          // 'my' | 'all'
let _netCatFilter = 'all';
let _netCatOpen = false;     // свёрнут/развёрнут блок категорий

// Вызывается при открытии страницы поиска
async function loadAndRenderNetworks() {
  const user = tg?.initDataUnsafe?.user;
  const nr = document.getElementById('networkSearchResults');
  if (!nr) return;

  _renderNetworkSearchShell();

  if (user?.id) {
    const myNets = await apiFetch(`/user/${user.id}/networks`);
    _allUserNetworks = (myNets && !myNets.__error) ? myNets : [];
  }

  const pubNets = await apiFetch('/networks/all');
  _allPublicNetworks = (pubNets && !pubNets.__error) ? pubNets : [];

  _renderNetworkCards();
}

const NET_CATS = [
  ['all','⚡ Все категории'],['tech','🖥️ Технологии'],['business','💼 Бизнес'],
  ['finance','📈 Финансы'],['games','🎮 Игры'],['art','🎨 Творчество'],
  ['news','📰 Новости'],['entertainment','🎬 Развлечения'],
  ['edu','🎓 Образование'],['other','🌍 Другое'],
];

function _renderNetworkSearchShell() {
  const nr = document.getElementById('networkSearchResults');
  if (!nr) return;

  const activeCatLabel = NET_CATS.find(([v]) => v === _netCatFilter)?.[1] || 'Все категории';

  nr.innerHTML = `
    <!-- Вкладки -->
    <div class="net-tabs">
      <div class="net-tab ${_netTab==='my' ?'active':''}" onclick="switchNetTab('my')">📋 Мои сетки</div>
      <div class="net-tab ${_netTab==='all'?'active':''}" onclick="switchNetTab('all')">🌐 Все сетки</div>
    </div>

    <!-- Сворачиваемый фильтр категорий -->
    <div class="net-cat-wrap">
      <div class="net-cat-toggle" onclick="toggleNetCat()">
        <span>🏷 Категория: <strong>${activeCatLabel}</strong></span>
        <span class="net-cat-arrow ${_netCatOpen?'open':''}">▾</span>
      </div>
      <div class="net-cat-list ${_netCatOpen?'open':''}">
        ${NET_CATS.map(([v,l]) => `
          <div class="net-cat-item ${_netCatFilter===v?'active':''}" onclick="setNetCat('${v}')">
            ${l}
            ${_netCatFilter===v ? '<span class="net-cat-check">✓</span>' : ''}
          </div>`).join('')}
      </div>
    </div>

    <!-- Список карточек -->
    <div id="netCardsList"><div class="net-empty">Загрузка…</div></div>
  `;
}

function toggleNetCat() {
  _netCatOpen = !_netCatOpen;
  // Обновляем только внутренности блока, не перерисовывая карточки
  const wrap  = document.querySelector('.net-cat-wrap');
  const list  = document.querySelector('.net-cat-list');
  const arrow = document.querySelector('.net-cat-arrow');
  if (!wrap || !list || !arrow) return;
  list.classList.toggle('open', _netCatOpen);
  arrow.classList.toggle('open', _netCatOpen);
  if (tg) tg.HapticFeedback?.impactOccurred('light');
}

function switchNetTab(tab) {
  _netTab = tab;
  _netCatOpen = false;
  _renderNetworkSearchShell();
  _renderNetworkCards();
}

function setNetCat(cat) {
  _netCatFilter = cat;
  _netCatOpen = false;   // закрываем после выбора
  _renderNetworkSearchShell();
  _renderNetworkCards();
}

function onNetworkSearch() {
  _renderNetworkCards();
}

function _renderNetworkCards() {
  const listEl = document.getElementById('netCardsList');
  if (!listEl) return;

  const q   = document.getElementById('networkSearch')?.value.toLowerCase().trim() || '';
  const src = _netTab === 'my' ? _allUserNetworks : _allPublicNetworks;

  let nets = src.filter(n => {
    // Фильтр по категории
    if (_netCatFilter !== 'all' && n.category !== _netCatFilter) return false;
    // Фильтр по тексту
    if (q) {
      return n.name.toLowerCase().includes(q)
        || (n.category||'').toLowerCase().includes(q)
        || (n.channels||[]).some(c => c.name.toLowerCase().includes(q) || c.usname.toLowerCase().includes(q));
    }
    return true;
  });

  if (nets.length === 0) {
    listEl.innerHTML = `<div class="net-empty">${
      _netTab === 'my'
        ? 'У вас пока нет сеток. Создайте в разделе Настройки → Сетки каналов'
        : 'Публичных сеток не найдено'
    }</div>`;
    return;
  }

  listEl.innerHTML = `
    <div class="channel-list" style="gap:10px">
      ${nets.map(n => buildNetworkCard(n)).join('')}
    </div>
  `;
}

// Карточка сетки
function buildNetworkCard(net) {
  const channels  = net.channels || [];
  const totalSubs = channels.reduce((s, c) => s + (parseInt(c.subscribers) || 0), 0);
  const sym       = getCurrSymbol(net.currency || 'RUB');
  const catName   = CAT_NAMES[net.category] || '';

  const fmtP = (v, label) => {
    if (!v) return null;
    if (v === '-') return `<span class="tag" style="opacity:.55">${label}: —</span>`;
    return `<span class="tag">${label}: ${v}${sym}</span>`;
  };

  const priceHtml = [
    fmtP(net.pricead_24,  '24ч'),
    fmtP(net.pricead_48,  '48ч'),
    fmtP(net.pricead_72,  '72ч'),
    fmtP(net.pricead_all, '∞'),
  ].filter(Boolean).join('');

  return `
  <div class="ch-card" onclick="openNetworkModal(${net.id})" style="cursor:pointer">
    <div class="ch-top">
      <div class="ch-avatar" style="background:rgba(108,99,255,.15);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">📋</div>
      <div class="ch-info">
        <div class="ch-name-row">
          <span class="ch-name">${net.name}</span>
          ${net.is_public ? '<span class="badge-verified" title="Публичная">🌐</span>' : ''}
        </div>
        <div class="ch-username" style="color:var(--text3)">${sym} ${net.currency||'RUB'}${catName?' · '+catName:''}</div>
        <div class="ch-tags">
          <span class="tag">${channels.length} канал${channels.length===1?'':channels.length<5?'а':'ов'}</span>
          <span class="tag green">👥 ${fmt(totalSubs)}</span>
          ${catName ? `<span class="tag">${catName}</span>` : ''}
        </div>
      </div>
    </div>

    ${priceHtml ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 0">${priceHtml}</div>` : ''}

    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">
      ${channels.slice(0, 4).map(c => `
        <div class="metric" style="gap:5px;flex-shrink:0">
          ${c.avatar_url
            ? `<img src="${c.avatar_url}" style="width:16px;height:16px;border-radius:4px;object-fit:cover" onerror="this.style.display='none'">`
            : '<span style="font-size:13px">📢</span>'}
          <strong style="font-size:11px">${fmtUsname(c.usname)}</strong>
        </div>`).join('')}
      ${channels.length > 4 ? `<div class="metric"><strong style="font-size:11px;color:var(--text3)">+${channels.length-4}</strong></div>` : ''}
    </div>

    <div class="ch-bottom" style="margin-top:10px">
      <div class="price-badge">📊 ${fmt(totalSubs)} подп.</div>
      <button class="ch-btn ch-btn-primary" onclick="event.stopPropagation();openNetworkModal(${net.id})">👁 Подробнее</button>
    </div>
  </div>`;
}

// Написать владельцу сетки
async function contactNetwork(networkId) {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) {
    showToast('⚠️ Откройте приложение через бота', 'error');
    return;
  }
  const result = await apiFetch('/send-network-message', {
    method: 'POST',
    body: JSON.stringify({ user_id: user.id, network_id: networkId }),
  });
  if (result?.ok) {
    showToast('📩 Сообщение отправлено в бот!', 'success');
    if (tg) tg.HapticFeedback?.notificationOccurred('success');
  } else {
    showToast(`❌ ${result?.error || 'Ошибка'}`, 'error');
  }
}

// Модальное окно сетки
function openNetworkModal(netId) {
  // Ищем в обоих источниках
  const net = _allUserNetworks.find(n => n.id === netId)
           || _allPublicNetworks.find(n => n.id === netId);
  if (!net) return;

  const channels  = net.channels || [];
  const totalSubs = channels.reduce((s, c) => s + (parseInt(c.subscribers) || 0), 0);
  const sym       = getCurrSymbol(net.currency || 'RUB');
  const catName   = CAT_NAMES[net.category] || '';

  const fmtP = (v) => (!v || v === '-') ? '—' : `${v}${sym}`;

  // Проверяем — это чужая сетка (показываем кнопку контакта) или своя
  const currentUserId = tg?.initDataUnsafe?.user?.id;
  const isOwn = net.owner_id && String(net.owner_id) === String(currentUserId);

  document.getElementById('networkModalContent').innerHTML = `
    <div class="modal-ch-header">
      <div class="modal-avatar" style="background:rgba(108,99,255,.18);display:flex;align-items:center;justify-content:center;font-size:32px">📋</div>
      <div>
        <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:800;display:flex;align-items:center;gap:7px">
          ${net.name}
          ${net.is_public ? '<span class="badge-verified" title="Публичная сетка">🌐</span>' : ''}
        </div>
        <div style="color:var(--text3);font-size:13px;margin:3px 0">Сетка каналов · ${sym} ${net.currency||'RUB'}${catName?' · '+catName:''}</div>
        <span class="tag">${channels.length} канал${channels.length===1?'':channels.length<5?'а':'ов'}</span>
        ${catName ? `<span class="tag" style="margin-left:5px">${catName}</span>` : ''}
      </div>
    </div>

    <!-- Статистика -->
    <div class="modal-stat-grid" style="grid-template-columns:repeat(2,1fr)">
      <div class="modal-stat"><div class="modal-stat-val">${fmt(totalSubs)}</div><div class="modal-stat-key">Всего подписчиков</div></div>
      <div class="modal-stat"><div class="modal-stat-val">${channels.length}</div><div class="modal-stat-key">Каналов в сетке</div></div>
    </div>

    <!-- Цены сетки -->
    <div style="margin:4px 0 8px;font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.6px">Цены рекламы в сетке</div>
    <div class="modal-stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
      <div class="modal-stat"><div class="modal-stat-val" style="font-size:15px">${fmtP(net.pricead_24)}</div><div class="modal-stat-key">24 ч</div></div>
      <div class="modal-stat"><div class="modal-stat-val" style="font-size:15px">${fmtP(net.pricead_48)}</div><div class="modal-stat-key">48 ч</div></div>
      <div class="modal-stat"><div class="modal-stat-val" style="font-size:15px">${fmtP(net.pricead_72)}</div><div class="modal-stat-key">72 ч</div></div>
      <div class="modal-stat"><div class="modal-stat-val" style="font-size:15px">${fmtP(net.pricead_all)}</div><div class="modal-stat-key">Навсегда</div></div>
    </div>

    <!-- Каналы сетки -->
    <div style="margin:0 0 8px;font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.6px">Каналы сетки</div>
    ${channels.length > 0 ? `
      <div class="net-channel-list">
        ${channels.map(c => {
          const subs = parseInt(c.subscribers)||0;
          const cSym = getCurrSymbol(c.currency||'RUB');
          const fmtC = (v) => (!v || v==='-') ? '—' : `${v}${cSym}`;
          return `
          <div class="net-ch-row" onclick="closeNetworkModal();openModal(${c.id})">
            <div class="net-ch-avatar">
              ${c.avatar_url
                ? `<img src="${c.avatar_url}" style="width:100%;height:100%;border-radius:10px;object-fit:cover" onerror="this.parentNode.innerHTML='📢'">`
                : '📢'}
            </div>
            <div class="net-ch-info">
              <div class="net-ch-name">${c.name}</div>
              <div class="net-ch-meta">${fmtUsname(c.usname)}</div>
              <div class="net-ch-prices">
                ${[['24ч',c.pricead_24],['48ч',c.pricead_48],['72ч',c.pricead_72],['∞',c.pricead_all]]
                  .filter(([,v]) => v)
                  .map(([l,v]) => `<span class="tag" style="font-size:10px;padding:2px 6px">${l}: ${fmtC(v)}</span>`)
                  .join('')}
              </div>
            </div>
            <div class="net-ch-right">
              <div class="net-ch-subs">👥 ${fmt(subs)}</div>
            </div>
          </div>`;
        }).join('')}
      </div>` : `<div class="net-empty">Каналы не добавлены</div>`}

    <!-- Кнопки -->
    <div class="modal-btns" style="flex-direction:column;gap:8px">
      ${!isOwn ? `
        <button class="modal-btn modal-btn-primary"
                onclick="contactNetwork(${net.id});closeNetworkModal()">
          📩 Написать владельцу сетки
        </button>` : ''}
      <button class="modal-btn modal-btn-secondary" onclick="closeNetworkModal()">Закрыть</button>
    </div>
  `;

  document.getElementById('networkModalOverlay').classList.add('open');
  if (tg) tg.HapticFeedback?.impactOccurred('medium');
}

function closeNetworkModal(e) {
  if (!e || e.target === document.getElementById('networkModalOverlay')) {
    document.getElementById('networkModalOverlay').classList.remove('open');
  }
}

async function renderNetworkSearchResults(q) { /* legacy */ }

function setSort(el) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentSort = el.dataset.sort;

  const netPanel = document.getElementById('networkSearchResults');
  const chList   = document.getElementById('searchList');
  const resInfo  = document.querySelector('.search-results-info');

  if (currentSort === 'networks') {
    // Показываем сетки, скрываем список каналов
    if (netPanel)  netPanel.style.display  = 'block';
    if (chList)    chList.style.display    = 'none';
    if (resInfo)   resInfo.style.display   = 'none';
    loadAndRenderNetworks();
  } else {
    // Показываем каналы, скрываем сетки
    if (netPanel)  netPanel.style.display  = 'none';
    if (chList)    chList.style.display    = 'block';
    if (resInfo)   resInfo.style.display   = 'flex';
    doSearch();
  }
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
  trackEvent(channelId, 'click');
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
  } else {
    const msg = result?.error || 'Не удалось отправить сообщение';
    showToast(`❌ ${msg}`, 'error');
    if (tg) tg.HapticFeedback?.notificationOccurred('error');
  }
}

function openModal(id) {
  trackEvent(id, 'view');
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
  resetForm(); // скрываем форму редактирования и сбрасываем состояние

  const user   = tg?.initDataUnsafe?.user;
  const userId = user?.id;
  const list   = document.getElementById('myChannelsList');

  if (!userId) {
    list.innerHTML = emptyState('Войдите через Telegram', 'Откройте приложение через бота');
    stopPollNewChannels();
    return;
  }

  list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-title">Загрузка…</div></div>';
  await loadMyChannelsList(userId);

  // Ждём новые каналы, которые пользователь добавит через Telegram (бот → админ)
  startPollNewChannels(userId);
}

// ── Список моих каналов ────────────────────────────────────────────────────────
async function loadMyChannelsList(userId) {
  const list = document.getElementById('myChannelsList');
  const data = await apiFetch(`/user/${userId}/channels`);

  if (!data || data.__error || data.length === 0) {
    list.innerHTML = emptyState(
      'Пока нет каналов',
      'Добавь бота администратором в свой канал — он появится здесь автоматически'
    );
    return;
  }

  const sym = getCurrSymbol(userCurrencyPrimary || 'RUB');
  list.innerHTML = data.map(ch => {
    const needsSetup = !ch.category;
    const prices = [
      ch.pricead_24  ? `24ч: ${ch.pricead_24  === '-' ? '—' : ch.pricead_24  + sym}` : null,
      ch.pricead_48  ? `48ч: ${ch.pricead_48  === '-' ? '—' : ch.pricead_48  + sym}` : null,
      ch.pricead_72  ? `72ч: ${ch.pricead_72  === '-' ? '—' : ch.pricead_72  + sym}` : null,
      ch.pricead_all ? `∞: ${ch.pricead_all  === '-' ? '—' : ch.pricead_all + sym}` : null,
    ].filter(Boolean);
    return `
    <div class="manage-ch-item ${needsSetup ? 'manage-ch-item-pending' : ''}">
      <div class="manage-ch-info">
        <div class="manage-ch-name">
          ${ch.name}
          ${needsSetup ? '<span class="tag orange" style="margin-left:6px">Заполните карточку</span>' : ''}
        </div>
        <div class="manage-ch-meta">${fmtUsname(ch.usname)} · ${ch.category ? (CAT_NAMES[ch.category] || ch.category) : '— без категории —'} · ${fmt(ch.subscribers || 0)} подп.</div>
        <div class="manage-ch-prices">
          ${prices.map(p => `<span class="tag">${p}</span>`).join('')}
          ${!needsSetup ? `<span class="tag" style="background:rgba(108,99,255,.1);color:var(--accent2)">${sym} ${userCurrencyPrimary || ch.currency || 'RUB'}</span>` : ''}
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

// ── Поллинг новых автоматически добавленных каналов ───────────────────────────
let _managePollTimer = null;

function startPollNewChannels(userId) {
  stopPollNewChannels();
  _managePollTimer = setInterval(async () => {
    try {
      const res = await apiFetch(`/verify-channel/pending/${userId}`);
      if (res && res.channel_id) {
        showToast(`✅ Канал "${res.channel_name || res.chat_id}" добавлен! Заполните карточку`, 'success');
        if (tg) tg.HapticFeedback?.notificationOccurred('success');
        await loadMyChannelsList(userId);
        loadStats();
      }
    } catch (err) {
      // сетевые ошибки при поллинге игнорируем
    }
  }, 3000);
}

function stopPollNewChannels() {
  if (_managePollTimer) {
    clearInterval(_managePollTimer);
    _managePollTimer = null;
  }
}

// ── Сохранить карточку канала (категория / цены) ──────────────────────────────
async function submitChannel() {
  const user = tg?.initDataUnsafe?.user;
  if (!editingChannelId) return;

  const category = document.getElementById('fCategory')?.value;
  const price24  = document.getElementById('fPrice24')?.value.trim();
  const price48  = document.getElementById('fPrice48')?.value.trim();
  const price72  = document.getElementById('fPrice72')?.value.trim();
  const priceAll = document.getElementById('fPriceAll')?.value.trim();
  const currency = document.getElementById('fCurrency')?.value || 'RUB';

  if (!category) {
    showToast('⚠️ Выберите категорию', 'error');
    return;
  }

  const data = await apiFetch(`/channels/${editingChannelId}`);
  const body = {
    name: data.name, usname: data.usname, category,
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
    showToast('✅ Карточка канала сохранена!', 'success');
    resetForm();
    renderManagePage();
    loadStats();
  } else {
    showToast(`❌ ${result?.error || result?.message || 'Ошибка'}`, 'error');
  }
}

// ── Редактировать карточку канала (категория / цены) ─────────────────────────
async function editChannel(id) {
  const data = await apiFetch(`/channels/${id}`);
  if (!data || data.__error) return;

  editingChannelId = id;

  const card = document.getElementById('manageFormCard');
  card.innerHTML = `
    <div class="manage-form-title">✏️ Карточка канала</div>
    <div class="form-group">
      <div class="edit-channel-meta">
        ${data.avatar_url ? `<img src="${data.avatar_url}" class="edit-channel-avatar">` : ''}
        <div>
          <div class="edit-channel-name">${data.name}</div>
          <div class="edit-channel-usname">${fmtUsname(data.usname)}</div>
        </div>
      </div>
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
      <button class="btn btn-secondary" onclick="resetForm()">Отмена</button>
      <button class="btn btn-primary" onclick="submitChannel()" style="flex:1;justify-content:center">💾 Сохранить</button>
    </div>
  `;

  document.getElementById('fCategory').value = data.category || '';
  document.getElementById('fPrice24').value  = data.pricead_24  || '';
  document.getElementById('fPrice48').value  = data.pricead_48  || '';
  document.getElementById('fPrice72').value  = data.pricead_72  || '';
  document.getElementById('fPriceAll').value = data.pricead_all || '';
  document.getElementById('fCurrency').value = data.currency || 'RUB';
  updatePriceLabels();

  card.style.display = '';
  card.scrollIntoView({ behavior: 'smooth' });
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
  const card = document.getElementById('manageFormCard');
  if (card) {
    card.style.display = 'none';
    card.innerHTML = '';
  }
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
            <div class="set-sub">${fmtUsname(ch.usname)}</div>
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
  _allUserNetworks = _networks; // синхронизируем кэш поиска "Мои"

  renderNetworkSettingsUI();
}

function renderNetworkSettingsUI() {
  const block = document.getElementById('networkSettingsBlock');
  if (!block) return;

  block.innerHTML = `
    <div style="margin-bottom:0">
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:12px"
              onclick="openNetworkEditor(null)">
        ➕ Создать сетку каналов
      </button>
      ${_networks.length === 0
        ? '<div style="padding:8px;color:var(--text3);font-size:13px;text-align:center">Сеток пока нет</div>'
        : _networks.map(net => {
            const sym = getCurrSymbol(net.currency || 'RUB');
            const prices = [
              net.pricead_24  && net.pricead_24  !== '-' ? `24ч: ${net.pricead_24}${sym}`  : net.pricead_24  === '-' ? '24ч: —' : null,
              net.pricead_48  && net.pricead_48  !== '-' ? `48ч: ${net.pricead_48}${sym}`  : net.pricead_48  === '-' ? '48ч: —' : null,
              net.pricead_72  && net.pricead_72  !== '-' ? `72ч: ${net.pricead_72}${sym}`  : net.pricead_72  === '-' ? '72ч: —' : null,
              net.pricead_all && net.pricead_all !== '-' ? `∞: ${net.pricead_all}${sym}`   : net.pricead_all === '-' ? '∞: —'   : null,
            ].filter(Boolean);
            return `
            <div class="manage-ch-item" style="margin-bottom:10px">
              <div class="manage-ch-info" style="flex:1">
                <div class="manage-ch-name">📋 ${net.name}</div>
                <div class="manage-ch-meta">${(net.channels||[]).length} каналов · ${sym} ${net.currency||'RUB'}</div>
                <div class="manage-ch-prices">
                  ${prices.map(p => `<span class="tag">${p}</span>`).join('')}
                </div>
                <div class="manage-ch-prices" style="margin-top:4px">
                  ${(net.channels||[]).map(c => `
                    <span class="tag" style="display:inline-flex;align-items:center;gap:4px">
                      ${c.avatar_url ? `<img src="${c.avatar_url}" style="width:14px;height:14px;border-radius:3px;object-fit:cover">` : '📢'}
                      ${fmtUsname(c.usname)}
                    </span>`).join('')}
                </div>
              </div>
              <div class="manage-ch-btns">
                <button class="ch-btn ch-btn-ghost" onclick="openNetworkEditor(${net.id})">✏️</button>
                <button class="ch-btn ch-btn-danger" onclick="deleteNetwork(${net.id}, '${net.name.replace(/'/g,"\\'")}')">🗑</button>
              </div>
            </div>`;
          }).join('')}
    </div>
  `;
}

// ── Редактор сетки ────────────────────────────────────────────────────────────
// state: какие каналы выбраны (для новой сетки — pending, для существующей — live)
let _netEditorChannels = []; // массив объектов channel из БД

async function openNetworkEditor(netId) {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) { showToast('⚠️ Войдите через бота', 'error'); return; }

  _editingNetworkId = netId;
  const net = netId ? _networks.find(n => n.id === netId) : null;

  // Сброс state публичности — инициализируем из текущей сетки
  window._netEditorIsPublic = net?.is_public ?? false;

  // Загружаем каналы пользователя
  const userChannelsResp = await apiFetch(`/user/${user.id}/channels`);
  const myChannels = (userChannelsResp && !userChannelsResp.__error) ? userChannelsResp : [];

  // Выбранные каналы: для существующей сетки берём из net.channels
  _netEditorChannels = net ? [...(net.channels || [])] : [];

  _renderNetworkEditorUI(net, myChannels);
}

function _saveNetFormState() {
  return {
    name:     document.getElementById('netNameInput')?.value  ?? null,
    category: document.getElementById('netCategory')?.value   ?? null,
    currency: document.getElementById('netCurrency')?.value   ?? null,
    p24:      document.getElementById('netPrice24')?.value    ?? null,
    p48:      document.getElementById('netPrice48')?.value    ?? null,
    p72:      document.getElementById('netPrice72')?.value    ?? null,
    pAll:     document.getElementById('netPriceAll')?.value   ?? null,
  };
}

function _renderNetworkEditorUI(net, myChannels) {
  const block = document.getElementById('networkSettingsBlock');
  if (!block) return;

  // Сохраняем то что уже ввёл пользователь (если поля ещё существуют в DOM)
  const saved = _saveNetFormState();

  const netId  = net?.id || null;

  // Приоритет: то что набрал юзер > данные из БД > дефолт
  const curName = (saved.name    !== null && saved.name    !== '') ? saved.name    : (net?.name     || '');
  const curCat  = (saved.category !== null)                        ? saved.category : (net?.category || '');
  const curCur  = (saved.currency !== null)                        ? saved.currency : (net?.currency || userCurrencyPrimary || 'RUB');
  const curP24  = (saved.p24  !== null) ? saved.p24  : (net?.pricead_24  || '');
  const curP48  = (saved.p48  !== null) ? saved.p48  : (net?.pricead_48  || '');
  const curP72  = (saved.p72  !== null) ? saved.p72  : (net?.pricead_72  || '');
  const curPAll = (saved.pAll !== null) ? saved.pAll : (net?.pricead_all || '');
  const curSym  = getCurrSymbol(curCur);
  const curPub  = window._netEditorIsPublic !== undefined
                    ? window._netEditorIsPublic
                    : (net?.is_public ?? false);

  const availableChannels = myChannels.filter(c => !_netEditorChannels.find(cc => cc.id === c.id));

  block.innerHTML = `
    <div class="manage-form-card" style="margin-bottom:0">
      <div class="manage-form-title">${netId ? '✏️ Редактировать сетку' : '➕ Создать сетку'}</div>

      <!-- Название -->
      <div class="form-group">
        <label class="form-label">Название сетки</label>
        <input class="form-input" id="netNameInput" placeholder="Моя сетка" value="${curName}">
      </div>

      <!-- Категория -->
      <div class="form-group">
        <label class="form-label">Категория</label>
        <select class="form-input" id="netCategory">
          <option value="">— Без категории —</option>
          <option value="tech"          ${curCat==='tech'          ?'selected':''}>🖥️ Технологии</option>
          <option value="business"      ${curCat==='business'      ?'selected':''}>💼 Бизнес</option>
          <option value="finance"       ${curCat==='finance'       ?'selected':''}>📈 Финансы</option>
          <option value="games"         ${curCat==='games'         ?'selected':''}>🎮 Игры</option>
          <option value="art"           ${curCat==='art'           ?'selected':''}>🎨 Творчество</option>
          <option value="news"          ${curCat==='news'          ?'selected':''}>📰 Новости</option>
          <option value="entertainment" ${curCat==='entertainment' ?'selected':''}>🎬 Развлечения</option>
          <option value="edu"           ${curCat==='edu'           ?'selected':''}>🎓 Образование</option>
          <option value="other"         ${curCat==='other'         ?'selected':''}>🌍 Другое</option>
        </select>
      </div>

      <!-- Валюта -->
      <div class="form-group">
        <label class="form-label">Валюта сетки</label>
        <select class="form-input" id="netCurrency" onchange="updateNetPriceLabels()">
          ${['RUB','KZT','TON','USD','STARS'].map(c =>
            `<option value="${c}" ${curCur===c?'selected':''}>
              ${getCurrSymbol(c)} ${c}
            </option>`
          ).join('')}
        </select>
      </div>

      <!-- Цены -->
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label" id="netLabel24">Цена 24ч (${curSym})</label>
          <input class="form-input" id="netPrice24" placeholder="500 или -" value="${curP24}">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label" id="netLabel48">Цена 48ч (${curSym})</label>
          <input class="form-input" id="netPrice48" placeholder="800 или -" value="${curP48}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label" id="netLabel72">Цена 72ч (${curSym})</label>
          <input class="form-input" id="netPrice72" placeholder="1200 или -" value="${curP72}">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label" id="netLabelAll">Цена навсегда (${curSym})</label>
          <input class="form-input" id="netPriceAll" placeholder="2000 или -" value="${curPAll}">
        </div>
      </div>

      <!-- Публичность -->
      <div class="setting-item" style="background:var(--card2);border-radius:12px;padding:12px 14px;margin-bottom:14px;border:1.5px solid var(--border)">
        <div class="set-text">
          <div class="set-title">🌐 Публичная сетка</div>
          <div class="set-sub">Видна всем пользователям в поиске сеток</div>
        </div>
        <div class="set-right">
          <div class="toggle ${curPub ? 'on' : ''}" id="netPublicToggle"
               onclick="window._netEditorIsPublic=!window._netEditorIsPublic;this.classList.toggle('on',window._netEditorIsPublic)">
          </div>
        </div>
      </div>

      <!-- Каналы в сетке -->
      <div class="form-group">
        <label class="form-label">Каналы в сетке</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:28px">
          ${_netEditorChannels.length === 0
            ? '<span style="color:var(--text3);font-size:13px">Каналов пока нет</span>'
            : _netEditorChannels.map(c => `
                <div class="tag" style="display:inline-flex;align-items:center;gap:5px;padding:5px 8px">
                  ${c.avatar_url ? `<img src="${c.avatar_url}" style="width:14px;height:14px;border-radius:3px;object-fit:cover">` : '📢'}
                  ${fmtUsname(c.usname)}
                  <span style="cursor:pointer;color:var(--danger);margin-left:2px;font-weight:700"
                    onclick="netEditorRemoveChannel(${c.id})">✕</span>
                </div>`).join('')}
        </div>
        ${availableChannels.length > 0 ? `
          <label class="form-label" style="margin-bottom:6px">Добавить канал:</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${availableChannels.map(c => `
              <div class="tag" style="cursor:pointer;padding:6px 10px;display:inline-flex;align-items:center;gap:5px"
                   onclick="netEditorAddChannel(${c.id})">
                ${c.avatar_url ? `<img src="${c.avatar_url}" style="width:14px;height:14px;border-radius:3px;object-fit:cover">` : '📢'}
                + ${fmtUsname(c.usname)}
              </div>`).join('')}
          </div>` : '<div style="color:var(--text3);font-size:12px">Все ваши каналы уже добавлены</div>'}
      </div>

      <div class="form-actions" style="margin-top:4px">
        <button class="btn btn-secondary" onclick="renderNetworkSettings()">Назад</button>
        <button class="btn btn-primary" onclick="saveNetwork()" style="flex:1;justify-content:center">
          ${netId ? '💾 Сохранить' : '➕ Создать'}
        </button>
      </div>
    </div>
  `;

  window._netEditorMyChannels = myChannels;
}

function updateNetPriceLabels() {
  const sel = document.getElementById('netCurrency');
  if (!sel) return;
  const sym = getCurrSymbol(sel.value);
  [['netLabel24','Цена 24ч'],['netLabel48','Цена 48ч'],['netLabel72','Цена 72ч'],['netLabelAll','Цена навсегда']]
    .forEach(([id, txt]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = `${txt} (${sym})`;
    });
}

function netEditorAddChannel(channelId) {
  const ch = (window._netEditorMyChannels || []).find(c => c.id === channelId);
  if (!ch || _netEditorChannels.find(c => c.id === channelId)) return;
  _netEditorChannels.push(ch);
  const net = _editingNetworkId ? _networks.find(n => n.id === _editingNetworkId) : null;
  _renderNetworkEditorUI(net, window._netEditorMyChannels || []);
  if (tg) tg.HapticFeedback?.impactOccurred('light');
}

function netEditorRemoveChannel(channelId) {
  _netEditorChannels = _netEditorChannels.filter(c => c.id !== channelId);
  const net = _editingNetworkId ? _networks.find(n => n.id === _editingNetworkId) : null;
  _renderNetworkEditorUI(net, window._netEditorMyChannels || []);
  if (tg) tg.HapticFeedback?.impactOccurred('light');
}

async function saveNetwork() {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) { showToast('⚠️ Войдите через бота', 'error'); return; }

  const name      = document.getElementById('netNameInput')?.value.trim() || 'Моя сетка';
  const currency  = document.getElementById('netCurrency')?.value || 'RUB';
  const category  = document.getElementById('netCategory')?.value || null;
  const is_public = window._netEditorIsPublic ?? false;
  const p24       = document.getElementById('netPrice24')?.value.trim() || null;
  const p48       = document.getElementById('netPrice48')?.value.trim() || null;
  const p72       = document.getElementById('netPrice72')?.value.trim() || null;
  const pAll      = document.getElementById('netPriceAll')?.value.trim() || null;

  const payload = { user_id: user.id, name, currency, category: category||null, is_public,
    pricead_24: p24, pricead_48: p48, pricead_72: p72, pricead_all: pAll };

  let netId = _editingNetworkId;

  if (netId) {
    // Обновить данные сетки
    const result = await apiFetch(`/networks/${netId}`, { method: 'PUT', body: JSON.stringify(payload) });
    if (!result || result.__error) { showToast(`❌ ${result?.error||'Ошибка'}`, 'error'); return; }

    // Синхронизировать состав каналов
    const net = _networks.find(n => n.id === netId);
    const oldIds = (net?.channels||[]).map(c => c.id);
    const newIds = _netEditorChannels.map(c => c.id);

    // Удалить убранные
    for (const id of oldIds.filter(id => !newIds.includes(id))) {
      await apiFetch(`/networks/${netId}/channels/${id}`, {
        method: 'DELETE', body: JSON.stringify({ user_id: user.id })
      });
    }
    // Добавить новые
    for (const id of newIds.filter(id => !oldIds.includes(id))) {
      await apiFetch(`/networks/${netId}/channels`, {
        method: 'POST', body: JSON.stringify({ user_id: user.id, channel_id: id })
      });
    }

    showToast('✅ Сетка обновлена!', 'success');
  } else {
    // Создать сетку
    const result = await apiFetch('/networks', { method: 'POST', body: JSON.stringify(payload) });
    if (!result || result.__error) { showToast(`❌ ${result?.error||'Ошибка создания'}`, 'error'); return; }
    netId = result.id;

    // Добавить выбранные каналы
    for (const ch of _netEditorChannels) {
      await apiFetch(`/networks/${netId}/channels`, {
        method: 'POST', body: JSON.stringify({ user_id: user.id, channel_id: ch.id })
      });
    }
    showToast('✅ Сетка создана!', 'success');
  }

  // Перезагрузить список сеток
  const nets = await apiFetch(`/user/${user.id}/networks`);
  _networks = (nets && !nets.__error) ? nets : [];
  _allUserNetworks = _networks;
  _netEditorChannels = [];
  window._netEditorIsPublic = undefined;
  renderNetworkSettingsUI();
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
    _allUserNetworks = _networks;
    showToast('🗑 Сетка удалена', 'success');
    renderNetworkSettingsUI();
  } else {
    showToast(`❌ ${result?.error || 'Ошибка'}`, 'error');
  }
}

// ── Settings init ──────────────────────────────────────────────────────────────
const settings = JSON.parse(localStorage.getItem('adhub_settings') || '{"notifNew":true,"notifCollab":true,"notifPrice":false}');


// ── Отправить все каналы и сетки себе в бота ─────────────────────────────────
async function sendMyChannelsToBot() {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) { showToast('⚠️ Откройте через бота', 'error'); return; }

  const result = await apiFetch('/send-my-channels', {
    method: 'POST',
    body: JSON.stringify({ user_id: user.id }),
  });

  if (result?.ok) {
    if (result.empty) {
      showToast('У вас пока нет каналов и сеток', '');
    } else {
      showToast('📨 Отправлено в бота!', 'success');
      if (tg) tg.HapticFeedback?.notificationOccurred('success');
    }
  } else {
    showToast(`❌ ${result?.error || 'Ошибка'}`, 'error');
  }
}

// ── Поделиться ссылкой ───────────────────────────────────────────────────────
async function shareMyChannels() {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) { showToast('⚠️ Откройте через бота', 'error'); return; }

  const result = await apiFetch('/share-link', {
    method: 'POST',
    body: JSON.stringify({ user_id: user.id }),
  });

  if (!result?.ok) { showToast(`❌ ${result?.error || 'Ошибка'}`, 'error'); return; }

  const link = result.link;

  // Используем Telegram share если доступно
  if (tg?.openTelegramLink) {
    const shareText = encodeURIComponent('Посмотри мои каналы и сетки в AdsWay 📢');
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${shareText}`);
  } else {
    // Fallback — копируем в буфер
    try {
      await navigator.clipboard.writeText(link);
      showToast('🔗 Ссылка скопирована!', 'success');
    } catch {
      showToast(`🔗 ${link}`, 'success');
    }
  }
  if (tg) tg.HapticFeedback?.notificationOccurred('success');
}

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
  renderAnalyticsSettings();
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

// Подставить ID пользователя в ссылку «Отправить себе в бота»
const _tgUser = tg?.initDataUnsafe?.user;
if (_tgUser?.id) {
  const link = document.getElementById('sendToBotLink');
  if (link) link.href = `https://t.me/adsway_bot?start=share_${_tgUser.id}`;
}
// ═══════════════════════════════════════════════════════════════
//  АНАЛИТИКА КАНАЛОВ
// ═══════════════════════════════════════════════════════════════

// ── Трекинг просмотров и кликов (огонь-и-забыть) ─────────────
function trackEvent(channelId, eventType) {
  const viewerId = tg?.initDataUnsafe?.user?.id || null;
  apiFetch('/analytics/track', {
    method: 'POST',
    body: JSON.stringify({ channel_id: channelId, event_type: eventType, viewer_id: viewerId }),
  }).catch(() => {});
}

// ── Список каналов в блоке аналитики (страница Настройки) ────
async function renderAnalyticsSettings() {
  const block = document.getElementById('analyticsSettingsBlock');
  if (!block) return;

  const userId = tg?.initDataUnsafe?.user?.id;
  if (!userId) {
    block.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:13px">Войдите через бота</div>';
    return;
  }

  const channels = await apiFetch(`/user/${userId}/channels`);

  if (!channels || channels.__error || channels.length === 0) {
    block.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:13px">Нет каналов — добавьте канал в каталог</div>';
    return;
  }

  block.innerHTML = `
    <div class="settings-section">
      ${channels.map(ch => {
        const usnameStr = String(ch.usname || '');
        const isPrivate = /^-?\d{6,}$/.test(usnameStr);
        const sub = isPrivate
          ? (ch.subscribers ? Number(ch.subscribers).toLocaleString('ru') + ' подп.' : 'приватный')
          : '@' + usnameStr + (ch.subscribers ? ' · ' + Number(ch.subscribers).toLocaleString('ru') + ' подп.' : '');
        return `
        <div class="setting-item" onclick="showChannelAnalytics(${ch.id}, '${ch.name.replace(/'/g, "\\'")}')">
          <div class="set-icon purple">📊</div>
          <div class="set-text">
            <div class="set-title">${ch.name}</div>
            <div class="set-sub">${sub}</div>
          </div>
          <div class="set-right">›</div>
        </div>`;
      }).join('')}
    </div>
  `;
}

// ── Модальная шторка с аналитикой канала ─────────────────────
async function showChannelAnalytics(channelId, channelName) {
  const userId = tg?.initDataUnsafe?.user?.id;
  if (!userId) { showToast('⚠️ Откройте через бота', 'error'); return; }

  const overlay = document.createElement('div');
  overlay.id = 'analyticsOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;z-index:9999;';
  overlay.innerHTML = `
    <div style="background:var(--card-bg,#1a1a2e);border-radius:20px 20px 0 0;padding:20px 20px 40px;width:100%;max-width:480px;max-height:82vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:17px;font-weight:700">📊 Аналитика</div>
        <button onclick="document.getElementById('analyticsOverlay').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3,#888);line-height:1">✕</button>
      </div>
      <div style="font-size:13px;color:var(--text3,#888);margin-bottom:20px">${channelName}</div>
      <div id="analyticsBody" style="text-align:center;padding:32px;color:var(--text3,#888)">⏳ Загрузка…</div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  if (tg) tg.HapticFeedback?.impactOccurred('light');

  const data = await apiFetch(`/analytics/${channelId}?user_id=${userId}`);
  const body = document.getElementById('analyticsBody');
  if (!body) return;

  if (!data || data.__error) {
    body.innerHTML = '<div style="color:#f87171">❌ Ошибка загрузки данных</div>';
    return;
  }

  const { total, week, today, chart } = data;

  const dayNames = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  const maxV = Math.max(...(chart || []).map(d => Number(d.views)), 1);
  const chartHtml = chart && chart.length
    ? `<div style="display:flex;align-items:flex-end;gap:5px;height:56px;margin-top:10px">
        ${chart.map(d => {
          const h = Math.max(3, Math.round((Number(d.views) / maxV) * 56));
          const dn = dayNames[new Date(d.day + 'T12:00:00').getDay()];
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
            <div style="width:100%;background:var(--accent,#6c63ff);border-radius:3px 3px 0 0;height:${h}px"></div>
            <div style="font-size:9px;color:var(--text3,#888)">${dn}</div>
          </div>`;
        }).join('')}
       </div>`
    : '<div style="font-size:12px;color:var(--text3,#888);padding:8px 0">Данных за 7 дней пока нет</div>';

  body.style.textAlign = '';
  body.style.padding = '';
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      ${_aCard('Сегодня','👁', today.today_views, 'просм.')}
      ${_aCard('Сегодня','📩', today.today_clicks, 'кликов')}
      ${_aCard('7 дней','👁', week.week_views, 'просм.')}
      ${_aCard('7 дней','📩', week.week_clicks, 'кликов')}
      ${_aCard('Всего','👁', total.total_views, 'просм.')}
      ${_aCard('Всего','📩', total.total_clicks, 'кликов')}
    </div>
    <div style="background:var(--card2,rgba(255,255,255,.04));border-radius:12px;padding:14px">
      <div style="font-size:12px;font-weight:600;margin-bottom:2px">📈 Просмотры по дням</div>
      ${chartHtml}
    </div>
  `;
}


function _aCard(period, icon, value, unit) {
  return `
    <div style="background:var(--card2,rgba(255,255,255,.05));border-radius:12px;padding:12px 14px">
      <div style="font-size:10px;color:var(--text3,#888);margin-bottom:2px">${icon} ${period}</div>
      <div style="font-size:26px;font-weight:800;line-height:1.1">${value ?? 0}</div>
      <div style="font-size:10px;color:var(--text3,#888);margin-top:1px">${unit}</div>
    </div>`;
}