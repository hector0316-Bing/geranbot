/* Criteria Catcher - side panel: Copperhead.

   Snorkel's asset and workflow validation. The Content block is the task
   brief, the IDs and times, the uploads, the notes and the form; the Answers
   box is what gets typed back in, with the Delay setting between answers.

   Needs panel/core.js. */

/* ---------- the caught Copperhead task ----------
   The brief as the left panel gives it, the IDs and times that say which task
   and which save this is, the notes, then the form question by question. */

const STAGE_NAME = { submission: 'Submission', review: 'Review', adjudication: 'Adjudication' };

function renderCopperhead(c) {
  const out = [];
  const part = (title, body) => {
    if (!body) return;
    out.push(`${title}\n${'-'.repeat(title.length)}\n${body}\n`);
  };

  const head = [`Stage: ${STAGE_NAME[c.stage] || c.stage || 'Submission'}`];
  if (c.taskId) head.push(`Task ID: ${c.taskId}`);
  if (c.lastSaved) head.push(`Last saved at: ${c.lastSaved}`);
  out.push(head.join('\n') + '\n');

  part('Task brief', (c.brief || [])
    .map((b) => `${b.label}: ${b.value ?? '(empty)'}${b.link ? ` <${b.link}>` : ''}`)
    .join('\n'));

  part('Uploads', (c.uploads || [])
    .map((u) => `${u.field ? `${u.field}: ` : ''}${u.name}${u.time ? ` (${u.time})` : ''}`)
    .join('\n'));

  // Newest first, automated and reviewer alike: it says what the task is
  // waiting on now.
  if (c.taskNotes?.length) {
    const notes = [...c.taskNotes].sort((a, b) => (b.latest ? 1 : 0) - (a.latest ? 1 : 0));
    part('Task notes', notes
      .map((n) => `[${n.title}${n.time ? ` — ${n.time}` : ''}${n.latest ? ', newest' : ''}]\n${noteBody(n)}`)
      .join('\n\n'));
  }

  for (const sec of c.sections || []) {
    const bar = '='.repeat(Math.min(60, Math.max(sec.name.length, 12)));
    out.push(`${bar}\n${sec.name}\n${bar}\n`);
    if (sec.intro) out.push(sec.intro + '\n');
    if (sec.waiting) {
      out.push('(Not open yet — it appears once the questions before it are answered.)\n');
      continue;
    }
    // The guidance here is a line or two per question, worth having in full.
    for (const f of sec.fields) out.push(renderQuestion(f, true) + '\n');
  }

  return out.join('\n').trim();
}

$('delay').addEventListener('change', () => save());

function copperheadCatchStatus(data, meta) {
  const c = data.content || {};
  const bits = [`${meta.fields} question${meta.fields === 1 ? '' : 's'}`];
  if (c.brief) bits.push('the task brief');
  if (c.uploads?.length) bits.push(`${c.uploads.length} upload${c.uploads.length === 1 ? '' : 's'}`);
  if (meta.notes) bits.push(`${meta.notes} task note${meta.notes === 1 ? '' : 's'}`);
  let msg = `Caught ${bits.join(', ')}${c.taskId ? ` for ${c.taskId}` : ''}.`;
  msg += meta.answered
    ? `\n${meta.answered} of ${meta.fields} already answered — those are in the Answers box.`
    : '\nNothing answered yet, so the Answers box is a blank template.';
  if (meta.waiting) {
    msg += `\n${meta.waiting} section${meta.waiting === 1 ? ' is' : 's are'} not open yet — `
      + 'they appear once the questions before them are answered.';
  }
  return { msg, kind: 'ok' };
}

/* ---------- registration ---------- */

PROJECTS.copperhead = {
  name: 'Copperhead',
  catch: 'Catch task',
  toInput: 'Send answers to input',
  copied: 'Answers copied into the input box.',
  placeholder: `Paste or upload answers like this:

"answers": {
  "boolean-were_you_able_to_download_the_application_listed_in_this_task": "Yes",
  "Does this asset appear to have been created for real professional work?": "Mostly",
  "How long would it take you to produce this asset as a finished deliverable (hours)?": 6.5,
  "Who would use or own this asset?": "The association's accountant…"
}

Keys are the field names from a catch, or a question's own wording.
Answers go in the order written, with the Delay after each one, so
put a follow-up question after the answer that brings it in.`,
  // A review is a form a person fills in by hand, so it is typed out.
  entry: 'type',

  render: (data) => renderCopperhead(data.content || {}),
  answers: (data) => data.answers || null,
  toInputText: (data) => answersJson(data.answers),

  catchStatus: copperheadCatchStatus,
  // Delay stands in for Gap here: the wait after each answer.
  applyOptions: () => ({ gap: Number($('delay').value) }),
  applyStatus: formApplyStatus,
  badge(res) {
    const ch = res.copperhead;
    return ch
      ? `${STAGE_NAME[ch.stage] || ch.stage} · ${ch.fields} question${ch.fields === 1 ? '' : 's'}`
      : 'no Copperhead task found';
  },

  saveState: () => ({ delay: $('delay').value }),
  loadState(s) {
    $('delay').value = s.delay || '5000';
  }
};
