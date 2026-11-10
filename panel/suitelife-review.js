/* Criteria Catcher - side panel: Suite Life, the Reviewer tab.

   The Review stage of a Suite Life task. The Content block is the stage and
   times, the checks' answers, the previous round's grading feedback when
   there is one, the task's facts, the uploads, the Task Report as Markdown,
   then the submission as the submitter left it - every section, every
   answer - and last the Reviewer Feedback questions, which are the ones a
   fill writes. The reviewer's answers go back with the Delay between them.

   Nothing is registered here: panel/suitelife.js owns the project and hands
   a Review catch or fill to what is below, by the tab.

   Needs panel/core.js and panel/suitelife.js, for the kind names and the
   note layout. */

const SLR_KIND_NAME = Object.assign({}, SL_KIND_NAME, {
  rating: 'pick a point on the scale',
  check: 'check — run alongside the answers when asked'
});

// A question the reviewer answers: its name and wording, what it asks, its
// options, and what is answered now.
function slrRenderQuestion(f) {
  const out = [`[${f.name || f.key}]  ${f.label}  (${SLR_KIND_NAME[f.kind] || f.kind})`];
  if (f.guidelines) out.push(f.guidelines);
  else if (f.question && f.question !== f.label) out.push(`Q: ${f.question}`);

  if (f.kind === 'choice' || f.kind === 'segment') {
    if (f.options?.length) {
      out.push('Options:');
      for (const o of f.options) out.push(`  - ${o.text}`);
    }
    out.push(f.answer ? `Answer: ${f.answer}` : 'Answer: (not chosen)');
  } else if (f.kind === 'rating') {
    const pts = (f.options || []).map((o) => o.text).join(' ');
    out.push(f.scale ? `Scale: ${pts}  (${f.scale.low} → ${f.scale.high})` : `Scale: ${pts}`);
    out.push(f.answer !== null && f.answer !== undefined ? `Answer: ${f.answer}` : 'Answer: (not chosen)');
  } else if (f.kind === 'flags' || f.kind === 'confirmation') {
    const on = f.answer || [];
    for (const o of f.options || []) out.push(`  [${on.includes(o.text) ? 'x' : ' '}] ${o.text}`);
    if (!on.length) out.push('Answer: (none ticked)');
  } else if (f.answer === null || f.answer === undefined || f.answer === '') {
    out.push('Answer: (empty)');
  } else {
    out.push(`Answer:\n${f.answer}`);
  }
  return out.join('\n');
}

// A question of the submission: what was asked and what the submitter said.
// A locked one is theirs alone; an open text box can still be written, by
// its key, so the key is shown.
function slrRenderSubmitted(f) {
  const who = f.area ? `${f.label} — ${f.area}` : f.label;
  if (f.kind === 'check') {
    // The results themselves are in the Checks part above; here, the verdicts.
    const said = (f.results || []).map((r) => r.verdict || (r.passed ? 'PASS' : 'FAIL'));
    return `${f.label}: ${said.length ? said.join(', ') : SL_CHECK_STATE[f.state] || f.state}`
      + `${f.waitsFor ? ` — waits for ${f.waitsFor}` : ''}`;
  }
  if (f.kind === 'segment' || f.kind === 'choice') {
    return `${who}: ${f.answer || '(not chosen)'}${f.locked ? '' : '  [open]'}`;
  }
  if (f.kind === 'flags' || f.kind === 'confirmation') {
    const on = f.answer || [];
    const all = f.options || [];
    const out = [`${who}: ${on.length} of ${all.length} ticked${f.locked ? '' : '  [open]'}`];
    for (const o of all) if (!on.includes(o.text)) out.push(`  [ ] ${o.text}`);
    return out.join('\n');
  }
  const key = f.locked ? '' : `[${f.name || f.key}]  `;
  const empty = f.answer === null || f.answer === undefined || f.answer === '';
  return `${key}${who}:${empty ? ' (empty)' : `\n${f.answer}`}`;
}

function renderSlReview(c) {
  const out = [];
  const part = (title, body) => {
    if (!body) return;
    out.push(`${title}\n${'-'.repeat(title.length)}\n${body}\n`);
  };

  const head = ['Stage: Review'];
  if (c.verdict) head.push(`Verdict so far: ${c.verdict}`);
  if (c.lastSaved) head.push(`Last saved at: ${c.lastSaved}`);
  if (c.timeLeft) head.push(`Time left: ${c.timeLeft}`);
  out.push(head.join('\n') + '\n');

  for (const fb of c.previousFeedback || []) part(fb.label, fb.text);

  // The checks' answers lead: they are what the catch pressed for.
  const checks = (c.submission || []).flatMap((s) => (s.fields || []).filter((f) => f.kind === 'check'));
  if (checks.length) {
    part('Checks', checks.map((f) => {
      const lines = [`${f.label}: ${SL_CHECK_STATE[f.state] || f.state}${f.waitsFor ? ` — waits for ${f.waitsFor}` : ''}`];
      for (const r of f.results || []) {
        lines.push(`  ${r.verdict || (r.passed ? 'PASS' : 'FAIL')}${r.name ? ` ${r.name}` : ''}${r.text ? `: ${r.text}` : ''}`);
      }
      return lines.join('\n');
    }).join('\n\n'));
  }

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

  part('Uploads', (c.uploads || [])
    .map((u) => `${u.field}\n  ${u.files?.length ? u.files.join(', ') : '(nothing uploaded yet)'}`)
    .join('\n'));

  part('Task Report', c.report);

  const wide = '#'.repeat(60);
  out.push(`${wide}\nTHE SUBMISSION — as the submitter left it\n${wide}\n`);
  for (const sec of c.submission || []) {
    const fields = (sec.fields || []).filter((f) => f.kind !== 'readonly');
    const bar = '='.repeat(Math.min(60, Math.max(sec.name.length, 12)));
    out.push(`${bar}\n${sec.name}\n${bar}\n`);
    if (!fields.length) {
      out.push(sec.waiting ? '(Not open yet.)\n' : '(Nothing here.)\n');
      continue;
    }
    for (const f of fields) out.push(slrRenderSubmitted(f) + '\n');
  }

  const rev = c.review || { name: 'Reviewer Feedback', fields: [] };
  out.push(`${wide}\n${(rev.name || 'Reviewer Feedback').toUpperCase()} — yours to answer\n${wide}\n`);
  const qs = (rev.fields || []).filter((f) => f.kind !== 'readonly' && f.kind !== 'check');
  if (!qs.length) out.push('(No reviewer questions found.)\n');
  for (const f of qs) out.push(slrRenderQuestion(f) + '\n');

  return out.join('\n').trim();
}

function slReviewCatchStatus(data, meta) {
  const c = data.content || {};
  const bits = [`the submission (${meta.submittedAnswered} of ${meta.submitted} answered)`];
  if (c.brief?.length) bits.push('the task facts');
  if (meta.report) bits.push('the Task Report');
  if (meta.notes) bits.push(`${meta.notes} task note${meta.notes === 1 ? '' : 's'}`);
  bits.push(`${meta.fields} reviewer question${meta.fields === 1 ? '' : 's'}`);
  let msg = `Caught ${bits.join(', ')}${data.fileName ? ` for ${data.fileName}` : ''}.`;
  if (meta.feedback) msg += '\nThis task came back with grading feedback from a previous round — it is at the top.';
  msg += meta.verdict ? `\nVerdict so far: ${meta.verdict}.` : '\nNo verdict chosen yet.';
  if (meta.fields) {
    msg += meta.answered
      ? `\n${meta.answered} of ${meta.fields} reviewer questions answered.`
      : '\nNothing answered yet in Reviewer Feedback.';
  }

  const answered = (meta.checks || []).filter((k) => k.state === 'answered');
  if (answered.length) {
    msg += `\nChecks: ${answered.map((k) => `${k.label} — ${k.verdicts?.length ? k.verdicts.join(', ') : 'answered'}`).join('; ')}`;
  }
  const failed = (meta.checks || []).filter((k) => k.failed);
  if (failed.length) msg += `\nFailing checks: ${failed.map((k) => k.label).join(', ')}`;
  if (meta.checksWaiting?.length) {
    msg += `\nPressed but not answered in time: ${meta.checksWaiting.join(', ')} — catch again once they show.`;
  }
  const notRun = (meta.checks || []).filter((k) => k.state !== 'answered' && !meta.checksWaiting?.includes(k.label))
    .map((k) => (k.waitsFor ? `${k.label} (after ${k.waitsFor})` : k.label));
  if (notRun.length) {
    msg += `\nChecks not run: ${notRun.join(', ')}${meta.checksSkipped === 'turned off' ? ' (pressing them first is turned off)' : ''}`;
  }
  if (meta.unanswered?.length) msg += `\nStill yours to answer: ${meta.unanswered.join(', ')}`;
  if (meta.waiting) {
    msg += `\n${meta.waiting} section${meta.waiting === 1 ? ' is' : 's are'} not open yet.`;
  }
  return { msg, kind: 'ok' };
}

function slReviewApplyStatus(result) {
  let msg = `Answered ${result.filled} of ${result.requested} question`
    + `${result.requested === 1 ? '' : 's'}.`;
  if (result.ranInBackground) {
    msg += '\nPart of this ran while the tab was behind, which Chrome slows down.';
  }
  if (result.skippedFields.length) msg += `\nNot on this page: ${result.skippedFields.join(', ')}`;
  if (result.refused.length) msg += `\nWould not take: ${result.refused.join('\n')}`;
  if (result.unknownFlags?.length) msg += `\nNo such option — ${result.unknownFlags.join('\n')}`;
  if (result.truncated.length) msg += `\nCut to the field limit: ${result.truncated.join(', ')}`;
  if (result.locked?.length) {
    msg += `\nThe submitter's, locked on this page: ${result.locked.join(', ')}`;
  }
  if (result.readOnly?.length) {
    msg += `\nFilled in by the page, not by you: ${result.readOnly.join(', ')}`;
  }
  if (result.leftToYou?.length) {
    msg += `\nNot written — a check is pressed, not answered: ${result.leftToYou.join(', ')}`;
  }
  if (result.unsure?.length) {
    msg += `\nCheck these came out right: ${result.unsure.join(', ')}`;
  }
  for (const c of result.checks || []) {
    const said = (c.results || []).map((r) => r.verdict || (r.passed ? 'PASS' : 'FAIL'));
    msg += `\n${c.label}: ${c.outcome}${said.length ? ` — ${said.join(', ')}` : ''}`;
  }
  if (result.checksSkipped && result.checksSkipped !== 'turned off') {
    msg += `\nChecks not run: ${result.checksSkipped}.`;
  }
  const todo = result.stillToDo || {};
  if (todo.questions?.length) msg += `\nStill yours to answer: ${todo.questions.join(', ')}`;
  if (todo.checks?.length) msg += `\nChecks still to run: ${todo.checks.join(', ')}`;
  msg += '\nSubmit is yours to press.';

  const checksOk = (result.checks || []).every((c) => /answered|passing/.test(c.outcome)
    && (c.results || []).every((r) => r.passed));
  const clean = result.filled === result.requested
    && !result.skippedFields.length && !result.refused.length && !result.truncated.length
    && !result.unsure?.length && !result.unknownFlags?.length && !result.locked?.length && checksOk;
  return { msg, clean };
}

// The input template on the Reviewer tab.
const SL_REVIEW_PLACEHOLDER = `Paste or upload answers like this:

"answers": {
  "verdict": "Needs Revision",
  "notes": "- instruction.md: …\\n- verifier: …",
  "error_categories": ["Test Coverage Issues", "Metadata Issues"],
  "rebuttal": "No rebuttal comments available",
  "quality": 2,
  "review_minutes": 45
}

An Accept takes "requirements": true (or a list of the requirements
met) in place of the error categories. The verdict is answered first
whatever the order: the notes box and the lists appear once it is
chosen. Keys are the names above, the page's field names, or a
question's wording. The submitter's text boxes can be written too,
by their Suite Life keys; their choices and confirmations are locked.
Submit is never pressed.`;
