import type { Operation } from "../github/graphql-client.js";

export type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object response");
  return value as JsonRecord;
}

function nested(key: string): (value: unknown) => unknown {
  return (value) => {
    const root = record(value);
    if (!(key in root)) throw new Error(`Missing ${key}`);
    return root[key];
  };
}

export function queryOperation(name: string, document: string, key: string): Operation<unknown> {
  return { name, document, decode: nested(key), retry: "safe-read" };
}

export function mutationOperation(name: string, document: string, key: string): Operation<unknown> {
  return { name, document, decode: nested(key), retry: "never" };
}

export const listOwnerProjects: Operation<unknown> = { name: "ListOwnerProjects", document: `query ListOwnerProjects($login: String!, $first: Int!, $after: String, $query: String) {
  organization(login: $login) { projectsV2(first: $first, after: $after, query: $query) { nodes { id number title url shortDescription public closed createdAt updatedAt } pageInfo { hasNextPage endCursor } } }
  user(login: $login) { projectsV2(first: $first, after: $after, query: $query) { nodes { id number title url shortDescription public closed createdAt updatedAt } pageInfo { hasNextPage endCursor } } }
}`, decode: record, retry: "safe-read" };

export const getProject = queryOperation("GetProject", `query GetProject($projectId: ID!) {
  node(id: $projectId) { ... on ProjectV2 { id number title url shortDescription readme public closed template createdAt updatedAt owner { __typename ... on Organization { login } ... on User { login } } repositories(first: 100) { nodes { id nameWithOwner url } pageInfo { hasNextPage endCursor } } teams(first: 100) { nodes { id name slug } pageInfo { hasNextPage endCursor } } } }
}`, "node");

export const getProjectItemsWithMultiSelect = queryOperation("GetProjectItemsWithMultiSelect", `query GetProjectItemsWithMultiSelect($projectId: ID!, $first: Int!, $after: String, $query: String, $archivedStates: [ProjectV2ItemArchivedState!]) {
  node(id: $projectId) { ... on ProjectV2 { items(first: $first, after: $after, query: $query, archivedStates: $archivedStates) { nodes { id type isArchived createdAt updatedAt content { __typename ... on Issue { id number title url state assignees(first: 10) { nodes { id login } } labels(first: 20) { nodes { id name } } milestone { id title dueOn } } ... on PullRequest { id number title url state assignees(first: 10) { nodes { id login } } labels(first: 20) { nodes { id name } } } ... on DraftIssue { id title body assignees(first: 10) { nodes { id login } } } } fieldValues(first: 50) { nodes { __typename ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id name } } } ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id name } } } ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id name } } } ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { id name } } } ... on ProjectV2ItemFieldMultiSelectValue { value options { id name } field { ... on ProjectV2FieldCommon { id name } } } ... on ProjectV2ItemFieldIterationValue { title startDate duration field { ... on ProjectV2FieldCommon { id name } } } ... on ProjectV2ItemFieldLabelValue { labels(first: 20) { nodes { id name } } field { ... on ProjectV2FieldCommon { id name } } } ... on ProjectV2ItemFieldUserValue { users(first: 20) { nodes { id login } } field { ... on ProjectV2FieldCommon { id name } } } ... on ProjectV2ItemFieldMilestoneValue { milestone { id title dueOn } field { ... on ProjectV2FieldCommon { id name } } } } } } pageInfo { hasNextPage endCursor } } } }
}`, "node");

const multiSelectItemValueFragment = "... on ProjectV2ItemFieldMultiSelectValue { value options { id name } field { ... on ProjectV2FieldCommon { id name } } } ";
export const getProjectItems: Operation<unknown> = {
  ...getProjectItemsWithMultiSelect,
  name: "GetProjectItems",
  document: getProjectItemsWithMultiSelect.document
    .replace("query GetProjectItemsWithMultiSelect(", "query GetProjectItems(")
    .replace(multiSelectItemValueFragment, ""),
};

export const createProject = mutationOperation("CreateProjectV2", `mutation CreateProjectV2($ownerId: ID!, $title: String!, $repositoryId: ID, $teamId: ID) { createProjectV2(input: { ownerId: $ownerId, title: $title, repositoryId: $repositoryId, teamId: $teamId }) { projectV2 { id number title url } } }`, "createProjectV2");
export const copyProject = mutationOperation("CopyProjectV2", `mutation CopyProjectV2($projectId: ID!, $ownerId: ID!, $title: String!, $includeDraftIssues: Boolean!) { copyProjectV2(input: { projectId: $projectId, ownerId: $ownerId, title: $title, includeDraftIssues: $includeDraftIssues }) { projectV2 { id number title url } } }`, "copyProjectV2");
export const updateProject = mutationOperation("UpdateProjectV2", `mutation UpdateProjectV2($projectId: ID!, $title: String, $shortDescription: String, $readme: String, $public: Boolean) { updateProjectV2(input: { projectId: $projectId, title: $title, shortDescription: $shortDescription, readme: $readme, public: $public }) { projectV2 { id number title url shortDescription public closed } } }`, "updateProjectV2");
export const closeProject = mutationOperation("CloseProjectV2", `mutation CloseProjectV2($projectId: ID!) { updateProjectV2(input: { projectId: $projectId, closed: true }) { projectV2 { id closed } } }`, "updateProjectV2");
export const reopenProject = mutationOperation("ReopenProjectV2", `mutation ReopenProjectV2($projectId: ID!) { updateProjectV2(input: { projectId: $projectId, closed: false }) { projectV2 { id closed } } }`, "updateProjectV2");
export const deleteProject = mutationOperation("DeleteProjectV2", `mutation DeleteProjectV2($projectId: ID!) { deleteProjectV2(input: { projectId: $projectId }) { projectV2 { id } } }`, "deleteProjectV2");
export const markProjectTemplate = mutationOperation("MarkProjectV2AsTemplate", `mutation MarkProjectV2AsTemplate($projectId: ID!) { markProjectV2AsTemplate(input: { projectId: $projectId }) { projectV2 { id template } } }`, "markProjectV2AsTemplate");
export const unmarkProjectTemplate = mutationOperation("UnmarkProjectV2AsTemplate", `mutation UnmarkProjectV2AsTemplate($projectId: ID!) { unmarkProjectV2AsTemplate(input: { projectId: $projectId }) { projectV2 { id template } } }`, "unmarkProjectV2AsTemplate");
export const linkProjectRepository = mutationOperation("LinkProjectV2ToRepository", `mutation LinkProjectV2ToRepository($projectId: ID!, $repositoryId: ID!) { linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) { repository { id nameWithOwner } } }`, "linkProjectV2ToRepository");
export const unlinkProjectRepository = mutationOperation("UnlinkProjectV2FromRepository", `mutation UnlinkProjectV2FromRepository($projectId: ID!, $repositoryId: ID!) { unlinkProjectV2FromRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) { repository { id nameWithOwner } } }`, "unlinkProjectV2FromRepository");
export const linkProjectTeam = mutationOperation("LinkProjectV2ToTeam", `mutation LinkProjectV2ToTeam($projectId: ID!, $teamId: ID!) { linkProjectV2ToTeam(input: { projectId: $projectId, teamId: $teamId }) { team { id name slug } } }`, "linkProjectV2ToTeam");
export const unlinkProjectTeam = mutationOperation("UnlinkProjectV2FromTeam", `mutation UnlinkProjectV2FromTeam($projectId: ID!, $teamId: ID!) { unlinkProjectV2FromTeam(input: { projectId: $projectId, teamId: $teamId }) { team { id name slug } } }`, "unlinkProjectV2FromTeam");

export const addProjectItem = mutationOperation("AddProjectV2ItemById", `mutation AddProjectV2ItemById($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id type content { __typename ... on Issue { title url } ... on PullRequest { title url } } } } }`, "addProjectV2ItemById");
export const addDraftIssue = mutationOperation("AddProjectV2DraftIssue", `mutation AddProjectV2DraftIssue($projectId: ID!, $title: String!, $body: String!) { addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) { projectItem { id type content { ... on DraftIssue { id title body } } } } }`, "addProjectV2DraftIssue");
export const updateDraftIssue = mutationOperation("UpdateProjectV2DraftIssue", `mutation UpdateProjectV2DraftIssue($draftIssueId: ID!, $title: String, $body: String) { updateProjectV2DraftIssue(input: { draftIssueId: $draftIssueId, title: $title, body: $body }) { draftIssue { id title body } } }`, "updateProjectV2DraftIssue");
export const convertDraftIssue = mutationOperation("ConvertProjectV2DraftIssueItemToIssue", `mutation ConvertProjectV2DraftIssueItemToIssue($itemId: ID!, $repositoryId: ID!) { convertProjectV2DraftIssueItemToIssue(input: { itemId: $itemId, repositoryId: $repositoryId }) { item { id content { ... on Issue { id number title url } } } } }`, "convertProjectV2DraftIssueItemToIssue");
export const updateItemField = mutationOperation("UpdateProjectV2ItemFieldValue", `mutation UpdateProjectV2ItemFieldValue($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) { projectV2Item { id } } }`, "updateProjectV2ItemFieldValue");
export const clearItemField = mutationOperation("ClearProjectV2ItemFieldValue", `mutation ClearProjectV2ItemFieldValue($projectId: ID!, $itemId: ID!, $fieldId: ID!) { clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) { projectV2Item { id } } }`, "clearProjectV2ItemFieldValue");
export const archiveProjectItem = mutationOperation("ArchiveProjectV2Item", `mutation ArchiveProjectV2Item($projectId: ID!, $itemId: ID!) { archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { item { id isArchived } } }`, "archiveProjectV2Item");
export const unarchiveProjectItem = mutationOperation("UnarchiveProjectV2Item", `mutation UnarchiveProjectV2Item($projectId: ID!, $itemId: ID!) { unarchiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { item { id isArchived } } }`, "unarchiveProjectV2Item");
export const deleteProjectItem = mutationOperation("DeleteProjectV2Item", `mutation DeleteProjectV2Item($projectId: ID!, $itemId: ID!) { deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { deletedItemId } }`, "deleteProjectV2Item");
export const moveProjectItem = mutationOperation("UpdateProjectV2ItemPosition", `mutation UpdateProjectV2ItemPosition($projectId: ID!, $itemId: ID!, $afterId: ID) { updateProjectV2ItemPosition(input: { projectId: $projectId, itemId: $itemId, afterId: $afterId }) { items(first: 1) { nodes { id } } } }`, "updateProjectV2ItemPosition");

export const listProjectFieldsWithMultiSelect = queryOperation("ListProjectV2FieldsWithMultiSelect", `query ListProjectV2FieldsWithMultiSelect($projectId: ID!, $first: Int!, $after: String) { node(id: $projectId) { ... on ProjectV2 { fields(first: $first, after: $after) { nodes { __typename ... on ProjectV2Field { id name dataType issueField { __typename } } ... on ProjectV2SingleSelectField { id name dataType options { id name color description } } ... on ProjectV2MultiSelectField { id name dataType multiSelectOptions { id name color description } } ... on ProjectV2IterationField { id name dataType configuration { startDay duration iterations { id title startDate duration } completedIterations { id title startDate duration } } } } pageInfo { hasNextPage endCursor } } } } }`, "node");
const multiSelectFieldFragment = "... on ProjectV2MultiSelectField { id name dataType multiSelectOptions { id name color description } } ";
export const listProjectFields: Operation<unknown> = {
  ...listProjectFieldsWithMultiSelect,
  name: "ListProjectV2Fields",
  document: listProjectFieldsWithMultiSelect.document
    .replace("query ListProjectV2FieldsWithMultiSelect(", "query ListProjectV2Fields(")
    .replace(multiSelectFieldFragment, ""),
};
export const createProjectFieldWithMultiSelect = mutationOperation("CreateProjectV2FieldWithMultiSelect", `mutation CreateProjectV2FieldWithMultiSelect($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!, $singleSelectOptions: [ProjectV2SingleSelectFieldOptionInput!], $multiSelectOptions: [ProjectV2MultiSelectFieldOptionInput!], $iterationConfiguration: ProjectV2IterationFieldConfigurationInput) { createProjectV2Field(input: { projectId: $projectId, name: $name, dataType: $dataType, singleSelectOptions: $singleSelectOptions, multiSelectOptions: $multiSelectOptions, iterationConfiguration: $iterationConfiguration }) { projectV2Field { __typename ... on ProjectV2Field { id name dataType } ... on ProjectV2SingleSelectField { id name dataType options { id name color description } } ... on ProjectV2MultiSelectField { id name dataType multiSelectOptions { id name color description } } ... on ProjectV2IterationField { id name dataType configuration { startDay duration iterations { id title startDate duration } } } } } }`, "createProjectV2Field");
export const createProjectField: Operation<unknown> = {
  ...createProjectFieldWithMultiSelect,
  name: "CreateProjectV2Field",
  document: createProjectFieldWithMultiSelect.document
    .replace("mutation CreateProjectV2FieldWithMultiSelect", "mutation CreateProjectV2Field")
    .replace(", $multiSelectOptions: [ProjectV2MultiSelectFieldOptionInput!]", "")
    .replace(", multiSelectOptions: $multiSelectOptions", "")
    .replace(multiSelectFieldFragment, ""),
};
export const createProjectIssueField = mutationOperation("CreateProjectV2IssueField", `mutation CreateProjectV2IssueField($projectId: ID!, $issueFieldId: ID!) { createProjectV2IssueField(input: { projectId: $projectId, issueFieldId: $issueFieldId }) { projectV2Field { __typename ... on ProjectV2Field { id name dataType isIssueField } } } }`, "createProjectV2IssueField");
export const updateProjectFieldWithMultiSelect = mutationOperation("UpdateProjectV2FieldWithMultiSelect", `mutation UpdateProjectV2FieldWithMultiSelect($fieldId: ID!, $name: String, $singleSelectOptions: [ProjectV2SingleSelectFieldOptionInput!], $multiSelectOptions: [ProjectV2MultiSelectFieldOptionInput!], $iterationConfiguration: ProjectV2IterationFieldConfigurationInput) { updateProjectV2Field(input: { fieldId: $fieldId, name: $name, singleSelectOptions: $singleSelectOptions, multiSelectOptions: $multiSelectOptions, iterationConfiguration: $iterationConfiguration }) { projectV2Field { __typename ... on ProjectV2Field { id name dataType } ... on ProjectV2SingleSelectField { id name dataType options { id name color description } } ... on ProjectV2MultiSelectField { id name dataType multiSelectOptions { id name color description } } ... on ProjectV2IterationField { id name dataType configuration { startDay duration iterations { id title startDate duration } } } } } }`, "updateProjectV2Field");
export const updateProjectField: Operation<unknown> = {
  ...updateProjectFieldWithMultiSelect,
  name: "UpdateProjectV2Field",
  document: updateProjectFieldWithMultiSelect.document
    .replace("mutation UpdateProjectV2FieldWithMultiSelect", "mutation UpdateProjectV2Field")
    .replace(", $multiSelectOptions: [ProjectV2MultiSelectFieldOptionInput!]", "")
    .replace(", multiSelectOptions: $multiSelectOptions", "")
    .replace(multiSelectFieldFragment, ""),
};
export const deleteProjectField = mutationOperation("DeleteProjectV2Field", `mutation DeleteProjectV2Field($fieldId: ID!) { deleteProjectV2Field(input: { fieldId: $fieldId }) { projectV2Field { ... on ProjectV2FieldCommon { id name } } } }`, "deleteProjectV2Field");
export const createProjectStatus = mutationOperation("CreateProjectV2StatusUpdate", `mutation CreateProjectV2StatusUpdate($projectId: ID!, $body: String!, $status: ProjectV2StatusUpdateStatus!, $startDate: Date, $targetDate: Date) { createProjectV2StatusUpdate(input: { projectId: $projectId, body: $body, status: $status, startDate: $startDate, targetDate: $targetDate }) { statusUpdate { id body status startDate targetDate } } }`, "createProjectV2StatusUpdate");
export const deleteProjectStatus = mutationOperation("DeleteProjectV2StatusUpdate", `mutation DeleteProjectV2StatusUpdate($statusUpdateId: ID!) { deleteProjectV2StatusUpdate(input: { statusUpdateId: $statusUpdateId }) { deletedStatusUpdateId } }`, "deleteProjectV2StatusUpdate");

export const listProjectViews = queryOperation("ListProjectV2Views", `query ListProjectV2Views($projectId: ID!, $first: Int!, $after: String) { node(id: $projectId) { ... on ProjectV2 { views(first: $first, after: $after) { nodes { id name number layout filter configuration { visibleFields(first: 100) { nodes { id name } } } } pageInfo { hasNextPage endCursor } } } } }`, "node");
export const createProjectView = mutationOperation("CreateProjectV2View", `mutation CreateProjectV2View($projectId: ID!, $name: String!, $layout: ProjectV2ViewLayout!, $configuration: ProjectV2ViewConfigurationInput) { createProjectV2View(input: { projectId: $projectId, name: $name, layout: $layout, configuration: $configuration }) { projectV2View { id name number layout filter configuration { visibleFields(first: 100) { nodes { id name } } } } } }`, "createProjectV2View");
export const updateProjectView = mutationOperation("UpdateProjectV2View", `mutation UpdateProjectV2View($viewId: ID!, $name: String, $layout: ProjectV2ViewLayout, $filter: String, $configuration: ProjectV2ViewConfigurationInput) { updateProjectV2View(input: { viewId: $viewId, name: $name, layout: $layout, filter: $filter, configuration: $configuration }) { projectV2View { id name number layout filter configuration { visibleFields(first: 100) { nodes { id name } } } } } }`, "updateProjectV2View");
export const deleteProjectView = mutationOperation("DeleteProjectV2View", `mutation DeleteProjectV2View($viewId: ID!) { deleteProjectV2View(input: { viewId: $viewId }) { projectV2View { id name } } }`, "deleteProjectV2View");
export const updateProjectStatus = mutationOperation("UpdateProjectV2StatusUpdate", `mutation UpdateProjectV2StatusUpdate($statusUpdateId: ID!, $body: String, $status: ProjectV2StatusUpdateStatus, $startDate: Date, $targetDate: Date) { updateProjectV2StatusUpdate(input: { statusUpdateId: $statusUpdateId, body: $body, status: $status, startDate: $startDate, targetDate: $targetDate }) { statusUpdate { id body status startDate targetDate } } }`, "updateProjectV2StatusUpdate");
export const listProjectStatuses = queryOperation("ListProjectV2StatusUpdates", `query ListProjectV2StatusUpdates($projectId: ID!, $first: Int!, $after: String) { node(id: $projectId) { ... on ProjectV2 { statusUpdates(first: $first, after: $after) { nodes { id body status startDate targetDate createdAt creator { login } } pageInfo { hasNextPage endCursor } } } } }`, "node");
export const listProjectWorkflows = queryOperation("ListProjectV2Workflows", `query ListProjectV2Workflows($projectId: ID!, $first: Int!, $after: String) { node(id: $projectId) { ... on ProjectV2 { workflows(first: $first, after: $after) { nodes { id name number createdAt updatedAt } pageInfo { hasNextPage endCursor } } } } }`, "node");
export const deleteProjectWorkflow = mutationOperation("DeleteProjectV2Workflow", `mutation DeleteProjectV2Workflow($workflowId: ID!) { deleteProjectV2Workflow(input: { workflowId: $workflowId }) { deletedWorkflowId } }`, "deleteProjectV2Workflow");
export const updateProjectCollaborators = mutationOperation("UpdateProjectV2Collaborators", `mutation UpdateProjectV2Collaborators($projectId: ID!, $collaborators: [ProjectV2Collaborator!]!) { updateProjectV2Collaborators(input: { projectId: $projectId, collaborators: $collaborators }) { collaborators(first: 100) { nodes { __typename ... on User { id login } ... on Team { id name slug } } } } }`, "updateProjectV2Collaborators");

export const listRepositoryProjects = queryOperation("ListRepositoryProjectsV2", `query ListRepositoryProjectsV2($owner: String!, $name: String!, $first: Int!, $after: String, $query: String) { repository(owner: $owner, name: $name) { projectsV2(first: $first, after: $after, query: $query) { nodes { id number title url shortDescription public closed createdAt updatedAt } pageInfo { hasNextPage endCursor } } } }`, "repository");
export const listTeamProjects = queryOperation("ListTeamProjectsV2", `query ListTeamProjectsV2($organization: String!, $slug: String!, $first: Int!, $after: String, $query: String) { organization(login: $organization) { team(slug: $slug) { projectsV2(first: $first, after: $after, query: $query) { nodes { id number title url shortDescription public closed createdAt updatedAt } pageInfo { hasNextPage endCursor } } } } }`, "organization");
export const listRecentOwnerProjects: Operation<unknown> = { name: "ListRecentOwnerProjectsV2", document: `query ListRecentOwnerProjectsV2($login: String!, $first: Int!, $after: String) { organization(login: $login) { recentProjects(first: $first, after: $after) { nodes { id number title url shortDescription public closed updatedAt } pageInfo { hasNextPage endCursor } } } user(login: $login) { recentProjects(first: $first, after: $after) { nodes { id number title url shortDescription public closed updatedAt } pageInfo { hasNextPage endCursor } } } }`, decode: record, retry: "safe-read" };
export const listRecentRepositoryProjects = queryOperation("ListRecentRepositoryProjectsV2", `query ListRecentRepositoryProjectsV2($owner: String!, $name: String!, $first: Int!, $after: String) { repository(owner: $owner, name: $name) { recentProjects(first: $first, after: $after) { nodes { id number title url shortDescription public closed updatedAt } pageInfo { hasNextPage endCursor } } } }`, "repository");
