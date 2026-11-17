# APP PALESTRA 2.0 — restyling: modifiche ed esito delle prove

Data: 18/11/2026 · Branch: `claude/peaceful-archimedes-lzmfeq`
Direzione approvata: Premium Minimal × Performance Sport. Nessuna immagine degli esercizi.

## Riepilogo delle modifiche

### Design system (`web/src/styles.css`, `web/src/components/`)
- Palette approvata: fondo `#111216`, fondo 2 `#1D2026`, card `#24272D`, bordi `#30343D`, primario `#FF5265` (premuto `#D63C50`), successo `#35C58B`, testo `#F4F5F7` / `#A7ADB8`, ambra `#F2B84B` solo per avvisi non critici (in scadenza, inattivo).
- Barlow Condensed per titoli e numeri (kg, ripetizioni, timer), Inter per il testo; testo operativo ≥ 15–16 px.
- Pulsanti ≥ 48 px (azioni principali 52–58 px), card a bordi sottili, icone lineari (`icons.tsx`), animazioni brevi e disattivate con «riduci movimento», aree sicure iPhone (`env(safe-area-inset-*)`).
- Stati di caricamento (skeleton), vuoto, errore, offline e sincronizzazione su tutte le schermate.

### Navigazione
- **Atleta:** Oggi · Scheda · Progressi · Check. Profilo e impostazioni dall'avatar in intestazione.
- **Coach:** selettore **Coach | Il mio allenamento** in intestazione, un solo account.
  - Area coach: Dashboard · Atleti · Schede · Progressi · Check.
  - Il mio allenamento: le stesse schermate dell'atleta, con le schede del coach (nessuna duplicazione).
  - L'ultima modalità viene ricordata sul dispositivo e usata al login.
- Profilo di un atleta: striscia corallo in alto e nome dell'atleta sempre visibile (anche in editor, Progressi coach, domande, revisione check).

### Schermate
- **Oggi:** allenamento previsto, scheda, avanzamento della rotazione, «Inizia/Riprendi allenamento» con un tocco, scelta di giorno e scheda, ultimo feedback del coach, check del giorno.
- **Seduta:**
  - Barra di navigazione degli esercizi, liberi da qualsiasi ordine.
  - Esercizio attivo in evidenza con ultima volta, assetto, feedback e risposta; serie registrate compatte (tocco → modifica / annulla).
  - Editor della serie corrente con campi kg e ripetizioni grandi: digitazione manuale + pulsanti ±. Il passo è scelto per esercizio (1 / 1,25 / 2,5 / 5 kg), salvato sul dispositivo e calcolato in centesimi, senza errori di arrotondamento.
  - RIR facoltativo.
  - «Completa serie N» in una barra fissa in basso, separata dal contenuto. Il recupero compare come barra compatta sopra il pulsante e non lo copre.
  - Menu ⋯ con tutte le azioni: riscaldamento, serie extra, sostituisci, assetto macchina, passo ±, chiedi al coach, salta / ripristina.
- **Timer recupero:** countdown grande con anello, pausa/ripresa, −15 s / +15 s, preset, salta.
  - Basato sull'ora reale e persistito: resta corretto dopo background, blocco o riapertura.
  - Fine recupero: segnale visivo (verde, «Recupero finito») e breve suono Web Audio, che rispetta volume e silenzioso.
  - La vibrazione viene tentata solo dove il browser la supporta (non Safari iOS); nessuna notifica promessa.
- **Domande e feedback:** vista a conversazione per esercizio (riusa domande/risposte/indicazioni esistenti); lato coach la risposta parte dalla stessa conversazione.
- **Scheda:** schede espandibili con giorni selezionabili, esercizi leggibili con notazioni originali (top set/back-off, 10-6, 10/6) e note.
- **Editor schede:**
  - Giorni come schede; esercizi in card espandibili con ↑/↓ e rimuovi.
  - Menu del giorno: rinomina, sposta, aggiungi, rimuovi.
  - Anteprima «L'atleta vedrà…».
  - Etichette **Modificato / Nuovo** sulle modifiche non ancora pubblicate.
  - Barra fissa con Salva bozza / Pubblica modifica.
  - L'import PDF segnala i dubbi sui giorni (!) e nelle card.
- **Progressi:** Carichi (grafico a parità di ripetizioni, migliori carichi, più ripetizioni a parità di carico) · Sedute (storico) · Corpo (media settimanale del peso, misure primo→ultimo check). Grafici mostrati solo con almeno due rilevazioni.
- **Check fisico:** nuovo check con anteprima di cosa vede il coach, confronto foto affiancate, dettaglio con feedback a conversazione; privacy invariata.
- **Coach:**
  - Dashboard con atleti, check da rivedere e richieste (solo dati reali), «Da gestire» raggruppato per atleta e attività recenti.
  - Atleti con ricerca e filtri: tutti, da rivedere, inattivi, mai allenati, senza scheda.
  - Profilo con schede interne: Riepilogo, Scheda, Sedute, Progressi, Check.
  - Assegna scheda (da profilo o da scheda), Schede «Le mie / Degli atleti», Progressi un atleta alla volta, Check da rivedere, revisione check con foto solo se autorizzate.
- **Inattività:** calcolata in interfaccia dai dati già restituiti da `/coach/athletes` (nessuna nuova query o migrazione). Tre stati: attivo, inattivo oltre soglia, nessun allenamento registrato. La soglia è 7 giorni di default, modificabile in Account e salvata sul dispositivo.

### Backend
Nessuna modifica a contratti API, database, autenticazione, autorizzazioni, privacy delle foto o versionamento. Aggiunto solo un test d'integrazione (eliminazione di una serie).

## Difetti trovati durante il collaudo e corretti
1. **Sincronizzazione — wakeup perso (bug preesistente, dimostrato dal test 9).** Un'operazione accodata mentre una sincronizzazione stava terminando restava in coda fino al tentativo successivo (≤ 30 s), e l'indicatore mostrava «Sincronizzato».
   - Correzione minima in `sync.ts`: se arriva una richiesta durante la sincronizzazione, si esegue un altro giro.
   - Il contatore della coda si aggiorna prima della UI: l'indicatore è sempre veritiero.
   - Nessuna modifica a idempotenza, ordine o formato delle operazioni.
2. **Precompilazione della serie** spostata dall'effetto al render: un input molto rapido poteva essere sovrascritto (peso del riscaldamento perso).
3. **Viewport allargato a 443 px** da un testo troncato nella Dashboard (`min-width: auto` dei figli di griglia): corretto in CSS e coperto da un controllo automatico «nessuno scroll orizzontale» sulla larghezza reale dello schermo.
4. Intestazione troppo affollata su 390 px; esercizio aperto di default deciso al primo render (niente sfarfallio); preset del timer tagliati; fogli semi-trasparenti durante l'animazione.

## Esito delle prove (eseguite il 17–18/11/2026)

| Suite | Esito |
|---|---|
| Typecheck strict (shared, server, web) | ✅ 0 errori |
| Unit `shared` | ✅ 9/9 |
| Integrazione API su PostgreSQL 16 | ✅ 37/37 (36 preesistenti + 1 nuovo) |
| End-to-end Playwright, iPhone 13, locale it-IT | ✅ 10/10, eseguiti 3 volte consecutive senza errori |

Flussi end-to-end:
1. Coach: assegna scheda all'atleta A, cambio modalità Coach ↔ Il mio allenamento (schede personali, tab bar coerente).
2. Atleta: Oggi → Pendulum → Completa serie (doppio tocco = 1 serie) → Recupero → ricarica → Lascia in sospeso → Riprendi → riscaldamento → Termina → Salva.
3. Offline: serie senza rete, ricarica offline, riconnessione, secondo dispositivo, dati una sola volta (DB verificato).
4. Pubblicare una modifica durante una seduta: la seduta resta sulla v1; etichetta «Modificato»; scarto senza cambiare rotazione.
5. Check con foto private, Chiedi al coach dal menu ⋯, Dashboard «Da gestire», risposta, feedback su check ed esercizio, condivisione e revoca (404 immediato), atleta B escluso, secondo dispositivo, eliminazione foto.
6. Import PDF incluso (dubbi segnalati), RDL → Pendulum, rimozione/aggiunta giorni, conferma revisione, seconda scheda a mano, rotazioni indipendenti.
7. **Nuovo · navigazione:** tab bar per ruolo e modalità, voce attiva, contesto atleta in Progressi coach, modalità ricordata al login, area coach inaccessibile all'atleta, nessuno scroll orizzontale su 15 schermate.
8. **Nuovo · timer** (orologio simulato): ±15 s, pausa (il tempo non scorre) e ripresa, preset, riapertura dell'app, segnale visivo di fine recupero.
9. **Nuovo · registrazione serie:** passo 2,5 → 1,25 senza errori di arrotondamento (63,75), passo per esercizio, inserimento manuale (61,3), modifica con lo stesso id (1 riga nel DB), annulla serie propagato al server.
10. **Nuovo · inattività:** attivo / inattivo da 10 giorni / mai allenato, filtri e ricerca, soglia portata a 14 giorni.

Screenshot reali (Chromium, iPhone 13): [`docs/screenshots/`](screenshots/).

## Problemi aperti / da verificare
- **Safari iOS reale non testato:** le prove usano Chromium con emulazione iPhone. Su un iPhone vanno verificati:
  - PWA installata e aree sicure con Dynamic Island;
  - tastiera numerica decimale con la virgola;
  - suono di fine recupero con l'interruttore silenzioso;
  - formato delle date (negli screenshot i campi data mostrano `mm/dd/yyyy` perché Chromium headless usa la lingua del sistema: su un iPhone in italiano compare `gg/mm/aaaa`).
- **Vibrazione e notifiche:** non disponibili su Safari iOS per le web app in primo piano; con l'app in background non c'è alcun segnale (il tempo resta corretto alla riapertura).
- Preferenze salvate solo sul dispositivo (passo ±, soglia di inattività, ultima modalità): non seguono l'utente su un altro telefono, per scelta (nessuna migrazione).
- «Attività recenti» mostra l'ultimo allenamento e l'ultimo check per atleta (dati già disponibili), non uno storico completo.
- Restano validi i punti aperti di `ESITO_PROVE.md` (ambiente TEST online con HTTPS, SMTP, backup, revisione privacy).

## Avvio della versione aggiornata
```bash
git checkout claude/peaceful-archimedes-lzmfeq && git pull
npm install
npm run migrate          # nessuna nuova migrazione, comando idempotente
npm run seed:demo        # solo ambiente di prova
npm run dev              # http://localhost:5173
```
Per provarla su iPhone: `npm run build` e poi il tunnel HTTPS descritto nel README.
