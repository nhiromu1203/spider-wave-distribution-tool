import { describe, expect, it } from "vitest";
import {
  CSV_MAX_ROWS_DEFAULT,
  decodeCsv,
  mapHeaders,
  parseBuildingCsv,
} from "../csv/parse";
import { summarizeAreas, toDatasetId } from "../csv/store";

const STANDARD_CSV = `建物名,住所,総戸数,種別,緯度,経度
グランドメゾン日暮里,東京都荒川区東日暮里1-5-3,24,賃貸,35.7295,139.7802
コーポ町屋,荒川区町屋1-3-7,,分譲,,
世帯数不明マンション,東京都荒川区東日暮里4-10-1,,,,
`;

function toBuffer(text: string, options: { bom?: boolean } = {}): ArrayBuffer {
  const body = options.bom ? `﻿${text}` : text;
  const bytes = new TextEncoder().encode(body);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** Shift_JIS のバイト列を作る（テスト用の最小変換） */
function toShiftJisBuffer(text: string): ArrayBuffer {
  // 検証に必要な文字だけを対応表で変換する
  const table: Record<string, number[]> = {
    建: [0x8c, 0x9a], 物: [0x95, 0xa8], 名: [0x96, 0xbc],
    住: [0x8f, 0x5a], 所: [0x8f, 0x8a],
    東: [0x93, 0x8c], 京: [0x8b, 0x9e], 都: [0x93, 0x73],
    荒: [0x8d, 0x72], 川: [0x90, 0xec], 区: [0x8b, 0xe6],
    日: [0x93, 0xfa], 暮: [0x95, 0xe9], 里: [0x97, 0xa2],
  };

  const out: number[] = [];
  for (const ch of text) {
    if (table[ch]) out.push(...table[ch]);
    else if (ch.charCodeAt(0) < 128) out.push(ch.charCodeAt(0));
    else out.push(0x3f); // 対応表に無い文字は "?"
  }
  return new Uint8Array(out).buffer;
}

describe("文字コードの判定", () => {
  it("BOM なし UTF-8 を読める", () => {
    const { encoding, text } = decodeCsv(toBuffer("建物名,住所\nテスト,東京都"));
    expect(encoding).toBe("utf-8");
    expect(text).toContain("建物名");
  });

  it("BOM あり UTF-8 を読め、BOM は取り除かれる", () => {
    const { encoding, text } = decodeCsv(toBuffer("建物名,住所", { bom: true }));
    expect(encoding).toBe("utf-8-bom");
    expect(text.startsWith("建物名")).toBe(true);
    expect(text).not.toContain("﻿");
  });

  it("Shift_JIS を読める", () => {
    const { encoding, text } = decodeCsv(
      toShiftJisBuffer("建物名,住所\nA,東京都荒川区"),
    );
    expect(encoding).toBe("shift_jis");
    expect(text).toContain("建物名");
    expect(text).toContain("東京都荒川区");
  });

  it("BOM 付きヘッダーでも列名が壊れない", () => {
    const result = parseBuildingCsv(toBuffer(STANDARD_CSV, { bom: true }), {
      sourceId: "csv",
      datasetName: "test",
    });
    expect(result.columnMap.building_name).toBe("建物名");
    expect(result.columnMap.address).toBe("住所");
  });
});

describe("ヘッダーの対応づけ", () => {
  it("標準ヘッダーを認識する", () => {
    const map = mapHeaders(["建物名", "住所", "総戸数", "種別", "緯度", "経度"]);
    expect(map).toMatchObject({
      building_name: "建物名",
      address: "住所",
      total_units: "総戸数",
      property_type: "種別",
      latitude: "緯度",
      longitude: "経度",
    });
  });

  it("よくある別名も拾う", () => {
    const map = mapHeaders(["物件名", "所在地", "総世帯数"]);
    expect(map.building_name).toBe("物件名");
    expect(map.address).toBe("所在地");
    expect(map.total_units).toBe("総世帯数");
  });

  it("無い列は null のまま", () => {
    const map = mapHeaders(["建物名", "住所"]);
    expect(map.total_units).toBeNull();
    expect(map.latitude).toBeNull();
    expect(map.property_type).toBeNull();
  });
});

describe("SourceBuilding への変換", () => {
  const result = parseBuildingCsv(toBuffer(STANDARD_CSV), {
    sourceId: "csv",
    datasetName: "tokyo",
  });

  it("標準列をすべて変換する", () => {
    const first = result.buildings[0];
    expect(first.building_name).toBe("グランドメゾン日暮里");
    expect(first.address).toBe("東京都荒川区東日暮里1-5-3");
    expect(first.total_units).toBe(24);
    expect(first.property_type).toBe("rental");
    expect(first.latitude).toBeCloseTo(35.7295);
    expect(first.longitude).toBeCloseTo(139.7802);
    expect(first.source_ref).toBe("csv:tokyo#1");
  });

  it("住所から都道府県・市区町村・町名を補完する", () => {
    expect(result.buildings[0].prefecture).toBe("東京都");
    expect(result.buildings[0].city).toBe("荒川区");
    expect(result.buildings[0].town).toBe("東日暮里");
    // 都道府県が省略されていても市区町村は取れる
    expect(result.buildings[1].city).toBe("荒川区");
  });

  it("空欄は推測せず null にする（0 戸と混同しない）", () => {
    expect(result.buildings[1].total_units).toBeNull();
    expect(result.buildings[1].latitude).toBeNull();
    expect(result.buildings[2].property_type).toBe("unknown");
  });
});

describe("列が不足している CSV", () => {
  it("住所だけでも取り込める", () => {
    const csv = "住所\n東京都荒川区東日暮里1-5-3\n荒川区町屋1-3-7\n";
    const result = parseBuildingCsv(toBuffer(csv), {
      sourceId: "csv",
      datasetName: "min",
    });

    expect(result.buildings).toHaveLength(2);
    expect(result.buildings[0].building_name).toBe("（建物名なし）");
    expect(result.buildings[0].total_units).toBeNull();
    expect(result.buildings[0].property_type).toBe("unknown");
  });

  it("住所の列が無ければ 0 件になり、理由が残る", () => {
    const csv = "建物名,総戸数\nテストマンション,24\n";
    const result = parseBuildingCsv(toBuffer(csv), {
      sourceId: "csv",
      datasetName: "no-address",
    });

    expect(result.columnMap.address).toBeNull();
    expect(result.buildings).toHaveLength(0);
    expect(result.skippedRows).toBe(1);
    expect(result.skippedSamples[0].reason).toContain("住所の列");
  });

  it("住所が空の行だけを捨てる", () => {
    const csv = "建物名,住所\nA,東京都荒川区東日暮里1-5-3\nB,\nC,荒川区町屋1-3-7\n";
    const result = parseBuildingCsv(toBuffer(csv), {
      sourceId: "csv",
      datasetName: "partial",
    });

    expect(result.buildings).toHaveLength(2);
    expect(result.skippedRows).toBe(1);
    expect(result.buildings.map((b) => b.building_name)).toEqual(["A", "C"]);
  });
});

describe("大量データ", () => {
  it("10万行を読み込める", () => {
    const rows = ["建物名,住所,総戸数"];
    for (let i = 1; i <= 100_000; i++) {
      rows.push(`建物${i},東京都荒川区東日暮里${(i % 8) + 1}-1-${i},${(i % 40) + 6}`);
    }
    const result = parseBuildingCsv(toBuffer(rows.join("\n")), {
      sourceId: "csv",
      datasetName: "large",
    });

    expect(result.totalRows).toBe(100_000);
    expect(result.buildings).toHaveLength(100_000);
    expect(result.buildings[99_999].city).toBe("荒川区");
  }, 60_000);

  it("上限を超えた分は読み捨てる", () => {
    const rows = ["建物名,住所"];
    for (let i = 1; i <= 50; i++) rows.push(`建物${i},東京都荒川区東日暮里1-1-${i}`);

    const result = parseBuildingCsv(toBuffer(rows.join("\n")), {
      sourceId: "csv",
      datasetName: "capped",
      maxRows: 10,
    });

    expect(result.totalRows).toBe(10);
    expect(result.buildings).toHaveLength(10);
  });

  it("既定の上限は10万件", () => {
    expect(CSV_MAX_ROWS_DEFAULT).toBe(100_000);
  });
});

describe("データセットの集計", () => {
  it("含まれるエリアを件数付きで集計する", () => {
    const { buildings } = parseBuildingCsv(toBuffer(STANDARD_CSV), {
      sourceId: "csv",
      datasetName: "areas",
    });
    const areas = summarizeAreas(buildings);

    expect(areas[0].prefecture).toBe("東京都");
    expect(areas[0].city).toBe("荒川区");
    expect(areas[0].count).toBe(3);
  });

  it("ファイル名から安全な識別子を作る", () => {
    expect(toDatasetId("東京都23区_建物一覧.csv")).toBe("東京都23区_建物一覧");
    expect(toDatasetId("../../etc/passwd.csv")).toBe("etc-passwd");
    expect(toDatasetId("a b/c.csv")).toBe("a-b-c");
  });
});
