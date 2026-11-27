// claimcheck.js holds the pure logic behind Claim Check.
// No DOM, no network. app.js uses it in the browser and the
// test suite uses it under test/. Keeping it separate from the
// fetching means the verdict logic can be tested without Wikipedia.

export const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for",
  "with", "by", "at", "from", "is", "are", "was", "were", "be", "been",
  "being", "it", "its", "this", "that", "these", "those", "i", "you",
  "he", "she", "we", "they", "them", "his", "her", "their", "our",
  "your", "my", "as", "if", "so", "do", "does", "did", "can", "could",
  "will", "would", "should", "has", "have", "had", "not", "no", "yes",
  "than", "then", "there", "here", "when", "where", "which", "who",
  "whom", "what", "how", "why", "all", "any", "some", "more", "most",
  "only", "very", "just", "also", "into", "over", "under", "about",
  "between", "after", "before", "during", "against", "without",
]);

// Phrases that usually mean a source is disputing, debunking or
// qualifying a claim rather than confirming it.
export const NEGATION_SIGNALS = [
  "no evidence",
  "no scientific evidence",
  "no credible evidence",
  "not supported",
  "false",
  "debunked",
  "myth",
  "hoax",
  "conspiracy theory",
  "disputed",
  "not true",
  "incorrect",
  "misleading",
  "unsubstantiated",
  "pseudoscience",
  "refuted",
  "urban legend",
  "fabricated",
  "no basis",
];

// Pull the words that carry the meaning out of a claim.
// "The moon landings were faked" -> ["moon", "landings", "faked"]
export function extractKeywords(claim) {
  if (!claim || typeof claim !== "string") return [];
  const words = claim
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 6);
}

// Build the query sent to Wikipedia. Falls back to the raw claim
// when it is too short or made only of stopwords.
export function buildSearchQuery(claim) {
  const keywords = extractKeywords(claim);
  if (keywords.length > 0) return keywords.join(" ");
  return (claim || "").trim();
}

// The searches to try for a claim, most specific first. A narrow
// query often finds nothing, so the app tries again with fewer
// keywords before giving up. The full keyword query comes first,
// then the first three keywords, then the first keyword on its
// own, then the raw claim as a last resort. Repeats are dropped
// (a match ignores case), so a one-word claim gives one query.
export function searchQueryFallbacks(claim) {
  const keywords = extractKeywords(claim);
  const raw = (claim || "").trim();
  const candidates = [
    buildSearchQuery(claim),
    keywords.slice(0, 3).join(" "),
    keywords[0] || "",
    raw,
  ];
  const seen = new Set();
  return candidates.filter((query) => {
    if (!query) return false;
    const key = query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Words in a title that mean the article is about a depiction of
// the topic, a film, a song or a novel, rather than the topic itself.
const DEPICTION_WORDS = [
  "film",
  "novel",
  "documentary",
  "mockumentary",
  "song",
  "album",
  "in popular culture",
  "television",
  "video game",
];
// Returns the stance, which keywords the extract actually mentions,
// and which doubt-phrases it contains, so the UI can show its work.
//
// A source only counts as supporting when it both mentions the claim's
// keywords in the text AND shares one of them with its title. Without
// that, a keyword match is usually a coincidence. A film about faking
// the Moon landing is not evidence the landings were faked.
export function classifyEvidence(extract, keywords, title = "") {
  const text = (extract || "").toLowerCase();
  const titleText = (title || "").toLowerCase();
  const matchedKeywords = (keywords || []).filter((k) =>
    text.includes(k.toLowerCase())
  );
  const titleKeywords = (keywords || []).filter((k) =>
    titleText.includes(k.toLowerCase())
  );
  const signals = NEGATION_SIGNALS.filter((s) => text.includes(s));
  const isDepiction = DEPICTION_WORDS.some((w) => titleText.includes(w));

  if (signals.length > 0) {
    return { stance: "questions", matchedKeywords, titleKeywords, signals };
  }
  if (matchedKeywords.length >= 2 && titleKeywords.length >= 1 && !isDepiction) {
    return { stance: "supports", matchedKeywords, titleKeywords, signals };
  }
  return { stance: "related", matchedKeywords, titleKeywords, signals };
}

// Say, in plain words, why an article landed where it did. The
// reason names the claim keywords the article actually mentions,
// the title match when there is one, and any pushback words found
// in it, so the sorting is not a black box. It takes the result
// classifyEvidence returns.
export function explainStance(result) {
  const item = result || {};
  const matched = (item.matchedKeywords || []).filter(Boolean);
  const signals = (item.signals || []).filter(Boolean);
  const titleMatches = (item.titleKeywords || []).filter(Boolean);

  const joinWords = (words) => {
    if (words.length === 1) return words[0];
    return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  };
  const quoted = (words) => joinWords(words.map((w) => `"${w}"`));

  if (item.stance === "questions") {
    if (matched.length > 0) {
      return `This counts as pushback because it mentions ${joinWords(matched)}, and it uses ${quoted(signals)}.`;
    }
    return `This counts as pushback because it uses ${quoted(signals)}.`;
  }
  if (item.stance === "supports") {
    if (titleMatches.length > 0) {
      return `This counts as supporting because it mentions ${joinWords(matched)}, and its title covers ${joinWords(titleMatches)}.`;
    }
    return `This counts as supporting because it mentions ${joinWords(matched)}.`;
  }
  if (matched.length > 0) {
    return `This is background only: it mentions ${joinWords(matched)}, but it never confirms the claim or pushes back on it.`;
  }
  return "This is background only: it never mentions the claim's key words, and nothing in it pushes back either.";
}

// Shorten a source extract to the first one or two sentences, so
// the reader sees the article's own words under the reason line
// without a wall of text. A long sentence is cut at a word
// boundary around 280 characters. Missing or empty extracts give
// back "", and the UI just shows the reason line on its own.
const SENTENCE_ABBREVIATIONS = [
  "u.s.", "u.k.", "e.g.", "i.e.", "dr.", "mr.", "mrs.", "ms.",
  "st.", "vs.", "etc.", "no.",
];

// Split text into sentences. A full stop only ends a sentence when
// the next word starts with a capital, a digit or a quote, and the
// word before it is not a common abbreviation, so "U.S. Navy" and
// "Dr. Smith" stay in one piece.
function splitSentences(text) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    const isEnd = i === text.length - 1;
    if (!isEnd) {
      if (text[i + 1] !== " ") continue;
      const nextChar = text[i + 2];
      if (nextChar && !/[A-Z0-9"“(]/.test(nextChar)) continue;
      const tail = text.slice(Math.max(0, i - 5), i + 1).toLowerCase();
      if (SENTENCE_ABBREVIATIONS.some((abbr) => tail.endsWith(abbr))) {
        continue;
      }
    }
    sentences.push(text.slice(start, i + 1).trim());
    start = i + 2;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences.filter(Boolean);
}

export function shortenExtract(extract, maxSentences = 2, maxLength = 280) {
  const text = (extract || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentences = splitSentences(text);
  let out = sentences.slice(0, maxSentences).join(" ");
  if (!out) out = text;
  if (out.length > maxLength) {
    const cut = out.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(" ");
    out = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
  }
  return out;
}

// A disambiguation page lists several topics that share a name,
// it is not an article about any of them. Its extract starts
// with "may refer to:", and its title often says so too.
export function isDisambiguationPage(title, extract) {
  const titleText = (title || "").toLowerCase();
  const text = (extract || "").toLowerCase();
  return (
    titleText.includes("(disambiguation)") ||
    text.includes("may refer to:")
  );
}

// Turn a list of classified results into one plain-language verdict.
// This is a guide, not a fact-checker: the sources below it are the
// real answer, and the UI says so.
export function summarizeVerdict(results) {
  const supports = results.filter((r) => r.stance === "supports").length;
  const questions = results.filter((r) => r.stance === "questions").length;

  if (results.length === 0) {
    return {
      label: "Nothing found",
      detail:
        "Wikipedia had no article that matched this claim. Try rephrasing it, or checking the claim against another source.",
    };
  }
  if (questions > 0 && supports === 0) {
    return {
      label: "The evidence raises doubts",
      detail:
        "The sources found describe this claim as disputed, a myth, or unsupported. Read them before believing it.",
    };
  }
  if (supports > 0 && questions === 0) {
    return {
      label: "The evidence lines up",
      detail:
        "The sources found are consistent with the claim. That is a good sign, but it is still worth reading the sources.",
    };
  }
  if (supports > 0 && questions > 0) {
    return {
      label: "Mixed picture",
      detail:
        "Some sources line up with the claim and others push back on it. Read both sides before deciding.",
    };
  }
  return {
    label: "Related, but no clear answer",
    detail:
      "The sources found are about the topic, but none of them clearly confirms or disputes the claim.",
  };
}

// Split pasted text into one claim per line. People usually
// fact-check a paragraph, not a single sentence, so the batch
// mode runs each line as its own claim. Blank lines are dropped,
// and so are lines too short to be a claim: under three words,
// or under ten characters. A lone "yes" or "the moon" is not
// worth a Wikipedia search.
export function splitClaims(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.length < 10) return false;
      return line.split(/\s+/).length >= 3;
    });
}

// Shareable links: a check lives in the URL hash as
// #claim=<encoded claim>, so the link can be copied and sent to
// someone else. Anyone opening it sees the same claim checked.
// encodeURIComponent keeps every character URL-safe, including
// &, #, ?, = and unicode, so the claim survives the round trip
// intact. There is no length cap here: browsers accept hashes
// far longer than any claim a person would paste.

export const HASH_CLAIM_PARAM = "claim";

export function encodeClaimInHash(claim) {
  const clean = (claim || "").trim();
  if (!clean) return "";
  return `#${HASH_CLAIM_PARAM}=${encodeURIComponent(clean)}`;
}

// Pull a claim back out of a hash. Returns "" when there is no
// claim in it, the hash is empty, or the encoding is broken.
export function decodeClaimFromHash(hash) {
  if (!hash || typeof hash !== "string") return "";
  try {
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    const value = new URLSearchParams(raw).get(HASH_CLAIM_PARAM);
    if (!value) return "";
    return value.trim();
  } catch {
    return "";
  }
}

// History: the last few claims you checked, so you can run one again
// without typing it out. It lives in the browser only, nothing
// leaves your machine. These helpers are pure, so the tests can use
// them without a real localStorage.

export const HISTORY_KEY = "claim-check-history";
export const MAX_HISTORY = 8;

// Put a new check at the front. If the same claim is already in the
// list, it moves to the front instead of appearing twice.
export function addToHistory(history, entry) {
  const clean = (entry && entry.claim ? entry.claim : "").trim();
  if (!clean) return [...(history || [])];
  const rest = (history || []).filter(
    (item) =>
      (item.claim || "").trim().toLowerCase() !== clean.toLowerCase()
  );
  return [
    {
      claim: clean,
      label: (entry && entry.label) || "",
      checkedAt: (entry && entry.checkedAt) || Date.now(),
    },
    ...rest,
  ].slice(0, MAX_HISTORY);
}

// Read the saved list out of a storage shaped like localStorage.
// A missing key or bad JSON just means an empty list.
export function loadHistory(storage) {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.claim === "string");
  } catch {
    return [];
  }
}

// Write the list back. If the browser blocks storage, this does
// nothing instead of breaking the page.
export function saveHistory(storage, history) {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(history || []));
  } catch {
    // storage unavailable, the page still works without history
  }
}
