/* Criteria Catcher - side panel: Geranium.

   The criteria and rubric pages. The page type (Submission, Review,
   Refinement) is chosen on the Catch tab, detected from the page until it is
   set by hand; the Content block leads with what says which task this is, then
   what it is waiting on; a fill types the criteria back in.

   Needs panel/core.js. */

/* ---------- the caught result ---------- */

const LABELS = {
  sector: 'Sector',
  occupation: 'Occupation',
  tier: 'Tier',
  areasOfFocus: 'Areas of Focus of Feedback',
  onetOccupation: 'O*NET Occupation',
  onetTasks: 'O*NET Tasks',
  onetSkills: 'O*NET Skills'
};

// One plain-text block, in the order the fields are asked for.
//
// Sector and its neighbours lead. They are the one short line that says which
// task this is, and behind a page of reviewer notes and failed checks that line
// was being scrolled past unread.
function renderContent(c) {
  const out = [];
  const block = (title, body) => {
    if (body === null || body === undefined || body === '') return;
    out.push(`${title}\n${'-'.repeat(title.length)}\n${body}\n`);
  };

  const head = [];
  for (const key of ['sector', 'occupation', 'tier', 'areasOfFocus']) {
    if (c[key]) head.push(`${LABELS[key]}: ${c[key]}`);
  }
  if (head.length) out.push(head.join('\n') + '\n');

  // A block caught before every check answered should say so on its face,
  // wherever it is pasted, rather than looking like a finished reading.
  if (c.pendingChecks?.length) {
    block('Checks still waiting when this was caught', c.pendingChecks.join('\n'));
  }

  // The auto-evaluation boxes below the golden solution upload. Grouped under
  // one heading either way; only where they sit moves, because when the
  // auto-checking is what is blocking they are the thing to read, and when it
  // is not they are the last thing worth the scroll.
  const autoFields = (c.fields || []).filter((f) => f.auto);
  const otherFields = (c.fields || []).filter((f) => !f.auto);
  const autoBlock = () => block('Auto-evaluation feedback (below the golden solution upload)',
    autoFields.map((f) => `[${f.label}]\n${String(f.value)}`).join('\n\n'));

  // What each "Check feedback" button answered, failures first. These are the
  // other half of the auto-checking, so they travel with the boxes above.
  const checkResults = [...(c.checkResults || [])].sort((a, b) => a.passed - b.passed);
  const checksBlock = () => block('Check feedback results',
    checkResults.map((r) => {
      const verdict = r.verdict || (r.passed ? 'PASS' : 'FAIL');
      const head = `[${r.check}]${r.name ? ` ${r.name}` : ''}: ${verdict}`;
      return r.text ? `${head}\n${r.text}` : head;
    }).join('\n\n'));

  // One note says what this task is waiting on, and which one it is decides
  // what the rest of the block is for. A failing automated run means the
  // auto-checking is blocking, so its results lead; a reviewer's note - or an
  // automated run that all passed - means the content itself is what is left.
  const onAuto = c.focus?.on === 'auto-evaluation';
  if (c.taskNotes?.length) {
    const lead = c.taskNotes.find((n) => n.focus) || c.taskNotes.find((n) => n.latest);
    const rest = c.taskNotes.filter((n) => n !== lead);

    if (lead) {
      const heading = onAuto ? 'Focus - the auto-checking' : "Focus - the reviewer's feedback";
      block(`${heading}: ${lead.title}${lead.time ? ` (${lead.time})` : ''}`,
        [c.focus?.why, lead.text].filter(Boolean).join('\n\n'));
    }

    // Straight after the note that sent the reader here, ahead of the older
    // notes: on a task the machine is blocking, this is the whole answer.
    if (onAuto && autoFields.length) autoBlock();
    if (onAuto && checkResults.length) checksBlock();

    if (rest.length) {
      block(lead ? 'Other task notes' : 'Task notes',
        rest.map((n) => `[${n.title}${n.time ? ` - ${n.time}` : ''}]\n${n.text}`).join('\n\n'));
    }
  }

  if (!onAuto && checkResults.length) checksBlock();

  if (c.errors?.length) {
    const errs = c.errors
      .map((e) => (e.label ? `[${e.label}]\n` : '') + e.text)
      .join('\n\n');
    block('Failed checks', errs);
  }

  block('Prompt', c.prompt);

  if (c.criteria?.length) {
    const rows = c.criteria
      .map((x) => `${x.n}. (weight ${x.weight ?? '-'}) ${x.criterion || '(empty)'}`)
      .join('\n');
    block(`Criteria (${c.criteria.length})`, rows);
  }

  const onet = [];
  for (const key of ['onetOccupation', 'onetTasks', 'onetSkills']) {
    if (c[key]) onet.push(`${LABELS[key]}: ${c[key]}`);
  }
  if (onet.length) block('O*NET', onet.join('\n'));

  for (const f of otherFields) {
    const v = String(f.value);
    // Keep one-liners on the label line; give longer answers their own block.
    if (v.length <= 60 && !v.includes('\n')) out.push(`${f.label}: ${v}\n`);
    else block(f.label, v);
  }

  if (!onAuto && autoFields.length) autoBlock();

  return out.join('\n').trim();
}

/* ---------- page type ---------- */

const modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));
let modeTouched = false; // once the user picks, stop auto-selecting over them

function selectedMode() {
  return modeRadios.find((r) => r.checked)?.value || null;
}

function setMode(value) {
  for (const r of modeRadios) r.checked = r.value === value;
}

const MODE_NAME = { submission: 'Submission', review: 'Review', refinement: 'Refinement' };

for (const r of modeRadios) {
  r.addEventListener('change', () => {
    modeTouched = true;
    $('modeHint').textContent = `Set to ${MODE_NAME[r.value]} by hand.`;
    save();
  });
}

$('runChecks').addEventListener('change', () => save());
$('removeExtras').addEventListener('change', () => save());
$('submitAfter').addEventListener('change', () => save());

/* ---------- what the panel says ---------- */

// Why nothing was pressed, when nothing was. Checks that had already answered
// say nothing: that is the ordinary case on a re-catch.
const CHECKS_SKIPPED = {
  'turned off': 'checks not run, the toggle is off',
  'no prompt yet': 'checks skipped, there is no prompt yet',
  'the buttons are disabled': 'checks not run, the page has their buttons disabled',
  'no checks on this page': 'no checks on this page'
};

function geraniumCatchStatus(data, meta) {
  const c = data.content || {};
  const extras = [];
  if (c.taskNotes) extras.push(`${c.taskNotes.length} task note${c.taskNotes.length === 1 ? '' : 's'}`);
  if (c.sector) extras.push('sector');
  if (c.tier) extras.push('tier');
  if (c.fields) extras.push(`${c.fields.length} fields`);
  if (c.checkResults) {
    const failed = c.checkResults.filter((r) => !r.passed).length;
    extras.push(`${c.checkResults.length} check result${c.checkResults.length === 1 ? '' : 's'}`
      + (failed ? ` (${failed} failed)` : ''));
  }
  if (c.errors) extras.push(`${c.errors.length} failed check${c.errors.length === 1 ? '' : 's'}`);

  const fromRubric = meta?.criteriaSource === 'provided rubrics';
  if (CHECKS_SKIPPED[meta?.checksSkipped]) extras.push(CHECKS_SKIPPED[meta.checksSkipped]);
  let msg = `Caught ${data.criteria.length} criteria${extras.length ? `, plus ${extras.join(', ')}` : ''}.`;
  // Which of the two a task is stuck on is the first thing worth knowing, so
  // say it here rather than leaving it to be read out of the block.
  if (c.focus) {
    msg += c.focus.on === 'auto-evaluation'
      ? '\nWaiting on the auto-checking - start from the auto-evaluation results below the golden solution upload.'
      : '\nThe auto-checking is satisfied - waiting on the content, so start from the feedback.';
  }
  if (fromRubric) msg += '\nThe criteria list was empty, so these came from Provided Rubrics.';
  // Only meaningful when the criteria came off the form itself.
  const short = fromRubric ? 0 : (meta?.sections ?? data.criteria.length) - data.criteria.length;
  if (short > 0) msg += `\n${short} section${short === 1 ? '' : 's'} would not open and stayed empty.`;
  // Never let a reading that went ahead without every answer pass for a full one.
  const waiting = meta?.checks?.waiting || [];
  if (waiting.length) {
    msg += `\nRead before ${waiting.length} check${waiting.length === 1 ? '' : 's'} answered: `
      + `${waiting.join(', ')}. Catch again once they land.`;
  }
  return { msg, kind: short > 0 || waiting.length ? '' : 'ok' };
}

function geraniumApplyStatus(result) {
  const verb = $('entry').value === 'type' ? 'Typed' : 'Pasted';
  let msg = `${verb} ${result.filled} of ${result.requested} criteria`;
  msg += result.added ? ` (added ${result.added} new section${result.added === 1 ? '' : 's'}).` : '.';
  if (result.ranInBackground) {
    msg += '\nPart of this ran while the tab was behind, which Chrome slows down.';
  }
  if (result.extrasLeft) {
    msg += `\n${result.extrasLeft} extra section${result.extrasLeft === 1 ? '' : 's'} `
      + 'could not be deleted — the page did not remove them.';
  }
  if (result.skippedFields.length) msg += `\nNo field for: ${result.skippedFields.join(', ')}`;
  if (result.truncated.length) msg += `\nCut to the field limit: ${result.truncated.join(', ')}`;

  let clean = result.filled === result.requested
    && !result.skippedFields.length && !result.truncated.length;

  const after = result.afterFill;
  if (after) {
    for (const c of after.checks) {
      if (c.outcome !== 'answered') msg += `\n${c.name}: ${c.outcome}.`;
    }
    if (after.submitted) {
      msg += '\nEvery check passed — Submit pressed.';
    } else if (after.failed.length) {
      const names = after.failed.map((f) => (f.name ? `${f.check} — ${f.name}` : f.check));
      msg += `\n${after.failed.length} check${after.failed.length === 1 ? '' : 's'} failed, so nothing was submitted`
        + ` (scrolled to the first):\n${names.join('\n')}`;
      clean = false;
    } else {
      msg += `\nNot submitted: ${after.reason}.`;
      clean = false;
    }
  }
  return { msg, clean };
}

// The section count, and the page type the page itself says it is - unless
// the user has already picked one.
function geraniumBadge(res) {
  const found = res.detected?.mode;
  if (found && !modeTouched) {
    setMode(found);
    $('modeHint').textContent = `Detected from the page ${res.detected.source}.`;
  } else if (!found && !modeTouched) {
    $('modeHint').textContent = 'Could not tell from the page — pick one.';
  }
  return res.hasContainer
    ? `${res.count} section${res.count === 1 ? '' : 's'}`
    : 'no criteria found';
}

/* ---------- registration ---------- */

PROJECTS.geranium = {
  name: 'Geranium',
  catch: 'Catch criteria',
  toInput: 'Send criteria to input',
  copied: 'Criteria copied into the input box.',
  placeholder: `Paste or upload criteria like this:

"criteria": [
  { "1": "Criterion text, at least 20 characters.", "weight": 2 },
  { "2": "A failure mode carries a negative weight.", "weight": -3 }
]

The outer { } are optional, and so is the last ]. "criterion"
works in place of the number. Order decides which section
each row goes to.`,

  render: (data) => renderContent(data.content || {}),
  // Written in the numbered shape the input box shows as its template.
  toInputText: (data) => JSON.stringify({
    criteria: data.criteria.map((c, i) => ({ [i + 1]: c.criterion, weight: c.weight }))
  }, null, 2),

  catchOptions: () => ({ mode: selectedMode(), runChecks: $('runChecks').checked }),
  catchStatus: geraniumCatchStatus,
  applyOptions: () => ({
    removeExtras: $('removeExtras').checked,
    mode: selectedMode(),
    submitAfter: $('submitAfter').checked
  }),
  applyStatus: geraniumApplyStatus,
  badge: geraniumBadge,

  saveState: () => ({
    mode: selectedMode(),
    runChecks: $('runChecks').checked,
    removeExtras: $('removeExtras').checked,
    submitAfter: $('submitAfter').checked
  }),
  loadState(s) {
    modeTouched = false;
    $('runChecks').checked = s.runChecks !== false;
    $('removeExtras').checked = s.removeExtras !== false;
    $('submitAfter').checked = s.submitAfter !== false;
    setMode(s.mode || null);
    $('modeHint').textContent = '';
  }
};
