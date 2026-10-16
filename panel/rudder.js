/* Criteria Catcher - side panel: Rudder.

   Preference comparisons. The Content block is the whole task - its notes,
   the conversation, both responses, and every question with its options and
   answer - and the Answers box is what gets edited and typed back in.

   Needs panel/core.js. */

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
  applyStatus: formApplyStatus,
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
