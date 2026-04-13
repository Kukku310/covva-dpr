// ═══════════════════════════════════════════════════════════════
//  COVVA — Site Intelligence Backend
//  Google Apps Script
//  Supports: Daily Report / Weekly Update / Material Log
// ═══════════════════════════════════════════════════════════════

// ─── YOUR KEYS ────────────────────────────────────────────────
const GEMINI_API_KEY  = 'YOUR_GEMINI_API_KEY';   // Set this in Apps Script only — never commit the real key
const SPREADSHEET_ID  = 'YOUR_SPREADSHEET_ID';   // Set this in Apps Script only — never commit the real ID

const GEMINI_MODEL = 'gemini-2.0-flash';

const TIMELINE_HEADERS = [
  'Activity', 'Planned Start', 'Planned End', 'Current End',
  'Status', 'Total Slippage Days', 'Delay Log', 'Last Updated',
  'Manual Override', 'Override Timestamp', 'AI Last Update Token', 'AI Update History'
];

const TIMELINE_WIDTHS = [180, 110, 110, 110, 100, 100, 400, 140, 100, 140, 130, 220];

const TIMELINE_COL = {
  ACTIVITY: 0,
  PLANNED_START: 1,
  PLANNED_END: 2,
  CURRENT_END: 3,
  STATUS: 4,
  SLIPPAGE: 5,
  DELAY_LOG: 6,
  LAST_UPDATED: 7,
  MANUAL_OVERRIDE: 8,
  OVERRIDE_TIMESTAMP: 9,
  AI_LAST_TOKEN: 10,
  AI_HISTORY: 11
};

// ═══════════════════════════════════════════════════════════════
//  GEMINI PROMPTS
// ═══════════════════════════════════════════════════════════════

const PROMPT_DAILY = `You are a construction site progress report formatter for COVVA, a high-end turnkey general contractor based in New Delhi.

The audio contains a Hinglish voice note from a site supervisor. Listen carefully and extract all information, then format it as a clean English Progress Report.

Trades on COVVA sites typically include: Carpenters, Stone workers, Painters, Polishers (PU/lacquer), Electricians, Plumbers, False ceiling workers, MS fabricators, Micro concrete applicators, Helpers.

STRICT RULES:
- Do NOT include any section where no information was provided
- Do NOT include Supervisor in the headcount
- Do NOT invent or assume anything not stated
- Only show sections that have actual reported content
- Convert all Hinglish naturally to clean English

Output format — include ONLY sections that have content:

📍 Progress Report
[Project Name from context] | [Date from context]

👷 Site Strength: [Total — do not count supervisor]
  • [Trade]: [Count]

✅ Completed Today
- [Only if supervisor mentioned completed work]

🔄 In Progress
- [Work currently happening]

⚠️ Site Flags
- [Only if supervisor mentioned a problem, delay, or issue]

📅 Tomorrow's Plan
- [Only if supervisor mentioned tomorrow's plan]

Output ONLY the formatted report. No preamble, no commentary, nothing else.`;


const PROMPT_WEEKLY = `You are a construction site weekly progress formatter for COVVA, a high-end turnkey contractor in New Delhi.

The audio is a Hinglish weekly update from a site supervisor covering activity-level progress.

Extract the following for each activity mentioned:
- Activity name
- Status: on_track / delayed / completed / paused / not_started / in_progress
- If delayed: by how many days (integer)
- If delayed: reason given
- If paused: reason given
- What new work is starting and when (if mentioned)

Important interpretation rule:
- If an activity was supposed to have already started by the report date, but the supervisor says it will start in X days / next week / on a later date, treat it as delayed and set delay_days based on that start delay.

Output format:

📊 Weekly Progress Update
[Project] | [Date]

Then list each activity mentioned with its status and any delay reason. Clean English. Concise.

After the WhatsApp-ready message, put the marker ---JSON--- on its own line.
On the next line, output exactly one single-line JSON object for Sheet update:
---JSON---
{"updates":[{"activity":"[name]","status":"[on_track|delayed|completed|paused|not_started|in_progress]","delay_days":[integer or 0],"reason":"[reason or null]","new_work_starting":"[description or null]","new_work_date":"[date string or null]"}]}

Output ONLY the message, the marker, and the JSON. No section labels, no code fences, no commentary.`;


const PROMPT_MATERIAL = `You are a construction site material delivery logger for COVVA, a high-end turnkey contractor in New Delhi.

The audio is a Hinglish material delivery update from a site supervisor.

Extract:
- Material name
- Area / room it is for
- Quantity received (with unit if mentioned)
- Condition: good / damaged / partial
- Damage detail if applicable
- Quantity still pending (if partial)
- Reason for partial delivery (if given)
- Expected date for balance (if mentioned)
- Supplier name (if mentioned)

Output format:

📦 Material Update
[Project] | [Date]

[Material name] — [Area]
Received: [qty] [condition note if issue]
[If partial: Balance pending: [qty] — Expected: [date]]
[If damaged: Issue: [detail]]

After the WhatsApp-ready message, put the marker ---JSON--- on its own line.
On the next line, output exactly one single-line JSON object for Sheet update:
---JSON---
{"material":"[name]","area":"[area]","qty_received":"[qty]","condition":"[good|damaged|partial]","damage_detail":"[detail or null]","qty_pending":"[qty or null]","pending_reason":"[reason or null]","expected_date":"[date or null]","supplier":"[name or null]"}

Output ONLY the message, the marker, and the JSON. No section labels, no code fences, no commentary.`;


// ═══════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    let action, mode, project, date, audioPayload;
    if (e.parameters && e.parameters.action) {
      action       = e.parameters.action[0];
      mode         = e.parameters.mode ? e.parameters.mode[0] : 'daily';
      project      = e.parameters.project ? e.parameters.project[0] : null;
      date         = e.parameters.date ? e.parameters.date[0] : null;
      audioPayload = e.parameters.audioPayload ? JSON.parse(e.parameters.audioPayload[0]) : null;
    } else {
      const body   = JSON.parse(e.postData.contents);
      action       = body.action;
      mode         = body.mode || 'daily';
      project      = body.project;
      date         = body.date;
      audioPayload = body.audioPayload;
    }

    // ─── New POST actions ──────────────────────────────────
    if (action === 'saveProjectData') {
      let payload;
      if (e.parameters && e.parameters.payload) {
        payload = JSON.parse(e.parameters.payload[0]);
      } else {
        payload = JSON.parse(e.postData.contents);
      }
      return saveProjectData(payload);
    }

    if (action === 'saveDPREdit') {
      let proj, dt, editedTxt;
      if (e.parameters && e.parameters.project) {
        proj      = e.parameters.project[0];
        dt        = e.parameters.date[0];
        editedTxt = e.parameters.editedText[0];
      } else {
        const body = JSON.parse(e.postData.contents);
        proj = body.project; dt = body.date; editedTxt = body.editedText;
      }
      return saveDPREditFn(proj, dt, editedTxt);
    }

    if (action === 'resetTimelineAI') {
      let resetProject, resetMode, resetDate;
      if (e.parameters && e.parameters.project) {
        resetProject = e.parameters.project[0];
        resetMode = e.parameters.mode ? e.parameters.mode[0] : 'latest';
        resetDate = e.parameters.resetDate ? e.parameters.resetDate[0] : '';
      } else {
        const body = JSON.parse(e.postData.contents);
        resetProject = body.project;
        resetMode = body.mode || 'latest';
        resetDate = body.resetDate || '';
      }
      return resetTimelineAIFn(resetProject, resetMode, resetDate);
    }

    // ─── logDPR — Sheets write on Copy (edited text) ───────
    if (action === 'logDPR') {
      let logMode, logProject, logDate, logText, structuredData;
      if (e.parameters && e.parameters.mode) {
        logMode    = e.parameters.mode[0];
        logProject = e.parameters.project[0];
        logDate    = e.parameters.date[0];
        logText    = e.parameters.dprText[0];
        structuredData = e.parameters.structuredData ? e.parameters.structuredData[0] : '';
      } else {
        const body = JSON.parse(e.postData.contents);
        logMode = body.mode; logProject = body.project; logDate = body.date; logText = body.dprText;
        structuredData = body.structuredData || '';
      }
      const logDateFmt = formatDate(new Date(logDate));
      if (logMode === 'daily') {
        logToDPR(logProject, logDateFmt, logText);
      } else if (logMode === 'weekly' && structuredData) {
        // Extract just the JSON object — guards against Gemini adding trailing text after the JSON
        const jsonMatch = structuredData.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON object found in structured data — Gemini response was malformed');
        const jsonData = JSON.parse(jsonMatch[0]);
        logToTimeline(logProject, logDateFmt, jsonData.updates || [], new Date(logDate));
      }
      return jsonResponse({ success: true });
    }

    if (action !== 'generateDPR') {
      return jsonResponse({ success: false, error: 'Unknown action' });
    }

    const noLog = e.parameters && e.parameters.noLog && e.parameters.noLog[0] === 'true';
    const dateFormatted = formatDate(new Date(date));

    // Select prompt based on mode
    let prompt;
    if (mode === 'weekly')   prompt = PROMPT_WEEKLY;
    else if (mode === 'material') prompt = PROMPT_MATERIAL;
    else                     prompt = PROMPT_DAILY;

    const rawResponse = generateWithGemini(audioPayload, prompt, project, dateFormatted);

    // Parse response and write to appropriate sheet tab
    let whatsappText = rawResponse;

    let structuredData = '';

    if (mode === 'weekly') {
      const parsed = parseStructuredResponse(rawResponse);
      whatsappText = parsed.whatsappText;
      structuredData = parsed.jsonText;
      if (parsed.jsonText) {
        try {
          if (!noLog) {
            const jsonData = JSON.parse(parsed.jsonText);
            logToTimeline(project, dateFormatted, jsonData.updates || [], new Date(date));
          }
        } catch(jsonErr) {
          // JSON parse failed — still return whatsapp text, log the error
          Logger.log('Weekly JSON parse error: ' + jsonErr.message);
        }
      }
    } else if (mode === 'material') {
      const parsed = parseStructuredResponse(rawResponse);
      whatsappText = parsed.whatsappText;
      if (parsed.jsonText) {
        try {
          const jsonData = JSON.parse(parsed.jsonText);
          logToMaterials(project, dateFormatted, jsonData);
        } catch(jsonErr) {
          Logger.log('Material JSON parse error: ' + jsonErr.message);
        }
      }
    } else {
      // Daily — log to DPR tab + MASTER only if noLog is not set
      // (when noLog=true, logging deferred to Copy button via logDPR action)
      if (!noLog) {
        logToDPR(project, dateFormatted, whatsappText);
      }
    }

    return jsonResponse({ success: true, dpr: whatsappText, structuredData: structuredData });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  const params = e ? e.parameter : {};
  const action  = params.action || '';
  const project = params.project || '';

  if (action === 'dashboardData' && project) {
    return serveDashboardData(project);
  }
  if (action === 'setupData' && project) {
    return serveSetupData(project);
  }
  if (action === 'projectList' || action === 'listProjects') {
    return serveProjectList();
  }

  return ContentService.createTextOutput('COVVA Site Intelligence Backend — OK');
}


// ═══════════════════════════════════════════════════════════════
//  DASHBOARD DATA — serveDashboardData(project)
//  Called by dashboard.html on page load via doGet action=dashboardData
// ═══════════════════════════════════════════════════════════════

function serveDashboardData(project) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const safeProject = sanitizeTabName(project);

    const activities = readTab(ss, safeProject + ' — Timeline', [
      'activity', 'planned_start', 'planned_end', 'current_end',
      'status', 'total_slippage_days', 'delay_log', 'last_updated'
    ]);

    const materials = readTab(ss, safeProject + ' — Materials', [
      'date', 'material', 'area', 'qty_received', 'condition',
      'damage_detail', 'qty_pending', 'pending_reason', 'expected_date', 'supplier', 'logged_at',
      'inform_date', 'target_date', 'status', 'notes'
    ]);

    const dprs = readTab(ss, safeProject + ' — DPR', [
      'date', 'project', 'report', 'logged_at'
    ]);

    // Enrich DPRs: add formatted_report alias and parse strength tags
    dprs.forEach(function(dpr) {
      dpr.formatted_report = dpr.report || '';
    });

    const result = {
      success: true,
      project: safeProject,
      activities: activities,
      materials: materials,
      dprs: dprs
    };

    return jsonResponse(result);
  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}


// ═══════════════════════════════════════════════════════════════
//  SETUP DATA — serveSetupData(project)
//  Called by setup.html to load project data for editing
// ═══════════════════════════════════════════════════════════════

function serveSetupData(project) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const safeProject = sanitizeTabName(project);

    const activities = readTabRaw(ss, safeProject + ' — Timeline');
    const materials  = readTabRaw(ss, safeProject + ' — Materials');
    const dprs       = readTabRaw(ss, safeProject + ' — DPR');

    // Convert DPR rows to objects with date + report
    const dprObjects = dprs.map(function(row) {
      return { date: row[0] || '', project: row[1] || '', report: row[2] || '', formatted_report: row[2] || '', logged_at: row[3] || '' };
    });

    return jsonResponse({
      success: true,
      project: safeProject,
      activities: activities,
      materials: materials,
      dprs: dprObjects
    });
  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}


// ═══════════════════════════════════════════════════════════════
//  PROJECT LIST — serveProjectList()
//  Returns array of project names derived from sheet tab names
// ═══════════════════════════════════════════════════════════════

function serveProjectList() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    const projectNames = [];

    const enDash = String.fromCharCode(8211);
    const emDash = String.fromCharCode(8212);

    sheets.forEach(function(s) {
      const tabName = s.getName();
      // Use indexOf to avoid regex encoding issues with dash characters
      const hasDPR = tabName.indexOf(enDash + ' DPR') > -1 ||
                     tabName.indexOf(emDash + ' DPR') > -1 ||
                     tabName.indexOf('- DPR') > -1;
      if (hasDPR) {
        const name = tabName.replace(' ' + enDash + ' DPR', '')
                            .replace(' ' + emDash + ' DPR', '')
                            .replace(' - DPR', '').trim();
        projectNames.push(name);
      }
    });

    const projects = projectNames.map(function(name) {
      const info = { name: name, start_date: '', end_date: '', last_dpr_date: '' };
      const timeline = ss.getSheetByName(name + ' ' + enDash + ' Timeline') ||
                       ss.getSheetByName(name + ' ' + emDash + ' Timeline') ||
                       ss.getSheetByName(name + ' - Timeline');
      if (timeline) {
        const rows = timeline.getDataRange().getValues();
        const allDates = [];
        const endDates = [];
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][1]) allDates.push(new Date(rows[i][1])); // planned_start col B
          if (rows[i][3]) endDates.push(new Date(rows[i][3])); // current_end col D
          else if (rows[i][2]) endDates.push(new Date(rows[i][2])); // planned_end col C
        }
        const validStart = allDates.filter(function(d) { return !isNaN(d); });
        const validEnd   = endDates.filter(function(d) { return !isNaN(d); });
        if (validStart.length) info.start_date = new Date(Math.min.apply(null, validStart)).toISOString();
        if (validEnd.length)   info.end_date   = new Date(Math.max.apply(null, validEnd)).toISOString();
      }

      // Get last DPR date from DPR tab — try both em dash and hyphen variants
      const dprTab = ss.getSheetByName(name + ' ' + enDash + ' DPR') ||
                     ss.getSheetByName(name + ' ' + emDash + ' DPR') ||
                     ss.getSheetByName(name + ' - DPR');
      if (dprTab) {
        const rows = dprTab.getDataRange().getValues();
        const dates = [];
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][0]) { const d = new Date(rows[i][0]); if (!isNaN(d)) dates.push(d); }
        }
        if (dates.length) info.last_dpr_date = new Date(Math.max.apply(null, dates)).toISOString();
      }

      return info;
    });

    return jsonResponse({ success: true, projects: projects });
  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}


// ═══════════════════════════════════════════════════════════════
//  SAVE PROJECT DATA — saveProjectData(payload)
//  Called by setup.html Submit (new project) or Save Row (edit)
//  Routed via doPost when action=saveProjectData
// ═══════════════════════════════════════════════════════════════

function saveProjectData(payload) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const project = sanitizeTabName(payload.project || '');
    if (!project) throw new Error('Project name required');

    const now = new Date().toLocaleString('en-IN');

    // ─── Timeline tab ─────────────────────────────────────────
    const timelineSheet = getOrCreateTab(ss, project + ' — Timeline', TIMELINE_HEADERS, TIMELINE_WIDTHS);

    // ─── Materials tab ────────────────────────────────────────
    const matHeaders = [
      'Date', 'Material', 'Area', 'Qty Received', 'Condition',
      'Damage Detail', 'Qty Pending', 'Pending Reason', 'Expected Date',
      'Supplier', 'Logged At', 'Inform Date', 'Target Date', 'Status', 'Notes',
      'Manual Override', 'Override Timestamp'
    ];
    const matSheet = getOrCreateTab(ss, project + ' — Materials', matHeaders,
      [100, 160, 140, 100, 90, 200, 100, 180, 110, 140, 160, 110, 110, 140, 200, 100, 140]
    );

    // ─── DPR tab (just ensure it exists) ─────────────────────
    getOrCreateTab(ss, project + ' — DPR',
      ['Date', 'Project', 'Formatted Report', 'Logged At'], [100, 140, 500, 160]
    );

    // ─── Handle single-row update (from Save Row button) ─────
    if (payload.updateType === 'activity') {
      upsertActivityRow(timelineSheet, payload, now);
      return jsonResponse({ success: true });
    }
    if (payload.updateType === 'material') {
      upsertMaterialRow(matSheet, payload, now);
      return jsonResponse({ success: true });
    }

    // ─── Full project save (new project) ──────────────────────
    (payload.activities || []).forEach(function(act) {
      upsertActivityRow(timelineSheet, act, now);
    });
    (payload.materials || []).forEach(function(mat) {
      upsertMaterialRow(matSheet, mat, now);
    });

    return jsonResponse({ success: true });

  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function upsertActivityRow(sheet, act, now) {
  const data = sheet.getDataRange().getValues();
  let foundRow = -1;
  const actName = normalizeTimelineActivityKey(act.activity || '');
  for (let i = 1; i < data.length; i++) {
    if (normalizeTimelineActivityKey(data[i][TIMELINE_COL.ACTIVITY] || '') === actName) { foundRow = i + 1; break; }
  }

  const overrideFlag  = act.manual_override ? 'YES' : '';
  const overrideStamp = act.manual_override ? now : '';

  // If current_end is empty, default to planned_end — never mandatory at row creation
  const resolvedPlannedEnd = act.planned_end || (foundRow > 0 ? data[foundRow-1][2] : '');
  const resolvedCurrentEnd = act.current_end || (foundRow > 0 ? data[foundRow-1][3] : '') || resolvedPlannedEnd;

  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, TIMELINE_HEADERS.length).setValues([[
      act.activity || data[foundRow-1][TIMELINE_COL.ACTIVITY],
      act.planned_start || data[foundRow-1][TIMELINE_COL.PLANNED_START],
      resolvedPlannedEnd,
      resolvedCurrentEnd,
      act.status        || data[foundRow-1][TIMELINE_COL.STATUS],
      data[foundRow-1][TIMELINE_COL.SLIPPAGE] || 0,  // preserve slippage
      data[foundRow-1][TIMELINE_COL.DELAY_LOG] || '',  // preserve delay log
      now,
      overrideFlag,
      overrideStamp,
      data[foundRow-1][TIMELINE_COL.AI_LAST_TOKEN] || '',
      data[foundRow-1][TIMELINE_COL.AI_HISTORY] || ''
    ]]);
  } else {
    sheet.appendRow([
      act.activity || '', act.planned_start || '', resolvedPlannedEnd,
      resolvedCurrentEnd, act.status || 'Not Started', 0, '', now,
      overrideFlag, overrideStamp, '', ''
    ]);
  }
}

function upsertMaterialRow(sheet, mat, now) {
  const data = sheet.getDataRange().getValues();
  let foundRow = -1;
  const matName = String(mat.material || '').toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase().trim() === matName) { foundRow = i + 1; break; }
  }

  const overrideFlag  = mat.manual_override ? 'YES' : '';
  const overrideStamp = mat.manual_override ? now : '';

  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, 17).setValues([[
      data[foundRow-1][0],  // preserve original date
      mat.material  || data[foundRow-1][1],
      mat.area      || data[foundRow-1][2],
      data[foundRow-1][3],  // preserve qty received (from voice logs)
      data[foundRow-1][4],  // preserve condition
      data[foundRow-1][5],  // preserve damage detail
      data[foundRow-1][6],  // preserve qty pending
      data[foundRow-1][7],  // preserve pending reason
      mat.target_date || data[foundRow-1][8],
      data[foundRow-1][9],  // preserve supplier
      now,
      mat.inform_date || data[foundRow-1][11] || '',
      mat.target_date || data[foundRow-1][12] || '',
      mat.status  || data[foundRow-1][13] || '',
      mat.notes   || data[foundRow-1][14] || '',
      overrideFlag,
      overrideStamp
    ]]);
  } else {
    sheet.appendRow([
      now, mat.material || '', mat.area || '', '', '', '', '', '', mat.target_date || '', '', now,
      mat.inform_date || '', mat.target_date || '', mat.status || 'Not Yet Informed', mat.notes || '',
      overrideFlag, overrideStamp
    ]);
  }
}


// ═══════════════════════════════════════════════════════════════
//  SAVE DPR EDIT — saveDPREdit(project, date, editedText)
//  Called by setup.html when a DPR is manually corrected
//  Routed via doPost when action=saveDPREdit
// ═══════════════════════════════════════════════════════════════

function saveDPREditFn(project, date, editedText) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const tabName = sanitizeTabName(project) + ' — DPR';
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) throw new Error('DPR tab not found: ' + tabName);

    const data = sheet.getDataRange().getValues();
    // Check if sheet has Manually Edited column (col 5 = index 4)
    // Ensure header has those columns
    const headers = data[0];
    if (headers.length < 5) {
      sheet.getRange(1, 5).setValue('Edit Flag');
      sheet.getRange(1, 6).setValue('Edited At');
    }

    // Find row by date
    const dateStr = String(date).trim();
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === dateStr) { foundRow = i + 1; break; }
    }

    if (foundRow < 0) throw new Error('DPR row not found for date: ' + dateStr);

    const now = new Date().toLocaleString('en-IN');
    sheet.getRange(foundRow, 3).setValue(editedText);
    sheet.getRange(foundRow, 5).setValue('Manually Edited');
    sheet.getRange(foundRow, 6).setValue(now);

    return jsonResponse({ success: true });
  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}


// ═══════════════════════════════════════════════════════════════
//  READ HELPERS
// ═══════════════════════════════════════════════════════════════

function readTab(ss, tabName, fieldNames) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1).map(function(row) {
    const obj = {};
    fieldNames.forEach(function(f, i) {
      obj[f] = row[i] !== undefined ? String(row[i]) : '';
    });
    return obj;
  });
}

function readTabRaw(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(function(row) {
    const obj = {};
    headers.forEach(function(h, i) {
      const key = String(h).toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      obj[key] = row[i] !== undefined ? String(row[i]) : '';
      obj[h] = obj[key]; // also keep original header key
    });
    return obj;
  });
}


// ═══════════════════════════════════════════════════════════════
//  GEMINI — MULTI-CLIP CALL
// ═══════════════════════════════════════════════════════════════

function generateWithGemini(audioPayload, systemPrompt, project, dateFormatted) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const safeAudioPayload = sanitizeAudioPayload(audioPayload);

  let response = fetchGeminiContent(url, buildGeminiPayload(safeAudioPayload, systemPrompt, project, dateFormatted, true));
  if (response.getResponseCode() !== 200) {
    const body = response.getContentText();
    if (response.getResponseCode() === 400 && body.indexOf('INVALID_ARGUMENT') > -1) {
      Logger.log('Gemini rejected request with system_instruction. Retrying with prompt in user content.');
      response = fetchGeminiContent(url, buildGeminiPayload(safeAudioPayload, systemPrompt, project, dateFormatted, false));
    }
  }

  if (response.getResponseCode() !== 200) {
    throw new Error(formatGeminiError(response.getContentText()));
  }

  const result = JSON.parse(response.getContentText());
  return result.candidates[0].content.parts[0].text.trim();
}

function fetchGeminiContent(url, payload) {
  return UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function buildGeminiPayload(audioPayload, systemPrompt, project, dateFormatted, useSystemInstruction) {
  const parts = audioPayload.map(function(clip) {
    return { inline_data: { mime_type: clip.mime, data: clip.base64 } };
  });
  const contextText = `Project: ${project}\nDate: ${dateFormatted}\nNumber of audio clips: ${audioPayload.length}\n\nListen to all clips in order. If a later clip corrects something in an earlier clip, use the correction. Synthesize all information into one output.`;

  if (useSystemInstruction) {
    parts.push({ text: contextText });
    return {
      contents: [{ parts: parts }],
      system_instruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.2, maxOutputTokens: 1500 }
    };
  }

  parts.push({ text: systemPrompt + '\n\n' + contextText });
  return {
    contents: [{ parts: parts }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1500 }
  };
}

function sanitizeAudioPayload(audioPayload) {
  if (!Array.isArray(audioPayload)) {
    throw new Error('Audio payload is missing or invalid.');
  }

  const safePayload = audioPayload.map(function(clip) {
    const base64 = clip && clip.base64 ? String(clip.base64).replace(/\s+/g, '') : '';
    const mime = normalizeAudioMimeType(clip && clip.mime);
    if (!base64 || !mime) return null;
    return { base64: base64, mime: mime };
  }).filter(function(clip) {
    return clip && clip.base64.length > 32;
  });

  if (!safePayload.length) {
    throw new Error('No valid audio clips were found. Please re-record the update and try again.');
  }

  return safePayload;
}

function normalizeAudioMimeType(mime) {
  const rawMime = String(mime || '').toLowerCase();
  if (rawMime.indexOf('audio/webm') === 0) return 'audio/webm';
  if (rawMime.indexOf('audio/ogg') === 0) return 'audio/ogg';
  if (rawMime.indexOf('audio/mp4') === 0 || rawMime.indexOf('audio/m4a') === 0) return 'audio/mp4';
  if (rawMime.indexOf('audio/mpeg') === 0 || rawMime.indexOf('audio/mp3') === 0) return 'audio/mpeg';
  if (rawMime.indexOf('audio/wav') === 0 || rawMime.indexOf('audio/x-wav') === 0) return 'audio/wav';
  return rawMime || '';
}

function parseStructuredResponse(rawResponse) {
  const marker = '---JSON---';
  const text = String(rawResponse || '');
  const markerIndex = text.indexOf(marker);
  let whatsappText = text;
  let jsonText = '';

  if (markerIndex > -1) {
    whatsappText = text.slice(0, markerIndex);
    jsonText = text.slice(markerIndex + marker.length);
  } else {
    const sectionTwoMatch = text.match(/\n\s*SECTION\s*2\b[\s\S]*?(\{[\s\S]*\})\s*$/i);
    const trailingJsonMatch = !sectionTwoMatch ? text.match(/(\{[\s\S]*\})\s*$/) : null;
    const extractedJson = sectionTwoMatch ? sectionTwoMatch[1] : (trailingJsonMatch ? trailingJsonMatch[1] : '');
    if (extractedJson) {
      jsonText = extractedJson;
      whatsappText = text.slice(0, text.lastIndexOf(extractedJson));
    }
  }

  whatsappText = cleanVisibleReportText(whatsappText);

  jsonText = jsonText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return { whatsappText: whatsappText, jsonText: jsonText };
}

function cleanVisibleReportText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/^\s*SECTION\s*1\b[^\n]*\n?/gim, '')
    .replace(/\n+\s*SECTION\s*2\b[\s\S]*$/i, '')
    .replace(/\n+\s*---JSON---[\s\S]*$/i, '')
    .trim();
}

function formatGeminiError(responseText) {
  try {
    const parsed = JSON.parse(responseText);
    const error = parsed && parsed.error ? parsed.error : null;
    if (error && error.code === 400) {
      return 'The audio upload could not be processed. Please delete any clip that looks blank or shows 0:00, then record it again.';
    }
    if (error && error.message) {
      return 'Gemini error: ' + error.message;
    }
  } catch (err) {
    // Fall through to raw text below.
  }
  return 'Gemini error: ' + responseText;
}


// ═══════════════════════════════════════════════════════════════
//  SHEET TAB HELPERS — AUTO-CREATE PER PROJECT
// ═══════════════════════════════════════════════════════════════

function getOrCreateTab(ss, tabName, headers, columnWidths) {
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  ensureSheetHeaders(sheet, headers, columnWidths);
  return sheet;
}

function ensureSheetHeaders(sheet, headers, columnWidths) {
  const currentMaxCols = Math.max(sheet.getMaxColumns(), 1);
  if (currentMaxCols < headers.length) {
    sheet.insertColumnsAfter(currentMaxCols, headers.length - currentMaxCols);
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (columnWidths) {
    columnWidths.forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  }
}

function sanitizeTabName(project) {
  return project.replace(/[^a-zA-Z0-9 ]/g, '').trim();
}


// ═══════════════════════════════════════════════════════════════
//  DAILY REPORT LOGGER → [Project] — DPR + MASTER
// ═══════════════════════════════════════════════════════════════

function logToDPR(project, dateFormatted, dpr) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tabName = sanitizeTabName(project) + ' — DPR';

  const sheet = getOrCreateTab(ss, tabName,
    ['Date', 'Project', 'Formatted Report', 'Logged At'],
    [100, 140, 500, 160]
  );
  sheet.appendRow([dateFormatted, project, dpr, new Date().toLocaleString('en-IN')]);

  // MASTER tab aggregation
  const master = getOrCreateTab(ss, 'MASTER',
    ['Date', 'Project', 'Formatted Report', 'Logged At'],
    [100, 140, 500, 160]
  );
  master.appendRow([dateFormatted, project, dpr, new Date().toLocaleString('en-IN')]);
}


// ═══════════════════════════════════════════════════════════════
//  WEEKLY UPDATE LOGGER → [Project] — Timeline
// ═══════════════════════════════════════════════════════════════

function logToTimeline(project, dateFormatted, updates, reportDateInput) {
  if (!updates || updates.length === 0) return;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tabName = sanitizeTabName(project) + ' — Timeline';
  const reportDate = normalizeTimelineDate(reportDateInput || dateFormatted);
  const reportToken = formatTimelineToken(reportDate);
  const sheet = getOrCreateTab(ss, tabName, TIMELINE_HEADERS, TIMELINE_WIDTHS);

  updates.forEach(function(update) {
    const loggedAt = new Date().toLocaleString('en-IN');
    undoTimelineReportTokenForActivity(sheet, update.activity, reportToken);

    let rowMatch = findTimelineRowMatch(sheet, update.activity);
    let existingRow = rowMatch ? rowMatch.rowNumber : 0;
    let rowData = rowMatch ? rowMatch.rowData : null;
    const beforeSnapshot = createTimelineSnapshot(existingRow, rowData);

    let finalRowNumber = existingRow;
    let finalRowData = rowData;

    if (existingRow) {
      finalRowData = applyTimelineUpdateToRowData(rowData, update, reportDate, dateFormatted, loggedAt);
      writeTimelineRow(sheet, existingRow, finalRowData);
    } else {
      finalRowData = createTimelineRowDataForNewActivity(update, reportDate, dateFormatted, loggedAt);
      sheet.appendRow(finalRowData);
      finalRowNumber = sheet.getLastRow();
    }

    const history = parseTimelineAIHistory(finalRowData[TIMELINE_COL.AI_HISTORY]);
    history.push({
      token: reportToken,
      report_date: reportToken,
      activity_key: normalizeTimelineActivityKey(update.activity),
      applied_at: loggedAt,
      before: beforeSnapshot
    });
    finalRowData[TIMELINE_COL.AI_LAST_TOKEN] = reportToken;
    finalRowData[TIMELINE_COL.AI_HISTORY] = stringifyTimelineAIHistory(history);
    writeTimelineRow(sheet, finalRowNumber, finalRowData);
  });
}

function applyTimelineUpdateToRowData(rowData, update, reportDate, dateFormatted, loggedAt) {
  const nextRow = cloneTimelineRowData(rowData);
  const plannedStartDate = normalizeTimelineDate(rowData[TIMELINE_COL.PLANNED_START]);
  const inferredStartDelayDays = inferTimelineStartDelayDays(update, reportDate, plannedStartDate);
  const currentStatus = normalizeTimelineStatus(update.status, inferredStartDelayDays);
  const currentSlippage = Number(rowData[TIMELINE_COL.SLIPPAGE]) || 0;
  const delayDays = Math.max(Number(update.delay_days) || 0, inferredStartDelayDays);
  const plannedEndDate = normalizeTimelineDate(rowData[TIMELINE_COL.PLANNED_END]);
  const currentEndDateRaw = normalizeTimelineDate(rowData[TIMELINE_COL.CURRENT_END]);
  let currentEndDate = currentEndDateRaw || plannedEndDate;

  if (delayDays > 0) {
    const baselineEndDate = latestTimelineDate(currentEndDate, plannedEndDate);
    const anchorDate = latestTimelineDate(baselineEndDate, reportDate);
    if (anchorDate) {
      currentEndDate = addTimelineDays(anchorDate, delayDays);
    }
  } else if (reportDate && (currentStatus === 'completed' || currentStatus === 'in_progress' || currentStatus === 'on_track')) {
    currentEndDate = latestTimelineDate(currentEndDate, reportDate) || reportDate;
  }

  const currentEnd = currentEndDate ? formatDate(currentEndDate) : (rowData[TIMELINE_COL.CURRENT_END] || rowData[TIMELINE_COL.PLANNED_END] || '');
  const newSlippage = calculateTimelineSlippage(currentSlippage, plannedEndDate, currentEndDate, delayDays);
  let delayLog = String(rowData[TIMELINE_COL.DELAY_LOG] || '');
  if (delayDays > 0) {
    const reason = buildTimelineDelayReason(update, inferredStartDelayDays);
    const entry = inferredStartDelayDays > 0 && (!update.delay_days || Number(update.delay_days) <= 0)
      ? `① ${dateFormatted} START DELAYED +${delayDays}d — ${reason}`
      : `① ${dateFormatted} +${delayDays}d — ${reason}`;
    delayLog = delayLog ? delayLog + '\n' + entry : entry;
  }

  nextRow[TIMELINE_COL.CURRENT_END] = currentEnd || rowData[TIMELINE_COL.CURRENT_END];
  nextRow[TIMELINE_COL.STATUS] = currentStatus;
  nextRow[TIMELINE_COL.SLIPPAGE] = newSlippage;
  nextRow[TIMELINE_COL.DELAY_LOG] = delayLog;
  nextRow[TIMELINE_COL.LAST_UPDATED] = loggedAt;
  return nextRow;
}

function createTimelineRowDataForNewActivity(update, reportDate, dateFormatted, loggedAt) {
  let delayLog = '';
  const inferredStartDelayDays = inferTimelineStartDelayDays(update, reportDate, null);
  const currentStatus = normalizeTimelineStatus(update.status, inferredStartDelayDays);
  const delayDays = Math.max(Number(update.delay_days) || 0, inferredStartDelayDays);
  let currentEnd = '';
  if (delayDays > 0 && reportDate) {
    currentEnd = formatDate(addTimelineDays(reportDate, delayDays));
  } else if (reportDate && currentStatus === 'completed') {
    currentEnd = formatDate(reportDate);
  }
  if (delayDays > 0) {
    const reason = buildTimelineDelayReason(update, inferredStartDelayDays);
    delayLog = inferredStartDelayDays > 0 && (!update.delay_days || Number(update.delay_days) <= 0)
      ? `① ${dateFormatted} START DELAYED +${delayDays}d — ${reason}`
      : `① ${dateFormatted} +${delayDays}d — ${reason}`;
  }

  return [
    update.activity || '',
    '',
    '',
    currentEnd,
    currentStatus,
    delayDays,
    delayLog,
    loggedAt,
    '',
    '',
    '',
    ''
  ];
}

function undoTimelineReportTokenForActivity(sheet, activityName, reportToken) {
  let rowMatch = findTimelineRowMatch(sheet, activityName);
  if (!rowMatch) return;
  const history = parseTimelineAIHistory(rowMatch.rowData[TIMELINE_COL.AI_HISTORY]);
  const indices = [];
  history.forEach(function(entry, index) {
    if (entry && entry.token === reportToken) indices.push(index);
  });
  if (!indices.length) return;
  revertTimelineHistoryEntries(sheet, rowMatch.rowNumber, indices);
}

function revertTimelineHistoryEntries(sheet, rowNumber, indices) {
  let currentRow = rowNumber;
  let rowData = currentRow ? readTimelineRow(sheet, currentRow) : null;
  let history = parseTimelineAIHistory(rowData ? rowData[TIMELINE_COL.AI_HISTORY] : '');
  const ordered = indices.slice().sort(function(a, b) { return b - a; });

  ordered.forEach(function(index) {
    if (!rowData || index < 0 || index >= history.length) return;
    const entry = history[index];
    history.splice(index, 1);
    const before = entry && entry.before ? entry.before : { exists: true, row: rowData.slice(0, TIMELINE_HEADERS.length) };

    if (before.exists === false) {
      sheet.deleteRow(currentRow);
      currentRow = 0;
      rowData = null;
      history = [];
      return;
    }

    rowData = ensureTimelineRowLength(before.row || []);
    rowData[TIMELINE_COL.AI_LAST_TOKEN] = history.length ? history[history.length - 1].token : '';
    rowData[TIMELINE_COL.AI_HISTORY] = stringifyTimelineAIHistory(history);
    writeTimelineRow(sheet, currentRow, rowData);
  });

  return { rowNumber: currentRow, rowData: rowData, history: history };
}

function normalizeTimelineDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function latestTimelineDate(a, b) {
  if (a && b) return a.getTime() >= b.getTime() ? a : b;
  return a || b || null;
}

function addTimelineDays(date, days) {
  if (!date) return null;
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + Number(days || 0));
  next.setHours(0, 0, 0, 0);
  return next;
}

function daysBetweenTimelineDates(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
}

function calculateTimelineSlippage(currentSlippage, plannedEndDate, currentEndDate, delayDays) {
  if (plannedEndDate && currentEndDate) {
    return Math.max(currentSlippage, Math.max(0, daysBetweenTimelineDates(plannedEndDate, currentEndDate)));
  }
  return currentSlippage + Math.max(0, Number(delayDays) || 0);
}

function inferTimelineStartDelayDays(update, reportDate, plannedStartDate) {
  if (!reportDate || (plannedStartDate && plannedStartDate.getTime() > reportDate.getTime())) {
    return 0;
  }

  const explicitDate = normalizeTimelineDate(update && update.new_work_date);
  if (explicitDate && explicitDate.getTime() > reportDate.getTime()) {
    return daysBetweenTimelineDates(reportDate, explicitDate);
  }

  const text = [
    update && update.new_work_starting,
    update && update.new_work_date,
    update && update.reason
  ].filter(Boolean).join(' ').toLowerCase();

  if (!text) return 0;

  const rangeMatch = text.match(/(\d+)\s*[-–]\s*(\d+)\s*days?/);
  if (rangeMatch) return Number(rangeMatch[1]) || 0;

  const daysMatch = text.match(/(\d+)\s*days?/);
  if (daysMatch) return Number(daysMatch[1]) || 0;

  if (/\bnext week\b/.test(text)) return 7;

  return 0;
}

function buildTimelineDelayReason(update, inferredStartDelayDays) {
  if (update && update.reason) return update.reason;
  if (inferredStartDelayDays > 0) {
    if (update && update.new_work_date) return `Work now expected ${update.new_work_date}`;
    if (update && update.new_work_starting) return update.new_work_starting;
    return 'Work start pushed out';
  }
  return 'No reason specified';
}

function normalizeTimelineStatus(status, inferredStartDelayDays) {
  const normalized = String(status || '').toLowerCase().trim().replace(/\s+/g, '_');
  if (inferredStartDelayDays > 0) {
    return 'delayed';
  }
  if (normalized === 'on_track' || normalized === 'delayed' || normalized === 'completed' || normalized === 'in_progress' || normalized === 'not_started') {
    return normalized;
  }
  if (normalized === 'paused') {
    return 'delayed';
  }
  return normalized || 'not_started';
}

function formatTimelineToken(date) {
  const safeDate = normalizeTimelineDate(date);
  if (!safeDate) return '';
  const yyyy = safeDate.getFullYear();
  const mm = String(safeDate.getMonth() + 1).padStart(2, '0');
  const dd = String(safeDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeTimelineActivityKey(value) {
  let text = String(value || '').toLowerCase();
  text = text.replace(/&/g, ' and ');
  text = text.replace(/\bwindows\b/g, 'window');
  text = text.replace(/\blights\b/g, 'light');
  text = text.replace(/\btouchups\b/g, 'touchup');
  text = text.replace(/\btouch-up\b/g, 'touchup');
  text = text.replace(/\bsanitary fitting\b/g, 'sanitary work');
  text = text.replace(/\bgym area mirror\b/g, 'gym area mirror wall');
  text = text.replace(/[^a-z0-9]+/g, ' ');
  return text.trim().replace(/\s+/g, ' ');
}

function tokenizeTimelineActivity(value) {
  return normalizeTimelineActivityKey(value).split(' ').filter(Boolean);
}

function timelineActivitySimilarity(a, b) {
  const aTokens = tokenizeTimelineActivity(a);
  const bTokens = tokenizeTimelineActivity(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = {};
  const bSet = {};
  aTokens.forEach(function(token) { aSet[token] = true; });
  bTokens.forEach(function(token) { bSet[token] = true; });
  let intersection = 0;
  Object.keys(aSet).forEach(function(token) {
    if (bSet[token]) intersection++;
  });
  const union = Object.keys(aSet).length + Object.keys(bSet).length - intersection;
  return union ? intersection / union : 0;
}

function findTimelineRowMatch(sheet, activityName) {
  const targetKey = normalizeTimelineActivityKey(activityName);
  if (!targetKey) return null;
  const data = sheet.getDataRange().getValues();
  let best = null;
  for (let i = 1; i < data.length; i++) {
    const rowName = data[i][TIMELINE_COL.ACTIVITY];
    if (!rowName) continue;
    const rowKey = normalizeTimelineActivityKey(rowName);
    if (rowKey === targetKey) {
      return { rowNumber: i + 1, rowData: ensureTimelineRowLength(data[i]) };
    }
    const score = timelineActivitySimilarity(targetKey, rowKey);
    if (!best || score > best.score) {
      best = { rowNumber: i + 1, rowData: ensureTimelineRowLength(data[i]), score: score };
    }
  }
  return best && best.score >= 0.6 ? { rowNumber: best.rowNumber, rowData: best.rowData } : null;
}

function ensureTimelineRowLength(row) {
  const nextRow = row.slice(0, TIMELINE_HEADERS.length);
  while (nextRow.length < TIMELINE_HEADERS.length) nextRow.push('');
  return nextRow;
}

function cloneTimelineRowData(row) {
  return ensureTimelineRowLength(row || []);
}

function readTimelineRow(sheet, rowNumber) {
  return ensureTimelineRowLength(sheet.getRange(rowNumber, 1, 1, TIMELINE_HEADERS.length).getValues()[0]);
}

function writeTimelineRow(sheet, rowNumber, rowData) {
  sheet.getRange(rowNumber, 1, 1, TIMELINE_HEADERS.length).setValues([ensureTimelineRowLength(rowData)]);
}

function parseTimelineAIHistory(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function stringifyTimelineAIHistory(history) {
  return history && history.length ? JSON.stringify(history) : '';
}

function createTimelineSnapshot(rowNumber, rowData) {
  if (!rowNumber || !rowData) return { exists: false };
  return { exists: true, row: ensureTimelineRowLength(rowData).slice(0, TIMELINE_HEADERS.length) };
}

function resetTimelineAIFn(project, mode, resetDate) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const safeProject = sanitizeTabName(project || '');
    if (!safeProject) throw new Error('Project name required');

    const sheet = ss.getSheetByName(safeProject + ' — Timeline');
    if (!sheet) throw new Error('Timeline tab not found');

    let targetToken = resetDate ? formatTimelineToken(resetDate) : '';
    if (mode === 'from_date' && !targetToken) throw new Error('Reset date required');

    if (mode === 'latest') {
      targetToken = findLatestTimelineAIToken(sheet);
      if (!targetToken) {
        return jsonResponse({ success: true, rowsReset: 0, rowsDeleted: 0, rowsSkipped: 0, message: 'No tracked AI timeline updates found.' });
      }
    }

    let rowsReset = 0;
    let rowsDeleted = 0;
    let rowsSkipped = 0;

    for (let row = sheet.getLastRow(); row >= 2; row--) {
      let rowData = readTimelineRow(sheet, row);
      if (String(rowData[TIMELINE_COL.MANUAL_OVERRIDE] || '').toUpperCase() === 'YES') {
        rowsSkipped++;
        continue;
      }

      const history = parseTimelineAIHistory(rowData[TIMELINE_COL.AI_HISTORY]);
      if (!history.length) continue;

      const indices = [];
      history.forEach(function(entry, index) {
        if (!entry || !entry.token) return;
        if (mode === 'latest') {
          if (entry.token === targetToken) indices.push(index);
        } else if (entry.token >= targetToken) {
          indices.push(index);
        }
      });

      if (!indices.length) continue;

      const beforeLastRow = sheet.getLastRow();
      const result = revertTimelineHistoryEntries(sheet, row, indices);
      if (!result || !result.rowNumber) rowsDeleted++;
      rowsReset++;

      if (sheet.getLastRow() < beforeLastRow) {
        // Row deleted; current loop runs bottom-up so no extra handling needed.
      }
    }

    return jsonResponse({
      success: true,
      rowsReset: rowsReset,
      rowsDeleted: rowsDeleted,
      rowsSkipped: rowsSkipped,
      message: mode === 'latest'
        ? `Undid tracked AI timeline update dated ${targetToken} on ${rowsReset} row(s).`
        : `Reset tracked AI timeline updates from ${targetToken} onward on ${rowsReset} row(s).`
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function findLatestTimelineAIToken(sheet) {
  const data = sheet.getDataRange().getValues();
  let latestToken = '';
  for (let i = 1; i < data.length; i++) {
    const history = parseTimelineAIHistory(ensureTimelineRowLength(data[i])[TIMELINE_COL.AI_HISTORY]);
    history.forEach(function(entry) {
      if (entry && entry.token && entry.token > latestToken) latestToken = entry.token;
    });
  }
  return latestToken;
}


// ═══════════════════════════════════════════════════════════════
//  MATERIAL LOG → [Project] — Materials
// ═══════════════════════════════════════════════════════════════

function logToMaterials(project, dateFormatted, data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tabName = sanitizeTabName(project) + ' — Materials';

  const headers = [
    'Date', 'Material', 'Area', 'Qty Received', 'Condition',
    'Damage Detail', 'Qty Pending', 'Pending Reason', 'Expected Date', 'Supplier', 'Logged At'
  ];
  const sheet = getOrCreateTab(ss, tabName, headers,
    [100, 160, 140, 100, 90, 200, 100, 180, 110, 140, 160]
  );

  sheet.appendRow([
    dateFormatted,
    data.material     || '',
    data.area         || '',
    data.qty_received || '',
    data.condition    || '',
    data.damage_detail  || '',
    data.qty_pending    || '',
    data.pending_reason || '',
    data.expected_date  || '',
    data.supplier       || '',
    new Date().toLocaleString('en-IN')
  ]);
}


// ═══════════════════════════════════════════════════════════════
//  UTIL
// ═══════════════════════════════════════════════════════════════

function formatDate(d) {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function jsonResponse(obj) {
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
