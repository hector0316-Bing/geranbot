/* Criteria Catcher - page side: which project, and the messages from the panel.

   Loaded last, once every project file has registered itself in
   PAGE_PROJECTS. Injection is on demand and only when the panel finds nothing
   answering, but the listener is guarded all the same so a second injection
   never answers every message twice.

   Needs core.js and the project files. */

// Which project's page this is. Each is settled by something only it has:
// Geranium's criteria list, Terminus's feedback boxes, Copperhead's task
// brief and review sections, Rudder's rating sections, then Geranium's
// "In this … project" blurb. The heading alone is the last resort - Terminus
// is headed "Submission" as Geranium is, and a Refinement page's first <h1>
// can be the "Rubric" inside its documents.
const DETECT_ORDER = ['geranium', 'terminus', 'copperhead', 'rudder'];

function detectProject() {
  for (const name of DETECT_ORDER) {
    const source = PAGE_PROJECTS[name]?.detect();
    if (source) return { project: name, source };
  }
  const loose = PAGE_PROJECTS.geranium?.detectLoosely();
  if (loose) return { project: 'geranium', source: loose };
  return { project: null, source: 'unknown' };
}

// Which reader runs is the panel's call - it is the one that asked the user -
// and the page's own answer is only the fallback for a message that did not
// say. A page nobody recognises is read as Geranium, as it always was.
function projectFor(options) {
  const name = options?.project || detectProject().project || 'geranium';
  const found = PAGE_PROJECTS[name];
  if (!found) throw new Error(`Unknown project: ${name}`);
  return { name, found };
}

// Everything below runs for as long as the page takes, so hold the tab awake
// for the whole of it rather than per step.
async function extract(options = {}) {
  const { found } = projectFor(options);
  stayAwake();
  try {
    return await found.read(options);
  } finally {
    letSleep();
  }
}

async function fill(data, options = {}) {
  const { name, found } = projectFor(options);
  if (!found.apply) throw new Error(`${name} is only read from - there is nothing to type back in.`);
  return found.apply(data, options);
}

/* ---------- messaging ---------- */

if (!window.__criteriaCatcherLoaded) {
  window.__criteriaCatcherLoaded = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        switch (msg?.type) {
          case 'PING': {
            // Each project adds what its badge needs.
            const extra = Object.values(PAGE_PROJECTS).map((p) => p.ping?.() || {});
            sendResponse(Object.assign({ ok: true }, ...extra, {
              project: detectProject(),
              busy,
              progress,
              checkProgress
            }));
            break;
          }
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
            const result = await fill(msg.data, msg.options);
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
}
