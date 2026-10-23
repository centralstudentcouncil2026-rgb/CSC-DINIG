# CSC D.I.N.I.G.

**Discuss Issues, Needs, Ideas, and Grievances** — a private student concern and follow-up service. Uses the original CSC torch, shared gold gradient/navy header, campus photograph, and framework-free HTML/CSS/JavaScript conventions from the current CSC sites. Inter is served locally with its license.

This project adds a Node.js HTTP server and PostgreSQL to meet the private-cookie and server authorization requirements. Staff authenticate against the **existing CSC Supabase Auth provider**. No demo login or public staff registration exists in the application. The other CSC repositories are unchanged.

## Deployment status and required setup

Source implementation and local tests are provided. **No live database was migrated and no production concern service was deployed.** A database password, authorized staff UUIDs, and server hosting were not available. GitHub Pages cannot execute this backend or set its HttpOnly tracking sessions.

The root `index.html` and `staff/index.html` are static **launch notices** for GitHub Pages. Student and COLE dashboard cards open the root notice; Officers open `staff/`. They collect no reports, codes, attachments, or credentials. The functioning application entry remains `public/index.html`, served through the Node application. Run `node scripts/build-launch-pages.js` to rebuild notices and their allowlisted `docs/` publication bundle. Configure GitHub Pages to publish **main → /docs**, which excludes the private server source and tests. Do not move the report-collection interface onto GitHub Pages and present it as a working secure service. Once the server is deployed, update the dashboard cards to that origin (`/` for students/COLE; `/staff` for staff).

1. Provision a Node-compatible HTTPS service (or deploy the included Dockerfile). Serve both `public/` and `/api/` through this server on the **same dedicated origin**, for example your approved university D.I.N.I.G. hostname. Do not share the application's cookies with the existing GitHub Pages origin.
2. Run `npm ci`. Copy `.env.example` to `.env` for local setup, or supply environment variables using the hosting platform's secret manager. Configure `APP_ORIGIN`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and a randomly generated `RATE_LIMIT_SECRET`. The Supabase key is a publishable key, not a service-role key. Database credentials remain on the server.
3. Run `npm run migrate` **once** with a Supabase database owner connection. The migration creates only the isolated `dinig` schema and `dinig_runtime` role. It references the existing `auth.users` table but does not alter it or the existing apps' tables, authentication, or policies. Back up the database and review the migration before production execution. Re-running the same migration deliberately fails rather than partially recreating tables.
4. Create/identify the first real staff account through the existing Supabase administration interface. Obtain its authenticated user UUID, then provision it through the trusted SQL console:

   ```sql
   INSERT INTO dinig.staff_profiles(user_id, display_name, role, sensitive_access)
   VALUES ('ACTUAL-AUTH-USER-UUID', 'Approved administrator', 'administrator', true);
   ```

   The UUID must exist in `auth.users`. Membership in other CSC apps does **not** automatically grant D.I.N.I.G. permissions. Public Supabase account creation, if enabled for other apps, cannot create a D.I.N.I.G. staff profile.
5. For runtime, use a separate server-only database login with `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` and membership in `dinig_runtime`, rather than the migration owner. Grant only the necessary database CONNECT privilege and `GRANT dinig_runtime TO your_runtime_login`. Every request transaction explicitly switches to `dinig_runtime`, sets its validated principal locally, and resets those settings at commit/rollback. Do **not** grant this role to `anon`, `authenticated`, public API roles, or client accounts. Keep `dinig` out of PostgREST's exposed schemas.
6. Start with `npm start`. Configure TLS, database backups, monitoring, and log redaction at the hosting layer. Do not log request bodies, passwords, cookies, private codes, report text, or attachment content. The server logs only generic failure codes. The database connection verifies TLS when `DATABASE_SSL=true`; install your provider's trusted CA chain if necessary. Do not disable certificate verification.
7. From `/staff`, authorize the remaining real staff accounts. Configure independent restricted reviewers, approved university offices, and category routing/service targets. At least **two independent reviewers** are needed if the first assigned reviewer may be involved in a later further-review request. Restricted submissions fail safely if no independent authorized reviewer is available. An optional student-facing staff selector uses separate random public IDs and excludes a named handler from case access automatically. Staff display names therefore appear in that selector; use approved professional display names.
8. Set only university-approved `EMERGENCY_GUIDANCE` and `RESPONSE_GUIDANCE`. Blank values produce no invented contact information or response promises. `RETENTION_DAYS` records policy guidance; it **does not delete reports**. Establish an approved review/export/deletion process and encrypted backup retention before collecting real data. There is deliberately no automatic report deletion job.
9. Verify live Supabase credentials and permissions with authorized test accounts before launch. The local tests substitute only the external identity-provider boundary; they exercise the real application HTTP handlers and real PostgreSQL schema/RLS in PGlite. They are not a production penetration test or security certification.

For local development only: use `APP_ORIGIN=http://127.0.0.1:3000`, `NODE_ENV=development`, a development database, then `npm run dev`. Production/non-loopback origins require HTTPS. Do not point browser QA at real private reports.

### Supplying the remaining connection safely

The local ignored `.env` can hold `DATABASE_URL`. Obtain the URI from the existing CSC Supabase project's Connect panel, using a connection/pooler mode supported by your server network. Enter the real password **in the local file or hosting secret manager**, never in chat or a committed file. Preserve URI encoding for special characters in passwords. Existing CSC publishable settings can be reused; a service-role API key is not needed by this application.

Run `npm run preflight` to check required settings without printing their values. After applying the migration and provisioning staff, run `npm run preflight -- --database` to verify connectivity, TLS, runtime-role access and the administrator profile. Configure the hosting health check to `/ready`: it returns 200 only when the database/schema is reachable and an enabled D.I.N.I.G. administrator exists. `/health` checks only whether the Node process is alive.

To complete deployment, the operator must provide access to a Node/Docker hosting service, configure the database connection in that service's secret manager, and identify the existing Supabase account email/UUID to authorize as the first administrator. The public GitHub Pages URL can remain an entry link that redirects to the actual server once its HTTPS origin is known.

## Implemented flows

- `/`: public introduction, submit/track actions, privacy information, small staff access link.
- `/submit`: accessible server-validated form → review → transactional report/history creation → one-time private-code confirmation, copy, download. Duplicate nicknames are allowed. A random idempotency UUID blocks repeated submissions. If the final response is lost after commit, the private code cannot be replayed/recovered; the UI never silently creates another report on retry.
- `/track`: code submitted by POST → report-scoped session → status, timeline, original report, private downloads and conversation. Students can add corrections as messages, confirm resolution, leave feedback or request independent review. No report ID parameter can widen a student session's scope.
- `/staff`: existing Supabase credentials → separately authorized staff membership → queues/filter/search/pagination, report details, student replies, private notes, assignment, priority/category, approved-office referrals and follow-up, resolution and status history.
- Administrators authorize existing auth accounts, manage category routing and service targets, add approved offices, assign/reassign cases, and restrict sensitive/conflicted cases. A sensitive case requires explicit assignment and reviewer privileges, including for administrators. A handler can access only explicitly assigned ordinary reports and never conflicted reports. Notifications persist for assignments and further-review requests; staff see pending review items in their queue. No full report is automatically emailed or forwarded.

## Security boundaries and operational limits

- Tracking secrets use 24 cryptographically random bytes (192 bits); only SHA-256 hashes are stored. References use a separate random human-readable identifier. Neither a reference nor a nickname authenticates anyone.
- Session secrets are also random and stored only as hashes. Production cookies are `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`. Sessions expire after 30 minutes of inactivity and at 8 hours absolutely. Staff membership is checked on every authenticated request, so disabling a staff profile stops existing sessions. Provider-side revocation alone is not an immediate D.I.N.I.G. session revocation; also disable the D.I.N.I.G. profile or remove its sessions.
- All mutations require an exact Origin match and a cookie-bound CSRF token. Tokens remain in memory; no tracking codes or auth tokens enter localStorage, URLs or analytics. There are no analytics or third-party runtime assets.
- Database row policies enforce report scope and exclude internal notes/history from student principals. Anonymous and Supabase client roles receive no schema grants. Application checks additionally enforce workflow, roles, conflicts and assignment rules. Pool settings are transaction-local to prevent cross-request principal leakage.
- Content is rendered as escaped text. Strict CSP disallows inline scripts, framing and external resources. Private API responses and downloads use `no-store`, `no-referrer` and `nosniff`.
- PNG/JPEG/PDF uploads are limited by count, individual/combined byte size, extension and file signature. Files are stored as private database bytes, returned only after the same report authorization check, and downloaded as opaque attachments. There is no public bucket, signed public URL, or content preview. File-signature validation is **not malware scanning**; add your university-approved scanning service and document its data handling before allowing untrusted documents in production. Do not forward sensitive attachments to third-party scanners without approval.
- Database-backed rate limits: 5 submissions/hour/IP; 10 tracking attempts/15 minutes/IP; 10 staff-login attempts/15 minutes/IP; 20 student messages/15 minutes/IP; 40 staff messages/15 minutes/IP, plus a general mutation ceiling. IP keys are HMAC-pseudonymized. Shared campus networks may require approved tuning. `TRUST_PROXY=true` is safe only if the reverse proxy overwrites `X-Forwarded-For` and the Node port is not publicly reachable.
- Schedule infrastructure housekeeping through trusted operations, for example deleting expired session/rate-limit rows and old submission-key records. Keep report retention separate; never silently delete concern data.
- Database/host operators retain privileged access by design. This service provides private, scoped access, not a promise of perfect anonymity or immunity from compromise.

## Checks

```text
npm run check
npm test
```

`check` verifies JavaScript syntax and local asset paths. Integration tests cover duplicate nicknames, one-way code storage, duplicate submissions, reference/ID tampering, scoped sessions, internal-note isolation, restricted access, authorized downloads, assignment, complete resolution/further-review flow, conflict reassignment, CSRF, upload validation, rate limits, session expiry, configuration permissions and audit records. Browser QA is described in `test/README.md`.

## Main files

- `public/index.html`, `app.js`, `styles.css`: mobile/desktop student and staff interfaces.
- `public/csc-header.css`, `assets/`: reused CSC branding and locally served font.
- `server/app.js`, `reports.js`: authenticated HTTP endpoints and report workflows.
- `server/security.js`, `database.js`, `config.js`: validation, cookies, CSRF, sessions, private database transactions/configuration.
- `migrations/001_dinig.sql`: all entities, relationships, indexes, grants and row policies.
- `test/application.test.js`: isolated integration verification; provider adapter is test-only.

No production credentials or private student/staff data belong in this repository.
