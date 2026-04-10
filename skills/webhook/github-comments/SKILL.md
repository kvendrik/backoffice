# GitHub Comment Monitor

Set up a webhook that watches for new comments on a GitHub repo and fires a handler script when they arrive.

## Prerequisites

- Webhook server running (`bun /app/skills/webhook server`)
- `gh` CLI authenticated (`/data/bins/gh`)
- Backoffice deployed with a public Railway domain

## Step 1 — Write a handler script

Create `/data/handle-gh-comment.ts`:

```ts
const raw = await new Response(Bun.stdin.stream()).text();
const input = JSON.parse(raw);
const payload = JSON.parse(input.body);

// Only handle new comments
if (payload.action !== "created") process.exit(0);

const user    = payload.comment?.user?.login ?? "";
const body    = payload.comment?.body ?? "";
const htmlUrl = payload.comment?.html_url ?? "";

// Filter to a specific user — edit or remove this check
const WATCH_USER = "some-username";
if (user !== WATCH_USER) process.exit(0);

// Do something — write to a file, call another script, etc.
await Bun.write(
  `/tmp/gh-comments/${Date.now()}.json`,
  JSON.stringify({ user, body, url: htmlUrl }, null, 2),
);

console.log(`[gh-comment] ${user}: ${body.slice(0, 80)}`);
```

Adjust `WATCH_USER` or remove the filter to catch all comments.

## Step 2 — Register the webhook endpoint

```bash
bun /app/skills/webhook register \
  --secret <your-secret> \
  --cmd "bun /data/handle-gh-comment.ts" \
  --name "github-comments"
```

Copy the printed URL — you need it in step 3.

## Step 3 — Create the GitHub webhook

```bash
GIT_SSL_CAINFO=/data/cacert.pem /data/bins/gh api \
  repos/<owner>/<repo>/hooks \
  --method POST \
  --field "config[url]=<webhook-url-from-step-2>" \
  --field "config[secret]=<your-secret>" \
  --field "config[content_type]=json" \
  --field "events[]=issue_comment" \
  --field "events[]=pull_request_review_comment" \
  --field "events[]=commit_comment"
```

Replace `<owner>/<repo>` with the target repo (e.g. `kvendrik/backoffice`).

## Step 4 — Verify

```bash
# Confirm the hook was created
GIT_SSL_CAINFO=/data/cacert.pem /data/bins/gh api repos/<owner>/<repo>/hooks

# Confirm the endpoint is registered locally
bun /app/skills/webhook list
```

GitHub sends a ping event immediately on creation — the handler receives it and exits cleanly since `action` won't be `"created"`.

## Comment event payloads

All three event types share the same key fields:

| Field | Description |
|---|---|
| `action` | `"created"` for new comments |
| `comment.user.login` | GitHub username of the commenter |
| `comment.body` | Comment text (Markdown) |
| `comment.html_url` | Link to the comment |
| `repository.full_name` | `"owner/repo"` |

PR review comments also include `comment.path` (file) and `comment.position` (line).

## Teardown

```bash
# Remove the local endpoint
bun /app/skills/webhook rm <id-prefix>

# Delete the GitHub webhook
GIT_SSL_CAINFO=/data/cacert.pem /data/bins/gh api \
  repos/<owner>/<repo>/hooks/<hook-id> --method DELETE
```

Get `<hook-id>` from the `id` field in the list output.
