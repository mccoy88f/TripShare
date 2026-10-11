import { useEffect, useRef } from 'react';

/**
 * Il pulsante "indietro" (o lo swipe dal bordo su Android e iOS) chiude finestre, anteprime e
 * gallerie aperte invece di uscire dalla pagina.
 *
 * Ogni finestra aperta aggiunge una voce alla cronologia con lo stesso indirizzo (e lo stesso
 * stato del router, così non cambia pagina né scorrimento). Tornando indietro la voce si
 * toglie e la finestra si chiude; se invece si chiude con i suoi pulsanti, la voce si toglie da
 * sola. Una voce rimasta orfana (ad esempio dopo un cambio di pagina) viene saltata.
 */
const stack: string[] = [];
let counter = 0;

const overlayKey = (state: unknown): string | undefined =>
  (state as { __overlay?: string } | null)?.__overlay;

export function useBackClose(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = `ov-${Date.now().toString(36)}-${++counter}`;
    stack.push(key);
    window.history.pushState({ ...(window.history.state as object | null), __overlay: key }, '');

    const onPop = () => {
      // Le finestre sopra la voce di arrivo si chiudono; quelle sotto restano.
      const target = overlayKey(window.history.state);
      const mine = stack.indexOf(key);
      const reached = target ? stack.indexOf(target) : -1;
      if (mine > reached) close.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      const i = stack.indexOf(key);
      if (i >= 0) stack.splice(i, 1);
      // Chiusa con i pulsanti: si toglie la sua voce, ma solo se è ancora in cima (se nel
      // frattempo la pagina è cambiata, la voce orfana la salta il controllo qui sotto).
      window.setTimeout(() => {
        if (overlayKey(window.history.state) === key) window.history.back();
      }, 0);
    };
  }, []);
}

/** Da chiamare una volta all'avvio: se si torna su una voce di una finestra già chiusa, si salta. */
export function installOverlaySkip() {
  window.addEventListener('popstate', () => {
    const key = overlayKey(window.history.state);
    if (key && !stack.includes(key)) window.history.back();
  });
}
