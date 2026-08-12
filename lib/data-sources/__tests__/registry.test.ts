import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DATA_SOURCES,
  getActiveBuildingSource,
  getDataSource,
  listSupportedAreas,
  resolveBuildingDataSource,
} from "../index";

/**
 * 取得元の選択は環境変数だけで決まる純粋なロジックなので、
 * process.env を差し替えて検証する。ネットワークアクセスは一切発生しない。
 */
const ENV_KEYS = [
  "BUILDING_DATA_SOURCE",
  "BUILDING_API_BASE_URL",
  "BUILDING_API_KEY",
  "BUILDING_API_REQUIRES_KEY",
  "NODE_ENV",
  "ALLOW_MOCK_DATA_IN_PRODUCTION",
] as const;

let saved: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
  else (process.env as Record<string, string | undefined>)[key] = value;
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) setEnv(k, undefined);
});

afterEach(() => {
  for (const k of ENV_KEYS) setEnv(k, saved[k]);
});

describe("取得元インターフェース", () => {
  it("すべての取得元が共通インターフェースを満たす", () => {
    for (const source of DATA_SOURCES) {
      expect(typeof source.id).toBe("string");
      expect(source.id.length).toBeGreaterThan(0);
      expect(typeof source.label).toBe("string");
      expect(typeof source.isDevelopment).toBe("boolean");
      expect(typeof source.supportsUnitCount).toBe("boolean");
      expect(typeof source.supportsCoordinates).toBe("boolean");
      expect(typeof source.isAvailable).toBe("function");
      expect(typeof source.listAreas).toBe("function");
      expect(typeof source.fetchByArea).toBe("function");
    }
  });

  it("id が重複していない", () => {
    const ids = DATA_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("id で取得元を引ける", () => {
    expect(getDataSource("mock")?.id).toBe("mock");
    expect(getDataSource("external_api")?.id).toBe("external_api");
    expect(getDataSource("does-not-exist")).toBeNull();
  });
});

describe("BUILDING_DATA_SOURCE による切り替え", () => {
  it("mock を指定すると開発用モックが使われる", () => {
    setEnv("BUILDING_DATA_SOURCE", "mock");
    const r = resolveBuildingDataSource();

    expect(r.active?.id).toBe("mock");
    expect(r.active?.isDevelopment).toBe(true);
    expect(r.unavailableReason).toBeNull();
    expect(r.mode).toBe("explicit");
  });

  it("external_api を指定し接続先が未設定なら、理由付きで利用不可になる", () => {
    setEnv("BUILDING_DATA_SOURCE", "external_api");
    const r = resolveBuildingDataSource();

    expect(r.active).toBeNull();
    expect(r.selected?.id).toBe("external_api");
    expect(r.unavailableReason).toContain("未設定");
    expect(r.unavailableReason).toContain("BUILDING_API_BASE_URL");
  });

  it("接続先が未設定でもモックへ勝手にフォールバックしない", () => {
    setEnv("BUILDING_DATA_SOURCE", "external_api");
    expect(getActiveBuildingSource()).toBeNull();
  });

  it("BASE URL だけ設定し API キーが無ければ、その旨を返す", () => {
    setEnv("BUILDING_DATA_SOURCE", "external_api");
    setEnv("BUILDING_API_BASE_URL", "https://example.invalid");
    const r = resolveBuildingDataSource();

    expect(r.active).toBeNull();
    expect(r.unavailableReason).toContain("BUILDING_API_KEY");
  });

  it("API キー不要の提供元は BASE URL だけで利用可能になる", () => {
    setEnv("BUILDING_DATA_SOURCE", "external_api");
    setEnv("BUILDING_API_BASE_URL", "https://example.invalid");
    setEnv("BUILDING_API_REQUIRES_KEY", "false");
    const r = resolveBuildingDataSource();

    expect(r.active?.id).toBe("external_api");
    expect(r.unavailableReason).toBeNull();
  });

  it("不明な値を指定した場合はクラッシュせず、指定可能な値を案内する", () => {
    setEnv("BUILDING_DATA_SOURCE", "homes_scraper");
    const r = resolveBuildingDataSource();

    expect(r.active).toBeNull();
    expect(r.selected).toBeNull();
    expect(r.unavailableReason).toContain("homes_scraper");
    expect(r.unavailableReason).toContain("external_api");
  });
});

describe("既定値", () => {
  it("未指定かつ開発環境ではモックが既定になる", () => {
    setEnv("NODE_ENV", "development");
    const r = resolveBuildingDataSource();

    expect(r.selectedId).toBe("mock");
    expect(r.active?.id).toBe("mock");
    expect(r.mode).toBe("default");
  });

  it("未指定かつ本番環境ではモックへ自動的に切り替えない", () => {
    setEnv("NODE_ENV", "production");
    const r = resolveBuildingDataSource();

    expect(r.active).toBeNull();
    expect(r.selectedId).toBe("external_api");
    expect(r.unavailableReason).toBeTruthy();
  });

  it("本番環境では明示指定しても mock を使わせない", () => {
    // 開発用データが実データに混ざると、あとから見分けて消す作業が必要になる。
    // 実際に混入したため、明示指定でも本番では拒否する。
    setEnv("NODE_ENV", "production");
    setEnv("BUILDING_DATA_SOURCE", "mock");
    const r = resolveBuildingDataSource();

    expect(r.active).toBeNull();
    expect(r.selected?.id).toBe("mock");
    expect(r.unavailableReason).toContain("本番環境では開発用モックデータを使用できません");
  });

  it("本番環境でも明示的な例外指定があれば mock を使える", () => {
    // 本番同等環境での動作確認など、意図的な場合のみ通す
    setEnv("NODE_ENV", "production");
    setEnv("BUILDING_DATA_SOURCE", "mock");
    setEnv("ALLOW_MOCK_DATA_IN_PRODUCTION", "1");
    const r = resolveBuildingDataSource();

    expect(r.active?.id).toBe("mock");
  });
});

describe("対応エリア", () => {
  it("使用中の取得元の対応エリアだけを返す", () => {
    setEnv("BUILDING_DATA_SOURCE", "mock");
    const areas = listSupportedAreas();

    expect(areas).toHaveLength(1);
    expect(areas[0].prefecture).toBe("東京都");
    expect(areas[0].city).toBe("荒川区");
  });

  it("使用できる取得元が無ければ空を返す（クラッシュしない）", () => {
    setEnv("BUILDING_DATA_SOURCE", "external_api");
    expect(listSupportedAreas()).toEqual([]);
  });
});

describe("ネットワークアクセスの抑止", () => {
  it("未設定の外部 API は fetch せずに例外を投げる", async () => {
    setEnv("BUILDING_DATA_SOURCE", "external_api");
    const source = getDataSource("external_api")!;

    await expect(
      source.fetchByArea({ prefecture: "東京都", city: "荒川区" }),
    ).rejects.toThrow(/未設定/);
  });
});
