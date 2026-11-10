/* Criteria Catcher - page side: Suite Life.

   A Suite Life (Snorkel) task is a review of a coding task that arrives as a
   zip. The left panel carries the task's facts - Task Type, File Name,
   Category, Difficulty, Task Tags, Languages - each under an h3, and a Task
   Report: a rendered document of headings, tables and nested lists saying
   what the task asks, how it is tested, how the models did, and what to
   review. The right side is the form, in accordion sections: Submitter
   Questions, Additional Submitter Questions, Final Comment and Handling Time.

   The form has shapes the other projects do not:

   - a segment selector - "Task Type", Feature or Fix - inside a
     multidimension-radio field, which decides which analysis question
     follows it;
   - "Final grading feedback (previous round)", a disabled box the page fills
     in itself after a sendback. It is read as feedback, never written to;
   - "Comments for Reviewer", a rich-text (TipTap / ProseMirror) editor,
     which is a contenteditable rather than a textarea, so it is written
     with editing commands and a paste event instead of a value setter.

   Nothing here is shared with Copperhead, though both are Snorkel review
   forms: a change for one never moves the other.

   This file is the Submission stage. The Review stage - the same page with
   the submission locked and a Reviewer Feedback section under it - is the
   project's Reviewer tab, in suitelife-review.js, built on what is here:
   the brief, the report, the fields, the typing, the checks. The project is
   registered at the foot of this file and hands each request to the stage
   the panel's tab names, or failing that the one the page shows.

   Needs core.js; suitelife-review.js follows it. */

/* ---------- the page ---------- */

const SL_UPLOAD = '[data-testid^="field-s3fileuploader-suite-life"]';
const SL_REPORT = '[data-testid="rich-doc-rendered"]';
const SL_EDITOR = '[contenteditable="true"]';
const SL_TIMER = '[data-testid="task-expiration-timer"]';

// The brief's own headings, not those inside the Task Report document.
function slBriefHeadings() {
  return Array.from(document.querySelectorAll(`${LEFT_PANEL} h3, ${LEFT_PANEL} h4`))
    .filter((h) => !h.closest(SL_REPORT));
}

function isSuiteLifePage() {
  if (document.querySelector(SL_UPLOAD)) return true;
  if (Array.from(document.querySelectorAll(`${FIELD} label`)).some((l) => /\bsuite\s*life\b/i.test(l.textContent || ''))) {
    return true;
  }
  const heads = slBriefHeadings().map((h) => norm(h.textContent));
  return heads.includes('task report') && heads.includes('difficulty')
    && (heads.includes('file name') || heads.includes('task type'));
}

function suiteLifeStage() {
  const h = headingText();
  if (/adjudicat/i.test(h)) return 'adjudication';
  if (/review/i.test(h)) return 'review';
  return 'submission';
}

/* ---------- the Task Report, as Markdown ----------
   The report is a rendered document: headings, paragraphs with inline code,
   two tables and lists nested two deep. innerText flattens all of that - a
   table comes out as tab-separated runs, and a "Finding:" loses the concept
   it belongs to - so it is written out as Markdown, which keeps the shape. */

function slInline(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) { out += n.textContent; continue; }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = n.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol' || tag === 'table') continue; // blocks, handled by the caller
    if (tag === 'br') { out += '\n'; continue; }
    const inner = slInline(n);
    if (tag === 'code') out += `\`${n.textContent}\``;
    else if (tag === 'strong' || tag === 'b') out += inner.trim() ? `**${inner.trim()}** ` : '';
    else if (tag === 'em' || tag === 'i') out += inner.trim() ? `_${inner.trim()}_ ` : '';
    else if (tag === 'a' && n.getAttribute('href')) out += `[${inner.trim()}](${n.getAttribute('href')})`;
    else out += inner;
  }
  return out;
}

// Inline text, spaces collapsed. A line break the paragraph itself carries
// ("…the raw output.\nInstruction: task/instruction.md") is kept, except in
// a table cell, which has to stay on its row.
function slLine(node, { oneRow = false } = {}) {
  const lines = slInline(node)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').trim())
    .filter(Boolean);
  return lines.join(oneRow ? ' ' : '\n');
}

function slList(list, depth) {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const pad = '  '.repeat(depth);
  const out = [];
  let n = 0;
  for (const li of list.children) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    n++;
    out.push(`${pad}${ordered ? `${n}.` : '-'} ${slLine(li, { oneRow: true })}`);
    for (const sub of li.children) {
      const t = sub.tagName.toLowerCase();
      if (t === 'ul' || t === 'ol') out.push(slList(sub, depth + 1));
    }
  }
  return out.join('\n');
}

function slTable(table) {
  const rows = Array.from(table.querySelectorAll('tr'))
    .map((tr) => Array.from(tr.children).map((c) => slLine(c, { oneRow: true }).replace(/\|/g, '\\|')));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] || '').join(' | ')} |`;
  const out = [line(rows[0]), `|${' --- |'.repeat(width)}`];
  for (const r of rows.slice(1)) out.push(line(r));
  return out.join('\n');
}

function slMarkdown(root) {
  const out = [];
  const walk = (el) => {
    for (const n of el.children) {
      const tag = n.tagName.toLowerCase();
      const h = tag.match(/^h([1-6])$/);
      if (h) out.push(`${'#'.repeat(Number(h[1]))} ${slLine(n, { oneRow: true })}`);
      else if (tag === 'p') { const t = slLine(n); if (t) out.push(t); }
      else if (tag === 'ul' || tag === 'ol') out.push(slList(n, 0));
      else if (tag === 'table') out.push(slTable(n));
      else if (tag === 'pre') out.push(`\`\`\`\n${(n.textContent || '').replace(/\n+$/, '')}\n\`\`\``);
      else if (tag === 'blockquote') {
        const inner = slMarkdown(n);
        if (inner) out.push(inner.split('\n').map((l) => `> ${l}`).join('\n'));
      } else if (tag === 'hr') out.push('---');
      else walk(n); // a wrapper: look inside it
    }
  };
  walk(root);
  return out.filter(Boolean).join('\n\n').trim();
}

/* ---------- the left panel ---------- */

// Each h3 and what sits beside it. A list (Task Tags, Languages) is read item
// by item; the Task Report is the one heading whose value is a document, and
// it is taken apart from the rest.
function readSlBrief() {
  const brief = [];
  let report = null;
  for (const h of slBriefHeadings()) {
    const label = oneLine(h.textContent);
    const box = h.parentElement;
    if (!label || !box) continue;

    const doc = box.querySelector(SL_REPORT);
    if (doc && !h.contains(doc)) {
      report = slMarkdown(doc) || blockText(doc) || null;
      continue;
    }

    const items = Array.from(box.querySelectorAll('li')).map((li) => oneLine(li.textContent)).filter(Boolean);
    const value = items.length
      ? items.join(', ')
      : Array.from(box.children)
        .filter((el) => el !== h && !el.contains(h))
        .map((el) => blockText(el))
        .filter(Boolean)
        .join('\n')
        .trim();
    const row = { label, value: value || null };
    const href = box.querySelector('a[href]')?.getAttribute('href');
    if (href && href !== value) row.link = href;
    brief.push(row);
  }
  return { brief, report };
}

// The Evaluation Criteria sidebar. Empty on a first submission, where it
// says "No evaluation information available".
const SL_NO_EVAL = /^no evaluation information available\.?$/i;

function readSlEvaluation() {
  const panel = document.querySelector(NOTES_PANEL);
  if (!panel) return null;
  const head = Array.from(panel.querySelectorAll('div, span, h2, h3'))
    .find((el) => /^evaluation criteria$/i.test(oneLine(el.textContent)));
  if (!head) return null;
  const text = blockText(panel)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^evaluation criteria$/i.test(l) && !/^close sidebar$/i.test(l))
    .join('\n')
    .trim();
  return text && !SL_NO_EVAL.test(text) ? text : null;
}

// The sidebar can be shut; its toggle is the "evaluation" button.
async function openSlEvaluation() {
  if (document.querySelector(NOTES_PANEL)) return false;
  const btn = document.querySelector('button[aria-label="evaluation"]');
  if (!btn || btn.disabled) return false;
  btn.click();
  await until(() => document.querySelector(NOTES_PANEL), { timeout: 2500 });
  return true;
}

function readSlLastSaved() {
  const m = (document.body.innerText || '').match(/last saved at\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

function readSlTimeLeft() {
  return oneLine(document.querySelector(SL_TIMER)?.textContent) || null;
}

/* ---------- the fields ----------
   A field is usually one question, but not always: the "(SEGMENTS)" field
   holds two segment selectors - Task Type (Feature, Fix) and Analysis
   (OpenFlags, Easy, Valid, Fixable) - whose radios all share one name. So the
   unit here is a question: a field, and for a segment field the selector it
   means. Its key is the field's name, with the segment after a colon:
   "multidimensionradio-segments-valid:Analysis". */

// "field-textarea-hard_parts_covered" -> "textarea-hard_parts_covered"
function slKey(fieldEl) {
  return (fieldEl.getAttribute('data-testid') || '').replace(/^field-/, '') || null;
}

function slFields(root = document) {
  return Array.from(root.querySelectorAll(FIELD)).filter((f) => slKey(f));
}

// A field's own controls, not those of a field nested inside it.
function slOwn(fieldEl, selector) {
  return Array.from(fieldEl.querySelectorAll(selector)).filter((el) => el.closest(FIELD) === fieldEl);
}

const SL_SEGMENT = '[data-testid^="segment-selector-"][data-testid$="-radiogroup"]';

function slSegments(fieldEl) {
  return slOwn(fieldEl, SL_SEGMENT);
}

// "segment-selector-Task Type-radiogroup" asks "Task Type".
function slSegName(seg) {
  return seg.getAttribute('data-testid').replace(/^segment-selector-/, '').replace(/-radiogroup$/, '').trim();
}

// What sits in a description but is not the description: the controls, and
// the labels the page repeats inside it.
const SL_NOT_WORDS = '[role="checkbox"], [role="radiogroup"], [data-testid^="segment-selector-"], [role="toolbar"], '
  + '[contenteditable], textarea, input, select, button, label, [data-testid^="s3-"]';

// A description, line by line, without the controls inside it. Paragraphs
// keep their bold and lists stay lists, so a template such as Trajectory
// notes' reads as the template it is.
function slDescLines(el, out = []) {
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = oneLine(n.textContent);
      if (t) out.push(t);
      continue;
    }
    if (n.nodeType !== Node.ELEMENT_NODE || n.matches(SL_NOT_WORDS)) continue;
    if (n.querySelector(SL_NOT_WORDS)) { slDescLines(n, out); continue; }
    const tag = n.tagName.toLowerCase();
    const t = tag === 'ul' || tag === 'ol' ? slList(n, 0) : /^(p|h[1-6])$/.test(tag) ? slLine(n) : blockText(n);
    if (t) out.push(t);
  }
  return out;
}

// "Task Type required" is a marker, not guidance; "Complete required fields
// first: …" is the state of a check, read on its own.
const SL_MARKER = /^[\w ]{1,40} required$|^complete required fields first\b/i;

function slDescribe(fieldEl) {
  const desc = slOwn(fieldEl, '[class*="_description_"]')[0];
  const lines = desc ? slDescLines(desc).filter((l) => !SL_MARKER.test(l)) : [];
  const full = lines.join('\n').trim();
  if (!full) return { question: null, guidelines: null };
  return { question: lines[0], guidelines: full };
}

function slControl(fieldEl) {
  return slOwn(fieldEl, 'textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"])')[0] || null;
}

function slEditor(fieldEl) {
  return slOwn(fieldEl, SL_EDITOR)[0] || null;
}

function slBoxes(fieldEl) {
  return slOwn(fieldEl, '[role="checkbox"]');
}

// A list of boxes each saying "I reviewed…", "I checked…" is the reviewer
// attesting to their own work. It is ticked only when the answers say so -
// a list of statements, one per box, or true for all of them.
function slIsConfirmation(fieldEl) {
  if (/confirmation/i.test(`${slKey(fieldEl)} ${fieldLabel(fieldEl)}`)) return true;
  const texts = slBoxOptions(fieldEl).map((o) => o.text);
  return texts.length > 0 && texts.every((t) => /^i\s/i.test(t));
}

// The shapes: segments (one or more selectors), a single choice, boxes to
// tick, confirmations, a check button, a rich-text box, written text, a
// number, an upload, and a box the page fills in itself. Uploads and the
// page's own boxes are read, never written to; checks are pressed only
// after the answers, when asked to.
function slKind(fieldEl) {
  const id = fieldEl.getAttribute('data-testid') || '';
  if (/feedbackbutton/i.test(id)) return 'check';
  if (/s3fileuploader/i.test(id)
    || slOwn(fieldEl, '[data-testid="s3-uploaded-file"], [data-testid="s3-upload-drop-zone"], input[type="file"]').length) return 'file';
  if (slSegments(fieldEl).length) return 'segments';
  if (slOwn(fieldEl, '[role="radiogroup"], input[type="radio"]').length) return 'choice';
  if (slBoxes(fieldEl).length) return slIsConfirmation(fieldEl) ? 'confirmation' : 'flags';
  if (slEditor(fieldEl)) return 'richtext';
  const ctl = slControl(fieldEl);
  if (ctl && (ctl.disabled || ctl.readOnly)) return 'readonly';
  if (slOwn(fieldEl, 'textarea').length) return 'text';
  if (slOwn(fieldEl, 'input[type="number"], input[inputmode="numeric"], input[inputmode="decimal"]').length) return 'number';
  if (ctl) return 'text';
  return 'other';
}

// What a fill can write to.
const SL_WRITABLE = new Set(['segment', 'choice', 'flags', 'confirmation', 'richtext', 'text', 'number']);

// A choice is a button with role="radio" beside a hidden input holding the
// stored value ("Fixable", "Valid", "OpenFlags"), inside a label carrying the
// wording on screen. Within a segment selector, only its own radios.
function slRadioOptions(fieldEl, seg = null) {
  return Array.from((seg || fieldEl).querySelectorAll('input[type="radio"]'))
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

// A box is a div with role="checkbox"; its words are inside it, or kept as
// escaped HTML in its aria-label.
function slBoxOptions(fieldEl) {
  return slBoxes(fieldEl).map((box) => ({
    text: oneLine(box.innerText || box.textContent || '') || textOfMarkup(box.getAttribute('aria-label')),
    checked: box.getAttribute('aria-checked') === 'true',
    box
  })).filter((o) => o.text);
}

// What a rich-text box holds. An empty TipTap editor is one paragraph with a
// placeholder and a trailing <br>, which reads as nothing.
function slEditorText(ed) {
  if (!ed) return '';
  if (ed.querySelector('.is-editor-empty') && !oneLine(ed.textContent)) return '';
  return blockText(ed);
}

function slIsAnswered(answer) {
  if (Array.isArray(answer)) return answer.length > 0;
  return answer !== null && answer !== undefined && answer !== '';
}

// A check sits behind its button and is never pressed here. It has answered
// (a result panel is showing), is waiting to be asked, or is locked until
// another passes - "Complete required fields first: Static Checks".
function readSlCheck(fieldEl, base) {
  const results = checkPanels().filter((p) => p.field === fieldEl).map((p) => p.result);
  const lock = (fieldEl.innerText || fieldEl.textContent || '').match(/complete required fields first:?\s*([^\n]*)/i);
  const btn = slOwn(fieldEl, 'button[data-testid="feedback-check"], button')
    .find((b) => !/^clear feedback/i.test(buttonText(b))) || null;
  if (results.length) base.state = 'answered';
  else if (btn && !btn.disabled) base.state = 'not run';
  else base.state = 'locked';
  if (!results.length && lock) base.waitsFor = lock[1].trim() || null;
  if (results.length) base.results = results;
  return [base];
}

// Every question a field asks, read off the page: a list, since a segment
// field asks one per selector.
function readSlField(fieldEl) {
  const key = slKey(fieldEl);
  if (!key) return [];
  const kind = slKind(fieldEl);
  if (kind === 'file' || kind === 'other') return [];

  const { question, guidelines } = slDescribe(fieldEl);
  const label = fieldLabel(fieldEl) || (question ? question.replace(/[:.]\s*$/, '') : key);

  if (kind === 'segments') {
    // The field's own label is the question the segments belong to, and its
    // description - what each analysis means - is kept with the first.
    const about = label.replace(/^\(segments\)\s*/i, '');
    return slSegments(fieldEl).map((seg, i) => {
      const name = slSegName(seg);
      const opts = slRadioOptions(fieldEl, seg);
      const out = { key: `${key}:${name}`, label: name, kind: 'segment', question: about };
      if (i === 0 && guidelines) out.guidelines = guidelines;
      out.options = opts.map((o) => ({ value: o.value, text: o.text }));
      out.answer = opts.find((o) => o.checked)?.text || null;
      return out;
    });
  }

  const out = { key, label, kind };
  const area = slAreas().get(fieldEl);
  if (area) {
    // One of several boxes with this label: named after its review area.
    out.area = area.area;
    out.name = area.name;
  }
  if (question && question !== label) out.question = question;
  if (guidelines && guidelines !== question) out.guidelines = guidelines;

  if (kind === 'check') return readSlCheck(fieldEl, out);
  if (kind === 'choice') {
    const opts = slRadioOptions(fieldEl);
    out.options = opts.map((o) => ({ value: o.value, text: o.text }));
    out.answer = opts.find((o) => o.checked)?.text || null;
  } else if (kind === 'flags' || kind === 'confirmation') {
    // The policy pledges are ticked on every fill, so they are not caught:
    // a group made only of them - LLM Policy - is left out whole.
    const opts = slBoxOptions(fieldEl)
      .filter((o) => kind !== 'confirmation' || !slMustTick(fieldEl, o.text));
    if (!opts.length && kind === 'confirmation') return [];
    out.options = opts.map((o) => ({ text: o.text }));
    out.answer = opts.filter((o) => o.checked).map((o) => o.text);
  } else if (kind === 'richtext') {
    out.answer = slEditorText(slEditor(fieldEl)) || null;
  } else {
    const ctl = slControl(fieldEl);
    const v = ctl ? String(ctl.value ?? '').trim() : '';
    out.answer = !v ? null : kind === 'number' && !Number.isNaN(Number(v)) ? Number(v) : v;
  }
  return [out];
}

// A section's trigger and whether it is open. The sections are base-ui
// accordions, and a shut one keeps its fields out of the DOM.
function slSectionTrigger(sec) {
  return sec.querySelector('h3 button[aria-expanded], button[aria-expanded][aria-controls]');
}

async function slOpenSection(sec) {
  const btn = slSectionTrigger(sec);
  if (!btn || btn.getAttribute('aria-expanded') !== 'false') return false;
  btn.click();
  await until(() => btn.getAttribute('aria-expanded') === 'true' && slFields(sec).length, { timeout: 2500 });
  return true;
}

// Each section in turn, opened first if it is shut. One at a time rather than
// all at once, so a form that keeps only one section open is read whole.
// Uploads are left out of the questions - they are listed on their own.
async function readSlSections() {
  const out = [];
  for (const sec of document.querySelectorAll(SECTION)) {
    await slOpenSection(sec);
    const name = oneLine((sec.getAttribute('data-testid') || '').replace(/^section-/, ''));
    const fields = slFields(sec).flatMap(readSlField);
    const block = { name: name || 'Section', fields };
    if (!fields.length && !slFields(sec).length) block.waiting = true;
    out.push(block);
  }
  const loose = slFields().filter((f) => !f.closest(SECTION)).flatMap(readSlField);
  if (loose.length) out.push({ name: 'Other questions', fields: loose });
  return out;
}

// Every upload field: the task zip as it came, and the place to re-upload a
// fixed one. One with nothing in it yet is listed too, so it is not missed.
function readSlUploads() {
  return slFields().filter((f) => slKind(f) === 'file').map((field) => {
    const names = slOwn(field, '[data-testid="s3-uploaded-file"]')
      .map((box) => blockText(box).split('\n').map((l) => l.trim()).find(Boolean))
      .filter(Boolean);
    return { key: slKey(field), field: fieldLabel(field) || slKey(field), files: names };
  });
}

// Task notes, from the notes sidebar and from note accordions in the page. A
// note seen in both is kept once.
async function readSlNotes() {
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

async function readSuiteLife() {
  await openSlEvaluation();
  await openNotes();
  const opened = await expandEverything();

  const notes = await readSlNotes();
  const { brief, report } = readSlBrief();
  const evaluation = readSlEvaluation();
  const sections = await readSlSections();
  const uploads = readSlUploads();

  if (!brief.length && !report && !sections.some((s) => s.fields.length)) {
    throw new Error('Nothing found on this page - no task facts, no report and no form. Is this a Suite Life task?');
  }

  // A box the page fills in itself - the previous round's grading feedback -
  // is feedback to act on, not a question to answer. Checks and
  // confirmations are read, but they are not answers a fill writes.
  const feedback = [];
  const checks = [];
  const confirmations = [];
  const answers = {};
  let fields = 0;
  let answered = 0;
  for (const sec of sections) {
    for (const f of sec.fields) {
      if (f.kind === 'readonly') {
        if (f.answer) feedback.push({ label: f.label, text: f.answer });
        continue;
      }
      if (f.kind === 'check') { checks.push(f); continue; }
      if (f.kind === 'confirmation') {
        confirmations.push(f);
        answers[f.key] = f.answer || [];
        continue;
      }
      fields++;
      answers[f.name || f.key] = f.answer === undefined ? null : f.answer;
      if (slIsAnswered(f.answer)) answered++;
    }
  }

  const stage = suiteLifeStage();
  const uid = readUid();
  const fileName = brief.find((b) => /^file name$/i.test(b.label))?.value || null;
  const lastSaved = readSlLastSaved();
  const timeLeft = readSlTimeLeft();

  const content = { title: headingText() || null, stage };
  if (lastSaved) content.lastSaved = lastSaved;
  if (timeLeft) content.timeLeft = timeLeft;
  if (feedback.length) content.previousFeedback = feedback;
  if (notes.length) {
    content.taskNotes = notes;
    const latest = notes.find((n) => n.latest);
    if (latest) content.latestNote = { title: latest.title, time: latest.time || null };
  }
  if (evaluation) content.evaluation = evaluation;
  if (brief.length) content.brief = brief;
  if (uploads.length) content.uploads = uploads;
  if (report) content.report = report;
  content.sections = sections;

  const data = { project: 'suitelife', stage };
  if (uid) data.uid = uid;
  if (fileName) data.fileName = fileName;
  data.content = content;
  data.answers = answers;

  return {
    data,
    meta: {
      project: 'suitelife',
      opened,
      fields,
      answered,
      notes: notes.length,
      feedback: feedback.length,
      report: !!report,
      checks: checks.map((c) => ({ label: c.label, state: c.state, waitsFor: c.waitsFor || null,
        failed: (c.results || []).filter((r) => !r.passed).length })),
      confirmations: confirmations.map((c) => ({ label: c.label, ticked: c.answer.length, of: c.options.length })),
      emptyUploads: uploads.filter((u) => !u.files.length).map((u) => slShortLabel(u.field)),
      waiting: sections.filter((s) => s.waiting).length
    }
  };
}

/* ---------- matching wording loosely ---------- */

function slLoose(s) {
  return oneLine(s).toLowerCase()
    .replace(/->|→|⟶|⇒|=>/g, ' to ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const slTight = (s) => slLoose(s).replace(/ /g, '');

const SL_SAME_AS = new Map([
  ['yes', 'true'], ['true', 'yes'],
  ['no', 'false'], ['false', 'no']
]);

// The part of an option a person would say: "Fixable" for "Fixable (The task
// has issues in the instructions…)".
function slOptionHead(text) {
  return slLoose(String(text).split(/[:.(]/)[0]);
}

// Strictest reading first. The last ones are for the Analysis segment, whose
// options are the stored values themselves - "OpenFlags", "Easy", "Valid" - so
// "Open Flags", "Suspected too easy" and "Valid-as-is" still find theirs.
function slMatchOption(options, value) {
  const want = norm(value);
  if (!want) return null;
  const tries = [want, SL_SAME_AS.get(want)].filter(Boolean);
  for (const reading of [
    (o, w) => norm(o.value) === w,
    (o, w) => norm(o.text) === w,
    (o, w) => slLoose(o.text) === slLoose(w),
    (o, w) => slOptionHead(o.text) === slLoose(w),
    (o, w) => slTight(o.value) === slTight(w) || slTight(o.text) === slTight(w),
    (o, w) => slLoose(w).length >= 4 && slLoose(o.text).startsWith(slLoose(w)),
    (o, w) => slTight(o.value).length >= 4
      && (slTight(w).startsWith(slTight(o.value)) || slTight(w).endsWith(slTight(o.value)))
  ]) {
    for (const w of tries) {
      const hit = options.find((o) => reading(o, w));
      if (hit) return hit;
    }
  }
  return null;
}

/* ---------- writing the answers back ---------- */

// The same shapes Copperhead takes, read on their own: { "key": answer }, an
// { "answers": { … } } wrapper, or a list of { key, answer } rows. A list
// keeps its order and its duplicates.
function slNormalizeAnswers(input) {
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

async function slSetChoice(fieldEl, seg, value, base) {
  const options = slRadioOptions(fieldEl, seg);
  if (!options.length) return { ok: false, why: 'no options to choose from' };

  const pick = slMatchOption(options, value);
  if (!pick) return { ok: false, why: `no option matching "${oneLine(value)}"` };

  // A choice re-renders the moment it is made, so what the click did is read
  // back off the page rather than off the node that was clicked.
  const chosen = () => slRadioOptions(fieldEl, seg).some((o) => o.checked && o.value === pick.value);
  if (chosen()) return { ok: true, already: true };

  const target = pick.btn || pick.label;
  if (!target) return { ok: false, why: 'the option has nothing to click' };
  target.scrollIntoView({ block: 'center' });
  await wait(base * 6); // a beat to look at it before choosing
  target.click();
  if (await until(chosen, { timeout: 2000 })) return { ok: true };

  pick.label?.click();
  return await until(chosen, { timeout: 1500 })
    ? { ok: true }
    : { ok: false, why: 'the page did not take the choice' };
}

function slFlagList(value) {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.map(String).filter((v) => v.trim());
  const one = String(value).trim();
  return one && !/^(none|no flags)$/i.test(one) ? [one] : [];
}

function slSameFlag(wanted, optionText) {
  const a = slLoose(wanted);
  const b = slLoose(optionText);
  return a === b || (a.length >= 8 && b.startsWith(a));
}

// Ticking is stated in full: every box named is put on and every other one
// taken off, so the page ends up saying exactly what the answer says.
async function slSetFlags(fieldEl, value, base) {
  const wanted = typeof value === 'boolean'
    ? (value ? slBoxOptions(fieldEl).map((o) => o.text) : [])
    : slFlagList(value);
  const names = slBoxOptions(fieldEl).map((o) => o.text);
  if (!names.length) return { ok: false, why: 'no boxes to tick' };

  const unknown = wanted.filter((w) => !names.some((n) => slSameFlag(w, n)));
  let stuck = 0;
  for (const name of names) {
    checkCancelled();
    const on = wanted.some((w) => slSameFlag(w, name));
    const now = slBoxOptions(fieldEl).find((o) => o.text === name);
    if (!now || now.checked === on) continue;
    now.box.scrollIntoView({ block: 'center' });
    await wait(base * 6);
    now.box.click();
    if (!await until(() => slBoxOptions(fieldEl).find((o) => o.text === name)?.checked === on, { timeout: 1500 })) stuck++;
  }
  return { ok: !stuck, unknown, why: stuck ? `${stuck} box${stuck === 1 ? '' : 'es'} would not tick` : null };
}

// Boxes ticked whatever the answer says, and when it says nothing: every
// LLM Policy box, and the pledges that the writing is the reviewer's own.
const SL_ALWAYS_AREA = /^llm policy\b/i;
const SL_ALWAYS_BOX = [
  /\bclaude fable\b/i,
  /\bllm-assisted analysis was human verified\b/i,
  /\bwritten in my own words\b/i,
  /\bhuman written\b/i
];
function slMustTick(fieldEl, boxText) {
  return SL_ALWAYS_AREA.test(slAreaName(fieldLabel(fieldEl) || ''))
    || SL_ALWAYS_BOX.some((re) => re.test(oneLine(boxText)));
}

// The always-ticked boxes on the page that are not ticked yet; ticks them.
async function slTickPledges(base) {
  const ticked = [];
  for (const q of slQuestions().filter((x) => x.kind === 'confirmation')) {
    const opts = slBoxOptions(q.field);
    const must = opts.filter((o) => slMustTick(q.field, o.text));
    if (!must.length || must.every((o) => o.checked)) continue;
    const wanted = opts.filter((o) => o.checked || slMustTick(q.field, o.text)).map((o) => o.text);
    const r = await slSetFlags(q.field, wanted, base);
    if (r.ok) ticked.push(slAreaName(fieldLabel(q.field)));
  }
  return ticked;
}

// Confirmations take true (or "all", "yes") for every box, false for none,
// or a list. A list naming the boxes ticks those; a list of statements in
// the reviewer's own words - one per box, in order - ticks a box for each.
async function slSetConfirmations(fieldEl, value, base) {
  const names = slBoxOptions(fieldEl).map((o) => o.text);
  if (!names.length) return { ok: false, why: 'no boxes to tick' };

  let wanted;
  let note = null;
  const one = typeof value === 'string' ? value.trim() : null;
  if (value === true || (one !== null && /^(all|yes|true|confirmed|done)$/i.test(one))) {
    wanted = names;
  } else if (value === false || (one !== null && /^(none|no|false)$/i.test(one))) {
    wanted = [];
  } else {
    // Each entry is a box's wording, a statement, or an object
    // { confirmation, checked, note } - the note is the reviewer's own and
    // has no box on the page.
    const entries = (Array.isArray(value) ? value : [value])
      .filter((e) => e !== null && e !== undefined && e !== '')
      .map((e) => (typeof e === 'object'
        ? { text: String(e.confirmation ?? e.text ?? e.label ?? e.box ?? ''), on: e.checked !== false && e.ticked !== false }
        : { text: String(e), on: true }));
    // Which box an entry names: its wording, or close to it.
    const boxFor = (text) => {
      const exact = names.find((n) => slSameFlag(text, n));
      if (exact) return exact;
      const scored = names.map((n) => ({ n, ...slCoverage(text, n) }))
        .filter((x) => x.held >= SL_CLOSE_ENOUGH)
        .sort((a, b) => b.held - a.held || b.near - a.near);
      return scored[0] && !(scored[1] && scored[1].held === scored[0].held && scored[1].near === scored[0].near)
        ? scored[0].n : null;
    };
    const named = entries.map((e) => boxFor(e.text));
    if (named.every(Boolean) && new Set(named).size === named.length) {
      wanted = named.filter((n, i) => entries[i].on);
    } else {
      // Statements in the reviewer's own words: one per box, in order. The
      // pledges are ticked anyway, so a list that leaves them out is laid
      // over the other boxes.
      const rest = names.filter((n) => !slMustTick(fieldEl, n));
      const slots = entries.length === rest.length && rest.length < names.length ? rest : names;
      wanted = slots.filter((n, i) => entries[i]?.on);
      if (entries.length !== slots.length) {
        note = `${entries.length} statement${entries.length === 1 ? '' : 's'} for ${slots.length} boxes - taken in order`;
      }
    }
  }
  // The pledges are ticked even when the answer leaves them out.
  wanted = names.filter((n) => wanted.includes(n) || slMustTick(fieldEl, n));
  const r = await slSetFlags(fieldEl, wanted, base);
  return { ...r, unknown: [], note };
}

/* ---------- the checks, alongside the answers ----------
   Static Checks is pressed as the fill begins and runs while the answers
   are typed. Once it has answered with every result a PASS, Instruction
   Review - locked until then - is pressed, still alongside the typing. A
   Static Checks that fails stops there: Instruction Review is not pressed.

   Nothing here scrolls or takes focus, so the typing is not disturbed. The
   fields are looked up afresh each time: a section shut by the page while
   another is typed into takes its check out of the DOM for a while, and
   that time is not counted against the wait. */

const SL_CHECK_STEPS = [
  { name: 'Static Checks', label: /static/i },
  { name: 'Instruction Review', label: /instruction/i }
];

function slCheckField(step, index) {
  const fields = slFields().filter((f) => slKind(f) === 'check');
  return fields.find((f) => step.label.test(fieldLabel(f))) || fields[index] || null;
}

function slCheckButton(fieldEl) {
  if (!fieldEl) return null;
  return slOwn(fieldEl, 'button[data-testid="feedback-check"]').find((b) => !b.disabled)
    || slOwn(fieldEl, 'button').find((b) => !b.disabled && !/clear feedback/i.test(buttonText(b)) && CHECK_BUTTON.test(buttonText(b)))
    || null;
}

function slCheckResults(fieldEl) {
  return fieldEl ? checkPanels().filter((p) => p.field === fieldEl).map((p) => p.result) : [];
}

// A press as a pointer makes one, without moving the caret out of the box
// being typed into.
function slPress(btn) {
  const at = { bubbles: true, cancelable: true, view: window, button: 0 };
  btn.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }));
  btn.dispatchEvent(new MouseEvent('mousedown', at));
  btn.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }));
  btn.dispatchEvent(new MouseEvent('mouseup', at));
  btn.click();
}

let slChecksHalt = false; // the fill the checks run beside has ended early

// Wait on `fn`, counting only the time the check's field is on the page.
async function slAwaitShown(find, fn, timeout) {
  let spent = 0;
  for (;;) {
    checkCancelled();
    if (slChecksHalt) throw new Error('the fill ended early');
    const field = find();
    const v = field ? fn(field) : null;
    if (v) return v;
    if (field && !document.hidden) spent += 250;
    if (spent > timeout) return null;
    await wait(250);
  }
}

// One check: press it (clearing a failed answer first) and wait for its
// answer. A check already passing is left as it is.
async function slRunCheck(step, index, { timeout }) {
  const find = () => slCheckField(step, index);
  const label = step.name;
  if (!await slAwaitShown(find, () => true, 60000)) return { label, outcome: 'not on the page' };

  const before = find();
  if (checkFinished(before)) {
    const had = slCheckResults(before);
    if (had.length && had.every((r) => r.passed)) return { label, outcome: 'already passing', results: had };
    const clear = slOwn(before, 'button').find((b) => !b.disabled && /clear feedback/i.test(buttonText(b)));
    if (clear) {
      slPress(clear);
      await slAwaitShown(find, (f) => !checkFinished(f), 10000);
    }
  }

  // Instruction Review unlocks a moment after Static Checks passes.
  const btn = await slAwaitShown(find, (f) => slCheckButton(f), 60000);
  if (!btn) {
    const lock = readSlCheck(find(), { label })[0];
    return { label, outcome: lock.waitsFor ? `locked - waits for ${lock.waitsFor}` : 'button disabled' };
  }
  slPress(btn);

  const done = await slAwaitShown(find, (f) => checkFinished(f), timeout);
  const results = slCheckResults(find());
  return { label, outcome: done ? 'answered' : 'no answer yet', results };
}

// Both checks in turn; never throws, so the fill it runs beside is not cut
// short by it. Stop still ends it.
async function slChecksAlongside({ timeout = 300000 } = {}) {
  const ran = [];
  try {
    for (let i = 0; i < SL_CHECK_STEPS.length; i++) {
      const step = SL_CHECK_STEPS[i];
      if (i > 0) {
        const prev = ran[i - 1];
        const passed = /answered|passing/.test(prev.outcome)
          && prev.results?.length && prev.results.every((r) => r.passed);
        if (!passed) {
          ran.push({ label: step.name, outcome: `not pressed - ${prev.label} did not pass` });
          continue;
        }
      }
      ran.push(await slRunCheck(step, i, { timeout }));
    }
  } catch (e) {
    ran.push({ label: 'Checks', outcome: cancelled ? 'stopped' : `stopped - ${e.message}` });
  }
  return ran;
}

/* ---------- the rich-text box ----------
   TipTap renders a contenteditable and keeps its own document, which it
   rebuilds from what it sees the browser do. A value setter means nothing to
   it, so it is written the way the browser writes: editing commands for each
   key, a keydown Enter for a new paragraph, and a real paste event for Paste
   per field. Where no editor answers a key or a paste, the browser's own
   editing commands do the same job, so the box still ends up holding the
   text. */

const slSpaces = (s) => String(s).replace(/\s+/g, ' ').trim();

function slSelectAll(ed) {
  ed.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(ed);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function slCaretToEnd(ed) {
  const range = document.createRange();
  range.selectNodeContents(ed);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// A key goes to the editor first. Where it acts on the key itself - Enter
// splits the paragraph, Backspace at the start of one joins it to the last -
// it cancels the event, and the browser's own command must not then do it a
// second time.
function slEditorPress(ed, key, command, arg) {
  const down = new KeyboardEvent('keydown', {
    key, code: key === 'Enter' ? 'Enter' : undefined, keyCode: key === 'Enter' ? 13 : undefined,
    bubbles: true, cancelable: true
  });
  if (ed.dispatchEvent(down)) document.execCommand(command, false, arg);
  ed.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function slEditorKey(ed, ch) {
  if (ch === '\n') slEditorPress(ed, 'Enter', 'insertParagraph');
  else slEditorPress(ed, ch, 'insertText', ch);
}

function slEditorBackspace(ed) {
  slEditorPress(ed, 'Backspace', 'delete');
}

async function slClearEditor(ed, base) {
  if (!slEditorText(ed)) return;
  slSelectAll(ed);
  slEditorBackspace(ed);
  await wait(base * 2);
  if (slEditorText(ed)) {
    // Something survived (a list item, a heading): select again and go.
    slSelectAll(ed);
    document.execCommand('delete', false);
    await wait(base);
  }
}

// A key the editor alone acts on - Tab to indent a list item, Shift-Tab to
// bring it back out. The browser has no command of its own for these.
function slEditorChord(ed, key, { shiftKey = false } = {}) {
  const init = { key, code: key, keyCode: key === 'Tab' ? 9 : undefined, shiftKey, bubbles: true, cancelable: true };
  ed.dispatchEvent(new KeyboardEvent('keydown', init));
  ed.dispatchEvent(new KeyboardEvent('keyup', init));
}

// How many list items deep the caret sits.
function slCaretDepth(ed) {
  let d = 0;
  for (let n = window.getSelection()?.anchorNode; n && n !== ed; n = n.parentNode) {
    if (n.nodeName === 'LI') d++;
  }
  return d;
}

// A line of the answer, read the way Markdown reads it: "  - Kept …" is a
// list item one level in, "1. Read …" a numbered one, anything else a plain
// paragraph.
const SL_LIST_LINE = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/;

function slParseLine(line) {
  const m = line.match(SL_LIST_LINE);
  if (!m) return { depth: 0, marker: null, body: line };
  const indent = m[1].replace(/\t/g, '  ').length;
  return { depth: Math.floor(indent / 2) + 1, marker: /\d/.test(m[2]) ? '1. ' : '- ', body: m[3] };
}

// Bring the caret to a list depth with Tab and Shift-Tab, stopping where the
// editor will not go further (the first item of a list cannot be indented).
async function slReachDepth(ed, want, base) {
  for (let guard = 0; guard < 8; guard++) {
    const now = slCaretDepth(ed);
    if (now === want) return;
    slEditorChord(ed, 'Tab', { shiftKey: now > want });
    await wait(keyDelay(base, ' ', ''));
    if (slCaretDepth(ed) === now) return;
  }
}

// One run of text, typed at the Pace with the same rhythm, hesitations and
// corrected slips as every other field.
async function slTypeRun(ed, text, base, slips) {
  const chars = Array.from(text);
  let corrections = 0;
  for (let i = 0; i < chars.length; i++) {
    checkCancelled();
    const ch = chars[i];
    const prev = chars[i - 1];
    if (prev === ' ' && /\w/.test(ch) && Math.random() < THINK_RATE) await pause(base * rand(4, 12));

    const slip = slips && Math.random() < TYPO_RATE ? slipFor(ch) : null;
    if (!slip) {
      slEditorKey(ed, ch);
      await wait(keyDelay(base, ch, prev));
      continue;
    }
    for (const k of slip) {
      slEditorKey(ed, k);
      await wait(keyDelay(base, k, prev));
    }
    let carried = 0;
    if (Math.random() < NOTICE_LATE) {
      const more = Math.floor(rand(1, 4));
      while (carried < more && i + 1 + carried < chars.length) {
        const k = chars[i + 1 + carried];
        slEditorKey(ed, k);
        await wait(keyDelay(base, k, chars[i + carried]));
        carried++;
      }
    }
    await pause(base * rand(1.5, 4));
    for (let n = slip.length + carried; n > 0; n--) {
      checkCancelled();
      slEditorBackspace(ed);
      await wait(Math.round(base * rand(0.35, 0.7)));
    }
    await wait(Math.round(base * rand(0.8, 1.8)));
    corrections++;
    i--;
  }
  return corrections;
}

// Typed line by line. A list is written the way a person writes one in the
// editor: "- " at the start of a paragraph turns it into a list, Enter makes
// the next item, Tab and Shift-Tab move an item in and out, and the marker
// is not typed again inside a list - TipTap would keep it as text. Where the
// box makes no lists of its own, the lines go in as written.
async function slTypeIntoEditor(ed, value, base) {
  const target = String(value ?? '').replace(/\r\n?/g, '\n');
  ed.scrollIntoView({ block: 'center' });
  ed.focus({ preventScroll: true });
  await wait(base);
  await slClearEditor(ed, base);
  ed.focus({ preventScroll: true });
  slCaretToEnd(ed);
  await pause(base * rand(2, 6));

  const slips = target.length >= 12;
  let corrections = 0;
  const lines = target.split('\n');
  for (let i = 0; i < lines.length; i++) {
    checkCancelled();
    if (i) {
      slEditorKey(ed, '\n');
      await wait(keyDelay(base, '\n', ''));
    }
    const line = slParseLine(lines[i]);
    const inList = slCaretDepth(ed) > 0;

    if (!line.marker) {
      // Out of the list first, then the paragraph.
      if (inList) await slReachDepth(ed, 0, base);
      corrections += await slTypeRun(ed, line.body, base, slips);
    } else if (inList) {
      await slReachDepth(ed, line.depth, base);
      corrections += await slTypeRun(ed, line.body, base, slips);
    } else {
      // A fresh paragraph: the marker starts the list (and stays as text
      // where the box has no lists), then any further levels.
      await slTypeRun(ed, line.marker, base, false);
      if (slCaretDepth(ed) > 0) {
        await slReachDepth(ed, line.depth, base);
      } else if (line.depth > 1) {
        await slTypeRun(ed, '  '.repeat(line.depth - 1), base, false);
      }
      corrections += await slTypeRun(ed, line.body, base, slips);
    }
  }

  await wait(base * 2);
  return { typed: target.length, corrections, matches: await slEditorHolds(ed, target, base) };
}

/* Markdown-ish text as HTML, for a paste the editor can build lists, code
   and bold from: nested "- " and "1. " lists, `code`, **bold**, and a
   paragraph per other line. */

const slEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function slInlineHtml(text) {
  return text.split(/(`[^`]+`)/).map((part) => (/^`[^`]+`$/.test(part)
    ? `<code>${slEscape(part.slice(1, -1))}</code>`
    : slEscape(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'))).join('');
}

function slTextToHtml(text) {
  const out = [];
  const open = []; // the list tags open, innermost last
  const closeTo = (depth) => {
    while (open.length > depth) out.push(`</li></${open.pop()}>`);
  };
  for (const raw of text.split('\n')) {
    const line = slParseLine(raw);
    if (!line.marker) {
      closeTo(0);
      out.push(line.body.trim() ? `<p>${slInlineHtml(line.body)}</p>` : '<p></p>');
      continue;
    }
    const tag = line.marker === '- ' ? 'ul' : 'ol';
    const depth = Math.min(line.depth, open.length + 1); // no skipping a level
    closeTo(depth);
    if (open.length === depth) out.push('</li>');
    while (open.length < depth) {
      open.push(tag);
      out.push(`<${tag}>`);
    }
    out.push(`<li><p>${slInlineHtml(line.body)}</p>`);
  }
  closeTo(0);
  return out.join('');
}

// The whole text as one paste, carried as HTML as well as plain text so the
// lists, code and bold come through as they would from a document.
async function slPasteIntoEditor(ed, value, base) {
  const target = String(value ?? '').replace(/\r\n?/g, '\n');
  ed.scrollIntoView({ block: 'center' });
  ed.focus({ preventScroll: true });
  await wait(base * 4);
  await slClearEditor(ed, base);
  ed.focus({ preventScroll: true });
  slCaretToEnd(ed);

  let taken = false;
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', target);
    dt.setData('text/html', slTextToHtml(target));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    taken = !ed.dispatchEvent(ev);
  } catch { /* no DataTransfer here: fall back below */ }
  if (!taken) {
    const lines = target.split('\n');
    lines.forEach((line, i) => {
      if (i) document.execCommand('insertParagraph', false);
      if (line) document.execCommand('insertText', false, line);
    });
  }
  await wait(base * 2);
  return { typed: target.length, matches: await slEditorHolds(ed, target, base) };
}

// Only the words and figures, for comparing: list markers become bullets,
// backticks become code and spacing changes, none of which is a wrong answer.
const slGist = (s) => String(s).replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
  .replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

// Whether the box says what was asked.
async function slEditorHolds(ed, target, base) {
  const want = slGist(target);
  return !!(await until(() => slGist(slEditorText(ed)) === want, { timeout: Math.max(800, base * 6) }));
}

/* ---------- finding the question an answer is for ---------- */

// Every question on the page, as { field, seg }: a segment field once per
// selector, every other field once.
function slQuestions() {
  const out = [];
  for (const field of slFields()) {
    const kind = slKind(field);
    if (kind === 'file' || kind === 'other') continue;
    if (kind === 'segments') {
      for (const seg of slSegments(field)) out.push({ field, seg, kind: 'segment' });
    } else {
      out.push({ field, seg: null, kind });
    }
  }
  return out;
}

const slQKey = (q) => (q.seg ? `${slKey(q.field)}:${slSegName(q.seg)}` : slKey(q.field));

// The words of a field's own name without its kind: "list_of_open_flags" from
// "textarea-list_of_open_flags", "how_long_in_minutes…" from "numeric-how_…".
// A name built on a hash ("radio-760f2-feature", "textarea-d9b92") says
// nothing.
function slKeyWords(field) {
  const key = slKey(field);
  if (/^[a-z]+-[0-9a-f]{5}(?:-|$)/i.test(key)) return null;
  return key.replace(/^[a-z]+-/i, '').replace(/[_-]+/g, ' ').trim() || null;
}

/* Boxes that share a label. On a Fix / Fixable task every review area -
   Instructions, Tagging and Metadata, Solution, the four test and reward
   reviews, Environment - is a list of confirmations followed by its own
   "Findings - Required confirmation" and "Edits made - Required
   confirmation" boxes, five pairs with the same two labels and mostly
   hashed names. Each is told apart by the area whose confirmations it
   follows: "Findings" after Instructions is instructions_findings. The
   confirmation lists since the pair before count as well, so the pair after
   Tests And Rewards, Verifier, Validation and Rubric review answers to any
   of those names. */

const slAreaName = (label) => oneLine(label).replace(/\s*-\s*required confirmations?\s*$/i, '');
const slSnake = (s) => slLoose(s).replace(/ /g, '_');

function slAreas() {
  const fields = slFields();
  const count = new Map();
  for (const f of fields) {
    const l = slLoose(fieldLabel(f));
    if (l) count.set(l, (count.get(l) || 0) + 1);
  }
  const out = new Map();
  let block = [];
  let pairSeen = false;
  for (const f of fields) {
    const kind = slKind(f);
    if (kind === 'confirmation') {
      if (pairSeen) { block = []; pairSeen = false; }
      block.push(slAreaName(fieldLabel(f)));
      continue;
    }
    if (!block.length || (count.get(slLoose(fieldLabel(f))) || 0) < 2) continue;
    const area = block[block.length - 1];
    const what = slAreaName(fieldLabel(f)).replace(/\s*-\s*required confirmation\s*$/i, '');
    out.set(f, { area, also: block.slice(0, -1), what, name: `${slSnake(area)}_${slSnake(what)}` });
    pairSeen = true;
  }
  return out;
}

// A segment answers to its name ("Task Type", "Analysis"); a box sharing its
// label to its area and label together ("Instructions Findings"); every
// other question to its label, the first line of its description, and its
// own field name in words.
function slWordings(q) {
  if (q.seg) return [slSegName(q.seg)];
  const area = slAreas().get(q.field);
  if (area) return [area.area, ...area.also].map((a) => `${a} ${area.what}`);
  return [fieldLabel(q.field), slDescribe(q.field).question, slKeyWords(q.field)].filter(Boolean);
}

const SL_CLOSE_ENOUGH = 0.75; // share of the key's words a wording must hold

// Words that carry no meaning for matching, and words that mean the same:
// "time_total_submission_minutes" is "How long … this entire submission?".
const SL_FILLER = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'for', 'and', 'or', 'is', 'it', 'its',
  'you', 'your', 'did', 'do', 'this', 'that', 'on', 'with', 'what', 'which', 'take', 'how', 'long']);
const SL_SYNONYM = new Map([
  ['entire', 'total'], ['whole', 'total'], ['overall', 'total'],
  ['min', 'minute'], ['mins', 'minute'], ['duration', 'time'], ['comment', 'comments']
]);

function slWordSet(s) {
  const loose = slLoose(s).replace(/\bhow long\b/g, 'time');
  const out = new Set();
  for (let w of loose.split(' ')) {
    if (!w || SL_FILLER.has(w)) continue;
    if (/ies$/.test(w) && w.length > 4) w = `${w.slice(0, -3)}y`;
    else if (/[^s]s$/.test(w) && w.length > 3) w = w.slice(0, -1);
    out.add(SL_SYNONYM.get(w) || w);
  }
  return out;
}

// How much of the key a wording holds, and how close the two are overall.
function slCoverage(key, wording) {
  const k = slWordSet(key);
  const w = slWordSet(wording);
  if (!k.size || !w.size) return { held: 0, near: 0 };
  let shared = 0;
  for (const x of k) if (w.has(x)) shared++;
  return { held: shared / k.size, near: shared / (k.size + w.size - shared), words: k.size };
}

// A key is the question's own name ("textarea-hard_parts_covered",
// "multidimensionradio-segments-valid:Analysis"); its wording works as well,
// compared loosely, and a wording a word or so off still finds its question
// when no other comes as close. The segment field's bare name finds the
// selector whose options hold the answer, so "Feature" goes to Task Type
// and "Fixable" to Analysis.
function findSlQuestion(key, value) {
  const qs = slQuestions();
  const want = String(key);

  const byKey = qs.find((q) => slQKey(q) === want);
  if (byKey) return byKey;
  const bare = qs.filter((q) => q.seg && slKey(q.field) === want);
  if (bare.length) {
    return bare.find((q) => slMatchOption(slRadioOptions(q.field, q.seg), value)) || bare[0];
  }

  const loose = slLoose(want);
  // A wording two questions share names neither.
  const exact = qs.filter((q) => slWordings(q).some((w) => slLoose(w) === loose));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  // Short keys ("open_flags", "trajectory_notes",
  // "time_initial_review_minutes") are found by the wording that holds most
  // of their words, the closer wording winning a tie. A one-word key must
  // be held whole, and by one question only.
  const scored = qs
    .map((q) => {
      let best = { held: 0, near: 0, words: 0 };
      for (const w of slWordings(q)) {
        const c = slCoverage(want, w);
        if (c.held > best.held || (c.held === best.held && c.near > best.near)) best = c;
      }
      return { q, ...best };
    })
    .filter((x) => x.held >= (x.words === 1 ? 1 : SL_CLOSE_ENOUGH))
    .sort((a, b) => b.held - a.held || b.near - a.near);
  if (!scored.length) return null;
  const [top, next] = scored;
  if (next && next.held === top.held && next.near === top.near) return null; // could be either
  return top.q;
}

// The question, with the section that holds it opened if it is shut.
async function slFindOpening(key, value) {
  let q = await until(() => findSlQuestion(key, value), { timeout: 1200, step: 100 });
  if (q) return q;
  for (const sec of document.querySelectorAll(SECTION)) {
    if (await slOpenSection(sec)) {
      q = findSlQuestion(key, value);
      if (q) return q;
    }
  }
  await expandEverything();
  return until(() => findSlQuestion(key, value), { timeout: 4000, step: 150 });
}

// A long upload label cut to its first sentence, for the status line.
function slShortLabel(label) {
  const first = String(label).split(/(?<=[.?!])\s/)[0];
  return first.length > 90 ? `${first.slice(0, 87)}…` : first;
}

// Answers are written in the order given, one question at a time, with the
// Delay after each. Task Type first: the analysis question that follows it
// can depend on it, and is waited for when its turn comes. Confirmations are
// ticked when the answers say so. With runChecks on, Static Checks is
// pressed once the files changed are written up - the Files Changed box on
// a Fix / Fixable task, Comments for Reviewer where there is no such box -
// and runs beside whatever is typed after it; Instruction Review follows
// once Static Checks has all passed. Without that answer the checks start
// after the last one. The run ends when both the answers and the
// checks are done. Nothing is uploaded, and Submit, Skip and Next
// section are never pressed.
async function applySuiteLife(input, options = {}) {
  if (busy) throw new Error('Already typing. Press Stop first.');

  const rows = slNormalizeAnswers(input)
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) throw new Error('No answers to write - every field was left empty.');
  if (!isSuiteLifePage()) throw new Error('This does not look like a Suite Life task page.');
  if (isSlReviewPage()) throw new Error('This is the Review page - switch the tab to Reviewer.');

  const base = Math.max(0, Number(options.speed ?? 200));
  const paste = options.entry === 'paste'; // typing is the default here
  const gap = Math.max(0, Number(options.gap ?? 5000));
  const runChecks = options.runChecks !== false;
  hiddenDuringRun = false;
  busy = true;
  cancelled = false;
  stayAwake();
  progress = { index: 0, total: rows.length, phase: 'opening', unit: 'answer' };

  const skippedFields = [];
  const truncated = [];
  const refused = [];
  const readOnly = [];
  const leftToYou = [];
  const unknownFlags = [];
  const unsure = [];
  const uploadsAsked = [];
  let checks = null;
  let checksSkipped = null;
  let filled = 0;
  let autoTicked = [];
  let checkRun = null;
  slChecksHalt = false;

  try {
    await expandEverything();

    if (!runChecks) checksSkipped = 'turned off';
    else if (!slQuestions().some((q) => q.kind === 'check')) checksSkipped = 'no checks on this page';
    const startChecks = () => {
      if (runChecks && !checksSkipped && !checkRun) checkRun = slChecksAlongside();
    };
    // Which answer the checks wait for: Files Changed when it is answered,
    // otherwise Comments for Reviewer.
    const SL_FILES_CHANGED = /^files changed\b/i;
    const hasFilesChanged = rows.some(([k]) => /\bfiles? changed\b/.test(slLoose(k)));
    const isTrigger = (fieldEl, label) => (SL_FILES_CHANGED.test(label)
      || (!hasFilesChanged && (/comments? for reviewer/i.test(label) || slKey(fieldEl) === 'richtext-comments_for_reviewer')));

    for (let i = 0; i < rows.length; i++) {
      checkCancelled();
      const [key, value] = rows[i];
      progress = { index: i + 1, total: rows.length, phase: 'filling', unit: 'answer' };
      if (document.hidden) hiddenDuringRun = true;

      const q = await slFindOpening(key, value);
      if (!q) {
        // The corrected zip goes into the upload box by hand.
        if (/\b(zip|upload|file)\b/.test(slLoose(key)) && readSlUploads().length) uploadsAsked.push(key);
        else skippedFields.push(key);
        continue;
      }
      const { field: fieldEl, seg } = q;
      const kind = q.kind;
      const label = seg ? slSegName(seg) : (fieldLabel(fieldEl) || key);

      if (!SL_WRITABLE.has(kind)) {
        // The page's own box, a check, a confirmation: none is written here.
        if (kind === 'readonly') readOnly.push(label);
        else leftToYou.push(label);
        continue;
      }

      if (kind === 'segment' || kind === 'choice') {
        const r = await slSetChoice(fieldEl, seg, value, base);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else if (kind === 'flags') {
        const r = await slSetFlags(fieldEl, value, base);
        if (r.unknown?.length) unknownFlags.push(`"${key}": ${r.unknown.join('; ')}`);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else if (kind === 'confirmation') {
        const r = await slSetConfirmations(fieldEl, value, base);
        if (r.note) unsure.push(`"${key}": ${r.note}`);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else if (kind === 'richtext') {
        const ed = slEditor(fieldEl);
        const r = paste ? await slPasteIntoEditor(ed, value, base) : await slTypeIntoEditor(ed, value, base);
        filled++;
        if (!r.matches) unsure.push(`"${key}"`);
      } else {
        const ctl = slControl(fieldEl);
        if (!ctl) { skippedFields.push(key); continue; }
        const r = paste ? await pasteInto(ctl, value, base) : await typeInto(ctl, value, base);
        if (r.truncated) truncated.push(`"${key}"`);
        filled++;
      }
      // The files changed are written up: the checks may begin.
      if (isTrigger(fieldEl, label)) startChecks();

      await pause(gap); // the Delay, before the next answer
    }

    // The pledges the answers left out are ticked now, a shut section
    // opened again first so its boxes can be reached.
    checkCancelled();
    progress = { index: rows.length, total: rows.length, phase: 'filling', unit: 'answer', text: 'Ticking the policy pledges…' };
    await expandEverything();
    autoTicked = await slTickPledges(base);

    startChecks(); // the answer they wait for was not among them
    if (checkRun) {
      // The answers are in; the checks may still be on their way. A section
      // the page shut while typing is opened again so they can be seen.
      progress = { index: 0, total: 0, phase: 'checking', unit: 'check', text: 'Waiting on the checks…' };
      if (!slCheckField(SL_CHECK_STEPS[0], 0)) await expandEverything();
      checks = await checkRun;
    }
  } finally {
    if (checkRun && !checks) {
      // The fill ended early: the checks end with it.
      slChecksHalt = true;
      checks = await checkRun;
    }
    busy = false;
    progress = null;
    letSleep();
  }

  // What is still the reviewer's to do by hand, said once the run is over.
  const emptyUploads = readSlUploads().filter((u) => !u.files.length).map((u) => slShortLabel(u.field));
  const unticked = slQuestions()
    .filter((q) => q.kind === 'confirmation' && slBoxOptions(q.field).some((o) => !o.checked))
    .map((q) => fieldLabel(q.field));
  const checksToRun = slQuestions()
    .filter((q) => q.kind === 'check')
    .map((q) => readSlCheck(q.field, { label: fieldLabel(q.field) })[0])
    .filter((c) => c.state !== 'answered')
    .map((c) => c.label);

  return {
    project: 'suitelife',
    requested: rows.length,
    filled,
    ranInBackground: hiddenDuringRun,
    skippedFields,
    truncated,
    refused,
    readOnly,
    leftToYou,
    unknownFlags,
    unsure,
    uploadsAsked,
    autoTicked,
    checks,
    checksSkipped,
    stillToDo: { uploads: emptyUploads, confirmations: unticked, checks: checksToRun }
  };
}

/* ---------- registration ---------- */

// Which stage a request is for: the tab the panel chose, else the one the
// page shows. The Review readers live in suitelife-review.js.
function slStageFor(options) {
  return options?.stage || (isSlReviewPage() ? 'review' : 'submission');
}

PAGE_PROJECTS.suitelife = {
  detect: () => (isSuiteLifePage() ? 'its Suite Life task upload' : null),
  read: (options) => (slStageFor(options) === 'review' ? readSlReview(options) : readSuiteLife(options)),
  apply: (data, options) => (slStageFor(options) === 'review' ? applySlReview(data, options) : applySuiteLife(data, options)),
  // The badge's facts, and which stage the page is so the tab can follow it.
  ping: () => {
    if (!isSuiteLifePage()) return { suitelife: null };
    const out = { stage: suiteLifeStage(), fields: slQuestions().filter((q) => SL_WRITABLE.has(q.kind)).length };
    if (isSlReviewPage()) {
      out.stage = 'review';
      out.review = slrPing();
    }
    return { suitelife: out };
  }
};
