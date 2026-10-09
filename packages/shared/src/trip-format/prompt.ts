import type { CurrencyCode } from '../currencies.js';
import type { Locale } from '../locales.js';
import { tripDocumentJsonSchema } from './json-schema.js';
import { TRIP_FORMAT_VERSION } from './schema.js';

export interface TripRequest {
  /** Richiesta libera dell'utente, es. "Scozia in auto, 5 giorni, Harry Potter e Loch Ness". */
  prompt: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  currency: CurrencyCode;
  departureFrom?: string;
  budget?: { amount: number; currency: CurrencyCode; basis: 'total' | 'per_person' };
  style?: string[];
  /** Data odierna, per ragionare su stagione e disponibilità. */
  today: string;
}

const RULES: Record<Locale, string> = {
  it: `Sei l'assistente di viaggio di TripShare. Crei programmi di viaggio realistici, dettagliati e utili per un gruppo.

Rispondi SOLO con un documento JSON valido nel formato "TripShare Trip Format" versione ${TRIP_FORMAT_VERSION}, che rispetta lo schema fornito. Niente testo prima o dopo il JSON.

Regole:
- Tutti i testi in italiano ("language": "it").
- Un elemento in "days" per ogni giorno, dal primo all'ultimo, in ordine. Le attività di ogni giorno sono in ordine cronologico, con orari realistici che tengono conto di distanze, tempi di guida, orari di apertura e luce del giorno.
- Ogni luogo citato da un'attività è in "places" e l'attività lo richiama con "placeIds". Gli "id" sono brevi, in kebab-case e unici in tutto il documento.
- Gli spostamenti vanno in "transport" con mezzo, durata e distanza. Se esiste un'alternativa sensata (tram o taxi), mettila in "transport.alternatives".
- Importi in unità maggiori con la loro valuta locale (es. sterline nel Regno Unito). Indica "basis" e usa "approximate": true per le stime. Riempi "exchangeRates" verso la valuta del viaggio per ogni valuta usata.
- In "budget" metti alloggi, trasporti, carburante, pasti, ingressi e documenti, con categoria e stato ("estimate" se non prenotato).
- Usa "verification.status": "verified" solo se hai letto orari o prezzi su una fonte ufficiale e la citi in "sources". Altrimenti "unverified".
- "warnings" per ciò che può rovinare la giornata: chiusure, ultimo ingresso, prenotazione obbligatoria, tramonto, strade difficili.
- Proponi "alternatives" per le parti del giorno che dipendono dal meteo o dalla stanchezza.
- In "packing" metti documenti, adempimenti prima della partenza e cose da portare legate a clima e attività.
- In "tips" i consigli generali su guida, fuso orario, pagamenti, connessione e stagione.
- Una sola emoji pertinente in "trip.emoji" e, dove utile, nelle attività.
- Non inventare codici di prenotazione, numeri di volo o prezzi precisi che non conosci.`,
  en: `You are TripShare's travel assistant. You create realistic, detailed and useful trip plans for groups.

Reply ONLY with a valid JSON document in the "TripShare Trip Format" version ${TRIP_FORMAT_VERSION}, matching the provided schema. No text before or after the JSON.

Rules:
- All text in English ("language": "en").
- One entry in "days" for every day, first to last, in order. Activities in each day are chronological, with realistic times that account for distances, driving times, opening hours and daylight.
- Every place used by an activity is listed in "places" and referenced through "placeIds". "id" values are short, kebab-case and unique across the whole document.
- Put movements in "transport" with mode, duration and distance. If there is a sensible alternative (tram or taxi), add it to "transport.alternatives".
- Amounts in major units with their local currency (e.g. pounds in the UK). Set "basis" and use "approximate": true for estimates. Fill "exchangeRates" towards the trip currency for every currency used.
- In "budget" list lodging, transport, fuel, meals, tickets and documents, with category and status ("estimate" if not booked).
- Use "verification.status": "verified" only if you read hours or prices on an official source and cite it in "sources". Otherwise "unverified".
- "warnings" for anything that can ruin the day: closures, last entry, mandatory booking, sunset, difficult roads.
- Offer "alternatives" for parts of the day that depend on weather or tiredness.
- In "packing" list documents, pre-departure tasks and items tied to climate and activities.
- In "tips" give general advice on driving, time zone, payments, connectivity and season.
- One relevant emoji in "trip.emoji" and, where useful, in activities.
- Do not invent booking codes, flight numbers or precise prices you do not know.`,
};

function describeRequest(req: TripRequest, locale: Locale): string {
  const it = locale === 'it';
  const lines: string[] = [];
  const add = (label: [string, string], value: string | number | undefined) => {
    if (value !== undefined && value !== '') lines.push(`- ${it ? label[0] : label[1]}: ${value}`);
  };
  add(['Oggi è', 'Today is'], req.today);
  add(['Destinazione', 'Destination'], req.destination);
  add(['Data di inizio', 'Start date'], req.startDate);
  add(['Data di fine', 'End date'], req.endDate);
  add(['Viaggiatori', 'Travelers'], req.travelers);
  add(['Partenza da', 'Departing from'], req.departureFrom);
  add(['Valuta del viaggio', 'Trip currency'], req.currency);
  if (req.budget) {
    const basis = req.budget.basis === 'per_person' ? (it ? 'a persona' : 'per person') : it ? 'totale' : 'total';
    add(['Budget', 'Budget'], `${req.budget.amount} ${req.budget.currency} ${basis}`);
  }
  if (req.style?.length) add(['Stile', 'Style'], req.style.join(', '));
  return `${it ? 'Richiesta del gruppo' : 'Group request'}:\n${req.prompt.trim()}\n\n${
    it ? 'Dati del viaggio' : 'Trip details'
  }:\n${lines.join('\n')}`;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Messaggi e `response_format` per chiedere a un modello (via OpenRouter) un viaggio completo.
 * Lo schema va anche nel prompt di sistema: alcuni modelli ignorano `response_format`.
 */
export function buildTripGenerationRequest(req: TripRequest, locale: Locale) {
  const schema = tripDocumentJsonSchema();
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${RULES[locale]}\n\nJSON Schema:\n${JSON.stringify(schema)}`,
    },
    { role: 'user', content: describeRequest(req, locale) },
  ];
  return {
    messages,
    response_format: {
      type: 'json_schema' as const,
      json_schema: { name: 'tripshare_trip_v1', strict: false, schema },
    },
  };
}

/**
 * Messaggio per chiedere al modello di correggere un documento non valido, con l'elenco
 * degli errori di validazione.
 */
export function buildRepairMessage(
  issues: readonly { path: string; message: string }[],
  locale: Locale,
): ChatMessage {
  const list = issues
    .slice(0, 30)
    .map((i) => `- ${i.path}: ${i.message}`)
    .join('\n');
  return {
    role: 'user',
    content:
      locale === 'it'
        ? `Il JSON non è valido per lo schema. Correggi questi errori e rispondi di nuovo con il documento completo, solo JSON:\n${list}`
        : `The JSON does not match the schema. Fix these errors and reply again with the full document, JSON only:\n${list}`,
  };
}
