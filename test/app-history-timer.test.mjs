import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

// These tests load the real app.js behind a stub page, so the
// timer wiring itself gets exercised, not just the helper it
// calls. The stub stands in for the browser: fake elements,
// fake storage, fake timers, and a fetch that must never fire.
// A fixed "now" pins the ages down, then moving it forward
// shows the timer doing its work.

const NOW = Date.UTC(2026, 10, 28, 12, 0, 0);
const MINUTE = 60 * 1000;

let loadCount = 0;
let realNow;
let nowValue;

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

// The recent checks list. Setting its HTML parses the age spans
// back out, the way the real page would hold them, so the timer
// has real spans to refresh. Every set counts as a render, so a
// tick that re-rendered the list instead of refreshing the spans
// would show up here.
function makeHistoryList() {
  const el = makeElement();
  let html = "";
  let spans = [];
  let renders = 0;
  Object.defineProperty(el, "innerHTML", {
    get() {
      return html;
    },
    set(value) {
      html = value;
      renders += 1;
      spans = [];
      const pattern =
        /<span class="history-time" data-checked-at="([^"]+)">([^<]*)<\/span>/g;
      for (const match of value.matchAll(pattern)) {
        spans.push({
          dataset: { checkedAt: match[1] },
          textContent: match[2],
        });
      }
    },
  });
  el.querySelectorAll = (selector) =>
    selector === ".history-time" ? spans : [];
  el.renderCount = () => renders;
  el.ageSpans = () => spans;
  return el;
}

function makeStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  const calls = { get: 0, set: 0 };
  return {
    calls,
    getItem(key) {
      calls.get += 1;
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      calls.set += 1;
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

// Load the real app.js once, with the stub page in place, and
// hand back everything the tests need to poke at: the captured
// timer, the pagehide handlers, the fetch calls, the storage
// writes, and the history list itself. The query string makes
// each load a fresh copy of the module.
async function loadApp(seedHistory) {
  loadCount += 1;
  const ids = [
    "claim-form",
    "claim-input",
    "check-button",
    "status",
    "results",
    "history",
    "clear-history",
    "mode-single",
    "mode-batch",
    "claim-label",
  ];
  const elements = {};
  for (const id of ids) elements[id] = makeElement();
  const historyList = makeHistoryList();
  elements["history-list"] = historyList;

  const storage = makeStorage({
    "claim-check-history": JSON.stringify(seedHistory),
  });
  const intervals = [];
  const cleared = [];
  const fetchCalls = [];
  const pagehideHandlers = [];
  let timerId = 0;

  const windowStub = {
    localStorage: storage,
    location: { hash: "" },
    addEventListener(type, fn) {
      if (type === "pagehide") pagehideHandlers.push(fn);
    },
  };

  // The real timers come back straight after the import, so the
  // test runner never runs on fake ones. The captured callback
  // and id are kept, and the pagehide test installs the fake
  // clearInterval again just while it fires the handler.
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const fakeClearInterval = (id) => {
    cleared.push(id);
  };

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
  // No navigator stub: app.js only touches navigator.clipboard
  // inside a copy-button click, which never fires here, and
  // Node's global navigator is getter-only anyway.
  globalThis.setInterval = (fn, ms) => {
    timerId += 1;
    intervals.push({ id: timerId, fn, ms });
    return timerId;
  };
  globalThis.clearInterval = fakeClearInterval;

  await import(`../app.js?history-timer-${loadCount}`);

  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;

  return {
    elements,
    historyList,
    storage,
    intervals,
    cleared,
    fetchCalls,
    pagehideHandlers,
    fakeClearInterval,
    realClearInterval,
  };
}

beforeEach(() => {
  realNow = Date.now;
  nowValue = NOW;
  Date.now = () => nowValue;
});

afterEach(() => {
  Date.now = realNow;
});

describe("history age timer wiring", () => {
  it("registers one timer, every 60 seconds", async () => {
    const app = await loadApp([
      { claim: "The moon landings were faked", label: "Mixed picture", checkedAt: NOW - 30 * 1000 },
    ]);
    assert.equal(app.intervals.length, 1);
    assert.equal(app.intervals[0].ms, 60 * 1000);
    assert.equal(typeof app.intervals[0].fn, "function");
  });

  it("advances the ages on a tick, and only the age text", async () => {
    const app = await loadApp([
      { claim: "The moon landings were faked", label: "Mixed picture", checkedAt: NOW - 30 * 1000 },
      { claim: "Humans use only 10% of their brains", label: "The evidence raises doubts", checkedAt: NOW - 90 * 1000 },
    ]);
    const spans = app.historyList.ageSpans();
    assert.equal(spans.length, 2);
    assert.equal(spans[0].textContent, "checked just now");
    assert.equal(spans[1].textContent, "checked 1 minute ago");
    const rendersBefore = app.historyList.renderCount();
    const htmlBefore = app.historyList.innerHTML;

    // 45 seconds pass. The first check crosses the minute line,
    // the second moves on to two minutes.
    nowValue = NOW + 45 * 1000;
    app.intervals[0].fn();

    assert.equal(spans[0].textContent, "checked 1 minute ago");
    assert.equal(spans[1].textContent, "checked 2 minutes ago");
    // The list itself was not re-rendered, the claims and verdicts
    // are untouched, and nothing was fetched or re-checked.
    assert.equal(app.historyList.renderCount(), rendersBefore);
    assert.equal(app.historyList.innerHTML, htmlBefore);
    assert.equal(app.fetchCalls.length, 0);
    assert.equal(app.storage.calls.set, 0);
  });

  it("does nothing to the page when there is no history", async () => {
    const app = await loadApp([]);
    assert.equal(app.historyList.ageSpans().length, 0);
    nowValue = NOW + 5 * MINUTE;
    assert.doesNotThrow(() => app.intervals[0].fn());
    assert.equal(app.fetchCalls.length, 0);
    assert.equal(app.storage.calls.set, 0);
  });

  it("clears the timer when the page goes away", async () => {
    const app = await loadApp([
      { claim: "The moon landings were faked", label: "Mixed picture", checkedAt: NOW - 30 * 1000 },
    ]);
    assert.equal(app.pagehideHandlers.length, 1);
    assert.deepEqual(app.cleared, []);
    globalThis.clearInterval = app.fakeClearInterval;
    try {
      app.pagehideHandlers[0]();
    } finally {
      globalThis.clearInterval = app.realClearInterval;
    }
    assert.deepEqual(app.cleared, [app.intervals[0].id]);
  });
});
