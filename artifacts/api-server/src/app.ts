import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import authRouter from "./routes/auth";
import cronRouter from "./routes/cron";
import inboundEmailRouter from "./routes/inboundEmail";
import mailboxOauthRouter from "./routes/mailboxOauth";
import widgetRouter from "./routes/widget";
import { requireAuth } from "./middlewares/auth";
import { idempotency } from "./middlewares/idempotency";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(
  express.json({
    // Den Raw-Body für signaturpflichtige Webhooks (Cal.com Widget) festhalten,
    // sonst können wir den HMAC nicht prüfen, sobald express.json den Body
    // bereits geparst hat. Nur Pfade unter /external/widget/.../cal-webhook
    // brauchen das — bewusst eng gehalten, um Memory nicht zu verschwenden.
    verify: (req, _res, buf) => {
      const url = (req as { url?: string }).url ?? "";
      if (url.includes("/external/widget/") && url.includes("/cal-webhook")) {
        (req as unknown as { rawBody: string }).rawBody = buf.toString("utf8");
      }
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Auth endpoints (public) — mounted under /api and /api/v1.
app.use("/api/auth", authRouter);
app.use("/api/v1/auth", authRouter);
// Cron endpoints — bewusst aussen am Auth-Stack vorbei. Eigene Token-Auth
// im Router (siehe routes/cron.ts), kein Login-Cookie noetig.
app.use("/api", cronRouter);
// Inbound-E-Mail-Webhook — externer Mail-Provider hat keine Login-Session.
// Token-basierte Auth + Tenant-Auflösung passiert im Router selbst (siehe
// routes/inboundEmail.ts). Mount auf /api UND /api/v1, damit beide
// Versions-Pfade konsistent funktionieren.
app.use("/api", inboundEmailRouter);
app.use("/api/v1", inboundEmailRouter);
// Mailbox OAuth callbacks — mounted BEFORE requireAuth because the third-
// party redirect carries no session cookie. The router validates a signed
// `state` parameter (HMAC over user/tenant/expiry) to authenticate.
app.use("/api", mailboxOauthRouter);
app.use("/api/v1", mailboxOauthRouter);
// Brand-Lead-Widget — Public-Key-basierte Auth pro Brand (siehe
// routes/widget.ts). Bewusst aussen am Auth-Stack vorbei, damit Besucher
// einer fremden Website das Widget ohne Login nutzen können.
app.use("/api", widgetRouter);
app.use("/api/v1", widgetRouter);
// All other /api routes require auth + idempotency.
app.use("/api", requireAuth, idempotency(), router);
app.use("/api/v1", requireAuth, idempotency(), router);

export default app;
