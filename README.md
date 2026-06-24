# webhunt.lol

Prop hunt multiplayer da browser. 3D low-poly, LAN-first. Vedi [`SPEC.md`](./SPEC.md) per il design.

## Requisiti

- Node ≥ 20
- pnpm

## Setup

```bash
pnpm install
```

## Sviluppo

```bash
pnpm dev
```

Avvia server di gioco (Colyseus, porta `2567`) e client (Vite) in parallelo.
Apri il client all'URL stampato da Vite (default `http://localhost:5173`).

Per avviarli separatamente:

```bash
pnpm dev:server
pnpm dev:client
```

## Gioco in LAN

1. L'host avvia `pnpm dev` e legge il proprio IP di rete locale (es. `192.168.1.42`).
2. I colleghi aprono il client passando l'URL del server: imposta
   `VITE_SERVER_URL=ws://192.168.1.42:2567` (vedi `packages/client/.env.example`)
   e riavvia il client, oppure compila il campo nella lobby.

## Stato

Slice 1 (skeleton giocabile): connessione alla stanza, movimento `WASD` sincronizzato,
rendering della mappa `office-min` data-driven. Vedi `SPEC.md` §10 per la roadmap.
