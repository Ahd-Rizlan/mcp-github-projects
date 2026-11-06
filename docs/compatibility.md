# GitHub Projects V2 compatibility

The server uses named, static GraphQL operations. It does not expose arbitrary GraphQL execution. Every request takes a `hostId` or uses the configured default host.

## Current MCP operation coverage

| Area | MCP tools | GitHub GraphQL surface |
|---|---|---|
| Projects | `list_projects`, `list_repository_projects`, `list_team_projects`, `list_recent_projects`, `get_project`, `create_project`, `copy_project`, `update_project`, `close_project`, `reopen_project`, `delete_project` | Owner/repository/team `projectsV2`, recent-project context, owner/repository/team search, `ProjectV2`, create/copy/update/delete mutations |
| Project relationships | `link_project_repository`, `unlink_project_repository`, `link_project_team`, `unlink_project_team`, `mark_project_template`, `unmark_project_template` | Repository/team links and template mutations |
| Items | `list_project_items`, `add_project_item`, `create_draft_issue`, `update_draft_issue`, `convert_draft_issue`, `set_project_item_field`, `clear_project_item_field`, `move_project_item`, `archive_project_item`, `unarchive_project_item`, `delete_project_item` | Item connections and all item, draft issue, field value, position, archive, and remove mutations; multi-select item values are selected only when schema introspection confirms support |
| Fields | `list_project_fields`, `create_project_field`, `create_project_issue_field`, `update_project_field`, `delete_project_field` | Custom fields, organization issue fields, single-select, multi-select, iteration configuration |
| Views | `list_project_views`, `create_project_view`, `update_project_view`, `delete_project_view` | View name, layout, filter, and ordered visible fields |
| Status updates | `list_project_status_updates`, `create_project_status_update`, `update_project_status_update`, `delete_project_status_update` | Project status update connection and CRUD mutations |
| Collaborators | `update_project_collaborators` | Collaborator role replacement mutation; `NONE` removes a direct role |
| Workflows | `list_project_workflows`, `delete_project_workflow` | Workflow inventory and the public delete mutation |
| Host and authentication | `list_hosts`, `add_host`, `remove_host`, `select_host`, `sign_in`, `complete_sign_in`, `sign_out`, `get_auth_status`, `check_connection`, `check_capabilities` | Device flow, viewer/rate limit query, GraphQL schema introspection |

The public Projects reference lists the supported mutation families and documents important replacement behavior for collaborators and field options. The implementation follows that static API surface; each host can still differ. [GitHub Projects GraphQL reference](https://docs.github.com/en/graphql/reference/projects)

## Runtime compatibility discovery

Use `check_connection` to verify authenticated access and `check_capabilities` to inspect the host's query root, mutation root, `ProjectV2` fields, multi-select types, and (when the endpoint provides it) GHES version header. Some GHES administrators disable schema introspection; in that case, the server selects conservative operations without multi-select support and reports that capability details are unavailable. The capability choice is cached for the process lifetime per host endpoint. An operation that is absent from a host schema returns an actionable GraphQL error without automatically replaying the write.

This pre-release build has not yet been validated against live GitHub.com and GHES accounts. The release owner must set the minimum supported GHES version and record tested GitHub.com, GHES, Node.js, and MCP client versions here before public release. Do not infer support from a successful typecheck.

## Known API boundaries

- Workflow inventory and deletion are exposed; GitHub's public Projects GraphQL reference does not provide workflow editing operations.
- `update_project_collaborators` replaces the direct collaborator configuration. The ProjectV2 GraphQL type does not expose a direct query for reading current collaborator roles, so provide the full intended list; `NONE` removes a direct role.
- Updating select-field options replaces the option set. Existing option IDs must be supplied to preserve existing item values.
- View updates expose name, layout, filter, and visible field ordering. Although the schema returns some sort/group settings, its public view configuration input only accepts visible field IDs, so this server cannot write sort or grouping configuration.
- Multi-select field discovery, creation, updates, item values, and item writes are enabled only when host introspection confirms the corresponding schema types; when introspection is disabled, the server uses conservative queries and rejects multi-select writes with an unsupported-capability error.
- Project and item list tools return one bounded page (up to 100); pass the returned `endCursor` to fetch the next page.
- Issue conversion may require repository Issues write permission. The user's GitHub App permissions and organization policy remain authoritative.
