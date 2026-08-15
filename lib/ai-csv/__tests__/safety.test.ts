import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * AI 調査 CSV 取込が、建物情報以外を書き換えないことを守る。
 *
 * 配布実績・配布済み判定・重複候補は、調査結果で動かしてよいものではない。
 * update に列を足すと簡単に壊れるため、ソースの内容で歯止めをかける。
 */

async function source(): Promise<string> {
  return readFile(new URL("../actions.ts", import.meta.url), "utf8");
}

/**
 * コードだけを取り出す。
 * 「触らない列」を列挙した注意書きに反応してしまうため、コメントは外す。
 */
async function code(): Promise<string> {
  const raw = await source();
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** buildPatch が組み立てる列名を取り出す */
function patchedColumns(code: string): string[] {
  const body = code.slice(code.indexOf("function buildPatch"));
  return [...body.matchAll(/patch\.([a-z_]+)\s*=/g)].map((m) => m[1]);
}

const ALLOWED = [
  "building_name",
  "normalized_building_name",
  "address",
  "normalized_address",
  "total_units",
  "property_type",
  "building_type",
  "name_source",
  "name_decided_at",
];

const FORBIDDEN = [
  "status",
  "distribution_count",
  "last_distributed_date",
  "source_ref",
  "latitude",
  "longitude",
  "prefecture",
  "city",
];

describe("触ってよい列", () => {
  it("建物情報の列だけを組み立てる", async () => {
    const columns = patchedColumns(await code());

    expect(columns.length).toBeGreaterThan(0);
    for (const c of columns) {
      expect(ALLOWED, `${c} を更新してはいけない`).toContain(c);
    }
  });

  it("配布実績・状態・座標を組み立てない", async () => {
    const columns = patchedColumns(await code());

    for (const c of FORBIDDEN) {
      expect(columns, `${c} が更新対象に入っている`).not.toContain(c);
    }
  });

  it("配布履歴・重複候補のテーブルに触れない", async () => {
    const body = await code();

    expect(body).not.toContain("distribution_history");
    expect(body).not.toContain("duplicate_candidates");
    expect(body).not.toContain("CONFIRMED_DISTRIBUTED");
  });

  it("更新は building_id で1件に絞る", async () => {
    const body = await code();

    expect(body).toMatch(/\.eq\("id", row\.building_id as string\)/);
    expect(body).not.toMatch(/\.eq\("address"/);
  });
});

describe("反映の手順", () => {
  it("反映時に判定をやり直す（画面表示をそのまま信じない）", async () => {
    const body = await code();
    const apply = body.slice(body.indexOf("export async function applyAiCsv"));

    // 上書きの指定も含めて、同じ条件で判定し直していること
    expect(apply).toContain("await previewAiCsv(text, options)");
  });

  it("更新可能な行以外は、選ばれていても反映しない", async () => {
    const body = await code();

    expect(body).toMatch(/r\.verdict === "更新可能"/);
  });

  it("変更した項目を履歴に残す", async () => {
    const body = await code();

    expect(body).toContain("building_field_updates");
    expect(body).toContain("ai_csv_batches");
  });

  it("取込単位で元に戻せる", async () => {
    const body = await code();

    expect(body).toContain("rollbackAiCsvBatch");
    expect(body).toMatch(/\.eq\("batch_id", batchId\)/);
  });
});
