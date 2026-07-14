import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DEFAULT_PORT, ROOM_NAME } from "@morphy/shared";
import cors from "cors";
import { MorphyRoom } from "./rooms/MorphyRoom";
import { playerStats } from "./stats/repository";

const port = Number(process.env.PORT ?? DEFAULT_PORT);

const server = defineServer({
  transport: new WebSocketTransport(),
  gracefullyShutdown: false,
  rooms: {
    [ROOM_NAME]: defineRoom(MorphyRoom).filterBy(["map"]),
  },
  express: (app) => {
    app.use(cors());
  },
});

server
  .listen(port)
  .then(() => console.log(`[morphy] listening on http://0.0.0.0:${port}`))
  .catch((error: unknown) => {
    console.error(`[morphy] failed to start on port ${port}:`, error);
    playerStats.close();
    process.exit(1);
  });

function shutdown(signal: NodeJS.Signals): void {
  console.log(`[morphy] ${signal} received, closing DB`);
  playerStats.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
