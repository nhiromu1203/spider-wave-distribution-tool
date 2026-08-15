/**
 * 区を複数のタイルへ分割する。
 *
 * ── なぜ分割するのか ────────────────────────────────────────
 * Vercel Hobby では 1 リクエストが 60 秒で打ち切られる。
 * 実測（台東区）では Overpass への問い合わせだけで 16.5 秒かかり、
 * 採用件数は 1214 件だった。世田谷区はこの 4 倍規模のため、
 * 1 リクエストで区全体を取得・登録する設計では確実に途中で切れる。
 *
 * そこで区の範囲を格子状のタイルに割り、1 リクエストで 1 タイルだけを
 * 処理する。各リクエストは短く収まり、途中で失敗しても
 * そのタイルからやり直せる。
 *
 * ── 状態を持たない ──────────────────────────────────────────
 * タイルの割り方は区の範囲から毎回同じ結果になるよう決める。
 * サーバーレスではリクエストごとに別のインスタンスへ振られるため、
 * 前回の取得結果をメモリに残しておくことはできない。
 * 「何番目のタイルか」だけを引き継げば続きから処理できる形にする。
 * ────────────────────────────────────────────────────────────
 */

export type BBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** 1 タイルが受け持つ街区点の目安。実測を元にした値 */
const POINTS_PER_TILE = 1500;

/** 分割数の上限。これ以上細かくすると Overpass への問い合わせ回数が増えすぎる */
const MAX_GRID = 4;

/**
 * 街区点の数から格子の一辺を決める。
 *
 * 街区点の数は区の広さと市街地の密度をよく表しており、
 * 建物件数の目安になる（荒川区 2850 点 / 世田谷区 11963 点）。
 */
export function gridSizeForPointCount(pointCount: number): number {
  if (pointCount <= 0) return 1;
  const tiles = Math.ceil(pointCount / POINTS_PER_TILE);
  const side = Math.ceil(Math.sqrt(tiles));
  return Math.min(Math.max(side, 1), MAX_GRID);
}

/** 座標の集まりを囲む矩形。点が無ければ null */
export function boundsOf(
  points: Array<{ latitude: number; longitude: number }>,
): BBox | null {
  if (points.length === 0) return null;

  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;

  for (const p of points) {
    if (p.latitude < south) south = p.latitude;
    if (p.latitude > north) north = p.latitude;
    if (p.longitude < west) west = p.longitude;
    if (p.longitude > east) east = p.longitude;
  }

  return { south, west, north, east };
}

/**
 * 矩形を side × side の格子に分ける。
 *
 * 境界上の建物を取りこぼさないよう、隣り合うタイルはわずかに重ねる。
 * 重なりで二重に取得された建物は、既存の重複判定が同一建物として
 * 統合するため問題にならない。
 */
export function splitIntoTiles(bbox: BBox, side: number): BBox[] {
  if (side <= 1) return [bbox];

  const latStep = (bbox.north - bbox.south) / side;
  const lonStep = (bbox.east - bbox.west) / side;

  // 約 10m 相当。タイル境界にまたがる建物の取りこぼしを防ぐ
  const overlap = 0.0001;

  const tiles: BBox[] = [];
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      tiles.push({
        south: bbox.south + latStep * row - (row > 0 ? overlap : 0),
        north: bbox.south + latStep * (row + 1) + (row < side - 1 ? overlap : 0),
        west: bbox.west + lonStep * col - (col > 0 ? overlap : 0),
        east: bbox.west + lonStep * (col + 1) + (col < side - 1 ? overlap : 0),
      });
    }
  }
  return tiles;
}

/** Overpass QL の (south,west,north,east) 表記 */
export function toOverpassBbox(bbox: BBox): string {
  const round = (v: number) => v.toFixed(6);
  return `${round(bbox.south)},${round(bbox.west)},${round(bbox.north)},${round(bbox.east)}`;
}
