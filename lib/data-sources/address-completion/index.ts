import "server-only";

/**
 * 住所補完の registry。
 *
 * 補完元を差し替えたいときは ADDRESS_COMPLETION_PROVIDERS に足すだけでよい。
 * 建物データ取得元（BuildingDataSource）とは独立しており、
 * OSM でも CSV でも外部 API でも、同じ手順で補完できる。
 */

import { isjAddressCompletionProvider } from "./isj";
import type {
  AddressCompletionProvider,
  CompletedAddress,
  LatLon,
} from "./types";

/** 先頭から順に、最初に利用可能なものが採用される */
export const ADDRESS_COMPLETION_PROVIDERS: AddressCompletionProvider[] = [
  // 例: 国土地理院「住居表示住所」（住居番号まで取れるが使用承認が必要な場合あり）
  isjAddressCompletionProvider,
];

export function getActiveAddressCompletionProvider(): AddressCompletionProvider | null {
  return (
    ADDRESS_COMPLETION_PROVIDERS.find((p) => p.isAvailable().available) ?? null
  );
}

export type CompletionOutcome = {
  results: Array<CompletedAddress | null>;
  provider: AddressCompletionProvider | null;
  /** 補完できた件数 */
  completed: number;
  /** 補完できなかった件数 */
  failed: number;
  /** 補完できなかった理由（provider が使えない場合など） */
  note: string | null;
};

/**
 * 座標をまとめて住所へ補完する。
 * 失敗しても例外を投げず、補完できなかった点は null を返す。
 */
export async function completeAddresses(
  points: LatLon[],
  context: { prefecture: string; city?: string | null },
): Promise<CompletionOutcome> {
  if (points.length === 0) {
    return { results: [], provider: null, completed: 0, failed: 0, note: null };
  }

  const provider = getActiveAddressCompletionProvider();
  if (!provider) {
    return {
      results: points.map(() => null),
      provider: null,
      completed: 0,
      failed: points.length,
      note: "利用可能な住所補完データがありません。",
    };
  }

  if (!provider.supportsPrefecture(context.prefecture)) {
    return {
      results: points.map(() => null),
      provider,
      completed: 0,
      failed: points.length,
      note: `${provider.label} は ${context.prefecture} に対応していません。`,
    };
  }

  try {
    const results = await provider.complete(points, context);
    const completed = results.filter((r) => r !== null).length;
    return {
      results,
      provider,
      completed,
      failed: results.length - completed,
      note: null,
    };
  } catch (error) {
    // 補完に失敗しても建物取得そのものは続ける
    return {
      results: points.map(() => null),
      provider,
      completed: 0,
      failed: points.length,
      note: `住所補完に失敗しました: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export { isjAddressCompletionProvider, ISJ_PROVIDER_ID } from "./isj";
export { getCityBlockPoints } from "./isj";
export { ATTRIBUTION as ISJ_ATTRIBUTION } from "./isj";
export type {
  AddressCompletionProvider,
  AddressPrecision,
  CompletedAddress,
  CompletionAvailability,
  LatLon,
} from "./types";
export { ADDRESS_SOURCE_ORIGINAL } from "./types";
