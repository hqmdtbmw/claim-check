import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addToHistory,
  batchCopyLines,
  batchSummary,
  buildSearchQuery,
  classifyEvidence,
  decodeClaimFromHash,
  encodeClaimInHash,
  explainStance,
  extractKeywords,
  filterSourcesByStance,
  formatUpdatedDate,
  isDisambiguationPage,
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
} from "../claimcheck.js";

describe("extractKeywords", () => {
  it("keeps the words that carry the meaning", () => {
    assert.deepEqual(extractKeywords("The moon landings were faked"), [
      "moon",
      "landings",
      "faked",
    ]);
  });

  it("drops stopwords, punctuation and duplicates", () => {
    assert.deepEqual(
      extractKeywords("Humans use only 10% of their brains, humans!"),
      ["humans", "use", "brains"]
    );
  });

  it("caps the list at six keywords", () => {
    const keywords = extractKeywords(
      "alpha beta gamma delta epsilon zeta eta theta"
    );
    assert.equal(keywords.length, 6);
  });

  it("returns an empty list for empty or stopword-only input", () => {
    assert.deepEqual(extractKeywords(""), []);
    assert.deepEqual(extractKeywords("the and of"), []);
    assert.deepEqual(extractKeywords(null), []);
  });
});

describe("filterSourcesByStance", () => {
  const sources = [
    { title: "Apollo 11", stance: "supports" },
    { title: "Moon landing conspiracy theories", stance: "questions" },
    { title: "Moon", stance: "related" },
    { title: "Apollo 13", stance: "supports" },
  ];

  it("keeps only the sources that support the claim", () => {
    assert.deepEqual(filterSourcesByStance(sources, "supports"), [
      { title: "Apollo 11", stance: "supports" },
      { title: "Apollo 13", stance: "supports" },
    ]);
  });

  it("keeps only the sources that push back on the claim", () => {
    assert.deepEqual(filterSourcesByStance(sources, "questions"), [
      { title: "Moon landing conspiracy theories", stance: "questions" },
    ]);
  });

  it("keeps only the background sources", () => {
    assert.deepEqual(filterSourcesByStance(sources, "related"), [
      { title: "Moon", stance: "related" },
    ]);
  });

  it("returns everything for All", () => {
    assert.deepEqual(filterSourcesByStance(sources, "all"), sources);
  });

  it("returns everything for an unknown stance", () => {
    assert.deepEqual(filterSourcesByStance(sources, "maybe"), sources);
    assert.deepEqual(filterSourcesByStance(sources, ""), sources);
    assert.deepEqual(filterSourcesByStance(sources, null), sources);
    assert.deepEqual(filterSourcesByStance(sources, undefined), sources);
  });

  it("returns an empty list for an empty list, whatever the stance", () => {
    assert.deepEqual(filterSourcesByStance([], "supports"), []);
    assert.deepEqual(filterSourcesByStance([], "questions"), []);
    assert.deepEqual(filterSourcesByStance([], "related"), []);
    assert.deepEqual(filterSourcesByStance([], "all"), []);
    assert.deepEqual(filterSourcesByStance(null, "supports"), []);
    assert.deepEqual(filterSourcesByStance(undefined, "all"), []);
  });
});

describe("stancesPresent", () => {
  it("lists the stances in a mixed set of sources, in button order", () => {
    assert.deepEqual(
      stancesPresent([
        { stance: "related" },
        { stance: "supports" },
        { stance: "questions" },
      ]),
      ["supports", "questions", "related"]
    );
  });

  it("leaves out a stance with no sources in it", () => {
    assert.deepEqual(
      stancesPresent([{ stance: "questions" }, { stance: "related" }]),
      ["questions", "related"]
    );
  });

  it("ignores sources with no stance or an unknown one", () => {
    assert.deepEqual(
      stancesPresent([{ stance: "supports" }, {}, { stance: "maybe" }]),
      ["supports"]
    );
  });

  it("returns an empty list for an empty list", () => {
    assert.deepEqual(stancesPresent([]), []);
    assert.deepEqual(stancesPresent(null), []);
    assert.deepEqual(stancesPresent(undefined), []);
  });
});

describe("batchSummary", () => {
  const item = (label, claim = "The moon landings were faked") => ({
    claim,
    verdict: { label, detail: "Some detail." },
    classified: [],
  });

  it("sums up a batch where every claim lines up", () => {
    assert.equal(
      batchSummary([
        item("The evidence lines up"),
        item("The evidence lines up"),
        item("The evidence lines up"),
      ]),
      "3 checked: 3 look right"
    );
  });

  it("sums up a mix, only naming categories with a count", () => {
    assert.equal(
      batchSummary([
        item("The evidence lines up"),
        item("The evidence raises doubts"),
        item("Nothing found"),
      ]),
      "3 checked: 1 looks right, 1 has doubts, 1 found nothing"
    );
  });

  it("sums up a batch where nothing was found", () => {
    assert.equal(
      batchSummary([item("Nothing found"), item("Nothing found")]),
      "2 checked: 2 found nothing"
    );
  });

  it("covers mixed, unclear and uncheckable claims too", () => {
    assert.equal(
      batchSummary([
        item("Mixed picture"),
        item("Related, but no clear answer"),
        item("Could not check this one"),
      ]),
      "3 checked: 1 is mixed, 1 has no clear answer, 1 could not be checked"
    );
  });

  it("uses plurals when more than one claim lands in a category", () => {
    assert.equal(
      batchSummary([
        item("The evidence lines up"),
        item("The evidence lines up"),
        item("The evidence raises doubts"),
        item("The evidence raises doubts"),
      ]),
      "4 checked: 2 look right, 2 have doubts"
    );
  });

  it("gives an empty string for an empty batch", () => {
    assert.equal(batchSummary([]), "");
    assert.equal(batchSummary(null), "");
    assert.equal(batchSummary(undefined), "");
  });

  it("changes when a claim is re-checked with a new verdict", () => {
    const results = [
      item("The evidence lines up"),
      item("The evidence lines up"),
    ];
    assert.equal(batchSummary(results), "2 checked: 2 look right");
    results[0] = item("The evidence raises doubts");
    assert.equal(
      batchSummary(results),
      "2 checked: 1 looks right, 1 has doubts"
    );
  });
});

describe("batchCopyLines", () => {
  it("puts the summary line at the top of the copied text", () => {
    const lines = batchCopyLines([
      {
        claim: "The moon landings were faked",
        verdict: { label: "The evidence raises doubts", detail: "The sources push back." },
        classified: [],
      },
      {
        claim: "Apollo 11 landed the first humans on the Moon",
        verdict: { label: "The evidence lines up", detail: "The sources line up." },
        classified: [
          {
            title: "Apollo 11",
            url: "https://en.wikipedia.org/wiki/Apollo_11",
            stance: "supports",
            matchedKeywords: ["apollo", "moon"],
            titleKeywords: ["apollo"],
            signals: [],
            snippet: "Apollo 11 landed humans on the Moon in 1969.",
          },
        ],
      },
    ]);
    assert.equal(lines[0], "2 checked: 1 looks right, 1 has doubts");
    assert.equal(lines[1], "");
    assert.equal(lines[2], "Claim: The moon landings were faked");
    assert.equal(lines[3], "Verdict: The evidence raises doubts");
    assert.ok(lines.includes("Claim: Apollo 11 landed the first humans on the Moon"));
    assert.ok(lines.includes("- Apollo 11 (https://en.wikipedia.org/wiki/Apollo_11)"));
  });

  it("copies nothing for an empty batch", () => {
    assert.deepEqual(batchCopyLines([]), []);
  });
});

describe("splitClaims", () => {
  it("splits pasted text into one claim per line", () => {
    assert.deepEqual(
      splitClaims(
        "The moon landings were faked\nHumans use only 10% of their brains\nApollo 11 landed the first humans on the Moon"
      ),
      [
        "The moon landings were faked",
        "Humans use only 10% of their brains",
        "Apollo 11 landed the first humans on the Moon",
      ]
    );
  });

  it("trims each line and drops blank lines", () => {
    assert.deepEqual(
      splitClaims("  The moon landings were faked  \n\n   \nGoldfish have a memory of only three seconds\n"),
      [
        "The moon landings were faked",
        "Goldfish have a memory of only three seconds",
      ]
    );
  });

  it("handles Windows line endings", () => {
    assert.deepEqual(
      splitClaims("The moon landings were faked\r\nHumans use only 10% of their brains"),
      ["The moon landings were faked", "Humans use only 10% of their brains"]
    );
  });

  it("keeps a single claim as a list of one", () => {
    assert.deepEqual(splitClaims("The moon landings were faked"), [
      "The moon landings were faked",
    ]);
  });

  it("drops lines that are too short to be a claim", () => {
    assert.deepEqual(
      splitClaims("The moon landings were faked\nyes\nthe moon\nok"),
      ["The moon landings were faked"]
    );
  });

  it("drops a line with fewer than three words even if it is long enough", () => {
    assert.deepEqual(
      splitClaims("The moon landings were faked\nsupercalifragilistic expialidocious"),
      ["The moon landings were faked"]
    );
  });

  it("returns an empty list for empty or non-string input", () => {
    assert.deepEqual(splitClaims(""), []);
    assert.deepEqual(splitClaims("   \n\n  "), []);
    assert.deepEqual(splitClaims(null), []);
    assert.deepEqual(splitClaims(undefined), []);
  });
});

describe("buildSearchQuery", () => {
  it("joins the keywords into a query", () => {
    assert.equal(
      buildSearchQuery("The Great Wall of China is visible from space"),
      "great wall china visible space"
    );
  });

  it("falls back to the raw claim when there are no keywords", () => {
    assert.equal(buildSearchQuery("the"), "the");
  });
});

describe("searchQueryFallbacks", () => {
  it("tries the full query, then fewer keywords, then the raw claim", () => {
    assert.deepEqual(
      searchQueryFallbacks("The Great Wall of China is visible from space"),
      [
        "great wall china visible space",
        "great wall china",
        "great",
        "The Great Wall of China is visible from space",
      ]
    );
  });

  it("drops the first-three query when it repeats the full query", () => {
    assert.deepEqual(searchQueryFallbacks("The moon landings were faked"), [
      "moon landings faked",
      "moon",
      "The moon landings were faked",
    ]);
  });

  it("gives a single query for a one-word claim", () => {
    assert.deepEqual(searchQueryFallbacks("Moon"), ["moon"]);
  });

  it("falls back to the raw claim when there are only stopwords", () => {
    assert.deepEqual(searchQueryFallbacks("the and of"), ["the and of"]);
  });

  it("never contains an empty string", () => {
    for (const claim of ["", "   ", null, "the", "Moon", "the and of"]) {
      assert.ok(searchQueryFallbacks(claim).every((q) => q.length > 0));
    }
  });
});

describe("classifyEvidence", () => {
  const extract =
    "Apollo 11 was the American spaceflight that first landed humans on the Moon in 1969.";

  it("marks an extract that mentions the keywords as supporting", () => {
    const result = classifyEvidence(
      extract,
      ["apollo", "moon"],
      "Apollo 11"
    );
    assert.equal(result.stance, "supports");
    assert.deepEqual(result.matchedKeywords, ["apollo", "moon"]);
    assert.deepEqual(result.titleKeywords, ["apollo"]);
    assert.deepEqual(result.signals, []);
  });

  it("does not count a keyword match as support when the title is unrelated", () => {
    // A film about faking the Moon landing is not evidence it was faked.
    const result = classifyEvidence(
      "Operation Avalanche is a 2016 film about two CIA agents who fake the Moon landing.",
      ["moon", "landings", "faked"],
      "Operation Avalanche (film)"
    );
    assert.equal(result.stance, "related");
  });

  it("does not count a film whose title shares a keyword as support", () => {
    const result = classifyEvidence(
      "Dark Side of the Moon is a 2002 mockumentary about a faked Moon landing.",
      ["moon", "landings", "faked"],
      "Dark Side of the Moon (2002 film)"
    );
    assert.equal(result.stance, "related");
  });

  it("marks an extract with doubt language as questioning", () => {
    const result = classifyEvidence(
      "The ten percent of the brain myth states that humans use only a small part of their brains. There is no scientific evidence for it.",
      ["humans", "brains"]
    );
    assert.equal(result.stance, "questions");
    assert.ok(result.signals.includes("myth"));
    assert.ok(result.signals.includes("no scientific evidence"));
  });

  it("doubt language wins over keyword matches", () => {
    const result = classifyEvidence(
      "The moon landing hoax theory claims the landings were faked.",
      ["moon", "landings", "faked"]
    );
    assert.equal(result.stance, "questions");
  });

  it("marks an extract with no keyword overlap as related background", () => {
    const result = classifyEvidence(
      "Water is an inorganic compound with the chemical formula H2O.",
      ["headache", "cure"]
    );
    assert.equal(result.stance, "related");
    assert.deepEqual(result.matchedKeywords, []);
  });
});

describe("explainStance", () => {
  const supportExtract =
    "Apollo 11 was the American spaceflight that first landed humans on the Moon in 1969.";
  const pushbackExtract =
    "The ten percent of the brain myth states that humans use only a small part of their brains. There is no scientific evidence for it.";

  it("says why a supporting article counts, with the keywords and the title match", () => {
    const reason = explainStance(
      classifyEvidence(supportExtract, ["apollo", "moon"], "Apollo 11")
    );
    assert.equal(
      reason,
      'This counts as supporting because it mentions apollo and moon, and its title covers apollo.'
    );
  });

  it("names the pushback words found in a questioning article", () => {
    const reason = explainStance(
      classifyEvidence(pushbackExtract, ["humans", "brains"])
    );
    assert.equal(
      reason,
      'This counts as pushback because it mentions humans and brains, and it uses "no scientific evidence" and "myth".'
    );
  });

  it("names the pushback words even when no claim keyword matched", () => {
    const reason = explainStance(
      classifyEvidence("This idea is a hoax with no evidence behind it.", [
        "goldfish",
        "memory",
      ])
    );
    assert.equal(
      reason,
      'This counts as pushback because it uses "no evidence" and "hoax".'
    );
  });

  it("says why a related article is only background when a keyword matched", () => {
    const reason = explainStance(
      classifyEvidence(
        "The Moon is Earth's only natural satellite.",
        ["moon", "landings", "faked"]
      )
    );
    assert.equal(
      reason,
      "This is background only: it mentions moon, but it never confirms the claim or pushes back on it."
    );
  });

  it("says why a related article is only background when nothing matched", () => {
    const reason = explainStance(
      classifyEvidence(
        "Water is an inorganic compound with the chemical formula H2O.",
        ["headache", "cure"]
      )
    );
    assert.equal(
      reason,
      "This is background only: it never mentions the claim's key words, and nothing in it pushes back either."
    );
  });

  it("handles an empty result without crashing", () => {
    const expected =
      "This is background only: it never mentions the claim's key words, and nothing in it pushes back either.";
    assert.equal(explainStance({}), expected);
    assert.equal(explainStance(null), expected);
    assert.equal(explainStance(undefined), expected);
  });
});

describe("shortenExtract", () => {
  it("keeps the first two sentences of a longer extract", () => {
    assert.equal(
      shortenExtract(
        "Apollo 11 was the American spaceflight that first landed humans on the Moon in 1969. It was launched on July 16, 1969. The crew was Neil Armstrong, Buzz Aldrin and Michael Collins."
      ),
      "Apollo 11 was the American spaceflight that first landed humans on the Moon in 1969. It was launched on July 16, 1969."
    );
  });

  it("keeps a short extract whole", () => {
    assert.equal(
      shortenExtract("The Moon is Earth's only natural satellite."),
      "The Moon is Earth's only natural satellite."
    );
  });

  it("returns an empty string for a missing or blank extract", () => {
    assert.equal(shortenExtract(""), "");
    assert.equal(shortenExtract("   "), "");
    assert.equal(shortenExtract(null), "");
    assert.equal(shortenExtract(undefined), "");
  });

  it("does not split on abbreviations like U.S. or Dr.", () => {
    assert.equal(
      shortenExtract(
        "The U.S. Navy was founded in 1775. It is the largest navy in the world. Dr. Smith wrote about it later."
      ),
      "The U.S. Navy was founded in 1775. It is the largest navy in the world."
    );
  });

  it("cuts a long sentence at a word boundary with an ellipsis", () => {
    const long =
      "Apollo 11 was the American spaceflight that first landed humans on the Moon in 1969, " +
      "and it carried a crew of three astronauts on a journey that took eight days in total, " +
      "from launch to splashdown and back again, with two of them walking on the lunar surface " +
      "while the third stayed in orbit around the Moon in the command module.";
    const short = shortenExtract(long);
    assert.ok(short.length <= 281);
    assert.ok(short.endsWith("…"));
    assert.ok(!short.endsWith(" …"));
    assert.ok(short.startsWith("Apollo 11 was the American spaceflight"));
  });

  it("collapses newlines and extra spaces", () => {
    assert.equal(
      shortenExtract("First sentence here.\nSecond  sentence  here. Third one."),
      "First sentence here. Second sentence here."
    );
  });
});

describe("formatUpdatedDate", () => {
  it("turns a Wikipedia revision timestamp into plain words", () => {
    assert.equal(
      formatUpdatedDate("2026-11-25T12:34:56Z"),
      "25 November 2026"
    );
  });

  it("uses the calendar date, not the local time zone", () => {
    assert.equal(formatUpdatedDate("2026-01-02T00:30:00Z"), "2 January 2026");
    assert.equal(formatUpdatedDate("2026-12-31T23:59:59Z"), "31 December 2026");
  });

  it("returns an empty string for a missing or broken timestamp", () => {
    assert.equal(formatUpdatedDate(""), "");
    assert.equal(formatUpdatedDate(null), "");
    assert.equal(formatUpdatedDate(undefined), "");
    assert.equal(formatUpdatedDate("not a date"), "");
    assert.equal(formatUpdatedDate(20261125), "");
  });
});

describe("pageUpdatedAt", () => {
  it("pulls the last revision time out of a Wikipedia page", () => {
    assert.equal(
      pageUpdatedAt({
        title: "Apollo 11",
        revisions: [{ timestamp: "2026-11-25T12:34:56Z" }],
      }),
      "2026-11-25T12:34:56Z"
    );
  });

  it("gives back an empty string when there is no revision to read", () => {
    assert.equal(pageUpdatedAt({ title: "Apollo 11" }), "");
    assert.equal(pageUpdatedAt({ title: "Apollo 11", revisions: [] }), "");
    assert.equal(
      pageUpdatedAt({ title: "Apollo 11", revisions: [{}] }),
      ""
    );
    assert.equal(pageUpdatedAt(null), "");
    assert.equal(pageUpdatedAt(undefined), "");
  });
});

describe("updatedLine", () => {
  it("says when a source was last updated, in plain words", () => {
    assert.equal(
      updatedLine("2026-11-25T12:34:56Z"),
      "Last updated 25 November 2026"
    );
  });

  it("gives back an empty string when there is no date", () => {
    assert.equal(updatedLine(""), "");
    assert.equal(updatedLine(null), "");
    assert.equal(updatedLine(undefined), "");
    assert.equal(updatedLine("not a date"), "");
  });
});

describe("verdictCopyLines", () => {
  const classified = [
    {
      title: "Apollo 11",
      url: "https://en.wikipedia.org/wiki/Apollo_11",
      stance: "supports",
      matchedKeywords: ["apollo", "moon"],
      titleKeywords: ["apollo"],
      signals: [],
      snippet: "Apollo 11 landed humans on the Moon in 1969.",
      updatedAt: "2026-11-25T12:34:56Z",
    },
  ];

  it("includes the last updated date under a source that has one", () => {
    const lines = verdictCopyLines(
      "Apollo 11 landed the first humans on the Moon",
      { label: "The evidence lines up", detail: "The sources line up." },
      classified
    );
    assert.ok(lines.includes("- Apollo 11 (https://en.wikipedia.org/wiki/Apollo_11)"));
    assert.ok(lines.includes('  "Apollo 11 landed humans on the Moon in 1969."'));
    assert.ok(lines.includes("  Last updated 25 November 2026"));
  });

  it("leaves the date out when a source has none", () => {
    const lines = verdictCopyLines(
      "Apollo 11 landed the first humans on the Moon",
      { label: "The evidence lines up", detail: "The sources line up." },
      [{ ...classified[0], updatedAt: "" }]
    );
    assert.ok(!lines.some((line) => line.includes("Last updated")));
  });
});

describe("isDisambiguationPage", () => {
  it("spots a page whose extract lists meanings", () => {
    assert.equal(
      isDisambiguationPage(
        "Mercury",
        "Mercury may refer to: Mercury (planet), Mercury (element)..."
      ),
      true
    );
  });

  it("spots a page with disambiguation in the title", () => {
    assert.equal(
      isDisambiguationPage("Mercury (disambiguation)", "Some text."),
      true
    );
  });

  it("leaves a real article alone", () => {
    assert.equal(
      isDisambiguationPage(
        "Mercury (planet)",
        "Mercury is the smallest planet in the Solar System."
      ),
      false
    );
  });

  it("handles empty input without crashing", () => {
    assert.equal(isDisambiguationPage("", ""), false);
    assert.equal(isDisambiguationPage(null, null), false);
  });
});

describe("summarizeVerdict", () => {
  it("says nothing found when there are no results", () => {
    assert.equal(summarizeVerdict([]).label, "Nothing found");
  });

  it("says the evidence lines up when only sources support", () => {
    const verdict = summarizeVerdict([
      { stance: "supports" },
      { stance: "related" },
    ]);
    assert.equal(verdict.label, "The evidence lines up");
  });

  it("says doubts are raised when sources push back and none support", () => {
    const verdict = summarizeVerdict([
      { stance: "questions" },
      { stance: "related" },
    ]);
    assert.equal(verdict.label, "The evidence raises doubts");
  });

  it("says mixed when sources disagree", () => {
    const verdict = summarizeVerdict([
      { stance: "supports" },
      { stance: "questions" },
    ]);
    assert.equal(verdict.label, "Mixed picture");
  });

  it("says no clear answer when everything is only related", () => {
    const verdict = summarizeVerdict([{ stance: "related" }]);
    assert.equal(verdict.label, "Related, but no clear answer");
  });
});

describe("shareable links", () => {
  it("encodes a claim into a hash and decodes it back", () => {
    const claim = "The moon landings were faked";
    assert.equal(
      encodeClaimInHash(claim),
      "#claim=The%20moon%20landings%20were%20faked"
    );
    assert.equal(
      decodeClaimFromHash(encodeClaimInHash(claim)),
      claim
    );
  });

  it("keeps special characters intact through the round trip", () => {
    const claims = [
      "Fish & chips cost £5, or 50% more?",
      "Did the #1 album of 1999 sell 10m+ copies?",
      "Is 5 > 3 and 2 < 4?",
      "Café au lait: worth the hype?",
      "What is 2 + 2 = 4, really?",
      "Emoji in a claim 🐟 still works",
      "Quotes \"like this\" and 'this' too",
    ];
    for (const claim of claims) {
      assert.equal(decodeClaimFromHash(encodeClaimInHash(claim)), claim);
    }
  });

  it("handles a long claim without losing anything", () => {
    const claim = "The moon landings were faked ".repeat(100).trim();
    assert.ok(claim.length > 2500);
    assert.equal(decodeClaimFromHash(encodeClaimInHash(claim)), claim);
  });

  it("trims the claim before encoding", () => {
    assert.equal(
      decodeClaimFromHash(encodeClaimInHash("  goldfish have short memories  ")),
      "goldfish have short memories"
    );
  });

  it("returns an empty hash for an empty or blank claim", () => {
    assert.equal(encodeClaimInHash(""), "");
    assert.equal(encodeClaimInHash("   "), "");
    assert.equal(encodeClaimInHash(null), "");
  });

  it("returns an empty claim when the hash has no claim in it", () => {
    assert.equal(decodeClaimFromHash(""), "");
    assert.equal(decodeClaimFromHash("#"), "");
    assert.equal(decodeClaimFromHash("#foo=bar"), "");
    assert.equal(decodeClaimFromHash(null), "");
  });

  it("reads the claim even when other params share the hash", () => {
    assert.equal(
      decodeClaimFromHash("#claim=Goldfish%20forget%20fast&ref=twitter"),
      "Goldfish forget fast"
    );
  });

  it("works with or without the leading hash mark", () => {
    assert.equal(decodeClaimFromHash("claim=Hello%20world"), "Hello world");
  });

  it("does not crash on broken percent encoding", () => {
    assert.equal(decodeClaimFromHash("#claim=100%25%"), "100%%");
  });
});

describe("verdictTone", () => {
  it("colours each verdict label by what it found", () => {
    assert.equal(verdictTone("The evidence lines up"), "good");
    assert.equal(verdictTone("The evidence raises doubts"), "bad");
    assert.equal(verdictTone("Mixed picture"), "mixed");
    assert.equal(verdictTone("Nothing found"), "none");
    assert.equal(verdictTone("Related, but no clear answer"), "none");
    assert.equal(verdictTone("Could not check this one"), "none");
  });

  it("stays neutral for a missing or unknown label", () => {
    assert.equal(verdictTone(""), "none");
    assert.equal(verdictTone(null), "none");
    assert.equal(verdictTone(undefined), "none");
    assert.equal(verdictTone("Something else entirely"), "none");
  });
});

describe("history", () => {
  function fakeStorage() {
    const data = {};
    return {
      getItem: (key) => (key in data ? data[key] : null),
      setItem: (key, value) => {
        data[key] = String(value);
      },
    };
  }

  it("puts the newest check first", () => {
    const history = addToHistory(
      [{ claim: "first claim", label: "Mixed picture", checkedAt: 1 }],
      { claim: "second claim", label: "The evidence lines up", checkedAt: 2 }
    );
    assert.equal(history[0].claim, "second claim");
    assert.equal(history[1].claim, "first claim");
  });

  it("moves a repeat claim to the front instead of duplicating it", () => {
    const history = addToHistory(
      [
        { claim: "The moon landings were faked", label: "old", checkedAt: 1 },
        { claim: "other claim", label: "old", checkedAt: 2 },
      ],
      { claim: "the Moon Landings were faked", label: "new", checkedAt: 3 }
    );
    assert.equal(history.length, 2);
    assert.equal(history[0].claim, "the Moon Landings were faked");
    assert.equal(history[0].label, "new");
  });

  it("keeps at most eight checks", () => {
    let history = [];
    for (let i = 0; i < 10; i += 1) {
      history = addToHistory(history, {
        claim: `claim ${i}`,
        label: "Mixed picture",
        checkedAt: i,
      });
    }
    assert.equal(history.length, 8);
    assert.equal(history[0].claim, "claim 9");
    assert.equal(history[7].claim, "claim 2");
  });

  it("ignores a blank claim", () => {
    const history = addToHistory([], { claim: "   ", label: "x" });
    assert.deepEqual(history, []);
  });

  it("saves and loads through storage", () => {
    const storage = fakeStorage();
    const history = addToHistory([], {
      claim: "Goldfish have a memory of only three seconds",
      label: "The evidence raises doubts",
      checkedAt: 100,
    });
    saveHistory(storage, history);
    assert.deepEqual(loadHistory(storage), history);
  });

  it("stores the verdict with the check", () => {
    const history = addToHistory([], {
      claim: "The moon landings were faked",
      label: "The evidence raises doubts",
      checkedAt: 5,
    });
    assert.equal(history.length, 1);
    assert.equal(history[0].claim, "The moon landings were faked");
    assert.equal(history[0].label, "The evidence raises doubts");
    assert.equal(history[0].checkedAt, 5);
  });

  it("loads an old entry saved without a verdict and keeps it working", () => {
    const storage = fakeStorage();
    storage.setItem(
      "claim-check-history",
      JSON.stringify([{ claim: "old claim", checkedAt: 1 }])
    );
    const loaded = loadHistory(storage);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].claim, "old claim");
    assert.equal(loaded[0].label, undefined);
    // Saving it back does not crash, and the entry is still there.
    saveHistory(storage, loaded);
    assert.equal(loadHistory(storage).length, 1);
  });

  it("a re-check replaces the stored verdict with the fresh one", () => {
    const history = addToHistory(
      [
        {
          claim: "The moon landings were faked",
          label: "The evidence lines up",
          checkedAt: 1,
        },
      ],
      {
        claim: "The moon landings were faked",
        label: "The evidence raises doubts",
        checkedAt: 2,
      }
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].label, "The evidence raises doubts");
    assert.equal(history[0].checkedAt, 2);
  });

  it("keeps at most eight checks even when every one has a verdict", () => {
    let history = [];
    for (let i = 0; i < 10; i += 1) {
      history = addToHistory(history, {
        claim: `claim ${i}`,
        label: i % 2 === 0 ? "The evidence lines up" : "Mixed picture",
        checkedAt: i,
      });
    }
    assert.equal(history.length, 8);
    assert.equal(history[0].label, "Mixed picture");
    assert.equal(history[7].label, "The evidence lines up");
  });

  it("loads an empty list when nothing is saved or the data is bad", () => {
    const storage = fakeStorage();
    assert.deepEqual(loadHistory(storage), []);
    storage.setItem("claim-check-history", "not json at all");
    assert.deepEqual(loadHistory(storage), []);
    storage.setItem("claim-check-history", JSON.stringify({ claim: "x" }));
    assert.deepEqual(loadHistory(storage), []);
  });
});
