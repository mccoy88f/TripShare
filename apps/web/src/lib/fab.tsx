import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Pulsante "+" al centro della barra in basso: ogni pagina può registrare la sua azione
 * (nuova spesa, nuovo luogo…). Senza azione registrata il "+" crea un nuovo viaggio.
 */
export interface FabAction {
  label: string;
  run: () => void;
}

let current: FabAction | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useFabAction(action: FabAction | null) {
  const ref = useRef(action);
  ref.current = action;
  const label = action?.label ?? null;
  useEffect(() => {
    if (label === null) return;
    const entry: FabAction = { label, run: () => ref.current?.run() };
    current = entry;
    emit();
    return () => {
      if (current === entry) {
        current = null;
        emit();
      }
    };
  }, [label]);
}

export function useCurrentFab() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** Richiesta di "aggiungi" inviata dal "+" al tab attivo del viaggio. */
export const AddRequestContext = createContext<{ target: string; n: number }>({
  target: '',
  n: 0,
});

/** Esegue `onAdd` quando il "+" viene premuto mentre è attivo il tab `target`. */
export function useOnAdd(target: string, onAdd: () => void) {
  const { target: t, n } = useContext(AddRequestContext);
  const ref = useRef(onAdd);
  ref.current = onAdd;
  const seen = useRef(n);
  useEffect(() => {
    if (n !== seen.current && t === target) ref.current();
    seen.current = n;
  }, [n, t, target]);
}
