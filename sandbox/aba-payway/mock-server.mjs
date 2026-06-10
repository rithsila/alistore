/**
 * Local mock of the ABA PayWay gateway — Node 20+, zero dependencies.
 *
 * Mirrors the contract of the real sandbox closely enough to develop and test
 * the alistore integration offline:
 *
 *   POST /api/payment-gateway/v1/payments/purchase              (multipart/form-data)
 *   POST /api/payment-gateway/v1/payments/check-transaction-2   (application/json)
 *
 * Plus mock-only control endpoints (never exist on real PayWay):
 *   POST /__mock/pay           { "tran_id": "..." }  → mark APPROVED + fire pushback
 *   POST /__mock/decline       { "tran_id": "..." }  → mark DECLINED
 *   GET  /__mock/transactions                        → inspect state
 *
 * The mock VERIFIES the HMAC-SHA512 hash on every request using the same
 * canonical field order as production. A wrong hash gets the real error
 * (status.code 1 on purchase, 5 on check) — so your hash implementation is
 * proven correct before you touch the real sandbox.
 *
 * Default port 4284 (4280 = Bakong mock, 4281 = FB OAuth mock,
 * 4282 = Google token mock, 4283 = run-test.mjs pushback receiver).
 *
 * Usage:  node mock-server.mjs [--port 4284]
 * Env:    PAYWAY_MOCK_MERCHANT_ID (default ec_sandbox_demo)
 *         PAYWAY_MOCK_API_KEY     (default mock-api-key-not-a-secret)
 */
import { createServer } from "node:http";
import { purchaseHash, checkTransactionHash } from "./lib/payway-client.mjs";

const PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || 4284;
const MERCHANT_ID = process.env.PAYWAY_MOCK_MERCHANT_ID || "ec_sandbox_demo";
const API_KEY = process.env.PAYWAY_MOCK_API_KEY || "mock-api-key-not-a-secret";

/** tran_id → { status, fields, apv, created_at } */
const transactions = new Map();

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/** Minimal multipart/form-data parser — text fields only, which is all PayWay uses. */
function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return {};
  const boundary = `--${m[1] || m[2]}`;
  const fields = {};
  for (const part of buffer.toString("utf8").split(boundary)) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const name = /name="([^"]+)"/.exec(part.slice(0, headerEnd))?.[1];
    if (!name) continue;
    fields[name] = part.slice(headerEnd + 4).replace(/\r\n--?$/, "").replace(/\r\n$/, "");
  }
  return fields;
}

async function parseFields(req) {
  const raw = await readBody(req);
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) return parseMultipart(raw, ct);
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return {};
    }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
  }
  return {};
}

function handlePurchase(fields, res) {
  if (fields.merchant_id !== MERCHANT_ID) {
    return json(res, 200, { status: { code: 8, message: "Wrong merchant profile" } });
  }
  const expected = purchaseHash(fields, API_KEY);
  if (fields.hash !== expected) {
    console.log(`[mock] purchase ${fields.tran_id}: WRONG HASH`);
    console.log(`        got      ${fields.hash}`);
    console.log(`        expected ${expected}`);
    return json(res, 200, { status: { code: 1, message: "Wrong hash" } });
  }
  if (!fields.tran_id || !fields.amount) {
    return json(res, 200, { status: { code: 2, message: "Missing required parameter" } });
  }
  if (transactions.has(fields.tran_id)) {
    return json(res, 200, { status: { code: 4, message: "Duplicate transaction id" } });
  }
  if (Number(fields.amount) <= 0) {
    return json(res, 200, { status: { code: 45, message: "Transaction with zero amount is not allowed" } });
  }

  transactions.set(fields.tran_id, {
    status: "PENDING",
    fields,
    apv: null,
    created_at: new Date().toISOString(),
  });
  console.log(`[mock] purchase ${fields.tran_id}: created (${fields.amount} ${fields.currency || "USD"})`);

  if (fields.payment_option === "abapay_khqr_deeplink") {
    return json(res, 200, {
      status: { code: "00", message: "Success!", tran_id: fields.tran_id },
      qr_string: `00020101021230510016abaakhppxxx@MOCK${fields.tran_id}`,
      abapay_deeplink: `abamobilebank://ababank.com?type=payway&qrcode=MOCK${fields.tran_id}`,
      checkout_qr_url: `http://127.0.0.1:${PORT}/__mock/checkout/${fields.tran_id}`,
    });
  }
  // hosted_view / popup: real PayWay returns an HTML checkout page
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(
    `<!doctype html><title>Mock PayWay Checkout</title><h1>Mock checkout for ${fields.tran_id}</h1>` +
      `<p>POST /__mock/pay {"tran_id":"${fields.tran_id}"} to simulate payment.</p>`
  );
}

function handleCheckTransaction(body, res) {
  if (body.merchant_id !== MERCHANT_ID) {
    return json(res, 200, { status: { code: 8, message: "Wrong merchant profile" }, data: null });
  }
  const expected = checkTransactionHash(body, API_KEY);
  if (body.hash !== expected) {
    console.log(`[mock] check ${body.tran_id}: WRONG HASH`);
    return json(res, 200, { status: { code: 5, message: "Invalid hash" }, data: null });
  }
  const tx = transactions.get(body.tran_id);
  if (!tx) {
    return json(res, 200, { status: { code: 6, message: "Transaction not found" }, data: null });
  }
  const codes = { APPROVED: 0, PENDING: 2, DECLINED: 3, REFUNDED: 4, CANCELLED: 7 };
  const amount = Number(tx.fields.amount);
  console.log(`[mock] check ${body.tran_id}: ${tx.status}`);
  return json(res, 200, {
    status: { code: "00", message: "Success!", tran_id: body.tran_id },
    data: {
      payment_status: tx.status,
      payment_status_code: codes[tx.status],
      total_amount: amount,
      original_amount: amount,
      payment_amount: tx.status === "APPROVED" ? amount : 0,
      refund_amount: 0,
      discount_amount: 0,
      payment_currency: tx.status === "PENDING" ? "" : tx.fields.currency || "USD",
      apv: tx.apv || "",
      transaction_date: tx.created_at,
    },
  });
}

async function firePushback(tranId, tx) {
  // Real PayWay POSTs JSON to the (base64-decoded) return_url after payment.
  const encoded = tx.fields.return_url;
  if (!encoded) return;
  let url;
  try {
    url = Buffer.from(encoded, "base64").toString("utf8");
    new URL(url); // validate
  } catch {
    url = encoded; // tolerate non-base64 return_url in the mock
  }
  const payload = {
    tran_id: tranId,
    apv: tx.apv,
    status: 0,
    return_params: tx.fields.return_params || "",
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log(`[mock] pushback → ${url} (${res.status})`);
  } catch (err) {
    console.log(`[mock] pushback → ${url} FAILED: ${err.message}`);
  }
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;

  if (req.method === "POST" && path === "/api/payment-gateway/v1/payments/purchase") {
    return handlePurchase(await parseFields(req), res);
  }
  if (
    req.method === "POST" &&
    (path === "/api/payment-gateway/v1/payments/check-transaction-2" ||
      path === "/api/payment-gateway/v1/payments/check-transaction")
  ) {
    return handleCheckTransaction(await parseFields(req), res);
  }
  if (req.method === "POST" && path === "/__mock/pay") {
    const { tran_id } = await parseFields(req);
    const tx = transactions.get(tran_id);
    if (!tx) return json(res, 404, { error: "unknown tran_id" });
    tx.status = "APPROVED";
    tx.apv = `APV${Math.floor(100000 + (Date.now() % 900000))}`;
    console.log(`[mock] pay ${tran_id}: APPROVED apv=${tx.apv}`);
    await firePushback(tran_id, tx);
    return json(res, 200, { ok: true, tran_id, status: "APPROVED", apv: tx.apv });
  }
  if (req.method === "POST" && path === "/__mock/decline") {
    const { tran_id } = await parseFields(req);
    const tx = transactions.get(tran_id);
    if (!tx) return json(res, 404, { error: "unknown tran_id" });
    tx.status = "DECLINED";
    return json(res, 200, { ok: true, tran_id, status: "DECLINED" });
  }
  if (req.method === "GET" && path === "/__mock/transactions") {
    return json(res, 200, Object.fromEntries(transactions));
  }
  if (path.startsWith("/__mock/checkout/")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(`<!doctype html><title>Mock QR page</title><h1>Scan-me placeholder for ${path.split("/").pop()}</h1>`);
  }
  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock ABA PayWay listening on http://127.0.0.1:${PORT}`);
  console.log(`  merchant_id: ${MERCHANT_ID}`);
  console.log(`  api_key:     ${API_KEY}`);
});
