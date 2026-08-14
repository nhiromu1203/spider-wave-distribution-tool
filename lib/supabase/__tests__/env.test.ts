import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifySupabaseKey,
  diagnoseSupabaseEnv,
  readSupabaseEnv,
  sanitizeEnvValue,
} from "../env";

/**
 * 本番で「Invalid API key」が出た原因を再現し、再発を防ぐ。
 * Supabase の実応答で確認した failing パターンをそのまま並べている。
 */

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const VALID_URL = "https://dsyknsarrgkqelpslgrr.supabase.co";
const VALID_KEY = "sb_publishable_AAAAAAAAAAAAAAAAAAAAAA";

let saved: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
  else (process.env as Record<string, string | undefined>)[key] = value;
}

beforeEach(() => {
  saved = { [URL_VAR]: process.env[URL_VAR], [KEY_VAR]: process.env[KEY_VAR] };
  setEnv(URL_VAR, VALID_URL);
  setEnv(KEY_VAR, VALID_KEY);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
});

describe("NEXT_PUBLIC_ の静的参照", () => {
  it("process.env を変数で引かない（ブラウザで undefined になるため）", async () => {
    // Next.js は process.env.NEXT_PUBLIC_XXX という「そのままの形」だけを
    // ビルド時に値へ置き換える。process.env[VAR] と書くと置換されず、
    // ブラウザ側では undefined になって接続できなくなる。
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../env.ts", import.meta.url), "utf8");

    // 注意書きのコメント自体に反応しないよう、コードだけを見る
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(code).toContain("process.env.NEXT_PUBLIC_SUPABASE_URL");
    expect(code).toContain("process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(code).not.toMatch(/process\.env\[/);
  });
});

describe("貼り付け時に紛れ込むものを取り除く", () => {
  it("前後の空白と改行を落とす", () => {
    expect(sanitizeEnvValue(`  ${VALID_KEY}\n`, KEY_VAR)).toBe(VALID_KEY);
  });

  it("引用符ごと貼られても値だけ取り出す", () => {
    expect(sanitizeEnvValue(`"${VALID_KEY}"`, KEY_VAR)).toBe(VALID_KEY);
    expect(sanitizeEnvValue(`'${VALID_KEY}'`, KEY_VAR)).toBe(VALID_KEY);
  });

  it("変数名ごと貼られても値だけ取り出す", () => {
    expect(sanitizeEnvValue(`${KEY_VAR}=${VALID_KEY}`, KEY_VAR)).toBe(VALID_KEY);
  });

  it("片側だけの引用符は値の一部として残す（勝手に削らない）", () => {
    expect(sanitizeEnvValue(`"${VALID_KEY}`, KEY_VAR)).toBe(`"${VALID_KEY}`);
  });

  it("未設定・空文字は null", () => {
    expect(sanitizeEnvValue(undefined, KEY_VAR)).toBeNull();
    expect(sanitizeEnvValue("   ", KEY_VAR)).toBeNull();
  });
});

describe("キーの種別", () => {
  it("新方式・旧方式・secret を見分ける", () => {
    expect(classifySupabaseKey("sb_publishable_abc")).toBe("publishable");
    expect(classifySupabaseKey("sb_secret_abc")).toBe("secret");
    expect(classifySupabaseKey("eyJhbGciOiJIUzI1NiJ9.x.y")).toBe("legacy_jwt");
    expect(classifySupabaseKey("abc")).toBe("unknown");
  });
});

describe("接続情報の診断", () => {
  it("正しい値ならそのまま使える", () => {
    const d = diagnoseSupabaseEnv();
    expect(d.problems).toEqual([]);
    expect(d.env).toEqual({ url: VALID_URL, anonKey: VALID_KEY });
  });

  it("引用符付きで設定されていても復旧して使える", () => {
    setEnv(KEY_VAR, `"${VALID_KEY}"`);
    setEnv(URL_VAR, `"${VALID_URL}"`);
    expect(readSupabaseEnv()).toEqual({ url: VALID_URL, anonKey: VALID_KEY });
  });

  it("secret key は使わせない", () => {
    setEnv(KEY_VAR, "sb_secret_AAAAAAAAAAAA");
    const d = diagnoseSupabaseEnv();
    expect(d.env).toBeNull();
    expect(d.problems.join()).toContain("secret key");
  });

  it("形式不明のキーは理由付きで拒否する", () => {
    setEnv(KEY_VAR, "not-a-key");
    const d = diagnoseSupabaseEnv();
    expect(d.env).toBeNull();
    expect(d.keyKind).toBe("unknown");
  });

  it("URL の末尾スラッシュやパス付きを指摘する", () => {
    setEnv(URL_VAR, `${VALID_URL}/`);
    expect(diagnoseSupabaseEnv().problems.join()).toContain(URL_VAR);

    setEnv(URL_VAR, `${VALID_URL}/auth/v1`);
    expect(diagnoseSupabaseEnv().problems.join()).toContain(URL_VAR);
  });

  it(".env.example のままなら未設定として扱う", () => {
    setEnv(URL_VAR, "https://xxxxxxxxxxxxxxxx.supabase.co");
    expect(readSupabaseEnv()).toBeNull();
  });

  it("未設定なら null（クラッシュしない）", () => {
    setEnv(URL_VAR, undefined);
    setEnv(KEY_VAR, undefined);
    const d = diagnoseSupabaseEnv();
    expect(d.env).toBeNull();
    expect(d.problems).toHaveLength(2);
  });
});
