const $ = (id) => document.getElementById(id);
const editor = $('json');
const statusEl = $('status');
const applyBtn = $('apply');
const catchBtn = $('catch');

let running = false;
let poller = null;
let modeTouched = false;   // once the user picks, stop auto-selecting over them
let caught = null;         // the last payload read off the page
let sessionTabId = null;   // the tab this panel session belongs to
const catching = new Set(); // tabs with a catch still under way

// A catch swaps the result for shimmering placeholders; a fill covers the panel
// and locks the form until it finishes.
function showSkeleton(on) {
  $('skeleton').hidden = !on;
  if (on) $('result').hidden = true;
}

function showBusy(on, text) {
  $('busy').hidden = !on;
  if (text) $('busyText').textContent = text;
  for (const id of ['catch', 'json', 'result']) $(id).classList.toggle('locked', on);
  document.querySelector('.bottom').classList.toggle('locked', on);
}

/* ---------- tabs ----------
   Catching and filling are separate jobs, and each view owns the full height,
   so the open tab is the only thing that scrolls. */

const TABS = [['tabCatch', 'viewCatch'], ['tabInput', 'viewInput']];

function showTab(which) {
  for (const [tabId, viewId] of TABS) {
    const on = tabId === which;
    $(tabId).setAttribute('aria-selected', String(on));
    $(viewId).hidden = !on;
  }
  save();
}

function activeTabId() {
  return TABS.find(([tabId]) => $(tabId).getAttribute('aria-selected') === 'true')?.[0] || 'tabCatch';
}

for (const [tabId] of TABS) {
  $(tabId).addEventListener('click', () => showTab(tabId));
}

const modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));

function selectedMode() {
  return modeRadios.find((r) => r.checked)?.value || null;
}

function setMode(value) {
  for (const r of modeRadios) r.checked = r.value === value;
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab.');
  if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(tab.url || '')) {
    throw new Error('This page cannot be scripted by extensions. Open the criteria page first.');
  }
  return tab;
}

// Inject on demand (activeTab) rather than running on every page. Try talking to
// an already-injected worker first so polling does not re-inject every time.
// A job that takes a while must keep talking to the tab it began on, not to
// whichever tab happens to be in front by the time it answers.
async function send(message, tabId = null) {
  const id = tabId ?? (await activeTab()).id;
  let res;
  try {
    res = await chrome.tabs.sendMessage(id, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    res = await chrome.tabs.sendMessage(id, message);
  }
  if (!res) throw new Error('No response from the page.');
  if (!res.ok) throw new Error(res.error);
  return res;
}

/* ---------- the caught result ---------- */

const LABELS = {
  sector: 'Sector',
  occupation: 'Occupation',
  tier: 'Tier',
  areasOfFocus: 'Areas of Focus of Feedback',
  onetOccupation: 'O*NET Occupation',
  onetTasks: 'O*NET Tasks',
  onetSkills: 'O*NET Skills'
};

// One plain-text block, in the order the fields are asked for.
//
// Sector and its neighbours lead. They are the one short line that says which
// task this is, and behind a page of reviewer notes and failed checks that line
// was being scrolled past unread.
function renderContent(c) {
  const out = [];
  const block = (title, body) => {
    if (body === null || body === undefined || body === '') return;
    out.push(`${title}\n${'-'.repeat(title.length)}\n${body}\n`);
  };

  const head = [];
  for (const key of ['sector', 'occupation', 'tier', 'areasOfFocus']) {
    if (c[key]) head.push(`${LABELS[key]}: ${c[key]}`);
  }
  if (head.length) out.push(head.join('\n') + '\n');

  // A block caught before every check answered should say so on its face,
  // wherever it is pasted, rather than looking like a finished reading.
  if (c.pendingChecks?.length) {
    block('Checks still waiting when this was caught', c.pendingChecks.join('\n'));
  }

  if (c.taskNotes?.length) {
    const notes = c.taskNotes
      .map((n) => `[${n.title}${n.time ? ` - ${n.time}` : ''}]\n${n.text}`)
      .join('\n\n');
    block('Task notes', notes);
  }

  if (c.errors?.length) {
    const errs = c.errors
      .map((e) => (e.label ? `[${e.label}]\n` : '') + e.text)
      .join('\n\n');
    block('Failed checks', errs);
  }

  block('Prompt', c.prompt);

  if (c.criteria?.length) {
    const rows = c.criteria
      .map((x) => `${x.n}. (weight ${x.weight ?? '-'}) ${x.criterion || '(empty)'}`)
      .join('\n');
    block(`Criteria (${c.criteria.length})`, rows);
  }

  const onet = [];
  for (const key of ['onetOccupation', 'onetTasks', 'onetSkills']) {
    if (c[key]) onet.push(`${LABELS[key]}: ${c[key]}`);
  }
  if (onet.length) block('O*NET', onet.join('\n'));

  for (const f of c.fields || []) {
    const v = String(f.value);
    // Keep one-liners on the label line; give longer answers their own block.
    if (v.length <= 60 && !v.includes('\n')) out.push(`${f.label}: ${v}\n`);
    else block(f.label, v);
  }

  return out.join('\n').trim();
}

// Local time, stamped when the catch happened rather than when it is redrawn,
// so a restored session still shows when it was taken.
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function showResult(data) {
  caught = data;
  $('skeleton').hidden = true;
  $('uidValue').textContent = data.uid || '(no UID on this page)';
  // The content opens with the UID and the time it was caught, so a pasted
  // block identifies itself without the UID box beside it.
  const header = `${data.uid || '(no UID)'}_${data.caughtAt || stamp()}`;
  $('contentValue').textContent = [header, renderContent(data.content || {})]
    .filter(Boolean).join('\n\n');
  $('result').hidden = false;
}

/* ---------- reading what was pasted ----------
   People paste the criteria fragment on its own - `"criteria": [ … ]` with the
   outer braces left behind, sometimes without the closing bracket. Rather than
   refuse it, try the strict reading first and fall back to the obvious repairs. */

// Append whatever brackets are still open, ignoring anything inside a string.
function closeBrackets(text) {
  const want = [];
  let inString = false;
  let escaped = false;

  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') want.push('}');
    else if (ch === '[') want.push(']');
    else if (ch === '}' || ch === ']') want.pop();
  }
  return text + want.reverse().join('');
}

function parseInput(text) {
  const raw = text.trim();
  if (!raw) throw new Error('Paste some criteria JSON first.');

  // Close what is open first, then wrap: wrapping a fragment whose bracket is
  // still open would put the brace on the wrong side of it.
  const tries = [];
  for (const base of [raw, closeBrackets(raw)]) {
    tries.push(base);
    // A fragment starting at the key needs the object put back around it.
    if (!base.startsWith('{') && !base.startsWith('[')) tries.push(`{${base}}`);
  }
  tries.push(...tries.map((t) => t.replace(/,\s*([}\]])/g, '$1'))); // trailing commas

  for (const candidate of tries) {
    try { return JSON.parse(candidate); } catch { /* try the next repair */ }
  }
  JSON.parse(raw); // nothing worked: report the original complaint
}

// navigator.clipboard is missing or throws outside a secure context, so keep the
// old selection trick as a fallback rather than failing silently.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

async function copyPart(partEl, text, what) {
  if (!text) return setStatus(`No ${what} to copy.`, 'err');
  if (!(await copyText(text))) return setStatus(`Could not copy the ${what}.`, 'err');
  partEl.classList.add('copied');   // swaps the copy icon for a tick
  setTimeout(() => partEl.classList.remove('copied'), 1000);
  setStatus(`${what} copied to clipboard.`, 'ok');
}

for (const [id, get, what] of [
  ['uidPart', () => caught?.uid, 'UID'],
  ['contentPart', () => $('contentValue').textContent, 'Content']
]) {
  const el = $(id);
  el.addEventListener('click', () => copyPart(el, get(), what));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyPart(el, get(), what); }
  });
}

/* ---------- catch ---------- */

function updateBadge(res) {
  $('pageInfo').textContent = res.hasContainer
    ? `${res.count} section${res.count === 1 ? '' : 's'}`
    : 'no criteria found';

  const found = res.detected?.mode;
  if (found && !modeTouched) {
    setMode(found);
    $('modeHint').textContent = `Detected from the page ${res.detected.source}.`;
  } else if (!found && !modeTouched) {
    $('modeHint').textContent = 'Could not tell from the page — pick one.';
  }
}

const MODE_NAME = { submission: 'Submission', review: 'Review', refinement: 'Refinement' };

for (const r of modeRadios) {
  r.addEventListener('change', () => {
    modeTouched = true;
    $('modeHint').textContent = `Set to ${MODE_NAME[r.value]} by hand.`;
    save();
  });
}

catchBtn.addEventListener('click', async () => {
  // A catch belongs to the tab it was started on, and it can easily outlast the
  // user's attention - waiting on the feedback checks alone takes minutes. So it
  // keeps talking to that tab, and everything it has to say at the end goes to
  // that tab's session. Painting a result over whichever tab happens to be in
  // front when the answer lands is how a page came to show a reading of some
  // other page, taken before its checks were in.
  let ranOn;
  try {
    ranOn = (await activeTab()).id;
  } catch (e) {
    return setStatus(e.message, 'err');
  }
  const mine = () => sessionTabId === ranOn;

  catching.add(ranOn);
  setStatus('Reading page…');
  showTab('tabCatch');
  showSkeleton(true);
  catchBtn.disabled = true;

  // The checks are answered by the server, so say what is being waited on.
  const watching = setInterval(async () => {
    try {
      const res = await send({ type: 'PING' }, ranOn);
      const c = res.checkProgress;
      if (c && mine()) setStatus(`Running the feedback checks — ${c.index} of ${c.total} answered…`);
    } catch { /* the next tick tries again */ }
  }, 900);

  try {
    const { data, meta } = await send({
      type: 'EXTRACT',
      options: { mode: selectedMode(), runChecks: $('runChecks').checked }
    }, ranOn);
    data.caughtAt = stamp();

    if (mine()) {
      showResult(data);
      save();
    } else {
      // File it under the tab it came from, so it is waiting there on return.
      await saveCaughtFor(ranOn, data);
    }

    const c = data.content || {};
    const extras = [];
    if (c.taskNotes) extras.push(`${c.taskNotes.length} task note${c.taskNotes.length === 1 ? '' : 's'}`);
    if (c.sector) extras.push('sector');
    if (c.tier) extras.push('tier');
    if (c.fields) extras.push(`${c.fields.length} fields`);
    if (c.errors) extras.push(`${c.errors.length} failed check${c.errors.length === 1 ? '' : 's'}`);

    const fromRubric = meta?.criteriaSource === 'provided rubrics';
    if (meta?.checksSkipped === 'refinement task not written yet') {
      extras.push('checks skipped, the task is not written yet');
    }
    let msg = `Caught ${data.criteria.length} criteria${extras.length ? `, plus ${extras.join(', ')}` : ''}.`;
    if (fromRubric) msg += '\nThe criteria list was empty, so these came from Provided Rubrics.';
    // Only meaningful when the criteria came off the form itself.
    const short = fromRubric ? 0 : (meta?.sections ?? data.criteria.length) - data.criteria.length;
    if (short > 0) msg += `\n${short} section${short === 1 ? '' : 's'} would not open and stayed empty.`;
    // Never let a reading that went ahead without every answer pass for a full one.
    const waiting = meta?.checks?.waiting || [];
    if (waiting.length) {
      msg += `\nRead before ${waiting.length} check${waiting.length === 1 ? '' : 's'} answered: `
        + `${waiting.join(', ')}. Catch again once they land.`;
    }
    if (mine()) {
      setStatus(msg, short > 0 || waiting.length ? '' : 'ok');
      refresh();
    }
  } catch (e) {
    if (mine()) setStatus(e.message, 'err');
  } finally {
    clearInterval(watching);
    catching.delete(ranOn);
    if (mine()) {
      catchBtn.disabled = false;
      showSkeleton(false);
    }
  }
});

/* ---------- type into page ---------- */

function setRunning(on) {
  running = on;
  applyBtn.textContent = on ? 'Stop' : ($('entry').value === 'type' ? 'Type into page' : 'Paste into page');
  applyBtn.classList.toggle('stop', on);
  catchBtn.disabled = on;
  editor.readOnly = on;

  clearInterval(poller);
  poller = on ? setInterval(pollProgress, 400) : null;
}

// Each browser tab has its own page worker, and that worker is the authority on
// whether a run is going. The panel shows one tab at a time, so the run state on
// screen must come from whichever tab is showing - never from a run started
// somewhere else.
function applyRunState(res) {
  const p = res.progress;
  if (res.busy) {
    if (!running) setRunning(true);
    showBusy(true, p ? `${p.phase} criterion ${p.index} of ${p.total}…` : 'Working…');
    if (p) setStatus(`${p.phase} ${p.index}/${p.total}…`);
  } else {
    if (running) setRunning(false);
    showBusy(false);
  }
}

async function pollProgress() {
  const asked = sessionTabId;
  try {
    const res = await send({ type: 'PING' });
    // A reply about the tab we have just left must not paint this one.
    if (sessionTabId !== asked) return;
    updateBadge(res);
    applyRunState(res);
  } catch { /* page navigating; the next tick retries */ }
}

applyBtn.addEventListener('click', async () => {
  if (running) {
    try { await send({ type: 'CANCEL' }); } catch { /* already gone */ }
    setStatus('Stopping…');
    return;
  }

  let parsed;
  try {
    parsed = parseInput(editor.value);
  } catch (e) {
    setStatus(`Invalid JSON: ${e.message}`, 'err');
    return;
  }

  const speed = Number($('speed').value);
  const verbing = $('entry').value === 'type' ? 'Typing' : 'Pasting';
  const ranOn = sessionTabId; // the run belongs to this browser tab alone
  showTab('tabInput');
  setRunning(true);
  setStatus(`${verbing}…`);
  showBusy(true, `${verbing} into the page…`);

  try {
    const { result } = await send({
      type: 'APPLY',
      data: parsed,
      options: {
        speed,
        entry: $('entry').value,
        gap: Number($('gap').value),
        removeExtras: $('removeExtras').checked
      }
    });

    const verb = $('entry').value === 'type' ? 'Typed' : 'Pasted';
    let msg = `${verb} ${result.filled} of ${result.requested} criteria`;
    msg += result.added ? ` (added ${result.added} new section${result.added === 1 ? '' : 's'}).` : '.';
    if (result.ranInBackground) {
      msg += '\nPart of this ran while the tab was behind, which Chrome slows down.';
    }
    if (result.extrasLeft) {
      msg += `\n${result.extrasLeft} extra section${result.extrasLeft === 1 ? '' : 's'} `
        + 'could not be deleted — the page did not remove them.';
    }
    if (result.skippedFields.length) msg += `\nNo field for: ${result.skippedFields.join(', ')}`;
    if (result.truncated.length) msg += `\nCut to the field limit: ${result.truncated.join(', ')}`;

    const clean = result.filled === result.requested
      && !result.skippedFields.length && !result.truncated.length;
    if (sessionTabId === ranOn) setStatus(msg, clean ? 'ok' : '');
  } catch (e) {
    if (sessionTabId === ranOn) setStatus(e.message, e.message === 'Stopped.' ? '' : 'err');
  } finally {
    // If the user moved to another tab meanwhile, that tab's view is not ours
    // to clear - it is showing its own state.
    if (sessionTabId === ranOn) {
      showBusy(false);
      setRunning(false);
      refresh();
    }
  }
});

/* ---------- side buttons ---------- */

$('copyJson').addEventListener('click', async () => {
  if (!caught) return setStatus('Catch something first.', 'err');
  const ok = await copyText(JSON.stringify(caught, null, 2));
  setStatus(ok ? 'JSON copied to clipboard.' : 'Could not copy the JSON.', ok ? 'ok' : 'err');
});

$('download').addEventListener('click', () => {
  if (!caught) return setStatus('Catch something first.', 'err');
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(caught, null, 2)], { type: 'application/json' })
  );
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `criteria-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  setStatus('Downloaded.', 'ok');
});

$('toInput').addEventListener('click', () => {
  if (!caught) return setStatus('Catch something first.', 'err');
  // Written in the numbered shape the input box shows as its template.
  const rows = caught.criteria.map((c, i) => ({ [i + 1]: c.criterion, weight: c.weight }));
  editor.value = JSON.stringify({ criteria: rows }, null, 2);
  save();
  showTab('tabInput');
  setStatus('Criteria copied into the input box.', 'ok');
});

$('busyStop').addEventListener('click', () => applyBtn.click());

$('loadFile').addEventListener('click', () => $('file').click());

$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  editor.value = await file.text();
  save();
  setStatus(`Loaded ${file.name}.`, 'ok');
  e.target.value = '';
});

$('format').addEventListener('click', () => {
  try {
    editor.value = JSON.stringify(parseInput(editor.value), null, 2);
    save();
    setStatus('Formatted.', 'ok');
  } catch (e) {
    setStatus(`Invalid JSON: ${e.message}`, 'err');
  }
});

$('clear').addEventListener('click', () => {
  editor.value = '';
  save();
  setStatus('');
});

/* ---------- per-tab session ----------
   State is filed under the tab it came from, in session storage so it dies with
   the browser session. Switching tabs swaps the whole session: a tab that has
   not been caught yet opens empty. */

const store = chrome.storage.session ?? chrome.storage.local;
const stateKey = () => `tab:${sessionTabId}`;

function save() {
  if (sessionTabId === null) return;
  store.set({
    [stateKey()]: {
      json: editor.value,
      speed: $('speed').value,
      entry: $('entry').value,
      gap: $('gap').value,
      runChecks: $('runChecks').checked,
      tab: activeTabId(),
      removeExtras: $('removeExtras').checked,
      mode: selectedMode(),
      caught
    }
  });
}

// A catch that finishes after the user has moved on still has somewhere to go:
// straight into the originating tab's stored session, without disturbing the
// session on screen.
async function saveCaughtFor(tabId, data) {
  const key = `tab:${tabId}`;
  const bag = await store.get(key);
  await store.set({ [key]: { ...(bag[key] || {}), caught: data } });
}

async function loadSession(tabId) {
  sessionTabId = tabId;
  modeTouched = false;

  const bag = await store.get(stateKey());
  const s = bag[stateKey()] || {};

  editor.value = s.json || '';
  $('speed').value = s.speed || '22';
  $('entry').value = s.entry || 'paste';
  $('gap').value = s.gap || '2000';
  $('runChecks').checked = s.runChecks !== false;
  $('removeExtras').checked = s.removeExtras !== false;
  setMode(s.mode || null);
  $('modeHint').textContent = '';

  if (s.caught) {
    showResult(s.caught);
  } else {
    caught = null;
    $('result').hidden = true;
  }

  setRunning(false);
  showBusy(false); // a run belongs to the tab that started it, not to this view
  // A catch started on this tab may still be running - it owns the button and
  // the placeholders until it answers.
  const stillCatching = catching.has(tabId);
  catchBtn.disabled = stillCatching;
  showSkeleton(stillCatching);
  setStatus(stillCatching ? 'Reading page…' : '');
  // Last, because showTab saves: everything above must already be this tab's.
  showTab(s.tab || 'tabCatch');
}

editor.addEventListener('input', save);
$('speed').addEventListener('change', save);
$('gap').addEventListener('change', save);
$('runChecks').addEventListener('change', save);
$('entry').addEventListener('change', () => { save(); if (!running) setRunning(false); });
$('removeExtras').addEventListener('change', save);

async function refresh() {
  const asked = sessionTabId;
  try {
    const res = await send({ type: 'PING' });
    if (sessionTabId !== asked) return; // switched again while we were asking
    updateBadge(res);
    // Picks up a run this tab started earlier, and clears the display of one
    // belonging to a tab we have just switched away from.
    applyRunState(res);
  } catch {
    $('pageInfo').textContent = 'page not ready';
  }
}

// The panel document can outlive a tab switch, so follow the active tab.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (tabId === sessionTabId) return;
  await loadSession(tabId);
  refresh();
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await loadSession(tab?.id ?? null);
  refresh();
})();
