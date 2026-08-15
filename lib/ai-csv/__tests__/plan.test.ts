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
  "building_id,building_name,current_address,address,total_units,property_type,building_type,source,note";

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
    building_type: null,
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
    building_type: "",
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
    v.building_type,
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

  it("同じ住所に複数棟あるときは自動確定せず、人の確認に回す", () => {
    const plan = planOf(row({ building_id: "", address: "東京都荒川区東日暮里3丁目12" }), [
      building({ id: "b1" }),
      building({ id: "b2" }),
    ]);

    expect(plan.rows[0].verdict).toBe("要確認");
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

describe("号まで一致しない住所の照合", () => {
  /**
   * 実際に起きた不具合。
   * CSV は「3丁目12番5号」、DB は「3丁目12」で、完全一致しないため
   * 照合不可になり、画面で建物名が「—」総世帯数が「不明」と表示されていた。
   */
  it("街区に1件だけなら、号が余分でも照合する", () => {
    const plan = planOf(
      row({
        building_id: "",
        building_name: "コーポ東尾久",
        address: "東京都荒川区東日暮里3丁目12番5号",
        total_units: "32",
      }),
      [building()],
    );

    expect(plan.rows[0].verdict).toBe("更新可能");
    expect(plan.rows[0].matched?.id).toBe("b1");
    expect(plan.rows[0].changes.map((c) => c.field)).toContain("building_name");
    expect(plan.rows[0].changes.map((c) => c.field)).toContain("total_units");
  });

  it("街区に複数あるときは自動確定せず、人の確認に回す", () => {
    const plan = planOf(
      row({ building_id: "", address: "東京都荒川区東日暮里3丁目12番5号" }),
      [building({ id: "b1" }), building({ id: "b2" })],
    );

    expect(plan.rows[0].verdict).toBe("要確認");
    expect(plan.rows[0].changes).toHaveLength(0);
    expect(plan.rows[0].reasons.join()).toContain("決められません");
  });

  it("別の街区には広がらない", () => {
    const plan = planOf(
      row({ building_id: "", address: "東京都荒川区東日暮里3丁目99番1号" }),
      [building()],
    );

    expect(plan.rows[0].verdict).toBe("照合不可");
  });
});

describe("上書きモード", () => {
  const line = row({
    building_name: "新しい名前",
    total_units: "40",
    property_type: "分譲",
    building_type: "マンション",
  });
  const existing = building({
    building_name: "既存マンション",
    total_units: 10,
    property_type: "rental",
    building_type: "アパート",
  });

  function planWith(overwrite: boolean) {
    const { rows } = parseAiCsv(csv(line));
    return planAiCsvImport(rows, [existing], { overwriteExisting: overwrite });
  }

  it("既定では既存の建物名を守る", () => {
    expect(planWith(false).rows[0].verdict).toBe("建物名競合");
  });

  it("上書きモードでは4項目すべてを置き換える", () => {
    const r = planWith(true).rows[0];

    expect(r.verdict).toBe("更新可能");
    expect(r.changes.map((c) => c.field).sort()).toEqual([
      "building_name",
      "building_type",
      "property_type",
      "total_units",
    ]);
  });

  it("上書きモードでも住所の規則は変えない", () => {
    const { rows } = parseAiCsv(
      csv(row({ address: "東京都荒川区西日暮里3丁目12番5号" })),
    );
    const plan = planAiCsvImport(rows, [building()], { overwriteExisting: true });

    expect(plan.rows[0].verdict).toBe("住所競合");
    expect(plan.rows[0].changes).toHaveLength(0);
  });
});

describe("建物種別", () => {
  it("未設定なら更新できる", () => {
    const plan = planOf(row({ building_type: "マンション" }), [building()]);

    expect(plan.rows[0].changes).toEqual([
      { field: "building_type", oldValue: null, newValue: "マンション" },
    ]);
  });

  it("同じ値なら変更なし", () => {
    const plan = planOf(row({ building_type: "アパート" }), [
      building({ building_type: "アパート" }),
    ]);

    expect(plan.rows[0].verdict).toBe("変更なし");
  });
});

describe("住所だけで照合する（building_id は必須にしない）", () => {
  function planNoId(over: Record<string, string>, db: CurrentBuilding[], create = true) {
    const { rows } = parseAiCsv(csv(row({ building_id: "", ...over })));
    return planAiCsvImport(rows, db, { allowCreate: create });
  }

  it("① 正規化住所が完全一致して1件なら更新できる", () => {
    const plan = planNoId(
      { building_name: "○○マンション", address: "東京都荒川区東日暮里3-12" },
      [building()],
    );

    expect(plan.rows[0].verdict).toBe("更新可能");
    expect(plan.rows[0].matched?.id).toBe("b1");
  });

  it("② 同一住所に複数あっても建物名が一致すれば絞れる", () => {
    const plan = planNoId(
      { building_name: "コーポ東尾久", address: "東京都荒川区東日暮里3丁目12", total_units: "20" },
      [
        building({ id: "b1", building_name: "コーポ東尾久" }),
        building({ id: "b2", building_name: "メゾン丸十" }),
      ],
    );

    expect(plan.rows[0].verdict).toBe("更新可能");
    expect(plan.rows[0].matched?.id).toBe("b1");
    expect(plan.rows[0].reasons.join()).toContain("建物名の一致");
  });

  it("④ 同一住所に複数あり建物名でも絞れないなら要確認", () => {
    const plan = planNoId(
      { building_name: "別の名前", address: "東京都荒川区東日暮里3丁目12" },
      [building({ id: "b1" }), building({ id: "b2" })],
    );

    expect(plan.rows[0].verdict).toBe("要確認");
    expect(plan.rows[0].changes).toHaveLength(0);
  });

  it("DB に無ければ新規登録の候補になる", () => {
    const plan = planNoId(
      {
        building_name: "新築マンション",
        address: "東京都荒川区南千住5丁目10番3号",
        total_units: "24",
        property_type: "賃貸",
        building_type: "マンション",
      },
      [building()],
    );

    expect(plan.rows[0].verdict).toBe("新規登録");
    expect(plan.rows[0].matched).toBeNull();
    expect(plan.rows[0].changes.map((c) => c.field).sort()).toEqual([
      "address",
      "building_name",
      "building_type",
      "property_type",
      "total_units",
    ]);
  });

  it("新規登録を許可しなければ照合不可のまま", () => {
    const plan = planNoId(
      { building_name: "新築マンション", address: "東京都荒川区南千住5丁目10番3号" },
      [building()],
      false,
    );

    expect(plan.rows[0].verdict).toBe("照合不可");
  });

  it("別の号の建物には寄せない（3-12-9 の DB に 3-12-5 の CSV）", () => {
    const plan = planNoId(
      { building_name: "新しい建物", address: "東京都荒川区東日暮里3丁目12番5号" },
      [building({ address: "東京都荒川区東日暮里3丁目12番9号" })],
    );

    // 同じ街区でも号が違えば別の建物。既存へは寄せず新規登録にする
    expect(plan.rows[0].verdict).toBe("新規登録");
  });
});

describe("新規登録の条件", () => {
  function newPlan(over: Record<string, string>) {
    const { rows } = parseAiCsv(csv(row({ building_id: "", ...over })));
    return planAiCsvImport(rows, [], { allowCreate: true }).rows[0];
  }

  it("戸数が分かっていて6戸未満なら登録しない", () => {
    expect(
      newPlan({
        building_name: "小さな建物",
        address: "東京都荒川区南千住5丁目10番3号",
        total_units: "4",
      }).verdict,
    ).toBe("照合不可");
  });

  it("6戸以上なら登録する", () => {
    expect(
      newPlan({
        building_name: "大きな建物",
        address: "東京都荒川区南千住5丁目10番3号",
        total_units: "6",
      }).verdict,
    ).toBe("新規登録");
  });

  it("戸数不明なら登録する（推測で除外しない）", () => {
    expect(
      newPlan({
        building_name: "戸数不明の建物",
        address: "東京都荒川区南千住5丁目10番3号",
      }).verdict,
    ).toBe("新規登録");
  });

  it("建物名が無ければ登録しない", () => {
    expect(
      newPlan({ address: "東京都荒川区南千住5丁目10番3号" }).verdict,
    ).toBe("照合不可");
  });

  it("番まで読めない住所は登録しない", () => {
    expect(
      newPlan({ building_name: "住所が粗い建物", address: "東京都荒川区南千住" })
        .verdict,
    ).toBe("照合不可");
  });
});

describe("漢数字の丁目", () => {
  /**
   * 実データで発覚した不具合。
   * 位置参照情報から補完した住所は「西日暮里二丁目26」の形で入るのに対し、
   * 調査結果は「西日暮里2丁目26番10号」と書かれる。
   * 漢数字を直さずに比べていたため、既存建物が見つからず
   * すべて新規登録として扱われていた。
   */
  const db = building({
    id: "b1",
    address: "東京都荒川区西日暮里二丁目26",
  });

  it("漢数字と算用数字の丁目を同じものとして扱う", () => {
    const { rows } = parseAiCsv(
      csv(
        row({
          building_id: "",
          building_name: "メゾン丸十",
          address: "東京都荒川区西日暮里2丁目26番10号",
          total_units: "12",
        }),
      ),
    );
    const plan = planAiCsvImport(rows, [db], { allowCreate: true });

    expect(plan.rows[0].verdict).toBe("更新可能");
    expect(plan.rows[0].matched?.id).toBe("b1");
  });

  it("漢数字でも丁目が違えば別の建物", () => {
    const { rows } = parseAiCsv(
      csv(
        row({
          building_id: "",
          building_name: "別の建物",
          address: "東京都荒川区西日暮里3丁目26番10号",
        }),
      ),
    );
    const plan = planAiCsvImport(rows, [db], { allowCreate: true });

    expect(plan.rows[0].verdict).toBe("新規登録");
  });

  it("十一丁目のような表記も扱える", () => {
    const { rows } = parseAiCsv(
      csv(
        row({
          building_id: "",
          building_name: "テスト",
          address: "東京都荒川区○○11丁目5番1号",
        }),
      ),
    );
    const plan = planAiCsvImport(
      rows,
      [building({ id: "x", address: "東京都荒川区○○十一丁目5" })],
      { allowCreate: true },
    );

    expect(plan.rows[0].verdict).toBe("更新可能");
  });
});
