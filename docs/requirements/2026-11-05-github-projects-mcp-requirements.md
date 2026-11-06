# GitHub Projects MCP Server — Requirements Draft

**Status:** Draft for requirements review and brainstorming
**Date:** 2026-11-05

## 1. Purpose

Create a professional, reusable MCP server that lets AI coding clients inspect and manage GitHub Projects boards. People should be able to install the same server on their own machines and connect it to Codex, Cursor, and Claude without maintaining a separate integration for each client.

The server must support GitHub.com and GitHub Enterprise Server (GHES). Its operations should cover the capabilities exposed by the supported GitHub Projects V2 APIs, with clear errors when the server version, GitHub permissions, or API does not support a requested operation.

## 2. Goals

- Publish an installable package for individual developers and teams.
- Provide a smooth sign-in flow through a GitHub App, without asking users to create and paste a personal access token.
- Connect to GitHub.com and configurable GHES instances.
- Make Projects V2 board data available through well-named, validated MCP tools.
- Support project discovery, planning, tracking, updates, and administration to the extent allowed by GitHub's APIs and the user's permissions.
- Keep each user's credentials local and protected by the operating system's secure credential store.
- Document installation, authentication, permissions, client setup, GHES setup, and troubleshooting.

## 3. Non-goals for the first release

- Reimplementing the GitHub Projects web interface or rendering interactive boards inside an MCP client.
- Managing Projects Classic. The target is Projects V2.
- Hosting users' tokens or project data in a central service.
- Providing arbitrary GraphQL execution as an exposed MCP tool.
- Bypassing GitHub account, organization, enterprise, or project permissions.
- Promising features that GitHub's Projects V2 API does not expose on a target GitHub version.

## 4. Users and supported clients

Primary users are developers and teams using AI coding assistants to plan and track work in GitHub Projects.

The package should work as a local stdio MCP server in:

- Codex (desktop and CLI, where MCP server configuration is available)
- Cursor
- Claude Code
- Claude Desktop, where local stdio MCP servers are supported

The package exposes one MCP implementation. Each client gets a short, client-specific setup guide; client configuration differences must not require different server code.

## 5. Distribution and runtime

- Implement in TypeScript for Node.js.
- Publish a versioned package to the public npm registry, subject to choosing a package name and confirming ownership.
- Provide a one-command launch configuration (for example, `npx -y <package>`), and pin-able version guidance for teams.
- Use the MCP stdio transport for the local package. Protocol messages use stdout; diagnostics go to stderr.
- Support a maintained Node.js LTS baseline, selected during design.
- Provide reproducible builds, a lockfile, package provenance/integrity guidance, release notes, and semantic versioning.

## 6. Authentication and credential handling

### GitHub.com

- Use a project-owned GitHub App with the minimum required user permissions for the selected Projects V2 operations.
- Sign in using the GitHub App device flow, suitable for a command-line/local process. The server displays a verification URL and one-time code; the user approves access on GitHub.
- Do not distribute a GitHub App private key or client secret in the npm package.
- Request only required read/write permissions and show users a plain-language explanation before authorization.
- Store access and refresh tokens in the operating system credential store. Do not write tokens to logs, MCP responses, project files, or plaintext config.
- Provide sign-out/revoke-local-credentials behavior and handle expired/revoked tokens with a clear re-authentication message.

### GitHub Enterprise Server

- Allow a GHES base URL and GraphQL endpoint to be configured per host.
- Support a GitHub App device flow registered on the target GHES instance, if that instance/version supports the required Projects V2 API and App flow.
- Do not assume the GitHub.com App registration can authenticate to a self-hosted GHES appliance. The setup guide must explain instance-specific App registration and which administrator actions may be required.
- Proposed default: GHES customers provide the Client ID of an App registered on that GHES instance; the package has no central service and never needs an App private key or client secret.
- Detect unsupported endpoints, versions, permissions, TLS/certificate errors, and unavailable Projects V2 features and report actionable diagnostics.
- Support enterprise TLS requirements without silently disabling certificate checks.

### Authorization behavior

- All API operations run as the authorizing user and remain subject to the user's GitHub permissions and any organization approval policy.
- The MCP server must not elevate privileges, install an app on an organization, or change an app's permissions on the user's behalf.
- Distinguish authentication failure, missing app approval/installation, insufficient access, unsupported API operation, and rate limiting.
- Operations against multiple configured hosts must accept an explicit host selector or use a documented default; parallel calls must not depend on mutable shared host-selection state.

## 7. Functional requirements

The MCP surface should use clear, narrow tools, with typed inputs, bounded pagination, predictable outputs, and descriptions that tell the model when an operation changes GitHub state.

### 7.1 Identity and connectivity

- Sign in, report authenticated account and host, check connection, refresh credentials, and sign out.
- List configured GitHub hosts and select the host for a request.
- Never return secrets or full credential values.

### 7.2 Project discovery and lifecycle

- List and search Projects V2 owned by a user or organization and projects associated with repositories.
- Fetch project details, URL, owner, status, fields, views, collaborators, linked repositories/teams, and status updates where available.
- Create, copy, rename/update, close/reopen, archive where supported, and delete projects.
- Link/unlink projects to repositories and teams.
- Mark/unmark organization projects as templates where supported.
- Make destructive operations explicit in tool names and responses; return the project identity and effect.

### 7.3 Views and board layouts

- List, inspect, create, update, and delete project views where supported by the target API.
- Read and update the view configuration exposed by GitHub, such as layout, grouping, sorting, filters, and visible fields when available.
- Report API/version limitations instead of silently dropping unsupported configuration.

### 7.4 Fields and iterations

- List built-in and custom fields and their options.
- Create, update, and delete supported text, number, date, single-select, multi-select, and iteration fields.
- Read and update iteration configuration and field options where the API exposes them.
- Validate field identifiers, option identifiers, and value types before sending mutations.

### 7.5 Project items and tracking

- List and search project items with pagination and useful filters.
- Add existing issues and pull requests; create and edit draft issues; convert draft issues to repository issues where supported.
- Update issue/PR/draft fields, including status, assignee, priority, dates, iteration, and other supported custom-field values.
- Clear field values, reorder items, archive/unarchive items, and remove items from projects.
- Return source issue/PR URLs and relevant project field values to support status and progress tracking.

### 7.6 Status updates and collaborators

- List, create, update, and delete project status updates where supported.
- Read and manage project collaborators and roles where permitted.
- Explain when collaborator changes require project owner/admin permissions.

### 7.7 Workflows and automation

- Inventory project workflows and expose workflow operations only where the target Projects V2 API supports them safely.
- Do not imply an automation can be created or edited if the public API only exposes reading or deletion for that workflow behavior.
- Preserve existing workflow behavior when making unrelated project changes.

### 7.8 API coverage and honest limits

- Aim for complete coverage of public Projects V2 read/write operations that are stable and available in supported GitHub.com/GHES versions.
- Maintain an API capability matrix by operation and host/version.
- For each unavailable or unsupported operation, return the reason and a manual GitHub UI path when practical.
- Recheck the capability matrix during release preparation as GitHub's API evolves.

## 8. Safety, privacy, and reliability

- Use GitHub GraphQL with explicit, reviewed query/mutation documents; no caller-provided arbitrary GraphQL.
- Validate and bound inputs, result sizes, pagination, and mutation batches.
- Use safe retry behavior for reads and rate-limit responses. Do not automatically retry non-idempotent writes unless the request can be safely deduplicated.
- For destructive operations (project deletion, field deletion, item removal, collaborator removal, workflow deletion), tool descriptions and results must state the consequence. The MCP client remains responsible for any user approval prompt.
- Avoid storing project content locally. Any local cache must be optional, bounded, and documented; default behavior should fetch live data.
- Never log authorization headers, tokens, draft issue content, or other unnecessary private project data.
- If an OS credential store is unavailable, fail closed with setup guidance; never fall back to plaintext token storage.
- Return structured errors with host, operation, and remediation guidance, while omitting secrets and sensitive payloads.
- Support GitHub GraphQL pagination and rate limits, including actionable retry timing.
- Keep stdout exclusively for the MCP protocol.

## 9. Documentation and adoption

- Quick start for npm install and sign-in.
- Copyable configuration for Codex, Cursor, Claude Code, and Claude Desktop where supported.
- GitHub.com permissions and App authorization explanation.
- GHES setup guide covering host URL, per-instance App registration, minimum supported server/API capabilities, organization approval, and certificate requirements.
- Tool catalog organized by read, write, and destructive operations.
- Troubleshooting for auth, app approvals, missing Projects permissions, GHES versions, API limits, and client configuration.
- Security policy, support policy, contribution guide, changelog, and license.

## 10. Acceptance criteria

- A new user can install the published package, sign in through the GitHub App flow, and use it from each supported MCP client using documented configuration.
- The server can connect to GitHub.com and at least one supported GHES instance without changing source code.
- Read and write tools cover the agreed Projects V2 capability matrix and respect the authenticated user's permissions.
- Common API limitations and authentication problems produce actionable messages.
- Secrets are stored using the platform credential store, are never logged, and can be removed through sign-out.
- Package releases are versioned and accompanied by client setup guides, GHES guidance, security documentation, and a clear feature matrix.

## 11. Decisions captured so far

- Product: a reusable MCP server for GitHub Projects, used by Codex, Cursor, and Claude.
- Distribution: public, individually installable package; local stdio runtime is the initial model.
- Implementation language: TypeScript/Node.js proposed.
- GitHub surface: Projects V2.
- Coverage goal: all stable public Projects V2 API operations available on supported targets; no claim of UI parity where GitHub exposes no API.
- Hosting targets: GitHub.com and GitHub Enterprise Server from the first release.
- Authentication: GitHub App sign-in, with device flow proposed for the local CLI process.
- GHES authentication proposal: local device flow against a GitHub App registered on that GHES instance; the user/admin configures that instance's Client ID.
- Credential storage proposal: fail closed rather than save credentials in plaintext if the OS secure store is unavailable.
- Client setup: Codex desktop/CLI, Cursor, Claude Code, and Claude Desktop where local stdio MCP is supported.
- License/package naming: recommend MIT and a provisional `github-projects-mcp` name, subject to package name and ownership checks before publication.
- Release scope: GitHub.com, supported GHES releases, Codex desktop/CLI, Cursor, Claude Code, and Claude Desktop where local stdio MCP is supported are first-release targets.
- User's requested workflow: requirements draft first, then brainstorm/refine, then begin implementation.

## 12. Open questions for brainstorming

1. The exact supported Projects V2 operation set must be mapped against GitHub.com and supported GHES schemas before implementation and publication.
2. The minimum GHES version must be selected after checking GitHub's active support window and validating the required Project V2 mutations and GitHub App device flow against real instances.
3. The provisional package name `github-projects-mcp` must be checked for availability, and its npm/GitHub organization ownership confirmed before publication.
4. Claude Desktop configuration and behavior must be verified against the MCP support in the release-time client version.

## 13. Source references

- [MCP TypeScript SDK: connect real hosts](https://ts.sdk.modelcontextprotocol.io/v2/get-started/real-host)
- [GitHub GraphQL Projects reference](https://docs.github.com/en/graphql/reference/projects)
- [GitHub: using the API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)
- [GitHub App device-flow token generation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub App security best practices for public clients](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
- [GHES GraphQL endpoint](https://docs.github.com/en/enterprise-server%403.22/graphql/guides/managing-enterprise-accounts)
- [GitHub Enterprise Server GitHub App device flow](https://docs.github.com/en/enterprise-server%403.20/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
