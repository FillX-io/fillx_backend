import assert from "node:assert/strict";
import test from "node:test";
import { IdentityApiError, apiError } from "./errors.js";

test("IdentityApiError sanitizes serialized 500-class messages", () => {
  const error = apiError("AVATAR_UPLOAD_FAILED", "storage secret leaked");

  assert.ok(error instanceof IdentityApiError);
  assert.equal(error.code, "AVATAR_UPLOAD_FAILED");
  assert.equal(error.status, 500);
  assert.equal(error.internalMessage, "storage secret leaked");
  assert.ok(error.cause instanceof Error);
  assert.equal(error.cause.message, "storage secret leaked");
  assert.equal(error.toJSON().message, "AVATAR_UPLOAD_FAILED");
});

test("IdentityApiError preserves non-5xx messages", () => {
  const error = apiError("AVATAR_INVALID_CONTENT_TYPE", "Only PNG is supported");

  assert.ok(error instanceof IdentityApiError);
  assert.equal(error.code, "AVATAR_INVALID_CONTENT_TYPE");
  assert.equal(error.status, 415);
  assert.equal(error.toJSON().message, "Only PNG is supported");
});

test("IdentityApiError maps display name validation statuses", () => {
  const required = apiError("USERNAME_REQUIRED");
  const invalid = apiError("INVALID_DISPLAY_NAME");
  const taken = apiError("DISPLAY_NAME_TAKEN");

  assert.equal(required.status, 400);
  assert.equal(required.toJSON().message, "USERNAME_REQUIRED");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.toJSON().message, "INVALID_DISPLAY_NAME");
  assert.equal(taken.status, 409);
  assert.equal(taken.toJSON().message, "DISPLAY_NAME_TAKEN");
});
