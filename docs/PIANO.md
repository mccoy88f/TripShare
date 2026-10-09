# TripShare — Piano di progetto

Un'app per **organizzare viaggi di gruppo e dividere le spese** in stile Splitwise.
È una **PWA installabile**, gira in **Docker**, usa **OpenRouter** per l'AI.

La pagina *“Scozia 12-16 ottobre”* serve solo come **riferimento per il
contenuto e la struttura** di un viaggio: un programma giorno per giorno con
orari, i luoghi con link e orari verificati, i pasti, il meteo, i costi (già
prenotati, da inserire, stime) e la lista delle cose da portare. Grafica e
funzionalità di quella pagina **non** sono un modello. TripShare deve gestire
viaggi con questa ricchezza di informazioni, in modo collaborativo e dinamico,
e aggiungere la divisione delle spese.

---

## 1. Obiettivi

1. **Pianificare**: un viaggio diviso in giorni, con attività sulla timeline,
   luoghi, spostamenti, pernottamenti e alternative (es. “Steall Falls al posto
   di Loch Ness”).
2. **Condividere**: si invita il gruppo con un link. Ognuno vede e modifica in
   tempo reale, in base al proprio ruolo.
3. **Dividere le spese**: chi ha pagato, per chi, in che valuta, in che modo
   (in parti uguali, importi esatti, percentuali, quote, per singola voce).
   Il saldo finale usa il minor numero possibile di trasferimenti.
4. **AI con OpenRouter**:
   - generare un viaggio da una richiesta testuale;
   - dare consigli contestuali;
   - **riconoscere scontrini, screenshot e ricevute** e trasformarli in spese
     o in prenotazioni.
5. **Esperienza moderna**: veloce, animata, usabile offline, con tema chiaro e
   scuro, pensata prima per il telefono.

## 2. Funzionalità

### 2.1 Viaggi e programma (struttura ricavata dall'esempio Scozia)
| Elemento della pagina Scozia | Entità in TripShare |
|---|---|
| Intestazione (date, n. persone, descrizione) | `Trip` (titolo, date, valuta base, copertina, membri) |
| Striscia dei giorni (12 Edimburgo · The Spires…) | `Day` (data, titolo, percorso, pernottamento collegato) |
| Voci orarie (08:00 Partenza…) | `Activity` (ora, titolo, note, tipo: trasporto, visita, pasto, check-in…) |
| Etichette “IN AUTO · 2h”, “TRAM ~35 min” | `TransportLeg` (mezzo, durata, km, opzioni alternative con costo) |
| Avvisi (“tramonto 18:00”, “prenotate online”) | `Activity.warnings[]` |
| Blocco “Alternativa per il pomeriggio” | `ActivityAlternative` (sostituisce un gruppo di attività) |
| Scheda Luoghi (orari, verificato / da controllare, link) | `Place` (query Maps, coordinate, orari, `verifiedAt`, fonti) |
| Scheda Pasti | `Place` di tipo ristorante, con fascia di prezzo e pasto (colazione, pranzo, cena) |
| Scheda Meteo | servizio Open-Meteo, salvato in cache per ogni giorno e località |
| Scheda Costi (prenotato / da inserire / stime) | `BudgetItem` con stato `booked`, `pending` o `estimate`, più l'opzione “includi” |
| Scheda Da portare | `PackingList` condivisa e per persona, con spunte |

Visualizzazioni:
- **Timeline del giorno**;
- **Mappa del viaggio**: Leaflet con OpenStreetMap, percorso e luoghi;
- **Calendario**;
- **Esportazione** in PDF, in `.ics` e come link pubblico in sola lettura.

### 2.2 Spese stile Splitwise
- **Spesa**: importo, valuta, cambio del giorno, chi ha pagato (anche più
  persone), partecipanti, metodo di divisione, categoria, data, giorno e
  attività collegati, foto della ricevuta, note.
- **Metodi di divisione**: in parti uguali, importi esatti, percentuali, quote
  (es. 2 per una coppia), **per singola voce** (dalle righe dello scontrino:
  “chi ha preso cosa”).
- **Multivaluta**: EUR e GBP nello stesso viaggio. Il cambio viene fissato al
  momento della spesa (API Frankfurter/BCE) e si può correggere a mano.
- **Saldi**: quanto deve o deve ricevere ciascuno, con algoritmo di
  **semplificazione dei debiti** (minimizzazione dei flussi, greedy su crediti e
  debiti netti).
- **Rimborsi**: si registra un pagamento tra membri. Facoltativo: link o QR per
  PayPal, Satispay o IBAN.
- **Budget e consuntivo**: confronto tra le stime della pianificazione e le
  spese reali, per categoria e per giorno. Un `BudgetItem` “da inserire” diventa
  una spesa reale quando arriva la ricevuta.
- **Statistiche**: grafici per categoria, persona e giorno; costo a testa.
- **Esportazione** in CSV e PDF del resoconto.

### 2.3 AI (OpenRouter)
Tutte le chiamate passano **dal backend**: la chiave non arriva mai al client.
I modelli si configurano per funzione, con un elenco di riserva (`models[]` di
OpenRouter) se il primo non risponde.

| Funzione | Input | Output (JSON validato con Zod) | Modello indicativo |
|---|---|---|---|
| **Generatore di viaggi** | destinazione, date, persone, stile, budget, vincoli (“in auto”, “Harry Potter”) | `Trip` completo: giorni, attività, luoghi, spostamenti, stime, lista bagagli | modello di ragionamento con output strutturato; variante `:online` per orari reali |
| **Riempi e verifica** | un giorno o un luogo | orari aggiornati con **fonti**, flag verificato o da controllare | modello con ricerca web (plugin `web` di OpenRouter) |
| **Consigli e chat** | domanda e contesto del viaggio (giorni, meteo, budget) | risposta e **azioni proposte** via tool calling: `addActivity`, `addExpense`, `swapAlternative` | modello conversazionale veloce |
| **Scontrini e ricevute** | foto o PDF | esercente, data, totale, valuta, righe, IVA, categoria e confidenza per campo | modello vision |
| **Screenshot di prenotazioni** | screenshot o PDF (Ryanair, Booking, noleggio auto) | prenotazione: voli, alloggi, noleggi come `Activity`, `BudgetItem` ed eventuale `Expense` | modello vision |
| **Lista bagagli intelligente** | meteo, attività (trekking, castello) | voci da aggiungere alla lista | modello leggero |

Flusso per lo scontrino:
1. Si scatta la foto (fotocamera della PWA) o si condivide l'immagine verso
   l'app (Web Share Target).
2. Il client comprime l'immagine e la carica su MinIO. I dati EXIF di
   posizione vengono rimossi.
3. Un job in coda chiama il modello vision e valida il JSON restituito.
4. Il risultato arriva in tempo reale. L'utente vede la **bozza di spesa** con
   i campi incerti evidenziati e decide la divisione, anche per singola voce.
5. L'utente conferma, la spesa si salva e i saldi si aggiornano per tutti.

Controllo dei costi: si registrano token e costo (dalla risposta di OpenRouter)
per utente e per viaggio. Ci sono limiti configurabili. Facoltativo: ogni utente
può usare la propria chiave OpenRouter (BYOK).

### 2.4 Collaborazione
- Inviti con link o QR. Ruoli: `owner`, `editor`, `viewer`.
- Anche partecipanti senza account (“ospiti”), che si possono collegare dopo.
- Aggiornamenti in tempo reale via WebSocket: spese, spunte, modifiche.
- Commenti e reazioni sulle attività; registro delle attività del viaggio.
- **Notifiche Web Push**: “Marco ha aggiunto 34 € parcheggio”, “domani si parte
  alle 07:15”.

### 2.5 PWA e offline
- Installabile (manifest, icone, splash), schermo intero, safe area.
- Service worker (Workbox): l'interfaccia si carica dalla cache. Programma,
  luoghi e lista restano disponibili offline (dati in IndexedDB con Dexie).
- **Coda di invio offline**: spese e spunte create senza rete si sincronizzano
  quando la rete torna (Background Sync, con riserva all'apertura dell'app).
- Web Share Target per ricevere foto o PDF da altre app; accesso alla
  fotocamera; Badging API per i saldi.

## 3. Architettura

```
                ┌───────────────────────── Docker Compose ─────────────────────────┐
 Browser/PWA ──▶│ caddy (HTTPS automatico, reverse proxy)                          │
                │   ├── /        → web   (build statica React, servita da Caddy)   │
                │   ├── /api     → api   (Fastify + tRPC/REST, WebSocket)          │
                │   └── /files   → minio (URL firmati)                             │
                │ worker (BullMQ): OCR scontrini, generazione AI, push, export      │
                │ postgres 16 · redis 7 · minio (S3)                               │
                └──────────────────────────────────────────────────────────────────┘
                       │                         │                     │
                  OpenRouter API         Open-Meteo / Frankfurter   OSM tiles
```

### Stack scelto
- **Monorepo** con pnpm e Turborepo:
  - `apps/web`
  - `apps/api`
  - `apps/worker`
  - `packages/shared` (schemi Zod, tipi, logica di divisione)
  - `packages/db`
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui (Radix),
  Framer Motion per le animazioni, TanStack Router e TanStack Query, Dexie
  (IndexedDB), `vite-plugin-pwa`, Leaflet, Recharts, i18n (italiano e inglese).
- **Backend**: Node 22, Fastify, tRPC (tipi condivisi end-to-end), WebSocket
  per il tempo reale, Zod.
- **Database**: PostgreSQL con Drizzle ORM e migrazioni versionate.
- **Code e cache**: Redis con BullMQ.
- **File**: MinIO, compatibile S3, sostituibile con S3 o R2.
- **Autenticazione**: Better Auth (email e password, magic link, passkey,
  OAuth Google facoltativo); sessioni in cookie httpOnly.
- **Importi** in **centesimi interi** (`bigint`) con codice valuta ISO; mai
  numeri a virgola mobile.

### Modello dati (essenziale)
```
User ─┬─< TripMember >── Trip ──< Day ──< Activity ──< ActivityAlternative
      │                    │         └── stay → Booking
      │                    ├──< Place (coordinate, orari, verifiedAt, sources[])
      │                    ├──< Booking (volo/alloggio/noleggio, codice, allegati)
      │                    ├──< BudgetItem (booked|pending|estimate, included)
      │                    ├──< Expense ──< ExpensePayer, ExpenseShare, ExpenseItem
      │                    │        └── Receipt (file, ocr_json, status, confidence)
      │                    ├──< Settlement (from, to, amount, currency)
      │                    ├──< PackingItem (owner?, checked_by)
      │                    └──< AiJob (tipo, modello, token, costo, stato)
      └──< PushSubscription
```

## 4. Docker

- `docker-compose.yml` con i servizi `caddy`, `api`, `worker`, `postgres`,
  `redis`, `minio`. Il frontend è compilato dentro l'immagine `caddy` oppure
  servito da `api`.
- Dockerfile multi-stage (build con pnpm, runtime `node:22-alpine` non root);
  immagini pubblicate su GHCR da GitHub Actions (amd64 e arm64, così gira anche
  su Raspberry Pi o NAS).
- `.env.example`:

  ```
  OPENROUTER_API_KEY
  OPENROUTER_MODEL_VISION
  OPENROUTER_MODEL_PLANNER
  OPENROUTER_MODEL_CHAT
  APP_URL
  DATABASE_URL
  REDIS_URL
  S3_*
  VAPID_PUBLIC_KEY
  VAPID_PRIVATE_KEY
  AUTH_SECRET
  ```

- Volumi persistenti per `postgres`, `minio` e `caddy`. Healthcheck su ogni
  servizio. Migrazioni eseguite all'avvio di `api`.
- Backup: servizio facoltativo che esegue `pg_dump` e copia i dati di MinIO
  ogni giorno.
- `docker-compose.dev.yml` con hot reload e Mailpit per le email di test.
- Nota: una PWA richiede HTTPS. Caddy lo gestisce in automatico su un dominio
  pubblico; in LAN si usa una CA locale di Caddy oppure Tailscale.

## 5. Design e UX

- **Identità visiva propria**, definita da zero nella fase 0 con un piccolo
  design system: token colore con tema chiaro e scuro, scala tipografica, cifre
  tabellari per gli importi, componenti shadcn/ui personalizzati.
- Ogni viaggio ha un **tema dinamico**: il colore d'accento si ricava dalla
  foto di copertina o dalla destinazione.
- Navigazione mobile con barra in basso: **Viaggi · Programma · Spese · Saldi ·
  Altro**. Pulsante flottante “+” per spesa, scontrino o attività.
- Micro-interazioni: spunte animate, swipe sulle spese (modifica / elimina),
  `View Transitions` tra le schermate, aggiornamento ottimistico.
- Accessibilità: contrasto AA, aree tattili di almeno 44 px, rispetto di
  `prefers-reduced-motion`.

## 6. Sicurezza e privacy
- Chiave OpenRouter solo lato server. Rate limit per utente sugli endpoint AI.
- Autorizzazione per viaggio su ogni query: il membro viene verificato nel
  middleware tRPC.
- File serviti con URL firmati a scadenza; dati EXIF rimossi; limiti di
  dimensione e tipo.
- I dati personali delle ricevute restano sul proprio server: nessuna terza
  parte oltre al modello chiamato. Avviso chiaro all'utente e opzione per
  scegliere modelli con policy “no training” (filtro `provider.data_collection:
  deny` di OpenRouter).
- Esportazione e cancellazione dei dati dell'utente (GDPR).

## 7. Test e qualità
- **Vitest**:
  - logica di divisione e semplificazione dei debiti, con test property-based
    (fast-check): la somma dei saldi è sempre 0 e gli arrotondamenti dei
    centesimi sono distribuiti in modo deterministico;
  - schemi Zod.
- **Test AI** con risposte registrate (fixture JSON) e un piccolo set di
  scontrini veri anonimizzati per misurare l'accuratezza dell'estrazione.
- **Playwright** end-to-end: creazione del viaggio, invito, spesa, saldo;
  scenario offline.
- CI con GitHub Actions: lint (ESLint e Prettier), typecheck, test, build delle
  immagini Docker, Lighthouse PWA.

## 8. Roadmap

| Fase | Contenuto | Risultato |
|---|---|---|
| **0. Fondamenta** (1 settimana) | monorepo, Docker Compose, Caddy, database con migrazioni, autenticazione, CI, shell PWA installabile | `docker compose up` funziona e la PWA è installabile |
| **1. Spese, il cuore Splitwise** (2 settimane) | viaggi, membri e inviti, spese con tutti i metodi di divisione, multivaluta, saldi, semplificazione, rimborsi | uno Splitwise di viaggio utilizzabile |
| **2. Pianificazione** (2 settimane) | giorni, timeline, attività, alternative, luoghi, mappa, prenotazioni, budget con stime, lista bagagli, meteo | la Scozia ricostruita a mano dentro l'app |
| **3. AI** (2 settimane) | client OpenRouter, coda AI, scontrini e screenshot verso spese e prenotazioni, generatore di viaggi, chat con azioni, verifica degli orari con fonti, controllo dei costi | “Fammi un viaggio in Scozia in 5 giorni in auto” produce un programma completo |
| **4. Tempo reale e offline** (1 settimana) | WebSocket, coda di invio offline, Background Sync, Web Push, Share Target | uso in viaggio senza rete |
| **5. Rifinitura** (1 settimana) | esportazione PDF e ICS, link pubblico, statistiche, temi dinamici, animazioni, i18n, accessibilità, documentazione | versione 1.0 |
| Dopo la 1.0 | importazione da Splitwise e CSV, tracciamento dei prezzi dei voli, app nativa con Capacitor | |

**MVP consigliato**: le fasi 0, 1 e la parte di scontrini della fase 3. È il
valore più immediato per il prossimo viaggio.

## 9. Decisioni aperte
1. **Hosting**: server personale o NAS in LAN, oppure VPS con dominio pubblico?
   Dalla risposta dipendono HTTPS e push.
2. **Account**: per tutti i membri, o anche ospiti senza registrazione via link?
3. **Chiave OpenRouter**: una sola dell'istanza, oppure ogni utente usa la
   propria?
4. **Lingua**: solo italiano o anche inglese dal primo rilascio?
5. **Rimborsi**: basta registrarli, oppure servono link di pagamento
   (PayPal, Satispay)?
