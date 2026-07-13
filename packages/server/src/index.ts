import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DEFAULT_PORT, ROOM_NAME } from "@morphy/shared";
import cors from "cors";
import { MorphyRoom } from "./rooms/MorphyRoom";

const port = Number(process.env.PORT ?? DEFAULT_PORT);

const server = defineServer({
  transport: new WebSocketTransport(),
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
    process.exit(1);
  });
