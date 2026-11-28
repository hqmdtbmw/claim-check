// app.js wires the page up to Wikipedia. It fetches, classifies
// and renders. The real logic is in claimcheck.js, this file just
// talks to the network and the page.

import {
  addToHistory,
  batchCopyLines,
  batchSummary,
  checkedAgo,
  classifyEvidence,
  decodeClaimFromHash,
  decodeClaimsFromHash,
  encodeClaimInHash,
  encodeClaimsInHash,
  explainStance,
  extractKeywords,
  filterSourcesByStance,
  isDisambiguationPage,
  updateHistoryAges,
  loadHistory,
  pageUpdatedAt,
  saveHistory,
  searchQueryFallbacks,
  shortenExtract,
  splitClaims,
  stancesPresent,
  summarizeVerdict,
  updatedLine,
  verdictCopyLines,
  verdictTone,
} from "./claimcheck.js";

const API =
  "https://en.wikipedia.org/w/api.php?format=json&origin=*";

const form = document.getElementById("claim-form");
const input = document.getElementById("claim-input");
const submitButton = document.getElementById("check-button");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const historySection = document.getElementById("history");
const historyList = document.getElementById("history-list");
const clearHistoryButton = document.getElementById("clear-history");
const modeSingleButton = document.getElementById("mode-single");
const modeBatchButton = document.getElementById("mode-batch");
const claimLabel = document.getElementById("claim-label");

// One claim or several: the toggle only changes what the box
// invites you to paste. A paste with more than one line runs as
// a batch either way, so the single-claim flow never changes.
let batchMode = false;

function setMode(batch) {
  batchMode = batch;
  modeSingleButton.setAttribute("aria-pressed", String(!batch));
  modeBatchButton.setAttribute("aria-pressed", String(batch));
  claimLabel.textContent = batch ? "The claims" : "The claim";
  input.rows = batch ? 6 : 3;
  input.placeholder = batch
    ? "One claim per line, like:\nThe moon landings were faked\nHumans use only 10% of their brains"
    : "e.g. The moon landings were faked";
  submitButton.textContent = batch ? "Check the claims" : "Check the claim";
}

modeSingleButton.addEventListener("click", () => setMode(false));
modeBatchButton.addEventListener("click", () => setMode(true));

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.example;
    form.requestSubmit();
    input.focus();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const claims = splitClaims(input.value);
  if (claims.length === 0) {
    setStatus(
      batchMode ? "Type at least one claim first." : "Type a claim first.",
      true
    );
    input.focus();
    return;
  }
  if (claims.length === 1) {
    await checkClaim(claims[0]);
  } else {
    await checkBatch(claims);
  }
});

// The recent checks list. Each row shows the claim, the verdict
// it got, coloured so you can see at a glance what you found, and
// when you checked it, so a verdict from days ago reads as old
// news next to one from five minutes ago. A re-check runs the live
// check again from the claim text, it never trusts the stored
// verdict. An old entry saved before verdicts were stored has no
// label, so it just shows the claim on its own. An entry with no
// saved time shows no age, never a wrong one.
function renderHistory() {
  const history = loadHistory(window.localStorage);
  if (!history.length) {
    historySection.hidden = true;
    historyList.innerHTML = "";
    return;
  }
  historySection.hidden = false;
  historyList.innerHTML = history
    .map((item, i) => {
      const age = checkedAgo(item.checkedAt);
      return `
      <li>
        <span class="history-claim">${escapeHtml(item.claim)}</span>
        ${item.label ? `<span class="history-label tone-${verdictTone(item.label)}">${escapeHtml(item.label)}</span>` : ""}
        ${age ? `<span class="history-time" data-checked-at="${item.checkedAt}">${escapeHtml(age)}</span>` : ""}
        <button type="button" data-history-index="${i}">Check again</button>
      </li>`;
    })
    .join("");
}

function recordHistory(claim, label) {
  const history = addToHistory(loadHistory(window.localStorage), {
    claim,
    label,
    checkedAt: Date.now(),
  });
  saveHistory(window.localStorage, history);
  renderHistory();
}

// The ages under recent checks go stale while the page sits open,
// so this refreshes just the age text once a minute. It works out
// the age again from the time saved on each row, nothing is
// re-checked and nothing is fetched. The timer stops when the page
// goes away.
function refreshHistoryAges() {
  updateHistoryAges(historyList.querySelectorAll(".history-time"));
}

const historyAgeTimer = setInterval(refreshHistoryAges, 60 * 1000);
window.addEventListener("pagehide", () => clearInterval(historyAgeTimer));

historyList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-history-index]");
  if (!button) return;
  const history = loadHistory(window.localStorage);
  const item = history[parseInt(button.dataset.historyIndex, 10)];
  if (!item) return;
  input.value = item.claim;
  form.requestSubmit();
  input.focus();
});

clearHistoryButton.addEventListener("click", () => {
  saveHistory(window.localStorage, []);
  renderHistory();
});

renderHistory();

// If the link carried claims, they win over whatever is typed in.
// A batch link fills the box and runs the batch straight away;
// a single claim fills it and runs the single check, as before.
const sharedClaims = decodeClaimsFromHash(window.location.hash);
if (sharedClaims.length > 1) {
  setMode(true);
  input.value = sharedClaims.join("\n");
  checkBatch(sharedClaims);
} else if (sharedClaims.length === 1) {
  input.value = sharedClaims[0];
  checkClaim(sharedClaims[0]);
} else {
  const sharedClaim = decodeClaimFromHash(window.location.hash);
  if (sharedClaim) {
    input.value = sharedClaim;
    checkClaim(sharedClaim);
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = !message;
}

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.textContent = loading
    ? "Checking…"
    : batchMode
      ? "Check the claims"
      : "Check the claim";
}

// Search Wikipedia for one claim and sort what comes back.
// Throws when Wikipedia cannot be reached, so the caller
// decides what to show.
async function fetchAndClassify(claim) {
  const keywords = extractKeywords(claim);
  let searchResults = [];
  // Try the full query first, then shorter ones, stopping at the
  // first that finds anything. A narrow query often misses, and a
  // shorter one finds the article.
  for (const query of searchQueryFallbacks(claim)) {
    searchResults = await searchWikipedia(query);
    if (searchResults.length > 0) break;
  }

  if (searchResults.length === 0) {
    return { verdict: summarizeVerdict([]), classified: [] };
  }

  const titles = searchResults.map((r) => r.title);
  const pages = (await fetchExtracts(titles)).filter(
    (page) => !isDisambiguationPage(page.title, page.extract)
  );

  const classified = pages.map((page) => ({
    title: page.title,
    url: page.fullurl,
    extract: page.extract,
    // The full extract decides the sorting, the short quote is
    // what the reader sees. A missing quote just leaves the
    // reason line on its own, never an error. The last revision
    // time says how fresh the article is, and a missing one
    // just leaves the date out.
    snippet: shortenExtract(page.extract),
    updatedAt: pageUpdatedAt(page),
    ...classifyEvidence(page.extract, keywords, page.title),
  }));

  return { verdict: summarizeVerdict(classified), classified };
}

async function checkClaim(claim) {
  setLoading(true);
  resultsEl.innerHTML = "";
  setStatus("Searching Wikipedia for evidence…");

  // Put the claim in the address bar so the link can be shared.
  // replaceState keeps it out of the back button history.
  history.replaceState(null, "", encodeClaimInHash(claim));

  try {
    const { verdict, classified } = await fetchAndClassify(claim);
    setStatus("");
    renderVerdict(claim, verdict, classified);
    recordHistory(claim, verdict.label);
  } catch (error) {
    setStatus(
      "Could not reach Wikipedia right now. Check your connection and try again.",
      true
    );
    console.error(error);
  } finally {
    setLoading(false);
  }
}

// Check several claims, one after another, in the order pasted.
// A claim Wikipedia will not answer for gets a plain "could not
// check" note instead of stopping the whole batch.
async function checkBatch(claims) {
  setLoading(true);
  resultsEl.innerHTML = "";

  // Put the whole batch in the address bar so the link can be
  // shared, the same as a single claim. replaceState keeps it
  // out of the back button history.
  history.replaceState(
    null,
    "",
    encodeClaimsInHash(claims) || window.location.pathname
  );

  const results = [];
  try {
    for (let i = 0; i < claims.length; i += 1) {
      setStatus(`Checking claim ${i + 1} of ${claims.length}…`);
      try {
        const { verdict, classified } = await fetchAndClassify(claims[i]);
        results.push({ claim: claims[i], verdict, classified });
      } catch (error) {
        console.error(error);
        results.push({
          claim: claims[i],
          verdict: {
            label: "Could not check this one",
            detail:
              "Wikipedia did not answer for this claim. Check your connection and try it on its own.",
          },
          classified: [],
        });
      }
    }
    setStatus("");
    renderBatch(results);
    // Record last claim first, so the first claim pasted ends up
    // at the top of the recent checks list.
    for (let i = results.length - 1; i >= 0; i -= 1) {
      recordHistory(results[i].claim, results[i].verdict.label);
    }
  } finally {
    setLoading(false);
  }
}

async function searchWikipedia(query) {
  const url =
    `${API}&action=query&list=search` +
    `&srsearch=${encodeURIComponent(query)}&srlimit=5`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Wikipedia search failed (${response.status})`);
  const data = await response.json();
  return (data.query && data.query.search) || [];
}

async function fetchExtracts(titles) {
  // revisions rides along on the same call, so the last edit time
  // costs no extra request. rvlimit=1 keeps just the latest one.
  const url =
    `${API}&action=query&prop=extracts|info|revisions&exintro&explaintext&inprop=url&rvprop=timestamp&rvlimit=1` +
    `&titles=${encodeURIComponent(titles.join("|"))}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Wikipedia lookup failed (${response.status})`);
  const data = await response.json();
  const pages = (data.query && data.query.pages) || {};
  return Object.values(pages).filter((p) => p.extract);
}

const STANCE_LABEL = {
  supports: "Lines up with the claim",
  questions: "Pushes back on the claim",
  related: "Related background",
};

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The source cards, shared by the single check and the batch.
// Same verdict labels, same reason lines, same links. The short
// quote from the article sits under the reason line, in small
// muted text, so the reader sees the article's own words. When
// there is no quote, the reason line stands on its own. Under the
// quote, the date the article was last updated, when Wikipedia
// gives one, so the reader can tell fresh evidence from a page
// nobody has touched in years. The stance filter only changes
// which cards show, it never changes the cards themselves.
function evidenceCards(classified, stance = "all") {
  const shown = filterSourcesByStance(classified, stance);
  if (shown.length === 0) {
    return `<p class="no-sources">No sources in this group.</p>`;
  }
  return shown
    .map((item) => {
      const updated = updatedLine(item.updatedAt);
      return `
      <article class="evidence ${item.stance}">
        <header>
          <h3>${escapeHtml(item.title)}</h3>
          <span class="stance">${STANCE_LABEL[item.stance]}</span>
        </header>
        <p class="why">${escapeHtml(explainStance(item))}</p>
        ${item.snippet ? `<p class="quote">“${escapeHtml(item.snippet)}”</p>` : ""}
        ${updated ? `<p class="updated">${escapeHtml(updated)}</p>` : ""}
        <a href="${item.url}" target="_blank" rel="noopener">Read on Wikipedia →</a>
      </article>`;
    })
    .join("");
}

// The filter buttons above a set of sources: All, Supporting,
// Questioning, Background, each with how many sources it holds.
// A stance with no sources in it is greyed out, so clicking it
// can never leave an empty list. Each set of sources gets its
// own buttons, so a batch result filters on its own. The buttons
// are rebuilt with every new check, so the filter always starts
// back on All. The copy button reads the full list, never the
// filtered one, so what you copy is not affected by the filter.
const SOURCE_FILTERS = [
  { stance: "all", label: "All" },
  { stance: "supports", label: "Supporting" },
  { stance: "questions", label: "Questioning" },
  { stance: "related", label: "Background" },
];

// The full source list behind each filter group, keyed by the
// group id the buttons carry, so a click can re-render just
// that group's cards from the unfiltered list.
const evidenceGroups = new Map();

function evidenceGroup(classified, groupId) {
  if (classified.length === 0) return "";
  evidenceGroups.set(groupId, classified);
  const present = stancesPresent(classified);
  const buttons = SOURCE_FILTERS.map(({ stance, label }) => {
    const count = filterSourcesByStance(classified, stance).length;
    const disabled = stance !== "all" && !present.includes(stance);
    return `<button type="button" data-filter-group="${groupId}" data-stance="${stance}" aria-pressed="${stance === "all"}" ${disabled ? "disabled" : ""}>${label} (${count})</button>`;
  }).join("");
  return `
    <div class="source-filters" role="group" aria-label="Show only some sources">
      ${buttons}
    </div>
    <div class="evidence-list" data-evidence-group="${groupId}">
      ${evidenceCards(classified)}
    </div>`;
}

// One listener for every filter button on the page, old and new.
// The buttons are rebuilt with each render, so listening on the
// results container catches them all without rewiring.
resultsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-stance]");
  if (!button || button.disabled) return;
  const groupId = button.dataset.filterGroup;
  const list = resultsEl.querySelector(
    `[data-evidence-group="${groupId}"]`
  );
  const classified = evidenceGroups.get(groupId);
  if (!list || !classified) return;
  resultsEl
    .querySelectorAll(`[data-filter-group="${groupId}"]`)
    .forEach((other) => {
      other.setAttribute("aria-pressed", String(other === button));
    });
  list.innerHTML = evidenceCards(classified, button.dataset.stance);
});

function wireCopyButton(button, lines, idleLabel) {
  if (!button) return;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = idleLabel;
      }, 2000);
    } catch {
      button.textContent = "Copy did not work, select the text instead";
    }
  });
}

function renderVerdict(claim, verdict, classified) {
  const supports = classified.filter((r) => r.stance === "supports").length;
  const questions = classified.filter((r) => r.stance === "questions").length;
  evidenceGroups.clear();

  resultsEl.innerHTML = `
    <section class="verdict" aria-live="polite">
      <p class="verdict-claim">“${escapeHtml(claim)}”</p>
      <h2>${escapeHtml(verdict.label)}</h2>
      <p>${escapeHtml(verdict.detail)}</p>
      <p class="counts">${supports} source${supports === 1 ? "" : "s"} line up · ${questions} push back · ${classified.length} checked</p>
    </section>
    ${evidenceGroup(classified, "single")}
    <p class="disclaimer">Wikipedia is a starting point, not a judge. The verdict above is just a guide, the sources are the real answer. Read them before you share the claim.</p>
    <p class="share-hint">Want to send this check to someone? The link in your address bar already holds the claim, just copy it and send it.</p>
    <p><button type="button" id="copy-verdict">Copy the verdict</button></p>`;

  wireCopyButton(
    document.getElementById("copy-verdict"),
    verdictCopyLines(claim, verdict, classified),
    "Copy the verdict"
  );
}

// The batch results: a compact list, one row per claim, with the
// verdict next to it. Open a row to see the same verdict detail
// and source cards as a single check. The first row starts open.
function renderBatch(results) {
  const totalSupports = results.reduce(
    (n, r) => n + r.classified.filter((c) => c.stance === "supports").length,
    0
  );
  const totalQuestions = results.reduce(
    (n, r) => n + r.classified.filter((c) => c.stance === "questions").length,
    0
  );
  evidenceGroups.clear();

  const items = results
    .map((result, i) => {
      return `
      <details class="batch-item" ${i === 0 ? "open" : ""}>
        <summary>
          <span class="batch-claim">“${escapeHtml(result.claim)}”</span>
          <span class="batch-verdict">${escapeHtml(result.verdict.label)}</span>
        </summary>
        <p>${escapeHtml(result.verdict.detail)}</p>
        ${evidenceGroup(result.classified, `batch-${i}`)}
      </details>`;
    })
    .join("");

  resultsEl.innerHTML = `
    <section class="verdict" aria-live="polite">
      <h2>${results.length} claims checked</h2>
      <p class="batch-summary">${escapeHtml(batchSummary(results))}</p>
      <p class="counts">${totalSupports} source${totalSupports === 1 ? "" : "s"} line up · ${totalQuestions} push back · open a claim to see its sources</p>
    </section>
    ${items}
    <p class="disclaimer">Wikipedia is a starting point, not a judge. The verdicts above are just a guide, the sources are the real answer. Read them before you share the claims.</p>
    <p class="share-hint">Want to send these checks to someone? The link in your address bar already holds the whole batch, just copy it and send it.</p>
    <p><button type="button" id="copy-verdict">Copy all the verdicts</button></p>`;

  const lines = batchCopyLines(results);
  wireCopyButton(
    document.getElementById("copy-verdict"),
    lines,
    "Copy all the verdicts"
  );
}
