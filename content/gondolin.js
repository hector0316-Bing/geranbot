/* Criteria Catcher - page side: Gondolin.

   A Gondolin task is a design datapoint: someone needs an Office template
   redesigned. The guide is on the left; the form on the right runs Metadata
   (Domain, Subdomain, Use Case, Change Type), the Prompt, three uploads
   (Starting Template, The Concept, Ending Template) and the Rubric - a
   repeatable list of 15 to 25 criteria, each a statement with a Rubric
   Category and an Importance from 1 (Minor) to 3 (Critical).

   Two things are its own. The Subdomain list is not fixed: the page shows
   only the subdomains of whichever Domain is chosen, so the Domain goes in
   first and the Subdomain is waited for. And the rubric has a size - fewer
   than 15 is said out loud, more than 25 is refused before anything is
   written.

   The uploads are left to the person, and Submit is never pressed.

   Needs core.js. */

/* ---------- what belongs to what ---------- */

// The page only ever shows one domain's subdomains, so the whole table is
// kept here: it is handed out with every catch, and an answer naming a
// subdomain from another domain is refused before the run starts.
const GD_SUBDOMAINS = {
  'Finance and Accounting': ['Corporate finance', 'Investment banking', 'Accounting and audit', 'Insurance', 'Personal finance'],
  'Consulting and Professional Services': ['Strategy consulting', 'Legal', 'Human resources', 'Real estate'],
  'Technology': ['Product management', 'Software engineering', 'Startups', 'Sales'],
  'Healthcare and Life Sciences': ['Clinical operations', 'Pharmaceuticals', 'Public health', 'Hospital administration'],
  'Education and Research': ['K-12 teaching', 'Higher education', 'Academic research', 'Corporate training'],
  'Marketing, Media, and Creative': ['Brand and advertising', 'Publishing', 'Fashion', 'Architecture and design', 'Events'],
  'Retail, Hospitality, and Consumer': ['E-commerce', 'Restaurants and food service', 'Travel', 'Consumer goods'],
  'Public Sector and Nonprofit': ['Government', 'Policy', 'Nonprofit fundraising', 'Community programs']
};

const GD_MIN_CRITERIA = 15;
const GD_MAX_CRITERIA = 25;
const GD_IMPORTANCE = ['Minor', 'Important', 'Critical']; // 1, 2, 3

// Wording reduced to its words: "Marketing, Media, and Creative", "marketing
// media & creative" and "marketing_media_creative" all come out the same.
function gdLoose(s) {
  return oneLine(s).toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function gdDomainOf(name) {
  const want = gdLoose(name);
  return Object.keys(GD_SUBDOMAINS).find((d) => gdLoose(d) === want) || null;
}

function gdDomainHolding(subdomain) {
  const want = gdLoose(subdomain);
  return Object.keys(GD_SUBDOMAINS)
    .find((d) => GD_SUBDOMAINS[d].some((s) => gdLoose(s) === want)) || null;
}

/* ---------- the page ---------- */

const GD_LIST = '[data-testid="repeatable-Rubric_Criteria" i]';
const GD_INSTANCE = '[data-testid^="repeatable-Rubric_Criteria-instance-" i]';
const GD_FEEDBACK = '[data-testid="field-gondolin_quality_feedback"]';
const GD_TIMER = '[data-testid="task-expiration-timer"]';

function isGondolinPage() {
  return !!document.querySelector(`${GD_LIST}, ${GD_INSTANCE}, ${GD_FEEDBACK}`)
    || (!!document.querySelector('[data-testid="field-sub-domains"]')
      && !!document.querySelector('[data-testid="field-change_type"]'));
}

function gondolinStage() {
  const h = headingText();
  if (/adjudicat/i.test(h)) return 'adjudication';
  if (/review/i.test(h)) return 'review';
  return 'submission';
}

function gdField(name, root = document) {
  return root.querySelector(`[data-testid="field-${name}"]`);
}

function gdInstances() {
  const n = (el) => Number((el.getAttribute('data-testid') || '').match(/-(\d+)$/)?.[1] || 0);
  return Array.from(document.querySelectorAll(GD_INSTANCE)).sort((a, b) => n(a) - n(b));
}

/* ---------- reading the controls ---------- */

// A choice is a radio button beside a hidden input holding the stored value
// ("healthcare_life_sciences__pharmaceuticals"), inside a label carrying the
// wording on screen.
function gdRadios(fieldEl) {
  if (!fieldEl) return [];
  return Array.from(fieldEl.querySelectorAll('button[role="radio"]')).map((btn) => {
    const label = btn.closest('label');
    return {
      value: btn.getAttribute('value') || label?.querySelector('input[type="radio"]')?.value || '',
      text: oneLine(label?.innerText || label?.textContent || '') || btn.getAttribute('value') || '',
      checked: btn.getAttribute('aria-checked') === 'true',
      btn,
      label
    };
  });
}

function gdBoxes(fieldEl) {
  if (!fieldEl) return [];
  return Array.from(fieldEl.querySelectorAll('[role="checkbox"]')).map((box) => ({
    text: oneLine(box.innerText || box.textContent || '') || textOfMarkup(box.getAttribute('aria-label')),
    checked: box.getAttribute('aria-checked') === 'true',
    box
  })).filter((o) => o.text);
}

function gdText(fieldEl) {
  const ta = fieldEl?.querySelector('textarea');
  return ta ? ta.value.trim() : '';
}

// Importance is three plain buttons reading 1 to 3, with no role and no input
// behind them: a chosen one loses the empty-cell colouring the rest keep. A
// scale that fills up to the chosen point reads the same way - the highest
// one lit is the answer.
function gdScale(fieldEl) {
  if (!fieldEl) return [];
  const btns = Array.from(fieldEl.querySelectorAll('button')).filter((b) => /^\d+$/.test(buttonText(b)));
  const empty = (b) => /empty-cell/.test(b.className || '');
  const marked = (b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true'
    || b.hasAttribute('data-selected') || b.hasAttribute('data-active') || b.hasAttribute('data-checked');
  const anyEmpty = btns.some(empty);
  return btns.map((b) => ({
    value: Number(buttonText(b)),
    lit: marked(b) || (anyEmpty && !empty(b)),
    btn: b
  }));
}

function gdImportance(fieldEl) {
  const lit = gdScale(fieldEl).filter((o) => o.lit).map((o) => o.value);
  return lit.length ? Math.max(...lit) : null;
}

function gdReadCriterion(inst) {
  const category = gdRadios(gdField('rubric_category', inst)).find((o) => o.checked);
  return {
    criterion: gdText(gdField('rubric_criterion', inst)),
    category: category ? category.text : null,
    importance: gdImportance(gdField('importance', inst))
  };
}

const gdWritten = (row) => !!(row.criterion || row.category || row.importance);

/* ---------- the guide, the uploads, the quality feedback ---------- */

// The left panel: "Task 54" under its heading, then the guide, a heading and
// a paragraph for each part of the work.
function gdReadGuide() {
  const out = [];
  for (const h of document.querySelectorAll(`${LEFT_PANEL} h3, ${LEFT_PANEL} h4`)) {
    const box = h.parentElement;
    const title = oneLine(h.textContent);
    if (!title || !box) continue;
    const text = Array.from(box.children)
      .filter((el) => el !== h)
      .map((el) => blockText(el))
      .filter(Boolean)
      .join('\n');
    out.push({ title, text: text || null });
  }
  return out;
}

const GD_UPLOADS = ['starting_template', 'concept', 'ending_template'];

function gdReadUploads() {
  return GD_UPLOADS.map((name) => {
    const fieldEl = gdField(name);
    if (!fieldEl) return null;
    const done = fieldEl.querySelector('[data-testid="s3-uploaded-file"]');
    const file = done ? blockText(done).split('\n').map((l) => l.trim()).find(Boolean) : null;
    return { key: name, label: fieldLabel(fieldEl), file: file || null };
  }).filter(Boolean);
}

function gdFeedbackButton() {
  const fieldEl = document.querySelector(GD_FEEDBACK);
  return fieldEl?.querySelector('[data-testid="feedback-check"]')
    || Array.from(fieldEl?.querySelectorAll('button') || []).find((b) => /^check\b/i.test(buttonText(b)))
    || null;
}

// What the quality check said. Its panels are read where it answers in
// pass/fail panels; otherwise whatever the field holds beyond its own label,
// description and buttons is taken as the answer.
function gdReadFeedback() {
  const fieldEl = document.querySelector(GD_FEEDBACK);
  if (!fieldEl) return null;

  const panels = Array.from(fieldEl.querySelectorAll(RESULT_PANEL))
    .filter((p) => !p.parentElement?.closest(RESULT_PANEL));
  if (panels.length) {
    return panels.map((p) => ({
      passed: /bg-success-subtle/.test(p.className || ''),
      text: blockText(p)
    })).filter((r) => r.text);
  }

  const copy = fieldEl.cloneNode(true);
  for (const el of copy.querySelectorAll('label, button, [class*="_description_"], svg')) el.remove();
  const text = (copy.textContent || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return text ? [{ passed: null, text }] : null;
}

// Pressed only where there is something to judge - a prompt and at least one
// criterion - and only when it has not answered already. The answer is known
// to have landed when the field holds text it did not hold before and has
// stopped changing.
async function gdRunFeedback({ timeout = 180000 } = {}) {
  const btn = gdFeedbackButton();
  if (!btn) return { skipped: 'no quality check on this page' };
  if (gdReadFeedback()) return { skipped: 'already answered' };
  if (!gdText(gdField('prompt'))) return { skipped: 'no prompt yet' };
  if (!gdInstances().some((inst) => gdReadCriterion(inst).criterion)) return { skipped: 'no criteria yet' };
  if (btn.disabled) return { skipped: 'the button is disabled' };

  btn.scrollIntoView({ block: 'center' });
  btn.click();
  checkProgress = { phase: 'checks', index: 0, total: 1 };
  try {
    const deadline = Date.now() + timeout;
    let last = null;
    let steady = 0;
    while (Date.now() < deadline) {
      checkCancelled();
      await wait(500);
      const now = JSON.stringify(gdReadFeedback());
      const working = gdFeedbackButton()?.disabled;
      steady = now !== 'null' && now === last && !working ? steady + 1 : 0;
      last = now;
      if (steady >= 3) return { ran: true };
    }
    return { ran: true, waiting: true };
  } finally {
    checkProgress = null;
  }
}

async function gdReadNotes() {
  const seen = new Set();
  const out = [];
  for (const n of [...readSidebarNotes(), ...await readNotes()]) {
    const k = `${n.title}|${n.time || ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    delete n.latest;
    out.push(n);
  }
  markLatest(out);
  return out;
}

/* ---------- catching ---------- */

async function readGondolin(options = {}) {
  await openNotes();
  const opened = await expandEverything();

  let feedbackRun = { skipped: 'turned off' };
  if (options.runChecks !== false) {
    feedbackRun = await gdRunFeedback();
    if (feedbackRun.ran) await expandEverything();
  }

  const domains = gdRadios(gdField('domain'));
  const subdomains = gdRadios(gdField('sub-domains'));
  const changeTypes = gdBoxes(gdField('change_type'));
  const instances = gdInstances();
  const criteria = instances.map(gdReadCriterion);
  const written = criteria.filter(gdWritten);

  if (!domains.length && !instances.length && !gdField('prompt')) {
    throw new Error('Nothing found on this page - no metadata, prompt or rubric. Is this a Gondolin task?');
  }

  const domain = domains.find((o) => o.checked)?.text || null;
  const subdomain = subdomains.find((o) => o.checked)?.text || null;
  const answers = {
    domain,
    subdomain,
    use_case: gdText(gdField('use_case')) || null,
    change_type: changeTypes.filter((o) => o.checked).map((o) => o.text),
    prompt: gdText(gdField('prompt')) || null,
    // A fresh page opens with one empty criterion; that is a blank, not a row.
    criteria: written.length ? criteria : []
  };

  const guide = gdReadGuide();
  const task = guide.find((g) => /^task$/i.test(g.title))?.text || null;
  const notes = await gdReadNotes();
  const feedback = gdReadFeedback();
  const stage = gondolinStage();
  const uid = readUid();
  const lastSaved = (document.body.innerText || '').match(/last saved at\s*([^\n]+)/i)?.[1].trim() || null;
  const timeLeft = oneLine(document.querySelector(GD_TIMER)?.textContent) || null;
  const categories = gdRadios(gdField('rubric_category', instances[0] || document)).map((o) => o.text);

  const content = { title: headingText() || null, stage };
  if (task) content.task = task;
  if (timeLeft) content.timeLeft = timeLeft;
  if (lastSaved) content.lastSaved = lastSaved;
  if (notes.length) {
    content.taskNotes = notes;
    const latest = notes.find((n) => n.latest);
    if (latest) content.latestNote = { title: latest.title, time: latest.time || null };
  }
  content.guide = guide.filter((g) => !/^task$/i.test(g.title));
  content.metadata = {
    domain,
    subdomain,
    useCase: answers.use_case,
    changeType: answers.change_type
  };
  content.prompt = answers.prompt;
  content.uploads = gdReadUploads();
  content.criteria = written.length ? criteria.map((c, i) => ({ n: i + 1, ...c })) : [];
  if (feedback) content.qualityFeedback = feedback;
  if (feedbackRun.waiting) content.pendingChecks = ['Quality feedback'];
  // Everything an answer may be chosen from, so nothing has to be looked up
  // on the page - least of all the subdomains it is not showing.
  content.options = {
    domains: domains.length ? domains.map((o) => o.text) : Object.keys(GD_SUBDOMAINS),
    subdomainsByDomain: GD_SUBDOMAINS,
    subdomainsShown: subdomains.map((o) => o.text),
    changeTypes: changeTypes.map((o) => o.text),
    categories,
    importance: GD_IMPORTANCE.map((text, i) => ({ value: i + 1, text })),
    criteriaCount: { min: GD_MIN_CRITERIA, max: GD_MAX_CRITERIA }
  };

  const data = { project: 'gondolin', stage };
  if (uid) data.uid = uid;
  if (task) data.task = task;
  data.content = content;
  data.answers = answers;

  return {
    data,
    meta: {
      project: 'gondolin',
      opened,
      sections: instances.length,
      criteria: written.length,
      notes: notes.length,
      feedback: feedbackRun
    }
  };
}

/* ---------- reading the answers ---------- */

const GD_KEYS = new Map([
  ['domain', 'domain'],
  ['subdomain', 'subdomain'], ['subdomains', 'subdomain'],
  ['usecase', 'use_case'],
  ['changetype', 'change_type'], ['changetypes', 'change_type'],
  ['prompt', 'prompt'], ['writeyourprompt', 'prompt'],
  ['criteria', 'criteria'], ['rubric', 'criteria'], ['rubriccriteria', 'criteria']
]);

const GD_ROW_KEYS = new Map([
  ['criterion', 'criterion'], ['rubriccriterion', 'criterion'], ['text', 'criterion'], ['statement', 'criterion'],
  ['category', 'category'], ['rubriccategory', 'category'],
  ['importance', 'importance'], ['weight', 'importance']
]);

const gdKeyName = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
// An empty list counts as nothing given: the blank template a fresh catch
// hands out must be safe to send straight back, not an order to untick every
// change type and delete the rubric.
const gdGiven = (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);

// A row is { "criterion", "category", "importance" }, or the bare statement.
// As on Geranium the criterion's number may stand as its key: { "1": "…" }.
function gdNormalizeRow(r, i) {
  if (typeof r === 'string') return { criterion: r };
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    throw new Error(`Criterion ${i + 1} must be an object or a string.`);
  }
  const out = {};
  for (const [key, value] of Object.entries(r)) {
    if (!gdGiven(value)) continue;
    const name = /^\d+$/.test(key) ? 'criterion' : GD_ROW_KEYS.get(gdKeyName(key));
    if (name) out[name] = value;
  }
  return out;
}

// { domain, subdomain, use_case, change_type, prompt, criteria: [ … ] }, with
// or without an "answers" wrapper; a bare list is the criteria on their own.
// Anything left out, empty or null is left alone on the page.
function gdNormalize(input) {
  let data = input;
  if (typeof data === 'string') data = JSON.parse(data);
  if (data && !Array.isArray(data) && data.answers && typeof data.answers === 'object') data = data.answers;
  if (Array.isArray(data)) data = { criteria: data };
  if (!data || typeof data !== 'object') {
    throw new Error('JSON must be an object of answers, or a list of criteria.');
  }

  const out = {};
  const unknownKeys = [];
  for (const [key, value] of Object.entries(data)) {
    const name = GD_KEYS.get(gdKeyName(key));
    if (!name) { unknownKeys.push(key); continue; }
    if (gdGiven(value)) out[name] = value;
  }
  if (out.criteria !== undefined) {
    if (!Array.isArray(out.criteria)) throw new Error('"criteria" must be a list.');
    out.criteria = out.criteria.map(gdNormalizeRow);
  }
  if (out.change_type !== undefined && !Array.isArray(out.change_type)) {
    out.change_type = String(out.change_type).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }
  return { answers: out, unknownKeys };
}

// Everything that can be known to be wrong before a key is pressed.
function gdValidate(a) {
  if (a.criteria && a.criteria.length > GD_MAX_CRITERIA) {
    throw new Error(`${a.criteria.length} criteria given - the rubric takes ${GD_MIN_CRITERIA} to ${GD_MAX_CRITERIA}.`);
  }

  if (a.domain && !gdDomainOf(a.domain)) {
    throw new Error(`No domain called "${oneLine(a.domain)}". The domains are: ${Object.keys(GD_SUBDOMAINS).join('; ')}.`);
  }
  if (a.subdomain) {
    const holder = gdDomainHolding(a.subdomain);
    if (!holder) throw new Error(`No subdomain called "${oneLine(a.subdomain)}" under any domain.`);
    const domain = a.domain ? gdDomainOf(a.domain) : null;
    if (domain && !GD_SUBDOMAINS[domain].some((s) => gdLoose(s) === gdLoose(a.subdomain))) {
      throw new Error(`"${oneLine(a.subdomain)}" is a subdomain of ${holder}, not of ${domain}. `
        + `${domain} has: ${GD_SUBDOMAINS[domain].join(', ')}.`);
    }
  }

  (a.criteria || []).forEach((row, i) => {
    if (row.importance !== undefined && !gdImportanceValue(row.importance)) {
      throw new Error(`Criterion ${i + 1}: importance "${oneLine(row.importance)}" is not 1 (Minor), 2 (Important) or 3 (Critical).`);
    }
  });
}

// 1 to 3, or the word for it.
function gdImportanceValue(value) {
  const word = GD_IMPORTANCE.findIndex((w) => w.toLowerCase() === gdLoose(value));
  if (word >= 0) return word + 1;
  const n = Number(String(value).trim().match(/^\d+/)?.[0]);
  return n >= 1 && n <= GD_IMPORTANCE.length ? n : null;
}

/* ---------- writing one control ---------- */

function gdMatchRadio(options, value) {
  const want = gdLoose(value);
  if (!want) return null;
  return options.find((o) => gdLoose(o.text) === want)
    || options.find((o) => gdLoose(o.value) === want)
    // The stored subdomain is "domain__subdomain"; its tail names it too.
    || options.find((o) => gdLoose(String(o.value).split('__').pop()) === want)
    || (want.length >= 4 ? options.find((o) => gdLoose(o.text).startsWith(want)) : null)
    || null;
}

// A choice re-renders the moment it is made, so what the click did is read
// back off the page rather than off the node that was clicked.
async function gdSetChoice(find, value, base) {
  const options = gdRadios(find());
  if (!options.length) return { ok: false, why: 'no options to choose from' };
  const pick = gdMatchRadio(options, value);
  if (!pick) {
    return { ok: false, why: `no option matching "${oneLine(value)}" (it offers: ${options.map((o) => o.text).join(', ')})` };
  }

  const chosen = () => gdRadios(find()).some((o) => o.checked && o.value === pick.value);
  if (chosen()) return { ok: true, already: true };

  pick.btn.scrollIntoView({ block: 'center' });
  await wait(base * 6); // a beat to look at it before choosing, as a person would
  pick.btn.click();
  if (await until(chosen, { timeout: 2000 })) return { ok: true };

  // The label answers to a click as well; try that before giving up.
  pick.label?.click();
  return await until(chosen, { timeout: 1500 })
    ? { ok: true }
    : { ok: false, why: 'the page did not take the choice' };
}

// Ticking is stated in full: every change type named is put on and every
// other one is taken off, so the page ends up saying what the answer says.
async function gdSetBoxes(fieldEl, wanted, base) {
  const names = gdBoxes(fieldEl).map((o) => o.text);
  if (!names.length) return { ok: false, why: 'no boxes to tick' };
  const same = (w, n) => gdLoose(w) === gdLoose(n);
  const unknown = wanted.filter((w) => !names.some((n) => same(w, n)));
  let stuck = 0;

  for (const name of names) {
    checkCancelled();
    const on = wanted.some((w) => same(w, name));
    const now = gdBoxes(fieldEl).find((o) => o.text === name);
    if (!now || now.checked === on) continue;
    now.box.scrollIntoView({ block: 'center' });
    await wait(base * 6);
    now.box.click();
    const settled = await until(() => gdBoxes(fieldEl).find((o) => o.text === name)?.checked === on, { timeout: 1500 });
    if (!settled) stuck++;
  }
  return { ok: !stuck, unknown, why: stuck ? `${stuck} box${stuck === 1 ? '' : 'es'} would not tick` : null };
}

async function gdSetImportance(fieldEl, value, base) {
  const n = gdImportanceValue(value);
  const pick = gdScale(fieldEl).find((o) => o.value === n);
  if (!pick) return { ok: false, why: 'no such point on the scale' };
  if (gdImportance(fieldEl) === n) return { ok: true, already: true };
  if (pick.btn.disabled) return { ok: false, why: 'the scale is locked' };

  pick.btn.scrollIntoView({ block: 'center' });
  await wait(base * 6);
  pick.btn.click();
  if (await until(() => gdImportance(fieldEl) === n, { timeout: 2000 })) return { ok: true };
  return { ok: false, why: 'the scale does not show the choice was taken' };
}

async function gdWrite(fieldEl, value, base, paste) {
  const ctl = fieldEl?.querySelector('textarea');
  if (!ctl) return null;
  return paste ? pasteInto(ctl, value, base) : typeInto(ctl, value, base);
}

/* ---------- the rubric list: opening, adding, deleting ---------- */

function gdTrigger(inst) {
  return inst.querySelector('h3 button[aria-expanded], button[aria-expanded]');
}

async function gdOpen(inst) {
  const t = gdTrigger(inst);
  if (!t || t.getAttribute('aria-expanded') !== 'false') return;
  t.click();
  await until(() => gdField('rubric_criterion', inst), { timeout: 2000 });
  await wait(settleMs);
}

// "Add item", under the list. Looked for outwards from the list so a button
// elsewhere on the form is never taken for it.
function gdAddButton() {
  let scope = document.querySelector(GD_LIST) || gdInstances()[0]?.parentElement;
  for (let hop = 0; hop < 5 && scope; hop++) {
    const found = Array.from(scope.querySelectorAll('button'))
      .find((b) => !b.disabled && !b.closest(GD_INSTANCE) && /^\+?\s*add\b/i.test(buttonText(b)));
    if (found) return found;
    scope = scope.parentElement;
  }
  return null;
}

async function gdAddCriterion() {
  const before = gdInstances().length;
  if (before >= GD_MAX_CRITERIA) throw new Error(`The rubric already holds ${before} criteria, and ${GD_MAX_CRITERIA} is the most it takes.`);
  const btn = gdAddButton();
  if (!btn) throw new Error(`The page has ${before} criteria and more are needed, but no "Add item" button was found.`);
  btn.scrollIntoView({ block: 'center' });
  await wait(settleMs);
  btn.click();
  if (!await until(() => gdInstances().length > before)) {
    throw new Error(`Clicked "${buttonText(btn)}" but no new criterion appeared.`);
  }
  await wait(settleMs);
}

async function gdRemoveExtras(target) {
  let current = gdInstances().length;
  while (current > target) {
    checkCancelled();
    const last = gdInstances()[current - 1];
    const del = Array.from(last.querySelectorAll('button'))
      .find((b) => !b.disabled && /\b(delete|remove)\b/i.test(buttonText(b)));
    if (!del) break; // no delete control: leave the spares rather than fail
    del.scrollIntoView({ block: 'center' });
    del.click();
    await wait(settleMs);
    await confirmIfAsked();
    if (!await until(() => gdInstances().length < current)) break;
    current = gdInstances().length;
    await wait(settleMs);
  }
  return current;
}

/* ---------- writing the answers back ---------- */

// The Domain goes first, then the Subdomain once the page has swapped in that
// domain's list, then Use Case, Change Type and the Prompt, then the rubric,
// one criterion at a time: statement, category, importance. The uploads are
// left alone and Submit is never pressed.
async function applyGondolin(input, options = {}) {
  if (busy) throw new Error('Already typing. Press Stop first.');

  const { answers: a, unknownKeys } = gdNormalize(input);
  if (!Object.keys(a).length) throw new Error('No answers to write - nothing in the JSON is a Gondolin field.');
  if (!isGondolinPage()) throw new Error('This does not look like a Gondolin task page.');
  gdValidate(a);

  // A subdomain on its own still needs its domain chosen, unless the page
  // already has the right one.
  if (a.subdomain && !a.domain) a.domain = gdDomainHolding(a.subdomain);

  const base = Math.max(0, Number(options.speed ?? 200));
  const paste = options.entry === 'paste'; // typing is the default here
  const gap = Math.max(0, Number(options.gap ?? 2000));
  const rows = a.criteria || null;
  const steps = ['domain', 'subdomain', 'use_case', 'change_type', 'prompt'].filter((k) => a[k] !== undefined);
  const total = steps.length + (rows ? rows.length : 0);

  hiddenDuringRun = false;
  settleMs = settleFor(gap);
  busy = true;
  cancelled = false;
  stayAwake();
  progress = { index: 0, total, phase: 'opening', unit: 'answer' };

  const refused = [];
  const skippedFields = [];
  const truncated = [];
  const unknownFlags = [];
  const warnings = [];
  let filled = 0;
  let added = 0;
  let extrasLeft = 0;
  let done = 0;

  const took = (name, r) => { if (r.ok) filled++; else refused.push(`${name} - ${r.why}`); };
  const wrote = (name, r) => {
    if (!r) return skippedFields.push(name);
    if (r.truncated) truncated.push(name);
    filled++;
  };

  try {
    await expandEverything();

    for (const key of steps) {
      checkCancelled();
      progress = { index: ++done, total, phase: 'filling', unit: 'answer' };
      if (document.hidden) hiddenDuringRun = true;

      if (key === 'domain') {
        took('"domain"', await gdSetChoice(() => gdField('domain'), a.domain, base));
      } else if (key === 'subdomain') {
        // The list under Subdomains is the chosen domain's, and it is swapped
        // in a moment after the domain is - so wait for the one wanted.
        const there = await until(
          () => gdMatchRadio(gdRadios(gdField('sub-domains')), a.subdomain),
          { timeout: 5000, step: 100 }
        );
        took('"subdomain"', there
          ? await gdSetChoice(() => gdField('sub-domains'), a.subdomain, base)
          : { ok: false, why: `the page is not offering "${oneLine(a.subdomain)}" - is the Domain set to ${gdDomainHolding(a.subdomain)}?` });
      } else if (key === 'change_type') {
        if (a.change_type.length < 2) warnings.push('The task asks for at least two change types.');
        const r = await gdSetBoxes(gdField('change_type'), a.change_type, base);
        if (r.unknown?.length) unknownFlags.push(`"change_type": ${r.unknown.join('; ')}`);
        took('"change_type"', r);
      } else {
        wrote(`"${key}"`, await gdWrite(gdField(key), a[key], base, paste));
      }
      await pause(gap);
    }

    if (rows) {
      if (rows.length < GD_MIN_CRITERIA) {
        warnings.push(`${rows.length} criteria written - the rubric asks for ${GD_MIN_CRITERIA} to ${GD_MAX_CRITERIA}.`);
      }
      if (options.matchCount !== false) {
        progress = { index: done, total, phase: 'tidying', unit: 'answer' };
        // The page keeps at least one criterion, so an empty list clears to one.
        const left = await gdRemoveExtras(Math.max(rows.length, 1));
        extrasLeft = Math.max(0, left - Math.max(rows.length, 1));
      }

      for (let i = 0; i < rows.length; i++) {
        checkCancelled();
        progress = { index: ++done, total, phase: 'typing', unit: 'answer', text: `Criterion ${i + 1} of ${rows.length}…` };
        if (document.hidden) hiddenDuringRun = true;

        if (i >= gdInstances().length) {
          await gdAddCriterion();
          added++;
        }
        const inst = gdInstances()[i];
        if (!inst) throw new Error(`Criterion ${i + 1} did not appear.`);
        await gdOpen(inst);

        const row = rows[i];
        const at = `#${i + 1}`;
        let ok = true;
        if (row.criterion !== undefined) {
          const r = await gdWrite(gdField('rubric_criterion', inst), row.criterion, base, paste);
          if (!r) { skippedFields.push(`${at} "criterion"`); ok = false; }
          else if (r.truncated) truncated.push(`${at} "criterion"`);
          await pause(gap);
        }
        if (row.category !== undefined) {
          const r = await gdSetChoice(() => gdField('rubric_category', gdInstances()[i]), row.category, base);
          if (!r.ok) { refused.push(`${at} "category" - ${r.why}`); ok = false; }
          await pause(gap);
        }
        if (row.importance !== undefined) {
          const r = await gdSetImportance(gdField('importance', gdInstances()[i]), row.importance, base);
          if (!r.ok) { refused.push(`${at} "importance" - ${r.why}`); ok = false; }
          await pause(gap);
        }
        if (ok) filled++;
      }
    }
  } finally {
    busy = false;
    progress = null;
    settleMs = SETTLE;
    letSleep();
  }

  return {
    project: 'gondolin',
    requested: total,
    filled,
    criteria: rows ? rows.length : null,
    added,
    sectionsOnPage: gdInstances().length,
    extrasLeft,
    ranInBackground: hiddenDuringRun,
    skippedFields,
    truncated,
    refused,
    unknownFlags,
    unknownKeys,
    warnings,
    uploadsMissing: gdReadUploads().filter((u) => !u.file).map((u) => u.label)
  };
}

/* ---------- registration ---------- */

PAGE_PROJECTS.gondolin = {
  detect: () => (isGondolinPage() ? 'its rubric criteria list' : null),
  read: readGondolin,
  apply: applyGondolin,
  ping: () => ({
    gondolin: isGondolinPage()
      ? { stage: gondolinStage(), criteria: gdInstances().map(gdReadCriterion).filter(gdWritten).length, sections: gdInstances().length }
      : null
  })
};
