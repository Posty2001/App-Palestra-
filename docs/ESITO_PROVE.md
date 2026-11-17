# Esito delle prove — 17/11/2026

Ambiente: Linux, Node 22.23, PostgreSQL 16.15, Chromium (Playwright 1.63) con emulazione iPhone 13. Database e archivio foto di test dedicati, utenti sintetici `[DEMO]` su dominio `.test`.

## Verifiche automatiche

| Suite | Esito |
|---|---|
| Typecheck strict (shared, server, web) | ✅ nessun errore |
| Unit `shared` (notazioni, top set/back-off, record, linee a parità di ripetizioni, media settimanale) | ✅ 9/9 |
| Integrazione API `server` su Postgres reale | ✅ 36/36 |
| End-to-end iPhone (`web/e2e/flows.spec.ts`) | ✅ 6/6, ripetuto 5 volte consecutive senza errori |

### Priorità 1 — accessi e isolamento (`server/test/security.test.ts`)
- Senza sessione → 401; scritture senza header anti-CSRF → 403; login errato con messaggio identico per email esistente/inesistente.
- **Atleta B non ottiene sessioni, check, foto, schede, pesi, progressi, domande di A** (11 endpoint → 404) e non può modificarli/cancellarli né avviare sedute sulle sue schede.
- **Il coach vede solo gli atleti collegati**; un secondo coach non vede nulla; foto visibili al coach solo se condivise; **revoca immediata** anche su URL già noto; scollegamento → accesso negato subito.
- Inviti non validi / usati / annullati / scaduti; collegamento di account esistente; email duplicata; token salvati solo come hash.
- Recupero: nessuna enumerazione; il reset invalida le altre sessioni; link monouso; il coach non genera link per atleti non suoi. Logout invalida la sessione lato server.

### Priorità 2 — schede (`programs.test.ts`, e2e 1 e 6)
- Scheda personale del coach precaricata: 5 giorni, ordine e notazioni originali, **Pendulum Squat 3° al Giorno 3** (2 serie, 7/5, 4’-5’), nessun RDL.
- Import del PDF incluso: 5 giorni, 7/8/6/8/5 esercizi, righe su più linee ricomposte, 2 elementi dubbi segnalati (recupero "—" in Pulley stretto; percentuale back-off assente in Shoulder Press prona) con conferma obbligatoria prima del salvataggio. File non PDF o senza testo → messaggio e rimando all'inserimento manuale.
- Da interfaccia: sostituzione RDL → Pendulum, rimozione e aggiunta giorni, validazioni; creazione manuale; **due programmi selezionabili in Oggi con rotazioni indipendenti**.
- Duplica/assegna senza toccare l'originale né le copie di altri atleti; bozza vs Pubblica modifica con riepilogo all'atleta; scheda in scadenza nella coda coach.

### Priorità 3 — seduta (`workouts.test.ts`, e2e 2-4)
- Flusso **Oggi → Pendulum → Completa serie → Recupero → Lascia in sospeso → Riprendi → Termina → Salva** su iPhone: doppio tocco = una sola serie; barra di recupero visibile durante lo scroll, durata modificabile, corretta dopo ricarica; riscaldamento nello storico ma fuori dal conteggio; riepilogo con serie mancanti; rotazione → Giorno 4.
- **Offline**: serie registrate senza rete, app ricaricata offline (shell da service worker, seduta da IndexedDB), riconnessione → sincronizzato; **nuovo accesso con la stessa utenza** da un secondo dispositivo riprende la seduta; nel DB 2 sedute / 5 serie, nessun duplicato.
- **Pubblicare una modifica durante una seduta non la altera** (resta v1); la nuova versione vale dalla seduta successiva; precompilazione dalla serie corrispondente dell'ultima seduta; Scarta seduta → serie eliminate, rotazione invariata.

### Priorità 4 — check e feedback (`checks-feedback.test.ts`, e2e 5)
- Giorno del check fissato dal coach → "Fai il check" in Oggi.
- Check retrodatato e check con 3 foto private; anteprima di cosa viene condiviso; confronto primo/ultimo con foto affiancate e differenze (−2,2 kg, −3 cm).
- Chiedi al coach → Da rivedere (atleta, esercizio, ultima prestazione) → risposta visibile nell'esercizio; feedback sul check visibile dentro il check; indicazione su esercizio sotto "Ultima volta".
- Foto: EXIF/GPS rimossi; condivisione → coach vede; **revoca → 404 immediato**; atleta B → 404; secondo dispositivo vede tutto; eliminazione foto e check rimuove anche i file.
- Dati di esempio riconoscibili (`[DEMO]`, `.test`, `is_demo`) ed eliminabili in blocco; gli atleti invitati da un coach demo ereditano il flag.

## Difetti trovati e corretti durante le prove
1. Atleti invitati da un coach di prova non marcati come dati demo → ora ereditano `is_demo`.
2. Controlli in fondo pagina coperti dalla tab bar → `scroll-padding-bottom`.
3. Toggle condivisione foto lento a reagire → aggiornamento ottimistico con ripristino su errore.
4. Possibile perdita di una serie chiudendo l'app subito dopo il tocco → stato + coda scritti in un'unica transazione IndexedDB prima di confermare in UI.
5. Scheda assegnata non visibile subito nel profilo atleta; peso nella coda formattato "75.20" → corretti.

## Prove manuali svolte
- Revisione visiva degli screenshot iPhone (Atleti, profilo atleta, Oggi, seduta con recupero, Termina, offline, Pubblica modifica, confronto check, Da rivedere, feedback nell'esercizio, revisione import).

## Controlli ancora da svolgere prima del rilascio con atleti reali
- **Safari iOS reale** (le prove usano Chromium con emulazione iPhone): installazione su Home, persistenza IndexedDB/service worker in standalone, upload foto HEIC dalla fotocamera (sharp le decodifica solo se compilato con libheif; altrimenti l'app chiede JPEG — verificare "Formato più compatibile" in iOS), vibrazione a fine recupero (non supportata da Safari).
- Deploy su ambiente di prova con HTTPS, Postgres gestito, backup, volume foto persistente/cifrato e SMTP reale; test di carico non eseguiti.
- Conflitto raro: seduta avviata **offline** su due dispositivi diversi contemporaneamente → il server accetta la prima, la seconda viene scartata con avviso (comportamento documentato, non coperto da e2e).
- Suggerimenti automatici di progressione: facoltativi da specifica, non implementati.
- Revisione legale/privacy (GDPR: informativa, base giuridica per foto corporee, conservazione e cancellazione account).
