// ── Telegram WebApp init ──────────────────────────────────────────────────────

//git add .
//git commit -m "fix db connection"
//git push

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
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) throw new Error('Ошибка сервера: ' + res.status);
    return await res.json();
  } catch (err) {
    showToast('⚠️ Нет связи с сервером', 'error');
    return null;
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────
let CHANNELS = [];
let favorites = JSON.parse(localStorage.getItem('adhub_favs') || '[]');
let currentSort = 'default';
let currentFcat = 'all';
let selectedAmount = 250;
let showFavPage = false;
let editingChannelId = null; // ID канала при редактировании

// ── Категории ─────────────────────────────────────────────────────────────────
const CAT_NAMES = {
  tech:'Технологии', business:'Бизнес', games:'Игры', art:'Творчество',
  finance:'Финансы', news:'Новости', entertainment:'Развлечения',
  edu:'Образование', other:'Другое'
};

// ── Регистрация пользователя при открытии ─────────────────────────────────────
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
async function loadChannels(category = null) {
  const url = category && category !== 'all'
    ? `/channels?category=${category}`
    : '/channels';
  const data = await apiFetch(url);
  if (!data) return;
  CHANNELS = data.map(mapChannel);
}

function mapChannel(ch) {
  return {
    id:       ch.id,
    name:     ch.name,
    usname:   ch.usname,
    username: '@' + ch.usname,
    cat:      ch.category,
    subs:     ch.subscribers || 0,
    desc:     ch.desc || '',
    price24:  ch.pricead_24 || null,
    priceAll: ch.pricead_all || null,
    price:    parseFloat(ch.pricead_24) || 0,
    collab:   ch.collab ?? false,
    verified: ch.verified ?? false,
    avatar:   ch.avatar_url || null,
    owner_id: ch.owner_id,
  };
}

// ── Загрузка статистики из БД ─────────────────────────────────────────────────
async function loadStats() {
  const data = await apiFetch('/stats');
  if (!data) return;
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
  if (name === 'search') doSearch();
  if (name === 'home') renderHome('all');
  if (name === 'settings') initSettings();
  if (name === 'manage') renderManagePage();
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

// ── Channel card HTML ─────────────────────────────────────────────────────────
function buildCard(ch) {
  const isFav = favorites.includes(ch.id);
  const price24 = ch.price24 ? `$${ch.price24}/24ч` : '—';
  const priceAll = ch.priceAll ? `$${ch.priceAll}/∞` : '';
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
          ${ch.er > 10 ? '<span class="tag orange">🔥 Топ ER</span>' : ''}
        </div>
      </div>
    </div>
    ${ch.desc ? `<div class="ch-desc">${ch.desc}</div>` : ''}
    <div class="ch-metrics">
      <div class="metric"><span>👥</span><strong>${fmt(ch.subs)}</strong></div>
      <div class="metric"><span>📊</span><strong>ER ${ch.er}%</strong></div>
      <div class="metric"><span>📋</span><strong>${ch.collab ? 'ВП доступен' : 'Только реклама'}</strong></div>
    </div>
    <div class="ch-bottom">
      <div class="price-badge">💰 ${price24}${priceAll ? ' · ' + priceAll : ''}</div>
      <div class="ch-action-btns">
        <button class="ch-btn ch-btn-ghost" onclick="event.stopPropagation();toggleFav(${ch.id},this)">${isFav ? '❤️' : '🤍'}</button>
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

  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const subsMin  = parseInt(document.getElementById('subsMin').value)  || 0;
  const subsMax  = parseInt(document.getElementById('subsMax').value)  || Infinity;
  const priceMin = parseFloat(document.getElementById('priceMin').value) || 0;
  const priceMax = parseFloat(document.getElementById('priceMax').value) || Infinity;

  let data = CHANNELS.filter(c => {
    if (currentFcat !== 'all' && c.cat !== currentFcat) return false;
    if (q && !c.name.toLowerCase().includes(q) && !c.username.toLowerCase().includes(q) && !c.desc.toLowerCase().includes(q)) return false;
    if (c.subs < subsMin || c.subs > subsMax) return false;
    if (c.price < priceMin || c.price > priceMax) return false;
    return true;
  });

  if (currentSort === 'subs')  data = [...data].sort((a,b) => b.subs - a.subs);
  if (currentSort === 'price') data = [...data].sort((a,b) => a.price - b.price);
  if (currentSort === 'er')    data = [...data].sort((a,b) => b.er - a.er);

  const list = document.getElementById('searchList');
  list.innerHTML = data.length ? data.map(buildCard).join('') : emptyState('Ничего не найдено', 'Попробуйте изменить запрос или фильтры');
  document.getElementById('resultsInfo').textContent = `Найдено ${data.length} кан${data.length===1?'ал':data.length<5?'ала':'алов'}`;
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

function toggleFilters() {
  const p = document.getElementById('filterPanel');
  const btn = document.getElementById('filterToggle');
  p.classList.toggle('open');
  btn.classList.toggle('active');
  btn.textContent = p.classList.contains('open') ? '⚙️ Скрыть' : '⚙️ Фильтры';
}

// ── MANAGE PAGE ───────────────────────────────────────────────────────────────
async function renderManagePage() {
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

  if (!data || data.length === 0) {
    list.innerHTML = emptyState('Нет каналов', 'Добавьте первый канал выше');
    return;
  }

  list.innerHTML = data.map(ch => `
    <div class="manage-ch-item">
      <div class="manage-ch-info">
        <div class="manage-ch-name">${ch.name}</div>
        <div class="manage-ch-meta">@${ch.usname} · ${CAT_NAMES[ch.category] || ch.category} · ${fmt(ch.subscribers || 0)} подп.</div>
        <div class="manage-ch-prices">
          ${ch.pricead_24 ? `<span class="tag">24ч: $${ch.pricead_24}</span>` : ''}
          ${ch.pricead_all ? `<span class="tag">∞: $${ch.pricead_all}</span>` : ''}
        </div>
      </div>
      <div class="manage-ch-btns">
        <button class="ch-btn ch-btn-ghost" onclick="editChannel(${ch.id})">✏️</button>
        <button class="ch-btn ch-btn-danger" onclick="deleteChannel(${ch.id}, '${ch.name}')">🗑</button>
      </div>
    </div>
  `).join('');
}

// ── Добавить / обновить канал ─────────────────────────────────────────────────
async function submitChannel() {
  const user = tg?.initDataUnsafe?.user;
  const usname   = document.getElementById('fUsname').value.trim().replace('@','');
  const category = document.getElementById('fCategory').value;
  const price24  = document.getElementById('fPrice24').value.trim();
  const priceAll = document.getElementById('fPriceAll').value.trim();

  if (!usname || !category) {
    showToast('⚠️ Заполните обязательные поля', 'error');
    return;
  }

  if (editingChannelId) {
    const data = await apiFetch(`/channels/${editingChannelId}`);
    const body = {
      name: data.name, usname, category,
      pricead_24: price24 || null, pricead_all: priceAll || null,
      owner_id: user?.id || 0
    };
    const result = await apiFetch(`/channels/${editingChannelId}`, {
      method: 'PUT', body: JSON.stringify(body)
    });
    if (result) { showToast('✅ Канал обновлён!', 'success'); resetForm(); renderManagePage(); loadStats(); }
    return;
  }

  showVerifyStep(usname, {
    usname, category,
    name: '',  // заполнится после верификации
    pricead_24: price24 || null,
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
          как администратора
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

  // Сохраняем данные канала во временную переменную
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

  if (!verify || !verify.verified) {
    btn.textContent = '🔍 Проверить';
    btn.disabled = false;
    showToast(verify?.error || '❌ Проверка не пройдена', 'error');
    return;
  }

  // Берём все данные из Telegram
  channelData.name       = verify.name || channelData.usname;  // ← название из Telegram
  channelData.subscribers = verify.subscribers || 0;
  channelData.avatar_url  = verify.avatar_url || null;

  const result = await apiFetch('/channels', {
    method: 'POST',
    body: JSON.stringify(channelData),
  });

  if (result) {
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
} 

// ── Редактировать канал ───────────────────────────────────────────────────────
async function editChannel(id) {
  const data = await apiFetch(`/channels/${id}`);
  if (!data) return;

  editingChannelId = id;
  document.getElementById('fName').value     = data.name || '';
  document.getElementById('fUsname').value   = data.usname || '';
  document.getElementById('fCategory').value = data.category || '';
  document.getElementById('fSubs').value     = data.subscribers || '';
  document.getElementById('fPrice24').value  = data.pricead_24 || '';
  document.getElementById('fPriceAll').value = data.pricead_all || '';

  document.getElementById('manageFormTitle').textContent = '✏️ Редактировать канал';
  document.getElementById('formSubmitBtn').textContent   = '💾 Сохранить';
  document.getElementById('formCancelBtn').style.display = 'block';

  // Скролл к форме
  document.getElementById('manageFormCard').scrollIntoView({ behavior: 'smooth' });
  if (tg) tg.HapticFeedback?.impactOccurred('medium');
}

// ── Удалить канал ─────────────────────────────────────────────────────────────
async function deleteChannel(id, name) {
  if (!confirm(`Удалить канал "${name}"?`)) return;
  const result = await apiFetch(`/channels/${id}`, { method: 'DELETE' });
  if (result) {
    showToast('🗑 Канал удалён', 'success');
    renderManagePage();
    loadStats();
  }
}

function resetForm() {
  editingChannelId = null;

  // Используем ?. перед .value, чтобы скрипт не падал, если поля нет на странице
  if (document.getElementById('fName'))      document.getElementById('fName').value = '';
  if (document.getElementById('fUsname'))    document.getElementById('fUsname').value = '';
  if (document.getElementById('fCategory'))   document.getElementById('fCategory').value = '';
  if (document.getElementById('fSubs'))      document.getElementById('fSubs').value = '';
  if (document.getElementById('fPrice24'))   document.getElementById('fPrice24').value = '';
  if (document.getElementById('fPriceAll'))  document.getElementById('fPriceAll').value = '';

  // Для текстового контента и стилей тоже добавляем проверки
  const title = document.getElementById('manageFormTitle');
  if (title) title.textContent = '➕ Добавить канал';

  const submitBtn = document.getElementById('formSubmitBtn');
  if (submitBtn) submitBtn.textContent = '➕ Добавить';

  const cancelBtn = document.getElementById('formCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

// ── Сброс формы ──────────────────────────────────────────────────────────────
// function resetForm() {
//   editingChannelId = null;
//   document.getElementById('fName').value     = '';
//   document.getElementById('fUsname').value   = '';
//   document.getElementById('fCategory').value = '';
//   document.getElementById('fSubs').value     = '';
//   document.getElementById('fPrice24').value  = '';
//   document.getElementById('fPriceAll').value = '';
//   document.getElementById('manageFormTitle').textContent = '➕ Добавить канал';
//   document.getElementById('formSubmitBtn').textContent   = '➕ Добавить';
//   document.getElementById('formCancelBtn').style.display = 'none';
// }

// ── FAV ───────────────────────────────────────────────────────────────────────
function toggleFav(id, btn) {
  const idx = favorites.indexOf(id);
  if (idx === -1) {
    favorites.push(id);
    btn.textContent = '❤️';
    showToast('❤️ Добавлено в избранное', 'success');
  } else {
    favorites.splice(idx, 1);
    btn.textContent = '🤍';
    showToast('🤍 Удалено из избранного');
  }
  localStorage.setItem('adhub_favs', JSON.stringify(favorites));
  sendToBot({action: 'favorite', channel_id: id});
}

function toggleFavPage() {
  showFavPage = !showFavPage;
  showPage('home');
  const list = document.getElementById('homeList');
  if (showFavPage) {
    document.getElementById('favBtn').style.color = '#f87171';
    const favChs = CHANNELS.filter(c => favorites.includes(c.id));
    list.innerHTML = favChs.length ? favChs.map(buildCard).join('') : emptyState('Избранное пусто', 'Добавляйте каналы нажав 🤍');
  } else {
    document.getElementById('favBtn').style.color = '';
    renderHome('all');
  }
}

function clearFavorites() {
  favorites = [];
  localStorage.removeItem('adhub_favs');
  showToast('🗑 Избранное очищено');
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openModal(id) {
  const ch = CHANNELS.find(c => c.id === id);
  if (!ch) return;
  const isFav = favorites.includes(ch.id);
  const price24str  = ch.price24  ? `$${ch.price24}` : '—';
  const priceAllStr = ch.priceAll ? `$${ch.priceAll}` : '—';
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
        <div class="modal-stat-val">${ch.er}%</div>
        <div class="modal-stat-key">ER (вовлечённость)</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-val">${price24str}</div>
        <div class="modal-stat-key">Реклама 24ч</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-val">${priceAllStr}</div>
        <div class="modal-stat-key">Реклама навсегда</div>
      </div>
    </div>
    ${ch.desc ? `<p class="modal-desc">${ch.desc}</p>` : ''}
    <div class="modal-btns">
      <button class="modal-btn modal-btn-primary" onclick="contactChannel(${ch.id});closeModal()">📩 Написать администратору</button>
      ${ch.collab?`<button class="modal-btn modal-btn-secondary" onclick="requestCollab(${ch.id});closeModal()">🤝 Предложить взаимопиар</button>`:''}
      <button class="modal-btn modal-btn-secondary" onclick="toggleFavModal(${ch.id},this)">${isFav?'❤️ В избранном':'🤍 Добавить в избранное'}</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('open');
  if (tg) tg.HapticFeedback?.impactOccurred('medium');
}

function closeModal(e) {
  if (!e || e.target === document.getElementById('modalOverlay')) {
    document.getElementById('modalOverlay').classList.remove('open');
  }
}

function toggleFavModal(id, btn) {
  const idx = favorites.indexOf(id);
  if (idx === -1) { favorites.push(id); btn.textContent = '❤️ В избранном'; showToast('❤️ Добавлено', 'success'); }
  else { favorites.splice(idx,1); btn.textContent = '🤍 Добавить в избранное'; showToast('🤍 Удалено'); }
  localStorage.setItem('adhub_favs', JSON.stringify(favorites));
}

// ── Contact / Collab ──────────────────────────────────────────────────────────
function contactChannel(id) {
  const ch = CHANNELS.find(c => c.id === id);
  if (!ch) return;
  sendToBot({ action: 'contact', channel_id: id });
  showToast(`📩 Запрос к ${ch.name} отправлен!`, 'success');
  if (tg) tg.HapticFeedback?.notificationOccurred('success');
}

function requestCollab(id) {
  const ch = CHANNELS.find(c => c.id === id);
  if (!ch) return;
  sendToBot({ action: 'collab', channel_id: id });
  showToast(`🤝 Запрос на ВП с ${ch.name} отправлен!`, 'success');
  if (tg) tg.HapticFeedback?.notificationOccurred('success');
}

// ── Donate ────────────────────────────────────────────────────────────────────
function selectAmount(val, el) {
  document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  const customRow = document.getElementById('customAmountRow');
  if (val === 'custom') {
    customRow.style.display = 'flex';
    selectedAmount = null;
    document.getElementById('donateBtnAmount').textContent = 'Stars';
  } else {
    customRow.style.display = 'none';
    selectedAmount = val;
    document.getElementById('donateBtnAmount').textContent = val + ' Stars';
  }
}

function sendDonate() {
  let amount = selectedAmount;
  if (!amount) {
    amount = parseInt(document.getElementById('customInput').value);
    if (!amount || amount < 1 || amount > 10000) {
      showToast('⚠️ Введите корректную сумму (1–10000)', 'error');
      return;
    }
  }
  sendToBot({ action: 'donate', amount });
  showToast(`💎 Спасибо за ${amount} Stars! ❤️`, 'success');
  if (tg) tg.HapticFeedback?.notificationOccurred('success');
}

// ── Settings ──────────────────────────────────────────────────────────────────
const settings = JSON.parse(localStorage.getItem('adhub_settings') || '{"notifNew":true,"notifCollab":true,"notifPrice":false}');

function initSettings() {
  const user = tg?.initDataUnsafe?.user;
  document.getElementById('profileName').textContent = user ? (user.first_name + (user.last_name ? ' ' + user.last_name : '')) : 'Пользователь';
  document.getElementById('profileId').textContent = user ? `ID: ${user.id} · @${user.username || '—'}` : 'Открыто в браузере';
  Object.keys(settings).forEach(k => {
    const el = document.getElementById(k);
    if (el) el.classList.toggle('on', !!settings[k]);
  });
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
