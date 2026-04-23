import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { pruneExpiredSessions } from "./lib/auth";

await seedIfEmpty().catch((err) => {
  logger.error({ err }, "Seed failed");
});

// Periodically clean up expired sessions (every hour).
setInterval(() => {
  pruneExpiredSessions().catch((err) =>
    logger.warn({ err }, "pruneExpiredSessions failed"),
  );
}, 60 * 60 * 1000).unref();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
