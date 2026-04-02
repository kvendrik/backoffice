# OAuth

In-memory OAuth 2.0 Authorization Server for the MCP endpoint, built on Bun (no Express). Mirrors the protocol behavior of the MCP SDK's Express-based auth handlers using Web Standard `Request`/`Response`.

## Flow

```
Client                              Server
  │                                    │
  ├─ GET /.well-known/                 │  Discovery
  │   oauth-protected-resource/mcp ──► │  (returns resource metadata)
  │                                    │
  ├─ GET /.well-known/                 │
  │   oauth-authorization-server ────► │  (returns AS metadata)
  │                                    │
  ├─ POST /register ─────────────────► │  Dynamic Client Registration
  │                                    │
  ├─ GET /authorize ─────────────────► │  Authorization Code + PKCE
  │ ◄── 302 redirect with code ────── │
  │                                    │
  ├─ POST /token ────────────────────► │  Exchange code for access_token
  │                                    │
  └─ POST /mcp (Bearer token) ──────► │  Authenticated MCP calls
```

## Files

| File                | Purpose                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `runtime.ts`        | OAuth route handling, CORS, metadata endpoints, token verification |
| `memoryProvider.ts` | In-memory client store and token/code state                        |
| `eventStore.ts`     | In-memory `EventStore` for resumable Streamable HTTP               |
| `index.ts`          | Barrel re-exports                                                  |

## Limitations

- All state (clients, codes, tokens) is **in-memory** — restarting the process clears everything.
- Single-instance only; not suited for multi-replica deployments.
- Access tokens expire after 1 hour. Refresh tokens are supported — apps like Claude.ai use them to rotate automatically.
