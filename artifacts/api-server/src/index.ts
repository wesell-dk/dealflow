import app from "./app";
import { logger } from "./lib/logger";
import {
  ensureSchemaColumns,
  seedIfEmpty,
  seedQuoteTemplatesIdempotent,
  seedPlaceholderObjectsIdempotent,
  seedContractMvpAugmentationIdempotent,
  backfillPricingCategoriesIdempotent,
} from "./lib/seed";
import { seedLegalSourcesIdempotent } from "./lib/seedLegalSources";
import { seedRegulatoryFrameworksIdempotent } from "./lib/seedRegulatoryFrameworks";
import { pruneExpiredSessions } from "./lib/auth";
import { runAllGenerators } from "./insights/generators";
import { runRetentionSweep } from "./gdpr/service";

// Self-healing DDL guard for stale databases that pre-date columns the
// code now relies on (e.g. quotes.archived_at). Must run before seeds,
// insight generators, or any request handler touches those tables.
try {
  await ensureSchemaColumns();
} catch (err) {
  logger.error({ err }, "Schema column guard failed");
  throw err;
}

await seedIfEmpty().catch((err) => {
  logger.error({ err }, "Seed failed");
});

await seedQuoteTemplatesIdempotent().catch((err) => {
  logger.error({ err }, "Quote-templates seed failed");
});

await seedPlaceholderObjectsIdempotent().catch((err) => {
  logger.error({ err }, "Placeholder-attachments seed failed");
});

await seedContractMvpAugmentationIdempotent().catch((err) => {
  logger.error({ err }, "Contract MVP augmentation seed failed");
});

await seedLegalSourcesIdempotent().catch((err) => {
  logger.error({ err }, "Legal sources seed failed");
});
await backfillPricingCategoriesIdempotent().catch((err) => {
  logger.error({ err }, "Pricing-categories backfill failed");
});

await seedRegulatoryFrameworksIdempotent().catch((err) => {
  logger.error({ err }, "Regulatory frameworks seed failed");
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

import { startWebhookWorker } from "./lib/webhooks";
startWebhookWorker();
