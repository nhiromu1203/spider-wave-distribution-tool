/**
 * Supabase（PostgREST）へ `in.(...)` で多数の値を渡すときの分割。
 *
 * ── なぜ必要か ──────────────────────────────────────────────
 * PostgREST の絞り込みは GET のクエリ文字列で渡される。値が増えると
 * URL が長くなり、Node の undici がヘッダー全体の上限を超えて
 *
 *   HeadersOverflowError (UND_ERR_HEADERS_OVERFLOW)
 *   Your request URL is 12898 characters
 *
 * で失敗する。上限は「URL 単体」ではなく apikey や Authorization の
 * JWT を含めたヘッダー全体に対して効くため、URL だけを見て
 * 「まだ余裕がある」と判断してはいけない。
 *
 * ── 方針 ────────────────────────────────────────────────────
 * 件数ではなくエンコード後のバイト長で分割する。
 * 日本語の住所は 1 文字あたり最大 9 バイトへ膨らむため、
 * 件数だけで区切ると安全な大きさにならない。
 * ────────────────────────────────────────────────────────────
 */

/**
 * 1 バッチあたりの絞り込み部分の上限（エンコード後のバイト数）。
 *
 * ヘッダー全体の上限（既定 16KB）から、apikey・Authorization の JWT・
 * その他のヘッダー分を大きめに差し引いた余裕のある値にしてある。
 */
export const MAX_FILTER_BYTES = 1_500;

/** 1 バッチあたりの最大件数。バイト長に余裕があっても件数で頭打ちにする */
export const MAX_FILTER_VALUES = 30;

/** PostgREST の in.() に載せたときのおおよそのバイト数 */
function encodedSize(value: string): number {
  // 値は "..." で囲まれ、区切りのカンマが 1 つ増える
  return encodeURIComponent(`"${value}",`).length;
}

/**
 * 値の配列を、URL が長くなりすぎない大きさへ分割する。
 *
 * 1 件だけで上限を超える値があっても捨てず、単独のバッチにする
 * （取りこぼすと照合漏れになり、二重登録につながるため）。
 */
export function chunkForInFilter(
  values: readonly string[],
  options: { maxBytes?: number; maxValues?: number } = {},
): string[][] {
  const maxBytes = options.maxBytes ?? MAX_FILTER_BYTES;
  const maxValues = options.maxValues ?? MAX_FILTER_VALUES;

  const batches: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;

  for (const value of values) {
    const size = encodedSize(value);

    const wouldExceed =
      current.length > 0 &&
      (currentBytes + size > maxBytes || current.length >= maxValues);

    if (wouldExceed) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(value);
    currentBytes += size;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/** 分割後の各バッチが上限に収まっているか（テスト・検証用） */
export function filterBytes(values: readonly string[]): number {
  return values.reduce((total, value) => total + encodedSize(value), 0);
}
