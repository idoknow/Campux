import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { OneBotRuntime } from "../runtime/onebot";

export async function registerOneBotRoutes(app: FastifyInstance, oneBot: OneBotRuntime) {
  await app.register(websocket);

  app.get("/onebot/v11/ws", { websocket: true }, (socket, request) => {
    oneBot.handleConnection(socket, {
      headers: request.headers,
      url: request.url,
    });
  });
}
