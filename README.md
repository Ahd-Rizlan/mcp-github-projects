# GitHub Projects MCP

A local Model Context Protocol server that lets MCP clients access GitHub Projects V2 on GitHub.com and GitHub Enterprise Server. It provides focused, typed project tools and GitHub App device sign-in.

> Pre-release: this package is not published yet. GitHub.com App registration, final package ownership, and live GitHub.com/GHES validation are still release tasks.

## Requirements

- Node.js 22 or newer
- A GitHub App Client ID with device flow enabled for each configured host
- An operating system credential store available to the current user

## Build from source

```powershell
npm install
npm run build
node .\dist\index.js
```

The server communicates over stdio. Add it to an MCP client using its absolute `dist/index.js` path and the `node` command. Keep the process attached to the client; do not run it in a separate terminal.

## First sign-in

1. Connect the MCP server to your client.
2. Call `add_host` with `kind: "github"`, a stable host `id`, and the GitHub App Client ID. For GHES, also provide the instance HTTPS `baseUrl` and its App Client ID.
3. Call `sign_in` for that host. Open the returned verification URL and enter the one-time user code.
4. After approving access, call `complete_sign_in`. If it reports `pending`, wait for the returned delay and call again.
5. Call `check_connection`, then use `list_projects` and `list_project_items`.

The host configuration is stored in the operating system's user configuration directory; tokens are stored separately in the operating system credential store. See [security and credential handling](docs/security.md) and [GHES notes](docs/ghes.md).

## Tool reference

See [compatibility and operation coverage](docs/compatibility.md). Destructive tools include `delete_project`, `delete_project_field`, `delete_project_view`, `delete_project_item`, `delete_project_status_update`, and `delete_project_workflow`. MCP clients control whether a write call requires approval.

## Client setup

Client-specific configuration examples are in `docs/clients/`. Client versions and examples must be verified again before release.
