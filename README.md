# ORBIT Internship — application & registration

A single-page internship application that collects the applicant, takes a registration
fee by direct bank transfer, and files everything into a Google Sheet.

No server, no payment gateway, no hosting bill.

```
  Apply  ──►  Pay (bank transfer)  ──►  Confirm  ──►  You verify
```

## Why it's built this way

A manual bank transfer has **no callback** — nobody tells a server that the money landed.
So the whole design hangs on one thing: a short **reference number** (`ORB-8842`) that the
applicant types into the transfer remarks. That is what lets a deposit on a bank statement
be matched back to a row in the sheet.

Two consequences fall out of that:

- **The row is written when they submit the form, not when they pay.** Someone who fills
  everything in and then hesitates at the payment screen still lands in the sheet as
  `AWAITING_PAYMENT` — a warm lead to chase, rather than someone who vanished.
- **`CONFIRMED` is only ever set by a human**, against a real bank statement. Anyone can
  type a made-up transaction ID and reach the "payment submitted" screen, so that screen
  promises nothing except that someone will check.

## What's here

| | |
|---|---|
| [`index.html`](index.html) | The whole front end. One self-contained file — styles, markup and script inline, no build step, no dependencies. |
| [`apps-script/Code.gs`](apps-script/Code.gs) | Google Apps Script backend. Appends and updates rows, saves receipts to Drive, emails the applicant their reference. |
| [`apps-script/appsscript.json`](apps-script/appsscript.json) | Declares the web app as *execute-as-owner / anyone-can-access*, so the deploy is reproducible instead of a pair of dropdowns someone clicked once. |
| [`SETUP.md`](SETUP.md) | Deployment, day-to-day operation, and an honest list of what this doesn't do. |

## The flow

1. **Apply.** Client-side validation, live completion meter, six sections.
2. **Save.** POSTs to the Apps Script web app, which appends a row and issues a reference.
3. **Pay.** The payment screen shows the account details and the reference, with
   copy-to-clipboard on every field — a mistyped IBAN is a payment you spend a week chasing.
4. **Confirm.** The applicant returns with a transaction ID and a screenshot of the receipt.
   Images are downscaled in the browser before upload, because a phone screenshot is 2–5 MB
   and mobile data in Pakistan is not free.
5. **Verify.** The sheet is the admin console: filter to `PAYMENT_SUBMITTED`, check the
   statement, flip the status.

The reference is kept in `localStorage`, and the confirmation email carries a `?ref=` deep
link — so closing the tab to open a banking app (which everyone does) doesn't mean
re-typing fourteen fields.

## Notes

The Apps Script endpoint is necessarily public: applicants aren't signed into anything.
A honeypot field, a minimum time-on-form check, and email deduplication stop casual junk.
None of them stop someone determined, and a secret key in client-side JavaScript would not
help — it's visible in View Source. If real abuse ever starts, the answer is a proper
backend, not more client-side tricks.

Receipts are stored **privately** in Drive. They contain bank details, and are never
link-shared.
