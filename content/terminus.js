/* Criteria Catcher - page side: Terminus-3rd.

   A Terminal Bench 3.0 task is uploaded as a zip, and everything worth
   carrying off the page is what the machine said about it: the task notes,
   the Quality Judge Panel, the Oracle / NOP run, the Summary, and whichever
   lines of the quality check summary did not pass. There is nothing to type
   back in. Only Submission has been seen so far; a Review page is read the
   same way until it shows something of its own. */

/* Needs core.js. */

// Labels are what the page shows; the testids are the page's own names for
// the same boxes, and either finds them.
const TERMINUS_FIELDS = [
  { key: 'qualityPanel', id: 'quality_panel_judge_feedback', label: /^quality judge panel feedback$/ },
  { key: 'oracleNop', id: 'oracle_nop_validation', label: /^oracle\s*\/\s*nop validation$/ },
  { key: 'summary', id: 'text_summary', label: /^summary$/ },
  { key: 'qualityChecks', id: 'quality_check_summary', label: /^quality check summary$/ }
];

function isTerminusPage() {
  if (TERMINUS_FIELDS.some((f) => document.querySelector(`[data-testid="field-${f.id}"]`))) return true;
  return Array.from(document.querySelectorAll('label, h1, h2, h3'))
    .some((el) => /terminal\s*bench/i.test(el.textContent || ''));
}

function terminusStage() {
  return /^review$/i.test(headingText()) ? 'review' : 'submission';
}

function terminusField(want) {
  const byId = document.querySelector(`[data-testid="field-${want.id}"]`);
  if (byId) return byId;
  return Array.from(document.querySelectorAll('[data-testid^="field-"]'))
    .find((f) => want.label.test(fieldLabel(f).toLowerCase())) || null;
}

// The quality check summary is a list of "✅ pass - verifiable: …" lines
// under "## …" headings, most of them passes. Only what did not pass is
// worth the reader's time, with the heading it sat under; an explanation
// that runs onto following lines stays with its check.
const QC_LINE = /^\s*(?:[^\w\s]+\s*)?(pass(?:ed)?|fail(?:ed|ure)?|warn(?:ing)?|error|skip(?:ped)?|n\/a|not[_ ]applicable)\b\s*[-–—:]\s*(.*)$/i;

function failedQualityChecks(text) {
  let section = null;
  let total = 0;
  let current = null;
  const failed = [];
  for (const line of String(text).split('\n')) {
    const heading = line.match(/^\s*#+\s*(.+?)\s*$/);
    if (heading) { section = heading[1]; current = null; continue; }
    const m = line.match(QC_LINE);
    if (m) {
      total++;
      const ok = /^(pass|n\/a|not|skip)/i.test(m[1]);
      current = ok ? null : { section, text: line.trim() };
      if (current) failed.push(current);
    } else if (current && line.trim()) {
      current.text += `\n${line.trim()}`;
    } else if (!line.trim()) {
      current = null;
    }
  }
  return { total, failed };
}

// The zip's download button. It is not always worded: it can be an icon
// alone, or a chip that shows only the file's name and links to it. So every
// way an element can say "download" counts - its text, its aria-label or
// title, its testid, a download icon inside it, a `download` attribute, or a
// link to an archive - and one naming a file or zip is preferred.
const ARCHIVE = /\.(zip|tar|tgz|gz)(\?|#|$)/i;

function downloadSignals(el) {
  const words = [
    buttonText(el),
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.getAttribute('data-testid')
  ].filter(Boolean).join(' ');
  const icon = Array.from(el.querySelectorAll('svg, i, [data-icon]'))
    .some((i) => /download/i.test(`${i.getAttribute('class') || ''} ${i.getAttribute('data-icon') || ''} ${i.getAttribute('aria-label') || ''}`));
  const href = el.getAttribute('href') || '';
  const says = /download/i.test(words) || icon || el.hasAttribute('download')
    || ARCHIVE.test(href) || /\/download\b/i.test(href);
  return { says, words, archive: ARCHIVE.test(href) || /\.zip\b/i.test(words) };
}

// The button that matters sits in its own field, "Download difficulty check
// results", reading "Download File". Earlier on the page the uploaded zip
// shows as a file chip that also says "download" and names a zip, and in page
// order it won - so the field comes first, the button's own wording next, and
// everything else only when neither is there.
const DOWNLOAD_FIELD = /^download\b/i;

function findDownloadButton() {
  return Array.from(document.querySelectorAll('button, a, [role="button"]'))
    // Nested clickables would find the same control twice; keep the outer.
    .filter((el) => !el.parentElement?.closest('button, a, [role="button"]'))
    .map((el) => ({ el, ...downloadSignals(el) }))
    .filter((x) => x.says)
    .map((x) => {
      const field = x.el.closest('[data-testid^="field-"]');
      const label = field ? fieldLabel(field) : '';
      const text = buttonText(x.el);
      let rank;
      if (DOWNLOAD_FIELD.test(label)) rank = 0;
      else if (/^download file$/i.test(text)) rank = 1;
      else rank = 2 + (x.archive || /file|zip/i.test(x.words) ? 0 : 1);
      if (!isVisible(x.el)) rank += 10;
      return {
        el: x.el,
        // Scroll the whole field, so its heading shows above the button.
        at: DOWNLOAD_FIELD.test(label) ? field : x.el,
        t: text || x.el.getAttribute('aria-label') || x.el.getAttribute('title') || 'download',
        field: DOWNLOAD_FIELD.test(label) ? label : null,
        rank
      };
    })
    .sort((a, b) => a.rank - b.rank)[0] || null;
}

async function readTerminus() {
  const opened = await expandEverything();

  // "Fast static checks" sits behind a Check feedback button, but a catch
  // never presses it here: the feedback worth having is what the submit
  // already produced. A result someone else asked for is still read below.
  const notes = await readNotes();
  markLatest(notes);
  const autos = notes.filter((n) => AUTO_NOTE.test(n.title));
  const newestAuto = newestOf(autos);
  const verdict = newestAuto ? autoVerdict(newestAuto.text) : null;

  const found = {};
  for (const want of TERMINUS_FIELDS) {
    const el = terminusField(want);
    if (!el) continue;
    const value = fieldValue(el);
    if (typeof value !== 'string' || !value.trim() || /^no code provided$/i.test(value.trim())) continue;
    found[want.key] = value.trim();
  }

  const stage = terminusStage();
  const content = { stage };
  if (notes.length) {
    content.taskNotes = notes;
    const latest = notes.find((n) => n.latest);
    if (latest) content.latestNote = { title: latest.title, time: latest.time || null };
  }
  if (verdict) content.autoEvalPassed = verdict === 'passed';
  if (found.qualityPanel) content.qualityPanel = found.qualityPanel;
  if (found.oracleNop) content.oracleNop = found.oracleNop;

  // The Summary repeats the whole Quality Judge Panel under a line or two of
  // its own. Those lines are the Summary; the repeat is already above.
  if (found.summary) {
    let summary = found.summary;
    if (found.qualityPanel && summary.includes(found.qualityPanel)) {
      summary = summary.replace(found.qualityPanel, '').replace(/\n{3,}/g, '\n\n').trim();
      content.summaryRepeatsPanel = true;
    }
    if (summary) content.summary = summary;
  }

  if (found.qualityChecks) {
    const { total, failed } = failedQualityChecks(found.qualityChecks);
    // A summary laid out some other way is kept whole rather than guessed at.
    content.qualityChecks = total
      ? { total, failed }
      : { total: 0, failed: [], text: found.qualityChecks };
  }

  const failedChecks = readCheckResults().filter((r) => !r.passed);
  if (failedChecks.length) content.failedStaticChecks = failedChecks;

  const uid = readUid();
  if (!uid && !notes.length && !Object.keys(found).length) {
    throw new Error('Nothing found on this page - no UID, task notes or feedback. Is this a Terminus task?');
  }

  const data = { project: 'terminus', stage };
  if (uid) data.uid = uid;
  data.content = content;

  // Everything is read; leave the page at the download button, which is
  // where the work goes next.
  // The file list can render after the rest of the page, so give it a moment.
  const download = await until(findDownloadButton, { timeout: 4000, step: 200 });
  download?.at.scrollIntoView({ block: 'center' });

  return {
    data,
    meta: {
      project: 'terminus',
      opened,
      notes: notes.length,
      found: Object.keys(found),
      download: download ? download.t : null,
      downloadField: download?.field || null
    }
  };
}

/* ---------- registration ---------- */

// Only read from: the task is a zip, so there is nothing to type back in.
PAGE_PROJECTS.terminus = {
  detect: () => (isTerminusPage() ? 'its feedback boxes' : null),
  read: readTerminus,
  ping: () => ({ terminusStage: isTerminusPage() ? terminusStage() : null })
};
