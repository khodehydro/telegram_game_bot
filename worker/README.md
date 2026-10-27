# ☁️ نسخه‌ی Cloudflare Workers (بدون سرور)

همان ربات **پاسور و حکم**، ولی روی Cloudflare:

| بخش | پایتون (نسخه اصلی) | Cloudflare Worker (این پوشه) |
|---|---|---|
| اجرا | polling / webhook روی VPS | **فقط webhook** روی Workers |
| دیتابیس | Postgres/Supabase | **D1** (SQLite مدیریت‌شده) |
| تایمر نوبت | حلقه‌ی asyncio هر ۳ ثانیه | **Cron Trigger** هر دقیقه |
| هزینه | سرور | پلن رایگان (تا سقف مصرف) |
| کد | `bot/` | `worker/src/` (TypeScript) |

موتور بازی‌ها عیناً پورت شده و همان قوانین را دارد؛ تست‌ها هم پورت شده‌اند (`worker/tests`).

---

## 🚀 راه‌اندازی در ۶ قدم

```bash
cd worker
npm install
npx wrangler login          # مرورگر باز می‌شود
```

### ۱) ساخت دیتابیس D1

```bash
npx wrangler d1 create telegram-card-games
```

خروجی چیزی شبیه این است:

```toml
[[d1_databases]]
binding = "DB"
database_name = "telegram-card-games"
database_id = "0f2c9a1e-....-...."
```

`database_id` را در `wrangler.jsonc` جای `REPLACE_WITH_YOUR_D1_DATABASE_ID` بگذارید.

### ۲) ساخت جدول‌ها

```bash
npx wrangler d1 execute telegram-card-games --remote --file=./schema.sql
```

(Worker خودش هم در اولین اجرا جدول‌ها را می‌سازد.)

### ۳) گذاشتن Secretها

```bash
npx wrangler secret put BOT_TOKEN        # توکن BotFather
npx wrangler secret put WEBHOOK_SECRET   # یک رشته‌ی تصادفی، مثلاً: openssl rand -hex 16
npx wrangler secret put SETUP_TOKEN      # رمز یک‌بارمصرف برای /setup
```

### ۴) انتشار

```bash
npx wrangler deploy
```

خروجی یک آدرس می‌دهد مثل `https://telegram-card-games.<your-subdomain>.workers.dev`.

### ۵) ثبت وبهوک (یک بار)

```bash
curl "https://telegram-card-games.<your-subdomain>.workers.dev/setup?token=<SETUP_TOKEN>"
# → {"ok":true,"webhook":"https://.../webhook","bot":"hydrogameofficialbot"}
```

خودِ `/setup` این کارها را می‌کند: `setWebhook` + `setMyCommands`.

### ۶) تست

در تلگرام به [@hydrogameofficialbot](https://t.me/hydrogameofficialbot) پیام بدهید:
`/start` → `/new pasur` → بقیه بازیکنان `/join` → دکمه‌ی «▶️ شروع بازی».

---

## 🧪 توسعه‌ی محلی

```bash
npx wrangler dev            # روی http://localhost:8787
npm test                    # ۴۱ تست (موتورها + سرویس + D1 + تایمرها)
npm run typecheck           # tsc --noEmit
```

برای اجرای محلی، توکن را در `.dev.vars` بگذارید (کامیت نمی‌شود):

```ini
BOT_TOKEN=123456:AA...
WEBHOOK_SECRET=dev-secret
```

---

## 🗺 نقشه‌ی معماری

```
Telegram ──POST /webhook──▶ Worker.fetch
                             ├─ secret-token check
                             ├─ UpdateHandler  (دستورها و دکمه‌ها)
                             ├─ GameService    (منطق میز، رندر، آمار)
                             ├─ games/*        (پاسور و حکم — pure logic)
                             └─ Storage ──▶ D1 (users / game_sessions / match_results)

Cron (* * * * *) ──▶ Worker.scheduled ──▶ GameService.processTimeouts()
```

- وضعیت هر میز به‌صورت JSON در جدول `game_sessions` ذخیره می‌شود؛ بنابراین Worker بی‌حالت (stateless) است و بین کول‌استارت‌ها هم بازی از دست نمی‌رود.
- برگ‌های هر بازیکن فقط در چت خصوصی خودش ارسال می‌شود (پیام‌ها با `editMessageText` آپدیت می‌شوند، پس چت را پر نمی‌کنند).

---

## 📊 محدودیت‌های پلن رایگان

| منبع | سقف رایگان | مصرف این ربات |
|---|---|---|
| Workers requests | ۱۰۰٬۰۰۰ در روز | هر حرکت یک آپدیت + چند ویرایش پیام |
| Workers CPU | ۱۰ms به ازای هر request | منطق بازی بسیار سبک است |
| D1 reads | ۵ میلیون در روز | چند خواندن در هر حرکت |
| D1 writes | ۱۰۰٬۰۰۰ در روز | ~۲–۳ نوشتن در هر حرکت |
| Cron | هر ۱ دقیقه | یک اسکن کوچک |

برای یک گروه چندصد نفره کاملاً کافی است. اگر بزرگ‌تر شد، پلن Workers Paid (۵ دلار در ماه) سقف را ده‌ها برابر می‌کند.

---

## ⚠️ نکته‌ها

- **تایمر نوبت** با Cron دقیقه‌ای اجرا می‌شود، پس ممکن است تا ~۶۰ ثانیه بعد از پایان مهلت، حرکت خودکار انجام شود. اگر دقت ثانیه‌ای می‌خواهید، می‌توان با Durable Object Alarm جایگزین کرد.
- **Polling روی Cloudflare ممکن نیست**؛ در عوض Worker همیشه از طریق HTTPS در دسترس است، پس webhook بهترین گزینه است.
- **داده‌ها در D1** هستند، نه Supabase. اگر می‌خواهید همان Supabase بماند، نسخه‌ی پایتون (`bot/`) را روی یک هاست اجرا کنید؛ D1 و Supabase هم‌زمان لازم نیستند.
- هر بار توکن را عوض کردید، فقط `npx wrangler secret put BOT_TOKEN` و بعد `curl .../setup` را تکرار کنید.
