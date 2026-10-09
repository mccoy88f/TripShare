import { useSyncExternalStore } from 'react';

/**
 * Elemento da mostrare dopo una ricerca: il tab giusto viene aperto dalla pagina, qui si
 * ritrova l'elemento (marcato con data-search-id), lo si porta in vista e lo si evidenzia.
 */
let state = { n: 0, date: undefined as string | undefined, key: '' };
const listeners = new Set<() => void>();

export const searchId = (key: string) => ({ 'data-search-id': key });

/** Giorno del programma da selezionare prima di evidenziare un'attività; si consuma una volta. */
export function takeFocusDate() {
  const date = state.date;
  state = { ...state, date: undefined };
  return date;
}

/** Chiave dell'ultimo elemento richiesto (per aprire sezioni chiuse che lo contengono). */
export const focusedKey = () => state.key;

export function useFocusRequest() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state.n,
  );
}

export function focusItem(key: string, date?: string) {
  state = { n: state.n + 1, date, key };
  listeners.forEach((l) => l());
  // L'elemento compare solo dopo il cambio di tab (e del giorno): si riprova per qualche secondo.
  let tries = 0;
  const timer = window.setInterval(() => {
    const el = document.querySelector<HTMLElement>(`[data-search-id="${CSS.escape(key)}"]`);
    if (el) {
      window.clearInterval(timer);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('search-flash');
      void el.offsetWidth;
      el.classList.add('search-flash');
      window.setTimeout(() => el.classList.remove('search-flash'), 2600);
    } else if (++tries > 30) window.clearInterval(timer);
  }, 100);
}
