/**
 * OAuth Provider Interface
 *
 * Every OAuth provider (Google, GitHub, Microsoft, Discord, Apple, Facebook)
 * implements this interface. Add a new provider by implementing IOAuthProvider
 * and registering it in registry.ts — no other files need changes.
 */

export interface OAuthProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  emailVerified: boolean;
}

export interface IOAuthProvider {
  readonly name: string;
  getAuthorizationUrl(state: string): Promise<string>;
  exchangeCode(code: string): Promise<OAuthProfile>;
}

export interface OAuthConfigInput {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  isEnabled: boolean;
}
