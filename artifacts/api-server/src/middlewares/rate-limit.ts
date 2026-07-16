/**
 * Rate-limiting middleware presets
 *
 * Keep these in a dedicated file to avoid circular imports between app.ts and route files.
 */

import rateLimit from "express-rate-limit";

/** Strict limiter for auth endpoints — brute-force protection */
export const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             20,             // 20 attempts per window per IP
  standardHeaders: "draft-8",
  legacyHeaders:   false,
  message:         { error: "Too many authentication attempts. Please try again later." },
});
