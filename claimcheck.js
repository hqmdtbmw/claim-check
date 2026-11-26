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
    return { stance: "questions", matchedKeywords, signals };
  }
  if (matchedKeywords.length >= 2 && titleKeywords.length >= 1 && !isDepiction) {
    return { stance: "supports", matchedKeywords, signals };
  }
  return { stance: "related", matchedKeywords, signals };
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
