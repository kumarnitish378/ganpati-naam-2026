/**
 * Razorpay order + signature verification, and hosting for share cards.
 * Deploy free on Cloudflare Workers.
 *
 * Secrets to set (never put these in index.html):
 *   npx wrangler secret put RAZORPAY_KEY_ID
 *   npx wrangler secret put RAZORPAY_KEY_SECRET
 *
 * Set ALLOWED_ORIGIN to your GitHub Pages URL before going live.
 */

const ALLOWED_ORIGIN = "https://kumarnitish378.github.io";
const SITE_URL = "https://kumarnitish378.github.io/ganpati-naam-2026/";

// WhatsApp will not preview a card larger than a few hundred KB, and the
// cap doubles as the abuse limit on a public upload endpoint.
const MAX_CARD_BYTES = 320 * 1024;
const CARD_TTL_SECONDS = 60 * 60 * 24 * 30;

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const path = new URL(request.url).pathname;

    // Fetched by WhatsApp's crawler and opened by people, so both are GET.
    if (request.method === "GET") {
      if (path.startsWith("/s/")) return sharePage(path.slice(3), env);
      if (path.startsWith("/i/")) return shareImage(path.slice(3), env);
      return new Response("not found", { status: 404 });
    }

    if (request.method !== "POST") return json({ error: "POST only" }, 405);

    if (path === "/order") return createOrder(request, env);
    if (path === "/verify") return verifyPayment(request, env);
    if (path === "/share") return createShare(request, env);
    return json({ error: "not found" }, 404);
  },
};

/* ---------------- share cards ---------------- */

// Stores the card and hands back an id. The link built from it is what gets
// sent to WhatsApp, which fetches /s/<id> for the Open Graph tags and shows
// the card as a preview — one message carrying picture, text and a tappable
// link, with no caption paste.
async function createShare(request, env) {
  const { success } = await env.SHARE_LIMIT.limit({
    key: request.headers.get("CF-Connecting-IP") || "anon",
  });
  if (!success) return json({ error: "slow down" }, 429);

  if (request.headers.get("Content-Type") !== "image/jpeg") {
    return json({ error: "jpeg only" }, 415);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CARD_BYTES) {
    return json({ error: "bad size" }, 413);
  }
  // Trust the bytes, not the header a client can set freely.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return json({ error: "not a jpeg" }, 415);
  }

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await env.SHARES.put(id, bytes, { expirationTtl: CARD_TTL_SECONDS });

  const origin = new URL(request.url).origin;
  return json({ id, url: `${origin}/s/${id}` });
}

const isId = (id) => /^[a-f0-9]{16}$/.test(id);

async function shareImage(id, env) {
  if (!isId(id)) return new Response("not found", { status: 404 });
  const card = await env.SHARES.get(id, "arrayBuffer");
  if (!card) return new Response("not found", { status: 404 });
  return new Response(card, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

async function sharePage(id, env) {
  if (!isId(id)) return Response.redirect(SITE_URL, 302);

  const origin = "https://ganpati-pay.nitish-ns378.workers.dev";
  const image = `${origin}/i/${id}`;
  const title = "अपने नाम वाला गणपति";
  const desc = "अपने नाम के साथ गणपति बप्पा की तस्वीर बनाइए — सिर्फ़ ₹9 में";

  // Crawlers read the tags; people are sent on to the site by the refresh.
  const html = `<!DOCTYPE html>
<html lang="hi">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${SITE_URL}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${image}">
<meta http-equiv="refresh" content="0; url=${SITE_URL}">
</head>
<body><a href="${SITE_URL}">${title}</a></body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/* ---------------- create order ---------------- */
async function createOrder(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  // Never trust the amount sent by the browser. Fix it here.
  const AMOUNT_PAISE = 900; // Rs 9

  const name = String(body.name || "").slice(0, 40);
  const template = String(body.template || "").slice(0, 8);

  if (name.length < 2) return json({ error: "bad name" }, 400);

  const auth = btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET);

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: "Basic " + auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: AMOUNT_PAISE,
      currency: "INR",
      receipt: "gc26_" + Date.now(),
      notes: { name, template },
    }),
  });

  if (!res.ok) {
    return json({ error: "razorpay order failed" }, 502);
  }

  const order = await res.json();
  return json({ id: order.id, amount: order.amount, currency: order.currency });
}

/* ---------------- verify signature ---------------- */
async function verifyPayment(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, 400);
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return json({ ok: false }, 400);
  }

  const expected = await hmacSha256Hex(
    env.RAZORPAY_KEY_SECRET,
    razorpay_order_id + "|" + razorpay_payment_id
  );

  const ok = timingSafeEqual(expected, razorpay_signature);
  return json({ ok }, ok ? 200 : 400);
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
