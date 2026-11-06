# GitHub Projects MCP Server — Design

**Status:** Draft for user review; implementation has not started
**Date:** 2026-11-05
**Requirements:** [Requirements draft](../../requirements/2026-11-05-github-projects-mcp-requirements.md)

## Intent

Publish a professional MCP server that lets Codex, Cursor, Claude Code, and Claude Desktop use GitHub Projects V2 from natural language. Developers should install one package locally, sign into GitHub, and work with project boards, fields, items, and progress without needing a separate integration for each client.

GitHub.com and GitHub Enterprise Server (GHES) are release targets. GitHub exposes a common GraphQL model but schemas and authentication support vary by version. The server will check host capabilities and clearly report limits instead of pretending every host behaves identically.

## Goals

- Publicly distribute a versioned npm package, provisionally named `github-projects-mcp`.
- Use one TypeScript MCP implementation over stdio across the supported clients.
- Provide GitHub App device-flow sign-in without distributing App private keys or client secrets.
- Support GitHub.com and configurable GHES instances, with App registration on the GHES instance for GHES users.
- Expose narrow, typed MCP operations for all stable public Projects V2 API capabilities available on the selected host.
- Store access and refresh credentials only in the operating system's secure credential store.
- Keep the default runtime local, with no hosted service and no central storage of user tokens or project data.

## Non-goals

- Recreating GitHub's web UI inside an MCP client.
- Supporting Projects Classic.
- Arbitrary caller-supplied GraphQL.
- A centrally hosted OAuth/token broker in the first release.
- Bypassing GitHub permissions, organization approval, or enterprise policy.
- Promising parity with UI features that the target API does not expose.

## Approaches considered

1. **Local stdio npm package — selected.** Each client launches the same local process. This is portable across the target MCP clients and keeps credentials and project data on the user's machine. GHES users supply a Client ID for an App registered on their own instance. The tradeoff is a per-client config entry and, for GHES, one additional admin setup step.
2. **Hosted Streamable HTTP service.** A single endpoint could serve many clients and centralize login. It would require hosting, OAuth callback handling, secure token storage, tenant isolation, and operational support. That adds a service and data trust boundary the user has not requested.
3. **Use only the existing GitHub connector or raw API access.** The current connector does not expose Projects board operations, and a generic GraphQL tool would be difficult for models to use safely. This does not meet the cross-client, complete Projects V2 goal.

The user selected a public, installable solution and delegated remaining choices to the assistant. The local npm package is the smallest architecture that serves all three clients while meeting the privacy and GHES goals.

## Architecture

### Runtime and package

- TypeScript on a maintained Node.js LTS version.
- Public npm package with a CLI entry point; clients launch it using `npx` or an installed binary.
- MCP stdio transport. stdout is reserved for protocol messages; logs and diagnostics use stderr.
- One MCP server process can hold multiple named host profiles (GitHub.com and one or more GHES hosts).
- Host configuration contains only non-secret values such as host URL, GitHub App Client ID, and default host selection.
- Every GitHub operation accepts an optional explicit `host` profile. If omitted, it uses a configured default host. There is no mutable “currently selected host” shared across parallel tool calls.
- Package name `github-projects-mcp` and MIT license are provisional; verify name availability and ownership before publication.

### Main modules

1. **MCP adapter:** registers stable tool names, validates arguments, and returns structured results and safe error messages.
2. **GitHub host registry:** normalizes GitHub.com and GHES URLs, maps each host to its GraphQL endpoint, and keeps authentication isolated by host.
3. **GitHub App auth:** device-code login, polling, token refresh, logout, current-user checks, and permission diagnostics.
4. **Credential store:** OS keychain integration with no plaintext persistence fallback.
5. **GraphQL client:** reviewed static operations with variables, pagination, rate-limit handling, API-version/capability checks, and request correlation.
6. **Projects service:** user-facing operations built from explicit GraphQL documents; maps GitHub's schema and errors to a consistent result model.
7. **Capability registry:** identifies which operations and field types exist on each host, avoiding hard failure when the same feature is absent on an older GHES version.

No project data is cached by default. A small in-memory capability cache may be used for a process lifetime. Any future persistent cache would require a separate design decision.

## Authentication design

### GitHub.com

1. The sign_in MCP tool starts device authorization using the public Client ID for the product GitHub App and returns GitHub's verification URL and one-time user code.
2. The assistant asks the user to authorize the App in their browser. The process stores the device code only in memory; it is never returned or persisted.
3. After the user confirms authorization, complete_sign_in polls once, respecting GitHub's interval. It returns a retry-after value if authorization is still pending, avoiding a long-running tool call.
4. Tokens are stored in the OS credential store. Requests use a user access token, so GitHub enforces both the App's granted permissions and the signed-in user's effective permissions.

### GitHub Enterprise Server

- Each GHES instance requires a GitHub App registered on that instance with device flow enabled and the minimum required Projects permissions.
- The user's local host profile contains the GHES base URL and that instance's App Client ID. It contains no App private key or client secret.
- The GitHub.com App Client ID is a public product configuration value. During development it is supplied through local configuration; before a one-command public release the product owner must supply and publish the product-owned App Client ID.
- The server uses that instance's device and token endpoints and GraphQL endpoint (`https://<HOST>/api/graphql` by default, configurable for GHES deployments).
- The setup guide explains which administrator may need to register/approve/install the App, and how to configure trusted enterprise certificates.
- The server performs a connectivity/capability check after login. It reports unsupported or missing mutations without exposing credentials.

GitHub's device flow is documented for CLI/headless applications, and App permissions must be verified against GraphQL operations. GHES has its own GraphQL endpoint and schema by release. See the source links in the requirements draft.

### Permissions and storage

- Request the minimum user permissions required for Projects V2 reads and writes. Request repository Issues permissions only for tools such as converting a draft into an issue that require them; gate those tools when the user or App has not granted the needed permission.
- Show requested permissions and the implications of write access in onboarding and package documentation.
- Do not attempt organization installation, access requests, or policy changes for the user.
- Never print or return tokens; do not log GraphQL authorization headers or private project content.
- Device authorization codes are short-lived and held in memory only; the display user code is returned only to let the user approve the sign-in.
- If no secure OS credential store is available, login fails with remediation guidance. Do not persist credentials in a plaintext file.
- `sign_out` revokes or removes locally stored credentials where the GitHub API supports revocation; it always clears the local secure-store entry.

## MCP tools and behavior

Tool names and schemas will be finalized during implementation against a written capability matrix. The first release must expose every stable, public Projects V2 GraphQL read/write operation that the supported GitHub.com and GHES schemas expose and the user is authorized to use, including related queries required to identify inputs and results. The matrix must map each API operation to a dedicated, typed MCP tool or explain why it is intentionally unavailable. There is no generic GraphQL execution tool. Tools should be grouped by purpose, return bounded/paginated results, prefer readable identifiers while accepting stable GitHub node IDs where necessary, and describe their side effects.

### Identity and host

- `list_hosts`, `add_host`, `remove_host`, `select_host`
- `sign_in`, `sign_out`, `get_auth_status`, `check_connection`, `check_capabilities`

GHES host URLs must be HTTPS unless an enterprise administrator explicitly configures an internal trusted endpoint; certificate validation remains enabled.

### Projects

- Discover/search/list projects for a user, organization, team, repository, or recent context.
- Get project metadata, views, fields, linked repositories/teams, collaborators, and status updates.
- Create, copy, update, close/reopen, and delete projects.
- Link/unlink repositories and teams; mark/unmark organization project templates where supported.

### Views and fields

- List, create, update, delete views; expose configuration GitHub's schema supports (layout, filters, sort/grouping, visible fields).
- List, create, update, delete custom fields and supported options/configuration for text, number, date, single-select, multi-select, and iteration fields.
- Explicitly report fields or view properties unsupported on a host version.

### Items and tracking

- List/search items, including issue, pull request, and draft issue content.
- Add issue/PR items; create/update/convert draft issues where supported.
- Set/clear item field values, change position, archive/unarchive, and remove an item.
- Return item URL, status, dates, assignees, iteration, and other requested field values.

### Status updates, collaborators, workflows

- List/create/update/delete project status updates.
- List and manage collaborators and roles where authorized.
- Inventory project workflows. Only expose workflow mutations actually supported and tested on a host; the first release must not claim workflow editing if the public schema only provides inventory/deletion for the relevant behavior.

### Safety for writes

- Every write tool has a specific operation name and typed inputs; there is no general `graphql` or `execute_mutation` tool.
- Destructive actions use explicit names such as `delete_project`, `delete_field`, `remove_item`, and `delete_workflow` and return a consequence summary.
- The tool does not pretend to provide its own interactive confirmation UI. MCP clients control call approval; documentation tells users to enable confirmation for destructive writes where available.
- Non-idempotent writes are not retried automatically after ambiguous network failures.
- Bulk updates are bounded and report per-item success/failure.

## GHES compatibility

- Use host-specific GraphQL endpoints, auth endpoints, TLS roots, and schema capability discovery.
- The release support floor is the oldest GHES release still within GitHub's support window at release time that supports the required Projects V2 operations and GitHub App device flow.
- Maintain a release-time compatibility matrix. Test at least one GitHub.com account and one GHES instance; add version-specific CI/schema checks when feasible.
- If some operations differ by GHES version, expose the common surface and report the missing capability with a useful explanation.
- Minimum version and supported matrix are publication criteria, not assumptions silently embedded in the client.

## Error handling and reliability

- Normalize errors for invalid input, authentication, missing permission, org/admin approval, unavailable Projects feature, unsupported host schema, API outage, rate limits, and TLS failure.
- Provide safe remediation hints, request/host context, and retry timing when known.
- Paginate all list operations and enforce conservative maximum page sizes.
- Retry safe reads on transient failures with bounded backoff; honor GitHub rate-limit headers and Retry-After data.
- Never retry non-idempotent writes without a confirmed idempotency key or a way to inspect whether the first request succeeded.

## Privacy and security

- Use static, reviewed GraphQL queries and mutations; use variables for inputs.
- Validate all MCP inputs and output sizes.
- Do not store board content after a process exits.
- Redact auth headers, tokens, and sensitive fields from logs/errors.
- Keep TLS checks on for GitHub.com and GHES.
- Publish a security policy and dependency/update process.
- Minimize required App permissions and document the difference between user-granted permissions and organization approval.

## Documentation and release

- README quick start, package install/update, initial sign-in, available tools, and example prompts.
- Separate copyable configuration examples for Codex desktop, Codex CLI, Cursor, Claude Code, and Claude Desktop, verified on release-time versions.
- GHES guide covering instance-specific App registration, Client ID setup, endpoint configuration, minimum version, permissions, SSO/admin approvals, and certificates.
- Tool reference that flags read/write/destructive operations and capability differences.
- Changelog, contribution guide, license, security policy, support policy, npm provenance and release process.
- Release process publishes versioned packages and a compatibility matrix; no publishing action occurs without the user's explicit authorization.

## Acceptance criteria

- A clean install can launch the MCP server and connect it to Codex, Cursor, and Claude using copyable client configuration.
- A GitHub.com user can sign in through device flow without manually creating a PAT.
- A GHES user can configure an instance-specific App Client ID, sign in, and query Projects V2 from a supported GHES instance.
- Each tool call targets its explicit `host` argument or the documented default; parallel calls cannot silently change the selected account/host.
- The first release includes GitHub.com, supported GHES versions, Codex desktop/CLI, Cursor, Claude Code, and Claude Desktop where local stdio MCP is supported.
- Tools cover the agreed capability matrix and respect the effective user permissions.
- CRUD and board tracking operations return correct results and handle pagination.
- Unsupported host features fail with actionable errors.
- Credentials are stored in the OS credential store, never logged, and cleared on sign-out; there is no plaintext fallback.
- Documentation lists minimum supported GitHub.com/Node/client/GHES expectations and accurately describes API gaps.

## Calls made by the assistant

- Use a local TypeScript stdio MCP package as the product's core.
- Use GitHub App device flow for GitHub.com and instance-local GitHub App registration for GHES.
- Use the current supported GHES releases that meet feature requirements as the support floor rather than choosing an arbitrary old release.
- Fail closed if secure credential storage is unavailable.
- Recommend MIT and provisional package name `github-projects-mcp`, subject to checking availability and ownership.
- Treat “all functionality” as the complete stable public Projects V2 API surface, with honest gaps where GitHub has no API or GHES differs.

## Items to resolve before implementation

- Validate operation/field/view/workflow coverage by comparing GitHub.com and target GHES schemas; narrow, rename, or defer anything unsupported.
- Select the concrete minimum GHES version at release time.
- Verify `github-projects-mcp` is available and decide the npm and GitHub owner.
- Verify client configuration for the supported release versions.
- Confirm a GitHub.com App owner and create the App registration before enabling public sign-in. GHES administrators create their instance-specific App registration.

## Sources

- [MCP TypeScript SDK: connect real hosts](https://ts.sdk.modelcontextprotocol.io/v2/get-started/real-host)
- [GitHub GraphQL Projects reference](https://docs.github.com/en/graphql/reference/projects)
- [GitHub: using the API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)
- [GitHub App device-flow token generation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub App security best practices for public clients](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
- [GHES GraphQL endpoint](https://docs.github.com/en/enterprise-server%403.22/graphql/guides/managing-enterprise-accounts)
- [GitHub Enterprise Server GitHub App device flow](https://docs.github.com/en/enterprise-server%403.19/apps/creating-github-apps/writing-code-for-a-github-app/building-a-cli-with-a-github-app)
