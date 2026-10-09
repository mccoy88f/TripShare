# TripShare Trip Format v1

TripShare usa un unico documento JSON per descrivere un viaggio. Lo usano:
- l'**AI**, quando genera un viaggio: il prompt chiede questo formato;
- l'**import** e l'**export** dei viaggi;
- le **API**, per creare un viaggio completo in una sola chiamata.

| File | Contenuto |
|---|---|
| `packages/shared/src/trip-format/schema.ts` | Schema Zod: la fonte di verità |
| `packages/shared/schema/trip.v1.schema.json` | JSON Schema generato (draft 2020-12). Si rigenera con `pnpm schema:trip` |
| `packages/shared/examples/scozia.trip.json` | Esempio completo: Scozia, 5 giorni in auto |
| `packages/shared/src/trip-format/prompt.ts` | Prompt di sistema (italiano e inglese) e `response_format` per OpenRouter |

## Regole generali

- **Date** in formato `YYYY-MM-DD`. **Orari** in formato `HH:MM` a 24 ore, nell'ora locale del luogo.
- **Importi** in unità maggiori (`23.5` = 23,50 £), sempre con la loro valuta. Nel database
  l'app li salva in centesimi interi.
- **Collegamenti tra oggetti** tramite `id` in kebab-case, unici in tutto il documento:
  - `placeIds` puntano a `places[].id`;
  - `bookingId` e `stayBookingId` puntano a `bookings[].id`;
  - `replacesActivityIds` punta alle attività dello stesso giorno.
- `formatVersion` vale `1`. Una modifica incompatibile del formato porta alla versione 2, con
  una funzione di migrazione.

## Struttura

```text
TripDocument
├── formatVersion: 1
├── language: "it" | "en"
├── trip            titolo, emoji, destinazione, date, fuso, valuta, viaggiatori, stile, coverQuery
├── places[]        luoghi: tipo, indirizzo, mapsQuery, coordinate, orari, prezzo, verifica, link
├── bookings[]      prenotazioni: volo, alloggio, noleggio, parcheggio, biglietto…, stato, costo
├── days[]          un elemento per giorno, in ordine
│   ├── route[]         tappe del giorno
│   ├── stayBookingId   alloggio della notte
│   ├── activities[]    voci del programma in ordine cronologico
│   │   └── transport   mezzo, durata, km, strada, costo, alternatives[]
│   └── alternatives[]  piani B che sostituiscono alcune attività
├── budget[]        voci di budget: booked | pending | estimate, included
├── packing[]       documenti, adempimenti e cose da portare
├── tips[]          consigli generali
├── exchangeRates   tassi verso la valuta del viaggio, usati per le stime
└── disclaimer, generatedBy
```

### Oggetto `Money`

```json
{ "amount": 14, "currency": "GBP", "basis": "per_person", "approximate": false, "note": "14 £ online, 16 £ in loco" }
```

`basis` indica a cosa si riferisce l'importo:

| Valore | Significato |
|---|---|
| `total` | importo complessivo (predefinito) |
| `per_person` | a persona: si moltiplica per `trip.travelers` |
| `per_night` | a notte |
| `per_vehicle` | per veicolo |
| `per_day` | al giorno |

`approximate: true` segna le stime.

### Verifica delle informazioni

`verification.status` vale `"verified"` solo se orari o prezzi sono stati letti su una fonte
ufficiale, citata in `sources` insieme alla data del controllo (`checkedAt`). In tutti gli
altri casi vale `"unverified"`. L'app mostra lo stato come badge *verificato* o
*da controllare*.

### Voci di budget

| `status` | Significato | `amount` |
|---|---|---|
| `booked` | già prenotato, importo noto | obbligatorio |
| `pending` | prenotato, importo da inserire dalla ricevuta | facoltativo |
| `estimate` | stima | obbligatorio |

`included: false` esclude la voce dal totale (es. un ingresso facoltativo).

## Validazione

`parseTripDocument(json)` applica i valori predefiniti e controlla, oltre alla struttura:
- id duplicati;
- riferimenti a luoghi, prenotazioni o attività che non esistono;
- giorni duplicati, fuori ordine o fuori dalle date del viaggio;
- `endDate` precedente a `startDate`;
- voci di budget senza importo quando lo stato non è `pending`.

## Uso con OpenRouter

```ts
import {
  buildTripGenerationRequest,
  buildRepairMessage,
  extractJson,
  parseTripDocument,
} from '@tripshare/shared/trip-format';

const { messages, response_format } = buildTripGenerationRequest(
  { prompt: 'Scozia in auto, Harry Potter e Loch Ness', travelers: 4, currency: 'EUR',
    startDate: '2026-10-12', endDate: '2026-10-16', today: '2026-10-09' },
  'it',
);
// POST https://openrouter.ai/api/v1/chat/completions { model, messages, response_format }
const result = parseTripDocument(extractJson(reply));
if (!result.success) {
  // Si rimanda al modello la sua risposta e gli errori, con al massimo 2 tentativi.
  messages.push({ role: 'assistant', content: reply }, buildRepairMessage(result.issues, 'it'));
}
```

Il JSON Schema va sia in `response_format`, per i modelli che supportano l'output
strutturato, sia nel prompt di sistema, per quelli che lo ignorano. `strict` è `false`
perché lo schema ha campi facoltativi; la validazione con Zod sul server resta comunque
obbligatoria.
