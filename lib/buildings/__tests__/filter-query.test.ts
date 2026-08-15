import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applyCommonFilters, combineOrGroups } from "../queries";
import type { BuildingFilters } from "../filters";

/**
 * PostgREST へ送る絞り込み条件の検証。
 *
 * ── 実際に起きた不具合 ──────────────────────────────────────
 * 都道府県用と世帯数用で .or() を 2 回呼んでいたため、URL が
 *   ?or=(prefecture.eq."東京都",prefecture.is.null)&or=(total_units.gte.6,...)
 * となり、PostgREST が片方しか解釈せず prefecture の条件が消えた。
 * その結果 prefecture が NULL の配布済み 3 件が集計から漏れ、
 * 画面の「配布済み」が 5 件ではなく 2 件になっていた。
 *
 * 対策として OR グループを 1 本の or へまとめる。
 */

describe("OR 条件の結合", () => {
  it("グループが無ければ null（or を付けない）", () => {
    expect(combineOrGroups([])).toBeNull();
    expect(combineOrGroups([[]])).toBeNull();
  });

  it("1 グループならそのまま列挙する", () => {
    expect(combineOrGroups([["total_units.gte.6", "total_units.is.null"]])).toBe(
      "total_units.gte.6,total_units.is.null",
    );
  });

  it("2 グループは直積を取って and で入れ子にする", () => {
    const combined = combineOrGroups([
      ["prefecture.eq.東京都", "prefecture.is.null"],
      ["total_units.gte.6", "total_units.is.null"],
    ]);

    // (A1 or A2) and (B1 or B2) を or=(and(...),...) で表現する
    expect(combined).toBe(
      [
        "and(prefecture.eq.東京都,total_units.gte.6)",
        "and(prefecture.eq.東京都,total_units.is.null)",
        "and(prefecture.is.null,total_units.gte.6)",
        "and(prefecture.is.null,total_units.is.null)",
      ].join(","),
    );
  });

  it("3 グループでも全組み合わせを網羅する", () => {
    const combined = combineOrGroups([
      ["a1", "a2"],
      ["b1", "b2", "b3"],
      ["c1", "c2"],
    ]);
    const terms = combined!.split("),and(");

    // 2 × 3 × 2 = 12 通り
    expect(terms).toHaveLength(12);
    // どの組み合わせも 3 条件を含む
    expect(combined).toContain("and(a1,b1,c1)");
    expect(combined).toContain("and(a2,b3,c2)");
  });

  it("空のグループは無視する", () => {
    expect(combineOrGroups([[], ["x", "y"], []])).toBe("x,y");
  });
});

describe("生成される条件の意味", () => {
  it("世帯数不明を除外しない条件が保たれる", () => {
    const combined = combineOrGroups([
      ["total_units.gte.6", "total_units.is.null"],
    ])!;
    // NULL を拾う項が必ず残っていること
    expect(combined).toContain("total_units.is.null");
  });

  it("キーワードと世帯数を同時に指定しても両方が効く", () => {
    const combined = combineOrGroups([
      [
        "building_name.ilike.%メゾン%",
        "address.ilike.%メゾン%",
        "normalized_address.ilike.%メゾン%",
      ],
      ["total_units.gte.6", "total_units.is.null"],
    ])!;

    // 3 × 2 = 6 通りすべてに世帯数条件が入る
    const terms = combined.split("),and(");
    expect(terms).toHaveLength(6);
    for (const term of terms) {
      expect(term).toMatch(/total_units\.(gte\.6|is\.null)/);
      expect(term).toMatch(/ilike/);
    }
  });
});

describe("実際に送信される URL の検証", () => {
  /** 送信せずに URL だけを取り出す supabase クライアント */
  async function captureUrl(
    build: (client: SupabaseClient) => PromiseLike<unknown>,
  ): Promise<URL> {
    const captured: string[] = [];
    const client = createClient("https://example.supabase.co", "dummy", {
      global: {
        fetch: async (url) => {
          captured.push(String(url));
          return new Response("[]", {
            status: 200,
            headers: { "Content-Range": "0-0/0" },
          });
        },
      },
    });
    await build(client);
    return new URL(captured[0]);
  }

  const baseFilters: BuildingFilters = {
    prefecture: "東京都",
    city: "荒川区",
    town: null,
    keyword: null,
    minUnits: 6,
    includeUnknownUnits: true,
    propertyTypes: ["rental", "condominium", "unknown"],
    statuses: ["CONFIRMED_DISTRIBUTED"],
    sort: "address_asc",
    page: 1,
  };

  it("or パラメータが 2 つ以上にならない（重複すると条件が消える）", async () => {
    const url = await captureUrl((client) =>
      applyCommonFilters(
        client.from("buildings").select("id").in("status", baseFilters.statuses),
        baseFilters,
      ) as PromiseLike<unknown>,
    );

    expect(url.searchParams.getAll("or").length).toBeLessThanOrEqual(1);
  });

  it("キーワードと世帯数を同時指定しても or は 1 つ", async () => {
    const url = await captureUrl((client) =>
      applyCommonFilters(
        client.from("buildings").select("id").in("status", baseFilters.statuses),
        { ...baseFilters, keyword: "メゾン" },
      ) as PromiseLike<unknown>,
    );

    expect(url.searchParams.getAll("or")).toHaveLength(1);
    const or = url.searchParams.get("or")!;
    expect(or).toContain("total_units.is.null");
    expect(or).toContain("ilike");
  });

  it("市区町村で都道府県が一意に定まるなら prefecture 条件を付けない", async () => {
    // 「荒川区」は東京都にしか存在しないため、city だけで地域が確定する。
    // prefecture を条件に入れると、値が NULL の行が落ちてしまう。
    const url = await captureUrl((client) =>
      applyCommonFilters(
        client.from("buildings").select("id").in("status", baseFilters.statuses),
        baseFilters,
      ) as PromiseLike<unknown>,
    );

    expect(url.searchParams.has("prefecture")).toBe(false);
    expect(url.searchParams.get("city")).toBe("eq.荒川区");
  });

  it("市区町村が未指定なら prefecture で厳密に絞る", async () => {
    const url = await captureUrl((client) =>
      applyCommonFilters(
        client.from("buildings").select("id").in("status", baseFilters.statuses),
        { ...baseFilters, city: null },
      ) as PromiseLike<unknown>,
    );

    expect(url.searchParams.get("prefecture")).toBe("eq.東京都");
  });

  it("他都道府県のデータが混ざらない（city 条件は必ず付く）", async () => {
    const url = await captureUrl((client) =>
      applyCommonFilters(
        client.from("buildings").select("id").in("status", baseFilters.statuses),
        baseFilters,
      ) as PromiseLike<unknown>,
    );

    expect(url.searchParams.get("city")).toBe("eq.荒川区");
  });
});
