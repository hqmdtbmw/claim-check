import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addToHistory,
  buildSearchQuery,
  classifyEvidence,
  decodeClaimFromHash,
  encodeClaimInHash,
  explainStance,
  extractKeywords,
  isDisambiguationPage,
  loadHistory,
  saveHistory,
  splitClaims,
  summarizeVerdict,
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

  it("loads an empty list when nothing is saved or the data is bad", () => {
    const storage = fakeStorage();
    assert.deepEqual(loadHistory(storage), []);
    storage.setItem("claim-check-history", "not json at all");
    assert.deepEqual(loadHistory(storage), []);
    storage.setItem("claim-check-history", JSON.stringify({ claim: "x" }));
    assert.deepEqual(loadHistory(storage), []);
  });
});
