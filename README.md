# Criteria Catcher

Chrome extension (MV3) that runs in the browser's **side panel**. It reads a
task page into one copyable block, and writes an answer back into it one field
at a time, at a human pace. Three projects are handled: **Geranium**'s criteria
and rubric pages, **Rudder**'s preference comparisons, and **Terminus-3rd**'s
Terminal Bench 3.0 tasks, which are only read.

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

## Three projects

Before anything else the panel asks which project the task belongs to, and the
answer holds for that tab:

- **Geranium** — the criteria and rubric pages: Submission, Review, Refinement.
  Everything from here down to **Field names** is about these.
- **Rudder** — preference comparisons, where two model responses are rated side
  by side against a scale. **Rudder tasks**, near the end, is about those.
- **Terminus-3rd** — Terminal Bench 3.0 tasks, uploaded as a zip. Only read
  from: there is nothing to type back in, so it has no Input tab.
  **Terminus-3rd tasks**, near the end, is about those.

The page usually says which it is — Geranium by its criteria list, Terminus by
its feedback boxes, Rudder by its split document review — and whichever it
looks like is marked **on this page** in the chooser, so the answer is normally
a confirmation rather than a decision.
It stays a choice because the readers have nothing in common: the wrong one
on a page reads nothing and fills nothing, and it is better to be asked than to
find that out from an empty result.

The chip beside the title says which project the tab is on, and it is the way
back: it carries a caret pointing the way it goes, and pressing it returns to the
chooser. Everything the projects word differently — the Catch button, the input
template, the options each offers — changes with the choice.

Picking the wrong one is ordinary and easy, so it does not have to be noticed
first. Whenever the page disagrees with the choice, a line under the controls
says so — *This page looks like a Rudder task.* — with **Switch to Rudder**
beside it, and one press moves the tab over without a trip back through the
chooser. Neither route is available mid-run; stop it first.

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

## Page type (Geranium)

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

**Pace** sets the keystroke rhythm when typing — Fast, **Human (default)**,
Careful or Unhurried.

**Gap** sets how long it waits after each field before moving to the next —
0.5s, 1s, **2s (default)**, 3s, 4s or 5s — so the page has time to validate,
autosave and settle between entries.

Gap paces the whole run, not only the wait between fields. Opening a section,
adding one, confirming a delete and waiting on a newly mounted field are all
given a sixth of the gap to settle, floored at 120ms and capped at 0.9s — so 2s
gives each click a third of a second, 5s gives it just over four fifths. These
used to stand at a fixed 120ms whatever the run was paced at, which spaced out
the fields while every click around them still came as fast as the browser
could fire it. A catch keeps to the 120ms default; only a fill is paced.

The gap is what governs how long a run takes: roughly (criteria x 2 fields) x
gap. Thirty criteria is about two minutes at the 2s default, and about five at
5s. Stop takes effect within a tenth of a second even mid-gap.

While it runs the button turns into **Stop** and the status line shows
`typing 4/12…`. You can close the panel; the run continues, and reopening it
picks the progress back up.

**Switching tabs mid-run.** A run — a fill or a catch — keeps going at full speed
while you work in another tab. Chrome works against that in two ways, and both
are answered.

*It slows a hidden tab's timers* to about one a second, and to one a minute once
the tab has been hidden a few minutes, so pacing driven by the page's own
`setTimeout` crawls and then looks stopped. The page therefore does not keep its
own time while it is behind: it asks the extension's service worker to do the
waiting and carries on when the reply arrives. A service worker is not a tab and
is not clamped, and messages reach a hidden page without being clamped either. In
front, nothing is sent to the worker at all.

*It freezes background tabs outright*, and a frozen page runs no script at all —
which is what a fill that halts the instant you look away, and resumes untouched
the instant you come back, actually was. Chrome will not freeze a page that is
holding a **Web Lock**, so a run takes one out and holds it for its whole length,
and holds an open port to the service worker beside it so the worker that is
keeping time is never shut down as idle. Both are dropped the moment the run
ends.

Waits on the page also stretch while the tab is behind, so a section that is slow
to mount is waited for rather than declared missing. The result says when part of
a run happened in the background.

A tab Chrome *discards* under real memory pressure is reloaded from scratch and
takes the run with it; nothing an extension does from inside prevents that. Short
of that, a run in the background is a run.

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
  options and the action button beneath it. A successful catch empties it: what
  it held was written against the previous reading, and left in place it could
  be typed into the page by mistake. A catch that fails leaves it alone.

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

  1. Sector, Occupation, Tier, Areas of Focus of Feedback — the one short line
     that says which task this is, kept at the top where it is read. Refinement
     calls the sector "Task Sector" and the occupation "Task Occupation";
     they are the same fields as Submission's and Review's "Sector" and
     "Occupation", and are labelled that way here so a caught block reads the
     same whichever page it came off
  2. Checks still waiting, if the page was read before every check had answered
  3. Focus — the one note the task is waiting on, under a heading that says
     which kind of problem that makes it
  4. The auto-evaluation results, then the **Check feedback results**, but
     only when they are the focus
  5. Other task notes — Reviewer Feedback, Reviewer Note, Rebuttal Note,
     Automated feedback, each with its timestamp
  6. Check feedback results, when they were not the focus — what each
     **Check feedback** button answered (Prompt Quality, Input Files Quality,
     Golden Solution Files Quality, Rubric Quality, Name Check…), one entry per
     sub-check with its name, PASS/FAIL and explanation, failures first
  7. Failed checks — any other panel the page paints red
  8. Prompt
  9. Criteria — number, text and weight only, never the weight guidance text
  10. O*NET Occupation, Tasks and Skills (Submission and Review only)
  11. The four task questions — input file count, multi-modal, web search,
      manual duration
  12. The auto-evaluation results, when they were not the focus — Golden
      Solution, Difficulty, input/output check, Self-Contained check, Verifier,
      Audit, Audit: Rubric and Golden Solution Alignment, Safety Check, LLM
      generated files check, Rubric Quality Check, Golden solution self
      consistency, leakage, entity grounding and role checks, Rubric golden
      alignment, Rubric value grounding, Reference Soundness, Quality Judge
      Check, Comprehensive Rubric Feedback and Recommendations

Only results are taken, never the form's own instructions: the description under
each label ("This box will only populate once the auto-evaluations finish…",
"Identify what occupation your prompt falls under…") is skipped. Anything absent
is left out rather than printed empty, and an auto-eval box still showing its
"No code provided" placeholder counts as absent.

### Which feedback the task is waiting on

A task is blocked on one of two different things, and which one decides what
there is to do about it:

- **the auto-checking**, when the machine will not pass the task — nothing in
  the wording will move it, the answer is in the auto-evaluation boxes;
- **the quality of the content**, when the machine is satisfied and a person
  has asked for something better.

So the caught block does not merely lead with the newest note; it names which
of the two this is, under **Focus**, and orders what follows to match. The
newest note decides, and the automated run's own **message** decides what that
means — not its timestamp, because a passing run can carry one too:

| Newest note | Its message | Focus | What leads the block |
|---|---|---|---|
| Automated feedback | names a failure | the auto-checking | the automated note, then **Auto-evaluation feedback (below the golden solution upload)** — every auto-eval box, pulled up from the foot of the block — then the **Check feedback results** |
| Automated feedback | all checks passed | the reviewer's feedback | the newest reviewer note, with the auto-eval boxes left at the foot |
| Reviewer Feedback / Note / Rebuttal | — | the reviewer's feedback | that note |

An automated run that is newest but says neither — "AutoEval execution error"
and the like — is read as blocking, not as passing: it is the newest word on the
task and it is not the standing all-clear.

Newest is decided on the timestamp, so a reviewer's reply after a failed run
still leads and still points at the content. Refinement now carries the same
timestamped "Automated feedback" and "Reviewer Feedback" accordions as the other
pages, beside its older headed blocks ("Correction Feedback", "AutoEval
Feedback", "Agentic Rubric Quality Check"), which carry no timestamps. When
nothing on the page is timestamped there is no newest note, so the automated
run is read on its own verdict — a failing "AutoEval Feedback" block makes the
auto-checking the focus, a passing one hands it to the correction feedback.

A failing automated run **is kept**: it used to be discarded as noise, which
threw away the one note that mattered precisely when it mattered.

The status line says the same thing in one line as the catch lands — *"Waiting
on the auto-checking — start from the auto-evaluation results below the golden
solution upload."*

## Running the checks

Each check on the page — O*NET Compliance, Prompt Quality, Input Files Quality,
Rubric Quality, Name Check and the rest — sits behind a **Check feedback**
button, and its verdict only exists once that button has been pressed and the
server has answered.

A catch presses every check that has not run yet, waits for all of them to
answer, and only then reads the page. A check is finished when its result panel
appears or its button turns into "Clear feedback results". Checks that have
already answered are left alone, so re-catching does not re-run them.

Whether there is anything to press is the page's answer, not a guess from the
form: a check showing an enabled **Check feedback** button has not been asked
yet. A check field is found by its testid where the page spells it
`feedbackButton`, and by the button's own text where it does not, so a renamed
wrapper cannot hide one.

The answers can take a while, so the status line counts them off — *"Running the
feedback checks — 2 of 5 answered…"* — and the Catch button is held until they
are in.

Three minutes is as long as it waits. That is three minutes of *waiting*, not of
wall clock: if the tab is suspended mid-wait, the time it was suspended for is
handed back rather than spent, because the page was not watching for an answer
while it was frozen. A catch left in a background tab therefore comes back having
waited as long as one left in front.

If a check still never answers, the catch goes ahead without it and says so —
in the status line (*"Read before 2 checks answered: Prompt Quality, Name
Check"*) and again at the top of the Content block under **Checks still waiting
when this was caught**, so a block that is copied elsewhere carries the caveat
with it. Catch again once they land.

A catch belongs to the tab it was started on. Move to another tab while it is
waiting and it keeps reading that page, not the one now in front; when it
finishes it files the result in that tab's own session, ready when you go back.

Nothing is pressed when there is nothing to press, and the status line says
which of these it was:

- the page carries no checks at all;
- every check on it has already answered — the ordinary case on a re-catch, and
  the only one the status line passes over in silence;
- the page has their buttons disabled, so they are not ready to be asked;
- the page has a **User Prompt** box of its own and it is empty;
- the toggle below turned off.

**A Refinement page's checks are pressed on the first catch**, which is the
catch that needs them: a refinement task arrives with its checks unrun. This
used to be the one page where nothing was ever pressed, because both of the old
guesses misread it — its criteria list opens empty, which was taken for "nothing
to judge yet", and its prompt is read-only rather than a box, which tripped the
empty-prompt skip. Neither is asked any more. The empty criteria list still
decides where the *criteria* are read from (Provided Rubrics), which is a
separate question and unchanged.

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
      { "title": "Reviewer Feedback", "time": "9/2/26, 4:15 AM", "text": "Prompt reads naturally now…", "latest": true, "focus": true }
    ],
    "focus": {
      "on": "reviewer feedback",
      "why": "The automated run says all checks passed, so the auto-checking is not what is blocking…",
      "note": { "title": "Reviewer Feedback", "time": "9/2/26, 4:15 AM" }
    },
    "autoEvalPassed": true,
    "sector": "Construction",
    "tier": "Tier 2",
    "areasOfFocus": "Golden Solution, Rubrics",
    "prompt": "Priya has me picking how we claw back…",
    "criteria": [{ "n": 1, "criterion": "The remaining work content is…", "weight": 2 }],
    "onetOccupation": "47-1011.00|First-Line Supervisors of Construction Trades…",
    "fields": [{ "label": "Safety Check", "value": "Safety screen: nothing blocking.", "auto": true }],
    "pendingChecks": ["Prompt Quality"]
  },
  "criteria": [{ "criterion": "The remaining work content is…", "weight": 2 }]
}
```

**Type into page** reads only `criteria` and ignores everything else, so a caught
payload can be fed straight back in.

### Where each part comes from

- **UID** — the value beside the `UID:` label.
- **Sector** — the "Sector" heading on Submission and Review; Refinement calls
  the same field "Task Sector", and its occupation "Task Occupation". The page's
  wording is only how it is found: both are reported as `sector` and
  `occupation`, and printed as **Sector** and **Occupation**, so one page's
  reading can be compared with another's. A value area that repeats its own
  heading has it stripped, so the sector is the sector and never the words "Task
  Sector".
- **Tier / Areas of Focus of Feedback** — Refinement's "Tier Type" and "Areas of
  Focus of Feedback" headings.
- **Task notes** — accordions outside the criteria list whose title mentions
  *feedback*, *note* or *rebuttal*. The page moved these from Radix to base-ui
  accordions, so a trigger is found either by Radix's collection-item marker or
  by `aria-controls` with `aria-expanded`. The automated note ends with a "Do you
  disagree with the automated feedback?" box; that is taken off the text and
  kept as `asks` (question and whether it is ticked). Plus Refinement's headed "Correction
  Feedback" and "Agentic Rubric Quality Check" blocks, which are not accordions.
  **On a Refinement page whose criteria are already written**, the correction
  feedback is left out: it describes the task as it was before that work, so it
  is stale once the criteria exist. Before any work, the correction feedback is
  what matters and it is kept.
  Collapsed ones are opened to read them. The header runs label and timestamp
  together ("Reviewer Feedback9/2/26, 4:15 AM"), so they are split into `title`
  and `time`. Every note is kept, failing automated runs included — which one
  the block leads with is settled by **Focus**, above. "Section 1 – …"
  accordions are not notes and are ignored.
- **focus** — which of the two problems the task is waiting on, `on`
  (`auto-evaluation` or `reviewer feedback`), `why` in a sentence, and the
  `note` it points at; the note itself is flagged `focus: true` in `taskNotes`.
  `autoEvalPassed` says separately whether the newest automated run said it
  passed, and is absent when no automated run is readable on the page.
- **Criteria on a Refinement page** — the editable list first. A refinement task
  usually opens with that list still blank, and when it is, the criteria are read
  from the read-only **Provided Rubrics** document instead: each
  `Criterion N - weight W` heading with the paragraphs under it. The status line
  says which of the two it used, and the JSON is the same either way, so it can
  be pasted straight back into the empty list.
- **checkResults** — one entry per result panel under a **Check feedback**
  button: `check` (the field's label), `name` (the sub-check's own title, such as
  "Rubric atomicity check"), `verdict` (`PASS` / `FAIL`), `passed`, and `text`.
  These panels are carried pass or fail, so a red one is not repeated under
  `errors`.
- **pendingChecks** — the checks that had not answered by the time the page was
  read. Absent, as everything absent is, when there were none.
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
| Submission | Submission (blurb) | ✓ | Mining, Quarrying, and Oil and Gas Extraction | 30 of 30 | 15 | Reviewer Feedback + Automated feedback ("AutoEval execution failed", so the focus is the auto-checking) |
| Review | Review (heading) | ✓ | Construction | 21 of 21 | 16 | Automated feedback + Reviewer Feedback |
| Refinement | Refinement (blurb) | ✓ | Professional, Scientific, and Technical Services (+ Tier 2, Areas of Focus) | 17, from Provided Rubrics (the list was empty) | 1 | Correction Feedback + Agentic Rubric Quality Check |
| Review, with failing checks | Review (heading) | ✓ | Construction | 32 of 32 | 16 | Automated feedback + Reviewer Feedback, **plus 2 failed checks** |
| Refinement, new layout | Refinement (blurb) | ✓ | Professional, Scientific, and Technical Services (+ Tier 2, Areas of Focus) | 23 of 23 | 15 auto-eval boxes (4 more still "No code provided") | Automated feedback ("Evaluation FAILED", newest, so the focus is the auto-checking) + Reviewer Feedback + Agentic Rubric Quality Check, **plus 40 check results** from 5 Check feedback buttons |

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

## Rudder tasks

A Rudder task is a different page altogether: the conversation and the two
candidate responses on the left, a form of rating scales, failure-mode flag
lists and written explanations on the right, and the task notes in a sidebar of
their own. There is no criteria list, so none of the criteria handling above
applies to it — but the field wrappers, the accordions and the typing behave
exactly as they do on a Geranium page, and are shared rather than written twice.

### What a catch takes

**Catch task** reads the whole task into one copyable block, in this order:

1. The page title and the **stage** — *first pass* while nothing has been
   answered and there are no notes, *revision* once either is true
2. **Latest note**, then any earlier ones, each with its timestamp — and the
   question a reviewer's note carries underneath it ("Do you disagree with the
   reviewer feedback?"), with whether it is ticked
3. **Context**, **Response A** and **Response B** — the left panel's documents,
   each under the heading the page shows it with
4. Every section of the form, and under each one every question: its key, its
   label, what it asks, its options, and whatever is answered right now

The first time round the form is empty, so the block is the task plus a blank
answer template. Once the task comes back for revision, the reviewer's note and
the answers already on the page are both in it, so the next answer is edited
from what was actually submitted rather than written again from nothing.

**Include the rating guidelines in full** adds each axis's standing guidance —
what Constraint Following covers and does not cover, and so on for the rest. It
is off by default: it is the same several pages on every task of the project,
and it roughly doubles the length of the block.

The notes sidebar is opened if it is shut, and every accordion is expanded
first — a closed one has no content in the DOM to be read.

### The answers box

A third box holds the answers as JSON: every key the page asks for, in the order
it asks for them, with whatever is already filled in.

```json
{
  "answers": {
    "constraint_following_response_a": "5",
    "constraint_following_checkboxes_response_a": [],
    "constraint_following_flag_missing_response_a": "false",
    "overall_rationale_response_a": "The response is mostly helpful…",
    "preference": "A < B",
    "preference_explanation": "Both responses recast the earlier advice…"
  }
}
```

Click it to copy, or press **Send answers to input** to drop it into the input
box. Edit the values there, press **Type into page**, and each one is written
back. A bare object without the `answers` wrapper works too, as does a list of
`{ "key": …, "answer": … }` rows.

### Writing answers back

Keys are the page's own field wrappers: `data-testid="field-preference"` is
`"preference"`. Only what the JSON actually says is written — a key left out,
left empty or set to `null` leaves that question exactly as it was, so a
correction can name the three fields it changes and touch nothing else.

| the page asks for | write | for example |
|---|---|---|
| a rating or a single choice | the stored value, the wording on screen, or the part before the colon | `4`, `"not_applicable"`, `"N/A"`, `"A > B"`, `"Yes"` |
| failure-mode flags | the labels to tick, as a list | `["Contains a false claim"]`, `[]` |
| an explanation | the text | `"The response is mostly helpful…"` |

An exact stored value is matched before anything looser, so `"A > B"` is never
taken for `"A >> B"`. `Yes`/`No` and `true`/`false` are read as each other,
since that is how the flag questions are usually spoken. A flag name may be
shortened, as long as what is left is long enough to mean only one of them.

Ticking is stated in full: every flag named is put on and **every other one is
taken off**, so the page ends up saying exactly what the answer says.

Answering one question can bring another into being — the correctness sub-flags
exist only once the status says *Flagged* — so a field that is not on the page
yet is waited for rather than skipped.

**Type per key** is the default here rather than paste: these answers go into a
form a person is meant to have filled in by hand, so they are typed out at a
human rhythm — `keydown` / `beforeinput` / `input` / `keyup` per character, with
variable gaps, exactly as described under **The two buttons**. A rating or a
flag gets a beat before it is clicked. **Pace** and **Gap** work the same way,
and the status line counts `filling field 7 of 12…`.

Anything that could not be written is named in the status line rather than
passed over: a key this page does not ask for, an option that does not exist, a
flag with no such label, a value cut to the field's limit.

**Submit is never pressed.** The form is filled, and that is where it stops.

## Terminus-3rd tasks

A Terminal Bench 3.0 page is headed "Submission" just like Geranium's, so it is
recognised by its own feedback boxes (or a "Terminal bench" label) before the
heading is looked at. Only Submission has been seen so far. A page headed
"Review" is recorded as stage `review` and read the same way until a sample
shows what a Review page carries of its own.

A catch takes, in this order:

1. **Task notes** — the note accordions, such as "Automated feedback", newest
   first. The "Do you disagree with the automated feedback?" box is left off the
   text. A form section titled like a note ("Terminal bench 3.0 task
   feedback") is not a note: a note never holds form fields.
2. **Quality Judge Panel Feedback**, in full.
3. **Oracle / NOP validation**, when it has run.
4. **Summary** — only its own lines. The Summary repeats the whole Quality Judge
   Panel under a line or two of its own, so the repeat is dropped and a line
   says where to find it.
5. **Quality check summary** — only the lines that did not pass (fail, warning,
   error), each under the `##` heading it sat under, with any explanation that
   runs onto the following lines. When all pass, one line says so, for example
   *All 48 checks passed.* A summary laid out some other way is kept whole
   rather than guessed at.
6. **Failed static checks** — "Fast static checks" sits behind a **Check
   feedback** button, and a Terminus catch **never presses it**; the toggle for
   that is not shown on this project. If the page already shows a result, a
   failing one is carried.

Boxes still showing "No code provided" are left out. The JSON carries the same
parts as `taskNotes`, `qualityPanel`, `oracleNop`, `summary`,
`qualityChecks: { total, failed: [{ section, text }] }` and
`failedStaticChecks`.

## Notes on the page it drives

- **Collapsed sections are expanded first.** Radix unmounts closed accordion
  content, so a closed section has no textarea to read or type into.
- **A rating is not an `<input>`.** Rudder's scales render as a button with
  `role="radio"` and a hidden input beside it holding the real value; its flags
  are divs with `role="checkbox"` and no input at all. Both are clicked and the
  result read back off the page, since the click is the only thing the component
  listens to.
- **React ignores `el.value = x`.** Values go through the prototype's native
  `value` setter, which desyncs React's value tracker so the `input` event that
  follows counts as a real edit.
- **A half-typed number is not assigned.** `<input type=number>` rejects a lone
  `"-"`, so for negative weights the keystroke is dispatched but the value lands
  on the following digit — same end state, no console warnings.

## Files

- [manifest.json](manifest.json) — MV3 manifest, `activeTab` + `scripting` + `storage` + `sidePanel`
- [background.js](background.js) — opens the side panel when the toolbar icon is
  clicked, one per tab; keeps time for a page whose tab is in the background, and
  holds the keepalive port a running page connects to
- [icon.svg](icon.svg) — the toolbar icon: a person at a monitor. Chrome only
  takes raster icons, so [tools/make-icons.mjs](tools/make-icons.mjs) renders it
  to `icons/icon{16,32,48,128}.png`. Edit the SVG, then re-run:
  `node <browser-automation>/browser.mjs about:blank --script tools/make-icons.mjs`
- [content.js](content.js) — page side, all three projects: read fields, fill
  values, add/delete sections on Geranium, choose ratings and tick flags on
  Rudder, read the feedback on Terminus-3rd
- [panel.html](panel.html) / [panel.css](panel.css) / [panel.js](panel.js) — the side panel UI
