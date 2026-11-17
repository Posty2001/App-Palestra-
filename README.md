# APP PALESTRA

PWA mobile-first (iPhone) per coach e atleti: inviti personali, schede versionate e assegnabili, sedute registrate anche offline, progressi, check fisico con foto private, feedback del coach.

Specifica di riferimento: [`docs/LEGGIMI_PER_CLAUDE.md`](docs/LEGGIMI_PER_CLAUDE.md) · Esito delle prove: [`docs/ESITO_PROVE.md`](docs/ESITO_PROVE.md) · Restyling 2.0: [`docs/RESTYLING_2.0.md`](docs/RESTYLING_2.0.md) · Screenshot: [`docs/screenshots/`](docs/screenshots/)

## Architettura

| Parte | Tecnologia | Note |
|---|---|---|
| `shared/` | TypeScript strict + zod | Modello scheda, parsing notazioni (top set/back-off, `10-6`, `10/6`, `2’-3’`), diff versioni, calcoli progressi. Usato da server e client. |
| `server/` | Node 22, Fastify 5, PostgreSQL 14+ (`pg`), sharp, pdf.js | API REST `/api`, autorizzazione lato server su ogni richiesta, archivio foto privato. |
| `web/` | React 18, Vite 7, vite-plugin-pwa (Workbox), IndexedDB (`idb`) | Seduta local-first con coda di sincronizzazione idempotente. |

In produzione un solo processo serve API e PWA dalla stessa origine (cookie `SameSite`, nessun CORS).

### Scelte chiave
- **Autenticazione reale**: password scrypt (N=2¹⁵), sessioni opache (solo hash SHA-256 nel DB) in cookie `HttpOnly`/`Secure`/`SameSite=Lax`; header anti-CSRF obbligatorio sulle scritture; rate limit su login/inviti/recupero; nessuna enumerazione delle email.
- **Inviti**: token monouso (hash nel DB, 7 giorni), nel *fragment* dell'URL (`/invito#…`) per non finire nei log. Stati gestiti: non valido, scaduto, già usato, annullato. L'atleta crea l'account o collega un account esistente.
- **Recupero accesso**: email (SMTP opzionale) oppure link monouso da 1 ora generato dal coach; il reset disconnette tutti i dispositivi.
- **Isolamento dati**: ogni endpoint verifica proprietario o collegamento coach–atleta **attivo** al momento della richiesta; risorse altrui → 404 (non rivela l'esistenza).
- **Foto**: nessun URL pubblico. Unico accesso `GET /api/photos/:id` (proprietario, oppure coach collegato **e** condivisione attiva su quel check), `Cache-Control: private, no-store`. Ri-codifica JPEG con rimozione EXIF/GPS, verifica del formato reale, limite pixel. Eliminazioni (anche a cascata) accodate con trigger DB e ripulite dall'archivio.
- **Schede versionate**: ogni *Pubblica modifica* crea una versione immutabile con riepilogo per l'atleta; la seduta salva lo snapshot del giorno eseguito → storico e sedute in corso non cambiano. Bozze separate (*Salva bozza*). Assegnare = copia indipendente.
- **Offline**: stato della seduta e operazione in coda scritti in **un'unica transazione IndexedDB** prima di aggiornare la UI; sincronizzazione ordinata con id generati dal client e `PUT` idempotenti (`ON CONFLICT`) → nessun duplicato dopo riconnessione o doppio tocco. Timer di recupero basato sull'ora reale.

## Avvio in locale

Prerequisiti: Node ≥ 22.12, PostgreSQL ≥ 14.

```bash
npm install
cp .env.example .env              # compila DATABASE_URL, TEST_DATABASE_URL, DEMO_PASSWORD
createdb palestra && createdb palestra_test   # con un ruolo dedicato
npm run migrate
npm run seed:demo                 # SOLO ambiente di prova: 3 utenti sintetici [DEMO]
npm run dev                       # API :3000 + PWA :5173 (proxy /api)
```

Apri http://localhost:5173. Utenti di prova (password = `DEMO_PASSWORD`):
`coach@demo.app-palestra.test`, `atleta.a@demo.app-palestra.test`, `atleta.b@demo.app-palestra.test`.
Rimozione completa dei dati di prova: `npm run purge-demo -w server`.

### Coach reale
```bash
COACH_PASSWORD='…' npm run create-coach -- --email tu@dominio.it --name "Nome Cognome"
```
Crea l'account coach e precarica nel suo profilo personale la **Scheda 5 giorni** importata da `server/assets/scheda_allenamento_5_giorni.pdf`, con **Pendulum Squat** come 3° esercizio del Giorno 3 al posto di RDL manubri (2 serie, 7/5, 4’-5’). Gli atleti entrano solo tramite invito.

### Produzione
```bash
npm run build
NODE_ENV=production COOKIE_SECURE=true WEB_DIST=../web/dist APP_URL=https://tuo-dominio npm start
```
Requisiti: HTTPS (reverse proxy con `TRUST_PROXY=true`), Postgres gestito con backup, `STORAGE_DIR` su volume persistente e cifrato (oppure sostituire `FsStorage` con un bucket S3 privato implementando `PrivateStorage`), `SMTP_URL` per le email di recupero. Le migrazioni si applicano all'avvio con lock advisory.

## Controlli

```bash
npm run typecheck      # shared + server + web, strict
npm test               # unit (shared) + integrazione API su Postgres reale (TEST_DATABASE_URL, viene azzerato)
npm run test:e2e       # Playwright, viewport iPhone 13 (locale it-IT), server e DB di test dedicati: 10 flussi
# screenshot reali: E2E_SHOTS_DIR=/percorso npm run test:e2e
```
