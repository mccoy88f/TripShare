import { useState } from 'react';

/**
 * Un elemento già esistente si apre in sola lettura ("Dettaglio"); la matita abilita la modifica.
 * Un elemento nuovo parte direttamente in modifica. `key` cambia a ogni nuova apertura
 * (es. id dell'elemento + stato aperto) e riporta la scheda in sola lettura.
 */
export function useDetailMode(existing: boolean, key: string = '') {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  return { readOnly: existing && editingKey !== key, startEdit: () => setEditingKey(key) };
}
