import { describe, expect, it } from "vitest";
import {
  buildUnknownNameCsv,
  isNameEmpty,
  parseCompletionCsv,
  parseCsv,
  planNameUpdates,
  UNKNOWN_NAME,
  type CurrentBuilding,
} from "../csv";

const HEADER = "building_id,address,building_name,status,source,note";

function csv(...lines: string[]): string {
  return [HEADER, ...lines].join("\n");
}

const current: CurrentBuilding[] = [
  { id: "a1", address: "東京都荒川区東日暮里3丁目12", building_name: null },
  { id: "a2", address: "東京都荒川区西日暮里2丁目6", building_name: "" },
  { id: "a3", address: "東京都荒川区南千住5丁目10", building_name: UNKNOWN_NAME },
  { id: "b1", address: "東京都荒川区荒川3丁目42", building_name: "既存マンション" },
];

describe("建物名不明の書き出し", () => {
  const rows = [
    {
      id: "a1",
      prefecture: "東京都",
      city: "荒川区",
      address: "東京都荒川区東日暮里3丁目12",
      latitude: 35.7311,
      longitude: 139.7816,
      building_name: UNKNOWN_NAME,
    },
  ];

  it("指定の列順で書き出す", () => {
    const out = buildUnknownNameCsv(rows);
    const [header, first] = out.replace(/^﻿/, "").trim().split("\r\n");

    expect(header).toBe(
      "building_id,prefecture,city,address,latitude,longitude,current_building_name",
    );
    expect(first).toBe(
      "a1,東京都,荒川区,東京都荒川区東日暮里3丁目12,35.7311,139.7816,（建物名不明）",
    );
  });

  it("Excel で開けるよう BOM を付ける", () => {
    expect(buildUnknownNameCsv(rows).startsWith("﻿")).toBe(true);
  });

  it("区切り文字を含む値を壊さない", () => {
    const out = buildUnknownNameCsv([
      { ...rows[0], address: 'A,B"C' },
    ]);
    expect(out).toContain('"A,B""C"');
  });
});

describe("CSV の読み取り", () => {
  it("引用符の中の改行と区切りを保つ", () => {
    expect(parseCsv('a,"b,c"\n"d\ne",f')).toEqual([
      ["a", "b,c"],
      ["d\ne", "f"],
    ]);
  });

  it("BOM と CRLF を扱える", () => {
    expect(parseCsv("﻿a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("取り込み CSV の検証", () => {
  it("正しい行を読み取る", () => {
    const { rows, errors } = parseCompletionCsv(
      csv("a1,住所,○○マンション,CONFIRMED,SUUMO,複数一致"),
    );

    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      building_id: "a1",
      building_name: "○○マンション",
      status: "CONFIRMED",
      source: "SUUMO",
    });
  });

  it("必須列が足りなければ読み取らない", () => {
    const { rows, errors } = parseCompletionCsv("building_id,address\na1,住所");

    expect(rows).toEqual([]);
    expect(errors[0].message).toContain("必須の列がありません");
  });

  it("status が許可値以外なら行エラー", () => {
    const { rows, errors } = parseCompletionCsv(csv("a1,住所,名前,MAYBE,src,"));

    expect(rows).toEqual([]);
    expect(errors[0].message).toContain("status が不正です");
  });

  it("CONFIRMED / HIGH で建物名が空なら行エラー", () => {
    const { errors } = parseCompletionCsv(
      csv("a1,住所,,CONFIRMED,src,", "a2,住所,,HIGH,src,"),
    );

    expect(errors).toHaveLength(2);
    expect(errors[0].message).toContain("building_name が空");
  });

  it("building_id の重複を弾く", () => {
    const { errors } = parseCompletionCsv(
      csv("a1,住所,名前1,HIGH,src,", "a1,住所,名前2,HIGH,src,"),
    );

    expect(errors[0].message).toContain("重複");
  });

  it("building_id が空なら行エラー", () => {
    const { errors } = parseCompletionCsv(csv(",住所,名前,HIGH,src,"));
    expect(errors[0].message).toContain("building_id が空");
  });
});

describe("更新するかどうかの判断", () => {
  it("CONFIRMED は更新する", () => {
    const { rows } = parseCompletionCsv(csv("a1,住所,○○マンション,CONFIRMED,src,"));
    const plan = planNameUpdates(rows, current);

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].newName).toBe("○○マンション");
  });

  it("HIGH は更新する", () => {
    const { rows } = parseCompletionCsv(csv("a2,住所,△△ハイツ,HIGH,src,"));
    expect(planNameUpdates(rows, current).updates).toHaveLength(1);
  });

  it("AMBIGUOUS は更新しない", () => {
    const { rows } = parseCompletionCsv(csv("a1,住所,,AMBIGUOUS,複数候補,"));
    const plan = planNameUpdates(rows, current);

    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("確度が不足");
  });

  it("NOT_FOUND は更新しない", () => {
    const { rows } = parseCompletionCsv(csv("a1,住所,,NOT_FOUND,,"));
    expect(planNameUpdates(rows, current).updates).toHaveLength(0);
  });

  it("既に建物名があれば上書きしない", () => {
    const { rows } = parseCompletionCsv(csv("b1,住所,別の名前,CONFIRMED,src,"));
    const plan = planNameUpdates(rows, current);

    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("既存名あり");
    expect(plan.skipped[0].currentName).toBe("既存マンション");
  });

  it("（建物名不明）は未設定として扱い、更新できる", () => {
    const { rows } = parseCompletionCsv(csv("a3,住所,新名称,HIGH,src,"));
    expect(planNameUpdates(rows, current).updates).toHaveLength(1);
  });

  it("building_id が DB に無ければエラーにする（住所では照合しない）", () => {
    const { rows } = parseCompletionCsv(csv("zzz,住所,名前,HIGH,src,"));
    const plan = planNameUpdates(rows, current);

    expect(plan.updates).toHaveLength(0);
    expect(plan.errors[0].message).toContain("見つかりません");
  });

  it("同じ CSV を再取込しても二重更新しない", () => {
    const { rows } = parseCompletionCsv(csv("a1,住所,○○マンション,CONFIRMED,src,"));

    // 1 回目の反映後を想定した状態
    const after: CurrentBuilding[] = current.map((c) =>
      c.id === "a1" ? { ...c, building_name: "○○マンション" } : c,
    );
    const plan = planNameUpdates(rows, after);

    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("同じ名前で更新済み");
  });
});

describe("建物名が入っているかの判定", () => {
  it("空・空白・（建物名不明）は未設定扱い", () => {
    expect(isNameEmpty(null)).toBe(true);
    expect(isNameEmpty("  ")).toBe(true);
    expect(isNameEmpty(UNKNOWN_NAME)).toBe(true);
    expect(isNameEmpty("メゾン丸十")).toBe(false);
  });
});
