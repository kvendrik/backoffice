# Persistence: Baked Images vs Runtime Install

## Problem

Backoffice's security model relies on ephemeral infrastructure (fresh container per deploy), but its value grows with persistence — installed CLIs, config files, cached data. Today the answer is Railway Volumes, which works but has downsides:

- **Fragile.** CLIs installed at runtime (e.g. `bun install -g strava`) depend on the volume surviving. Volume loss means manual reinstall.
- **Not reproducible.** Two deploys of the same repo can have different CLIs installed depending on what the AI did in previous sessions.
- **Slow first run.** Every new deploy or volume reset requires the AI to reinstall everything before it can do useful work.

## Proposal: User-Defined Dockerfile

Let users define a Dockerfile (or a simpler manifest) that bakes their CLIs into the image. Backoffice ships a base image; users extend it.

### Option A: Dockerfile Extension

Users add a `Dockerfile` to their Backoffice fork:

```dockerfile
FROM backoffice:latest

RUN bun install -g @kvendrik/strava
RUN apt-get update && apt-get install -y ffmpeg
```

Railway (and most hosts) auto-detect Dockerfiles and build from them. Deploys are self-contained — every fresh container has the same CLIs, no volume needed for tool installation.

Volumes would still be used for **data** (tokens, caches, user files), but not for **tooling**.

### Option B: `backoffice.json` Manifest

A simpler alternative — a JSON file that declares what to install:

```json
{
  "packages": {
    "bun": ["@kvendrik/strava"],
    "apt": ["ffmpeg", "jq"]
  }
}
```

Backoffice reads this on startup and installs missing packages. Simpler than a Dockerfile but slower (installs happen at boot) and less flexible.

### Option C: Both

Ship a CLI (`backoffice init`) that generates a Dockerfile from a `backoffice.json`. Users get the simplicity of a manifest with the reproducibility of a baked image.

## Recommendation

**Start with Option A** (Dockerfile). It's the most standard approach, requires zero new code, and Railway already supports it. Document the pattern in the README with an example. Option B/C can come later if users find Dockerfiles too much friction.

### What Changes

1. Add a `Dockerfile.example` to the repo showing how to extend the base image with CLIs.
2. Publish a base Docker image (`ghcr.io/kvendrik/backoffice:latest` or similar) that users `FROM`.
3. Update the README to describe the two persistence strategies: Volumes for data, Dockerfile for tooling.
4. Update AGENT.md so the AI knows which CLIs are pre-installed and doesn't try to install them at runtime.

### What Doesn't Change

- Volumes remain the answer for runtime data (tokens, files the AI creates, caches).
- The security model stays the same — the container is still ephemeral and isolated, just pre-loaded with tools.
- No new server code needed for Option A.
