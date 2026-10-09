# TripShare — Piano di progetto

Un'app per **organizzare viaggi di gruppo e dividere le spese** in stile Splitwise.
È una **PWA installabile**, gira in **Docker**, usa **OpenRouter** per l'AI.

La pagina _“Scozia 12-16 ottobre”_ serve solo come **riferimento per il
contenuto e la struttura** di un viaggio: un programma giorno per giorno con
orari, i luoghi con link e orari verificati, i pasti, il meteo, i costi (già
prenotati, da inserire, stime) e la lista delle cose da portare. Grafica e
funzionalità di quella pagina **non** sono un modello. TripShare deve gestire
viaggi con questa ricchezza di informazioni, in modo collaborativo e dinamico,
e aggiungere la divisione delle spese.

### Decisioni prese

| Tema              | Scelta                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nome              | **TripShare**                                                                                                                                                 |
| Hosting           | **VPS con dominio pubblico e HTTPS** (Let's Encrypt automatico con Caddy). Il dominio si imposta con `DOMAIN`                                                 |
| Email             | **SMTP configurato con variabili d'ambiente**                                                                                                                 |
| Rimborsi          | **Link PayPal.me** precompilato se chi riceve ha impostato il suo PayPal.me. Altrimenti il rimborso si registra soltanto                                      |
| Chiave OpenRouter | **Centralizzata**, gestita dal super admin. Si può passare alla **modalità per utente**, in cui ognuno usa la propria chiave                                  |
| Lingue            | **Italiano e inglese dal primo rilascio**                                                                                                                     |
| Valuta            | **Predefinita scelta dall'utente** nel profilo, e **valuta del viaggio** scelta alla creazione                                                                |
| Accesso           | **Sito pubblico** con registrazione. Gli invitati a un viaggio si registrano dal link d'invito ed entrano direttamente nel viaggio                            |
| Amministrazione   | **Pannello super admin** per OpenRouter, utenti, registrazioni, email e impostazioni                                                                          |
| Grafica           | Moderna, basata su una libreria di componenti. **Emoji** per spese e categorie, **profilo con foto** personalizzabile, **foto di copertina** per ogni viaggio |

---

## 1. Obiettivi

1. **Pianificare**: un viaggio diviso in giorni, con attività sulla timeline,
   luoghi, spostamenti, pernottamenti e alternative (es. “Steall Falls al posto
   di Loch Ness”).
2. **Condividere**: si invita il gruppo via email o con un link. Chi è
   invitato si registra ed entra nel viaggio. Ognuno vede e modifica in tempo
   reale, in base al proprio ruolo.
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

| Elemento della pagina Scozia                             | Entità in TripShare                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Intestazione (date, n. persone, descrizione)             | `Trip` (titolo, emoji, date, valuta del viaggio, foto di copertina, membri)        |
| Striscia dei giorni (12 Edimburgo · The Spires…)         | `Day` (data, titolo, percorso, pernottamento collegato)                            |
| Voci orarie (08:00 Partenza…)                            | `Activity` (ora, titolo, note, tipo: trasporto, visita, pasto, check-in…)          |
| Etichette “IN AUTO · 2h”, “TRAM ~35 min”                 | `TransportLeg` (mezzo, durata, km, opzioni alternative con costo)                  |
| Avvisi (“tramonto 18:00”, “prenotate online”)            | `Activity.warnings[]`                                                              |
| Blocco “Alternativa per il pomeriggio”                   | `ActivityAlternative` (sostituisce un gruppo di attività)                          |
| Scheda Luoghi (orari, verificato / da controllare, link) | `Place` (query Maps, coordinate, orari, `verifiedAt`, fonti)                       |
| Scheda Pasti                                             | `Place` di tipo ristorante, con fascia di prezzo e pasto (colazione, pranzo, cena) |
| Scheda Meteo                                             | servizio Open-Meteo, salvato in cache per ogni giorno e località                   |
| Scheda Costi (prenotato / da inserire / stime)           | `BudgetItem` con stato `booked`, `pending` o `estimate`, più l'opzione “includi”   |
| Scheda Da portare                                        | `PackingList` condivisa e per persona, con spunte                                  |

Visualizzazioni:

- **Timeline del giorno**;
- **Mappa del viaggio**: Leaflet con OpenStreetMap, percorso e luoghi;
- **Calendario**;
- **Esportazione** in PDF, in `.ics` e come link pubblico in sola lettura.

### 2.2 Spese stile Splitwise

- **Spesa**: **emoji**, titolo, importo, valuta, cambio del giorno, chi ha
  pagato (anche più persone), partecipanti, metodo di divisione, categoria,
  data, giorno e attività collegati, foto della ricevuta, note.
- **Emoji**: ogni categoria ha un'emoji predefinita (🍽️ pasti, ⛽ carburante,
  🏨 alloggio, ✈️ voli, 🚕 trasporti, 🎟️ ingressi, 🛒 spesa, 🍺 bar…). Ogni
  spesa può avere la sua emoji, scelta con un selettore con ricerca in italiano
  e in inglese. Quando legge uno scontrino, l'AI propone categoria ed emoji.
- **Metodi di divisione**: in parti uguali, importi esatti, percentuali, quote
  (es. 2 per una coppia), **per singola voce** (dalle righe dello scontrino:
  “chi ha preso cosa”).
- **Valute**:
  - ogni utente sceglie la sua **valuta predefinita** nel profilo;
  - alla creazione del viaggio si sceglie la **valuta del viaggio**, che di
    default è quella di chi lo crea. Saldi e budget si calcolano in questa
    valuta;
  - ogni spesa può essere in una valuta qualsiasi (es. EUR e GBP nello stesso
    viaggio). Il cambio viene fissato al momento della spesa (API
    Frankfurter/BCE) e si può correggere a mano;
  - ogni membro può vedere anche il controvalore nella propria valuta
    predefinita, solo come informazione.
- **Saldi**: quanto deve o deve ricevere ciascuno, con algoritmo di
  **semplificazione dei debiti** (minimizzazione dei flussi, greedy su crediti e
  debiti netti).
- **Rimborsi**:
  - per ogni trasferimento suggerito (“Luca → Marco 42,50 €”) si registra il
    pagamento con data e nota facoltativa;
  - se chi riceve ha inserito il suo **username PayPal.me** nel profilo, chi
    deve pagare vede il pulsante **“Paga con PayPal”**. Il pulsante apre
    `https://paypal.me/<username>/<importo><VALUTA>` (es.
    `paypal.me/marco/42.50EUR`), quindi importo e valuta sono già compilati.
    Su mobile si apre l'app PayPal, se è installata. Si mostra anche un QR
    dello stesso link, utile se si paga da un altro dispositivo;
  - PayPal non conferma il pagamento all'app. Dopo il ritorno da PayPal, l'app
    chiede “Hai completato il pagamento?”: rispondendo sì, il rimborso viene
    registrato. Chi riceve può confermarlo o contestarlo;
  - se chi riceve non ha PayPal.me, oppure la valuta non è supportata da
    PayPal, c'è solo il pulsante **“Segna come pagato”**.
- **Budget e consuntivo**: confronto tra le stime della pianificazione e le
  spese reali, per categoria e per giorno. Un `BudgetItem` “da inserire” diventa
  una spesa reale quando arriva la ricevuta.
- **Statistiche**: grafici per categoria, persona e giorno; costo a testa.
- **Esportazione** in CSV e PDF del resoconto.

### 2.3 Formato standard del viaggio (TripShare Trip Format v1)

Ogni viaggio generato dall'AI, importato o esportato usa lo stesso documento
JSON. È definito con Zod in `packages/shared/src/trip-format/schema.ts` e ha:

- un **JSON Schema** generato (`packages/shared/schema/trip.v1.schema.json`),
  che si passa a OpenRouter come `response_format` e si include nel prompt;
- un **esempio completo**, `packages/shared/examples/scozia.trip.json`;
- un **validatore** (`parseTripDocument`) che controlla anche i riferimenti
  tra oggetti, gli id duplicati e le date. Gli errori si rimandano al modello
  con `buildRepairMessage`, per chiedergli di correggere il documento.

Documentazione del formato: `docs/TRIP_FORMAT.md`.

### 2.4 AI (OpenRouter)

Tutte le chiamate passano **dal backend**: la chiave non arriva mai al client.
I modelli si configurano per funzione, con un elenco di riserva (`models[]` di
OpenRouter) se il primo non risponde.

| Funzione                       | Input                                                                           | Output (JSON validato con Zod)                                                                  | Modello indicativo                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Generatore di viaggi**       | destinazione, date, persone, stile, budget, vincoli (“in auto”, “Harry Potter”) | `Trip` completo: giorni, attività, luoghi, spostamenti, stime, lista bagagli                    | modello di ragionamento con output strutturato; variante `:online` per orari reali |
| **Riempi e verifica**          | un giorno o un luogo                                                            | orari aggiornati con **fonti**, flag verificato o da controllare                                | modello con ricerca web (plugin `web` di OpenRouter)                               |
| **Consigli e chat**            | domanda e contesto del viaggio (giorni, meteo, budget)                          | risposta e **azioni proposte** via tool calling: `addActivity`, `addExpense`, `swapAlternative` | modello conversazionale veloce                                                     |
| **Scontrini e ricevute**       | foto o PDF                                                                      | esercente, data, totale, valuta, righe, IVA, categoria e confidenza per campo                   | modello vision                                                                     |
| **Screenshot di prenotazioni** | screenshot o PDF (Ryanair, Booking, noleggio auto)                              | prenotazione: voli, alloggi, noleggi come `Activity`, `BudgetItem` ed eventuale `Expense`       | modello vision                                                                     |
| **Lista bagagli intelligente** | meteo, attività (trekking, castello)                                            | voci da aggiungere alla lista                                                                   | modello leggero                                                                    |

Flusso per lo scontrino:

1. Si scatta la foto (fotocamera della PWA) o si condivide l'immagine verso
   l'app (Web Share Target).
2. Il client comprime l'immagine e la carica su MinIO. I dati EXIF di
   posizione vengono rimossi.
3. Un job in coda chiama il modello vision e valida il JSON restituito.
4. Il risultato arriva in tempo reale. L'utente vede la **bozza di spesa** con
   i campi incerti evidenziati e decide la divisione, anche per singola voce.
5. L'utente conferma, la spesa si salva e i saldi si aggiornano per tutti.

Le risposte dell'AI sono nella lingua dell'utente (italiano o inglese).

**Modalità della chiave**, scelta dal super admin:

| Modalità                        | Funzionamento                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Centralizzata** (predefinita) | una sola chiave dell'istanza. Il super admin imposta quote mensili per utente (richieste o euro)                        |
| **Per utente**                  | ogni utente inserisce la propria chiave OpenRouter nel profilo. Senza chiave le funzioni AI restano disattivate per lui |
| **Mista**                       | si usa la chiave centrale, ma chi vuole può usare la propria e non consuma la quota                                     |

In tutte le modalità si registrano token e costo (dalla risposta di
OpenRouter) per utente, per viaggio e per funzione. Le chiavi sono salvate
**cifrate** nel database (AES-256-GCM con una chiave master presa da una
variabile d'ambiente) e non vengono mai mostrate per intero.

### 2.5 Sito pubblico, account e inviti

- **Sito pubblico**, semplice, in italiano e in inglese:
  - home con le funzioni principali e alcune schermate;
  - pagine di registrazione e accesso;
  - privacy, termini, cookie.
    Le pagine sono pre-renderizzate per la SEO e sono servite dalla stessa app.
- **Registrazione**: email e password con verifica dell'email, recupero della
  password, accesso con magic link e passkey; Google facoltativo. Il super
  admin sceglie se le registrazioni sono **aperte** o **solo su invito**.
- **Profilo utente**:
  - nome e **foto**: caricamento con ritaglio e zoom, ridimensionata
    lato server;
  - in alternativa un **avatar emoji** su un colore a scelta;
  - lingua, **valuta predefinita**, fuso orario, tema chiaro, scuro o
    automatico;
  - notifiche;
  - **username PayPal.me** facoltativo, per ricevere i rimborsi;
  - chiave OpenRouter personale, se la modalità lo prevede.
- **Inviti a un viaggio**:
  1. Il proprietario invita **via email** o crea un **link o QR** d'invito,
     con un ruolo, una scadenza e un numero massimo di usi.
  2. Chi riceve l'invito apre il link e vede l'anteprima del viaggio
     (copertina, date, chi c'è già).
  3. Se ha già un account, accede ed entra nel viaggio. Altrimenti si registra
     con email già compilata; dopo la verifica entra subito nel viaggio.
  4. Il proprietario riceve una notifica. Si può revocare un invito in ogni
     momento.
- **Membri segnaposto**: si possono inserire subito spese per una persona non
  ancora registrata (es. “Luca”). Quando Luca accetta l'invito, il segnaposto
  si collega al suo account e conserva tutte le spese.
- Ruoli nel viaggio: `owner`, `editor`, `viewer`.

### 2.6 Pannello super admin

Accessibile solo agli utenti con ruolo `superadmin`. Il primo superadmin si
crea al primo avvio, da variabile d'ambiente o con un comando CLI.

- **OpenRouter**:
  - chiave centrale, con un pulsante per testarla e la visualizzazione del
    credito residuo;
  - modalità della chiave (centralizzata, per utente, mista);
  - **modello per funzione** (vision, generatore, chat, ricerca web, leggero),
    scelto dall'elenco dei modelli caricato dall'API di OpenRouter, con prezzi
    e modelli di riserva;
  - quote per utente e limite di spesa globale;
  - policy dei provider (es. nessun utilizzo dei dati per l'addestramento).
- **Utilizzo dell'AI**: grafici di costo e chiamate per giorno, utente e
  funzione; registro degli errori.
- **Utenti**: elenco con ricerca, dettagli, sospensione ed eliminazione, invio
  del reset password, impersonificazione in sola lettura per il supporto,
  cambio di ruolo.
- **Viaggi**: elenco e statistiche (nessun accesso ai contenuti senza un motivo
  registrato nel log).
- **Registrazioni**: aperte, solo su invito o chiuse; domini email consentiti.
- **Rimborsi**: attivazione dei link PayPal.me per l'istanza.
- **Email**: stato della configurazione SMTP letta dalle variabili d'ambiente
  (senza mostrare la password), pulsante per inviare un'email di prova, coda
  e registro degli invii, anteprima dei modelli in italiano e in inglese.
- **Impostazioni generali**:
  - nome (predefinito **TripShare**) e logo dell'istanza;
  - valute disponibili;
  - limiti di caricamento dei file;
  - chiave Unsplash per le copertine;
  - testi delle pagine legali.
- **Sistema**: stato dei servizi, code BullMQ, spazio occupato dai file, ultimi
  backup, **log di audit** delle azioni amministrative.

Le impostazioni si salvano nel database (`AppSetting`). Le variabili
d'ambiente servono solo come valori iniziali e possono essere modificate dal
pannello.

### 2.7 Collaborazione

- Aggiornamenti in tempo reale via WebSocket: spese, spunte, modifiche.
- Commenti e reazioni sulle attività; registro delle attività del viaggio.
- **Notifiche Web Push**: “Marco ha aggiunto 34 € parcheggio”, “domani si parte
  alle 07:15”.

### 2.8 PWA e offline

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
                │   ├── /        → web   (sito pubblico, app, pannello /admin)     │
                │   ├── /api     → api   (Fastify + tRPC/REST, WebSocket)          │
                │   └── /files   → minio (URL firmati)                             │
                │ worker (BullMQ): OCR scontrini, AI, email, push, immagini, export │
                │ postgres 16 · redis 7 · minio (S3)                               │
                └──────────────────────────────────────────────────────────────────┘
                       │                         │                     │
        OpenRouter · SMTP          Open-Meteo / Frankfurter     OSM · Unsplash
```

### Stack scelto

- **Monorepo** con pnpm e Turborepo:
  - `apps/web`
  - `apps/api`
  - `apps/worker`
  - `packages/shared` (schemi Zod, tipi, logica di divisione)
  - `packages/db`
- **Frontend**: un'unica app con tre aree: sito pubblico, app e `/admin`.
  - React 19, Vite e TypeScript;
  - **Tailwind CSS v4 con shadcn/ui** (Radix), Lucide per le icone, Motion
    (Framer Motion) per le animazioni;
  - **Frimousse** come selettore emoji e `react-easy-crop` per ritagliare foto
    e copertine;
  - TanStack Router e TanStack Query, Dexie (IndexedDB), `vite-plugin-pwa`,
    Leaflet, Recharts;
  - **i18next**: italiano e inglese, formati di date e importi con `Intl`.
- **Backend**: Node 22, Fastify, tRPC (tipi condivisi end-to-end), WebSocket
  per il tempo reale, Zod.
- **Database**: PostgreSQL con Drizzle ORM e migrazioni versionate.
- **Code e cache**: Redis con BullMQ.
- **File**: MinIO, compatibile S3, sostituibile con S3 o R2. Le immagini
  (avatar, copertine, ricevute) sono elaborate con `sharp`: varianti WebP e
  AVIF, miniature e placeholder sfocato (blurhash).
- **Email**: Nodemailer con SMTP configurato dalle variabili d'ambiente;
  modelli con React Email, in italiano e in inglese. Gli invii passano da una
  coda con nuovi tentativi in caso di errore.
- **Autenticazione**: Better Auth (email e password con verifica, magic link,
  passkey, OAuth Google facoltativo; plugin admin per ruoli e sospensioni);
  sessioni in cookie httpOnly.
- **Importi** in **centesimi interi** (`bigint`) con codice valuta ISO; mai
  numeri a virgola mobile.

### Modello dati (essenziale)

```
User (locale, defaultCurrency, avatar, avatarEmoji, role, paypalMe, openrouterKey cifrata)
 ─┬─< TripMember >── Trip (currency, coverImage, coverColor, emoji)
  │                    │
  │                    ├──< Day ──< Activity ──< ActivityAlternative
  │                    │         └── stay → Booking
  │                    ├──< Place (coordinate, orari, verifiedAt, sources[])
  │                    ├──< Booking (volo/alloggio/noleggio, codice, allegati)
  │                    ├──< BudgetItem (booked|pending|estimate, included)
  │                    ├──< Expense (emoji, category) ──< ExpensePayer, ExpenseShare, ExpenseItem
  │                    │        └── Receipt (file, ocr_json, status, confidence)
  │                    ├──< Settlement (from, to, amount, currency, method: manual|paypal, status: pending|confirmed|disputed)
  │                    ├──< PackingItem (owner?, checked_by)
  │                    ├──< Invitation (email?, token, role, expiresAt, maxUses, status)
  │                    └──< AiJob (tipo, modello, token, costo, stato, keySource)
  ├──< PushSubscription
  └──< AuditLog
AppSetting (key, value cifrato se sensibile) · Category (emoji predefinita, nomi it/en)
TripMember può essere un segnaposto (userId nullo) collegato all'account in seguito
```

## 4. Docker

- `docker-compose.yml` con i servizi `caddy`, `api`, `worker`, `postgres`,
  `redis`, `minio`. Il frontend è compilato dentro l'immagine `caddy` oppure
  servito da `api`.
- Dockerfile multi-stage (build con pnpm, runtime `node:22-alpine` non root);
  immagini pubblicate su GHCR da GitHub Actions (amd64 e arm64, così gira anche
  su Raspberry Pi o NAS).
- `.env.example` contiene solo l'essenziale. Il resto si configura dal
  pannello super admin:

  ```
  DOMAIN
  ACME_EMAIL
  APP_URL
  DATABASE_URL
  REDIS_URL
  S3_*
  AUTH_SECRET
  ENCRYPTION_KEY
  VAPID_PUBLIC_KEY
  VAPID_PRIVATE_KEY
  SUPERADMIN_EMAIL
  APP_NAME=TripShare

  SMTP_HOST
  SMTP_PORT
  SMTP_SECURE
  SMTP_USER
  SMTP_PASSWORD
  SMTP_FROM            # facoltativo

  OPENROUTER_API_KEY
  ```

  `SMTP_HOST` è obbligatoria. `SMTP_USER` e `SMTP_PASSWORD` servono solo se il
  server richiede l'autenticazione. `SMTP_FROM` è facoltativa: se manca, il
  mittente è `"TripShare" <SMTP_USER>` quando `SMTP_USER` è un indirizzo email,
  altrimenti `"TripShare" <noreply@DOMAIN>`. All'avvio `api` verifica la
  connessione e scrive nel log l'eventuale errore. `OPENROUTER_API_KEY` è
  facoltativa: serve solo come valore iniziale e si può cambiare dal
  pannello.

- Volumi persistenti per `postgres`, `minio` e `caddy`. Healthcheck su ogni
  servizio. Migrazioni eseguite all'avvio di `api`.
- Backup: servizio facoltativo che esegue `pg_dump` e copia i dati di MinIO
  ogni giorno.
- `docker-compose.dev.yml` con hot reload e Mailpit per le email di test.
- **Installazione su VPS**:
  1. Si punta il record DNS al server.
  2. Si copia `.env.example` in `.env`.
  3. Si esegue `docker compose up -d`.

  Caddy ottiene e rinnova il certificato Let's Encrypt. Al primo accesso,
  l'utente `SUPERADMIN_EMAIL` riceve il link per impostare la password.
  Script `deploy.sh` per gli aggiornamenti: pull delle immagini, migrazioni,
  riavvio senza downtime. Firewall consigliato: aperte solo le porte 80 e 443.

## 5. Design e UX

- **Grafica moderna basata su shadcn/ui**, personalizzata con un design system
  proprio:
  - token colore con tema chiaro e scuro;
  - font variabile moderno (es. Inter o Geist), cifre tabellari per gli
    importi;
  - angoli arrotondati, ombre morbide, superfici “glass” leggere sulle
    copertine.
- **Foto di copertina del viaggio**:
  - si carica dal telefono, con ritaglio;
  - si sceglie da **Unsplash** cercando la destinazione (se il super admin ha
    inserito la chiave);
  - oppure si usa un gradiente generato.

  La copertina appare grande nella scheda del viaggio, con titolo ed emoji
  sovrapposti. Dalla copertina si ricava il **colore d'accento** del viaggio
  (colore dominante), usato per pulsanti e grafici.

- **Elenco viaggi** come card con copertina, date, avatar dei membri impilati
  e il tuo saldo (“ricevi 42 €” / “devi 18 €”).
- **Emoji ovunque in modo coerente**: categorie e spese nell'elenco (emoji in
  un cerchio colorato), viaggi, avatar alternativo alla foto.
- **Avatar** dei membri accanto a ogni spesa e saldo: foto o emoji; se manca,
  le iniziali su un colore generato dal nome.
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

| Fase                                                    | Contenuto                                                                                                                                                                                                                                                                                      | Risultato                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **0. Fondamenta** (1,5 settimane)                       | monorepo, Docker Compose con Caddy e HTTPS su VPS, database con migrazioni, design system con shadcn/ui, i18n italiano e inglese, CI, shell PWA installabile                                                                                                                                   | `docker compose up` sul VPS funziona e la PWA è installabile                   |
| **1. Account e sito pubblico** (1,5 settimane)          | home pubblica, registrazione con verifica email, accesso, recupero password, profilo con foto o emoji, lingua e valuta predefinita, email transazionali, base del pannello admin (utenti, registrazioni, SMTP)                                                                                 | ci si registra dal sito e si gestisce il profilo                               |
| **2. Viaggi e spese, il cuore Splitwise** (2 settimane) | viaggi con copertina ed emoji, valuta del viaggio, inviti via email e link con registrazione, membri segnaposto, spese con emoji e tutti i metodi di divisione, multivaluta, saldi, semplificazione, rimborsi                                                                                  | uno Splitwise di viaggio utilizzabile con il gruppo                            |
| **3. Pianificazione** (2 settimane)                     | giorni, timeline, attività, alternative, luoghi, mappa, prenotazioni, budget con stime, lista bagagli, meteo                                                                                                                                                                                   | la Scozia ricostruita a mano dentro l'app                                      |
| **4. AI** (2 settimane)                                 | client OpenRouter, sezione OpenRouter del pannello admin (chiave, modalità centralizzata, per utente o mista, modelli, quote, consumi), coda AI, scontrini e screenshot verso spese e prenotazioni, generatore di viaggi, chat con azioni, verifica degli orari con fonti, controllo dei costi | “Fammi un viaggio in Scozia in 5 giorni in auto” produce un programma completo |
| **5. Tempo reale e offline** (1 settimana)              | WebSocket, coda di invio offline, Background Sync, Web Push, Share Target                                                                                                                                                                                                                      | uso in viaggio senza rete                                                      |
| **6. Rifinitura** (1 settimana)                         | esportazione PDF e ICS, link pubblico, statistiche, colori dinamici dalle copertine, animazioni, accessibilità, pannello admin completo (audit, sistema, backup), documentazione                                                                                                               | versione 1.0                                                                   |
| Dopo la 1.0                                             | importazione da Splitwise e CSV, tracciamento dei prezzi dei voli, app nativa con Capacitor                                                                                                                                                                                                    |                                                                                |

**MVP consigliato**: le fasi 0, 1 e 2 più la parte di scontrini della fase 4.
Con questo si può già usare l'app con il gruppo nel prossimo viaggio.

### Stato di avanzamento

**Fasi 0, 1 e 2 completate.** Cosa c'è:

- monorepo, CI su GitHub Actions, immagini Docker multi-architettura, Caddy con HTTPS,
  compose dedicato per Coolify;
- registrazione con verifica dell'email, accesso con password o magic link, recupero
  password, super admin creato al primo avvio;
- profilo con foto o emoji, colore, lingua, valuta predefinita, tema e PayPal.me;
- pannello admin: stato dei servizi, email di prova, registrazioni, OpenRouter (chiave
  cifrata, modalità, modelli, quote), utenti, registro delle azioni;
- viaggi con foto di copertina (o sfumatura), emoji, date e valuta;
- membri con ruoli, persone senza account (segnaposto) che si collegano all'account
  accettando l'invito; inviti via link condivisibile o email, anche in modalità
  "solo su invito";
- spese con emoji e categoria, divisione in parti uguali, quote, percentuali o importi
  esatti, in qualsiasi valuta con il tasso BCE del giorno (modificabile);
- saldi esatti al centesimo, trasferimenti minimi, rimborsi registrati o pagati con
  link PayPal.me precompilato;
- formato standard del viaggio (sezione 2.3).

Scelte diverse dal piano iniziale:

- **Worker nella stessa immagine dell'API.** Il worker è `apps/api/src/worker.ts`, avviato
  dallo stesso image con un comando diverso: un solo build, codice delle email condiviso.
- **Archivio file su disco invece di MinIO.** Foto profilo e copertine sono salvate in un
  volume Docker (`uploads`), già convertite in WebP. Si passerà a uno storage S3 solo se
  servirà (es. più istanze dell'API).
- **Passkey rimandate.** In Better Auth sono un pacchetto separato; si aggiungono insieme
  alla gestione dei dispositivi.

## 9. Decisioni ancora aperte

Nessuna decisione blocca l'avvio. Il dominio si inserisce in `DOMAIN` al
momento del deploy.
