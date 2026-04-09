#!/bin/sh
set -e

# This script runs as root so it can set up filesystem ownership before
# dropping privileges. The server itself runs as appuser (non-root), which
# is the primary security boundary: system directories (/usr, /bin, /etc)
# and the app source (/app) are root-owned and unwritable by the process.
#
# /data needs chown here because Railway mounts volumes as root. We take
# ownership on every start so the app can read/write its persistent storage.
# gosu does a clean exec (replaces this shell process entirely) so signals
# are handled correctly and no root process lingers.

mkdir -p /data /tmp
chown -R appuser:appuser /data
exec gosu appuser bun run start
