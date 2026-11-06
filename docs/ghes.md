# GitHub Enterprise Server

Each GHES instance needs its own host profile and GitHub App Client ID. The App must have device flow enabled by the instance administrator.

1. Set the instance's GitHub App callback-free device flow configuration and select only the permissions needed by the desired project tools.
2. Add the host with `kind: "ghes"`, `baseUrl: "https://github.example.com"`, a stable ID, and the instance-specific Client ID. The base URL must be the instance origin without a path prefix because GitHub's device endpoints are hosted at the origin root. `graphqlUrl` defaults to `https://github.example.com/api/graphql` and can be supplied for a reverse proxy on the same origin.
3. Run `sign_in` and authorize through the instance's login page, then call `complete_sign_in`.
4. Run `check_connection` and `check_capabilities` to confirm viewer access and available schema fields.

The server requires HTTPS, keeps TLS validation enabled, and rejects redirects. If the instance has a private certificate authority, configure Node.js to trust the approved certificate chain; do not disable TLS verification.

The minimum GHES release has not been set. Before public release, select the oldest GitHub-supported GHES version that supports the required Projects V2 operations and GitHub App device flow, then validate the compatibility matrix against that version. This pre-release package has not yet been tested against a live GHES instance.
