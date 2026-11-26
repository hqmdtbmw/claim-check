# Claim Check

Paste a claim, see what the evidence says. With sources.

I kept seeing wild claims in group chats and on timelines, and nobody ever checked them before sharing. So I built this. Paste the claim, it looks up Wikipedia and shows you what the sources actually say, for and against, then gives you a plain verdict. Right now it only checks Wikipedia. More sources later.

## How it works

1. **You paste a claim.** Anything, like "The moon landings were faked" or "Humans use only 10% of their brains".
2. **It pulls the important words out** and searches Wikipedia for the articles that cover the topic.
3. **Each article gets sorted.** If it lines up with the claim, it counts as supporting. If it uses words like "myth", "debunked" or "no evidence", it counts as pushback. The rest is just background.
4. **You get a verdict and the sources.** The verdict is only a guide. The linked articles are the real answer, so read them before you share the claim.
5. **Your last few checks are saved in your browser**, so you can run one again with one click. Nothing is uploaded anywhere.

You can share a check too. When you check a claim, the link in your address bar holds the claim, so just copy it and send it. Anyone opening the link sees the same claim checked.

## Run it

No build step, no API key, no account. Serve the folder with any static server:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Or drop the folder on GitHub Pages, Netlify or Vercel. It is plain HTML, CSS and JavaScript.

## Try it

- "The moon landings were faked". The sources push back hard.
- "Humans use only 10% of their brains". The sources call it a myth.
- "Apollo 11 landed the first humans on the Moon". The sources line up.

## Tests

```bash
npm test
```

The tests cover the claim analysis: pulling keywords out of a claim, sorting evidence into supporting, questioning or related, and turning a set of results into a verdict. They run with plain Node, no dependencies.

## What it can't do yet

- Wikipedia only, for now. A claim Wikipedia does not cover gets "Nothing found", not an answer.
- The verdict is a reading of the articles, not a fact checker. If the articles are wrong or thin, the verdict will be too.
- It checks what the claim says, not who said it or why.

## License

MIT. See [LICENSE](LICENSE).
