# Codex setup

Build the package from source and point the MCP server entry to the absolute `dist/index.js` path. In Codex MCP configuration, use:

```toml
[mcp_servers.github-projects]
command = "node"
args = ["C:\\path\\to\\github-projects-mcp\\dist\\index.js"]
```

Restart or reload MCP servers, then use `add_host` and `sign_in`. Confirm writes in Codex's tool approval flow. This example has not been verified against a released Codex version yet.
