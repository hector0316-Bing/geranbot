/* Criteria Catcher - side panel: Telemanus.

   Video question tasks: a video, the Assets sidebar with an AI-generated idea
   per question, and a form of five multiple-choice questions. The Content
   block opens with the video link and the assets; the form follows only when
   the catch was asked to include it. The Answers box is what gets edited and
   written back.

   Needs panel/core.js. */

const TM_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const tmIndent = (text, by = '  ') => String(text).split('\n').map((l) => by + l).join('\n');

function tmRenderCheck(check) {
  if (!check) return null;
  if (check.result) {
    const verdict = check.passed === true ? 'PASSED\n' : check.passed === false ? 'FAILED\n' : '';
    return verdict + check.result;
  }
  return check.waitingOn ? `(not run - the page still wants: ${check.waitingOn})` : null;
}

function renderTelemanus(c) {
  const out = [];
  const part = (title, body) => {
    if (!body) return;
    out.push(`${title}\n${'-'.repeat(title.length)}\n${body}\n`);
  };

  const head = [];
  if (c.page) head.push(c.page);
  if (c.timeLeft) head.push(`Time left: ${c.timeLeft}`);
  if (c.lastSaved) head.push(`Last saved at: ${c.lastSaved}`);
  if (head.length) out.push(head.join('\n') + '\n');

  const videos = c.videos || [];
  part(videos.length > 1 ? 'Videos' : 'Video', videos.length
    ? videos.map((v) => (v.duration ? `${v.url}\nLength: ${v.duration}` : v.url)).join('\n\n')
    : '(no video link found on this page)');

  part('Assets', (c.assets || []).map((a) => {
    if (!a.fields) return `${a.title}: ${a.text || '(empty)'}`;
    const rows = Object.entries(a.fields).map(([k, v]) => `${k}: ${v || '(empty)'}`);
    return `${a.title}\n${tmIndent(rows.join('\n'))}`;
  }).join('\n'));

  const f = c.form;
  if (!f) return out.join('\n').trim();

  part('Group Type', f.groupType || '(not chosen)');

  for (const q of f.questions || []) {
    const lines = [
      `Taxonomy: ${q.taxonomy?.length ? q.taxonomy.join(' > ') : '(not chosen)'}`,
      `Question: ${q.question || '(empty)'}`,
      ...TM_LETTERS.map((l) => `${l}. ${q[l] || '(empty)'}`),
      `Correct answer: ${q.correct_letter || '(none)'}${q.correct_text ? ` — ${q.correct_text}` : ''}`,
      `Check the model: ${q.modelCheck || (q.modelChecked ? 'done' : '(not run)')}`
    ];
    const difficulty = tmRenderCheck(q.difficulty);
    if (difficulty) lines.push(`Difficulty: ${difficulty}`);
    part(`Question ${q.n}`, lines.join('\n'));
  }

  const design = [
    `Group Structure: ${f.groupStructure || '(empty)'}`,
    `Reasoning Steps: ${f.reasoningSteps ?? '(empty)'}`
  ];
  const coherence = tmRenderCheck(f.coherenceCheck);
  if (coherence) design.push(`Coherence Quality Check: ${coherence}`);
  part('Group Design', design.join('\n'));

  part('Time spent (minutes)', String(f.timeSpent ?? '(empty)'));
  part('Latest automatic group difficulty result', f.latestGroupDifficulty);

  const o = c.options || {};
  const choices = [];
  if (o.groupTypes?.length) choices.push(`Group Type: ${o.groupTypes.join(', ')}`);
  if (o.levels?.length) choices.push(`Taxonomy level: ${o.levels.join(', ')} (then the heads the page offers under it)`);
  choices.push('Correct letter: A to H');
  part('What the answers are chosen from', choices.join('\n'));

  return out.join('\n').trim();
}

for (const id of ['tmForm', 'tmModel', 'tmFeedback']) {
  $(id).addEventListener('change', () => save());
}

function telemanusCatchStatus(data, meta) {
  const bits = [];
  bits.push(meta.videos ? 'the video link' : 'no video link');
  if (meta.assets) bits.push(`${meta.assets} asset${meta.assets === 1 ? '' : 's'}`);
  if (meta.form) bits.push(`the form, ${meta.written} of ${meta.questions} question${meta.questions === 1 ? '' : 's'} written`);
  let msg = `Caught ${bits.join(', ')}.`;
  if (!meta.form) msg += '\nThe submit form was left out — tick "Include the submit form" to catch it too.';
  else if (!meta.questions) msg += '\nNo questions on this page — the form is on the page after the instructions.';
  const ok = meta.videos > 0 && (!meta.form || meta.questions > 0);
  return { msg, kind: ok ? 'ok' : '' };
}

/* ---------- what the Check feedback buttons said ---------- */

const tmVerdict = (f) => (f.passed === true ? 'PASSED' : f.passed === false ? 'FAILED'
  : f.text ? 'NO VERDICT READ' : 'NO RESULT');

// Every question's result, passed and failed alike, as one block of text.
function tmFeedbackReport(feedback) {
  const passed = feedback.filter((f) => f.passed === true).length;
  const head = `Telemanus - Check feedback results: ${passed} of ${feedback.length} passed`;
  const parts = feedback.map((f) => `${f.title} - ${tmVerdict(f)}\n${f.text || '(no result on the page)'}`);
  return [head, ...parts].join('\n\n');
}

// The last fill's report, kept for the Copy button.
let tmLastReport = '';

function tmShowReport(report) {
  tmLastReport = report;
  $('tmCopyFeedback').hidden = !report;
}

$('tmCopyFeedback').addEventListener('click', async () => {
  if (!tmLastReport) return setStatus('No feedback results yet - run a fill with Check feedback on.', 'err');
  const ok = await copyText(tmLastReport);
  setStatus(ok ? 'Feedback results copied to clipboard.' : 'Could not copy the feedback results.', ok ? 'ok' : 'err');
});

function telemanusApplyStatus(result) {
  const verb = $('entry').value === 'type' ? 'Typed' : 'Pasted';
  let msg = `${verb} ${result.filled} of ${result.requested} step${result.requested === 1 ? '' : 's'}`
    + ` across ${result.questions} question${result.questions === 1 ? '' : 's'}.`;
  if (result.checked.length) msg += `\nCheck feedback pressed on question ${result.checked.join(', ')}.`;

  const feedback = result.feedback || [];
  const allPassed = feedback.length > 0 && feedback.every((f) => f.passed === true);
  if (feedback.length) {
    const list = (rows) => rows.map((f) => f.n).join(', ');
    const failed = feedback.filter((f) => f.passed === false);
    const unread = feedback.filter((f) => f.passed === null);
    if (allPassed) msg += `\nCheck feedback: all ${feedback.length} passed.`;
    else {
      msg += `\nCheck feedback: ${feedback.length - failed.length - unread.length} of ${feedback.length} passed.`;
      if (failed.length) msg += ` Failed: question ${list(failed)}.`;
      if (unread.length) msg += ` No verdict read: question ${list(unread)}.`;
    }
  }
  tmShowReport(feedback.length ? tmFeedbackReport(feedback) : '');

  if (result.ranInBackground) {
    msg += '\nPart of this ran while the tab was behind, which Chrome slows down.';
  }
  for (const w of result.warnings) msg += `\n${w}`;
  if (result.unknownKeys.length) msg += `\nNot a Telemanus field: ${result.unknownKeys.join(', ')}`;
  if (result.skippedFields.length) msg += `\nNo field for: ${result.skippedFields.join(', ')}`;
  if (result.refused.length) msg += `\nWould not take: ${result.refused.join('\n')}`;
  if (result.truncated.length) msg += `\nCut to the field limit: ${result.truncated.join(', ')}`;
  msg += '\nSubmit is not pressed.';

  const clean = result.filled === result.requested && !result.warnings.length
    && !result.unknownKeys.length && !result.skippedFields.length && !result.refused.length
    && !result.truncated.length && (!feedback.length || allPassed);

  // Not all passed: all of the results go to the clipboard, the passed ones
  // with the failed. The line saying so follows once the copy has happened.
  if (feedback.length && !allPassed) {
    copyText(tmLastReport).then((ok) => {
      setStatus(`${msg}${unchangedLine(result)}\n${ok
        ? `All ${feedback.length} feedback results are on the clipboard.`
        : 'Could not copy the feedback results - press "Copy feedback results".'}`, ok ? '' : 'err');
    }, () => {});
  }
  return { msg, clean };
}

// What Send to input writes when the form was left out of the catch: the
// shape to fill in, with nothing in it.
function tmBlankAnswers() {
  const question = { taxonomy: [], question: null };
  for (const l of TM_LETTERS) question[l] = null;
  question.correct_letter = null;
  question.correct_text = null;
  return {
    group_type: null,
    questions: Array.from({ length: 5 }, () => ({ ...question })),
    group_structure: null,
    reasoning_steps: null,
    time_spent: null
  };
}

/* ---------- registration ---------- */

PROJECTS.telemanus = {
  name: 'Telemanus',
  catch: 'Catch task',
  toInput: 'Send answers to input',
  copied: 'Answers copied into the input box.',
  placeholder: `Paste or upload answers like this:

"answers": {
  "group_type": "Coherence",
  "questions": [
    { "taxonomy": ["2. Temporal Dynamics", "…", "…"],
      "question": "What happens right after…?",
      "A": "…", "B": "…", "C": "…", "D": "…",
      "E": "…", "F": "…", "G": "…", "H": "…",
      "correct_letter": "C",
      "correct_text": "…" }
  ],
  "group_structure": "…",
  "reasoning_steps": 3,
  "time_spent": 90
}

Questions go in order, one row each; a row left empty or null
skips that question. "Did you use the AI-generated proposal" is
not asked for: it is answered "No" in its place.`,
  // The form is one a person fills in by hand, so it is typed out.
  entry: 'type',

  render: (data) => renderTelemanus(data.content || {}),
  answers: (data) => data.answers || null,
  toInputText: (data) => answersJson(data.answers || tmBlankAnswers()),

  catchOptions: () => ({ includeForm: $('tmForm').checked }),
  catchStatus: telemanusCatchStatus,
  applyOptions: () => ({ modelCheck: $('tmModel').checked, checkFeedback: $('tmFeedback').checked }),
  applyStatus: telemanusApplyStatus,
  badge(res) {
    const t = res.telemanus;
    if (!t) return 'no Telemanus task found';
    return t.questions
      ? `${t.written} of ${t.questions} question${t.questions === 1 ? '' : 's'} written`
      : 'no questions on this page';
  },

  saveState: () => ({
    tmForm: $('tmForm').checked,
    tmModel: $('tmModel').checked,
    tmFeedback: $('tmFeedback').checked
  }),
  loadState(s) {
    $('tmForm').checked = s.tmForm !== false;
    $('tmModel').checked = s.tmModel !== false;
    $('tmFeedback').checked = s.tmFeedback !== false;
  }
};
