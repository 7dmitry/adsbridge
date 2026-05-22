from email import message
import asyncio, logging, json, os, random
from datetime import datetime
from aiogram import Bot, Dispatcher, types, F
from aiogram.types import (
    ReplyKeyboardMarkup, KeyboardButton, WebAppInfo,
    InlineKeyboardMarkup, InlineKeyboardButton,
)
from aiogram.filters import Command, CommandStart
from aiogram.filters.chat_member_updated import ChatMemberUpdatedFilter, IS_NOT_MEMBER, ADMINISTRATOR
from aiogram.types import ChatMemberUpdated
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.utils.keyboard import InlineKeyboardBuilder
from dotenv import load_dotenv
from aiogram.client.bot import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram import F, Router, types
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import psycopg2
import json

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)
router = Router()

BOT_TOKEN    = os.getenv("BOT_TOKEN")
WEBAPP_URL   = os.getenv("WEBAPP_URL")
ADMIN_ID     = int(os.getenv("ADMIN_ID"))
DATABASE_URL = os.getenv("DATABASE_URL")
USER_URL     = os.getenv("USER_URL")
PASSWORD     = os.getenv("PASSWORD")
DB_NAME      = os.getenv("DB_NAME")
DB_USER      = os.getenv("DB_USER")
DB_PASSWORD  = os.getenv("DB_PASSWORD")

bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp  = Dispatcher(storage=MemoryStorage())

DATABASE_URL = os.getenv("DATABASE_URL")
db = psycopg2.connect(DATABASE_URL, sslmode='require')
c = db.cursor()
db.autocommit = True
logger.info("БД подключена успешно")

# ── Хранилище пользователей (в памяти) ───────────────────────────────────────
users_db = {}

def ensure_user(user):
    uid = user.id
    # Сохраняем в памяти
    if uid not in users_db:
        users_db[uid] = {
            "id":         uid,
            "username":   user.username or "",
            "first_name": user.first_name or "",
            "joined":     datetime.now().isoformat(),
        }
    # Сохраняем в БД
    try:
        c.execute("""
            INSERT INTO users (id, username, first_name, last_name)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
            SET username = EXCLUDED.username,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name
        """, (
            uid,
            user.username or "",
            user.first_name or "",
            user.last_name or "",
        ))
    except Exception as e:
        logger.warning(f"Ошибка сохранения пользователя: {e}")
    return users_db[uid]

def get_channels_count():
    try:
        c.execute("SELECT COUNT(*) FROM channels")
        return c.fetchone()[0]
    except Exception:
        return 0

def get_user_channels(user_id):
    try:
        c.execute("""
            SELECT ch.* FROM channels ch
            JOIN user_admin ua ON ch.id = ua.channel_id
            WHERE ua.user_id = %s
        """, (user_id,))
        return c.fetchall()
    except Exception:
        return []

def _chat_id(usname: str):
    """Возвращает chat_id для Telegram API: числовой ID как int, публичный — '@username'."""
    s = usname.strip()
    if s.lstrip('-').isdigit():   # приватный: '-1001234567890' или '1001234567890'
        return int(s)
    return '@' + s.lstrip('@')

async def fetch_channel_info(usname: str):
    """Возвращает (subscribers, avatar_url, name) или (None, None, None)."""
    try:
        chat_id = _chat_id(usname)
        chat = await bot.get_chat(chat_id)
        name = chat.title
        avatar_url = None
        if chat.photo:
            file = await bot.get_file(chat.photo.big_file_id)
            avatar_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file.file_path}"
        subs = await bot.get_chat_member_count(chat_id)
        logger.info(f"✅ {usname} → {subs} подп., название: {name}")
        return subs, avatar_url, name
    except Exception as e:
        logger.warning(f"Ошибка получения инфо {usname}: {e}")
        return None, None, None

async def update_channel_subscribers(channel_id: int, usname: str):
    subs, avatar, name = await fetch_channel_info(usname)
    if subs is not None:
        c.execute(
            """UPDATE channels
               SET subscribers = %s, avatar_url = %s, name = %s
               WHERE id = %s""",
            (subs, avatar, name, channel_id)
        )
        logger.info(f"✅ @{usname} обновлён")
    return subs

async def update_all_subscribers():
    logger.info("🔄 Запуск обновления подписчиков всех каналов...")
    try:
        c.execute("SELECT id, usname FROM channels")
        channels = c.fetchall()
    except Exception as e:
        logger.error(f"Ошибка получения каналов: {e}")
        return

    updated = 0
    failed  = 0
    for ch_id, usname in channels:
        subs = await update_channel_subscribers(ch_id, usname)
        if subs is not None:
            updated += 1
        else:
            failed += 1
        await asyncio.sleep(0.5)

    logger.info(f"✅ Обновлено: {updated}, ❌ Ошибок: {failed}")

    try:
        await bot.send_message(
            ADMIN_ID,
            f"🔄 <b>Обновление подписчиков завершено</b>\n\n"
            f"✅ Обновлено: {updated}\n"
            f"❌ Ошибок: {failed}\n"
            f"🕐 {datetime.now().strftime('%d.%m.%Y %H:%M')}"
        )
    except Exception:
        pass


# ── Категории ─────────────────────────────────────────────────────────────────
CAT = {
    "tech":"🖥️ Технологии","business":"💼 Бизнес","games":"🎮 Игры",
    "art":"🎨 Творчество","news":"📰 Новости",
    "finance":"📈 Финансы","entertainment":"🎬 Развлечения",
    "edu":"🎓 Образование","other":"🌍 Другое",
}

# ── Клавиатуры ────────────────────────────────────────────────────────────────
# def kb_main():
#     return ReplyKeyboardMarkup(keyboard=[
#         [KeyboardButton(text="🌐 Открыть каталог", web_app=WebAppInfo(url=WEBAPP_URL))],
#     ], resize_keyboard=True)

def kb_categories():
    b = InlineKeyboardBuilder()
    for k,v in CAT.items():
        b.button(text=v, callback_data=f"addcat_{k}")
    b.adjust(2); return b.as_markup()

def kb_collab():
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✅ Да, открыт к ВП",  callback_data="addcol_yes"),
        InlineKeyboardButton(text="❌ Только реклама",    callback_data="addcol_no"),
    ]])

def kb_cancel():
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="❌ Отмена", callback_data="cancel")
    ]])

def kb_donate():
    b = InlineKeyboardBuilder()
    for a in [50, 100, 250, 500, 1000]:
        b.button(text=f"⭐ {a} Stars", callback_data=f"don_{a}")
    b.button(text="✏️ Своя сумма", callback_data="don_custom")
    b.adjust(3); return b.as_markup()

def kb_settings(uid):
    u = users_db.get(uid, {})
    notif = "ВКЛ ✅" if u.get("notifications", True) else "ВЫКЛ ❌"
    lang  = "🇷🇺 Русский" if u.get("lang","ru")=="ru" else "🇬🇧 English"
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"🔔 Уведомления: {notif}", callback_data="set_notif")],
        [InlineKeyboardButton(text=f"🌐 Язык: {lang}",         callback_data="set_lang")],
        [InlineKeyboardButton(text="🗑 Удалить мои каналы",    callback_data="set_delch")],
        [InlineKeyboardButton(text="📤 Экспорт данных",        callback_data="set_exp")],
    ])

# ── Вспомогательная функция ───────────────────────────────────────────────────
def get_user_data_text(owner_id: int):
    """Каналы и сетки пользователя owner_id — форматированный текст."""
    CURR      = {"RUB": "₽", "KZT": "₸", "TON": "ꘜ", "USD": "$", "STARS": "⭐️"}
    CURR_FULL = {
        "RUB":   "RUB ₽",
        "KZT":   "KZT ₸",
        "TON":   "TON ꘜ",
        "USD":   "USD $",
        "STARS": "Telegram Stars ⭐️",
    }

    def fmt_prices(p24, p48, p72, pall, sym):
        lines = []
        if p24  and p24  != "-": lines.append(f"💰 24ч: {p24}{sym}")
        if p48  and p48  != "-": lines.append(f"      48ч: {p48}{sym}")
        if p72  and p72  != "-": lines.append(f"      72ч: {p72}{sym}")
        if pall and pall != "-": lines.append(f"      ∞: {pall}{sym}")
        return "\n".join(lines)

    # Каналы + валюты владельца
    try:
        c.execute("""
            SELECT ch.name, ch.usname, ch.subscribers,
                   ch.pricead_24, ch.pricead_48, ch.pricead_72, ch.pricead_all,
                   COALESCE(u.currency_primary, 'RUB')     AS cur,
                   COALESCE(u.currency_extra,  '[]'::text) AS cur_extra
            FROM channels ch
            JOIN user_admin ua ON ch.id = ua.channel_id
            LEFT JOIN users u ON ch.owner_id = u.id
            WHERE ua.user_id = %s
            ORDER BY ch.subscribers DESC
        """, (owner_id,))
        channels = c.fetchall()
    except Exception:
        channels = []

    # Сетки
    try:
        c.execute(
            "SELECT * FROM channel_networks WHERE owner_id = %s ORDER BY created_at DESC",
            (owner_id,)
        )
        nets_raw  = c.fetchall()
        col_names = [d[0] for d in c.description]
        nets = [dict(zip(col_names, row)) for row in nets_raw]
        for net in nets:
            c.execute("""
                SELECT ch.name, ch.usname FROM channels ch
                JOIN network_channels nc ON ch.id = nc.channel_id
                WHERE nc.network_id = %s
            """, (net["id"],))
            net["channels"] = c.fetchall()
    except Exception:
        nets = []

    if not channels and not nets:
        return None

    # Собираем все виды оплаты пользователя (primary + extras) — один раз
    pay_set = []
    if channels:
        primary = channels[0][7]   # cur
        extras_raw = channels[0][8]  # cur_extra (JSON-строка или список)
        pay_set.append(primary)
        try:
            import json as _json
            extras = _json.loads(extras_raw) if isinstance(extras_raw, str) else (extras_raw or [])
            if isinstance(extras, list):
                for e in extras:
                    if e and e not in pay_set:
                        pay_set.append(e)
        except Exception:
            pass
    pay_str = ", ".join(CURR_FULL.get(c, c) for c in pay_set if c)

    text = "📋 Ваши каналы в AdsWay\n"
    if pay_str:
        text += f"💳 Способы оплаты: {pay_str}\n"
    text += "\n"

    for row in channels:
        name, usname, subs, p24, p48, p72, pall, cur, _ = row
        sym      = CURR.get(cur, "₽")
        is_priv  = str(usname).lstrip("-").isdigit()
        ref      = name if is_priv else f"{name} (@{usname})"
        subs_fmt = f"{subs or 0:,}".replace(",", "\u202f")

        text += f"📢 {ref}\n"
        text += f"👥 {subs_fmt} подписчиков\n"
        block = fmt_prices(p24, p48, p72, pall, sym)
        if block:
            text += block + "\n"
        text += "\n"

    if nets:
        text += "\n🗂 Ваши сетки каналов\n\n"
        for net in nets:
            sym = CURR.get(net.get("currency", "RUB"), "₽")
            text += f"🗂 {net['name']}\n"
            block = fmt_prices(
                net.get("pricead_24"), net.get("pricead_48"),
                net.get("pricead_72"), net.get("pricead_all"), sym
            )
            if block:
                text += block + "\n"
            ch_refs = [
                ch_name if str(ch_usname).lstrip("-").isdigit() else f"@{ch_usname}"
                for ch_name, ch_usname in net.get("channels", [])
            ]
            if ch_refs:
                text += f"📢 Каналы: {', '.join(ch_refs)}\n"
            text += "\n"

    return text


# ── /start ────────────────────────────────────────────────────────────────────
@dp.message(CommandStart())
async def cmd_start(msg: types.Message, command: CommandStart):
    ensure_user(msg.from_user)

    # Share deeplink: /start share_USER_ID
    args = command.args or ""
    if args.startswith("share_"):
        try:
            shared_uid = int(args.split("_", 1)[1])
        except (ValueError, IndexError):
            shared_uid = None
        if shared_uid:
            data_text = get_user_data_text(shared_uid)
            if data_text:
                await msg.answer(f"📢 Каналы и сетки пользователя:\n\n{data_text}")
            else:
                await msg.answer("У этого пользователя пока нет каналов в AdsWay.")
            return

    count = get_channels_count()

    user = msg.from_user
    username_str = f"@{user.username}" if user.username else "без username"
    await bot.send_message(
        1283231216,
        f"👤 <a href='tg://openmessage?user_id={user.id}' target='_blank'><b>Новый пользователь запустил бота!</b></a>\n\n"
        f"🆔 ID: <code>{user.id}</code>\n"
        f"👤 Имя: {user.first_name} {user.last_name or ''}\n"
        f"📎 Username: {username_str}\n"
    )
    
    await msg.answer(
        f"👋 Привет, <b>{msg.from_user.first_name}</b>!\n\n"
        "🚀 <b>AdsWay</b> — каталог Telegram-каналов для:\n"
        "• 📢 Покупки рекламы у проверенных авторов\n"
        "• 🤝 Взаимного пиара между каналами\n"
        "• 📊 Анализа аудитории и ER\n\n"
        f"📺 В каталоге <b>{count} каналов</b>\n"
        "Для открытия каталога нажми кнопку ниже(Открыть каталог✨)\n"
        "📋Инструкция по добавлению канала в каталог: https://t.me/AdsWay_Official/26\n\n"
        "📢 Канал: @AdsWay_Official\n"
        "💬Чат: @AdsWay_Community"
    )

# ── /update_subs — ручное обновление (только для админа) ─────────────────────
@dp.message(Command("update_subs"))
async def cmd_update_subs(msg: types.Message):
    if msg.from_user.id != ADMIN_ID:
        return
    await msg.answer("🔄 Запускаю обновление подписчиков...")
    await update_all_subscribers()

@dp.message(Command("up"))
async def cmd_up(message: types.Message):
    
    
    # chat = await bot.get_chat(7935048582)
    # username = chat.username
    # owner_id = 7935048582
    # text = '{owner_id}'
    text = "Перейдите на <a href='https://t.me/user?id=$7935048582'>Google</a> для поиска."
    await message.answer(text, parse_mode=ParseMode.HTML)
    
@router.message(F.web_app_data) # Фильтр ловит данные из Mini App
async def handle_webapp_data(message: types.Message):
    raw_data = message.web_app_data.data
    user = message.from_user
    username_str = f"@{user.username}" if user.username else "без username"

    await bot.send_message(
        1283231216,
        f"🌐 <b>Пользователь открыл Web App!</b>\n\n"
        f"👤 Имя: {user.first_name} {user.last_name or ''}\n"
    )

    try:
        data = json.loads(raw_data)
        name = data.get("name", "Неизвестно")
        await message.answer(f"Привет, {name}! Данные из приложения получены.")
    except json.JSONDecodeError:
        await message.answer(f"Получен текст: {raw_data}")
      
# ── Запуск ────────────────────────────────────────────────────────────────────
async def main():
    interval_hours = 8
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        update_all_subscribers,
        trigger='interval',
        hours=interval_hours,
        id='update_subs',
        replace_existing=True,
    )
    scheduler.start()
    logger.info(f"⏰ Планировщик запущен, интервал: каждые {interval_hours}ч")
    logger.info("🚀 AdsBridge Bot запущен")
    try:
        await dp.start_polling(
            bot,
            allowed_updates=["message", "callback_query", "chat_member", "my_chat_member"],
        )
    finally:
        scheduler.shutdown(wait=False)
        logger.info("🛑 Бот остановлен")

CAT_KEYS = {"tech", "business", "games", "art", "news", "finance", "entertainment", "edu", "other"}

@dp.message(Command("add"))
async def cmd_add_channel(msg: types.Message):
    if msg.from_user.id != ADMIN_ID:
        return await msg.answer("⛔ Нет доступа.")

    parts = msg.text.strip().split()
    if len(parts) != 4:
        return await msg.answer(
            "❌ Неверный формат.\n\n"
            "Используй: <code>/add @username ID_владельца категория</code>\n"
            "Пример: <code>/add @mychannel 123456789 tech</code>\n\n"
            "📂 Доступные категории:\n"
            "tech · business · games · art · news\n"
            "finance · entertainment · edu · other"
        )

    raw_usname = parts[1].lstrip('@')
    try:
        owner_id = int(parts[2])
    except ValueError:
        return await msg.answer("❌ ID владельца должен быть числом.")

    category = parts[3].lower()
    if category not in CAT_KEYS:
        return await msg.answer(
            f"❌ Неизвестная категория: <code>{category}</code>\n\n"
            "📂 Доступные:\n"
            "tech · business · games · art · news\n"
            "finance · entertainment · edu · other"
        )

    await msg.answer(f"🔍 Получаю инфо о канале @{raw_usname}...")

    subs, avatar_url, name = await fetch_channel_info(raw_usname)

    if subs is None:
        name = raw_usname
        subs = 0
        avatar_url = None
        fallback_warn = (
            "\n⚠️ <i>Не удалось получить данные канала автоматически.\n"
            "Подписчики и аватар не заполнены — обнови вручную позже.</i>"
        )
    else:
        fallback_warn = ""

    try:
        c.execute("""
        INSERT INTO channels (usname, name, subscribers, avatar_url, owner_id,
                            pricead_24, pricead_all, category, collab)
        VALUES (%s, %s, %s, %s, %s, NULL, NULL, %s, FALSE)
        ON CONFLICT (usname) DO UPDATE
            SET name        = EXCLUDED.name,
                subscribers = EXCLUDED.subscribers,
                avatar_url  = EXCLUDED.avatar_url,
                owner_id    = EXCLUDED.owner_id,
                category    = EXCLUDED.category
        RETURNING id
    """, (raw_usname, name, subs, avatar_url, owner_id, category))
        channel_id = c.fetchone()[0]

        c.execute("""
            INSERT INTO user_admin (user_id, channel_id)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING
        """, (owner_id, channel_id))

        await msg.answer(
            f"✅ <b>Канал добавлен!</b>\n\n"
            f"📢 Название: <b>{name}</b>\n"
            f"🔗 Username: @{raw_usname}\n"
            f"👥 Подписчики: <b>{subs:,}</b>\n"
            f"👤 Владелец ID: <code>{owner_id}</code>\n"
            f"🆔 ID в БД: <code>{channel_id}</code>\n"
            f"📂 Категория: <b>{CAT[category]}</b>\n"
            f"💰 Цена: не указана"
            + fallback_warn
        )

    except Exception as e:
        logger.error(f"Ошибка добавления канала: {e}")
        await msg.answer(f"❌ Ошибка при записи в БД:\n<code>{e}</code>")


# ── Бот добавлен в канал как администратор ────────────────────────────────────
@dp.my_chat_member(
    ChatMemberUpdatedFilter(member_status_changed=IS_NOT_MEMBER >> ADMINISTRATOR)
)
async def on_bot_added_as_admin(event: ChatMemberUpdated):
    if event.chat.type != 'channel':
        return

    channel_id   = event.chat.id
    channel_name = event.chat.title or ''
    user_id      = event.from_user.id

    try:
        c.execute("""
            INSERT INTO pending_channel_ids (user_id, chat_id, channel_name, created_at)
            VALUES (%s, %s, %s, NOW())
        """, (user_id, str(channel_id), channel_name))
        logger.info(f"✅ Бот добавлен в канал '{channel_name}' ({channel_id}) пользователем {user_id}")
    except Exception as e:
        logger.error(f"Ошибка записи pending_channel_ids: {e}")
        # Fallback: пробуем без channel_name (старая схема БД)
        try:
            c.execute("""
                INSERT INTO pending_channel_ids (user_id, chat_id, created_at)
                VALUES (%s, %s, NOW())
            """, (user_id, str(channel_id)))
            logger.info(f"✅ Записано (fallback без channel_name): {channel_id} для {user_id}")
        except Exception as e2:
            logger.error(f"Fallback тоже не удался: {e2}")
            return

    try:
        await bot.send_message(
            user_id,
            f"✅ Канал <b>{channel_name}</b> получен!\n"
            f"Вернитесь в AdsWay — страница обновится автоматически.",
        )
    except Exception:
        pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        db.close()
        logger.info("🔌 Соединение с БД закрыто")