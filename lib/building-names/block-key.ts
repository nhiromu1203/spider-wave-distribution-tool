/**
 * 住所から「街区」を取り出す。
 *
 * 建物名の照合は街区（丁目＋番）単位で行う。取得元から候補を集めるのも、
 * 候補を対象に割り当てるのも、この単位でまとめないと成立しない。
 *
 *   東京都荒川区東日暮里三丁目12   → 東日暮里 / 3 / 12
 *   東京都荒川区東日暮里3-12-5     → 東日暮里 / 3 / 12
 *   荒川区西日暮里六丁目42          → 西日暮里 / 6 / 42
 */

const KANJI_DIGITS: Record<string, string> = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
};

export type BlockKey = {
  /**
   * 市区町村（例: 荒川区）。分からなければ空。
   *
   * 23区には同じ町名が複数の区に存在する（中央・本町・栄町など）。
   * 町名だけで街区を表すと別の区の建物と混ざるため、必ず含める。
   */
  city: string;
  /** 町名（丁目を除く。例: 東日暮里） */
  town: string;
  /** 丁目 */
  chome: number;
  /** 街区符号（番） */
  block: number;
};

/** 全角英数字と全角ハイフンを半角へ寄せる */
export function toHalfWidth(value: string): string {
  return value
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－―ー‐‑–—−]/g, "-")
    .replace(/\s+/g, "");
}

/** 「三丁目」「3丁目」「3」をすべて数値にする */
export function parseChomeNumber(raw: string): number | null {
  const kanji = raw.replace(/[一二三四五六七八九]/g, (c) => KANJI_DIGITS[c] ?? c);
  // 十一丁目 のような表記（10 以上）にも一応対応する
  const tens = raw.match(/^十([一二三四五六七八九])?$/);
  if (tens) return 10 + (tens[1] ? Number(KANJI_DIGITS[tens[1]]) : 0);
  const n = Number(kanji);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 住所から街区を取り出す。取り出せなければ null。
 *
 * 号（枝番）は無視する。号まで一致させる判定はここでは行わない
 * （こちらの住所には号が無いことが多いため）。
 */
export function parseBlockKey(address: string): BlockKey | null {
  // 都道府県は書かれたり省略されたりするので必ず落とす
  const withoutPrefecture = toHalfWidth(address).replace(
    /^(東京都|北海道|京都府|大阪府|.{2,3}県)/,
    "",
  );

  // 市区町村は切り出して鍵に含める。町名の先頭に「町」が来る場合
  // （町屋など）は直前に別の文字が要る指定なので、誤って削らない。
  const cityMatch = withoutPrefecture.match(/^([^市区町村]+[市区町村])/);
  const city = cityMatch?.[1] ?? "";
  const normalized = cityMatch
    ? withoutPrefecture.slice(cityMatch[1].length)
    : withoutPrefecture;

  // 町名 + 丁目 + 番
  const withChome = normalized.match(
    /^(.+?)([0-9]+|[一二三四五六七八九十]+)丁目-?([0-9]+)/,
  );
  if (withChome) {
    const chome = parseChomeNumber(withChome[2]);
    if (chome === null) return null;
    return { city, town: withChome[1], chome, block: Number(withChome[3]) };
  }

  // 町名 + ハイフン区切り（東日暮里3-12-5）
  const hyphen = normalized.match(/^(.+?)([0-9]+)-([0-9]+)/);
  if (hyphen) {
    return {
      city,
      town: hyphen[1],
      chome: Number(hyphen[2]),
      block: Number(hyphen[3]),
    };
  }

  return null;
}

/** 同じ街区かどうかを比べるための文字列 */
export function blockKeyToString(key: BlockKey): string {
  return `${key.city}/${key.town}/${key.chome}/${key.block}`;
}

/** 住所をそのまま街区文字列にする。取り出せなければ null */
export function blockKeyOf(address: string): string | null {
  const key = parseBlockKey(address);
  return key ? blockKeyToString(key) : null;
}
