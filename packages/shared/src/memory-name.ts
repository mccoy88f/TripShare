/**
 * Nome del file di un ricordo scaricato o condiviso: data e ora (UTC, uguali per tutti) più un
 * pezzo dell'identificativo. Lo stesso nome vale per il server e per l'app.
 */
export function memoryFileName(
  memory: { id: string; kind: string; at: Date },
  photoAsJpeg: boolean,
): string {
  const iso = memory.at.toISOString();
  const stamp = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 16).replace(':', '')}`;
  const ext = memory.kind === 'video' ? 'mp4' : photoAsJpeg ? 'jpg' : 'webp';
  return `ricordo-${stamp}-${memory.id.slice(0, 6)}.${ext}`;
}
