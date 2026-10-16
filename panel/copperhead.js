/* Criteria Catcher - side panel: Copperhead.

   Snorkel's asset and workflow validation. The Content block is the task
   brief, the IDs and times, the uploads, the notes and the form; the Answers
   box is what gets typed back in, with the Delay setting between answers.

   Needs panel/core.js. */

function chNoteBody(n) {
  const asks = (n.asks || []).map((a) => `[${a.answer ? 'x' : ' '}] ${a.question}`).join('\n');
  return [n.text, asks].filter(Boolean).join('\n\n');
}

const CH_KIND_NAME = {
  choice: 'pick one',
  flags: 'tick any that apply',
  select: 'pick from the list',
  number: 'a number',
  text: 'written answer'
};

// One question: its key and wording, what it asks, its options, and what is
// answered now. The guidance under a Copperhead question is a line or two,
// so it is kept in full.
function chRenderQuestion(f) {
  const out = [`[${f.key}]  ${f.label}  (${CH_KIND_NAME[f.kind] || f.kind})`];
  if (f.guidelines) out.push(f.guidelines);
  else if (f.question && f.question !== f.label) out.push(`Q: ${f.question}`);

  if (f.kind === 'choice' || f.kind === 'select') {
    if (f.options?.length) {
      out.push('Options:');
      for (const o of f.options) out.push(`  - ${o.text}`);
    }
    out.push(f.answer ? `Answer: ${f.answer}` : 'Answer: (not answered)');
  } else if (f.kind === 'flags') {
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

// After a fill: how many were answered, and anything the page would not take
// or that was left for the reviewer.
function copperheadApplyStatus(result) {
  let msg = `Answered ${result.filled} of ${result.requested} question`
    + `${result.requested === 1 ? '' : 's'}.`;
  if (result.ranInBackground) {
    msg += '\nPart of this ran while the tab was behind, which Chrome slows down.';
  }
  // A question the page does not ask is worth saying out loud: usually its
  // wording differs from the page's, or it belongs to another task.
  if (result.skippedFields.length) {
    msg += `\nNot on this page: ${result.skippedFields.join(', ')}`;
  }
  if (result.refused.length) msg += `\nWould not take: ${result.refused.join('\n')}`;
  if (result.unknownFlags.length) msg += `\nNo such option — ${result.unknownFlags.join('\n')}`;
  if (result.truncated.length) msg += `\nCut to the field limit: ${result.truncated.join(', ')}`;
  if (result.leftToYou?.length) {
    msg += `\nLeft for you to tick yourself: ${result.leftToYou.join(', ')}`;
  }

  const clean = result.filled === result.requested && !result.skippedFields.length
    && !result.refused.length && !result.unknownFlags.length && !result.truncated.length;
  return { msg, clean };
}

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
      .map((n) => `[${n.title}${n.time ? ` — ${n.time}` : ''}${n.latest ? ', newest' : ''}]\n${chNoteBody(n)}`)
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
    for (const f of sec.fields) out.push(chRenderQuestion(f) + '\n');
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
    ? `\n${meta.answered} of ${meta.fields} already answered.`
    : '\nNothing answered yet.';
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
  // No Answers box: every answer is already in the Content block. The JSON
  // still carries them, for Send answers to input.
  toInputText: (data) => answersJson(data.answers),

  catchStatus: copperheadCatchStatus,
  // Delay stands in for Gap here: the wait after each answer.
  applyOptions: () => ({ gap: Number($('delay').value) }),
  applyStatus: copperheadApplyStatus,
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
