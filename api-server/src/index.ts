import app, { registerRoutes } from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

(async () => {
  const server = await registerRoutes(app);

  server.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Server listening");
  });
})();
