/* Criteria Catcher - side panel, shared by every project.

   The panel's scripts load in the order panel.html lists them - this file,
   then one per project, then main.js - into one page, sharing one global
   scope. Each project file registers itself in PROJECTS with what it shows
   and says; main.js runs the panel and asks the chosen project for those.

   What a project can register:

     name, catch, toInput, copied, placeholder   wording on the panel
     readOnly                                    nothing to type back in
     entry                                       Entry setting it starts with
     render(data)                                the Content block
     answers(data)                               the Answers box, if it has one
     toInputText(data)                           what Send to input writes
     catchOptions() / applyOptions()             extra options for the page
     catchStatus(data, meta)  -> { msg, kind }   the line after a catch
     applyStatus(result)      -> { msg, clean }  the line after a fill
     badge(res)                                  the badge beside the title
     saveState() / loadState(saved)              its own settings, per tab

   Nothing here may call into main.js while loading: main.js loads last, so
   its functions exist only once the panel is running. Event handlers that
   need them wrap the call - () => save() - rather than passing it. */

const $ = (id) => document.getElementById(id);

const PROJECTS = {};

// Local time, stamped when the catch happened rather than when it is redrawn,
// so a restored session still shows when it was taken.
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// The answers as the page holds them: the keys it asks for, in the order it
// asks for them, with whatever is already filled in. Edit and send back.
function answersJson(answers) {
  return JSON.stringify({ answers: answers || {} }, null, 2);
}

