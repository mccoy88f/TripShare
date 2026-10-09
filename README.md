# TripShare

App per **organizzare viaggi di gruppo e dividere le spese** in stile Splitwise. È una PWA
installabile, gira in Docker e usa l'AI di OpenRouter o Google Gemini. Interfaccia in italiano e
inglese.

- Piano completo: [`docs/PIANO.md`](docs/PIANO.md)
- Formato standard del viaggio (JSON per AI, import ed export): [`docs/TRIP_FORMAT.md`](docs/TRIP_FORMAT.md)

## Stato

| Fase                                                                                                    | Stato |
| ------------------------------------------------------------------------------------------------------- | ----- |
| 0. Fondamenta: monorepo, Docker con HTTPS, database, design system, i18n, CI, PWA                       | ✅    |
| 1. Account e sito pubblico: registrazione con verifica email, accesso, profilo con foto, pannello admin | ✅    |
| 2. Viaggi e spese: copertine, inviti, membri senza account, spese multivaluta, saldi, PayPal.me         | ✅    |
| 3. Pianificazione: programma, luoghi, prenotazioni, biglietti, budget, bagagli, note                    | ✅    |
| 4. AI con OpenRouter o Gemini: scontrini, prenotazioni, generatore, assistente, verifiche               | ✅    |
| 5. Tempo reale e offline                                                                                | ⏳    |
| 6. Rifinitura                                                                                           | ⏳    |

## Installazione su un VPS

Requisiti: Docker con il plugin Compose, un dominio che punta al server, porte 80 e 443 aperte.

```sh
git clone https://github.com/mccoy88f/TripShare.git && cd TripShare
cp .env.example .env
# Compila DOMAIN, AUTH_SECRET, ENCRYPTION_KEY, POSTGRES_PASSWORD, SUPERADMIN_EMAIL e SMTP_*.
docker compose up -d --build
```

Al primo avvio succede quanto segue:

- Caddy ottiene il certificato HTTPS da Let's Encrypt.
- L'API applica le migrazioni del database.
- L'indirizzo `SUPERADMIN_EMAIL` riceve un'email con il link per impostare la password.
  Dopo l'accesso, il pannello si trova in **Admin**.

Per aggiornare: `./deploy.sh`.

### Installazione con Coolify

Coolify ha già un proxy (Traefik) sulle porte 80 e 443 e gestisce lui HTTPS. Per questo c'è un compose dedicato, senza porte pubblicate, con Caddy in HTTP.

1. Crea una risorsa **Docker Compose** dal repository, branch `main`.
2. Imposta **Docker Compose Location** a `/docker-compose.coolify.yml`.
3. Nella scheda del servizio **caddy** imposta il dominio, es. `https://trip.example.com:80`.
4. Nelle variabili d'ambiente di Coolify inserisci le stesse variabili della tabella qui sotto; `DOMAIN` deve corrispondere al dominio del punto 3.

### Variabili d'ambiente

| Variabile                      | Obbligatoria | Note                                                                                                                   |
| ------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`                       | sì           | Dominio pubblico, es. `trip.example.com`                                                                               |
| `ACME_EMAIL`                   | no           | Email per Let's Encrypt. Predefinita: `admin@DOMAIN`                                                                   |
| `AUTH_SECRET`                  | sì           | `openssl rand -base64 48`                                                                                              |
| `ENCRYPTION_KEY`               | sì           | `openssl rand -base64 32`: cifra le chiavi API salvate nel database                                                    |
| `POSTGRES_PASSWORD`            | sì           | `openssl rand -hex 24`                                                                                                 |
| `SUPERADMIN_EMAIL`             | consigliata  | Account super admin creato al primo avvio                                                                              |
| `APP_NAME`                     | no           | Predefinito `TripShare`; si può cambiare anche dal pannello                                                            |
| `SMTP_HOST`                    | sì           | Server SMTP                                                                                                            |
| `SMTP_PORT`                    | no           | Predefinita `587`                                                                                                      |
| `SMTP_SECURE`                  | no           | `true` per TLS implicito. Se vuota, vale `true` solo con la porta 465                                                  |
| `SMTP_USER`, `SMTP_PASSWORD`   | no           | Solo se il server richiede l'autenticazione                                                                            |
| `SMTP_FROM`                    | no           | Se vuota: `"TripShare" <SMTP_USER>` quando `SMTP_USER` è un indirizzo email, altrimenti `"TripShare" <noreply@DOMAIN>` |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | no           | `false` solo per server SMTP con certificato self-signed                                                               |
| `OPENROUTER_API_KEY`           | no           | Valore iniziale; si gestisce dal pannello admin                                                                        |
| `GEMINI_API_KEY`               | no           | Chiave di Google AI Studio, valore iniziale; con la sola chiave Gemini diventa il provider centrale                    |

Le email passano da una coda (Redis + BullMQ) gestita dal servizio `worker`: se il server
SMTP non risponde, l'invio viene ritentato fino a 6 volte nel giro di circa 15 minuti. Anche i
lavori AI (scontrini, prenotazioni, generazione dei viaggi, assistente) girano nel `worker`, che
per questo monta lo stesso volume `uploads` dell'API.

**AI.** Dal pannello admin (scheda AI) si sceglie il provider della chiave centrale (OpenRouter o
Google Gemini), i modelli per ogni compito e i limiti mensili per utente. In modalità "per utente"
o "mista" ognuno può aggiungere nel profilo la propria chiave OpenRouter o Gemini.

**Unsplash.** Facoltativo: con la _Access Key_ di un'applicazione Unsplash
(unsplash.com/developers, non servono Secret Key né Application ID) nel pannello admin compare
"Cerca foto" per scegliere la copertina dei viaggi; l'autore della foto viene citato sulla
copertina come richiedono le regole di Unsplash.

## Sviluppo

```sh
pnpm install
pnpm dev:services            # PostgreSQL, Redis e Mailpit (http://localhost:8025)
cp .env.example .env         # usa i valori della sezione "Solo sviluppo locale"
                             # SMTP_HOST=localhost, SMTP_PORT=1025
pnpm db:migrate
pnpm dev                     # API :3000, worker, web :5173
```

| Comando                                      | Cosa fa                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm test`                                  | Test (con `TEST_DATABASE_URL` girano anche i test di integrazione su PostgreSQL) |
| `pnpm typecheck`, `pnpm lint`, `pnpm format` | Controlli                                                                        |
| `pnpm db:generate <nome>`                    | Crea una migrazione dallo schema Drizzle                                         |
| `pnpm schema:trip`                           | Rigenera il JSON Schema del formato viaggio                                      |

## Struttura

```text
apps/
  api/       Fastify + tRPC + Better Auth; src/worker.ts è il worker BullMQ (stessa immagine)
  web/       React + Vite + Tailwind + componenti stile shadcn/ui, PWA, i18n it/en
packages/
  shared/    valute, categorie con emoji, divisione spese, PayPal.me, formato viaggio (Zod)
  db/        schema Drizzle e migrazioni
docker/      Caddyfile
```
