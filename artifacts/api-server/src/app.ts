import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ── Global JSON error handler ─────────────────────────────────────────────────
// Must be defined after all routes. Catches any error passed via next(err) or
// thrown inside async route handlers (Express 5 auto-propagates async throws).
// Always responds with JSON so the client never receives an HTML error page.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number; statusCode?: number })?.status ??
    (err as { status?: number; statusCode?: number })?.statusCode ?? 500;
  const message =
    (err as { message?: string })?.message ?? "Internal server error";

  logger.error({ err }, "Unhandled error");

  res.status(status).json({ error: message });
});

export default app;
