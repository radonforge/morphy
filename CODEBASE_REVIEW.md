# morphy.lol — Codebase review e registro di remediation

Data della review: 2026-07-21  
Scope revisionato: `packages/shared`, `packages/server`, `packages/client`, `packages/bot`, test, asset pubblici, Docker, nginx e GitHub Actions.

## Executive summary

morphy.lol è un prop hunt multiplayer browser, LAN-first ma predisposto anche al deploy remoto. Il client usa React 19, React Three Fiber 9 e Three.js 0.184; il server usa Colyseus 0.17 e SQLite; il workspace include tre generatori procedurali di mappe, party privati, statistiche persistenti e bot headless.

La review iniziale ha registrato 29 finding; durante la remediation ne sono emersi altri 2. Non sono stati rilevati P0 certi. Stato finale delle 31 voci:

- 28 `FIXED`.
- 2 a stato misto: REV-002 (`FIXED / ACCEPTED`) e REV-029 (`FIXED / DEFERRED`).
- 1 `DEFERRED`: REV-028, refactoring strutturale non necessario a correggere il comportamento e rischioso senza visual-regression test.
- 0 `OPEN`.

I cambiamenti funzionali sono coperti da 20 test automatici. Biome, TypeScript, test, build client, smoke test HTTP/WebSocket e build/smoke Docker su Node 24 risultano superati.

## Scope e architettura validati

- `packages/shared`: protocollo di rete, schema degli agent, cataloghi, validatori, geometria e utility pure condivise.
- `packages/server`: room Colyseus, state machine delle partite, raycast autorevole, statistiche SQLite e generatori delle mappe.
- `packages/client`: lobby React/Three, partita, networking Colyseus, audio, preferenze e pipeline Vite degli asset.
- `packages/bot`: client headless, scheduler policy, percezione, navigazione e mira.
- Infrastruttura: CI GitHub Actions, deploy via immagini container, nginx e Docker Node 24.

Il movimento resta intenzionalmente client-authoritative per il compromesso LAN dichiarato dal progetto. Colpi, cooldown, danno, ruoli e win condition sono invece server-authoritative.

## P1 — alta priorità

### REV-001 — Validazione delle armi aggirabile tramite prototype chain

- Stato: **FIXED**
- Evidenza iniziale: `isWeaponId()` usava `value in WEAPONS`; valori come `toString` e `constructor` superavano il guard.
- Remediation: validazione own-property tramite `Object.hasOwn()` in `packages/shared/src/weapons.ts`.
- Verifica: regression test su proprietà ereditate e ID validi.

### REV-002 — Movimento client-authoritative e origine del colpo manipolabile

- Stato: **FIXED / ACCEPTED**
- Evidenza iniziale: il server accettava dal client l'origine del raycast con uno slack di 3 unità, sufficiente ad attraversare pareti modulari spesse 1. Il movimento non valida velocità o collisioni.
- Remediation: `ShootMessage` contiene soltanto la direzione; il server deriva sempre l'origine dalla posizione server-side del player più `PLAYER_EYE_HEIGHT`. Client e bot sono stati riallineati.
- Verifica: integration test che invia un payload con origine malevola e conferma che non possa colpire attraverso il muro.
- Decisione esplicita: il movimento permissivo resta **ACCEPTED**, perché è un compromesso LAN documentato in `SPEC.md`; il limite di sicurezza è ora dichiarato e separato dal bug del raycast.

### REV-003 — Join durante un round altera la composizione della partita

- Stato: **FIXED**
- Evidenza iniziale: `onJoin()` non controllava `state.phase`; il nuovo player entrava vivo nella win condition ma non nel roster del round.
- Remediation: phase guard con errore 409 fuori dalla lobby, lock della room all'avvio del countdown e unlock al reset.
- Verifica: integration test di join durante `hiding` rifiutato senza alterare lo stato.

### REV-004 — Le disconnessioni non rivalutano la fine del round

- Stato: **FIXED**
- Evidenza iniziale: `onLeave()` rimuoveva il player senza chiamare `checkRoundEnd()`.
- Remediation: la win condition viene rivalutata subito dopo la rimozione, salvo il reset a lobby per player insufficienti.
- Verifica: integration test in cui l'ultimo prop lascia la room e gli hunter vincono immediatamente.

### REV-005 — Cache immutable su asset non versionati

- Stato: **FIXED**
- Evidenza iniziale: nginx assegnava un anno di cache `immutable` a `/models/` e `/sounds/`, pur mantenendo URL stabili tra i deploy.
- Remediation: questi path usano ora `max-age=0, must-revalidate`; gli asset hashed di Vite mantengono la cache lunga.
- Verifica: configurazione nginx riesaminata distinguendo asset content-hashed e asset a nome stabile.

## P2 — priorità media

### REV-006 — Race tra deploy concorrenti e tag `latest`

- Stato: **FIXED**
- Evidenza iniziale: deploy di produzione senza concurrency e consumo del tag mutabile `latest`.
- Remediation: concurrency sul workflow di produzione e passaggio dell'esatto SHA al deploy. `latest` resta soltanto un alias pubblicato.
- Verifica: workflow producer/consumer riallineati sul medesimo identificatore immutabile.

### REV-007 — Spawn urban sovrapposti ai prop statici

- Stato: **FIXED**
- Evidenza iniziale: 784 seed su 1.000 producevano almeno uno spawn sovrapposto, per 1.431 collisioni complessive.
- Remediation: il clearance test degli spawn include anche tutti i prop statici già posizionati.
- Verifica: 1.000 seed urban validati senza sovrapposizioni; parsing e determinismo verificati su 1.000 seed per ciascuna delle tre mappe.

### REV-008 — Timeout di connessione lascia room tardive senza owner

- Stato: **FIXED**
- Evidenza iniziale: gli helper client e bot rigettavano sul timeout senza gestire una `join/create` risolta successivamente.
- Remediation: unico `withTimeout()` in `packages/shared/src/async.ts`, con cleanup delle late resolution; client e bot eseguono `room.leave()` sulle room tardive.
- Verifica: unit test della risoluzione successiva al timeout e del relativo cleanup.

### REV-009 — Endpoint statistiche incompatibile con `VITE_SERVER_URL`

- Stato: **FIXED**
- Evidenza iniziale: Colyseus usava `VITE_SERVER_URL`, mentre `/stats` era sempre richiesto su `window.location.origin`.
- Remediation: helper unico in `packages/client/src/net/endpoints.ts` converte in modo validato `ws/wss` in `http/https` e costruisce l'endpoint statistiche.
- Verifica: test su URL relativi, HTTP, HTTPS, WS e WSS; smoke test reale di `/stats`.

### REV-010 — Cooldown client/server divergente dopo il cambio arma

- Stato: **FIXED**
- Evidenza iniziale: il client ricalcolava il cooldown storico usando l'arma corrente, mentre il server conservava il cooldown assoluto dell'arma che aveva sparato.
- Remediation: il client conserva `nextShotAt`, come il server.
- Verifica: la finestra di fuoco non viene più accorciata passando da shotgun a pistol.

### REV-011 — Fallback `localStorage` non sicuro

- Stato: **FIXED**
- Evidenza iniziale: accesso o scrittura potevano sollevare `SecurityError`/`QuotaExceededError` già durante l'import.
- Remediation: adapter unico `safeStorage` con accesso protetto e fallback in-memory, usato da device ID, preferenze e audio.
- Verifica: test con getter, lettura e scrittura che lanciano; la sessione continua usando il fallback.

### REV-012 — Timeout delle policy bot non effettivo

- Stato: **FIXED**
- Evidenza iniziale: `abort()` non liberava `decideInFlight` quando la policy ignorava `AbortSignal`.
- Remediation: race esplicita tramite l'helper timeout, invalidazione della sequence e rilascio single-flight; anche i throw sincroni vengono normalizzati.
- Verifica: test con Promise che non si risolve e policy che lancia sincronicamente.

### REV-013 — Geometria/percezione bot divergente dal server e dal client

- Stato: **FIXED**
- Evidenza iniziale: LOS e mira ignoravano `other.y`; la navigazione ignorava i decoy, che sul client sono collider.
- Remediation: mira e raycast propagano l'altezza effettiva; i decoy entrano tra gli ostacoli dinamici.
- Verifica: test su target airborne e su occlusione/collider.

### REV-014 — Bundle iniziale e preload eccessivi

- Stato: **FIXED**
- Evidenza iniziale: singolo chunk da 1.471,67 kB minificato / 424,17 kB gzip e preload in lobby di 43 GLB appartenenti a tutte le mappe.
- Remediation: route `Game` caricata con `React.lazy`; rimosso il preload globale dei diorami; catalogo lobby estratto.
- Risultato: chunk iniziale 1.429,69 kB / 411,66 kB gzip e chunk `Game` separato 46,56 kB / 15,65 kB gzip. Resta il warning Vite oltre 500 kB perché la lobby usa direttamente React Three Fiber/Three; non è un errore di build.

### REV-015 — Asset pubblici inutilizzati o sovradimensionati

- Stato: **FIXED**
- Evidenza iniziale: 558 GLB nel sorgente, molti non raggiungibili dai cataloghi o dai generatori runtime; due PNG sorgente da circa 0,58 MB ciascuno finivano nel deploy.
- Remediation: manifest derivato dalle source of truth runtime; plugin Vite che valida l'esistenza dei GLB, analizza il JSON chunk e include le dipendenze esterne, quindi rimuove dal solo `dist` gli asset estranei. La lobby riusa `icon-192.png`; i file sorgente e le licenze non vengono eliminati.
- Risultato: `public` 603 file / 38.097.744 byte; `dist` 178 file / 20.759.849 byte. `public/models` 569 file / 29.254.854 byte; `dist/models` 144 file / 11.583.406 byte, composti da 135 GLB runtime e 9 texture esterne validate. Risparmio modelli: 17.671.448 byte.
- Verifica: test del manifest e delle dipendenze GLB, production build e richieste HTTP reali a un GLB e alla sua texture esterna.

### REV-016 — Assenza di test automatici

- Stato: **FIXED**
- Evidenza iniziale: nessun test; CI limitata a Biome e TypeScript.
- Remediation: suite Node/tsx con 20 test su validatori, geometria, mappe, asset, storage, endpoint, bot scheduler/raycast, lifecycle room, autorità del colpo e statistiche SQLite. La CI esegue ora test e production build.
- Verifica: 20/20 test superati.

## P3 — ridondanze, dead code e robustezza

### REV-017 — `withTimeout` duplicato fra client e bot

- Stato: **FIXED**
- Remediation: helper condiviso in `packages/shared/src/async.ts`, con normalizzazione del timeout e cleanup opzionale delle risoluzioni tardive.

### REV-018 — Geometria ray/AABB duplicata fra server e bot

- Stato: **FIXED**
- Remediation: `rayAabb()` e `colliderAabb()` sono primitive pure condivise in `packages/shared/src/geometry.ts`; server e bot usano la stessa implementazione.
- Verifica: test geometrici comuni.

### REV-019 — Temi grafici duplicati

- Stato: **FIXED**
- Remediation: base theme condiviso in `packages/client/src/theme.ts`, con override espliciti per lobby e partita.

### REV-020 — `MapDefinition.name` payload ridondante

- Stato: **FIXED**
- Evidenza iniziale: il campo era validato e trasmesso ma nessun consumer lo leggeva; il nome esiste già in `MAP_CATALOG`.
- Remediation: campo rimosso dallo schema e dai generatori; il catalogo resta la source of truth.

### REV-021 — Intent bot `taunt` e `hideType` non operativi

- Stato: **FIXED**
- Evidenza iniziale: `taunt` era un no-op e `hideType` non raggiungeva `hideAs`.
- Remediation: rimossi intent e stato morti; eliminata anche la ripetizione del messaggio vocale invariato.

### REV-022 — Bounding sphere calcolata ma frustum culling disabilitato

- Stato: **FIXED**
- Remediation: rimosso il calcolo inutile quando `frustumCulled={false}`.

### REV-023 — Validator mappe accetta numeri non finiti

- Stato: **FIXED**
- Remediation: guard `Number.isFinite` e invarianti semantiche per bounds, scale, collider, spawn e duplicati.
- Verifica: test con `NaN`, `Infinity`, dimensioni non positive, coordinate fuori bounds e spawn duplicati.

### REV-024 — Parser agent trasforma tipi booleani errati in `false`

- Stato: **FIXED**
- Remediation: i booleani richiesti devono essere realmente booleani; valori di tipo errato vengono rifiutati.
- Verifica: boundary test sui payload agent.

### REV-025 — Lobby music non ritenta dopo alcuni errori

- Stato: **FIXED**
- Remediation: lo stato `wanted` viene ripristinato dopo errori di inizializzazione, caricamento o playback, consentendo un retry coerente.

### REV-026 — Timer kill-feed non cancellati all'unmount

- Stato: **FIXED**
- Remediation: gli handle sono registrati e cancellati nel cleanup del componente.

### REV-027 — Poll React duplicati ogni 200 ms

- Stato: **FIXED**
- Remediation: `Game` e `usePartyRoom` usano le callback granulari ufficiali Colyseus (`Callbacks.listen`/`onAdd`) per root state e metadata; gli unsubscriber annidati vengono ripuliti. Le posizioni ad alta frequenza restano fuori dallo state React.
- Verifica: smoke test reale con due client Colyseus; osservati add iniziale, secondo join e modifica del nome tramite callback annidata.

### REV-028 — Moduli eccessivamente accentrati

- Stato: **DEFERRED**
- Evidenza iniziale: `Scene.tsx`, `styles.css`, `Game.tsx`, `MorphyRoom.ts` e `reflex.ts` concentrano molte responsabilità.
- Miglioramento già eseguito: estratti async, geometria, theme, endpoint, storage, manifest asset e cataloghi diorama; lazy boundary tra lobby e gioco.
- Motivo del defer: lo split ulteriore è un refactoring strutturale senza correzione comportamentale. Eseguirlo in questa remediation, senza visual-regression harness, aumenterebbe il rischio di regressioni in rendering e gameplay. Va affrontato per slice coperte da test visivi, non come riscrittura unica.

### REV-029 — Documentazione incoerente

- Stato: **FIXED / DEFERRED**
- Remediation: `README.md` e `SPEC.md` sono stati riallineati a Node 24/pnpm 11, gate CI, controlli, protocollo, state machine, asset e deploy attuali.
- Defer esplicito: `AGENTS.md` era un file non tracciato preesistente dell'utente; è stato intenzionalmente lasciato invariato per non sovrascrivere contenuto non appartenente alla remediation. Anche `CLAUDE.md`, già modificato dall'utente, non è stato toccato dalla review.

## Finding emersi durante la remediation

### REV-030 — `crypto.randomUUID()` non disponibile su HTTP LAN non sicuro

- Stato: **FIXED**
- Evidenza: secondo MDN `randomUUID()` è limitato ai secure context, mentre il progetto documenta accesso LAN via HTTP.
- Remediation: generazione UUID v4 con `randomUUID()` quando disponibile, fallback a `crypto.getRandomValues()` — disponibile anche negli insecure context — e ultimo fallback compatibile per browser legacy. Gli accessi restano protetti dal safe storage.
- Verifica: test che simula il rifiuto di `randomUUID()` e valida formato/versione/variant dell'UUID generato.

### REV-031 — Range visivo del bot divergente dall'arma predefinita

- Stato: **FIXED**
- Evidenza: percezione/raycast usavano la costante storica `SHOOT_RANGE = 50`, mentre la pistol predefinita ha range 30.
- Remediation: il bot deriva il range da `WEAPONS[DEFAULT_WEAPON].range`; rimossa la costante duplicata.
- Verifica: typecheck e test del raycast bot usano la stessa source of truth delle armi.

## Validazione finale

| Gate | Esito | Evidenza |
|---|---:|---|
| `pnpm check` | PASS | Biome, 88 file |
| `pnpm typecheck` | PASS | shared, server, client, bot; incluse le configurazioni Vite |
| `pnpm test` | PASS | 20 test, 0 failure |
| `pnpm --filter @morphy/client build` | PASS | build Vite 8 e pruning/validazione asset |
| `git diff --check` | PASS | nessun whitespace error |
| Smoke HTTP locale | PASS | `/`, `/stats`, GLB e texture esterna |
| Smoke WebSocket | PASS | due client, join e callback schema granulari |
| Docker build | PASS | `node:24-slim`, install pnpm frozen-lockfile |
| Docker runtime | PASS | Node v24.18.0, server in ascolto, `/stats` valido |

Nota ambiente: l'host della review usa Node v22.22.3 e quindi pnpm mostra correttamente il warning rispetto all'engine `>=24`. La build e lo smoke Docker hanno validato il runtime dichiarato dal progetto su Node v24.18.0.

## Limiti residui dichiarati

- Non è stata eseguita una visual-regression automatica basata su screenshot. Rendering e asset sono stati verificati tramite typecheck, production build, parsing delle dipendenze GLB e smoke HTTP; un futuro refactoring grafico ampio deve aggiungere questo gate.
- Il warning Vite per il chunk iniziale oltre 500 kB rimane: la lobby 3D carica Three/React Three Fiber. È un'opportunità di ottimizzazione ulteriore, non un errore funzionale o di build.
- Il movimento client-authoritative resta un rischio accettato per lo scope LAN. Un eventuale deployment competitivo pubblico richiederebbe simulazione/collisioni autorevoli server-side e non è una patch locale.

## Riferimenti ufficiali consultati

Le fonti sono state selezionate in coerenza con le versioni dichiarate nei manifest (`@colyseus/*` 0.17, Vite 8, pnpm 11, Node 24):

- [Colyseus 0.17 — room lifecycle](https://docs.colyseus.io/room)
- [Colyseus — locking e matchmaking](https://docs.colyseus.io/concepts)
- [Colyseus — deny player join](https://docs.colyseus.io/recipes/deny-player-join-a-room)
- [Colyseus SDK — state callbacks](https://docs.colyseus.io/state/callbacks)
- [Vite 8 — config loading e `--configLoader runner`](https://vite.dev/config/)
- [Vite — static asset handling](https://vite.dev/guide/assets)
- [Drei — `useGLTF`](https://drei.docs.pmnd.rs/loaders/gltf-use-gltf)
- [pnpm 11 — install](https://pnpm.io/cli/install)
- [Node.js 24 — SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [GitHub Actions — deployment concurrency](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
- [MDN — `localStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [MDN — `Crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
- [MDN — `Crypto.getRandomValues()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)
- [MDN — `Cache-Control`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
