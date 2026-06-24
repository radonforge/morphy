# webhunt.lol — Spec di progetto

> Prop hunt multiplayer da browser. Si parte LAN-first (un collega ospita, gli altri si connettono via IP), con la stessa codebase deployabile in cloud per il "vero" multiplayer. 3D low-poly, semplice ma curato.

## 1. Visione

Ci si nasconde mimetizzandosi tra gli oggetti di una scena 3D (i **prop**), mentre i **cacciatori** li stanano. Il fascino sta nel mimetismo spaziale e nella deduzione, non negli asset: niente texture elaborate, solo primitive flat-shaded + buona luce + palette pulita. Tema iniziale: **ufficio minimale**, perfetto per giocare coi colleghi.

Obiettivo qualitativo: *nella sua semplicità, deve stupire*.

## 2. Loop di gioco

Macchina a stati del round, gestita **autoritativamente dal server**:

| Fase | Cosa succede | Durata |
|---|---|---|
| `LOBBY` | I giocatori entrano con un codice stanza, scelgono nome, mettono "ready" | — |
| `STARTING` | Assegnazione ruoli + countdown | `START_COUNTDOWN_MS` |
| `HIDING` | I prop si spargono e si trasformano; i cacciatori sono **bloccati** (schermo oscurato, no movimento) | `HIDE_DURATION_MS` |
| `HUNTING` | Cacciatori liberi; fase principale | fino a `ROUND_DURATION_MS` o a prop esauriti |
| `ROUND_END` | Schermata vincitore + punteggi | `ROUND_END_MS` → torna a `LOBBY` |

**Assegnazione ruoli** (a ogni round, casuale): ~1 cacciatore ogni 4 giocatori (`HUNTER_RATIO`), minimo 1 cacciatore. I ruoli si rimescolano ogni round.

**Condizioni di vittoria**:
- Cacciatori vincono se **tutti i prop sono presi** prima dello scadere.
- Prop vincono se **almeno un prop è vivo** allo scadere del timer.

## 3. La meccanica del "preso" — spara + penalità

Il cuore del bilanciamento. Il cacciatore spara; sbagliare costa.

- **Click sinistro = sparo**, con cooldown (`FIRE_COOLDOWN_MS`) anti-spam.
- Il client invia `shoot { origin, direction }`. Il **server fa il raycast** contro le posizioni autoritative dei prop vivi (entro `SHOOT_RANGE`):
  - **Colpito un giocatore-prop** → eliminato, diventa **spettatore** per il round.
  - **Nessun giocatore-prop colpito** (muro, prop finto, vuoto) → **colpo sbagliato**: il cacciatore subisce `WRONG_SHOT_DAMAGE`.
- Il cacciatore a 0 HP (`HUNTER_MAX_HP`) è **fuori per il round**.

Perché funziona: la penalità trasforma lo "sparare a caso" in **deduzione** — non puoi spruzzare ovunque, ti dissangui. Devi notare l'anomalia ("quella pianta non c'era", "quel monitor si è mosso").

**Taunt obbligatorio** (bilanciamento lato prop): ogni `TAUNT_INTERVAL_MS` il server forza su ogni prop vivo un taunt → audio posizionale + breve "wiggle" del mesh, broadcastato a tutti. Costringe i prop a tradire un minimo la posizione.

> Risoluzione hit **autoritativa sul server** = il pezzo anti-cheat che conta. Il movimento è più permissivo (vedi §7), accettabile per un gioco tra colleghi.

## 4. Controlli

| Input | Azione |
|---|---|
| `WASD` | Movimento |
| Mouse | Rotazione vista (e del prop) |
| Click sx | Sparo (solo cacciatore) |
| `E` | Trasformazione (solo prop): guarda un prop nella mappa e premi `E` per assumerne il mesh |
| `T` | Apre la chat testuale; `Invio` invia, `Esc` chiude |
| `Esc` | Menu / pausa |

**Trasformazione prop**: raycast su un prop del catalogo mappa + `E` → il **mesh visivo** del giocatore diventa quello. Il **collider resta una capsule di dimensione fissa** (player-sized): solo l'aspetto cambia. Scelta MVP per evitare incastri e grattacapi di fisica.

## 5. Chat

Canale testuale stile videogioco: `T` apre l'input, il messaggio va sul canale di rete esistente e viene broadcastato. Validazione al boundary: lunghezza ≤ `MAX_CHAT_LENGTH`, encoding/escape in output (no XSS nella UI). Nome ≤ `MAX_NAME_LENGTH`.

## 6. Mappa data-driven

Una mappa è **dati, non codice**. Il motore di gioco non conosce il tema: carica una `MapDefinition`. Aggiungere scenari/prop in futuro = aggiungere file/voci, non logica.

```ts
// packages/shared/src/map.ts
export interface Vec3 { x: number; y: number; z: number }

export interface BoxCollider { position: Vec3; size: Vec3 }

export interface PrimitiveSpec {
  kind: 'box' | 'cylinder' | 'cone';
  position: Vec3;
  size: Vec3;
  color: string;
}

export interface PropDefinition {
  id: string;
  name: string;          // "scrivania", "monitor", "pianta"...
  parts: PrimitiveSpec[]; // composizione di primitive = il mesh low-poly
}

export interface PropInstance {
  type: string;          // id di una PropDefinition del catalogo
  position: Vec3;
  rotation: number;      // radianti, attorno a Y
}

export interface MapDefinition {
  id: string;
  name: string;
  bounds: { min: Vec3; max: Vec3 };       // clamp del movimento
  spawnPoints: { hunters: Vec3[]; props: Vec3[] };
  colliders: BoxCollider[];   // guscio statico (pavimento + pareti)
  props: PropInstance[];      // mobili piazzati nella scena (statici)
  propCatalog: PropDefinition[]; // forme in cui ci si può trasformare
}
```

La validazione runtime vive in `parseMapDefinition(raw: unknown): MapDefinition`
(`packages/shared/src/map.ts`), usata sia dal server (lettura da file) sia dal client
(import bundleizzato) — i prop instance con `type` fuori catalogo vengono rifiutati.

**Mappa MVP**: `office-min` — un open-space con ~8-10 prop primitivi distinti (scrivania, monitor, sedia, pianta, stampante, tazza, cestino, distributore d'acqua, cassa, faldone). Distinti a sufficienza perché il mimetismo e la deduzione funzionino e siano testabili. Art/polish e mappe extra = Fase 2, già abilitate da questa struttura.

## 7. Stack & architettura

| Pezzo | Scelta |
|---|---|
| Linguaggio | **TypeScript** ovunque |
| Client render | **Three.js** via **@react-three/fiber** + **@react-three/drei** |
| UI (lobby/chat/HUD) | **React** |
| Build client | **Vite** |
| Server di gioco | **Colyseus** (autoritativo, a stanze, state-sync + interpolazione integrate) |
| Monorepo | **pnpm workspaces** |

### Modello di rete

- Stanza `WebHuntRoom` con stato sincronizzato via `@colyseus/schema`.
- Broadcast di stato a 20 Hz (`PATCH_RATE_MS = 50`); il client **interpola** tra gli snapshot e renderizza a 60 fps.
- **Autorità del server**: fase, timer, ruoli, HP, vivo/morto, risoluzione spari, taunt, vittoria.
- **Movimento (pragmatico)**: il client invia `position + rotation + propType` a ~20 Hz; il server **clampa ai bounds della mappa** e fa un sanity check di velocità (anti-teleport). Non rollback/prediction completi: scelta consapevole per restare semplici su LAN.

### Stato sincronizzato (schema)

```ts
// concettuale
PlayerState  { id, name, role: 'hunter'|'prop', position, rotation,
               propType: string|null, hp, alive }
RoomState    { phase, roundEndsAt, players: Map<id, PlayerState> }
```

### Contratti dei messaggi (boundary tipizzato)

```ts
// packages/shared/src/protocol.ts
export type ClientMessage =
  | { t: 'ready' }
  | { t: 'input'; position: Vec3; rotation: number; propType: string | null }
  | { t: 'transform'; propType: string }
  | { t: 'shoot'; origin: Vec3; direction: Vec3 }
  | { t: 'chat'; text: string };

export type ServerEvent =
  | { t: 'phase'; phase: Phase; roundEndsAt: number }
  | { t: 'hit'; targetId: string; byId: string }
  | { t: 'wrong-shot'; hunterId: string; hpLeft: number }
  | { t: 'taunt'; propId: string; position: Vec3 }
  | { t: 'eliminated'; playerId: string }
  | { t: 'chat'; fromId: string; name: string; text: string }
  | { t: 'round-result'; winner: 'hunters' | 'props' };
```

Tutti i payload in ingresso (HTTP/WS) sono **validati al boundary** prima di toccare la logica (lunghezze, range, propType esistente nel catalogo). Niente `any` nel codice interno.

### Layout repo

```
webhunt.lol/
  package.json            # pnpm workspaces
  packages/
    shared/               # tipi, protocol, constants, MapDefinition
      src/{constants,protocol,map}.ts
    server/               # Colyseus: WebHuntRoom + logica autoritativa
      src/rooms/WebHuntRoom.ts
      src/index.ts
    client/               # Vite + React + R3F
      src/{game,ui,net}/
      index.html
  maps/
    office-min.json
```

## 8. Configurazione (niente magic value)

Tutte le costanti centralizzate in `packages/shared/src/constants.ts`. URL/porta dal config, mai inline.

```ts
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
export const MOVE_SPEED = 5;               // unità/s
export const PATCH_RATE_MS = 50;           // broadcast 20 Hz
export const INPUT_SEND_RATE_MS = 50;
export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 200;
```

Server URL lato client da env: `VITE_SERVER_URL` (default `ws://localhost:2567`). Porta server da env `PORT` (default `2567`).

## 9. Come si gioca (LAN-first → cloud)

- **LAN**: l'host avvia tutto (`pnpm dev`), legge il proprio IP locale e lo condivide. I colleghi aprono il client Vite su `http://<ip-host>:5173` e lo puntano al server con `VITE_SERVER_URL=http://<ip-host>:2567` (la SDK Colyseus deriva il WebSocket dall'URL HTTP).
- **Cloud (Fase 2)**: lo **stesso** server Colyseus si deploya su fly.io/render; cambia solo l'URL. Server autoritativo = i client non sanno dove sono gli altri (no wallhack banali).

## 10. Scope

### MVP (obiettivo di partenza)
- 1 mappa `office-min` data-driven con ~8-10 prop primitivi
- Lobby con codice stanza + nome + ready
- Macchina a stati del round completa (incl. fase HIDING coi cacciatori bloccati)
- Movimento WASD + mouse look, trasformazione prop (`E`), collider capsule fisso
- Sparo con penalità su colpo sbagliato, risoluzione hit server-side, cooldown
- Taunt obbligatorio (audio + wiggle)
- Chat `T`
- Spettatore dopo l'eliminazione
- Schermata risultato + ritorno in lobby

### Fase 2 (sbloccata dalla struttura, non ora)
- Più mappe e scenari; art/polish, ombre, audio curato
- Punteggi/leaderboard, statistiche
- Scoreboard `Tab`, kill-feed
- Skin/varianti, emote, taunt manuali
- Riconnessione, persistenza stanze, deploy cloud pubblico
- Mobile/touch

### Non-goal (per ora)
- Anti-cheat di livello competitivo (movimento non completamente autoritativo)
- Editor di mappe in-game
- Account/login

## 11. Rischi & note

- **Netcode**: la latenza è il vero punto delicato; su LAN è perdonabile. L'interpolazione di Colyseus copre l'MVP; lag compensation seria → Fase 2.
- **Collisioni**: capsule + AABB statici, niente motore fisico pesante; attenzione al tunneling a velocità alte (clamp di `MOVE_SPEED`).
- **Mimetismo testabile**: serve **varietà** di prop fin da subito, altrimenti il gameplay non si può valutare — per questo l'MVP ha già ~8-10 forme distinte.
- **Audio**: il taunt posizionale è centrale per il bilanciamento; va previsto presto anche se grezzo.
```
