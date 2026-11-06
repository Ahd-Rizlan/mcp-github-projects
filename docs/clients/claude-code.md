# Claude Code setup

Register the local stdio server with Claude Code's MCP configuration:

```sh
claude mcp add github-projects -- node /absolute/path/to/github-projects-mcp/dist/index.js
```

Then use `add_host` and `sign_in`. Review Claude Code's approval behavior for write tools before using destructive operations. Verify this command against the Claude Code version you install; the package is pre-release.
