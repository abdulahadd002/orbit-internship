/**
 * ORBIT internship — Google Sheets backend
 * ─────────────────────────────────────────
 * Paste this into Extensions ▸ Apps Script on your Google Sheet.
 * Run setup() once, then deploy as a Web App. Full steps in SETUP.md.
 */

/* ═══════════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════════ */

const SHEET_NAME = 'Applications';

/** Drive folder for receipt uploads. Leave this blank and the script makes
 *  its own folder the first time somebody uploads a receipt, then remembers
 *  it. Only set it if you want receipts landing somewhere specific — paste
 *  the folder ID, the last chunk of its URL. */
const DRIVE_FOLDER_ID = '';
const RECEIPTS_FOLDER_NAME = 'ORBIT Internship Receipts';

/** The address applicants see, and the one their replies land in. */
const CONTACT_EMAIL = 'info@orbitpk.com';

/** Where the form is hosted. Puts a ?ref= resume link in the applicant's email,
 *  so they can finish paying from their phone without re-filling anything.
 *  Change this and redeploy if the site ever moves to apply.orbitpk.com. */
const FORM_URL = 'https://orbit-internship.vercel.app';

/** Email you on every new application and payment. Blank = off. */
const NOTIFY_EMAIL = CONTACT_EMAIL;

/** Email the applicant their reference after they apply. Blank = off.
 *  Gmail allows ~100 sends/day, Workspace ~1,500. */
const EMAIL_APPLICANT = true;

const HEADERS = [
  'Ref',                  //  1
  'Applied at',           //  2
  'Status',               //  3
  'Full name',            //  4
  'Email',                //  5
  'Phone',                //  6
  'City',                 //  7
  'University',           //  8
  'Degree',               //  9
  'Year',                 // 10
  'Track',                // 11
  'Skills',               // 12
  'Portfolio',            // 13
  'LinkedIn',             // 14
  'Hours / week',         // 15
  'Earliest start',       // 16
  'Why ORBIT',            // 17
  'Fee',                  // 18
  'Paid from',            // 19
  'Transaction ID',       // 20
  'Payment date',         // 21
  'Receipt',              // 22
  'Payment submitted at', // 23
  'Verified at'           // 24
];

/** 1-based column numbers. Keep in step with HEADERS above. */
const COL = {
  REF: 1, APPLIED: 2, STATUS: 3, NAME: 4, EMAIL: 5, PHONE: 6, CITY: 7,
  UNI: 8, DEGREE: 9, YEAR: 10, TRACK: 11, SKILLS: 12, PORTFOLIO: 13,
  LINKEDIN: 14, HOURS: 15, START: 16, WHY: 17, FEE: 18, PAID_FROM: 19,
  TID: 20, PAID_ON: 21, RECEIPT: 22, PAID_AT: 23, VERIFIED: 24
};

const STATUS = {
  AWAITING: 'AWAITING_PAYMENT',
  SUBMITTED: 'PAYMENT_SUBMITTED',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED'
};

/* ═══════════════════════════════════════════════════════════════════
   Web app entry points
   ═══════════════════════════════════════════════════════════════════ */

/** Health check. Also the hook that re-applies the layout after a version
 *  bump, so a formatting change needs a GET rather than a trip to the editor. */
function doGet() {
  const sheet = getSheet();
  return json({
    ok: true,
    service: 'ORBIT internship intake',
    applications: Math.max(0, sheet.getLastRow() - 1),
    layout: LAYOUT_VERSION,
    time: new Date().toISOString()
  });
}

function doPost(e) {
  // Two people submitting at the same instant must not get the same ref,
  // and must not overwrite each other's row. Serialise every write.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json({ ok: false, error: 'The server is busy. Please try again in a moment.' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'Empty request.' });
    }

    const body = JSON.parse(e.postData.contents);

    if (body.action === 'apply')   return json(handleApply(body));
    if (body.action === 'confirm') return json(handleConfirm(body));
    return json({ ok: false, error: 'Unknown action.' });

  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + (err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Step 1 — the application
   ═══════════════════════════════════════════════════════════════════ */

function handleApply(body) {
  // Bots fill every input they find, including the off-screen one.
  // Answer with a plausible success so they don't retry, and write nothing.
  if (String(body.orb_hp || '').trim() !== '') {
    return { ok: true, ref: 'ORB-0000' };
  }

  // A human cannot fill fourteen fields in under three seconds.
  if (Number(body.elapsed) < 3000) {
    return { ok: false, error: 'That was too quick. Please review your answers and submit again.' };
  }

  const email = String(body.email || '').trim().toLowerCase();
  const name  = String(body.name || '').trim();

  if (!email || email.indexOf('@') < 1) return { ok: false, error: 'A valid email is required.' };
  if (!name) return { ok: false, error: 'Your name is required.' };

  const sheet = getSheet();
  const dup = findRow(sheet, COL.EMAIL, email);

  if (dup) {
    const status = dup.values[COL.STATUS - 1];

    // Already applied but never paid — hand back the same reference rather
    // than opening a second row. This also makes the whole endpoint safe to
    // retry: if the response was lost in transit, the retry lands here.
    if (status === STATUS.AWAITING) {
      return { ok: true, ref: dup.values[COL.REF - 1], resumed: true };
    }

    return {
      ok: false,
      error: 'An application already exists for this email (' + dup.values[COL.REF - 1] +
             '). Email us if you think that is a mistake.'
    };
  }

  const ref = makeRef(sheet);
  const row = new Array(HEADERS.length).fill('');

  row[COL.REF - 1]       = ref;
  row[COL.APPLIED - 1]   = new Date();
  row[COL.STATUS - 1]    = STATUS.AWAITING;
  row[COL.NAME - 1]      = text(name);
  row[COL.EMAIL - 1]     = text(email);
  row[COL.PHONE - 1]     = text(body.phone);     // "+92 300..." — the one that breaks
  row[COL.CITY - 1]      = text(body.city);
  row[COL.UNI - 1]       = text(body.university);
  row[COL.DEGREE - 1]    = text(body.degree);
  row[COL.YEAR - 1]      = text(body.year);
  row[COL.TRACK - 1]     = text(body.track);
  row[COL.SKILLS - 1]    = text(body.skills);
  row[COL.PORTFOLIO - 1] = text(body.portfolio);
  row[COL.LINKEDIN - 1]  = text(body.linkedin);
  row[COL.HOURS - 1]     = text(body.hours);
  row[COL.START - 1]     = text(body.start);
  row[COL.WHY - 1]       = text(body.why);
  row[COL.FEE - 1]       = text(body.amount);

  sheet.appendRow(row);

  notifyAdmin(
    'New application — ' + name + ' (' + ref + ')',
    [
      'Ref:        ' + ref,
      'Name:       ' + name,
      'Email:      ' + email,
      'Phone:      ' + body.phone,
      'University: ' + body.university,
      'Track:      ' + body.track,
      '',
      'Status: awaiting payment of ' + body.amount + '.',
      body.bankReady ? '' : 'NOTE: the payment screen is still locked — no bank details are published.'
    ].join('\n'),
    email
  );

  if (EMAIL_APPLICANT) {
    emailApplicant(email, name, ref, String(body.amount || ''), !!body.bankReady);
  }

  return { ok: true, ref: ref };
}

/* ═══════════════════════════════════════════════════════════════════
   Step 2 — the payment confirmation
   ═══════════════════════════════════════════════════════════════════ */

function handleConfirm(body) {
  const ref   = String(body.ref || '').trim().toUpperCase();
  const email = String(body.email || '').trim().toLowerCase();

  if (!ref)   return { ok: false, error: 'Missing reference.' };
  if (!email) return { ok: false, error: 'Missing email.' };
  if (!body.tid) return { ok: false, error: 'Missing transaction ID.' };

  const sheet = getSheet();
  const found = findRow(sheet, COL.REF, ref);

  if (!found) {
    return { ok: false, error: 'We have no application under reference ' + ref + '. Please check it and try again.' };
  }

  // The reference alone isn't a secret — it's four digits printed on the
  // page. Requiring the email to match too means you can't post a payment
  // against somebody else's application by guessing.
  if (String(found.values[COL.EMAIL - 1]).trim().toLowerCase() !== email) {
    return { ok: false, error: 'That email does not match reference ' + ref + '. Use the email you applied with.' };
  }

  const status = found.values[COL.STATUS - 1];
  if (status === STATUS.CONFIRMED) {
    return { ok: false, error: 'This payment is already confirmed. Nothing more to do.' };
  }

  const name = String(found.values[COL.NAME - 1] || '');

  let receiptUrl = '';
  if (body.proofB64) {
    try {
      receiptUrl = saveReceipt(body.proofB64, body.proofMime, ref, name);
    } catch (err) {
      // A Drive failure must not lose the transaction ID — that is the part
      // you actually need to reconcile against the bank statement.
      receiptUrl = 'UPLOAD FAILED: ' + (err && err.message ? err.message : err);
    }
  }

  const r = found.row;
  sheet.getRange(r, COL.STATUS).setValue(STATUS.SUBMITTED);
  sheet.getRange(r, COL.PAID_FROM).setValue(text(body.paidFrom));
  sheet.getRange(r, COL.TID).setValue(text(body.tid));
  sheet.getRange(r, COL.PAID_ON).setValue(text(body.paidOn));
  sheet.getRange(r, COL.RECEIPT).setValue(receiptUrl);
  sheet.getRange(r, COL.PAID_AT).setValue(new Date());

  notifyAdmin(
    'Payment submitted — ' + name + ' (' + ref + ')',
    [
      'Ref:            ' + ref,
      'Name:           ' + name,
      'Email:          ' + email,
      'Transaction ID: ' + body.tid,
      'Paid from:      ' + body.paidFrom,
      'Payment date:   ' + body.paidOn,
      'Receipt:        ' + (receiptUrl || 'none'),
      '',
      'Check this against your bank statement, then set Status to CONFIRMED.'
    ].join('\n'),
    email
  );

  return { ok: true, ref: ref };
}

/* ═══════════════════════════════════════════════════════════════════
   Receipts → Drive
   ═══════════════════════════════════════════════════════════════════ */

function saveReceipt(b64, mime, ref, name) {
  const type = String(mime || 'image/jpeg');
  const ext  = type === 'application/pdf' ? 'pdf' : (type.split('/')[1] || 'jpg');

  const safe = String(name || 'applicant')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'applicant';

  const blob = Utilities.newBlob(Utilities.base64Decode(b64), type, ref + '_' + safe + '.' + ext);

  // Deliberately NOT shared publicly. Receipts carry bank details; they stay
  // private to the Drive account that owns this script. The link in the sheet
  // opens for you because you are signed in — not for anyone who finds it.
  return receiptsFolder().createFile(blob).getUrl();
}

/** The folder receipts go into. Built on first use if you haven't named one,
 *  so there is no folder ID to create and paste by hand. */
function receiptsFolder() {
  if (DRIVE_FOLDER_ID) return DriveApp.getFolderById(DRIVE_FOLDER_ID);

  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('receiptsFolderId');

  if (cached) {
    try {
      return DriveApp.getFolderById(cached);
    } catch (err) {
      // Folder was deleted or trashed. Fall through and build a new one
      // rather than losing the receipt we are holding right now.
    }
  }

  const folder = DriveApp.createFolder(RECEIPTS_FOLDER_NAME);
  props.setProperty('receiptsFolderId', folder.getId());
  return folder;
}

/* ═══════════════════════════════════════════════════════════════════
   Email
   ═══════════════════════════════════════════════════════════════════ */

/** @param replyTo  the applicant's address, so hitting Reply on the notification
 *                  answers them directly instead of yourself. */
function notifyAdmin(subject, body, replyTo) {
  if (!NOTIFY_EMAIL) return;
  try {
    const opts = { to: NOTIFY_EMAIL, subject: subject, body: body, name: 'ORBIT intake' };
    if (replyTo) opts.replyTo = replyTo;
    MailApp.sendEmail(opts);
  } catch (err) {
    // Out of quota, bad address — either way, never fail the write over an email.
  }
}

function emailApplicant(email, name, ref, fee, bankReady) {
  try {
    const back = FORM_URL ? FORM_URL + (FORM_URL.indexOf('?') > -1 ? '&' : '?') + 'ref=' + ref : '';

    const lines = [
      'Hi ' + (name.split(' ')[0] || 'there') + ',',
      '',
      'Thanks for applying to the ORBIT internship. Your application is saved.',
      '',
      'Your reference is: ' + ref,
      ''
    ];

    if (bankReady) {
      lines.push(
        'To hold your seat, transfer ' + fee + ' to the account shown on the application',
        'page, and put ' + ref + ' in the remarks field of the transfer. That reference is',
        'how we match your payment to you, so please do not leave it out.',
        '',
        'Once you have paid, come back and confirm it with your transaction ID.'
      );
      if (back) lines.push('', 'Pick up where you left off:', back);
    } else {
      // The payment screen is locked, so promising them an account to pay into
      // would contradict the page they just came from.
      lines.push(
        'Please do not transfer any money yet. Payment details for this intake have',
        'not been published — we will send them to you directly, and your place is',
        'held in the meantime.'
      );
    }

    lines.push('', 'Questions? Just reply to this email.', '', '— ORBIT');

    // Apps Script sends as whoever owns the script; it cannot forge a From
    // address. replyTo is what actually gets answers into the right inbox.
    // (To send *from* CONTACT_EMAIL you'd have to verify it in Gmail under
    // Settings ▸ Accounts ▸ "Send mail as" and move to GmailApp — a wider scope,
    // and a re-authorisation.)
    MailApp.sendEmail({
      to: email,
      subject: 'Your ORBIT internship reference: ' + ref,
      body: lines.join('\n'),
      name: 'ORBIT',
      replyTo: CONTACT_EMAIL
    });
  } catch (err) {
    // Same as above: an email failure must never cost us the application row.
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Sheet helpers
   ═══════════════════════════════════════════════════════════════════ */

/** Bump this and the sheet re-applies its layout on the next request. Saves
 *  going back into the editor every time the formatting changes. */
const LAYOUT_VERSION = 2;

/** The Applications tab, built on first use. Nobody has to remember to run
 *  setup() — the first request that arrives creates it. After that this is a
 *  single cheap lookup, unless the layout is out of date. */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return buildSheet(ss);

  const props = PropertiesService.getScriptProperties();
  if (Number(props.getProperty('layoutVersion') || 0) < LAYOUT_VERSION) {
    buildSheet(ss);   // formatting only — never touches the rows
  }
  return sheet;
}

/** Scan one column for a value. Returns { row, values } or null. */
function findRow(sheet, col, value) {
  const last = sheet.getLastRow();
  if (last < 2) return null;

  const keys = sheet.getRange(2, col, last - 1, 1).getValues();
  const needle = String(value).trim().toLowerCase();

  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim().toLowerCase() === needle) {
      const row = i + 2;
      return { row: row, values: sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0] };
    }
  }
  return null;
}

/** Short, human-typeable, collision-checked. It has to survive being
 *  retyped into a bank app's remarks box on a phone. */
function makeRef(sheet) {
  const taken = {};
  const last = sheet.getLastRow();

  if (last > 1) {
    sheet.getRange(2, COL.REF, last - 1, 1).getValues()
      .forEach(function (r) { taken[String(r[0]).trim()] = true; });
  }

  for (let i = 0; i < 60; i++) {
    const ref = 'ORB-' + (1000 + Math.floor(Math.random() * 9000));
    if (!taken[ref]) return ref;
  }

  // Effectively unreachable — you'd need thousands of applicants first.
  return 'ORB-' + Utilities.getUuid().slice(0, 6).toUpperCase();
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Sheets evaluates a leading =, +, - or @ as a formula. That is why a phone
 * number like "+92 300 1234567" lands in the sheet as #ERROR! and the contact
 * details are gone. A leading apostrophe forces the value to be stored as
 * literal text; Sheets strips it again on read, so getValue() still returns
 * the plain string. Every free-text field goes through here.
 */
function text(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/* ═══════════════════════════════════════════════════════════════════
   Run once from the editor
   ═══════════════════════════════════════════════════════════════════ */

/** How wide each column should be, in the order of HEADERS. Hand-set rather
 *  than auto-resized: autoResize on an empty sheet just fits the header text,
 *  which is why Ref showed up as "ORE". */
const WIDTHS = [
  92,   // Ref
  132,  // Applied at
  168,  // Status
  158,  // Full name
  208,  // Email
  138,  // Phone
  104,  // City
  168,  // University
  176,  // Degree
  104,  // Year
  104,  // Track
  216,  // Skills
  176,  // Portfolio
  176,  // LinkedIn
  118,  // Hours / week
  118,  // Earliest start
  300,  // Why ORBIT
  86,   // Fee
  128,  // Paid from
  148,  // Transaction ID
  118,  // Payment date
  188,  // Receipt
  148,  // Payment submitted at
  128   // Verified at
];

const ROWS = 2000;

/** Creates and formats the Applications tab. Idempotent: it rewrites the
 *  header row and the formatting, and never touches the rows below. */
function buildSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  // A new sheet ships with 1000 rows. Asking for a bigger range before those
  // rows exist throws, so grow the sheet first.
  if (sheet.getMaxRows() < ROWS) {
    sheet.insertRowsAfter(sheet.getMaxRows(), ROWS - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  } else if (sheet.getMaxColumns() > HEADERS.length) {
    sheet.deleteColumns(HEADERS.length + 1, sheet.getMaxColumns() - HEADERS.length);
  }

  const data = sheet.getRange(2, 1, ROWS - 1, HEADERS.length);

  /* ── header ──────────────────────────────────────────────────────── */
  const head = sheet.getRange(1, 1, 1, HEADERS.length);
  head.setValues([HEADERS])
      .setBackground('#0a0a0a')
      .setFontColor('#ffffff')
      .setFontFamily('Inter')
      .setFontSize(10)
      .setFontWeight('bold')
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('left');

  // ORBIT orange under the header — the one flash of brand in here.
  head.setBorder(null, null, true, null, null, null,
                 '#ff751f', SpreadsheetApp.BorderStyle.SOLID_THICK);

  sheet.setRowHeight(1, 36);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);

  /* ── body ────────────────────────────────────────────────────────── */
  data.setFontFamily('Inter')
      .setFontSize(10)
      .setVerticalAlignment('middle')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);   // one line per row, scannable

  sheet.setRowHeights(2, ROWS - 1, 28);
  WIDTHS.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  /* ── formats ─────────────────────────────────────────────────────── */
  // Plain text everywhere, so "+92 300..." is never parsed as a formula.
  data.setNumberFormat('@');

  // ...except the timestamps, which stay real dates so you can sort by them.
  // ISO-ish rather than 7/13/2026 — no ambiguity about which is the month.
  [COL.APPLIED, COL.PAID_AT, COL.VERIFIED].forEach(function (c) {
    sheet.getRange(2, c, ROWS - 1, 1).setNumberFormat('yyyy-mm-dd  hh:mm');
  });

  /* ── status: the column you actually work in ─────────────────────── */
  const statusRange = sheet.getRange(2, COL.STATUS, ROWS - 1, 1);
  statusRange
    .setHorizontalAlignment('center')
    .setFontWeight('bold')
    .setFontSize(9)
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList([STATUS.AWAITING, STATUS.SUBMITTED, STATUS.CONFIRMED, STATUS.REJECTED], true)
        .setAllowInvalid(false)
        .build()
    );

  sheet.setConditionalFormatRules([
    tint(statusRange, STATUS.AWAITING,  '#fff1e0', '#8a4b00'),
    tint(statusRange, STATUS.SUBMITTED, '#e3ecfd', '#12448c'),
    tint(statusRange, STATUS.CONFIRMED, '#e2f4e8', '#0f6b33'),
    tint(statusRange, STATUS.REJECTED,  '#fde9e7', '#a3160b')
  ]);

  /* ── banding: 24 columns is a long way for the eye to track ──────── */
  sheet.getBandings().forEach(function (b) { b.remove(); });   // never stack them
  data.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

  /* ── a filter, because the daily job is "show me PAYMENT_SUBMITTED" ─ */
  const stale = sheet.getFilter();
  if (stale) stale.remove();
  sheet.getRange(1, 1, ROWS, HEADERS.length).createFilter();

  /* ── tidy up ─────────────────────────────────────────────────────── */
  const stray = ss.getSheetByName('Sheet1');
  if (stray && stray.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(stray);
  }

  PropertiesService.getScriptProperties().setProperty('layoutVersion', String(LAYOUT_VERSION));
  return sheet;
}

/** Run this once from the editor to authorise the script and lay out the
 *  sheet up front. Optional — the first application would build it anyway. */
function setup() {
  buildSheet(SpreadsheetApp.getActiveSpreadsheet());

  const msg = 'Setup complete. Sheet "' + SHEET_NAME + '" is ready, and the script is authorised.';
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    // No UI when run headlessly — the log above is enough.
  }
}

function tint(range, value, bg, fg) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(value)
    .setBackground(bg)
    .setFontColor(fg)
    .setRanges([range])
    .build();
}
