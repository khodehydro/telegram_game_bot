# کلمه‌بازی

مینی‌اپ پازل کلمات فارسی برای تلگرام؛ با حروف گردونه کلمه بساز، مرحله‌ها را باز کن و در جدول برترین‌ها بالا برو.

- ۴۰۰ مرحلهٔ آمادهٔ بازی با سختی پلکانی: از ۵ جای خالی و کلمه‌های کوتاه در مرحلهٔ ۱ تا ۱۲ جای خالی در مرحله‌های آخر
- کشیدن انگشت روی حروف گردونه و ساخت کلمه
- «کلمه‌های اضافه» به‌عنوان امتیاز جایزه
- سکه، راهنما، استریک روزانه و مرحلهٔ روز
- جدول برترین‌ها: امروز / این هفته / همه
- رابط فارسی راست‌به‌چپ با فونت وزیرمتن (میزبانی محلی)، تم تیره و روشن هماهنگ با تلگرام
- آیکون‌های SVG اختصاصی به‌جای ایموجی + گردونهٔ کانواسی با کشیدن انگشت
- داوری کلمه و محاسبهٔ امتیاز فقط سمت سرور (ضدتقلب)

## معماری

```
Telegram Mini App  ──►  Cloudflare Worker  ──►  D1
  public/ (UI)            src/api.ts            players / progress / plays
                          src/bot.ts (webhook)
```

همه‌چیز در یک Worker است: فایل‌های استاتیک با binding `ASSETS` سرو می‌شوند و مسیرهای `/api/*`، `/webhook` و `/setup` به کد Worker می‌رسند (`run_worker_first` در `wrangler.jsonc`).

```
worker/
├─ public/                 # مینی‌اپ: index.html + styles.css + app.js + fonts/
├─ src/
│  ├─ index.ts             # روتر Worker (health/setup/webhook/api/assets)
│  ├─ api.ts               # REST مینی‌اپ + احراز هویت initData
│  ├─ auth.ts              # اعتبارسنجی HMAC تلگرام (initData)
│  ├─ bot.ts               # دستورهای ربات و دکمهٔ مینی‌اپ
│  ├─ telegram.ts          # کلاینت سبک Bot API
│  ├─ db.ts                # SCHEMA + Store روی D1
│  ├─ levels.ts            # منطق مرحله، داوری کلمه، امتیاز، راهنما
│  └─ data/levels.json     # ۴۰۰ مرحله (تولیدشده)
├─ scripts/                # ساخت دیکشنری و مرحله‌ها از wordfreq + hazm
└─ tests/                  # vitest
```

## اجرای محلی

```bash
cd worker
npm ci
cp .dev.vars.example .dev.vars   # BOT_TOKEN و … را پر کنید
npm run dev                      # http://localhost:8787
```

در حالت محلی `DEV_AUTH=1` را در `.dev.vars` بگذارید تا بدون تلگرام هم بتوانید بازی کنید (مرورگر یک کاربر آزمایشی می‌سازد). **این متغیر را در محیط اصلی تنظیم نکنید.**

| دستور | کار |
| --- | --- |
| `npm run dev` | اجرای محلی Worker + D1 محلی |
| `npm run typecheck` | بررسی تایپ‌ها |
| `npm test` | تست‌های vitest |
| `npm run check` | typecheck + تست |
| `npm run cf:check` | بیلد آزمایشی wrangler (بدون انتشار) |
| `npm run levels` | بازتولید `src/data/levels.json` |

## استقرار روی Cloudflare

1. **D1**: در پنل Cloudflare → Storage & Databases → D1 یک دیتابیس بسازید و `database_id` را در `worker/wrangler.jsonc` بگذارید. (جدول‌ها با اولین درخواست خودکار ساخته می‌شوند.)
2. **متغیرها**: در تنظیمات Worker مقدارهای `BOT_TOKEN`، `WEBHOOK_SECRET` و `SETUP_TOKEN` را به‌صورت Secret اضافه کنید. `APP_URL` و `BOT_USERNAME` در `wrangler.jsonc` هستند.
3. **Build از GitHub**: Workers & Pages → Create → Worker → Connect to Git. ریشهٔ پروژه را `worker` بگذارید، Build command: `npm ci`، Deploy command: `npx wrangler deploy`. نام Worker در پنل باید با `name` در `wrangler.jsonc` یکی باشد.
4. **ثبت وبهوک**: یک‌بار آدرس زیر را باز کنید تا وبهوک، دستورها و دکمهٔ منوی مینی‌اپ تنظیم شود:

   ```
   https://<آدرس-worker>/setup?token=<SETUP_TOKEN>
   ```

5. در تلگرام ربات را باز کنید و «شروع بازی» را بزنید.

> ⚠️ توکن ربات را هرگز در کد، README یا گیت نگذارید؛ فقط از Secret پنل استفاده کنید. اگر لو رفت، از BotFather توکن را عوض کنید.

## منحنی سختی مرحله‌ها

سختی هر مرحله در `worker/scripts/build_levels.py` با تابع `level_score` سنجیده می‌شود
(تعداد کلمه‌های هدف، بلندترین و میانگین طول کلمه‌ها، تعداد حروف گردونه و کم‌شدن با فراوانی واژه‌ها)
و مرحله‌ها از آسان به سخت مرتب می‌شوند. تعداد جای خالی هم پله‌ای رشد می‌کند:
۸٪ اول مرحله‌ها ۵ کلمه، تا ۲۵٪ شش کلمه، تا ۶۰٪ هفت/هشت کلمه و بقیه ۹ تا ۱۲ کلمه.
کلمه‌های اضافهٔ هر مرحله (که در جای خالی‌ها نیستند) به‌عنوان «کلمهٔ اضافه» در `bonus` نگه داشته می‌شوند.

با هر بار بازتولید `levels.json`، مقدار `LEVELS_VERSION` در `src/levels.ts` را یکی زیاد کنید؛
وگرنه پیشرفت قدیمی بازیکن‌ها با پازل‌های جدید هم‌خوان نمی‌شود.

## API

همهٔ مسیرها به هدر `x-init-data` (یا `?init_data=`) نیاز دارند؛ در حالت `DEV_AUTH=1` هدر `x-dev-user` هم پذیرفته می‌شود.

| مسیر | توضیح |
| --- | --- |
| `GET /api/me` | پروفایل، امتیاز/رتبهٔ امروز، شمارهٔ مرحلهٔ روز |
| `GET /api/level?n=1` | حروف گردونه، نقشهٔ جای خالی‌ها، حل‌شده‌ها و راهنماها |
| `POST /api/guess` | `{level, word}` → داوری کلمه، امتیاز، سکه، تکمیل مرحله |
| `POST /api/hint` | یک حرف از کلمه‌های حل‌نشده (اول ۳ راهنمای رایگان، بعد ۴۰ سکه) |
| `GET /api/leaderboard?period=today\|week\|all` | جدول برترین‌ها |
| `GET /health` | سلامت سرویس |
| `POST /webhook` | آپدیت‌های تلگرام |
| `GET /setup?token=…` | تنظیم یک‌بارهٔ وبهوک/دستورها/منو |

کلاینت هرگز فهرست کلمات هدف را دریافت نمی‌کند؛ فقط طول و ایندکس جای خالی‌ها را می‌بیند.

## اقتصاد بازی

| رویداد | امتیاز | سکه |
| --- | --- | --- |
| کلمهٔ ۳ / ۴ / ۵ / ۶ / ۷ حرفی | ۱۰ / ۲۰ / ۳۵ / ۵۵ / ۸۰ | ۱ تا ۸ |
| کلمهٔ اضافه | ۳ | ۱ |
| تکمیل مرحله | +۱۰۰ | +۲۵ |
| راهنما | — | ۴۰ (۳ مورد اول رایگان) |

امتیاز هر کلمه فقط یک‌بار ثبت می‌شود؛ امتیاز روزانه در جدول «امروز» و «این هفته» جمع می‌شود.

## ساخت دادهٔ مرحله‌ها

دیکشنری از فهرست فراوانی wordfreq ساخته می‌شود و با واژگان و برچسب‌های دستوری hazm (اسم/صفت) پالایش می‌شود؛ املای نمایشی (آ/ئ/…) حفظ و برای تطبیق، نرمال‌سازی می‌شود.

```bash
python -m venv .venv && source .venv/bin/activate
pip install wordfreq hazm

cd worker
python scripts/build_dictionary.py --out data/dictionary.json
python scripts/build_levels.py --input data/dictionary.json --out src/data/levels.json \
  --count 400 --max-targets 12 --min-weight 5000 --bonus-min-weight 4000
```

## تست

```bash
cd worker && npm run check
```

۴۴ تست: منطق داوری/راهنما/تطبیق «آ»، اعتبارسنجی initData، مسیرهای API و سلامت دادهٔ مرحله‌ها.
<!-- deploy -->
