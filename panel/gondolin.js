/* Criteria Catcher - side panel: Gondolin.

   Office template redesign tasks. The Content block is the task number,
   the metadata, the prompt, the uploads, the rubric and everything an
   answer may be chosen from - the subdomains of every domain included, since
   the page shows only the chosen domain's. The Answers box is what gets
   edited and written back.

   Needs panel/core.js. */

const GD_STAGE_NAME = { submission: 'Submission', review: 'Review', adjudication: 'Adjudication' };
const GD_IMPORTANCE_NAME = { 1: 'Minor', 2: 'Important', 3: 'Critical' };

function renderGondolin(c) {
  const out = [];
  const part = (title, body) => {
    if (!body) return;
    out.push(`${title}\n${'-'.repeat(title.length)}\n${body}\n`);
  };

  const head = [];
  if (c.task) head.push(c.task);
  head.push(`Stage: ${GD_STAGE_NAME[c.stage] || c.stage || 'Submission'}`);
  if (c.timeLeft) head.push(`Time left: ${c.timeLeft}`);
  if (c.lastSaved) head.push(`Last saved at: ${c.lastSaved}`);
  out.push(head.join('\n') + '\n');

  if (c.pendingChecks?.length) {
    part('Checks still waiting when this was caught', c.pendingChecks.join('\n'));
  }

  // Newest first: it says what the task is waiting on now.
  if (c.taskNotes?.length) {
    const notes = [...c.taskNotes].sort((a, b) => (b.latest ? 1 : 0) - (a.latest ? 1 : 0));
    part('Task notes', notes
      .map((n) => `[${n.title}${n.time ? ` — ${n.time}` : ''}${n.latest ? ', newest' : ''}]\n${n.text}`)
      .join('\n\n'));
  }

  const m = c.metadata || {};
  part('Metadata', [
    `Domain: ${m.domain || '(not chosen)'}`,
    `Subdomain: ${m.subdomain || '(not chosen)'}`,
    `Use Case: ${m.useCase || '(empty)'}`,
    `Change Type: ${m.changeType?.length ? m.changeType.join(', ') : '(none ticked)'}`
  ].join('\n'));

  part('Prompt', c.prompt || '(empty)');

  part('Uploads', (c.uploads || [])
    .map((u) => `${u.label}: ${u.file || '(not uploaded)'}`)
    .join('\n'));

  const o = c.options || {};
  const size = o.criteriaCount ? `${o.criteriaCount.min} to ${o.criteriaCount.max}` : '15 to 25';
  const rows = c.criteria || [];
  part(`Rubric (${rows.length} written — the task asks for ${size})`, rows.length
    ? rows.map((x) => {
      const imp = x.importance ? `${x.importance} ${GD_IMPORTANCE_NAME[x.importance] || ''}`.trim() : 'no importance';
      return `${x.n}. [${x.category || 'no category'} · ${imp}] ${x.criterion || '(empty)'}`;
    }).join('\n')
    : '(no criteria yet)');

  if (c.qualityFeedback?.length) {
    part('Quality feedback', c.qualityFeedback
      .map((r) => (r.passed === null || r.passed === undefined ? r.text : `${r.passed ? 'PASS' : 'FAIL'}\n${r.text}`))
      .join('\n\n'));
  }

  const choices = [];
  if (o.subdomainsByDomain) {
    choices.push('Domain, and the subdomains each one has:');
    for (const [domain, subs] of Object.entries(o.subdomainsByDomain)) {
      choices.push(`  ${domain}`);
      for (const s of subs) choices.push(`    - ${s}`);
    }
  }
  if (o.changeTypes?.length) choices.push(`Change Type (tick at least two): ${o.changeTypes.join(', ')}`);
  if (o.categories?.length) choices.push(`Rubric Category: ${o.categories.join(', ')}`);
  if (o.importance?.length) {
    choices.push(`Importance: ${o.importance.map((i) => `${i.value} ${i.text}`).join(', ')}`);
  }
  choices.push(`Criteria: ${size}`);
  part('What the answers are chosen from', choices.join('\n'));

  return out.join('\n').trim();
}

$('gdMatch').addEventListener('change', () => save());

const GD_FEEDBACK_SKIPPED = {
  'turned off': 'quality feedback not run, the toggle is off',
  'no prompt yet': 'quality feedback skipped, there is no prompt yet',
  'no criteria yet': 'quality feedback skipped, there are no criteria yet',
  'the button is disabled': 'quality feedback not run, the page has its button disabled'
};

function gondolinCatchStatus(data, meta) {
  const c = data.content || {};
  const bits = [`${meta.criteria} criteri${meta.criteria === 1 ? 'on' : 'a'}`];
  if (c.metadata?.domain) bits.push('the metadata');
  if (c.prompt) bits.push('the prompt');
  if (meta.notes) bits.push(`${meta.notes} task note${meta.notes === 1 ? '' : 's'}`);
  if (c.qualityFeedback?.length) bits.push('the quality feedback');
  let msg = `Caught ${bits.join(', ')}${c.task ? ` for ${c.task}` : ''}.`;

  const skipped = GD_FEEDBACK_SKIPPED[meta.feedback?.skipped];
  if (skipped) msg += `\n${skipped[0].toUpperCase()}${skipped.slice(1)}.`;
  const waiting = !!meta.feedback?.waiting;
  if (waiting) msg += '\nRead before the quality feedback answered. Catch again once it lands.';

  const missing = (c.uploads || []).filter((u) => !u.file).length;
  if (missing) msg += `\n${missing} upload${missing === 1 ? ' is' : 's are'} still to do — those are left to you.`;
  return { msg, kind: waiting ? '' : 'ok' };
}

function gondolinApplyStatus(result) {
  const verb = $('entry').value === 'type' ? 'Typed' : 'Pasted';
  let msg = `${verb} ${result.filled} of ${result.requested} answer${result.requested === 1 ? '' : 's'}`;
  if (result.criteria !== null) msg += `, ${result.criteria} of them criteria`;
  msg += result.added ? ` (added ${result.added} new section${result.added === 1 ? '' : 's'}).` : '.';

  if (result.ranInBackground) {
    msg += '\nPart of this ran while the tab was behind, which Chrome slows down.';
  }
  for (const w of result.warnings) msg += `\n${w}`;
  if (result.extrasLeft) {
    msg += `\n${result.extrasLeft} extra section${result.extrasLeft === 1 ? '' : 's'} `
      + 'could not be deleted — the page did not remove them.';
  }
  if (result.unknownKeys.length) msg += `\nNot a Gondolin field: ${result.unknownKeys.join(', ')}`;
  if (result.skippedFields.length) msg += `\nNo field for: ${result.skippedFields.join(', ')}`;
  if (result.refused.length) msg += `\nWould not take: ${result.refused.join('\n')}`;
  if (result.unknownFlags.length) msg += `\nNo such option — ${result.unknownFlags.join('\n')}`;
  if (result.truncated.length) msg += `\nCut to the field limit: ${result.truncated.join(', ')}`;
  if (result.uploadsMissing.length) {
    msg += `\nLeft for you to upload: ${result.uploadsMissing.join(', ')}. Submit is not pressed.`;
  }

  const clean = result.filled === result.requested && !result.warnings.length && !result.extrasLeft
    && !result.unknownKeys.length && !result.skippedFields.length && !result.refused.length
    && !result.unknownFlags.length && !result.truncated.length;
  return { msg, clean };
}

/* ---------- registration ---------- */

PROJECTS.gondolin = {
  name: 'Gondolin',
  catch: 'Catch task',
  toInput: 'Send answers to input',
  copied: 'Answers copied into the input box.',
  placeholder: `Paste or upload answers like this:

"answers": {
  "domain": "Healthcare and Life Sciences",
  "subdomain": "Pharmaceuticals",
  "use_case": "Quarterly pipeline review deck",
  "change_type": ["Restyle", "Restructure"],
  "prompt": "Our pipeline review deck looks dated…",
  "criteria": [
    { "criterion": "The title slide uses the navy brand color.",
      "category": "Color", "importance": 3 }
  ]
}

The subdomain must belong to the domain. The rubric takes 15 to
25 criteria; importance is 1 (Minor), 2 (Important) or 3
(Critical). Anything left out or null is left alone on the page.`,
  // The form is one a person fills in by hand, so it is typed out.
  entry: 'type',

  render: (data) => renderGondolin(data.content || {}),
  answers: (data) => data.answers || null,
  toInputText: (data) => answersJson(data.answers),

  catchOptions: () => ({ runChecks: $('runChecks').checked }),
  catchStatus: gondolinCatchStatus,
  applyOptions: () => ({ matchCount: $('gdMatch').checked }),
  applyStatus: gondolinApplyStatus,
  badge(res) {
    const g = res.gondolin;
    return g
      ? `${GD_STAGE_NAME[g.stage] || g.stage} · ${g.criteria} of ${g.sections} criteri${g.sections === 1 ? 'on' : 'a'} written`
      : 'no Gondolin task found';
  },

  saveState: () => ({ gdMatch: $('gdMatch').checked }),
  loadState(s) {
    $('gdMatch').checked = s.gdMatch !== false;
  }
};
