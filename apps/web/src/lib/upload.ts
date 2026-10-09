/** Carica un'immagine con multipart; restituisce l'URL o lancia un errore con il codice del server. */
export async function uploadImage(url: string, file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(url, { method: 'POST', body, credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? 'UPLOAD_FAILED');
  return data.url;
}
