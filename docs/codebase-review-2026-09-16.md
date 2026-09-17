# Review della codebase: qualità, residui e ottimizzazioni

Data: 16 settembre 2026. Revisione: `58e954bfe62d35f9ff7b16ebca6a84346ffa72fd` (v0.2.5 + fix bot fill).
Ambito: client React 19 / R3F / Three.js, server Colyseus, shared, bot, mappe, asset pipeline, test, CI e deploy.

## Valutazione

La base architetturale è coerente con un multiplayer LAN: contratto condiviso, dipendenze orientate, geometria comune per i colpi, validazione degli ingressi e separazione tra posizioni per frame e stato React. Non emerge la necessità di cambiare stack o introdurre un framework di stato.

Le priorità sono correggere le divergenze tra stato locale e server, alcuni casi limite della navigazione/percezione dei bot e la gestione del tempo nel movimento. La pulizia può poi eliminare metadati senza lettori, contratti inutilizzati e documentazione superata. Le ottimizzazioni più promettenti riguardano rendering statico, aggiornamento dei metadati e geometria ripetuta; il loro beneficio in partita va misurato.

Non sono stati modificati sorgenti, test, configurazioni o dipendenze dichiarate. Questo documento è l'unico nuovo file versionabile.

## Metodo, verifiche e limiti

La skill `investigate` è stata applicata alla lettura e alla diagnosi; la creazione di questo Markdown è l'eccezione esplicitamente richiesta dall'utente.

| Area | Copertura della review |
| --- | --- |
| Shared | Costanti, cataloghi, protocollo, tipi bot, validazione mappe, geometria, timeout, codici party |
| Server | Entry point, HTTP, identità, SQLite, room lifecycle, messaggi, shooting, bot fill, error handling |
| Mappe | Tre builder, primitive della griglia, furnishing, cataloghi e manifest dei modelli |
| Bot | CLI, trasporto, driver, policy, percezione, collisioni, A*, smoothing, trace |
| Client | App, connessione e riconnessione, lobby, scene 3D, HUD, input, audio, storage, preferenze, CSS |
| Tooling | Manifest, tsconfig, Biome, Vite, Docker, compose, quattro workflow GitHub, nginx di riferimento |
| Test | Inventario delle 14 suite e lettura mirata delle regressioni pertinenti; nessuna nuova suite creata |
| Asset | Riferimenti e pipeline; non una verifica visiva di tutti i GLB o delle licenze |

Verifiche eseguite:

- `pnpm check:ci`: superato, 100 file controllati.
- `pnpm typecheck`: superato nei quattro package.
- Diagnostiche in memoria sui moduli reali per percezione, navigazione e inseguimento dei bot; risultati sotto.
- Campionamento delle mappe e micro-misura della costruzione della griglia; controllo degli spawn station su 1.000 seed.
- Ricerca dei lettori dei candidati dead code e controllo dei peer dependency di Colyseus installato.

L'ambiente espone Node **22.22.3**, mentre repository e CI richiedono Node **≥24**. Le verifiche non equivalgono quindi alla CI sul runtime previsto. All'avvio dei comandi, pnpm 11.9.0 ha automaticamente installato le dipendenze mancanti in `node_modules`; manifest e lockfile sono rimasti invariati. È comparso un warning transitorio sulla creazione del binario `tsc`, seguito dal completamento positivo di tutti i typecheck.

Non sono stati eseguiti la suite completa, la build di produzione, un browser playtest, un deploy o profiling GPU. Il percorso di build scrive e pota `dist`; la review è rimasta diagnostica. Non si dichiarano FPS guadagnati, leak GPU misurati o errori osservati in produzione.

**Classificazione:** P1 = intervenire prima dei refactor; P2 = correzione funzionale/manutentiva nel prossimo ciclo; P3 = pulizia o miglioramento circoscritto. “Riprodotto” significa osservato con i moduli reali in memoria; “statico” significa dimostrato dal flusso del codice, senza riproduzione end-to-end; “da misurare” indica una proposta prestazionale.

## Rilievi prioritari

### R1 · P1 · L'arma locale non segue quella autorevole

**Evidenza statica.** [Game.tsx:491](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Game.tsx:491) inizializza sempre `weapon` a `DEFAULT_WEAPON`. Il campo non compare nei metadati sottoscritti né in [RemotePlayerView](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/types.ts:3). Il server conserva invece `PlayerState.weapon` durante la riconnessione e [handleSetWeapon](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/rooms/MorphyRoom.ts:624) rifiuta i cambi quando il giocatore è morto. [App.tsx:111](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/ui/App.tsx:111) rimonta Game dopo il reconnect.

**Effetto:** scegliendo rifle o shotgun e riconnettendosi, viewmodel, audio e cooldown locali tornano alla pistol mentre il server risolve i colpi con l'arma precedente. Accade anche al ritorno party → partita, che rimonta Game senza cambiare room. Inoltre i tasti 1/2/3 aggiornano lo stato locale anche da morti: il server rifiuta il cambio, ma la UI lo conserva.

**Intervento minimo:** leggere e sottoscrivere l'arma locale dallo schema, mantenere un'unica fonte autorevole e applicare gli stessi vincoli ai comandi della UI. Se si vuole una selezione ottimistica, riconciliarla con la risposta del server.

**Verifica:** selezionare rifle, interrompere e ristabilire la connessione; ripetere tornando al party e cambiando arma da eliminati. Controllare arma mostrata, cadenza e `MSG_SHOT_FIRED.weapon`.

### R2 · P1 · Un obiettivo irraggiungibile viene considerato raggiunto

**Riprodotto.** In [Reflex.runStatic:482](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:482), dopo `ensurePath`, l'assenza di waypoint porta a `settle()` se `pathBlocked` è false. Ma [failPath:674](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:674) al primo fallimento incrementa solo `replanCount`; imposta `pathBlocked` dopo due tentativi.

Con una mappa separata da un muro continuo, bot a (-5, 0) e `hideAs` a (5, 0), il primo tick produce:

```text
t=1000: position=(-5,0), blocked=false, arrival=true, settled=true, replanCount=1
t=2000: position=(-5,0), blocked=false, arrival=false, settled=true, replanCount=1
t=3000: position=(-5,0), blocked=false, arrival=false, settled=true, replanCount=1
```

Il bot smette di tentare prima di poter raggiungere la soglia di fallimento. La policy ripropone lo stesso nascondiglio e [behaviorChanged](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/driver.ts:28) non azzera il percorso per un intento equivalente.

**Intervento minimo:** distinguere esplicitamente pianificazione fallita, percorso attivo e percorso completato. Segnalare arrivo solo dopo un percorso valido consumato o distanza effettivamente raggiunta. Poi fare scegliere un'altra destinazione alla policy quando il percorso resta impossibile.

**Verifica:** obiettivo in componente disconnessa, fallimento temporaneo e arrivo ordinario; verificare retry limitati e assenza di falsi eventi di arrivo.

### R3 · P1 · Il motore dei bot usa posizioni aggiornate di bersagli non percepiti

**Riprodotto a livello di motore.** [runShoot:534](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:534) recupera il bersaglio da `world.others`. Se non può colpirlo, [riga 579](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:579) pianifica verso le sue coordinate vere. [runApproach:516](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:516) quantizza la posizione nascosta, ma non verifica che il bersaglio sia ancora udibile.

La policy filtra l'osservazione, però un intento resta attivo fra due decisioni. Durante questo intervallo il motore può seguire un bersaglio uscito dalla percezione.

Diagnostica: bot a (0,0), muro continuo a x=5, contatto a (16,3), oltre il raggio uditivo. L'osservazione limited contiene **zero entità**, ma eseguendo un intento già acquisito:

```text
shootTarget → pathGoal=(16,3), cioè la posizione vera corrente
inspect     → pathGoal=(16,4), cioè la posizione corrente quantizzata
```

Il test isola un intento preesistente; non dimostra che la policy scelga da zero un contatto invisibile.

**Intervento minimo:** conservare l'ultima posizione legittimamente percepita e aggiornare il target soltanto quando passa i gate di vista/udito. Il motore deve poter cercare l'ultima posizione nota senza leggere il movimento successivo dietro il muro.

**Verifica:** acquisire un bersaglio visibile, farlo sparire oltre vista e udito prima della decisione successiva, spostarlo dietro il muro; la destinazione non deve seguirlo.

Questo è distinto dal compromesso accettato della visibilità dello schema ai client: riguarda le regole informative dei bot, esplicitamente richieste dal progetto.

### R4 · P2 · Un contatto immobile può generare un falso rumore

**Riprodotto.** [trackMovement:346](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:346) inizializza `lastMovedAt = now` al primo avvistamento, pur restituendo false. Una seconda osservazione entro `MOVED_RECENTLY_MS` restituisce true anche senza spostamento.

Con il fixture geometrico di [bot-perception.test.mjs:7](/Users/davide/orca/workspaces/morphy.lol/bonnethead/tests/bot-perception.test.mjs:7), contatto fermo a (5.9,1.9) dietro un muro:

```text
t=1000: entities=[]
t=1200: entities=[{x:4,z:0,hasLineOfSight:false,movedRecently:true}]
t=1700: entities=[]
```

La cadenza ordinaria di decisione è 700 ms e la finestra movimento 600 ms: il caso emerge con una decisione anticipata da eventi, non a ogni ciclo ordinario.

**Intervento minimo:** inizializzare il timestamp a un valore che rappresenti “nessun movimento osservato” e aggiornarlo solo dopo uno spostamento reale. Eliminare anche i campioni di giocatori usciti: oggi `movement` viene svuotata solo in `setMap`.

**Verifica:** contatto fermo e contatto in movimento dietro un muro, con intervalli inferiori e superiori a 600 ms.

### R5 · P2 · Il movimento client integra un delta non limitato

**Evidenza statica.** [LocalPlayer:1853](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:1853) usa direttamente `delta` per accelerazione, posizione e gravità. Le collisioni verificano la posizione finale, non il segmento percorso. Il bot, invece, limita già il passo in [driver.ts:121](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/driver.ts:121).

Un frame lento può saltare completamente un collider sottile: a velocità hunter di 8.5 unità/s, 250 ms rappresentano 2.125 unità, oltre lo spessore di una parete station. Il risultato esatto dipende da posizione iniziale, input e geometria; non è stato riprodotto nel browser.

**Intervento minimo:** estrarre l'integrazione del movimento in una funzione pura, usare sottopassi limitati e un limite al recupero del tempo perso. Il solo clamp a 250 ms non basta a garantire collisioni con muri di un'unità.

**Verifica:** stessa traiettoria a 30/60/144 Hz e con spike da 100–500 ms; salto sotto un soffitto, contro una parete, vicino a uno spigolo. Non cambia l'autorità del movimento.

### R6 · P2 · Un taunt rimasto senza mesh può tenere attive le ombre

**Evidenza statica.** [Game.tsx:632](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Game.tsx:632) inserisce il timer in `tauntPulseRef`. Il valore viene decrementato da [applyTauntPulse](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:65), eseguito dalle mesh dei giocatori. [onRemove:562](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Game.tsx:562) non elimina l'entry. Se un giocatore esce durante il pulse, il valore positivo può restare senza un consumatore.

[ShadowRefresh:779](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:779) considera ogni valore positivo un'animazione in corso e azzera continuamente il timer di quiete. La scena può quindi continuare ad aggiornare le ombre fino a circa 30 Hz anziché passare al refresh di quiete.

**Intervento minimo:** rimuovere l'entry all'uscita e usare scadenze temporali o un aggiornamento centralizzato indipendente dalla presenza della mesh; pulire i pulse al cambio round.

**Verifica:** taunt seguito immediatamente dall'uscita del giocatore; a scena ferma il refresh deve tornare alla cadenza di quiete. Impatto GPU da misurare.

### R7 · P2 · La rimozione di un bot guasto non rivaluta la fine del round

**Evidenza statica.** [tickBots:1155](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/rooms/MorphyRoom.ts:1155) cattura un errore e chiama `removeBot`, ma [removeBot:1128](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/rooms/MorphyRoom.ts:1128) non esegue le verifiche di continuazione/fine round presenti in `onLeave`.

Se il bot guasto è l'ultimo hunter o l'ultimo prop, il round può continuare finché un altro evento non chiama `checkRoundEnd`. Nel caso senza altri eventi può arrivare al timeout, che assegna la vittoria ai props. Il [test esistente:305](/Users/davide/orca/workspaces/morphy.lol/bonnethead/tests/server-room.test.mjs:305) verifica rimozione e contenimento dell'errore, ma non l'esito in hunting.

**Intervento minimo:** un percorso comune di rivalutazione dopo la rimozione di un partecipante; invocarlo per guasti dei bot senza far partire rivalutazioni intermedie indesiderate durante il normale ridimensionamento del fill.

**Verifica:** errore dell'ultimo hunter e dell'ultimo prop durante hunting; controllare vincitore, timer e una sola registrazione delle statistiche.

### R8 · P2 · La CLI accetta quantità e difficoltà non finite

**Evidenza statica.** [parseArgs:61](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/index.ts:61) applica `Number`, `Math.floor`, `Math.max` e clamp senza controllare `Number.isFinite`.

- `--count Infinity` rende illimitato il ciclo di creazione.
- `--count abc` produce NaN e nessun bot, seguito da un messaggio fuorviante sul server.
- `--difficulty abc` propaga NaN al comportamento.
- Flag sconosciuti e valori mancanti sono ignorati o interpretati come valori del flag precedente.

**Intervento minimo:** parser numerico finito con vincoli distinti per count, ready-at e difficulty; errori espliciti per opzioni sconosciute o incomplete. Derivare l'elenco delle mappe supportate da `MAP_CATALOG`.

**Verifica:** parser puro con input validi, NaN, Infinity, negativi, decimali, valore mancante e flag sconosciuto. Nessuna connessione necessaria.

### R9 · P2 · Effetti collaterali negli updater React

**Evidenza statica.** [App.disconnect:64](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/ui/App.tsx:64) esegue `room.leave()` dentro `setConnection(prev => ...)`. [Lobby.toggleAudio:283](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/ui/Lobby.tsx:283) modifica storage e audio dentro l'updater dello stato.

Gli updater React devono essere puri; possono essere rivalutati. [Documentazione React](https://react.dev/reference/react/useState). Il bootstrap attuale non usa StrictMode, quindi non si afferma che oggi ogni click produca chiamate duplicate.

**Intervento minimo:** eseguire leave e aggiornamento audio nell'event handler o in un lifecycle con ownership esplicita, lasciando all'updater solo il calcolo dello stato. Gestire anche gli eventuali rifiuti delle promise di leave.

**Verifica:** uscita volontaria, errore di connessione e rimontaggio; una sola chiusura per room e assenza di effetti collaterali durante il render.

### R10 · P2 · Il deploy elimina i chunk che una lobby già aperta può ancora chiedere

**Evidenza statica; condizione operativa da riprodurre.** [App.tsx:23](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/ui/App.tsx:23) carica Game con import dinamico. [deploy.yml:97](/Users/davide/orca/workspaces/morphy.lol/bonnethead/.github/workflows/deploy.yml:97) pubblica con `rsync --delete` nella directory servita, eliminando i vecchi asset hashati. Una pagina aperta prima del deploy che non abbia ancora caricato Game può chiedere un chunk ormai eliminato. Non c'è un error boundary per il lazy import fallito.

**Intervento minimo:** conservare per un periodo i chunk delle release precedenti e pubblicare gli asset prima dell'entry point; preferire directory di release con switch atomico, assicurando comunque che i vecchi URL degli asset restino risolvibili. Aggiungere un recupero comprensibile per il caricamento fallito.

**Verifica:** aprire lobby della release A, pubblicare B con un chunk Game diverso, premere Play nella pagina A. Uno switch atomico da solo non risolve la retention degli asset della pagina già aperta.

### R11 · P3 · Gli effetti morph perdono la quota Y

**Evidenza statica.** [MorphFx:958](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:958) e `renderPosesRef` conservano solo x/z. [MorphEffects:1053](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:1053) posiziona fascio e frammenti rispetto al suolo, mentre i giocatori possono saltare o stare sopra gli oggetti. Il percorso dei decoy break conserva già y.

**Intervento minimo:** propagare y insieme a x/z e aggiungerla alle coordinate dei burst.

**Verifica:** cambio disguise in salto e sopra una superficie rialzata; effetto centrato sul giocatore.

## Dead code, leftovers e contratti da snellire

| Candidato | Evidenza e intervento |
| --- | --- |
| Metadati del vecchio raycast/prop picker | `LOCAL_AVATAR_KEY` e i due `userData` in [Scene.tsx:166](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:166), [1637](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:1637), [2093](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:2093) hanno scrittori ma nessun lettore nel codice applicativo. Rimuovere insieme; lo shooting corrente usa il raggio della camera e non interseca queste mesh. |
| CSS `.menu-locked` | [styles.css:809](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/styles.css:809): nessun riferimento nelle classi TSX o in generatori di nomi trovati. Eliminare i due selettori dopo un controllo della UI. Non eliminare in blocco `.lobby`: serve ancora a loading e DesktopGate. |
| `PathFollower.goal` | [path.ts:115](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/nav/path.ts:115): getter senza chiamanti. Rimuovibile; mantenere invece `hasPath`, usato dalla pianificazione. |
| `Room.name` nel builder station | [station.ts:22](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/maps/station.ts:22): nomi assegnati ma mai letti né serializzati. Rimuovere campo e valori o documentarne un uso effettivo. Gli id restano necessari per il floorplan. |
| Wrapper `afterRound` | [MorphyRoom.ts:889](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/rooms/MorphyRoom.ts:889): inoltra soltanto a `resetToLobby`. Pulizia facoltativa, nessun beneficio prestazionale significativo. |
| `KillReason = "shot"` | [protocol.ts:40](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/shared/src/protocol.ts:40): nessun producer attuale, che emette solo `self` o `converted`. Residuato del modello di eliminazione precedente; restringere il tipo e rendere esaustivo `killText` se non serve compatibilità con vecchi messaggi. |
| `ObservedMap.doorways` | [reflex.ts:209](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:209) estrae porte dai nomi GLB e [341](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:341) le copia a ogni osservazione. La policy non le legge; finiscono però nel trace serializzato. Rimuovere dal contratto runtime se non è richiesto conservarle per diagnostica, verificando gli eventuali consumatori esterni dei trace. Non confondere con le doorway dei builder/furnishing, realmente usate. |
| `ObservedSelf.canShootNow` | [reflex.ts:262](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:262): prodotto ma non consultato dalla policy; il cooldown è già applicato dal motore. È un campo diagnostico potenzialmente superfluo, non una funzione totalmente irraggiungibile. Stessa cautela sui trace. |
| `Observation.pathBlocked` | [agent.ts:114](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/shared/src/agent.ts:114): la policy non lo legge. Prima correggere R2: potrebbe diventare proprio il segnale necessario per scegliere un nuovo nascondiglio. Non cancellare il campo interno `Reflex.pathBlocked`, che è usato. |
| Tipi messaggio non applicati | `TeleportMessage`, `TauntMessage`, `ChatSend`, `ChatEvent`, `ShotResult`, `ReadyMessage` in [protocol.ts:78](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/shared/src/protocol.ts:78) sono esportati ma non usati dai producer. Preferibile applicare `satisfies` nei punti di invio, oppure eliminare tipi realmente superati; non mantenere un contratto soltanto nominale. |

La ricerca dei simboli non è una prova universale di inutilizzo esterno. I package sono privati, ma i trace possono essere letti fuori repository. TypeScript `noUnusedLocals` già attivo non trova necessariamente export inutilizzati, campi mai letti o selettori CSS.

### Documentazione da riallineare

- [AGENTS.md:78](/Users/davide/orca/workspaces/morphy.lol/bonnethead/AGENTS.md:78) descrive ancora un prop picker con E: ora R cambia disguise e Q/E ruotano.
- [AGENTS.md:111](/Users/davide/orca/workspaces/morphy.lol/bonnethead/AGENTS.md:111) descrive `characters/` come non collegata. I personaggi sono già usati come props da [urbanCatalog.ts:20](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/urbanCatalog.ts:20), pur non essendo avatar selezionabili.
- [protocol.ts:166](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/shared/src/protocol.ts:166) descrive matchmaking filtrato per mappa; il server usa intenzionalmente solo `sortBy`.
- [bot/README.md:28](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/README.md:28) sostiene che il default ready-at impedisca un avvio senza umani: l'autostart del server non dipende più da tutti-ready. Descrive inoltre trasformazioni/scelta del tipo che la policy non esegue.
- [ScriptedPolicy:36](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/policy/scripted.ts:36) e [Trace:14](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/trace.ts:14) parlano ancora di LLM/training futuro. Riscrivere intorno a bot di riempimento e diagnostica; il trace è effettivamente collegato alla CLI, quindi non va classificato automaticamente come codice morto.
- La CLI ha default `visibility: "full"` in [index.ts:72](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/index.ts:72), e il README non documenta `--visibility`, `--policy`, `--trace`. Per il normale uso con persone preferire limited, mantenendo full come opzione esplicita di misurazione. Il fill server è già limited.
- [collision.ts:65](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/collision.ts:65) dichiara collisioni uguali al client: il bot usa cerchi/AABB sul piano, il client OBB e quota. Documentare la semplificazione.
- [viteRuntimeAssets.ts:81](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/viteRuntimeAssets.ts:81) parla di potare solo GLB: il codice elimina ogni file non consentito sotto `dist/models`. Riallineare il commento alla regola effettiva e chiarire dove si distribuiscono le licenze.

## Ridondanze, costanti e organizzazione

### Centralizzare solo i valori con semantica comune

[Scene.tsx:83](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:83) e [bot/config.ts:6](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/config.ts:6) duplicano raggio corpo 0.4 e soglia furniture 0.3. Il raggio influenza collisioni e navigabilità: è un buon candidato per shared, con nome che esprima la semantica. Le soglie camera, intensità luci e livelli audio restano invece locali.

[urban.ts:178](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/maps/urban.ts:178) contiene 0.3 per distanza dagli edifici, 0.7 per frequenza dei pedoni, 1.2 per riserva spawn, 5 per separazione spawn e 3 passate. Estrarre questi valori con nomi di dominio renderebbe più sicuro il tuning. In particolare, [maps.test.mjs:29](/Users/davide/orca/workspaces/morphy.lol/bonnethead/tests/maps.test.mjs:29) ricopia 1.2 e 0.3: esplicitare se il test fissa un requisito minimo indipendente o deve leggere la configurazione.

Le dimensioni misurate dei GLB in `mars.ts` e `urban.ts`, le coordinate delle mappe authored, le frequenze musicali e i numeri geometrici come metà dimensione o π/2 sono dati contestualizzati: trasformarli tutti in costanti globali peggiorerebbe la leggibilità. Per i bounds dei modelli è più utile una futura verifica rispetto al GLB che un ulteriore livello di configurazione.

### Ridurre le copie di schema sul client

[types.ts:3](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/types.ts:3), `PlayerMeta`, `PLAYER_META_FIELDS`, la costruzione di `next` e `metaEqual` ripetono quasi lo stesso elenco. R1 mostra il rischio concreto di omissione.

Mantenere un tipo snapshot compatto e una lista di campi verificata dal compilatore; derivare la proiezione/equality o centralizzarla in una funzione. I tipi devono stare nel contratto condiviso se servono a entrambi i lati, senza importare classi server nel browser. Non serializzare tramite JSON a ogni patch.

`PartyMember` e `PartyMemberView` duplicano anch'essi la stessa forma. Un unico tipo UI evita deriva, ma non giustifica un framework generale.

### Estrarre responsabilità che permettano test utili

[Scene.tsx](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:1) ha 2.208 righe; [Game.tsx](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Game.tsx:1) 1.185; [MorphyRoom.ts](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/rooms/MorphyRoom.ts:1) 1.244. La dimensione da sola non è un bug.

L'estrazione con più ritorno è il movimento/collisioni da Scene: consente di verificare R5 senza WebGL. Seguono effetti visivi, rendering statico, sottoscrizioni della room e proiezione dei metadati. Nel server conviene estrarre validatori e funzioni pure di risoluzione geometrica, lasciando alla room l'ownership di timer e transizioni. Evitare una riscrittura simultanea della state machine e della struttura dei file.

## Ottimizzazioni da misurare

### O1 · Instancing dei props statici e cache del fitting

[MapView:1572](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:1572) raggruppa già i tile per modello, ma props e scenery usano cloni separati. [FittedModel:1363](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:1363) clona la scena e ricalcola il Box3 per istanza. Questo costa soprattutto in caricamento, mentre i mesh separati possono aumentare le draw call.

Conteggi reali delle mappe al seed 0, **non draw call misurate**:

| Mappa | Tile | Collider mappa | Props | Scenery |
| --- | ---: | ---: | ---: | ---: |
| station | 645 | 26 | 148 | 0 |
| mars | 75 | 87 | 56 | 96 |
| urban | 45 | 32 | 110 | 28 |

Candidato: cache di bounds/fitting per modello e instancing dei props statici compatibili, separando i personaggi dinamici. Non riusare ciecamente `firstMesh` dei tile per scenery multi-mesh: si perderebbero parti del modello e trasformazioni dei nodi.

[InstancedTiles:1448](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:1448) disabilita il frustum culling: valutare gruppi spaziali e bounds corretti solo se la misura mostra un costo significativo. Non basta rimuovere il flag senza calcolare i bounds delle istanze.

Misurare `renderer.info.render.calls`, triangoli, tempi CPU/GPU e frame p95 nelle tre mappe su hardware rappresentativo, mantenendo lo stesso DPR e camera. Il riuso degli oggetti è coerente con le [indicazioni R3F](https://r3f.docs.pmnd.rs/advanced/pitfalls).

### O2 · Coalescere i metadati per patch

[Game.syncPlayerMeta:526](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Game.tsx:526) ricostruisce tutti i giocatori a ogni modifica di uno dei 12 campi osservati. Con molti campi cambiati durante l'assegnazione ruoli si ripetono copie ed equality check prima che React raggruppi i render.

Candidato: aggiornare soltanto il giocatore cambiato, oppure marcare dirty e produrre un unico snapshot per patch. Mantenere sottoscrizioni e controlli di uguaglianza, senza reintrodurre polling delle posizioni.

Con massimo 12 giocatori il costo può essere modesto: usare React Profiler e contatori delle proiezioni durante assegnazione ruoli/ping prima di introdurre nuove astrazioni.

### O3 · Precalcolo delle AABB e dati statici dei bot

[rayAabb](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/shared/src/geometry.ts:6) crea quattro array per chiamata; `colliderAabb` crea due vettori a ogni conversione. [resolvePellet](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/rooms/MorphyRoom.ts:632) e le funzioni di vista del bot ripetono conversioni su collider invarianti. [detectLineOfSightGain](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/driver.ts:223) verifica i contatti ogni tick.

Primo intervento candidato: precalcolare le AABB quando si applica la mappa e riutilizzarle; solo dopo misurazione considerare una struttura spaziale. Conservare equivalenza del raycast e priorità delle intersezioni.

Ogni bot ricostruisce la griglia statica in [Reflex.setMap:200](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:200). Su questa macchina, Node 22, seed 0, mediana di 12 chiamate successive a `buildNavGrid` con muri/ostacoli già costruiti:

| Mappa | Tempo indicativo per griglia |
| --- | ---: |
| station | 0.97 ms |
| mars | 1.62 ms |
| urban | 1.23 ms |

È una micro-misura locale senza benchmark isolato, non una stima di latenza in produzione. Con tre bot di riempimento non giustifica da sola una cache globale. Se servisse, condividere dati immutabili per istanza di mappa, non solo per mapId: seed diversi cambiano gli ostacoli.

[executeIntent:370](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/reflex.ts:370) copia gli ostacoli statici a ogni tick anche senza decoy. Un ramo che riusa `this.obstacles` quando non ce ne sono è una semplificazione economica; verificare che nessun consumer muti l'array.

### O4 · Togliere letture SQLite inutili prima di cambiare architettura

[recordRound:91](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/stats/repository.ts:91) esegue UPSERT e poi SELECT. Il chiamante in [MorphyRoom:882](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/server/src/rooms/MorphyRoom.ts:882) ignora il valore restituito. Una firma `void`, se confermata per tutti i consumatori, evita una query per partecipante; adeguare il test che usa il ritorno o leggere esplicitamente con `get`.

Più partecipanti producono scritture separate durante `endRound`. `DatabaseSync` esegue operazioni sincrone, come documentato da [Node.js](https://nodejs.org/api/sqlite.html#class-databasesync). Misurare durata del batch ed event-loop delay su Node 24 e disco rappresentativo. Una transazione per round può ridurre il costo, ma cambia la semantica best-effort per giocatore: decidere come isolare un record fallito.

Non emerge evidenza per migrare a Postgres o introdurre subito worker thread. Il singleton creato all'import rende però più difficili test e riuso: separare classe repository e composizione del singleton nell'entry point riduce gli effetti collaterali degli import.

### O5 · Riutilizzare il build già validato in CI

[ci.yml](/Users/davide/orca/workspaces/morphy.lol/bonnethead/.github/workflows/ci.yml:1) costruisce il client e [deploy.yml:70](/Users/davide/orca/workspaces/morphy.lol/bonnethead/.github/workflows/deploy.yml:70) lo ricostruisce in un altro job. Pubblicare/scaricare l'artefatto del build validato riduce lavoro duplicato e collega verifica e distribuzione agli stessi byte.

Il [Dockerfile](/Users/davide/orca/workspaces/morphy.lol/bonnethead/docker/server.Dockerfile:1) copia tutto il contesto prima di installare: ogni cambiamento invalida il layer di installazione, pur con store cache. Valutare uno stadio basato su manifest/lockfile e un'immagine contenente solo il grafo server/bot/shared. `tsx` è il runtime attuale: non togliere indiscriminatamente tutte le devDependencies prima di averlo collocato correttamente o introdotto una compilazione.

Misurare tempi e dimensione immagine; nessun dato di miglioramento è stato raccolto.

## Altri casi da verificare nel prossimo ciclo

- **Input e focus:** [useControls.ts:50](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/useControls.ts:50) non azzera i tasti su blur/visibilitychange e rappresenta ogni azione con un solo booleano: W + ArrowUp, poi rilascio di uno, può fermare l'azione mentre l'altro resta premuto. Gestire un set di codici premuti e svuotarlo alla perdita di focus. Inoltre [Game.tsx:896](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Game.tsx:896) non include `controlsOpen` nel blocco input: verificare se il dialog deve sospendere i comandi.
- **Orologio HUD:** [Countdown:400](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Game.tsx:400) e RingTimer sottraggono l'orologio locale da una scadenza calcolata sul server. Su macchine LAN con clock diversi il timer mostrato diverge, pur restando corretta la transizione server. Verifica minima con offset simulato di ±60 secondi; se rilevante, stimare un offset server/client.
- **Caricamenti falliti:** Suspense gestisce l'attesa, ma in App/Game manca un percorso di recupero per errori di caricamento. `parseMapDefinition` può inoltre lanciare nel callback del messaggio in [Game.tsx:749](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Game.tsx:749). Verificare GLB indisponibile e mappa malformata, mostrando un errore recuperabile.
- **Avatar remoti:** [RemotePlayer:2161](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/client/src/game/Scene.tsx:2161) interpola una mesh appena montata dall'origine (0,0,0) verso lo spawn. Inizializzare dalla prima posa valida evita l'ingresso “in volo”; mantenere smoothing per gli aggiornamenti successivi.
- **Contratti numerici:** [parseMapDefinition](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/shared/src/map.ts:212) accetta parti vuote nei props e un catalogo vuoto; oggi i builder non li emettono. Valutare invarianti più strette per mappe effettivamente giocabili. Non classificare i fixture con catalogo vuoto come bug del gioco.
- **Navigazione dinamica:** i decoy entrano nella collisione bot ma non nella griglia A*. Un passaggio bloccato può essere ripianificato identicamente. Dopo R2, verificare un corridoio chiuso da decoy prima di scegliere tra overlay dinamico e reazione locale.
- **Trace CLI:** [Trace.write:54](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/trace.ts:54) non tratta backpressure; [main:190](/Users/davide/orca/workspaces/morphy.lol/bonnethead/packages/bot/src/index.ts:190) non chiude esplicitamente il trace di un bot che fallisce la connessione mentre altri restano attivi. Rilevanza limitata alla CLI con tracing; introdurre cleanup e un limite ai dati accodati solo conservando il comportamento diagnostico desiderato.

## Cosa mantenere e falsi positivi esclusi

- Movimento client-side e schema pubblico sono compromessi deliberati: questa review non propone di riaprire l'anti-cheat.
- Non introdurre `filterBy(["map"])`: frammenterebbe il matchmaking.
- Conservare `onUncaughtException`, la validazione dei payload, la riconnessione con una nuova room client e il cleanup delle risorse risolte dopo timeout.
- Conservare il confine `@morphy/bot/brain`. Non aggiungere infrastruttura LLM.
- `express` e `@colyseus/better-call` non vanno rimossi perché manca un import applicativo diretto: compaiono nei peer dependency di `@colyseus/core` installato e fanno parte del setup HTTP.
- Gli asset non usati in `public` non equivalgono automaticamente a bytes spediti: il plugin applica già una allow-list. Non cancellare `characters/`, texture esterne o kit interi basandosi sul solo testo di AGENTS.md.
- La migrazione `webhunt:` è compatibilità per storage esistente, non dead code dimostrato. La rimozione richiede una politica sul supporto dei vecchi client.
- Non sostituire le ref delle posizioni con setState per frame. L'architettura attuale evita già questo anti-pattern.
- Il sospetto che station protegga soltanto il primo spawn di ogni stanza è stato verificato contro i props con collisione OBB: **nessuna sovrapposizione rilevata nei seed 0–999**, con raggio corpo 0.4 e step height 0.35. Non viene promosso a bug; non è una prova per tutti i seed o per asset futuri.
- Non si è dimostrato un leak GPU dovuto ai cloni GLTF. Non aggiungere `dispose()` indiscriminati su geometrie/materiali condivisi dal loader.
- Non servono costanti nominate per ogni numero, memoizzazione per ogni componente o un nuovo package per ogni helper.

## Sequenza di intervento proposta

1. **Correttezza:** R1–R4, con regressioni mirate su sincronizzazione arma, fallimento path e confine percettivo.
2. **Stabilità del gameplay:** R5–R7; estrarre solo la parte di movimento necessaria ai test.
3. **Robustezza dei confini:** R8–R10 e gestione dei caricamenti falliti.
4. **Pulizia separata:** metadati raycast, getter, CSS, commenti, contratti e numeri di tuning; R11 con verifica visiva.
5. **Profiling:** O1–O5, scegliendo le modifiche in base a misure sul runtime supportato. Iniziare dalle eliminazioni di lavoro evidente prima delle strutture più complesse.

Per le future modifiche di codice eseguire i quattro gate del repository su Node 24: `pnpm check:ci`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @morphy/client build`. I casi React/WebGL/reconnect richiedono inoltre una verifica nel browser: la suite attuale non copre questi percorsi end-to-end.

## Riprodurre le diagnostiche principali senza scrivere file

Dalla root, con le dipendenze già presenti, il seguente script esercita i moduli reali. Non avvia server, non apre socket e non crea database.

```bash
node --import tsx --input-type=module <<'JS'
import { Reflex } from './packages/bot/src/reflex.ts';

const makeMap = (wall, extent = 20) => ({
  id: 'review-fixture',
  bounds: {
    min: { x: -extent, y: 0, z: -extent },
    max: { x: extent, y: 10, z: extent },
  },
  spawnPoints: { props: [{ x: 0, y: 0, z: 0 }] },
  colliders: [wall], props: [], tiles: [], scenery: [], propCatalog: [],
});
const player = (id, x, z) => ({
  id, name: id, x, y: 0, z, rot: 0, aim: 0,
  role: 'hunter', alive: true, hp: 100, kills: 0, propType: '', ready: true,
});
const ready = (map, x = 0) => {
  const reflex = new Reflex(0.6, 'limited');
  reflex.setMap(map);
  reflex.syncPosition(x, 0);
  return reflex;
};

// R2: destinazione separata da un muro senza passaggi.
const closedMap = makeMap({
  position: { x: 0, y: 2, z: 0 }, size: { x: 1, y: 4, z: 20 },
}, 10);
const blocked = ready(closedMap, -5);
const hideWorld = {
  phase: 'hiding',
  self: { ...player('self', -5, 0), role: 'prop', propType: 'crate' },
  others: [], decoys: [],
};
for (const t of [1000, 2000, 3000]) {
  blocked.executeIntent({ kind: 'hideAs', seq: 1, x: 5, z: 0 }, hideWorld, 0.05, t);
  console.log('R2', t, {
    x: blocked.x, z: blocked.z,
    blocked: blocked.buildObservation(hideWorld, 1, t).pathBlocked,
    arrived: blocked.consumeArrivalEvent(),
  });
}

// R4: due osservazioni ravvicinate, nessuno spostamento.
const soundMap = makeMap({
  position: { x: 5.2, y: 2, z: 0 }, size: { x: 0.4, y: 4, z: 12 },
});
const listener = ready(soundMap);
const world = {
  phase: 'hunting', self: player('self', 0, 0),
  others: [{ ...player('target', 5.9, 1.9), role: 'prop', propType: 'crate' }],
  decoys: [],
};
for (const [seq, t] of [1000, 1200, 1700].entries()) {
  console.log('R4', t, listener.buildObservation(world, seq, t).entities);
}

// R3: un intento preesistente continua a leggere un bersaglio non percepito.
const occludedMap = makeMap({
  position: { x: 5, y: 2, z: 0 }, size: { x: 1, y: 4, z: 40 },
});
world.others[0].x = 16;
world.others[0].z = 3;
for (const kind of ['shootTarget', 'inspect']) {
  const motor = ready(occludedMap);
  const observation = motor.buildObservation(world, 1, 1000);
  motor.executeIntent({ kind, targetId: 'target', seq: 1 }, world, 0.05, 1050);
  // Ispezione diagnostica del campo private TS; non è un'API applicativa.
  console.log('R3', kind, { entities: observation.entities, pathGoal: motor.pathGoal });
}
JS
```

## Validazione indipendente (16 settembre 2026)

Seconda lettura condotta su `58e954b` rideriva ogni rilievo dal codice, senza assumere valide le
conclusioni della prima stesura. Le tre diagnostiche marcate "riprodotto" sono state rieseguite e
producono un output identico a quello documentato.

**Esito: gli undici rilievi sono confermati e non emergono falsi positivi.** Ogni voce della tabella
dead code è stata verificata cercandone i lettori: `LOCAL_AVATAR_KEY` e i due `userData` hanno
scrittori e nessun lettore, `.menu-locked` compare solo nel CSS, `PathFollower.goal` non ha
chiamanti, `afterRound` inoltra soltanto a `resetToLobby`, `KillReason = "shot"` non ha producer, e i
sei tipi messaggio di `protocol.ts` non compaiono altrove. Anche i rilievi documentali reggono: `KeyE`
è `turnRight` mentre `KeyR` invia `MSG_REROLL`, e `characters/` è realmente collegata tramite
`ch()` → `boxProp("characters", …)` in `urbanCatalog.ts`, contro quanto afferma AGENTS.md:111.

### Correzioni alla review

**La premessa sull'ambiente non vale.** Il worktree espone Node **24.14.0**, non 22.22.3: la riserva
dichiarata in "Metodo, verifiche e limiti" decade. I due gate rimasti fuori sono stati eseguiti sul
runtime previsto, insieme agli altri due: `pnpm check:ci` (100 file), `pnpm typecheck` (quattro
package), `pnpm test` (**35 test superati**) e `pnpm --filter @morphy/client build`. Nessun gate
falliva.

**Manca il rilievo prestazionale di maggiore impatto: il code splitting non separa il motore 3D.**
Il bundle di produzione produce `dist/assets/index-*.js` da **1.432 kB (412 kB gzip)** contenente
`THREE.WebGLRenderer`, `GLTFLoader`, `InstancedMesh` e `react-three`, mentre il chunk `Game`
caricato in `lazy` pesa **48 kB**. Lo split di rotta descritto in AGENTS.md non rinvia quindi quasi
nulla: l'intero stack 3D viene scaricato già nel menu. La sezione O1–O2 analizza draw call e
proiezioni React senza mai esaminare la composizione del bundle. L'intervento è di sola
configurazione di build e precede per rapporto costo/beneficio l'instancing dei props.

**Due severità sono sovrastimate.** In entrambi i casi la review dichiara già il limite; è
l'etichetta a non seguirlo.

- **R3** è circoscritto a un ciclo di decisione. La policy è priva di stato e legge solo
  `obs.entities`, quindi torna a `patrol` non appena il contatto esce dall'osservazione: la finestra
  di inseguimento su posizione esatta è ≤ `DECIDE_INTERVAL_MS` (700 ms), non un wallhack persistente.
  Resta una deviazione reale dal contratto informativo (`runShoot:579` pianifica sulle coordinate
  vere senza alcun gate di vista, mentre `runApproach` almeno quantizza), ma sotto R1 e R2.
- **R9** è latente. Senza StrictMode gli updater non vengono rivalutati: è igiene, non un difetto
  osservabile oggi.

**R2 è più grave di come è descritto e assorbe una riga della tabella dead code.** Poiché `settle()`
imposta `settled = true` e `runStatic` esce subito quando è settled, `ensurePath` non viene più
invocata: `replanCount` resta fermo a 1 e non può raggiungere `MAX_REPLANS_BEFORE_BLOCKED = 2`. Su
`hideAs` e `moveTo` il campo `Observation.pathBlocked` non è quindi soltanto "non letto dalla
policy", è **irraggiungibile**. Le due voci sono lo stesso difetto.

### Rilievo da promuovere

La CLI imposta `visibility: "full"` come default in `packages/bot/src/index.ts:72`, mentre il fill
del server usa `"limited"`. Chi lancia `pnpm bot` per riempire una stanza con altre persone ottiene
bot onniscienti senza averlo chiesto. La review lo cita fra le note documentali: rispetto al
contratto di equità dichiarato in AGENTS.md merita un rilievo P2 a sé.

### Ordine di intervento adottato

R1 e R2 per primi, un branch ciascuno: sono autonomi, visibili all'utente e verificabili con
`node:test` senza browser. Seguono la coppia di equità (R3 più il default `--visibility`), che tocca
lo stesso contratto e sta in un unico branch, e poi R5 insieme all'estrazione del movimento in
funzione pura, che è ciò che lo rende testabile.
