# Cursor setup

Add the local server to `.cursor/mcp.json` in the project or Cursor MCP settings:

```json
{
  "mcpServers": {
    "github-projects": {
      "command": "node",
      "args": ["/absolute/path/to/github-projects-mcp/dist/index.js"]
    }
  }
}
```

On Windows, use an escaped absolute path, for example `C:\\tools\\github-projects-mcp\\dist\\index.js`. Restart the MCP connection, then call `add_host` and `sign_in`. Confirm writes in Cursor's tool approval flow. This example has not been verified against a released Cursor version yet.
