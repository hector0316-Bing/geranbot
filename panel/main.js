/* Criteria Catcher - side panel: running it.

   Tabs, the project chooser, talking to the page, the Catch and Type buttons,
   and the per-tab session. Everything a project words or does differently is
   asked of its entry in PROJECTS, so nothing here names a project.

   Loaded last: needs panel/core.js and the project files. */

const editor = $('json');
const statusEl = $('status');
const applyBtn = $('apply');
const catchBtn = $('catch');

let running = false;
let poller = null;
let caught = null;         // the last payload read off the page
let sessionTabId = null;   // the tab this panel session belongs to
let project = null;        // which project this tab's task belongs to
let likely = null;         // what the page itself looks like, if it says
const catching = new Set(); // tabs with a catch still under way

// The page-side files, in the order they must load: shared code first, each
// project, then the messaging that looks the projects up.
const PAGE_SCRIPTS = [
  'content/core.js',
  'content/geranium.js',
  'content/rudder.js',
  'content/terminus.js',
  'content/copperhead.js',
  'content/main.js'
];

// The project a caught payload belongs to. Geranium's payloads predate the
// field and carry none.
const projectOf = (data) => PROJECTS[data?.project] || PROJECTS.geranium;

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
  // A project with nothing to type in has no Input tab to be on.
  if (PROJECTS[project]?.readOnly) which = 'tabCatch';
  for (const [tabId, viewId] of TABS) {
    const on = tabId === which;
    $(tabId).setAttribute('aria-selected', String(on));
    // Neither view is open while the project is still being chosen.
    $(viewId).hidden = !on || !project;
  }
  save();
}

function activeTabId() {
  return TABS.find(([tabId]) => $(tabId).getAttribute('aria-selected') === 'true')?.[0] || 'tabCatch';
}

for (const [tabId] of TABS) {
  $(tabId).addEventListener('click', () => showTab(tabId));
}

/* ---------- which project the tab is for ----------
   The projects are different pages, with different forms and nothing in
   common to fill in. Guessing which is which is how the wrong reader comes to
   run on a page, so the panel asks - once per tab, with whichever the page
   already looks like marked, so the answer is usually a confirmation rather
   than a decision. */

function markLikely() {
  for (const card of document.querySelectorAll('.pick-card')) {
    card.classList.toggle('likely', likely?.project === card.dataset.project);
  }
  $('pickHint').textContent = likely?.project
    ? `This page looks like ${PROJECTS[likely.project].name}, from ${likely.source}.`
    : 'Nothing on the page says which — pick one.';
}

// Everything the two projects word differently lives in PROJECTS, so switching
// is a matter of reading it out rather than of hiding things one at a time.
function setProject(value) {
  project = value || null;
  document.body.dataset.project = project || '';

  $('viewProject').hidden = !!project;
  $('tabs').hidden = !project;
  $('projectChip').hidden = !project;
  $('mismatch').hidden = true; // re-decided on the next reading of the page

  if (project) {
    const p = PROJECTS[project];
    $('projectName').textContent = p.name;
    catchBtn.textContent = p.catch;
    $('toInput').textContent = p.toInput || '';
    editor.placeholder = p.placeholder || '';
  } else {
    markLikely();
  }
  showTab(activeTabId()); // closes both views while the chooser is up, and saves
}

function pickProject(chosen) {
  // A project whose answers go into a form a person fills in by hand starts
  // on typing rather than pasting.
  const entry = PROJECTS[chosen]?.entry;
  if (entry && project !== chosen) {
    $('entry').value = entry;
    if (!running) setRunning(false); // the button says which of the two it does
  }
  setProject(chosen);
  refresh(); // the badge and the hints belong to the new project, not the old
}

for (const card of document.querySelectorAll('.pick-card')) {
  card.addEventListener('click', () => {
    pickProject(card.dataset.project);
    setStatus('');
  });
}

// The chip is the way back. It carries a caret pointing the way it goes, so it
// reads as a control rather than as a label saying which project this is.
$('projectChip').addEventListener('click', () => {
  if (running) return setStatus('Stop the run first.', 'err');
  setProject(null);
  setStatus('');
  refresh(); // the badge belonged to the project just left
});

// Picking the wrong project is easy and ordinary, so correcting it is one press
// rather than a trip back through the chooser.
$('switchProject').addEventListener('click', () => {
  const to = $('switchProject').dataset.project;
  if (!to) return;
  if (running) return setStatus('Stop the run first.', 'err');
  pickProject(to);
  setStatus(`Switched to ${PROJECTS[to].name}.`, 'ok');
});

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
    await chrome.scripting.executeScript({ target: { tabId: id }, files: PAGE_SCRIPTS });
    res = await chrome.tabs.sendMessage(id, message);
  }
  if (!res) throw new Error('No response from the page.');
  if (!res.ok) throw new Error(res.error);
  return res;
}

/* ---------- the caught result ---------- */

function showResult(data) {
  caught = data;
  $('skeleton').hidden = true;
  $('uidValue').textContent = data.uid || '(no UID on this page)';
  // The content opens with the UID and the time it was caught, so a pasted
  // block identifies itself without the UID box beside it.
  const header = `${data.uid || '(no UID)'}_${data.caughtAt || stamp()}`;
  const p = projectOf(data);
  $('contentValue').textContent = [header, p.render(data)].filter(Boolean).join('\n\n');

  const answers = p.answers?.(data);
  $('answersValue').textContent = answers ? answersJson(answers) : '';
  $('answersPart').hidden = !answers;
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
  ['contentPart', () => $('contentValue').textContent, 'Content'],
  ['answersPart', () => $('answersValue').textContent, 'Answers']
]) {
  const el = $(id);
  el.addEventListener('click', () => copyPart(el, get(), what));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyPart(el, get(), what); }
  });
}

/* ---------- catch ---------- */

function updateBadge(res) {
  likely = res.project?.project ? res.project : null;

  if (!project) {
    $('pageInfo').textContent = likely
      ? `looks like ${PROJECTS[likely.project].name}`
      : 'page not recognised';
    markLikely();
    return;
  }

  // Picking the wrong project reads nothing and fills nothing, and an empty
  // result never says why. So when the page disagrees with the choice, say so
  // on a line of its own, with the switch to press on it.
  const other = likely?.project && likely.project !== project ? likely.project : null;
  $('mismatch').hidden = !other;
  if (other) {
    $('mismatchText').textContent = `This page looks like a ${PROJECTS[other].name} task.`;
    $('switchProject').textContent = `Switch to ${PROJECTS[other].name}`;
    $('switchProject').dataset.project = other;
  }

  $('pageInfo').textContent = PROJECTS[project].badge(res);
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
      options: { project, ...PROJECTS[project].catchOptions?.() }
    }, ranOn);
    data.caughtAt = stamp();

    // Whatever sat in the input box was written against the last reading, so a
    // fresh catch empties it rather than leave a stale answer to be typed in.
    if (mine()) {
      showResult(data);
      editor.value = '';
      save();
    } else {
      // File it under the tab it came from, so it is waiting there on return.
      await saveCaughtFor(ranOn, data);
    }

    const { msg, kind } = projectOf(data).catchStatus(data, meta);
    if (mine()) {
      setStatus(msg, kind);
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
    showBusy(true, p ? (p.text || `${p.phase} ${p.unit || 'criterion'} ${p.index} of ${p.total}…`) : 'Working…');
    if (p) setStatus(p.text || `${p.phase} ${p.index}/${p.total}…`);
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
  const p = PROJECTS[project];
  if (p?.readOnly) return setStatus(`${p.name} is only read from.`, 'err');

  let parsed;
  try {
    parsed = parseInput(editor.value);
  } catch (e) {
    setStatus(`Invalid JSON: ${e.message}`, 'err');
    return;
  }

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
        project,
        speed: Number($('speed').value),
        entry: $('entry').value,
        gap: Number($('gap').value),
        ...p.applyOptions?.()
      }
    });

    const { msg, clean } = p.applyStatus(result);
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
  const p = projectOf(caught);
  if (p.readOnly) return setStatus(`A ${p.name} task has nothing to type back in.`, 'err');
  editor.value = p.toInputText(caught);
  save();
  showTab('tabInput');
  setStatus(PROJECTS[project]?.copied || 'Copied into the input box.', 'ok');
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
   not been caught yet opens empty. Each project keeps its own settings in the
   same record. */

const store = chrome.storage.session ?? chrome.storage.local;

const stateKey = () => `tab:${sessionTabId}`;

function save() {
  if (sessionTabId === null) return;
  const own = Object.assign({}, ...Object.values(PROJECTS).map((p) => p.saveState?.() || {}));
  store.set({
    [stateKey()]: {
      ...own,
      json: editor.value,
      speed: $('speed').value,
      entry: $('entry').value,
      gap: $('gap').value,
      project,
      tab: activeTabId(),
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
  await store.set({ [key]: { ...(bag[key] || {}), caught: data, json: '' } });
}

async function loadSession(tabId) {
  sessionTabId = tabId;

  const bag = await store.get(stateKey());
  const s = bag[stateKey()] || {};

  editor.value = s.json || '';
  // A Pace saved before the values changed matches no option, and an
  // unmatched select reads as nothing - no delay at all - so fall back to Human.
  $('speed').value = s.speed || '200';
  if (!$('speed').value) $('speed').value = '200';
  $('entry').value = s.entry || 'paste';
  $('gap').value = s.gap || '2000';
  for (const p of Object.values(PROJECTS)) p.loadState?.(s);
  // Before the result is drawn: which project it is decides how it is read.
  likely = null;
  setProject(s.project || null);

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
$('entry').addEventListener('change', () => { save(); if (!running) setRunning(false); });

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
