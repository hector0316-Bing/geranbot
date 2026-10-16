/* Criteria Catcher - page side: Copperhead.

   A Copperhead (Snorkel) task is an asset and workflow validation review. The
   task brief is on the left - Task ID, the application, its download link,
   the workflow, domain, persona, trigger and outcome, each under an h3 - and
   the review form on the right, in sections: App and Asset Review, the
   Workflow sections, and Complete Your Submission.

   Much of the form only exists once an earlier answer asks for it: the
   sections after "Download" appear when both download questions are Yes, and
   several explanations appear only for one particular choice. Those are
   waited for as the answers bring them in.

   Questions are found by their key or by their wording, and the wording is
   matched loosely - the page writes "Trigger → Outcome Alignment",
   "Realism Score (1–10)" and "Judgement Based", and an answer written with
   "->", "(1-10)" or "Judgment-based" means the same question and option.

   The confirmation that the task was done without AI assistance is neither
   caught nor ticked here. It is the reviewer's own statement, so it is left
   for them.

   Only Submission has been seen. Review and Adjudication are recorded as
   their own stage and read the same way until a sample shows what they
   carry of their own.

   Needs core.js. */

/* ---------- the fields ---------- */

// "field-boolean-were_you_able_to_…" -> "boolean-were_you_able_to_…"
function chKey(fieldEl) {
  return (fieldEl.getAttribute('data-testid') || '').replace(/^field-/, '') || null;
}

function chFieldList(root = document) {
  return Array.from(root.querySelectorAll(FIELD)).filter((f) => chKey(f));
}

// A choice is a radio button beside a hidden input holding the stored value
// ("true" for Yes), inside a label carrying the wording on screen.
function chRadioOptions(fieldEl) {
  return Array.from(fieldEl.querySelectorAll('input[type="radio"]'))
    .filter((input) => input.closest(FIELD) === fieldEl)
    .map((input) => {
      const label = input.closest('label');
      const btn = (label || input.parentElement)?.querySelector('button[role="radio"]') || null;
      return {
        value: input.value,
        text: oneLine(label?.innerText || label?.textContent || '') || input.value,
        checked: input.checked || btn?.getAttribute('aria-checked') === 'true',
        input,
        label,
        btn
      };
    });
}

// A field's description: the first line says what is asked ("Does this
// reflect how the workflow actually happens?"), the rest how to answer it.
function chDescribe(fieldEl) {
  const desc = Array.from(fieldEl.querySelectorAll('[class*="_description_"]'))
    .find((d) => d.closest(FIELD) === fieldEl);
  const full = blockText(desc);
  if (!full) return { question: null, guidelines: null };
  const first = full.split('\n').map((l) => l.trim()).find(Boolean) || null;
  return { question: first, guidelines: full };
}

// A field is named by its label; one without falls back to its description.
function chLabel(fieldEl) {
  const lab = fieldLabel(fieldEl);
  if (lab) return lab;
  const { question } = chDescribe(fieldEl);
  return question ? question.replace(/[:.]\s*$/, '') : chKey(fieldEl);
}

function chSectionIntro(sec) {
  const desc = Array.from(sec.querySelectorAll('[class*="_description_"]'))
    .find((d) => !d.closest(FIELD));
  return blockText(desc) || null;
}

function chIsAnswered(answer) {
  if (Array.isArray(answer)) return answer.length > 0;
  return answer !== null && answer !== undefined && answer !== '';
}

/* ---------- matching wording loosely ---------- */

// Wording reduced to its words: arrows read as "to", every kind of dash and
// punctuation dropped, case ignored, and the two spellings of judgement made
// one. "Trigger → Outcome Alignment" and "trigger -> outcome alignment" come
// out the same, as do "Realism Score (1–10)" and "Realism Score (1-10)".
function chLoose(s) {
  return oneLine(s).toLowerCase()
    .replace(/->|→|⟶|⇒|=>/g, ' to ')
    .replace(/judgement/g, 'judgment')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// How alike two wordings are, by the words they share: 1 is the same words.
function chLikeness(a, b) {
  const x = new Set(chLoose(a).split(' ').filter(Boolean));
  const y = new Set(chLoose(b).split(' ').filter(Boolean));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/* ---------- writing the answers back ---------- */

// Yes and No are stored as true and false.
const CH_SAME_AS = new Map([
  ['yes', 'true'], ['true', 'yes'],
  ['no', 'false'], ['false', 'no']
]);

// The part of an option a person would say: "Mostly" for "Mostly. A few
// details are off, but the asset holds together."
function chOptionHead(text) {
  return chLoose(String(text).split(/[:.]/)[0]);
}

function chMatchOption(options, value) {
  const want = norm(value);
  if (!want) return null;
  const tries = [want, CH_SAME_AS.get(want)].filter(Boolean);

  // Strictest reading first, then the loose ones: the stored value, the
  // wording, the part before the full stop, and the start of the wording.
  for (const reading of [
    (o, w) => norm(o.value) === w,
    (o, w) => norm(o.text) === w,
    (o, w) => chLoose(o.text) === chLoose(w),
    (o, w) => chOptionHead(o.text) === chLoose(w),
    (o, w) => chLoose(w).length >= 4 && chLoose(o.text).startsWith(chLoose(w))
  ]) {
    for (const w of tries) {
      const hit = options.find((o) => reading(o, w));
      if (hit) return hit;
    }
  }
  return null;
}

// A box is named by its wording, loosely; a shortened name is allowed as long
// as it is long enough to mean only one of them.
function chSameFlag(wanted, optionText) {
  const a = chLoose(wanted);
  const b = chLoose(optionText);
  return a === b || (a.length >= 8 && b.startsWith(a));
}

function chFlagList(value) {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.map(String).filter((v) => v.trim());
  const one = String(value).trim();
  return one && !/^(none|no flags)$/i.test(one) ? [one] : [];
}

// A choice re-renders the moment it is made, so what the click did is read
// back off the page rather than off the node that was clicked.
async function chSetChoice(fieldEl, value, base) {
  const options = chRadioOptions(fieldEl);
  if (!options.length) return { ok: false, why: 'no options to choose from' };

  const pick = chMatchOption(options, value);
  if (!pick) return { ok: false, why: `no option matching "${oneLine(value)}"` };

  const chosen = () => chRadioOptions(fieldEl).some((o) => o.checked && o.value === pick.value);
  if (chosen()) return { ok: true, already: true };

  const target = pick.btn || pick.label;
  if (!target) return { ok: false, why: 'the option has nothing to click' };
  target.scrollIntoView({ block: 'center' });
  await wait(base * 6); // a beat to look at it before choosing, as a person would
  target.click();
  if (await until(chosen, { timeout: 2000 })) return { ok: true };

  // The label answers to a click as well; try that before giving up.
  pick.label?.click();
  return await until(chosen, { timeout: 1500 })
    ? { ok: true }
    : { ok: false, why: 'the page did not take the choice' };
}

// Ticking is stated in full: every flag named is put on and every other one
// is taken off, so the page ends up saying exactly what the answer says.
async function chSetFlags(fieldEl, value, base) {
  const options = chFlagOptions;
  const wanted = chFlagList(value);
  const names = options(fieldEl).map((o) => o.text);
  if (!names.length) return { ok: false, why: 'no boxes to tick' };

  const unknown = wanted.filter((w) => !names.some((n) => chSameFlag(w, n)));
  let stuck = 0;

  for (const name of names) {
    checkCancelled();
    const on = wanted.some((w) => chSameFlag(w, name));
    const now = options(fieldEl).find((o) => o.text === name);
    if (!now || now.checked === on) continue;

    now.box.scrollIntoView({ block: 'center' });
    await wait(base * 6);
    now.box.click();
    const settled = await until(
      () => options(fieldEl).find((o) => o.text === name)?.checked === on,
      { timeout: 1500 }
    );
    if (!settled) stuck++;
  }

  return {
    ok: !stuck,
    unknown,
    why: stuck ? `${stuck} box${stuck === 1 ? '' : 'es'} would not tick` : null
  };
}

// Answers are written as { "field key": answer }, which is the shape the
// caught template hands out. An { "answers": { … } } wrapper and a list of
// { key, answer } rows are both read as the same thing.
//
// What comes back is a list of [key, answer] pairs in the order given. A list
// of rows is kept as a list, not folded into an object: two questions can share
// a wording - Copperhead's "What gave this asset away…" is asked once to be
// written and once to be ticked - and an object would keep only the second.
function chNormalizeAnswers(input) {
  let data = input;
  if (typeof data === 'string') data = JSON.parse(data);
  if (data && !Array.isArray(data) && data.answers && typeof data.answers === 'object') data = data.answers;

  if (Array.isArray(data)) {
    const out = data
      .filter((row) => row && typeof row === 'object' && row.key)
      .map((row) => [String(row.key), row.answer ?? row.value ?? null]);
    if (!out.length) throw new Error('No answers found - each row needs a "key".');
    return out;
  }
  if (!data || typeof data !== 'object') {
    throw new Error('JSON must be an object of answers, keyed by field name.');
  }
  if (Array.isArray(data.criteria)) {
    throw new Error('That is a Geranium criteria list. Switch the project to Geranium to use it.');
  }
  return Object.entries(data);
}

/* ---------- the page ---------- */

const COPPERHEAD_SECTION = '[data-testid^="section-App and Asset Review"], '
  + '[data-testid^="section-Workflow - "], [data-testid^="section-Workflows - "]';

function briefHeadings() {
  return Array.from(document.querySelectorAll(`${LEFT_PANEL} h1, ${LEFT_PANEL} h2, ${LEFT_PANEL} h3, ${LEFT_PANEL} h4`));
}

function isCopperheadPage() {
  if (document.querySelector(COPPERHEAD_SECTION)) return true;
  const heads = briefHeadings().map((h) => norm(h.textContent));
  return heads.includes('task id')
    && heads.some((h) => h === 'application(s) used' || h === 'app download link');
}

function copperheadStage() {
  const h = headingText();
  if (/adjudicat/i.test(h)) return 'adjudication';
  if (/review/i.test(h)) return 'review';
  return 'submission';
}

// A field's own controls, not those of a follow-up question nested inside it.
function own(fieldEl, selector) {
  return Array.from(fieldEl.querySelectorAll(selector)).filter((el) => el.closest(FIELD) === fieldEl);
}

// Five shapes: a single choice (radios), several (checkboxes), a dropdown,
// a number and written text. Uploads are reported, never written to.
// The box confirming the task was done without AI assistance. Ticking it is
// the reviewer's own statement, so it is neither caught nor answered.
const CH_CONFIRMATION = /\bwithout\s+(?:any\s+)?(?:ai|llms?|large language models?)\b|\bai\s+assistance\b/i;

function chKind(fieldEl) {
  if (/s3fileuploader/i.test(fieldEl.getAttribute('data-testid') || '')
    || own(fieldEl, '[data-testid="s3-uploaded-file"], input[type="file"]').length) return 'file';
  if (own(fieldEl, '[role="radiogroup"], input[type="radio"]').length) return 'choice';
  if (own(fieldEl, '[role="checkbox"], input[type="checkbox"]').length) {
    return CH_CONFIRMATION.test(blockText(fieldEl)) ? 'confirmation' : 'flags';
  }
  if (own(fieldEl, 'select, [role="combobox"], button[aria-haspopup="listbox"]').length) return 'select';
  if (own(fieldEl, 'textarea').length) return 'text';
  if (own(fieldEl, 'input[type="number"], input[inputmode="numeric"], input[inputmode="decimal"]').length) return 'number';
  if (own(fieldEl, 'input:not([type="hidden"])').length) return 'text';
  return 'other';
}

function chControl(fieldEl) {
  return own(fieldEl, 'textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"])')[0] || null;
}

// A checkbox here may be a button playing the part, with its words in the
// label around it rather than inside it, or a plain input inside a label.
function chFlagOptions(fieldEl) {
  let boxes = own(fieldEl, '[role="checkbox"]');
  const roles = boxes.length > 0;
  if (!roles) boxes = own(fieldEl, 'input[type="checkbox"]');
  return boxes.map((box) => {
    const label = box.closest('label')
      || (box.id ? fieldEl.querySelector(`label[for="${CSS.escape(box.id)}"]`) : null);
    const text = oneLine(box.innerText || box.textContent || '')
      || oneLine(label?.innerText || label?.textContent || '')
      || textOfMarkup(box.getAttribute('aria-label'))
      || (roles ? '' : box.value);
    const checked = roles ? box.getAttribute('aria-checked') === 'true' : box.checked;
    return { text, checked, box: roles ? box : (label || box) };
  }).filter((o) => o.text);
}

// A dropdown is either a real <select> or a button that opens a listbox
// somewhere else in the page; either way, what it shows is its answer.
function selectTrigger(fieldEl) {
  return own(fieldEl, '[role="combobox"], button[aria-haspopup="listbox"]')[0] || null;
}

function readSelect(fieldEl) {
  const native = own(fieldEl, 'select')[0];
  if (native) {
    const options = Array.from(native.options)
      .filter((o) => o.value !== '')
      .map((o) => ({ value: o.value, text: oneLine(o.textContent) || o.value }));
    const picked = native.value ? options.find((o) => o.value === native.value) : null;
    return { options, answer: picked ? picked.text : null };
  }
  const trigger = selectTrigger(fieldEl);
  const shown = oneLine(trigger?.innerText || trigger?.textContent || '');
  const empty = !shown || /^(select|choose|pick)\b/i.test(shown) || trigger?.hasAttribute('data-placeholder');
  return { options: null, answer: empty ? null : shown };
}

async function setSelect(fieldEl, value, base) {
  const native = own(fieldEl, 'select')[0];
  if (native) {
    const options = Array.from(native.options).map((o) => ({ value: o.value, text: oneLine(o.textContent), o }));
    const pick = chMatchOption(options, value);
    if (!pick) return { ok: false, why: `no option matching "${oneLine(value)}"` };
    native.scrollIntoView({ block: 'center' });
    await wait(base * 6);
    setDiscrete(native, pick.value);
    return { ok: true };
  }

  const trigger = selectTrigger(fieldEl);
  if (!trigger) return { ok: false, why: 'no dropdown to open' };
  trigger.scrollIntoView({ block: 'center' });
  await wait(base * 6);
  trigger.click();
  const list = await until(() => Array.from(document.querySelectorAll('[role="option"]')).filter(isVisible).length
    ? Array.from(document.querySelectorAll('[role="option"]')).filter(isVisible) : null, { timeout: 2500 });
  if (!list) return { ok: false, why: 'the dropdown did not open' };

  const options = list.map((el) => ({
    value: el.getAttribute('data-value') || oneLine(el.textContent),
    text: oneLine(el.textContent),
    el
  }));
  const pick = chMatchOption(options, value);
  if (!pick) {
    trigger.click(); // close it again rather than leave it hanging open
    return { ok: false, why: `no option matching "${oneLine(value)}"` };
  }
  await wait(base * 4);
  pick.el.click();
  const took = await until(() => norm(readSelect(fieldEl).answer || '') === norm(pick.text), { timeout: 2000 });
  return took ? { ok: true } : { ok: false, why: 'the page did not take the choice' };
}

function readChField(fieldEl) {
  const key = chKey(fieldEl);
  if (!key) return null;
  const kind = chKind(fieldEl);
  // Uploads are not answers, and the "without AI assistance" confirmation is
  // the reviewer's own to make - neither is carried off the page.
  if (kind === 'file' || kind === 'other' || kind === 'confirmation') return null;

  const { question, guidelines } = chDescribe(fieldEl);
  const out = { key, label: chLabel(fieldEl), kind };
  if (question) out.question = question;
  if (guidelines && guidelines !== question) out.guidelines = guidelines;

  if (kind === 'choice') {
    const opts = chRadioOptions(fieldEl);
    out.options = opts.map((o) => ({ value: o.value, text: o.text }));
    const picked = opts.find((o) => o.checked);
    // The wording on screen, not the stored value: "Mostly. A few details…"
    // says more than whatever the page keeps behind it.
    out.answer = picked ? picked.text : null;
  } else if (kind === 'flags') {
    const opts = chFlagOptions(fieldEl);
    out.options = opts.map((o) => ({ text: o.text }));
    out.answer = opts.filter((o) => o.checked).map((o) => o.text);
  } else if (kind === 'select') {
    const { options, answer } = readSelect(fieldEl);
    if (options) out.options = options;
    out.answer = answer;
  } else {
    const ctl = chControl(fieldEl);
    const v = ctl ? String(ctl.value ?? '').trim() : '';
    out.answer = !v ? null : kind === 'number' && !Number.isNaN(Number(v)) ? Number(v) : v;
  }
  return out;
}

function chFields(root = document) {
  return chFieldList(root);
}

function readChSections() {
  const out = [];
  for (const sec of document.querySelectorAll(SECTION)) {
    const name = oneLine((sec.getAttribute('data-testid') || '').replace(/^section-/, ''));
    const fields = chFields(sec).map(readChField).filter(Boolean);
    const block = { name: name || 'Section', fields };
    const intro = chSectionIntro(sec);
    if (intro) block.intro = intro;
    // A section still shut behind an earlier answer is listed anyway, so the
    // reader can see what is yet to come.
    if (!fields.length) block.waiting = true;
    out.push(block);
  }
  const loose = chFields().filter((f) => !f.closest(SECTION)).map(readChField).filter(Boolean);
  if (loose.length) out.push({ name: 'Other questions', fields: loose });
  return out;
}

// The task brief: each h3 on the left and whatever sits under it.
function readBrief() {
  const out = [];
  for (const h of briefHeadings()) {
    const label = oneLine(h.textContent);
    const box = h.parentElement;
    if (!label || !box) continue;
    const value = Array.from(box.children)
      .filter((el) => el !== h && !el.contains(h))
      .map((el) => blockText(el))
      .filter(Boolean)
      .join('\n')
      .trim();
    const row = { label, value: value || null };
    const href = box.querySelector('a[href]')?.getAttribute('href');
    if (href && href !== value) row.link = href;
    out.push(row);
  }
  return out;
}

function readLastSaved() {
  const m = (document.body.innerText || '').match(/last saved at\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

// Uploaded files: the asset itself and the screenshot, each with the time it
// went up when the page shows one.
const STAMP = /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/;

function readUploads() {
  return Array.from(document.querySelectorAll('[data-testid="s3-uploaded-file"]')).map((box) => {
    const field = box.closest(FIELD);
    const lines = blockText(box).split('\n').map((l) => l.trim()).filter(Boolean);
    const name = lines[0] || null;
    const time = lines.find((l) => l !== name && STAMP.test(l)) || null;
    const row = { field: field ? fieldLabel(field) : null, name };
    if (time) row.time = time;
    return row;
  }).filter((f) => f.name);
}

// Notes - automated feedback and reviewer feedback - can sit in the notes
// sidebar or in accordions in the page; both are read, and a note seen twice
// is kept once.
async function readChNotes() {
  const seen = new Set();
  const out = [];
  for (const n of [...readSidebarNotes(), ...await readNotes()]) {
    const k = `${n.title}|${n.time || ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    delete n.latest;
    n.kind = AUTO_NOTE.test(n.title) ? 'automated' : 'reviewer';
    out.push(n);
  }
  markLatest(out);
  return out;
}

async function readCopperhead() {
  await openNotes();
  const opened = await expandEverything();

  const notes = await readChNotes();
  const brief = readBrief();
  const uploads = readUploads();
  const sections = readChSections();

  if (!brief.length && !sections.some((s) => s.fields.length)) {
    throw new Error('Nothing found on this page - no task brief and no form. Is this a Copperhead task?');
  }

  const answers = {};
  let answered = 0;
  for (const sec of sections) {
    for (const f of sec.fields) {
      answers[f.key] = f.answer === undefined ? null : f.answer;
      if (chIsAnswered(f.answer)) answered++;
    }
  }

  const stage = copperheadStage();
  const uid = readUid();
  const taskId = brief.find((b) => /^task id$/i.test(b.label))?.value || null;
  const lastSaved = readLastSaved();

  const content = { title: headingText() || null, stage };
  if (taskId) content.taskId = taskId;
  if (lastSaved) content.lastSaved = lastSaved;
  if (brief.length) content.brief = brief;
  if (uploads.length) content.uploads = uploads;
  if (notes.length) {
    content.taskNotes = notes;
    const latest = notes.find((n) => n.latest);
    if (latest) content.latestNote = { title: latest.title, time: latest.time || null };
  }
  content.sections = sections;

  const data = { project: 'copperhead', stage };
  if (uid) data.uid = uid;
  if (taskId) data.taskId = taskId;
  data.content = content;
  data.answers = answers;

  return {
    data,
    meta: {
      project: 'copperhead',
      opened,
      fields: Object.keys(answers).length,
      answered,
      notes: notes.length,
      waiting: sections.filter((s) => s.waiting).length
    }
  };
}

// The wordings a field answers to: its label, and the question beneath it.
function chWordings(fieldEl) {
  return [chLabel(fieldEl), chDescribe(fieldEl).question].filter(Boolean);
}

const CH_CLOSE_ENOUGH = 0.75; // share of words two wordings must have in common

// A key is the field's own name ("boolean-were_you_able_to_…"). A question's
// wording works as well, which is how a follow-up that was not on the page at
// catch time is answered - and it is compared loosely, so "->" finds "→",
// "(1-10)" finds "(1–10)", and a wording a word or so off still finds its
// question when no other comes as close. Two questions can share a wording -
// one written, one ticked - so a list goes to the one that ticks.
function findChField(key, value) {
  const fields = chFields().filter((f) => !['file', 'other'].includes(chKind(f)));
  const want = String(key);

  const byKey = fields.find((f) => chKey(f) === want);
  if (byKey) return byKey;

  const loose = chLoose(want);
  let hits = fields.filter((f) => chWordings(f).some((w) => chLoose(w) === loose));
  if (!hits.length) {
    const scored = fields
      .map((f) => ({ f, s: Math.max(...chWordings(f).map((w) => chLikeness(w, want))) }))
      .filter((x) => x.s >= CH_CLOSE_ENOUGH)
      .sort((a, b) => b.s - a.s);
    hits = scored.filter((x) => x.s === scored[0]?.s).map((x) => x.f);
  }
  if (hits.length < 2) return hits[0] || null;
  const ticks = Array.isArray(value);
  return hits.find((f) => (chKind(f) === 'flags') === ticks) || hits[0];
}

// Answers are written in the order given, one question at a time, with the
// Delay after each. A question an earlier answer brings in is waited for;
// anything that cannot be written is named rather than passed over.
async function applyCopperhead(input, options = {}) {
  if (busy) throw new Error('Already typing. Press Stop first.');

  // A key left empty is a question deliberately not being answered, so only
  // what the answer actually says is written to the page.
  const rows = chNormalizeAnswers(input)
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) throw new Error('No answers to write - every field was left empty.');
  if (!isCopperheadPage()) throw new Error('This does not look like a Copperhead task page.');

  const base = Math.max(0, Number(options.speed ?? 200));
  const paste = options.entry === 'paste'; // typing is the default here
  const gap = Math.max(0, Number(options.gap ?? 5000));
  hiddenDuringRun = false;
  busy = true;
  cancelled = false;
  stayAwake();
  progress = { index: 0, total: rows.length, phase: 'starting', unit: 'answer' };

  const skippedFields = [];
  const truncated = [];
  const refused = [];
  const unknownFlags = [];
  const leftToYou = [];
  let filled = 0;

  try {
    progress = { index: 0, total: rows.length, phase: 'opening', unit: 'answer' };
    await expandEverything();

    for (let i = 0; i < rows.length; i++) {
      checkCancelled();
      const [key, value] = rows[i];
      progress = { index: i + 1, total: rows.length, phase: 'filling', unit: 'answer' };
      if (document.hidden) hiddenDuringRun = true;

      // A follow-up mounts a moment after the answer that asks for it, and a
      // whole section appears only once both download answers are Yes - shut,
      // so it is opened and given a few seconds more.
      let fieldEl = await until(() => findChField(key, value), { timeout: 1200, step: 100 });
      if (!fieldEl) {
        await expandEverything();
        fieldEl = await until(() => findChField(key, value), { timeout: 4000, step: 150 });
      }
      if (!fieldEl) { skippedFields.push(key); continue; }

      const kind = chKind(fieldEl);
      if (kind === 'confirmation') {
        // The reviewer's own statement: never ticked on their behalf.
        leftToYou.push(chLabel(fieldEl) || key);
        continue;
      }
      if (kind === 'choice') {
        const r = await chSetChoice(fieldEl, value, base);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else if (kind === 'flags') {
        // A lone box answered true or false is ticked or not.
        const ticks = typeof value === 'boolean'
          ? (value ? chFlagOptions(fieldEl).map((o) => o.text) : [])
          : value;
        const r = await chSetFlags(fieldEl, ticks, base);
        if (r.unknown?.length) unknownFlags.push(`"${key}": ${r.unknown.join('; ')}`);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else if (kind === 'select') {
        const r = await setSelect(fieldEl, value, base);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else {
        const ctl = chControl(fieldEl);
        if (!ctl) { skippedFields.push(key); continue; }
        const r = paste
          ? await pasteInto(ctl, value, base)
          : await typeInto(ctl, value, base);
        if (r.truncated) truncated.push(`"${key}"`);
        filled++;
      }

      await pause(gap); // the Delay, before the next answer
    }
  } finally {
    busy = false;
    progress = null;
    letSleep();
  }

  return {
    project: 'copperhead',
    requested: rows.length,
    filled,
    ranInBackground: hiddenDuringRun,
    skippedFields,
    truncated,
    refused,
    unknownFlags,
    leftToYou
  };
}

/* ---------- registration ---------- */

PAGE_PROJECTS.copperhead = {
  detect: () => (isCopperheadPage() ? 'its task brief' : null),
  read: readCopperhead,
  apply: applyCopperhead,
  ping: () => ({
    copperhead: isCopperheadPage()
      ? { stage: copperheadStage(), fields: chFields().filter((f) => !['file', 'other', 'confirmation'].includes(chKind(f))).length }
      : null
  })
};
