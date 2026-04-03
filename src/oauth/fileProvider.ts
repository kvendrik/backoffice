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
import { redirectUriMatches } from "./memoryProvider";

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

interface SerializedTokenEntry {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: string;
}

interface SerializedRefreshEntry {
  clientId: string;
  scopes: string[];
  resource?: string;
}

interface PersistedState {
  clients: [string, OAuthClientInformationFull][];
  tokens: [string, SerializedTokenEntry][];
  refreshTokens: [string, SerializedRefreshEntry][];
}

class FileBackedClientsStore implements OAuthRegisteredClientsStore {
  readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly onMutate: () => Promise<void>;

  constructor(onMutate: () => Promise<void>) {
    this.onMutate = onMutate;
  }

  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return Promise.resolve(this.clients.get(clientId));
  }

  async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    this.clients.set(client.client_id, client);
    await this.onMutate();
    return client;
  }
}

/**
 * File-backed OAuth provider. Identical behavior to BunMemoryOAuthProvider but persists
 * clients and tokens to a JSON file so OAuth state survives server restarts/deploys.
 *
 * Use `BunFileOAuthProvider.create(filePath)` for async initialization (loads existing state).
 *
 * Note: auth codes are not persisted — they're ephemeral by design (single-use, short-lived).
 */
export class BunFileOAuthProvider {
  readonly clientsStore: FileBackedClientsStore;
  private readonly codes = new Map<string, CodeEntry>();
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly refreshTokens = new Map<string, RefreshEntry>();
  private readonly validateResource: ((resource: URL | undefined) => boolean) | undefined;
  private readonly filePath: string;

  private constructor(filePath: string, validateResource?: (resource: URL | undefined) => boolean) {
    this.filePath = filePath;
    this.validateResource = validateResource;
    this.clientsStore = new FileBackedClientsStore(() => this.save());
  }

  static async create(
    filePath: string,
    validateResource?: (resource: URL | undefined) => boolean,
  ): Promise<BunFileOAuthProvider> {
    const provider = new BunFileOAuthProvider(filePath, validateResource);
    await provider.load();
    return provider;
  }

  private async load(): Promise<void> {
    const file = Bun.file(this.filePath);
    if (!(await file.exists())) {
      console.log(`[oauth] No state file at ${this.filePath} — starting fresh.`);
      return;
    }

    try {
      const state = (await file.json()) as PersistedState;
      const now = Date.now();

      for (const [id, client] of state.clients) {
        this.clientsStore.clients.set(id, client);
      }

      let expiredTokens = 0;
      for (const [token, entry] of state.tokens) {
        if (entry.expiresAt > now) {
          this.tokens.set(token, {
            ...entry,
            resource: entry.resource !== undefined ? new URL(entry.resource) : undefined,
          });
        } else {
          expiredTokens++;
        }
      }

      for (const [refresh, entry] of state.refreshTokens) {
        this.refreshTokens.set(refresh, {
          ...entry,
          resource: entry.resource !== undefined ? new URL(entry.resource) : undefined,
        });
      }

      console.log(
        `[oauth] Loaded state from ${this.filePath}: ` +
          `${String(this.clientsStore.clients.size)} client(s), ` +
          `${String(this.tokens.size)} active token(s)` +
          (expiredTokens > 0 ? ` (${String(expiredTokens)} expired, skipped)` : "") +
          `, ${String(this.refreshTokens.size)} refresh token(s).`,
      );
    } catch (err) {
      console.warn(`[oauth] Failed to load state from ${this.filePath} — starting fresh.`, err);
    }
  }

  private async save(): Promise<void> {
    const state: PersistedState = {
      clients: Array.from(this.clientsStore.clients.entries()),
      tokens: Array.from(this.tokens.entries()).map(([k, v]) => [
        k,
        { ...v, resource: v.resource?.href } as SerializedTokenEntry,
      ]),
      refreshTokens: Array.from(this.refreshTokens.entries()).map(([k, v]) => [
        k,
        { ...v, resource: v.resource?.href } as SerializedRefreshEntry,
      ]),
    };
    try {
      await Bun.write(this.filePath, JSON.stringify(state));
    } catch (err) {
      console.error(`[oauth] Failed to save state to ${this.filePath}:`, err);
      throw err;
    }
  }

  buildAuthorizationRedirect(
    client: OAuthClientInformationFull,
    params: CodeEntry["params"],
  ): string {
    if (
      !client.redirect_uris.some((registered) => redirectUriMatches(params.redirectUri, registered))
    ) {
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

  async exchangeAuthorizationCode(
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
    const tokens = this.issueTokenPair(client.client_id, scopes, resource);
    await this.save();
    return tokens;
  }

  async exchangeRefreshToken(
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
    const tokens = this.issueTokenPair(entry.clientId, entry.scopes, entry.resource);
    await this.save();
    return tokens;
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
    if (tokenData === undefined) {
      console.warn("[oauth] verifyAccessToken: token not found (unknown or already expired out of memory)");
      throw new InvalidTokenError("Invalid or expired token");
    }
    if (tokenData.expiresAt < Date.now()) {
      console.warn(
        `[oauth] verifyAccessToken: token expired for client=${tokenData.clientId} ` +
          `(expired ${String(Math.round((Date.now() - tokenData.expiresAt) / 1000))}s ago)`,
      );
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
