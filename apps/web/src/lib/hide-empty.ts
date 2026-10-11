import { useLayoutEffect, type RefObject } from 'react';

/**
 * In dettaglio (sola lettura) nasconde i campi senza valore: si vedono solo quelli compilati.
 * Vale per i `Field` con un campo nativo (testo, numero, menù, testo lungo); quelli con
 * controlli personalizzati restano. Si rifà a ogni disegno, perché i valori possono arrivare
 * dopo, e tutto torna visibile appena si passa alla modifica.
 */
export function useHideEmptyFields(active: boolean, root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const hidden: HTMLElement[] = [];
    if (active) {
      for (const field of root.current?.querySelectorAll<HTMLElement>('[data-field]') ?? []) {
        const controls = [
          ...field.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
            'input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea',
          ),
        ];
        if (controls.length === 0) continue;
        const empty = controls.every((c) => {
          const v = c.value.trim();
          return (
            v === '' ||
            (c instanceof HTMLSelectElement &&
              /^[—–-]$/.test(c.selectedOptions[0]?.text.trim() ?? ''))
          );
        });
        if (empty) {
          field.hidden = true;
          hidden.push(field);
        }
      }
    }
    return () => hidden.forEach((f) => (f.hidden = false));
  });
}
