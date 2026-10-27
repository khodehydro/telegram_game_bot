/**
 * اعتبارسنجی initData مینی‌اپ تلگرام.
 *
 * طبق مستندات: secret = HMAC_SHA256("WebAppData", bot_token)
 *              hash   = hex(HMAC_SHA256(secret, data_check_string))
 * که data_check_string = مرتب‌شدهٔ همهٔ فیلدها به‌جز hash با قالب key=value و \n
 */

export interface WebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface AuthResult {
  ok: boolean
  user?: WebAppUser
  error?: string
  authDate?: number
}

const encoder = new TextEncoder();

async function hmac(key: Uint8Array | string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSeconds?: number; now?: number } = {},
): Promise<AuthResult> {
  if (!initData) return { ok: false, error: "missing_init_data" };
  if (!botToken) return { ok: false, error: "missing_bot_token" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "missing_hash" };
  params.delete("hash");

  const pairs: string[] = [];
  params.forEach((value, key) => pairs.push(`${key}=${value}`));
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secret = await hmac("WebAppData", botToken);
  const expected = toHex(await hmac(secret, dataCheckString));
  if (!safeEqual(expected, hash.toLowerCase())) return { ok: false, error: "bad_hash" };

  const authDate = Number(params.get("auth_date") ?? 0);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const maxAge = opts.maxAgeSeconds ?? 7 * 24 * 3600;
  if (!authDate || now - authDate > maxAge) return { ok: false, error: "expired" };

  const rawUser = params.get("user");
  if (!rawUser) return { ok: false, error: "no_user" };
  let user: WebAppUser;
  try {
    user = JSON.parse(rawUser) as WebAppUser;
  } catch {
    return { ok: false, error: "bad_user" };
  }
  if (!user || typeof user.id !== "number") return { ok: false, error: "bad_user" };

  return { ok: true, user, authDate };
}

/** برای تست و ابزارهای محلی: ساخت initData معتبر */
export async function signInitData(
  user: WebAppUser,
  botToken: string,
  authDate = Math.floor(Date.now() / 1000),
): Promise<string> {
  const params = new URLSearchParams({
    user: JSON.stringify(user),
    auth_date: String(authDate),
    query_id: "AAtest",
  });
  const pairs: string[] = [];
  params.forEach((value, key) => pairs.push(`${key}=${value}`));
  pairs.sort();
  const secret = await hmac("WebAppData", botToken);
  const hash = toHex(await hmac(secret, pairs.join("\n")));
  params.set("hash", hash);
  return params.toString();
}
