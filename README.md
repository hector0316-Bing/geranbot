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
the page scrolls. Drag its inner edge to resize. Needs Chrome 114 or newer.

Nothing runs until you open the panel — the page script is injected on demand
under `activeTab`, so the extension has no access to any other site.

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

**Pace** — Fast, Human (default), Careful. It sets the keystroke interval when
typing and the pause between fields when pasting.

While it runs the button turns into **Stop** and the status line shows
`typing 4/12…`. You can close the panel; the run continues, and reopening it
picks the progress back up.

## Running out of sections

Sections are filled in order. When the JSON has more entries than the page has
sections, the extension clicks the page's own **Add criterion** button, waits for
the new section to mount, and types into it — one at a time, at the point it is
needed, not all up front.

**Remove extra sections** (on by default) deletes trailing sections when the JSON
has fewer entries than the page, using each section's own "Delete section"
button. Untick it to leave the spares alone.

## The result panel

A catch fills two boxes. **Click either one to copy it**, or use the copy icon
in its corner; the box flashes green when the clipboard has it.

- **UID** — just the identifier, on its own, so it can go straight into a
  tracker or a message.
- **Content** — everything else as one plain-text block, in this order:

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
  Collapsed ones are opened to read them. The header runs label and timestamp
  together ("Reviewer Feedback9/2/26, 4:15 AM"), so they are split into `title`
  and `time`. **An "Automated feedback" note whose body mentions a failure is
  left out** — passing auto-evals are kept. "Section 1 – …" accordions are not
  notes and are ignored.
- **Everything else** — matched by the field's **label**, never its
  `data-testid`: the hashes in `field-code-194d3` are regenerated and cannot be
  relied on. Values come from a `<pre>` for auto-eval output, from the chip
  buttons for O*NET multiselects (which otherwise render with no separator
  between picks), and from Monaco's line elements for the self-containment
  summary, whose `<textarea>` is empty and whose `<select>` holds a language name
  rather than the value.

## Checked against the real pages

`submission.txt`, `review.txt` and `Refinement.txt` here, plus the dumps in
[samples/](samples/), are captures of real pages. Running the extension's page
script over them gives:

| Sample | Detected | UID | Sector | Criteria | Fields | Task notes |
|---|---|---|---|---|---|---|
| submission.txt | Submission (blurb) | ✓ | Mining, Quarrying, and Oil and Gas Extraction | 30 of 30 | 15 | Reviewer Feedback (the Automated one said "AutoEval execution failed" and was dropped) |
| review.txt | Review (heading) | ✓ | Construction | 21 of 21 | 16 | Automated feedback + Reviewer Feedback |
| Refinement.txt | Refinement (blurb) | ✓ | Professional, Scientific, and Technical Services (+ Tier 2, Areas of Focus) | 1 of 15 mounted | 1 | Correction Feedback + Agentic Rubric Quality Check |
| samples/errors & succss for Review.txt | Review (heading) | ✓ | Construction | 32 of 32 | 16 | Automated feedback + Reviewer Feedback, **plus 2 failed checks** |

The Refinement figure is a limit of the dump, not of the extension: 14 of its 15
sections were collapsed when the HTML was captured, and a saved snapshot has no
React behind it to mount them when clicked. On the live page they expand
normally. If a section ever does fail to open, the status line says how many
stayed empty rather than silently handing back a short list.

### Input template

The input box shows this shape, and **Send criteria to input** writes it:

```json
{
  "criteria": [
    { "1": "Criterion text, at least 20 characters.", "weight": 2 },
    { "2": "A failure mode carries a negative weight.", "weight": -3 }
  ]
}
```

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
- [background.js](background.js) — opens the side panel when the toolbar icon is clicked
- [content.js](content.js) — page side: read fields, fill values, add/delete sections
- [panel.html](panel.html) / [panel.css](panel.css) / [panel.js](panel.js) — the side panel UI
- [samples/](samples/) — extra page dumps used to check the reader
