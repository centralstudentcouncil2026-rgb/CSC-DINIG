# CSC D.I.N.I.G.

**Discuss Issues, Needs, Ideas, and Grievances** — an HTML/CSS/JavaScript student concern platform using **Google Sheets for reports and staff accounts**, **Google Apps Script for private server operations**, and a private Google Drive folder for attachments.

This version needs **no separate Node hosting, PostgreSQL, Supabase project, or database password**. It reuses the original CSC torch, gold/navy header, campus photograph and local Inter font. The existing CSC dashboard cards already point Students/COLE to the student entry and Officers to the staff entry.

## Current deployment state

The HTML interface and Apps Script source are implemented and tested locally. The [Apps Script project](https://script.google.com/home/projects/1EMimtH76pRx1UM-B5XfHb85AWu0jle1Bj71uigK053RCIE2v0uouv1n4/edit) has been created in the existing CSC Google account and its code/manifest uploaded. **The Google backend is not deployed yet:** the owner must enter private setup properties and authorize Google access before setup/deployment. Until a valid `/exec` URL is configured, the site shows its introduction and blocks concern/login forms rather than collecting private information without a backend.

The initial administrator email is **aupcscdinig@aup.edu.ph**. Its D.I.N.I.G. password is chosen privately during Google setup; it is not the Google account password and is never embedded in HTML.

## Finish setup

For the new single-admin installation, follow [google-apps-script/FRESH-SETUP.md](google-apps-script/FRESH-SETUP.md). The older migration-compatible source remains documented in SETUP.md.

1. Create a new private Google Sheet, open Extensions → Apps Script, and replace Code.gs with FreshStart.gs. No Crypto.gs is needed.
2. Enable the advanced Sheets v4 service and set ADMIN_PASSWORD privately in Script properties.
3. Run setup. It initializes the Sheet, creates the admin hash, prepares cached login and removes the plaintext password property. No Drive folder is created.
4. Deploy execute as Me, accessible to Anyone. Keep the Sheet Restricted.
5. Configure the public /exec URL in public/backend-config.js, run npm run build, commit and push. GitHub Pages publishes main → /docs.

## Included workflows

- Account-free submission, review, duplicate-submit guard, one-time private-code display, copy/download, and unique public reference numbers.
- Private-code tracking, original concern, status timeline, student/staff messages, corrections as follow-ups, feedback and independent further review.
- Fast single-admin login against a server-only Script-properties verifier, staff permissions, assigned/unassigned/overdue/review queues, search/filters, category/priority updates, assignment, restricted/conflicted handling, private notes, approved-office referrals, follow-up outcomes, resolution and closure.
- The fresh installation uses one administrator and rejects additional staff creation. No public signup. Disabling an account or changing its password revokes access on subsequent requests. Owner-side password reset is available only through the Apps Script editor.
- Private reports have no public listing. No report content is automatically forwarded or emailed externally.

## Security model and limitations

Every report operation checks its report-scoped session or authorized staff membership in Apps Script. Sensitive cases require an explicit assignment and reviewer permission; involved staff are excluded. The Sheet must remain Restricted and owner-only because Sheets does not provide database row-level policies.

At the owner’s request for faster Apps Script sign-in, staff passwords use **salted, server-keyed HMAC-SHA256**. This is a fast verifier, not an adaptive password hash. The key stays in Script properties, separate from the Sheet. If both the key and Sheet are compromised, guesses are much cheaper than with PBKDF2. Existing PBKDF2 accounts migrate only after a successful password check; their first login remains slow. Keep the bundled crypto library for unmigrated accounts. Plaintext passwords are neither stored nor logged. Tracking and session secrets are HMAC-derived using a separately generated 256-bit server secret and unique nonces; only hashes are stored. Reference numbers and nicknames cannot authenticate a student.

The user approved replacing the original HttpOnly-cookie design with **memory-only bearer sessions**. Tokens are held only in JavaScript memory, expire after 30 minutes idle/eight hours absolutely, and disappear on reload. Students re-enter their tracking code; staff sign in again. Tokens/codes do not enter URLs, localStorage, sessionStorage, analytics or application logs. This is a deliberate platform tradeoff, not cookie-based authentication.

Private reads use POST with browser credentials omitted. User content is rendered as escaped text and written through Sheets `stringValue` JSON records to prevent formulas. Related records are committed using one Sheets batch update under a script lock. File attachments and their download endpoints are disabled.

No file uploads or Drive access are used. The Sheets v4 dependency is for atomic record writes. Apps Script service quotas and lock contention still apply. Existing files are not automatically deleted.

The Google/Workspace operators remain trusted. These checks do not constitute a production security certification.

## Development and verification

```text
npm ci
npm run build
npm run check
npm test
npm start
```

Node is used only for local tooling, building, tests and optional preview. Students need only a browser. `npm start` serves a local static preview. The Apps Script production runtime is managed by Google.

`test/sheets.test.js` runs the actual Apps Script code and password hashing with mocked Google Sheets/Drive services. It verifies hashing, duplicate nicknames, code/reference isolation, ID tampering, private notes, assignments/restrictions, referrals, resolution/review, attachment authorization, atomic write failure, formula safety, expiry and password-change revocation. These are local logic tests, not a live Google deployment audit.

`test/sheets-browser.mjs` exercises the HTML and actual Apps Script logic through that local harness at desktop/tablet/mobile sizes. It verifies the complete submission/tracking/login path, memory-only session behavior, no script execution, no browser-storage credentials, and correct dashboard returns.

## Main files

- `index.html`, `staff/index.html`, `docs/`: generated student/staff HTML entries and GitHub Pages bundle.
- `public/app.js`, `styles.css`, `backend.js`, `backend-config.js`: UI, static hash routes and Apps Script transport.
- `google-apps-script/Code.gs`: private Sheets/Drive operations, accounts and authorization.
- `google-apps-script/Crypto.gs`, `NOBLE-LICENSE.txt`: bundled password hashing and license; rebuild with `npm run build:crypto`.
- `google-apps-script/appsscript.json`, `SETUP.md`: Google deployment configuration and instructions.
- `scripts/build-static.js`: rebuilds static outputs with correct subdirectory asset paths.

The earlier `server/`, `migrations/` and PostgreSQL tests are retained as **legacy reference only**. They are not used by the HTML/Sheets site. There is no need to configure or deploy them. Existing CSC S.Y.N.C., T.R.A.C.E. and L.I.V.E. authentication and repositories are unchanged.

Current single-admin backend: `google-apps-script/FreshStart.gs` v3. All concerns go to the central administrator desk; assignment and routing are retired. Submission date/time is recorded automatically and shown in the admin list and detail. Existing Apps Script deployments must be updated to v3 to apply these backend rules.
