/* Criteria Catcher - page side: Telemanus.

   A Telemanus task is a video and five multiple-choice questions written
   about it. The Assets sidebar on the left carries the Task Type and an
   AI-generated idea for each question; the form on the right runs Group Type,
   then for each question the video again and a group of fields - Question
   Taxonomy (a Level, then the heads under it), the question, eight choices A
   to H, the correct letter and its text, "Check the model" (type "check" and
   press the arrow), whether the AI proposal was used, and a Difficulty check
   - then Group Design and the time spent.

   The form is the newer "form-block" layout: every field is a block carrying
   a data-block-id and its title in a heading, with no field-* testids to go
   by, so a block is found by what its heading says.

   Three things are its own. The catch can leave the form out and take only
   the task - the video link and the assets. The "Did you use the AI-generated
   proposal" question is never caught and never asked for: a fill answers it
   "No" itself, in its place in the order. And a question is finished by
   pressing its "Check feedback" button - only once its model check has run
   all five times, since feedback pressed sooner is about something else -
   and what the five came back with, passed or failed, goes out with the fill.
   The model check and Check feedback are switched on and off separately.

   Submit is never pressed.

   Needs core.js. */

/* ---------- the page ---------- */

const TM_BLOCK = '[data-block-id]';
const TM_GROUP = '[data-testid="form-block-group"]';
const TM_VIDEO = 'video[data-testid="video-hls-player"], video';
const TM_ASSETS = '[data-testid="static-assets-section"]';
const TM_CHECK = '[data-testid="feedback-check"]';
const TM_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function isTelemanusPage() {
  if (!document.querySelector('[data-testid="form-block"]')) return false;
  return !!document.querySelector('[data-testid="video-hls-player"]')
    || tmQuestionGroups().length > 0;
}

// What a block is headed: the first heading in it, or - where a block has
// none, as the repeated video has - nothing.
function tmTitle(root) {
  return oneLine(root?.querySelector('h1, h2, h3')?.textContent);
}

function tmNumber(block) {
  return oneLine(block.querySelector('[data-testid="block-field-header"] span')?.textContent) || null;
}

// The outer wrapper holds the page's own word on whether a block is answered.
function tmAnswered(block) {
  return block?.closest('[data-testid="form-block"]')?.getAttribute('data-answered') === 'true';
}

// "Question 1" … "Question 5": a group each, headed by its number.
function tmQuestionGroups() {
  const out = [];
  for (const el of document.querySelectorAll(TM_GROUP)) {
    const head = oneLine(el.querySelector('[data-testid="form-block-group-header"]')?.textContent);
    const n = Number(head.match(/question\s+(\d+)\s*$/i)?.[1]);
    if (n) out.push({ n, el });
  }
  return out.sort((a, b) => a.n - b.n);
}

// What each block of a question is, from its heading.
function tmKind(title) {
  const t = oneLine(title);
  if (/^question taxonomy/i.test(t)) return 'taxonomy';
  if (/^write your question/i.test(t)) return 'question';
  const letter = t.match(/^([A-H])\.?$/i);
  if (letter) return letter[1].toUpperCase();
  if (/^correct answer letter/i.test(t)) return 'correct_letter';
  if (/^correct answer text/i.test(t)) return 'correct_text';
  if (/^check the model/i.test(t)) return 'model';
  if (/ai-?generated proposal/i.test(t)) return 'proposal';
  if (/difficulty$/i.test(t)) return 'difficulty';
  return null;
}

// A question's blocks, in the order the page asks them.
function tmQuestionBlocks(groupEl) {
  return Array.from(groupEl.querySelectorAll(TM_BLOCK))
    .map((el) => ({ el, kind: tmKind(tmTitle(el)) }))
    .filter((b) => b.kind);
}

// A block outside the question groups, by its heading.
function tmTopBlock(re) {
  return Array.from(document.querySelectorAll(TM_BLOCK))
    .find((b) => !b.closest(TM_GROUP) && re.test(tmTitle(b))) || null;
}

const TM_TOP = {
  group_type: /^group type/i,
  group_structure: /^group structure/i,
  reasoning_steps: /^reasoning steps/i,
  time_spent: /^record your time spent/i
};

/* ---------- reading the controls ---------- */

function tmRadios(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll('button[role="radio"]')).map((btn) => {
    const id = btn.getAttribute('id');
    const label = (id && root.querySelector(`label[for="${CSS.escape(id)}"]`))
      || btn.parentElement?.querySelector('label');
    return {
      value: btn.getAttribute('value') || '',
      text: oneLine(label?.textContent) || btn.getAttribute('value') || '',
      checked: btn.getAttribute('aria-checked') === 'true' || btn.hasAttribute('data-checked'),
      group: btn.closest('[role="radiogroup"]'),
      btn,
      label
    };
  });
}

// The taxonomy is a Level and then the heads under it; each is a radio group
// or, where the page uses one, a dropdown. Read in the order they stand.
function tmCombos(root) {
  return Array.from(root?.querySelectorAll('button[role="combobox"]') || []);
}

function tmComboValue(combo) {
  const t = oneLine(combo.textContent);
  return !t || /^select\b/i.test(t) ? null : t;
}

function tmReadTaxonomy(block) {
  const picks = [];
  const groups = new Set();
  for (const el of block.querySelectorAll('[role="radiogroup"], button[role="combobox"]')) {
    if (el.getAttribute('role') === 'combobox') {
      const v = tmComboValue(el);
      if (v) picks.push(v);
      continue;
    }
    if (groups.has(el)) continue;
    groups.add(el);
    const chosen = tmRadios(el).find((o) => o.checked);
    if (chosen) picks.push(chosen.text);
  }
  return picks;
}

function tmControl(block) {
  return block?.querySelector('textarea, input[type="number"], input[type="text"], input:not([type])') || null;
}

function tmValue(block) {
  const ctl = tmControl(block);
  if (!ctl) return null;
  const v = (ctl.value || '').trim();
  if (!v) return null;
  return ctl.type === 'number' ? Number(v) : v;
}

// Whatever a block says beyond its own heading, description and controls:
// the answer a check came back with, or the page's reason for not running it.
// Only the first heading is the block's own - an answer may well have
// headings in it - and the description shares that heading's wrapper.
function tmResult(block) {
  if (!block) return null;
  const copy = block.cloneNode(true);
  copy.querySelector('[data-testid="block-field-header"]')?.remove();
  const title = copy.querySelector('h1, h2, h3');
  (title?.parentElement && title.parentElement !== copy ? title.parentElement : title)?.remove();
  return tmLinesOf(copy) || null;
}

// The text of a copy with its controls taken out, a line per piece.
function tmLinesOf(copy) {
  for (const el of copy.querySelectorAll('label, textarea, input, button, svg, [data-testid="prompting-attachments"]')) {
    el.remove();
  }
  const lines = [];
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const t = oneLine(node.nodeValue);
    if (t) lines.push(t);
  }
  return lines.join('\n');
}

const TM_BLOCKED = /^complete required fields first:?\s*/i;

// A check block: what it answered, or what it is still waiting on.
function tmReadCheck(block) {
  const text = tmResult(block);
  if (!text) return null;
  if (TM_BLOCKED.test(text)) {
    // The AI proposal question is a fill's to answer, so it is not listed
    // among what the person still owes.
    const waitingOn = text.replace(TM_BLOCKED, '')
      .replace(/,?\s*did you use the ai-?generated proposal[^?]*\?/i, '')
      .replace(/^,\s*/, '');
    return waitingOn ? { waitingOn } : null;
  }
  const said = tmReadFeedback(block);
  return said && said.passed !== null ? { result: said.text, passed: said.passed } : { result: text };
}

/* ---------- the video ---------- */

// The player is HLS. Where the browser plays it natively the <video> holds
// the signed master.m3u8 itself; where hls.js is feeding it the src is a
// blob: that names nothing, and the playlist is found among the page's own
// requests instead.
function tmPlaylistRequested() {
  try {
    const names = performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /\.m3u8(\?|$)/i.test(n));
    return names.find((n) => /master\.m3u8/i.test(n)) || names[0] || null;
  } catch {
    return null;
  }
}

function tmClock(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const m = Math.floor(ms / 60000);
  return `${p(m)}:${p(Math.floor((ms % 60000) / 1000))}.${p(Math.round(ms % 1000), 3)}`;
}

// The same video is repeated above every question, so the links are told
// apart and a task normally comes out with one.
function tmReadVideos() {
  const seen = new Set();
  const out = [];
  for (const v of document.querySelectorAll(TM_VIDEO)) {
    let url = v.currentSrc || v.src || v.getAttribute('src')
      || v.querySelector('source')?.src || '';
    if (!url || /^blob:/i.test(url)) url = tmPlaylistRequested() || '';
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const state = v.parentElement?.querySelector('[data-testid="video-port-state"]');
    const ms = Number(state?.getAttribute('data-duration'))
      || (Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0);
    const video = { url };
    const duration = tmClock(ms);
    if (duration) video.duration = duration;
    out.push(video);
  }
  return out;
}

/* ---------- the assets ---------- */

// The sidebar can be folded shut, and a folded section shows nothing.
async function tmOpenAssets() {
  let opened = 0;
  const toggles = document.querySelectorAll(
    '[data-testid^="form-blocks-sidebar-section"] button[aria-expanded="false"]:not([aria-haspopup])'
  );
  for (const btn of toggles) {
    btn.click();
    opened++;
    await wait(settleMs);
  }
  return opened;
}

// Each asset is a heading over either a value or a list of "key:" / value
// pairs - the ideas are the second kind.
function tmReadAssets() {
  const out = [];
  for (const h of document.querySelectorAll(`${TM_ASSETS} h4`)) {
    const title = oneLine(h.textContent);
    const body = h.nextElementSibling;
    if (!title) continue;

    const fields = {};
    let pairs = 0;
    for (const key of body ? body.querySelectorAll('[class*="text-color-secondary"]') : []) {
      const name = oneLine(key.textContent);
      if (!/:$/.test(name)) continue;
      pairs++;
      fields[name.replace(/:$/, '')] = blockText(key.nextElementSibling) || null;
    }
    out.push(pairs ? { title, fields } : { title, text: blockText(body) || null });
  }
  return out;
}

/* ---------- catching ---------- */

function tmReadQuestion({ n, el }) {
  const q = { n };
  const answers = { taxonomy: [], question: null };
  for (const letter of TM_LETTERS) answers[letter] = null;
  answers.correct_letter = null;
  answers.correct_text = null;

  for (const b of tmQuestionBlocks(el)) {
    // Whether the AI proposal was used is never caught: a fill answers it.
    if (b.kind === 'proposal') continue;
    if (b.kind === 'taxonomy') answers.taxonomy = tmReadTaxonomy(b.el);
    else if (b.kind === 'model') {
      q.modelChecked = tmAnswered(b.el);
      const said = tmResult(b.el);
      if (said) q.modelCheck = said;
    } else if (b.kind === 'difficulty') {
      const check = tmReadCheck(b.el);
      if (check) q.difficulty = check;
    } else answers[b.kind] = tmValue(b.el);
  }
  return { q: { ...q, ...answers }, answers };
}

const tmWritten = (a) => !!(a.question || a.taxonomy.length || a.correct_letter || a.correct_text
  || TM_LETTERS.some((l) => a[l]));

async function readTelemanus(options = {}) {
  if (!document.querySelector('[data-testid="form-block"]')) {
    throw new Error('Nothing found on this page - no form blocks. Is this a Telemanus task?');
  }
  const withForm = options.includeForm !== false;
  const opened = await tmOpenAssets();

  const uid = oneLine(document.querySelector('[data-testid="topbar-task-uid"]')?.textContent).match(UUID)?.[0]
    || readUid();
  const videos = tmReadVideos();
  const assets = tmReadAssets();
  const groups = tmQuestionGroups();
  const timeLeft = oneLine(document.querySelector('[data-testid="task-expiration-timer"]')?.textContent) || null;
  const lastSaved = (document.body.innerText || document.body.textContent || '')
    .match(/last saved at\s*(\d{1,2}:\d{2}\s*(?:[AP]M)?)/i)?.[1].trim() || null;

  const content = {};
  const page = oneLine(document.querySelector('[data-testid="page-indicator"]')?.textContent);
  if (page) content.page = page;
  if (timeLeft) content.timeLeft = timeLeft;
  if (lastSaved) content.lastSaved = lastSaved;
  content.videos = videos;
  content.assets = assets;

  const data = { project: 'telemanus' };
  if (uid) data.uid = uid;
  // The link on its own, where it is wanted without the rest.
  if (videos[0]) data.video = videos[0].url;
  data.content = content;

  let written = 0;
  if (withForm) {
    const groupType = tmRadios(tmTopBlock(TM_TOP.group_type));
    const read = groups.map(tmReadQuestion);
    written = read.filter((r) => tmWritten(r.answers)).length;

    const coherence = tmReadCheck(tmTopBlock(/^coherence quality check/i));
    const latest = tmValue(tmTopBlock(/^latest automatic group difficulty/i));
    const form = {
      groupType: groupType.find((o) => o.checked)?.text || null,
      questions: read.map((r) => r.q),
      groupStructure: tmValue(tmTopBlock(TM_TOP.group_structure)),
      reasoningSteps: tmValue(tmTopBlock(TM_TOP.reasoning_steps)),
      timeSpent: tmValue(tmTopBlock(TM_TOP.time_spent))
    };
    if (coherence) form.coherenceCheck = coherence;
    if (latest) form.latestGroupDifficulty = latest;
    content.form = form;

    // Everything an answer may be chosen from.
    // The Level only: the heads under it change with the Level chosen.
    const taxonomy = groups[0]
      ? tmRadios(tmQuestionBlocks(groups[0].el).find((b) => b.kind === 'taxonomy')?.el)
      : [];
    const levels = taxonomy.filter((o) => o.group === taxonomy[0].group).map((o) => o.text);
    content.options = { groupTypes: groupType.map((o) => o.text), levels, letters: TM_LETTERS };

    data.answers = {
      group_type: form.groupType,
      questions: read.map((r) => r.answers),
      group_structure: form.groupStructure,
      reasoning_steps: form.reasoningSteps,
      time_spent: form.timeSpent
    };
  }

  return {
    data,
    meta: {
      project: 'telemanus',
      opened,
      form: withForm,
      videos: videos.length,
      assets: assets.length,
      questions: groups.length,
      written
    }
  };
}

/* ---------- reading the answers ---------- */

const tmKeyName = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const tmGiven = (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);

const TM_KEYS = new Map([
  ['grouptype', 'group_type'],
  ['questions', 'questions'],
  ['groupstructure', 'group_structure'],
  ['reasoningsteps', 'reasoning_steps'],
  ['timespent', 'time_spent'], ['time', 'time_spent'], ['minutes', 'time_spent'],
  ['recordyourtimespentonthistask', 'time_spent']
]);

const TM_ROW_KEYS = new Map([
  ['taxonomy', 'taxonomy'], ['questiontaxonomy', 'taxonomy'],
  ['question', 'question'], ['writeyourquestion', 'question'], ['text', 'question'],
  ['correctletter', 'correct_letter'], ['correctanswerletter', 'correct_letter'], ['answer', 'correct_letter'],
  ['correcttext', 'correct_text'], ['correctanswertext', 'correct_text'],
  ...TM_LETTERS.map((l) => [l.toLowerCase(), l])
]);

// What a catch hands out beside the answers, and the question a fill answers
// for itself: sent back, they are passed over rather than called unknown.
const TM_ROW_IGNORED = new Set(['n', 'modelchecked', 'modelcheck', 'difficulty', 'proposal', 'aiproposal',
  'usedaiproposal', 'checkthemodel']);

// The taxonomy is the Level and then the heads under it, in order: a list, an
// object naming them, or one line with " > " between them.
function tmTaxonomyList(v) {
  if (Array.isArray(v)) return v.map(oneLine).filter(Boolean);
  if (v && typeof v === 'object') return Object.values(v).map(oneLine).filter(Boolean);
  return String(v).split(/\s*(?:>|→|\/|\|)\s*/).map(oneLine).filter(Boolean);
}

function tmNormalizeRow(r, i) {
  if (r === null || r === undefined) return {};
  if (typeof r !== 'object' || Array.isArray(r)) throw new Error(`Question ${i + 1} must be an object.`);

  const out = {};
  const unknown = [];
  for (const [key, value] of Object.entries(r)) {
    const k = tmKeyName(key);
    if (TM_ROW_IGNORED.has(k)) continue;
    const name = TM_ROW_KEYS.get(k);
    if (!name) { unknown.push(`questions[${i + 1}].${key}`); continue; }
    if (!tmGiven(value)) continue;
    // The choices can also come as one object or list under "options".
    out[name] = name === 'taxonomy' ? tmTaxonomyList(value) : value;
  }
  for (const [key, value] of Object.entries(r)) {
    if (!/^(options|choices)$/i.test(key) || !value || typeof value !== 'object') continue;
    unknown.splice(unknown.indexOf(`questions[${i + 1}].${key}`), 1);
    const entries = Array.isArray(value) ? value.map((v, j) => [TM_LETTERS[j], v]) : Object.entries(value);
    for (const [k, v] of entries) {
      const letter = String(k || '').replace(/[^a-z]/gi, '').toUpperCase();
      if (TM_LETTERS.includes(letter) && tmGiven(v)) out[letter] = v;
    }
  }
  if (out.correct_letter !== undefined) {
    const letter = String(out.correct_letter).trim().replace(/\.$/, '').toUpperCase();
    if (!TM_LETTERS.includes(letter)) {
      throw new Error(`Question ${i + 1}: correct letter "${oneLine(out.correct_letter)}" is not one of A to H.`);
    }
    out.correct_letter = letter;
  }
  return { row: out, unknown };
}

// { group_type, questions: [ … ], group_structure, reasoning_steps,
// time_spent }, with or without an "answers" wrapper; a bare list is the
// questions on their own. Anything left out, empty or null is left alone.
function tmNormalize(input) {
  let data = input;
  if (typeof data === 'string') data = JSON.parse(data);
  if (data && !Array.isArray(data) && data.answers && typeof data.answers === 'object') data = data.answers;
  if (Array.isArray(data)) data = { questions: data };
  if (!data || typeof data !== 'object') {
    throw new Error('JSON must be an object of answers, or a list of questions.');
  }

  const out = {};
  const unknownKeys = [];
  for (const [key, value] of Object.entries(data)) {
    const name = TM_KEYS.get(tmKeyName(key));
    if (!name) { unknownKeys.push(key); continue; }
    if (tmGiven(value)) out[name] = value;
  }
  if (out.questions !== undefined) {
    if (!Array.isArray(out.questions)) throw new Error('"questions" must be a list.');
    out.questions = out.questions.map((r, i) => {
      const got = tmNormalizeRow(r, i);
      if (!got.row) return {};
      unknownKeys.push(...got.unknown);
      return got.row;
    });
  }
  return { answers: out, unknownKeys };
}

/* ---------- writing one control ---------- */

// "2. Temporal Dynamics" is matched whole, or by its words without the number.
function tmLoose(s) {
  return oneLine(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

const tmBare = (s) => tmLoose(s).replace(/^[\d ]+/, '');

function tmMatch(options, value) {
  const want = tmLoose(value);
  if (!want) return null;
  return options.find((o) => tmLoose(o.text) === want)
    || options.find((o) => tmLoose(o.value) === want)
    || options.find((o) => tmBare(o.text) && tmBare(o.text) === tmBare(value))
    || (want.length >= 4 ? options.find((o) => tmLoose(o.text).startsWith(want)) : null)
    || null;
}

// A choice re-renders the moment it is made, so what the click did is read
// back off the page rather than off the node that was clicked.
async function tmSetChoice(find, value, base) {
  const options = tmRadios(find());
  if (!options.length) return { ok: false, why: 'no options to choose from' };
  const pick = tmMatch(options, value);
  if (!pick) {
    return { ok: false, why: `no option matching "${oneLine(value)}" (it offers: ${options.map((o) => o.text).join(', ')})` };
  }

  const chosen = () => tmRadios(find()).some((o) => o.checked && o.value === pick.value && o.text === pick.text);
  if (chosen()) return unchanged({ ok: true, already: true });

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

function tmListOptions() {
  return Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="option"]'))
    .filter(isVisible)
    .map((el) => ({ text: oneLine(el.textContent), value: el.getAttribute('data-value') || '', el }));
}

// A head offered as a dropdown: opened, looked through, and shut again if
// what is wanted is not in it.
async function tmPickFromCombo(combo, value, base) {
  combo.scrollIntoView({ block: 'center' });
  await wait(base * 4);
  combo.click();
  const pick = await until(() => tmMatch(tmListOptions(), value), { timeout: 1500 });
  if (!pick) {
    if (combo.getAttribute('aria-expanded') === 'true') combo.click();
    await wait(settleMs);
    return false;
  }
  pick.el.click();
  await wait(settleMs);
  return true;
}

// The Level first; choosing it brings in the heads under it, so each next
// value is waited for among the choices not yet made.
async function tmSetTaxonomy(find, values, base) {
  const used = new Set();
  let acted = false;
  for (let i = 0; i < values.length; i++) {
    checkCancelled();
    const value = values[i];
    const radio = () => tmMatch(tmRadios(find()).filter((o) => !used.has(o.group)), value);
    const found = await until(radio, { timeout: i ? 4000 : 1500, step: 100 });

    if (found) {
      const group = found.group;
      const r = await tmSetChoice(() => group?.isConnected ? group : find(), value, base);
      if (!r.ok) return { ok: false, why: `"${value}" - ${r.why}` };
      if (!r.already) acted = true;
      // The group is re-rendered by the choice, so it is found again to mark.
      const now = tmRadios(find()).find((o) => o.checked && o.text === found.text);
      used.add(now?.group || group);
    } else {
      let took = false;
      for (const combo of tmCombos(find()).filter((c) => !used.has(c))) {
        if (!await tmPickFromCombo(combo, value, base)) continue;
        used.add(combo);
        took = true;
        acted = true;
        break;
      }
      if (!took) {
        const open = tmRadios(find()).filter((o) => !used.has(o.group)).map((o) => o.text);
        return {
          ok: false,
          why: `no choice matching "${value}"${open.length ? ` (it offers: ${open.join(', ')})` : ''}`
        };
      }
    }
    await wait(settleMs);
  }
  // One head already chosen does not make the whole taxonomy untouched.
  if (acted) skippedWrite = false;
  return { ok: true };
}

async function tmWrite(block, value, base, paste) {
  const ctl = tmControl(block);
  if (!ctl || ctl.readOnly || ctl.disabled) return null;
  return paste ? pasteInto(ctl, value, base) : typeInto(ctl, value, base);
}

// A wait that Stop can end, for the answers the server takes its time over.
async function tmWaitFor(fn, timeout, step = 400) {
  const deadline = Date.now() + timeout;
  for (;;) {
    checkCancelled();
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    if (document.hidden) hiddenDuringRun = true;
    await wait(step);
  }
}

/* ---------- the two checks of a question ---------- */

// "Complete required fields first: A., B., Check the model, Did you use …?"
// with the two a fill sees to itself taken out: what is left is missing for
// good. The proposal question has commas of its own, so it goes first.
function tmMissingFields(waitingOn) {
  if (!waitingOn) return null;
  const rest = waitingOn
    .replace(/did you use the ai-?generated proposal[^?]*\?/i, '')
    .replace(/check the model/i, '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  return rest.length ? rest.join(', ') : null;
}

const TM_MODEL_WAIT = 300000;   // five runs of a model over a video
const TM_MODEL_QUIET = 8000;    // nothing new for this long: the runs are over
const TM_ENABLE_WAIT = 60000;
const TM_FEEDBACK_WAIT = 180000;

function tmSendButton(block) {
  return block.querySelector('button[aria-label="Send prompt" i], button[title="Send prompt" i]')
    || Array.from(block.querySelectorAll('button')).find((b) => b.closest('.relative')?.querySelector('textarea'))
    || null;
}

// Something in the block is still turning: a spinner, or a button to stop it.
const TM_BUSY = '.animate-spin, [aria-busy="true"], [role="progressbar"], '
  + '[data-testid*="spinner" i], [data-testid*="loading" i]';

function tmBusy(block) {
  if (!block) return false;
  if (block.querySelector(TM_BUSY)) return true;
  return Array.from(block.querySelectorAll('button'))
    .some((b) => /^(stop|cancel)\b/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || buttonText(b)));
}

// Whether the Difficulty block still lists "Check the model" among what it
// waits on - the page's own word that the check is not done. Null where the
// block lists nothing, and so says nothing either way.
function tmModelOwed(difficulty) {
  const waitingOn = tmReadCheck(difficulty)?.waitingOn;
  return waitingOn ? /check the model/i.test(waitingOn) : null;
}

// The model check is over when the page no longer counts it as owed, nothing
// in its block is turning, and what the block says has stopped changing. It
// runs five times, so a first answer is not the end: the block has to stay
// quiet. `before` is what the block said ahead of the send - an answer has to
// be something new - and is left out where the check was not sent from here.
async function tmModelSettled(findModel, findDifficulty, { before, quiet = TM_MODEL_QUIET, timeout = TM_MODEL_WAIT } = {}) {
  let last = null;
  let since = Date.now();
  const done = await tmWaitFor(() => {
    const block = findModel();
    if (!block) return true;
    const now = tmResult(block) || '';
    if (now !== last) { last = now; since = Date.now(); }
    if (tmBusy(block)) { since = Date.now(); return false; }
    if (tmModelOwed(findDifficulty())) return false;

    const calm = Date.now() - since;
    if (before !== undefined && now === before) {
      // Nothing new to read: taken as done only on the page's word, and
      // only after a long quiet.
      return tmAnswered(block) && calm >= Math.max(quiet, 30000);
    }
    return calm >= quiet;
  }, timeout, 500);
  return !!done;
}

function tmPress(el) {
  const at = { bubbles: true, cancelable: true, view: window };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, at));
  }
  el.click();
}

// "Check the model": the word "check" into its box, the arrow, and then the
// wait for all five runs - whatever else the fill is or is not doing. A check
// the page already counts as done is not sent a second time.
async function tmRunModelCheck(findModel, findDifficulty, base, paste) {
  const block = findModel();
  if (!block) return { ok: false, why: 'no "Check the model" block' };

  const owed = tmModelOwed(findDifficulty());
  if (tmAnswered(block) && owed !== true) {
    const settled = await tmModelSettled(findModel, findDifficulty);
    return settled ? unchanged({ ok: true, already: true }) : { ok: true, waiting: true };
  }

  const ctl = block.querySelector('textarea');
  if (!ctl) return { ok: false, why: 'no box to type "check" into' };
  const before = tmResult(block) || '';

  if (oneLine(ctl.value).toLowerCase() !== 'check') {
    if (paste) await pasteInto(ctl, 'check', base);
    else await typeInto(ctl, 'check', base);
  }

  const ready = () => {
    const b = tmSendButton(findModel() || block);
    return b && !b.disabled ? b : null;
  };
  const send = await until(ready, { timeout: 4000, step: 100 });
  if (!send) return { ok: false, why: 'the arrow stayed disabled after "check" was typed' };

  // Sent, when the page shows any sign of it: the box emptied or locked, the
  // arrow gone or disabled, something turning, something new said, or the
  // Difficulty block no longer waiting on it.
  const sent = () => {
    const now = findModel();
    if (!now) return true;
    const box = now.querySelector('textarea');
    return !box || box.disabled || oneLine(box.value).toLowerCase() !== 'check'
      || !ready() || tmBusy(now) || (tmResult(now) || '') !== before
      || (owed === true && tmModelOwed(findDifficulty()) === false);
  };

  send.scrollIntoView({ block: 'center' });
  await wait(base * 4);
  send.click();
  if (!await tmWaitFor(sent, 5000, 150)) {
    // A bare click can go unheard; press it the long way once.
    const again = ready();
    if (again) tmPress(again);
    if (!await tmWaitFor(sent, 8000, 150)) {
      return { ok: false, why: 'the arrow was pressed and the page showed no sign of sending' };
    }
  }

  const settled = await tmModelSettled(findModel, findDifficulty, { before });
  return settled ? { ok: true } : { ok: true, waiting: true };
}

// What a Check feedback block answered: pass/fail panels where the page
// draws them, otherwise whatever it says, read for the word.
function tmReadFeedback(block) {
  if (!block) return null;
  const panels = Array.from(block.querySelectorAll(RESULT_PANEL))
    .filter((p) => !p.parentElement?.closest(RESULT_PANEL));
  const parts = panels.map((p) => {
    const text = tmLinesOf(p.cloneNode(true));
    const word = text.split('\n').find((t) => /^(pass(ed)?|fail(ed)?|warn(ing)?|error)$/i.test(t));
    return { text, passed: word ? /^pass/i.test(word) : /bg-success-subtle/.test(p.getAttribute('class') || '') };
  }).filter((x) => x.text);
  if (parts.length) {
    return { passed: parts.every((x) => x.passed), text: parts.map((x) => x.text).join('\n\n') };
  }

  const text = tmResult(block);
  if (!text || TM_BLOCKED.test(text)) return null;
  const verdict = autoVerdict(text);
  return { passed: verdict ? verdict === 'passed' : null, text };
}

// The Difficulty check. Its button stays disabled until every required field
// of the question is in, and it judges what the model check found - so it is
// pressed only once that check is over, and an answer left from an earlier
// run is cleared first, being about something else.
async function tmRunFeedback(find, findModel, { enableWait = TM_ENABLE_WAIT } = {}) {
  const buttons = () => Array.from(find()?.querySelectorAll('button') || []);
  const clearButton = () => buttons().find((b) => /clear feedback/i.test(buttonText(b))) || null;
  const runButton = () => buttons().find((b) => CHECK_BUTTON.test(buttonText(b)))
    || buttons().find((b) => b.matches(TM_CHECK) && !/clear/i.test(buttonText(b)))
    || null;

  const stale = clearButton();
  if (stale && !stale.disabled) {
    stale.scrollIntoView({ block: 'center' });
    await wait(settleMs);
    stale.click();
    await tmWaitFor(() => !clearButton() && runButton(), 8000, 200);
  }
  if (!runButton()) return { ok: false, why: 'no Check feedback button' };

  // What it waits on is written under it; a field nobody filled in is not
  // going to fill itself.
  const started = Date.now();
  let missing = null;
  const ready = await tmWaitFor(() => {
    const b = runButton();
    if (b && !b.disabled) return b;
    missing = tmMissingFields(tmReadCheck(find())?.waitingOn);
    return missing && Date.now() - started > 8000 ? 'missing' : null;
  }, enableWait);
  if (!ready || ready === 'missing') {
    const waitingOn = missing || tmReadCheck(find())?.waitingOn;
    return { ok: false, why: waitingOn ? `not pressed, the page still wants: ${waitingOn}` : 'not pressed, the button stayed disabled' };
  }

  // Enabled is not the same as the model being done with all five runs.
  if (!await tmModelSettled(findModel, find, { quiet: 3000, timeout: TM_ENABLE_WAIT })) {
    return { ok: false, why: 'not pressed, the model check was still running' };
  }
  const button = runButton();
  if (!button || button.disabled) return { ok: false, why: 'not pressed, the button went back to disabled' };

  const before = tmResult(find());
  button.scrollIntoView({ block: 'center' });
  await wait(settleMs);
  button.click();

  // Answered when a result panel or "Clear feedback results" shows; failing
  // those, when the block says something new and has stopped changing.
  let last = null;
  let steady = 0;
  const landed = await tmWaitFor(() => {
    const block = find();
    const now = tmResult(block);
    const said = now && now !== before && !TM_BLOCKED.test(now);
    const idle = !tmBusy(block) && !runButton()?.disabled;
    steady = said && idle && now === last ? steady + 1 : 0;
    last = now;
    if ((block?.querySelector(RESULT_PANEL) || clearButton()) && idle) return steady >= 2;
    return steady >= 8;
  }, TM_FEEDBACK_WAIT, 500);
  return landed ? { ok: true } : { ok: true, waiting: true };
}

/* ---------- writing the answers back ---------- */

// Group Type first, then each question in the page's own order - taxonomy,
// the question, A to H, the correct letter and text, "Check the model", "No"
// to the AI proposal, and the Difficulty check - then Group Structure,
// Reasoning Steps and the time spent. Submit is never pressed.
async function applyTelemanus(input, options = {}) {
  if (busy) throw new Error('Already typing. Press Stop first.');

  const { answers: a, unknownKeys } = tmNormalize(input);
  const rows = (a.questions || []).map((row) => (Object.keys(row).length ? row : null));
  if (!Object.keys(a).length || (Object.keys(a).length === 1 && a.questions && !rows.some(Boolean))) {
    throw new Error('No answers to write - nothing in the JSON is a Telemanus field.');
  }
  if (!document.querySelector('[data-testid="form-block"]')) {
    throw new Error('This does not look like a Telemanus task page.');
  }
  const groups = tmQuestionGroups();
  if (rows.some(Boolean) && !groups.length) {
    throw new Error('No questions on this page - the form is on the page after the instructions. Go to it and try again.');
  }
  if (rows.length > groups.length && groups.length) {
    throw new Error(`${rows.length} questions given - the page has ${groups.length}.`);
  }

  const base = Math.max(0, Number(options.speed ?? 200));
  const paste = options.entry === 'paste'; // typing is the default here
  const gap = Math.max(0, Number(options.gap ?? 2000));
  const runModel = options.modelCheck !== false;
  const runFeedback = options.checkFeedback !== false;

  // One step per thing done, so the count on the panel means something.
  const plan = [];
  if (a.group_type !== undefined) plan.push({ top: 'group_type' });
  rows.forEach((row, i) => {
    if (!row) return;
    for (const b of tmQuestionBlocks(groups[i].el)) {
      if (b.kind === 'proposal') plan.push({ q: i, kind: b.kind });
      else if (b.kind === 'model') { if (runModel) plan.push({ q: i, kind: b.kind }); }
      else if (b.kind === 'difficulty') { if (runFeedback) plan.push({ q: i, kind: b.kind }); }
      else if (row[b.kind] !== undefined) plan.push({ q: i, kind: b.kind });
    }
  });
  for (const key of ['group_structure', 'reasoning_steps', 'time_spent']) {
    if (a[key] !== undefined) plan.push({ top: key });
  }
  const total = plan.length;

  hiddenDuringRun = false;
  settleMs = settleFor(gap);
  busy = true;
  cancelled = false;
  stayAwake();
  progress = { index: 0, total, phase: 'opening', unit: 'answer' };

  const refused = [];
  const skippedFields = [];
  const truncated = [];
  const warnings = [];
  const checked = [];
  const feedback = [];
  const modelPending = new Set();
  let filled = 0;
  let done = 0;

  const took = (name, r) => { if (r.ok) filled++; else refused.push(`${name} - ${r.why}`); };
  const wrote = (name, r) => {
    if (!r) return skippedFields.push(name);
    if (r.truncated) truncated.push(name);
    filled++;
  };
  const blockOf = (i, kind) => tmQuestionBlocks(tmQuestionGroups()[i].el).find((b) => b.kind === kind)?.el || null;

  try {
    for (const step of plan) {
      checkCancelled();
      if (document.hidden) hiddenDuringRun = true;
      done++;

      if (step.top) {
        const name = `"${step.top}"`;
        progress = { index: done, total, phase: 'filling', unit: 'answer' };
        if (step.top === 'group_type') {
          took(name, await tmSetChoice(() => tmTopBlock(TM_TOP.group_type), a.group_type, base));
        } else {
          wrote(name, await tmWrite(tmTopBlock(TM_TOP[step.top]), a[step.top], base, paste));
        }
        await gapPause(gap);
        continue;
      }

      const i = step.q;
      const row = rows[i];
      const at = `Question ${i + 1}`;
      const name = `${at} "${step.kind}"`;
      const say = (what) => {
        progress = { index: done, total, phase: 'filling', unit: 'answer', text: `${at} of ${groups.length} — ${what}…` };
      };

      if (step.kind === 'taxonomy') {
        say('taxonomy');
        took(name, await tmSetTaxonomy(() => blockOf(i, 'taxonomy'), row.taxonomy, base));
      } else if (step.kind === 'model') {
        // Waited out here, whether or not Check feedback is pressed after.
        say('asking the model and waiting for its five runs');
        const r = await tmRunModelCheck(() => blockOf(i, 'model'), () => blockOf(i, 'difficulty'), base, paste);
        if (r.waiting) {
          modelPending.add(i);
          warnings.push(`${at}: the model check had not finished after ${TM_MODEL_WAIT / 60000} minutes.`);
        }
        took(`${at} "Check the model"`, r);
      } else if (step.kind === 'proposal') {
        // Never asked for: it is always "No", and it goes in here, in its
        // place, rather than after everything else.
        say('the AI proposal question');
        took(`${at} "AI-generated proposal"`, await tmSetChoice(() => blockOf(i, 'proposal'), 'No', base));
      } else if (step.kind === 'difficulty') {
        say('Check feedback');
        // Never ahead of the model check: feedback on a check still running
        // is feedback about something else.
        const r = modelPending.has(i)
          ? { ok: false, why: 'not pressed, the model check had not finished' }
          : await tmRunFeedback(() => blockOf(i, 'difficulty'), () => blockOf(i, 'model'),
            { enableWait: runModel ? TM_ENABLE_WAIT : 15000 });
        if (r.ok) checked.push(i + 1);
        if (r.waiting) warnings.push(`${at}: Check feedback was pressed and had not answered after ${TM_FEEDBACK_WAIT / 60000} minutes.`);
        took(`${at} "Check feedback"`, r);
      } else {
        say(/^[A-H]$/.test(step.kind) ? `choice ${step.kind}` : step.kind.replace(/_/g, ' '));
        wrote(name, await tmWrite(blockOf(i, step.kind), row[step.kind], base, paste));
      }
      await gapPause(gap);
    }

    // What each Check feedback came back with, read once everything is in.
    if (runFeedback) {
      rows.forEach((row, i) => {
        const block = row && blockOf(i, 'difficulty');
        if (!block) return;
        const said = tmReadFeedback(block);
        feedback.push({
          n: i + 1,
          title: tmTitle(block) || `Question ${i + 1} Difficulty`,
          pressed: checked.includes(i + 1),
          passed: said ? said.passed : null,
          text: said?.text || null
        });
      });
    }
  } finally {
    busy = false;
    progress = null;
    settleMs = SETTLE;
    letSleep();
  }

  return {
    project: 'telemanus',
    requested: total,
    filled,
    questions: rows.filter(Boolean).length,
    checked,
    feedback,
    ranInBackground: hiddenDuringRun,
    skippedFields,
    truncated,
    refused,
    unknownKeys,
    warnings
  };
}

/* ---------- registration ---------- */

PAGE_PROJECTS.telemanus = {
  detect: () => (isTelemanusPage() ? 'its video and question groups' : null),
  read: readTelemanus,
  apply: applyTelemanus,
  ping: () => {
    if (!isTelemanusPage()) return { telemanus: null };
    const groups = tmQuestionGroups();
    return {
      telemanus: {
        questions: groups.length,
        written: groups.filter((g) => tmWritten(tmReadQuestion(g).answers)).length
      }
    };
  }
};
