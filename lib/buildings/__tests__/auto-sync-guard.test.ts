import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { isAreaSyncEnabled } from "../sync-config";

/**
 * 画面表示・リロード・エリア選択で建物が増えないことを守る。
 *
 * ── 実際に起きたこと ────────────────────────────────────────
 * 「そのエリアに取得元由来（source='data_source'）の建物が 0 件なら
 * 自動で取得する」という作りだった。建物マスタを CSV
 * （source='import'）で作り直すと取得元由来は常に 0 件になるため、
 * 画面を開くたびに OSM から取得して登録され、736 件が 1,108 件へ増えた。
 */

const KEY = "BUILDING_AUTO_SYNC";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY];
  delete (process.env as Record<string, string | undefined>)[KEY];
});

afterEach(() => {
  if (saved === undefined) delete (process.env as Record<string, string | undefined>)[KEY];
  else (process.env as Record<string, string | undefined>)[KEY] = saved;
});

describe("取得元からの自動登録", () => {
  it("既定では無効", () => {
    expect(isAreaSyncEnabled()).toBe(false);
  });

  it("明示的に指定したときだけ有効", () => {
    (process.env as Record<string, string | undefined>)[KEY] = "1";
    expect(isAreaSyncEnabled()).toBe(true);
  });

  it("1 以外の値では有効にしない", () => {
    for (const v of ["0", "true", "yes", ""]) {
      (process.env as Record<string, string | undefined>)[KEY] = v;
      expect(isAreaSyncEnabled(), v).toBe(false);
    }
  });
});

describe("止め方", () => {
  it("サーバー側で断っている（画面だけの制御にしない）", async () => {
    const source = await readFile(new URL("../sync.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    // 取得元へ問い合わせる前に判定していること
    const guard = code.indexOf("isAreaSyncEnabled()");
    const fetchCall = code.indexOf("source.fetchByArea");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(fetchCall);
  });

  it("画面から自動実行しない（useEffect で取得を呼ばない）", async () => {
    const source = await readFile(
      new URL("../../../components/AreaSync.tsx", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toContain("useEffect");
  });
});
