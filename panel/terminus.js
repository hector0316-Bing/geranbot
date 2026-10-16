/* Criteria Catcher - side panel: Terminus-3rd.

   Terminal Bench 3.0 tasks. Only read from - the task is a zip, so there is
   nothing to type back in and no Input tab.

   Needs panel/core.js. */

/* ---------- the caught Terminus-3rd task ----------
   What the machine said about the submitted zip, in the order it is worked
   through: the task notes, the Quality Judge Panel, the Oracle / NOP run, the
   Summary, and only the quality checks that did not pass. */

function renderTerminus(c) {
  const out = [];
  const block = (title, body) => {
    if (body === null || body === undefined || body === '') return;
    out.push(`${title}\n${'-'.repeat(title.length)}\n${body}\n`);
  };

  out.push(`Stage: ${c.stage === 'review' ? 'Review' : 'Submission'}\n`);

  if (c.pendingChecks?.length) {
    block('Checks still waiting when this was caught', c.pendingChecks.join('\n'));
  }

  // Newest first: it is the one that says what state the task is in now.
  if (c.taskNotes?.length) {
    const notes = [...c.taskNotes].sort((a, b) => (b.latest ? 1 : 0) - (a.latest ? 1 : 0));
    block('Task notes', notes
      .map((n) => `[${n.title}${n.time ? ` - ${n.time}` : ''}${n.latest ? ', newest' : ''}]\n${n.text}`)
      .join('\n\n'));
  }

  block('Quality Judge Panel Feedback', c.qualityPanel);
  block('Oracle / NOP validation', c.oracleNop);
  block('Summary', c.summary
    && (c.summaryRepeatsPanel
      ? `${c.summary}\n\n(The Summary goes on to repeat the Quality Judge Panel Feedback, given in full above.)`
      : c.summary));

  const qc = c.qualityChecks;
  if (qc) {
    if (qc.text) {
      block('Quality check summary', qc.text);
    } else if (qc.failed.length) {
      let section = null;
      const lines = [];
      for (const f of qc.failed) {
        if (f.section && f.section !== section) {
          if (lines.length) lines.push('');
          lines.push(`[${f.section}]`);
          section = f.section;
        }
        lines.push(f.text);
      }
      block(`Quality check summary - ${qc.failed.length} of ${qc.total} did not pass`, lines.join('\n'));
    } else {
      block('Quality check summary', `All ${qc.total} checks passed.`);
    }
  }

  if (c.failedStaticChecks?.length) {
    block('Failed static checks', c.failedStaticChecks.map((r) => {
      const head = `[${r.check}]${r.name ? ` ${r.name}` : ''}: ${r.verdict || 'FAIL'}`;
      return r.text ? `${head}\n${r.text}` : head;
    }).join('\n\n'));
  }

  return out.join('\n').trim();
}

function terminusCatchStatus(data, meta) {
  const c = data.content || {};
  const bits = [];
  if (c.taskNotes) bits.push(`${c.taskNotes.length} task note${c.taskNotes.length === 1 ? '' : 's'}`);
  const boxes = meta.found?.length || 0;
  bits.push(`${boxes} feedback box${boxes === 1 ? '' : 'es'}`);
  let msg = `Caught ${bits.join(', ')}.`;
  if (c.autoEvalPassed === false) msg += '\nThe newest automated run failed.';
  const qc = c.qualityChecks;
  if (qc?.total) {
    msg += qc.failed.length
      ? `\n${qc.failed.length} of ${qc.total} quality checks did not pass.`
      : `\nAll ${qc.total} quality checks passed.`;
  }
  if (c.failedStaticChecks?.length) msg += `\n${c.failedStaticChecks.length} static check${c.failedStaticChecks.length === 1 ? '' : 's'} failed.`;
  msg += !meta.download
    ? '\nNo download button found on the page.'
    : meta.downloadField
      ? `\nScrolled to "${meta.downloadField}".`
      : `\nScrolled to the "${meta.download}" button.`;
  return { msg, kind: 'ok' };
}

/* ---------- registration ---------- */

PROJECTS.terminus = {
  name: 'Terminus-3rd',
  catch: 'Catch feedback',
  readOnly: true,

  render: (data) => renderTerminus(data.content || {}),
  catchStatus: terminusCatchStatus,
  badge: (res) => (res.terminusStage
    ? (res.terminusStage === 'review' ? 'Review' : 'Submission')
    : 'no Terminus feedback found')
};
