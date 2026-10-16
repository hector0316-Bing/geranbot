/* Criteria Catcher - page side: Rudder.

   A Rudder task is a different page altogether. The left half shows the
   conversation and the two candidate responses; the right half is a form of
   rating scales, failure-mode flag lists and written explanations; the task
   notes live in a sidebar of their own. There is no criteria list, so none of
   the reading above applies to it - but the field wrapper, the accordions and
   the typing behave exactly as they do on a Geranium page, so those are
   shared rather than written a second time. */

/* Needs core.js. */

/* ---------- the fields ---------- */

function rudderKey(fieldEl) {
  return (fieldEl.getAttribute('data-testid') || '').replace(/^field-/, '') || null;
}

function rudderFields(root = document) {
  return Array.from(root.querySelectorAll(FIELD)).filter((f) => rudderKey(f));
}

// A rating scale keeps its real value in an input beside the button that is
// actually clicked: "5", "not_applicable", "A > B". That value is what the
// page stores, so it is what the answers are written in.
function radioOptions(fieldEl) {
  return Array.from(fieldEl.querySelectorAll('input[type="radio"]')).filter((input) => input.closest(FIELD) === fieldEl).map((input) => {
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

// Flags have no inputs at all - each one is a div playing the part of a
// checkbox - so they are known by the words beside them.
function flagOptions(fieldEl) {
  return Array.from(fieldEl.querySelectorAll('[role="checkbox"]')).map((box) => ({
    text: oneLine(box.innerText || box.textContent || '')
      || textOfMarkup(box.getAttribute('aria-label')),
    checked: box.getAttribute('aria-checked') === 'true',
    box
  }));
}

// A field's own description: the first line is the question being asked, the
// rest is the project's guidance on how to answer it. That guidance runs to
// pages, so the two are kept apart and the reader chooses.
function describeField(fieldEl) {
  const desc = Array.from(fieldEl.querySelectorAll('[class*="_description_"]'))
    .find((d) => d.closest(FIELD) === fieldEl);
  const full = blockText(desc);
  if (!full) return { question: null, guidelines: null };
  const first = full.split('\n').map((l) => l.trim()).find(Boolean) || null;
  return { question: first, guidelines: full };
}

// Most fields carry a label; a bare flag list carries only its description
// ("Failure-mode flags (check all that apply):"), so fall back to that.
function rudderLabel(fieldEl) {
  const lab = fieldLabel(fieldEl);
  if (lab) return lab;
  const { question } = describeField(fieldEl);
  return question ? question.replace(/[:.]\s*$/, '') : rudderKey(fieldEl);
}

function sectionIntro(sec) {
  const desc = Array.from(sec.querySelectorAll('[class*="_description_"]'))
    .find((d) => !d.closest(FIELD));
  return blockText(desc) || null;
}

function isAnswered(answer) {
  if (Array.isArray(answer)) return answer.length > 0;
  return answer !== null && answer !== undefined && answer !== '';
}

/* ---------- writing the answers back ---------- */

// The same answer can be written several ways - the stored value ("5",
// "not_applicable"), the wording on screen, or just the part before the colon
// that a person would say out loud ("5", "N/A", "OK"). Yes and no are how the
// true/false flags are usually spoken, so they are read as each other.
const SAME_AS = new Map([
  ['yes', 'true'], ['true', 'yes'],
  ['no', 'false'], ['false', 'no'],
  ['n/a', 'not_applicable'], ['na', 'not_applicable'], ['not applicable', 'not_applicable']
]);

function optionHead(text) {
  return norm(String(text).split(/[:.]/)[0]);
}

function matchOption(options, value) {
  const want = norm(value);
  if (!want) return null;
  const tries = [want, SAME_AS.get(want)].filter(Boolean);

  // Strictest reading first: an exact stored value beats a loose prefix, so
  // "A > B" is never taken for "A >> B".
  for (const reading of [
    (o, w) => norm(o.value) === w,
    (o, w) => norm(o.text) === w,
    (o, w) => optionHead(o.text) === w,
    (o, w) => w.length >= 4 && norm(o.text).startsWith(w)
  ]) {
    for (const w of tries) {
      const hit = options.find((o) => reading(o, w));
      if (hit) return hit;
    }
  }
  return null;
}

// A flag is named by its wording. A shortened name is allowed as long as it
// is long enough to mean only one of them.
function sameFlag(wanted, optionText) {
  const a = norm(wanted);
  const b = norm(optionText);
  return a === b || (a.length >= 8 && b.startsWith(a));
}

function flagList(value) {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.map(String).filter((v) => v.trim());
  const one = String(value).trim();
  return one && !/^(none|no flags)$/i.test(one) ? [one] : [];
}

// A choice re-renders the moment it is made, so what the click did is read
// back off the page rather than off the node that was clicked.
async function setChoice(fieldEl, value, base) {
  const options = radioOptions(fieldEl);
  if (!options.length) return { ok: false, why: 'no options to choose from' };

  const pick = matchOption(options, value);
  if (!pick) return { ok: false, why: `no option matching "${oneLine(value)}"` };

  const chosen = () => radioOptions(fieldEl).some((o) => o.checked && o.value === pick.value);
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
async function setFlags(fieldEl, value, base, options = flagOptions) {
  const wanted = flagList(value);
  const names = options(fieldEl).map((o) => o.text);
  if (!names.length) return { ok: false, why: 'no flags to tick' };

  const unknown = wanted.filter((w) => !names.some((n) => sameFlag(w, n)));
  let stuck = 0;

  for (const name of names) {
    checkCancelled();
    const on = wanted.some((w) => sameFlag(w, name));
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
    why: stuck ? `${stuck} flag${stuck === 1 ? '' : 's'} would not tick` : null
  };
}

// Answers are written as { "field key": answer }, which is the shape the
// caught template hands out. An { "answers": { … } } wrapper and a list of
// { key, answer } rows are both read as the same thing.
//
// What comes back is a list of [key, answer] pairs in the order given; a list
// of rows stays a list, so no row is lost to another with the same key.
function normalizeAnswers(input) {
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

const RICH_DOC = '[data-testid="rich-doc-rendered"]';
// The split document review used to be Rudder's alone and was taken as proof
// of it. Every project now sits in that layout - Geranium Refinement and
// Terminus carry the same left panel and submit button - so only what Rudder
// asks for itself counts: its rating sections, or its name in the heading.
const RUDDER_SECTION = '[data-testid^="section-Rating Assessment"], [data-testid^="section-Overall preference"]';

function isRudderPage() {
  return !!document.querySelector(RUDDER_SECTION) || /\brudder\b/i.test(headingText());
}

// Three shapes cover the whole form: a single choice on a scale, a list of
// failure-mode flags to tick, and something to write in.
function rudderKind(fieldEl) {
  if (fieldEl.querySelector('[role="radiogroup"], input[type="radio"]')) return 'choice';
  if (fieldEl.querySelector('[role="checkbox"]')) return 'flags';
  if (fieldEl.querySelector('textarea')) return 'text';
  if (fieldEl.querySelector('input:not([type="hidden"]), select')) return 'value';
  return 'other';
}

function readRudderField(fieldEl) {
  const key = rudderKey(fieldEl);
  if (!key) return null;

  const kind = rudderKind(fieldEl);
  const { question, guidelines } = describeField(fieldEl);
  const out = { key, label: rudderLabel(fieldEl), kind };
  if (question) out.question = question;
  if (guidelines && guidelines !== question) out.guidelines = guidelines;

  if (kind === 'choice') {
    const opts = radioOptions(fieldEl);
    out.options = opts.map((o) => ({ value: o.value, text: o.text }));
    const picked = opts.find((o) => o.checked);
    out.answer = picked ? picked.value : null;
    if (picked) out.answerText = picked.text;
  } else if (kind === 'flags') {
    const opts = flagOptions(fieldEl);
    out.options = opts.map((o) => ({ text: o.text }));
    out.answer = opts.filter((o) => o.checked).map((o) => o.text);
  } else {
    const v = fieldValue(fieldEl);
    out.answer = v === '' ? null : v;
  }
  return out;
}

/* ---------- Rudder: the task itself ---------- */

// The heading that introduces a block - "Context", "Response A" - sits above
// it rather than inside it, so climb out until a heading that precedes it
// turns up, and take the nearest one.
function headingAbove(el, stop) {
  for (let node = el; node && node !== stop; node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent) break;
    const head = Array.from(parent.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .filter((h) => !h.contains(el)
        && (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
      .pop();
    if (head) return oneLine(head.textContent);
    if (parent === stop) break;
  }
  return null;
}

// The conversation and the two responses, each under the heading it is shown
// with. A page laid out some other way still gives up its text in one piece.
function readRudderDocs() {
  const panel = document.querySelector(LEFT_PANEL);
  if (!panel) return [];

  const docs = Array.from(panel.querySelectorAll(RICH_DOC));
  if (!docs.length) {
    const text = blockText(panel);
    return text ? [{ title: 'Task', text }] : [];
  }
  return docs
    .map((doc, i) => ({
      title: headingAbove(doc, panel) || `Part ${i + 1}`,
      text: blockText(doc)
    }))
    .filter((d) => d.text);
}

function readRudderSections() {
  const out = [];
  for (const sec of document.querySelectorAll(SECTION)) {
    const name = oneLine((sec.getAttribute('data-testid') || '').replace(/^section-/, ''));
    const fields = rudderFields(sec).map(readRudderField).filter(Boolean);
    if (!fields.length) continue;
    const block = { name: name || 'Section', fields };
    const intro = sectionIntro(sec);
    if (intro) block.intro = intro;
    out.push(block);
  }

  // Anything the page asks outside a section still has to be answered.
  const loose = rudderFields().filter((f) => !f.closest(SECTION))
    .map(readRudderField).filter(Boolean);
  if (loose.length) out.push({ name: 'Other questions', fields: loose });
  return out;
}

async function readRudder() {
  await openNotes();
  // Sections, notes and the response panes are all accordions, and a closed
  // one has no content in the DOM to be read.
  const opened = await expandEverything();

  const notes = readSidebarNotes();
  const documents = readRudderDocs();
  const sections = readRudderSections();

  if (!sections.length && !documents.length) {
    throw new Error('Nothing found on this page - no task text and no rating form. Is this a Rudder task?');
  }

  // The answers as the page holds them now, in the order it asks for them.
  // First time round they are all empty; on a revision this is the work being
  // sent back, and it is what the next answer is edited from.
  const answers = {};
  let answered = 0;
  for (const sec of sections) {
    for (const f of sec.fields) {
      answers[f.key] = f.answer === undefined ? null : f.answer;
      if (isAnswered(f.answer)) answered++;
    }
  }

  const uid = readUid();
  const content = {
    title: headingText() || null,
    stage: answered || notes.length ? 'revision' : 'first pass'
  };
  if (notes.length) {
    content.taskNotes = notes;
    const latest = notes.find((n) => n.latest);
    if (latest) content.latestNote = { title: latest.title, time: latest.time || null };
  }
  if (documents.length) content.documents = documents;
  content.sections = sections;

  const data = { project: 'rudder', stage: content.stage };
  if (uid) data.uid = uid;
  data.content = content;
  data.answers = answers;

  return {
    data,
    meta: {
      project: 'rudder',
      opened,
      fields: Object.keys(answers).length,
      answered,
      notes: notes.length,
      documents: documents.length
    }
  };
}

/* ---------- Rudder: writing the answers back ---------- */

function findRudderField(key) {
  const want = String(key);
  const fields = Array.from(document.querySelectorAll(FIELD));
  return fields.find((f) => rudderKey(f) === want)
    || fields.find((f) => norm(rudderLabel(f)) === norm(want))
    || null;
}

async function applyRudder(input, options = {}) {
  if (busy) throw new Error('Already typing. Press Stop first.');

  // A key left empty is a question deliberately not being answered, so only
  // what the answer actually says is written to the page.
  const rows = normalizeAnswers(input)
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) throw new Error('No answers to write - every field was left empty.');
  if (!isRudderPage()) throw new Error('This does not look like a Rudder task page.');

  const base = Math.max(0, Number(options.speed ?? 200));
  const paste = options.entry === 'paste'; // typing is the default here
  const gap = Math.max(0, Number(options.gap ?? 2000));
  hiddenDuringRun = false;
  busy = true;
  cancelled = false;
  stayAwake();
  progress = { index: 0, total: rows.length, phase: 'starting', unit: 'field' };

  const skippedFields = [];
  const truncated = [];
  const refused = [];
  const unknownFlags = [];
  let filled = 0;

  try {
    progress = { index: 0, total: rows.length, phase: 'opening', unit: 'field' };
    await expandEverything();

    for (let i = 0; i < rows.length; i++) {
      checkCancelled();
      const [key, value] = rows[i];
      progress = { index: i + 1, total: rows.length, phase: 'filling', unit: 'field' };
      if (document.hidden) hiddenDuringRun = true;

      // Answering one question can bring another into being - the correctness
      // flags exist only once the status says "flagged" - so a field that is
      // not there yet is given a moment to arrive.
      let fieldEl = await until(() => findRudderField(key), { timeout: 1200, step: 100 });
      if (!fieldEl) {
        await expandEverything();
        fieldEl = findRudderField(key);
      }
      if (!fieldEl) { skippedFields.push(key); continue; }

      const kind = rudderKind(fieldEl);
      if (kind === 'choice') {
        const r = await setChoice(fieldEl, value, base);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else if (kind === 'flags') {
        const r = await setFlags(fieldEl, value, base);
        if (r.unknown?.length) unknownFlags.push(`"${key}": ${r.unknown.join('; ')}`);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else {
        const ctl = control(fieldEl);
        if (!ctl) { skippedFields.push(key); continue; }
        if (ctl.type === 'checkbox' || ctl instanceof HTMLSelectElement) {
          setDiscrete(ctl, value);
        } else {
          const r = paste
            ? await pasteInto(ctl, value, base)
            : await typeInto(ctl, value, base);
          if (r.truncated) truncated.push(`"${key}"`);
        }
        filled++;
      }

      await pause(gap); // settle before moving on to the next question
    }
  } finally {
    busy = false;
    progress = null;
    letSleep();
  }

  return {
    project: 'rudder',
    requested: rows.length,
    filled,
    ranInBackground: hiddenDuringRun,
    skippedFields,
    truncated,
    refused,
    unknownFlags
  };
}

/* ---------- registration ---------- */

PAGE_PROJECTS.rudder = {
  detect: () => (isRudderPage() ? 'its rating sections' : null),
  read: readRudder,
  apply: applyRudder,
  ping: () => ({ rudderFields: isRudderPage() ? rudderFields().length : 0 })
};
