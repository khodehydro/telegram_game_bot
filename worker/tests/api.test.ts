import { describe, expect, it } from "vitest";
import { json, routeApi, type Ctx, type Env } from "../src/api";
import worker, { type FullEnv } from "../src/index";
import { signInitData } from "../src/auth";

const TOKEN = "123456:TEST-TOKEN";

function ctx(path: string, init: RequestInit = {}, env: Partial<Env> = {}): Ctx {
  const url = new URL(`https://app.example${path}`);
  const request = new Request(url, init);
  return {
    env: { BOT_TOKEN: TOKEN, ...env } as Env,
    store: {} as unknown as Ctx["store"],
    request,
    url,
  };
}

describe("routeApi", () => {
  it("بدون initData خطای ۴۰۱ می‌دهد", async () => {
    const res = await routeApi(ctx("/api/me"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: "unauthorized" });
  });

  it("initData نامعتبر را رد می‌کند", async () => {
    const res = await routeApi(ctx("/api/level", { headers: { "x-init-data": "hash=bad" } }));
    expect(res.status).toBe(401);
  });

  it("مسیر ناشناس ۴۰۴ می‌دهد", async () => {
    const res = await routeApi(ctx("/api/nope"));
    expect(res.status).toBe(404);
  });

  it("حدس با متد GET مجاز نیست", async () => {
    const res = await routeApi(ctx("/api/guess"));
    expect(res.status).toBe(404);
  });

  it("در حالت DEV_AUTH هدر توسعه‌دهنده پذیرفته می‌شود", async () => {
    // فقط تا مرحلهٔ احراز هویت؛ store قلابی است و بعد از آن خطای سرور می‌دهد
    const user = encodeURIComponent(JSON.stringify({ id: 7, first_name: "دِو" }));
    // از احراز هویت عبور می‌کند و بعد به store قلابی می‌خورد
    await expect(
      routeApi(ctx("/api/me", { headers: { "x-dev-user": user } }, { DEV_AUTH: "1" })),
    ).rejects.toThrow();
  });

  it("json خروجی استاندارد می‌سازد", async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("worker fetch", () => {
  const env = { BOT_TOKEN: TOKEN } as FullEnv;

  it("health را برمی‌گرداند", async () => {
    const res = await worker.fetch(new Request("https://app.example/health"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "kalame-bazi" });
  });

  it("setup بدون توکن ۴۰۱ می‌دهد", async () => {
    const res = await worker.fetch(new Request("https://app.example/setup?token=wrong"), env);
    expect(res.status).toBe(401);
  });

  it("وبهوک با secret اشتباه رد می‌شود", async () => {
    const res = await worker.fetch(
      new Request("https://app.example/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "wrong" },
        body: "{}",
      }),
      { ...env, WEBHOOK_SECRET: "right" } as FullEnv,
    );
    expect(res.status).toBe(401);
  });

  it("api بدون احراز هویت ۴۰۱ می‌دهد", async () => {
    const res = await worker.fetch(new Request("https://app.example/api/me"), {
      ...env,
      DB: {} as FullEnv["DB"],
    } as FullEnv);
    expect(res.status).toBe(401);
  });

  it("initData معتبر و مسیر api عبور می‌کند", async () => {
    const initData = await signInitData({ id: 1, first_name: "آزمون" }, TOKEN);
    const res = await worker.fetch(
      new Request("https://app.example/api/leaderboard", { headers: { "x-init-data": initData } }),
      { ...env, DB: {} as FullEnv["DB"] } as FullEnv,
    );
    // store.init روی DB قلابی خطا می‌دهد ولی مسیر نباید ۴۰۱ باشد
    expect(res.status).not.toBe(401);
  });
});
