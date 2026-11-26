// app.js wires the page up to Wikipedia. It fetches, classifies
// and renders. The real logic is in claimcheck.js, this file just
// talks to the network and the page.

import {
  addToHistory,
  buildSearchQuery,
  classifyEvidence,
  extractKeywords,
  isDisambiguationPage,
  loadHistory,
  saveHistory,
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

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.example;
    form.requestSubmit();
    input.focus();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const claim = input.value.trim();
  if (claim.length < 3) {
    setStatus("Type a claim first.", true);
    input.focus();
    return;
  }
  await checkClaim(claim);
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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = !message;
}

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.textContent = loading ? "Checking…" : "Check the claim";
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

async function checkClaim(claim) {
  setLoading(true);
  resultsEl.innerHTML = "";
  setStatus("Searching Wikipedia for evidence…");

  try {
    const keywords = extractKeywords(claim);
    const query = buildSearchQuery(claim);
    const searchResults = await searchWikipedia(query);

    if (searchResults.length === 0) {
      setStatus("");
      const verdict = summarizeVerdict([]);
      renderVerdict(claim, verdict, []);
      recordHistory(claim, verdict.label);
      return;
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

    setStatus("");
    const verdict = summarizeVerdict(classified);
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

function renderVerdict(claim, verdict, classified) {
  const supports = classified.filter((r) => r.stance === "supports").length;
  const questions = classified.filter((r) => r.stance === "questions").length;

  const cards = classified
    .map((item) => {
      const signals = item.signals.length
        ? `<p class="signals">Flagged phrases: ${item.signals
            .map((s) => `<mark>${escapeHtml(s)}</mark>`)
            .join(" ")}</p>`
        : "";
      const keywords = item.matchedKeywords.length
        ? `<p class="keywords">Mentions: ${item.matchedKeywords
            .map(escapeHtml)
            .join(", ")}</p>`
        : "";
      return `
      <article class="evidence ${item.stance}">
        <header>
          <h3>${escapeHtml(item.title)}</h3>
          <span class="stance">${STANCE_LABEL[item.stance]}</span>
        </header>
        <p>${escapeHtml(item.extract)}</p>
        ${keywords}
        ${signals}
        <a href="${item.url}" target="_blank" rel="noopener">Read on Wikipedia →</a>
      </article>`;
    })
    .join("");

  resultsEl.innerHTML = `
    <section class="verdict" aria-live="polite">
      <p class="verdict-claim">“${escapeHtml(claim)}”</p>
      <h2>${escapeHtml(verdict.label)}</h2>
      <p>${escapeHtml(verdict.detail)}</p>
      <p class="counts">${supports} source${supports === 1 ? "" : "s"} line up · ${questions} push back · ${classified.length} checked</p>
    </section>
    ${cards}
    <p class="disclaimer">Wikipedia is a starting point, not a judge. The verdict above is just a guide, the sources are the real answer. Read them before you share the claim.</p>
    <p><button type="button" id="copy-verdict">Copy the verdict</button></p>`;

  const copyButton = document.getElementById("copy-verdict");
  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      const lines = [
        `Claim: ${claim}`,
        `Verdict: ${verdict.label}`,
        verdict.detail,
        "",
        "Sources:",
        ...classified.map((item) => `- ${item.title} (${item.url})`),
      ];
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        copyButton.textContent = "Copied";
        setTimeout(() => {
          copyButton.textContent = "Copy the verdict";
        }, 2000);
      } catch {
        copyButton.textContent = "Copy did not work, select the text instead";
      }
    });
  }
}
