export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Distanza in linea d'aria tra due punti, in chilometri (formula dell'haversine). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MAX_STOPS = 8;

export interface OrderedStops<T> {
  /** Tappe nell'ordine che rende minore il percorso totale. */
  order: T[];
  /** Km in linea d'aria di ogni tratto: partenza → prima tappa, …, ultima tappa → rientro. */
  legsKm: number[];
  totalKm: number;
}

/**
 * Ordina le tappe in modo da percorrere meno strada possibile, partendo da `origin` e finendo in
 * `returnTo` (di default la partenza). Fino a 8 tappe prova tutti gli ordini, quindi il risultato
 * è il migliore possibile. A parità di km totali (un giro di andata e ritorno si può fare nei due
 * sensi) si parte dalla tappa più vicina. Le distanze sono in
 * linea d'aria: per isole, traghetti e montagne sono una prima stima.
 */
export function orderStops<T extends GeoPoint>(
  origin: GeoPoint,
  stops: readonly T[],
  returnTo: GeoPoint = origin,
): OrderedStops<T> {
  const n = stops.length;
  const legs = (order: readonly T[]) => {
    const points = [origin, ...order, returnTo];
    return points.slice(1).map((p, i) => haversineKm(points[i]!, p));
  };
  const total = (l: number[]) => l.reduce((s, x) => s + x, 0);
  if (n <= 1) {
    const l = legs(stops);
    return { order: [...stops], legsKm: l, totalKm: total(l) };
  }
  if (n > MAX_STOPS) throw new Error(`At most ${MAX_STOPS} stops`);

  // Distanze precalcolate: indice 0 = partenza, 1..n = tappe, n+1 = rientro.
  const pts = [origin, ...stops, returnTo];
  const dist = pts.map((a) => pts.map((b) => haversineKm(a, b)));
  let best: number[] = [];
  let bestKm = Infinity;
  let bestLegs: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const current: number[] = [];
  const EPS = 1e-6;
  const walk = (last: number, km: number) => {
    // Un percorso già più lungo del migliore non può più battere (taglio dei rami).
    if (km > bestKm + EPS) return;
    if (current.length === n) {
      const full = km + dist[last]![n + 1]!;
      const l = legs(current.map((i) => stops[i]!));
      const shorter = full < bestKm - EPS;
      // A parità di totale vince chi ha i primi tratti più corti.
      const firstDiff = l.findIndex((x, i) => Math.abs(x - bestLegs[i]!) > EPS);
      const tie =
        Math.abs(full - bestKm) <= EPS && firstDiff !== -1 && l[firstDiff]! < bestLegs[firstDiff]!;
      if (shorter || tie) {
        bestKm = full;
        best = [...current];
        bestLegs = l;
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      current.push(i);
      walk(i + 1, km + dist[last]![i + 1]!);
      current.pop();
      used[i] = false;
    }
  };
  walk(0, 0);
  const order = best.map((i) => stops[i]!);
  const l = legs(order);
  return { order, legsKm: l, totalKm: total(l) };
}

/**
 * Divide le notti tra le tappe: almeno una a testa e il resto in parti uguali (le prime tappe
 * prendono le notti che avanzano). Con meno notti che tappe, le prime tappe ne prendono una.
 */
export function distributeNights(totalNights: number, stops: number): number[] {
  if (stops <= 0) return [];
  const total = Math.max(0, Math.floor(totalNights));
  const base = Math.floor(total / stops);
  const extra = total % stops;
  return Array.from({ length: stops }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Notti tra due date ISO (YYYY-MM-DD). */
export function nightsBetween(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}
