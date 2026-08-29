# Cocolab — Floss Pick User Research

An interactive 2×2×2 map of the July 2026 midpoint user-interview round, built for
Cocolab. Password-protected, static, hosted on GitHub Pages. Vanilla JS — no build
step, no framework, three files of source.

The visual language is lifted from the 3D project graph on
[wyattroy.com](https://wyattroy.com): same warm white ground, same spring-driven
orbit and zoom, same trick of projecting HTML axis labels onto a WebGL canvas.

## The map

Twenty-one takeaways, each placed on three axes:

| Axis | Runs from | To | Meaning |
|---|---|---|---|
| **x** | In the Hand | In the World | The artifact itself vs. the shelf, the dentist, the household, the habit |
| **y** | Function | Feeling | Mechanics vs. emotion, trust, identity and guilt |
| **z** (depth) | Emerging | Proven | How many of the three participants actually said it |

The x/y split gives four groups — **Performance**, **Availability**, **Trust
Signals**, **Meaning**. The z split at the midpoint is the third division that makes
it a 2×2×2: it separates what is ready to brief from what is still a single-voice
hypothesis. That honesty is deliberate. With n=3, the depth axis is what keeps the
map from overclaiming.

## How the password works

This is not a JavaScript `if (password === '…')` check, which anyone could read
around in a public repo. The research is **AES-256-GCM encrypted at rest** and the
password is what derives the key:

- `src/insights.json` — plaintext source. **Gitignored. Never committed.**
- `data/insights.enc.json` — what actually ships: ciphertext, random salt, random IV.
- `js/gate.js` — derives a key with PBKDF2-HMAC-SHA256 (310,000 iterations) and
  decrypts in the browser via WebCrypto.

A wrong password does not fail a comparison — it produces a key whose GCM auth tag
does not verify, so decryption throws and there is nothing to render. The password
is held in `sessionStorage` (not the decrypted text), so a reload in the same tab
does not re-prompt and closing the tab forgets it.

> **Because `src/insights.json` is gitignored, this repo is not a backup of the
> research.** Keep the plaintext somewhere else too.

## Editing the content

```bash
# 1. edit the research
$EDITOR src/insights.json

# 2. re-encrypt (the password is never stored in the repo)
SITE_PASSWORD='your-password' node tools/encrypt.mjs

# 3. ship
git add data/insights.enc.json && git commit -m "Update insights" && git push
```

Changing the password is the same command with a different value — re-encrypt
and push, and the old password stops working immediately.

`tools/encrypt.mjs` deliberately has **no default password**. This repo is
public so that GitHub Pages is free; a default baked into the script would
publish the key next to the ciphertext and make the encryption decorative.

## Running locally

WebCrypto and ES modules both require a real origin, so `file://` will not work:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Structure

```
index.html              markup for the gate, the hero, the panel and the report
style.css               design tokens shared with wyattroy.com
js/gate.js              WebCrypto password gate
js/scene.js             the Three.js 2×2×2 (+ an SVG fallback if WebGL is absent)
js/app.js               boot, filters, detail panel, written report
data/insights.enc.json  the encrypted research — the only content that ships
src/insights.json       plaintext source (gitignored)
tools/encrypt.mjs       source → ciphertext
```

## Notes

- Three.js r160 loads from jsDelivr; everything else is local.
- No WebGL? The hero falls back to an SVG scatter of the same 2×2, with evidence
  encoded as dot size. Every insight is also written out in full below the graph,
  so nothing is reachable only through the 3D view.
- `Cmd/Ctrl-P` prints the report cleanly — the graph and chrome drop out.
- Deep links work: `…/#thickness` opens that insight's panel directly.
