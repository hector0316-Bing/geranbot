/* Criteria Catcher - page side: Geranium.

   The criteria and rubric pages - Submission, Review and Refinement. A catch
   reads the criteria list, the task notes, the sector and the rest of the
   form, pressing any "Check feedback" button not yet answered; a fill types the
   criteria back into the list, adding or deleting sections to match, and on a
   Refinement runs the two checks and submits when every check passes.

   Needs core.js. */

/* ---------- the criteria list ---------- */

function getContainer() {
  const el = document.querySelector(CONTAINER);
  if (el) return el;
  // Fallback: the list wrapper around whatever instances exist.
  const first = document.querySelector(INSTANCE);
  if (!first) return null;
  return first.parentElement?.parentElement || first.parentElement;
}

function idxOf(inst) {
  const m = (inst.getAttribute('data-testid') || '').match(/-(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function getInstances() {
  return Array.from(document.querySelectorAll(INSTANCE)).sort((a, b) => idxOf(a) - idxOf(b));
}

/* ---------- page type: Submission, Review, Refinement ---------- */

// Submission and Refinement pages share the heading "Submission"; only the
// blurb underneath tells them apart - "In this prompt generation project…"
// against "In this refinery project…".
function projectPhrase() {
  const el = Array.from(document.querySelectorAll('div.text-base-normal, p'))
    .find((d) => /in this\b.*\bproject\b/i.test(d.textContent || ''));
  const blurb = (el?.textContent || '').replace(/\s+/g, ' ').trim();

  // Fall back to the whole page when the blurb sits in some other wrapper.
  const text = /refinery project|prompt generation project/i.test(blurb)
    ? blurb
    : (document.body?.innerText || document.body?.textContent || '');

  // Refinement wins the tie: a refinement page shows the task it is revising,
  // so it can quote the submission wording, but never the other way round.
  if (/refinery project/i.test(text)) return 'refinement';
  if (/prompt generation project/i.test(text)) return 'submission';
  return null;
}

function detectMode() {
  const heading = headingText();
  const phrase = projectPhrase();

  if (/^review$/i.test(heading)) return { mode: 'review', source: 'heading' };

  if (/^submission$/i.test(heading)) {
    if (phrase) return { mode: phrase, source: 'blurb' };
    return { mode: 'submission', source: 'heading' };
  }

  if (/refine/i.test(heading)) return { mode: 'refinement', source: 'heading' };
  if (phrase) return { mode: phrase, source: 'blurb' };
  return { mode: null, source: 'unknown' };
}

function stripHeading(text, heading) {
  const h = (heading || '').replace(/\s+/g, ' ').trim();
  const t = (text || '').trim();
  if (!h || !t.toLowerCase().startsWith(h.toLowerCase())) return t;
  return t.slice(h.length).replace(/^[:\s]+/, '').trim();
}

// Read a read-only labelled block, e.g. the "Sector" heading and the value
// rendered under its description. Headings vary in punctuation
// ("Correction Feedback:"), so compare without a trailing colon.
function readLabelledBlock(...labels) {
  const want = labels.map((l) => l.toLowerCase().replace(/:\s*$/, ''));
  const head = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, label, dt'))
    .find((h) => want.includes((h.textContent || '').trim().toLowerCase().replace(/:\s*$/, '')));
  if (!head) return null;

  // Refinement stacks several headings inside one container, so take only the
  // siblings between this heading and the next one; descriptions are prompts
  // for the user, not values.
  const parts = [];
  for (let el = head.nextElementSibling; el; el = el.nextElementSibling) {
    if (/^H[1-6]$/.test(el.tagName)) break;
    if (/_description_/.test(el.className || '')) continue;
    parts.push(el);
  }
  if (parts.length) {
    const ctl = parts.map((p) => p.querySelector('textarea, select, input:not([type="hidden"])')).find(Boolean);
    if (ctl) {
      const v = readControl(ctl);
      if (v !== '' && v !== null) return v;
    }
    const chip = parts.map((p) => p.querySelector('span[style*="pre-wrap"]')).find(Boolean);
    if (chip) return chip.textContent.trim() || null;
    const text = parts.map((p) => (p.innerText || p.textContent || '').trim())
      .filter(Boolean).join('\n').trim();
    // A value area that repeats its own heading would report "Task Sector" as
    // the sector. Whatever the page calls the field, only its value is wanted.
    const value = stripHeading(text, head.textContent);
    if (value) return value;
  }

  // Only fall back to the whole parent when this heading owns it. A heading
  // stacked under an earlier one would otherwise report its neighbour's text.
  const block = head.parentElement;
  if (!block || block.firstElementChild !== head) return null;

  const ctl = block.querySelector('textarea, select, input:not([type="hidden"])');
  if (ctl) {
    const v = readControl(ctl);
    return v === '' ? null : v;
  }

  const span = block.querySelector('span[style*="pre-wrap"]');
  if (span) return span.textContent.trim() || null;

  // Fall back to whatever text is left once the heading and its description go.
  const desc = block.querySelector('[class*="_description_"]');
  let text = (block.innerText || block.textContent || '').trim();
  for (const part of [head.textContent, desc?.textContent]) {
    const p = (part || '').trim();
    if (p && text.startsWith(p)) text = text.slice(p.length).trim();
  }
  return text || null;
}

/* ---------- which feedback the task is waiting on ---------- */

// Which feedback the task is waiting on, and so what the reader should be on.
//
//   newest note is the automated run and it reports a failure
//     -> the auto-checking is what is blocking. The answer is in the
//        auto-evaluation results below the golden solution upload, not in
//        anybody's wording, so those are what the block leads with.
//   newest note is the reviewer's, or is an automated run that all passed
//     -> the auto-checking is satisfied and what is left is the quality of
//        the content, so the reviewer's feedback is what the block leads with.
function decideFocus(notes) {
  const latest = markLatest(notes);
  const autos = notes.filter((n) => AUTO_NOTE.test(n.title));
  const human = notes.filter((n) => !AUTO_NOTE.test(n.title));

  // The automated run only gets to decide when it is the newest note. On a
  // page whose notes carry no timestamps at all there is no newest note, so
  // the automated run is read on its own verdict instead.
  const auto = latest ? (AUTO_NOTE.test(latest.title) ? latest : null) : newestOf(autos);
  const verdict = auto ? autoVerdict(auto.text) : null;

  const newestAuto = newestOf(autos);
  const overall = newestAuto ? autoVerdict(newestAuto.text) : null;
  const autoEvalPassed = overall === null ? null : overall === 'passed';

  let focus = null;
  if (auto && verdict !== 'passed') {
    // An unreadable automated run is treated as a failing one: it is the
    // newest word on the task and it is not the standing all-clear.
    focus = {
      on: 'auto-evaluation',
      note: auto,
      why: verdict === 'failed'
        ? 'The newest note is the automated run and it reports a failure, so the auto-checking is what this task is waiting on. The answer is in the auto-evaluation results below the golden solution upload, not in the wording.'
        : 'The newest note is the automated run and it does not say the checks passed, so read it as the auto-checking still blocking. Start from the auto-evaluation results below the golden solution upload.'
    };
  } else {
    const lead = latest && !AUTO_NOTE.test(latest.title) ? latest : newestOf(human) || latest;
    if (lead) {
      focus = {
        on: 'reviewer feedback',
        note: lead,
        why: auto
          ? 'The automated run says all checks passed, so the auto-checking is not what is blocking. What is left is the quality of the content, and this feedback is what to work from.'
          : 'The newest note is a person\'s, not the machine\'s, so the auto-checking is behind it. What is left is the quality of the content, and this feedback is what to work from.'
      };
    }
  }

  if (focus) focus.note.focus = true;
  return { latest, focus, autoEvalPassed };
}

/* ---------- Provided Rubrics and failed checks ---------- */

// A refinement task shows the rubric it is revising as a read-only document:
// "Criterion 1 — weight 2" as a heading, the criterion text in the paragraphs
// under it, up to the next heading.
const RUBRIC_HEADING = /^criterion\s*(\d+)\s*[—–-]\s*weight\s*(-?\d+)$/i;

function readProvidedRubrics() {
  const out = [];
  for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (h.closest(INSTANCE)) continue; // the editable list, handled elsewhere

    const m = (h.textContent || '').replace(/\s+/g, ' ').trim().match(RUBRIC_HEADING);
    if (!m) continue;

    const parts = [];
    for (let el = h.nextElementSibling; el; el = el.nextElementSibling) {
      if (/^H[1-6]$/.test(el.tagName)) break;
      const t = (el.innerText || el.textContent || '').trim();
      if (t) parts.push(t);
    }

    const criterion = parts.join('\n').trim();
    if (criterion) out.push({ criterion, weight: Number(m[2]) });
  }
  return out;
}

// Check results paint themselves green or red. A green one says nothing went
// wrong, so only the red ones are worth carrying off the page.
function readErrorBlocks() {
  const out = [];
  const seen = new Set();
  const checks = new Set(checkFields());
  for (const el of document.querySelectorAll('[class*="bg-error-subtle"]')) {
    // A red block nested in another would repeat its parent's text.
    if (el.parentElement?.closest('[class*="bg-error-subtle"]')) continue;

    // A check's own result panel is carried whole, pass or fail, by
    // readCheckResults; listing it here as well would say it twice.
    const own = el.closest('[data-testid^="field-"]');
    if (own && !el.closest(INSTANCE) && checks.has(own)) continue;

    const text = (el.innerText || el.textContent || '').replace(/[ \t]+\n/g, '\n').trim();
    if (!text) continue;

    const field = el.closest('[data-testid^="field-"]');
    const inst = el.closest(INSTANCE);
    const where = field
      ? fieldLabel(field)
      : inst
        ? `Criterion ${idxOf(inst) + 1}`
        : null;

    const key = `${where || ''}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(where ? { label: where, text } : { text });
  }
  return out;
}

/* ---------- running the checks on a catch ---------- */

// The editable User Prompt box. Refinement has none - it shows the prompt it
// is revising as read-only text - so its absence is not an empty prompt.
function promptBox() {
  return document.querySelector('[data-testid="field-prompt"] textarea')
    || Array.from(document.querySelectorAll('[data-testid^="field-"]'))
      .find((f) => /^user prompt$/i.test(fieldLabel(f)))?.querySelector('textarea')
    || null;
}

function promptText() {
  return (promptBox()?.value || '').trim();
}

// Press every check that has not run, then wait for all of them to answer.
// The results are read afterwards by the usual pass/fail sweep.
async function runFeedbackChecks({ timeout = 180000 } = {}) {
  const pending = [];

  const clicked = new Set();
  for (const field of checkFields()) {
    if (checkFinished(field)) continue;
    const btn = checkRunButton(field);
    // A field nested in another finds the same button twice; press it once.
    if (!btn || clicked.has(btn)) continue;
    clicked.add(btn);
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    pending.push({ field, label: fieldLabel(field) });
    await wait(250); // stagger, rather than firing them all at once
  }

  const started = pending.length;
  if (!started) return { started: 0, answered: 0, waiting: [] };

  let left;
  try {
    checkProgress = { phase: 'checks', index: 0, total: started };
    left = await awaitChecks(pending, timeout, (n) => {
      checkProgress = { phase: 'checks', index: n, total: started };
    });
  } finally {
    checkProgress = null;
  }
  return {
    started,
    answered: started - left.length,
    waiting: left.map((p) => p.label)
  };
}

// Wait for every pressed check to answer; hands back the ones that did not.
async function awaitChecks(pending, timeout, onAnswered) {
  let left = pending;
  const SLICE = 500;
  let deadline = Date.now() + timeout;

  while (left.length && Date.now() < deadline) {
    checkCancelled();
    const before = Date.now();
    await wait(SLICE);
    // A slice that took far longer than it asked for means the tab was
    // suspended, not that the server was slow. Those minutes were never the
    // server's to spend, so hand them back - otherwise a catch left alone in a
    // background tab runs out of patience on checks it never actually waited
    // for, and reads a page whose answers are still on their way.
    const lost = Date.now() - before - SLICE;
    if (lost > 2000) deadline += lost;
    left = left.filter((p) => !checkFinished(p.field));
    onAnswered?.(pending.length - left.length);
  }
  return left;
}

/* ---------- after a Refinement fill: two checks, then Submit ----------
   Once the criteria are in, the rubric is judged afresh - Rubric Quality
   Check (Rapid In-App) first, Name Check once it has answered - and then
   every check on the page is looked at. All passing, Submit is pressed; any
   failing, the page is scrolled to it and nothing is submitted. */

const SUBMIT_CHECKS = [
  { name: 'Rubric Quality Check (Rapid In-App)', label: /rubric quality/i, prefer: /rapid/i },
  { name: 'Name Check', label: /\bname check\b/i }
];

function findCheckField(want) {
  let found = checkFields().filter((f) => !f.closest(INSTANCE) && want.label.test(fieldLabel(f)));
  if (want.prefer && found.some((f) => want.prefer.test(fieldLabel(f)))) {
    found = found.filter((f) => want.prefer.test(fieldLabel(f)));
  }
  // A field nested in another is found twice; the inner one is the check.
  return found.find((f) => !found.some((g) => g !== f && f.contains(g))) || null;
}

function clearButton(field) {
  return Array.from(field.querySelectorAll('button'))
    .find((b) => !b.disabled && /clear feedback/i.test(buttonText(b))) || null;
}

// Ask one check again and wait for its answer. An answer already showing was
// given about the criteria as they were before the fill, so it is cleared
// first rather than trusted.
async function rerunCheck(field, { timeout = 180000 } = {}) {
  field.scrollIntoView({ block: 'center' });
  await wait(settleMs);

  if (checkFinished(field)) {
    const clear = clearButton(field);
    if (clear) {
      clear.click();
      await until(() => !checkFinished(field), { timeout: 10000 });
      await wait(settleMs);
    }
    if (checkFinished(field)) return 'would not clear';
  }

  // The page can hold its buttons back for a moment while it saves the fill.
  const btn = await until(() => checkRunButton(field), { timeout: 15000, step: 200 });
  if (!btn) return 'button disabled';
  checkCancelled();
  btn.click();

  const left = await awaitChecks([{ field }], timeout);
  return left.length ? 'no answer' : 'answered';
}

function submitRank(t) {
  if (DECLINE.test(t)) return 99;
  if (/^submit$/i.test(t)) return 0;
  if (/^submit\b/i.test(t)) return 1;
  return 99;
}

function findSubmitButton() {
  return Array.from(document.querySelectorAll('button'))
    .filter((b) => isVisible(b) && !b.closest(INSTANCE) && !openDialog()?.contains(b))
    .map((b) => ({ b, rank: submitRank(buttonText(b)) }))
    .filter((x) => x.rank < 99)
    .sort((a, b) => a.rank - b.rank)[0]?.b || null;
}

// A submit may ask "are you sure?"; its affirmative can read Submit as well.
function submitConfirmRank(t) {
  const r = submitRank(t);
  return r < 99 ? r : confirmRank(t);
}

async function checkAndSubmit({ fillClean }) {
  const ran = [];
  for (let i = 0; i < SUBMIT_CHECKS.length; i++) {
    checkCancelled();
    const want = SUBMIT_CHECKS[i];
    progress = {
      index: i + 1,
      total: SUBMIT_CHECKS.length,
      phase: 'checking',
      unit: 'check',
      text: `Waiting on ${want.name}…`
    };
    const field = findCheckField(want);
    ran.push({ name: want.name, outcome: field ? await rerunCheck(field) : 'not on this page' });
  }

  // Every check on the page counts, not only the two just asked.
  const failing = checkPanels().filter((p) => !p.result.passed);
  const failed = failing.map((p) => ({
    check: p.result.check,
    ...(p.result.name ? { name: p.result.name } : {}),
    verdict: p.result.verdict || 'FAIL'
  }));
  const unanswered = ran.filter((r) => r.outcome !== 'answered');

  if (failing.length) {
    failing[0].panel.scrollIntoView({ block: 'center' });
    return { checks: ran, failed, submitted: false, reason: 'a check failed' };
  }
  if (unanswered.length) {
    const where = unanswered.map((r) => findCheckField(SUBMIT_CHECKS.find((w) => w.name === r.name)))
      .find(Boolean);
    where?.scrollIntoView({ block: 'center' });
    return { checks: ran, failed, submitted: false, reason: 'a check did not answer' };
  }
  if (!fillClean) {
    return { checks: ran, failed, submitted: false, reason: 'the fill was incomplete' };
  }

  progress = { index: 1, total: 1, phase: 'submitting', unit: 'task', text: 'Every check passed — submitting…' };
  const submit = findSubmitButton();
  if (!submit) return { checks: ran, failed, submitted: false, reason: 'no Submit button found' };
  submit.scrollIntoView({ block: 'center' });
  await wait(settleMs);
  if (submit.disabled) return { checks: ran, failed, submitted: false, reason: 'the Submit button is disabled' };
  checkCancelled();
  submit.click();
  await wait(settleMs);
  const confirmed = await confirmIfAsked(submitConfirmRank);
  return { checks: ran, failed, submitted: true, confirmed };
}

/* ---------- form fields outside the criteria list ---------- */

// The fields to report, in the order they should be read back.
const WANTED_FIELDS = [
  { key: 'prompt', match: /^user prompt$/ },
  { key: 'onetOccupation', match: /^o\*net occupation$/ },
  { key: 'onetTasks', match: /^o\*net tasks$/ },
  { key: 'onetSkills', match: /^o\*net skills$/ },
  { match: /^how many input files are tied to your prompt/ },
  { match: /input files.*multi-modal/ },
  { match: /^is web search required for your task/ },
  { match: /^if you were to complete this prompt manually/ },
  // Everything from here down is an auto-evaluation result, the run of
  // boxes that sits below the golden solution upload. When the auto-checking
  // is what a task is waiting on, these are the answer, so they are flagged
  // to be led with rather than left at the foot of the block.
  { auto: true, match: /^auto-evaluation golden solution submission feedback$/ },
  { auto: true, match: /^auto-evaluation difficulty submission feedback$/ },
  { auto: true, match: /^auto-evaluation input output check submission feedback$/ },
  { auto: true, match: /^auto-evaluation check: prompt and input files self-contained/ },
  { auto: true, match: /^verifier$/ },
  { auto: true, match: /^audit$/ },
  { auto: true, match: /^audit: rubric and golden solution alignment$/ },
  { auto: true, match: /^safety check$/ },
  { auto: true, match: /^auto-evaluation llm generated files check/ },
  { auto: true, match: /^auto-evaluation rubric quality check submission feedback$/ },
  { auto: true, match: /^golden solution self[- ]?consistency check$/ },
  { auto: true, match: /^golden solution leakage check$/ },
  { auto: true, match: /^golden solution entity grounding check$/ },
  { auto: true, match: /^golden solution role check$/ },
  { auto: true, match: /^rubric golden alignment check$/ },
  { auto: true, match: /^rubric value grounding check$/ },
  { auto: true, match: /^reference soundness check$/ },
  { auto: true, match: /^quality judge check$/ },
  { auto: true, match: /^comprehensive rubric feedback and recommendations$/ }
];

function readFields() {
  const found = [];
  for (const f of document.querySelectorAll('[data-testid^="field-"]')) {
    if (f.closest(INSTANCE)) continue;
    const label = fieldLabel(f);
    if (label) found.push({ label, norm: label.toLowerCase(), el: f });
  }

  const named = {};
  const list = [];
  for (const want of WANTED_FIELDS) {
    // Several fields can share a label (two Safety Checks); keep them all.
    for (const f of found.filter((x) => want.match.test(x.norm))) {
      const value = fieldValue(f.el);
      if (value === null || value === '') continue;
      // The code widget's empty state, not a result.
      if (typeof value === 'string' && /^no code provided$/i.test(value.trim())) continue;
      if (want.key) named[want.key] = value;
      else list.push(want.auto ? { label: f.label, value, auto: true } : { label: f.label, value });
    }
  }
  return { named, list };
}

/* ---------- criteria fields ---------- */

// "field-textarea-criterion" -> "criterion", "field-numeric-weight" -> "weight"
function fieldKey(fieldEl) {
  const t = fieldEl.getAttribute('data-testid') || '';
  const m = t.match(/^field-[a-z]+-(.+)$/i);
  if (m) return m[1];
  const bare = t.replace(/^field-/i, '');
  if (bare) return bare;
  const ctl = control(fieldEl);
  return ctl?.id?.replace(/^(textarea|numeric|input|select)-/, '') || null;
}

function fieldsOf(inst) {
  return Array.from(inst.querySelectorAll('[data-testid^="field-"]'));
}

function readControl(ctl) {
  if (!ctl) return null;
  if (ctl.type === 'checkbox') return ctl.checked;
  const v = ctl.value;
  if (ctl.type === 'number' || ctl.getAttribute('inputmode') === 'numeric') {
    if (v === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }
  return v;
}

/* ---------- opening a criterion section ---------- */

function triggerOf(inst) {
  return inst.querySelector('button[data-radix-collection-item]')
    || inst.querySelector('h1 button, h2 button, h3 button, h4 button');
}

function isCollapsed(inst) {
  const t = triggerOf(inst);
  if (!t) return false;
  return t.getAttribute('data-state') === 'closed' || t.getAttribute('aria-expanded') === 'false';
}

// Collapsed Radix sections unmount their content, so nothing can be read or
// written until they are open.
async function expand(inst) {
  if (!isCollapsed(inst)) return false;
  triggerOf(inst)?.click();
  await until(() => !isCollapsed(inst) && fieldsOf(inst).length > 0, { timeout: 2000 });
  await wait(settleMs);
  return true;
}

/* ---------- adding and deleting sections ---------- */

// The page's own button is "Add criterion"; rank looser matches below it so a
// reworded label still works.
function addRank(t) {
  if (/^add criterion$/i.test(t)) return 0;
  if (/^\+?\s*add\b/i.test(t)) return 1;
  if (/\b(add|new)\b/i.test(t)) return 2;
  if (/^\+$/.test(t)) return 3;
  return 99;
}

function findAddButton() {
  const container = getContainer();
  if (!container) return null;
  let scope = container;
  for (let hop = 0; hop < 6 && scope; hop++) {
    const found = Array.from(scope.querySelectorAll('button'))
      .filter((b) => !b.disabled && !b.closest(INSTANCE))
      .map((b) => ({ b, t: buttonText(b) }))
      .filter((x) => !/delete|remove|cancel|submit|save/i.test(x.t))
      .map((x) => ({ ...x, r: addRank(x.t) }))
      .filter((x) => x.r < 99)
      .sort((a, b) => a.r - b.r)[0];
    if (found) return found.b;
    scope = scope.parentElement;
  }
  return null;
}

function findDeleteButton(inst) {
  return Array.from(inst.querySelectorAll('button'))
    .find((b) => /\b(delete|remove)\b/i.test(buttonText(b)) && !b.disabled) || null;
}

async function addSection() {
  const before = getInstances().length;
  const btn = findAddButton();
  if (!btn) {
    throw new Error(
      `The page has ${before} sections and more are needed, but no "Add criterion" button was found.`
    );
  }
  btn.scrollIntoView({ block: 'center' });
  await wait(settleMs);
  btn.click();
  const grew = await until(() => getInstances().length > before);
  if (!grew) throw new Error(`Clicked "${buttonText(btn)}" but no new section appeared.`);
  await wait(settleMs);
}

async function removeExtras(target) {
  let current = getInstances().length;

  while (current > target) {
    checkCancelled();
    const del = findDeleteButton(getInstances()[current - 1]);
    if (!del) break; // no delete control: leave the spares rather than fail

    del.click();
    await wait(settleMs);
    await confirmIfAsked();

    const shrank = await until(() => getInstances().length < current);
    if (!shrank) break; // the page did not remove it; report the leftovers
    current = getInstances().length;
    await wait(settleMs);
  }
  return current;
}

/* ---------- catching ---------- */

async function readPage(options = {}) {
  const mode = options.mode || detectMode().mode;

  // Anything still collapsed is invisible to every reader below, including the
  // criteria list itself if its section happens to be shut.
  const opened = await expandEverything();

  let criteria = [];
  if (getContainer()) {
    for (const inst of getInstances()) {
      const row = {};
      for (const f of fieldsOf(inst)) {
        const key = fieldKey(f);
        if (key) row[key] = readControl(control(f));
      }
      // Fallback for pages without data-testid field wrappers.
      if (!Object.keys(row).length) {
        const ta = inst.querySelector('textarea');
        const num = inst.querySelector('input[type="number"]');
        if (ta) row.criterion = ta.value;
        if (num) row.weight = readControl(num);
      }
      if (Object.keys(row).length) criteria.push(row);
    }
  }

  const boardFilled = criteria.some((c) => String(c.criterion || '').trim());

  // A refinement page with nothing in its criteria list is a task nobody has
  // written yet, so its criteria are read from the Provided Rubrics document
  // further down rather than from the empty list.
  const notStartedYet = mode === 'refinement' && !boardFilled;

  // Whether to press the checks is the page's answer, not a guess from the
  // form: a check with an enabled "Check feedback" button has not been asked
  // yet, and asking it is the whole point of the catch.
  //
  // It used to be guessed, and both guesses were wrong on a Refinement page
  // exactly when it mattered - on the first catch. Its criteria list opens
  // empty, which read as "nothing to judge", and its prompt is read-only, so
  // the empty-prompt gate fired as well. Between them nothing was ever
  // pressed on a refinement task, which is the one page that arrives with its
  // checks unrun.
  let checks = null;
  let checksSkipped = null;
  const fields = checkFields();
  const unanswered = fields.filter((f) => !checkFinished(f));
  const runnable = unanswered.filter((f) => checkRunButton(f));
  const box = promptBox();
  if (options.runChecks === false) checksSkipped = 'turned off';
  else if (!fields.length) checksSkipped = 'no checks on this page';
  else if (!unanswered.length) checksSkipped = 'already answered';
  // A check still waiting to be asked, behind a button the page has disabled,
  // is not the same as one that has answered - and saying nothing about it is
  // how a catch that pressed nothing passes for a catch that had nothing to
  // press.
  else if (!runnable.length) checksSkipped = 'the buttons are disabled';
  // Only where the page has a prompt box of its own to be empty.
  else if (box && !promptText()) checksSkipped = 'no prompt yet';
  else checks = await runFeedbackChecks();

  // A verdict that lands while the checks are answering can mount inside a
  // section that was shut, or that did not exist during the first sweep.
  if (checks?.started) await expandEverything();

  // The rubric being revised is the read-only copy, so fall back to that.
  let criteriaSource = 'form';
  if (notStartedYet) {
    const provided = readProvidedRubrics();
    if (provided.length) {
      criteria = provided;
      criteriaSource = 'provided rubrics';
    }
  }

  const uid = readUid();
  // A refinement whose criteria are written is a revision under way. The
  // correction feedback describes the task before that work, so it is stale
  // once the criteria exist; the automated run is what speaks to the task now.
  const revisionUnderWay = mode === 'refinement' && boardFilled;

  const notes = await readNotes();
  const { named, list } = readFields();

  // Submission and Review label it "Sector"; Refinement says "Task Sector".
  const sector = readLabelledBlock('Sector', 'Task Sector');
  const occupation = readLabelledBlock('Task Occupation');
  const tier = readLabelledBlock('Tier Type', 'Tier');
  const areasOfFocus = readLabelledBlock('Areas of Focus of Feedback');

  // Refinement carries its feedback as headed blocks, not accordions.
  const headed = [['AutoEval Feedback'], ['Agentic Rubric Quality Check']];
  if (!revisionUnderWay) headed.unshift(['Correction Feedback'], ['Feedback to Improve Task']);

  for (const [title, ...aliases] of headed) {
    const text = readLabelledBlock(title, ...aliases);
    if (text && !notes.some((n) => n.title === title)) notes.push({ title, text });
  }

  // What the task is waiting on decides what the reader should be looking at,
  // so work it out here, once the headed blocks have joined the accordions.
  const { latest: latestNote, focus, autoEvalPassed } = decideFocus(notes);

  if (!criteria.length && !uid && !notes.length && !sector && !list.length) {
    throw new Error('Nothing found on this page - no criteria, UID, sector or task notes.');
  }

  const content = {};
  if (notes.length) content.taskNotes = notes;
  if (latestNote) {
    content.latestNote = { title: latestNote.title, time: latestNote.time || null };
  }
  if (focus) {
    content.focus = {
      on: focus.on,
      why: focus.why,
      note: { title: focus.note.title, time: focus.note.time || null }
    };
  }
  if (autoEvalPassed !== null) content.autoEvalPassed = autoEvalPassed;
  if (sector) content.sector = sector;
  if (occupation) content.occupation = occupation;
  if (tier) content.tier = tier;
  if (areasOfFocus) content.areasOfFocus = areasOfFocus;
  if (named.prompt) content.prompt = named.prompt;
  content.criteria = criteria.map((c, i) => ({ n: i + 1, ...c }));
  // O*NET is asked for on Submission and Review only.
  if (mode !== 'refinement') {
    for (const k of ['onetOccupation', 'onetTasks', 'onetSkills']) {
      if (named[k]) content[k] = named[k];
    }
  }
  if (list.length) content.fields = list;
  const checkResults = readCheckResults();
  if (checkResults.length) content.checkResults = checkResults;
  const errors = readErrorBlocks();
  if (errors.length) content.errors = errors;
  // Say so in the content itself, not only in the panel: a block that is
  // copied away should admit that it was read before every check had answered.
  if (checks?.waiting?.length) content.pendingChecks = checks.waiting;

  const data = {};
  if (mode) data.mode = mode;
  if (uid) data.uid = uid;
  data.content = content;
  data.criteria = criteria;

  // A section whose content never mounted yields nothing; say so rather than
  // quietly handing back a short list.
  return {
    data,
    meta: { sections: getInstances().length, criteriaSource, opened, checks, checksSkipped }
  };
}

/* ---------- writing the criteria back ---------- */

// A row is written either as { "criterion": text, "weight": n } or with the
// criterion's number as the key: { "1": text, "weight": n }. The number is a
// label - position in the list still decides which section a row goes to.
function normalizeRow(r) {
  if (typeof r === 'string') return { criterion: r };
  if (!r || typeof r !== 'object') {
    throw new Error('Each criterion must be an object or a string.');
  }
  const out = {};
  for (const [key, value] of Object.entries(r)) {
    if (/^\d+$/.test(key)) out.criterion = value;
    else out[key] = value;
  }
  return out;
}

function normalize(input) {
  let data = input;
  if (typeof data === 'string') data = JSON.parse(data);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.criteria)) return data.criteria;
  if (data && Array.isArray(data.items)) return data.items;
  throw new Error('JSON must be an array, or an object with a "criteria" array.');
}

async function apply(input, options = {}) {
  if (busy) throw new Error('Already typing. Press Stop first.');

  const rows = normalize(input).map(normalizeRow);
  if (!getContainer()) throw new Error('No criteria container found on this page.');

  const base = Math.max(0, Number(options.speed ?? 200));
  const paste = options.entry !== 'type'; // paste per field unless asked to type
  hiddenDuringRun = false;
  const gap = Math.max(0, Number(options.gap ?? 2000)); // pause after each field
  settleMs = settleFor(gap); // and the room every other step in the run gets
  busy = true;
  cancelled = false;
  stayAwake();
  progress = { index: 0, total: rows.length, phase: 'starting', unit: 'criterion' };

  const skippedFields = [];
  const truncated = [];
  let added = 0;
  let filled = 0;
  let extrasLeft = 0; // sections the page would not delete
  let afterFill = null; // the checks and Submit, on a Refinement page

  try {
    // The criteria list is unreachable while its section is collapsed.
    progress.phase = 'opening';
    await expandEverything();

    if (options.removeExtras !== false) {
      progress.phase = 'tidying';
      const left = await removeExtras(rows.length);
      extrasLeft = Math.max(0, left - rows.length);
    }

    for (let i = 0; i < rows.length; i++) {
      checkCancelled();
      progress = { index: i + 1, total: rows.length, phase: 'typing', unit: 'criterion' };

      // Only reach for "Add criterion" once the existing sections run out.
      if (i >= getInstances().length) {
        progress.phase = 'adding';
        await addSection();
        added++;
        progress.phase = 'typing';
      }

      if (document.hidden) hiddenDuringRun = true;

      const inst = getInstances()[i];
      if (!inst) throw new Error(`Section ${i + 1} did not appear.`);
      await expand(inst);

      const byKey = new Map();
      for (const f of fieldsOf(inst)) {
        const k = fieldKey(f);
        if (k) byKey.set(k.toLowerCase(), f);
      }

      for (const [key, value] of Object.entries(rows[i])) {
        checkCancelled();
        const f = byKey.get(key.toLowerCase());
        let ctl = f ? control(f) : null;
        if (!ctl) {
          // Fall back to the conventional shape of a criterion row.
          if (/^(criterion|text)$/i.test(key)) ctl = inst.querySelector('textarea');
          else if (/^(weight|score)$/i.test(key)) ctl = inst.querySelector('input[type="number"]');
        }
        if (!ctl) { skippedFields.push(`#${i + 1} "${key}"`); continue; }

        if (ctl.type === 'checkbox' || ctl instanceof HTMLSelectElement) {
          setDiscrete(ctl, value);
        } else {
          const r = paste
            ? await pasteInto(ctl, value, base)
            : await typeInto(ctl, value, base);
          if (r.truncated) truncated.push(`#${i + 1} "${key}"`);
        }
        await pause(gap); // settle before moving to the next field
      }
      filled++;
    }

    const mode = options.mode || detectMode().mode;
    if (mode === 'refinement' && options.submitAfter !== false) {
      afterFill = await checkAndSubmit({
        fillClean: filled === rows.length && !skippedFields.length && !truncated.length
      });
    }
  } finally {
    busy = false;
    progress = null;
    settleMs = SETTLE;
    letSleep();
  }

  return {
    requested: rows.length,
    filled,
    added,
    sectionsOnPage: getInstances().length,
    ranInBackground: hiddenDuringRun,
    extrasLeft,
    skippedFields,
    truncated,
    afterFill
  };
}

/* ---------- registration ---------- */

PAGE_PROJECTS.geranium = {
  // The criteria list is Geranium's alone. The blurb and the heading are
  // weaker - a Terminus page is headed "Submission" too - so they are asked
  // only after every other project has said no.
  detect: () => (document.querySelector(CONTAINER) ? 'the criteria list' : null),
  detectLoosely: () => (projectPhrase() ? 'the page blurb' : detectMode().mode ? 'the page heading' : null),
  read: readPage,
  apply,
  ping: () => ({
    count: getInstances().length,
    hasContainer: !!getContainer(),
    detected: detectMode()
  })
};
