/* Criteria Catcher - page side, shared by every project.

   Timing and staying awake while the tab is behind, the run state Stop and the
   panel's progress read, task notes, the "Check feedback" buttons, reading a
   form field, typing and pasting into one, opening accordions, and the
   "are you sure?" step.

   The page-side files are injected together, in the order the panel lists
   them (core, form, the projects, main), as classic scripts into the
   extension's isolated world. They share one global scope, so what one file
   declares at the top level the next can use. */

// Each project file registers its reader and filler here; main.js looks them
// up by name.
const PAGE_PROJECTS = {};

const CONTAINER = '[data-testid="repeatable-criteria"]';
const INSTANCE = '[data-testid^="repeatable-criteria-instance-"]';

let busy = false;
let cancelled = false;
let progress = null;
let checkProgress = null; // set while the feedback checks are being awaited
let hiddenDuringRun = false; // the tab went behind while we were working

const sleepHere = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- staying awake while the tab is behind ----------
   Slow timers were only half of it. Chrome also freezes a background tab
   outright, and a frozen page runs no script at all - which is exactly what a
   fill that stops dead when the user changes tab, and carries on untouched
   when they come back, looks like from the outside.

   Chrome will not freeze a page that is holding a Web Lock, so a run takes one
   out and holds it until it finishes. The pacing below leans on the service
   worker, and a worker with nothing to do is shut down, so an open port is
   held for the same stretch to give it a reason to stay. Both are dropped the
   moment the run ends: neither outlives the work it is protecting. */

let awake = 0;          // runs currently asking to stay awake
let releaseLock = null; // resolves the promise the Web Lock is held by
let keepPort = null;
let portOpenedAt = 0;

function openPort() {
  try {
    keepPort = chrome.runtime.connect({ name: 'keepalive' });
    keepPort.onDisconnect.addListener(() => { keepPort = null; });
    portOpenedAt = Date.now();
  } catch {
    keepPort = null; // the worker is restarting; the next renewal tries again
  }
}

// Chrome closes a port that has been open a few minutes, and closing it takes
// away the worker's reason to stay alive, so it is replaced before then.
function renewPort() {
  if (!awake) return;
  if (keepPort && Date.now() - portOpenedAt < 240000) return;
  try { keepPort?.disconnect(); } catch { /* already gone */ }
  openPort();
}

function stayAwake() {
  if (awake++) return;
  openPort();

  // The lock is held for as long as the callback's promise is unsettled, so
  // hold on to its resolver. A run can finish before the lock is granted, so
  // a release asked for early is remembered and applied on arrival.
  let releasedEarly = false;
  releaseLock = () => { releasedEarly = true; };
  // Shared, so two tabs of the same site can each hold it: an exclusive lock
  // would leave the second run queued behind the first and unprotected.
  navigator.locks?.request('criteria-catcher-run', { mode: 'shared' }, () => new Promise((done) => {
    if (releasedEarly) return done();
    releaseLock = done;
  })).catch(() => { /* locks unavailable: the worker pacing still applies */ });
}

function letSleep() {
  if (awake > 0) awake--;
  if (awake) return;
  releaseLock?.();
  releaseLock = null;
  try { keepPort?.disconnect(); } catch { /* already gone */ }
  keepPort = null;
}

// Chrome clamps this page's timers once the tab is behind - to about one a
// second, and to one a minute after a few minutes hidden - so a fill driven by
// setTimeout crawls and then appears to stop. The extension's service worker
// is not a tab and keeps proper time, so hand the waiting to it and let the
// reply wake us; messages reach a hidden page without being clamped.
//
// A clamped local timer would cost about a second anyway, so short waits are
// rounded up rather than made into a message each.
async function wait(ms) {
  if (document.hidden && ms > 0) {
    renewPort();
    try {
      await chrome.runtime.sendMessage({ type: 'SLEEP', ms: Math.max(ms, 250) });
      return;
    } catch {
      // The worker is asleep or restarting; a clamped timer still beats stopping.
    }
  }
  return sleepHere(ms);
}

// How long to wait on the page before calling something a failure.
//
// Chrome slows a hidden tab's timers, and the page's own re-render runs on
// those same timers - so a section that mounts in half a second in front can
// take many seconds behind. Judging it by the foreground budget declares a
// failure that never happened, and the caller throws, ending the run. The
// budget therefore grows the moment the tab goes behind, and because that can
// happen mid-wait it is re-checked on every pass.
const HIDDEN_PATIENCE = 8;

async function until(fn, { timeout = 5000, step = 50 } = {}) {
  const start = Date.now();
  let budget = timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (document.hidden) {
      budget = Math.max(budget, timeout * HIDDEN_PATIENCE);
      hiddenDuringRun = true;
    }
    if (Date.now() - start > budget) return null;
    await wait(step);
  }
}

function checkCancelled() {
  if (cancelled) throw new Error('Stopped.');
}

// How long the page is given to settle after a structural click - opening a
// section, adding one, confirming a delete, waiting on a newly mounted field.
//
// These used to stand at a fixed 120ms whatever the run was paced at, which
// made Gap a setting about one pause out of several: the fields were spaced
// out while every click around them still came as fast as the browser could
// fire it. A page that validates and autosaves between steps wants the room
// in both places, so the two move together - pace the run slower and every
// step in it is given more room.
const SETTLE = 120; // the default, and what a catch keeps to
let settleMs = SETTLE;

function settleFor(gap) {
  // A sixth of the gap, never below the old fixed wait and capped so the
  // clicks cannot become the slowest part of a run.
  return Math.min(900, Math.max(SETTLE, Math.round(gap / 6)));
}

// A long wait in one piece would leave Stop unresponsive for its whole length,
// so sit out the gap in slices and check between them.
//
// Counting slices would be wrong: Chrome clamps timers in a hidden tab to
// roughly one a second, so twenty 100ms slices become twenty seconds once the
// user looks at another tab. Work to a deadline instead - then a slow slice
// simply overshoots the end and the gap still lasts about as long as asked.
async function pause(ms) {
  const until = Date.now() + ms;
  for (;;) {
    checkCancelled();
    const left = until - Date.now();
    if (left <= 0) return;
    await wait(Math.min(150, left));
  }
}

/* ---------- page identity: heading and UID ---------- */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function headingText() {
  const h1 = document.querySelector('h1.text-2xl-semibold') || document.querySelector('h1');
  return (h1?.textContent || '').replace(/\s+/g, ' ').trim();
}

function readUid() {
  const label = Array.from(document.querySelectorAll('div, span, dt, label'))
    .find((el) => /^uid:?$/i.test((el.textContent || '').trim()));
  if (!label) {
    const m = (document.body.innerText || '').match(new RegExp(`UID:?\\s*(${UUID.source})`, 'i'));
    return m ? m[1] : null;
  }
  const value = (label.nextElementSibling?.textContent
    || (label.parentElement?.textContent || '').replace(/^\s*UID:?\s*/i, '')).trim();
  return value.match(UUID)?.[0] || value || null;
}

/* ---------- task notes ----------
   Read the same way on every project that has them: accordions headed by who
   left the note and when, or the notes sidebar of the document-review layout. */

// Task notes are accordions outside the criteria list: "Automated feedback",
// "Reviewer feedback", "Reviewer note", "Rebuttal note".
const NOTE_TITLE = /feedback|note|rebuttal/i;

// The header reads "Reviewer Feedback9/2/26, 4:15 AM" as one run of text: the
// label lives in its own truncating span, the timestamp in a sibling.
function noteHeading(btn) {
  const full = (btn.textContent || '').replace(/\s+/g, ' ').trim();
  const label = btn.querySelector('span.truncate');
  if (!label) return { title: full, time: null };
  const title = (label.textContent || '').replace(/\s+/g, ' ').trim();
  const rest = full.startsWith(title) ? full.slice(title.length).trim() : '';
  return { title: title || full, time: rest || null };
}

// Note timestamps read "9/2/26, 5:54 PM". Parsed by hand rather than left to
// Date, which is free to read 9/2 either way round.
function noteWhen(time) {
  const m = (time || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return 0;
  const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  let hour = Number(m[4]);
  const half = (m[6] || '').toUpperCase();
  if (half === 'PM' && hour !== 12) hour += 12;
  if (half === 'AM' && hour === 12) hour = 0;
  return new Date(year, Number(m[1]) - 1, Number(m[2]), hour, Number(m[5])).getTime();
}

// The one note of a set to read: newest by timestamp, or the first of them
// when none carries a timestamp at all.
function newestOf(notes) {
  let best = null;
  let bestWhen = -1;
  for (const n of notes) {
    const when = noteWhen(n.time);
    if (when > bestWhen) { bestWhen = when; best = n; }
  }
  return best;
}

// The newest note on the page. Only a timestamped note can be the newest one:
// Refinement carries some of its feedback as headed blocks with no time
// against them, so a page can have no newest note at all.
function markLatest(notes) {
  const best = newestOf(notes.filter((n) => noteWhen(n.time)));
  if (best) best.latest = true;
  return best;
}

// "Automated feedback" on Submission and Review, "AutoEval Feedback" on
// Refinement: one machine run under two names.
const AUTO_NOTE = /automated|auto-?\s*eval/i;

// An automated run says which kind of run it was in its own words - a clean
// one is the standing "All checks have passed", a dirty one names what
// failed. Its timestamp does not say, because a passing run can carry one
// too, so the verdict is read from the message and never from the clock.
function autoVerdict(text) {
  const t = text || '';
  if (/\bfail(ed|ing|ure|s)?\b|\bdid not pass\b|\bnot passed\b/i.test(t)) return 'failed';
  if (/\bpass(ed|es|ing)?\b/i.test(t)) return 'passed';
  return null;
}

// The note accordions were Radix and are now base-ui, which marks its triggers
// only with aria-controls/aria-expanded, so either kind counts. Radix also
// tags checkboxes as collection items, but those carry no aria-expanded and
// their text never reads as a note title.
const NOTE_TRIGGER = 'button[data-radix-collection-item], button[aria-controls][aria-expanded]';

async function readNotes() {
  const out = [];
  for (const btn of document.querySelectorAll(NOTE_TRIGGER)) {
    if (btn.closest(INSTANCE)) continue; // criteria sections are handled separately
    if (btn.closest('[data-testid^="field-"]')) continue; // a form field, not a note

    const { title, time } = noteHeading(btn);
    if (!title || !NOTE_TITLE.test(title)) continue;

    if (btn.getAttribute('data-state') === 'closed' || btn.getAttribute('aria-expanded') === 'false') {
      btn.click();
      await wait(120);
    }

    const id = btn.getAttribute('aria-controls');
    const region = (id && document.getElementById(id))
      || btn.closest('[data-state]')?.querySelector('[role="region"]');
    // A form section can be titled like a note ("Terminal bench 3.0 task
    // feedback"), but a note never holds form fields.
    if (region?.querySelector('[data-testid^="field-"]')) continue;
    let text = (region?.innerText || region?.textContent || '').trim();

    // The automated note ends with a question of its own - "Do you disagree
    // with the automated feedback?" - which is a box to tick, not feedback.
    const asks = [];
    for (const box of region ? region.querySelectorAll('[role="checkbox"]') : []) {
      const label = (box.innerText || box.textContent || '').replace(/\s+/g, ' ').trim()
        || (box.getAttribute('aria-label') || '').trim();
      if (!label) continue;
      asks.push({ question: label, answer: box.getAttribute('aria-checked') === 'true' });
      if (text.endsWith(label)) text = text.slice(0, -label.length).trim();
    }
    if (!text) continue;

    // A failing automated run used to be dropped as noise. It is the opposite:
    // when the auto-evaluation does not pass it becomes the newest note on the
    // page, and it is the thing that says what state the task is actually in.

    const note = time ? { title, time, text } : { title, text };
    if (asks.length) note.asks = asks;
    out.push(note);
  }
  return out;
}

/* ---------- the "Check feedback" buttons ----------
   Each check field carries one button reading "Check feedback". Pressing it
   asks the server, and when the answer lands the button becomes "Clear
   feedback results" and a pass/fail panel appears beside it. Both of those
   say the check has finished. */

const CHECK_BUTTON = /^check\s+feedback\b/i;

// A check field is one carrying a "Check feedback" button. Most say so in
// their testid; the button itself is the authority where the testid does not,
// so a renamed wrapper cannot hide a check from the sweep.
function checkFields() {
  const out = [];
  for (const f of document.querySelectorAll('[data-testid^="field-"]')) {
    const byId = /feedbackbutton/i.test(f.getAttribute('data-testid') || '');
    const byButton = Array.from(f.querySelectorAll('button')).some((b) => CHECK_BUTTON.test(buttonText(b)));
    if (byId || byButton) out.push(f);
  }
  return out;
}

function checkRunButton(field) {
  return Array.from(field.querySelectorAll('button'))
    .find((b) => !b.disabled && CHECK_BUTTON.test(buttonText(b))) || null;
}

const RESULT_PANEL = '[class*="bg-success-subtle"], [class*="bg-error-subtle"], [class*="bg-warning-subtle"]';

function checkFinished(field) {
  if (field.querySelector(RESULT_PANEL)) return true;
  return Array.from(field.querySelectorAll('button'))
    .some((b) => /clear feedback/i.test(buttonText(b)));
}

// What each check said once its button was pressed. A result panel is a
// header - the check's own name and a PASS/FAIL badge - over the explanation,
// with thumbs-up/down buttons at the foot that are not part of the answer.
// One field can answer with several panels, one per sub-check.
function readCheckResults() {
  return checkPanels().map((p) => p.result);
}

// The same sweep, keeping each panel beside its reading so a failure can be
// scrolled to.
function checkPanels() {
  const out = [];
  const seen = new Set();
  for (const field of checkFields()) {
    if (field.closest(INSTANCE)) continue;
    const check = fieldLabel(field);
    for (const panel of field.querySelectorAll(RESULT_PANEL)) {
      if (seen.has(panel) || panel.parentElement?.closest(RESULT_PANEL)) continue;
      seen.add(panel);

      const [header, ...body] = Array.from(panel.children);
      const bits = Array.from(header?.querySelectorAll('div, span') || [])
        .filter((el) => !el.children.length)
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const verdict = bits.find((t) => /^(pass(ed)?|fail(ed)?|warn(ing)?|error)$/i.test(t)) || null;
      const name = bits.find((t) => t !== verdict && /\w/.test(t)) || null;
      const text = body
        .filter((el) => !el.querySelector('button') || (el.innerText || el.textContent || '').trim())
        .map((el) => blockText(el))
        .filter(Boolean)
        .join('\n\n');

      const passed = verdict
        ? /^pass/i.test(verdict)
        : /bg-success-subtle/.test(panel.className || '');
      const result = { check, passed };
      if (name && name.toLowerCase() !== check.toLowerCase()) result.name = name;
      if (verdict) result.verdict = verdict.toUpperCase();
      if (text) result.text = text;
      out.push({ field, panel, result });
    }
  }
  return out;
}

/* ---------- form fields ---------- */

// Every field renders as: label header, optional description, value area.
// The data-testid hashes ("field-code-194d3") are not stable, so match on the
// label text instead.
function fieldLabel(fieldEl) {
  const lab = fieldEl.querySelector('label');
  return (lab?.textContent || '')
    .replace(/\s+/g, ' ')
    .replace(/\(optional\)\s*$/i, '')
    .trim();
}

// Monaco keeps its own line elements, positions them by `top`, and puts the
// line numbers in a separate gutter. Only rendered lines exist in the DOM, so
// a long value can come back clipped to what is on screen.
function monacoText(root) {
  const lines = Array.from(root.querySelectorAll('.view-line'));
  if (!lines.length) return null;
  return lines
    .map((l) => ({ top: parseFloat(l.style.top) || 0, text: (l.innerText || '').replace(/ /g, ' ') }))
    .sort((a, b) => a.top - b.top)
    .map((l) => l.text)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;
}

function fieldValue(fieldEl) {
  // Auto-eval output renders as a plain <pre>.
  const pre = fieldEl.querySelector('pre');
  if (pre) return (pre.innerText || pre.textContent || '').trim() || null;

  // The self-containment summary is a Monaco editor whose textarea is empty,
  // and whose <select> holds a language name, not the value.
  if (fieldEl.querySelector('.monaco-editor')) return monacoText(fieldEl);

  // Multiselects render their picks as chip buttons with nothing between them,
  // so read the chips rather than the run-together text.
  if (/multiselect/i.test(fieldEl.getAttribute('data-testid') || '')) {
    const chips = Array.from(fieldEl.querySelectorAll('button'))
      .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && !/^add more/i.test(t));
    if (chips.length) return chips.join(', ');
  }

  const ta = fieldEl.querySelector('textarea');
  if (ta && ta.value.trim()) return ta.value.trim();

  const input = fieldEl.querySelector('input:not([type="file"])');
  if (input) {
    if (input.type === 'checkbox') return input.checked;
    const v = (input.value || '').trim();
    if (v) return input.type === 'number' ? Number(v) : v;
  }

  const sel = fieldEl.querySelector('select');
  if (sel && sel.value) return sel.value;

  // Otherwise read the rendered value area: the last child, once the label
  // header and the description are discounted.
  const kids = Array.from(fieldEl.children);
  const area = kids[kids.length - 1];
  if (!area || area.querySelector('label') || /_description_/.test(area.className)) return null;
  return (area.innerText || area.textContent || '').replace(/ /g, ' ').trim() || null;
}

function control(fieldEl) {
  return fieldEl.querySelector('textarea, input, select');
}

/* ---------- writing into a field ---------- */

// React keeps its own copy of an input's value, so a plain `el.value = x` is
// discarded on the next render. Go through the prototype setter instead: that
// desyncs React's value tracker, so the input event it hears counts as a real
// edit.
function nativeSet(ctl, str) {
  const proto = ctl instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : ctl instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(ctl, str); else ctl.value = str;
}

/* ---------- typing like a person ----------
   Nobody types at an even rate. Letters inside a word run together quickly,
   a space is a beat longer, a sentence ends and the next one is thought about,
   and now and then the next word is hesitated over. Fingers slip too: a key
   beside the one meant, or a letter struck twice - and the slip is usually
   seen a key or two later, deleted, and typed again.

   `base` is the Pace setting: the typical time between two keys, in ms. Every
   pause below is a multiple of it, so a slower Pace slows the whole hand.
   Whatever happens on the way, the field ends up holding exactly the text
   asked for. */

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

const TYPO_RATE = 0.03;      // slips per letter typed
const NOTICE_LATE = 0.6;     // a slip seen only after more keys have gone in
const THINK_RATE = 0.05;     // hesitating before a word

// The keys around each one on a QWERTY keyboard, where a finger lands when it
// misses.
const NEIGHBOURS = {
  q: 'wa', w: 'qeas', e: 'wrds', r: 'etdf', t: 'ryfg', y: 'tugh', u: 'yihj', i: 'uojk', o: 'ipkl', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk'
};

// What a slipping finger types in place of `ch`: a neighbouring key, kept in
// the same case, or the letter struck twice. Null where there is no slip to
// make - digits and punctuation are typed with more care.
function slipFor(ch) {
  const near = NEIGHBOURS[ch.toLowerCase()];
  if (!near) return null;
  if (Math.random() < 0.2) return ch + ch;
  const k = near[Math.floor(Math.random() * near.length)];
  return ch === ch.toLowerCase() ? k : k.toUpperCase();
}

// The gap after a key: quick inside a word, a beat longer at a space, a real
// stop after a sentence, a shorter one after a comma.
function keyDelay(base, ch, prev) {
  let d = base * rand(0.55, 1.35);
  if (/\w/.test(ch) && /\w/.test(prev || '')) d *= 0.85;
  if (ch === ' ') d += base * rand(0.2, 0.6);
  if (/[.!?]/.test(ch)) d += base * rand(3, 8);
  else if (/[,;:]/.test(ch)) d += base * rand(1, 2.5);
  return Math.max(1, Math.round(d));
}

// One key: down, the edit it makes, up. The edit is skipped where the value
// would not be assignable - a number input refuses a half-typed "-", "6." or
// "1e" - and lands with the next key instead, as in a real field.
function pressKey(ctl, buf, ch, numeric) {
  ctl.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
  const next = buf + ch;
  if (!numeric || (Number.isFinite(Number(next)) && !/[.eE+-]$/.test(next))) {
    ctl.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: ch
    }));
    nativeSet(ctl, next);
    try { ctl.setSelectionRange(next.length, next.length); } catch { /* number inputs */ }
    ctl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
  }
  ctl.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
  return next;
}

function pressBackspace(ctl, buf) {
  ctl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  const next = buf.slice(0, -1);
  ctl.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true, cancelable: true, inputType: 'deleteContentBackward', data: null
  }));
  nativeSet(ctl, next);
  try { ctl.setSelectionRange(next.length, next.length); } catch { /* number inputs */ }
  ctl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
  ctl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', bubbles: true }));
  return next;
}

async function typeInto(ctl, value, base) {
  const text = value === null || value === undefined ? '' : String(value);
  const max = ctl.maxLength > 0 ? ctl.maxLength : Infinity;
  const target = text.length > max ? text.slice(0, max) : text;

  ctl.scrollIntoView({ block: 'center' });
  ctl.focus({ preventScroll: true });
  await wait(base);
  await clearField(ctl, base);
  // A moment to read the question before the first key.
  await pause(base * rand(2, 6));

  // Track the intended text in a buffer rather than reading back ctl.value:
  // a number input sanitises a partial "-" to "", which would eat the sign.
  // Numbers and short answers are typed carefully, without slips.
  const numeric = ctl.type === 'number';
  const slips = !numeric && target.length >= 12;
  const chars = Array.from(target);
  let buf = '';
  let corrections = 0;

  for (let i = 0; i < chars.length; i++) {
    checkCancelled();
    const ch = chars[i];
    const prev = chars[i - 1];

    // Hesitating over the next word, now and then.
    if (prev === ' ' && /\w/.test(ch) && Math.random() < THINK_RATE) {
      await pause(base * rand(4, 12));
    }

    const slip = slips && Math.random() < TYPO_RATE ? slipFor(ch) : null;
    if (!slip) {
      buf = pressKey(ctl, buf, ch, numeric);
      await wait(keyDelay(base, ch, prev));
      continue;
    }

    // The slip goes in, and maybe a few right keys after it before it is seen.
    for (const k of slip) {
      buf = pressKey(ctl, buf, k, numeric);
      await wait(keyDelay(base, k, prev));
    }
    let carried = 0;
    if (Math.random() < NOTICE_LATE) {
      const more = Math.floor(rand(1, 4));
      while (carried < more && i + 1 + carried < chars.length && chars[i + 1 + carried] !== '\n') {
        const k = chars[i + 1 + carried];
        buf = pressKey(ctl, buf, k, numeric);
        await wait(keyDelay(base, k, chars[i + carried]));
        carried++;
      }
    }

    // Seen: a pause, back over everything since the slip, a breath, and on.
    await pause(base * rand(1.5, 4));
    for (let n = slip.length + carried; n > 0; n--) {
      checkCancelled();
      buf = pressBackspace(ctl, buf);
      await wait(Math.round(base * rand(0.35, 0.7)));
    }
    await wait(Math.round(base * rand(0.8, 1.8)));
    corrections++;
    i--; // type the intended key now
  }

  // The field must hold exactly what was asked for, however the typing went.
  if (!numeric && ctl.value !== target) {
    nativeSet(ctl, target);
    ctl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
  }

  ctl.dispatchEvent(new Event('change', { bubbles: true }));
  ctl.blur();
  return { typed: target.length, truncated: target.length < text.length, corrections };
}

// Clear the field the way selecting-all and deleting would.
async function clearField(ctl, base) {
  if (ctl.value === '') return;
  try { ctl.setSelectionRange(0, ctl.value.length); } catch { /* number inputs */ }
  ctl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  nativeSet(ctl, '');
  ctl.dispatchEvent(new InputEvent('input', {
    bubbles: true, inputType: 'deleteContentBackward', data: null
  }));
  await wait(base * 2);
}

// Drop the whole value in at once, as a paste does, rather than key by key.
// Still one field at a time, with a beat between them.
async function pasteInto(ctl, value, base) {
  const text = value === null || value === undefined ? '' : String(value);
  const max = ctl.maxLength > 0 ? ctl.maxLength : Infinity;
  const target = text.length > max ? text.slice(0, max) : text;

  ctl.scrollIntoView({ block: 'center' });
  ctl.focus({ preventScroll: true });
  await wait(base * 4);
  await clearField(ctl, base);

  ctl.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: target
  }));
  nativeSet(ctl, target);
  try { ctl.setSelectionRange(target.length, target.length); } catch { /* number inputs */ }
  ctl.dispatchEvent(new InputEvent('input', {
    bubbles: true, inputType: 'insertFromPaste', data: target
  }));
  ctl.dispatchEvent(new Event('change', { bubbles: true }));
  ctl.blur();

  return { typed: target.length, truncated: target.length < text.length };
}

// Checkboxes and selects have nothing to type into.
function setDiscrete(ctl, value) {
  if (ctl.type === 'checkbox') {
    if (ctl.checked !== Boolean(value)) ctl.click();
    return true;
  }
  nativeSet(ctl, value === null || value === undefined ? '' : String(value));
  ctl.dispatchEvent(new Event('input', { bubbles: true }));
  ctl.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/* ---------- accordion ---------- */

// Sections, criteria and notes are all Radix accordions, and a closed one has
// no content in the DOM at all, so everything has to be opened before the page
// can be read. Repeatedly: opening "Section 2" reveals the accordions nested
// inside it, which may themselves be closed.
//
// aria-expanded is what separates an accordion from the rest. The page puts
// data-radix-collection-item on checkbox and radio items too, and those carry
// data-state="unchecked" with no aria-expanded - clicking one would tick a box
// on the user's form. Menu buttons are skipped for the same reason.
async function expandEverything() {
  // Click each trigger at most once. A second click on one that has not
  // repainted yet would shut it again.
  const tried = new WeakSet();
  let opened = 0;

  for (let pass = 0; pass < 8; pass++) {
    const closed = Array.from(
      document.querySelectorAll('button[aria-expanded="false"]:not([aria-haspopup])')
    ).filter((b) => !b.disabled && !tried.has(b));
    if (!closed.length) break;

    for (const btn of closed) {
      tried.add(btn);
      btn.click();
      opened++;
      await wait(Math.round(settleMs / 2));
    }
    await wait(settleMs * 2); // let the newly mounted content settle
  }
  return opened;
}

/* ---------- buttons and the "are you sure?" step ---------- */

function buttonText(b) {
  return (b.textContent || '').replace(/\s+/g, ' ').trim();
}

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// Rank the buttons in a confirmation so the affirmative one is chosen, and a
// Cancel is never mistaken for it.
const DECLINE = /^(no|cancel|keep|back|close|dismiss)\b/i;

function confirmRank(t) {
  if (DECLINE.test(t)) return 99;
  if (/^yes\b/i.test(t)) return 0;
  if (/^(delete|remove)\b/i.test(t)) return 1;
  if (/^confirm\b/i.test(t)) return 2;
  if (/^ok$/i.test(t)) return 3;
  return 99;
}

function openDialog() {
  const boxes = document.querySelectorAll(
    '[role="alertdialog"], [role="dialog"], [aria-modal="true"]'
  );
  return Array.from(boxes).find(
    (d) => isVisible(d) && d.getAttribute('data-state') !== 'closed'
  ) || null;
}

// Deleting a section puts up a confirmation. Nothing is removed until its
// affirmative button is pressed, so press it.
async function confirmIfAsked(rank = confirmRank) {
  const dialog = await until(openDialog, { timeout: 1500, step: 60 });
  if (!dialog) return false;

  const choice = Array.from(dialog.querySelectorAll('button'))
    .filter((b) => !b.disabled && isVisible(b))
    .map((b) => ({ b, rank: rank(buttonText(b)) }))
    .filter((x) => x.rank < 99)
    .sort((a, b) => a.rank - b.rank)[0];

  if (!choice) return false;
  choice.b.click();
  await wait(settleMs);
  return true;
}

/* ---------- the document-review layout ----------
   Rudder, Copperhead and newer Geranium pages share it: the task on the left,
   a form of sections on the right, the notes in a sidebar of their own. */

const LEFT_PANEL = '[data-testid="document-review-left-panel"]';
const NOTES_PANEL = '[data-testid="collapsible-sidebar-panel"]';
const NOTES_TOGGLE = 'button[aria-label="task-notes"]';
const FIELD = '[data-testid^="field-"]';
const SECTION = '[data-testid^="section-"]';

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = (s) => oneLine(s).toLowerCase();

function blockText(el) {
  return (el?.innerText || el?.textContent || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Some option labels are kept as escaped HTML in an aria-label. Parsed in a
// document of its own rather than assigned to innerHTML, so nothing in the
// markup can load or run while we are only after the words.
function textOfMarkup(markup) {
  if (!markup) return '';
  if (!/[<&]/.test(markup)) return oneLine(markup);
  try {
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    return oneLine(doc.body.textContent);
  } catch {
    return oneLine(markup.replace(/<[^>]*>/g, ' '));
  }
}

// The notes sidebar can be shut, and a shut sidebar is not in the DOM at all,
// so nothing about the feedback can be read until its toggle is pressed.
async function openNotes() {
  if (document.querySelector(NOTES_PANEL)) return false;
  const btn = document.querySelector(NOTES_TOGGLE);
  if (!btn || btn.disabled) return false;
  btn.click();
  await until(() => document.querySelector(NOTES_PANEL), { timeout: 2500 });
  return true;
}

// Each note is an accordion headed by who left it and when. A reviewer's note
// carries a question of its own underneath - whether the annotator disagrees
// with it - and that question, answered or not, is part of what it says.
function readSidebarNotes() {
  const panel = document.querySelector(NOTES_PANEL);
  if (!panel) return [];

  const out = [];
  for (const btn of panel.querySelectorAll('button[aria-expanded]')) {
    const { title, time } = noteHeading(btn);
    if (!title) continue;

    const id = btn.getAttribute('aria-controls');
    const region = (id && document.getElementById(id))
      || btn.closest('[data-index]')?.querySelector('[role="region"]');
    if (!region) continue;

    const body = region.querySelector('[class*="whitespace-pre-line"]');
    let text = blockText(body || region);
    const asks = [];
    for (const box of region.querySelectorAll('[role="checkbox"]')) {
      const label = oneLine(box.innerText || box.textContent || '')
        || textOfMarkup(box.getAttribute('aria-label'));
      if (!label) continue;
      asks.push({ question: label, answer: box.getAttribute('aria-checked') === 'true' });
      // With no body of its own, the region's text ends with this question.
      if (!body && text.endsWith(label)) text = text.slice(0, -label.length).trim();
    }
    if (!text && !asks.length) continue;

    const note = time ? { title, time, text } : { title, text };
    if (asks.length) note.asks = asks;
    out.push(note);
  }
  markLatest(out);
  return out;
}
