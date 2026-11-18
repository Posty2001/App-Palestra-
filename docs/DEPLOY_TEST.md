# APP PALESTRA 2.0 — piano per l'ambiente TEST privato

Stato: **proposta da approvare.** Non è stato acquistato né creato alcun servizio. Nessun dato di atleti reali.
I prezzi sono stime basate su listini noti; vanno **riverificati sulle pagine ufficiali** prima dell'acquisto, perché cambiano spesso.

## 1. Analisi del repository (cosa serve per pubblicare)

| Componente | Requisito |
|---|---|
| App | Un solo processo Node 22: API Fastify + PWA compilata, stessa origine (nessun CORS). Migrazioni all'avvio. |
| Database | PostgreSQL ≥ 14 (estensione `citext`). Testato con PostgreSQL 16. |
| Foto | Cartella privata su **disco persistente** (`STORAGE_DIR`); mai servite staticamente. |
| HTTPS | Obbligatorio: cookie `Secure`, service worker della PWA, Safari iOS. |
| Email | Facoltativa: senza SMTP il recupero accesso si fa con il link generato dal coach. |
| Backup | Database **e** foto, insieme e coerenti. |

Conseguenza pratica: serve un hosting con container Docker, disco persistente e PostgreSQL gestito. Le piattaforme senza disco richiederebbero di riscrivere l'archivio foto per uno storage S3, cioè una modifica al codice che qui evitiamo.

## 2. Soluzione proposta

**Render (Francoforte, UE) per app e database + Cloudflare R2 per la copia off-site cifrata dei backup.**

| Servizio | Uso | Piano | Costo stimato / mese |
|---|---|---|---|
| Render Web Service | App Docker (API + PWA), HTTPS automatico su `*.onrender.com` | Starter (512 MB) | ~7 $ |
| Render Persistent Disk | Foto private + copie locali dei backup | 1 GB | ~0,25 $ |
| Render PostgreSQL | Database gestito, rete privata, backup della piattaforma | Basic 256 MB + 1 GB | ~6–7 $ |
| Cloudflare R2 | Copia off-site dei backup cifrati | Fascia gratuita (10 GB) | 0 € |
| Email | Nessuna in TEST (link di recupero del coach) | — | 0 € |
| Dominio (facoltativo) | es. `test.tuodominio.it` | — | ~10–15 €/anno |
| **Totale** | | | **~13–15 $/mese (~12–14 €)** + IVA, dominio escluso |

**Gratuiti:** HTTPS e certificati (Render), R2 entro 10 GB, email (non usata), monitoraggio di base e log di Render.
**A pagamento:** web service, disco e PostgreSQL di Render.
Le fasce gratuite di Render non vanno bene: il web service gratuito non supporta dischi e si spegne; il PostgreSQL gratuito scade.

**Vantaggi**
- Nessun server da amministrare (sistema operativo, patch, certificati).
- Deploy dal branch GitHub.
- PostgreSQL gestito, raggiungibile solo dalla rete privata.
- Snapshot del disco e backup del DB forniti dalla piattaforma, più il nostro backup cifrato indipendente.
- Dati in UE.

**Limiti**
- Con un disco collegato il servizio ha una sola istanza e pochi secondi di indisponibilità a ogni deploy (accettabile in TEST e per pochi atleti).
- Costo fisso anche quando l'app non è in uso.
- Il recupero del DB dalla piattaforma copre pochi giorni (durata da verificare per il piano scelto). Per questo c'è anche il backup giornaliero cifrato su R2, conservato 30 giorni.

**Crescita (più atleti)**
- Salire di piano (web service da 2 GB, DB più grande) e aumentare il disco con un click, senza migrazioni.
- Oltre qualche centinaio di GB di foto conviene spostarle su object storage: l'interfaccia `PrivateStorage` del server è già predisposta, ma servirebbe una piccola modifica al codice.

**Alternative valutate**

| Opzione | Costo stimato | Perché non è la prima scelta |
|---|---|---|
| Railway (Hobby) | ~5–10 $ | PostgreSQL in container, non gestito; backup a snapshot del volume. |
| VPS Hetzner + Docker Compose + Caddy | ~5–7 € | Il più economico e potente, ma aggiornamenti di sicurezza, firewall e monitoraggio sono a tuo carico. |
| Fly.io | da ~40 $ con Postgres gestito | Costoso con DB gestito; più complesso da configurare. |

## 3. Configurazione preparata (branch locale `test-env`, nessuna modifica all'app)

- `Dockerfile` — immagine unica per TEST e produzione:
  - build della PWA e del server;
  - avvio come utente non privilegiato (`node`, uid 1000) tramite `tini`;
  - include `pg_dump` 16, `age` e `rclone` per i backup.
- `deploy/entrypoint.sh` — prepara il disco (cartelle `700`), abbassa i privilegi, avvia i backup pianificati se abilitati.
- `deploy/backup.sh` · `deploy/backup-loop.sh` · `deploy/restore.sh` · `deploy/verify.sh` — vedi §7.
- `render.yaml` — Blueprint TEST: web service, disco da 1 GB su `/data`, PostgreSQL 16 senza accesso da Internet, deploy manuale.
- `deploy/env.test.example` — elenco delle variabili da inserire nel pannello. **Nessun segreto nel repository.**

**Separazione TEST / produzione**
- Servizi, database, dischi, chiavi di backup e bucket R2 (o prefissi) distinti, con un altro `APP_URL`.
- La produzione sarà un secondo Blueprint con nomi `-prod`, creato solo dopo il collaudo.
- Gli account dimostrativi non possono essere creati con `NODE_ENV=production`: serve un override esplicito e consapevole (vedi §4).

**Protezioni mantenute**
- Cookie `HttpOnly` + `Secure` + `SameSite=Lax`.
- HSTS e CSP.
- Rate limit sul login, che con `TRUST_PROXY=true` usa l'IP reale.
- Foto servite solo dopo il controllo dei permessi.
- Database raggiungibile solo dalla rete privata.
- Backup cifrati: la chiave privata **non** sta mai sul server.

## 4. Account dimostrativi (nessun dato reale)

Dopo il primo deploy, dalla **Shell** del servizio su Render (una sola volta):
```bash
cd /app/server && NODE_ENV=test DEMO_PASSWORD='<password lunga generata da te>' node dist/cli.js seed-demo
```
Crea 3 account riconoscibili: `[DEMO] Coach Prova`, `[DEMO] Atleta A` e `[DEMO] Atleta B`, sul dominio `@demo.app-palestra.test`. Il coach ha la «Scheda 5 giorni» precaricata.
La password non viene salvata da nessuna parte: conservala nel tuo gestore di password.
Pulizia completa: `NODE_ENV=test node dist/cli.js purge-demo`.

## 5. Passaggi per pubblicare (dopo la tua approvazione)

1. Crea un account **Render** (e collega GitHub con accesso al solo repository) e un account **Cloudflare**.
2. Su Cloudflare R2:
   - crea il bucket `app-palestra-backups`;
   - aggiungi una regola di ciclo di vita che elimina gli oggetti dopo 30 giorni;
   - crea un token *Object Read & Write* limitato a quel bucket.
3. Sul tuo computer: `age-keygen -o chiave-backup-test.txt`. Salva il file **offline** (gestore di password e una copia su chiavetta). La riga «Public key» va in `BACKUP_AGE_RECIPIENT`.
4. Render → New → **Blueprint** → seleziona il repository: crea servizio, disco e database. Inserisci le variabili `sync: false` (vedi `deploy/env.test.example`).
5. Primo deploy manuale, poi controlla che `https://<nome>.onrender.com/api/health` risponda `{"ok":true}`.
6. Crea gli account dimostrativi (§4).
7. Esegui subito un backup e una **prova di ripristino** (§7).
8. Installa la PWA sull'iPhone (§8) e segui la checklist (§9).

Tempo stimato: circa 1 ora. Da parte mia, dopo l'approvazione: unire il branch `test-env` (o spingerlo come branch separato) e guidarti passo passo. Non posso creare io gli account sui servizi a tuo nome.

## 6. Email (quando serviranno)

In TEST: nessuna. Il recupero accesso si fa con il link monouso generato dal coach.

Per gli atleti reali: un dominio proprio più un provider SMTP con fascia gratuita (es. Brevo o Resend, poche centinaia di email al giorno, da verificare). Bastano `SMTP_URL` e `MAIL_FROM`, senza modifiche al codice.

## 7. Backup e ripristino — configurazione e **prove eseguite**

**Come funziona.** Ogni giorno alle 02:00 UTC `backup.sh` produce un archivio **cifrato con age**, che contiene:
- `pg_dump` del database;
- tutte le foto;
- il conteggio delle righe di 14 tabelle;
- l'elenco delle foto;
- checksum SHA-256.

L'archivio resta sul disco (ultime 7 copie) e viene copiato su R2 (30 giorni). Senza la chiave privata è illeggibile, e ogni manomissione viene rilevata. In più ci sono il backup del database e lo snapshot giornaliero del disco offerti da Render.

**Ripristino.** Su un computer con la chiave privata, oppure dalla Shell del servizio, caricando la chiave solo temporaneamente:
```bash
AGE_IDENTITY=chiave-backup-test.txt TARGET_DATABASE_URL=<db> TARGET_STORAGE_DIR=<cartella foto> deploy/restore.sh palestra-test-<data>.tar.age
```
Lo script decifra, controlla i checksum, rifiuta le destinazioni non vuote (salvo `--force`), ripristina DB e foto e infine esegue `verify.sh`.

**Prove eseguite il 18/11/2026 in questo ambiente (non su Render)**

| Prova | Esito |
|---|---|
| Backup di un sistema con 3 utenti, scheda assegnata, seduta con 2 serie, check con 2 foto condivise | ✅ archivio di 72 KB, illeggibile senza chiave |
| Ripristino in un database vuoto separato + verifica (conteggi di 14 tabelle, foto ↔ file) | ✅ VERIFICA SUPERATA |
| App avviata sul DB ripristinato: login atleta e coach, sedute, check, **hash SHA-256 delle foto identici** all'originale, coach vede solo le foto condivise | ✅ identico |
| Archivio manomesso (1 byte) | ✅ rifiutato («failed to decrypt and authenticate») |
| Chiave sbagliata | ✅ rifiutato |
| Destinazione non vuota senza `--force` | ✅ rifiutato, destinazione intatta |
| Foto mancante dopo un ripristino | ✅ `verify.sh` segnala «MANCANTE» e fallisce |
| Immagine Docker in modalità produzione: utente non privilegiato, cookie `Secure`, HSTS/CSP, PWA servita, `seed-demo` bloccato in produzione | ✅ |
| Backup **pianificato** nel container (avviato da solo all'ora impostata) | ✅ |
| Copia off-site con `rclone` (destinazione locale simulata, nessun account esterno creato) | ✅ |
| **Esercitazione di disastro:** container, database e disco eliminati → nuovo container vuoto → ripristino dal solo file cifrato + chiave → app identica | ✅ |

**Da ripetere su Render dopo la pubblicazione:** upload reale su R2, un ripristino di prova su un database Render separato, poi un'esercitazione di ripristino al mese.

**Rischio noto:** se una foto viene eliminata proprio durante i secondi del backup, l'archivio può contenere la riga senza il file. Ce ne si accorge perché `verify.sh` lo segnala.

## 8. Installare la PWA su iPhone

1. Apri l'indirizzo HTTPS del TEST con **Safari** (non Chrome: su iOS solo Safari aggiunge web app alla Home con il pieno supporto).
2. Accedi con l'account dimostrativo.
3. Tocca **Condividi** (quadrato con freccia) → **Aggiungi alla schermata Home** → verifica che il nome sia «Palestra» → **Aggiungi**. Su iOS recenti, attiva «Apri come app web» se compare.
4. Apri l'app **dall'icona**: deve partire a schermo intero, senza barra di Safari.
5. Gli aggiornamenti si installano da soli alla riapertura successiva a un deploy. Se qualcosa sembra vecchio, chiudi l'app dal multitasking e riaprila.
6. Nota iOS: i dati salvati dall'app installata sono separati da quelli di Safari, quindi l'accesso va rifatto una volta dall'icona.

## 9. Checklist di collaudo su Safari iOS reale

Annota per ogni voce: ✅ / ❌ e modello di iPhone e versione di iOS.

**Installazione e aspetto**
- [ ] Icona e nome corretti sulla Home; apertura a schermo intero; barra di stato leggibile.
- [ ] Aree sicure: niente coperto da notch/Dynamic Island in alto né dalla barra home in basso (tab bar, «Completa serie», fogli).
- [ ] Nessuno scorrimento orizzontale; testi lunghi (nomi esercizi) a capo correttamente; rotazione bloccata in verticale.

**Accesso**
- [ ] Login, logout, nuovo login dall'icona; sessione mantenuta dopo aver chiuso l'app.
- [ ] Invito atleta aperto dal link (il link si apre in Safari: registrazione, poi accesso anche dall'icona).
- [ ] Link di recupero generato dal coach funzionante e monouso.

**Seduta (in palestra, anche con una mano)**
- [ ] La tastiera numerica mostra la **virgola** per i kg; i ± non sono coperti dalla tastiera; «Completa serie» resta raggiungibile.
- [ ] Doppio tocco veloce su «Completa serie» = una sola serie.
- [ ] Timer: blocca lo schermo per 1 minuto e riapri → tempo corretto; app in background 2 minuti → tempo corretto.
- [ ] Fine recupero con app aperta: segnale verde + suono. Ripetere con l'interruttore silenzioso attivo: niente suono ma segnale visivo. Vibrazione: non prevista su iOS.
- [ ] Pausa/ripresa, ±15 s, preset, «Salta».
- [ ] **Modalità aereo** a metà seduta: registra 3 serie, chiudi l'app, riaprila offline (deve aprirsi), disattiva la modalità aereo → «Sincronizzato», serie presenti una sola volta (verifica da un secondo dispositivo o dal coach).
- [ ] Lascia in sospeso → Riprendi; Termina → Salva; Scarta seduta.

**Check e foto**
- [ ] Scatto dalla fotocamera e scelta dalla libreria (HEIC): il caricamento riesce (Safari converte normalmente in JPEG; se fallisce, annotare iOS e impostazione «Formati» della fotocamera).
- [ ] Foto private di default; condividi → il coach le vede; revoca → il coach non le vede più (ricarica).
- [ ] Confronto foto, date (formato gg/mm/aaaa), misure con la virgola.

**Coach**
- [ ] Selettore Coach / Il mio allenamento, Dashboard, Atleti (ricerca, filtri, inattività), profilo atleta, assegna scheda, editor con «Modificato», pubblica modifica, risposta a domanda, revisione check.

**Prestazioni e rete**
- [ ] Prima apertura su 4G accettabile; navigazione fluida; nessun errore con rete instabile (indicatore di sincronizzazione coerente).

## 10. Decisioni richieste prima di procedere

1. Approvi **Render + Cloudflare R2** (~12–14 €/mese) o preferisci l'alternativa VPS (~5–7 €/mese, più manutenzione)?
2. Usare l'indirizzo gratuito `*.onrender.com` o un tuo dominio (`test.…`, ~10–15 €/anno)?
3. Dove pubblicare la configurazione: unirla al branch dell'app (sono solo file nuovi, l'app non cambia) oppure in un branch separato?
