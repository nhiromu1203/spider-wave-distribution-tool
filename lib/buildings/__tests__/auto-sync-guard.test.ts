import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * 建物一覧の画面から建物が増えないことを守る。
 *
 * ── 実際に起きたこと ────────────────────────────────────────
 * 「そのエリアに取得元由来（source='data_source'）の建物が 0 件なら
 * 自動で取得する」という作りだった。件数を数える処理が
 * source='data_source' だけを数えるため、建物マスタを CSV
 * （source='import'）で作り直すと常に 0 件になる。
 * その結果、画面を開くたびに OSM から取得して登録され、
 * 736 件が 1,108 件へ増えた。
 *
 * 取得の経路そのものを外したので、条件分岐ではなく
 * 「書き込む手段が無いこと」で守る。
 */

async function read(path: string): Promise<string> {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  // 注意書きに反応しないよう、コメントは外して中身だけ見る
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("エリアの画面は DB を変更しない", () => {
  it("取得元から取り込む処理を持たない", async () => {
    const code = await read("../sync.ts");

    expect(code).not.toContain("ingestBuildings");
    expect(code).not.toContain("fetchByArea");
    expect(code).not.toContain("data_source");
  });

  it("Supabase クライアントすら作らない", async () => {
    const code = await read("../sync.ts");

    expect(code).not.toContain("createClient");
    expect(code).not.toContain("insert");
    expect(code).not.toContain("upsert");
  });

  it("画面側に取得を呼ぶ処理が無い", async () => {
    const code = await read("../../../components/AreaSync.tsx");

    expect(code).not.toContain("syncAreaBuildings");
    expect(code).not.toContain("useEffect");
    expect(code).not.toContain("onClick");
  });
});

describe("建物を作る経路", () => {
  it("残っているのは CSV 取込と取得元の取り込み処理だけ", async () => {
    // ingest.ts は建物データ取得の共通処理で、現在の呼び出し元は
    // 過去配布リスト取込（skipUnmatched で新規作成しない）のみ。
    const importAction = await read("../../import/actions.ts");
    expect(importAction).toContain("skipUnmatched: true");

    // AI 調査 CSV だけが建物を新しく作る
    const aiCsv = await read("../../ai-csv/actions.ts");
    expect(aiCsv).toContain('.from("buildings")');
    expect(aiCsv).toContain(".insert(insert)");
  });
});
