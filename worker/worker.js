/**
 * Razorpay order + signature verification.
 * Deploy free on Cloudflare Workers.
 *
 * Secrets to set (never put these in index.html):
 *   npx wrangler secret put RAZORPAY_KEY_ID
 *   npx wrangler secret put RAZORPAY_KEY_SECRET
 *
 * Set ALLOWED_ORIGIN to your GitHub Pages URL before going live.
 */

const ALLOWED_ORIGIN = "https://kumarnitish378.github.io";

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
    if (request.method !== "POST") return json({ error: "POST only" }, 405);

    const path = new URL(request.url).pathname;

    if (path === "/order") return createOrder(request, env);
    if (path === "/verify") return verifyPayment(request, env);
    return json({ error: "not found" }, 404);
  },
};

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
