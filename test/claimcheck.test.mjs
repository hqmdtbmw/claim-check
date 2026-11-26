import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchQuery,
  classifyEvidence,
  extractKeywords,
  isDisambiguationPage,
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
