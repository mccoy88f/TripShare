import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useEffect, useRef } from 'react';
import { memoryUrl, type Memory } from '@/lib/memories';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function createMap(el: HTMLElement, center: L.LatLngExpression, zoom: number) {
  const map = L.map(el, { center, zoom, worldCopyJump: true });
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  return map;
}

/** Pallino con la miniatura del ricordo, usato come segnaposto sulla mappa. */
function pin(m: Memory) {
  return L.divIcon({
    className: '',
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    html: `<div style="width:46px;height:46px;border-radius:9999px;overflow:hidden;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);background:#334155"><img src="${memoryUrl(m.id, 'thumb')}" alt="" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer" /></div>`,
  });
}

/** Mappa OpenStreetMap con i ricordi raggruppati: lo zoom apre i gruppi, il tocco apre il ricordo. */
export default function MemoryMap({
  memories,
  onOpen,
}: {
  memories: (Memory & { lat: number; lon: number })[];
  onOpen: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.MarkerClusterGroup | null>(null);
  const fitted = useRef(false);
  const open = useRef(onOpen);
  open.current = onOpen;

  useEffect(() => {
    if (!host.current) return;
    const m = createMap(host.current, [42, 12], 4);
    const group = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 55,
      spiderfyOnMaxZoom: true,
    });
    m.addLayer(group);
    map.current = m;
    layer.current = group;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
      fitted.current = false;
    };
  }, []);

  useEffect(() => {
    const group = layer.current;
    const m = map.current;
    if (!group || !m) return;
    group.clearLayers();
    for (const mem of memories) {
      const marker = L.marker([mem.lat, mem.lon], { icon: pin(mem) });
      marker.on('click', () => open.current(mem.id));
      group.addLayer(marker);
    }
    // Alla prima apertura la mappa inquadra tutti i ricordi.
    if (!fitted.current && memories.length > 0) {
      m.fitBounds(L.latLngBounds(memories.map((x) => [x.lat, x.lon] as [number, number])), {
        padding: [40, 40],
        maxZoom: 15,
      });
      fitted.current = true;
    }
  }, [memories]);

  return (
    <div
      ref={host}
      className="isolate h-[min(70dvh,34rem)] w-full overflow-hidden rounded-2xl border"
    />
  );
}

/** Piccola mappa per scegliere il punto di un ricordo toccandola. */
export function PlacePicker({
  value,
  onChange,
}: {
  value: { lat: number; lon: number } | null;
  onChange: (point: { lat: number; lon: number }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const m = createMap(host.current, value ? [value.lat, value.lon] : [42, 12], value ? 13 : 4);
    m.on('click', (e: L.LeafletMouseEvent) =>
      change.current({ lat: e.latlng.lat, lon: e.latlng.lng }),
    );
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // la mappa si crea una volta; il segnaposto segue `value` nell'effetto sotto
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    marker.current?.remove();
    marker.current = null;
    if (value) {
      marker.current = L.marker([value.lat, value.lon], {
        icon: L.divIcon({
          className: '',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          html: '<div style="width:22px;height:22px;border-radius:9999px;background:#e11d48;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>',
        }),
      }).addTo(m);
      m.panTo([value.lat, value.lon]);
    }
  }, [value]);

  return <div ref={host} className="isolate h-56 w-full overflow-hidden rounded-xl border" />;
}
