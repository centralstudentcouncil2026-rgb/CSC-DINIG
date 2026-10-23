# Local browser QA

Run `node test/browser.mjs` with Playwright and its Chromium installed in your tooling environment. If Playwright is supplied by an external tools runtime, set `PLAYWRIGHT_MODULE` to its absolute module directory and optionally `CHROMIUM_EXECUTABLE` to that runtime's browser executable. No browser tooling is included in production dependencies.

The script creates a disposable PostgreSQL database through PGlite, runs the actual migration and server, and substitutes the external identity provider with a test-only adapter. `qa@example.invalid` exists only inside this isolated test script; it is not a production credential or an application authentication fallback.

It verifies the real UI at 1366×768, 1280×600, 768×1024, 390×844 and 375×667: submission, review, confirmation, code-based tracking, reload persistence, student replies, staff authentication, private notes, no horizontal clipping, no script execution from report text, and no page errors/missing assets. Screenshots are generated in ignored `test-results/`. No live student records are used.
