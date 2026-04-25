// Cron-Endpoints (Task #66): geplante Hintergrund-Jobs werden ohne User-Session
// von einem externen Scheduler aufgerufen. Auth erfolgt über einen Shared-Secret-
// Header (`X-Cron-Token`), der aus der Umgebungsvariable `CRON_TOKEN` gelesen
// wird. Ohne gesetztes Token antwortet der Endpoint mit 503, damit Aufrufer
// merken, dass der Server für Cron noch nicht konfiguriert ist (statt Aufrufe
// schweigend zu akzeptieren).
//
// Bewusst ausserhalb des `requireAuth`-Stacks gemountet, damit der Scheduler
// kein Login-Cookie braucht. Nur tenant-übergreifende Wartungs-Jobs gehören
// hierher; alles, was ein User auslöst, bleibt unter `/api/...`.

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, tenantsTable } from "@workspace/db";
import { materializeRenewalsForTenant, type RenewalRunResult } from "./dealflow";

const router: IRouter = Router();

function requireCronToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.CRON_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "cron disabled (CRON_TOKEN not configured)" });
    return;
  }
  const got =
    (req.header("x-cron-token") ?? "").trim() ||
    (typeof req.query.token === "string" ? req.query.token : "");
  if (got !== expected) {
    res.status(401).json({ error: "invalid cron token" });
    return;
  }
  next();
}

// POST /cron/renewals — scannt alle Tenants und materialisiert fällige
// Renewal-Opportunities. Antwortet mit einer Aufstellung pro Tenant plus
// Summen, damit der Scheduler die Run-Healthiness loggen kann.
router.post("/cron/renewals", requireCronToken, async (req, res) => {
  const tenants = await db.select({ id: tenantsTable.id }).from(tenantsTable);
  const perTenant: Array<{ tenantId: string; result: RenewalRunResult; error?: string }> = [];
  let totals: RenewalRunResult = { scanned: 0, created: 0, updated: 0, dueSoon: 0, skipped: 0 };

  for (const t of tenants) {
    try {
      const r = await materializeRenewalsForTenant(t.id);
      perTenant.push({ tenantId: t.id, result: r });
      totals = {
        scanned: totals.scanned + r.scanned,
        created: totals.created + r.created,
        updated: totals.updated + r.updated,
        dueSoon: totals.dueSoon + r.dueSoon,
        skipped: totals.skipped + r.skipped,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log?.error?.({ err, tenantId: t.id }, "renewal materialization failed");
      perTenant.push({
        tenantId: t.id,
        result: { scanned: 0, created: 0, updated: 0, dueSoon: 0, skipped: 0 },
        error: msg,
      });
    }
  }

  res.json({
    ranAt: new Date().toISOString(),
    tenantCount: tenants.length,
    totals,
    perTenant,
  });
});

export default router;
