/**
 * Il testo di "reply" in un JSON ancora incompleto: serve a mostrare la risposta dell'assistente
 * mentre il modello la scrive. Restituisce null finché la chiave "reply" non è comparsa.
 */
export function replyFromPartialJson(text: string): string | null {
  const key = /"reply"\s*:\s*"/.exec(text);
  if (!key) return null;
  let out = '';
  for (let i = key.index + key[0].length; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') return out;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) return out;
    if (next === 'u') {
      const hex = text.slice(i + 2, i + 6);
      // Sequenza non ancora completa: si aspetta il prossimo pezzo.
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
    out += map[next] ?? next;
    i += 1;
  }
  return out;
}

/** Chiama `emit` al massimo ogni `ms` con l'ultimo testo ricevuto. */
export function throttleText(emit: (text: string) => void, ms = 120) {
  let last = 0;
  return (text: string) => {
    const now = Date.now();
    if (now - last < ms) return;
    last = now;
    emit(text);
  };
}
