import { describe, expect, it } from "vitest";
import { signInitData, verifyInitData } from "../src/auth";

const TOKEN = "123456:TEST-TOKEN";

describe("verifyInitData", () => {
  it("initData امضاشده را می‌پذیرد", async () => {
    const initData = await signInitData({ id: 42, first_name: "آزمون", username: "tester" }, TOKEN);
    const result = await verifyInitData(initData, TOKEN);
    expect(result.ok).toBe(true);
    expect(result.user).toMatchObject({ id: 42, first_name: "آزمون" });
  });

  it("دستکاری داده را رد می‌کند", async () => {
    const initData = await signInitData({ id: 42, first_name: "آزمون" }, TOKEN);
    const tampered = initData.replace("%22id%22%3A42", "%22id%22%3A43");
    const result = await verifyInitData(tampered, TOKEN);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("bad_hash");
  });

  it("توکن اشتباه را رد می‌کند", async () => {
    const initData = await signInitData({ id: 42, first_name: "آزمون" }, "999:OTHER");
    expect((await verifyInitData(initData, TOKEN)).ok).toBe(false);
  });

  it("initData منقضی را رد می‌کند", async () => {
    const old = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    const initData = await signInitData({ id: 42, first_name: "آزمون" }, TOKEN, old);
    expect(await verifyInitData(initData, TOKEN)).toMatchObject({ ok: false, error: "expired" });
  });

  it("ورودی خالی یا بدون هش را رد می‌کند", async () => {
    expect(await verifyInitData("", TOKEN)).toMatchObject({ ok: false, error: "missing_init_data" });
    expect(await verifyInitData("auth_date=1&user=%7B%7D", TOKEN)).toMatchObject({
      ok: false,
      error: "missing_hash",
    });
  });

  it("بدون BOT_TOKEN خطا می‌دهد", async () => {
    expect(await verifyInitData("hash=abc", "")).toMatchObject({ ok: false, error: "missing_bot_token" });
  });
});
