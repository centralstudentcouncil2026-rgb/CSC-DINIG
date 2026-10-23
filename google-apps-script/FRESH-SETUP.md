# Fresh D.I.N.I.G. database — one administrator

This is a NEW installation. It does not delete or migrate the old database. The public website stays on the old backend until its endpoint is changed. Old tracking codes will not authenticate against the new empty database.

1. Create a NEW Google Sheet under the intended CSC owner account. Keep sharing Restricted.
2. Open that Sheet > Extensions > Apps Script.
3. Replace all contents of Code.gs with google-apps-script/FreshStart.gs. This is the full backend. Do not paste it alongside the old Code.gs. Do not add Crypto.gs or any third-party library.
4. Services > + > Google Sheets API > v4 > Add (identifier Sheets). Use the project’s default Google Cloud project, or enable Sheets API in your custom Cloud project.
5. Project Settings > Script properties: add ADMIN_PASSWORD with a new, private D.I.N.I.G. password of at least 12 characters. Do not send it in chat. Leave SPREADSHEET_ID, FAST_ADMIN_RECORD and TOKEN_SECRET unset in this new project. Setup supplies them.
6. Save, select setup, and Run. Review and complete Google authorization yourself. Setup initializes the bound Sheet, seeds aupcscdinig@aup.edu.ph, deletes the initial plaintext password property and prepares the cached admin verifier. The log should say Setup complete.
7. Deploy > New deployment > Web app. Execute as Me; Who has access Anyone. Keep the Sheet Restricted. Deploy.
8. Open the /exec URL with ?action=health appended. It should return configured:true, backendVersion:dinig-fresh-single-admin-v2 and fastAdminReady:true.
9. Send only the public URL ending /exec to Codex. Codex will switch public/backend-config.js, rebuild, test and push the frontend. Do not send your password or private server properties.

Administrator email: aupcscdinig@aup.edu.ph. This is an application account, not Google sign-in. No public registration or additional staff creation is enabled. Login uses built-in HMAC-SHA256, Script properties and cached sessions with no Sheet access during credential verification. Reports load after the admin workspace appears. Tokens remain memory-only in the browser. Cache eviction can end sessions early; idle timeout remains 30 minutes.

For a later password reset: set a new ADMIN_PASSWORD property and run resetAdminPassword. It refreshes the verifier and revokes old sessions. Never rerun setup expecting it to erase report data.

File attachments are removed in v2. No Drive folder or Drive OAuth scope is required. The advanced Sheets service is still required for atomic concern/message writes. Existing private files are not deleted automatically. For an already configured v1 project, replace Code.gs with FreshStart.gs and deploy a new version; keep the existing properties and URL. You do not need to rerun setup.
