/* Criteria Catcher - page side: Rudder.

   A Rudder task is a different page altogether. The left half shows the
   conversation and the two candidate responses; the right half is a form of
   rating scales, failure-mode flag lists and written explanations; the task
   notes live in a sidebar of their own. There is no criteria list, so none of
   the reading above applies to it - but the field wrapper, the accordions and
   the typing behave exactly as they do on a Geranium page, so those are
   shared rather than written a second time. */

/* Needs core.js and form.js. */

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
  const key = formKey(fieldEl);
  if (!key) return null;

  const kind = rudderKind(fieldEl);
  const { question, guidelines } = describeField(fieldEl);
  const out = { key, label: formLabel(fieldEl), kind };
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
    const fields = formFields(sec).map(readRudderField).filter(Boolean);
    if (!fields.length) continue;
    const block = { name: name || 'Section', fields };
    const intro = sectionIntro(sec);
    if (intro) block.intro = intro;
    out.push(block);
  }

  // Anything the page asks outside a section still has to be answered.
  const loose = formFields().filter((f) => !f.closest(SECTION))
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
  return fields.find((f) => formKey(f) === want)
    || fields.find((f) => norm(formLabel(f)) === norm(want))
    || null;
}

const RUDDER_FORM = {
  project: 'rudder',
  name: 'Rudder',
  isPage: () => isRudderPage(),
  find: (key) => findRudderField(key),
  kind: rudderKind,
  flags: flagOptions,
  control,
  patience: 0
};

async function applyRudder(input, options = {}) {
  return applyForm(input, options, RUDDER_FORM);
}

/* ---------- registration ---------- */

PAGE_PROJECTS.rudder = {
  detect: () => (isRudderPage() ? 'its rating sections' : null),
  read: readRudder,
  apply: applyRudder,
  ping: () => ({ rudderFields: isRudderPage() ? formFields().length : 0 })
};
