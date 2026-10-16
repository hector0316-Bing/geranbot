/* Criteria Catcher - page side: Copperhead.

   A Copperhead (Snorkel) task sits in the same document-review layout as
   Rudder: the task brief on the left - Task ID, the application, its download
   link, the workflow, domain, persona, trigger and outcome, each under an h3 -
   and a form of sections on the right. The form is answered with the same
   clicks and keystrokes as Rudder's, so it runs on the same engine.

   Much of the form only exists once an earlier answer asks for it: the
   sections after "Download" appear when both download questions are Yes, and
   several explanations appear only for one particular choice. Those are
   waited for as the answers bring them in.

   Only Submission has been seen. Review and Adjudication are recorded as
   their own stage and read the same way until a sample shows what they
   carry of their own. */

/* Needs core.js and form.js. */

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
function chKind(fieldEl) {
  if (/s3fileuploader/i.test(fieldEl.getAttribute('data-testid') || '')
    || own(fieldEl, '[data-testid="s3-uploaded-file"], input[type="file"]').length) return 'file';
  if (own(fieldEl, '[role="radiogroup"], input[type="radio"]').length) return 'choice';
  if (own(fieldEl, '[role="checkbox"], input[type="checkbox"]').length) return 'flags';
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
    const pick = matchOption(options, value);
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
  const pick = matchOption(options, value);
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
  const key = formKey(fieldEl);
  if (!key) return null;
  const kind = chKind(fieldEl);
  if (kind === 'file' || kind === 'other') return null;

  const { question, guidelines } = describeField(fieldEl);
  const out = { key, label: formLabel(fieldEl), kind };
  if (question) out.question = question;
  if (guidelines && guidelines !== question) out.guidelines = guidelines;

  if (kind === 'choice') {
    const opts = radioOptions(fieldEl);
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
  return formFields(root);
}

function readChSections() {
  const out = [];
  for (const sec of document.querySelectorAll(SECTION)) {
    const name = oneLine((sec.getAttribute('data-testid') || '').replace(/^section-/, ''));
    const fields = chFields(sec).map(readChField).filter(Boolean);
    const block = { name: name || 'Section', fields };
    const intro = sectionIntro(sec);
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

// Notes can arrive in the sidebar, as on Rudder, or as accordions in the page,
// as on Geranium; both are read and a note seen twice is kept once.
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
      if (isAnswered(f.answer)) answered++;
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

// A key is the field's own name; a question's wording works as well, which is
// how a follow-up that was not on the page at catch time can be answered. Two
// questions can share a wording - one written, one ticked - so a list goes to
// the one that ticks.
function findChField(key, value) {
  const want = String(key);
  const fields = chFields();
  const byKey = fields.find((f) => formKey(f) === want);
  if (byKey) return byKey;
  const byLabel = fields.filter((f) => norm(formLabel(f)) === norm(want) && chKind(f) !== 'file');
  if (byLabel.length < 2) return byLabel[0] || null;
  const ticks = Array.isArray(value);
  return byLabel.find((f) => (chKind(f) === 'flags') === ticks) || byLabel[0];
}

const COPPERHEAD_FORM = {
  project: 'copperhead',
  name: 'Copperhead',
  isPage: () => isCopperheadPage(),
  find: findChField,
  kind: chKind,
  flags: chFlagOptions,
  control: chControl,
  // A follow-up can take a moment to mount, and a whole section only appears
  // once both download answers are Yes.
  patience: 4000
};

async function applyCopperhead(input, options = {}) {
  return applyForm(input, options, COPPERHEAD_FORM);
}

/* ---------- registration ---------- */

PAGE_PROJECTS.copperhead = {
  detect: () => (isCopperheadPage() ? 'its task brief' : null),
  read: readCopperhead,
  apply: applyCopperhead,
  ping: () => ({
    copperhead: isCopperheadPage()
      ? { stage: copperheadStage(), fields: chFields().filter((f) => !['file', 'other'].includes(chKind(f))).length }
      : null
  })
};
