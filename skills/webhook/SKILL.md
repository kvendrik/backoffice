# Webhook Skill

Registers HTTP endpoints that fire a shell command when a valid signed request arrives.

## Quick Start

```bash
# 1. Start the server (once per session, background: true)
bun /app/skills/webhook server

# 2. Register an endpoint
bun /app/skills/webhook register \
  --secret mysecret \
  --cmd "bun /data/handle.ts" \
  --name "my-hook"

# 3. Paste the printed URL into your webhook sender (GitHub, Shopify, etc.)
```

## Subcommands

| Command | Description |
|---|---|
| `server` | Start HTTP server on port 3002 (always `background: true`) |
| `register` | Register a new endpoint, print its public URL |
| `list` | Show all registered endpoints |
| `rm <id>` | Unregister by ID prefix |

## Register Flags

| Flag | Required | Default | Description |
|---|---|---|---|
| `--secret` | ✅ | — | HMAC-SHA256 secret matching the sender's config |
| `--cmd` | ✅ | — | Shell command fired on each valid request |
| `--name` | — | — | Human label shown in `list` |
| `--signature-header` | — | `X-Hub-Signature-256` | Header the sender puts the signature in |
| `--signature-prefix` | — | `sha256=` | Prefix to strip before comparing |
| `--signature-encoding` | — | `hex` | `hex` or `base64` |
| `--replay-ttl` | — | `86400` | Replay detection window in seconds |

## Handler Stdin

```json
{ "method": "POST", "headers": { "content-type": "application/json" }, "body": "{...}" }
```

Fire-and-forget — the endpoint returns `200` immediately without waiting for the command.

## Security

1. **HMAC-SHA256** — signature verified against raw body bytes with `timingSafeEqual`. Invalid → `401`.
2. **Replay detection** — signature used as dedup key within `--replay-ttl` window. Duplicate → `409`.
3. `--secret` is mandatory — registration fails without it.

## Service Configs

### GitHub (default)
```bash
bun /app/skills/webhook register --secret <secret> --cmd "bun /data/handle.ts"
```

### Shopify
```bash
bun /app/skills/webhook register --secret <secret> --cmd "bun /data/handle.ts" \
  --signature-header X-Shopify-Hmac-Sha256 --signature-prefix "" --signature-encoding base64
```

### Linear
```bash
bun /app/skills/webhook register --secret <secret> --cmd "bun /data/handle.ts" \
  --signature-header X-Linear-Signature --signature-prefix ""
```

## Storage

Ephemeral — `/tmp/webhooks/`, gone on container restart. Server re-registers all endpoints on startup.

- `/tmp/webhooks/registrations.json`
- `/tmp/webhooks/seen.json`

Body size limit: 64 KB. Port: `3002` (override with `WEBHOOK_PORT` env var).
