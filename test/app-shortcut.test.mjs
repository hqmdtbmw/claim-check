import { describe, it } from "node:test";
import assert from "node:assert/strict";

// These tests load the real app.js behind a stub page, so the
// Ctrl+Enter wiring itself gets exercised, not just the helper
// it calls. The stub stands in for the browser: fake elements,
// fake storage, fake timers, and a fetch that must never fire.
// The form's requestSubmit is recorded instead of running, so
// the test proves the shortcut hands the check to the same
// submit handler the button uses, without doing a live check.

let loadCount = 0;

function makeElement() {
  const listeners = new Map();
  return {
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    rows: 3,
    placeholder: "",
    dataset: {},
    classList: {
      toggle() {},
      add() {},
      remove() {},
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatch(type, event) {
      for (const fn of listeners.get(type) || []) fn(event);
    },
    focus() {},
    requestSubmit() {},
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    closest() {
      return null;
    },
  };
}

function makeStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

// Load the real app.js once, with the stub page in place, and
// hand back the input, the form's recorded submits, the captured
// timer and the fetch calls. The query string makes each load a
// fresh copy of the module.
async function loadApp() {
  loadCount += 1;
  const ids = [
    "claim-form",
    "claim-input",
    "check-button",
    "status",
    "results",
    "history",
    "history-list",
    "clear-history",
    "mode-single",
    "mode-batch",
    "claim-label",
  ];
  const elements = {};
  for (const id of ids) elements[id] = makeElement();

  const storage = makeStorage();
  const intervals = [];
  const fetchCalls = [];
  const submits = [];
  let timerId = 0;

  elements["claim-form"].requestSubmit = () => {
    submits.push(elements["claim-input"].value);
  };

  const windowStub = {
    localStorage: storage,
    location: { hash: "" },
    addEventListener() {},
  };

  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;

  globalThis.document = {
    getElementById: (id) => elements[id] || makeElement(),
    querySelectorAll: () => [],
  };
  globalThis.window = windowStub;
  globalThis.history = { replaceState() {} };
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    throw new Error("fetch must not run in this test");
  };
  globalThis.setInterval = (fn, ms) => {
    timerId += 1;
    intervals.push({ id: timerId, fn, ms });
    return timerId;
  };

  await import(`../app.js?shortcut-${loadCount}`);

  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;

  return {
    elements,
    intervals,
    fetchCalls,
    submits,
  };
}

function keyEvent(overrides = {}) {
  return { key: "Enter", preventDefault() {}, ...overrides };
}

describe("Ctrl+Enter shortcut wiring", () => {
  it("runs the check on Ctrl+Enter, through the form submit", async () => {
    const app = await loadApp();
    app.elements["claim-input"].value = "The moon landings were faked";
    app.elements["claim-input"].dispatch("keydown", keyEvent({ ctrlKey: true }));
    assert.equal(app.submits.length, 1);
    assert.equal(app.submits[0], "The moon landings were faked");
    assert.equal(app.fetchCalls.length, 0);
  });

  it("runs the check on Cmd+Enter too", async () => {
    const app = await loadApp();
    app.elements["claim-input"].value = "Humans use only 10% of their brains";
    app.elements["claim-input"].dispatch("keydown", keyEvent({ metaKey: true }));
    assert.equal(app.submits.length, 1);
    assert.equal(app.fetchCalls.length, 0);
  });

  it("does nothing on a plain Enter, so it can still add a newline", async () => {
    const app = await loadApp();
    app.elements["claim-input"].value = "The moon landings were faked";
    app.elements["claim-input"].dispatch("keydown", keyEvent());
    assert.equal(app.submits.length, 0);
    assert.equal(app.fetchCalls.length, 0);
  });

  it("does nothing on Enter with only alt or shift, or on other keys", async () => {
    const app = await loadApp();
    app.elements["claim-input"].dispatch("keydown", keyEvent({ altKey: true }));
    app.elements["claim-input"].dispatch("keydown", keyEvent({ shiftKey: true }));
    app.elements["claim-input"].dispatch(
      "keydown",
      keyEvent({ key: "a", ctrlKey: true })
    );
    assert.equal(app.submits.length, 0);
    assert.equal(app.fetchCalls.length, 0);
  });

  it("leaves the history-age timer alone", async () => {
    const app = await loadApp();
    assert.equal(app.intervals.length, 1);
    assert.equal(app.intervals[0].ms, 60 * 1000);
  });
});
