/**
 * ABA PayWay sandbox test runner — Node 20+, zero dependencies.
 *
 * Two modes, selected by env:
 *
 * 1. LOCAL MOCK (default — no credentials needed):
 *      Terminal A:  node mock-server.mjs
 *      Terminal B:  node run-test.mjs
 *    Runs the full lifecycle: purchase → PENDING → simulated pay (with
 *    pushback callback) → APPROVED. Also proves a tampered hash is rejected.
 *
 * 2. REAL ABA SANDBOX (after you receive credentials by email):
 *      PowerShell:
 *        $env:PAYWAY_BASE_URL    = "https://checkout-sandbox.payway.com.kh"
 *        $env:PAYWAY_MERCHANT_ID = "<your sandbox merchant id>"
 *        $env:PAYWAY_API_KEY     = "<your sandbox api key>"
 *        node run-test.mjs
 *    Creates a real sandbox purchase (KHQR deeplink), verifies PENDING via
 *    check-transaction-2, and prints the checkout URL so you can pay with the
 *    sandbox app/test cards, then re-run check with:
 *        node run-test.mjs --check <tran_id>
 */
import { createServer } from "node:http";
import {
  PayWayClient,
  encodeItems,
  purchaseHash,
  reqTime,
} from "./lib/payway-client.mjs";

const BASE_URL = process.env.PAYWAY_BASE_URL || "http://127.0.0.1:4284";
const MERCHANT_ID = process.env.PAYWAY_MERCHANT_ID || "ec_sandbox_demo";
const API_KEY = process.env.PAYWAY_API_KEY || "mock-api-key-not-a-secret";
const IS_MOCK = BASE_URL.includes("127.0.0.1") || BASE_URL.includes("localhost");
const PUSHBACK_PORT = 4283;

const client = new PayWayClient({ baseUrl: BASE_URL, merchantId: MERCHANT_ID, apiKey: API_KEY });

let passed = 0;
let failed = 0;
function assert(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --check <tran_id>: just verify an existing transaction and exit
const checkIdx = process.argv.indexOf("--check");
if (checkIdx !== -1) {
  const tranId = process.argv[checkIdx + 1];
  const result = await client.checkTransaction(tranId);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log(`Target: ${BASE_URL} (${IS_MOCK ? "local mock" : "REAL ABA sandbox"})\n`);

// Pushback receiver — stands in for the future backend callback route
let pushbackReceived = null;
let pushbackServer = null;
if (IS_MOCK) {
  pushbackServer = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      pushbackReceived = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => pushbackServer.listen(PUSHBACK_PORT, "127.0.0.1", r));
}

const tranId = `alistore-${Date.now().toString(36)}`;
const returnUrl = IS_MOCK
  ? Buffer.from(`http://127.0.0.1:${PUSHBACK_PORT}/payway/pushback`).toString("base64")
  : undefined;

// ---- Step 1: create purchase (KHQR deeplink — matches alistore's pay screen)
console.log(`Step 1: purchase tran_id=${tranId}`);
const purchase = await client.purchase({
  tran_id: tranId,
  amount: "1.00",
  currency: "USD",
  payment_option: "abapay_khqr_deeplink",
  items: encodeItems([{ name: "Sandbox tee", quantity: 1, price: 1.0 }]),
  firstname: "Sandbox",
  lastname: "Tester",
  email: "sandbox@example.com",
  phone: "012345678",
  lifetime: "20",
  ...(returnUrl ? { return_url: returnUrl } : {}),
});
console.log(`  → ${JSON.stringify(purchase).slice(0, 200)}`);
assert("purchase accepted (status.code == '00')", String(purchase?.status?.code) === "00", JSON.stringify(purchase?.status));
assert("qr_string returned", typeof purchase?.qr_string === "string" && purchase.qr_string.length > 0);
assert("abapay_deeplink returned", typeof purchase?.abapay_deeplink === "string");

// ---- Step 2: check-transaction must be PENDING before payment
console.log("\nStep 2: check-transaction-2 (expect PENDING)");
const pending = await client.checkTransaction(tranId);
assert("check accepted", String(pending?.status?.code) === "00", JSON.stringify(pending?.status));
assert("payment_status is PENDING", pending?.data?.payment_status === "PENDING", `got ${pending?.data?.payment_status}`);

// ---- Step 3: wrong hash must be rejected (negative test)
console.log("\nStep 3: tampered purchase hash (expect rejection)");
{
  const fields = {
    req_time: reqTime(),
    merchant_id: MERCHANT_ID,
    tran_id: `${tranId}-tamper`,
    amount: "1.00",
    currency: "USD",
  };
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("hash", purchaseHash(fields, "wrong-key").slice(0, 88));
  const res = await fetch(`${BASE_URL}/api/payment-gateway/v1/payments/purchase`, {
    method: "POST",
    body: form,
  });
  const body = await res.text();
  let rejected;
  try {
    const parsed = JSON.parse(body);
    rejected = String(parsed?.status?.code) !== "00";
  } catch {
    rejected = res.status >= 400; // real gateway may render an error page
  }
  assert("tampered hash rejected", rejected, body.slice(0, 120));
}

if (IS_MOCK) {
  // ---- Step 4: simulate customer payment, expect pushback + APPROVED
  console.log("\nStep 4: simulate payment via /__mock/pay");
  const pay = await fetch(`${BASE_URL}/__mock/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tran_id: tranId }),
  }).then((r) => r.json());
  assert("mock pay ok", pay?.ok === true);

  await new Promise((r) => setTimeout(r, 200)); // let pushback land
  assert("pushback callback received", pushbackReceived?.tran_id === tranId, JSON.stringify(pushbackReceived));
  assert("pushback carries apv", typeof pushbackReceived?.apv === "string" && pushbackReceived.apv.length > 0);

  console.log("\nStep 5: check-transaction-2 (expect APPROVED)");
  const approved = await client.checkTransaction(tranId);
  assert("payment_status is APPROVED", approved?.data?.payment_status === "APPROVED", `got ${approved?.data?.payment_status}`);
  assert("payment_status_code is 0", approved?.data?.payment_status_code === 0);
  assert("apv present", typeof approved?.data?.apv === "string" && approved.data.apv.length > 0);

  pushbackServer.close();
} else {
  console.log("\nReal sandbox: pay manually, then verify with:");
  console.log(`  checkout_qr_url: ${purchase?.checkout_qr_url || "(see purchase response)"}`);
  console.log(`  node run-test.mjs --check ${tranId}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
