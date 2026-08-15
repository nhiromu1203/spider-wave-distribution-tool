import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * CSV 取込が、建物名まわり以外の列を書き換えないことを守る。
 *
 * 配布実績や住所は、建物名の調査結果で動かしてよいものではない。
 * update に列を足すと簡単に壊れるため、ソースの内容で歯止めをかける。
 */

async function source(): Promise<string> {
  return readFile(new URL("../csv-actions.ts", import.meta.url), "utf8");
}

/** update({ ... }) の中身だけを取り出す */
function updatePayloads(code: string): string[] {
  return [...code.matchAll(/\.update\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
}

const ALLOWED = [
  "building_name",
  "normalized_building_name",
  "name_source",
  "name_decided_at",
];

const FORBIDDEN = [
  "status",
  "distribution_count",
  "total_units",
  "address",
  "latitude",
  "longitude",
  "property_type",
  "prefecture",
  "city",
];

describe("CSV 取込が触ってよい列", () => {
  it("buildings の更新は建物名まわりの列だけ", async () => {
    const payloads = updatePayloads(await source());
    expect(payloads.length).toBeGreaterThan(0);

    for (const payload of payloads) {
      const keys = [...payload.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(ALLOWED, `${key} を更新してはいけない`).toContain(key);
      }
    }
  });

  it("配布実績・住所・種別を書き換える記述が無い", async () => {
    const payloads = updatePayloads(await source()).join("\n");

    for (const column of FORBIDDEN) {
      expect(payloads, `${column} が更新対象に入っている`).not.toMatch(
        new RegExp(`^\\s*${column}:`, "m"),
      );
    }
  });

  it("配布履歴のテーブルには触れない", async () => {
    const code = await source();

    expect(code).not.toContain("distribution_history");
    expect(code).not.toContain("duplicate_candidates");
  });

  it("建物名の更新は building_id で特定する（住所では特定しない）", async () => {
    const code = await source();

    // .eq("id", ...) で1件に絞っていること
    expect(code).toMatch(/\.eq\("id",\s*update\.building_id\)/);
    expect(code).not.toMatch(/\.eq\("address"/);
  });

  it("更新のたびに履歴を残す", async () => {
    const code = await source();
    expect(code).toContain("building_name_updates");
  });

  it("書き出しは指定エリアで絞り込める", async () => {
    const code = await source();

    expect(code).toMatch(/\.eq\("prefecture", area\.prefecture\)/);
    expect(code).toMatch(/\.eq\("city", area\.city\)/);
  });

  it("書き出し対象は建物名が未設定のものだけ", async () => {
    const code = await source();

    // building_name が null / 空 / （建物名不明）のいずれか
    expect(code).toMatch(/building_name\.is\.null/);
    expect(code).toContain("UNKNOWN_NAME");
  });
});
