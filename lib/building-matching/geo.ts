/**
 * 緯度経度による補助判定。
 * 座標が無い物件でも必ず正常に動作すること（null を返すだけ）。
 */

export type Coordinates = {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
};

const EARTH_RADIUS_M = 6371008.8;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * 2 点間の距離（メートル）。
 * どちらかに座標が無ければ null を返す。
 */
export function distanceInMeters(a: Coordinates, b: Coordinates): number | null {
  if (
    a.latitude == null ||
    a.longitude == null ||
    b.latitude == null ||
    b.longitude == null ||
    !Number.isFinite(a.latitude) ||
    !Number.isFinite(a.longitude) ||
    !Number.isFinite(b.latitude) ||
    !Number.isFinite(b.longitude)
  ) {
    return null;
  }

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
