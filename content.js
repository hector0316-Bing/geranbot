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

  const sleepHere = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- staying awake while the tab is behind ----------
     Slow timers were only half of it. Chrome also freezes a background tab
     outright, and a frozen page runs no script at all - which is exactly what a
     fill that stops dead when the user changes tab, and carries on untouched
     when they come back, looks like from the outside.

     Chrome will not freeze a page that is holding a Web Lock, so a run takes one
     out and holds it until it finishes. The pacing below leans on the service
     worker, and a worker with nothing to do is shut down, so an open port is
     held for the same stretch to give it a reason to stay. Both are dropped the
     moment the run ends: neither outlives the work it is protecting. */

  let awake = 0;          // runs currently asking to stay awake
  let releaseLock = null; // resolves the promise the Web Lock is held by
  let keepPort = null;
  let portOpenedAt = 0;

  function openPort() {
    try {
      keepPort = chrome.runtime.connect({ name: 'keepalive' });
      keepPort.onDisconnect.addListener(() => { keepPort = null; });
      portOpenedAt = Date.now();
    } catch {
      keepPort = null; // the worker is restarting; the next renewal tries again
    }
  }

  // Chrome closes a port that has been open a few minutes, and closing it takes
  // away the worker's reason to stay alive, so it is replaced before then.
  function renewPort() {
    if (!awake) return;
    if (keepPort && Date.now() - portOpenedAt < 240000) return;
    try { keepPort?.disconnect(); } catch { /* already gone */ }
    openPort();
  }

  function stayAwake() {
    if (awake++) return;
    openPort();

    // The lock is held for as long as the callback's promise is unsettled, so
    // hold on to its resolver. A run can finish before the lock is granted, so
    // a release asked for early is remembered and applied on arrival.
    let releasedEarly = false;
    releaseLock = () => { releasedEarly = true; };
    // Shared, so two tabs of the same site can each hold it: an exclusive lock
    // would leave the second run queued behind the first and unprotected.
    navigator.locks?.request('criteria-catcher-run', { mode: 'shared' }, () => new Promise((done) => {
      if (releasedEarly) return done();
      releaseLock = done;
    })).catch(() => { /* locks unavailable: the worker pacing still applies */ });
  }

  function letSleep() {
    if (awake > 0) awake--;
    if (awake) return;
    releaseLock?.();
    releaseLock = null;
    try { keepPort?.disconnect(); } catch { /* already gone */ }
    keepPort = null;
  }

  // Chrome clamps this page's timers once the tab is behind - to about one a
  // second, and to one a minute after a few minutes hidden - so a fill driven by
  // setTimeout crawls and then appears to stop. The extension's service worker
  // is not a tab and keeps proper time, so hand the waiting to it and let the
  // reply wake us; messages reach a hidden page without being clamped.
  //
  // A clamped local timer would cost about a second anyway, so short waits are
  // rounded up rather than made into a message each.
  async function wait(ms) {
    if (document.hidden && ms > 0) {
      renewPort();
      try {
        await chrome.runtime.sendMessage({ type: 'SLEEP', ms: Math.max(ms, 250) });
        return;
      } catch {
        // The worker is asleep or restarting; a clamped timer still beats stopping.
      }
    }
    return sleepHere(ms);
  }

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

  function stripHeading(text, heading) {
    const h = (heading || '').replace(/\s+/g, ' ').trim();
    const t = (text || '').trim();
    if (!h || !t.toLowerCase().startsWith(h.toLowerCase())) return t;
    return t.slice(h.length).replace(/^[:\s]+/, '').trim();
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
      // A value area that repeats its own heading would report "Task Sector" as
      // the sector. Whatever the page calls the field, only its value is wanted.
      const value = stripHeading(text, head.textContent);
      if (value) return value;
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

  // Note timestamps read "9/2/26, 5:54 PM". Parsed by hand rather than left to
  // Date, which is free to read 9/2 either way round.
  function noteWhen(time) {
    const m = (time || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return 0;
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    let hour = Number(m[4]);
    const half = (m[6] || '').toUpperCase();
    if (half === 'PM' && hour !== 12) hour += 12;
    if (half === 'AM' && hour === 12) hour = 0;
    return new Date(year, Number(m[1]) - 1, Number(m[2]), hour, Number(m[5])).getTime();
  }

  // The one note of a set to read: newest by timestamp, or the first of them
  // when none carries a timestamp at all.
  function newestOf(notes) {
    let best = null;
    let bestWhen = -1;
    for (const n of notes) {
      const when = noteWhen(n.time);
      if (when > bestWhen) { bestWhen = when; best = n; }
    }
    return best;
  }

  // The newest note on the page. Only a timestamped note can be the newest one:
  // Refinement carries some of its feedback as headed blocks with no time
  // against them, so a page can have no newest note at all.
  function markLatest(notes) {
    const best = newestOf(notes.filter((n) => noteWhen(n.time)));
    if (best) best.latest = true;
    return best;
  }

  // "Automated feedback" on Submission and Review, "AutoEval Feedback" on
  // Refinement: one machine run under two names.
  const AUTO_NOTE = /automated|auto-?\s*eval/i;

  // An automated run says which kind of run it was in its own words - a clean
  // one is the standing "All checks have passed", a dirty one names what
  // failed. Its timestamp does not say, because a passing run can carry one
  // too, so the verdict is read from the message and never from the clock.
  function autoVerdict(text) {
    const t = text || '';
    if (/\bfail(ed|ing|ure|s)?\b|\bdid not pass\b|\bnot passed\b/i.test(t)) return 'failed';
    if (/\bpass(ed|es|ing)?\b/i.test(t)) return 'passed';
    return null;
  }

  // Which feedback the task is waiting on, and so what the reader should be on.
  //
  //   newest note is the automated run and it reports a failure
  //     -> the auto-checking is what is blocking. The answer is in the
  //        auto-evaluation results below the golden solution upload, not in
  //        anybody's wording, so those are what the block leads with.
  //   newest note is the reviewer's, or is an automated run that all passed
  //     -> the auto-checking is satisfied and what is left is the quality of
  //        the content, so the reviewer's feedback is what the block leads with.
  function decideFocus(notes) {
    const latest = markLatest(notes);
    const autos = notes.filter((n) => AUTO_NOTE.test(n.title));
    const human = notes.filter((n) => !AUTO_NOTE.test(n.title));

    // The automated run only gets to decide when it is the newest note. On a
    // page whose notes carry no timestamps at all there is no newest note, so
    // the automated run is read on its own verdict instead.
    const auto = latest ? (AUTO_NOTE.test(latest.title) ? latest : null) : newestOf(autos);
    const verdict = auto ? autoVerdict(auto.text) : null;

    const newestAuto = newestOf(autos);
    const overall = newestAuto ? autoVerdict(newestAuto.text) : null;
    const autoEvalPassed = overall === null ? null : overall === 'passed';

    let focus = null;
    if (auto && verdict !== 'passed') {
      // An unreadable automated run is treated as a failing one: it is the
      // newest word on the task and it is not the standing all-clear.
      focus = {
        on: 'auto-evaluation',
        note: auto,
        why: verdict === 'failed'
          ? 'The newest note is the automated run and it reports a failure, so the auto-checking is what this task is waiting on. The answer is in the auto-evaluation results below the golden solution upload, not in the wording.'
          : 'The newest note is the automated run and it does not say the checks passed, so read it as the auto-checking still blocking. Start from the auto-evaluation results below the golden solution upload.'
      };
    } else {
      const lead = latest && !AUTO_NOTE.test(latest.title) ? latest : newestOf(human) || latest;
      if (lead) {
        focus = {
          on: 'reviewer feedback',
          note: lead,
          why: auto
            ? 'The automated run says all checks passed, so the auto-checking is not what is blocking. What is left is the quality of the content, and this feedback is what to work from.'
            : 'The newest note is a person\'s, not the machine\'s, so the auto-checking is behind it. What is left is the quality of the content, and this feedback is what to work from.'
        };
      }
    }

    if (focus) focus.note.focus = true;
    return { latest, focus, autoEvalPassed };
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

      // A failing automated run used to be dropped as noise. It is the opposite:
      // when the auto-evaluation does not pass it becomes the newest note on the
      // page, and it is the thing that says what state the task is actually in.

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

  const CHECK_BUTTON = /^check\s+feedback\b/i;

  // A check field is one carrying a "Check feedback" button. Most say so in
  // their testid; the button itself is the authority where the testid does not,
  // so a renamed wrapper cannot hide a check from the sweep.
  function checkFields() {
    const out = [];
    for (const f of document.querySelectorAll('[data-testid^="field-"]')) {
      const byId = /feedbackbutton/i.test(f.getAttribute('data-testid') || '');
      const byButton = Array.from(f.querySelectorAll('button')).some((b) => CHECK_BUTTON.test(buttonText(b)));
      if (byId || byButton) out.push(f);
    }
    return out;
  }

  function checkRunButton(field) {
    return Array.from(field.querySelectorAll('button'))
      .find((b) => !b.disabled && CHECK_BUTTON.test(buttonText(b))) || null;
  }

  function checkFinished(field) {
    if (field.querySelector('[class*="bg-success-subtle"], [class*="bg-error-subtle"]')) return true;
    return Array.from(field.querySelectorAll('button'))
      .some((b) => /clear feedback/i.test(buttonText(b)));
  }

  // The editable User Prompt box. Refinement has none - it shows the prompt it
  // is revising as read-only text - so its absence is not an empty prompt.
  function promptBox() {
    return document.querySelector('[data-testid="field-prompt"] textarea')
      || Array.from(document.querySelectorAll('[data-testid^="field-"]'))
        .find((f) => /^user prompt$/i.test(fieldLabel(f)))?.querySelector('textarea')
      || null;
  }

  function promptText() {
    return (promptBox()?.value || '').trim();
  }

  // Press every check that has not run, then wait for all of them to answer.
  // The results are read afterwards by the usual pass/fail sweep.
  async function runFeedbackChecks({ timeout = 180000 } = {}) {
    const pending = [];

    const clicked = new Set();
    for (const field of checkFields()) {
      if (checkFinished(field)) continue;
      const btn = checkRunButton(field);
      // A field nested in another finds the same button twice; press it once.
      if (!btn || clicked.has(btn)) continue;
      clicked.add(btn);
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      pending.push({ field, label: fieldLabel(field) });
      await wait(250); // stagger, rather than firing them all at once
    }

    const started = pending.length;
    if (!started) return { started: 0, answered: 0, waiting: [] };

    let left = pending;
    try {
      checkProgress = { phase: 'checks', index: 0, total: started };
      const SLICE = 500;
      let deadline = Date.now() + timeout;

      while (left.length && Date.now() < deadline) {
        checkCancelled();
        const before = Date.now();
        await wait(SLICE);
        // A slice that took far longer than it asked for means the tab was
        // suspended, not that the server was slow. Those minutes were never the
        // server's to spend, so hand them back - otherwise a catch left alone in a
        // background tab runs out of patience on checks it never actually waited
        // for, and reads a page whose answers are still on their way.
        const lost = Date.now() - before - SLICE;
        if (lost > 2000) deadline += lost;
        left = left.filter((p) => !checkFinished(p.field));
        checkProgress = { phase: 'checks', index: started - left.length, total: started };
      }
    } finally {
      checkProgress = null;
    }
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
    // Everything from here down is an auto-evaluation result, the run of
    // boxes that sits below the golden solution upload. When the auto-checking
    // is what a task is waiting on, these are the answer, so they are flagged
    // to be led with rather than left at the foot of the block.
    { auto: true, match: /^auto-evaluation golden solution submission feedback$/ },
    { auto: true, match: /^auto-evaluation difficulty submission feedback$/ },
    { auto: true, match: /^auto-evaluation input output check submission feedback$/ },
    { auto: true, match: /^auto-evaluation check: prompt and input files self-contained/ },
    { auto: true, match: /^verifier$/ },
    { auto: true, match: /^audit$/ },
    { auto: true, match: /^audit: rubric and golden solution alignment$/ },
    { auto: true, match: /^safety check$/ },
    { auto: true, match: /^auto-evaluation llm generated files check/ },
    { auto: true, match: /^auto-evaluation rubric quality check submission feedback$/ },
    { auto: true, match: /^golden solution leakage check$/ },
    { auto: true, match: /^rubric golden alignment check$/ },
    { auto: true, match: /^rubric value grounding check$/ }
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
        else list.push(want.auto ? { label: f.label, value, auto: true } : { label: f.label, value });
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

  /* ---------- Rudder: preference comparison tasks ----------
     A Rudder task is a different page altogether. The left half shows the
     conversation and the two candidate responses; the right half is a form of
     rating scales, failure-mode flag lists and written explanations; the task
     notes live in a sidebar of their own. There is no criteria list, so none of
     the reading above applies to it - but the field wrapper, the accordions and
     the typing behave exactly as they do on a Geranium page, so those are
     shared rather than written a second time. */

  const LEFT_PANEL = '[data-testid="document-review-left-panel"]';
  const RICH_DOC = '[data-testid="rich-doc-rendered"]';
  const NOTES_PANEL = '[data-testid="collapsible-sidebar-panel"]';
  const NOTES_TOGGLE = 'button[aria-label="task-notes"]';
  const FIELD = '[data-testid^="field-"]';
  const SECTION = '[data-testid^="section-"]';

  const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const norm = (s) => oneLine(s).toLowerCase();

  function blockText(el) {
    return (el?.innerText || el?.textContent || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Some option labels are kept as escaped HTML in an aria-label. Parsed in a
  // document of its own rather than assigned to innerHTML, so nothing in the
  // markup can load or run while we are only after the words.
  function textOfMarkup(markup) {
    if (!markup) return '';
    if (!/[<&]/.test(markup)) return oneLine(markup);
    try {
      const doc = new DOMParser().parseFromString(markup, 'text/html');
      return oneLine(doc.body.textContent);
    } catch {
      return oneLine(markup.replace(/<[^>]*>/g, ' '));
    }
  }

  function isRudderPage() {
    return !!(document.querySelector(LEFT_PANEL)
      || document.querySelector('[data-testid="document-review-primary-submit"]')
      || document.querySelector('[data-testid^="section-Rating Assessment"]'));
  }

  // Which project's page this is. The criteria list belongs to Geranium alone
  // and the split document review to Rudder, so either one settles it on its
  // own; the heading is consulted only when neither has mounted yet.
  function detectProject() {
    if (document.querySelector(CONTAINER)) return { project: 'geranium', source: 'the criteria list' };
    if (isRudderPage()) return { project: 'rudder', source: 'the review layout' };
    if (/\brudder\b/i.test(headingText())) return { project: 'rudder', source: 'the page heading' };
    if (detectMode().mode) return { project: 'geranium', source: 'the page heading' };
    return { project: null, source: 'unknown' };
  }

  /* ---------- Rudder: the fields ---------- */

  function rudderKey(fieldEl) {
    return (fieldEl.getAttribute('data-testid') || '').replace(/^field-/, '') || null;
  }

  function rudderFields(root = document) {
    return Array.from(root.querySelectorAll(FIELD)).filter((f) => rudderKey(f));
  }

  // Three shapes cover the whole form: a single choice on a scale, a list of
  // failure-mode flags to tick, and something to write in.
  function rudderKind(fieldEl) {
    if (fieldEl.querySelector('[role="radiogroup"], input[type="radio"]')) return 'choice';
    if (fieldEl.querySelector('[role="checkbox"]')) return 'flags';
    if (fieldEl.querySelector('textarea')) return 'text';
    if (fieldEl.querySelector('input:not([type="hidden"]), select')) return 'value';
    return 'other';
  }

  // A rating scale keeps its real value in an input beside the button that is
  // actually clicked: "5", "not_applicable", "A > B". That value is what the
  // page stores, so it is what the answers are written in.
  function radioOptions(fieldEl) {
    return Array.from(fieldEl.querySelectorAll('input[type="radio"]')).map((input) => {
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
  function rudderLabel(fieldEl) {
    const lab = fieldLabel(fieldEl);
    if (lab) return lab;
    const { question } = describeField(fieldEl);
    return question ? question.replace(/[:.]\s*$/, '') : rudderKey(fieldEl);
  }

  function readRudderField(fieldEl) {
    const key = rudderKey(fieldEl);
    if (!key) return null;

    const kind = rudderKind(fieldEl);
    const { question, guidelines } = describeField(fieldEl);
    const out = { key, label: rudderLabel(fieldEl), kind };
    if (question) out.question = question;
    if (guidelines && guidelines !== question) out.guidelines = guidelines;

    if (kind === 'choice') {
      const opts = radioOptions(fieldEl);
      out.options = opts.map((o) => ({ value: o.value, text: o.text }));
      const picked = opts.find((o) => o.checked);
      out.answer = picked ? picked.value : null;
      if (picked) out.answerText = picked.text;
    } else if (kind === 'flags') {
      const opts = flagOptions(fieldEl);
      out.options = opts.map((o) => ({ text: o.text }));
      out.answer = opts.filter((o) => o.checked).map((o) => o.text);
    } else {
      const v = fieldValue(fieldEl);
      out.answer = v === '' ? null : v;
    }
    return out;
  }

  /* ---------- Rudder: the task itself ---------- */

  // The notes sidebar can be shut, and a shut sidebar is not in the DOM at all,
  // so nothing about the feedback can be read until its toggle is pressed.
  async function openNotes() {
    if (document.querySelector(NOTES_PANEL)) return false;
    const btn = document.querySelector(NOTES_TOGGLE);
    if (!btn || btn.disabled) return false;
    btn.click();
    await until(() => document.querySelector(NOTES_PANEL), { timeout: 2500 });
    return true;
  }

  // Each note is an accordion headed by who left it and when. A reviewer's note
  // carries a question of its own underneath - whether the annotator disagrees
  // with it - and that question, answered or not, is part of what it says.
  function readRudderNotes() {
    const panel = document.querySelector(NOTES_PANEL);
    if (!panel) return [];

    const out = [];
    for (const btn of panel.querySelectorAll('button[aria-expanded]')) {
      const { title, time } = noteHeading(btn);
      if (!title) continue;

      const id = btn.getAttribute('aria-controls');
      const region = (id && document.getElementById(id))
        || btn.closest('[data-index]')?.querySelector('[role="region"]');
      if (!region) continue;

      const body = region.querySelector('[class*="whitespace-pre-line"]');
      let text = blockText(body || region);
      const asks = [];
      for (const box of region.querySelectorAll('[role="checkbox"]')) {
        const label = oneLine(box.innerText || box.textContent || '')
          || textOfMarkup(box.getAttribute('aria-label'));
        if (!label) continue;
        asks.push({ question: label, answer: box.getAttribute('aria-checked') === 'true' });
        // With no body of its own, the region's text ends with this question.
        if (!body && text.endsWith(label)) text = text.slice(0, -label.length).trim();
      }
      if (!text && !asks.length) continue;

      const note = time ? { title, time, text } : { title, text };
      if (asks.length) note.asks = asks;
      out.push(note);
    }
    markLatest(out);
    return out;
  }

  // The heading that introduces a block - "Context", "Response A" - sits above
  // it rather than inside it, so climb out until a heading that precedes it
  // turns up, and take the nearest one.
  function headingAbove(el, stop) {
    for (let node = el; node && node !== stop; node = node.parentElement) {
      const parent = node.parentElement;
      if (!parent) break;
      const head = Array.from(parent.querySelectorAll('h1, h2, h3, h4, h5, h6'))
        .filter((h) => !h.contains(el)
          && (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
        .pop();
      if (head) return oneLine(head.textContent);
      if (parent === stop) break;
    }
    return null;
  }

  // The conversation and the two responses, each under the heading it is shown
  // with. A page laid out some other way still gives up its text in one piece.
  function readRudderDocs() {
    const panel = document.querySelector(LEFT_PANEL);
    if (!panel) return [];

    const docs = Array.from(panel.querySelectorAll(RICH_DOC));
    if (!docs.length) {
      const text = blockText(panel);
      return text ? [{ title: 'Task', text }] : [];
    }
    return docs
      .map((doc, i) => ({
        title: headingAbove(doc, panel) || `Part ${i + 1}`,
        text: blockText(doc)
      }))
      .filter((d) => d.text);
  }

  function sectionIntro(sec) {
    const desc = Array.from(sec.querySelectorAll('[class*="_description_"]'))
      .find((d) => !d.closest(FIELD));
    return blockText(desc) || null;
  }

  function readRudderSections() {
    const out = [];
    for (const sec of document.querySelectorAll(SECTION)) {
      const name = oneLine((sec.getAttribute('data-testid') || '').replace(/^section-/, ''));
      const fields = rudderFields(sec).map(readRudderField).filter(Boolean);
      if (!fields.length) continue;
      const block = { name: name || 'Section', fields };
      const intro = sectionIntro(sec);
      if (intro) block.intro = intro;
      out.push(block);
    }

    // Anything the page asks outside a section still has to be answered.
    const loose = rudderFields().filter((f) => !f.closest(SECTION))
      .map(readRudderField).filter(Boolean);
    if (loose.length) out.push({ name: 'Other questions', fields: loose });
    return out;
  }

  function isAnswered(answer) {
    if (Array.isArray(answer)) return answer.length > 0;
    return answer !== null && answer !== undefined && answer !== '';
  }

  async function readRudder() {
    await openNotes();
    // Sections, notes and the response panes are all accordions, and a closed
    // one has no content in the DOM to be read.
    const opened = await expandEverything();

    const notes = readRudderNotes();
    const documents = readRudderDocs();
    const sections = readRudderSections();

    if (!sections.length && !documents.length) {
      throw new Error('Nothing found on this page - no task text and no rating form. Is this a Rudder task?');
    }

    // The answers as the page holds them now, in the order it asks for them.
    // First time round they are all empty; on a revision this is the work being
    // sent back, and it is what the next answer is edited from.
    const answers = {};
    let answered = 0;
    for (const sec of sections) {
      for (const f of sec.fields) {
        answers[f.key] = f.answer === undefined ? null : f.answer;
        if (isAnswered(f.answer)) answered++;
      }
    }

    const uid = readUid();
    const content = {
      title: headingText() || null,
      stage: answered || notes.length ? 'revision' : 'first pass'
    };
    if (notes.length) {
      content.taskNotes = notes;
      const latest = notes.find((n) => n.latest);
      if (latest) content.latestNote = { title: latest.title, time: latest.time || null };
    }
    if (documents.length) content.documents = documents;
    content.sections = sections;

    const data = { project: 'rudder', stage: content.stage };
    if (uid) data.uid = uid;
    data.content = content;
    data.answers = answers;

    return {
      data,
      meta: {
        project: 'rudder',
        opened,
        fields: Object.keys(answers).length,
        answered,
        notes: notes.length,
        documents: documents.length
      }
    };
  }

  /* ---------- Rudder: writing the answers back ---------- */

  function findRudderField(key) {
    const want = String(key);
    const fields = Array.from(document.querySelectorAll(FIELD));
    return fields.find((f) => rudderKey(f) === want)
      || fields.find((f) => norm(rudderLabel(f)) === norm(want))
      || null;
  }

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
  async function setFlags(fieldEl, value, base) {
    const wanted = flagList(value);
    const names = flagOptions(fieldEl).map((o) => o.text);
    if (!names.length) return { ok: false, why: 'no flags to tick' };

    const unknown = wanted.filter((w) => !names.some((n) => sameFlag(w, n)));
    let stuck = 0;

    for (const name of names) {
      checkCancelled();
      const on = wanted.some((w) => sameFlag(w, name));
      const now = flagOptions(fieldEl).find((o) => o.text === name);
      if (!now || now.checked === on) continue;

      now.box.scrollIntoView({ block: 'center' });
      await wait(base * 6);
      now.box.click();
      const settled = await until(
        () => flagOptions(fieldEl).find((o) => o.text === name)?.checked === on,
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
  function normalizeAnswers(input) {
    let data = input;
    if (typeof data === 'string') data = JSON.parse(data);

    if (Array.isArray(data)) {
      const out = {};
      for (const row of data) {
        if (row && typeof row === 'object' && row.key) out[row.key] = row.answer ?? row.value ?? null;
      }
      if (!Object.keys(out).length) throw new Error('No answers found - each row needs a "key".');
      return out;
    }
    if (!data || typeof data !== 'object') {
      throw new Error('JSON must be an object of answers, keyed by field name.');
    }
    if (data.answers && typeof data.answers === 'object') return data.answers;
    if (Array.isArray(data.criteria)) {
      throw new Error('That is a Geranium criteria list. Switch the project to Geranium to use it.');
    }
    return data;
  }

  async function applyRudder(input, options = {}) {
    if (busy) throw new Error('Already typing. Press Stop first.');

    const answers = normalizeAnswers(input);
    // A key left empty is a question deliberately not being answered, so only
    // what the answer actually says is written to the page.
    const rows = Object.entries(answers)
      .filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (!rows.length) throw new Error('No answers to write - every field was left empty.');
    if (!isRudderPage()) throw new Error('This does not look like a Rudder task page.');

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
        let fieldEl = await until(() => findRudderField(key), { timeout: 1200, step: 100 });
        if (!fieldEl) {
          await expandEverything();
          fieldEl = findRudderField(key);
        }
        if (!fieldEl) { skippedFields.push(key); continue; }

        const kind = rudderKind(fieldEl);
        if (kind === 'choice') {
          const r = await setChoice(fieldEl, value, base);
          if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
        } else if (kind === 'flags') {
          const r = await setFlags(fieldEl, value, base);
          if (r.unknown?.length) unknownFlags.push(`"${key}": ${r.unknown.join('; ')}`);
          if (r.ok) filled++; else refused.push(`"${key}" - ${r.why}`);
        } else {
          const ctl = control(fieldEl);
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
      project: 'rudder',
      requested: rows.length,
      filled,
      ranInBackground: hiddenDuringRun,
      skippedFields,
      truncated,
      refused,
      unknownFlags
    };
  }

  /* ---------- operations ---------- */

  // Everything below runs for as long as the page takes, so hold the tab awake
  // for the whole of it rather than per step.
  //
  // Which reader runs is the panel's call - it is the one that asked the user -
  // and the page's own answer is only the fallback for a message that did not
  // say.
  async function extract(options = {}) {
    const project = options.project || detectProject().project;
    stayAwake();
    try {
      return project === 'rudder' ? await readRudder() : await readPage(options);
    } finally {
      letSleep();
    }
  }

  async function readPage(options = {}) {
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
    // written yet, so its criteria are read from the Provided Rubrics document
    // further down rather than from the empty list.
    const notStartedYet = mode === 'refinement' && !boardFilled;

    // Whether to press the checks is the page's answer, not a guess from the
    // form: a check with an enabled "Check feedback" button has not been asked
    // yet, and asking it is the whole point of the catch.
    //
    // It used to be guessed, and both guesses were wrong on a Refinement page
    // exactly when it mattered - on the first catch. Its criteria list opens
    // empty, which read as "nothing to judge", and its prompt is read-only, so
    // the empty-prompt gate fired as well. Between them nothing was ever
    // pressed on a refinement task, which is the one page that arrives with its
    // checks unrun.
    let checks = null;
    let checksSkipped = null;
    const fields = checkFields();
    const unanswered = fields.filter((f) => !checkFinished(f));
    const runnable = unanswered.filter((f) => checkRunButton(f));
    const box = promptBox();
    if (options.runChecks === false) checksSkipped = 'turned off';
    else if (!fields.length) checksSkipped = 'no checks on this page';
    else if (!unanswered.length) checksSkipped = 'already answered';
    // A check still waiting to be asked, behind a button the page has disabled,
    // is not the same as one that has answered - and saying nothing about it is
    // how a catch that pressed nothing passes for a catch that had nothing to
    // press.
    else if (!runnable.length) checksSkipped = 'the buttons are disabled';
    // Only where the page has a prompt box of its own to be empty.
    else if (box && !promptText()) checksSkipped = 'no prompt yet';
    else checks = await runFeedbackChecks();

    // A verdict that lands while the checks are answering can mount inside a
    // section that was shut, or that did not exist during the first sweep.
    if (checks?.started) await expandEverything();

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
    // A refinement whose criteria are written is a revision under way. The
    // correction feedback describes the task before that work, so it is stale
    // once the criteria exist; the automated run is what speaks to the task now.
    const revisionUnderWay = mode === 'refinement' && boardFilled;

    const notes = await readNotes();
    const { named, list } = readFields();

    // Submission and Review label it "Sector"; Refinement says "Task Sector".
    const sector = readLabelledBlock('Sector', 'Task Sector');
    const occupation = readLabelledBlock('Task Occupation');
    const tier = readLabelledBlock('Tier Type', 'Tier');
    const areasOfFocus = readLabelledBlock('Areas of Focus of Feedback');

    // Refinement carries its feedback as headed blocks, not accordions.
    const headed = [['AutoEval Feedback'], ['Agentic Rubric Quality Check']];
    if (!revisionUnderWay) headed.unshift(['Correction Feedback'], ['Feedback to Improve Task']);

    for (const [title, ...aliases] of headed) {
      const text = readLabelledBlock(title, ...aliases);
      if (text && !notes.some((n) => n.title === title)) notes.push({ title, text });
    }

    // What the task is waiting on decides what the reader should be looking at,
    // so work it out here, once the headed blocks have joined the accordions.
    const { latest: latestNote, focus, autoEvalPassed } = decideFocus(notes);

    if (!criteria.length && !uid && !notes.length && !sector && !list.length) {
      throw new Error('Nothing found on this page - no criteria, UID, sector or task notes.');
    }

    const content = {};
    if (notes.length) content.taskNotes = notes;
    if (latestNote) {
      content.latestNote = { title: latestNote.title, time: latestNote.time || null };
    }
    if (focus) {
      content.focus = {
        on: focus.on,
        why: focus.why,
        note: { title: focus.note.title, time: focus.note.time || null }
      };
    }
    if (autoEvalPassed !== null) content.autoEvalPassed = autoEvalPassed;
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
    // Say so in the content itself, not only in the panel: a block that is
    // copied away should admit that it was read before every check had answered.
    if (checks?.waiting?.length) content.pendingChecks = checks.waiting;

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
    stayAwake();
    progress = { index: 0, total: rows.length, phase: 'starting', unit: 'criterion' };

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
        progress = { index: i + 1, total: rows.length, phase: 'typing', unit: 'criterion' };

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
      letSleep();
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
              project: detectProject(),
              rudderFields: isRudderPage() ? rudderFields().length : 0,
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
          case 'APPLY': {
            const project = msg.options?.project || detectProject().project;
            const result = project === 'rudder'
              ? await applyRudder(msg.data, msg.options)
              : await apply(msg.data, msg.options);
            sendResponse({ ok: true, result });
            break;
          }
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
