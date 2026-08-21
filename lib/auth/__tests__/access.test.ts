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

/**
 * 現在このアプリはログインを求めていない。
 * ここの判断ロジックは、ログインを戻す場合に使えるよう残してある。
 * 使っていないあいだも壊れていないことを、この検証で確かめておく。
 */
describe("判断を掛ける場所", () => {
  it("ログインを求めていないので、proxy では判断していない", async () => {
    const source = await readFile(
      new URL("../../../proxy.ts", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toContain("decideAccess");
    expect(code).not.toContain("auth.getUser");
  });

  it("DB へはサーバー側の鍵で触る（ブラウザへ鍵を出さない）", async () => {
    const source = await readFile(
      new URL("../../supabase/server.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("readServiceRoleKey");
    // 秘密鍵に NEXT_PUBLIC_ を付けていないこと
    expect(source).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE");
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

describe("鍵が未設定のときの案内", () => {
  it("権限不足なら、何を設定すればよいか伝える", async () => {
    const { describeQueryError } = await import("@/lib/buildings/queries");
    const message = describeQueryError(
      "建物一覧の取得",
      "permission denied for table buildings",
    );

    expect(message).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(message).toContain("NEXT_PUBLIC_ は付けないでください");
  });

  it("それ以外の失敗はそのまま伝える", async () => {
    const { describeQueryError } = await import("@/lib/buildings/queries");
    expect(describeQueryError("建物一覧の取得", "timeout")).toBe(
      "建物一覧の取得に失敗しました: timeout",
    );
  });
});

describe("秘密鍵の読み取り", () => {
  it("公開鍵を入れても秘密鍵として扱わない", async () => {
    const { readServiceRoleKey } = await import("@/lib/supabase/env");
    const key = "SUPABASE_SERVICE_ROLE_KEY";
    const before = process.env[key];

    (process.env as Record<string, string | undefined>)[key] =
      "sb_publishable_xxxxxxxxxxxx";
    expect(readServiceRoleKey()).toBeNull();

    (process.env as Record<string, string | undefined>)[key] = "sb_secret_xxxxxxxx";
    expect(readServiceRoleKey()).toBe("sb_secret_xxxxxxxx");

    if (before === undefined) delete (process.env as Record<string, string | undefined>)[key];
    else (process.env as Record<string, string | undefined>)[key] = before;
  });
});
