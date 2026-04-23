import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { pruneExpiredSessions } from "./lib/auth";
import { runAllGenerators } from "./insights/generators";
import { runRetentionSweep } from "./gdpr/service";

await seedIfEmpty().catch((err) => {
  logger.error({ err }, "Seed failed");
});

await runAllGenerators().catch((err) => {
  logger.error({ err }, "Copilot insight generators failed");
});

// Periodically clean up expired sessions (every hour).
setInterval(() => {
  pruneExpiredSessions().catch((err) =>
    logger.warn({ err }, "pruneExpiredSessions failed"),
  );
}, 60 * 60 * 1000).unref();

// Run GDPR retention sweep once at boot, then daily.
void runRetentionSweep()
  .then((r) => logger.info({ applied: r.applied }, "GDPR retention sweep"))
  .catch((err) => logger.warn({ err }, "GDPR retention sweep failed (boot)"));
setInterval(() => {
  runRetentionSweep()
    .then((r) => logger.info({ applied: r.applied }, "GDPR retention sweep"))
    .catch((err) => logger.warn({ err }, "GDPR retention sweep failed"));
}, 24 * 60 * 60 * 1000).unref();

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
