/* Criteria Catcher - side panel: Suite Life.

   Snorkel's review of a coding task delivered as a zip, at two stages, with
   a tab for each above Catch / Input: Submission, which is this file,
   and Reviewer, in panel/suitelife-review.js. The tab follows the page
   until the user picks one by hand, and decides which stage a catch or fill
   is for; a caught result is shown by the stage it was caught at.

   On the Submission tab the Content block is the stage and times, the
   previous round's grading feedback when there is one, the task's facts,
   the uploads, the Task Report as Markdown, and the form question by
   question - checks and confirmations included, marked as the reviewer's
   own to do. Answers are typed back with the Delay between them - the same
   Delay control Copperhead uses, so one setting serves both.

   Needs panel/core.js; panel/suitelife-review.js follows it. */

const SL_KIND_NAME = {
  segment: 'pick one',
  choice: 'pick one',
  flags: 'tick any that apply',
  confirmation: 'confirmations — true, or one statement per box',
  check: 'check — pressed alongside the answers',
  richtext: 'written answer, rich text',
  text: 'written answer',
  number: 'a number'
};

const SL_STAGE_NAME = { submission: 'Submission', review: 'Review', adjudication: 'Adjudication' };

const SL_CHECK_STATE = {
  'not run': 'not run yet',
  locked: 'locked',
  answered: 'answered'
};

function slNoteBody(n) {
  const asks = (n.asks || []).map((a) => `[${a.answer ? 'x' : ' '}] ${a.question}`).join('\n');
  return [n.text, asks].filter(Boolean).join('\n\n');
}

// One question: its key and wording, what it asks, its options, and what is
// answered now.
function slRenderQuestion(f, brief) {
  // A box sharing its label with others is shown, and answered, by the name
  // of its review area: [instructions_findings]  Findings — Instructions.
  const out = [f.area
    ? `[${f.name}]  ${f.label} — ${f.area}  (${SL_KIND_NAME[f.kind] || f.kind})`
    : `[${f.key}]  ${f.label}  (${SL_KIND_NAME[f.kind] || f.kind})`];
  if (f.kind === 'segment' && f.question) out.push(`Part of: ${f.question}`);
  if (f.guidelines) out.push(f.guidelines);
  else if (f.question && f.question !== f.label && f.kind !== 'segment') out.push(`Q: ${f.question}`);

  if (f.kind === 'check') {
    let state = `State: ${SL_CHECK_STATE[f.state] || f.state}`;
    if (f.waitsFor) state += ` — waits for ${f.waitsFor}`;
    out.push(state);
    for (const r of f.results || []) {
      out.push(`  ${r.verdict || (r.passed ? 'PASS' : 'FAIL')}${r.name ? ` ${r.name}` : ''}${r.text ? `: ${r.text}` : ''}`);
    }
  } else if (f.kind === 'segment' || f.kind === 'choice') {
    if (f.options?.length) {
      out.push('Options:');
      for (const o of f.options) out.push(`  - ${o.text}`);
    }
    // A segment can repeat a fact the brief already states.
    if (f.kind === 'segment') {
      const fact = (brief || []).find((b) => b.label && b.value && b.label.toLowerCase() === f.label.toLowerCase());
      if (fact) out.push(`(The task brief says ${f.label}: ${fact.value})`);
    }
    out.push(f.answer ? `Answer: ${f.answer}` : 'Answer: (not answered)');
  } else if (f.kind === 'flags' || f.kind === 'confirmation') {
    const on = f.answer || [];
    for (const o of f.options || []) out.push(`  [${on.includes(o.text) ? 'x' : ' '}] ${o.text}`);
    if (f.kind === 'confirmation') out.push(`(${on.length} of ${(f.options || []).length} ticked)`);
    else if (!on.length) out.push('Answer: (none ticked)');
  } else if (f.answer === null || f.answer === undefined || f.answer === '') {
    out.push('Answer: (empty)');
  } else {
    out.push(`Answer:\n${f.answer}`);
  }
  return out.join('\n');
}

function renderSuiteLife(c) {
  const out = [];
  const part = (title, body) => {
    if (!body) return;
    out.push(`${title}\n${'-'.repeat(title.length)}\n${body}\n`);
  };

  const head = [`Stage: ${SL_STAGE_NAME[c.stage] || c.stage || 'Submission'}`];
  if (c.lastSaved) head.push(`Last saved at: ${c.lastSaved}`);
  if (c.timeLeft) head.push(`Time left: ${c.timeLeft}`);
  out.push(head.join('\n') + '\n');

  // A sendback's findings are what this round has to answer, so they lead.
  for (const fb of c.previousFeedback || []) part(fb.label, fb.text);

  if (c.taskNotes?.length) {
    const notes = [...c.taskNotes].sort((a, b) => (b.latest ? 1 : 0) - (a.latest ? 1 : 0));
    part('Task notes', notes
      .map((n) => `[${n.title}${n.time ? ` — ${n.time}` : ''}${n.latest ? ', newest' : ''}]\n${slNoteBody(n)}`)
      .join('\n\n'));
  }

  part('Evaluation criteria', c.evaluation);

  part('Task', (c.brief || [])
    .map((b) => `${b.label}: ${b.value ?? '(empty)'}${b.link ? ` <${b.link}>` : ''}`)
    .join('\n'));

  // Every upload field, the empty ones too: the fixed task goes back up by
  // hand, and an empty box is easy to miss.
  part('Uploads', (c.uploads || [])
    .map((u) => `${u.field}\n  ${u.files?.length ? u.files.join(', ') : '(nothing uploaded yet)'}`)
    .join('\n'));

  part('Task Report', c.report);

  for (const sec of c.sections || []) {
    const fields = (sec.fields || []).filter((f) => f.kind !== 'readonly');
    const bar = '='.repeat(Math.min(60, Math.max(sec.name.length, 12)));
    out.push(`${bar}\n${sec.name}\n${bar}\n`);
    if (!fields.length) {
      out.push(sec.waiting
        ? '(Not open yet — it appears once the questions before it are answered.)\n'
        : '(Nothing to answer here.)\n');
      continue;
    }
    for (const f of fields) out.push(slRenderQuestion(f, c.brief) + '\n');
  }

  return out.join('\n').trim();
}

// What is still the reviewer's to do by hand, in one place.
function slToDo({ uploads = [], confirmations = [], checks = [] }) {
  const lines = [];
  if (uploads.length) lines.push(`Nothing uploaded yet: ${uploads.join('; ')}`);
  if (confirmations.length) lines.push(`Left for you to tick: ${confirmations.join(', ')}`);
  if (checks.length) lines.push(`Checks still to run: ${checks.join(', ')}`);
  return lines;
}

function suiteLifeCatchStatus(data, meta) {
  const c = data.content || {};
  const bits = [`${meta.fields} question${meta.fields === 1 ? '' : 's'}`];
  if (c.brief?.length) bits.push('the task facts');
  if (meta.report) bits.push('the Task Report');
  if (meta.notes) bits.push(`${meta.notes} task note${meta.notes === 1 ? '' : 's'}`);
  let msg = `Caught ${bits.join(', ')}${data.fileName ? ` for ${data.fileName}` : ''}.`;
  if (meta.feedback) msg += '\nThis task came back with grading feedback from the previous round — it is at the top.';
  msg += meta.answered
    ? `\n${meta.answered} of ${meta.fields} already answered.`
    : '\nNothing answered yet.';

  const failed = (meta.checks || []).filter((k) => k.failed);
  if (failed.length) msg += `\nFailing checks: ${failed.map((k) => k.label).join(', ')}`;
  const todo = slToDo({
    uploads: meta.emptyUploads || [],
    confirmations: (meta.confirmations || []).filter((k) => k.ticked < k.of).map((k) => k.label),
    checks: (meta.checks || []).filter((k) => k.state !== 'answered')
      .map((k) => (k.waitsFor ? `${k.label} (after ${k.waitsFor})` : k.label))
  });
  if (todo.length) msg += `\n${todo.join('\n')}`;
  if (meta.waiting) {
    msg += `\n${meta.waiting} section${meta.waiting === 1 ? ' is' : 's are'} not open yet — `
      + 'they appear once the questions before them are answered.';
  }
  return { msg, kind: 'ok' };
}

function suiteLifeApplyStatus(result) {
  let msg = `Answered ${result.filled} of ${result.requested} question`
    + `${result.requested === 1 ? '' : 's'}.`;
  if (result.ranInBackground) {
    msg += '\nPart of this ran while the tab was behind, which Chrome slows down.';
  }
  if (result.skippedFields.length) msg += `\nNot on this page: ${result.skippedFields.join(', ')}`;
  if (result.refused.length) msg += `\nWould not take: ${result.refused.join('\n')}`;
  if (result.unknownFlags?.length) msg += `\nNo such option — ${result.unknownFlags.join('\n')}`;
  if (result.truncated.length) msg += `\nCut to the field limit: ${result.truncated.join(', ')}`;
  if (result.readOnly?.length) {
    msg += `\nFilled in by the page, not by you: ${result.readOnly.join(', ')}`;
  }
  if (result.unsure?.length) {
    msg += `\nCheck these came out right: ${result.unsure.join(', ')}`;
  }
  if (result.uploadsAsked?.length) {
    msg += `\nUpload by hand: ${result.uploadsAsked.join(', ')}`;
  }
  if (result.autoTicked?.length) {
    msg += `\nPolicy pledges ticked though the JSON left them out: ${result.autoTicked.join(', ')}`;
  }
  for (const c of result.checks || []) {
    const said = (c.results || []).map((r) => r.verdict || (r.passed ? 'PASS' : 'FAIL'));
    msg += `\n${c.label}: ${c.outcome}${said.length ? ` — ${said.join(', ')}` : ''}`;
  }
  if (result.checksSkipped && result.checksSkipped !== 'turned off') {
    msg += `\nChecks not run: ${result.checksSkipped}.`;
  }
  // An answer given for a check or a confirmation is not written; the to-do
  // lines below already name those, so only anything else is listed here.
  const todoIn = result.stillToDo || {};
  const named = new Set([...(todoIn.confirmations || []), ...(todoIn.checks || [])]);
  const notWritten = (result.leftToYou || []).filter((l) => !named.has(l));
  if (notWritten.length) msg += `\nNot written — yours to do on the page: ${notWritten.join(', ')}`;
  const todo = slToDo(todoIn);
  if (todo.length) msg += `\n${todo.join('\n')}`;

  const checksOk = (result.checks || []).every((c) => /answered|passing/.test(c.outcome)
    && (c.results || []).every((r) => r.passed));
  const clean = result.filled + (result.uploadsAsked?.length || 0) === result.requested
    && !result.skippedFields.length
    && !result.refused.length && !result.truncated.length && !result.unsure?.length
    && !result.unknownFlags?.length && checksOk;
  return { msg, clean };
}

/* ---------- the stage tab ----------
   Submission or Reviewer. The page says which it is, and the tab follows
   it until the user picks one by hand, as Geranium's page type does. */

const slStageRadios = Array.from(document.querySelectorAll('input[name="slStage"]'));
let slStageTouched = false; // once the user picks, stop following the page

const SL_TAB_NAME = { submission: 'Submission', review: 'Reviewer' };

function slStage() {
  return slStageRadios.find((r) => r.checked)?.value || 'submission';
}

// The Input view's controls, the Catch button and the template follow the tab.
function slSetStage(value) {
  const stage = SL_TAB_NAME[value] ? value : 'submission';
  for (const r of slStageRadios) r.checked = r.value === stage;
  document.body.dataset.slStage = stage;
  if (document.body.dataset.project === 'suitelife') {
    $('catch').textContent = PROJECTS.suitelife.catch;
    $('json').placeholder = PROJECTS.suitelife.placeholder;
  }
}

for (const r of slStageRadios) {
  r.addEventListener('change', () => {
    slStageTouched = true;
    slSetStage(r.value);
    $('slStageHint').textContent = `Set to ${SL_TAB_NAME[r.value]} by hand.`;
    save();
  });
}

// The badge: the stage the page is at and how much is answered. Unless the
// user has picked a tab, the tab moves to the stage the page shows.
function suiteLifeBadge(res) {
  const sl = res.suitelife;
  if (!sl) return 'no Suite Life task found';
  const found = sl.review ? 'review' : 'submission';
  if (!slStageTouched) {
    if (slStage() !== found) slSetStage(found);
    $('slStageHint').textContent = `Detected from the page: ${SL_TAB_NAME[found]}.`;
  } else if (slStage() !== found) {
    $('slStageHint').textContent = `This page looks like ${SL_TAB_NAME[found] === 'Reviewer' ? 'a Review' : 'a Submission'} — the tab was set by hand.`;
  }
  return sl.review
    ? `Review · ${sl.review.answered} of ${sl.review.fields} answered`
    : `${SL_STAGE_NAME[sl.stage] || sl.stage} · ${sl.fields} question${sl.fields === 1 ? '' : 's'}`;
}

// A result caught on the Reviewer tab carries the Reviewer Feedback section.
const slIsReviewCatch = (data) => !!data?.content?.review;

/* ---------- registration ---------- */

const SL_SUBMISSION_PLACEHOLDER = `Paste or upload answers like this:

"answers": {
  "task_type": "Feature",
  "analysis": "Open Flags",
  "trajectories_confirmations": true,
  "trajectory_notes": "Critical files reviewed: …",
  "open_flags": "- tests/…: nothing checks …",
  "hard_parts_covered": "- Collapsing passing Surefire blocks …",
  "comments_for_reviewer": "Files changed:\\n- instruction.md: …\\n  - Removed …",
  "time_initial_review_minutes": 90,
  "time_total_submission_minutes": 275
}

A Fix / Fixable task adds "files_changed", "added_to_pr",
"<area>_confirmations" and "<area>_findings" / "<area>_edits_made" for
instructions, tagging_and_metadata, solution, tests_and_rewards and
environment, plus "critical_files_reviewed".

Keys are the field names from a catch, a question's own wording, or a
short name made of its words. Confirmations take true, or one statement
per box. "- " lines become lists in Comments for Reviewer.
Answers go in the order written, with the Delay after each one, so
put Task Type before the analysis question that follows it.`;

PROJECTS.suitelife = {
  name: 'Suite Life',
  // The button and the template follow the tab.
  get catch() { return slStage() === 'review' ? 'Catch review' : 'Catch task'; },
  toInput: 'Send answers to input',
  copied: 'Answers copied into the input box.',
  get placeholder() { return slStage() === 'review' ? SL_REVIEW_PLACEHOLDER : SL_SUBMISSION_PLACEHOLDER; },
  // A review is a form a person fills in by hand, so it is typed out.
  entry: 'type',

  // A caught result is shown by the stage it was caught at, whatever the
  // tab says now.
  render: (data) => (slIsReviewCatch(data) ? renderSlReview(data.content || {}) : renderSuiteLife(data.content || {})),
  // No Answers box: every answer is already in the Content block.
  toInputText: (data) => answersJson(data.answers),

  catchOptions: () => ({ stage: slStage(), runChecks: $('slrChecksFirst').checked }),
  catchStatus: (data, meta) => (slIsReviewCatch(data) ? slReviewCatchStatus(data, meta) : suiteLifeCatchStatus(data, meta)),
  applyOptions: () => ({
    stage: slStage(),
    gap: Number($('delay').value),
    runChecks: slStage() === 'review' ? $('slrRunChecks').checked : $('slRunChecks').checked
  }),
  applyStatus: (result) => (result.stage === 'review' ? slReviewApplyStatus(result) : suiteLifeApplyStatus(result)),
  badge: suiteLifeBadge,
  // The Delay is saved and restored by Copperhead's entry: it is one control.
  saveState: () => ({
    slStage: slStage(),
    slRunChecks: $('slRunChecks').checked,
    slrRunChecks: $('slrRunChecks').checked,
    slrChecksFirst: $('slrChecksFirst').checked
  }),
  loadState(s) {
    slStageTouched = false;
    $('slRunChecks').checked = s.slRunChecks !== false;
    $('slrRunChecks').checked = s.slrRunChecks !== false;
    $('slrChecksFirst').checked = s.slrChecksFirst !== false;
    slSetStage(s.slStage || 'submission');
    $('slStageHint').textContent = '';
  }
};

$('slRunChecks').addEventListener('change', () => save());
$('slrRunChecks').addEventListener('change', () => save());
$('slrChecksFirst').addEventListener('change', () => save());
