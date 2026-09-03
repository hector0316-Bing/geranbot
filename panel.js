const $ = (id) => document.getElementById(id);
const editor = $('json');
const statusEl = $('status');
const applyBtn = $('apply');
const catchBtn = $('catch');

let running = false;
let poller = null;
let modeTouched = false; // once the user picks, stop auto-selecting over them
let caught = null;       // the last payload read off the page

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
async function send(message) {
  const tab = await activeTab();
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    res = await chrome.tabs.sendMessage(tab.id, message);
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
function renderContent(c) {
  const out = [];
  const block = (title, body) => {
    if (body === null || body === undefined || body === '') return;
    out.push(`${title}\n${'-'.repeat(title.length)}\n${body}\n`);
  };

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

  const head = [];
  for (const key of ['sector', 'occupation', 'tier', 'areasOfFocus']) {
    if (c[key]) head.push(`${LABELS[key]}: ${c[key]}`);
  }
  if (head.length) out.push(head.join('\n') + '\n');

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

function showResult(data) {
  caught = data;
  $('uidValue').textContent = data.uid || '(no UID on this page)';
  $('contentValue').textContent = renderContent(data.content || {}) || '(nothing captured)';
  $('result').hidden = false;
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
  partEl.classList.add('copied');
  setTimeout(() => partEl.classList.remove('copied'), 900);
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
  setStatus('Reading page…');
  try {
    const { data, meta } = await send({ type: 'EXTRACT', options: { mode: selectedMode() } });
    showResult(data);
    save();

    const c = data.content || {};
    const extras = [];
    if (c.taskNotes) extras.push(`${c.taskNotes.length} task note${c.taskNotes.length === 1 ? '' : 's'}`);
    if (c.sector) extras.push('sector');
    if (c.tier) extras.push('tier');
    if (c.fields) extras.push(`${c.fields.length} fields`);

    let msg = `Caught ${data.criteria.length} criteria${extras.length ? `, plus ${extras.join(', ')}` : ''}.`;
    const short = (meta?.sections ?? data.criteria.length) - data.criteria.length;
    if (short > 0) msg += `\n${short} section${short === 1 ? '' : 's'} would not open and stayed empty.`;
    setStatus(msg, short > 0 ? '' : 'ok');
    refresh();
  } catch (e) {
    setStatus(e.message, 'err');
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

async function pollProgress() {
  try {
    const res = await send({ type: 'PING' });
    updateBadge(res);
    if (res.busy && res.progress) {
      const p = res.progress;
      setStatus(`${p.phase} ${p.index}/${p.total}…`);
    } else if (!res.busy && running) {
      setRunning(false); // finished while the popup was closed
    }
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
    parsed = JSON.parse(editor.value);
  } catch (e) {
    setStatus(`Invalid JSON: ${e.message}`, 'err');
    return;
  }

  const speed = Number($('speed').value);
  setRunning(true);
  setStatus('Typing…');

  try {
    const { result } = await send({
      type: 'APPLY',
      data: parsed,
      options: { speed, entry: $('entry').value, removeExtras: $('removeExtras').checked }
    });

    const verb = $('entry').value === 'type' ? 'Typed' : 'Pasted';
    let msg = `${verb} ${result.filled} of ${result.requested} criteria`;
    msg += result.added ? ` (added ${result.added} new section${result.added === 1 ? '' : 's'}).` : '.';
    if (result.skippedFields.length) msg += `\nNo field for: ${result.skippedFields.join(', ')}`;
    if (result.truncated.length) msg += `\nCut to the field limit: ${result.truncated.join(', ')}`;

    const clean = result.filled === result.requested
      && !result.skippedFields.length && !result.truncated.length;
    setStatus(msg, clean ? 'ok' : '');
  } catch (e) {
    setStatus(e.message, e.message === 'Stopped.' ? '' : 'err');
  } finally {
    setRunning(false);
    refresh();
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
  setStatus('Criteria copied into the input box.', 'ok');
});

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
    editor.value = JSON.stringify(JSON.parse(editor.value), null, 2);
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

/* Keep the editor contents, the caught result and the options between openings. */
function save() {
  chrome.storage.local.set({
    json: editor.value,
    speed: $('speed').value,
    entry: $('entry').value,
    removeExtras: $('removeExtras').checked,
    mode: selectedMode(),
    caught
  });
}

editor.addEventListener('input', save);
$('speed').addEventListener('change', save);
$('entry').addEventListener('change', () => { save(); if (!running) setRunning(false); });
$('removeExtras').addEventListener('change', save);

async function refresh() {
  try {
    const res = await send({ type: 'PING' });
    updateBadge(res);
    // Typing started before the popup was last closed is still going.
    if (res.busy && !running) setRunning(true);
  } catch {
    $('pageInfo').textContent = 'page not ready';
  }
}

(async () => {
  const stored = await chrome.storage.local.get(['json', 'speed', 'entry', 'removeExtras', 'mode', 'caught']);
  if (stored.json) editor.value = stored.json;
  if (stored.speed) $('speed').value = stored.speed;
  if (stored.entry) $('entry').value = stored.entry;
  if (stored.removeExtras === false) $('removeExtras').checked = false;
  // Last session's choice shows immediately; detection overrides it a tick later.
  if (stored.mode) setMode(stored.mode);
  if (stored.caught) showResult(stored.caught);
  setRunning(false); // label the action button for the restored entry mode
  refresh();
})();
