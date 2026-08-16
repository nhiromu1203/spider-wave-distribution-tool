import { describe, expect, it } from "vitest";
import { ingestBuildings, type BuildingInput } from "../ingest";
import {
  normalizeAddress,
  normalizeBuildingName,
} from "@/lib/building-matching";

/**
 * 過去配布リストの照合。
 *
 * ── 判定の条件 ──────────────────────────────────────────────
 * 「住所が一致」または「建物名が一致」のどちらかで、同じ物件として
 * 配布実績を紐付ける（＝配布対象一覧から外れる）。
 *
 * 過去配布リストは住所の書き方も建物名の書き方も揃っていないため、
 * 片方だけが一致することがよくある。
 *
 * 建物名は正規化したうえでの完全一致で判定する。部分一致は使わない
 * （別の建物を巻き込むため）。
 * ────────────────────────────────────────────────────────────
 */

type Row = {
  id: string;
  building_name: string;
  address: string;
  normalized_address: string;
  normalized_building_name: string;
  distribution_count: number;
  latitude: number | null;
  longitude: number | null;
  source_ref: string | null;
  city: string | null;
  status: string;
};

function building(name: string, address: string, id = name): Row {
  return {
    id,
    building_name: name,
    address,
    normalized_address: normalizeAddress(address),
    normalized_building_name: normalizeBuildingName(name),
    distribution_count: 0,
    latitude: null,
    longitude: null,
    source_ref: null,
    city: "荒川区",
    status: "NOT_DISTRIBUTED",
  };
}

/**
 * 本物の ingest を動かすための最小限の Supabase 代役。
 * どの建物へ配布実績が付いたかを記録する。
 */
function fakeSupabase(rows: Row[]) {
  const history: Array<{ building_id: string }> = [];

  const match = (row: Row, column: string, values: string[]) =>
    values.includes(String((row as unknown as Record<string, unknown>)[column]));

  const builder = (table: string) => {
    const state = { rows: [...rows], filtered: [...rows] };

    const api: Record<string, unknown> = {
      select: () => api,
      limit: () => api,
      gt: (column: string) => {
        state.filtered = state.filtered.filter(
          (r) => Number((r as unknown as Record<string, unknown>)[column]) > 0,
        );
        return api;
      },
      not: () => {
        state.filtered = state.filtered.filter((r) => r.latitude !== null);
        return api;
      },
      in: (column: string, values: string[]) => {
        state.filtered = state.filtered.filter((r) => match(r, column, values));
        return api;
      },
      eq: () => api,
      insert: (payload: Record<string, unknown>) => {
        if (table === "distribution_history") {
          history.push({ building_id: String(payload.building_id) });
        }
        return {
          select: () => ({
            single: async () => ({ data: null, error: { message: "登録しない" } }),
          }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      upsert: async () => ({ error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: table === "buildings" ? state.filtered : [], error: null }),
    };
    return api;
  };

  return {
    client: { from: (table: string) => builder(table) },
    history,
  };
}

function distributionRow(
  address: string,
  buildingName: string,
): BuildingInput {
  return {
    building_name: buildingName,
    address,
    distribution: { distributed_date: "2026-01-01" },
  } as BuildingInput;
}

async function ingest(rows: Row[], input: BuildingInput) {
  const { client, history } = fakeSupabase(rows);
  const summary = await ingestBuildings(
    client as never,
    [input],
    { source: "import", skipUnmatched: true },
  );
  return { summary, history };
}

const EXISTING = building("メゾン丸十", "東京都荒川区西日暮里2丁目26番10号");

describe("住所が一致すれば配布済みにする", () => {
  it("表記が違っても同じ住所なら紐付く", async () => {
    const { history } = await ingest(
      [EXISTING],
      distributionRow("荒川区西日暮里２ー２６ー１０", "メゾン丸十"),
    );

    expect(history).toHaveLength(1);
    expect(history[0].building_id).toBe("メゾン丸十");
  });
});

describe("建物名が一致すれば配布済みにする", () => {
  it("住所が違っても建物名が一致すれば紐付く", async () => {
    const { history } = await ingest(
      [EXISTING],
      distributionRow("東京都荒川区東日暮里9丁目99番9号", "メゾン丸十"),
    );

    expect(history).toHaveLength(1);
    expect(history[0].building_id).toBe("メゾン丸十");
  });

  it("全角・大小文字・中黒・ハイフンの違いを吸収する", async () => {
    const existing = building("ＭＥＺＯＮ・丸十", "東京都荒川区西日暮里2丁目26番10号");
    const { history } = await ingest(
      [existing],
      distributionRow("東京都荒川区東日暮里9丁目99番9号", "mezon･丸十"),
    );

    expect(history).toHaveLength(1);
  });
});

describe("住所が一致すれば建物名が違っても配布済みにする", () => {
  it("建物名が別でも住所が同じなら紐付く", async () => {
    const { history } = await ingest(
      [EXISTING],
      distributionRow("東京都荒川区西日暮里2丁目26番10号", "まったく別の名前"),
    );

    expect(history).toHaveLength(1);
    expect(history[0].building_id).toBe("メゾン丸十");
  });
});

describe("どちらも一致しなければ配布済みにしない", () => {
  it("住所も建物名も違う行は紐付かない", async () => {
    const { summary, history } = await ingest(
      [EXISTING],
      distributionRow("東京都荒川区東日暮里9丁目99番9号", "存在しないマンション"),
    );

    expect(history).toHaveLength(0);
    expect(summary.counts.skipped).toBe(1);
  });

  it("建物名の部分一致では紐付かない", async () => {
    // 「メゾン丸十」に対する「メゾン丸十第二」。別の建物なので巻き込まない
    const { history } = await ingest(
      [EXISTING],
      distributionRow("東京都荒川区東日暮里9丁目99番9号", "メゾン丸十第二"),
    );

    expect(history).toHaveLength(0);
  });
});

describe("照合に使えない行", () => {
  it("住所も建物名も空なら判定に使わない", async () => {
    const { summary, history } = await ingest([EXISTING], distributionRow("", ""));

    expect(history).toHaveLength(0);
    expect(summary.counts.skipped).toBe(1);
  });

  it("住所が空でも建物名があれば照合できる", async () => {
    const { history } = await ingest([EXISTING], distributionRow("", "メゾン丸十"));

    expect(history).toHaveLength(1);
  });
});
