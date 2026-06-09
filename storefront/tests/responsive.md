# TEST-09 — Responsive & In-App Browser Checklist

> **Task:** TEST-09 (`ImplementPlan.md`) — _Responsive & in-app browser_
> **Objective:** Verify mobile-first behavior.
> **Acceptance criteria:** All pass in in-app browsers; no broken OAuth / polling.
> **Dependencies:** INTEGRATION-05 (KHQR), INTEGRATION-06 / 06B (Facebook / Google login).

This is a **manual UAT checklist**, not an automated spec. The viewport-width
section (Track A) can be run locally against the dev server; the in-app-browser
section (Track B) requires real devices and a **deployed HTTPS storefront** —
Facebook/Telegram in-app browsers cannot reach `localhost`, and the OAuth
providers only redirect to an allowlisted `https` `redirect_uri`. Track B is
therefore a go-live UAT gate (runs once SETUP-11 + the Vercel deploy are up),
the same posture INTEGRATION-10's live Telegram send carries.

Mark each row **✓ Pass / ✗ Fail / — N/A**, with the device + browser and a note.
Any ✗ blocks the acceptance criteria.

---

## Reference — implemented breakpoints (source of truth)

These are the exact boundaries in the components under test. The three widths
the task names (360 / 768 / 1440) deliberately straddle different boundaries, so
the expected layout is **not** uniform across surfaces at a given width.

| Surface | Component | Boundary | Behavior |
|---|---|---|---|
| Primary nav | `layout/TopNav` | `min-[600px]:` | ≤599 hamburger + left drawer; ≥600 inline links + currency toggle + search/account/bag |
| Bottom cart bar | `layout/BottomBar` | `min-[600px]:hidden` | shown ≤599; hidden ≥600; sits in normal flow (no `position: fixed`) |
| Product grid | `product/ProductGrid` | `min-[600/1024/1440px]:` | 1-up base → 2-up ≥600 → 3-up ≥1024 → 4-up ≥1440 |
| Filter rail/drawer | `product/FilterSidebar` | `small:` (1024px) | ≤1023 "Filters" pill → full-screen off-canvas drawer; ≥1024 fixed 220px left rail |
| Checkout columns | `app/checkout/page` | `small:flex-row` | stacked single column <1024; form + order summary side-by-side ≥1024 |
| KHQR pay screen | `app/checkout/khqr/page` | `max-w-md` centered | same centered card at all widths; 3s status poll + 1s countdown |

### Expected layout at the three task widths

| Width | TopNav | BottomBar | PLP grid | Filters | Checkout |
|---|---|---|---|---|---|
| **360** | hamburger drawer | **shown** | **1-up** | drawer | stacked |
| **768** | inline desktop | hidden | **2-up** | **drawer** (still <1024) | stacked |
| **1440** | inline desktop | hidden | **4-up** | **rail** | two-column |

> Note the 768 row: desktop nav is already active while the filter is still a
> mobile drawer and the grid is 2-up — confirm all three independently.

---

## Track A — Viewport widths (360 / 768 / 1440)

Run against the dev storefront (`npm run dev`) using Chrome DevTools device
toolbar (or any responsive-resize tool). Test at the design rule's smallest
target first (360px). Surfaces to walk: home `/`, PLP `/category/[handle]`,
PDP `/product/[handle]`, cart `/cart`, checkout `/checkout`, KHQR
`/checkout/khqr`, order confirmation `/order/[id]`.

> Automated coverage already exists for the **grid reflow** at 360 / 768 / 1100 /
> 1440 (`storefront/tests/catalog.spec.ts`, TEST-01, green). This track
> re-confirms it visually and adds the nav/filter/bottom-bar/checkout reflow that
> the spec does not assert.

### A1 — 360px (mobile, 1-up)

- [ ] No horizontal scroll / overflow anywhere (test 360px **first**, per design rule).
- [ ] `TopNav`: hamburger (left) + centered wordmark + bag (right); desktop links hidden.
- [ ] Hamburger opens the left slide-in drawer; backdrop dims; nav links + currency toggle present; close (✕) and backdrop both dismiss it.
- [ ] PLP product grid is **1-up** (single column), 1:1 product images on soft-cloud.
- [ ] `FilterSidebar`: "Filters" pill visible; tapping opens the **full-screen off-canvas drawer**; ✕ closes it; chip selections persist after close.
- [ ] `BottomBar` is **visible**, in normal flow (scrolls with content, not pinned/overlapping), Checkout disabled when bag empty.
- [ ] Checkout `/checkout` is a **single stacked column** (login → delivery form → payment → order summary → Place order).
- [ ] KHQR `/checkout/khqr` centered card: QR + countdown + "Pay with KHQR" CTA + "Waiting for payment…" all fit; no clipping.

### A2 — 768px (tablet — desktop nav, mobile filter, 2-up)

- [ ] No horizontal overflow.
- [ ] `TopNav`: **inline desktop** layout (links + currency toggle + search/account/bag); hamburger hidden.
- [ ] `BottomBar` is **hidden** (≥600).
- [ ] PLP product grid is **2-up**.
- [ ] `FilterSidebar` is **still the drawer** (Filters pill), not the rail (768 < 1024).
- [ ] Checkout is **still stacked** (form above order summary; 768 < 1024).

### A3 — 1440px (desktop-large — 4-up, rail, two-column)

- [ ] `TopNav` inline desktop; content max-width respected (`max-w-8xl`), gutters breathe.
- [ ] PLP product grid is **4-up**.
- [ ] `FilterSidebar` is the **fixed 220px left rail** (`small:` ≥1024 satisfied); no Filters pill.
- [ ] Checkout is **two-column** (delivery form left, order summary right, `small:w-80` sticky-ish column).
- [ ] KHQR card stays `max-w-md` centered (does not stretch full width).

### A4 — Reflow continuity (resize sweep)

- [ ] Drag width 360 → 1440 continuously: grid steps 1→2→3→4 at 600/1024/1440; nav swaps at 600; filter swaps at 1024; no layout break, overlap, or content jump at any boundary.

---

## Track B — In-app browsers (Facebook + Telegram)

**Precondition:** deployed HTTPS storefront reachable from a phone, with the
OAuth `redirect_uri` for both Facebook and Google pointing at that origin
(allowlist — `security.md`). Open the storefront by posting/sending its link
into a Facebook post or Messenger thread (→ Facebook in-app browser) and into a
Telegram chat (→ Telegram in-app browser), then tapping the link. Run on **one
Android and one iOS device** for each app (in-app WebViews differ by OS).

Devices used (fill in): Android ____________  iOS ____________

### B1 — Facebook in-app browser

| # | Check | Pass/Fail | Notes |
|---|---|---|---|
| B1.1 | Storefront opens; no horizontal overflow at device width (matches A1/360) | | |
| B1.2 | **Nav collapse:** hamburger drawer opens/closes; links navigate inside the IAB | | |
| B1.3 | **Filter drawer:** Filters pill opens the off-canvas drawer; chips toggle; close works | | |
| B1.4 | Add to bag → `BottomBar` reachable by scrolling (not hidden behind FB's bottom chrome); Checkout works | | |
| B1.5 | **Polling:** `/checkout/khqr` renders the QR + live countdown; status poll continues while foreground | | |
| B1.6 | **Polling → paid:** simulated/sandbox pay flips to "Payment confirmed" and redirects to `/order/[id]` (no stuck spinner) | | |
| B1.7 | **OAuth (Facebook):** "Continue with Facebook" top-level redirects to FB consent → returns to `/checkout` → Full Name prefilled | | |
| B1.8 | **OAuth (Google):** "Continue with Google" — see Known Constraint C1 (Google may refuse embedded WebView); verify the external-browser fallback completes | | |
| B1.9 | Cart cookie + `ali_currency` preference persist across navigation within the IAB session | | |

### B2 — Telegram in-app browser

| # | Check | Pass/Fail | Notes |
|---|---|---|---|
| B2.1 | Storefront opens; no horizontal overflow at device width | | |
| B2.2 | **Nav collapse:** hamburger drawer opens/closes; links navigate | | |
| B2.3 | **Filter drawer:** opens/closes; chip selection persists | | |
| B2.4 | `BottomBar` reachable; Checkout works | | |
| B2.5 | **Polling:** QR + countdown render; poll continues; paid → `/order/[id]` redirect fires | | |
| B2.6 | **OAuth (Facebook):** top-level redirect → consent → back to `/checkout`, name prefilled | | |
| B2.7 | **OAuth (Google):** see C1; external-browser fallback completes and returns prefilled | | |
| B2.8 | KHQR **deeplink** ("Pay with KHQR") — see C2; QR-scan path always available as fallback | | |

---

## Known constraints & expected behaviors

These are **expected** (not defects). The checklist passes if the documented
behavior — including the fallback — holds.

- **C1 — Google blocks OAuth in embedded WebViews.** Google returns
  `disallowed_useragent` ("this browser or app may not be secure") for OAuth
  started inside an embedded WebView (both Facebook's and Telegram's in-app
  browsers are WebViews). The storefront's OAuth start is a normal top-level
  `<a href="/store/auth/google">` navigation, so the **fix is to open the link
  in the system browser** (FB/Telegram both offer "Open in external browser").
  Expected result: in-IAB Google login may be refused by Google; opening in the
  real browser completes it and returns to `/checkout` with the name prefilled.
  Facebook login is **not** subject to this (it works as a top-level redirect in
  the IAB). The OAuth `state` cookie is `SameSite=Lax` (set in
  `backend/src/api/store/auth/{facebook,google}/route.ts`), which is required so
  it survives the provider's top-level redirect back to the callback — verify it
  is not dropped in the IAB.

- **C2 — KHQR deeplink may not hand off to the bank app.** The "Pay with KHQR"
  CTA is a deeplink (`session.deeplink`) to the customer's banking app. In-app
  WebViews may not switch to an external app for custom URL schemes. The
  **QR-scan path is the primary, always-available path** (scan the on-screen QR
  with a separate banking app). Verify: QR renders and is scannable; the deeplink
  either opens the bank app or is harmlessly ignored; **payment confirmation
  works via polling regardless of which pay path was used** (`paid` is decided
  server-side after Bakong verify — `security.md` — never by the client).

- **C3 — WebViews throttle background timers.** The pay screen uses
  `setInterval` (3s status poll, 1s countdown) and tells the user to "keep this
  screen open." Backgrounding the IAB may pause the timers; returning to
  foreground must resume polling and still catch the `paid` flip. Verify the
  redirect fires when the screen is foregrounded.

- **C4 — No `position: fixed` for the cart bar (by design).** `BottomBar` sits
  in normal document flow (`design.md` / FRONTEND-21), which avoids the iOS
  WebView fixed-element jitter. Confirm it is reachable by scrolling and not
  permanently obscured by the host app's bottom chrome.

---

## Results & sign-off

| Track | Scope | Result | Date | Tester |
|---|---|---|---|---|
| A1 | 360px | | | |
| A2 | 768px | | | |
| A3 | 1440px | | | |
| A4 | Resize sweep | | | |
| B1 | Facebook IAB (Android + iOS) | | | |
| B2 | Telegram IAB (Android + iOS) | | | |

**Acceptance criteria — all must hold:**

- [ ] Layout correct at 360 / 768 / 1440 (nav collapse, filter drawer, grid reflow, bottom bar, checkout columns).
- [ ] No broken **OAuth** in in-app browsers (Facebook completes in-IAB; Google completes via the external-browser fallback — C1).
- [ ] No broken **KHQR polling** in in-app browsers (QR scannable, status polls, `paid` redirect fires — C2/C3).
- [ ] No horizontal overflow / unreachable controls in either in-app browser.

> **Execution status:** Checklist authored and ready. Track A is runnable now
> against the dev server (grid reflow already green in `catalog.spec.ts`). Track B
> is pending the HTTPS deploy (SETUP-11 + Vercel) and real devices — it is a
> go-live UAT gate and has **not** been executed from this environment (no
> Facebook/Telegram app + no public origin available here).
