# Claim Check

Paste any claim, get the evidence for and against it — with sources.

Misinformation is read, not searched for. A claim shows up in a group chat, a video, a headline, and by the time anyone thinks to check it, it has already been believed and shared. Claim Check closes that gap: paste the claim, and in a few seconds you see what the sources actually say, for and against, with links to read for yourself.

This is the first version, and it checks **Wikipedia**. More sources are coming.

## How it works

1. **You paste a claim.** Anything — "The moon landings were faked", "Humans use only 10% of their brains", "Drinking water cures headaches".
2. **The app pulls the words that carry the meaning** out of the claim (the rest is noise) and searches Wikipedia for the articles that cover the topic.
3. **Each article is read and sorted.** If it lines up with the claim, it is marked as supporting. If it uses language like "myth", "debunked" or "no evidence", it is marked as pushing back. Everything else is related background.
4. **You get a verdict and the sources.** The verdict is a guide, not a judge — the linked articles are the real answer. Read them before you share the claim.

## Run it

No build step, no API key, no account. Serve the folder with any static server:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Or drop the folder on GitHub Pages, Netlify, or Vercel — it is plain HTML, CSS and JavaScript.

## Try it

- "The moon landings were faked" — the sources push back hard.
- "Humans use only 10% of their brains" — the sources call it a myth.
- "Apollo 11 landed the first humans on the Moon" — the sources line up.

## Tests

```bash
npm test
```

The tests cover the claim analysis: pulling keywords out of a claim, sorting evidence into supporting / questioning / related, and turning a set of results into a verdict. They run with plain Node, no dependencies.

## Honest limits

- Wikipedia only, for now. A claim Wikipedia does not cover gets "Nothing found", not an answer.
- The verdict is a reading of the articles, not a fact-checker. If the articles are wrong or thin, the verdict will be too.
- It checks what the claim says, not who said it or why.

## License

MIT — see [LICENSE](LICENSE).
