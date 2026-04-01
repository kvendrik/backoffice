import { randomBytes, randomUUID } from "node:crypto";
import * as z from "zod";
import { verifyChallenge } from "pkce-challenge";
import {
  OAuthClientMetadataSchema,
  type OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import {
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import {
  InsufficientScopeError,
  InvalidClientError,
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
  OAuthError,
  ServerError,
  UnsupportedGrantTypeError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { BunMemoryOAuthProvider, redirectUriMatches } from "./memoryProvider";

const SCOPES = ["mcp:tools"] as const;

export const oauthCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version",
};

function withOAuthCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(oauthCorsHeaders)) {
    h.set(k, v);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function jsonOAuth(
  data: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  const h = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (headers !== undefined) {
    for (const [k, v] of Object.entries(headers)) {
      h.set(k, v);
    }
  }
  return withOAuthCors(new Response(JSON.stringify(data), { status, headers: h }));
}

function createErrorRedirect(redirectUri: string, error: OAuthError, state: string | undefined): string {
  const errorUrl = new URL(redirectUri);
  errorUrl.searchParams.set("error", error.errorCode);
  errorUrl.searchParams.set("error_description", error.message);
  if (error.errorUri !== undefined) {
    errorUrl.searchParams.set("error_uri", error.errorUri);
  }
  if (state !== undefined) {
    errorUrl.searchParams.set("state", state);
  }
  return errorUrl.href;
}

const ClientAuthorizationParamsSchema = z.object({
  client_id: z.string(),
  redirect_uri: z
    .string()
    .optional()
    .refine((value) => value === undefined || URL.canParse(value), {
      message: "redirect_uri must be a valid URL",
    }),
});

const RequestAuthorizationParamsSchema = z.object({
  response_type: z.literal("code"),
  code_challenge: z.string(),
  code_challenge_method: z.literal("S256"),
  scope: z.string().optional(),
  state: z.string().optional(),
  resource: z.url().optional(),
});

const TokenRequestSchema = z.object({
  grant_type: z.string(),
});

const AuthorizationCodeGrantSchema = z.object({
  code: z.string(),
  code_verifier: z.string(),
  redirect_uri: z.string().optional(),
  resource: z.url().optional(),
});

const ClientAuthenticatedFormSchema = z.object({
  client_id: z.string(),
  client_secret: z.string().optional(),
});

export interface OAuthRuntime {
  provider: BunMemoryOAuthProvider;
  oauthMetadata: ReturnType<typeof createOAuthMetadata>;
  protectedResourceMetadata: Record<string, unknown>;
  mcpServerUrl: URL;
  issuerUrl: URL;
  resourceMetadataUrl: string;
  handleOAuthRequest: (req: Request) => Promise<Response | null>;
  verifyMcpBearer: (req: Request) => Promise<{ authInfo: AuthInfo } | { response: Response }>;
}

export function createOAuthRuntime(options: {
  issuerUrl: URL;
  mcpServerUrl: URL;
  resourceName?: string;
}): OAuthRuntime {
  const { issuerUrl, mcpServerUrl, resourceName = "filesystem-mcp" } = options;

  const validateResource = (resource: URL | undefined): boolean => {
    if (resource === undefined) {
      return false;
    }
    const expected = resourceUrlFromServerUrl(mcpServerUrl);
    return resource.href === expected.href;
  };

  const provider = new BunMemoryOAuthProvider(validateResource);

  const oauthMetadata = createOAuthMetadata({
    provider: provider as unknown as OAuthServerProvider,
    issuerUrl,
    scopesSupported: [...SCOPES],
  });

  const protectedResourceMetadata: Record<string, unknown> = {
    resource: mcpServerUrl.href,
    authorization_servers: [oauthMetadata.issuer],
    scopes_supported: [...SCOPES],
    resource_name: resourceName,
  };

  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpServerUrl);

  const authorizationPath = new URL(oauthMetadata.authorization_endpoint).pathname;
  const tokenPath = new URL(oauthMetadata.token_endpoint).pathname;
  const registerPath = oauthMetadata.registration_endpoint
    ? new URL(oauthMetadata.registration_endpoint).pathname
    : null;

  const prmPath = new URL(resourceMetadataUrl).pathname;
  const asMetadataPath = "/.well-known/oauth-authorization-server";

  async function handleAuthorize(req: Request): Promise<Response> {
    let resolvedRedirect: string;
    let client: NonNullable<Awaited<ReturnType<typeof provider.clientsStore.getClient>>>;

    const phase1Raw =
      req.method === "GET"
        ? Object.fromEntries(new URL(req.url).searchParams.entries())
        : Object.fromEntries(new URLSearchParams(await req.text()).entries());

    try {
      const r1 = ClientAuthorizationParamsSchema.safeParse(phase1Raw);
      if (!r1.success) {
        throw new InvalidRequestError(r1.error.message);
      }
      const { client_id, redirect_uri } = r1.data;
      const c = await provider.clientsStore.getClient(client_id);
      if (!c) {
        throw new InvalidClientError("Invalid client_id");
      }
      client = c;
      if (redirect_uri !== undefined) {
        if (!client.redirect_uris.some((registered) => redirectUriMatches(redirect_uri, registered))) {
          throw new InvalidRequestError("Unregistered redirect_uri");
        }
        resolvedRedirect = redirect_uri;
      } else if (client.redirect_uris.length === 1) {
        const only = client.redirect_uris[0];
        if (only === undefined) {
          throw new InvalidRequestError("Unregistered redirect_uri");
        }
        resolvedRedirect = only;
      } else {
        throw new InvalidRequestError(
          "redirect_uri must be specified when client has multiple registered URIs",
        );
      }
    } catch (error) {
      if (error instanceof OAuthError) {
        const status = error instanceof ServerError ? 500 : 400;
        return jsonOAuth(error.toResponseObject(), status);
      }
      return jsonOAuth(new ServerError("Internal Server Error").toResponseObject(), 500);
    }

    let state: string | undefined;
    try {
      const parseResult = RequestAuthorizationParamsSchema.safeParse(phase1Raw);
      if (!parseResult.success) {
        throw new InvalidRequestError(parseResult.error.message);
      }
      const { scope, code_challenge, resource } = parseResult.data;
      state = parseResult.data.state;
      const requestedScopes = scope !== undefined ? scope.split(" ") : [];
      const authParams: {
        redirectUri: string;
        codeChallenge: string;
        scopes: string[];
        state?: string;
        resource?: URL;
      } = {
        redirectUri: resolvedRedirect,
        codeChallenge: code_challenge,
        scopes: requestedScopes,
      };
      if (state !== undefined) {
        authParams.state = state;
      }
      if (resource !== undefined) {
        authParams.resource = new URL(resource);
      }
      const redirectUrl = provider.buildAuthorizationRedirect(client, authParams);
      return withOAuthCors(Response.redirect(redirectUrl, 302));
    } catch (error) {
      if (error instanceof OAuthError) {
        return withOAuthCors(
          Response.redirect(createErrorRedirect(resolvedRedirect, error, state), 302),
        );
      }
      const serverError = new ServerError("Internal Server Error");
      return withOAuthCors(
        Response.redirect(createErrorRedirect(resolvedRedirect, serverError, state), 302),
      );
    }
  }

  async function authenticateClientFromForm(body: URLSearchParams): Promise<OAuthClientInformationFull> {
    const raw = Object.fromEntries(body.entries());
    const result = ClientAuthenticatedFormSchema.safeParse(raw);
    if (!result.success) {
      throw new InvalidRequestError(String(result.error));
    }
    const { client_id, client_secret } = result.data;
    const c = await provider.clientsStore.getClient(client_id);
    if (c === undefined) {
      throw new InvalidClientError("Invalid client_id");
    }
    if (c.client_secret) {
      if (client_secret === undefined || client_secret === "") {
        throw new InvalidClientError("Client secret is required");
      }
      if (c.client_secret !== client_secret) {
        throw new InvalidClientError("Invalid client_secret");
      }
      if (
        c.client_secret_expires_at !== undefined &&
        c.client_secret_expires_at < Math.floor(Date.now() / 1000)
      ) {
        throw new InvalidClientError("Client secret has expired");
      }
    }
    return c;
  }

  async function handleToken(req: Request): Promise<Response> {
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.includes("application/x-www-form-urlencoded")) {
      return jsonOAuth(
        new InvalidRequestError("Content-Type must be application/x-www-form-urlencoded").toResponseObject(),
        400,
      );
    }
    const text = await req.text();
    const body = new URLSearchParams(text);
    try {
      const client = await authenticateClientFromForm(body);
      const parseResult = TokenRequestSchema.safeParse(Object.fromEntries(body.entries()));
      if (!parseResult.success) {
        throw new InvalidRequestError(parseResult.error.message);
      }
      const { grant_type } = parseResult.data;
      switch (grant_type) {
        case "authorization_code": {
          const g = AuthorizationCodeGrantSchema.safeParse(Object.fromEntries(body.entries()));
          if (!g.success) {
            throw new InvalidRequestError(g.error.message);
          }
          const { code, code_verifier, redirect_uri, resource } = g.data;
          const codeChallenge = await provider.challengeForAuthorizationCode(client, code);
          if (!(await verifyChallenge(code_verifier, codeChallenge))) {
            throw new InvalidGrantError("code_verifier does not match the challenge");
          }
          const tokens = await provider.exchangeAuthorizationCode(
            client,
            code,
            undefined,
            redirect_uri,
            resource !== undefined ? new URL(resource) : undefined,
          );
          return jsonOAuth(tokens, 200);
        }
        case "refresh_token": {
          const rt = body.get("refresh_token");
          if (!rt) {
            throw new InvalidRequestError("Missing refresh_token parameter");
          }
          const tokens = await provider.exchangeRefreshToken(client, rt);
          return jsonOAuth(tokens, 200);
        }
        default:
          throw new UnsupportedGrantTypeError(
            "The grant type is not supported by this authorization server.",
          );
      }
    } catch (error) {
      if (error instanceof OAuthError) {
        const status = error instanceof ServerError ? 500 : 400;
        return jsonOAuth(error.toResponseObject(), status);
      }
      return jsonOAuth(new ServerError("Internal Server Error").toResponseObject(), 500);
    }
  }

  async function handleRegister(req: Request): Promise<Response> {
    try {
      const json: unknown = await req.json();
      const parseResult = OAuthClientMetadataSchema.safeParse(json);
      if (!parseResult.success) {
        throw new InvalidClientMetadataError(parseResult.error.message);
      }
      const clientMetadata = parseResult.data;
      const isPublicClient = clientMetadata.token_endpoint_auth_method === "none";
      const clientSecret = isPublicClient ? undefined : randomBytes(32).toString("hex");
      const clientIdIssuedAt = Math.floor(Date.now() / 1000);
      const clientSecretExpirySeconds = 30 * 24 * 60 * 60;
      const secretExpiryTime = clientSecretExpirySeconds > 0 ? clientIdIssuedAt + clientSecretExpirySeconds : 0;
      const clientSecretExpiresAt = isPublicClient ? undefined : secretExpiryTime;
      const newClient: OAuthClientInformationFull = {
        ...clientMetadata,
        client_secret: clientSecret,
        client_secret_expires_at: clientSecretExpiresAt,
        client_id: randomUUID(),
        client_id_issued_at: clientIdIssuedAt,
      };
      if (!provider.clientsStore.registerClient) {
        throw new ServerError("Registration not supported");
      }
      const clientInfo = await provider.clientsStore.registerClient(newClient);
      return jsonOAuth(clientInfo, 201);
    } catch (error) {
      if (error instanceof OAuthError) {
        const status = error instanceof ServerError ? 500 : 400;
        return jsonOAuth(error.toResponseObject(), status);
      }
      return jsonOAuth(new ServerError("Internal Server Error").toResponseObject(), 500);
    }
  }

  async function handleOAuthRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === asMetadataPath && req.method === "GET") {
      return jsonOAuth(oauthMetadata, 200);
    }
    if (path === prmPath && req.method === "GET") {
      return jsonOAuth(protectedResourceMetadata, 200);
    }
    if (path === authorizationPath) {
      if (req.method === "OPTIONS") {
        return withOAuthCors(new Response(null, { status: 204 }));
      }
      if (req.method === "GET" || req.method === "POST") {
        return handleAuthorize(req);
      }
      return jsonOAuth(new ServerError("Method not allowed").toResponseObject(), 405);
    }
    if (path === tokenPath) {
      if (req.method === "OPTIONS") {
        return withOAuthCors(new Response(null, { status: 204 }));
      }
      if (req.method === "POST") {
        return handleToken(req);
      }
      return jsonOAuth(new ServerError("Method not allowed").toResponseObject(), 405);
    }
    if (registerPath !== null && path === registerPath) {
      if (req.method === "OPTIONS") {
        return withOAuthCors(new Response(null, { status: 204 }));
      }
      if (req.method === "POST") {
        return handleRegister(req);
      }
      return jsonOAuth(new ServerError("Method not allowed").toResponseObject(), 405);
    }
    return null;
  }

  function buildWwwAuthHeader(errorCode: string, message: string): string {
    let header = `Bearer error="${errorCode}", error_description="${message}"`;
    header += `, resource_metadata="${resourceMetadataUrl}"`;
    return header;
  }

  async function verifyMcpBearer(req: Request): Promise<{ authInfo: AuthInfo } | { response: Response }> {
    try {
      const authHeader = req.headers.get("authorization");
      if (!authHeader) {
        throw new InvalidTokenError("Missing Authorization header");
      }
      const [type, token] = authHeader.split(" ");
      if (type === undefined || token === undefined || type.toLowerCase() !== "bearer" || token === "") {
        throw new InvalidTokenError("Invalid Authorization header format, expected 'Bearer TOKEN'");
      }
      const verified = await provider.verifyAccessToken(token);
      if (typeof verified.expiresAt !== "number" || Number.isNaN(verified.expiresAt)) {
        throw new InvalidTokenError("Token has no expiration time");
      }
      if (verified.expiresAt < Date.now() / 1000) {
        throw new InvalidTokenError("Token has expired");
      }
      const authInfo: AuthInfo = {
        token: verified.token,
        clientId: verified.clientId,
        scopes: verified.scopes,
        expiresAt: verified.expiresAt,
        ...("resource" in verified ? { resource: verified.resource } : {}),
      };
      return { authInfo };
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        return {
          response: jsonOAuth(error.toResponseObject(), 401, {
            "WWW-Authenticate": buildWwwAuthHeader(error.errorCode, error.message),
          }),
        };
      }
      if (error instanceof InsufficientScopeError) {
        return {
          response: jsonOAuth(error.toResponseObject(), 403, {
            "WWW-Authenticate": buildWwwAuthHeader(error.errorCode, error.message),
          }),
        };
      }
      if (error instanceof ServerError) {
        return { response: jsonOAuth(error.toResponseObject(), 500) };
      }
      if (error instanceof OAuthError) {
        return { response: jsonOAuth(error.toResponseObject(), 400) };
      }
      return { response: jsonOAuth(new ServerError("Internal Server Error").toResponseObject(), 500) };
    }
  }

  return {
    provider,
    oauthMetadata,
    protectedResourceMetadata,
    mcpServerUrl,
    issuerUrl,
    resourceMetadataUrl,
    handleOAuthRequest,
    verifyMcpBearer,
  };
}
