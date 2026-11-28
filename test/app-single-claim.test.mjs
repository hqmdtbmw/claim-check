import { describe, it } from "node:test";
import assert from "node:assert/strict";

// These tests load the real app.js behind a stub page, so the form
// submit itself gets exercised, not just the helper it calls. The
// stub stands in for the browser: fake elements, fake storage, fake
// timers, and a canned Wikipedia that answers the search and the
// extracts call for "Vaccines work". The point is the short claim
// that used to be dropped before it ever reached the network: the
// test proves the check runs and the results render, instead of
// the form answering "Type a claim first."

let loadCount = 0;

function makeElement() {
  const listeners = new Map();
  return {
    textContent: "",
    innerHTML: "",
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

// Load the real app.js once, with the stub page in place, and hand
// back the elements and the fetch calls. The query string makes
// each load a fresh copy of the module.
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
  let timerId = 0;

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
    if (url.includes("list=search")) {
      return {
        ok: true,
        json: async () => ({ query: { search: [{ title: "Vaccine" }] } }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        query: {
          pages: {
            123: {
              pageid: 123,
              title: "Vaccine",
              extract:
                "A vaccine is a biological preparation that provides active acquired immunity. Vaccines work by training the immune system.",
              fullurl: "https://en.wikipedia.org/wiki/Vaccine",
              revisions: [{ timestamp: "2026-11-20T10:00:00Z" }],
            },
          },
        },
      }),
    };
  };
  globalThis.setInterval = (fn, ms) => {
    timerId += 1;
    intervals.push({ id: timerId, fn, ms });
    return timerId;
  };

  await import(`../app.js?single-claim-${loadCount}`);

  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;

  return {
    elements,
    intervals,
    fetchCalls,
  };
}

function submitEvent() {
  return { preventDefault() {} };
}

// Let the async submit handler run to the end.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("short claim submit wiring", () => {
  it("runs the check for a two-word claim instead of asking for one", async () => {
    const app = await loadApp();
    app.elements["claim-input"].value = "Vaccines work";
    app.elements["claim-form"].dispatch("submit", submitEvent());
    await settle();
    assert.equal(app.fetchCalls.length, 2);
    assert.match(app.fetchCalls[0], /list=search/);
    assert.match(app.fetchCalls[1], /prop=extracts/);
    assert.match(app.elements["results"].innerHTML, /Vaccine/);
    assert.notEqual(app.elements["status"].textContent, "Type a claim first.");
  });

  it("still asks for a claim when the box is empty", async () => {
    const app = await loadApp();
    app.elements["claim-input"].value = "   ";
    app.elements["claim-form"].dispatch("submit", submitEvent());
    await settle();
    assert.equal(app.fetchCalls.length, 0);
    assert.equal(app.elements["status"].textContent, "Type a claim first.");
    assert.equal(app.elements["results"].innerHTML, "");
  });

  it("checks a long single claim exactly as before", async () => {
    const app = await loadApp();
    app.elements["claim-input"].value = "The moon landings were faked";
    app.elements["claim-form"].dispatch("submit", submitEvent());
    await settle();
    assert.equal(app.fetchCalls.length, 2);
    assert.match(app.elements["results"].innerHTML, /Vaccine/);
  });
});
