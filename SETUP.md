# ORBIT internship intake

**Status: live.** The Sheet, the script, and the endpoint all exist and have been
tested end to end against the real deployment.

| | |
|---|---|
| **Sheet** | [ORBIT Internship 2026](https://docs.google.com/spreadsheets/d/1C8pR1q9KE7Y04qejEWD8ofUNGFxR4_MNutu_YglkJZw/edit) |
| **Script** | [Apps Script editor](https://script.google.com/home/projects/1msKs1JTI1Jj6_j4eDJsYq3HddbxKUf8mii4IB5E-uDHFwhfzkqLvPU5t/edit) |
| **Endpoint** | `https://script.google.com/macros/s/AKfycbyw3S92…KGVeJGAiQ/exec` |
| **Receipts** | Drive folder **ORBIT Internship Receipts** (the script made it on first upload) |
| **Owner** | `hello.theorbit@gmail.com` |

The endpoint is already wired into `CONFIG.ENDPOINT` in [`index.html`](index.html).

## How it works

```
  ┌──────────┐   apply    ┌──────────────┐  appendRow   ┌───────────────┐
  │  Form    │───────────►│ Apps Script  │─────────────►│ Google Sheet  │
  │          │◄───────────│  Web App     │              │  AWAITING_    │
  │          │  ORB-8842  └──────────────┘              │  PAYMENT      │
  └──────────┘                                          └───────────────┘
       │
       │  applicant transfers PKR 3,000 from their own bank,
       │  putting ORB-8842 in the remarks
       ▼
  ┌──────────┐  confirm   ┌──────────────┐  update row  ┌───────────────┐
  │ Payment  │───────────►│ Apps Script  │─────────────►│ PAYMENT_      │
  │ screen   │            │              │──► receipt ─►│ SUBMITTED     │
  └──────────┘            └──────────────┘   to Drive   └───────────────┘
                                                               │
                                        you check the bank     │
                                        statement, flip to  ───┘
                                        CONFIRMED
```

A manual bank transfer has no callback — nobody tells the server the money landed. So
the whole design hangs on **one reference number** the applicant types into the transfer
remarks. That's what lets you match a PKR 3,000 deposit on your statement to a row.

The row is written **when they submit the form, not when they pay**. Someone who fills
everything in and then balks at the payment screen still lands in the sheet as
`AWAITING_PAYMENT` — a warm lead you can chase, rather than someone who vanished.

---

# Before you share the link

### 1. Put in your real bank details — the page is locked until you do

**The payment screen currently refuses to take money.** Every bank field in `CONFIG`
still starts with `TODO`, and the page detects that: instead of an account number it
shows a red *"do not transfer any money"* warning, and hides the transfer card, the
how-to-pay steps, and the "I have paid" form.

Applications still save normally. The only thing withheld is the invitation to send
money to an account that isn't yours. That is deliberate — a live page pointing at the
wrong IBAN is worse than no page at all, so it's a structural guard rather than a note
you can skim past.

Open [`index.html`](index.html), find the `CONFIG` block at the top of the `<script>`,
and replace the values:

```js
BANK: [
  { k: 'Bank',           v: 'TODO — bank name' },
  { k: 'Account title',  v: 'TODO — account title, exactly as on your statement' },
  { k: 'Account number', v: 'TODO — account number' },
  { k: 'IBAN',           v: 'TODO — IBAN' },
  { k: 'Branch',         v: 'TODO — branch (optional, delete this line if unused)' }
],

ALT: [                                    // set to [] to hide this card entirely
  { k: 'Easypaisa', v: 'TODO — Easypaisa number, or delete this line' },
  { k: 'JazzCash',  v: 'TODO — JazzCash number, or delete this line' }
],

SUPPORT_EMAIL: 'internships@orbitpk.com',
```

Delete the last `TODO` and the payment screen unlocks by itself. Then
`git commit && git push`, and Pages redeploys in about a minute.

Make the **account title match your registered company name**. It's printed right there
on the payment screen, and a mismatch is the first thing a suspicious applicant notices.

### 2. Delete the test rows

Two rows were written by end-to-end tests against the live endpoint:

| Ref | Why it's there |
|---|---|
| `ORB-2007` | first live test — its Phone cell shows `#ERROR!`, written before the formula fix |
| `ORB-4508` | written after the fix, to prove `+92 300 1234567` now stores correctly |

Delete both, and delete the test receipt (a 1×1 pixel PNG) from the **ORBIT Internship
Receipts** folder in Drive.

### Optional: notifications

At the top of [`apps-script/Code.gs`](apps-script/Code.gs):

```js
const NOTIFY_EMAIL    = '';     // set it, and you get an email on every application + payment
const EMAIL_APPLICANT = true;   // already on: emails them their reference
const FORM_URL        = '';     // set to your hosted URL, and that email gets a resume link
```

Change these and you must redeploy — see below.

---

# Changing the script later

**Editing `Code.gs` does not update the live endpoint.** You have to push *and* redeploy.

```bash
cd "d:/internship registration/apps-script"
clasp push
clasp deploy -i AKfycbyw3S92OFzzB1AjnRmlyBaCwSpWZkRje4AmjCle-58dGmYotKG82M3UUsUf5KGVeJGAiQ -d "what changed"
```

The `-i` matters. **`clasp deploy` on its own mints a brand-new deployment with a
different URL**, which silently orphans the endpoint baked into `index.html` —
the form keeps posting into the void. Passing `-i` updates the existing deployment in
place, so the URL stays put.

Three things to know about the local project:

- `.claspignore` restricts pushes to `Code.gs` + `appsscript.json`. Nothing else leaks up.
- **Never run `clasp pull`.** It re-downloads the server code as `Code.js` alongside your
  `Code.gs`, and the next push sends both — every function declared twice, script dead.
  If you do it by accident, delete `Code.js`.
- Changing the sheet's **formatting** (widths, colours, headers) means editing
  `buildSheet()` *and* bumping `LAYOUT_VERSION`. The next request re-applies the layout
  by itself, so you never have to open the editor again. It only ever rewrites formatting
  — the rows are never touched.

The web app's *execute as me / anyone can access* settings live in
[`apps-script/appsscript.json`](apps-script/appsscript.json), not in the UI:

```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
```

---

# Running it day to day

The sheet is your admin console.

1. Filter **Status** to `PAYMENT_SUBMITTED`.
2. Check the **Transaction ID** against your bank statement, and open the **Receipt**
   link to confirm the amount.
3. Good → set **Status** to `CONFIRMED`. Bogus → `REJECTED`.

`AWAITING_PAYMENT` rows are people who applied and didn't pay. Chase them.

Receipts are **not** shared publicly — they carry bank details. The link works for you
because you own the folder, not because anyone with the URL can open it.

Need a real Excel file: **File ▸ Download ▸ Microsoft Excel (.xlsx)**.

---

# What this doesn't do

**The endpoint is public.** It has to be — your applicants aren't signed into anything.
Anyone who reads your page source can find the URL and POST to it. There's a honeypot
field, a "no human fills a form in under three seconds" check, and email deduplication,
which together stop casual junk — all three are tested and working. None of them stop
someone determined. A secret key in the client JavaScript wouldn't help either; it's
right there in View Source. If real abuse starts, that's the signal to move to a proper
backend, not to add more client-side tricks.

**Nothing verifies the money actually arrived.** A manual bank transfer has no callback.
Anyone can type a made-up transaction ID and reach the "payment submitted" screen. That
screen deliberately promises nothing except that you'll check. `CONFIRMED` is only ever
set by you, against your own bank statement. **Do not admit anyone to the program on
`PAYMENT_SUBMITTED` alone.**

**A reference alone isn't a secret** — it's four digits printed on a page. That's why
confirming a payment requires the reference *and* the matching email, so nobody can post
a payment against someone else's application by guessing. Tested.

**Gmail sends ~100 emails/day** (Workspace ~1,500). For a big intake push, set
`EMAIL_APPLICANT = false` and send references in a batch. A failed email never costs you
the application row — that's handled.

**Google Sheets is fine to a few thousand rows.** Well past what one intake needs.

---

One last thing, and it's about trust rather than code: students in Pakistan are wary of
internship fees, because plenty of them are scams. Everything you do to look legitimate
pays for itself. Say plainly what the PKR 3,000 buys, publish a refund policy, and use a
bank account whose **title matches your registered company name** — that title is right
there on the payment screen, and a mismatch is the first thing a suspicious applicant
will notice.
