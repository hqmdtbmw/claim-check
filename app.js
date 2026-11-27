// app.js wires the page up to Wikipedia. It fetches, classifies
// and renders. The real logic is in claimcheck.js, this file just
// talks to the network and the page.

import {
  addToHistory,
  classifyEvidence,
  decodeClaimFromHash,
  encodeClaimInHash,
  explainStance,
  extractKeywords,
  isDisambiguationPage,
  loadHistory,
  saveHistory,
  searchQueryFallbacks,
  splitClaims,
  summarizeVerdict,
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

// The recent checks list. Each row shows the claim and the verdict
// it got, with a button to run it again.
function renderHistory() {
  const history = loadHistory(window.localStorage);
  if (!history.length) {
    historySection.hidden = true;
    historyList.innerHTML = "";
    return;
  }
  historySection.hidden = false;
  historyList.innerHTML = history
    .map(
      (item, i) => `
      <li>
        <span class="history-claim">${escapeHtml(item.claim)}</span>
        <span class="history-label">${escapeHtml(item.label || "")}</span>
        <button type="button" data-history-index="${i}">Check again</button>
      </li>`
    )
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

// If the link carried a claim, it wins over whatever is typed in.
// Fill the input and run the check straight away.
const sharedClaim = decodeClaimFromHash(window.location.hash);
if (sharedClaim) {
  input.value = sharedClaim;
  checkClaim(sharedClaim);
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

  // A batch has no single claim to share, so clear any old
  // #claim link out of the address bar.
  history.replaceState(null, "", window.location.pathname);

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
  const url =
    `${API}&action=query&prop=extracts|info&exintro&explaintext&inprop=url` +
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
// Same verdict labels, same reason lines, same links.
function evidenceCards(classified) {
  return classified
    .map((item) => {
      return `
      <article class="evidence ${item.stance}">
        <header>
          <h3>${escapeHtml(item.title)}</h3>
          <span class="stance">${STANCE_LABEL[item.stance]}</span>
        </header>
        <p>${escapeHtml(item.extract)}</p>
        <p class="why">${escapeHtml(explainStance(item))}</p>
        <a href="${item.url}" target="_blank" rel="noopener">Read on Wikipedia →</a>
      </article>`;
    })
    .join("");
}

// The plain-text version of one check, for the copy button.
function verdictCopyLines(claim, verdict, classified) {
  return [
    `Claim: ${claim}`,
    `Verdict: ${verdict.label}`,
    verdict.detail,
    "",
    "Sources:",
    ...classified.flatMap((item) => [
      `- ${item.title} (${item.url})`,
      `  ${explainStance(item)}`,
    ]),
  ];
}

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

  resultsEl.innerHTML = `
    <section class="verdict" aria-live="polite">
      <p class="verdict-claim">“${escapeHtml(claim)}”</p>
      <h2>${escapeHtml(verdict.label)}</h2>
      <p>${escapeHtml(verdict.detail)}</p>
      <p class="counts">${supports} source${supports === 1 ? "" : "s"} line up · ${questions} push back · ${classified.length} checked</p>
    </section>
    ${evidenceCards(classified)}
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

  const items = results
    .map((result, i) => {
      return `
      <details class="batch-item" ${i === 0 ? "open" : ""}>
        <summary>
          <span class="batch-claim">“${escapeHtml(result.claim)}”</span>
          <span class="batch-verdict">${escapeHtml(result.verdict.label)}</span>
        </summary>
        <p>${escapeHtml(result.verdict.detail)}</p>
        ${evidenceCards(result.classified)}
      </details>`;
    })
    .join("");

  resultsEl.innerHTML = `
    <section class="verdict" aria-live="polite">
      <h2>${results.length} claims checked</h2>
      <p class="counts">${totalSupports} source${totalSupports === 1 ? "" : "s"} line up · ${totalQuestions} push back · open a claim to see its sources</p>
    </section>
    ${items}
    <p class="disclaimer">Wikipedia is a starting point, not a judge. The verdicts above are just a guide, the sources are the real answer. Read them before you share the claims.</p>
    <p class="share-hint">A batch has no single shareable link. Check a claim on its own if you want to send it to someone.</p>
    <p><button type="button" id="copy-verdict">Copy all the verdicts</button></p>`;

  const lines = results.flatMap((result, i) => [
    ...(i > 0 ? [""] : []),
    ...verdictCopyLines(result.claim, result.verdict, result.classified),
  ]);
  wireCopyButton(
    document.getElementById("copy-verdict"),
    lines,
    "Copy all the verdicts"
  );
}
