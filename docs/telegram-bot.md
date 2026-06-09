# Telegram Bot — Order Alerts (complete guide)

How the Telegram order-alert integration works in Ali Store, how to finish setting
it up (you've created the bot and added the token — the **chat ID** is the piece
still missing), how to test it, and how to troubleshoot it.

This is the **BACKEND-09** feature, verified end-to-end as **INTEGRATION-10**.

---

## Table of contents

1. [What it does](#1-what-it-does)
2. [Where it lives in the code](#2-where-it-lives-in-the-code)
3. [The two config values](#3-the-two-config-values)
4. [Setup, step by step](#4-setup-step-by-step)
   - [4.1 Create the bot (done)](#41-create-the-bot-done)
   - [4.2 Get your chat ID (the missing piece)](#42-get-your-chat-id-the-missing-piece)
   - [4.3 Put both values in `.env`](#43-put-both-values-in-env)
   - [4.4 Restart the backend](#44-restart-the-backend)
5. [The message you'll receive](#5-the-message-youll-receive)
6. [Testing](#6-testing)
7. [Troubleshooting](#7-troubleshooting)
8. [How it behaves (reliability & limits)](#8-how-it-behaves-reliability--limits)
9. [Security model](#9-security-model)
10. [Production / UAT](#10-production--uat)
11. [Rotating or revoking the token](#11-rotating-or-revoking-the-token)
12. [Not the same thing: the public "Chat on Telegram" links](#12-not-the-same-thing-the-public-chat-on-telegram-links)

---

## 1. What it does

Every time an order is **placed** — whether the customer paid by **KHQR** or chose
**Cash-on-Delivery** — the backend posts a single message with the full order
details to **your private Telegram chat**:

> 🛍️ New order #1042
> Payment: COD
>
> Items:
> • Classic Tee — M / Black ×2
>
> Total: $33.00 USD (≈ 135,300 KHR)
>
> Customer: Dara Sok
> Phone: 012345678
> Address: St 271, Phnom Penh
> Note: call before delivery

It is **one-way**: the bot only sends alerts to you. It does **not** read customer
messages, and customers never interact with it. (The customer-facing "Chat on
Telegram" buttons are a separate, unrelated thing — see [section 12](#12-not-the-same-thing-the-public-chat-on-telegram-links).)

If the two config values aren't set, the feature **silently no-ops** (logs a
warning and returns) — the app runs fine on placeholders, orders still place.

---

## 2. Where it lives in the code

| Concern | Location |
| --- | --- |
| The whole feature | `backend/src/subscribers/order-placed.ts` |
| Event it listens to | `order.placed` (emitted by `completeCartWorkflow` for both COD and KHQR) |
| Config keys | `backend/.env` → `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Env documentation | `backend/.env.template` (lines for the Telegram block) |

It's a Medusa **subscriber**: a file that exports a handler plus
`export const config = { event: "order.placed" }`. Medusa auto-discovers it on
boot — there is nothing to register manually.

The only Telegram API it calls is:

```
POST https://api.telegram.org/bot<TOKEN>/sendMessage
Content-Type: application/json
{ "chat_id": "<CHAT_ID>", "text": "...", "disable_web_page_preview": true }
```

The host `api.telegram.org` is **hard-coded** (https only) — there is no
user-controllable URL anywhere in the path.

---

## 3. The two config values

Both live in `backend/.env` and are **secrets — never commit real values**.

| Variable | What it is | Example shape |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | The token @BotFather gave you when you created the bot. | `8123456789:AAH...` (digits, a colon, then a long string) |
| `TELEGRAM_CHAT_ID` | The ID of the chat the alerts go to (your DM with the bot, or a private group). | `123456789` (DM) or `-1001234567890` (group/supergroup) |

**Both must be present.** If either is empty, the subscriber logs
`TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — skipping order alert` and does
nothing.

---

## 4. Setup, step by step

### 4.1 Create the bot (done)

You've already done this with **@BotFather**:

1. Open Telegram, search **@BotFather**, send `/newbot`.
2. Pick a name and a username ending in `bot`.
3. BotFather replies with the **token** → that's your `TELEGRAM_BOT_TOKEN`.

✅ You have the token in `.env` already.

### 4.2 Get your chat ID (the missing piece)

A Telegram bot **cannot start a conversation with you** — Telegram only lets bots
reply to people who messaged them first. So the order is always: *you message the
bot → then the bot can find your chat ID → then the bot can send you alerts.*

**Step A — message the bot first.** Open Telegram, search for **your bot's
username**, open the chat, and press **Start** (or send any message like `hi`).
This one-time step is mandatory; skip it and you'll get a "chat not found" /
"can't initiate conversation" error later.

**Step B — read the chat ID off `getUpdates`.** In PowerShell (your shell), run:

```powershell
$token = "PASTE_YOUR_BOT_TOKEN"
Invoke-RestMethod "https://api.telegram.org/bot$token/getUpdates" | ConvertTo-Json -Depth 8
```

Look in the response for `result[].message.chat.id`. For a direct chat with the
bot it's a **positive number** (e.g. `123456789`). That number is your
`TELEGRAM_CHAT_ID`.

> Plain `curl` equivalent (works in any shell):
> ```bash
> curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
> ```

**If you'd rather send alerts to a private group** (so more than one staff phone
sees them):

1. Create a Telegram group, add your bot to it.
2. Send any message in the group.
3. Run the same `getUpdates` call. The group's `chat.id` is a **negative**
   number — supergroups look like `-1001234567890`. Use that whole value
   (including the leading `-100`).

> **Quick alternative:** message **@userinfobot** or **@getidsbot** to read an ID
> without `getUpdates`. For a DM, your user ID *is* the chat ID.

### 4.3 Put both values in `.env`

Edit `backend/.env` (the file you have open) — fill in the two lines that are
already there as empty keys:

```bash
TELEGRAM_BOT_TOKEN=8123456789:AAH...your-real-token...
TELEGRAM_CHAT_ID=123456789
```

No quotes, no spaces around `=`. Do **not** commit this file.

### 4.4 Restart the backend

The backend reads `.env` into `process.env` **at boot**, so a running dev server
won't pick up the new values until you restart it:

```bash
# in backend/
npx medusa develop
```

That's it — the next placed order will trigger an alert.

---

## 5. The message you'll receive

The body is built in `buildMessage()` and sent as **plain text** (no Markdown /
HTML `parse_mode`), so customer-supplied text can never inject formatting:

```
🛍️ New order #<order number>
Payment: <KHQR | COD | Unknown>

Items:
• <product title> — <variant> ×<qty>
• <product title> ×<qty>          (no variant → no dash)

Total: $<USD>.XX USD (≈ <KHR> KHR)

Customer: <name>
Phone: <phone>
Address: <full address on one line>
Note: <customer note>
```

Notes on each field:

- **Order number** — Medusa's human-friendly `display_id` (falls back to the raw
  id if missing).
- **Payment** — resolved as: if the order metadata flag `payment_method` is
  `cod` → **COD**; otherwise by the payment provider — Bakong → **KHQR**, Medusa
  manual provider → **COD**; anything else → **Unknown**.
- **Total** — for USD orders, shows the USD amount and the KHR equivalent
  computed from `USD_KHR_RATE`, rounded to **whole riel** (no decimals).
- **Customer / Phone / Address / Note** — pulled from the COD contact metadata
  first, then the shipping address; any missing field shows `—`.

---

## 6. Testing

### 6.1 Fastest check — prove the token + chat ID work (no order needed)

Send yourself a test message directly. PowerShell:

```powershell
$token  = "PASTE_YOUR_BOT_TOKEN"
$chatId = "PASTE_YOUR_CHAT_ID"
Invoke-RestMethod -Method Post "https://api.telegram.org/bot$token/sendMessage" `
  -ContentType "application/json" `
  -Body (@{ chat_id = $chatId; text = "Ali Store test ✅" } | ConvertTo-Json)
```

If a message arrives in your chat, both values are correct and the rest is wired.
If you get an error, jump to [Troubleshooting](#7-troubleshooting).

### 6.2 End-to-end — place a real test order (INTEGRATION-10)

1. Start the backend (`npx medusa develop`) and storefront (`npm run dev`).
2. On the storefront, add a product to the cart and complete a **COD** checkout
   with a valid Cambodia phone (`0…` or `+855…`).
3. The order places → within a second or two the alert lands in your chat with
   the full details from [section 5](#5-the-message-youll-receive).

### 6.3 Confirm via backend logs

The handler logs its outcome (no PII in logs — phone/address are never written):

| Log line | Meaning |
| --- | --- |
| `[order-placed] Telegram alert sent for order <id>` | ✅ delivered |
| `[order-placed] ...not set — skipping order alert` | env not set / not restarted |
| `[order-placed] Telegram alert FAILED after 3 attempts...` | all retries failed (see below) |
| `[order-placed] Telegram send budget (30/min) exceeded...` | rate cap hit (see [section 8](#8-how-it-behaves-reliability--limits)) |

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No message; log says **"not set — skipping"** | env empty, or backend not restarted after editing `.env` | Set both keys, restart backend |
| `getUpdates` returns `{"ok":true,"result":[]}` | You never messaged the bot, or a webhook is swallowing updates | Open the bot and press **Start** / send a message; if still empty run `curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"` then retry |
| Telegram error **401 Unauthorized** (`telegram_http_401`) | Bad / truncated token | Re-copy the full token from @BotFather (`/mybots` → API Token) |
| Telegram error **404** | Token malformed (missing the `:` segment) | Re-copy the whole token incl. the part before `:` |
| **400 "chat not found"** | Wrong chat ID, or you never opened the chat with the bot | Re-run `getUpdates` after messaging the bot; copy the exact `chat.id` |
| **403 "bot can't initiate conversation with a user"** | You haven't pressed **Start** on the bot | Open the bot, press Start, retry |
| **403 "bot was blocked by the user"** | You blocked the bot | Unblock it in Telegram |
| Group alerts stopped after upgrade | Group became a **supergroup**, the ID changed | Re-fetch the new `-100…` ID via `getUpdates` |
| Works in test but no alert on real order | Order didn't reach `order.placed` (checkout failed earlier) | Check checkout logs; confirm the order actually exists in Admin |

A failed alert **never breaks order placement** — the order is saved regardless;
you just won't get the ping. So "no alert" is always a notification problem, never
a lost order.

---

## 8. How it behaves (reliability & limits)

From `order-placed.ts`:

- **Retry with backoff** — up to **3** send attempts, sleeping `500ms × attempt`
  between tries. Each attempt has a **10s** timeout.
- **Never throws** — the handler is wrapped so a Telegram failure can't bubble up
  and break order completion. On final failure it logs an error and returns.
- **Send budget** — a process-level cap of **30 messages/minute** (a fixed-window
  counter). Past that, alerts in the same minute are skipped with a warning. This
  matches the `security.md` "Telegram send path — 30/min/process" rule. For a
  single-operator shop this is far above normal order volume; it only trips under
  an abnormal burst.
- **No-op when unconfigured** — missing token or chat ID → warn + return.

---

## 9. Security model

This integration was built to the project `security.md` rules:

- **Private chat only.** Full order PII (name, phone, address, note) is sent —
  that's the whole point — but **only to your private chat / private group**.
  Never point `TELEGRAM_CHAT_ID` at a public channel.
- **No PII in logs.** Phone/address/note appear in the Telegram message but are
  **never** written to server logs or error messages — only the (non-sensitive)
  order id and attempt count are logged.
- **Token never logged.** The bot token lives only in the request URL; failures
  log a generic `telegram_http_<status>`, never the Telegram response body (which
  can echo the token path or chat id).
- **No SSRF surface.** The host is hard-coded `https://api.telegram.org`; nothing
  about the destination is user-controllable.
- **No injection.** Messages are sent as plain text with no `parse_mode`, so a
  customer can't smuggle Telegram markup or links through their name/note.
- **Secret hygiene.** `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` are `.env`-only,
  never committed. `.env.template` holds the keys with empty values as
  documentation.

---

## 10. Production / UAT

The UAT runbook (`docs/uat-deploy.md`) exercises this live with real credentials.
The relevant `.env` block on the server:

```bash
# --- Telegram order alerts (UAT exercises BACKEND-09 live) ---
TELEGRAM_BOT_TOKEN=      # ← from @BotFather
TELEGRAM_CHAT_ID=        # ← your private chat id
```

After `npx medusa build`, remember the env is copied into the build output before
running it:

```bash
cp .env .medusa/server/.env
```

UAT acceptance for this feature (from the runbook checklist):

> ☐ **Telegram alert arrives** in your private chat with full order details
> (order #, items, total USD+KHR, COD, name/phone/address). *(BACKEND-09 live)*

---

## 11. Rotating or revoking the token

If the token is ever exposed (committed, pasted, leaked in a screenshot):

1. In @BotFather: `/mybots` → select the bot → **API Token** → **Revoke current
   token**. This immediately invalidates the old token and issues a new one.
2. Update `TELEGRAM_BOT_TOKEN` in `backend/.env` (and the server's `.env`).
3. Restart the backend.

To retire the bot entirely: @BotFather → `/deletebot`.

---

## 12. Not the same thing: the public "Chat on Telegram" links

The storefront shows "Chat on Telegram" links in two places — the **footer**
(`storefront/src/components/layout/Footer.tsx`) and the **COD order-confirmation
page** (`storefront/src/app/order/[id]/page.tsx`, `TELEGRAM_SUPPORT_URL`). These
are **public marketing/support links** for customers to message the shop — a
completely separate concern from the alert bot:

| | Order-alert bot (this doc) | "Chat on Telegram" link |
| --- | --- | --- |
| Direction | Backend → operator | Customer → shop |
| Configured via | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (`.env`) | A public `t.me/...` URL in storefront code |
| Status | Built & working (BACKEND-09) | **Placeholder** `https://t.me` — wire the real handle at INTEGRATION |

Don't put your bot token anywhere near the storefront, and don't reuse the
alert chat ID for the public link. They never touch each other.
```
