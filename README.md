# अपने नाम वाला गणपति — Ganesh Chaturthi 2026

A one-page site. Pick a template, type a name, pay ₹9, download the image.
The name is drawn in the browser with the Canvas API, so there is no image server.

---

## Files

```
index.html          the whole site
assets/t1.jpg       banner template 1      (941 x 1672)
assets/t2.jpg       banner template 2
assets/t3.jpg       rangoli template
assets/*_thumb.jpg  picker thumbnails
worker/worker.js    Razorpay order + signature check
worker/wrangler.toml
```

---

## Try it right now

Open `index.html` with a local server (not file://, images need http):

```bash
python3 -m http.server 8000
```

Then go to http://localhost:8000

`DEMO_MODE` is `true`, so the pay button skips Razorpay and unlocks the
download. Use this to check the templates and name rendering.

---

## Going live — 4 steps

### 1. Host on GitHub Pages
Push this folder to a repo, then Settings → Pages → Deploy from branch → `main` / root.
Your URL will be `https://USERNAME.github.io/REPO/`.

### 2. Deploy the worker

```bash
cd worker
npx wrangler deploy
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
```

Then edit `ALLOWED_ORIGIN` at the top of `worker.js` to your Pages URL and
deploy again. Leaving it as `*` lets any site call your worker.

### 3. Fill in the config

In `index.html`, near the top of the `<script>`:

```js
RAZORPAY_KEY_ID : "rzp_live_xxxxx",       // public key, fine in the browser
WORKER_URL      : "https://ganpati-pay.xxx.workers.dev",
INSTAGRAM       : "https://instagram.com/YOURHANDLE",
DEMO_MODE       : false                    // <- must be false
```

The **secret** key never goes in this file. Only in the worker.

### 4. Test with a real ₹9 payment
Pay yourself once before you post the reel. Check that the download works
on an actual Android phone, not just desktop.

---

## Moving the name

Each template has a `box` in `TEMPLATES` — the rectangle the name is drawn in,
in image pixels (the image is 941 x 1672).

```js
box:{x:200, y:130, w:540, h:128}
```

The font size shrinks automatically until the name fits, so long names
will not spill onto the artwork.

---

## Adding a template for the next festival

1. Generate the art at 941 x 1672 with a blank area for the name.
2. Save as `assets/t4.jpg`, plus a ~280px `assets/t4_thumb.jpg`.
3. Add an entry to `TEMPLATES` with the box coordinates and text colour.

Nothing else changes.

---

## Things that will bite you

- **Devanagari fonts.** The name is drawn in Tiro Devanagari Hindi, loaded
  from Google Fonts and awaited before the first draw. If you swap the font,
  test `श्रद्धा` and `प्रियांशु` — many fonts break on conjuncts.
- **Preview watermark.** The preview is watermarked so people cannot
  screenshot instead of paying. It is removed only after `unlock()`.
- **DEMO_MODE.** If you ship with it `true`, everything is free.
- **Image weight.** Templates are ~350 KB each. Keep new ones under 400 KB
  or the page will crawl on 4G.
- **Refunds.** Razorpay does not return its fee on a refunded payment.
