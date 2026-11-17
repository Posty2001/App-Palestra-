# APP PALESTRA — consegna per lo sviluppo

Sviluppa una prima versione realmente utilizzabile di APP PALESTRA, in italiano, ottimizzata per iPhone e comoda anche da desktop per il coach. Usa questo documento come specifica. Se lavori in Claude Code, implementa nel progetto locale e avvia i controlli. Se lavori in chat, consegna un progetto sorgente completo e avviabile. Inizia dall'implementazione e accompagna il codice con istruzioni di avvio, configurazione e collaudo.

## Materiale incluso

- `scheda_allenamento_5_giorni.pdf` è la scheda sorgente. Precaricala nel profilo personale del coach, con **Pendulum Squat al Giorno 3 come terzo esercizio al posto di RDL manubri**, 2 serie, 7/5 ripetizioni e 4–5 min di recupero, modificabili. Mantieni gli altri esercizi, l'ordine e le notazioni originali. Il PDF originale contiene ancora RDL.
- `app-palestra-coach.html` è il riferimento interattivo dell'area coach. Usa nomi e valori di esempio. Per aprirlo da browser, basta aprire il file HTML. Usa questo brief per i comportamenti reali e per le schermate atleta.
- La piattaforma è una scelta implementativa. Una PWA mobile-first con backend gestito è una base proponibile. Usa autenticazione reale, database persistente e archivio privato per foto. L'ambiente di prova va configurato con utenti sintetici e senza credenziali in repository.

## Design e navigazione

Stile approvato **Bodybuilding premium**. Fondo nero grafite (#161317), schede #231e24, testo chiaro #fff3f5, accento rosso #ff5065 per l'azione principale e i segnali importanti. Titoli compatti (Barlow Condensed), testo leggibile (Inter), carichi e timer con numeri grandi. Pulsanti comodi a una mano, interfaccia lineare, un'azione principale per schermata. Il contatore dischi è escluso.

**Atleta:** barra Oggi · Scheda · Progressi · Check fisico. **Coach:** voce Atleti, con accesso anche al proprio spazio di allenamento. L'interfaccia deve distinguere con chiarezza il profilo personale dal profilo dell'atleta aperto.

## Account e accessi

- Il coach invita. L'atleta crea o collega il proprio account accettando un invito personale. Gestisci inviti non validi, scaduti o già usati e il recupero dell'accesso.
- Ogni atleta vede i propri dati, schede e feedback. Il coach accede agli atleti collegati e può assegnare schede e scrivere feedback. I ruoli e il collegamento coach–atleta si verificano lato server.
- Schede, storico delle sedute, serie, peso, misure, note, feedback e foto devono ritrovarsi dopo logout o cambio dispositivo. Foto private per impostazione iniziale. L'atleta controlla la visibilità al coach per ciascun check e può modificare la scelta o eliminare la foto. L'accesso ai dati e ai file deve seguire il collegamento e la condivisione corrente. Evita URL pubblici per le foto.

## Schede

- Azioni **Creala a mano** e **Importa PDF**. Ogni scheda ha un nome, un eventuale periodo con inizio e fine e giorni modificabili. Consenti di aggiungere e rimuovere giorni ed esercizi, impostare serie, ripetizioni, recuperi e note. Supporta top set, back-off e percentuali se presenti. Conserva le notazioni come 10-6 e 10/6 quando il significato non è esplicito.
- Il PDF genera una bozza modificabile. Estrai giorni e righe dai PDF con testo selezionabile e layout tabellare compatibile. Mostra elementi dubbi o mancanti e chiedi conferma prima di salvare. Se il PDF è una scansione o non è leggibile, comunica il limite e offri l'inserimento manuale.
- Gestisci più schede. La vista **Oggi** permette di selezionare quale eseguire tra quelle disponibili per quell'account. Ogni scheda conserva la propria rotazione, senza giorni della settimana fissi. Il periodo è visibile e una scadenza può generare un avviso nella vista coach. Il coach può duplicare un programma, personalizzarne la copia e assegnarla senza modificare quella di altri atleti.
- Per modificare usa **Modifica scheda**, con salvataggio o pubblicazione esplicita. **Pubblica modifica** crea una nuova versione e mostra all'atleta un riepilogo. Una seduta in corso e lo storico fanno riferimento alla versione e al giorno effettivamente eseguiti. La versione nuova vale dalla prossima seduta.

## Oggi e seduta

- In Oggi mostra scheda selezionata, prossimo giorno, **Inizia allenamento** o **Riprendi allenamento** e scelta del giorno se l'atleta vuole cambiare ordine. Se salta la palestra, il prossimo giorno resta disponibile. Check in scadenza e indicazioni nuove appaiono quando pertinenti.
- Seduta in **un'unica lista scorrevole**, con esercizi espandibili direttamente nella lista. Nell'esercizio mostra obiettivo, serie dell'ultima volta, eventuale feedback, campi kg e ripetizioni precompilati dalla serie corrispondente dell'ultima seduta, RIR facoltativo. Senza storico, lascia i campi da compilare. Permetti di saltare o sostituire un esercizio e registra l'attività effettiva.
- **Completa serie** registra una sola volta e avvia il recupero. Barra timer sempre visibile in fondo, anche mentre si scorre, con **Salta recupero**. Per un intervallo di recupero consenti di scegliere la durata. Usa il tempo reale trascorso anche dopo cambio schermata o riapertura.
- **Assetto macchina** è una nota facoltativa per esercizio, mostrata sotto Ultima volta quando compilata. **+ Riscaldamento** è un'azione discreta. Le serie di riscaldamento restano nello storico e sono escluse dal contatore delle serie allenanti e dai record.
- Salva progressivamente. Supporta registrazione offline di una seduta già disponibile e sincronizzazione senza duplicati al ritorno della connessione. Indica lo stato di sincronizzazione. Conserva la seduta in sospeso anche dopo la chiusura dell'app.
- **Termina allenamento** mostra durata, serie registrate, esercizi saltati e serie mancanti. La nota atleta è facoltativa. **Torna alla seduta** consente correzioni. **Salva allenamento** accetta anche una seduta parziale e aggiorna la rotazione della scheda eseguita. **Scarta seduta** chiede conferma e lascia la rotazione al giorno precedente allo scarto.

## Progressi e check fisico

- **Progressi** ha viste Esercizi e Storico sedute. Mostra ultima seduta, serie registrate, migliori carichi per numero di ripetizioni e andamento a parità di ripetizioni. Sul Pendulum si possono confrontare, per esempio, linee 5 e 7 ripetizioni. Tieni separati attrezzi e varianti diverse. Mostra chiaramente miglioramenti nelle ripetizioni a uno stesso carico. I suggerimenti automatici di progressione sono facoltativi e valgono solo per criteri esplicitamente configurati.
- **Check fisico** ha Nuovo check e Aggiungi peso. Un check datato può includere peso, bicipite, petto, coscia, addome, nota e foto fronte, lato e retro. Consenti inserimenti retrodatati, media settimanale del peso quando ci sono rilevazioni e scelta di due date, inizialmente primo e ultimo check disponibili. Foto grandi affiancate della stessa posa in primo piano. Sotto, misure e differenze. La condivisione mostra cosa verrà incluso. Le foto si includono su scelta dell'atleta.
- Il coach può fissare il giorno del check ricorrente per atleta. In quel giorno l'atleta vede **Fai il check** in Oggi e ritrova il feedback del coach nel check inviato.

## Area coach e feedback

- **Atleti** mostra chi segui e una coda **Da rivedere** con check ricevuti, nuove domande o note, e schede in scadenza. Ogni voce apre direttamente il dato associato. Dopo la revisione l'elemento esce dalla coda, restando accessibile nel profilo.
- Nel profilo atleta mostra scheda attiva, ultimo allenamento e ultimo check. Sezioni Scheda · Allenamenti · Check. Azioni principali **Assegna scheda** e **Lascia feedback**. Permetti al coach di scegliere 2–3 esercizi chiave e vedere la variazione a parità di ripetizioni.
- Puoi lasciare un commento su un check o un'indicazione su un esercizio. Il coach può anche aggiornare la versione assegnata. L'atleta vede il feedback nel punto pertinente. Per esercizio, sotto **Ultima volta**. Per check, dentro il check stesso.
- **Chiedi al coach** dentro un esercizio apre una domanda breve. Il coach la trova in Da rivedere con atleta, esercizio e ultima prestazione. La risposta rimane consultabile nell'esercizio.

## Priorità e verifica della consegna

1. Configura accessi, inviti, archivio di schede, assegnazione, sessioni e salvataggio. Verifica tre utenti di prova, coach, atleta A e atleta B. Controlla che l'atleta B non possa ottenere sessioni, check o foto dell'atleta A e che il coach veda solo gli atleti collegati e le foto autorizzate.
2. Prova creazione manuale e importazione del PDF incluso. Verifica i cinque giorni, la revisione, la possibilità di sostituire RDL con Pendulum, l'aggiunta e rimozione di giorni, la selezione di due programmi e le rotazioni indipendenti.
3. Prova su viewport iPhone il flusso **Oggi → Pendulum → Completa serie → Recupero → Lascia in sospeso → Riprendi → Termina → Salva**. Verifica anche serie offline, riconnessione e nuovo accesso con la stessa utenza. I dati devono comparire una sola volta. Verifica che pubblicare una modifica durante una seduta non alteri quella seduta.
4. Prova **Atleta → Fai il check o Chiedi al coach → Coach → Da rivedere → Feedback → Atleta**. Verifica il confronto foto, la revoca della visibilità, l'eliminazione e l'accesso da un secondo dispositivo. Verifica che i dati di esempio siano riconoscibili e confinati alla prova.
5. Consegna codice sorgente, README, schema e migrazioni, esempio di configurazione privo di segreti e risultati dei controlli. Distingui verifiche automatiche, prove manuali e controlli ancora da svolgere. Se manca un servizio o un progetto remoto, completa il lavoro locale possibile e indica con precisione la configurazione richiesta. Usa un ambiente di prova prima del rilascio con atleti reali.
