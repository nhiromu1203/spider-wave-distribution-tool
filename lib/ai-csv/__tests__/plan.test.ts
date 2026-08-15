import { describe, expect, it } from "vitest";
import {
  AI_CSV_COLUMNS,
  decideAddress,
  parseAiCsv,
  parsePropertyType,
  parseSource,
  parseTotalUnits,
  planAiCsvImport,
  UNKNOWN_NAME,
  type CurrentBuilding,
} from "../plan";

const HEADER =
  "building_id,building_name,current_address,address,total_units,property_type,source,note";

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

/** 列の並びに依存せず、必要な項目だけ指定して1行を作る */
function row(over: Partial<Record<string, string>> = {}): string {
  const v = {
    building_id: "b1",
    building_name: "",
    current_address: "",
    address: "",
    total_units: "",
    property_type: "",
    source: "chatgpt",
    note: "",
    ...over,
  };
  return [
    v.building_id,
    v.building_name,
    v.current_address,
    v.address,
    v.total_units,
    v.property_type,
    v.source,
    v.note,
  ].join(",");
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
    const plan = planOf(row({ building_name: "○○マンション" }), [building()]);

    expect(plan.rows[0].verdict).toBe("更新可能");
    expect(plan.rows[0].changes[0]).toMatchObject({
      field: "building_name",
      newValue: "○○マンション",
    });
  });

  it("既存の建物名は勝手に上書きしない", () => {
    const plan = planOf(row({ building_name: "新しい名前" }), [
      building({ building_name: "既存マンション" }),
    ]);

    expect(plan.rows[0].verdict).toBe("建物名競合");
    expect(plan.rows[0].changes).toHaveLength(0);
  });

  it("丁目・番の住所を号まで詳しくできる", () => {
    const plan = planOf(row({ address: "東京都荒川区東日暮里3丁目12番5号" }), [building()]);

    expect(plan.rows[0].verdict).toBe("更新可能");
    expect(plan.rows[0].changes[0].field).toBe("address");
  });

  it("別の町名の住所では更新しない", () => {
    const plan = planOf(row({ address: "東京都荒川区西日暮里3丁目12番5号" }), [building()]);

    expect(plan.rows[0].verdict).toBe("住所競合");
    expect(plan.rows[0].changes).toHaveLength(0);
  });

  it("総世帯数を更新できる", () => {
    const plan = planOf(row({ total_units: "32" }), [building()]);

    expect(plan.rows[0].changes).toEqual([
      { field: "total_units", oldValue: null, newValue: "32" },
    ]);
  });

  it("不正な総世帯数は更新せず要確認にする", () => {
    const plan = planOf(row({ total_units: "約30" }), [building()]);

    expect(plan.rows[0].verdict).toBe("要確認");
    expect(plan.rows[0].changes).toHaveLength(0);
  });

  it("物件種別を更新できる", () => {
    const plan = planOf(row({ property_type: "賃貸" }), [building()]);

    expect(plan.rows[0].changes).toEqual([
      { field: "property_type", oldValue: "unknown", newValue: "rental" },
    ]);
  });

  it("同じ CSV を再取込しても変更なしになる", () => {
    const line = row({
      building_name: "○○マンション",
      total_units: "32",
      property_type: "賃貸",
    });
    const after = building({
      building_name: "○○マンション",
      total_units: 32,
      property_type: "rental",
    });

    expect(planOf(line, [after]).rows[0].verdict).toBe("変更なし");
    expect(planOf(line, [after]).rows[0].changes).toHaveLength(0);
  });

  it("building_id が無い場合、住所が一意なら照合する", () => {
    const plan = planOf(
      row({
        building_id: "",
        building_name: "○○マンション",
        address: "東京都荒川区東日暮里3丁目12",
      }),
      [building()],
    );

    expect(plan.rows[0].verdict).toBe("更新可能");
    expect(plan.rows[0].building_id).toBe("b1");
  });

  it("同じ住所に複数棟あるときは自動確定しない", () => {
    const plan = planOf(row({ building_id: "", address: "東京都荒川区東日暮里3丁目12" }), [
      building({ id: "b1" }),
      building({ id: "b2" }),
    ]);

    expect(plan.rows[0].verdict).toBe("照合不可");
    expect(plan.rows[0].changes).toHaveLength(0);
  });

  it("存在しない building_id は照合不可", () => {
    const plan = planOf(row({ building_id: "zzz", building_name: "○○マンション" }), [building()]);

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
      csv(row({ building_name: "名前1" }), row({ building_name: "名前2" })),
    );

    expect(errors[0].message).toContain("重複");
  });
});

describe("集計", () => {
  it("判定ごとに数える", () => {
    const { rows } = parseAiCsv(
      csv(
        row({ building_id: "b1", building_name: "○○マンション" }),
        row({ building_id: "b2", building_name: "別名" }),
        row({ building_id: "zzz", building_name: "名前" }),
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

describe("物件種別の表記ゆれ", () => {
  it("賃貸を含む書き方は rental にする", () => {
    for (const v of ["賃貸マンション", "賃貸アパート", "賃貸物件"]) {
      expect(parsePropertyType(v), v).toEqual({ ok: true, value: "rental" });
    }
  });

  it("分譲を含む書き方は condominium にする", () => {
    for (const v of ["分譲マンション", "分譲住宅"]) {
      expect(parsePropertyType(v), v).toMatchObject({ value: "condominium" });
    }
  });

  it("賃貸と分譲の両方を含むものは決めつけない", () => {
    // 「分譲賃貸」は分譲物件を賃貸に出しているもので、
    // どちらとして扱うべきか一意に決まらない。推測しない。
    for (const v of ["賃貸・分譲", "分譲賃貸"]) {
      const r = parsePropertyType(v) as { ok: false; reason: string };
      expect(r.ok, v).toBe(false);
      expect(r.reason).toContain("判断できません");
    }
  });

  it("どちらとも読めない語は変換しない", () => {
    expect(parsePropertyType("マンション").ok).toBe(false);
    expect(parsePropertyType("戸建").ok).toBe(false);
  });
});

describe("source は決められた値のみ", () => {
  it("許可された値を受け付ける", () => {
    for (const v of ["chatgpt", "claude", "homes", "suumo", "google_maps", "manual"]) {
      expect(parseSource(v), v).toEqual({ ok: true, value: v });
    }
  });

  it("大文字小文字と空白の違いは吸収する", () => {
    expect(parseSource(" ChatGPT ")).toEqual({ ok: true, value: "chatgpt" });
    expect(parseSource("Google Maps")).toEqual({ ok: true, value: "google_maps" });
  });

  it("一覧に無い値は受け付けない", () => {
    const r = parseSource("HOME'S・SUUMO等で確認") as { ok: false; reason: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("使えません");
  });

  it("未記入も受け付けない", () => {
    expect(parseSource("").ok).toBe(false);
  });

  it("source が不正な行は、変更内容があっても要確認にする", () => {
    const plan = planOf(
      row({ building_name: "○○マンション", source: "ネット検索" }),
      [building()],
    );

    expect(plan.rows[0].verdict).toBe("要確認");
  });
});

describe("テンプレートの列", () => {
  it("current_address を含む", () => {
    expect(AI_CSV_COLUMNS).toContain("current_address");
  });

  it("current_address は参考欄で、更新には使わない", () => {
    // 現在住所の欄に別の住所が入っていても、address 側が空なら何も変えない
    const plan = planOf(
      row({ current_address: "東京都荒川区西日暮里9丁目99", building_name: "○○" }),
      [building()],
    );

    expect(plan.rows[0].changes.map((c) => c.field)).toEqual(["building_name"]);
  });
});
