/* Criteria Catcher - side panel, shared by every project.

   The panel's scripts load in the order panel.html lists them - this file,
   then one per project, then main.js - into one page, sharing one global
   scope. Each project file registers itself in PROJECTS with what it shows
   and says; main.js runs the panel and asks the chosen project for those.

   What a project can register:

     name, catch, toInput, copied, placeholder   wording on the panel
     readOnly                                    nothing to type back in
     entry                                       Entry setting it starts with
     render(data)                                the Content block
     answers(data)                               the Answers box, if it has one
     toInputText(data)                           what Send to input writes
     catchOptions() / applyOptions()             extra options for the page
     catchStatus(data, meta)  -> { msg, kind }   the line after a catch
     applyStatus(result)      -> { msg, clean }  the line after a fill
     badge(res)                                  the badge beside the title
     saveState() / loadState(saved)              its own settings, per tab

   Nothing here may call into main.js while loading: main.js loads last, so
   its functions exist only once the panel is running. Event handlers that
   need them wrap the call - () => save() - rather than passing it. */

const $ = (id) => document.getElementById(id);

const PROJECTS = {};

// Local time, stamped when the catch happened rather than when it is redrawn,
// so a restored session still shows when it was taken.
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// The answers as the page holds them: the keys it asks for, in the order it
// asks for them, with whatever is already filled in. Edit and send back.
function answersJson(answers) {
  return JSON.stringify({ answers: answers || {} }, null, 2);
}

function noteBody(n) {
  const asks = (n.asks || []).map((a) => `[${a.answer ? 'x' : ' '}] ${a.question}`).join('\n');
  return [n.text, asks].filter(Boolean).join('\n\n');
}

/* ---------- one question of a form ----------
   Rudder and Copperhead both show their form question by question: the key,
   the wording, the options, and whatever is answered now. */

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

// After a Rudder or Copperhead fill: how many were answered, and anything the
// page would not take.
function formApplyStatus(result) {
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
