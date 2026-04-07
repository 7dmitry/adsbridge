import asyncio, logging, json, os, random
from datetime import datetime
from aiogram import Bot, Dispatcher, types, F
from aiogram.types import (
    ReplyKeyboardMarkup, KeyboardButton, WebAppInfo,
    InlineKeyboardMarkup, InlineKeyboardButton,
)
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.utils.keyboard import InlineKeyboardBuilder
from dotenv import load_dotenv
from aiogram.client.bot import DefaultBotProperties
from aiogram.enums import ParseMode
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import psycopg2

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

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

async def fetch_channel_info(usname: str):
    """Возвращает (subscribers, avatar_url, name) или (None, None, None)."""
    try:
        chat = await bot.get_chat('@' + usname)
        name = chat.title
        avatar_url = None
        if chat.photo:
            file = await bot.get_file(chat.photo.big_file_id)
            avatar_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file.file_path}"
        subs = await bot.get_chat_member_count('@' + usname)
        logger.info(f"✅ @{usname} → {subs} подп., название: {name}")
        return subs, avatar_url, name
    except Exception as e:
        logger.warning(f"Ошибка получения инфо @{usname}: {e}")
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

# ── /start ────────────────────────────────────────────────────────────────────
@dp.message(CommandStart())
async def cmd_start(msg: types.Message):
    ensure_user(msg.from_user)
    count = get_channels_count()
    await msg.answer(
        f"👋 Привет, <b>{msg.from_user.first_name}</b>!\n\n"
        "🚀 <b>AdsWay</b> — каталог Telegram-каналов для:\n"
        "• 📢 Покупки рекламы у проверенных авторов\n"
        "• 🤝 Взаимного пиара между каналами\n"
        "• 📊 Анализа аудитории и ER\n\n"
        f"📺 В каталоге <b>{count} каналов</b>\n\n"
        "📢 Канал: @AdsWay_Official\n"
        "💬Чат: @AdsWay_Community",
    )

# ── /update_subs — ручное обновление (только для админа) ─────────────────────
@dp.message(Command("update_subs"))
async def cmd_update_subs(msg: types.Message):
    if msg.from_user.id != ADMIN_ID:
        return
    await msg.answer("🔄 Запускаю обновление подписчиков...")
    await update_all_subscribers()

# ── Запуск ────────────────────────────────────────────────────────────────────
async def main():
    # Планировщик: каждые 24-72 часа (1-3 дня)
    # Интервал выбирается случайно при каждом запуске
    interval_hours = random.randint(24, 72)
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
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())

db.close()