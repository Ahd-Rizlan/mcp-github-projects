# Claude Desktop setup

Add a server entry to Claude Desktop's `claude_desktop_config.json`:

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

On Windows, use an escaped absolute path. Restart Claude Desktop, then call `add_host` and `sign_in`. Review its write approval settings before using destructive tools. Verify the configuration path and behavior against your installed version.
