# GitHub Projects MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a publicly installable MCP server that lets Codex, Cursor, and Claude manage GitHub Projects V2 on GitHub.com and supported GitHub Enterprise Server instances.

**Architecture:** A local TypeScript/Node.js process exposes narrow MCP tools over stdio, authenticates through GitHub App device flow, and calls reviewed Projects V2 GraphQL operations. Host profiles and credentials are isolated; tokens stay in the OS credential store; no central service or arbitrary GraphQL tool is included.

**Tech Stack:** TypeScript, maintained Node.js LTS, MCP TypeScript SDK v2, Zod schemas, GitHub GraphQL API, OS credential-store adapter, npm.

**Spec:** docs/superpowers/specs/2026-11-05-github-projects-mcp-design.md; requirements: docs/requirements/2026-11-05-github-projects-mcp-requirements.md.

## Global Constraints

- The server must support GitHub.com and GitHub Enterprise Server (GHES).
- The target is Projects V2.
- Do not persist credentials in a plaintext file.
- There is no generic GraphQL execution tool.
- Expose every stable public Projects V2 GraphQL read/write operation available in the supported GitHub.com/GHES schemas and authorized for the user.
- stdout is reserved for MCP protocol messages; logs and diagnostics use stderr.
- TLS checks remain enabled.
- Support the oldest GHES release still in GitHub's support window at release time that supports required Projects V2 operations and GitHub App device flow.
- Do not publish npm packages or register external GitHub Apps without the user's explicit authorization.

## Review Focus

- Wrong host/account: explicit host argument takes precedence; omitted host resolves only to configured default, never shared mutable selection state.
- Credential exposure: logs, errors, MCP results, and config files must not include access or refresh tokens.
- Untrusted GHES URL: validate URL/endpoint construction, reject cross-host redirects, and never disable certificate validation.
- Partial GraphQL failure: distinguish HTTP success with GraphQL errors, missing permissions, unsupported schema fields, and rate limits.
- Ambiguous write retry: never replay a non-idempotent mutation after an unknown outcome.

---

## File Structure

| File | Responsibility |
|---|---|
| package.json, package-lock.json, tsconfig.json | Package metadata, build/runtime commands, compiler settings. |
| src/index.ts | CLI entry point, config load, MCP server startup, stderr-only diagnostics. |
| src/config/types.ts | Shared AppConfig and HostProfile interfaces. |
| src/config/host-profile.ts | Host profile parsing, URL normalization, endpoint resolution, host selection. |
| src/config/config-store.ts | Non-secret host configuration persistence and process-local store. |
| src/auth/device-flow.ts | GitHub App device login and token refresh for GitHub.com and GHES. |
| src/auth/token-store.ts | TokenStore interface and OS credential-store adapter. |
| src/github/graphql-client.ts | Authenticated GraphQL, pagination, errors, safe read retries. |
| src/github/capabilities.ts | Host API/schema capability discovery and compatibility report. |
| src/projects/operations.ts | Static Projects V2 GraphQL operations and typed result mapping. |
| src/tools/host-tools.ts | MCP tools for hosts, auth, connectivity, and capabilities. |
| src/tools/project-tools.ts | MCP tools for projects, views, fields, items, status, collaborators, workflows. |
| src/errors.ts | Safe structured errors and redaction helpers. |
| README.md and docs/ | Install, client setup, GHES, security, compatibility, support guidance. |

## Tasks

### Task 1: Package and MCP process foundation

**Files:** package.json, package-lock.json, tsconfig.json, src/index.ts, src/errors.ts, src/config/types.ts, .gitignore

**Interfaces:**
- Produces startServer(config: AppConfig): Promise<void>.
- AppConfig contains hosts: HostProfile[] and optional defaultHostId; both shared types live in src/config/types.ts.
- HostProfile has id, kind (github or ghes), baseUrl, graphqlUrl, and appClientId; Task 2 implements parsing and endpoint resolution.
- Uses MCP SDK v2 and Zod schemas; stdout remains protocol-only.

- [x] Create a package skeleton with build, start, typecheck, and pack scripts; set private=true until package owner/name are confirmed.
- [x] Configure TypeScript for Node.js ESM and maintained Node.js LTS.
- [x] Start an MCP server with ping/version tool and safe startup errors on stderr.
- [x] Run npm run typecheck and npm pack --dry-run; expect clean typecheck and intended package contents only.

### Task 2: Host profiles and endpoint resolution

**Files:** src/config/host-profile.ts, src/config/config-store.ts, src/tools/host-tools.ts, src/index.ts

**Interfaces:**
- HostProfile has id, kind (github or ghes), baseUrl, graphqlUrl, and appClientId.
- resolveHost(hostId: string | undefined, config: AppConfig): HostProfile.
- Every GitHub tool accepts hostId optional; omitted host uses documented default.

- [x] Normalize GitHub.com GraphQL endpoint to https://api.github.com/graphql and GHES to https://HOST/api/graphql unless explicitly configured.
- [x] Validate HTTPS, host, endpoint origin, and Client ID; preserve TLS checks and reject cross-host redirects.
- [x] Add list_hosts, add_host, remove_host, and select_host; select_host only saves a default and cannot change targets of in-flight calls.
- [x] Run npm run typecheck; expect host profiles and tool argument types to compile without public any types.

### Task 3: GitHub App device flow and credential storage

**Files:** src/auth/device-flow.ts, src/auth/token-store.ts, src/tools/host-tools.ts

**Interfaces:**
- TokenSet contains accessToken, optional refreshToken, expiresAt, and refreshTokenExpiresAt.
- TokenStore exposes get(hostId), set(hostId, tokens), and delete(hostId), all asynchronous.
- signIn(host, io) supports device instructions without exposing secrets.

- [x] Implement host-specific device-code authorization and refresh; handle pending, slow_down, expiry, denial, and revocation.
- [x] Document that GitHub App permissions are administrator-configured and that repository Issues write is needed only for draft-issue conversion; normalize permission failures when a host denies an operation.
- [x] Store credentials in the OS secure store; fail closed with remediation when unavailable.
- [x] Add sign_in (start), complete_sign_in (single poll), sign_out, and get_auth_status; isolate tokens per host, keep device codes in memory, and redact all credentials.
- [x] Run npm run typecheck; expect the auth flow and safe credential failures to compile.

### Task 4: GraphQL client and compatibility discovery

**Files:** src/github/graphql-client.ts, src/github/capabilities.ts, src/errors.ts, docs/compatibility.md

**Interfaces:**
- GraphQLClient.request<T>(host, operation: Operation<T>, variables): Promise<T>.
- Operation<T> contains name, static document, decoder, and retry class safe-read or never.
- CapabilityProfile contains hostId, optional version, supported operation names, and limitations.

- [x] Implement authenticated GraphQL requests using variables and reviewed static operations; normalize transport and GraphQL errors.
- [x] Implement bounded cursor pagination and retry safe reads only, honoring rate-limit retry timing.
- [x] Discover host/version capabilities and expose check_connection and check_capabilities.
- [x] Create compatibility matrix mapping every stable Projects V2 query/mutation to GitHub.com and supported GHES schemas; live host validation remains a release requirement.
- [x] Run npm run typecheck; expect no MCP argument can supply arbitrary GraphQL and no write operation is classified as a safe read.

### Task 5: Projects, views, fields, items, and administration

**Files:** src/projects/operations.ts, src/tools/project-tools.ts, docs/compatibility.md

**Interfaces:**
- ProjectRef has id, owner, optional number and URL.
- ProjectItem has id, type (issue, pull_request, draft_issue), title, optional URL, and field values.
- Tools use validated identifiers and field-specific values; bulk result reports succeeded IDs and per-ID safe errors.

- [x] Map project list/search/detail/create/copy/update/close/reopen/delete and repository/team/template relationships.
- [x] Map view list/create/update/delete and configuration supported by host schema.
- [x] Map custom field list/create/update/delete and supported types/options/iteration configuration.
- [x] Map item list/search/add issue or PR/create/update/convert draft/set or clear field/reorder/archive/unarchive/remove.
- [x] Map status update CRUD, collaborator operations, and workflow inventory plus only schema-supported workflow mutations.
- [x] Name each MCP tool for its action; destructive operations must clearly say delete/remove/archive.
- [x] Keep writes explicit and unbatched, and never retry ambiguous non-idempotent mutations.
- [x] Run npm run typecheck and inspect registered tool schema; expect each supported operation in the matrix to map to a typed tool or an explicit limitation.

### Task 6: Client setup, security, and release readiness

**Files:** README.md, docs/clients/codex.md, docs/clients/cursor.md, docs/clients/claude-code.md, docs/clients/claude-desktop.md, docs/ghes.md, docs/security.md, docs/compatibility.md, package.json

**Interfaces:**
- Installation examples use final package name and versioned npx command.
- Each client guide documents config location, required fields, login, disconnect, and tested client version.

- [x] Document install, GitHub.com App permissions/device flow, host configuration, all tool categories, and destructive operations.
- [x] Document GHES App registration/Client ID, endpoint, supported version, org approvals/SSO, and certificates.
- [ ] Verify configuration formats against release-time Codex, Cursor, Claude Code, and Claude Desktop documentation; record versions.
- [ ] Confirm package name/owner, MIT license, GitHub.com App owner/Client ID, GHES floor, and package metadata before setting private=false.
- [x] Run npm run typecheck and npm pack --dry-run; expect clean build and pack contents without local config or secrets.
- [x] Do not publish or create the public GitHub App without explicit user authorization.
