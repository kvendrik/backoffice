## T1

- [ ] Oauth persistance between sessions does not work. When Railway redeploys and Claude tries to query the MCP the MCP throws an error I can't see because Claude just says "An error occured during tool execution".

- [ ] install packages to /data for persistence from Bun and brew
- [ ] learn from the MEMORY file Claude saved
- [ ] Tool call logs

## T2

- [ ] The open registration endpoint — anyone can POST to /oauth/register without auth. Not in the security section at all. It's not dangerous but it's a DoS surface worth a note.
- [ ] Authorization codes don't expire — the README says access tokens are short-lived (true), but doesn't mention that auth codes live until used or until the server restarts. Minor, but incomplete picture of the token lifecycle.
- [ ] The shell bypass via scripting runtimes — the README says "no shell" and that's technically true, but bun -e is effectively a shell. The README does say the guardrails don't protect against a "determined or compromised model," which covers it implicitly — but the specific mechanism is left to the reader's imagination.
