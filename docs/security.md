# Security and credential handling

## Credentials

- GitHub App access and refresh tokens are saved per host in the operating system credential store through `@napi-rs/keyring`.
- Device codes remain in process memory. Only the short-lived user code and verification URL are returned so the user can authorize the app.
- Tokens are not written to the JSON host configuration, MCP output, or logs. Errors use generic messages and redact common GitHub token formats.
- `sign_out` removes the local credential and pending device flow. The GitHub App authorization is not revoked; users can revoke it from GitHub settings.
- If the operating system credential store cannot be accessed, authentication fails closed. There is no plaintext token-file fallback.

On Linux, secure storage depends on the system credential backend. The selected keyring library can fall back to the kernel keyring, whose contents may not persist across reboot. Users may need to sign in again after restart when Secret Service is unavailable.

## Network and API safety

- GitHub.com and GHES endpoints require HTTPS. GHES GraphQL endpoints must use the configured instance's origin.
- Redirects are rejected and TLS certificate validation stays enabled.
- GraphQL documents are static and named; all user-provided values are sent as variables. There is no generic query or mutation tool.
- Read retries are bounded. Mutations are never retried after an ambiguous network failure.
- Project content is fetched on demand and is not persisted after the process exits.

## App permissions

The GitHub App registration must request only the permissions needed for Projects V2 access and any enabled repository issue operation. GitHub's effective user permissions, organization approval, SSO, and enterprise policy can further restrict access. A maintainer must verify the final permission set and device-flow configuration before registering the public GitHub.com App.

## Release security work

Before publishing, review dependency licenses and update policy, provide a security contact and vulnerability-reporting instructions, confirm the GitHub App owner and Client ID, and verify that no secret values appear in package contents or diagnostics.
