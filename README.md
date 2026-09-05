# Criteria Catcher

Chrome extension (MV3) that runs in the browser's **side panel**: **Catch
criteria** reads a task page into a copyable block, and **Paste into page**
fills the criteria back in one field at a time.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder
4. Pin the extension, open the task page, click the icon

The icon opens a side panel docked to the right of the window. It is a browser
panel, not an overlay: the page is given the remaining width rather than being
covered, the panel runs the full height of the window, and it stays put while
the page scrolls. Drag its inner edge to resize. Needs Chrome 116 or newer.

Nothing runs until you open the panel — the page script is injected on demand
under `activeTab`, so the extension has no access to any other site.

## One session per tab

The panel belongs to the tab it was opened on. Chrome's default is one panel per
window that follows you from tab to tab; that default is switched off and the
panel is enabled only for the tab whose icon you clicked, so:

- switching to another tab does not bring the panel with you;
- opening it on that tab starts a **fresh session** — no result, empty input;
- coming back to the first tab restores exactly what was there;
- closing a tab discards its session.

State is filed under the tab id in `chrome.storage.session`, so it lives as long
as the browser session and never reaches disk.

## While it is working

**Catching** replaces the result boxes with a **skeleton** — shimmering
placeholder bars in the shape of the UID and Content boxes — until the page has
been read.

**Filling** covers the panel with a centred working card: a pulsing indicator,
the current step (`typing criterion 4 of 12…`) and a **Stop** button. The rest of
the UI, the input box included, is dimmed and cannot be edited until the run
finishes or is stopped, so the JSON cannot change underneath a run in progress.

Both respect `prefers-reduced-motion`.

## Page type

Three radio buttons at the top — **Submission**, **Review**, **Refinement** —
set from the page itself when the popup opens:

| Page | Detected as |
|---|---|
| `<h1>Review</h1>` | Review |
| `<h1>Submission</h1>` + "In this **prompt generation** project…" | Submission |
| `<h1>Submission</h1>` + "In this **refinery** project…" | Refinement |

Review is the only one the heading settles on its own. **Submission and
Refinement pages carry the identical heading "Submission"** — the blurb under it
is the only thing that separates them, so detection works like this:

1. Heading exactly "Review" → Review, and nothing else is consulted.
2. Otherwise the blurb decides: "refinery project" → Refinement,
   "prompt generation project" → Submission.
3. If both phrases appear, **Refinement wins** — a refinement page shows the task
   it is revising and so can quote the submission wording, never the reverse.
4. The blurb is looked for in the usual `div.text-base-normal` / `<p>` wrapper
   first, then anywhere in the page text, so a markup change does not blind it.
5. Nothing matched → no radio is set and the hint says to pick one.

Picking one by hand stops auto-selection overriding you for the rest of that
popup session; the hint line says whether the heading, the blurb, or you decided.

## Collapsed sections

A task page can open with sections shut — "Section 2 - Golden Solution and
Rubric", "Section 3 - AHT" and so on — and Radix keeps a closed section's
content out of the DOM entirely. Nothing inside one can be read or filled while
it is shut, so both buttons open everything first, repeatedly: opening a section
reveals the accordions nested inside it, which may themselves be closed.

Only accordions are touched. The page marks checkbox and radio items with the
same `data-radix-collection-item` attribute, so the trigger has to be identified
by `aria-expanded` — those items carry `data-state="unchecked"` and no
`aria-expanded`, and clicking one would tick a box on the form. Menu buttons are
skipped for the same reason, and each trigger is clicked at most once so a slow
one cannot be toggled shut again.

## The two buttons

**Catch criteria** — reads the page into the result panel: the UID on its own,
and everything else as one copyable block. Collapsed sections are opened first.

**Paste / Type into page** — works through the form the way a person does:
criterion 1's text, then its weight, then on to criterion 2. Never all fields at
once. Whatever is already in a field is cleared first.

**Entry** picks how each field is filled:

- **Paste per field** (default) — the whole value lands in one go, as a paste
  does, with a beat before the next field. This is the fast, ordinary way to
  work through a form.
- **Type per key** — one character at a time, with `keydown` / `beforeinput` /
  `input` / `keyup` per keystroke and variable gaps (longer after punctuation,
  shorter mid-word, the occasional pause). Slower, but the page sees a genuine
  typing rhythm.

Either way the page's own validation, character counter and autosave fire
exactly as they do for a person.

**Pace** sets the keystroke rhythm when typing. **Gap** sets how long it waits
after each field before moving to the next — 0.5s, 1s, **2s (default)** or 4s —
so the page has time to validate, autosave and settle between entries.

The gap is what governs how long a run takes: roughly (criteria x 2 fields) x
gap. Thirty criteria at the 2s default is about two minutes. Stop takes effect
within a tenth of a second even mid-gap.

While it runs the button turns into **Stop** and the status line shows
`typing 4/12…`. You can close the panel; the run continues, and reopening it
picks the progress back up.

**Switching tabs mid-run.** Chrome slows a hidden tab's timers, and the page's
own re-render runs on those same timers - so a section that mounts in half a
second in front can take many seconds behind. Waits on the page therefore stretch
while the tab is behind, rather than declaring a failure that never happened and
ending the run. The result says when part of a run happened in the background.

Even so, a run is fastest and most reliable with the tab in front, and Chrome can
throttle a long-hidden tab hard enough to stall one.

## Running out of sections

Sections are filled in order. When the JSON has more entries than the page has
sections, the extension clicks the page's own **Add criterion** button, waits for
the new section to mount, and types into it — one at a time, at the point it is
needed, not all up front.

**Remove extra sections** (on by default) deletes trailing sections when the JSON
has fewer entries than the page, using each section's own "Delete section"
button. Untick it to leave the spares alone.

Deleting puts up a confirmation, and nothing is removed until its affirmative
button is pressed - so the extension presses it, one section at a time until the
count matches. The affirmative button is picked by rank (Yes, then Delete or
Remove, then Confirm, then OK) and anything reading as Cancel, No, Keep, Back or
Close is excluded, so a confirmation is never dismissed the wrong way. If the
page refuses to remove a section, the status line says how many were left rather
than passing over it in silence.

## Two tabs

The panel has a **Catch** tab and an **Input** tab. Each owns the full height, so
only one region ever scrolls - the caught text and the input box no longer sit in
nested scrollers competing for the same wheel.

- **Catch** holds the page-type radios, the Catch button and the two result
  boxes. The radios and button stay pinned while the caught text scrolls under
  them.
- **Input** holds the JSON box, which grows to fill the panel, with the entry
  options and the action button beneath it.

The panel follows the job: catching switches to Catch, starting a fill switches
to Input, and **Send criteria to input** carries you across with the JSON. The
open tab is remembered per browser tab along with the rest of the session, and
the status line sits below both.

## The result panel

A catch fills two boxes. **Click either one to copy it**, or use the copy icon
in its corner; the box flashes green when the clipboard has it.

- **UID** — just the identifier, on its own, so it can go straight into a
  tracker or a message.
- **Content** — everything else as one plain-text block, opening with
  `<UID>_<time caught>` so a pasted block identifies itself without the UID box
  beside it, then in this order:

  1. Task notes — Reviewer Feedback, Reviewer Note, Rebuttal Note, Automated
     feedback, each with its timestamp
  2. Failed checks — any check panel the page paints red
  3. Sector, Occupation, Tier, Areas of Focus of Feedback
  4. Prompt
  5. Criteria — number, text and weight only, never the weight guidance text
  6. O*NET Occupation, Tasks and Skills (Submission and Review only)
  7. The four task questions — input file count, multi-modal, web search, manual
     duration
  8. Every auto-evaluation result — Golden Solution, Difficulty, input/output
     check, Self-Contained check, Verifier, Audit, Audit: Rubric and Golden
     Solution Alignment, Safety Check, LLM generated files check, Rubric Quality
     Check, Golden solution leakage, Rubric golden alignment, Rubric value
     grounding

Only results are taken, never the form's own instructions: the description under
each label ("This box will only populate once the auto-evaluations finish…",
"Identify what occupation your prompt falls under…") is skipped. Anything absent
is left out rather than printed empty, and an auto-eval box still showing its
"No code provided" placeholder counts as absent.

## Running the checks

Each check on the page — O*NET Compliance, Prompt Quality, Input Files Quality,
Rubric Quality, Name Check and the rest — sits behind a **Check feedback**
button, and its verdict only exists once that button has been pressed and the
server has answered.

When the prompt is filled, a catch presses every check that has not run yet,
waits for all of them to answer, and only then reads the page. A check is
finished when its result panel appears or its button turns into "Clear feedback
results". Checks that have already answered are left alone, so re-catching does
not re-run them.

The answers can take a while, so the status line counts them off — *"Running the
feedback checks — 2 of 5 answered…"* — and the Catch button is held until they
are in. If one never answers, the catch goes ahead after three minutes and the
result says which was still outstanding.

Nothing is pressed when there is nothing to judge:

- **a Refinement page whose criteria list is still empty** — that is a task
  nobody has written yet, so the checks are skipped and the criteria come from
  Provided Rubrics as usual;
- an empty prompt;
- the toggle below turned off.

**Run the feedback checks first** on the Catch tab turns this off, for when you
want to read the page as it stands without asking the server for anything.

**Check results** are read by colour. A panel painted `bg-success-subtle` passed,
so it is left out; one painted `bg-error-subtle` is captured in full under
**Failed checks**, tagged with the check it belongs to.

Under the boxes, **Copy JSON** and **Download JSON** take the whole payload as
structured data, and **Send criteria to input** drops just the criteria into the
input box below, ready to type back into another page.

## JSON format

Catching produces this; `content` is for reading, `criteria` is what gets typed
back:

```json
{
  "mode": "review",
  "uid": "a7bf2291-1382-425b-a12e-31a5a6246399",
  "content": {
    "taskNotes": [
      { "title": "Reviewer Feedback", "time": "9/2/26, 4:15 AM", "text": "Prompt reads naturally now…" }
    ],
    "sector": "Construction",
    "tier": "Tier 2",
    "areasOfFocus": "Golden Solution, Rubrics",
    "prompt": "Priya has me picking how we claw back…",
    "criteria": [{ "n": 1, "criterion": "The remaining work content is…", "weight": 2 }],
    "onetOccupation": "47-1011.00|First-Line Supervisors of Construction Trades…",
    "fields": [{ "label": "Safety Check", "value": "Safety screen: nothing blocking." }]
  },
  "criteria": [{ "criterion": "The remaining work content is…", "weight": 2 }]
}
```

**Type into page** reads only `criteria` and ignores everything else, so a caught
payload can be fed straight back in.

### Where each part comes from

- **UID** — the value beside the `UID:` label.
- **Sector** — the "Sector" heading on Submission and Review; Refinement calls it
  "Task Sector" and carries a "Task Occupation" beside it, both of which are read
  too.
- **Tier / Areas of Focus of Feedback** — Refinement's "Tier Type" and "Areas of
  Focus of Feedback" headings.
- **Task notes** — accordions outside the criteria list whose title mentions
  *feedback*, *note* or *rebuttal*, plus Refinement's headed "Correction
  Feedback" and "Agentic Rubric Quality Check" blocks, which are not accordions.
  **On a Refinement page whose criteria are already written**, the correction
  feedback is left out: it describes the task as it was before that work, so it
  is stale once the criteria exist. The automated run is taken instead, failures
  included — on a revision under way those failures are the point, and dropping
  them would leave that page with no automated feedback at all. Before any work,
  the correction feedback is what matters and it is kept as before.
  Collapsed ones are opened to read them. The header runs label and timestamp
  together ("Reviewer Feedback9/2/26, 4:15 AM"), so they are split into `title`
  and `time`. **An "Automated feedback" note whose body mentions a failure is
  left out** — passing auto-evals are kept. "Section 1 – …" accordions are not
  notes and are ignored.
- **Criteria on a Refinement page** — the editable list first. A refinement task
  usually opens with that list still blank, and when it is, the criteria are read
  from the read-only **Provided Rubrics** document instead: each
  `Criterion N - weight W` heading with the paragraphs under it. The status line
  says which of the two it used, and the JSON is the same either way, so it can
  be pasted straight back into the empty list.
- **Everything else** — matched by the field's **label**, never its
  `data-testid`: the hashes in `field-code-194d3` are regenerated and cannot be
  relied on. Values come from a `<pre>` for auto-eval output, from the chip
  buttons for O*NET multiselects (which otherwise render with no separator
  between picks), and from Monaco's line elements for the self-containment
  summary, whose `<textarea>` is empty and whose `<select>` holds a language name
  rather than the value.

## Checked against the real pages

The reader was built against saved DOM captures of all three page types, plus
one Review page carrying failed checks. Those dumps are not kept in the repo —
they are large and contain task content — but this is what the page script read
from them:

| Sample | Detected | UID | Sector | Criteria | Fields | Task notes |
|---|---|---|---|---|---|---|
| Submission | Submission (blurb) | ✓ | Mining, Quarrying, and Oil and Gas Extraction | 30 of 30 | 15 | Reviewer Feedback (the Automated one said "AutoEval execution failed" and was dropped) |
| Review | Review (heading) | ✓ | Construction | 21 of 21 | 16 | Automated feedback + Reviewer Feedback |
| Refinement | Refinement (blurb) | ✓ | Professional, Scientific, and Technical Services (+ Tier 2, Areas of Focus) | 17, from Provided Rubrics (the list was empty) | 1 | Correction Feedback + Agentic Rubric Quality Check |
| Review, with failing checks | Review (heading) | ✓ | Construction | 32 of 32 | 16 | Automated feedback + Reviewer Feedback, **plus 2 failed checks** |

That Refinement page had an empty criteria list — the task had not been written
yet — so its 17 criteria came from the Provided Rubrics document instead.

A separate limit worth knowing: 14 of that dump's 15 form sections were collapsed
when the HTML was captured, and a saved snapshot has no React behind it to mount
them when clicked. On a live page they expand normally. If a section ever does
fail to open, the status line says how many stayed empty rather than silently
handing back a short list.

### Input template

The input box takes the criteria fragment on its own — no outer braces needed:

```
"criteria": [
  { "1": "Criterion text, at least 20 characters.", "weight": 2 },
  { "2": "A failure mode carries a negative weight.", "weight": -3 }
]
```

The strict reading is tried first, then the obvious repairs: the outer `{ }` put
back, a closing bracket added, a trailing comma dropped. Anything genuinely
malformed is still reported rather than guessed at. **Send criteria to input**
writes the complete object, since that costs nothing to generate.

The key is the criterion's number. It is a label only — position in the list
decides which section a row is written to.

Also accepted:

- `"criterion"` in place of the number: `[{ "criterion": "…", "weight": 2 }]`
- a bare array rather than a `criteria` object
- bare strings: `["…", "…"]` (weight left alone)
- `{ "items": [ … ] }`
- a whole caught payload — its `mode` / `uid` / `content` keys are ignored

Order matters: entry *n* goes into section *n*. Text longer than the field's
`maxlength` is cut to fit and reported in the status line.

## Field names

Keys come from the page's own field wrappers, so nothing is hard-wired to
`criterion`/`weight`:

```
<div data-testid="field-textarea-criterion">  ->  "criterion"
<div data-testid="field-numeric-weight">      ->  "weight"
```

Any other `data-testid="field-<type>-<name>"` in a section is caught and applied
under `<name>` too. Numeric inputs come out as numbers, checkboxes as booleans.
If a page has no such wrappers, it falls back to the first `textarea`
(`criterion`) and first `input[type=number]` (`weight`) in each section.

A key with no matching field on the page is reported in the status line rather
than failing the run.

## Notes on the page it drives

- **Collapsed sections are expanded first.** Radix unmounts closed accordion
  content, so a closed section has no textarea to read or type into.
- **React ignores `el.value = x`.** Values go through the prototype's native
  `value` setter, which desyncs React's value tracker so the `input` event that
  follows counts as a real edit.
- **A half-typed number is not assigned.** `<input type=number>` rejects a lone
  `"-"`, so for negative weights the keystroke is dispatched but the value lands
  on the following digit — same end state, no console warnings.

## Files

- [manifest.json](manifest.json) — MV3 manifest, `activeTab` + `scripting` + `storage` + `sidePanel`
- [background.js](background.js) — opens the side panel when the toolbar icon is clicked, one per tab
- [icon.svg](icon.svg) — the toolbar icon: a person at a monitor. Chrome only
  takes raster icons, so [tools/make-icons.mjs](tools/make-icons.mjs) renders it
  to `icons/icon{16,32,48,128}.png`. Edit the SVG, then re-run:
  `node <browser-automation>/browser.mjs about:blank --script tools/make-icons.mjs`
- [content.js](content.js) — page side: read fields, fill values, add/delete sections
- [panel.html](panel.html) / [panel.css](panel.css) / [panel.js](panel.js) — the side panel UI
