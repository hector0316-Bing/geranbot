/* Criteria Catcher - page side: Suite Life, the Review stage.

   The Reviewer tab of the Suite Life project. The page is the submitter's
   page over again - the task's facts and Task Report on the left, the whole
   submission form on the right - with one more section at the foot, Reviewer
   Feedback, which is the reviewer's own:

   - "What is your verdict for this Submission?" - Accept, Needs Revision or
     Reject, stored as yes / needs_revision / no;
   - a notes box whose label follows the verdict - Accept Notes, Revision
     Notes, Rejection Notes - under a hashed field name;
   - on an Accept, "Please confirm that the task meets all the following
     requirements", a list of boxes; on a Needs Revision, "Error Categories",
     a list of tags;
   - "Acknowledgement of Submitter Rebuttal", three statements to pick from;
   - "What is the overall quality of the submission?", five plain buttons
     numbered 1 to 5 between "Lower Quality" and "Exceptional Quality";
   - "How long (in minutes) did it take you to complete this review?".

   The submitter's choices and confirmations are disabled - radios with the
   disabled attribute, boxes with aria-disabled - and are read as the
   submission, never written. Their text boxes, rich-text editors and
   numbers stay open: the Accept Notes guidance invites the reviewer to make
   minor fixes themselves, so those can be written by their Suite Life keys.

   Nearly everything here leans on suitelife.js - the brief, the report, the
   fields, the typing - and adds the lock, the rating and the reviewer's
   names. Static Checks and Instruction Review are run alongside the answers
   when asked, as on a Submission.

   Needs core.js and suitelife.js. */

/* ---------- the page ---------- */

const SLR_SECTION = '[data-testid^="section-Reviewer"]';
const SLR_VERDICT = /\bverdict\b/i;

// The reviewer's section: named for them, or holding the verdict question.
function slrIsReviewerSection(sec) {
  return /^section-reviewer/i.test(sec.getAttribute('data-testid') || '')
    || slFields(sec).some((f) => SLR_VERDICT.test(fieldLabel(f)));
}

function slrReviewSection() {
  return document.querySelector(SLR_SECTION)
    || Array.from(document.querySelectorAll(SECTION)).find(slrIsReviewerSection)
    || null;
}

function isSlReviewPage() {
  if (!isSuiteLifePage()) return false;
  if (slrReviewSection()) return true;
  return suiteLifeStage() === 'review';
}

/* ---------- what is the submitter's, and locked ---------- */

function slrLocked(fieldEl, kind, seg = null) {
  if (kind === 'segment' || kind === 'choice') {
    const opts = slRadioOptions(fieldEl, seg);
    return opts.length > 0 && opts.every((o) => o.input?.disabled || o.btn?.disabled
      || o.btn?.getAttribute('aria-disabled') === 'true' || o.btn?.hasAttribute('data-disabled'));
  }
  if (kind === 'flags' || kind === 'confirmation') {
    const boxes = slBoxes(fieldEl);
    return boxes.length > 0 && boxes.every((b) => b.getAttribute('aria-disabled') === 'true'
      || b.hasAttribute('data-disabled'));
  }
  if (kind === 'rating') {
    const btns = slrRatingButtons(fieldEl);
    return btns.length > 0 && btns.every((b) => b.disabled);
  }
  if (kind === 'richtext') {
    const ed = slEditor(fieldEl);
    return !!ed && ed.getAttribute('contenteditable') !== 'true';
  }
  const ctl = slControl(fieldEl);
  return !!ctl && (ctl.disabled || ctl.readOnly);
}

/* ---------- the quality scale ----------
   Five plain buttons reading 1 to 5, no role and no input behind them. The
   one chosen loses the empty-cell colouring the rest keep; a pressed or
   checked state is honoured too, should the page grow one. */

function slrRatingButtons(fieldEl) {
  return slOwn(fieldEl, 'button').filter((b) => /^\d+$/.test(buttonText(b)));
}

function slrRatingOptions(fieldEl) {
  const btns = slrRatingButtons(fieldEl);
  const empty = (b) => /empty-cell/.test(b.className || '');
  const marked = (b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true'
    || /^(on|checked|active|selected)$/.test(b.getAttribute('data-state') || '')
    || b.hasAttribute('data-selected') || b.hasAttribute('data-active') || b.hasAttribute('data-checked');
  const anyEmpty = btns.some(empty);
  return btns.map((b) => ({
    value: Number(buttonText(b)),
    text: buttonText(b),
    checked: marked(b) || (anyEmpty && !empty(b)),
    btn: b
  }));
}

// "Lower Quality" and "Exceptional Quality", the words at either end.
function slrScaleEnds(fieldEl) {
  const words = slOwn(fieldEl, 'span')
    .filter((s) => !s.closest('label, button, [class*="_description_"]') && !s.querySelector('span'))
    .map((s) => oneLine(s.textContent))
    .filter((t) => t && !/^\d+$/.test(t));
  return words.length >= 2 ? { low: words[0], high: words[words.length - 1] } : null;
}

function slrKind(fieldEl) {
  if (/preferenceselection/i.test(fieldEl.getAttribute('data-testid') || '')
    || slrRatingButtons(fieldEl).length >= 3) return 'rating';
  return slKind(fieldEl);
}

/* ---------- the reviewer's names ----------
   The reviewer's questions are few and fixed, so each answers to a short
   name of its own, whatever the page calls its field: the notes box is
   "notes" whether it is headed Accept, Revision or Rejection Notes. */

const SLR_NAMES = [
  [/\bverdict\b/i, 'verdict'],
  [/\bnotes?\b/i, 'notes'],
  [/confirm that the task meets|requirements/i, 'requirements'],
  [/error categor/i, 'error_categories'],
  [/rebuttal/i, 'rebuttal'],
  [/overall quality|quality of the submission/i, 'quality'],
  [/how long|minutes/i, 'review_minutes']
];

const SLR_ALIAS = new Map([
  ['decision', 'verdict'], ['outcome', 'verdict'], ['review_outcome', 'verdict'], ['review_verdict', 'verdict'],
  ['result', 'verdict'],
  ['accept_notes', 'notes'], ['revision_notes', 'notes'], ['rejection_notes', 'notes'], ['reject_notes', 'notes'],
  ['review_notes', 'notes'], ['reviewer_notes', 'notes'], ['note', 'notes'], ['feedback', 'notes'],
  ['comments', 'notes'], ['comment', 'notes'],
  ['requirements_met', 'requirements'], ['confirmations', 'requirements'], ['confirmation', 'requirements'],
  ['confirm', 'requirements'], ['checklist', 'requirements'], ['meets_requirements', 'requirements'],
  ['task_requirements', 'requirements'],
  ['categories', 'error_categories'], ['error_category', 'error_categories'], ['errors', 'error_categories'],
  ['error_tags', 'error_categories'], ['tags', 'error_categories'], ['issues', 'error_categories'],
  ['rebuttal_acknowledgement', 'rebuttal'], ['rebuttal_acknowledgment', 'rebuttal'], ['acknowledgement', 'rebuttal'],
  ['acknowledgment', 'rebuttal'], ['ack', 'rebuttal'], ['submitter_rebuttal', 'rebuttal'],
  ['acknowledgement_of_submitter_rebuttal', 'rebuttal'],
  ['overall_quality', 'quality'], ['rating', 'quality'], ['score', 'quality'], ['quality_score', 'quality'],
  ['submission_quality', 'quality'],
  ['time_review_minutes', 'review_minutes'], ['review_time', 'review_minutes'], ['review_time_minutes', 'review_minutes'],
  ['minutes', 'review_minutes'], ['time', 'review_minutes'], ['handling_time', 'review_minutes'],
  ['time_minutes', 'review_minutes'], ['how_long', 'review_minutes'], ['review_minute', 'review_minutes']
]);

// The label decides first; its guidance only when the label says nothing -
// the rebuttal's guidance speaks of the submitter's notes, and the error
// categories' of revision notes, and neither is the notes box.
function slrName(fieldEl) {
  const label = fieldLabel(fieldEl);
  for (const [re, name] of SLR_NAMES) if (re.test(label)) return name;
  const question = slDescribe(fieldEl).question || '';
  for (const [re, name] of SLR_NAMES) if (re.test(question)) return name;
  return slSnake(slKeyWords(fieldEl) || label || slKey(fieldEl));
}

const slrAlias = (key) => {
  const snake = slSnake(key);
  return SLR_ALIAS.get(snake) || snake;
};

/* ---------- reading ---------- */

function slrDescribed(fieldEl, kind) {
  const { question, guidelines } = slDescribe(fieldEl);
  const label = fieldLabel(fieldEl) || (question ? question.replace(/[:.]\s*$/, '') : slKey(fieldEl));
  const out = { key: slKey(fieldEl), label, kind };
  if (question && question !== label) out.question = question;
  if (guidelines && guidelines !== question) out.guidelines = guidelines;
  return out;
}

// A list of boxes, whole - the submitter's LLM Policy pledges included,
// since here they are theirs to have ticked, not ours.
function slrReadBoxes(fieldEl, kind) {
  const out = slrDescribed(fieldEl, kind);
  const opts = slBoxOptions(fieldEl);
  out.options = opts.map((o) => ({ text: o.text }));
  out.answer = opts.filter((o) => o.checked).map((o) => o.text);
  return out;
}

function slrReadRating(fieldEl) {
  const out = slrDescribed(fieldEl, 'rating');
  const opts = slrRatingOptions(fieldEl);
  out.options = opts.map((o) => ({ value: o.value, text: o.text }));
  const ends = slrScaleEnds(fieldEl);
  if (ends) out.scale = ends;
  out.answer = opts.find((o) => o.checked)?.value ?? null;
  return out;
}

// Every question a field asks, with whether it is locked and, in the
// reviewer's section, the short name it answers to.
function slrReadField(fieldEl, reviewer) {
  const kind = slrKind(fieldEl);
  if (kind === 'file' || kind === 'other') return [];
  let qs;
  if (kind === 'rating') qs = [slrReadRating(fieldEl)];
  else if ((kind === 'flags' || kind === 'confirmation') && !reviewer) qs = [slrReadBoxes(fieldEl, kind)];
  else qs = readSlField(fieldEl);
  for (const q of qs) {
    const seg = q.kind === 'segment' ? slSegments(fieldEl).find((s) => slSegName(s) === q.label) || null : null;
    if (q.kind !== 'check' && q.kind !== 'readonly' && slrLocked(fieldEl, q.kind, seg)) q.locked = true;
    if (reviewer) q.name = slrName(fieldEl);
  }
  return qs;
}

async function slrReadSections() {
  const out = [];
  const names = new Set();
  for (const sec of document.querySelectorAll(SECTION)) {
    await slOpenSection(sec);
    const name = oneLine((sec.getAttribute('data-testid') || '').replace(/^section-/, ''));
    const reviewer = slrIsReviewerSection(sec);
    const fields = slFields(sec).flatMap((f) => slrReadField(f, reviewer));
    if (reviewer) {
      // Two questions sharing a name would be answered by the first alone.
      for (const f of fields) {
        if (!f.name) continue;
        if (names.has(f.name)) f.name = `${f.name}_${names.size + 1}`;
        names.add(f.name);
      }
    }
    const block = { name: name || 'Section', fields };
    if (reviewer) block.reviewer = true;
    if (!fields.length && !slFields(sec).length) block.waiting = true;
    out.push(block);
  }
  const loose = slFields().filter((f) => !f.closest(SECTION)).flatMap((f) => slrReadField(f, false));
  if (loose.length) out.push({ name: 'Other questions', fields: loose });
  return out;
}

/* ---------- the checks, before the catch ----------
   A reviewer wants Static Checks and Instruction Review answered, so a catch
   presses every check that has not answered yet and waits for them all. On
   a Review page both buttons are live, so both are pressed at once; one that
   is locked until another passes is pressed as soon as it unlocks. A check
   already showing results is kept as it is. The panel shows the count as
   they answer, the way it does on Geranium. */

async function slrRunChecksFirst({ timeout = 300000 } = {}) {
  const fields = () => slFields().filter((f) => slKind(f) === 'check');
  const total = fields().length;
  if (!total) return { pressed: [], waiting: [] };

  const pressed = new Map(); // label -> when
  const start = Date.now();
  try {
    for (;;) {
      const fs = fields();
      let done = 0;
      let pending = false;
      for (const f of fs) {
        const label = fieldLabel(f);
        if (checkFinished(f)) { done++; continue; }
        if (pressed.has(label)) { pending = true; continue; }
        const btn = slCheckButton(f);
        if (!btn) continue;
        slPress(btn);
        pressed.set(label, Date.now());
        pending = true;
        await wait(250); // stagger, rather than firing them all at once
      }
      checkProgress = { phase: 'checks', index: done, total: Math.max(total, fs.length) };
      if (fs.length && done >= fs.length) break;
      // Nothing on its way and nothing left to press: a check locked behind
      // one that failed stays locked, and is not worth the wait.
      if (!pending) break;
      if (Date.now() - start > timeout) break;
      await wait(500);
    }
  } finally {
    checkProgress = null;
  }
  const waiting = fields().filter((f) => pressed.has(fieldLabel(f)) && !checkFinished(f)).map(fieldLabel);
  return { pressed: Array.from(pressed.keys()), waiting };
}

async function readSlReview(options = {}) {
  await openSlEvaluation();
  await openNotes();
  const opened = await expandEverything();
  const ran = options.runChecks === false
    ? { pressed: [], waiting: [], skipped: 'turned off' }
    : await slrRunChecksFirst({ timeout: options.checkTimeout || 300000 });

  const notes = await readSlNotes();
  const { brief, report } = readSlBrief();
  const evaluation = readSlEvaluation();
  const sections = await slrReadSections();
  const uploads = readSlUploads();

  const review = sections.filter((s) => s.reviewer);
  const submission = sections.filter((s) => !s.reviewer);
  if (!review.length && !brief.length && !report) {
    throw new Error('Nothing found on this page - no task facts, no report and no Reviewer Feedback. Is this a Suite Life review?');
  }

  // The previous round's grading feedback is the page's own box; the checks
  // are pressed, not answered; the rest of the submission is read as given.
  const feedback = [];
  const checks = [];
  let submitted = 0;
  let submittedAnswered = 0;
  for (const sec of submission) {
    for (const f of sec.fields) {
      if (f.kind === 'readonly') {
        if (f.answer) feedback.push({ label: f.label, text: f.answer });
        continue;
      }
      if (f.kind === 'check') { checks.push(f); continue; }
      submitted++;
      if (slIsAnswered(f.answer)) submittedAnswered++;
    }
  }

  const answers = {};
  const questions = [];
  for (const sec of review) {
    for (const f of sec.fields) {
      if (f.kind === 'readonly') continue;
      if (f.kind === 'check') { checks.push(f); continue; }
      questions.push(f);
      answers[f.name || f.key] = f.answer === undefined ? null : f.answer;
    }
  }
  const verdict = questions.find((q) => q.name === 'verdict')?.answer || null;

  const uid = readUid();
  const fileName = brief.find((b) => /^file name$/i.test(b.label))?.value || null;
  const lastSaved = readSlLastSaved();
  const timeLeft = readSlTimeLeft();

  const content = { title: headingText() || null, stage: 'review' };
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
  content.submission = submission;
  content.review = review.length === 1 ? review[0] : { name: 'Reviewer Feedback', fields: review.flatMap((s) => s.fields) };
  if (verdict) content.verdict = verdict;

  const data = { project: 'suitelife', stage: 'review' };
  if (uid) data.uid = uid;
  if (fileName) data.fileName = fileName;
  data.content = content;
  data.answers = answers;

  return {
    data,
    meta: {
      project: 'suitelife',
      stage: 'review',
      opened,
      fields: questions.length,
      answered: questions.filter((q) => slIsAnswered(q.answer)).length,
      verdict,
      submitted,
      submittedAnswered,
      notes: notes.length,
      feedback: feedback.length,
      report: !!report,
      checks: checks.map((c) => ({ label: c.label, state: c.state, waitsFor: c.waitsFor || null,
        failed: (c.results || []).filter((r) => !r.passed).length,
        verdicts: (c.results || []).map((r) => r.verdict || (r.passed ? 'PASS' : 'FAIL')) })),
      checksPressed: ran.pressed,
      checksWaiting: ran.waiting,
      checksSkipped: ran.skipped || null,
      emptyUploads: uploads.filter((u) => !u.files.length).map((u) => slShortLabel(u.field)),
      unanswered: questions.filter((q) => !slIsAnswered(q.answer)).map((q) => q.label),
      waiting: sections.filter((s) => s.waiting).length
    }
  };
}

/* ---------- finding the question an answer is for ---------- */

// Every question on the page: the reviewer's first, named; then the
// submitter's, locked or not.
function slrQuestions() {
  const revSec = Array.from(document.querySelectorAll(SECTION)).find(slrIsReviewerSection) || null;
  const out = [];
  for (const field of slFields()) {
    const kind = slrKind(field);
    if (kind === 'file' || kind === 'other') continue;
    const reviewer = !!revSec && revSec.contains(field);
    if (kind === 'segments') {
      for (const seg of slSegments(field)) {
        out.push({ field, seg, kind: 'segment', reviewer, locked: slrLocked(field, 'segment', seg), name: null });
      }
      continue;
    }
    out.push({ field, seg: null, kind, reviewer, locked: slrLocked(field, kind), name: reviewer ? slrName(field) : null });
  }
  return out;
}

// The question among `qs` holding most of the key's words, as Suite Life
// finds its short keys; none when two come equally close.
function slrByWords(qs, want) {
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
  if (next && next.held === top.held && next.near === top.near) return null;
  return top.q;
}

function slrFindQuestion(key, value) {
  const qs = slrQuestions();
  const want = String(key);
  const mine = qs.filter((q) => q.reviewer);

  const byName = mine.find((q) => q.name === slrAlias(want));
  if (byName) return byName;
  const byKey = qs.find((q) => slQKey(q) === want);
  if (byKey) return byKey;

  const loose = slLoose(want);
  const exact = mine.filter((q) => slWordings(q).some((w) => slLoose(w) === loose));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const close = slrByWords(mine, want);
  if (close) return close;

  // Not the reviewer's: one of the submitter's boxes, found the Suite Life way.
  const sl = findSlQuestion(key, value);
  return sl ? qs.find((q) => q.field === sl.field && q.seg === sl.seg) || null : null;
}

// The question, with its section opened if shut, waited for when it is one
// the verdict brings in.
async function slrFindOpening(key, value) {
  let q = await until(() => slrFindQuestion(key, value), { timeout: 1200, step: 100 });
  if (q) return q;
  for (const sec of document.querySelectorAll(SECTION)) {
    if (await slOpenSection(sec)) {
      q = slrFindQuestion(key, value);
      if (q) return q;
    }
  }
  await expandEverything();
  return until(() => slrFindQuestion(key, value), { timeout: 4000, step: 150 });
}

const slrIsVerdictKey = (key) => slrAlias(key) === 'verdict';

/* ---------- the reviewer's wording ---------- */

// Accept, Needs Revision and Reject are stored as yes, needs_revision and
// no, so the spoken verdict is turned into the stored value first.
function slrVerdictValue(value) {
  const v = slLoose(value);
  if (/^(yes|accept|accepted|approve|approved|agree|agreed|ok|pass|passed)\b/.test(v)) return 'yes';
  if (/revis|send ?back|sent back|needs? (a )?(change|fix|work|rework)|rework/.test(v)) return 'needs_revision';
  if (/^(no|reject|rejected|decline|declined|disagree|fail|failed)\b/.test(v)) return 'no';
  return value;
}

// The rebuttal statements are sentences; a few words of either will do.
function slrRebuttalPick(options, value) {
  const v = slLoose(value);
  const find = (re) => options.find((o) => re.test(o.text));
  if (/no rebuttal|^none\b|^n a$|^na$|not available|^nothing|no comments?/.test(v)) return find(/no rebuttal/i);
  if (/revis|accordingly|changed my|updated my/.test(v) && !/not change|unchanged|does not|doesn t/.test(v)) return find(/revised/i);
  if (/does not|doesn t|not change|unchanged|same|stands?|stand by|keep|kept|no change|confirm/.test(v)) return find(/does not change/i);
  return null;
}

async function slrSetChoice(q, value, base) {
  const label = q.seg ? slSegName(q.seg) : fieldLabel(q.field);
  let want = value;
  if (SLR_VERDICT.test(label)) want = slrVerdictValue(value);
  else if (/rebuttal/i.test(label)) want = slrRebuttalPick(slRadioOptions(q.field, q.seg), value)?.text ?? value;
  return slSetChoice(q.field, q.seg, want, base);
}

// A tag as a person types it: "Test <-> Instruction Misalignment" or
// "test-instruction misalignment" for "Test ↔ Instruction Misalignment",
// "PR Scope Violation" for the box that goes on to explain itself. Each
// wanted tag is turned into the box's own wording before the ticking, so
// only a tag naming no box is reported as unknown.
const slrTagKey = (s) => slLoose(s).replace(/\b(to|vs|and|or)\b/g, ' ').replace(/\s+/g, '');

function slrTagNames(fieldEl, value) {
  if (typeof value === 'boolean') return value;
  const names = slBoxOptions(fieldEl).map((o) => o.text);
  return slFlagList(value).map((w) => {
    if (names.some((n) => slSameFlag(w, n))) return w;
    const k = slrTagKey(w);
    const hit = names.filter((n) => slrTagKey(n) === k
      || (k.length >= 8 && slrTagKey(n).startsWith(k))
      || slOptionHead(n) === slLoose(w));
    if (hit.length === 1) return hit[0];
    const scored = names.map((n) => ({ n, ...slCoverage(w, n) }))
      .filter((x) => x.held >= SL_CLOSE_ENOUGH)
      .sort((a, b) => b.held - a.held || b.near - a.near);
    const close = scored[0] && !(scored[1] && scored[1].held === scored[0].held && scored[1].near === scored[0].near)
      ? scored[0].n : null;
    return close || w;
  });
}

async function slrSetRating(fieldEl, value, base) {
  const opts = slrRatingOptions(fieldEl);
  if (!opts.length) return { ok: false, why: 'no scale to pick from' };
  const n = Number(String(value).trim().match(/\d+/)?.[0]);
  const pick = opts.find((o) => o.value === n) || slMatchOption(opts, value);
  if (!pick) return { ok: false, why: `no point on the scale matching "${oneLine(value)}"` };
  if (pick.checked) return { ok: true, already: true };
  if (pick.btn.disabled) return { ok: false, why: 'the scale is locked' };

  pick.btn.scrollIntoView({ block: 'center' });
  await wait(base * 6);
  pick.btn.click();
  const chosen = () => slrRatingOptions(fieldEl).find((o) => o.checked)?.value === pick.value;
  if (await until(chosen, { timeout: 2000 })) return { ok: true };
  return { ok: true, unsure: 'the scale does not show which point is chosen' };
}

/* ---------- writing the answers back ---------- */

// Answers go in the order written, with the Delay after each - except the
// verdict, which goes first whatever the order: the notes box and the lists
// under it exist only once it is chosen. The submitter's choices and
// confirmations are locked and are reported as such; their text boxes are
// written when named. With runChecks on, Static Checks is pressed as the
// run begins and Instruction Review once it passes, alongside the typing.
// Submit, Skip and the section buttons are never pressed.
async function applySlReview(input, options = {}) {
  if (busy) throw new Error('Already typing. Press Stop first.');

  let rows = slNormalizeAnswers(input)
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) throw new Error('No answers to write - every field was left empty.');
  if (!isSlReviewPage()) {
    throw new Error(isSuiteLifePage()
      ? 'This is a Suite Life Submission page, not a Review - switch the tab to Submission.'
      : 'This does not look like a Suite Life review page.');
  }
  const vi = rows.findIndex(([k]) => slrIsVerdictKey(k));
  if (vi > 0) rows = [rows[vi], ...rows.slice(0, vi), ...rows.slice(vi + 1)];

  const base = Math.max(0, Number(options.speed ?? 200));
  const paste = options.entry === 'paste';
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
  const locked = [];
  const leftToYou = [];
  const unknownFlags = [];
  const unsure = [];
  let checks = null;
  let checksSkipped = null;
  let checkRun = null;
  let filled = 0;
  slChecksHalt = false;

  try {
    await expandEverything();

    if (!runChecks) checksSkipped = 'turned off';
    else if (!slQuestions().some((q) => q.kind === 'check')) checksSkipped = 'no checks on this page';
    else checkRun = slChecksAlongside();

    for (let i = 0; i < rows.length; i++) {
      checkCancelled();
      const [key, value] = rows[i];
      progress = { index: i + 1, total: rows.length, phase: 'filling', unit: 'answer' };
      if (document.hidden) hiddenDuringRun = true;

      const q = await slrFindOpening(key, value);
      if (!q) { skippedFields.push(key); continue; }
      const { field: fieldEl, seg, kind } = q;
      const label = seg ? slSegName(seg) : (fieldLabel(fieldEl) || key);

      if (kind === 'readonly') { readOnly.push(label); continue; }
      if (kind === 'check') { leftToYou.push(label); continue; }
      if (q.locked) { locked.push(label); continue; }

      if (kind === 'segment' || kind === 'choice') {
        const r = await slrSetChoice(q, value, base);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else if (kind === 'rating') {
        const r = await slrSetRating(fieldEl, value, base);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
        if (r.unsure) unsure.push(`"${key}": ${r.unsure}`);
      } else if (kind === 'flags') {
        const r = await slSetFlags(fieldEl, slrTagNames(fieldEl, value), base);
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

      await pause(gap); // the Delay, before the next answer
    }

    if (checkRun) {
      progress = { index: 0, total: 0, phase: 'checking', unit: 'check', text: 'Waiting on the checks…' };
      if (!slCheckField(SL_CHECK_STEPS[0], 0)) await expandEverything();
      checks = await checkRun;
    }
  } finally {
    if (checkRun && !checks) {
      slChecksHalt = true;
      checks = await checkRun;
    }
    busy = false;
    progress = null;
    letSleep();
  }

  // What the reviewer still has to answer, said once the run is over.
  const revSec = slrReviewSection();
  const unanswered = revSec
    ? slFields(revSec).flatMap((f) => slrReadField(f, true))
      .filter((q) => q.kind !== 'check' && q.kind !== 'readonly' && !slIsAnswered(q.answer))
      .map((q) => q.label)
    : [];
  const checksToRun = slQuestions()
    .filter((q) => q.kind === 'check')
    .map((q) => readSlCheck(q.field, { label: fieldLabel(q.field) })[0])
    .filter((c) => c.state !== 'answered')
    .map((c) => c.label);

  return {
    project: 'suitelife',
    stage: 'review',
    requested: rows.length,
    filled,
    ranInBackground: hiddenDuringRun,
    skippedFields,
    truncated,
    refused,
    readOnly,
    locked,
    leftToYou,
    unknownFlags,
    unsure,
    checks,
    checksSkipped,
    stillToDo: { questions: unanswered, checks: checksToRun }
  };
}

// What the Suite Life badge says of the Reviewer Feedback section: how many
// questions, how many answered. Registered through suitelife.js, which
// hands a Review page to the readers here.
function slrPing() {
  const revSec = slrReviewSection();
  const qs = revSec
    ? slFields(revSec).flatMap((f) => slrReadField(f, true)).filter((q) => q.kind !== 'check' && q.kind !== 'readonly')
    : [];
  return { fields: qs.length, answered: qs.filter((q) => slIsAnswered(q.answer)).length };
}
