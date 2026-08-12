import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBuildingCsv } from "../csv/parse";
import { classifyBuildingUse } from "../building-use";

/**
 * samples/用途判定確認用_建物一覧.csv を実際に読み込み、
 * 1 行ずつ配布対象になるかを検証する。
 * 取込画面から同じファイルを上げたときと同じ経路を通る。
 */
const CSV_PATH = path.join(
  process.cwd(),
  "samples",
  "用途判定確認用_建物一覧.csv",
);

function loadRows() {
  const file = readFileSync(CSV_PATH);
  const buffer = file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength,
  ) as ArrayBuffer;

  const parsed = parseBuildingCsv(buffer, {
    sourceId: "csv",
    datasetName: "用途判定確認用",
  });

  return {
    parsed,
    rows: parsed.buildings.map((b) => ({
      name: b.building_name,
      address: b.address,
      totalUnits: b.total_units,
      judgement: classifyBuildingUse(b.building_use_raw, b.building_name),
    })),
  };
}

const { parsed, rows } = loadRows();
const find = (name: string) => {
  const row = rows.find((r) => r.name === name);
  expect(row, `${name} が CSV に存在しない`).toBeDefined();
  return row!;
};

describe("確認用 CSV の読み込み", () => {
  it("住所が無い行だけが取り込み対象外になる", () => {
    expect(parsed.skippedRows).toBe(1);
    expect(rows.some((r) => r.name === "住所が無い建物")).toBe(false);
  });

  it("用途列を認識している", () => {
    expect(parsed.columnMap.building_use).toBe("用途");
    expect(parsed.columnMap.total_units).toBe("総戸数");
  });

  it("総戸数は空欄なら null になる（0 戸と混同しない）", () => {
    expect(find("グランドヒルズ荒川").totalUnits).toBe(32);
    expect(find("佐藤邸").totalUnits).toBeNull();
  });
});

describe("配布対象になる建物（集合住宅のみ）", () => {
  const expected = [
    "グランドヒルズ荒川", // OSM building=apartments
    "日暮里ハウジング", // OSM building=housing
    "サンライトマンション荒川", // 日本語「マンション」
    "コーポ東尾久", // 日本語「アパート」
    "都営南千住住宅", // 日本語「集合住宅」
    "西日暮里共同住宅", // 日本語「共同住宅」
    "上野桜木アパートメント", // OSM building=apartments（台東区）
    "荒川メゾンひぐらし", // 用途列が空 → 建物名の「メゾン」で判断
    "南千住レジデンス", // building=residential だが建物名の「レジデンス」で判断
  ];

  for (const name of expected) {
    it(`${name} は配布対象になる`, () => {
      expect(find(name).judgement.use).toBe("RESIDENTIAL_MULTI");
    });
  }

  it("配布対象は 9 件", () => {
    const included = rows.filter((r) => r.judgement.use === "RESIDENTIAL_MULTI");
    expect(included.map((r) => r.name).sort()).toEqual([...expected].sort());
  });
});

describe("対象外になる建物", () => {
  const cases: Array<[string, string]> = [
    ["佐藤邸", "戸建て（OSM house）"],
    ["西尾久の一戸建て", "戸建て（OSM detached）"],
    ["尾久ツインハウス", "戸建て（OSM semidetached_house）"],
    ["町屋テラスハウス", "テラスハウス（OSM terrace）"],
    ["日暮里ドミトリー", "寮（OSM dormitory）"],
    ["荒川第一社宅", "社宅"],
    ["田中様邸", "戸建て"],
    ["谷中の一軒家", "一軒家"],
    ["町屋長屋", "長屋"],
    ["町屋ショッピングセンター", "商業施設（OSM commercial）"],
    ["南千住ドラッグストア", "店舗（OSM retail）"],
    ["町屋銀座ストア", "店舗"],
    ["店舗付きマンション日暮里", "店舗付き住宅"],
    ["日暮里オフィスタワー", "オフィス（OSM office）"],
    ["荒川区役所別館", "事務所"],
    ["東日暮里製作所", "工場（OSM factory）"],
    ["東尾久金属工業", "工場"],
    ["荒川物流センター", "倉庫（OSM warehouse）"],
    ["南千住倉庫3号棟", "倉庫"],
    ["荒川第二小学校", "学校（OSM school）"],
    ["南千住総合病院", "病院（OSM hospital）"],
    ["日暮里クリニックビル", "病院"],
    ["町屋パーキング", "ガレージ（OSM garage）"],
    ["西尾久駐車場", "駐車場"],
  ];

  for (const [name, why] of cases) {
    it(`${name} は対象外（${why}）`, () => {
      const judged = find(name).judgement;
      expect(judged.use).toBe("EXCLUDED");
      expect(judged.excludedAsUnknown).toBe(false);
    });
  }
});

describe("用途を判定できない建物も対象外にする", () => {
  const cases: Array<[string, string]> = [
    ["西日暮里A棟", "OSM building=yes で、建物名からも判断できない"],
    ["山田ビル", "用途列が空で、建物名からも判断できない"],
  ];

  for (const [name, why] of cases) {
    it(`${name} は対象外（${why}）`, () => {
      const judged = find(name).judgement;
      expect(judged.use).toBe("EXCLUDED");
      // 用途不明による除外は件数表示で区別できるようにする
      expect(judged.excludedAsUnknown).toBe(true);
    });
  }

  it("用途不明で除外されるのは 2 件", () => {
    const unknown = rows.filter((r) => r.judgement.excludedAsUnknown);
    expect(unknown.map((r) => r.name).sort()).toEqual(["山田ビル", "西日暮里A棟"].sort());
  });

  it("曖昧なタグでも建物名が決め手になれば配布対象にする", () => {
    // building=residential は用途を絞り込めないだけで、除外の根拠にはならない
    const judged = find("南千住レジデンス").judgement;
    expect(judged.use).toBe("RESIDENTIAL_MULTI");
    expect(judged.reason).toContain("レジデンス");
  });
});

describe("全体の内訳", () => {
  it("配布対象 9 件 / 対象外 26 件 / 住所なし 1 件", () => {
    const included = rows.filter((r) => r.judgement.use === "RESIDENTIAL_MULTI");
    const excluded = rows.filter((r) => r.judgement.use === "EXCLUDED");

    expect(included).toHaveLength(9);
    expect(excluded).toHaveLength(26);
    expect(parsed.skippedRows).toBe(1);
    // 9 件（配布対象）+ 26 件（対象外）+ 1 件（住所なし）
    expect(parsed.totalRows).toBe(36);
  });
});

describe("区ごとの内訳（エリア選択で取得される件数）", () => {
  const byWard = (ward: string) =>
    rows.filter((r) => r.address.includes(ward));

  it("荒川区は配布対象 8 件", () => {
    const included = byWard("荒川区").filter(
      (r) => r.judgement.use === "RESIDENTIAL_MULTI",
    );
    expect(included).toHaveLength(8);
  });

  it("台東区は配布対象 1 件（荒川区を選ぶと取得されない）", () => {
    const included = byWard("台東区").filter(
      (r) => r.judgement.use === "RESIDENTIAL_MULTI",
    );
    expect(included.map((r) => r.name)).toEqual(["上野桜木アパートメント"]);
  });
});
