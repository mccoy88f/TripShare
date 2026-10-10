import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

interface Point {
  lat: number;
  lon: number;
  label: string;
}

const badge = (text: string, color: string) =>
  L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.45);display:grid;place-items:center;font:600 13px system-ui">${text}</div>`,
  });

/** Percorso del viaggio su OpenStreetMap: partenza, tappe numerate e rientro, in linea d'aria. */
export default function RouteMap({
  origin,
  stops,
  returnTo,
}: {
  origin: Point;
  stops: Point[];
  returnTo: Point;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, {
      center: [origin.lat, origin.lon],
      zoom: 5,
      zoomControl: false,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
    };
    // la mappa si crea una volta; il resto si aggiorna nell'effetto sotto
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const path: [number, number][] = [origin, ...stops, returnTo].map((p) => [p.lat, p.lon]);
    L.polyline(path, { color: '#0d9488', weight: 3, opacity: 0.85, dashArray: '6 6' }).addTo(g);
    L.marker([origin.lat, origin.lon], { icon: badge('●', '#475569') })
      .bindTooltip(origin.label)
      .addTo(g);
    stops.forEach((s, i) =>
      L.marker([s.lat, s.lon], { icon: badge(String(i + 1), '#0d9488') })
        .bindTooltip(s.label)
        .addTo(g),
    );
    m.fitBounds(L.latLngBounds(path), { padding: [28, 28], maxZoom: 9 });
  }, [origin, stops, returnTo]);

  return <div ref={host} className="isolate h-56 w-full overflow-hidden rounded-xl border" />;
}
