import * as vscode from "vscode";

const VIEW_ID = "infrasageView";

interface AuditResult {
  audit_id: string;
  alignment_score: number;
  violation_count: number;
  violations: Array<{ message?: string; line?: number; severity?: string }>;
  unified_diff_patch: string;
  carbon_delta_total?: number;
  timestamp: string;
}

interface SummaryResult {
  average_alignment: number;
  trend_delta: number;
  total_carbon_delta: number;
  violations_resolved: number;
  recent_audits: Array<{
    audit_id: string;
    timestamp: string;
    alignment_score: number;
    violation_count: number;
    patch_applied: boolean;
  }>;
}

export function activate(context: vscode.ExtensionContext) {
  let lastAuditResult: AuditResult | null = null;
  let lastAuditUri: vscode.Uri | null = null;
  let lastAuditFileName: string | null = null;
  let webviewView: vscode.WebviewView | null = null;

  const getApiBase = (): string => {
    const base = vscode.workspace.getConfiguration("infrasage").get<string>("apiBaseUrl") || "";
    return base.replace(/\/$/, "");
  };

  const postToWebview = (message: unknown) => {
    if (webviewView?.webview) {
      webviewView.webview.postMessage(message);
    }
  };

  const runAudit = async (fileName: string, fileContent: string): Promise<AuditResult | null> => {
    const base = getApiBase();
    if (!base) {
      vscode.window.showWarningMessage("InfraSage: Set infrasage.apiBaseUrl in settings.");
      return null;
    }
    try {
      const res = await fetch(`${base}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, fileContent }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Audit failed: ${res.status} ${text}`);
      }
      return (await res.json()) as AuditResult;
    } catch (e) {
      vscode.window.showErrorMessage(`InfraSage audit failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  };

  const fetchSummary = async (): Promise<SummaryResult | null> => {
    const base = getApiBase();
    if (!base) return null;
    try {
      const res = await fetch(`${base}/summary`);
      if (!res.ok) throw new Error(`Summary: ${res.status}`);
      return (await res.json()) as SummaryResult;
    } catch {
      return null;
    }
  };

  const applyUnifiedDiff = (
    content: string,
    patch: string
  ): { content: string; applied: boolean; error?: string } => {
    if (!patch || !patch.trim()) {
      return { content, applied: false, error: "Empty patch" };
    }

    const orig = content.split("\n");
    const patchLines = patch.split("\n");
    const out: string[] = [];

    const hunkHeaderRe = /^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/;

    let origIdx = 0; // 0-based index into orig
    let p = 0;
    let sawHunk = false;
    let appliedAnyChange = false;

    const expectLine = (expected: string, actual: string, kind: string): string | null => {
      if (expected !== actual) {
        return `${kind} mismatch: expected ${JSON.stringify(expected)} but saw ${JSON.stringify(actual)}`;
      }
      return null;
    };

    while (p < patchLines.length) {
      const line = patchLines[p];

      // Skip file headers and empty leading lines
      if (line.startsWith("---") || line.startsWith("+++")) {
        p++;
        continue;
      }

      const m = line.match(hunkHeaderRe);
      if (!m) {
        p++;
        continue;
      }

      sawHunk = true;
      const oldStart1 = Number(m[1]); // 1-based
      if (!Number.isFinite(oldStart1) || oldStart1 < 1) {
        return { content, applied: false, error: `Invalid hunk header: ${line}` };
      }

      // Copy unchanged lines before the hunk
      const targetOrigIdx = oldStart1 - 1;
      if (targetOrigIdx < origIdx || targetOrigIdx > orig.length) {
        return { content, applied: false, error: `Hunk position out of range: ${line}` };
      }
      out.push(...orig.slice(origIdx, targetOrigIdx));
      origIdx = targetOrigIdx;

      p++; // move past @@ header

      // Apply hunk body
      while (p < patchLines.length && !patchLines[p].startsWith("@@")) {
        const hl = patchLines[p];
        if (hl.startsWith("---") || hl.startsWith("+++")) {
          p++;
          continue;
        }

        const prefix = hl[0] ?? "";
        const text = hl.slice(1);

        if (prefix === " ") {
          const actual = orig[origIdx] ?? "";
          const err = expectLine(text, actual, "context");
          if (err) return { content, applied: false, error: err };
          out.push(actual);
          origIdx++;
        } else if (prefix === "-") {
          const actual = orig[origIdx] ?? "";
          const err = expectLine(text, actual, "remove");
          if (err) return { content, applied: false, error: err };
          origIdx++;
          appliedAnyChange = true;
        } else if (prefix === "+") {
          out.push(text);
          appliedAnyChange = true;
        } else if (hl === "\\ No newline at end of file") {
          // ignore
        } else if (hl === "") {
          // treat as empty context line; must match empty actual line
          const actual = orig[origIdx] ?? "";
          const err = expectLine("", actual, "context");
          if (err) return { content, applied: false, error: err };
          out.push(actual);
          origIdx++;
        } else {
          return { content, applied: false, error: `Unexpected patch line: ${hl}` };
        }
        p++;
      }
    }

    if (!sawHunk) {
      return { content, applied: false, error: "Patch has no hunks" };
    }

    // Append remaining original content after last hunk
    out.push(...orig.slice(origIdx));
    const newContent = out.join("\n");
    return { content: newContent, applied: appliedAnyChange, error: appliedAnyChange ? undefined : "No changes applied" };
  };

  const applyPatchToDocument = async (
    doc: vscode.TextDocument,
    patch: string
  ): Promise<boolean> => {
    const content = doc.getText();
    const res = applyUnifiedDiff(content, patch);
    if (!res.applied || res.content === content) return false;
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(content.length)
    );
    edit.replace(doc.uri, fullRange, res.content);
    return vscode.workspace.applyEdit(edit);
  };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!doc.uri.fsPath.endsWith(".tf")) return;
      const base = getApiBase();
      if (!base) return;
      const fileName = doc.uri.fsPath.split(/[/\\]/).pop() || "main.tf";
      const result = await runAudit(fileName, doc.getText());
      if (result) {
        lastAuditResult = result;
        lastAuditUri = doc.uri;
        lastAuditFileName = fileName;
        postToWebview({ type: "auditResult", data: result });
        const summary = await fetchSummary();
        if (summary) postToWebview({ type: "summary", data: summary });
      }
    })
  );

  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(
      view: vscode.WebviewView,
      _resolveContext: vscode.WebviewViewResolveContext,
      _token: vscode.CancellationToken
    ) {
      webviewView = view;
      view.webview.options = {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
      };
      view.webview.html = getWebviewHtml(view.webview);
      view.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === "init") {
          postToWebview({ type: "apiBaseUrl", data: getApiBase() });
          if (lastAuditResult) postToWebview({ type: "auditResult", data: lastAuditResult });
          const summary = await fetchSummary();
          if (summary) postToWebview({ type: "summary", data: summary });
          return;
        }
        if (msg.type === "applyPatch" && lastAuditResult && lastAuditUri) {
          const doc = await vscode.workspace.openTextDocument(lastAuditUri);
          const applied = await applyPatchToDocument(doc, lastAuditResult.unified_diff_patch);
          if (!applied) {
            vscode.window.showWarningMessage(
              "InfraSage: Patch could not be applied (diff did not match the current file). Re-run audit and try again."
            );
            return;
          }
          await doc.save();
          const base = getApiBase();
          try {
            await fetch(`${base}/audit/${lastAuditResult.audit_id}/applied`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                resolvedViolationCount: lastAuditResult.violation_count,
              }),
            });
          } catch {
            // best effort
          }
          const newResult = await runAudit(lastAuditFileName!, doc.getText());
          if (newResult) {
            lastAuditResult = newResult;
            postToWebview({ type: "auditResult", data: newResult });
          }
          const summary = await fetchSummary();
          if (summary) postToWebview({ type: "summary", data: summary });
          return;
        }
        if (msg.type === "rerunAudit" && lastAuditUri) {
          const doc = await vscode.workspace.openTextDocument(lastAuditUri);
          const result = await runAudit(lastAuditFileName || "main.tf", doc.getText());
          if (result) {
            lastAuditResult = result;
            postToWebview({ type: "auditResult", data: result });
          }
          return;
        }
        if (msg.type === "refreshSummary") {
          const summary = await fetchSummary();
          if (summary) postToWebview({ type: "summary", data: summary });
        }
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider)
  );
}

function getWebviewHtml(webview: vscode.Webview): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body { font-family: var(--vscode-font-family); font-size: 13px; margin: 0; padding: 8px; color: var(--vscode-foreground); }
    .tabs { display: flex; gap: 4px; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .tab { padding: 6px 12px; cursor: pointer; border-radius: 4px; }
    .tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .tab:not(.active):hover { background: var(--vscode-toolbar-hoverBackground); }
    .panel { display: none; }
    .panel.active { display: block; }
    .score { font-size: 28px; font-weight: bold; margin: 8px 0; }
    .score.low { color: #f14c4c; }
    .score.mid { color: #cca700; }
    .score.high { color: #89d185; }
    ul { margin: 4px 0; padding-left: 20px; }
    .diff { font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow: auto; border: 1px solid var(--vscode-panel-border); padding: 8px; }
    .diff .minus { color: #f14c4c; }
    .diff .plus { color: #89d185; }
    button { margin: 4px 4px 4px 0; padding: 6px 12px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .summary-line { margin: 6px 0; }
    .recent-list { font-size: 12px; margin-top: 8px; }
    .empty { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="tabs">
    <div class="tab active" data-tab="audit">Audit Results</div>
    <div class="tab" data-tab="summary">Governance Summary</div>
  </div>
  <div id="auditPanel" class="panel active">
    <div id="auditScore" class="score empty">—</div>
    <div id="violations"></div>
    <div id="diffSection" style="display:none;">
      <strong>Diff</strong>
      <pre id="diffContent" class="diff"></pre>
      <button id="applyBtn">Apply Patch</button>
    </div>
    <button id="rerunBtn" style="display:none;">Re-run Audit</button>
  </div>
  <div id="summaryPanel" class="panel">
    <div class="summary-line"><strong>Average alignment:</strong> <span id="avgAlign">—</span></div>
    <div class="summary-line"><strong>Trend:</strong> <span id="trend">—</span></div>
    <div class="summary-line"><strong>Total carbon delta:</strong> <span id="carbon">—</span></div>
    <div class="summary-line"><strong>Violations resolved:</strong> <span id="resolved">—</span></div>
    <div class="recent-list"><strong>Recent audits</strong><ul id="recentList"></ul></div>
    <button id="refreshSummaryBtn">Refresh</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    let auditData = null;
    function scoreClass(s) {
      if (s >= 80) return 'high';
      if (s >= 50) return 'mid';
      return 'low';
    }
    function renderDiff(patch) {
      if (!patch) return '';
      return patch.split('\\n').map(l => {
        if (l.startsWith('-') && !l.startsWith('---')) return '<span class="minus">' + escapeHtml(l) + '</span>';
        if (l.startsWith('+') && !l.startsWith('+++')) return '<span class="plus">' + escapeHtml(l) + '</span>';
        return escapeHtml(l);
      }).join('\\n');
    }
    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }
    document.querySelectorAll('.tab').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        el.classList.add('active');
        document.getElementById(el.dataset.tab + 'Panel').classList.add('active');
      });
    });
    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'auditResult') {
        auditData = msg.data;
        const s = document.getElementById('auditScore');
        s.textContent = auditData.alignment_score + ' / 100';
        s.className = 'score ' + scoreClass(auditData.alignment_score);
        const v = document.getElementById('violations');
        v.innerHTML = '<strong>Violations (' + (auditData.violations && auditData.violations.length) + ')</strong>' +
          (auditData.violations && auditData.violations.length
            ? '<ul>' + auditData.violations.map(x => '<li>' + escapeHtml(x.message || '') + '</li>').join('') + '</ul>'
            : '<p class="empty">None</p>');
        const diffSec = document.getElementById('diffSection');
        const diffContent = document.getElementById('diffContent');
        const applyBtn = document.getElementById('applyBtn');
        const rerunBtn = document.getElementById('rerunBtn');
        if (auditData.unified_diff_patch) {
          diffSec.style.display = 'block';
          diffContent.innerHTML = renderDiff(auditData.unified_diff_patch);
          applyBtn.style.display = 'inline-block';
        }
        rerunBtn.style.display = 'inline-block';
      }
      if (msg.type === 'summary') {
        const d = msg.data || {};
        const num = (n) => (typeof n === 'number' && !Number.isNaN(n) ? n : null);
        const avg = num(d.average_alignment);
        const trend = num(d.trend_delta);
        const carbon = num(d.total_carbon_delta);
        const resolved = num(d.violations_resolved);
        document.getElementById('avgAlign').textContent = avg !== null ? String(avg) : '—';
        document.getElementById('trend').textContent = trend !== null ? (trend >= 0 ? '+' : '') + trend : '—';
        document.getElementById('carbon').textContent = carbon !== null ? String(carbon) : '—';
        document.getElementById('resolved').textContent = resolved !== null ? String(resolved) : '—';
        const list = document.getElementById('recentList');
        const recent = Array.isArray(d.recent_audits) ? d.recent_audits : [];
        const ts = (a) => (typeof a.timestamp === 'string' ? a.timestamp : (a.timestamp && a.timestamp.S) ? a.timestamp.S : '');
        list.innerHTML = recent.length
          ? recent.map(a => '<li>' + (a.alignment_score ?? 0) + ' – ' + ts(a) + '</li>').join('')
          : '<li class="empty">No audits yet</li>';
      }
    });
    document.getElementById('applyBtn').addEventListener('click', () => {
      if (auditData) vscode.postMessage({ type: 'applyPatch' });
    });
    document.getElementById('rerunBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'rerunAudit' });
    });
    document.getElementById('refreshSummaryBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'refreshSummary' });
    });
    vscode.postMessage({ type: 'init' });
  </script>
</body>
</html>`;
}

export function deactivate() {}
