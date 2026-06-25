# webhunt.lol — Spec di progetto

> Prop hunt multiplayer da browser. Si parte LAN-first (un collega ospita, gli altri si connettono; cloud-ready con lo stesso codice). 3D low-poly, semplice ma curato. Tema: **stazione spaziale su Marte**.

## 1. Visione

Ci si nasconde mimetizzandosi tra gli oggetti di una scena 3D (i **prop**), mentre i **cacciatori** li stanano. Il fascino sta nel mimetismo spaziale e nella deduzione, non negli asset.

L'estetica è low-poly basata sui kit **Kenney** (modelli glTF con texture flat a colormap), con buona luce e palette pulita: interni di una stazione spaziale generata proceduralmente, affacciati su una piana marziana con razzi, hangar e relitti. Ogni prop ha un fallback a primitive (box/cilindro/cono) se il modello manca.

Obiettivo qualitativo: *nella sua semplicità, deve stupire*.

## 2. Loop di gioco

Macchina a stati del round, gestita **autoritativamente dal server**:

| Fase | Cosa succede | Durata |
|---|---|---|
| `lobby` | I giocatori entrano, scelgono nome, mettono "ready" | — |
| `starting` | Countdown prima dell'assegnazione ruoli | `START_COUNTDOWN_MS` |
| `hiding` | Si genera una nuova mappa, si assegnano i ruoli e si fa spawn; i prop si spargono e si trasformano; i cacciatori sono **bloccati** (schermo oscurato, no movimento) | `HIDE_DURATION_MS` |
| `hunting` | Cacciatori liberi; fase principale | fino a `ROUND_DURATION_MS` o a fine anticipata |
| `round_end` | Schermata vincitore + classifica | `ROUND_END_MS` → torna a `lobby` |

Il round parte da `lobby` quando ci sono almeno `MIN_PLAYERS_TO_START` giocatori e **tutti** sono "ready".

**Assegnazione ruoli** (a ogni round, casuale): `HUNTER_RATIO` (~1 cacciatore ogni 4), minimo 1 cacciatore e sempre almeno 1 prop. I ruoli si rimescolano ogni round.

**Condizioni di vittoria** (modello "infezione", vedi §3):
- **Cacciatori** vincono se **tutti i prop vengono convertiti** (nessun prop vivo).
- **Prop** vincono se **almeno un prop è ancora vivo allo scadere** di `ROUND_DURATION_MS`, oppure se **tutti i cacciatori si auto-eliminano** (HP a 0 per i colpi sbagliati).

La fine anticipata è valutata dal server dopo ogni sparo.

## 3. La meccanica del "preso" — spara + penalità

Il cuore del bilanciamento. Il cacciatore spara; sbagliare costa.

- **Click sinistro = sparo**, con cooldown (`FIRE_COOLDOWN_MS`) anti-spam.
- Il client invia `shoot { origin, dir }`. Il **server fa il raycast** (entro `SHOOT_RANGE`) contro le hitbox autoritative dei prop vivi, occluso dai muri:
  - **Colpito un giocatore-prop** → **convertito**: passa al team dei **cacciatori** (resta in gioco, prima persona + arma) anziché diventare spettatore. **Modalità infezione**: il round finisce quando l'ultimo prop viene convertito.
  - **Nessun prop colpito** (muro, vuoto, fuori bordo) → **colpo sbagliato**: il cacciatore subisce `WRONG_SHOT_DAMAGE`.
- Il cacciatore a 0 HP (`HUNTER_MAX_HP`) è **fuori per il round** (spettatore).

**Hitbox del prop**: derivata dal volume del prop in cui ci si è trasformati — un cilindro verticale (`computePropBounds`) calcolato dalle sue primitive, approssimato a un AABB lato server. Un prop non trasformato usa una hitbox fissa (`UNTRANSFORMED_PROP_RADIUS` × `UNTRANSFORMED_PROP_HEIGHT`). Conseguenza di design: trasformarsi in un oggetto grande ti rende un bersaglio più grande.

Perché funziona: la penalità trasforma lo "sparare a caso" in **deduzione** — non puoi spruzzare ovunque, ti dissangui. Devi notare l'anomalia ("quella cassa non c'era", "quel computer si è mosso").

**Taunt obbligatorio** (bilanciamento lato prop): ogni `TAUNT_INTERVAL_MS` il server forza su ogni prop vivo un taunt → broadcast `taunt { playerId, x, z }`. Il client riproduce un audio posizionale (volume per distanza) e un breve "wiggle" (pulsazione di scala) del mesh. Costringe i prop a tradire un minimo la posizione.

> Risoluzione hit **autoritativa sul server** = il pezzo anti-cheat che conta. Il movimento è più permissivo (vedi §7), accettabile per un gioco tra colleghi.

## 4. Controlli

| Input | Azione |
|---|---|
| `WASD` / frecce | Movimento |
| `Shift` | Corsa (tutti; cacciatore `RUN_MULTIPLIER_HUNTER` > prop `RUN_MULTIPLIER_PROP`) |
| `Spazio` | Salto (solo cacciatore) |
| Mouse | Rotazione vista (pointer lock; cacciatore in prima persona, prop in terza) |
| Click sx | Sparo (solo cacciatore) |
| `E` | Trasformazione (solo prop): guarda un prop nella mappa entro breve distanza e premi `E` |
| `T` | Chat: apre l'input; `Invio` invia, `Esc` chiude |
| `Tab` | Classifica (tieni premuto) |
| `M` | Muta / riattiva l'audio |
| `Esc` | Rilascia il puntatore del mouse / chiude la chat |

**Trasformazione prop**: raycast dal centro schermo su un prop del catalogo mappa + `E` → il **mesh visivo** del giocatore diventa quello. Il **collider di movimento resta un cerchio di raggio fisso** (player-sized), così non resti incastrato; cambia l'aspetto e la hitbox di sparo (§3), non la fisica di spostamento. Scelta MVP per evitare incastri e grattacapi di fisica.

## 5. Chat

Canale testuale stile videogioco: `T` apre l'input, il messaggio va sul canale di rete e viene broadcastato a tutti. Validazione al boundary: testo trimmato e troncato a `MAX_CHAT_LENGTH`, messaggi vuoti scartati; nome troncato a `MAX_NAME_LENGTH`. L'output è renderizzato come testo React (escape automatico, no XSS).

## 6. Mappa procedurale data-driven

Una mappa è **dati, non codice**. Il motore di gioco non conosce il tema: consuma una `MapDefinition`. **La mappa viene generata proceduralmente dal server a ogni round** (`generateMap(seed, catalog)`), non caricata da file — un seme diverso a ogni `hiding`, quindi varietà infinita. La struttura `MapDefinition` resta il contratto: aggiungere prop/temi = aggiungere voci di catalogo e modelli, non logica.

```ts
// packages/shared/src/map.ts
export interface Vec3 { x: number; y: number; z: number }

export type PrimitiveKind = "box" | "cylinder" | "cone";

export interface PrimitiveSpec {
  kind: PrimitiveKind;
  position: Vec3;
  size: Vec3;
  color: string;
}

export interface PropDefinition {
  id: string;
  name: string;          // "Sedia", "Computer", "Container"...
  parts: PrimitiveSpec[]; // composizione di primitive = mesh di fallback
  model?: string;         // glTF da usare al posto delle primitive
  modelScale?: number;
}

export interface PropInstance {       // mobile piazzato nella scena (statico)
  type: string;          // id di una PropDefinition del catalogo
  position: Vec3;
  rotation: number;      // radianti, attorno a Y
}

export interface BoxCollider { position: Vec3; size: Vec3 }

export interface TileInstance {       // pezzo modulare glTF (pavimento/parete)
  model: string;
  position: Vec3;
  rotationY: number;
}

export interface SceneryInstance {    // scenografia esterna decorativa (no collider)
  model: string;
  position: Vec3;
  rotationY: number;
  scale: number;
}

export interface MapDefinition {
  id: string;
  name: string;
  bounds: { min: Vec3; max: Vec3 };       // clamp del movimento
  spawnPoints: { hunters: Vec3[]; props: Vec3[] };
  colliders: BoxCollider[];   // guscio statico (pavimento + pareti + scenografia solida)
  tiles: TileInstance[];      // pezzi modulari renderizzati (instanced)
  scenery: SceneryInstance[]; // set piece esterni (razzi, hangar, relitti)
  props: PropInstance[];      // mobili piazzati nella scena
  propCatalog: PropDefinition[]; // forme in cui ci si può trasformare
}
```

La validazione runtime vive in `parseMapDefinition(raw: unknown): MapDefinition`
(`packages/shared/src/map.ts`): il **client** la usa sulla mappa ricevuta via rete (`map` event)
prima di renderizzarla — i prop instance con `type` fuori catalogo vengono rifiutati.
`computePropBounds(def)` deriva il cilindro di delimitazione di un prop ed è **condiviso** tra
hit detection lato server e fitting del mesh lato client, così le hitbox combaciano con ciò che si vede.

### Generazione

`generateMap` (`packages/server/src/generateMap.ts`) costruisce un layout **stanze + corridoi** su griglia di tile fisse: un rettangolo murato suddiviso in stanze, ogni parete interna forata da una porta (`gate`) per coppia di stanze adiacenti. Emette `tiles` glTF modulari per il rendering e `colliders` AABB allineati per fisica/occlusione. `furnish.ts` arreda ogni stanza con un arredamento semanticamente coerente scelto da un set di **archetipi** (mensa, alloggi, sala controllo, magazzino, laboratorio), stando alla larga da porte e punto di spawn. `emitScenery` veste la piana marziana esterna con razzi modulari agli angoli, hangar, navette e detriti (meteoriti/crateri). Il **catalogo prop** è `spaceCatalog.ts` (`SPACE_CATALOG`, ~28 oggetti di stazione spaziale). Tutto è deterministico per seme.

## 7. Stack & architettura

| Pezzo | Scelta |
|---|---|
| Linguaggio | **TypeScript** ovunque |
| Client render | **Three.js** via **@react-three/fiber** + **@react-three/drei** |
| UI (lobby/chat/HUD) | **React** |
| Build client | **Vite** |
| Server di gioco | **Colyseus** (`@colyseus/core` + `@colyseus/ws-transport`, non il meta-pacchetto; autoritativo, a stanze) |
| Monorepo | **pnpm workspaces** |

### Modello di rete

- Stanza `WebHuntRoom` con stato sincronizzato via `@colyseus/schema`.
- Broadcast di stato a 20 Hz (`PATCH_RATE_MS = 50`); il client **interpola** tra gli snapshot e renderizza a 60 fps.
- **Autorità del server**: fase, timer, ruoli, HP, vivo/morto, risoluzione spari, taunt, vittoria, generazione mappa.
- **Movimento (pragmatico)**: il client invia `input { x, y, z, rot }` a ~20 Hz (`INPUT_SEND_RATE_MS`); il server **clampa solo ai bounds della mappa**. Niente prediction/rollback, **nessun sanity check di velocità** e **nessuna collisione lato server**: muri e mobili sono gestiti **solo dal client** (`Scene.tsx`). Scelta consapevole per restare semplici su LAN.

### Stato sincronizzato (schema)

```ts
// packages/server/src/rooms/WebHuntRoom.ts
PlayerState  { id, name, x, y, z, rot, role: 'hunter'|'prop',
               alive, hp, kills, propType: string, ready, avatar }
RoomState    { mapId, phase, phaseEndsAt, winner, players: Map<id, PlayerState> }
```

Fase, timer (`phaseEndsAt`) e vincitore vivono **nello stato sincronizzato**, non in eventi: il client li legge facendo polling di `room.state`.

### Contratti dei messaggi (boundary tipizzato)

I messaggi sono canali Colyseus separati identificati da costanti `MSG_*` (`packages/shared/src/protocol.ts`), non un'unione discriminata.

```ts
// client → server
input     { x, y, z, rot }            // posizione + rotazione
transform { propType }                // morphing del prop
shoot     { origin, dir }             // raggio di sparo
chat      { text }
ready     { ready }
map                                   // richiesta della MapDefinition corrente

// server → client
map           MapDefinition           // mappa generata (anche a ogni nuovo round)
teleport      { x, z }                // riposizionamento allo spawn
taunt         { playerId, x, z }
shot_result   { hit }                 // esito del proprio sparo
kill          { byId, byName, victimId, victimName, reason }
chat          { fromId, name, text }
```

`reason` di `kill` ∈ `"shot" | "self" | "converted"`. Tutti i payload in ingresso sono **validati al boundary** da helper `parse*` che ritornano `null` su input non valido (scartato, mai propagato). Niente `any` nel codice interno.

### Layout repo

```
webhunt.lol/
  package.json            # pnpm workspaces; script dev/typecheck/tunnel
  packages/
    shared/               # contratto: tipi, protocol, constants, MapDefinition
      src/{constants,protocol,map,index}.ts
    server/               # Colyseus: stanza + logica autoritativa + generazione mappa
      src/index.ts
      src/rooms/WebHuntRoom.ts
      src/{generateMap,furnish,spaceCatalog,avatars}.ts
    client/               # Vite + React + R3F
      src/ui/App.tsx          # lobby / connessione
      src/net/connection.ts   # SDK Colyseus
      src/game/{Game,Scene,audio,useControls,types}.ts(x)
      public/models/{space,space-station,space-kit,pets,blaster}/  # asset glTF (Kenney)
      index.html
```

## 8. Configurazione (niente magic value)

Tutte le costanti di gioco centralizzate in `packages/shared/src/constants.ts`. URL/porta dal config, mai inline.

```ts
export const ROOM_NAME = "webhunt";
export const DEFAULT_PORT = 2567;
export const COLYSEUS_PROXY_PATH = "/colyseus";

export const MAX_PLAYERS = 12;
export const MIN_PLAYERS_TO_START = 2;
export const HUNTER_RATIO = 0.25;          // ~1 cacciatore ogni 4

export const START_COUNTDOWN_MS = 5_000;
export const HIDE_DURATION_MS = 20_000;
export const ROUND_DURATION_MS = 240_000;  // 4 min
export const ROUND_END_MS = 8_000;
export const TAUNT_INTERVAL_MS = 30_000;

export const HUNTER_MAX_HP = 100;
export const WRONG_SHOT_DAMAGE = 20;
export const FIRE_COOLDOWN_MS = 800;
export const SHOOT_RANGE = 50;             // unità mondo
export const UNTRANSFORMED_PROP_RADIUS = 0.5;
export const UNTRANSFORMED_PROP_HEIGHT = 1.8;

export const MOVE_SPEED = 5;               // unità/s
export const RUN_MULTIPLIER_HUNTER = 1.7;
export const RUN_MULTIPLIER_PROP = 1.5;
export const JUMP_SPEED = 6;
export const GRAVITY = 20;

export const PATCH_RATE_MS = 50;           // broadcast 20 Hz
export const INPUT_SEND_RATE_MS = 50;

export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 200;
```

Server URL lato client da env `VITE_SERVER_URL`; default = stessa origine + `COLYSEUS_PROXY_PATH` (`/colyseus`), che Vite fa da proxy verso il server in dev. Porta server da env `PORT` (default `2567`).

## 9. Come si gioca (LAN-first → cloud)

- **Dev / LAN**: l'host avvia tutto con `pnpm dev` (server Colyseus su `:2567`, Vite su `:5173`). Vite espone sulla rete (`host: true`) e fa da **proxy** di `/colyseus` verso il server, derivando anche il WebSocket. I colleghi aprono `http://<ip-host>:5173`: il client parla col server attraverso il proxy, **senza configurare nulla**. In alternativa si può puntare un server separato con `VITE_SERVER_URL`.
- **Remoto**: `pnpm tunnel` (ngrok su `5173`, opzionale `NGROK_DOMAIN`) espone un singolo tunnel che copre client e WebSocket; il dominio ngrok è già in `allowedHosts` di Vite.
- **Cloud (Fase 2)**: lo **stesso** server Colyseus si deploya su fly.io/render; cambia solo l'URL. Server autoritativo = i client non sanno dove sono gli altri (no wallhack banali).

## 10. Scope

### Implementato (baseline)
- Mappa **procedurale** a ogni round (stanze + corridoi, arredamento ad archetipi, scenografia marziana esterna) con catalogo di ~28 prop
- Lobby con nome + ready
- Macchina a stati del round completa (incl. fase `hiding` coi cacciatori bloccati e oscurati)
- Movimento WASD + mouse look (cacciatore 1ª persona, prop 3ª persona), corsa e salto
- Trasformazione prop (`E`), collider di movimento a raggio fisso
- Sparo con penalità su colpo sbagliato, risoluzione hit server-side, cooldown, modello a infezione
- Taunt obbligatorio (audio posizionale + wiggle)
- Chat `T`, classifica `Tab`, kill-feed, schermata risultato + ritorno in lobby
- Avatar animali (cube-pet) casuali per giocatore
- Audio sintetizzato a runtime (Web Audio), ombre, mute persistente
- Spettatore dopo l'auto-eliminazione del cacciatore

### Fase 2 (sbloccata dalla struttura, non ora)
- Più temi/cataloghi; art/polish ulteriore
- Punteggi/leaderboard persistenti, statistiche fra round
- Skin/varianti selezionabili, emote, taunt manuali
- Riconnessione, persistenza stanze, deploy cloud pubblico
- Mobile/touch

### Non-goal (per ora)
- Anti-cheat di livello competitivo (movimento non autoritativo, niente collisione server-side)
- Editor di mappe in-game
- Account/login

## 11. Rischi & note

- **Netcode**: la latenza è il vero punto delicato; su LAN è perdonabile. L'interpolazione copre l'MVP; lag compensation seria → Fase 2.
- **Collisioni client-side**: il server clampa solo ai bounds, muri e mobili sono lato client (cerchio player vs AABB/raggio). Conseguenza: la fisica di movimento non è anti-cheat e va trattata come tale.
- **Mimetismo testabile**: serve **varietà** di prop fin da subito — il catalogo `SPACE_CATALOG` ne offre ~28 e la mappa è procedurale, quindi il gameplay è valutabile da subito.
- **Audio**: il taunt posizionale è centrale per il bilanciamento ed è già implementato (sintetizzato, nessun file asset).
