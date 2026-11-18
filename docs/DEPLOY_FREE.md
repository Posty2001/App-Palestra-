# APP PALESTRA 2.0 — pubblicazione a costo zero

Vincolo: **0 € al mese, 0 € di attivazione**, nessun servizio a pagamento, nessuna carta di credito.
Sostituisce il piano a pagamento di `DEPLOY_TEST.md` (annullato). Nulla è stato ancora creato o pubblicato.
I limiti riportati sono stati verificati il 18/11/2026 sulle pagine ufficiali dei fornitori (fonti in fondo). Possono cambiare: ricontrollarli al momento dell'attivazione.

## 1. Limiti reali dei piani gratuiti (verificati)

| Servizio | Cosa offre gratis | Limiti rilevanti per l'app |
|---|---|---|
| **Render Free** (web service) | Container Docker, HTTPS su `*.onrender.com`, 750 ore/mese (bastano per 1 servizio sempre disponibile) | **Si sospende dopo 15 min senza traffico; risveglio ~1 minuto.** Nessun disco persistente (filesystem effimero). Niente shell/SSH. Porte SMTP 25/465/587 bloccate. Postgres Free di Render **scade dopo 30 giorni e viene cancellato dopo altri 14** → non usarlo. |
| **Neon Free** (PostgreSQL) | Permanente, nessuna carta. 1 GB per progetto, 100 CU-ore/mese per progetto, 5 GB/mese di traffico in uscita | Si sospende dopo 5 min di inattività (riparte in modo trasparente in meno di un secondo). Ripristino a un istante passato: solo ultime **6 ore**. 1 snapshot manuale. Oltre 1 GB le scritture si bloccano (i dati restano). |
| **GitHub Actions** (backup) | Repository privati: circa 2.000 minuti/mese (12 $ di credito incluso) e 500 MB di artefatti. Pubblici: gratis | Superato il limite **senza** metodo di pagamento i job vengono bloccati, non addebitati. |
| **Tailscale Funnel** (alternativa) | URL HTTPS pubblico `https://<pc>.<tailnet>.ts.net` per un computer tuo, certificati automatici | Beta; limiti di banda non dichiarati; richiede un computer **sempre acceso**. |
| **Oracle Cloud Always Free** (scartato) | VM ARM 2 OCPU / 12 GB (dimezzata nel 2026), 200 GB di disco | Richiede la carta in fase di iscrizione. Le istanze inattive per 7 giorni (CPU, rete e RAM sotto il 20%) **possono essere eliminate da Oracle**: un'app personale usata poco è a rischio. |
| **Cloudflare R2** (scartato) | 10 GB di storage | Fonti contrastanti sull'obbligo di registrare una carta o PayPal per attivarlo: escluso per prudenza. |

**Conclusione.** Nessun hosting gratuito senza carta offre un **disco persistente** per le foto, e la shell Render non è disponibile sul piano Free. L'unico modo per avere tutto gratis senza carta e senza un computer di casa sempre acceso è salvare le foto **dentro il database**.

## 2. Soluzione raccomandata (0 €)

**Render Free (app) + Neon Free (database, foto incluse) + GitHub Actions (backup cifrati).**

```
iPhone (PWA, Safari) ──HTTPS──▶ Render Free: container dell'app (API + PWA)
                                      │  rete cifrata (TLS)
                                      ▼
                              Neon Free: PostgreSQL 16, Frankfurt
                              (utenti, schede, sedute, check, feedback, FOTO)
GitHub Actions (ogni notte) ──▶ pg_dump cifrato con age ──▶ artefatto privato (7 giorni)
```

**L'unica modifica al backend (strettamente necessaria).** Un archivio foto alternativo in PostgreSQL, attivato da `STORAGE_DRIVER=db`:
- nuova classe `DbStorage` accanto a `FsStorage`;
- migrazione `002_photo_blobs.sql`.

Il resto non cambia:
- il predefinito resta `fs` (disco), quindi sviluppo, test e produzione futura funzionano come prima;
- regole di accesso alle foto, privacy, rimozione EXIF/GPS, revoca ed eliminazione a cascata sono le stesse;
- interfaccia, API, autenticazione, sincronizzazione offline e versionamento sono intatti.

**Funzionalità mantenute:** account coach e atleta con inviti, database persistente, schede e allenamenti, sincronizzazione offline, foto private con condivisione e revoca, check fisici, feedback, isolamento degli utenti, HTTPS.

### Compromessi (onesti)
1. **Risveglio di circa 1 minuto** se nessuno ha usato l'app negli ultimi 15 minuti.
   - La PWA si apre subito dalla cache e le serie registrate durante l'attesa vengono salvate sul telefono e sincronizzate appena il server è sveglio.
   - Login, primo caricamento dei dati e foto, invece, attendono il risveglio.
   - Consiglio pratico: apri l'app entrando in palestra.
2. **Capacità del database: 1 GB.** Stima con foto ridimensionate dall'app (1600 px, ~250–400 KB l'una):
   - un check con 3 foto occupa circa 1 MB; sedute e schede pesano pochi KB;
   - solo tu: ~50 MB all'anno;
   - 10 atleti con check settimanale: ~0,5 GB all'anno.
   - Quando ci si avvicina al limite, Neon blocca le nuove scritture senza perdere dati. Si alleggerisce eliminando foto vecchie, o si passa a un piano superiore (a pagamento, solo se lo deciderai).
3. **Traffico in uscita da Neon: 5 GB/mese**, circa 15.000 visualizzazioni di foto al mese. Ampio per pochi atleti.
4. **Email non disponibile** (SMTP bloccato su Render Free). Il recupero accesso avviene con il **link monouso generato dal coach** dal profilo atleta, già presente nell'app.
5. **Backup.**
   - Ripristino a un istante passato fornito da Neon: solo 6 ore.
   - Il backup indipendente è giornaliero su GitHub, conservato 7 giorni (limite 500 MB).
   - Una volta al mese conviene scaricarne una copia sul tuo computer o su iCloud Drive.
6. **Un solo server, nessuna garanzia di disponibilità**: Render può riavviare i servizi Free in qualsiasi momento. Per un uso personale e per pochi atleti è accettabile.

### Alternativa senza modifiche al backend: computer di casa + Tailscale Funnel
Se hai un Mac o un PC **sempre acceso**:
- l'immagine Docker gira com'è, con PostgreSQL e foto su disco locale;
- Tailscale Funnel la espone in HTTPS su `https://<nome-pc>.<tailnet>.ts.net`, gratis e senza dominio;
- vantaggi: nessun risveglio, nessun limite di 1 GB;
- svantaggi: se il computer si spegne o va in stop l'app non è raggiungibile; consumo elettrico; backup da fare verso iCloud/Google Drive.

## 3. Prove eseguite in questo ambiente (18/11/2026)

| Prova | Esito |
|---|---|
| Suite server completa (unit + integrazione) con la modifica | ✅ 39/39: le 37 precedenti + 2 nuove per `STORAGE_DRIVER=db` |
| Foto in DB: upload, accesso proprietario, coach solo se condivisa, atleta B escluso, revoca immediata, EXIF assente, `Cache-Control: private, no-store`, nessun file su disco | ✅ |
| Foto in DB: sostituzione e cancellazione (anche a cascata dal check) eliminano i blob; file non valido → nessun blob orfano | ✅ |
| Immagine Docker reale in modalità produzione con `STORAGE_DRIVER=db`, **senza disco**: container distrutto e ricreato (come uno spin-down o un deploy di Render Free) → dati e foto **identici byte per byte** | ✅ |
| Avvio dell'app nel container | ✅ 0,7–0,8 s (il minuto di Render è il risveglio della piattaforma) |
| Backup come lo eseguirà GitHub Actions (`deploy/backup.sh`, modalità db) → **perdita totale del database** → `restore.sh` → verifica dei conteggi di 15 tabelle → app riavviata: dati e foto identici | ✅ |
| Foto mancante nel database → `verify.sh` la segnala ed esce con errore | ✅ |
| Test di regressione della modalità a disco (backup, ripristino, esercitazione di disastro della fase precedente) | ✅ invariati |

**Non provati qui** (richiedono gli account che creerai tu):
- l'esecuzione reale del workflow su GitHub;
- la connessione TLS a Neon;
- il risveglio di Render;
- l'installazione su iPhone.

Vanno verificati al primo avvio (§5, punti 8–10).

## 4. File preparati (branch locale `test-env`)
- `render.yaml`: Blueprint **Free**. `STORAGE_DRIVER=db`, `DATABASE_URL` di Neon inserita a mano, nessun health check che terrebbe sveglio il database, deploy manuale.
- `.github/workflows/backup.yml`: backup giornaliero cifrato (02:17 UTC) + avvio manuale, artefatto conservato 7 giorni.
- `Dockerfile` e `deploy/*.sh`: stessa immagine e stessi script di backup/ripristino, ora con la modalità `db`.
- `server/src/services/storage.ts` (`DbStorage`), `server/migrations/002_photo_blobs.sql`, `server/src/config.ts` (`STORAGE_DRIVER`), test `server/test/storage-db.test.ts`.
- Nessun segreto nel repository.

## 5. Procedura di pubblicazione (dopo la tua approvazione, tutto gratuito e senza carta)
1. **Neon** (neon.com, accesso con GitHub o email):
   - crea il progetto `app-palestra-test` nella regione **AWS Europe Central (Frankfurt)**, con **PostgreSQL 16**;
   - copia la *connection string* diretta (termina con `?sslmode=require`).
2. **Chiave dei backup** sul tuo computer: `age-keygen -o chiave-backup-test.txt`.
   - Conserva il file offline: gestore di password + una copia su chiavetta.
   - La riga *Public key* (`age1…`) servirà su GitHub.
3. **GitHub** → repository → Settings → Secrets and variables → Actions:
   - `BACKUP_DATABASE_URL` = stringa Neon;
   - `BACKUP_AGE_RECIPIENT` = chiave pubblica.
   - Nota: GitHub esegue i workflow pianificati solo dal **branch predefinito** del repository.
4. **Render** (render.com, accesso con GitHub, nessuna carta):
   - New → Blueprint → seleziona il repository;
   - inserisci `DATABASE_URL` (Neon) e `APP_URL` (`https://app-palestra-test.onrender.com` o il nome assegnato);
   - verifica che il piano mostrato sia **Free**.
5. Primo deploy (manuale), poi apri `https://…onrender.com/api/health`: deve rispondere `{"ok":true}`.
6. **Account dimostrativi**: Render Free non ha shell, quindi si creano dal tuo computer collegandosi a Neon:
   ```bash
   cd server && DATABASE_URL='<stringa Neon>' NODE_ENV=test DEMO_PASSWORD='<password lunga>' npx tsx src/cli.ts seed-demo
   ```
   Crea `[DEMO] Coach Prova`, `[DEMO] Atleta A` e `[DEMO] Atleta B` sul dominio `@demo.app-palestra.test`. Il coach ha la «Scheda 5 giorni» precaricata.
7. **iPhone**: installa la PWA da Safari (`DEPLOY_TEST.md` §8) e segui la checklist Safari (`DEPLOY_TEST.md` §9), aggiungendo questi controlli:
   - [ ] dopo 20 minuti di inattività, la riapertura mostra l'app subito; le serie registrate durante il risveglio vengono sincronizzate una sola volta;
   - [ ] il login dopo l'inattività riesce entro circa 1 minuto;
   - [ ] le foto caricate restano visibili dopo un nuovo deploy.
8. **GitHub** → Actions → *backup* → *Run workflow*: deve comparire l'artefatto `palestra-backup-…`.
9. **Prova di ripristino** sul tuo computer:
   - crea un secondo progetto Neon gratuito, `app-palestra-restore`;
   - scarica l'artefatto e lancia:
   ```bash
   AGE_IDENTITY=chiave-backup-test.txt TARGET_DATABASE_URL='<stringa Neon restore>' STORAGE_DRIVER=db deploy/restore.sh palestra-test-*.tar.age
   ```
   Deve terminare con «VERIFICA SUPERATA». Poi elimina il progetto di prova.
10. Ogni mese: scarica un backup sul tuo computer e ripeti il punto 9.

**Atleti reali:** solo dopo il collaudo, con il tuo account coach (creato con `create-coach`) e gli inviti dall'app; poi si rimuovono i dati demo con `purge-demo`.

## 6. Quando servirà crescere
Nessuna riscrittura:
- più spazio sul database (piano Neon superiore);
- nessun risveglio (piano Render a pagamento);
- foto su disco o object storage (`STORAGE_DRIVER=fs` + disco).

Sono tutte decisioni rinviabili e reversibili: i backup funzionano in entrambe le modalità.

## Fonti
- Render, piano Free: https://render.com/docs/free
- Neon, prezzi e piano Free: https://neon.com/pricing
- GitHub Actions, fatturazione e limiti: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Tailscale Funnel: https://tailscale.com/kb/1223/funnel
- Oracle Cloud Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm
- Cloudflare R2 (requisiti di attivazione non chiari): https://www.cloudflare.com/developer-platform/r2/
