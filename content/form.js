/* Criteria Catcher - page side: the form engine.

   Rudder and Copperhead pages hold the same kind of form - a field wrapper per
   question, single choices on radios, multiple choices as boxes to tick, and
   text to write - and both are answered with the same clicks and keystrokes.
   That is all here; each project says how its own fields are found and what
   their parts look like, and hands that to applyForm.

   Needs core.js. */

/* ---------- the fields ---------- */

function formKey(fieldEl) {
  return (fieldEl.getAttribute('data-testid') || '').replace(/^field-/, '') || null;
}

function formFields(root = document) {
  return Array.from(root.querySelectorAll(FIELD)).filter((f) => formKey(f));
}

// A rating scale keeps its real value in an input beside the button that is
// actually clicked: "5", "not_applicable", "A > B". That value is what the
// page stores, so it is what the answers are written in.
function radioOptions(fieldEl) {
  return Array.from(fieldEl.querySelectorAll('input[type="radio"]')).filter((input) => input.closest(FIELD) === fieldEl).map((input) => {
    const label = input.closest('label');
    const btn = (label || input.parentElement)?.querySelector('button[role="radio"]') || null;
    return {
      value: input.value,
      text: oneLine(label?.innerText || label?.textContent || '') || input.value,
      checked: input.checked || btn?.getAttribute('aria-checked') === 'true',
      input,
      label,
      btn
    };
  });
}

// Flags have no inputs at all - each one is a div playing the part of a
// checkbox - so they are known by the words beside them.
function flagOptions(fieldEl) {
  return Array.from(fieldEl.querySelectorAll('[role="checkbox"]')).map((box) => ({
    text: oneLine(box.innerText || box.textContent || '')
      || textOfMarkup(box.getAttribute('aria-label')),
    checked: box.getAttribute('aria-checked') === 'true',
    box
  }));
}

// A field's own description: the first line is the question being asked, the
// rest is the project's guidance on how to answer it. That guidance runs to
// pages, so the two are kept apart and the reader chooses.
function describeField(fieldEl) {
  const desc = Array.from(fieldEl.querySelectorAll('[class*="_description_"]'))
    .find((d) => d.closest(FIELD) === fieldEl);
  const full = blockText(desc);
  if (!full) return { question: null, guidelines: null };
  const first = full.split('\n').map((l) => l.trim()).find(Boolean) || null;
  return { question: first, guidelines: full };
}

// Most fields carry a label; a bare flag list carries only its description
// ("Failure-mode flags (check all that apply):"), so fall back to that.
function formLabel(fieldEl) {
  const lab = fieldLabel(fieldEl);
  if (lab) return lab;
  const { question } = describeField(fieldEl);
  return question ? question.replace(/[:.]\s*$/, '') : formKey(fieldEl);
}

function sectionIntro(sec) {
  const desc = Array.from(sec.querySelectorAll('[class*="_description_"]'))
    .find((d) => !d.closest(FIELD));
  return blockText(desc) || null;
}

function isAnswered(answer) {
  if (Array.isArray(answer)) return answer.length > 0;
  return answer !== null && answer !== undefined && answer !== '';
}

/* ---------- writing the answers back ---------- */

// The same answer can be written several ways - the stored value ("5",
// "not_applicable"), the wording on screen, or just the part before the colon
// that a person would say out loud ("5", "N/A", "OK"). Yes and no are how the
// true/false flags are usually spoken, so they are read as each other.
const SAME_AS = new Map([
  ['yes', 'true'], ['true', 'yes'],
  ['no', 'false'], ['false', 'no'],
  ['n/a', 'not_applicable'], ['na', 'not_applicable'], ['not applicable', 'not_applicable']
]);

function optionHead(text) {
  return norm(String(text).split(/[:.]/)[0]);
}

function matchOption(options, value) {
  const want = norm(value);
  if (!want) return null;
  const tries = [want, SAME_AS.get(want)].filter(Boolean);

  // Strictest reading first: an exact stored value beats a loose prefix, so
  // "A > B" is never taken for "A >> B".
  for (const reading of [
    (o, w) => norm(o.value) === w,
    (o, w) => norm(o.text) === w,
    (o, w) => optionHead(o.text) === w,
    (o, w) => w.length >= 4 && norm(o.text).startsWith(w)
  ]) {
    for (const w of tries) {
      const hit = options.find((o) => reading(o, w));
      if (hit) return hit;
    }
  }
  return null;
}

// A flag is named by its wording. A shortened name is allowed as long as it
// is long enough to mean only one of them.
function sameFlag(wanted, optionText) {
  const a = norm(wanted);
  const b = norm(optionText);
  return a === b || (a.length >= 8 && b.startsWith(a));
}

function flagList(value) {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.map(String).filter((v) => v.trim());
  const one = String(value).trim();
  return one && !/^(none|no flags)$/i.test(one) ? [one] : [];
}

// A choice re-renders the moment it is made, so what the click did is read
// back off the page rather than off the node that was clicked.
async function setChoice(fieldEl, value, base) {
  const options = radioOptions(fieldEl);
  if (!options.length) return { ok: false, why: 'no options to choose from' };

  const pick = matchOption(options, value);
  if (!pick) return { ok: false, why: `no option matching "${oneLine(value)}"` };

  const chosen = () => radioOptions(fieldEl).some((o) => o.checked && o.value === pick.value);
  if (chosen()) return { ok: true, already: true };

  const target = pick.btn || pick.label;
  if (!target) return { ok: false, why: 'the option has nothing to click' };
  target.scrollIntoView({ block: 'center' });
  await wait(base * 6); // a beat to look at it before choosing, as a person would
  target.click();
  if (await until(chosen, { timeout: 2000 })) return { ok: true };

  // The label answers to a click as well; try that before giving up.
  pick.label?.click();
  return await until(chosen, { timeout: 1500 })
    ? { ok: true }
    : { ok: false, why: 'the page did not take the choice' };
}

// Ticking is stated in full: every flag named is put on and every other one
// is taken off, so the page ends up saying exactly what the answer says.
async function setFlags(fieldEl, value, base, options = flagOptions) {
  const wanted = flagList(value);
  const names = options(fieldEl).map((o) => o.text);
  if (!names.length) return { ok: false, why: 'no flags to tick' };

  const unknown = wanted.filter((w) => !names.some((n) => sameFlag(w, n)));
  let stuck = 0;

  for (const name of names) {
    checkCancelled();
    const on = wanted.some((w) => sameFlag(w, name));
    const now = options(fieldEl).find((o) => o.text === name);
    if (!now || now.checked === on) continue;

    now.box.scrollIntoView({ block: 'center' });
    await wait(base * 6);
    now.box.click();
    const settled = await until(
      () => options(fieldEl).find((o) => o.text === name)?.checked === on,
      { timeout: 1500 }
    );
    if (!settled) stuck++;
  }

  return {
    ok: !stuck,
    unknown,
    why: stuck ? `${stuck} flag${stuck === 1 ? '' : 's'} would not tick` : null
  };
}

// Answers are written as { "field key": answer }, which is the shape the
// caught template hands out. An { "answers": { … } } wrapper and a list of
// { key, answer } rows are both read as the same thing.
//
// What comes back is a list of [key, answer] pairs in the order given. A list
// of rows is kept as a list, not folded into an object: two questions can share
// a wording - Copperhead's "What gave this asset away…" is asked once to be
// written and once to be ticked - and an object would keep only the second.
function normalizeAnswers(input) {
  let data = input;
  if (typeof data === 'string') data = JSON.parse(data);
  if (data && !Array.isArray(data) && data.answers && typeof data.answers === 'object') data = data.answers;

  if (Array.isArray(data)) {
    const out = data
      .filter((row) => row && typeof row === 'object' && row.key)
      .map((row) => [String(row.key), row.answer ?? row.value ?? null]);
    if (!out.length) throw new Error('No answers found - each row needs a "key".');
    return out;
  }
  if (!data || typeof data !== 'object') {
    throw new Error('JSON must be an object of answers, keyed by field name.');
  }
  if (Array.isArray(data.criteria)) {
    throw new Error('That is a Geranium criteria list. Switch the project to Geranium to use it.');
  }
  return Object.entries(data);
}

// Rudder and Copperhead fill their forms the same way - a choice clicked and
// read back, flags ticked in full, text typed out - and differ only in how a
// field is found and what its parts look like, which `spec` says.
async function applyForm(input, options, spec) {
  if (busy) throw new Error('Already typing. Press Stop first.');

  // A key left empty is a question deliberately not being answered, so only
  // what the answer actually says is written to the page.
  const rows = normalizeAnswers(input)
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) throw new Error('No answers to write - every field was left empty.');
  if (!spec.isPage()) throw new Error(`This does not look like a ${spec.name} task page.`);

  const base = Math.max(0, Number(options.speed ?? 22));
  const paste = options.entry === 'paste'; // typing is the default here
  const gap = Math.max(0, Number(options.gap ?? 2000));
  hiddenDuringRun = false;
  busy = true;
  cancelled = false;
  stayAwake();
  progress = { index: 0, total: rows.length, phase: 'starting', unit: 'field' };

  const skippedFields = [];
  const truncated = [];
  const refused = [];
  const unknownFlags = [];
  let filled = 0;

  try {
    progress = { index: 0, total: rows.length, phase: 'opening', unit: 'field' };
    await expandEverything();

    for (let i = 0; i < rows.length; i++) {
      checkCancelled();
      const [key, value] = rows[i];
      progress = { index: i + 1, total: rows.length, phase: 'filling', unit: 'field' };
      if (document.hidden) hiddenDuringRun = true;

      // Answering one question can bring another into being - the correctness
      // flags exist only once the status says "flagged" - so a field that is
      // not there yet is given a moment to arrive.
      let fieldEl = await until(() => spec.find(key, value), { timeout: 1200, step: 100 });
      if (!fieldEl) {
        // It may sit in a section that has only just appeared, still shut.
        await expandEverything();
        fieldEl = await until(() => spec.find(key, value), { timeout: spec.patience, step: 150 });
      }
      if (!fieldEl) { skippedFields.push(key); continue; }

      const kind = spec.kind(fieldEl);
      if (kind === 'choice') {
        const r = await setChoice(fieldEl, value, base);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else if (kind === 'flags') {
        // A lone box answered true or false is ticked or not.
        const flags = typeof value === 'boolean'
          ? (value ? spec.flags(fieldEl).map((o) => o.text) : [])
          : value;
        const r = await setFlags(fieldEl, flags, base, spec.flags);
        if (r.unknown?.length) unknownFlags.push(`"${key}": ${r.unknown.join('; ')}`);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else if (kind === 'select') {
        const r = await setSelect(fieldEl, value, base);
        if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
      } else if (kind === 'file') {
        refused.push(`"${key}" - an upload, which is left to you`);
      } else {
        const ctl = spec.control(fieldEl);
        if (!ctl) { skippedFields.push(key); continue; }
        if (ctl.type === 'checkbox' || ctl instanceof HTMLSelectElement) {
          setDiscrete(ctl, value);
        } else {
          const r = paste
            ? await pasteInto(ctl, value, base)
            : await typeInto(ctl, value, base);
          if (r.truncated) truncated.push(`"${key}"`);
        }
        filled++;
      }

      await pause(gap); // settle before moving on to the next question
    }
  } finally {
    busy = false;
    progress = null;
    letSleep();
  }

  return {
    project: spec.project,
    requested: rows.length,
    filled,
    ranInBackground: hiddenDuringRun,
    skippedFields,
    truncated,
    refused,
    unknownFlags
  };
}
