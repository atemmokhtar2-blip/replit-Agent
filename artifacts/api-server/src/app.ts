import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { authLimiter as _authLimiterImport } from "./middlewares/rate-limit";
import path from "path";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ── Security headers (helmet) ─────────────────────────────────────────────────
app.use(
  helmet({
    // Allow embedding in Replit preview iframe during development
    contentSecurityPolicy: process.env["NODE_ENV"] === "production",
    crossOriginEmbedderPolicy: process.env["NODE_ENV"] === "production",
  }),
);

// ── CORS — restrict to known origins ─────────────────────────────────────────
// Priority: explicit APP_CORS_ORIGINS env → Replit production domains → dev domain → localhost
function buildAllowedOrigins(): (string | RegExp)[] | "*" {
  // Explicit override (comma-separated list)
  const explicit = process.env["APP_CORS_ORIGINS"];
  if (explicit) {
    return explicit.split(",").map((o) => o.trim());
  }

  // In development with no config, allow everything (mirrors previous behaviour)
  if (process.env["NODE_ENV"] !== "production") {
    return "*";
  }

  const origins: string[] = [];

  // Replit deployed domains (comma-separated)
  const replitDomains = process.env["REPLIT_DOMAINS"];
  if (replitDomains) {
    replitDomains.split(",").forEach((d) => origins.push(`https://${d.trim()}`));
  }

  // Replit dev workspace
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) origins.push(`https://${devDomain}`);

  // Explicit app URL (non-Replit hosting)
  const appUrl = process.env["APP_URL"];
  if (appUrl) origins.push(appUrl.replace(/\/$/, ""));

  return origins.length > 0 ? origins : [];
}

const allowedOrigins = buildAllowedOrigins();

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

// ── Global rate limiter ───────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs:         60 * 1000,       // 1 minute
  max:              300,             // 300 req / min per IP
  standardHeaders:  "draft-8",
  legacyHeaders:    false,
  message:          { error: "Too many requests, please slow down." },
  skip: (req) => req.path === "/healthz", // never rate-limit health checks
});

// Re-export authLimiter so other modules that already import it from here keep working
export { _authLimiterImport as authLimiter };

app.use(globalLimiter);

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/api", router);

// ── Static file serving (production) ──────────────────────────────────────────
// Serve the built Vite frontend from the API server when NODE_ENV=production.
// This lets a single process handle both /api and the SPA.
if (process.env["NODE_ENV"] === "production" && !process.env["VERCEL"]) {
  const clientDist = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../ai-agent/dist/public",
  );
  app.use(express.static(clientDist));
  app.use((_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// ── Global JSON error handler ─────────────────────────────────────────────────
// Must be defined after all routes. Catches any error passed via next(err) or
// thrown inside async route handlers (Express 5 auto-propagates async throws).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { status?: number; statusCode?: number })?.statusCode ??
    500;

  // Never expose internal error details to clients in production
  const isProduction = process.env["NODE_ENV"] === "production";
  const message = isProduction && status >= 500
    ? "An internal server error occurred."
    : (err as { message?: string })?.message ?? "Internal server error";

  logger.error({ err }, "Unhandled error");

  res.status(status).json({ error: message });
});

export default app;
