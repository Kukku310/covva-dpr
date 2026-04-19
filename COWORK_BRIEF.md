# COVVA Site Intelligence — Cowork Project Brief

## What This Project Is

A mobile web tool for COVVA — a high-end turnkey general contractor based in New Delhi. Site supervisors use this tool to record one or more Hinglish voice clips on their Android phones. The system synthesizes them into a clean English Progress Report, which the supervisor edits if needed, then copies and pastes into the client WhatsApp group. Simultaneously, the report is logged automatically into a central Google Sheet.

No apps. No logins. No typing. One URL, one or more voice clips, one tap to copy.

---

## Live Deployment

| Item | Value |
|---|---|
| GitHub Repo | `https://github.com/Kukku310/covva-dpr` |
| GitHub Pages URL | `https://kukku310.github.io/covva-dpr/` |
| Apps Script Deployment | `https://script.google.com/macros/s/AKfycbzcUokFn0MTGieOsC2a6r-HP883YPwBNLXPZB9MhBZaW4NI5cGF062K5k1AKT3feQWB/exec` |
| Google Sheet ID | `11Xi5K1v-m10PhxnZ5dYBKD4w91IITzFXT0EDsqvFJ7Q` |
| Gemini API Key | `[REDACTED — see Code.gs]` |

---

## The Stack

| Layer | Tool |
|---|---|
| Supervisor UI (DPR input) | `index.html` — hosted on GitHub Pages |
| Project Dashboard | `dashboard.html` — live project view for internal + client use |
| Project Setup | `setup.html` — new project creation + activity/material management |
| Backend (API calls + Sheets) | `Code.gs` — Google Apps Script |
| Voice → DPR | Gemini 2.0 Flash API (handles Hinglish audio natively) |
| Data logging | Google Sheets |

---

## Files in This Repository

### `index.html`
The supervisor's mobile interface. Updated with two additions:

**Date Override Row**
- A collapsible row between the mode toggle and the main mic panel
- Toggle label: "Date Override" — tapping reveals a date picker input
- `getReportDate()` returns picker ISO string if set, or `now.toISOString()` if not
- `form.append('date', getReportDate())` — date sent to backend on every generation
- CSS classes: `.date-override-wrap`, `.date-override-toggle`, `.date-override-panel`, `.date-override-input`
- JS functions: `toggleDateOverride()`, `getReportDate()`

**Edit-on-Copy (Deferred Logging)**
- Generation call now sends `noLog=true` — Gemini runs but Sheets write is skipped
- State vars `_lastMode` and `_lastDate` captured at generation time
- `copyDPR()` calls `logEditedDPR(text, _lastMode, _lastDate)` after clipboard write
- `logEditedDPR()` fires a fire-and-forget `fetch` with `action=logDPR` — logs the final edited text (not the raw AI output)
- Weekly/Material modes still log at generation time (they write to Timeline/Materials tabs, not DPR tab, so `noLog` flag only affects daily mode `logToDPR` call)

Core behaviour (unchanged):
- Three-mode toggle: Daily Report / Weekly Update / Material Log
- Records multiple audio clips via browser MediaRecorder API
- All clips sent together as `audioPayload` JSON array
- Editable report output box
- "Start Over" clears all clips and resets UI

---

### `dashboard.html`
Full project dashboard — live data from Google Sheets via Apps Script.

**Sections:**
1. **① Project Timeline** — Hybrid HTML+Canvas Gantt chart (see Gantt Architecture below)
2. **② Site Strength** (internal only) — today's headcount by trade + over-time line chart
3. **③ Client Materials** — procurement status tracker with overdue flags
4. **④ DPR Archive** (internal only) — expandable list of past DPRs
5. **⑤ Flags & Actions** (internal only) — delayed activities, work increases, overdue materials

**Header controls:**
- Project selector dropdown (populated from `?project=` param or `serveProjectList`)
- Dark/Light mode toggle (persisted via `localStorage`)
- Client View toggle — hides sections ②④⑤, shows PDF export bar

**Client View / PDF Export:**
- Client View hides all internal sections; shows PDF bar at top
- "Export PDF" button opens modal with Gantt + dates table + pending materials
- Modal: `window.print()` triggers browser PDF save
- `@media print { @page { margin: 0; } body { margin: 1.5cm; } }` — eliminates browser print headers/footers

**Data source:** `APPS_SCRIPT_URL?action=dashboardData&project=[name]`

---

### `dashboard_preview.html`
Standalone dummy-data preview of `dashboard.html` — not connected to Sheets. Used for design review only. Contains hardcoded dummy data for Modi Basement (11 activities, 18 workers across 5 trades, 5 materials, 3 DPRs). Purple banner at top marks it as preview mode. Lives in the workspace folder but is **not** pushed to GitHub.

---

### `setup.html`
Project setup and management interface.

**Section A — New Project:**
- Two-column grid: Project Name, Client Name, Start Date, End Date, Project Manager
- Activity table: add rows with activity name, planned start/end dates
- Material table: add rows with material name, area, target date
- Submit calls `saveProjectData` action on Apps Script

**Section B — Edit Existing:**
- Project selector populated from `serveProjectList`
- Three tabs: Activities / Materials / DPR Archive
- Each row: inline inputs + "Save Row" button + "Manual Override" chip
- DPR Archive tab: expandable entries, editable textarea, "Save Edit" calls `saveDPREdit`

**Design:** Panel backgrounds, amber bottom-border on focus, DM Mono font throughout — no harsh white input boxes.

---

### `Code.gs`
Google Apps Script backend. Updated with new routing and actions.

**`doGet` routing:**
- `action=dashboardData` → `serveDashboardData(project)`
- `action=setupData` → `serveSetupData(project)`
- `action=projectList` → `serveProjectList()`
- No `action` → serves `index.html` (legacy fallback)

**`doPost` actions:**
- `generateDPR` — existing; now respects `noLog=true` flag (skips `logToDPR` for daily mode)
- `logDPR` — new; fired by Copy button; logs edited text to DPR + MASTER tabs
- `saveProjectData` — new; creates tab set if missing; upserts activity or material rows
- `saveDPREdit` — new; finds row by date, updates col 3, adds "Manually Edited" flag + timestamp

**New helper functions:**
- `serveDashboardData(project)` — reads Timeline/Materials/DPR tabs, returns `{success, project, activities, materials, dprs}`
- `serveSetupData(project)` — reads raw rows with both original header keys and snake_case keys
- `serveProjectList()` — scans sheet tabs for names ending in "— DPR", extracts project names
- `saveProjectData(payload)` — creates tab set; `updateType='activity'` → `upsertActivityRow()`; `updateType='material'` → `upsertMaterialRow()`
- `saveDPREditFn(project, date, editedText)` — finds row by date, updates, flags as manually edited
- `readTab(ss, tabName, fieldNames)` — returns array of objects with named keys
- `readTabRaw(ss, tabName)` — returns array of objects with both original header keys and snake_case keys

**⚠️ Redeploy required:** Every change to `Code.gs` requires a new deployment version in Apps Script (Deploy → Manage Deployments → New Version). The deployment URL stays the same.

---

## Gantt Architecture — Hybrid HTML + Canvas

**Why hybrid:** Canvas text rendering never achieves visual parity with HTML text. Even with `document.fonts.ready` and correct `ctx.font` strings, canvas falls back to system fonts at paint time, making Gantt labels appear lighter/thinner than the rest of the page.

**The solution:** Labels are plain HTML `<div>` elements. Canvas draws only bars.

**Row structure:**
```html
<div class="g-row">
  <div class="g-label">Stone Flooring & Skirting</div>
  <canvas class="g-track" width="[chartW]" height="38"></canvas>
</div>
```

**`.g-label`** — pure CSS text, inherits `var(--text)` colour, DM Sans 11px 500 weight. Full browser font rendering. No `ctx.fillText` calls ever.

**`.g-track` canvas** draws only:
- Row background (alternating subtle tint)
- Vertical month grid lines
- Coloured activity bar (planned_end)
- Purple work-increase extension (current_end > planned_end)
- Dashed planned-end tick (when current ≠ planned)
- Amber today line (2px)

**Axis tick labels** — HTML `<span>` elements absolutely positioned inside `.g-axis-ticks` div. Same font stack as the page. No canvas text.

**Today date label** — HTML `<span>` below the last row, positioned via `left: [todayX]px`.

**`document.fonts.ready` is no longer needed** for Gantt rendering. Canvas draws zero text. Labels are HTML, rendered by the browser's native text engine.

**PDF Gantt** — same hybrid architecture. Labels are inline `div` elements with `color: #1a1714` (always light mode). Canvas tracks draw bars only.

**`GANTT_CFG` placement** — must be declared before the theme IIFE that calls `buildGantt()`. `const`/`let` do not hoist. If placed after the IIFE, throws `ReferenceError: Cannot access 'GANTT_CFG' before initialization`.

---

## CORS Fix — Critical Implementation Note

Apps Script Web Apps block `fetch()` calls from external domains when the request has a `Content-Type: application/json` header, because this triggers a CORS preflight (OPTIONS request) that Apps Script cannot respond to.

**The fix:** `index.html` sends all data as `FormData` with no explicit Content-Type header. This is a "simple request" per browser spec and bypasses preflight entirely. `Code.gs` reads from `e.parameters` (FormData) with a JSON fallback for `e.postData` (direct API calls).

Do not revert this to JSON fetch — it will break on Android Chrome.

---

## Keys and IDs

Already filled in and live. For reference:

```
GEMINI_API_KEY   → [REDACTED — see Code.gs]
SPREADSHEET_ID   → 11Xi5K1v-m10PhxnZ5dYBKD4w91IITzFXT0EDsqvFJ7Q
APPS_SCRIPT_URL  → https://script.google.com/macros/s/AKfycbzcUokFn0MTGieOsC2a6r-HP883YPwBNLXPZB9MhBZaW4NI5cGF062K5k1AKT3feQWB/exec
```

---

## Three-Mode Toggle — Behaviour & Rules

### Toggle UI
- Three buttons below the header, above the mic: `[ Daily Report ] [ Weekly Update ] [ Material Log ]`
- Amber active state, dark inactive — warm industrial aesthetic
- **Weekly Update** is disabled (greyed out, non-tappable) on any day that is not Monday or Tuesday (JS `getDay()` === 1 or 2)
- When disabled, "Mon & Tue ko ON hoga" appears in amber directly under the Weekly Update button — centred within its column, not below the full row
- Daily Report and Material Log are available every day, no restriction
- Switching modes while clips are recorded prompts a confirm before clearing

### Mode: Daily Report
- Instruction text: site strength → completed work → problems/delays → tomorrow's plan (Hinglish sequence)
- Gemini prompt: `PROMPT_DAILY` — formats structured WhatsApp-ready Progress Report
- Generation: `noLog=true` — Sheets write deferred to Copy button
- Copy button: triggers `logEditedDPR()` → fires `logDPR` action to Apps Script with final edited text
- Output logged to: `[Project] — DPR` tab + MASTER tab

### Mode: Weekly Update (Mon & Tue only)
- Instruction text: update on each activity — on track / delayed / paused + reason + new work starting
- Gemini prompt: `PROMPT_WEEKLY` — outputs WhatsApp summary AND `---JSON---` structured updates array
- Output: WhatsApp text returned to UI; JSON parsed and written to `[Project] — Timeline` tab
- After copy: shows "Timeline sheet updated automatically."

### Mode: Material Log (every day)
- Instruction text: material name → area → quantity → condition → partial/damage details
- Gemini prompt: `PROMPT_MATERIAL` — outputs WhatsApp summary AND `---JSON---` structured material object
- Output: WhatsApp text returned to UI; JSON parsed and written to `[Project] — Materials` tab
- After copy: shows "Materials sheet updated automatically."

---

## Daily Report Format Rules

These are locked in and must not change:

- Title: "Progress Report" — NOT "Daily Progress Report"
- Only include sections where the supervisor actually reported something
- Never show empty or "Not reported" sections — omit them entirely
- Do NOT include Supervisor in the site headcount
- Sections available (only shown if reported):
  - 📍 Progress Report | [Project] | [Date]
  - 👷 Site Strength: [Total] with trade breakdown
  - ✅ Completed Today
  - 🔄 In Progress
  - ⚠️ Site Flags
  - 📅 Tomorrow's Plan

---

## Multi-Clip Recording — How It Works

1. Supervisor taps mic → records first clip → taps mic again to stop
2. Clip appears as a card: clip number, duration, audio playback, Delete button
3. Supervisor can tap mic again to add another clip (no limit)
4. Each clip can be individually deleted
5. "Start Over" wipes all clips
6. On "Generate Report": all clips encoded to base64, sent as `audioPayload` JSON array
7. Gemini receives all clips as sequential audio parts in one API call
8. If a later clip contains a correction, Gemini resolves it automatically
9. Report renders in an editable box — supervisor can fix any noise/translation errors
10. Copy button grabs the current (edited or original) text and fires deferred log

---

## Multi-Project Setup

Each project gets its own bookmarked URL on the supervisor's phone:

```
https://kukku310.github.io/covva-dpr/?project=modi-basement
https://kukku310.github.io/covva-dpr/?project=golf-links
https://kukku310.github.io/covva-dpr/?project=vasant-vihar
```

Same `index.html` file serves all of them. Each project auto-creates its own tab in the Google Sheet.

Dashboard URL format:
```
https://kukku310.github.io/covva-dpr/dashboard.html?project=modi-basement
```

---

## Current Active Projects

**Modi Basement, New Delhi** — primary test site

Typical trades on this site:
- Carpenters (built-in units, doors)
- Stone workers (skirting, flooring)
- Painters (base coat, putty, primer)
- Polishers (PU polish on millwork)
- Electricians (roughing, wiring)
- MS fabricators (skylight — upcoming)
- Micro concrete applicators (flooring — upcoming)
- Helpers

**Golf Links** — confirmed active (tested 28/03/2026)

---

## Deployment Checklist

1. ✅ **GitHub** — Public repository `covva-dpr` created, `index.html` pushed, GitHub Pages enabled on `main` branch
2. ✅ **Google Apps Script** — Project created at script.google.com, `Code.gs` pasted, `GEMINI_API_KEY` and `SPREADSHEET_ID` filled in, deployed as Web App (Execute as: Me / Access: Anyone)
3. ✅ **index.html** — `APPS_SCRIPT_URL` replaced with live deployment URL, pushed to GitHub
4. ✅ **CORS fix** — Fetch switched from JSON POST to FormData POST; `Code.gs` updated to parse `e.parameters`; redeployed
5. ✅ **Multi-clip** — `audioPayload` array sent to Gemini as sequential audio parts; correction-aware prompt
6. ✅ **Editable DPR** — Report box is `contenteditable`; Copy button reads `innerText` to capture edits
7. ✅ **Full redo** — "Start Over" clears all clips, revokes object URLs, resets UI to initial state
8. ✅ **Date format** — Changed to `dd/mm/yyyy`
9. ✅ **Tested live** — Modi Basement and Golf Links URLs confirmed working on Android Chrome
10. ✅ **Three-mode toggle** — Daily Report / Weekly Update / Material Log; mode sent to backend; three Gemini prompts; three Sheet tab types per project; Weekly Update day-restricted (Mon/Tue only)
11. ✅ **Toggle UX refinement** — "Mon & Tue ko ON hoga" repositioned to sit under Weekly Update button only, in amber, centred within that button's column
12. ✅ **Date override row** — Collapsible date picker in index.html; overrides report date without disrupting UI
13. ✅ **Edit-on-copy / deferred logging** — Daily DPR logs final edited text on Copy tap, not raw AI output; `noLog=true` flag defers write; `logDPR` action in Code.gs handles the deferred write
14. ✅ **dashboard.html** — Full project dashboard live at `/dashboard.html?project=`; hybrid Gantt, strength chart, materials tracker, DPR archive, client view, PDF export
15. ✅ **setup.html** — Project setup UI live at `/setup.html`; new project creation + edit existing activities/materials/DPR entries
16. ✅ **Code.gs expanded** — `doGet` routing for 3 new actions; `doPost` handlers for `saveProjectData`, `saveDPREdit`, `logDPR`; helper functions `serveDashboardData`, `serveSetupData`, `serveProjectList`, `readTab`, `readTabRaw`
17. ✅ **Hybrid Gantt** — HTML div labels + canvas bar tracks; zero canvas text rendering; axis ticks as HTML spans; `GANTT_CFG` declared before theme IIFE
18. ✅ **Print/PDF** — `@page { margin: 0 }` + `body { margin: 1.5cm }` inside `@media print`; eliminates browser print headers/footers
19. ✅ **All files pushed to GitHub** — `index.html`, `dashboard.html`, `setup.html`, `Code.gs` live on `main` branch; GitHub Pages rebuilt and serving all files

**⚠️ Pending:** Apps Script must be redeployed with a new version for the expanded `Code.gs` (new `doGet` routes and `doPost` actions) to go live. Current deployment still runs the previous version.
- ✅ Code.gs — Phase 3: same-day correction logic in applyTimelineUpdateToRowData + extractSameDayDelayLogEntry helper
- ⬜ Code.gs — Phase 3: redeployed with new version
- ⬜ Code.gs — Phase 4: rollbackTimeline() function added + doPost routing
- ⬜ setup.html — Phase 4: Rollback Timeline button + modal + toast
- ⬜ Code.gs — Phase 4: redeployed with new version

---

## Gemini API Details

- Model: `gemini-2.0-flash`
- Called from Google Apps Script via `UrlFetchApp`
- Audio sent as base64 `inline_data` — one part per clip, all in a single API call
- Supported mime types: `audio/webm;codecs=opus`, `audio/webm`, `audio/ogg` (Android Chrome auto-selects best)
- Temperature: 0.2 (low — for consistent structured output)
- Max output tokens: 1500
- Three system prompts in `Code.gs`: `PROMPT_DAILY`, `PROMPT_WEEKLY`, `PROMPT_MATERIAL`
- Text instruction explicitly tells Gemini: number of clips, to listen in order, and to resolve corrections
- Weekly and Material prompts output two sections: WhatsApp text + `---JSON---` structured data block
- `Code.gs` splits on `---JSON---`, returns WhatsApp text to UI, parses JSON and writes to correct Sheet tab
- No OpenAI or Whisper involved — Gemini handles Hinglish audio natively

---

## Google Sheets Structure

Each project auto-creates three tabs on first submission. MASTER is shared across all projects.

```
COVVA Site Tracker (parent spreadsheet)
│
├── Modi Basement — DPR        ← Daily Report entries
├── Modi Basement — Timeline   ← Weekly Update: activity-level slippage tracking
├── Modi Basement — Materials  ← Material Log: delivery history
├── Golf Links — DPR
├── Golf Links — Timeline
├── Golf Links — Materials
├── [Next Project] — DPR       ← auto-created on first submission
├── [Next Project] — Timeline
├── [Next Project] — Materials
└── MASTER                     ← Daily Report entries aggregated across all projects
```

**[Project] — DPR columns:** Date | Project | Formatted Report | Logged At | Edit Flag | Edit Timestamp

**[Project] — Timeline columns:** Activity | Planned Start | Planned End | Current End | Status | Total Slippage Days | Delay Log | Last Updated
- If an activity row exists: Status updated, Current End recalculated by adding `delay_days`, Total Slippage Days incremented, Delay Log appended as `① [Date] +[X]d — [Reason]` (never overwrites)
- If activity is new: row created; Planned Start/End left blank for manual entry

**[Project] — Materials columns:** Date | Material | Area | Qty Received | Condition | Damage Detail | Qty Pending | Pending Reason | Expected Date | Supplier | Logged At
- Each submission appends a new row — full delivery history builds organically, no overwriting

---

## Design Notes

### Warm Industrial Palette
- Dark mode: bg `#0e0e0e`, surface `#161616`, panel `#1e1e1e`, border `#2a2a2a`, amber `#d4872a`, text `#e8e2d9`, mid `#a89f94`, dim `#7a7268`
- Light mode: bg `#f5f2ee`, surface `#ffffff`, panel `#f0ece6`, border `#e0dbd3`, amber `#b8711f`, text `#1a1714`, mid `#5c5148`, dim `#9a9188`
- Fonts: Bebas Neue (headings/section titles), DM Mono (data/labels/monospace), DM Sans (body/names)
- Full body text colours `#1a1714` / `#e8e2d9` are the correct colours for Gantt labels — mid-tones (`#5c5148` / `#a89f94`) look too light

### Mobile-first
- Optimised for Android Chrome — no desktop-only features
- No dependencies other than Google Fonts
- Touch targets at least 44px
- FormData POST (not JSON) for CORS safety

### Dashboard-specific
- Client View strips all internal data — safe to share URL with clients
- PDF export modal: always light mode, `@page { margin: 0 }` for clean print output
- Section numbers: ①②③④⑤ in amber circles (Bebas Neue)
- Internal sections marked with `.internal-badge` chip

---

## COVVA Brand Rules

- Always write **COVVA** — double V, all caps, non-negotiable
- No "Cova", no "Covva"
- Footer reads: "COVVA SITE INTELLIGENCE" — nothing else

---

## Feature: Material Requirement Dates (MRD)

### What This Is

A new feature inside dashboard.html (Section ③ — Client Materials) and a new 
standalone section. The supervisor needs to be able to mark specific client-supplied 
materials with a "Required On Site Date" — the date by which each material must be 
delivered to site for installation to begin.

This is different from the existing Material Log in index.html, which records 
deliveries that have ALREADY arrived. MRDs are forward-looking — they tell the client 
when their material needs to arrive.

### Two Surfaces Where MRDs Appear

1. The Gantt chart in dashboard.html (Section ①) — as visual flag markers on the 
   timeline at the required on-site date
2. A new Section ⑥ — Procurement Schedule — in dashboard.html, below Section ⑤

### What an MRD Contains (per material entry)

- Material Name (e.g. "Vitrified Tile", "Natural Stone", "Aluminium Windows")
- Area (e.g. "Master Bedroom", "Living Room", "All Bathrooms")
- Required On Site Date (the date this material must reach site)
- Quantity Required (free text, e.g. "850 sqft", "12 units")
- Notes (optional, e.g. "Large format 800x800mm")
- Delivery Status: NOT YET INFORMED / CLIENT ACTIONING / PARTIAL DELIVERY / 
  RECEIVED / TARGET OVERDUE
- Inform Date (when COVVA told client to initiate procurement)

Note: No lead times, no "order by" date calculations. Only the required on-site date 
is tracked. Ordering decisions are handled by the client and their architect.

### How MRDs Are Entered

Via setup.html — in the Client Material Table (Section A and Section B → Materials tab).
A new column "Required On Site Date" (date picker) is added to that table alongside 
the existing columns. This is the primary way the supervisor or admin sets an MRD.

### Gantt Chart Integration (Section ①)

MRD markers appear on the Gantt as vertical flag pins at the requiredOnSiteDate position.

Visual style:
- A small filled diamond (◆) drawn on the canvas at the correct X position
- A short vertical stem below the diamond (like a pin/flag)
- Colour by status:
  - NOT YET INFORMED / CLIENT ACTIONING: amber #b8711f (light) / #d4872a (dark)
  - PARTIAL DELIVERY: blue #1a6fa0
  - RECEIVED: green #1e8449
  - TARGET OVERDUE: red #a93226
- Material name label: HTML <span> element absolutely positioned below the pin 
  (same hybrid approach as axis tick labels — no canvas text)
- On mobile: tap the pin to show a small popover with material name, area, 
  required date, and status

In Client View: MRD markers are visible. Material name, required date, and status 
colour shown. Delivery notes and quantities are NOT shown in client view.

### Section ⑥ — Procurement Schedule

A new section in dashboard.html below Section ⑤.
Visible in BOTH internal view and client view.

Title: "⑥ Procurement Schedule"
Subtitle (internal only): "Client-procured materials only."

Table columns: Material | Area | Required On Site | Qty Required | Status | Notes

Status badge colours (same as Section ③):
- NOT YET INFORMED: red
- CLIENT ACTIONING: amber
- PARTIAL DELIVERY: amber
- TARGET OVERDUE: red
- ORDERED: blue
- RECEIVED: green (hidden in client view — received items not shown to client)

A "Copy for WhatsApp" button at the top right of this section.
Generates this plain-text format and copies to clipboard:

──────────────────────────────
PROCUREMENT SCHEDULE
[Project Name]
[Today's date dd/mm/yyyy]
──────────────────────────────

1. Vitrified Tile — Living Room
   Required On Site: 15/05/2026
   Qty: 850 sqft
   Status: CLIENT ACTIONING
   Notes: Large format 800x800mm

2. Natural Stone — Master Bedroom
   Required On Site: 20/05/2026
   Qty: 120 sqft
   Status: PARTIAL DELIVERY
   Notes: 60 sqft received, 60 sqft pending

──────────────────────────────

Copy success shows the same inline "Copied!" toast as the rest of the dashboard.

In client view: RECEIVED items are hidden from this section (same rule as Section ③).

### Intelligent Link to Material Log (index.html)

When the supervisor submits a Material Log voice entry via index.html, the 
transcribed material data is written to the [Project] — Materials tab as usual.

Additionally, Code.gs should attempt to match the submitted material name against 
open MRD entries in the [Project] — Materials tab (the MRD rows, identified by 
having a value in the "Required On Site Date" column). The match is case-insensitive 
and partial (e.g. "tile" matches "Vitrified Tile").

If a match is found:
- Update the Delivery Status of the matched MRD row:
  - If the voice log contains "full", "complete", "all received", or quantity 
    matches quantityRequired → set status to RECEIVED
  - Otherwise → set status to PARTIAL DELIVERY
- Update the "Last Delivery Note" column with a summary of the received quantity 
  and condition from the voice log
- Update the "Last Delivery At" column with the log date

This match is best-effort. If no match is found, the material log is saved as-is 
with no error. This never blocks or delays the existing Material Log flow.

### Google Sheets Structure — Materials Tab Update

Add the following new columns to [Project] — Materials tab 
(appended after existing columns, do not remove existing columns):

- Required On Site Date (date — set via setup.html, not via voice log)
- Qty Required (free text — set via setup.html)
- Inform Date (date — set via setup.html)
- Last Delivery Note (text — auto-updated by intelligent match on voice log)
- Last Delivery At (date — auto-updated by intelligent match on voice log)

### PDF Export Update

The PDF export (Client View → Export PDF) should include the Procurement Schedule 
table (pending items only, same as client view of Section ⑥) below the Gantt chart 
and above the footer.

### Deployment Checklist Additions (append to existing checklist)

- ✅ setup.html — "Required On Site Date" column added to Client Material Table
- ✅ Code.gs — Materials tab new columns handled in saveProjectData and serveDashboardData
- ✅ Code.gs — Intelligent match logic in Material Log flow (matchAndUpdateMRDs)
- ⚠️ Code.gs — Redeployed with new version (manual step required in Apps Script)
- ✅ dashboard.html — MRD flag markers on Gantt canvas (diamond pins + HTML labels + popovers)
- ✅ dashboard.html — Section ⑥ Procurement Schedule with WhatsApp copy
- ✅ dashboard.html — PDF export includes Procurement Schedule
- ✅ dashboard.html — Client View rules applied to Section ⑥ (hide RECEIVED)

---

## Feature: Phase 3 — Same-Day Weekly Update Correction

### What This Is

The Weekly Update mode (Mon/Tue only) sends a voice recording to Gemini which
outputs structured JSON containing delay_days per activity. Code.gs reads this
JSON and writes to the [Project] — Timeline tab — incrementing Total Slippage Days,
recalculating Current End, and appending to the Delay Log.

The problem: if the supervisor submits a second Weekly Update on the same calendar
day (to correct a mistake in the first one), the current logic compounds both
submissions. delay_days from the first run are already written. The second run adds
on top. This corrupts the timeline.

Phase 3 fixes this with same-day replacement logic.

### Rule

If a Weekly Update JSON is processed for a project and the [Project] — Timeline tab
already has a Delay Log entry dated TODAY (same dd MMM yyyy date string), the second
submission REPLACES the first day's update rather than stacking on top of it.

"Same day" is determined by matching the date string in the Delay Log column.
Format used: dd MMM yyyy (e.g. "19 Apr 2026") — consistent with existing log entries.

### How Replacement Works (per activity row)

When a matching same-day entry is detected:

1. Read the existing Current End and Total Slippage Days for the activity row
2. Find the today-dated Delay Log entry — format: `① 19/04 +3d — Reason` 
   (the circled number ① may vary — match by date string, not by position)
3. Extract the delay_days value from that existing entry (parse the `+Xd` portion)
4. Subtract those original delay_days from Current End and Total Slippage Days
   to get back to the pre-today state
5. Apply the new delay_days from the current submission
6. Replace the today-dated Delay Log entry with the new one (same position in the
   log string, or appended if position replacement is too complex — append is
   acceptable as long as the old today entry is removed)

If the activity has NO today-dated entry in its Delay Log: standard append logic
applies unchanged. This is a new update for the week, not a correction.

### Scope

- Only applies to Weekly Update mode (PROMPT_WEEKLY path in doPost)
- Daily Report and Material Log are unaffected
- Only same-day corrections are handled — no cross-day rollback (that is Phase 4)
- If the today-date detection or log parsing fails for any reason, fall back to
  the existing append behaviour and log a warning via Logger.log

### Files to Touch

- Code.gs — upsertActivityRow() or the Weekly Update write path
  (wherever delay_days are applied to the Timeline tab rows)

### Deployment Note

Requires Apps Script redeploy with new version after Code.gs is updated.

---

## Feature: Phase 4 — Timeline Rollback

### What This Is

An admin-facing feature in setup.html that allows the authorised user (Abhishek)
to undo a specific Weekly Update from a past date — reverting the timeline to its
state before that update was applied.

This is needed because manually correcting a corrupt timeline in Google Sheets is
error-prone — Total Slippage Days, Current End dates, and Delay Log entries across
multiple activity rows all need to be unwound together. Rollback does this in one tap.

### Where It Lives

setup.html — Section B (Edit Existing Project) — Activities tab.

A new "Rollback Timeline" button appears at the top of the Activities tab, right-aligned,
styled in amber outline (not filled — this is a destructive action, not a primary action).

### User Flow

1. Admin taps "Rollback Timeline" button
2. A modal appears:
   - Title: "Roll Back Timeline Update"
   - A dropdown showing all dates that have a Delay Log entry in the current project's
     Timeline tab — populated by reading the Timeline tab and extracting unique dates
     from all Delay Log columns. Sorted DESC (most recent first).
   - Warning text: "This will undo all activity changes logged on the selected date.
     This cannot be undone."
   - Two buttons: "Cancel" and "Confirm Rollback" (amber filled)
3. On confirm: calls a new Apps Script action rollbackTimeline(project, date)
4. Modal closes, Activities tab refreshes with updated data
5. A success/error toast appears (same style as existing toasts in setup.html)

### How rollbackTimeline Works in Code.gs

For each activity row in [Project] — Timeline tab:

1. Read Delay Log column for this row
2. Find all log entries dated the selected rollback date
   Format to match: `① dd/mm — +Xd — Reason` or the existing log format
   (read existing entries to confirm exact format before parsing)
3. For each matched entry:
   a. Parse the delay_days value (the `+Xd` portion)
   b. Subtract that value from Current End (subtract N calendar days)
   c. Subtract that value from Total Slippage Days
   d. Remove the matched log entry from the Delay Log string
4. If no entries matched for this row: skip (no changes to this row)
5. Write the updated Current End, Total Slippage Days, and Delay Log back to the row

After all rows processed:
- Log: Logger.log("Rollback complete for " + project + " date: " + rollbackDate)
- Return { success: true, activitiesAffected: N }

### Edge Cases to Handle

- An activity has multiple log entries on the same date (two updates same day before
  Phase 3 was deployed): remove ALL matching entries and subtract ALL their delay values
- Current End after rollback would be earlier than Planned End: cap at Planned End,
  set Total Slippage Days to 0
- Total Slippage Days after subtraction goes negative: set to 0, log a warning
- Rollback date not found in any activity row: return { success: true, activitiesAffected: 0 }
  with a "No entries found for that date" toast

### Files to Touch

- Code.gs — new rollbackTimeline() function + doGet/doPost routing for new action
- setup.html — "Rollback Timeline" button + modal + fetch call to new action

### Deployment Note

Requires Apps Script redeploy with new version after Code.gs is updated.
