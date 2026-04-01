import { randomUUID } from "node:crypto";
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Same rules as MCP SDK `redirectUriMatches` (RFC 8252 loopback port flexibility). */
export function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) {
    return true;
  }
  let req: URL;
  let reg: URL;
  try {
    req = new URL(requested);
    reg = new URL(registered);
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(req.hostname) || !LOOPBACK_HOSTS.has(reg.hostname)) {
    return false;
  }
  return (
    req.protocol === reg.protocol &&
    req.hostname === reg.hostname &&
    req.pathname === reg.pathname &&
    req.search === reg.search
  );
}

interface CodeEntry {
  client: OAuthClientInformationFull;
  params: {
    state?: string;
    scopes?: string[];
    redirectUri: string;
    codeChallenge: string;
    resource?: URL;
  };
}

interface TokenEntry {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL | undefined;
}

interface RefreshEntry {
  clientId: string;
  scopes: string[];
  resource?: URL | undefined;
}

export class BunInMemoryClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return Promise.resolve(this.clients.get(clientId));
  }

  registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    this.clients.set(client.client_id, client);
    return Promise.resolve(client);
  }
}

/**
 * In-memory OAuth provider (demo-style). Single-process only; not for multi-replica deploys.
 */
export class BunMemoryOAuthProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private readonly codes = new Map<string, CodeEntry>();
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly refreshTokens = new Map<string, RefreshEntry>();
  private readonly validateResource: ((resource: URL | undefined) => boolean) | undefined;

  constructor(validateResource?: (resource: URL | undefined) => boolean) {
    this.validateResource = validateResource;
    this.clientsStore = new BunInMemoryClientsStore();
  }

  /**
   * Returns the absolute URL to redirect the user agent to (authorization success).
   */
  buildAuthorizationRedirect(
    client: OAuthClientInformationFull,
    params: CodeEntry["params"],
  ): string {
    if (!client.redirect_uris.some((registered) => redirectUriMatches(params.redirectUri, registered))) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }
    const code = randomUUID();
    this.codes.set(code, { client, params });
    const searchParams = new URLSearchParams({ code });
    if (params.state !== undefined) {
      searchParams.set("state", params.state);
    }
    const targetUrl = new URL(params.redirectUri);
    targetUrl.search = searchParams.toString();
    return targetUrl.toString();
  }

  challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    return Promise.resolve(codeData.params.codeChallenge);
  }

  exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL,
  ): Promise<OAuthTokens> {
    void _codeVerifier;
    void _redirectUri;
    void _resource;
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    if (codeData.client.client_id !== client.client_id) {
      throw new InvalidGrantError("Authorization code was not issued to this client");
    }
    if (this.validateResource !== undefined && !this.validateResource(codeData.params.resource)) {
      throw new InvalidGrantError(`Invalid resource: ${String(codeData.params.resource)}`);
    }
    this.codes.delete(authorizationCode);
    const scopes = codeData.params.scopes ?? [];
    const resource = codeData.params.resource;
    return Promise.resolve(this.issueTokenPair(client.client_id, scopes, resource));
  }

  exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const entry = this.refreshTokens.get(refreshToken);
    if (!entry) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    if (entry.clientId !== client.client_id) {
      throw new InvalidGrantError("Refresh token was not issued to this client");
    }
    this.refreshTokens.delete(refreshToken);
    return Promise.resolve(this.issueTokenPair(entry.clientId, entry.scopes, entry.resource));
  }

  private issueTokenPair(clientId: string, scopes: string[], resource?: URL): OAuthTokens {
    const token = randomUUID();
    const refresh = randomUUID();
    const tokenData: TokenEntry = {
      token,
      clientId,
      scopes,
      expiresAt: Date.now() + 3600000,
      ...(resource !== undefined ? { resource } : {}),
    };
    this.tokens.set(token, tokenData);
    this.refreshTokens.set(refresh, {
      clientId,
      scopes,
      ...(resource !== undefined ? { resource } : {}),
    });
    return {
      access_token: token,
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: refresh,
      scope: scopes.join(" "),
    };
  }

  verifyAccessToken(token: string): Promise<{
    token: string;
    clientId: string;
    scopes: string[];
    expiresAt: number;
    resource?: URL;
  }> {
    const tokenData = this.tokens.get(token);
    if (tokenData?.expiresAt === undefined || tokenData.expiresAt < Date.now()) {
      throw new InvalidTokenError("Invalid or expired token");
    }
    const base = {
      token,
      clientId: tokenData.clientId,
      scopes: tokenData.scopes,
      expiresAt: Math.floor(tokenData.expiresAt / 1000),
    };
    return Promise.resolve(
      tokenData.resource !== undefined ? { ...base, resource: tokenData.resource } : base,
    );
  }
}
