import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRunShortcut } from "../claimcheck.js";

// Ctrl+Enter (or Cmd+Enter on a Mac) runs the check from the
// keyboard. Plain Enter must never fire it: in batch mode it
// just adds a newline.

describe("isRunShortcut", () => {
  it("fires on Ctrl+Enter", () => {
    assert.equal(isRunShortcut({ key: "Enter", ctrlKey: true }), true);
  });

  it("fires on Cmd+Enter", () => {
    assert.equal(isRunShortcut({ key: "Enter", metaKey: true }), true);
  });

  it("does nothing on a plain Enter", () => {
    assert.equal(isRunShortcut({ key: "Enter" }), false);
  });

  it("does nothing on Enter with only alt or shift", () => {
    assert.equal(isRunShortcut({ key: "Enter", altKey: true }), false);
    assert.equal(isRunShortcut({ key: "Enter", shiftKey: true }), false);
    assert.equal(
      isRunShortcut({ key: "Enter", altKey: true, shiftKey: true }),
      false
    );
  });

  it("does nothing for other keys, even with Ctrl held", () => {
    assert.equal(isRunShortcut({ key: "a", ctrlKey: true }), false);
    assert.equal(isRunShortcut({ key: " ", ctrlKey: true }), false);
    assert.equal(isRunShortcut({ key: "Tab", ctrlKey: true }), false);
  });

  it("does nothing for a missing or broken event", () => {
    assert.equal(isRunShortcut(null), false);
    assert.equal(isRunShortcut(undefined), false);
    assert.equal(isRunShortcut({}), false);
    assert.equal(isRunShortcut({ key: "enter", ctrlKey: true }), false);
  });
});
