/* Criteria Catcher - side panel: Rudder.

   Preference comparisons. The Content block is the whole task - its notes,
   the conversation, both responses, and every question with its options and
   answer - and the Answers box is what gets edited and typed back in.

   Needs panel/core.js. */

function noteBody(n) {
  const asks = (n.asks || []).map((a) => `[${a.answer ? 'x' : ' '}] ${a.question}`).join('\n');
  return [n.text, asks].filter(Boolean).join('\n\n');
}

/* ---------- one question ----------
   The key, the wording, the options, and whatever is answered now. */

const KIND_NAME = {
  choice: 'pick one',
  flags: 'tick any that apply',
  text: 'written answer',
  value: 'value'
};

function renderQuestion(f, withGuidelines) {
  const out = [`[${f.key}]  ${f.label}  (${KIND_NAME[f.kind] || f.kind})`];
  if (f.question && f.question !== f.label) out.push(`Q: ${f.question}`);
  // The guidance behind a rating runs to a page or more, so it is included only
  // when it was asked for.
  if (withGuidelines && f.guidelines) out.push(f.guidelines);

  if (f.kind === 'choice') {
    out.push('Options:');
    for (const o of f.options || []) out.push(`  ${o.value} = ${o.text}`);
    out.push(f.answer === null || f.answer === undefined
      ? 'Answer: (not answered)'
      : `Answer: ${f.answer}${f.answerText ? ` — ${f.answerText}` : ''}`);
  } else if (f.kind === 'flags') {
    const on = f.answer || [];
    out.push('Flags:');
    for (const o of f.options || []) out.push(`  [${on.includes(o.text) ? 'x' : ' '}] ${o.text}`);
    if (!on.length) out.push('Answer: (none ticked)');
  } else if (f.answer === null || f.answer === undefined || f.answer === '') {
    out.push('Answer: (empty)');
  } else {
    out.push(`Answer:\n${f.answer}`);
  }
  return out.join('\n');
}

/* ---------- the caught Rudder task ----------
   One block holding everything the task says: what it is waiting on, the
   conversation, both responses, and every question with its options and
   whatever has already been answered. It is meant to be copied out whole, so
   nothing is left to be looked up on the page afterwards. */

function renderRudder(c, withGuidelines) {
  const out = [];
  const part = (title, body) => {
    if (!body) return;
    out.push(`${title}\n${'-'.repeat(title.length)}\n${body}\n`);
  };

  const head = [];
  if (c.title) head.push(c.title);
  head.push(c.stage === 'revision'
    ? 'Stage: revision — this task has been answered or sent back before.'
    : 'Stage: first pass — nothing has been answered yet.');
  out.push(head.join('\n') + '\n');

  if (c.taskNotes?.length) {
    const latest = c.taskNotes.find((n) => n.latest);
    const rest = c.taskNotes.filter((n) => n !== latest);
    if (latest) {
      part(`Latest note — ${latest.title}${latest.time ? ` (${latest.time})` : ''}`,
        `This is what the task is waiting on.\n\n${noteBody(latest)}`);
    }
    if (rest.length) {
      part(latest ? 'Earlier task notes' : 'Task notes',
        rest.map((n) => `[${n.title}${n.time ? ` — ${n.time}` : ''}]\n${noteBody(n)}`).join('\n\n'));
    }
  }

  for (const doc of c.documents || []) part(doc.title, doc.text);

  for (const sec of c.sections || []) {
    const bar = '='.repeat(Math.min(60, Math.max(sec.name.length, 12)));
    out.push(`${bar}\n${sec.name}\n${bar}\n`);
    if (sec.intro) out.push(sec.intro + '\n');
    for (const f of sec.fields) out.push(renderQuestion(f, withGuidelines) + '\n');
  }

  return out.join('\n').trim();
}

// The guidelines are part of the caught block, so turning them on redraws it.
$('withGuidelines').addEventListener('change', () => {
  save();
  if (caught) showResult(caught);
});

function rudderCatchStatus(data, meta) {
  const bits = [`${meta.fields} question${meta.fields === 1 ? '' : 's'}`];
  if (meta.documents) bits.push(`${meta.documents} document${meta.documents === 1 ? '' : 's'}`);
  if (meta.notes) bits.push(`${meta.notes} task note${meta.notes === 1 ? '' : 's'}`);
  let msg = `Caught ${bits.join(', ')}.`;
  // First time round there is nothing to carry over; on a revision the
  // answers already on the page are what the next one is edited from.
  msg += meta.answered
    ? `\n${meta.answered} of ${meta.fields} already answered — those are in the Answers box.`
    : '\nNothing answered yet, so the Answers box is a blank template.';
  return { msg, kind: 'ok' };
}

// After a fill: how many were answered, and anything the
// page would not take.
function rudderApplyStatus(result) {
  let msg = `Answered ${result.filled} of ${result.requested} question`
    + `${result.requested === 1 ? '' : 's'}.`;
  if (result.ranInBackground) {
    msg += '\nPart of this ran while the tab was behind, which Chrome slows down.';
  }
  // A key the page does not ask for is worth saying out loud: it usually
  // means the answer was written against a different task.
  if (result.skippedFields.length) {
    msg += `\nNot on this page: ${result.skippedFields.join(', ')}`;
  }
  if (result.refused.length) msg += `\nWould not take: ${result.refused.join('\n')}`;
  if (result.unknownFlags.length) msg += `\nNo such flag — ${result.unknownFlags.join('\n')}`;
  if (result.truncated.length) msg += `\nCut to the field limit: ${result.truncated.join(', ')}`;

  const clean = result.filled === result.requested && !result.skippedFields.length
    && !result.refused.length && !result.unknownFlags.length && !result.truncated.length;
  return { msg, clean };
}

/* ---------- registration ---------- */

PROJECTS.rudder = {
  name: 'Rudder',
  catch: 'Catch task',
  toInput: 'Send answers to input',
  copied: 'Answers copied into the input box.',
  placeholder: `Paste or upload answers like this:

"answers": {
  "constraint_following_response_a": 4,
  "constraint_following_checkboxes_response_a": [
    "Length or count constraint missed"
  ],
  "overall_rationale_response_a": "The response is mostly helpful…",
  "preference": "A > B"
}

Catch the task first and press "Send answers to input": that
fills this box with the keys the page actually asks for, and
with whatever is already answered on it.`,
  // A Rudder answer goes into a form a person is meant to have filled in by
  // hand, so it is typed out rather than dropped in whole.
  entry: 'type',

  render: (data) => renderRudder(data.content || {}, $('withGuidelines').checked),
  answers: (data) => data.answers || null,
  toInputText: (data) => answersJson(data.answers),

  catchStatus: rudderCatchStatus,
  applyStatus: rudderApplyStatus,
  badge(res) {
    $('stageHint').textContent = 'The task, its notes and any answers already on it.';
    return res.rudderFields
      ? `${res.rudderFields} question${res.rudderFields === 1 ? '' : 's'}`
      : 'no rating form found';
  },

  saveState: () => ({ withGuidelines: $('withGuidelines').checked }),
  loadState(s) {
    $('withGuidelines').checked = !!s.withGuidelines;
  }
};
