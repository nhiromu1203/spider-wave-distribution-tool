import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateNameSimilarity,
  distanceInMeters,
  matchBuilding,
  normalizeAddressDetailed,
  normalizeBuildingNameDetailed,
  parseAddressParts,
} from "@/lib/building-matching";
import {
  classifyBuildingUse,
  type BuildingUseJudgement,
} from "@/lib/data-sources/building-use";
import {
  isDevelopmentData,
  UNKNOWN_BUILDING_NAME,
} from "@/lib/data-sources/types";
import { chunkForInFilter, filterBytes } from "./query-batch";
import type {
  BuildingRow,
  BuildingSource,
  PropertyType,
} from "@/lib/supabase/types";

/**
 * 取り込み対象の 1 行。取得元（過去配布 CSV / 建物データソース）を問わない共通形。
 * lib/data-sources の SourceBuilding はそのままこの型として渡せる。
 */
export type BuildingInput = {
  building_name: string;
  address: string;
  /**
   * エリア。取得元が構造化データを持っていれば渡す。
   * 未指定なら住所文字列から解析する。
   */
  prefecture?: string | null;
  city?: string | null;
  town?: string | null;
  total_units?: number | null;
  property_type?: PropertyType;
  /** 建物用途の生の値（OSM の building タグ値、または日本語表記） */
  building_use_raw?: string | null;
  /** 住所の出所（"source" = 取得元が持っていた / "isj" などは補完） */
  address_source?: string | null;
  /** 住所の粒度（"housenumber" | "block" | "town"） */
  address_precision?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source_ref?: string | null;
  /** 過去配布リストの取込時のみ指定する */
  distribution?: {
    distributed_date: string;
    distributed_by?: string | null;
    notes?: string | null;
  } | null;
};

export type IngestOutcome =
  /** 新規に建物として登録した */
  | "inserted"
  /** 既存の建物レコードに統合した */
  | "merged"
  /** 住所一致で配布済みと確定したため、未配布一覧には追加しなかった */
  | "already_distributed"
  /** 重複候補として登録し、人間の確認待ちにした */
  | "possible_duplicate"
  /** 住所が無いなど、登録できなかった */
  | "skipped"
  /** 住居用途の集合住宅ではないため登録しなかった（戸建て・店舗・オフィス等） */
  | "excluded_use";

export type IngestRowResult = {
  input: BuildingInput;
  outcome: IngestOutcome;
  buildingId: string | null;
  message: string | null;
};

export type IngestSummary = {
  results: IngestRowResult[];
  counts: Record<IngestOutcome, number>;
  /** 用途を判定できなかったために除外した件数（excluded_use の内数） */
  excludedAsUnknownUse: number;
  /**
   * 座標は近いが統合しなかった件数と理由。
   * 誤統合を避けて別行にした分なので、多い場合は目視確認の手掛かりになる。
   */
  nearMisses: string[];
};

type Client = SupabaseClient;

/**
 * 開発用データを本番 DB へ書き込ませないための最終防衛線。
 *
 * 取得元の設定ミスや、開発環境の設定を持ち込んだデプロイでも
 * モックデータが実データに混ざらないようにする。
 * 一度混入すると、見分けて消す作業が必要になる（実際に発生した）。
 */
function rejectsDevelopmentData(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_MOCK_DATA_IN_PRODUCTION !== "1"
  );
}

/**
 * Supabase への問い合わせを実行し、失敗したら原因を残したまま投げ直す。
 *
 * supabase-js はネットワーク層の失敗を
 *   message: "TypeError: fetch failed"
 *   details: "Caused by: ..."（本当の原因はここ）
 * という形で返す。message だけを見ると原因が分からないため、
 * details / code / hint と問い合わせ内容をすべて残す。
 *
 * fetch 自体の失敗は一時的なことがあるため、1 回だけやり直す。
 */
type QueryResult<T> = {
  data: T | null;
  error: {
    message?: string;
    code?: string;
    details?: string;
    hint?: string;
  } | null;
  status?: number;
  statusText?: string;
};

async function runQuery<T>(
  label: string,
  context: Record<string, unknown>,
  run: () => PromiseLike<QueryResult<T>>,
): Promise<T> {
  const endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(未設定)";

  for (let attempt = 0; attempt <= 1; attempt++) {
    const { data, error, status, statusText } = await run();
    if (!error) return (data ?? []) as T;

    const combined = `${error.message ?? ""} ${error.details ?? ""}`;
    const isNetworkFailure =
      /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket/i.test(combined);

    console.error(
      `[Supabase] ${label} に失敗:`,
      JSON.stringify(
        {
          処理: label,
          接続先: endpoint,
          問い合わせ内容: context,
          httpStatus: status ?? null,
          httpStatusText: statusText ?? null,
          message: error.message ?? null,
          code: error.code ?? null,
          // supabase-js はネットワーク層の本当の原因をここに入れる
          details: error.details ?? null,
          hint: error.hint ?? null,
          試行: `${attempt + 1} 回目`,
        },
        null,
        2,
      ),
    );

    if (isNetworkFailure && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    const detail =
      [error.code, error.message, error.details, error.hint]
        .filter((v) => typeof v === "string" && v.length > 0)
        .join(" / ") || `HTTP ${status} ${statusText}`;

    throw new Error(
      `${label}に失敗しました: ${detail}（接続先: ${endpoint} / 条件: ${JSON.stringify(context)}）`,
    );
  }

  throw new Error(`${label}に失敗しました。`);
}

/** 正規化済みの取り込み行 */
type PreparedRow = {
  input: BuildingInput;
  normalizedAddress: string;
  addressExtra: string | null;
  normalizedName: string;
  prefecture: string | null;
  city: string | null;
  town: string | null;
  useJudgement: BuildingUseJudgement;
};

function prepare(input: BuildingInput): PreparedRow | null {
  const address = (input.address ?? "").trim();
  if (!address) return null;

  const addr = normalizeAddressDetailed(address);
  if (!addr.normalized) return null;

  const name = normalizeBuildingNameDetailed(input.building_name);
  const parts = parseAddressParts(address);

  // 建物名が不明な建物は、比較用の名前に取得元の識別子を混ぜて別物として扱う。
  //
  // 街区レベルの住所（住居番号なし）では同一街区に複数棟が並ぶため、
  // 名前をすべて「建物名不明」で揃えると DB の一意キー
  // (normalized_address, normalized_building_name) が衝突し、
  // 別棟が 1 行に統合されて配布漏れになる。
  // source_ref は取得元で安定しているため、再取得しても行は増えない。
  const isUnknownName = input.building_name === UNKNOWN_BUILDING_NAME;
  const normalizedName =
    isUnknownName && input.source_ref
      ? name.normalized + "#" + input.source_ref
      : name.normalized;

  return {
    input,
    normalizedAddress: addr.normalized,
    addressExtra: addr.extra || null,
    normalizedName,
    // 取得元が構造化データを持っていればそちらを優先し、無ければ住所から解析する
    prefecture: input.prefecture ?? parts.prefecture,
    city: input.city ?? parts.city,
    town: input.town ?? parts.town,
    // 配布対象は住居用途の集合住宅のみ。判定できないものは要確認に回す。
    useJudgement: classifyBuildingUse(input.building_use_raw, input.building_name),
  };
}

/**
 * 判定材料となる既存物件を必要な範囲だけ読み込む。
 *
 * - 同一 normalized_address の物件（ルール1の判定に必須）
 * - 同一市区町村の「配布実績がある」物件（ルール2・3の候補）
 */
async function loadComparisonSet(
  supabase: Client,
  rows: PreparedRow[],
): Promise<{
  byAddress: Map<string, BuildingRow[]>;
  bySourceRef: Map<string, BuildingRow>;
  nearby: BuildingRow[];
  distributed: BuildingRow[];
}> {
  const addresses = [...new Set(rows.map((r) => r.normalizedAddress))];
  const cities = [...new Set(rows.map((r) => r.city).filter((c): c is string => !!c))];
  const sourceRefs = [
    ...new Set(rows.map((r) => r.input.source_ref).filter((v): v is string => !!v)),
  ];

  const byAddress = new Map<string, BuildingRow[]>();
  const bySourceRef = new Map<string, BuildingRow>();
  const nearbyMap = new Map<string, BuildingRow>();
  const distributedMap = new Map<string, BuildingRow>();

  // URL が長くなりすぎないよう、件数ではなくエンコード後のバイト長で分割する。
  // 固定件数で区切ると日本語住所でヘッダー上限を超える（HeadersOverflowError）。
  for (const chunk of chunkForInFilter(addresses)) {
    const rows2 = await runQuery<BuildingRow[]>(
      "既存物件の照合（住所）",
      {
        table: "buildings",
        filter: "normalized_address in (...)",
        件数: chunk.length,
        絞り込みバイト数: filterBytes(chunk),
        先頭: chunk[0],
      },
      () => supabase.from("buildings").select("*").in("normalized_address", chunk),
    );
    for (const row of rows2) {
      const list = byAddress.get(row.normalized_address) ?? [];
      list.push(row);
      byAddress.set(row.normalized_address, list);
      if (row.distribution_count > 0) distributedMap.set(row.id, row);
    }
  }

  // 取得元での識別子が一致すれば、建物名が変わっていても同じ建物。
  // 利用者が画面から建物名を入力しても、次回取得で二重登録にならない。
  for (const chunk of chunkForInFilter(sourceRefs)) {
    const rows2 = await runQuery<BuildingRow[]>(
      "既存物件の照合（取得元ID）",
      {
        table: "buildings",
        filter: "source_ref in (...)",
        件数: chunk.length,
        絞り込みバイト数: filterBytes(chunk),
        先頭: chunk[0],
      },
      () => supabase.from("buildings").select("*").in("source_ref", chunk),
    );
    for (const row of rows2) {
      if (row.source_ref) bySourceRef.set(row.source_ref, row);
    }
  }

  if (cities.length > 0) {
    const distributedRows = await runQuery<BuildingRow[]>(
      "過去配布物件の取得",
      { table: "buildings", filter: "city in (...) and distribution_count > 0", cities },
      () =>
        supabase
          .from("buildings")
          .select("*")
          .in("city", cities)
          .gt("distribution_count", 0)
          .limit(20000),
    );
    for (const row of distributedRows) distributedMap.set(row.id, row);

    // 座標だけで同一건物を判定するための候補（同一市区町村で座標を持つ行）
    const coordRows = await runQuery<BuildingRow[]>(
      "近接建物の取得",
      { table: "buildings", filter: "city in (...) and latitude is not null", cities },
      // 近接判定に必要な列だけを取る（全件 select だと転送量が大きいため）
      () =>
        supabase
          .from("buildings")
          .select(
            "id, building_name, normalized_building_name, normalized_address, latitude, longitude, distribution_count, source_ref",
          )
          .in("city", cities)
          .not("latitude", "is", null)
          .limit(20000) as unknown as PromiseLike<QueryResult<BuildingRow[]>>,
    );
    for (const row of coordRows) nearbyMap.set(row.id, row);
  }

  return {
    byAddress,
    bySourceRef,
    nearby: [...nearbyMap.values()],
    distributed: [...distributedMap.values()],
  };
}

/**
 * 座標がごく近い既存建物を探す（取得元 ID が無い場合の保険）。
 *
 * ── 住所が同じでも同じ建物とは限らない ──────────────────────
 * 補完した住所は街区符号までしかなく（例: 荒川区西尾久8-44）、
 * 1 つの住所に最大 8 棟が入る。
 * 「同一住所かつ 15m 以内」で無条件に統合すると、同じ街区の別棟が
 * 1 行にまとめられ、建物名ごと失われる（実際に 39 件が消えた）。
 * そのため距離を 5m まで詰め、建物名の条件を課す。
 * ────────────────────────────────────────────────────────────
 */
function findByProximity(
  candidates: BuildingRow[],
  row: PreparedRow,
): BuildingRow | null {
  const lat = row.input.latitude;
  const lon = row.input.longitude;
  if (lat == null || lon == null) return null;

  let best: { building: BuildingRow; distance: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.latitude == null || candidate.longitude == null) continue;
    const distance = distanceInMeters(
      { latitude: lat, longitude: lon },
      { latitude: candidate.latitude, longitude: candidate.longitude },
    );
    if (distance === null || distance > COORDINATE_MERGE_DISTANCE_M) continue;
    if (!best || distance < best.distance) best = { building: candidate, distance };
  }

  if (!best) return null;
  return isSameBuildingByName(row.input.building_name, best.building.building_name)
    ? best.building
    : null;
}

/**
 * 座標が重なっている 2 件を同じ建物とみなしてよいかを建物名から判断する。
 *
 * ・どちらにも名前が無い → 同一と判断する根拠が無いので統合しない
 * ・片方だけ名前がある   → 同じ建物の情報が片方に入っただけとみなして統合する
 * ・両方に名前がある     → 正規化して一致する場合だけ統合する
 *
 * ── なぜ類似度の閾値ではなく「一致」を求めるか ──────────────
 * 実データで測ったところ、名前の類似度では
 *   表記違いの同一建物と、同一複合の別棟を区別できなかった。
 *
 *   1.000  グランドメゾン日暮里 / GRAND MAISON NIPPORI  … 同一
 *   0.947  コスモステージ荒川遊園 S棟 / N棟             … 別棟
 *   0.845  グリーンコーポ町屋 / グリーンパーク町屋       … 別棟
 *
 * 0.947 と 1.000 の間に安全な線は引けない。
 * 表記違い（カタカナ/ローマ字）は正規化で吸収されて一致するため、
 * 「正規化後に一致」を条件にすれば同一建物だけを拾える。
 * ────────────────────────────────────────────────────────────
 */
function isSameBuildingByName(
  incomingName: string,
  existingName: string,
): boolean {
  const incomingNamed = incomingName !== UNKNOWN_BUILDING_NAME;
  const existingNamed = existingName !== UNKNOWN_BUILDING_NAME;

  if (!incomingNamed && !existingNamed) return false;
  if (incomingNamed && existingNamed) {
    // 正規化して同一とみなせる場合のみ（表記違いはここで吸収される）
    return calculateNameSimilarity(incomingName, existingName).score >= 0.99;
  }
  return true;
}

/**
 * 住所が違っていても、座標がほぼ同一なら同じ建物とみなす最終手段。
 *
 * ── なぜ必要か ──────────────────────────────────────────────
 * 住所の表記や補完元が将来変わると normalized_address が変化し、
 * 同じ建物が別行として増えてしまう。座標は変わらないため、
 * これを同一性の拠り所にする。
 *
 * ── 誤統合を避けるための条件（すべて満たすときだけ統合）────
 * 1. 距離が 5m 以内（建物の中心点がほぼ重なる）
 * 2. どちらかに実際の建物名がある（両方「建物名不明」なら根拠が無い）
 * 3. 両方に名前がある場合は、その名前が矛盾しない（類似度 0.5 以上）
 *
 * 隣接する別棟は 5m 以内に中心点が来ることはまずない。
 * 5〜15m の「近いが別物かもしれない」範囲は統合せず、別行のまま残す。
 * ────────────────────────────────────────────────────────────
 */
const COORDINATE_MERGE_DISTANCE_M = 5;
const COORDINATE_NEAR_DISTANCE_M = 15;

export type CoordinateMatch =
  | { kind: "merge"; building: BuildingRow; distance: number }
  | { kind: "near"; building: BuildingRow; distance: number; reason: string }
  | null;

function findByCoordinatesOnly(
  candidates: BuildingRow[],
  row: PreparedRow,
): CoordinateMatch {
  const lat = row.input.latitude;
  const lon = row.input.longitude;
  if (lat == null || lon == null) return null;

  let best: { building: BuildingRow; distance: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.latitude == null || candidate.longitude == null) continue;
    // 住所が同じものは前段で処理済み
    if (candidate.normalized_address === row.normalizedAddress) continue;

    const distance = distanceInMeters(
      { latitude: lat, longitude: lon },
      { latitude: candidate.latitude, longitude: candidate.longitude },
    );
    if (distance === null || distance > COORDINATE_NEAR_DISTANCE_M) continue;
    if (!best || distance < best.distance) best = { building: candidate, distance };
  }

  if (!best) return null;

  if (best.distance > COORDINATE_MERGE_DISTANCE_M) {
    return {
      kind: "near",
      building: best.building,
      distance: best.distance,
      reason: `座標が ${Math.round(best.distance)}m と近いが、統合の条件（5m 以内）を満たさないため別の建物として登録`,
    };
  }

  if (!isSameBuildingByName(row.input.building_name, best.building.building_name)) {
    return {
      kind: "near",
      building: best.building,
      distance: best.distance,
      reason: `座標は ${Math.round(best.distance)}m と近いが、建物名の条件を満たさないため統合しない`,
    };
  }

  return { kind: "merge", building: best.building, distance: best.distance };
}

/**
 * 登録は行わず、取り込んだ場合にどう判定されるかだけを返す（プレビュー用）。
 * 実行前に「正常 / 住所不足 / 重複候補 / 登録不可」を見せるために使う。
 */
export async function analyzeBuildings(
  supabase: Client,
  inputs: BuildingInput[],
): Promise<IngestSummary> {
  const results: IngestRowResult[] = [];
  const counts = emptyCounts();
  let excludedAsUnknownUse = 0;
  const nearMisses: string[] = [];

  const prepared: PreparedRow[] = [];
  for (const input of inputs) {
    const row = prepare(input);
    if (!row) {
      results.push({
        input,
        outcome: "skipped",
        buildingId: null,
        message: "住所が空、または住所として解釈できませんでした",
      });
      counts.skipped++;
      continue;
    }

    // 本番環境では開発用データを登録しない
    if (rejectsDevelopmentData() && isDevelopmentData(input.source_ref)) {
      results.push({
        input,
        outcome: "skipped",
        buildingId: null,
        message:
          "開発用データのため本番環境では登録しません（source_ref が mock で始まる行）",
      });
      counts.skipped++;
      continue;
    }

    // 配布対象は住居用途の集合住宅のみ。戸建て・店舗・オフィス等は登録しない。
    // 判定できなかった建物は除外せず、要確認として登録する。
    // 過去配布リストの取込（distribution あり）は用途で除外しない。
    // 実際に配布した記録であり、失うと二重配布につながるため。
    if (!input.distribution && row.useJudgement.use === "EXCLUDED") {
      results.push({
        input,
        outcome: "excluded_use",
        buildingId: null,
        message: row.useJudgement.reason,
      });
      counts.excluded_use++;
      if (row.useJudgement.excludedAsUnknown) excludedAsUnknownUse++;
      continue;
    }

    prepared.push(row);
  }

  if (prepared.length === 0) {
    return { results, counts, excludedAsUnknownUse, nearMisses };
  }

  const { byAddress, bySourceRef, nearby, distributed } = await loadComparisonSet(
    supabase,
    prepared,
  );

  for (const row of prepared) {
    const { input } = row;
    const sameAddress = byAddress.get(row.normalizedAddress) ?? [];

    if (input.distribution) {
      const target =
        sameAddress.find((b) => b.normalized_building_name === row.normalizedName) ??
        sameAddress[0];
      const outcome: IngestOutcome = target ? "merged" : "inserted";
      results.push({
        input,
        outcome,
        buildingId: target?.id ?? null,
        message: target
          ? `住所一致：既存物件「${target.building_name}」に配布履歴を追加します`
          : null,
      });
      counts[outcome]++;
      continue;
    }

    const distributedAtSameAddress = sameAddress.find((b) => b.distribution_count > 0);
    if (distributedAtSameAddress) {
      results.push({
        input,
        outcome: "already_distributed",
        buildingId: distributedAtSameAddress.id,
        message: `住所完全一致：既に配布済み「${distributedAtSameAddress.building_name}」`,
      });
      counts.already_distributed++;
      continue;
    }

    const match = matchBuilding(
      {
        building_name: input.building_name,
        address: input.address,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      },
      distributed,
    );

    if (match.status === "POSSIBLE_DUPLICATE") {
      results.push({
        input,
        outcome: "possible_duplicate",
        buildingId: null,
        message: match.candidates[0]?.reasons.join(" / ") ?? null,
      });
      counts.possible_duplicate++;
      continue;
    }

    const coordinateMatch = findByCoordinatesOnly(nearby, row);
    const existingSame =
      (row.input.source_ref ? bySourceRef.get(row.input.source_ref) : undefined) ??
      sameAddress.find((b) => b.normalized_building_name === row.normalizedName) ??
      findByProximity(sameAddress, row) ??
      (coordinateMatch?.kind === "merge" ? coordinateMatch.building : null);
    const outcome: IngestOutcome = existingSame ? "merged" : "inserted";
    results.push({ input, outcome, buildingId: existingSame?.id ?? null, message: null });
    counts[outcome]++;
  }

  return { results, counts, excludedAsUnknownUse, nearMisses };
}

function emptyCounts(): Record<IngestOutcome, number> {
  return {
    inserted: 0,
    merged: 0,
    already_distributed: 0,
    possible_duplicate: 0,
    skipped: 0,
    excluded_use: 0,
  };
}

/**
 * 建物データを取り込む。
 *
 * `distribution` を持つ行は「過去配布済みリスト」の取込として扱い、
 * 住所が一致する既存物件があれば建物名が違っていてもそちらに配布履歴を紐付ける
 * （住所一致を最優先するルール）。
 *
 * `distribution` を持たない行は「新規取得物件」として扱い、
 * 過去配布物件と照合したうえで status を決める。
 */
export async function ingestBuildings(
  supabase: Client,
  inputs: BuildingInput[],
  options: {
    source: BuildingSource;
    userId?: string | null;
    /**
     * 既存の建物にだけ反映し、新しい建物を作らない。
     *
     * 過去配布リストは「どこへ配ったか」の記録であって、建物マスタでは
     * ない。住所が一致する建物が無い行まで登録すると、建物名も戸数も
     * 分からない行が건物マスタに増えていく（実際に増えた）。
     */
    skipUnmatched?: boolean;
  },
): Promise<IngestSummary> {
  const results: IngestRowResult[] = [];
  const counts = emptyCounts();
  let excludedAsUnknownUse = 0;
  const nearMisses: string[] = [];

  const prepared: PreparedRow[] = [];
  for (const input of inputs) {
    const row = prepare(input);
    if (!row) {
      results.push({
        input,
        outcome: "skipped",
        buildingId: null,
        message: "住所が空、または住所として解釈できませんでした",
      });
      counts.skipped++;
      continue;
    }

    // 本番環境では開発用データを登録しない
    if (rejectsDevelopmentData() && isDevelopmentData(input.source_ref)) {
      results.push({
        input,
        outcome: "skipped",
        buildingId: null,
        message:
          "開発用データのため本番環境では登録しません（source_ref が mock で始まる行）",
      });
      counts.skipped++;
      continue;
    }

    // 配布対象は住居用途の集合住宅のみ。戸建て・店舗・オフィス等は登録しない。
    // 判定できなかった建物は除外せず、要確認として登録する。
    // 過去配布リストの取込（distribution あり）は用途で除外しない。
    // 実際に配布した記録であり、失うと二重配布につながるため。
    if (!input.distribution && row.useJudgement.use === "EXCLUDED") {
      results.push({
        input,
        outcome: "excluded_use",
        buildingId: null,
        message: row.useJudgement.reason,
      });
      counts.excluded_use++;
      if (row.useJudgement.excludedAsUnknown) excludedAsUnknownUse++;
      continue;
    }

    prepared.push(row);
  }

  if (prepared.length === 0) {
    return { results, counts, excludedAsUnknownUse, nearMisses };
  }

  const { byAddress, bySourceRef, nearby, distributed } = await loadComparisonSet(
    supabase,
    prepared,
  );

  for (const row of prepared) {
    const { input } = row;
    const sameAddress = byAddress.get(row.normalizedAddress) ?? [];

    // ── 過去配布済みリストの取込 ────────────────────────────
    if (input.distribution) {
      // 住所一致を最優先。建物名が違っても同一物件として履歴を紐付ける。
      let target =
        sameAddress.find((b) => b.normalized_building_name === row.normalizedName) ??
        sameAddress[0] ??
        null;

      if (!target) {
        // 新規作成をしない取込では、既存に当たらなかった行はここで終える
        if (options.skipUnmatched) {
          results.push({
            input,
            outcome: "skipped",
            buildingId: null,
            message:
              "住所が一致する建物が見つかりませんでした（新しい建物は作成しません）。",
          });
          counts.skipped++;
          continue;
        }

        const inserted = await insertBuilding(supabase, row, options.source);
        if (!inserted.ok) {
          results.push({
            input,
            outcome: "skipped",
            buildingId: null,
            message: inserted.message,
          });
          counts.skipped++;
          continue;
        }
        target = inserted.row;
        registerLoaded(byAddress, target);
      }

      const { error } = await supabase.from("distribution_history").insert({
        building_id: target.id,
        distributed_date: input.distribution.distributed_date,
        distributed_by: input.distribution.distributed_by ?? null,
        notes: input.distribution.notes ?? null,
        created_by: options.userId ?? null,
      });

      if (error) {
        results.push({
          input,
          outcome: "skipped",
          buildingId: target.id,
          message: `配布履歴の登録に失敗しました: ${error.message}`,
        });
        counts.skipped++;
        continue;
      }

      const outcome: IngestOutcome = sameAddress.length > 0 ? "merged" : "inserted";
      results.push({
        input,
        outcome,
        buildingId: target.id,
        message:
          sameAddress.length > 0 &&
          target.normalized_building_name !== row.normalizedName
            ? `住所一致により既存物件「${target.building_name}」の配布履歴として登録しました`
            : null,
      });
      counts[outcome]++;
      continue;
    }

    // ── 新規取得物件の取込 ──────────────────────────────────
    // ルール1: 同一住所に配布済み物件があれば、その時点で配布済み確定。
    const distributedAtSameAddress = sameAddress.find((b) => b.distribution_count > 0);
    if (distributedAtSameAddress) {
      results.push({
        input,
        outcome: "already_distributed",
        buildingId: distributedAtSameAddress.id,
        message: `住所完全一致：既に配布済み「${distributedAtSameAddress.building_name}」`,
      });
      counts.already_distributed++;
      continue;
    }

    // 取得元 ID が一致する行があれば同じ建物。利用者が入力した建物名を守るため、
    // 名前は上書きせず、欠けている情報だけを補う。
    let mergeMessage = "既存の建物レコードに統合しました";
    let existingSame: BuildingRow | null =
      (row.input.source_ref ? bySourceRef.get(row.input.source_ref) : undefined) ??
      sameAddress.find((b) => b.normalized_building_name === row.normalizedName) ??
      findByProximity(sameAddress, row) ??
      null;

    // 住所が違っていても座標がほぼ同一なら同じ建物とみなす（最終手段）。
    // 住所表記や補完元が変わっても行が増えないようにするため。
    if (!existingSame) {
      const byCoordinates = findByCoordinatesOnly(nearby, row);
      if (byCoordinates?.kind === "merge") {
        existingSame = byCoordinates.building;
        mergeMessage = `住所は違うが座標が ${Math.round(byCoordinates.distance)}m と一致するため既存の建物に統合しました`;
      } else if (byCoordinates?.kind === "near") {
        nearMisses.push(byCoordinates.reason);
      }
    }

    if (existingSame) {
      await mergeBuilding(supabase, existingSame, row);
      results.push({
        input,
        outcome: "merged",
        buildingId: existingSame.id,
        message: mergeMessage,
      });
      counts.merged++;
      continue;
    }

    // 新規作成をしない取込では、既存に当たらなかった行はここで終える
    if (options.skipUnmatched) {
      results.push({
        input,
        outcome: "skipped",
        buildingId: null,
        message:
          "住所が一致する建物が見つかりませんでした（新しい建物は作成しません）。",
      });
      counts.skipped++;
      continue;
    }

    const inserted = await insertBuilding(supabase, row, options.source);
    if (!inserted.ok) {
      results.push({
        input,
        outcome: "skipped",
        buildingId: null,
        message: inserted.message,
      });
      counts.skipped++;
      continue;
    }
    registerLoaded(byAddress, inserted.row);

    // ルール2・3: 過去配布物件との類似判定
    const match = matchBuilding(
      {
        id: inserted.row.id,
        building_name: input.building_name,
        address: input.address,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      },
      distributed,
    );

    if (match.status === "POSSIBLE_DUPLICATE" && match.candidates.length > 0) {
      const payload = match.candidates.slice(0, 5).map((c) => ({
        new_building_id: inserted.row.id,
        possible_existing_building_id: c.building.id,
        address_similarity_score: c.addressSimilarity,
        name_similarity_score: c.nameSimilarity,
        distance_meters: c.distanceMeters,
        reason: c.reasons,
        status: "pending",
      }));

      // ignoreDuplicates: 人間が既に判断済みの組み合わせを pending に戻さない
      await supabase.from("duplicate_candidates").upsert(payload, {
        onConflict: "new_building_id,possible_existing_building_id",
        ignoreDuplicates: true,
      });

      await supabase
        .from("buildings")
        .update({ status: "POSSIBLE_DUPLICATE" })
        .eq("id", inserted.row.id);

      results.push({
        input,
        outcome: "possible_duplicate",
        buildingId: inserted.row.id,
        message: match.candidates[0].reasons.join(" / "),
      });
      counts.possible_duplicate++;
      continue;
    }

    results.push({
      input,
      outcome: "inserted",
      buildingId: inserted.row.id,
      message: null,
    });
    counts.inserted++;
  }

  return { results, counts, excludedAsUnknownUse, nearMisses };
}

/**
 * 既に一覧に載っている建物を、過去配布物件と再照合する。
 *
 * エリアの建物取得を先に行い、その後で過去配布リストを取り込んだ場合、
 * 取込時点では「新規取得物件 → 過去配布物件」の照合しか走らない。
 * この関数は逆向き（既存の配布対象 → 新しく登録された配布済み物件）を
 * 埋めることで、作業の順序に関わらず二重配布を防ぐ。
 */
export async function reconcileDistributionStatus(
  supabase: Client,
  cities: string[],
): Promise<{ confirmed: number; possibleDuplicate: number }> {
  const uniqueCities = [...new Set(cities.filter(Boolean))];
  if (uniqueCities.length === 0) return { confirmed: 0, possibleDuplicate: 0 };

  const [{ data: distributedData }, { data: targetData }] = await Promise.all([
    supabase
      .from("buildings")
      .select("*")
      .in("city", uniqueCities)
      .gt("distribution_count", 0)
      .limit(20000),
    supabase
      .from("buildings")
      .select("*")
      .in("city", uniqueCities)
      .eq("distribution_count", 0)
      .neq("status", "CONFIRMED_DISTRIBUTED")
      .limit(20000),
  ]);

  const distributed = (distributedData ?? []) as BuildingRow[];
  const targets = (targetData ?? []) as BuildingRow[];
  if (distributed.length === 0 || targets.length === 0) {
    return { confirmed: 0, possibleDuplicate: 0 };
  }

  let confirmed = 0;
  let possibleDuplicate = 0;

  for (const target of targets) {
    const match = matchBuilding(
      {
        id: target.id,
        building_name: target.building_name,
        address: target.address,
        latitude: target.latitude,
        longitude: target.longitude,
      },
      distributed,
    );

    if (match.status === "CONFIRMED_DISTRIBUTED") {
      // 同一住所に配布済み物件が存在する。配布履歴は相手側が持っているため、
      // ここでは状態だけを更新して配布対象一覧から外す。
      await supabase
        .from("buildings")
        .update({ status: "CONFIRMED_DISTRIBUTED" })
        .eq("id", target.id);
      confirmed++;
      continue;
    }

    if (match.status === "POSSIBLE_DUPLICATE" && match.candidates.length > 0) {
      const payload = match.candidates.slice(0, 5).map((c) => ({
        new_building_id: target.id,
        possible_existing_building_id: c.building.id,
        address_similarity_score: c.addressSimilarity,
        name_similarity_score: c.nameSimilarity,
        distance_meters: c.distanceMeters,
        reason: c.reasons,
        status: "pending",
      }));

      await supabase.from("duplicate_candidates").upsert(payload, {
        onConflict: "new_building_id,possible_existing_building_id",
        ignoreDuplicates: true,
      });

      // 未確認の候補が残っている場合のみ隔離する
      const { count } = await supabase
        .from("duplicate_candidates")
        .select("id", { count: "exact", head: true })
        .eq("new_building_id", target.id)
        .eq("status", "pending");

      if ((count ?? 0) > 0 && target.status !== "POSSIBLE_DUPLICATE") {
        await supabase
          .from("buildings")
          .update({ status: "POSSIBLE_DUPLICATE" })
          .eq("id", target.id);
        possibleDuplicate++;
      }
    }
  }

  return { confirmed, possibleDuplicate };
}

function registerLoaded(map: Map<string, BuildingRow[]>, row: BuildingRow) {
  const list = map.get(row.normalized_address) ?? [];
  list.push(row);
  map.set(row.normalized_address, list);
}

async function insertBuilding(
  supabase: Client,
  row: PreparedRow,
  source: BuildingSource,
): Promise<{ ok: true; row: BuildingRow } | { ok: false; message: string }> {
  const { input } = row;
  const base = {
    building_name: input.building_name?.trim() || "（建物名なし）",
    address: input.address.trim(),
    normalized_building_name: row.normalizedName,
    normalized_address: row.normalizedAddress,
    address_extra: row.addressExtra,
    prefecture: row.prefecture,
    city: row.city,
    town: row.town,
    total_units: input.total_units ?? null,
    property_type: input.property_type ?? "unknown",
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    source,
    source_ref: input.source_ref ?? null,
  };

  const withUse = {
    ...base,
    building_use: row.useJudgement.use,
    building_use_note: row.useJudgement.reason,
    address_source: input.address_source ?? null,
    address_precision: input.address_precision ?? null,
  };

  let { data, error } = await supabase
    .from("buildings")
    .insert(buildingUseColumnAvailable ? withUse : base)
    .select("*")
    .single();

  // migration 0002 が未適用の環境でも動くようにする。
  // 列が無いと分かった時点で以降は付けずに登録する。
  if (error && buildingUseColumnAvailable && isMissingColumnError(error)) {
    buildingUseColumnAvailable = false;
    ({ data, error } = await supabase
      .from("buildings")
      .insert(base)
      .select("*")
      .single());
  }

  if (error || !data) {
    return { ok: false, message: `登録に失敗しました: ${error?.message ?? "unknown"}` };
  }
  return { ok: true, row: data as BuildingRow };
}

/**
 * migration 0002（building_use 列）が適用済みかどうか。
 * 未適用の環境では列を付けずに登録し、アプリは動き続ける。
 */
let buildingUseColumnAvailable = true;

export function isBuildingUseColumnAvailable(): boolean {
  return buildingUseColumnAvailable;
}

function isMissingColumnError(error: { message?: string; code?: string }): boolean {
  // PostgREST は未知の列を PGRST204 で返す
  if (error.code === "PGRST204" || error.code === "42703") return true;
  const message = error.message ?? "";
  return (
    /building_use|address_source|address_precision/.test(message) &&
    /column|schema cache/i.test(message)
  );
}

/**
 * 既存レコードの欠けている情報だけを補う。
 * 原本（building_name / address）は決して上書きしない。
 */
async function mergeBuilding(
  supabase: Client,
  existing: BuildingRow,
  row: PreparedRow,
): Promise<void> {
  const patch: Record<string, unknown> = {};

  if (existing.total_units == null && row.input.total_units != null) {
    patch.total_units = row.input.total_units;
  }
  if (existing.property_type === "unknown" && row.input.property_type) {
    patch.property_type = row.input.property_type;
  }
  if (existing.latitude == null && row.input.latitude != null) {
    patch.latitude = row.input.latitude;
    patch.longitude = row.input.longitude ?? null;
  }

  if (Object.keys(patch).length === 0) return;
  await supabase.from("buildings").update(patch).eq("id", existing.id);
}
