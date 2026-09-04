/* Criteria Catcher - page-side worker.
   Injected on demand by the popup. Re-injection is a no-op. */
(() => {
  if (window.__criteriaCatcherLoaded) return;
  window.__criteriaCatcherLoaded = true;

  const CONTAINER = '[data-testid="repeatable-criteria"]';
  const INSTANCE = '[data-testid^="repeatable-criteria-instance-"]';

  let busy = false;
  let cancelled = false;
  let progress = null;
  let checkProgress = null; // set while the feedback checks are being awaited
  let hiddenDuringRun = false; // the tab went behind while we were working

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // How long to wait on the page before calling something a failure.
  //
  // Chrome slows a hidden tab's timers, and the page's own re-render runs on
  // those same timers - so a section that mounts in half a second in front can
  // take many seconds behind. Judging it by the foreground budget declares a
  // failure that never happened, and the caller throws, ending the run. The
  // budget therefore grows the moment the tab goes behind, and because that can
  // happen mid-wait it is re-checked on every pass.
  const HIDDEN_PATIENCE = 8;

  async function until(fn, { timeout = 5000, step = 50 } = {}) {
    const start = Date.now();
    let budget = timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (document.hidden) {
        budget = Math.max(budget, timeout * HIDDEN_PATIENCE);
        hiddenDuringRun = true;
      }
      if (Date.now() - start > budget) return null;
      await wait(step);
    }
  }

  function checkCancelled() {
    if (cancelled) throw new Error('Stopped.');
  }

  // A long wait in one piece would leave Stop unresponsive for its whole length,
  // so sit out the gap in slices and check between them.
  //
  // Counting slices would be wrong: Chrome clamps timers in a hidden tab to
  // roughly one a second, so twenty 100ms slices become twenty seconds once the
  // user looks at another tab. Work to a deadline instead - then a slow slice
  // simply overshoots the end and the gap still lasts about as long as asked.
  async function pause(ms) {
    const until = Date.now() + ms;
    for (;;) {
      checkCancelled();
      const left = until - Date.now();
      if (left <= 0) return;
      await wait(Math.min(150, left));
    }
  }

  function getContainer() {
    const el = document.querySelector(CONTAINER);
    if (el) return el;
    // Fallback: the list wrapper around whatever instances exist.
    const first = document.querySelector(INSTANCE);
    if (!first) return null;
    return first.parentElement?.parentElement || first.parentElement;
  }

  function idxOf(inst) {
    const m = (inst.getAttribute('data-testid') || '').match(/-(\d+)$/);
    return m ? Number(m[1]) : 0;
  }

  function getInstances() {
    return Array.from(document.querySelectorAll(INSTANCE)).sort((a, b) => idxOf(a) - idxOf(b));
  }

  /* ---------- page identity: mode, uid, sector, task notes ---------- */

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  function headingText() {
    const h1 = document.querySelector('h1.text-2xl-semibold') || document.querySelector('h1');
    return (h1?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Submission and Refinement pages share the heading "Submission"; only the
  // blurb underneath tells them apart - "In this prompt generation project…"
  // against "In this refinery project…".
  function projectPhrase() {
    const el = Array.from(document.querySelectorAll('div.text-base-normal, p'))
      .find((d) => /in this\b.*\bproject\b/i.test(d.textContent || ''));
    const blurb = (el?.textContent || '').replace(/\s+/g, ' ').trim();

    // Fall back to the whole page when the blurb sits in some other wrapper.
    const text = /refinery project|prompt generation project/i.test(blurb)
      ? blurb
      : (document.body?.innerText || document.body?.textContent || '');

    // Refinement wins the tie: a refinement page shows the task it is revising,
    // so it can quote the submission wording, but never the other way round.
    if (/refinery project/i.test(text)) return 'refinement';
    if (/prompt generation project/i.test(text)) return 'submission';
    return null;
  }

  function detectMode() {
    const heading = headingText();
    const phrase = projectPhrase();

    if (/^review$/i.test(heading)) return { mode: 'review', source: 'heading' };

    if (/^submission$/i.test(heading)) {
      if (phrase) return { mode: phrase, source: 'blurb' };
      return { mode: 'submission', source: 'heading' };
    }

    if (/refine/i.test(heading)) return { mode: 'refinement', source: 'heading' };
    if (phrase) return { mode: phrase, source: 'blurb' };
    return { mode: null, source: 'unknown' };
  }

  function readUid() {
    const label = Array.from(document.querySelectorAll('div, span, dt, label'))
      .find((el) => /^uid:?$/i.test((el.textContent || '').trim()));
    if (!label) {
      const m = (document.body.innerText || '').match(new RegExp(`UID:?\\s*(${UUID.source})`, 'i'));
      return m ? m[1] : null;
    }
    const value = (label.nextElementSibling?.textContent
      || (label.parentElement?.textContent || '').replace(/^\s*UID:?\s*/i, '')).trim();
    return value.match(UUID)?.[0] || value || null;
  }

  // Read a read-only labelled block, e.g. the "Sector" heading and the value
  // rendered under its description. Headings vary in punctuation
  // ("Correction Feedback:"), so compare without a trailing colon.
  function readLabelledBlock(...labels) {
    const want = labels.map((l) => l.toLowerCase().replace(/:\s*$/, ''));
    const head = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, label, dt'))
      .find((h) => want.includes((h.textContent || '').trim().toLowerCase().replace(/:\s*$/, '')));
    if (!head) return null;

    // Refinement stacks several headings inside one container, so take only the
    // siblings between this heading and the next one; descriptions are prompts
    // for the user, not values.
    const parts = [];
    for (let el = head.nextElementSibling; el; el = el.nextElementSibling) {
      if (/^H[1-6]$/.test(el.tagName)) break;
      if (/_description_/.test(el.className || '')) continue;
      parts.push(el);
    }
    if (parts.length) {
      const ctl = parts.map((p) => p.querySelector('textarea, select, input:not([type="hidden"])')).find(Boolean);
      if (ctl) {
        const v = readControl(ctl);
        if (v !== '' && v !== null) return v;
      }
      const chip = parts.map((p) => p.querySelector('span[style*="pre-wrap"]')).find(Boolean);
      if (chip) return chip.textContent.trim() || null;
      const text = parts.map((p) => (p.innerText || p.textContent || '').trim())
        .filter(Boolean).join('\n').trim();
      if (text) return text;
    }

    // Only fall back to the whole parent when this heading owns it. A heading
    // stacked under an earlier one would otherwise report its neighbour's text.
    const block = head.parentElement;
    if (!block || block.firstElementChild !== head) return null;

    const ctl = block.querySelector('textarea, select, input:not([type="hidden"])');
    if (ctl) {
      const v = readControl(ctl);
      return v === '' ? null : v;
    }

    const span = block.querySelector('span[style*="pre-wrap"]');
    if (span) return span.textContent.trim() || null;

    // Fall back to whatever text is left once the heading and its description go.
    const desc = block.querySelector('[class*="_description_"]');
    let text = (block.innerText || block.textContent || '').trim();
    for (const part of [head.textContent, desc?.textContent]) {
      const p = (part || '').trim();
      if (p && text.startsWith(p)) text = text.slice(p.length).trim();
    }
    return text || null;
  }

  // Task notes are accordions outside the criteria list: "Automated feedback",
  // "Reviewer feedback", "Reviewer note", "Rebuttal note".
  const NOTE_TITLE = /feedback|note|rebuttal/i;

  // The header reads "Reviewer Feedback9/2/26, 4:15 AM" as one run of text: the
  // label lives in its own truncating span, the timestamp in a sibling.
  function noteHeading(btn) {
    const full = (btn.textContent || '').replace(/\s+/g, ' ').trim();
    const label = btn.querySelector('span.truncate');
    if (!label) return { title: full, time: null };
    const title = (label.textContent || '').replace(/\s+/g, ' ').trim();
    const rest = full.startsWith(title) ? full.slice(title.length).trim() : '';
    return { title: title || full, time: rest || null };
  }

  async function readNotes() {
    const out = [];
    for (const btn of document.querySelectorAll('button[data-radix-collection-item]')) {
      if (btn.closest(INSTANCE)) continue; // criteria sections are handled separately

      const { title, time } = noteHeading(btn);
      if (!title || !NOTE_TITLE.test(title)) continue;

      if (btn.getAttribute('data-state') === 'closed' || btn.getAttribute('aria-expanded') === 'false') {
        btn.click();
        await wait(120);
      }

      const id = btn.getAttribute('aria-controls');
      const region = (id && document.getElementById(id))
        || btn.closest('[data-state]')?.querySelector('[role="region"]');
      const text = (region?.innerText || region?.textContent || '').trim();
      if (!text) continue;

      // An auto-eval that reports failures is noise here, not task feedback.
      if (/automated/i.test(title) && /fail/i.test(text)) continue;

      out.push(time ? { title, time, text } : { title, text });
    }
    return out;
  }

  // A refinement task shows the rubric it is revising as a read-only document:
  // "Criterion 1 — weight 2" as a heading, the criterion text in the paragraphs
  // under it, up to the next heading.
  const RUBRIC_HEADING = /^criterion\s*(\d+)\s*[—–-]\s*weight\s*(-?\d+)$/i;

  function readProvidedRubrics() {
    const out = [];
    for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      if (h.closest(INSTANCE)) continue; // the editable list, handled elsewhere

      const m = (h.textContent || '').replace(/\s+/g, ' ').trim().match(RUBRIC_HEADING);
      if (!m) continue;

      const parts = [];
      for (let el = h.nextElementSibling; el; el = el.nextElementSibling) {
        if (/^H[1-6]$/.test(el.tagName)) break;
        const t = (el.innerText || el.textContent || '').trim();
        if (t) parts.push(t);
      }

      const criterion = parts.join('\n').trim();
      if (criterion) out.push({ criterion, weight: Number(m[2]) });
    }
    return out;
  }

  // Check results paint themselves green or red. A green one says nothing went
  // wrong, so only the red ones are worth carrying off the page.
  function readErrorBlocks() {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('[class*="bg-error-subtle"]')) {
      // A red block nested in another would repeat its parent's text.
      if (el.parentElement?.closest('[class*="bg-error-subtle"]')) continue;

      const text = (el.innerText || el.textContent || '').replace(/[ \t]+\n/g, '\n').trim();
      if (!text) continue;

      const field = el.closest('[data-testid^="field-"]');
      const inst = el.closest(INSTANCE);
      const where = field
        ? fieldLabel(field)
        : inst
          ? `Criterion ${idxOf(inst) + 1}`
          : null;

      const key = `${where || ''}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(where ? { label: where, text } : { text });
    }
    return out;
  }

  /* ---------- the "Check feedback" buttons ----------
     Each check field carries one button reading "Check feedback". Pressing it
     asks the server, and when the answer lands the button becomes "Clear
     feedback results" and a pass/fail panel appears beside it. Both of those
     say the check has finished. */

  function checkFields() {
    return Array.from(document.querySelectorAll('[data-testid^="field-"]'))
      .filter((f) => /feedbackbutton/i.test(f.getAttribute('data-testid') || ''));
  }

  function checkRunButton(field) {
    return Array.from(field.querySelectorAll('button'))
      .find((b) => !b.disabled && /^check feedback$/i.test(buttonText(b))) || null;
  }

  function checkFinished(field) {
    if (field.querySelector('[class*="bg-success-subtle"], [class*="bg-error-subtle"]')) return true;
    return Array.from(field.querySelectorAll('button'))
      .some((b) => /clear feedback/i.test(buttonText(b)));
  }

  function promptText() {
    const el = document.querySelector('[data-testid="field-prompt"] textarea')
      || Array.from(document.querySelectorAll('[data-testid^="field-"]'))
        .find((f) => /^user prompt$/i.test(fieldLabel(f)))?.querySelector('textarea');
    return (el?.value || '').trim();
  }

  // Press every check that has not run, then wait for all of them to answer.
  // The results are read afterwards by the usual pass/fail sweep.
  async function runFeedbackChecks({ timeout = 180000 } = {}) {
    const pending = [];

    for (const field of checkFields()) {
      if (checkFinished(field)) continue;
      const btn = checkRunButton(field);
      if (!btn) continue;
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      pending.push({ field, label: fieldLabel(field) });
      await wait(250); // stagger, rather than firing them all at once
    }

    const started = pending.length;
    if (!started) return { started: 0, answered: 0, waiting: [] };

    checkProgress = { phase: 'checks', index: 0, total: started };
    const deadline = Date.now() + timeout;
    let left = pending;

    while (left.length && Date.now() < deadline) {
      checkCancelled();
      await wait(500);
      left = left.filter((p) => !checkFinished(p.field));
      checkProgress = { phase: 'checks', index: started - left.length, total: started };
    }

    checkProgress = null;
    return {
      started,
      answered: started - left.length,
      waiting: left.map((p) => p.label)
    };
  }

  /* ---------- form fields outside the criteria list ---------- */

  // Every field renders as: label header, optional description, value area.
  // The data-testid hashes ("field-code-194d3") are not stable, so match on the
  // label text instead.
  function fieldLabel(fieldEl) {
    const lab = fieldEl.querySelector('label');
    return (lab?.textContent || '')
      .replace(/\s+/g, ' ')
      .replace(/\(optional\)\s*$/i, '')
      .trim();
  }

  // Monaco keeps its own line elements, positions them by `top`, and puts the
  // line numbers in a separate gutter. Only rendered lines exist in the DOM, so
  // a long value can come back clipped to what is on screen.
  function monacoText(root) {
    const lines = Array.from(root.querySelectorAll('.view-line'));
    if (!lines.length) return null;
    return lines
      .map((l) => ({ top: parseFloat(l.style.top) || 0, text: (l.innerText || '').replace(/ /g, ' ') }))
      .sort((a, b) => a.top - b.top)
      .map((l) => l.text)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || null;
  }

  function fieldValue(fieldEl) {
    // Auto-eval output renders as a plain <pre>.
    const pre = fieldEl.querySelector('pre');
    if (pre) return (pre.innerText || pre.textContent || '').trim() || null;

    // The self-containment summary is a Monaco editor whose textarea is empty,
    // and whose <select> holds a language name, not the value.
    if (fieldEl.querySelector('.monaco-editor')) return monacoText(fieldEl);

    // Multiselects render their picks as chip buttons with nothing between them,
    // so read the chips rather than the run-together text.
    if (/multiselect/i.test(fieldEl.getAttribute('data-testid') || '')) {
      const chips = Array.from(fieldEl.querySelectorAll('button'))
        .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && !/^add more/i.test(t));
      if (chips.length) return chips.join(', ');
    }

    const ta = fieldEl.querySelector('textarea');
    if (ta && ta.value.trim()) return ta.value.trim();

    const input = fieldEl.querySelector('input:not([type="file"])');
    if (input) {
      if (input.type === 'checkbox') return input.checked;
      const v = (input.value || '').trim();
      if (v) return input.type === 'number' ? Number(v) : v;
    }

    const sel = fieldEl.querySelector('select');
    if (sel && sel.value) return sel.value;

    // Otherwise read the rendered value area: the last child, once the label
    // header and the description are discounted.
    const kids = Array.from(fieldEl.children);
    const area = kids[kids.length - 1];
    if (!area || area.querySelector('label') || /_description_/.test(area.className)) return null;
    return (area.innerText || area.textContent || '').replace(/ /g, ' ').trim() || null;
  }

  // The fields to report, in the order they should be read back.
  const WANTED_FIELDS = [
    { key: 'prompt', match: /^user prompt$/ },
    { key: 'onetOccupation', match: /^o\*net occupation$/ },
    { key: 'onetTasks', match: /^o\*net tasks$/ },
    { key: 'onetSkills', match: /^o\*net skills$/ },
    { match: /^how many input files are tied to your prompt/ },
    { match: /input files.*multi-modal/ },
    { match: /^is web search required for your task/ },
    { match: /^if you were to complete this prompt manually/ },
    { match: /^auto-evaluation golden solution submission feedback$/ },
    { match: /^auto-evaluation difficulty submission feedback$/ },
    { match: /^auto-evaluation input output check submission feedback$/ },
    { match: /^auto-evaluation check: prompt and input files self-contained/ },
    { match: /^verifier$/ },
    { match: /^audit$/ },
    { match: /^audit: rubric and golden solution alignment$/ },
    { match: /^safety check$/ },
    { match: /^auto-evaluation llm generated files check/ },
    { match: /^auto-evaluation rubric quality check submission feedback$/ },
    { match: /^golden solution leakage check$/ },
    { match: /^rubric golden alignment check$/ },
    { match: /^rubric value grounding check$/ }
  ];

  function readFields() {
    const found = [];
    for (const f of document.querySelectorAll('[data-testid^="field-"]')) {
      if (f.closest(INSTANCE)) continue;
      const label = fieldLabel(f);
      if (label) found.push({ label, norm: label.toLowerCase(), el: f });
    }

    const named = {};
    const list = [];
    for (const want of WANTED_FIELDS) {
      // Several fields can share a label (two Safety Checks); keep them all.
      for (const f of found.filter((x) => want.match.test(x.norm))) {
        const value = fieldValue(f.el);
        if (value === null || value === '') continue;
        // The code widget's empty state, not a result.
        if (typeof value === 'string' && /^no code provided$/i.test(value.trim())) continue;
        if (want.key) named[want.key] = value;
        else list.push({ label: f.label, value });
      }
    }
    return { named, list };
  }

  /* ---------- criteria fields ---------- */

  // "field-textarea-criterion" -> "criterion", "field-numeric-weight" -> "weight"
  function fieldKey(fieldEl) {
    const t = fieldEl.getAttribute('data-testid') || '';
    const m = t.match(/^field-[a-z]+-(.+)$/i);
    if (m) return m[1];
    const bare = t.replace(/^field-/i, '');
    if (bare) return bare;
    const ctl = control(fieldEl);
    return ctl?.id?.replace(/^(textarea|numeric|input|select)-/, '') || null;
  }

  function control(fieldEl) {
    return fieldEl.querySelector('textarea, input, select');
  }

  function fieldsOf(inst) {
    return Array.from(inst.querySelectorAll('[data-testid^="field-"]'));
  }

  function readControl(ctl) {
    if (!ctl) return null;
    if (ctl.type === 'checkbox') return ctl.checked;
    const v = ctl.value;
    if (ctl.type === 'number' || ctl.getAttribute('inputmode') === 'numeric') {
      if (v === '') return null;
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }

  /* ---------- writing ---------- */

  // React keeps its own copy of an input's value, so a plain `el.value = x` is
  // discarded on the next render. Go through the prototype setter instead: that
  // desyncs React's value tracker, so the input event it hears counts as a real
  // edit.
  function nativeSet(ctl, str) {
    const proto = ctl instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : ctl instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(ctl, str); else ctl.value = str;
  }

  // Vary the gap between keys so the page sees a rhythm rather than a metronome:
  // longer after punctuation, a little longer at spaces, and the odd pause.
  function keyDelay(base, ch) {
    let d = base * (0.6 + Math.random() * 0.9);
    if (/[.,;:!?]/.test(ch)) d += base * 2.2;
    else if (ch === ' ') d += base * 0.35;
    if (Math.random() < 0.02) d += base * 6;
    return Math.max(1, Math.round(d));
  }

  async function typeInto(ctl, value, base) {
    const text = value === null || value === undefined ? '' : String(value);
    const max = ctl.maxLength > 0 ? ctl.maxLength : Infinity;
    const target = text.length > max ? text.slice(0, max) : text;

    ctl.scrollIntoView({ block: 'center' });
    ctl.focus({ preventScroll: true });
    await wait(base);

    await clearField(ctl, base);

    // Track the intended text in a buffer rather than reading back ctl.value:
    // a number input sanitises a partial "-" to "", which would eat the sign.
    const numeric = ctl.type === 'number';
    let buf = '';
    for (const ch of target) {
      checkCancelled();
      ctl.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      buf += ch;

      // A half-typed number ("-", "1e") is not assignable; the keystroke still
      // happens, the value just lands on the next character, as in a real field.
      if (!numeric || Number.isFinite(Number(buf))) {
        ctl.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: ch
        }));
        nativeSet(ctl, buf);
        try { ctl.setSelectionRange(buf.length, buf.length); } catch { /* number inputs */ }
        ctl.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'insertText', data: ch
        }));
      }

      ctl.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await wait(keyDelay(base, ch));
    }

    ctl.dispatchEvent(new Event('change', { bubbles: true }));
    ctl.blur();
    return { typed: target.length, truncated: target.length < text.length };
  }

  // Clear the field the way selecting-all and deleting would.
  async function clearField(ctl, base) {
    if (ctl.value === '') return;
    try { ctl.setSelectionRange(0, ctl.value.length); } catch { /* number inputs */ }
    ctl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    nativeSet(ctl, '');
    ctl.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'deleteContentBackward', data: null
    }));
    await wait(base * 2);
  }

  // Drop the whole value in at once, as a paste does, rather than key by key.
  // Still one field at a time, with a beat between them.
  async function pasteInto(ctl, value, base) {
    const text = value === null || value === undefined ? '' : String(value);
    const max = ctl.maxLength > 0 ? ctl.maxLength : Infinity;
    const target = text.length > max ? text.slice(0, max) : text;

    ctl.scrollIntoView({ block: 'center' });
    ctl.focus({ preventScroll: true });
    await wait(base * 4);
    await clearField(ctl, base);

    ctl.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: target
    }));
    nativeSet(ctl, target);
    try { ctl.setSelectionRange(target.length, target.length); } catch { /* number inputs */ }
    ctl.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertFromPaste', data: target
    }));
    ctl.dispatchEvent(new Event('change', { bubbles: true }));
    ctl.blur();

    return { typed: target.length, truncated: target.length < text.length };
  }

  // Checkboxes and selects have nothing to type into.
  function setDiscrete(ctl, value) {
    if (ctl.type === 'checkbox') {
      if (ctl.checked !== Boolean(value)) ctl.click();
      return true;
    }
    nativeSet(ctl, value === null || value === undefined ? '' : String(value));
    ctl.dispatchEvent(new Event('input', { bubbles: true }));
    ctl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /* ---------- accordion ---------- */

  function triggerOf(inst) {
    return inst.querySelector('button[data-radix-collection-item]')
      || inst.querySelector('h1 button, h2 button, h3 button, h4 button');
  }

  function isCollapsed(inst) {
    const t = triggerOf(inst);
    if (!t) return false;
    return t.getAttribute('data-state') === 'closed' || t.getAttribute('aria-expanded') === 'false';
  }

  // Collapsed Radix sections unmount their content, so nothing can be read or
  // written until they are open.
  async function expand(inst) {
    if (!isCollapsed(inst)) return false;
    triggerOf(inst)?.click();
    await until(() => !isCollapsed(inst) && fieldsOf(inst).length > 0, { timeout: 2000 });
    await wait(80);
    return true;
  }

  // Sections, criteria and notes are all Radix accordions, and a closed one has
  // no content in the DOM at all, so everything has to be opened before the page
  // can be read. Repeatedly: opening "Section 2" reveals the accordions nested
  // inside it, which may themselves be closed.
  //
  // aria-expanded is what separates an accordion from the rest. The page puts
  // data-radix-collection-item on checkbox and radio items too, and those carry
  // data-state="unchecked" with no aria-expanded - clicking one would tick a box
  // on the user's form. Menu buttons are skipped for the same reason.
  async function expandEverything() {
    // Click each trigger at most once. A second click on one that has not
    // repainted yet would shut it again.
    const tried = new WeakSet();
    let opened = 0;

    for (let pass = 0; pass < 8; pass++) {
      const closed = Array.from(
        document.querySelectorAll('button[aria-expanded="false"]:not([aria-haspopup])')
      ).filter((b) => !b.disabled && !tried.has(b));
      if (!closed.length) break;

      for (const btn of closed) {
        tried.add(btn);
        btn.click();
        opened++;
        await wait(60);
      }
      await wait(200); // let the newly mounted content settle
    }
    return opened;
  }

  /* ---------- add / delete sections ---------- */

  function buttonText(b) {
    return (b.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // The page's own button is "Add criterion"; rank looser matches below it so a
  // reworded label still works.
  function addRank(t) {
    if (/^add criterion$/i.test(t)) return 0;
    if (/^\+?\s*add\b/i.test(t)) return 1;
    if (/\b(add|new)\b/i.test(t)) return 2;
    if (/^\+$/.test(t)) return 3;
    return 99;
  }

  function findAddButton() {
    const container = getContainer();
    if (!container) return null;
    let scope = container;
    for (let hop = 0; hop < 6 && scope; hop++) {
      const found = Array.from(scope.querySelectorAll('button'))
        .filter((b) => !b.disabled && !b.closest(INSTANCE))
        .map((b) => ({ b, t: buttonText(b) }))
        .filter((x) => !/delete|remove|cancel|submit|save/i.test(x.t))
        .map((x) => ({ ...x, r: addRank(x.t) }))
        .filter((x) => x.r < 99)
        .sort((a, b) => a.r - b.r)[0];
      if (found) return found.b;
      scope = scope.parentElement;
    }
    return null;
  }

  function findDeleteButton(inst) {
    return Array.from(inst.querySelectorAll('button'))
      .find((b) => /\b(delete|remove)\b/i.test(buttonText(b)) && !b.disabled) || null;
  }

  async function addSection() {
    const before = getInstances().length;
    const btn = findAddButton();
    if (!btn) {
      throw new Error(
        `The page has ${before} sections and more are needed, but no "Add criterion" button was found.`
      );
    }
    btn.scrollIntoView({ block: 'center' });
    await wait(120);
    btn.click();
    const grew = await until(() => getInstances().length > before);
    if (!grew) throw new Error(`Clicked "${buttonText(btn)}" but no new section appeared.`);
    await wait(120);
  }

  /* ---------- the "are you sure?" step ---------- */

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // Rank the buttons in a confirmation so the affirmative one is chosen, and a
  // Cancel is never mistaken for it.
  const DECLINE = /^(no|cancel|keep|back|close|dismiss)\b/i;

  function confirmRank(t) {
    if (DECLINE.test(t)) return 99;
    if (/^yes\b/i.test(t)) return 0;
    if (/^(delete|remove)\b/i.test(t)) return 1;
    if (/^confirm\b/i.test(t)) return 2;
    if (/^ok$/i.test(t)) return 3;
    return 99;
  }

  function openDialog() {
    const boxes = document.querySelectorAll(
      '[role="alertdialog"], [role="dialog"], [aria-modal="true"]'
    );
    return Array.from(boxes).find(
      (d) => isVisible(d) && d.getAttribute('data-state') !== 'closed'
    ) || null;
  }

  // Deleting a section puts up a confirmation. Nothing is removed until its
  // affirmative button is pressed, so press it.
  async function confirmIfAsked() {
    const dialog = await until(openDialog, { timeout: 1500, step: 60 });
    if (!dialog) return false;

    const choice = Array.from(dialog.querySelectorAll('button'))
      .filter((b) => !b.disabled && isVisible(b))
      .map((b) => ({ b, rank: confirmRank(buttonText(b)) }))
      .filter((x) => x.rank < 99)
      .sort((a, b) => a.rank - b.rank)[0];

    if (!choice) return false;
    choice.b.click();
    await wait(120);
    return true;
  }

  async function removeExtras(target) {
    let current = getInstances().length;

    while (current > target) {
      checkCancelled();
      const del = findDeleteButton(getInstances()[current - 1]);
      if (!del) break; // no delete control: leave the spares rather than fail

      del.click();
      await wait(120);
      await confirmIfAsked();

      const shrank = await until(() => getInstances().length < current);
      if (!shrank) break; // the page did not remove it; report the leftovers
      current = getInstances().length;
      await wait(100);
    }
    return current;
  }

  /* ---------- operations ---------- */

  async function extract(options = {}) {
    const mode = options.mode || detectMode().mode;

    // Anything still collapsed is invisible to every reader below, including the
    // criteria list itself if its section happens to be shut.
    const opened = await expandEverything();

    let criteria = [];
    if (getContainer()) {
      for (const inst of getInstances()) {
        const row = {};
        for (const f of fieldsOf(inst)) {
          const key = fieldKey(f);
          if (key) row[key] = readControl(control(f));
        }
        // Fallback for pages without data-testid field wrappers.
        if (!Object.keys(row).length) {
          const ta = inst.querySelector('textarea');
          const num = inst.querySelector('input[type="number"]');
          if (ta) row.criterion = ta.value;
          if (num) row.weight = readControl(num);
        }
        if (Object.keys(row).length) criteria.push(row);
      }
    }

    const boardFilled = criteria.some((c) => String(c.criterion || '').trim());

    // A refinement page with nothing in its criteria list is a task nobody has
    // written yet. There is nothing for the checks to judge, and running them
    // would only ask the server about work that does not exist.
    const notStartedYet = mode === 'refinement' && !boardFilled;

    // Otherwise a filled prompt means the checks have something to judge, so run
    // them and wait; the failures are picked up by the sweep below.
    let checks = null;
    let checksSkipped = null;
    if (options.runChecks === false) checksSkipped = 'turned off';
    else if (notStartedYet) checksSkipped = 'refinement task not written yet';
    else if (!promptText()) checksSkipped = 'no prompt yet';
    else checks = await runFeedbackChecks();

    // The rubric being revised is the read-only copy, so fall back to that.
    let criteriaSource = 'form';
    if (notStartedYet) {
      const provided = readProvidedRubrics();
      if (provided.length) {
        criteria = provided;
        criteriaSource = 'provided rubrics';
      }
    }

    const uid = readUid();
    const notes = await readNotes();
    const { named, list } = readFields();

    // Submission and Review label it "Sector"; Refinement says "Task Sector".
    const sector = readLabelledBlock('Sector', 'Task Sector');
    const occupation = readLabelledBlock('Task Occupation');
    const tier = readLabelledBlock('Tier Type', 'Tier');
    const areasOfFocus = readLabelledBlock('Areas of Focus of Feedback');

    // Refinement carries its feedback as headed blocks, not accordions.
    for (const [title, ...aliases] of [['Correction Feedback'], ['AutoEval Feedback'],
      ['Agentic Rubric Quality Check'], ['Feedback to Improve Task']]) {
      const text = readLabelledBlock(title, ...aliases);
      if (text && !notes.some((n) => n.title === title)) notes.push({ title, text });
    }

    if (!criteria.length && !uid && !notes.length && !sector && !list.length) {
      throw new Error('Nothing found on this page - no criteria, UID, sector or task notes.');
    }

    const content = {};
    if (notes.length) content.taskNotes = notes;
    if (sector) content.sector = sector;
    if (occupation) content.occupation = occupation;
    if (tier) content.tier = tier;
    if (areasOfFocus) content.areasOfFocus = areasOfFocus;
    if (named.prompt) content.prompt = named.prompt;
    content.criteria = criteria.map((c, i) => ({ n: i + 1, ...c }));
    // O*NET is asked for on Submission and Review only.
    if (mode !== 'refinement') {
      for (const k of ['onetOccupation', 'onetTasks', 'onetSkills']) {
        if (named[k]) content[k] = named[k];
      }
    }
    if (list.length) content.fields = list;
    const errors = readErrorBlocks();
    if (errors.length) content.errors = errors;

    const data = {};
    if (mode) data.mode = mode;
    if (uid) data.uid = uid;
    data.content = content;
    data.criteria = criteria;

    // A section whose content never mounted yields nothing; say so rather than
    // quietly handing back a short list.
    return {
      data,
      meta: { sections: getInstances().length, criteriaSource, opened, checks, checksSkipped }
    };
  }

  // A row is written either as { "criterion": text, "weight": n } or with the
  // criterion's number as the key: { "1": text, "weight": n }. The number is a
  // label - position in the list still decides which section a row goes to.
  function normalizeRow(r) {
    if (typeof r === 'string') return { criterion: r };
    if (!r || typeof r !== 'object') {
      throw new Error('Each criterion must be an object or a string.');
    }
    const out = {};
    for (const [key, value] of Object.entries(r)) {
      if (/^\d+$/.test(key)) out.criterion = value;
      else out[key] = value;
    }
    return out;
  }

  function normalize(input) {
    let data = input;
    if (typeof data === 'string') data = JSON.parse(data);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.criteria)) return data.criteria;
    if (data && Array.isArray(data.items)) return data.items;
    throw new Error('JSON must be an array, or an object with a "criteria" array.');
  }

  async function apply(input, options = {}) {
    if (busy) throw new Error('Already typing. Press Stop first.');

    const rows = normalize(input).map(normalizeRow);
    if (!getContainer()) throw new Error('No criteria container found on this page.');

    const base = Math.max(0, Number(options.speed ?? 22));
    const paste = options.entry !== 'type'; // paste per field unless asked to type
    hiddenDuringRun = false;
    const gap = Math.max(0, Number(options.gap ?? 2000)); // pause after each field
    busy = true;
    cancelled = false;
    progress = { index: 0, total: rows.length, phase: 'starting' };

    const skippedFields = [];
    const truncated = [];
    let added = 0;
    let filled = 0;
    let extrasLeft = 0; // sections the page would not delete

    try {
      // The criteria list is unreachable while its section is collapsed.
      progress.phase = 'opening';
      await expandEverything();

      if (options.removeExtras !== false) {
        progress.phase = 'tidying';
        const left = await removeExtras(rows.length);
        extrasLeft = Math.max(0, left - rows.length);
      }

      for (let i = 0; i < rows.length; i++) {
        checkCancelled();
        progress = { index: i + 1, total: rows.length, phase: 'typing' };

        // Only reach for "Add criterion" once the existing sections run out.
        if (i >= getInstances().length) {
          progress.phase = 'adding';
          await addSection();
          added++;
          progress.phase = 'typing';
        }

        if (document.hidden) hiddenDuringRun = true;

        const inst = getInstances()[i];
        if (!inst) throw new Error(`Section ${i + 1} did not appear.`);
        await expand(inst);

        const byKey = new Map();
        for (const f of fieldsOf(inst)) {
          const k = fieldKey(f);
          if (k) byKey.set(k.toLowerCase(), f);
        }

        for (const [key, value] of Object.entries(rows[i])) {
          checkCancelled();
          const f = byKey.get(key.toLowerCase());
          let ctl = f ? control(f) : null;
          if (!ctl) {
            // Fall back to the conventional shape of a criterion row.
            if (/^(criterion|text)$/i.test(key)) ctl = inst.querySelector('textarea');
            else if (/^(weight|score)$/i.test(key)) ctl = inst.querySelector('input[type="number"]');
          }
          if (!ctl) { skippedFields.push(`#${i + 1} "${key}"`); continue; }

          if (ctl.type === 'checkbox' || ctl instanceof HTMLSelectElement) {
            setDiscrete(ctl, value);
          } else {
            const r = paste
              ? await pasteInto(ctl, value, base)
              : await typeInto(ctl, value, base);
            if (r.truncated) truncated.push(`#${i + 1} "${key}"`);
          }
          await pause(gap); // settle before moving to the next field
        }
        filled++;
      }
    } finally {
      busy = false;
      progress = null;
    }

    return {
      requested: rows.length,
      filled,
      added,
      sectionsOnPage: getInstances().length,
      ranInBackground: hiddenDuringRun,
      extrasLeft,
      skippedFields,
      truncated
    };
  }

  /* ---------- messaging ---------- */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        switch (msg?.type) {
          case 'PING':
            sendResponse({
              ok: true,
              count: getInstances().length,
              hasContainer: !!getContainer(),
              detected: detectMode(),
              busy,
              progress,
              checkProgress
            });
            break;
          case 'CANCEL':
            cancelled = true;
            sendResponse({ ok: true });
            break;
          case 'EXTRACT': {
            const r = await extract(msg.options);
            sendResponse({ ok: true, data: r.data, meta: r.meta });
            break;
          }
          case 'APPLY':
            sendResponse({ ok: true, result: await apply(msg.data, msg.options) });
            break;
          default:
            sendResponse({ ok: false, error: `Unknown command: ${msg?.type}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // keep the channel open for the async response
  });
})();
