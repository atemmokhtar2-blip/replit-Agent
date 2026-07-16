/**
 * Mailer — thin nodemailer wrapper
 *
 * Configuration via environment variables:
 *   SMTP_HOST     — SMTP server hostname  (required for email to work)
 *   SMTP_PORT     — SMTP port, default 587
 *   SMTP_USER     — SMTP username / login
 *   SMTP_PASS     — SMTP password
 *   SMTP_FROM     — "From" address, default noreply@<APP_URL host>
 *   SMTP_SECURE   — "true" for port 465 TLS, otherwise STARTTLS
 *
 * If SMTP_HOST is not set the mailer logs a warning and no-ops every send.
 * This lets the server boot and function without email in development.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const host = process.env["SMTP_HOST"];
  if (!host) {
    logger.warn("[mailer] SMTP_HOST is not set — email delivery is disabled. Set SMTP_HOST/SMTP_USER/SMTP_PASS to enable.");
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port:   Number(process.env["SMTP_PORT"] ?? "587"),
    secure: process.env["SMTP_SECURE"] === "true",
    auth: process.env["SMTP_USER"]
      ? { user: process.env["SMTP_USER"], pass: process.env["SMTP_PASS"] ?? "" }
      : undefined,
  });

  return transporter;
}

function getFromAddress(): string {
  if (process.env["SMTP_FROM"]) return process.env["SMTP_FROM"];
  const appUrl = process.env["APP_URL"] ?? process.env["REPLIT_DEV_DOMAIN"] ?? "localhost";
  const host   = appUrl.replace(/^https?:\/\//, "").split("/")[0];
  return `noreply@${host}`;
}

export interface MailOptions {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
}

export async function sendMail(opts: MailOptions): Promise<void> {
  const xport = getTransporter();
  if (!xport) {
    logger.warn({ to: opts.to, subject: opts.subject }, "[mailer] Email not sent — SMTP not configured");
    return;
  }

  try {
    const info = await xport.sendMail({
      from:    getFromAddress(),
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text,
    });
    logger.info({ messageId: info.messageId, to: opts.to }, "[mailer] Email sent");
  } catch (err) {
    logger.error({ err, to: opts.to }, "[mailer] Failed to send email");
    throw err;
  }
}

// ── Template helpers ──────────────────────────────────────────────────────────

export function passwordResetEmail(opts: { resetUrl: string; username: string }): Pick<MailOptions, "subject" | "html" | "text"> {
  const { resetUrl, username } = opts;
  return {
    subject: "Reset your password",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;background:#f4f4f5;margin:0;padding:32px 16px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <h2 style="margin:0 0 8px;font-size:20px;color:#111">Reset your password</h2>
    <p style="color:#555;margin:0 0 24px">Hi ${username}, we received a request to reset your password. Click the button below — this link expires in 1 hour.</p>
    <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Reset Password</a>
    <p style="color:#888;font-size:13px;margin:24px 0 0">If you didn't request this, you can safely ignore this email. Your password will not change.</p>
    <p style="color:#bbb;font-size:12px;margin:8px 0 0;word-break:break-all">Or copy this link: ${resetUrl}</p>
  </div>
</body>
</html>`,
    text: `Reset your password\n\nHi ${username},\n\nClick this link to reset your password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
  };
}
