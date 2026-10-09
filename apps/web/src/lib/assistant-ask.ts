/** Domanda da porre all'assistente in una nuova chat, passata dalla ricerca al tab Assistente. */
let pending: string | null = null;

export const askAssistant = (text: string) => {
  pending = text;
};
export const hasPendingAsk = () => pending !== null;
export function takePendingAsk() {
  const text = pending;
  pending = null;
  return text;
}
