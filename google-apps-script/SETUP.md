# Connect D.I.N.I.G. to Google Sheets

No Node hosting, PostgreSQL, Supabase account, or database password is needed for this version. The existing Node implementation is retained only as legacy source; it is not deployed or called by the HTML interface.

**Prepared project:** [CSC D.I.N.I.G. Apps Script](https://script.google.com/home/projects/1EMimtH76pRx1UM-B5XfHb85AWu0jle1Bj71uigK053RCIE2v0uouv1n4/edit), owned by the existing `centralstudentcouncil2026@gmail.com` CSC Google account. Its `Code.gs` already contains both the cryptographic library and backend, and the manifest is uploaded. Do not add a duplicate Crypto file to this prepared project. Start at step 2 below; step 1 is only for a fresh project.

## 1. Create the Apps Script project

Sign in to Google as the approved database owner, preferably **aupcscdinig@aup.edu.ph**, and open [a new Apps Script project](https://script.google.com/home/start). Name it `CSC D.I.N.I.G.`.

- Replace the initial `Code.gs` with the supplied `google-apps-script/Code.gs`.
- Add a Script file named `Crypto` and paste `google-apps-script/Crypto.gs` into it. This contains the locally bundled PBKDF2 library; it does not download code at runtime.
- In Project Settings, enable **Show appsscript.json manifest file in editor**. Replace that manifest with `google-apps-script/appsscript.json`. It enables the Sheets v4 advanced service and the needed spreadsheet, Drive, and script-property scopes. If using a standard Google Cloud project, enable its Google Sheets API too.

## 2. Set two private Script properties

In Project Settings → Script properties, set:

| Property | Value |
| --- | --- |
| `TOKEN_SECRET` | The 64-character random hex value in the ignored local `google-apps-script/.setup-secrets.txt`. Generate it with `npm run setup:secret` if absent. Never put it into frontend files, Git, or chat. |
| `ADMIN_PASSWORD` | A strong new password you choose for `aupcscdinig@aup.edu.ph`, at least 12 characters. Enter it only in Script properties. Do not reuse the Google account password. |

This is a separate D.I.N.I.G. login. Its email is not a Google sign-in mechanism, and the application never asks for your Google password.

Do not set `ADMIN_USER_ID`, Supabase keys, or `DATABASE_URL`: the Sheets version does not use them. `SPREADSHEET_ID` and `ATTACHMENT_FOLDER_ID` may be left unset; setup creates new private resources automatically. If you supply existing IDs, they must be dedicated to D.I.N.I.G. and private.

Optional properties are `EMERGENCY_GUIDANCE`, `RESPONSE_GUIDANCE`, and `RETENTION_DAYS`. Use only approved university guidance. Blank guidance produces no invented contacts or response promises. Retention is informational and never triggers automatic report deletion.

## 3. Run setup

Confirm **Services** lists **Google Sheets API** (identifier `Sheets`, version v4). If missing, use Services → + to add it. Setup flushes new tabs and headers before using this advanced API, then runs a read-only API check so missing service, API enablement, or permission errors appear directly in the owner execution log.

Select `setup` in the Apps Script editor and click Run. Review the permission prompt and authorize this project. This is the owner-side step; students never authorize Drive or Sheets access.

The function creates the private database tabs and attachment folder, seeds the administrator account, and prints **only the Sheet URL** to the execution log. It stores a salted, server-keyed HMAC-SHA256 password verifier and removes `ADMIN_PASSWORD` from Script properties after success. It preserves existing accounts when rerun. Keep `TOKEN_SECRET` unchanged after launch.

Keep the spreadsheet and attachment folder **Restricted**, with no additional viewers/editors or public/domain sharing. Never publish the Sheet to the web. Handlers get access through the application; sharing the entire database would bypass case restrictions. Database/Drive owners and Google Workspace administrators remain trusted operators.

## 4. Deploy

Deploy → New deployment → Web app:

- Execute as: **Me** (the approved database owner).
- Who has access: **Anyone**, including anonymous students.

If your university Workspace policy disallows anonymous web apps, ask the university administrator to approve the deployment or use an approved Google account. Do not make the Sheet public to work around that policy.

Copy the URL ending in `/exec`, for example `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`. Share **that deployment URL** with the coding agent; it is a public endpoint, not a password or private tracking code. It will be put in `public/backend-config.js`, then `npm run build` and a commit/push will publish the connected HTML. You can also set it there yourself and rebuild.

After changing backend code, update the existing deployment to a **new version** through Manage deployments. Do not send students the editor `/dev` URL.

## 5. Verify before collecting real concerns

1. Confirm the `/exec?action=health` response says configured without exposing records.
2. Open the GitHub Pages homepage and staff entry. Log in with `aupcscdinig@aup.edu.ph` and the D.I.N.I.G. password you chose.
3. Submit two test reports under the same nickname. Save each private code. A reference alone must fail; each code must show only its report.
4. Add a private staff note and check it never appears in the student conversation. Check unauthorized staff and the other report cannot download an attachment.
5. Configure additional handler/reviewer accounts in Access & approved routing. At least one **independent** reviewer is needed for a further-review request; a reviewer who previously handled the case is excluded.
6. Check mobile layout, assignment, referral, resolution, and a further-review request with non-sensitive test data. Test password changes/disabled accounts and the 30-minute idle timeout.

## Session and storage differences you approved

Apps Script cannot set the custom HttpOnly tracking cookie from the original brief. The approved alternative uses a short-lived bearer token **only in JavaScript memory**. Students re-enter the private code after a reload. Staff also sign in again after reload. Tokens and tracking codes never enter URLs, localStorage, sessionStorage, or analytics. Both session kinds expire after 30 minutes idle and eight hours absolutely; password changes and disabling staff revoke access on subsequent requests.

All private reads and downloads use POST, with credentials omitted and no token in a query. Passwords reach only this Apps Script deployment over HTTPS, are checked against salted slow hashes, and are never saved as plaintext or logged. There is no public signup, public listing, Drive URL response, or automatic external email.

## Limits and maintenance

Google Sheets has no row-level database security; **every operation is checked in Apps Script** and the Sheet itself stays owner-only. User content is written as Sheets `stringValue` containing JSON, so formula-looking inputs do not become formulas. Related writes use one Sheets batch update under a script lock. Records are private JSON rows, organized by entity, and reviewed through the app.

Uploads allow up to three matching PNG/JPEG/PDF files, 5 MB each and 10 MB combined. Files stay in the private Drive folder; downloads are authorized before returning base64 data. Signature checks are not malware scanning. A failed/uncertain file-and-Sheets operation may leave an owner-only orphan Drive file; review such files through trusted operations rather than automatically deleting possible evidence.

Apps Script does not provide a trustworthy requester IP here. Limits are deliberately global for anonymous tracking (100/15 min), submissions (60/hour), and staff login (10/5 min), plus per-session messaging limits. This can cause shared-service throttling and does not replace a full abuse-prevention service. Apps Script execution, Sheet size, and Drive quotas apply; benchmark password-hashing time and simultaneous usage on the actual Google deployment. This setup is suited to modest traffic and is not a security certification.

Schedule trusted review of expired sessions, rate-limit records, commit markers and orphan files. No cleanup endpoint or automatic report deletion is exposed. For an administrator password reset, the owner sets a new `ADMIN_PASSWORD` property and runs `resetAdminPassword` in the editor; it clears the property and revokes that administrator's old sessions.

## Update existing deployments to fast verification

Replace Code.gs with the current backend source, keeping Crypto.gs and all existing Script properties unchanged. Deploy → Manage deployments → Edit → Version: New version → Deploy. Keep the same deployment URL. Do not rerun setup or reset passwords. Existing accounts verify PBKDF2 once on their next successful sign-in and then migrate; failed attempts never migrate. New/changed passwords use HMAC-SHA256 immediately. This performance tradeoff removes adaptive password stretching, though the server-only HMAC key, unique salts, rate limits and authorization remain.
