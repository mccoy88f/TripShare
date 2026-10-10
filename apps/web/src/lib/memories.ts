import type { AvatarUser } from '@/components/ui/avatar';

export interface Memory {
  id: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  size: number;
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

const pad = (n: number) => String(n).padStart(2, '0');

/** Nome del file scaricato o condiviso: data e ora del ricordo più un pezzo dell'identificativo. */
export function memoryFileName(m: Memory) {
  const d = memoryDate(m);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `ricordo-${stamp}-${m.id.slice(0, 6)}.${m.kind === 'video' ? 'mp4' : 'jpg'}`;
}

/** Fa partire il download di un indirizzo con il gestore di download del browser. */
export function triggerDownload(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}

export const MAX_ZIP = 200;
export const downloadMemories = (list: Memory[]) =>
  triggerDownload(
    list.length === 1
      ? `/api/memories/${list[0]!.id}/file?v=jpg&download=1`
      : `/api/memories/zip?ids=${list.map((m) => m.id).join(',')}`,
  );

/** Il browser sa condividere file con il menu del sistema (Android, iOS, alcuni computer). */
export const canShareFiles = () =>
  typeof navigator !== 'undefined' &&
  typeof navigator.share === 'function' &&
  typeof navigator.canShare === 'function';

// I file si scaricano in anticipo: su iPhone la condivisione deve partire subito dal tocco.
const files = new Map<string, Promise<File>>();
export function prepareFile(m: Memory): Promise<File> {
  let p = files.get(m.id);
  if (!p) {
    p = fetch(`/api/memories/${m.id}/file?v=jpg`, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error('FETCH_FAILED');
        const blob = await res.blob();
        return new File([blob], memoryFileName(m), { type: blob.type });
      })
      .catch((err) => {
        files.delete(m.id);
        throw err;
      });
    files.set(m.id, p);
  }
  return p;
}

export type ShareResult = 'shared' | 'cancelled' | 'retry' | 'unsupported' | 'failed';

/** Apre il menu "Condividi" del sistema con i file dei ricordi. */
export async function shareMemories(list: Memory[]): Promise<ShareResult> {
  try {
    const picked = await Promise.all(list.map(prepareFile));
    if (!navigator.canShare?.({ files: picked })) return 'unsupported';
    await navigator.share({ files: picked });
    return 'shared';
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'AbortError') return 'cancelled';
    // Il tocco è "scaduto" durante il caricamento dei file: ora sono pronti, basta riprovare.
    if (name === 'NotAllowedError') return 'retry';
    return 'failed';
  }
}
