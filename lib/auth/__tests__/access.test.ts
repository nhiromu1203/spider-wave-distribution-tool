import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  allowedGoogleEmails,
  decideAccess,
  NOT_ALLOWED_MESSAGE,
  providerOf,
} from "../access";

/**
 * 誰がアプリを使えるかの判断。
 *
 * ── 守りたいこと ────────────────────────────────────────────
 * Google でログインすること自体は誰にでもできる。どのアカウントで
 * 入ってきたかは認証後の user.email でしか分からないため、
 * 「ログイン画面に出さない」だけでは防御にならない。
 * ────────────────────────────────────────────────────────────
 */

const KEY = "ALLOWED_GOOGLE_EMAILS";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY];
  delete (process.env as Record<string, string | undefined>)[KEY];
});

afterEach(() => {
  if (saved === undefined) delete (process.env as Record<string, string | undefined>)[KEY];
  else (process.env as Record<string, string | undefined>)[KEY] = saved;
});

describe("許可アカウント", () => {
  it("既定は infor@spiderwaves.co.jp だけ", () => {
    expect(allowedGoogleEmails()).toEqual(["infor@spiderwaves.co.jp"]);
  });

  it("環境変数で差し替えられる", () => {
    (process.env as Record<string, string | undefined>)[KEY] =
      "a@example.com, B@Example.com ";
    expect(allowedGoogleEmails()).toEqual(["a@example.com", "b@example.com"]);
  });
});

describe("Google ログイン", () => {
  it("許可アカウントは通す", () => {
    expect(decideAccess("infor@spiderwaves.co.jp", "google")).toEqual({
      allowed: true,
    });
  });

  it("大文字小文字と前後の空白は同じものとして扱う", () => {
    expect(decideAccess("  INFOR@SpiderWaves.co.jp ", "google").allowed).toBe(true);
  });

  it("個人の Gmail は通さない", () => {
    const d = decideAccess("someone@gmail.com", "google");
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.reason).toBe(NOT_ALLOWED_MESSAGE);
  });

  it("同じ会社の別アカウントも通さない", () => {
    expect(decideAccess("other@spiderwaves.co.jp", "google").allowed).toBe(false);
  });

  it("似ているだけのドメインは通さない", () => {
    for (const email of [
      "infor@spiderwaves.co.jp.evil.com",
      "infor@spiderwaves.com",
      "xinfor@spiderwaves.co.jp",
      "infor@spiderwave.co.jp",
    ]) {
      expect(decideAccess(email, "google").allowed, email).toBe(false);
    }
  });

  it("メールアドレスが取れない場合は通さない", () => {
    expect(decideAccess(null, "google").allowed).toBe(false);
    expect(decideAccess("", "google").allowed).toBe(false);
  });
});

describe("メール＋パスワードのログイン", () => {
  it("これまでどおり通す（Google の制限は掛けない）", () => {
    expect(decideAccess("staff@spiderwaves.co.jp", "email").allowed).toBe(true);
    expect(decideAccess("someone@gmail.com", "email").allowed).toBe(true);
  });

  it("メールアドレスが無ければ通さない", () => {
    expect(decideAccess(null, "email").allowed).toBe(false);
  });
});

describe("ログイン経路の取り出し", () => {
  it("app_metadata から読む", () => {
    expect(providerOf({ app_metadata: { provider: "google" } })).toBe("google");
    expect(providerOf({ app_metadata: { provider: "email" } })).toBe("email");
    expect(providerOf({})).toBeNull();
  });
});

describe("判断を掛ける場所", () => {
  it("保護ページを開くたびにサーバー側で確かめている", async () => {
    const source = await readFile(
      new URL("../../../proxy.ts", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).toContain("decideAccess(user.email");
    // 権限が無ければセッションを残さない
    expect(code).toContain("supabase.auth.signOut()");
  });

  it("Google から戻った直後にも確かめている", async () => {
    const source = await readFile(
      new URL("../../../app/auth/callback/route.ts", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).toContain("decideAccess(data.user.email");
    expect(code).toContain("supabase.auth.signOut()");
  });

  it("メール＋パスワードのログインを消していない", async () => {
    const source = await readFile(
      new URL("../../../app/login/actions.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("signInWithPassword");
    expect(source).toContain("signInWithOAuth");
  });
});
