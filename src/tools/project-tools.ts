import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { SafeError, safeErrorMessage } from "../errors.js";
import { resolveHost } from "../config/host-profile.js";
import type { ConfigStore } from "../config/config-store.js";
import type { TokenStore } from "../auth/token-store.js";
import { GraphQLClient, type Operation } from "../github/graphql-client.js";
import { discoverCapabilities, type CapabilityProfile } from "../github/capabilities.js";
import * as ops from "../projects/operations.js";

type ToolShape = z.ZodRawShape;
type ToolInput<S extends ToolShape> = z.output<z.ZodObject<S>>;
type VariableMapper<S extends ToolShape> = (input: ToolInput<S>) => Readonly<Record<string, unknown>>;

async function safeCall(handler: () => Promise<unknown>) {
  try {
    const result = await handler();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text" as const, text: safeErrorMessage(error) }] };
  }
}

export function registerProjectTools(server: McpServer, store: ConfigStore, tokenStore: TokenStore): void {
  const client = new GraphQLClient(tokenStore);
  const capabilitiesByHost = new Map<string, CapabilityProfile>();
  const getCapabilities = async (host: ReturnType<typeof resolveHost>): Promise<CapabilityProfile> => {
    const key = `${host.id}:${host.graphqlUrl.toString()}`;
    let profile = capabilitiesByHost.get(key);
    if (!profile) {
      profile = await discoverCapabilities(client, host);
      capabilitiesByHost.set(key, profile);
    }
    return profile;
  };
  const register = <S extends ToolShape>(name: string, description: string, schema: z.ZodObject<S>, operation: Operation<unknown>, variables: VariableMapper<S>) => {
    server.registerTool(name, { description, inputSchema: schema }, async (input) => safeCall(async () => {
      const parsed = input as ToolInput<S> & { hostId?: string };
      const host = resolveHost(parsed.hostId, store.get());
      return client.request(host, operation, variables(parsed));
    }));
  };

  const hostId = { hostId: z.string().optional() };
  const projectId = z.string().min(1);
  const itemId = z.string().min(1);
  const page = { first: z.number().int().min(1).max(100).default(50), after: z.string().nullable().optional() };
  const fieldOption = z.object({ id: z.string().optional(), name: z.string().min(1).max(256), color: z.enum(["BLUE", "GRAY", "GREEN", "ORANGE", "PINK", "PURPLE", "RED", "YELLOW"]), description: z.string().max(1000) });
  const iteration = z.object({ id: z.string().optional(), title: z.string().min(1).max(256), startDate: z.iso.date(), duration: z.number().int().min(1).max(365) });
  const iterationConfiguration = z.object({ startDate: z.iso.date(), duration: z.number().int().min(1).max(365), iterations: z.array(iteration).max(100) });

  register("list_projects", "List or search Projects V2 owned by a GitHub user or organization. Search by project name and paginate with the returned endCursor.", z.object({ ...hostId, login: z.string().min(1), ...page, query: z.string().max(256).optional() }), ops.listOwnerProjects, ({ login, first, after, query }) => ({ login, first, after: after ?? null, query: query ?? null }));
  register("list_repository_projects", "List or search Projects V2 linked to a repository. Paginate with the returned endCursor.", z.object({ ...hostId, owner: z.string().min(1), repository: z.string().min(1), ...page, query: z.string().max(256).optional() }), ops.listRepositoryProjects, ({ owner, repository, first, after, query }) => ({ owner, name: repository, first, after: after ?? null, query: query ?? null }));
  register("list_team_projects", "List or search Projects V2 that a team can access. Paginate with the returned endCursor.", z.object({ ...hostId, organization: z.string().min(1), teamSlug: z.string().min(1), ...page, query: z.string().max(256).optional() }), ops.listTeamProjects, ({ organization, teamSlug, first, after, query }) => ({ organization, slug: teamSlug, first, after: after ?? null, query: query ?? null }));
  const recentProjectsSchema = z.object({ ...hostId, ownerKind: z.enum(["user", "organization", "repository"]), login: z.string().min(1).optional(), repositoryOwner: z.string().min(1).optional(), repository: z.string().min(1).optional(), ...page }).refine((value) => value.ownerKind === "repository" ? Boolean(value.repositoryOwner && value.repository && !value.login) : Boolean(value.login && !value.repositoryOwner && !value.repository));
  server.registerTool("list_recent_projects", {
    description: "List recently modified Projects V2 in a user, organization, or repository context. Results are bounded to 100 per call; use endCursor to continue.",
    inputSchema: recentProjectsSchema,
  }, async (input) => safeCall(async () => {
    const parsed = input as ToolInput<typeof recentProjectsSchema.shape> & { hostId?: string; ownerKind: "user" | "organization" | "repository"; login?: string; repositoryOwner?: string; repository?: string; first: number; after?: string | null };
    const host = resolveHost(parsed.hostId, store.get());
    const operation = parsed.ownerKind === "repository" ? ops.listRecentRepositoryProjects : ops.listRecentOwnerProjects;
    const variables = parsed.ownerKind === "repository"
      ? { owner: parsed.repositoryOwner, name: parsed.repository, first: parsed.first, after: parsed.after ?? null }
      : { login: parsed.login, first: parsed.first, after: parsed.after ?? null };
    return client.request(host, operation, variables);
  }));
  register("get_project", "Get Projects V2 metadata by stable project node ID.", z.object({ ...hostId, projectId }), ops.getProject, ({ projectId: id }) => ({ projectId: id }));
  const itemListSchema = z.object({ ...hostId, projectId, ...page, query: z.string().max(256).optional(), includeArchived: z.boolean().default(false) });
  server.registerTool("list_project_items", {
    description: "List issue, pull request, and draft issue items with field values. Results are bounded to 100 items per call; use endCursor for the next page. An optional search query filters results; includeArchived also returns archived items. Multi-select values are included when the host schema exposes them.",
    inputSchema: itemListSchema,
  }, async (input) => safeCall(async () => {
    const parsed = input as ToolInput<typeof itemListSchema.shape> & { hostId?: string };
    const host = resolveHost(parsed.hostId, store.get());
    const capability = await getCapabilities(host);
    const operation = capability.itemFieldValueTypes.includes("ProjectV2ItemFieldMultiSelectValue") ? ops.getProjectItemsWithMultiSelect : ops.getProjectItems;
    return client.request(host, operation, {
      projectId: parsed.projectId,
      first: parsed.first,
      after: parsed.after ?? null,
      query: parsed.query ?? null,
      archivedStates: parsed.includeArchived ? ["NOT_ARCHIVED", "ARCHIVED"] : ["NOT_ARCHIVED"],
    });
  }));
  const projectFieldsSchema = z.object({ ...hostId, projectId, ...page });
  server.registerTool("list_project_fields", {
    description: "List built-in, custom, single-select, iteration, and when supported multi-select fields. Results are bounded to 100 fields per call; use endCursor for the next page.",
    inputSchema: projectFieldsSchema,
  }, async (input) => safeCall(async () => {
    const parsed = input as ToolInput<typeof projectFieldsSchema.shape> & { hostId?: string };
    const host = resolveHost(parsed.hostId, store.get());
    const capability = await getCapabilities(host);
    const operation = capability.fieldConfigurationTypes.includes("ProjectV2MultiSelectField") ? ops.listProjectFieldsWithMultiSelect : ops.listProjectFields;
    return client.request(host, operation, { projectId: parsed.projectId, first: parsed.first, after: parsed.after ?? null });
  }));

  register("create_project", "Create a project owned by a GitHub user or organization, optionally linked to a repository or team. IDs must be GitHub node IDs.", z.object({ ...hostId, ownerId: z.string().min(1), title: z.string().min(1).max(256), repositoryId: z.string().min(1).optional(), teamId: z.string().min(1).optional() }), ops.createProject, ({ ownerId, title, repositoryId, teamId }) => ({ ownerId, title, repositoryId, teamId }));
  register("copy_project", "Copy a project to a selected user or organization. Draft issues can be included.", z.object({ ...hostId, projectId, ownerId: z.string().min(1), title: z.string().min(1).max(256), includeDraftIssues: z.boolean().default(false) }), ops.copyProject, ({ projectId: id, ownerId, title, includeDraftIssues }) => ({ projectId: id, ownerId, title, includeDraftIssues }));
  register("update_project", "Update project title, description, readme, or visibility. Provide at least one field to change.", z.object({ ...hostId, projectId, title: z.string().min(1).max(256).optional(), shortDescription: z.string().max(280).nullable().optional(), readme: z.string().max(50_000).nullable().optional(), public: z.boolean().optional() }).refine((value) => value.title !== undefined || value.shortDescription !== undefined || value.readme !== undefined || value.public !== undefined), ops.updateProject, ({ projectId: id, ...changes }) => ({ projectId: id, ...changes }));
  register("close_project", "Close a project while preserving its data.", z.object({ ...hostId, projectId }), ops.closeProject, ({ projectId: id }) => ({ projectId: id }));
  register("reopen_project", "Reopen a previously closed project.", z.object({ ...hostId, projectId }), ops.reopenProject, ({ projectId: id }) => ({ projectId: id }));
  register("delete_project", "Permanently delete a project and its project data. This cannot be undone.", z.object({ ...hostId, projectId }), ops.deleteProject, ({ projectId: id }) => ({ projectId: id }));
  register("mark_project_template", "Mark a project as an organization template where supported.", z.object({ ...hostId, projectId }), ops.markProjectTemplate, ({ projectId: id }) => ({ projectId: id }));
  register("unmark_project_template", "Remove a project template designation.", z.object({ ...hostId, projectId }), ops.unmarkProjectTemplate, ({ projectId: id }) => ({ projectId: id }));
  register("link_project_repository", "Link a repository to a project using both GitHub node IDs.", z.object({ ...hostId, projectId, repositoryId: z.string().min(1) }), ops.linkProjectRepository, ({ projectId: id, repositoryId }) => ({ projectId: id, repositoryId }));
  register("unlink_project_repository", "Unlink a repository from a project using both GitHub node IDs.", z.object({ ...hostId, projectId, repositoryId: z.string().min(1) }), ops.unlinkProjectRepository, ({ projectId: id, repositoryId }) => ({ projectId: id, repositoryId }));
  register("link_project_team", "Link a team to a project using both GitHub node IDs.", z.object({ ...hostId, projectId, teamId: z.string().min(1) }), ops.linkProjectTeam, ({ projectId: id, teamId }) => ({ projectId: id, teamId }));
  register("unlink_project_team", "Unlink a team from a project using both GitHub node IDs.", z.object({ ...hostId, projectId, teamId: z.string().min(1) }), ops.unlinkProjectTeam, ({ projectId: id, teamId }) => ({ projectId: id, teamId }));

  register("add_project_item", "Add an existing issue or pull request to a project by its GitHub node ID.", z.object({ ...hostId, projectId, contentId: z.string().min(1) }), ops.addProjectItem, ({ projectId: id, contentId }) => ({ projectId: id, contentId }));
  register("create_draft_issue", "Create a draft issue and add it to a project.", z.object({ ...hostId, projectId, title: z.string().min(1).max(256), body: z.string().max(65_536).default("") }), ops.addDraftIssue, ({ projectId: id, title, body }) => ({ projectId: id, title, body }));
  register("update_draft_issue", "Update a draft issue title or body.", z.object({ ...hostId, draftIssueId: itemId, title: z.string().min(1).max(256).optional(), body: z.string().max(65_536).optional() }).refine((value) => value.title !== undefined || value.body !== undefined), ops.updateDraftIssue, ({ draftIssueId, ...changes }) => ({ draftIssueId, ...changes }));
  register("convert_draft_issue", "Convert a draft issue item to a repository issue. Requires repository Issues write permission.", z.object({ ...hostId, itemId, repositoryId: z.string().min(1) }), ops.convertDraftIssue, ({ itemId: id, repositoryId }) => ({ itemId: id, repositoryId }));
  const setItemFieldSchema = z.object({ ...hostId, projectId, itemId, fieldId: z.string().min(1), value: z.object({ text: z.string().optional(), number: z.number().optional(), date: z.iso.date().optional(), singleSelectOptionId: z.string().optional(), multiSelectOptionIds: z.array(z.string()).optional(), iterationId: z.string().optional() }).refine((value) => Object.values(value).filter((part) => part !== undefined).length === 1) });
  server.registerTool("set_project_item_field", {
    description: "Set a project item's custom field value. Exactly one of text, number, date, singleSelectOptionId, multiSelectOptionIds, or iterationId must be supplied. Multi-select is available only when the host schema supports it.",
    inputSchema: setItemFieldSchema,
  }, async (input) => safeCall(async () => {
    const parsed = input as ToolInput<typeof setItemFieldSchema.shape> & { hostId?: string };
    const host = resolveHost(parsed.hostId, store.get());
    if (parsed.value.multiSelectOptionIds) {
      const capability = await getCapabilities(host);
      if (!capability.customFieldTypes.includes("MULTI_SELECT")) throw new SafeError("This GitHub host schema does not support multi-select Project fields.", "unsupported_capability");
    }
    return client.request(host, ops.updateItemField, { projectId: parsed.projectId, itemId: parsed.itemId, fieldId: parsed.fieldId, value: parsed.value });
  }));
  register("clear_project_item_field", "Clear a project item's field value.", z.object({ ...hostId, projectId, itemId, fieldId: z.string().min(1) }), ops.clearItemField, ({ projectId: project, itemId: item, fieldId }) => ({ projectId: project, itemId: item, fieldId }));
  register("archive_project_item", "Archive a project item while preserving its history.", z.object({ ...hostId, projectId, itemId }), ops.archiveProjectItem, ({ projectId: project, itemId: item }) => ({ projectId: project, itemId: item }));
  register("unarchive_project_item", "Restore an archived project item.", z.object({ ...hostId, projectId, itemId }), ops.unarchiveProjectItem, ({ projectId: project, itemId: item }) => ({ projectId: project, itemId: item }));
  register("move_project_item", "Move a project item before the selected item, or to the top when afterId is null.", z.object({ ...hostId, projectId, itemId, afterId: z.string().nullable().optional() }), ops.moveProjectItem, ({ projectId: project, itemId: item, afterId }) => ({ projectId: project, itemId: item, afterId: afterId ?? null }));
  register("delete_project_item", "Remove a project item permanently from the project. This does not delete its linked issue or pull request.", z.object({ ...hostId, projectId, itemId }), ops.deleteProjectItem, ({ projectId: project, itemId: id }) => ({ projectId: project, itemId: id }));
  const createFieldSchema = z.object({ ...hostId, projectId, name: z.string().min(1).max(256), dataType: z.enum(["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "MULTI_SELECT", "ITERATION"]), singleSelectOptions: z.array(fieldOption).min(1).max(100).optional(), multiSelectOptions: z.array(fieldOption).min(1).max(100).optional(), iterationConfiguration: iterationConfiguration.optional() }).refine((value) => value.dataType !== "SINGLE_SELECT" || Boolean(value.singleSelectOptions?.length)).refine((value) => value.dataType !== "MULTI_SELECT" || Boolean(value.multiSelectOptions?.length)).refine((value) => value.dataType !== "ITERATION" || Boolean(value.iterationConfiguration)).refine((value) => value.dataType === "SINGLE_SELECT" || value.singleSelectOptions === undefined).refine((value) => value.dataType === "MULTI_SELECT" || value.multiSelectOptions === undefined).refine((value) => value.dataType === "ITERATION" || value.iterationConfiguration === undefined);
  server.registerTool("create_project_field", {
    description: "Create a text, number, date, single-select, multi-select, or iteration field. Select options and iteration configuration are required for the matching field types. Multi-select is available only when the host schema supports it.",
    inputSchema: createFieldSchema,
  }, async (input) => safeCall(async () => {
    const parsed = input as ToolInput<typeof createFieldSchema.shape> & { hostId?: string };
    const host = resolveHost(parsed.hostId, store.get());
    const capability = parsed.dataType === "MULTI_SELECT" ? await getCapabilities(host) : undefined;
    if (parsed.dataType === "MULTI_SELECT" && (!capability?.customFieldTypes.includes("MULTI_SELECT") || !capability.fieldConfigurationTypes.includes("ProjectV2MultiSelectField"))) {
      throw new SafeError("This GitHub host schema does not support multi-select Project fields.", "unsupported_capability");
    }
    const operation = capability ? ops.createProjectFieldWithMultiSelect : ops.createProjectField;
    return client.request(host, operation, { projectId: parsed.projectId, name: parsed.name, dataType: parsed.dataType, singleSelectOptions: parsed.singleSelectOptions, ...(capability ? { multiSelectOptions: parsed.multiSelectOptions } : {}), iterationConfiguration: parsed.iterationConfiguration });
  }));
  register("create_project_issue_field", "Add an organization issue field to a project using its issue field node ID.", z.object({ ...hostId, projectId, issueFieldId: z.string().min(1) }), ops.createProjectIssueField, ({ projectId: id, issueFieldId }) => ({ projectId: id, issueFieldId }));
  const updateFieldSchema = z.object({ ...hostId, fieldId: z.string().min(1), name: z.string().min(1).max(256).optional(), singleSelectOptions: z.array(fieldOption).max(100).optional(), multiSelectOptions: z.array(fieldOption).max(100).optional(), iterationConfiguration: iterationConfiguration.optional() }).refine((value) => value.name !== undefined || value.singleSelectOptions !== undefined || value.multiSelectOptions !== undefined || value.iterationConfiguration !== undefined);
  server.registerTool("update_project_field", {
    description: "Rename a project field or replace its select options or iteration configuration. Existing option and iteration IDs must be supplied to preserve values; omitted entries are removed. Multi-select options are available only when supported by the host schema.",
    inputSchema: updateFieldSchema,
  }, async (input) => safeCall(async () => {
    const parsed = input as ToolInput<typeof updateFieldSchema.shape> & { hostId?: string };
    const host = resolveHost(parsed.hostId, store.get());
    const capability = parsed.multiSelectOptions === undefined ? undefined : await getCapabilities(host);
    if (parsed.multiSelectOptions !== undefined && (!capability?.customFieldTypes.includes("MULTI_SELECT") || !capability.fieldConfigurationTypes.includes("ProjectV2MultiSelectField"))) {
      throw new SafeError("This GitHub host schema does not support multi-select Project fields.", "unsupported_capability");
    }
    const operation = capability ? ops.updateProjectFieldWithMultiSelect : ops.updateProjectField;
    return client.request(host, operation, { fieldId: parsed.fieldId, name: parsed.name, singleSelectOptions: parsed.singleSelectOptions, ...(capability ? { multiSelectOptions: parsed.multiSelectOptions } : {}), iterationConfiguration: parsed.iterationConfiguration });
  }));
  register("delete_project_field", "Delete a custom project field and its values. This cannot be undone.", z.object({ ...hostId, fieldId: z.string().min(1) }), ops.deleteProjectField, ({ fieldId }) => ({ fieldId }));
  register("create_project_status_update", "Post a project status update with optional start and target dates.", z.object({ ...hostId, projectId, body: z.string().min(1).max(10_000), status: z.enum(["ON_TRACK", "AT_RISK", "OFF_TRACK", "COMPLETE", "INACTIVE"]), startDate: z.iso.date().optional(), targetDate: z.iso.date().optional() }), ops.createProjectStatus, ({ projectId: id, body, status, startDate, targetDate }) => ({ projectId: id, body, status, startDate, targetDate }));
  register("delete_project_status_update", "Delete a project status update permanently.", z.object({ ...hostId, statusUpdateId: z.string().min(1) }), ops.deleteProjectStatus, ({ statusUpdateId }) => ({ statusUpdateId }));

  register("list_project_views", "List project views with their names, layouts, and filters. Results are bounded to 100 views per call; use endCursor to continue.", z.object({ ...hostId, projectId, ...page }), ops.listProjectViews, ({ projectId: id, first, after }) => ({ projectId: id, first, after: after ?? null }));
  register("create_project_view", "Create a project view in table, board, or roadmap layout and optionally set ordered visible field IDs. The public configuration input cannot set sort or grouping.", z.object({ ...hostId, projectId, name: z.string().min(1).max(256), layout: z.enum(["TABLE_LAYOUT", "BOARD_LAYOUT", "ROADMAP_LAYOUT"]), visibleFieldIds: z.array(z.string().min(1)).max(100).optional() }), ops.createProjectView, ({ projectId: id, name, layout, visibleFieldIds }) => ({ projectId: id, name, layout, configuration: visibleFieldIds ? { visibleFieldIds } : undefined }));
  register("update_project_view", "Update a view name, layout, filter, or ordered visible field IDs. Public view configuration does not allow sort or grouping changes.", z.object({ ...hostId, viewId: z.string().min(1), name: z.string().min(1).max(256).optional(), layout: z.enum(["TABLE_LAYOUT", "BOARD_LAYOUT", "ROADMAP_LAYOUT"]).optional(), filter: z.string().max(5000).nullable().optional(), visibleFieldIds: z.array(z.string().min(1)).max(100).optional() }).refine((value) => value.name !== undefined || value.layout !== undefined || value.filter !== undefined || value.visibleFieldIds !== undefined), ops.updateProjectView, ({ viewId, visibleFieldIds, ...changes }) => ({ viewId, ...changes, configuration: visibleFieldIds ? { visibleFieldIds } : undefined }));
  register("delete_project_view", "Permanently delete a project view.", z.object({ ...hostId, viewId: z.string().min(1) }), ops.deleteProjectView, ({ viewId }) => ({ viewId }));
  register("list_project_status_updates", "List project status updates. Results are bounded to 100 per call; use endCursor to continue.", z.object({ ...hostId, projectId, ...page }), ops.listProjectStatuses, ({ projectId: id, first, after }) => ({ projectId: id, first, after: after ?? null }));
  register("update_project_status_update", "Update a status update's body, status, or dates. Provide at least one field to change.", z.object({ ...hostId, statusUpdateId: z.string().min(1), body: z.string().min(1).max(10_000).optional(), status: z.enum(["ON_TRACK", "AT_RISK", "OFF_TRACK", "COMPLETE", "INACTIVE"]).optional(), startDate: z.iso.date().nullable().optional(), targetDate: z.iso.date().nullable().optional() }).refine((value) => value.body !== undefined || value.status !== undefined || value.startDate !== undefined || value.targetDate !== undefined), ops.updateProjectStatus, ({ statusUpdateId, ...changes }) => ({ statusUpdateId, ...changes }));
  register("list_project_workflows", "List available project workflows. GitHub's public API exposes workflow inventory and deletion, but not workflow editing.", z.object({ ...hostId, projectId, ...page }), ops.listProjectWorkflows, ({ projectId: id, first, after }) => ({ projectId: id, first, after: after ?? null }));
  register("delete_project_workflow", "Delete a project workflow permanently. This also removes the associated automation.", z.object({ ...hostId, workflowId: z.string().min(1) }), ops.deleteProjectWorkflow, ({ workflowId }) => ({ workflowId }));
  register("update_project_collaborators", "Replace the project's complete collaborator role configuration. The API does not expose a direct ProjectV2 query for reading existing roles, so supply the full intended list. Use role NONE to remove a direct role.", z.object({ ...hostId, projectId, collaborators: z.array(z.object({ userId: z.string().min(1).optional(), teamId: z.string().min(1).optional(), role: z.enum(["ADMIN", "NONE", "READER", "WRITER"]) }).refine((value) => Boolean(value.userId) !== Boolean(value.teamId))).min(1).max(100) }), ops.updateProjectCollaborators, ({ projectId: id, collaborators }) => ({ projectId: id, collaborators }));
}
