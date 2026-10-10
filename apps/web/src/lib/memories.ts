import type { AvatarUser } from '@/components/ui/avatar';

export interface Memory {
  id: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  takenAt: string | null;
  createdAt: string;
  lat: number | null;
  lon: number | null;
  placeName: string | null;
  caption: string | null;
  shared: boolean;
  status: string;
  tripId: string | null;
  tripTitle: string | null;
  mine: boolean;
  owner: AvatarUser;
}

export const memoryUrl = (id: string, variant?: 'thumb') =>
  `/api/memories/${id}/file${variant ? `?v=${variant}` : ''}`;

/** Momento del ricordo: quello dello scatto, altrimenti del caricamento. */
export const memoryDate = (m: Pick<Memory, 'takenAt' | 'createdAt'>) =>
  new Date(m.takenAt ?? m.createdAt);

export const hasPoint = (m: Memory): m is Memory & { lat: number; lon: number } =>
  m.lat !== null && m.lon !== null;

/** Carica un file con l'avanzamento in percentuale; restituisce l'id del ricordo. */
export function uploadMemory(
  file: File,
  fields: Record<string, string>,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    // Prima i campi e per ultimo il file: il server legge i campi che precedono il file.
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    body.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/memories');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let json: { id?: string; error?: string } = {};
      try {
        json = JSON.parse(xhr.responseText) as typeof json;
      } catch {
        // risposta non JSON (es. limite del proxy)
      }
      if (xhr.status === 200 && json.id) resolve(json.id);
      else
        reject(new Error(json.error ?? (xhr.status === 413 ? 'FILE_TOO_LARGE' : 'UPLOAD_FAILED')));
    };
    xhr.onerror = () => reject(new Error('UPLOAD_FAILED'));
    xhr.send(body);
  });
}

export const formatDuration = (sec: number | null) => {
  if (!sec) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const LAST_TRIP_KEY = 'tripshare.lastTrip';

/** Ricorda l'ultimo viaggio aperto: è quello proposto quando si caricano dei ricordi. */
export function rememberTrip(id: string) {
  try {
    localStorage.setItem(LAST_TRIP_KEY, id);
  } catch {
    // non salvato: pazienza
  }
}

export function lastTrip(): string | null {
  try {
    return localStorage.getItem(LAST_TRIP_KEY);
  } catch {
    return null;
  }
}
