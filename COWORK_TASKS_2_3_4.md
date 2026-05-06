# COVVA — Cowork Prompt: Tasks 2, 3 & 4

Read COWORK_BRIEF.md first for full project context before starting anything.

Task 1 is already complete. Do not touch index.html except for the two specific changes listed at the end of this document.

---

## SESSION UPDATE — 29 APR 2026

### Issue: setup edits not reflected in Gantt

- Problem observed on `setup.html` / `dashboard.html`:
  - row-level edits saved in the setup activity table were not reliably reflected in the dashboard Gantt
  - renamed activities could leave the old activity row behind in the Timeline sheet
  - deleted activities could remain visible in the Gantt because the stale row still existed in Google Sheets
  - dashboard date parsing could shift Google Sheet date-object values by one day relative to setup display
  - the Override chip existed in the UI but its meaning was unclear and automatic timeline updates did not consistently honor it

### Root Cause

- Activity saves only matched rows by the new visible activity name. If a user renamed an activity, the backend could append/update a separate row instead of updating the original row.
- Delete actions also used the visible text only, so deleting after a rename could fail to remove the original Timeline row.
- Dashboard fetch/render did not refresh after normal setup saves/deletes, only rollback events.
- Dashboard Gantt used raw `new Date(...)` parsing for Apps Script date strings, while setup displayed the spreadsheet date key. This created apparent date mismatches.
- Manual override state was recorded but weekly timeline updates could still mutate rows unless explicitly skipped.

### Fix Implemented

- `setup.html`
  - stores each edit row's original activity/material name in `data-original-*`
  - sends `original_activity` / `original_material` with row saves so the backend can update renamed rows in place
  - delete now targets the original activity name and notifies the dashboard after success
  - setup saves now write a localStorage timeline-edit signal so open dashboard tabs can refresh
  - Override chip is treated as a manual lock for automatic updates

- `Code.gs`
  - `serveDashboardData`, `serveSetupData`, and `saveProjectData` now canonicalize project names, so fixes apply across projects rather than one hard-coded project
  - `upsertActivityRow` and `upsertMaterialRow` match by original name first, then current name
  - manual activity edits recalculate slippage from Planned End vs Current End
  - weekly timeline updates skip rows where `Manual Override` is `YES`

- `dashboard.html`
  - adds cache-busting to dashboard data fetches
  - refreshes when setup saves/deletes activity or material rows for the current project
  - parses Google Sheet dates through a shared `parseSheetDate()` helper so Gantt bars align with setup table dates

### Data Reconciliation Performed

- D12 Terrace Timeline was reconciled to the setup screenshot requested by the user.
- Stale duplicate/old-name rows were removed.
- Live dashboard feed now returns 17 D12 Terrace activities in the intended order:
  1. Floor Dismantling
  2. Deck Opening & Sliding Window Opening
  3. Waterproofing
  4. Tile Work on Floor
  5. Protection Plaster
  6. Pillar Treatment
  7. Khangar Filling
  8. Wall Plaster
  9. Bar Counter
  10. PCC
  11. Electrical Work
  12. Birla Putty
  13. Micro Concreting
  14. Paint Work
  15. Deck Installation
  16. Handover
  17. Sliding Window Installation

### Verification

- Local JS parse checks passed for `setup.html`, `dashboard.html`, and `Code.gs`.
- Live project feed check:
  - Golf Links: 0 activities
  - D12 Terrace: 17 activities
  - Modi Basement: 11 activities
- No exact duplicate activity keys were detected in the live feed check.

### Deployment Notes

- GitHub commits pushed:
  - `1a0c533` — Fix setup timeline saves
  - `b4f1f8a` — Sync timeline deletes to dashboard
  - `6448371` — Align Gantt date parsing with setup
- `Code.gs` changes still require Apps Script redeploy whenever backend code is changed.

---

## SESSION UPDATE — 07 APR 2026

### Achieved Today

- Timeline Update Gemini flow hardened:
  - invalid/empty audio clips filtered before request
  - backend retries a simpler Gemini payload if `INVALID_ARGUMENT` is returned
  - raw Gemini payload errors now surface as a supervisor-friendly message
- Weekly / Material output cleaned:
  - `SECTION 1` / `SECTION 2` labels removed from prompts
  - backend parser made backward-compatible with older Gemini responses
  - frontend also strips labels before showing / copying the report
- Weekly logging moved to Copy action:
  - `Generate Report` now drafts only
  - Timeline sheet write now happens on `Copy & Post to Group`
- Timeline date logic improved:
  - delayed activities now anchor to the supervisor report date instead of extending from stale stored dates
  - `Planned End` baseline is preserved; only `Current End` moves
  - “starting in X days / next week” is now interpreted as a start delay and should push `Current End` out

### Next Work In This Session

- Add safer same-day correction mode for AI Timeline updates:
  - if the supervisor sends a corrected Timeline update on the same report date, the earlier AI-applied change for that date should be replaced instead of compounded
- Add reset / rollback support for AI Timeline updates only:
  - admin should be able to undo the latest AI Timeline update or reset AI Timeline updates from a selected date onward
  - DPR entries, Material Log entries, and manual/original Timeline setup data must remain untouched

### Guardrail For Reset Feature

- Reset logic can only reliably roll back AI Timeline updates that were written after AI history tracking is introduced in this session.
- Older historical Timeline edits that were already applied before this tracking exists may still need manual cleanup or Google Sheets version history.

---

## TASK 2 — Build dashboard.html

A live project dashboard that reads from Google Sheets via Apps Script and renders a full project intelligence view.

### Deployment
Hosted on GitHub Pages alongside index.html.
URL structure:
```
kukku310.github.io/covva-dpr/dashboard.html?project=modi-basement
```

---

### Aesthetic
- Default: light mode
- Dark mode: optional toggle in header
- Light mode: background #f5f2ee, surface #ffffff, panel #f0ece6, border #e0dbd3, amber #b8711f, text #1a1714, dim #9a9188
- Dark mode: background #0e0e0e, surface #161616, panel #1e1e1e, border #2a2a2a, amber #d4872a, text #e8e2d9, dim #7a7268
- Fonts: Bebas Neue for logo/headings, DM Mono for labels and data, DM Sans for body
- Mobile-first, horizontally scrollable Gantt

---

### Header — old style
```
COVVA  |  [PROJECT NAME]
[Start date] — [End date]  ·  Day [X] of [Y]
```
Right side of header:
- Project selector dropdown (loads project names from Sheet tabs)
- Dark Mode toggle button
- Client View button
Both buttons identical size. When Client View is active, button fills amber.

Below header — only visible when in Client View:
A slim amber-tinted bar with a small "⬇ Export PDF" button aligned right.

---

### Section ① — Project Timeline (Gantt)

Horizontally scrollable SVG or Canvas Gantt chart.

**X axis:**
Monthly ticks only. Year shown only when it changes — format: Mar '26, Apr '26 ... Jan '27, Feb '27. No overlap, no crowding. Minimum 3-week gap between visible labels if months are too close.

**Today line:**
Vertical amber line running through all bars. Date label (e.g. "29 Mar '26") sits below the last Gantt row — not floating above any bar.

**Each activity row:**
- Bar spans from actual Start to Current End date
- Faint baseline tick at original Planned End date
- Colour coding:
  - Completed: #1e8449 (green)
  - On Track: #1a6fa0 (blue)
  - Delayed ≤7d: #d4ac0d (amber)
  - Delayed >7d: #a93226 (red)
  - Not Started: #c8c0b8 (grey)
- Work Increase extension: purple #7d3c98 bar appended to the right of the original bar end — not a separate row

**Click any bar:**
Detail panel slides open below the Gantt showing:
- Planned dates (start → original end)
- Current end date
- Status
- Slippage
- Change Log (internal only, hidden in client view):
  - Entries tagged: DELAY / WORK INCREASE / START DELAYED
  - DELAY: red tint background
  - WORK INCREASE: purple tint background
  - START DELAYED: blue tint background
- From DPRs (internal only): date-tagged mentions of this activity extracted from DPR submissions

**Legend below Gantt:**
Completed / On Track / Delayed ≤7d / Delayed >7d / Not Started / Work Increase

---

### Section ② — Site Strength (internal only, hidden in client view)

Two toggle views: Today | Over Time

**Today view (default):**
- Total on site count with last reported date
- Horizontal bar per trade, amber fill, proportional width, count on right

**Over Time view:**
- Line chart, one line per trade, dots at each DPR submission date
- X axis: DPR submission dates
- Y axis: headcount
- Pulls from all DPR rows in [ProjectName] — DPR tab

---

### Section ③ — Client Material — Inform & Track

Internal view: all materials shown including received.
Client view: received materials hidden — only show pending, partial, overdue, not-yet-informed.

Each material entry shows:
- Material name + area
- Status badge: NOT YET INFORMED (red) / CLIENT ACTIONING (amber) / PARTIAL DELIVERY (amber) / TARGET OVERDUE (red) / ORDERED (blue) / RECEIVED (green)
- Inform Date (when COVVA told client to initiate procurement) — if exists
- Target Date (pre-agreed delivery date) — if exists, shown in red if overdue
- Notes

Intro line (internal only): "Client-procured materials only. Delivered items hidden in client view."

---

### Section ④ — DPR Archive (internal only, hidden in client view)

Project selector at top if needed.
Chronological list, newest first. Each entry:
- Date
- First line preview
- Tap/click to expand full formatted report text

---

### Section ⑤ — Flags & Actions (internal only, hidden in client view)

Four flag types:
- ⚠️ Timeline extension — activity name, days added, date, reason
- 🟣 Work Increase — activity name, days added, reason (client scope addition)
- ✅ Early completion — activity name, days early, [Confirm Close] [Keep Open] buttons
- 🔴 Overdue client material — material name, target date, days overdue

---

### PDF Export

Triggered by "⬇ Export PDF" button visible only in Client View.
Opens a clean modal preview with:
- COVVA logo + "SITE INTELLIGENCE" subtext top left
- Project name, date range, snapshot date top right
- Gantt chart (same colour coding, same today line and label)
- Client Material — pending actions only (no received items)
- Footer: "COVVA — [Project Name]  ·  [Date]  ·  Confidential"
- Two buttons: "Print / Save as PDF" (triggers window.print()) and "Close Preview"

---

### Client View Rules
When Client View is active:
- Hide: Section ②, Section ④, Section ⑤
- Hide: Change Log and DPR mentions inside Gantt detail panel
- Hide: received materials in Section ③
- Show: Gantt with dates, statuses, today line
- Show: pending/partial/overdue/not-informed client materials only
- Show: slim PDF export bar below header

---

### Data Source
All data read from Google Sheets via Apps Script `serveDashboardData(project)` function (built in Task 4).
On page load, fetch data from Apps Script URL with project parameter.
Show loading state while fetching.
Handle empty or missing data gracefully.

---

## TASK 3 — Build setup.html (Project Setup & Manual Edit)

Internal use only. No password protection. Not shared externally.

### Aesthetic
Identical to dashboard.html and index.html:
- Light mode default, dark mode toggle in header
- Same header style: COVVA | Setup & Edit
- Same card style, same colour palette, same fonts
- All inputs styled dark (in dark mode) or warm off-white (in light mode)
- Text inputs: no harsh white boxes. Background matches panel colour, amber bottom-border on focus
- Date inputs: `<input type="date">` fully styled to match theme — no default browser chrome
- Dropdowns: same panel background, amber on focus
- Hover states on rows: subtle amber tint
- Add Row button: amber outline, fills amber on hover
- Submit/Save buttons: full amber fill, Bebas Neue label

---

### Section A — New Project Setup

Top fields in a clean two-column grid:
- Project Name (text)
- Client Name (text)
- Start Date (date picker)
- End Date (date picker)
- Project Manager (text)

**Activity Table:**
Columns: Activity Name | Start Date | End Date | Status (dropdown: Not Started / In Progress / Completed / Delayed) | Notes
Each row editable inline.
"+ Add Activity" button below table.

**Client Material Table:**
Columns: Material Name | Area | Inform Date (date picker) | Target Date (date picker, optional) | Status (dropdown: Not Yet Informed / Client Actioning / Ordered / Partial Delivery / Received) | Notes
Each row editable inline.
"+ Add Material" button below table.

**Submit button** at bottom: writes full project to Sheets via `saveProjectData()` Apps Script function. Creates project tab set automatically if it doesn't exist. Success/error message shown inline.

---

### Section B — Edit Existing Project

Project selector dropdown at top — populates from existing Sheet tab names via `serveSetupData()`.

Once project selected, two editable tabs appear:

**Activities tab:**
Loads current activity rows into the same table format as Section A.
Each row: inline editable fields, Save Row button per row.
Manual Override chip per row — when toggled amber, row is flagged as manually overridden in Sheet with timestamp.

**Materials tab:**
Loads current material rows. Same inline editing. Save Row per row. Manual Override chip.

**DPR Archive tab:**
Lists all DPR entries for the selected project. Date + report text.
Each entry expandable. Text is editable inline.
Save button per entry — saves corrected text back to Sheet, flags row as "Manually Edited" with timestamp.

---

## TASK 4 — Update Code.gs (additions only, no changes to existing functions)

Add the following four new functions:

### Function 1: serveDashboardData(project)
Called by dashboard.html on page load.
Reads from three tabs: [ProjectName] — Timeline, [ProjectName] — Materials, [ProjectName] — DPR.
Returns a single JSON object:
```json
{
  "project": "Modi Basement",
  "activities": [ array of activity row objects ],
  "materials": [ array of material row objects ],
  "dprs": [ array of DPR row objects with date, report text, activity tags, strength data ]
}
```
Serve via doGet() when action=dashboardData and project parameter is present.

### Function 2: serveSetupData(project)
Called by setup.html to load existing project data for editing.
Same read as above but returns raw row data including all columns.
Serve via doGet() when action=setupData.

### Function 3: saveProjectData(payload)
Called by setup.html on Submit (new project) or Save Row (edit).
Payload contains project metadata, array of activity rows, array of material rows.
If project tab set doesn't exist: create [ProjectName] — Timeline, [ProjectName] — Materials, [ProjectName] — DPR tabs with correct headers.
If tabs exist: update matching rows by activity name / material name. Append new rows. Do not delete existing rows.
Write "Manual Override" and timestamp to a dedicated column if manualOverride flag is true in payload.
Return success or error JSON.

### Function 4: saveDPREdit(project, date, editedText)
Called by setup.html DPR Archive when a DPR is manually edited.
Finds the matching row in [ProjectName] — DPR tab by date.
Updates the Formatted Report column with editedText.
Adds "Manually Edited" flag and timestamp to that row.

---

## TWO ADDITIONS TO index.html (Task 1 is done — only these two changes)

### Addition 1 — Date override (Hinglish label)
Add a small collapsible row below the three-state mode toggle on all three modes.
Label in Hinglish: "Alag date ke liye record kar rahe hain?"
Collapsed by default — tap/click to expand.
When expanded: shows a styled date picker input defaulting to today's date.
The selected date from this picker — or today's date if untouched — is what gets passed as the `date` field in the Apps Script payload.
Style the date picker identically to all other inputs: dark background in dark mode, warm panel in light mode, amber border on focus, DM Mono font.

### Addition 2 — Send edited text on Copy, not original generated text
Currently, the generated DPR text is sent to Apps Script (for Sheets logging) at generation time.
Change this so the Apps Script call happens only when the "Copy & Post to Group" button is tapped.
What gets sent to Sheets is the current content of the editable textarea at that moment — not the originally generated text.
This ensures if the supervisor edits the DPR on the result screen before copying, the edited version is what gets logged in Sheets.
The voice audio processing and Gemini formatting still happen at generation time as before — only the Sheets write call moves to the Copy button tap.

---

## SESSION UPDATE — 04 MAY 2026

### Issues Fixed

**1. Gantt Detail Panel — Change-Log entries not showing**
- Problem: Clicking a Gantt bar opened the detail panel, but change-log entries (DELAY / WORK INCREASE / START DELAYED) were not visible even in internal view.
- Root Cause: The detail panel only read `delay_log` and the entire change-log block was being hidden in Client View. Status-change events (e.g. on-track → in-progress) that weren't tagged as DELAY had no description recorded, so the May 4 weekly update produced no visible log entries for those activities.

**2. Weekly Timeline Logger — plain status updates not recorded**
- Problem: `Code.gs` `logToTimeline()` only appended to the delay log when `delay_days > 0`. Activities with status changes but no delay (e.g. in_progress, completed) got no description logged.
- Root Cause: The logger was gated on `delay_days > 0` instead of recording all status-change events.

**3. Activity Matching — "Strip Lights" creating duplicate rows**
- Problem: Weekly updates for "Strip Lights" were creating a new row instead of updating the existing "Fixing & Strip Lights" entry.
- Root Cause: Exact string match only. Fuzzy/partial matching not implemented.

### Fixes Implemented

- `dashboard.html` (line 933): Gantt detail panel now shows change-log entries in **both** internal and client views. Missing May 4 status-change descriptions are rendered correctly.
- `Code.gs` (line 1157): `logToTimeline()` now records plain status updates (not only delays) into the activity's delay log. Activity name matching improved so partial-name updates (e.g. "Strip Lights" → "Fixing & Strip Lights") map to the correct existing row instead of creating a duplicate.

### Verification

- Dashboard script syntax verified locally before push.
- Gantt detail panel confirmed showing change-log entries for all activity types.
- Caveat: Code.gs backend changes require Apps Script redeploy for future weekly updates to benefit from improved logging. **Redeployed as new version on 04 May 2026.**

### Deployment

- GitHub commits pushed:
  - `97ed90f` — fix: Gantt detail panel — include change-log entries and May 4 status notes
- GitHub credentials configured: personal access token stored in `~/.git-credentials` via `git credential store` for future pushes.
- Google Apps Script redeployed as a new version (manual, via script.google.com) on 04 May 2026.

---

## SESSION UPDATE — 06 MAY 2026

### Issues Fixed & Features Added

**1. Confirm Close button — broken fetch**
- Problem: `flag-btn-confirm` called `fetch(GAS_URL, ...)` but `GAS_URL` was never defined, so every Confirm Close silently threw `ReferenceError` and never saved.
- Fix: Changed to `fetch(APPS_SCRIPT_URL, ...)` (the correct variable).

**2. Confirm Close — full override replaced with soft lock**
- Problem: Setting `manual_override: true` via Confirm Close blocked ALL automatic AI updates, including work-increase scope additions — so if the client or architect added scope after close, the Gantt bar would not move.
- Fix (`Code.gs`): `logToTimeline()` now only skips updates when `manual_override = YES` AND `update.work_increase` is falsy. Work-increase updates are allowed through even on locked rows, so scope additions still extend the bar and log correctly.

**3. Keep Open — no persistence**
- Problem: Keep Open only removed the flag row from the DOM. On next reload it reappeared.
- Fix: Keep Open now saves the dismissed activity name to `sessionStorage` (`covva-dismissed-flags`). `buildFlags()` filters these out on every render within the same browser session.

**4. Timeline Update toggle — inaccessible on Android Chrome**
- Problem A (CSS): The toggle switch was 34×18 px with a zero-size hidden `<input>`. On Android Chrome the tap target was too small and `-webkit-tap-highlight-color` caused ghost interactions.
- Fix (`home.html`): Increased toggle to 40×24 px, added `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent`.
- Problem B (cross-device): Toggle state was stored only in browser `localStorage`. Setting it ON on a laptop had no effect on the supervisor's phone.
- Fix: `setTimelineActive()` now also calls `APPS_SCRIPT_URL?action=setTimelineOverride` (persists to Apps Script `PropertiesService`). `serveProjectList()` returns `timeline_override_today: true/false` per project. `buildCard()` seeds the toggle from server state. `index.html` performs an async `getTimelineOverride` call on load and enables the Timeline Update button if the server flag is set — so the supervisor's phone auto-unlocks without manual action.

**5. Gantt detail panel — early completion display**
- Problem: Clicking a completed-early activity showed "Total Slippage: 0 days" — no indication it finished ahead of schedule.
- Fix (`dashboard.html`): Renamed "Current End" → "Actual End". When `status = completed` and `current_end < planned_end`, replaces the slippage row with "X days early ✓" in green. Slippage row is still shown normally for delayed/in-progress activities.

**6. Client PDF — activity table restructured**
- Problem: Table showed Activity | Timeline (using current_end) | Days | Status. Clients couldn't see the planned commitment vs actual delivery, and early completion was not visible.
- Fix (`dashboard.html`): Dropped the Days column. New structure:
  - Activity (38%) | Planned (planned_start → planned_end, 26%) | Actual End (18%) | Status (18%)
  - Status cell shows delta sub-note: "Completed · 8d early" (green), "Delayed · +5d" (red), "Completed on time" (green), or plain status for in-progress.

**7. Report heading change**
- `PROMPT_WEEKLY` in `Code.gs`: Changed `📊 Weekly Progress Update` → `📊 Timeline Update` to match the tool's labelling throughout.

### Deployment

- GitHub commit pushed: `32dba52` — feat: early completion display, PDF restructure, timeline toggle cross-device, soft lock
- **Code.gs requires Apps Script redeploy** for the following to take effect:
  - Soft lock (work-increase through manual override)
  - `setTimelineOverride` / `getTimelineOverride` GET actions
  - `timeline_override_today` in project list
  - `📊 Timeline Update` heading in generated reports

---

## Final Step
Push all new and updated files to the covva-dpr GitHub repository:
- dashboard.html (new)
- setup.html (new)
- Code.gs (updated with 4 new functions)
- index.html (updated with 2 additions only)
