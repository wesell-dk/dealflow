import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import authRouter from "./routes/auth";
import cronRouter from "./routes/cron";
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth endpoints (public) — mounted under /api and /api/v1.
app.use("/api/auth", authRouter);
app.use("/api/v1/auth", authRouter);
// Cron endpoints — bewusst aussen am Auth-Stack vorbei. Eigene Token-Auth
// im Router (siehe routes/cron.ts), kein Login-Cookie noetig.
app.use("/api", cronRouter);
// All other /api routes require auth + idempotency.
app.use("/api", requireAuth, idempotency(), router);
app.use("/api/v1", requireAuth, idempotency(), router);

export default app;
