import assert from "node:assert/strict";
import { test } from "node:test";
import { safeErrorMessage } from "../src/errors.js";
import {
  createProjectField,
  createProjectFieldWithMultiSelect,
  deleteProject,
  listProjectFields,
  listProjectFieldsWithMultiSelect,
  updateProjectField,
  updateProjectFieldWithMultiSelect,
  updateItemField,
  getProjectItems,
  getProjectItemsWithMultiSelect,
} from "../src/projects/operations.js";

test("error messages redact GitHub tokens and bearer credentials", () => {
  assert.equal(
    safeErrorMessage(new Error("Bearer ghp_abcdefghijklmnopqrstuvwxyz1234567890 and github_pat_abcdefghijklmnopqrstuvwxyz1234567890")),
    "Bearer [REDACTED] and [REDACTED]",
  );
  assert.equal(safeErrorMessage("x".repeat(1200)).length, 1000);
});

test("host-compatible field documents use the right schema variants", () => {
  assert.match(listProjectFieldsWithMultiSelect.document, /ProjectV2MultiSelectField \{ id name dataType multiSelectOptions/);
  assert.doesNotMatch(listProjectFields.document, /ProjectV2MultiSelectField|multiSelectOptions/);
  assert.match(listProjectFields.document, /ProjectV2SingleSelectField \{ id name dataType options/);

  assert.match(createProjectFieldWithMultiSelect.document, /ProjectV2MultiSelectField \{ id name dataType multiSelectOptions/);
  assert.doesNotMatch(createProjectField.document, /multiSelectOptions|ProjectV2MultiSelectField/);
  assert.match(updateProjectFieldWithMultiSelect.document, /ProjectV2MultiSelectField \{ id name dataType multiSelectOptions/);
  assert.doesNotMatch(updateProjectField.document, /multiSelectOptions|ProjectV2MultiSelectField/);
});

test("item queries preserve valid multi-select value options and separate the fallback variant", () => {
  assert.match(getProjectItemsWithMultiSelect.document, /ProjectV2ItemFieldMultiSelectValue \{ value options \{ id name \}/);
  assert.doesNotMatch(getProjectItems.document, /ProjectV2ItemFieldMultiSelectValue/);
  assert.equal(getProjectItems.retry, "safe-read");
});

test("mutations are never marked safe to retry", () => {
  assert.equal(deleteProject.retry, "never");
  assert.equal(updateItemField.retry, "never");
});
