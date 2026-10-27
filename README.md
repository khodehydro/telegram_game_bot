# 🎴 ربات بازی‌های کارتی ایرانی (تلگرام)

**ربات:** [@hydrogameofficialbot](https://t.me/hydrogameofficialbot)

ربات تلگرامی برای بازی **پاسور** و **حکم** — هم داخل گروه، هم در میز خصوصی با لینک دعوت.
نوشته‌شده با **Python + aiogram 3**، پایگاه‌داده **PostgreSQL (Supabase)** یا SQLite، و موتور بازی کاملاً مستقل از تلگرام (قابل تست).

---

## 📍 وضعیت پروژه

| بخش | وضعیت |
|---|---|
| موتور پاسور و حکم | ✅ کامل و تست‌شده (دو پیاده‌سازی: Python و TypeScript) |
| رابط تلگرام (گروه + میز خصوصی + پیوی برگ‌ها) | ✅ کامل در هر دو نسخه |
| دیتابیس Supabase | ✅ جدول‌ها ساخته شده + کاربر اختصاصی `bot_app` |
| نسخه‌ی **Cloudflare Workers** (بدون سرور) | ✅ آماده در پوشه‌ی `worker/` — فقط `wrangler deploy` |
| تست‌ها | ✅ ۵۵ تست پایتون + ۴۱ تست TypeScript، `ruff` و `tsc` تمیز |
| اجرا | ⏳ یک بار باید روی هاست خودتان دیپلوی شود (این سندباکس به `api.telegram.org` دسترسی ندارد) |

دو مسیر استقرار دارید — هر کدام را خواستید:

| | ☁️ Cloudflare Workers | 🖥 سرور / Railway / VPS |
|---|---|---|
| فایل‌های راهنما | [`worker/README.md`](worker/README.md) | همین فایل، بخش «استقرار آنلاین» |
| دیتابیس | D1 (داخل Cloudflare) | Supabase / Postgres |
| هزینه | پلن رایگان | پلن رایگان یا سرور |
| حالت اجرا | webhook | polling یا webhook |

> ⚠️ **نکته امنیتی:** توکن ربات را در چت نفرستید. اگر جایی منتشر شد، در [@BotFather](https://t.me/BotFather) → `/revoke` توکن را عوض کنید.

---

## ✨ امکانات

| | |
|---|---|
| 🎣 **پاسور** | ۲ تا ۴ نفره (۴ نفره = دو تیم)، برداشت با جمع ۱۱، شاه/بی‌بی/سرباز، سور، هفت‌خاج، بازی تا ۶۲ امتیاز |
| 👑 **حکم** | ۴ نفره و تیمی، انتخاب خال حکم توسط حاکم، ۷ دست، کوت و حاکم‌کوت، بازی تا ۷ امتیاز |
| 🪑 **میز گروهی** | `/new pasur` داخل گروه؛ بازیکنان با دکمه «می‌نشینم» یا `/join` |
| 🔗 **میز خصوصی** | ساخت میز در چت خصوصی + لینک دعوت (`t.me/bot?start=join_…`) |
| 🖐 **برگ مخفی** | برگ‌های هر بازیکن فقط در پیوی خودش نمایش داده می‌شود |
| ⏱ **تایمر نوبت** | اگر بازیکنی حرکت نکند، ربات خودش بهترین حرکت را انجام می‌دهد |
| 📊 **آمار و رتبه‌بندی** | `/stats` و `/top` — برد، باخت، نرخ برد و امتیاز کل |
| ♻️ **ادامه پس از ری‌استارت** | وضعیت همه‌ی میزها در دیتابیس ذخیره می‌شود |
| 🌐 **polling و webhook** | هر دو حالت پشتیبانی می‌شود (Railway/Fly/VPS) |

---

## 🃏 قوانین پیاده‌شده

<details>
<summary><b>پاسور</b></summary>

- ۵۲ برگ، ۲ تا ۴ نفر؛ در حالت ۴ نفره یارها روبه‌روی هم می‌نشینند (۰ و ۲ در برابر ۱ و ۳).
- پخش: ۴ برگ به هر نفر + ۴ برگ رو به زمین؛ بیش از یک سرباز یا بیش از دو بی‌بی/شاه روی زمین ⇒ پخش دوباره. سرباز تکی روی زمین در پاکت برگردانده می‌شود.
- برداشت: شاه شاه را، بی‌بی بی‌بی را، سرباز همه‌ی برگ‌های عددی و سربازها را (نه شاه/بی‌بی)، و برگ‌های عددی هر ترکیبی که جمعش با آن‌ها ۱۱ شود (آس = ۱).
- **سور**: خالی‌کردن کامل زمین با برگ غیرسرباز ⇒ ۵ امتیاز. در پخش آخر و زمانی که تیم ۵۰ امتیاز یا بیشتر دارد حساب نمی‌شود؛ سور حریف را هم باطل می‌کند.
- آخرین برداشت‌کننده، برگ‌های باقی‌مانده روی زمین را می‌برد.
- امتیاز: هر آس ۱، هر سرباز ۱، ۲♣ ۲، ۱۰♦ ۳، ۷ برگ یا بیشتر گشنیز ۷، هر سور ۵. رسیدن به ۶۲ (بدون حالت تساوی) = برد.
</details>

<details>
<summary><b>حکم</b></summary>

- دقیقاً ۴ نفر، دو تیم دو نفره.
- حاکم ۵ برگ می‌گیرد، **خال حکم** را انتخاب می‌کند و بعد ۸ برگ بعدی پخش می‌شود.
- باید از خال زمینه بازی کرد (اگر ندارید هر برگی). حکم از همه بالاتر است.
- اولین تیم به ۷ دست: برد عادی ۱، کوت (۷–۰) ۲، حاکم‌کوت ۳ امتیاز.
- بازی تا ۷ امتیاز؛ تیم برنده حاکم بعدی را تعیین می‌کند.
</details>

---

## 🚀 راه‌اندازی

### ۱) ساخت ربات
1. در تلگرام به [@BotFather](https://t.me/BotFather) پیام دهید.
2. `/newbot` → نام و یوزرنیم بدهید → **توکن** را کپی کنید.
3. توصیه: `/setcommands` و `/setprivacy off` (اگر می‌خواهید در گروه به همه‌ی پیام‌ها دسترسی داشته باشد؛ برای این ربات لازم نیست).

### ۲) نصب

```bash
git clone https://github.com/khodehydro/telegram_game_bot.git
cd telegram_game_bot

python -m venv .venv
source .venv/bin/activate        # ویندوز: .venv\Scripts\activate
pip install -r requirements.txt

# فایل .env از قبل با BOT_TOKEN و DATABASE_URL آماده است
# (اگر نبود: cp .env.example .env و مقادیر را بگذارید)
python -m bot.main
```

بدون دیتابیس هم بالا می‌آید: به‌صورت پیش‌فرض از `sqlite:///data/gamebot.db` استفاده می‌کند.

### ۳) اتصال به Supabase

1. پروژه را در Supabase بسازید (یا پروژه‌ی موجود را از حالت pause خارج کنید).
2. مسیر **Project Settings → Database → Connection string → URI** (حالت *Session pooler* برای هاست‌های serverless بهتر است).
3. رمز دیتابیس را جای `YOUR-PASSWORD` بگذارید:

```env
DATABASE_URL=postgresql://postgres.xxxxxxxx:YOUR-PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

4. `python -m bot.main` — جدول‌ها خودشان ساخته می‌شوند (`users`, `game_sessions`, `match_results`).
   اگر خواستید دستی بسازید: `scripts/schema.sql` را در SQL Editor اجرا کنید.

> 🔒 هیچ‌وقت `.env` را کامیت نکنید؛ در `.gitignore` هست.

---

## ☁️ استقرار بدون سرور روی Cloudflare

اگر نمی‌خواهید سرور نگه دارید، نسخه‌ی **Cloudflare Workers** در پوشه‌ی [`worker/`](worker/README.md) آماده است:
همان پاسور و حکم، با دیتابیس **D1** و تایمر نوبت با **Cron Trigger** — روی پلن رایگان.

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create telegram-card-games   # database_id را در wrangler.jsonc بگذارید
npx wrangler d1 execute telegram-card-games --remote --file=./schema.sql
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put SETUP_TOKEN
npx wrangler deploy
curl "https://telegram-game-bot.<your-subdomain>.workers.dev/setup?token=<SETUP_TOKEN>"
```

جزئیات کامل: [`worker/README.md`](worker/README.md) — و برای اتصال از پنل: [`worker/DEPLOY-CLOUDFLARE.md`](worker/DEPLOY-CLOUDFLARE.md)

---
## 🌍 استقرار روی سرور (پایتون)

### ۰) بررسی پیش‌پرواز

قبل از هر کاری، روی ماشینی که اینترنت آزاد دارد:

```bash
cp .env.example .env      # BOT_TOKEN و DATABASE_URL را بگذارید
python -m scripts.doctor
```

اگر هم توکن و هم دیتابیس ✅ شدند، ربات آماده است:

```bash
python -m bot.main
```

### ۱) Railway (سریع‌ترین)

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → همین ریپو.
2. Railway خودش `Dockerfile` را می‌شناسد (`railway.json` هم موجود است).
3. در تب **Variables** این‌ها را بگذارید:
   ```
   BOT_TOKEN=...
   DATABASE_URL=postgresql://bot_app.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
4. در تب **Settings → Networking** یک دامنه بگیرید؛ ربات خودش `RAILWAY_PUBLIC_DOMAIN` را می‌خواند و وبهوک را ست می‌کند.
5. Deploy → لاگ باید بگوید `webhook server listening on 0.0.0.0:8080`.

### ۲) Fly.io

```bash
fly launch --no-deploy --copy-config      # از fly.toml استفاده می‌کند
fly secrets set BOT_TOKEN="..." DATABASE_URL="..."
fly deploy
fly logs
```

### ۳) VPS (پایدارترین)

```bash
ssh root@SERVER
apt update && apt install -y python3.12 python3.12-venv git
git clone https://github.com/khodehydro/telegram_game_bot.git /opt/telegram_game_bot
cd /opt/telegram_game_bot
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env && nano .env       # BOT_TOKEN و DATABASE_URL
.venv/bin/python -m scripts.doctor
.venv/bin/python -m bot.main            # تست دستی
```

سپس سرویس systemd:

```ini
[Unit]
Description=Telegram Card Games Bot
After=network.target

[Service]
WorkingDirectory=/opt/telegram_game_bot
ExecStart=/opt/telegram_game_bot/.venv/bin/python -m bot.main
Restart=always
EnvironmentFile=/opt/telegram_game_bot/.env

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now cardbot
journalctl -u cardbot -f
```

### ۴) Docker (هر جا)

```bash
docker compose up -d --build
docker compose logs -f
```

### نکات مهم

- در **polling** نیازی به دامنه نیست؛ در **webhook** دامنه‌ی https لازم است. ربات روی Render/Railway/Koyeb/Fly خودش آدرس را تشخیص می‌دهد.
- اگر سرور داخل ایران است، باید به `api.telegram.org` دسترسی داشته باشد (فیلتر است) — وگرنه از VPS خارج استفاده کنید.
- سرویس رایگان Render بعد از بی‌کاری می‌خوابد؛ برای ربات ۲۴ساعته پلن paid یا VPS/Koyeb بهتر است.
- `/health` برای healthcheck آماده است.

---

## 🕹 نحوه‌ی بازی

**در گروه**

```
/new pasur      ← ساخت میز پاسور
/new hokm       ← ساخت میز حکم
/join           ← نشستن سر میز
/cancel         ← لغو میز
```

**در چت خصوصی**

```
/start          ← منوی اصلی
/new pasur      ← ساخت میز خصوصی + گرفتن لینک دعوت
```

سپس سازنده دکمه‌ی **▶️ شروع بازی** را می‌زند. برگ‌های هر بازیکن در پیوی او می‌آید؛ با زدن روی برگ، بازی انجام می‌شود. اگر با یک برگ چند ترکیب برداشت ممکن باشد، ربات گزینه‌ها را نشان می‌دهد.

> ⚠️ هر بازیکن باید یک بار ربات را در چت خصوصی استارت کند تا بتواند برگ‌هایش را ببیند.

---

## 🧱 ساختار پروژه

```
worker/                   # نسخه‌ی Cloudflare Workers (TypeScript)
├── src/
│   ├── index.ts          # fetch / webhook / cron
│   ├── handlers.ts       # دستورها و دکمه‌ها
│   ├── service.ts        # منطق میز و رندر
│   ├── storage.ts        # D1
│   ├── render.ts
│   └── games/            # پورت پاسور و حکم
├── schema.sql
├── wrangler.jsonc
└── tests/

bot/                      # نسخه‌ی پایتون (aiogram 3)
├── cards.py              # کارت، خال، رندر فارسی
├── config.py             # تنظیمات از .env
├── main.py               # اجرای polling / webhook + تایمر نوبت‌ها
├── service.py            # اتصال موتور بازی ↔ تلگرام ↔ دیتابیس
├── render.py             # متن‌ها و کیبوردهای فارسی
├── db/
│   ├── models.py         # users / game_sessions / match_results
│   └── storage.py        # لایه‌ی async (SQLite یا Postgres)
├── games/
│   ├── base.py           # قرارداد موتور بازی
│   ├── pasur.py          # موتور کامل پاسور
│   ├── hokm.py           # موتور کامل حکم
│   └── registry.py
└── handlers/             # /start, /new, دکمه‌ها, آمار
```

موتورهای بازی هیچ وابستگی‌ای به تلگرام ندارند و وضعیتشان یک دیکشنری JSON است؛ به همین دلیل تست‌پذیر و قابل ذخیره در دیتابیس‌اند.

---

## 🧪 تست

```bash
# نسخه‌ی پایتون
pip install -r requirements-dev.txt
python -m pytest        # ۵۵ تست: موتورها، رندر، دیتابیس و یک بازی کامل end-to-end
ruff check .

# نسخه‌ی Cloudflare
cd worker
npm install
npm test                # ۴۱ تست: موتورها، رندر، سرویس، D1 و تایمرها
npm run typecheck
```

تست end-to-end با یک Bot API تقلبی اجرا می‌شود، چون سندباکس به `api.telegram.org` دسترسی ندارد؛ بنابراین کل مسیر (آپدیت تلگرام → هندلر → موتور → دیتابیس) بدون شبکه تست می‌شود.

---

## 🗺 نقشه‌ی راه

- [ ] شلم (Shelem)
- [ ] رامی / چهاربرگ
- [ ] حالت تیمی سفارشی و انتخاب یار
- [ ] جدول رتبه‌بندی هر گروه
- [ ] Web App برای دیدن میز روی موبایل
- [ ] پشتیبانی از چند میز هم‌زمان در یک گروه
