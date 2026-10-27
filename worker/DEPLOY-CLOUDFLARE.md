# 🚀 اتصال ریپو به Cloudflare و دیپلوی از پنل (Workers Builds)

این راهنما برای وقتی است که می‌خواهید در پنل Cloudflare یک Worker بسازید، ریپوی GitHub را وصل کنید و با هر `push` خودکار دیپلوی شود.

> ## ⚠️ پاسخ کوتاه به سؤال «وبهوک چی وارد کنم؟»
>
> در مسیر **Workers & Pages → Create → Connect to Git** کلادفلر **هیچ فیلد Webhook از شما نمی‌خواهد**.
> کلادفلر از طریق **GitHub App** خودش به ریپو دسترسی می‌گیرد (یک بار Authorize می‌کنید) و با هر push بیلد می‌شود.
>
> - اگر جایی از شما **Webhook URL** می‌خواهد، یعنی اشتباهاً وارد ساخت دستی **GitHub App** شده‌اید (Settings → Developer settings → GitHub Apps → New GitHub App). آن مسیر لازم نیست؛ برگردید.
> - وبهوک **تلگرام** را هم دستی وارد نمی‌کنید — خود Worker با یک بار صدا زدن `/setup` آن را ثبت می‌کند (پایین توضیح داده شده).

---

## ۰) پیش‌نیاز: کد روی شاخه‌ی درست

کد پروژه روی شاخه‌ی `arena/3f6c6652-telegram-game-bot` است و `main` هنوز خالی است.
یا PR را مرج کنید تا کد روی `main` بیاید، یا در Cloudflare همان شاخه را به‌عنوان **Production branch** انتخاب کنید.

---

## ۱) ساخت دیتابیس D1 (قبل از اتصال)

پنل → **Storage & Databases → D1 SQL Database → Create**

| فیلد | مقدار |
|---|---|
| Name | `telegram-card-games` |

بعد از ساخت، وارد دیتابیس شوید و **Database ID** را کپی کنید (شبیه `1a2b3c4d-....-....`).

سپس در ریپو، فایل `worker/wrangler.jsonc` را باز کنید و این خط را عوض کنید:

```jsonc
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"   →   "database_id": "1a2b3c4d-....-...."
```

> بدون این کار، دیپلوی با خطای `invalid database_id` شکست می‌خورد.

---

## ۲) ساخت Worker و اتصال GitHub

پنل → **Workers & Pages → Create application → Continue with Git** (یا **Import a repository**)

1. **Connect GitHub** → Authorize Cloudflare GitHub App
   → در صفحه‌ی GitHub، دسترسی را فقط به ریپوی `khodehydro/telegram_game_bot` بدهید (ریپو private است).
2. ریپو را انتخاب کنید: `khodehydro/telegram_game_bot`
3. تنظیمات را **دقیقاً** این‌طور پر کنید:

| فیلد پنل | مقدار |
|---|---|
| **Project / Worker name** | `telegram-game-bot` ← باید با `name` داخل `worker/wrangler.jsonc` یکی باشد |
| **Production branch** | `main` (یا شاخه‌ی `arena/3f6c6652-telegram-game-bot` اگر مرج نکرده‌اید) |
| **Root directory** | `worker` |
| **Build command** | `npm ci` |
| **Deploy command** | `npx wrangler deploy` |
| **Non-production branch deploy command** | خالی / غیرفعال بگذارید |

> اگر نام Worker را چیز دیگری گذاشتید، همان را در `worker/wrangler.jsonc` هم بگذارید — نام پنل و نام فایل کانفیگ باید یکی باشند، وگرنه بیلد fail می‌شود.

4. (اختیاری ولی توصیه‌شده) در بخش **Build variables** اضافه کنید:

| Variable | Value |
|---|---|
| `NODE_VERSION` | `22` |

5. **Deploy** بزنید. اولین بیلد چند دقیقه طول می‌کشد.

---

## ۳) تنظیم Secretها (بعد از اولین دیپلوی)

پنل → Worker `telegram-game-bot` → **Settings → Variables and Secrets** → **Add**

| Name | Type | Value |
|---|---|---|
| `BOT_TOKEN` | **Secret** | توکن BotFather |
| `WEBHOOK_SECRET` | **Secret** | یک رشته تصادفی (مثلاً خروجی `openssl rand -hex 16`) |
| `SETUP_TOKEN` | **Secret** | یک رمز یک‌بارمصرف دیگر |

نکته: `BOT_USERNAME` و `TURN_TIMEOUT` و `LOBBY_TIMEOUT` از قبل در `wrangler.jsonc` هستند؛ نیازی به تعریف دوباره ندارند.

---

## ۴) ثبت وبهوک تلگرام (یک بار)

آدرس Worker شما چیزی شبیه این است:

```
https://telegram-game-bot.<your-subdomain>.workers.dev
```

اگر `workers.dev` فعال نیست: Worker → **Settings → Domains & Routes → Enable workers.dev**.

سپس در مرورگر (یا با curl) این را باز کنید:

```
https://telegram-game-bot.<your-subdomain>.workers.dev/setup?token=<مقدار SETUP_TOKEN>
```

خروجی موفق:

```json
{ "ok": true, "webhook": "https://telegram-game-bot.<subdomain>.workers.dev/webhook", "bot": "hydrogameofficialbot" }
```

از این لحظه پیام‌های تلگرام به Worker می‌رسند. تست کنید:

```
/start   →   /new pasur   →   بقیه بازیکنان /join   →   دکمه «▶️ شروع بازی»
```

---

## ۵) ساخت جدول‌های D1

دو راه دارد:

**الف) خودکار:** اولین پیامی که به ربات می‌رسد، جدول‌ها ساخته می‌شوند (`Storage.init()` در کد صدا زده می‌شود).

**ب) دستی (مطمئن‌تر):**

پنل → D1 → `telegram-card-games` → تب **Console** → محتوای `worker/schema.sql` را پیست و اجرا کنید.
یا از سیستم خودتان:

```bash
cd worker
npx wrangler login
npx wrangler d1 execute telegram-card-games --remote --file=./schema.sql
```

---

## ۶) چک‌لیست عیب‌یابی

| مشکل | علت / راه‌حل |
|---|---|
| بیلد: `Worker name does not match` | نام Worker در پنل ≠ `name` در `wrangler.jsonc` |
| بیلد: `Could not resolve` یا `wrangler: not found` | Root directory روی `worker` نیست |
| بیلد: `invalid database_id` | مرحله ۱ انجام نشده |
| دپلوی OK ولی ربات جواب نمی‌دهد | مرحله ۴ (`/setup`) انجام نشده یا `WEBHOOK_SECRET` عوض شده |
| `/setup` می‌گوید `unauthorized` | مقدار `token` با `SETUP_TOKEN` یکی نیست |
| `/setup` خطای تلگرام می‌دهد | `BOT_TOKEN` اشتباه است یا در BotFather revoke شده |
| ربات «خطایی رخ داد» می‌دهد | Worker → Logs (Observability) را ببینید؛ معمولاً Secret جا افتاده |
| تایمر نوبت کار نمی‌کند | Cron باید در Worker → Settings → Triggers نماش داده شود؛ با `wrangler deploy` خودکار ست می‌شود. اگر نیست، از پنل یک Cron با `* * * * *` بسازید |
| پیام «Chat not found» | کاربر باید یک بار ربات را در **چت خصوصی** استارت کند تا برگ‌ها بیاید |

---

## ۷) تفاوت‌ها با نسخه‌ی پایتون

- نسخه‌ی Worker فقط **webhook** است (polling روی Cloudflare ممکن نیست) — ولی همین بهتر است، چون Worker خودش HTTPS دارد.
- دیتابیس **D1** است، نه Supabase.
- تایمر نوبت با **Cron هر دقیقه** اجرا می‌شود؛ پس حرکت خودکار ممکن است تا ~۶۰ ثانیه دیرتر انجام شود.
