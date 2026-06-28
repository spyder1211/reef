# Release Notes

[English](RELEASE_NOTES.md) · [日本語](RELEASE_NOTES.ja.md)

## v1.0.1 (2026-06-28) — UX papercuts: DML feedback, NULL insertion, keyboard editing, and connection guard

A focused patch that addresses four small but frequently-noticed friction points in everyday use.

### DML/DDL results now show affected-row count (U5)
- UPDATE, INSERT, DELETE, and DDL statements now display "✓ N rows affected" in the result pane and status bar, instead of the misleading "no results (0 rows)" that appeared before.

### NULL button in the INSERT row editor (U8)
- When adding a new row, each cell in the editor now has a **NULL** button, making it possible to set an explicit `NULL` (distinct from an empty string or DB default) before committing the INSERT.

### Enter to edit + read-only banner for tables without a primary key (U9)
- Pressing **Enter** on a selected row now starts editing its first editable column, consistent with how most grid-based apps behave.
- Tables without a primary key now show a read-only banner explaining why cell editing is disabled, rather than silently ignoring edit attempts.

### Connection double-fire guard
- The Connect button and double-click are disabled while a connection is already in progress, preventing a second simultaneous connection attempt from being triggered accidentally.

---

## v1.0.0 (2026-06-24) — The Reef debut: open source, internationalization, and overlay accessibility

This is the first release under the new name **Reef** (formerly Table++), and the project's debut as **open source**. Alongside the rename it bundles the long-deferred follow-up batch — UI internationalization, tab keyboard shortcuts, and accessibility for modals and context menus — plus a development foundation (Biome) and behavior-preserving internal cleanups.

### Renamed to Reef, now open source (#48, #49, #50)
- The app and project were renamed **Table++ → Reef**, the README and notes were translated to English, the source was released under the **MIT license**, and the repository was made **public** on GitHub. The app icon was refreshed to the Reef brand and repository URLs were updated. (`docs/superpowers` working notes are excluded from the published tree.)

### Internationalization — English / Japanese (#51)
- The entire UI is now **internationalized (English / Japanese)**. It uses a lightweight custom catalog (`src/shared/i18n`, with **zero new dependencies**); the default is English, the system locale is auto-detected on first launch, and you can switch languages from a settings modal. Both the renderer and the native menus follow the selection.

### Tab keyboard shortcuts (#53)
- Workspace tabs can now be driven from the keyboard: **⌘T** opens a new SQL tab, **⌘W** closes the active tab (falling back to closing the window when no tab remains), **⌘1–8** jump to the Nth tab and **⌘9** to the last, and **⌘⇧] / ⌘⇧[** cycle to the next / previous tab. New Tab and Close Tab also appear in the menu bar.

### Accessibility for modals & context menus (#55)
- Modals and right-click menus were rebuilt on shared, accessible components. Modals now have **dialog semantics** (`role="dialog"` / `aria-modal`), **Escape to close**, a **focus trap** (Tab / Shift+Tab cycle within the dialog), initial focus, and **focus restoration** to the trigger on close (the import dialog stays open while a restore is running).
- Context menus now **clamp and flip at the screen edges** (no more clipping in a bottom or right corner) and support **keyboard navigation** (↑/↓ to move, Enter to activate, Esc to close), with proper `menu` / `menuitem` roles and event isolation so menu keystrokes don't leak to the grid behind them.

### Development foundation: Biome (#52)
- **Biome** was introduced for linting and formatting, and a **lint job was added to CI**, so style issues and a class of bugs are caught automatically on every push and pull request.

### Internal cleanups (#54)
- Low-risk debt cleanups that don't change behavior: the renderer's `window.api` type is now sourced from the preload's single `Api` definition; the table view's staging reset (across seven call sites) was consolidated into one helper; and the identifier-escaping `quoteIdent` was unified into one shared module.

### Coming next (v0.5 and beyond)
- Foreign-key jump / additional export formats / a settings screen / type-aware cell editing / code signing & notarization, and more

---

## v0.4.0 (2026-06-20) — Query cancellation × large data × dev foundation

Following the "foundation for using power safely" laid in v0.3.0, v0.4 focuses on **the ergonomics of handling heavy, large queries safely and comfortably** and **a development foundation that rejects broken changes**. It doesn't freeze when you touch large data, you can stop a query at any time, and you won't accidentally pour a huge result set into the app — a batch that reduces the friction of a workflow that peeks at production daily.

### Cancel long-running queries (#44)
- You can now interrupt a heavy query mid-flight with a **Stop button** next to the "Running…" indicator in the result area. It applies to both SQL tabs (multi-statement execution) and table browsing.
- The mechanism is **`KILL QUERY` over a dedicated connection**: the executing connection's `threadId` is captured, and a separate connection kills that thread. The server-side interruption (`ER_QUERY_INTERRUPTED`) **stops quietly** without an error, and in-progress staged edits are preserved.
- Internal queries (row count, `EXPLAIN`, DDL, CSV fetch) are not cancellable. Known limitation: when the connection pool is exhausted, a connection for the kill may not be available.

### Auto `LIMIT` + result-cap guard for SQL tabs (#45)
- Until now, SQL tabs ran your SQL **as-is, without any `LIMIT`**, so `SELECT * FROM huge_table` risked loading every row and freezing the app. Only table browsing (auto `LIMIT 100` + pagination) was protected; SQL tabs were exposed.
- A **layered defense** was introduced: a single bare `SELECT` (a leading `SELECT` / `WITH … SELECT` with no top-level `LIMIT`) gets an **automatic `LIMIT 500`** (first line of defense). As a last resort for cases that bypass the auto `LIMIT`, the result is **capped at 10,000 rows**.
- When the auto `LIMIT` is applied, a "showing the first 500 rows" banner and a **"Re-run without auto LIMIT" button** are shown. When the 10,000-row cap kicks in, it's stated explicitly and you're directed to CSV export for the full result. The query history stores the **original SQL**.
- The auto `LIMIT` only targets bare `SELECT`s (it is not added to `SHOW`/`DESCRIBE`/DML/DDL or queries with an explicit `LIMIT`). The table-browsing and CSV-export (full fetch) paths are **unchanged**.

### Virtualized result grid (#46)
- The result grid used to **render every visible row into the DOM**, so at the 10,000-row cap, rendering, scrolling, and selection became sluggish. **Row virtualization** (`@tanstack/react-virtual`) was introduced to **render only the visible window of rows plus a small overscan**. The DOM node count stays constant regardless of row count, so large data scrolls smoothly.
- Column widths are **measured from content and fixed** (by measuring the character width of the header and a leading sample of rows), so widths don't jitter on scroll and stay aligned with the header. Cells wider than the fixed width are truncated with an ellipsis (…); the full value is available via double-click editing or copy.
- Existing interactions — row selection, ⌘A, arrow-key navigation, cell editing, the right-click menu, quick filters, and row insert/delete — are all preserved. Table browsing and CSV export are unaffected.

### GitHub Actions CI (#43)
- Set up CI that runs **typecheck → test → build** as three parallel jobs on `push`/PR. The **MySQL integration tests**, which previously ran only locally, now **run continuously on a CI service (`mysql:8.0`)**, rejecting broken changes early.

### Coming next (candidate batch)
- Lint/format with Biome / tab-switching shortcuts / accessibility improvements for modals and context menus / foreign-key jump, more export formats, a settings screen, and more

---

## v0.3.0 (2026-06-14) — Hardening for production safety

As the release right after v0.2.0 added "strong powers" (production connections, SSH, dump import/export), this one solidifies **the foundation for using that power safely**. The first installment concentrates on safety (Tier 1), rebuilding things into a layered defense that does not trust the renderer (the UI side).

### Enforce the production guard in the main process (#39)
- The production guard previously existed only on the UI side, so destructive execution in SQL tabs, `DROP`/`TRUNCATE`, dump import/export, and edit commits could **bypass confirmation even against production** (import in particular launches from the native menu, so it physically never passes the UI-side confirmation). This release moves the guard into the main process to **enforce confirmation at every write/destructive boundary**.
- SQL is automatically classified as read-only / write / catastrophic. On a production connection, ordinary writes (`INSERT`/`UPDATE`/`DELETE`/`ALTER`, etc.) show an OK/Cancel confirmation, while **catastrophic operations (`DROP`/`TRUNCATE`, dump import/restore, dump export) show a red confirmation dialog requiring an "I understand this is production" checkbox**.
- Read-only statements (`SELECT`/`SHOW`/`EXPLAIN`, etc.) require no confirmation, as before. No extra confirmation appears for non-production (staging/development/local).
- Classification was tightened so the guard can't be bypassed via DML that starts with `WITH` (CTE) or a **destructive statement prefixed with a comment** (`-- delete\nDROP TABLE ...`).
- Canceling a confirmation aborts quietly without showing an error and preserves in-progress staged edits.

### Credential & file hardening (#40)
- Connection info (`connections.json`) and query history (`query-history.json`) are saved as **owner read/write only (`0o600`)**. Writes are atomic via a temp file, and files left with loose permissions by older versions are **re-tightened automatically on app startup**.
- In environments where macOS `safeStorage` can't encrypt (e.g. Linux without a keyring), credentials are **never written to disk in plaintext**, with a note to that effect on the connection form. A bug where an existing encrypted password could be overwritten with an empty string (erasing it) when encryption was unavailable was also fixed.

### Electron security hardening (#41)
- A strict **Content-Security-Policy** is applied to production builds (`script-src 'self'`, `object-src`/`frame-src 'none'`, and more). It is applied twice — via an HTTP header and a `<meta>` tag — to take effect reliably even under `file://` loading. It is not applied in development to keep HMR working.
- The renderer runs with **`sandbox: true`**, making it harder for a compromise on the UI side to escalate to main-process privileges (`contextIsolation: true` / `nodeIntegration: false` are kept).
- Navigation away from the app and new-window creation are forbidden; external links (http/https) are locked down to open in the default browser.

### Coming next (the v0.3 follow-up batch)
- Cancel long-running queries / row virtualization + auto `LIMIT` for SQL tabs / CI & Lint setup / accessibility improvements for modals and context menus, and more

---

## v0.2.0 (2026-06-12) — Developer feature enhancements

A batch of features supporting a web engineer's daily work (checking schemas, investigating queries, connecting to production).

### Schema & SQL-editor enhancements
- Added a "Data / Structure" toggle to table tabs. The structure view shows columns (type, nullability, key, default, Extra, comment), indexes, and the `SHOW CREATE TABLE` DDL (#24)
- Table-name and column-name completion in the SQL editor (the connected DB's structure is fetched from `information_schema`) (#25)
- Query history. Executed SQL is persisted, and you can search and reuse it from the SQL tab's history panel (up to 500 entries) (#26)
- `Cmd+E` runs `EXPLAIN` (single statement). The execution plan is shown in the result grid (#27)

### Connection enhancements
- SSH tunnel connections. Connect to staging/production MySQL via a bastion. Both password auth and private-key auth (with passphrase) are supported, and SSH secrets are also stored encrypted with `safeStorage` (#31)
- A connection guard for production (`production` tag). A confirmation dialog appears on every connect (cancel aborts the connection), and while connected a red "PRODUCTION" warning bar is always shown at the top of the workspace to deter mistakes (#35)

### UI enhancements
- Dark mode. Follows the macOS system appearance (light/dark) automatically. The CodeMirror editor follows in real time too (#30)
- A toggle in the detail pane to pretty-print JSON columns / JSON strings (#29)
- SQL-tab results can now also be exported to CSV (previously table tabs only) (#28)
- Added "Copy table name" to the table list's right-click menu (#33)

### Planned for v0.3.0 and beyond (out of scope for this release)
- PostgreSQL support / ER diagrams & foreign-key jump / customizable keyboard shortcuts / auto-reconnect / manual dark-mode toggle / SSL support

---

## v0.1.0 (2026-06-11) — Initial release

The first release of **Reef**. A tab-unlimited MySQL client (macOS desktop app), built with Electron + React + TypeScript.

### Connection management
- Saved connection profiles (passwords encrypted with Electron `safeStorage` and stored in `userData`)
- Two-level grouping (user-created groups × subgroups auto-derived from the environment tag `production` / `staging` / `development` / `local`), with drag-and-drop move and reorder (#17)
- Right-click menu on a connection row (duplicate / edit / delete); duplicate copies the encrypted password, tags, and group assignment (#20)
- Window maximizes on connect (#21)
- Closing the window while connected returns to the connection list (prevents accidental quit) (#9)

### Table browsing
- Table list with name-based search jump (#12)
- Record sorting, paging, and total-count display (#2)
- A filter bar, plus quick filters from a column's right-click menu (`=` `<>` `<` `>` `contains` `in` `between` `is null`, and more) (#1, #13)
- Side-by-side split view of records (the same table shown left and right, with independent scroll positions only; the center divider is drag-resizable) (#21)
- Row detail pane (view/edit in the right pane) (#5)
- Add-row / split / detail-toggle consolidated as icons in the on-grid toolbar (#21)

### Table editing
- Cell editing (`UPDATE`) (#3)
- Row insert (`INSERT`) / row delete (`DELETE`) (#6)
- Multi-row selection + right-click for bulk delete / duplicate / copy (#18)
- `TRUNCATE` / `DROP` from the table list's right-click menu (#15)

### SQL editor
- CodeMirror-based SQL editor (syntax highlighting)
- Run with `Cmd+Enter`; multiple statements (semicolon-separated) run sequentially (#20)

### Import / export (File menu)
- Export results to CSV (#7)
- Export SQL dumps (streaming, with progress) (#8)
- Import / restore SQL dumps. Supports `.sql` and gzip-compressed `.sql.gz`, disables foreign-key checks during import, and shows progress and a result summary (#14, #16)

### Application / distribution
- Unified the app name as **Reef** and added a dedicated app icon
- Packaging as `.app` / `.dmg` for macOS (Apple Silicon / arm64) (`npm run dist:mac`)
- Mitigated the Gatekeeper "damaged" error on unsigned distribution (ad-hoc re-signing of the whole bundle) — first launch requires right-click → "Open"
- Changed `Cmd+R` from a full reload to reloading the active tab (#19)

### Documentation
- Added a project README (#22)

### Tech stack
- Electron 31 / electron-vite / Vite 5 / React 18 / TypeScript 5 / zustand / @tanstack/react-table / CodeMirror / mysql2
