# APP PALESTRA — piano definitivo a costo zero

Vincolo: **0 € al mese, 0 € di attivazione**, nessun abbonamento, dominio, carta di credito, pay-as-you-go o addebito automatico. Vale per i test e per l'uso con gli atleti.
Stato: **proposta, nessuna migrazione avviata, nulla pubblicato.** Limiti verificati il 18/11/2026 sui siti ufficiali (fonti in fondo).

## Regola d'oro anti-addebito
**Non inserire mai una carta o un metodo di pagamento** su Render, Neon, GitHub, Supabase o Cloudflare.
Per tutti i servizi scelti, senza metodo di pagamento il superamento di una quota produce **blocco o sospensione, mai un addebito** (verificato per Render, GitHub Actions, Cloudflare D1 e Workers; Neon dichiara il piano Free permanente e senza carta).

## 1. Confronto delle opzioni

| Opzione | Lavoro di migrazione | Carta | Limiti principali | Valutazione |
|---|---|---|---|---|
| **A. Render Free + Neon Free + GitHub Actions** (Fastify invariato, foto in PostgreSQL) | **Già fatto e testato**: 42 righe nel backend, opzionali (`STORAGE_DRIVER=db`) | No | Risveglio ~1 min dopo 15 min di inattività; 1 GB di database (foto incluse); 5 GB/mese di traffico dal DB | **Raccomandata** |
| B. Render Free + **Supabase Free** (Postgres + Storage privato per le foto) | ~1 giorno: adattatore S3 per Supabase Storage, backup separato delle foto, test | Non dichiarato sulle pagine consultate | DB 500 MB, foto 1 GB, 5 GB di traffico; **progetto messo in pausa dopo 7 giorni di inattività**; nessun backup incluso | Più spazio per le foto, ma la pausa settimanale è un rischio concreto (vacanze, pause degli atleti) |
| C. **Cloudflare Pages + Workers + D1** (backend riscritto) | **Settimane**: Fastify → Workers, PostgreSQL → SQLite (D1), riscrittura di tutte le query | No (Workers/D1) · incerta per R2 | **10 ms di CPU per richiesta**: l'hashing sicuro delle password (scrypt, decine di ms) e `sharp` (ridimensionamento foto e rimozione EXIF, modulo nativo) non sono eseguibili. Andrebbero indeboliti o spostati sul telefono. L'import PDF è a rischio | **Sconsigliata**: molto lavoro e regressioni di sicurezza |
| D. **Supabase nativo** (Auth + RLS + Storage, senza Fastify) | Settimane: logica e permessi riscritti in policy RLS e client | Come B | Come B, più la riscrittura dell'isolamento dei dati | Sconsigliata |
| E. *(facoltativa, aggiungibile ad A)* **Cloudflare Pages** per la PWA + funzione proxy `/api` → Render | ~20 righe, nessuna modifica al backend | No | Pages Functions = Workers Free (100.000 richieste/giorno; l'attesa di rete non conta come CPU) | Apertura istantanea al **primo** accesso anche con Render addormentato. Utile soprattutto per gli inviti; dopo la prima visita lo fa già il service worker |

**Perché non Cloudflare o Supabase «al posto» di Fastify.** L'architettura attuale (Fastify + PostgreSQL + `sharp` + controlli dei permessi lato server) non gira nei Workers né nelle Edge Functions senza una riscrittura profonda. Supabase sarebbe utilizzabile solo come database/archivio dietro Fastify (opzione B), ma con una pausa automatica che renderebbe l'app irraggiungibile dopo una settimana di inutilizzo.

## 2. Soluzione raccomandata: A

```
Smartphone (PWA) ──HTTPS──▶ Render Free · app Fastify (API + PWA), Francoforte
                                    │ TLS
                                    ▼
                            Neon Free · PostgreSQL 16, Francoforte
                            utenti, schede, sedute, check, feedback, foto (private)
GitHub Actions (pianificato) ──▶ backup cifrato con age ──▶ artefatto privato + copia mensile sul tuo computer
```

**Requisiti.**
1. Tutte le funzionalità restano, senza riscrittura (vedi §4 per i limiti).
2. Isolamento tra atleti: invariato, controlli lato server (39 test di integrazione verdi).
3. Foto non pubbliche: nessun URL pubblico, servite solo da `/api/photos/:id` dopo i controlli di proprietà, collegamento e condivisione; revoca immediata; EXIF/GPS rimossi; conservate nel database.
4. Allenamenti offline e sincronizzazione: invariati (PWA + coda idempotente).
5. Nessuna carta: Render, Neon e GitHub Free non la richiedono.
6. Nessun costo automatico, se si rispetta la regola d'oro.
7. Backup gratuiti e ripristino verificato (§5).
8. Branch stabile non modificato: tutto è sul branch locale `test-env`, non pubblicato.
9. Nessun acquisto o pubblicazione senza la tua autorizzazione.

## 3. Cosa succede al raggiungimento delle quote

| Quota (verificata) | Uso stimato | Al superamento |
|---|---|---|
| Render: 750 ore/mese di istanza | 1 servizio ≤ 744 ore | Non raggiungibile con un solo servizio |
| Render: traffico in uscita incluso nel workspace (valore non riportato nella pagina consultata: si legge in *Billing → Usage*) | Poche centinaia di MB/mese per pochi utenti | **Tutti i servizi Free sospesi fino a fine mese.** Le serie registrate offline restano sul telefono e si sincronizzano al ritorno |
| Render: minuti di build | Pochi deploy al mese | Nuovi deploy bloccati; l'app continua a funzionare |
| Neon: **1 GB** di storage | Check con 3 foto ≈ 1 MB. Solo tu: ~50 MB/anno; 10 atleti con check settimanale: ~0,5 GB/anno | **Scritture bloccate** (anche sedute e check: app in sola lettura), dati intatti. Si libera spazio o si aggiunge archivio (§6) |
| Neon: **100 ore-CU/mese** (0,25 CU per ora attiva, sospensione dopo 5 min) | ~20–40 ore-CU con qualche ora di uso al giorno | **Calcolo sospeso fino al mese successivo: app non disponibile** |
| Neon: **5 GB/mese di traffico** (visualizzazione foto **e backup**) | Foto viste ~0,3 MB l'una; **ogni backup completo trasferisce l'intero DB** | Calcolo sospeso fino al mese successivo → app non disponibile |
| GitHub Actions: ~2.000 min/mese e 500 MB di artefatti (repository privato) | ~1 min per backup; artefatti = numero di copie × dimensione del DB | Job bloccati (nessun addebito); i backup si fermano |

**Due limiti da gestire attivamente.**
1. **Il traffico consumato dai backup.** Con le foto nel database ogni backup completo costa l'intera dimensione del DB. Regola: backup **giornaliero finché il DB è sotto 100 MB**, poi **settimanale**, sempre in modo che *dimensione × numero di backup al mese* resti sotto 2 GB.
2. **Lo spazio.** Un allarme preventivo: il workflow di backup legge la dimensione del database e fallisce sopra 800 MB, e GitHub ti avvisa per email gratuitamente.

Entrambe sono piccole modifiche al solo workflow (non all'app), da fare all'avvio.

## 4. Funzionalità con limiti in questa configurazione
- **Primo accesso dopo 15 minuti di inattività: ~1 minuto di attesa** per il risveglio di Render.
  - L'app installata si apre subito dalla cache e le serie registrate nel frattempo vengono salvate sul telefono.
  - Login, caricamento iniziale e foto attendono il risveglio.
  - L'opzione E elimina l'attesa al primo caricamento della pagina, non quella delle API.
- **Recupero password via email: non disponibile** (SMTP bloccato su Render Free). Si usa il link monouso generato dal coach, già presente nell'app.
- **Foto:** caricamento più lento (CPU ridotta del piano Free) e spazio condiviso con i dati entro 1 GB.
- **Import PDF:** funziona, ma può richiedere qualche secondo in più.
- **Disponibilità:** nessuna garanzia; Render può riavviare i servizi Free in qualsiasi momento (la seduta in corso resta comunque sul telefono).

Tutto il resto funziona senza differenze: account coach e atleta, inviti, schede e versioni, seduta, timer, progressi, check, feedback e domande, Area coach.

## 5. Backup e ripristino (gratuiti, verificati)
- **Automatici:** GitHub Actions esegue `deploy/backup.sh`. Il dump del DB (foto incluse) viene cifrato con **age** usando la sola chiave **pubblica**, conservato come artefatto privato per 7 giorni (o 14 con la cadenza settimanale).
- **Manuali:** ogni mese scarichi l'ultimo artefatto sul tuo computer o su iCloud Drive (spazio gratuito tuo).
- **Neon:** ripristino a un istante delle ultime 6 ore, per gli errori immediati.
- **Ripristino:** `deploy/restore.sh` decifra, controlla i checksum, ripristina in un database vuoto (un secondo progetto Neon gratuito) e lancia `verify.sh` (conteggi di 15 tabelle, foto ↔ righe).
- **Già verificato in questo ambiente:**
  - backup → perdita totale del DB → ripristino → app con dati e foto **identici byte per byte**;
  - container senza disco distrutto e ricreato senza perdite;
  - archivi manomessi o chiavi errate rifiutati;
  - foto mancanti segnalate.
- **Da verificare al primo avvio reale:** un ripristino dal backup prodotto su GitHub verso un secondo progetto Neon, poi una prova al mese.

## 6. Crescita senza costi
- **Prima di toccare i limiti:**
  - foto ridimensionate un po' di più, ad esempio 1280 px: è un parametro di configurazione;
  - eliminazione dei check vecchi non più utili, già possibile dall'app.
- **Più spazio per le foto, sempre gratis:** spostare la tabella `photo_blobs` in un **secondo progetto Neon Free** (+1 GB). Richiede una piccola modifica: una seconda stringa di connessione per l'archivio foto.
  - Neon Free consente più progetti, con un limite complessivo di storage da verificare sulla pagina dei prezzi.
  - Prima di farlo occorre verificarne la compatibilità con i termini d'uso.
- **Oltre questi margini** non esiste una soluzione gratuita affidabile per molti atleti con foto settimanali: andrebbero ridotte le foto (per esempio una sola posa) o accettato un servizio a pagamento. Sarà una tua decisione, non un passaggio automatico.

## 7. Prossimi passi (solo dopo la tua autorizzazione)
1. Autorizzi il piano A (con o senza l'opzione E).
2. Mi indichi dove pubblicare i commit di `test-env`: un branch separato, il branch stabile resta intatto.
3. Io aggiungo al workflow la cadenza adattiva dei backup e l'allarme di spazio (§3), e li testo.
4. Tu crei gli account gratuiti (Neon, Render, eventualmente Cloudflare), **senza carta**, e segui `DEPLOY_FREE.md`.
5. Collaudo su iPhone (checklist Safari), prova di ripristino, poi gli inviti agli atleti.

## Fonti (consultate il 18/11/2026)
- Render, piano Free: https://render.com/docs/free
- Neon, piano Free: https://neon.com/pricing
- Supabase, prezzi: https://supabase.com/pricing · Billing FAQ (restrizioni al superamento delle quote): https://supabase.com/docs/guides/platform/billing-faq
- Cloudflare Workers, limiti: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1, prezzi e limiti: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare R2, prezzi: https://developers.cloudflare.com/r2/pricing/
- GitHub Actions, fatturazione: https://docs.github.com/en/billing/concepts/product-billing/github-actions
