import { describe, expect, it } from "vitest";
import {
  decideAddress,
  parseAiCsv,
  parsePropertyType,
  parseTotalUnits,
  planAiCsvImport,
  UNKNOWN_NAME,
  type CurrentBuilding,
} from "../plan";

const HEADER =
  "building_id,building_name,address,total_units,property_type,source,note";

function csv(...lines: string[]): string {
  return [HEADER, ...lines].join("\n");
}

function building(over: Partial<CurrentBuilding> = {}): CurrentBuilding {
  return {
    id: "b1",
    building_name: UNKNOWN_NAME,
    address: "東京都荒川区東日暮里3丁目12",
    normalized_address: "",
    prefecture: "東京都",
    city: "荒川区",
    total_units: null,
    property_type: "unknown",
    latitude: 35.73,
    longitude: 139.78,
    ...over,
  };
}

function planOf(line: string, current: CurrentBuilding[]) {
  const { rows } = parseAiCsv(csv(line));
  return planAiCsvImport(rows, current);
}

describe("総世帯数の読み取り", () => {
  it("正の整数だけ受け付ける", () => {
    expect(parseTotalUnits("32")).toEqual({ ok: true, value: 32 });
    expect(parseTotalUnits("8")).toEqual({ ok: true, value: 8 });
  });

  it("0・空欄・不明・約30 は更新に使わない", () => {
    expect(parseTotalUnits("0").ok).toBe(false);
    expect(parseTotalUnits("").ok).toBe(false);
    expect(parseTotalUnits("不明").ok).toBe(false);
    expect(parseTotalUnits("約30").ok).toBe(false);
  });

  it("空欄は理由なし（単に対象外）、不正値は理由あり（要確認にする）", () => {
    expect(parseTotalUnits("")).toEqual({ ok: false, reason: null });
    expect(parseTotalUnits("約30").ok).toBe(false);
    const r = parseTotalUnits("約30") as { ok: false; reason: string };
    expect(r.reason).toContain("数値ではありません");
  });
});

describe("物件種別の読み取り", () => {
  it("既存の区分に対応づける", () => {
    expect(parsePropertyType("賃貸")).toEqual({ ok: true, value: "rental" });
    expect(parsePropertyType("分譲")).toEqual({ ok: true, value: "condominium" });
    expect(parsePropertyType("不明")).toEqual({ ok: true, value: "unknown" });
  });

  it("当てはまらない値は勝手に変換しない", () => {
    const r = parsePropertyType("マンション") as { ok: false; reason: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("当てはまりません");
  });
});

describe("住所の判断", () => {
  it("号が足されただけなら更新候補にする", () => {
    expect(
      decideAddress("東京都荒川区東日暮里3丁目12", "東京都荒川区東日暮里3丁目12番5号"),
    ).toEqual({ kind: "詳細住所へ更新", value: "東京都荒川区東日暮里3丁目12番5号" });
  });

  it("同じ内容なら変更なし", () => {
    expect(
      decideAddress("東京都荒川区東日暮里3丁目12", "東京都荒川区東日暮里3-12").kind,
    ).toBe("変更なし");
  });

  it("町名が違えば競合", () => {
    const d = decideAddress(
      "東京都荒川区東日暮里3丁目12",
      "東京都荒川区西日暮里3丁目12番5号",
    );
    expect(d.kind).toBe("競合");
  });

  it("丁目が違えば競合", () => {
    expect(
      decideAddress("東京都荒川区東日暮里3丁目12", "東京都荒川区東日暮里4丁目12番5号")
        .kind,
    ).toBe("競合");
  });

  it("番が違えば競合", () => {
    expect(
      decideAddress("東京都荒川区東日暮里3丁目12", "東京都荒川区東日暮里3丁目13番5号")
        .kind,
    ).toBe("競合");
  });
});

describe("行ごとの判定", () => {
  it("建物名が未設定なら更新できる", () => {
    const plan = planOf("b1,○○マンション,東京都荒川区東日暮里3丁目12,,,ChatGPT,", [
      building(),
    ]);

    expect(plan.rows[0].verdict).toBe("更新可能");
    expect(plan.rows[0].changes[0]).toMatchObject({
      field: "building_name",
      newValue: "○○マンション",
    });
  });

  it("既存の建物名は勝手に上書きしない", () => {
    const plan = planOf("b1,新しい名前,東京都荒川区東日暮里3丁目12,,,ChatGPT,", [
      building({ building_name: "既存マンション" }),
    ]);

    expect(plan.rows[0].verdict).toBe("建物名競合");
    expect(plan.rows[0].changes).toHaveLength(0);
  });

  it("丁目・番の住所を号まで詳しくできる", () => {
    const plan = planOf(
      "b1,,東京都荒川区東日暮里3丁目12番5号,,,ChatGPT,",
      [building()],
    );

    expect(plan.rows[0].verdict).toBe("更新可能");
    expect(plan.rows[0].changes[0].field).toBe("address");
  });

  it("別の町名の住所では更新しない", () => {
    const plan = planOf("b1,,東京都荒川区西日暮里3丁目12番5号,,,ChatGPT,", [building()]);

    expect(plan.rows[0].verdict).toBe("住所競合");
    expect(plan.rows[0].changes).toHaveLength(0);
  });

  it("総世帯数を更新できる", () => {
    const plan = planOf("b1,,,32,,ChatGPT,", [building()]);

    expect(plan.rows[0].changes).toEqual([
      { field: "total_units", oldValue: null, newValue: "32" },
    ]);
  });

  it("不正な総世帯数は更新せず要確認にする", () => {
    const plan = planOf("b1,,,約30,,ChatGPT,", [building()]);

    expect(plan.rows[0].verdict).toBe("要確認");
    expect(plan.rows[0].changes).toHaveLength(0);
  });

  it("物件種別を更新できる", () => {
    const plan = planOf("b1,,,,賃貸,ChatGPT,", [building()]);

    expect(plan.rows[0].changes).toEqual([
      { field: "property_type", oldValue: "unknown", newValue: "rental" },
    ]);
  });

  it("同じ CSV を再取込しても変更なしになる", () => {
    const line = "b1,○○マンション,東京都荒川区東日暮里3丁目12,32,賃貸,ChatGPT,";
    const after = building({
      building_name: "○○マンション",
      total_units: 32,
      property_type: "rental",
    });

    expect(planOf(line, [after]).rows[0].verdict).toBe("変更なし");
    expect(planOf(line, [after]).rows[0].changes).toHaveLength(0);
  });

  it("building_id が無い場合、住所が一意なら照合する", () => {
    const plan = planOf(",○○マンション,東京都荒川区東日暮里3丁目12,,,ChatGPT,", [
      building(),
    ]);

    expect(plan.rows[0].verdict).toBe("更新可能");
    expect(plan.rows[0].building_id).toBe("b1");
  });

  it("同じ住所に複数棟あるときは自動確定しない", () => {
    const plan = planOf(",○○マンション,東京都荒川区東日暮里3丁目12,,,ChatGPT,", [
      building({ id: "b1" }),
      building({ id: "b2" }),
    ]);

    expect(plan.rows[0].verdict).toBe("照合不可");
    expect(plan.rows[0].changes).toHaveLength(0);
  });

  it("存在しない building_id は照合不可", () => {
    const plan = planOf("zzz,○○マンション,住所,,,ChatGPT,", [building()]);

    expect(plan.rows[0].verdict).toBe("照合不可");
  });
});

describe("CSV の検証", () => {
  it("必須列が無ければ読み取らない", () => {
    const { rows, errors } = parseAiCsv("building_id,source\nb1,ChatGPT");

    expect(rows).toEqual([]);
    expect(errors[0].message).toContain("必須の列がありません");
  });

  it("building_id の重複を弾く", () => {
    const { errors } = parseAiCsv(
      csv("b1,名前1,住所,,,src,", "b1,名前2,住所,,,src,"),
    );

    expect(errors[0].message).toContain("重複");
  });
});

describe("集計", () => {
  it("判定ごとに数える", () => {
    const { rows } = parseAiCsv(
      csv(
        "b1,○○マンション,東京都荒川区東日暮里3丁目12,,,src,",
        "b2,別名,東京都荒川区東日暮里3丁目12,,,src,",
        "zzz,名前,住所,,,src,",
      ),
    );
    const plan = planAiCsvImport(rows, [
      building({ id: "b1" }),
      building({ id: "b2", building_name: "既存名" }),
    ]);

    expect(plan.counts.updatable).toBe(1);
    expect(plan.counts.needsReview).toBe(1);
    expect(plan.counts.unmatched).toBe(1);
  });
});
