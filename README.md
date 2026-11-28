# Claim Check

Paste a claim, see what the evidence says. With sources.

I kept seeing wild claims in group chats and on timelines, and nobody ever checked them before sharing. So I built this. Paste the claim, it looks up Wikipedia and shows you what the sources actually say, for and against, then gives you a plain verdict. Right now it only checks Wikipedia. More sources later.

## How it works

1. **You paste a claim.** Anything, like "The moon landings were faked" or "Humans use only 10% of their brains". Got a few at once? Switch to "Several claims" and paste one per line. It checks them one after another and shows you a short verdict for each, with the sources tucked under it when you want to see them.
2. **It pulls the important words out** and searches Wikipedia for the articles that cover the topic. If the first search finds nothing, it tries again with a shorter search, dropping words until something turns up, before giving up.
3. **Each article gets sorted.** If it lines up with the claim, it counts as supporting. If it uses words like "myth", "debunked" or "no evidence", it counts as pushback. The rest is just background. Under every article there is a short line in plain words saying why it landed there, like which words from your claim it mentions and which pushback words it uses. Under that line, a sentence or two in the article's own words, so you can see what it actually says before you click through. When Wikipedia gives no usable extract, the reason line stands on its own. Under each source there is also the date the article was last updated, so you can tell fresh evidence from a page nobody has touched in years. If Wikipedia gives no date for a page, the line is simply left out. Above the sources there are small buttons to look at just the ones that line up with the claim, just the ones that push back, or just the background. The buttons only change what you see on the page, the copy button still copies every source.
4. **You get a verdict and the sources.** The verdict is only a guide. The linked articles are the real answer, so read them before you share the claim.
5. **Your last few checks are saved in your browser**, so you can run one again with one click. Each one shows the verdict it got, coloured so you can see at a glance what you found: green when the evidence lined up, red when it raised doubts, amber when the picture was mixed. It also shows when you checked it, like "checked 2 hours ago", so a verdict from days ago reads as old news next to a fresh one. The verdict shown is only what that check found at the time. Checking again runs the live check from scratch, it never trusts the old verdict. Nothing is uploaded anywhere.

You can share a check too. When you check a claim, the link in your address bar holds the claim, so just copy it and send it. Anyone opening the link sees the same claim checked. A batch works the same way, the link holds every claim in it.

## Checking a few at once

I usually check claims one at a time, but a paragraph someone forwarded has five claims in it, not one. So there is a batch mode. Flip the toggle above the box to "Several claims", paste one claim per line, and it runs through them in order. You get a short list: each claim, its verdict, and the sources if you open it up. At the top it sums up the batch in one line, like how many look right and how many found nothing, so you can see the shape of it before opening any claim. The copy button copies all of them at once, with that summary line at the top, and each claim lands in your recent checks on its own. The link holds the whole batch too. When you check a few claims at once, the address bar holds all of them, so you can copy the link and send it, and anyone opening it sees the same batch checked.

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

The tests cover the claim analysis: pulling keywords out of a claim, sorting evidence into supporting, questioning or related, explaining each sorting in plain words, trimming a source extract down to a sentence or two, turning a set of results into a verdict, showing when each source was last updated, saying how long ago each recent check was made, and splitting pasted text into one claim per line for batch checks. They also cover the shorter-search retries, which try the full query first and then fewer keywords when the first search finds nothing. They run with plain Node, no dependencies.

## What it can't do yet

- Wikipedia only, for now. A claim Wikipedia does not cover gets "Nothing found", not an answer.
- The verdict is a reading of the articles, not a fact checker. If the articles are wrong or thin, the verdict will be too.
- It checks what the claim says, not who said it or why.

## License

MIT. See [LICENSE](LICENSE).
