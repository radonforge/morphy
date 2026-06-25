import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DEFAULT_PORT, ROOM_NAME } from "@webhunt/shared";
import cors from "cors";
import { WebHuntRoom } from "./rooms/WebHuntRoom";

const port = Number(process.env.PORT ?? DEFAULT_PORT);

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: {
    [ROOM_NAME]: defineRoom(WebHuntRoom),
  },
  express: (app) => {
    app.use(cors());
  },
});

server
  .listen(port)
  .then(() => console.log(`[webhunt] listening on http://0.0.0.0:${port}`))
  .catch((error: unknown) => {
    console.error(`[webhunt] failed to start on port ${port}:`, error);
    process.exit(1);
  });
