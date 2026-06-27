/**
 * Google OAuth 2.0 Provider
 *
 * Uses the standard Authorization Code flow with PKCE-optional approach.
 * Config (client ID, secret, redirect URI) is loaded from the DB at runtime
 * so it can be updated without restarting the server.
 */

import { db, oauthProviderConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptKey } from "../provider-manager/key-vault";
import type { IOAuthProvider, OAuthProfile } from "./types";

export class GoogleOAuthProvider implements IOAuthProvider {
  readonly name = "google";

  private async getConfig() {
    const [config] = await db
      .select()
      .from(oauthProviderConfigsTable)
      .where(eq(oauthProviderConfigsTable.provider, "google"))
      .limit(1);

    if (!config?.isEnabled || !config.clientId || !config.clientSecretEncrypted || !config.redirectUri) {
      throw new Error("Google OAuth is not configured or is disabled");
    }

    const clientSecret = decryptKey(config.clientSecretEncrypted);
    return { clientId: config.clientId, clientSecret, redirectUri: config.redirectUri };
  }

  async getAuthorizationUrl(state: string): Promise<string> {
    const { clientId, redirectUri } = await this.getConfig();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "select_account",
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code: string): Promise<OAuthProfile> {
    const { clientId, clientSecret, redirectUri } = await this.getConfig();

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      throw new Error(`Google token exchange failed (${tokenRes.status}): ${body.slice(0, 200)}`);
    }

    const tokens = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!profileRes.ok) {
      throw new Error("Failed to fetch Google user profile");
    }

    const profile = (await profileRes.json()) as {
      id: string;
      email: string;
      name: string;
      picture?: string;
      verified_email: boolean;
    };

    if (!profile.verified_email) {
      throw new Error("Google account email is not verified");
    }

    return {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
      emailVerified: profile.verified_email,
    };
  }
}
