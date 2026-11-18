# APP PALESTRA 3.0 — architettura local-first e piano di migrazione

Stato: **proposta da approvare. La conversione non è iniziata.**
Branch: `local-first-v3` (creato da APP PALESTRA 2.0, commit `7a85bb9`). La 2.0 con backend Fastify/PostgreSQL resta intatta nel branch `claude/peaceful-archimedes-lzmfeq`.
Budget: 0 €. Nessun account, server applicativo, database remoto o servizio cloud obbligatorio.

---

## 1. Sintesi delle decisioni

| Tema | Decisione proposta |
|---|---|
| Esecuzione | PWA statica, completamente offline dopo il primo caricamento (service worker). |
| Dati | IndexedDB, una sola origine, schema versionato, scritture in transazione, validazione zod all'ingresso, controllo d'integrità all'avvio e su richiesta. |
| Logica | I servizi del server 2.0 (versionamento schede, rotazione, sedute, check, progressi, feedback, coda «Da rivedere») vengono **portati nel browser** come livello di servizio locale con le stesse firme e gli stessi DTO di `@palestra/shared`. |
| Interfaccia | Pagine e componenti 2.0 riutilizzati. In una prima fase un adattatore sostituisce le chiamate HTTP con chiamate locali, così le pagine cambiano pochissimo. |
| Identità | Nessun account. Ogni installazione ha un **profilo locale** (ID casuale, nome, ruolo atleta o coach) e una **chiave di firma** generata sul dispositivo. |
| Coach | Atleti gestiti localmente. Lo scambio avviene solo tramite **file**: pacchetto coach → atleta (schede, feedback, risposte) e atleta → coach (dati scelti dall'atleta). |
| Pacchetti | Formato `.palestra` versionato, con ID univoco, manifest con SHA-256, validazione, anteprima prima dell'importazione e commit atomico. Protezione da duplicati e sovrascritture. |
| Cifratura | Obbligatoria per pacchetti con dati personali o foto: AES-256-GCM a blocchi, chiave derivata dalla password con PBKDF2-SHA256 (600.000 iterazioni). |
| Autenticità | **Separata dall'integrità**: firma ECDSA P-256 del mittente, chiave verificata all'abbinamento confrontando un'impronta. |
| Backup | Backup completo cifrato su file (Condividi → File / iCloud Drive / AirDrop), verificato prima del salvataggio, ripristino con anteprima e verifica, promemoria. |
| Distribuzione | Hosting statico gratuito: **Cloudflare Pages (Direct Upload)** con repository privato, oppure GitHub Pages pubblicando **solo la build** in un repository pubblico separato. |
| Rimossi | Autenticazione, sessioni, inviti via link, recupero password, Fastify, PostgreSQL, `sharp`, `nodemailer`, coda di sincronizzazione verso server. |

---

## 2. Cosa resta, cosa cambia, cosa sparisce

| Funzionalità 2.0 | 3.0 local-first |
|---|---|
| Schede: creazione manuale, editor, giorni, riordino, note, top set/back-off, notazioni originali | **Invariato** (logica locale). |
| Import PDF | **Invariato per l'utente**: parsing nel browser con pdf.js, caricato solo quando serve. |
| Versionamento, bozza, «Pubblica modifica», riepilogo all'atleta, «Modificato» | **Invariato** in locale. Le versioni pubblicate dal coach arrivano all'atleta tramite pacchetto. |
| Più schede, rotazione indipendente, scelta del giorno | **Invariato.** |
| Seduta, timer, serie, riscaldamento, extra, salta/sostituisci, assetto, passo ±, termina/scarta | **Invariato.** Il salvataggio diventa locale e immediato (niente coda verso server). |
| Storico, progressi, grafici, peso, misure | **Invariato.** |
| Check fisico, foto, confronto | **Invariato.** Foto elaborate sul telefono (ridimensionamento, rotazione, **rimozione EXIF/GPS** tramite ricodifica). |
| Foto «condivise col coach» con revoca immediata | **Cambia**: diventa «includi le foto nel prossimo invio», disattivato di default. **Un file già inviato non può essere ritirato**: lo diciamo esplicitamente. |
| Feedback, domande/risposte, indicazioni per esercizio, feedback sul check | **Invariato nella forma.** Viaggiano nei pacchetti, non in tempo reale. |
| Area coach: dashboard, atleti, ricerca/filtri, inattività, profilo atleta, assegna scheda, Da rivedere | **Invariato nella forma.** I dati provengono dai pacchetti importati. L'inattività diventa «ultimo dato ricevuto». |
| Modalità Coach / Il mio allenamento | **Invariato.** |
| Account, login, inviti, recupero password, sessioni, scollegamento | **Sostituiti** da profilo locale + abbinamento via file. «Scollega» = elimina i dati locali dell'atleta. |
| Sincronizzazione offline verso server | **Rimossa** (tutto è locale). Nessuna sincronizzazione automatica tra dispositivi. |

---

## 3. Riutilizzo e dipendenze attuali dal backend

**Riutilizzabile così com'è**
- `shared/` (543 righe): modello scheda e notazioni, diff delle versioni, calcoli dei progressi, DTO e schemi zod.
- `web/src/components/` e la grafica: design system, icone, Sheet, grafici, TabBar, TopBar (senza la parte account).
- `web/src/lib/rest.ts`, `prefs.ts`, `sound.ts`, `activity.ts`, `format.ts`.

**Da adattare (UI)**
- `web/src/pages/*` (≈ 3.000 righe con i componenti): sostituire circa 45 chiamate `get/post/put/patch/del` con il servizio locale.
- Togliere `Auth.tsx` e le parti account di `Account.tsx`.

**Da portare dal server nel browser (≈ 1.770 righe di servizi e route)**

| Server 2.0 | Destinazione 3.0 | Note |
|---|---|---|
| `services/programs.ts`, `routes/programs.ts` | `local/programs.ts` | normalizzazione, bozza, pubblicazione versione, duplicazione, archivio, «visto», rotazione |
| `services/pdfImport.ts` | `local/pdfImport.ts` (worker) | il parser (`parseProgramFromItems`) è già codice puro; cambia solo l'estrazione del testo |
| `routes/workouts.ts`, `services/workouts.ts` | `local/workouts.ts` | avvio con snapshot del giorno, serie, stati esercizio, termina con rotazione, scarta |
| `routes/checks.ts` | `local/checks.ts` + `local/images.ts` | `sharp` → `createImageBitmap` + canvas → JPEG |
| `routes/athlete.ts` | `local/today.ts`, `local/progress.ts` | bundle Oggi, contesti esercizio, domande, progressi |
| `routes/coach.ts` | `local/coach.ts` | elenco atleti, coda Da rivedere, feedback, risposte, impostazioni atleta |
| `routes/auth.ts`, inviti, sessioni, rate limit, CSRF, `mailer.ts`, `storage.ts`, `db.ts`, migrazioni SQL | **Non portati** | sostituiti da profilo locale, IndexedDB e pacchetti |

**Dipendenze dal backend (endpoint usati dalla 2.0, raggruppati)**
- Autenticazione e account: `/auth/*`, `/invites/*`, `/coach/invites*`, `/coach/athletes/:id/recovery-link` → **eliminati**.
- Schede: `/programs*`, `/program-versions/:id`, `/import/pdf` → servizio locale.
- Sedute: `/workouts*`, `/exercise-notes/:key`, `/bundle` → servizio locale (transazioni dirette, senza coda).
- Check: `/checks*`, `/photos/:id`, `/weights*` → servizio locale. Le foto sono servite come `blob:` URL creati al momento e revocati all'uscita.
- Progressi: `/progress/*`, `/exercises/:key/context` → servizio locale.
- Coach: `/coach/athletes*`, `/coach/review*`, `/questions/:id/answer`, `/checks/:id/feedback`, `/coach/athletes/:id/exercise-feedback` → servizio locale. I contenuti arrivano dai pacchetti.

**Strategia di sostituzione a rischio minimo.**
- **Fase 1:** `api(method, path, body)` instrada verso un router locale che riproduce gli stessi percorsi e gli stessi DTO, appoggiandosi ai servizi locali tipizzati. Le pagine restano quasi identiche e i 10 test end-to-end della 2.0 si possono riusare.
- **Fase 2 (facoltativa):** chiamate dirette ai servizi tipizzati, eliminando l'adattatore.

---

## 4. Architettura target

```
┌──────────────────────── PWA (statica, offline) ────────────────────────┐
│ UI React 2.0 (pagine, componenti, design system)                       │
│        │ hook (useAsync, useBundle locale)                             │
│ Adattatore api() ──▶ Router locale (stessi percorsi/DTO, fase 1)       │
│        │                                                               │
│ Servizi locali: programs · workouts · checks · progress · coach ·      │
│                 exchange (pacchetti) · backup · integrity              │
│        │ zod (validazione in ingresso)                                 │
│ Repository (idb): transazioni, indici, migrazioni di schema            │
│        │                                                               │
│ IndexedDB (origine unica)        Web Worker: pdf.js · immagini · cifratura │
│ Service worker: cache della shell e di pdf.js (offline completo)       │
└────────────────────────────────────────────────────────────────────────┘
          ▲ file .palestra (Condividi / File / AirDrop / email: a scelta dell'utente)
          ▼
   altra installazione (coach ↔ atleta) · backup sul tuo spazio (iCloud Drive / computer)
```

Nessuna chiamata di rete per i dati. L'app non contatta alcun server oltre al caricamento iniziale e agli aggiornamenti dei file statici.

---

## 5. Modello dati IndexedDB

Database `app-palestra`, schema versionato (`version` di IndexedDB) e migrazioni scritte una per versione.
**Prima di ogni migrazione:** controllo d'integrità e invito a fare un backup se l'ultimo ha più di 7 giorni.

| Store | Chiave | Indici | Contenuto |
|---|---|---|---|
| `meta` | `key` | — | versione schema, profilo locale, chiavi, data ultimo backup, registro pacchetti |
| `people` | `id` | `role` | profilo proprio + atleti (lato coach) e coach (lato atleta) |
| `programs` | `id` | `ownerId`, `authorId` | metadati, bozza, rotazione, `ownerSeenVersionNo` |
| `programVersions` | `id` | `[programId+versionNo]` (unico), `programId` | contenuto immutabile + `contentHash` |
| `workouts` | `id` | `[personId+startedAt]`, `status` | snapshot del giorno, stati esercizio, nota |
| `sets` | `id` | `workoutId`, `[personId+exerciseKey+completedAt]` | serie |
| `checks` | `id` | `[personId+checkDate]` | misure, nota, `includePhotosInExport` (default `false`) |
| `photos` | `id` | `checkId` (+ posa, unico) | metadati + `sha256` + `Blob` JPEG |
| `weights` | `id` | `[personId+measuredOn]` | peso |
| `exerciseNotes` | `[personId+exerciseKey]` | — | assetto macchina |
| `feedback` | `id` | `[personId+exerciseKey]`, `checkId` | indicazioni ed eventuali commenti ai check |
| `questions` | `id` | `[personId+exerciseKey]`, `status` | domanda, risposta, revisione |
| `reviewState` | `[type+id]` | — | «visto» del coach |
| `packages` | `packId` | `importedAt` | registro dei pacchetti importati/esportati (hash, tipo, esito) |

**Transazioni.** Ogni operazione che tocca più store usa una sola transazione `readwrite`: termina seduta (workout + rotazione), elimina check (check + foto + feedback), importa pacchetto (tutto o niente).

**Integrità.**
1. Validazione zod di ogni record prima della scrittura.
2. Verifica rapida all'avvio: versione schema, conteggi, presenza del profilo.
3. Verifica completa (su richiesta, prima di backup e migrazioni):
   - riferimenti (serie → seduta, foto → check, versione → scheda);
   - foto presenti con `sha256` corretto;
   - indici unici rispettati.
4. Le anomalie vengono mostrate e mai corrette in silenzio; si propone il ripristino da backup.

---

## 6. Identità locale, ruoli e abbinamento

**Primo avvio.** Il profilo locale contiene:
- `installId` (UUID) e nome;
- ruolo «Mi alleno» oppure «Sono un coach (e mi alleno)»;
- una coppia di chiavi **ECDSA P-256** generata con WebCrypto: la privata **non estraibile** e salvata in IndexedDB come `CryptoKey`, la pubblica esportabile.

**Abbinamento coach ↔ atleta (una volta).**
1. Il coach crea l'atleta: viene generato un `athleteId` locale.
2. Il coach esporta il **pacchetto di abbinamento**, che contiene `coachId`, nome del coach, chiave pubblica del coach e `athleteId` assegnato.
3. L'atleta lo importa e vede l'**impronta** della chiave del coach (es. 6 parole o 12 caratteri). La confronta con quella che il coach legge sul proprio telefono, a voce o di persona. Se coincidono, la conferma.
4. Il primo pacchetto atleta → coach include la chiave pubblica dell'atleta: il coach ne confronta l'impronta allo stesso modo e la conferma.

Da quel momento ogni pacchetto firmato da una chiave diversa da quella confermata viene **bloccato** (con spiegazione).

**Limite dichiarato:** un profilo vive su un solo dispositivo. Il passaggio a un nuovo iPhone avviene con il backup completo, che include la chiave di firma in forma cifrata. Non è prevista la gestione dello stesso profilo su più dispositivi in parallelo.

---

## 7. Formato dei pacchetti `.palestra`

### 7.1 Tipi
| Tipo | Mittente → destinatario | Contenuto | Cifratura |
|---|---|---|---|
| `pairing` | coach → atleta | identità e chiave pubblica del coach, `athleteId` | facoltativa (nessun dato personale oltre al nome) |
| `coach-update` | coach → atleta | schede assegnate (tutte le versioni non ancora inviate), feedback, risposte, impostazioni (giorno del check) | **obbligatoria** |
| `athlete-report` | atleta → coach | elementi scelti dall'atleta (§9): sedute, check e misure, peso, note, domande, assetti; foto solo se incluse esplicitamente | **obbligatoria** |
| `program-template` | chiunque | una scheda senza dati personali | facoltativa |
| `full-backup` | dispositivo → sé stesso | tutto il database, foto e chiave di firma | **obbligatoria** |

### 7.2 Struttura del file
```
"PALESTRA\x00" (8 byte magic) · u16 versione formato (=1)
u32 lunghezza + intestazione JSON in chiaro (minima, senza dati personali):
  { format:"app-palestra-pack", formatVersion:1, packId:UUIDv4, type, createdAt,
    appVersion, schemaVersion, encrypted:true,
    kdf:{ alg:"PBKDF2-SHA256", iterations:600000, salt:base64(16B) },
    cipher:{ alg:"AES-256-GCM", chunkSize:1048576, noncePrefix:base64(7B) },
    signature:{ alg:"ECDSA-P256-SHA256", keyId:"<sha256 della chiave pubblica>" } }
corpo = sequenza di blocchi cifrati (STREAM): ogni blocco = AES-GCM(chunk),
  nonce = noncePrefix ‖ contatore u32 ‖ flag "ultimo blocco"
  AAD = hash dell'intestazione → intestazione e ordine dei blocchi non manipolabili, troncamento rilevato
contenuto in chiaro (dopo decifratura) = sezioni:
  manifest.json { packId, type, from:{installId,name}, to:{personId}, entities:{store:[{id, sha256}]},
                  blobs:[{id, sha256, bytes, mime}], counts, totalSha256 }
  data.json     record per store (validati da zod in importazione)
  blob…         foto in binario, in sezioni con lunghezza dichiarata
firma (se presente) = ECDSA(sha256(intestazione ‖ manifest)) del mittente
```
Pacchetti non cifrati (solo `pairing` e `program-template`): stessa struttura senza cifratura. L'integrità resta garantita dal manifest con SHA-256.

### 7.3 Integrità ≠ autenticità (cosa garantisce cosa)
| Meccanismo | Protegge da | Non protegge da |
|---|---|---|
| SHA-256 nel manifest | file corrotti o troncati, errori di trasferimento | qualcuno che modifica il file e ricalcola gli hash |
| AES-GCM con password | lettura da parte di chi non conosce la password; qualsiasi modifica (decifratura fallisce) | chi **conosce la password**: potrebbe creare un pacchetto valido |
| Firma ECDSA con chiave confermata all'abbinamento | pacchetti creati o alterati da chiunque non possieda la chiave del mittente | furto del telefono sbloccato del mittente |

### 7.4 Password e chiavi
- Password scelta al momento dell'esportazione e mai salvata nell'app. Requisiti: almeno 12 caratteri, oppure la **passphrase di 5 parole** proposta dall'app (generata con `crypto.getRandomValues` da una lista di parole italiane inclusa).
- La password va comunicata **su un canale diverso** da quello del file: di persona, a voce o con un messaggio separato.
- Derivazione: PBKDF2-SHA256, 600.000 iterazioni, sale casuale per file (WebCrypto nativo, nessuna dipendenza).
- Per il **backup completo** si consiglia di salvare la password nel gestore di password (Portachiavi iCloud). Senza password il backup è **irrecuperabile**, e lo diciamo chiaramente.
- Chiave di firma: non estraibile nell'uso quotidiano. Viene esportata solo dentro il backup completo cifrato.

### 7.5 Validazione e limiti
- Formato, versione di formato e versione di schema controllati prima della decifratura. Versioni future: rifiuto con messaggio «aggiorna l'app»; versioni precedenti: migrazione in memoria.
- Schemi zod per ogni record, ID UUID, date, numeri nei limiti della 2.0, lunghezze dei testi, MIME delle foto (`image/jpeg`) e dimensione massima per foto e per pacchetto.
- Ogni foto viene ridecodificata prima di salvarla: niente file non immagine.

### 7.6 Duplicati e sovrascritture
- **Stesso `packId` già importato** → «Pacchetto già importato il …», nessuna modifica.
- **Mittente non abbinato o firma diversa** → bloccato.
- **Destinatario errato** (`to.personId` non corrisponde) → bloccato.
- **Anteprima obbligatoria** prima di confermare: nuovi, aggiornati, identici, in conflitto, ignorati per proprietà (§8).
- **Commit atomico** in una sola transazione: in caso di errore non cambia nulla.
- Nessun dato viene mai cancellato da un pacchetto. Le eliminazioni restano locali.

---

## 8. Conflitti e versioni delle schede

**Principio: un solo autore per ogni tipo di dato** (single-writer). Così i conflitti reali sono quasi impossibili.

| Dato | Autore (unico) | Regola d'importazione |
|---|---|---|
| Scheda assegnata dal coach, sue versioni, nome, periodo | coach | Versioni immutabili identificate da `(programId, versionNo, contentHash)`: si aggiungono le mancanti. Stesso numero di versione con hash diverso → **conflitto bloccante** (indica manomissione o un secondo dispositivo del coach). |
| Rotazione, «visto», stato di avanzamento | atleta | Mai sovrascritti dai pacchetti del coach. Dopo una nuova versione la rotazione viene riportata nei limiti (come nella 2.0). |
| Schede personali dell'atleta | atleta | Restano locali. Il coach le vede solo se l'atleta le include. |
| Sedute, serie, check, foto, peso, note, domande, assetti | atleta | Lato coach: inserimento se mancanti; identici → ignorati; diversi con lo stesso ID → aggiornamento solo se `updatedAt` è più recente, mostrato nell'anteprima. |
| Feedback, risposte, commenti ai check, giorno del check | coach | Lato atleta: inserimento se mancanti; risposta aggiunta alla domanda corrispondente. |
| «Visto» del coach, esercizi chiave | coach | Locali al coach, mai esportati. |

**Seduta in corso e nuova versione.** Come nella 2.0: la seduta usa lo snapshot del giorno salvato all'avvio. La nuova versione vale dalla seduta successiva e l'atleta vede il riepilogo delle modifiche.

**Il coach modifica la copia di un atleta.** Il coach pubblica la versione N+1 sul proprio dispositivo; al prossimo `coach-update` l'atleta la riceve. Se l'atleta non importa per un po', riceverà tutte le versioni mancanti in ordine.

**Orologi diversi tra dispositivi.** Le regole non dipendono dall'ora, salvo il confronto `updatedAt`, che riguarda solo modifiche dell'autore stesso.

---

## 9. Condivisione selettiva (atleta → coach)

Finestra «Invia al coach»:
- periodo (dall'ultimo invio, oppure date a scelta);
- caselle: Sedute e serie ✔ · Check e misure ✔ · Peso ✔ · Note e domande ✔ · Assetti ✖ · **Foto ✖** (attivabili per singolo check, con miniatura).
- Riepilogo prima dell'esportazione: «Il coach riceverà: 6 sedute, 2 check (senza foto), 3 domande».
- Avviso fisso: **«Una volta inviato, il file non può essere ritirato. Il coach potrà conservarlo.»**

La preferenza di default è sempre senza foto, e non si ricorda una scelta «con foto» tra un invio e l'altro.

---

## 10. Backup e ripristino su iPhone

**Esportazione.**
1. Verifica d'integrità completa.
2. Creazione del pacchetto `full-backup` cifrato in un worker.
3. **Verifica prima del salvataggio:** il file appena creato viene decifrato e validato in memoria, confrontando conteggi e hash con il database.
4. Condivisione con il foglio di iOS (`navigator.share({ files })`) verso **File / iCloud Drive**, AirDrop o un computer. Dove la condivisione non è disponibile, si scarica il file.

**Promemoria.**
- Banner persistente se l'ultimo backup ha più di 7 giorni o se dopo ci sono più di 5 sedute o un check con foto.
- Pagina «Dati e backup» con data dell'ultimo backup, spazio usato (`navigator.storage.estimate()`) e stato di persistenza (`persisted()`).

**Ripristino.**
1. Scelta del file, password, decifratura.
2. Verifica di formato, firma e hash.
3. Anteprima con conteggi.
4. Prima di sostituire, **proposta di esportare i dati attuali**.
5. Sostituzione completa in una transazione.
6. Verifica d'integrità finale e messaggio con l'esito.

È disponibile anche la **verifica di un file di backup** senza ripristinarlo (dry-run), consigliata una volta al mese.

**Avvisi sul rischio di perdita (testi nell'app).**
- I dati sono salvati **solo su questo iPhone**. Nessuna copia automatica nel cloud.
- Si perdono se rimuovi l'app dalla schermata Home, se cancelli i dati di Safari/siti web o, in rari casi, se iOS libera spazio.
- Usa l'app **dall'icona sulla schermata Home** e fai backup regolari.

---

## 11. Limiti di IndexedDB, iOS e fotografie (verificati)

**Quota (WebKit, Safari 17+).**
- Per origine, fino al 60% del disco nei browser e fino al 15% per le altre app.
- Complessiva fino all'80%.
- Oltre la quota dell'origine la scrittura fallisce con `QuotaExceededError` (da gestire con un messaggio chiaro).
- La quota restituita da `estimate()` è un massimo teorico, non una garanzia.

**Eviction.**
- In modalità «best-effort» (predefinita) iOS può eliminare i dati delle origini usate meno di recente quando lo spazio è poco o dopo inattività.
- `navigator.storage.persist()` è supportato; WebKit lo concede in base a euristiche, ad esempio se il sito è aperto come **web app dalla schermata Home**.
- L'app chiederà la persistenza e mostrerà se è stata concessa.

**Limite dei 7 giorni (ITP).** Si applica ai siti in Safari. Le web app aggiunte alla schermata Home hanno un proprio contatore di giorni d'uso e, secondo WebKit, i loro dati di prima parte non dovrebbero essere cancellati. Ne deriva l'istruzione: **installare e usare l'app dalla Home.**

**Origine stabile.** I dati sono legati al dominio. **Cambiare indirizzo di hosting equivale a ripartire da zero**: si passa con backup e ripristino. L'indirizzo si sceglie una volta sola.

**Foto e file grandi.**
- Ogni foto viene ridimensionata a 1600 px in JPEG 0,82: circa 250–400 KB. Un check con 3 foto pesa circa 1 MB.
- Un anno con check settimanale occupa circa 50 MB per persona; un coach con 10 atleti che inviano tutte le foto circa 0,5 GB l'anno. Nessun problema di quota.
- Il punto critico è la **memoria** quando si genera o si importa un pacchetto da centinaia di MB su iPhone. Soluzione:
  - cifratura e decifratura a blocchi da 1 MB in un worker;
  - foto lette e scritte come `Blob`;
  - backup oltre ~150 MB divisi in **volumi numerati**, con controllo che siano tutti presenti;
  - opzione «backup senza foto» rapida e frequente, più un «backup completo» periodico.
- Le foto si salvano come `Blob` (supportato da Safari moderno); va verificato sul dispositivo reale (checklist §13).

**PDF.**
- pdf.js nel browser (~1 MB, caricato solo all'importazione e messo in cache per l'uso offline).
- Limite del file: 12 MB e 20 pagine, come nella 2.0.

---

## 12. Distribuzione statica gratuita

| Opzione | Requisiti | Note |
|---|---|---|
| **Cloudflare Pages – Direct Upload** (consigliata) | Account Cloudflare gratuito; nessun collegamento Git necessario: si carica la cartella `web/dist` | Funziona con il repository **privato**. Limiti del piano Free: 500 build/mese, 20.000 file, 25 MiB per file. HTTPS su `*.pages.dev`. |
| GitHub Pages | Con GitHub Free il repository **deve essere pubblico** | Per non pubblicare il sorgente: un **repository pubblico separato con la sola build**. Limiti: sito ≤ 1 GB, 100 GB/mese (soglia indicativa). I termini escludono l'uso come hosting di un'attività commerciale online. |

**In entrambi i casi.**
- Il pacchetto pubblico **non contiene dati personali**: la scheda PDF e i file di prova restano fuori dalla build; la scheda personale si importa dall'app.
- Il service worker mette in cache tutta l'app, pdf.js compreso. Gli aggiornamenti arrivano in automatico e la nuova versione si attiva alla riapertura.
- Le intestazioni di sicurezza (CSP) vanno impostate dove la piattaforma lo consente (file `_headers` su Cloudflare Pages); su GitHub Pages ci si limita al meta tag CSP.

---

## 13. Roadmap tecnica, rischi e test

| Fase | Contenuto | Stima |
|---|---|---|
| 0 | Struttura: workspace `web` senza dipendenze dal server, store IndexedDB, repository, migrazioni di schema, profilo locale, primo avvio | 2 giorni |
| 1 | Porting dei servizi (schede e versioni, sedute, check, progressi, coach, Oggi) + router/adattatore `api()` + rimozione di login e account | 4 giorni |
| 2 | Import PDF nel worker, elaborazione foto sul dispositivo (rotazione, ridimensionamento, rimozione EXIF), `blob:` URL | 1,5 giorni |
| 3 | Atleti locali, coda Da rivedere dai dati importati, inattività basata sull'ultimo dato ricevuto | 1,5 giorni |
| 4 | Pacchetti: formato, cifratura a blocchi, firma e abbinamento con impronta, validazione, anteprima, commit atomico, registro anti-duplicati | 4 giorni |
| 5 | Backup/ripristino completo, verifica pre-salvataggio, volumi, promemoria, pagina «Dati e backup», persistenza | 2,5 giorni |
| 6 | Distribuzione statica (Cloudflare Pages o GitHub Pages), service worker offline completo, aggiornamenti | 0,5 giorni |
| 7 | Test automatici, prove su Safari iOS reale, documentazione | 3 giorni |
| | **Totale** | **circa 19 giorni di lavoro** (in più sessioni) |

**Rischi principali e mitigazioni**
| Rischio | Impatto | Mitigazione |
|---|---|---|
| Perdita dei dati locali (app rimossa, dati Safari cancellati, eviction) | Alto | Uso dalla Home, `persist()`, promemoria e verifica dei backup, avvisi chiari |
| Password del backup dimenticata | Alto, irreversibile | Passphrase generata, consiglio di usare il Portachiavi iCloud, avviso esplicito |
| Memoria insufficiente con backup grandi su iPhone | Medio | Blocchi da 1 MB in un worker, volumi, backup senza foto |
| Pacchetto contraffatto da chi conosce la password | Medio | Firma ECDSA con chiave confermata all'abbinamento |
| Cambio dell'indirizzo di hosting | Alto | Origine scelta una volta, migrazione con backup/ripristino |
| Bug di IndexedDB su Safari (Blob, transazioni lunghe) | Medio | Test su dispositivo reale, transazioni brevi, ripiego con `ArrayBuffer` |
| Profilo coach usato su due dispositivi | Medio | Non supportato: rilevato come conflitto di versione, documentato |
| Foto HEIC o formati non decodificabili fuori da Safari | Basso | Decodifica nativa di iOS, messaggio d'errore altrove |

**Test necessari**
- **Unitari (shared/local):** codec dei pacchetti, cifratura (vettori di prova, password errata, manomissione di un byte, troncamento, riordino dei blocchi), firma (chiave sconosciuta o diversa), validazione zod, regole di merge, registro anti-duplicati, migrazioni di schema, calcoli di progressi e versioni (già esistenti).
- **Integrazione nel browser (Playwright):**
  - tutte le operazioni dei servizi locali, con transazioni annullate in caso di errore;
  - controllo d'integrità con riferimenti rotti e foto alterate;
  - quota simulata (`QuotaExceededError`).
- **End-to-end (Playwright, viewport iPhone):**
  - i 10 flussi della 2.0 adattati (senza login);
  - **due contesti browser come due telefoni:** abbinamento con impronta, scheda → atleta, seduta, report con e senza foto → coach, feedback → atleta, nuova versione durante una seduta, reimportazione dello stesso file (nessun duplicato), file manomesso o firmato da altri (rifiutato);
  - backup → cancellazione completa dei dati → ripristino → dati e foto identici byte per byte;
  - app completamente offline (rete disattivata dal primo avvio dopo l'installazione).
- **Safari iOS reale (checklist):**
  - installazione dalla Home e stato `persisted()`;
  - export tramite foglio di condivisione verso File/iCloud/AirDrop e import da File;
  - backup con 200 foto (tempi e memoria);
  - foto HEIC dalla fotocamera;
  - riavvio dell'iPhone, aggiornamento dell'app, uso in modalità aereo;
  - spazio esaurito simulato.

**Criteri di accettazione**
- Nessuna richiesta di rete per i dati.
- Tutte le funzionalità della §2 presenti.
- Pacchetti con dati personali sempre cifrati e firmati.
- Ripristino verificato byte per byte.
- Nessuna promessa di sincronizzazione automatica, revoca remota o conservazione permanente nei testi dell'app.

---

## 14. Cosa l'app 3.0 NON promette (testi da usare nell'interfaccia)
- **Nessuna sincronizzazione automatica**: i dati si scambiano solo con file che scegli tu.
- **Nessuna revoca**: un file inviato non può essere ritirato o cancellato dal dispositivo di chi lo riceve.
- **Nessuna conservazione garantita**: i dati restano su questo dispositivo finché iOS e le tue azioni lo consentono. Il backup è responsabilità tua e l'app te lo ricorda.
- **Nessun recupero della password** dei file cifrati.

---

## 15. Decisioni richieste
1. Approvi l'architettura (servizi portati nel browser + adattatore `api()` in fase 1)?
2. **Autenticità:** confermi la firma ECDSA con abbinamento tramite impronta (consigliata), oppure ti basta la password, accettando che chi la conosce possa creare pacchetti validi?
3. **Hosting:** Cloudflare Pages (repository privato) oppure GitHub Pages con un repository pubblico separato contenente solo la build?
4. Posso pubblicare il branch `local-first-v3` (per ora contiene solo questo documento)?
5. Il branch locale `test-env` (piano Render + Neon, ora superato): lo archivio in un branch separato o lo elimino?
