import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, type PrismTheme } from "prism-react-renderer";

const CHASSIS_THEME: PrismTheme = {
  plain: { color: "#e8eef3", backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "#606b78", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "#9aa6b3" } },
    { types: ["namespace"], style: { opacity: 0.7 } },
    { types: ["property", "tag", "constant", "symbol", "deleted"], style: { color: "#ef5a4d" } },
    { types: ["boolean", "number"], style: { color: "#f0a83a" } },
    { types: ["selector", "attr-name", "string", "char", "builtin", "inserted"], style: { color: "#3fc97a" } },
    { types: ["operator", "entity", "url"], style: { color: "#ff8a3d" } },
    { types: ["atrule", "attr-value", "keyword"], style: { color: "#b08aff", fontWeight: "500" } },
    { types: ["function", "class-name"], style: { color: "#ff8a3d", fontWeight: "500" } },
    { types: ["regex", "important", "variable"], style: { color: "#f0a83a" } },
    { types: ["important", "bold"], style: { fontWeight: "600" } },
    { types: ["italic"], style: { fontStyle: "italic" } },
  ],
};

function languageFromClass(className?: string): string {
  if (!className) return "python";
  const m = /language-(\w+)/.exec(className);
  if (!m) return "python";
  const lang = m[1]!.toLowerCase();
  if (lang === "py" || lang === "ipython3") return "python";
  if (lang === "sh" || lang === "shell" || lang === "zsh") return "bash";
  return lang;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <Highlight code={code} language={language} theme={CHASSIS_THEME}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <code className="nb-hl-code">
          {tokens.map((line, i) => {
            const { key: _k, ...lineProps } = getLineProps({ line, key: i });
            return (
              <div key={i} {...lineProps} className="nb-hl-line">
                {line.map((token, j) => {
                  const { key: _kk, ...tokenProps } = getTokenProps({ token, key: j });
                  return <span key={j} {...tokenProps} />;
                })}
              </div>
            );
          })}
        </code>
      )}
    </Highlight>
  );
}

type SlimCell =
  | { kind: "markdown"; src: string }
  | { kind: "code"; src: string; outputs: SlimOutput[] };

type SlimOutput =
  | { kind: "text"; text: string }
  | { kind: "image"; mime: string; b64: string }
  | { kind: "error"; ename: string; evalue: string; traceback: string };

type NotebookJson = { slug: string; cells: SlimCell[] };

export function NotebookRenderer({ id }: { id: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; cells: SlimCell[] } | { status: "error"; msg: string }>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/notebooks/${id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<NotebookJson>;
      })
      .then((nb) => {
        if (!cancelled) setState({ status: "ready", cells: nb.cells });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", msg: String(e?.message ?? e) });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === "loading") {
    return (
      <div className="nb-status">
        <span className="nb-status-text">Loading notebook…</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="nb-status nb-status-error">
        <span className="nb-status-text">Could not load notebook: {state.msg}</span>
      </div>
    );
  }

  return (
    <div className="nb">
      {state.cells.map((c, i) => (
        <Cell key={i} cell={c} index={i} />
      ))}
    </div>
  );
}

function Cell({ cell, index }: { cell: SlimCell; index: number }) {
  if (cell.kind === "markdown") return <MarkdownCell src={cell.src} />;
  return <CodeCell cell={cell} index={index} />;
}

function MarkdownCell({ src }: { src: string }) {
  return (
    <div className="nb-cell nb-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {src}
      </ReactMarkdown>
    </div>
  );
}

function CodeCell({ cell, index }: { cell: SlimCell & { kind: "code" }; index: number }) {
  return (
    <div className="nb-cell nb-code-cell">
      <div className="nb-code">
        <div className="nb-code-gutter">
          In&nbsp;[{index + 1}]:
        </div>
        <pre className="nb-code-pre">
          <CodeBlock code={cell.src} language="python" />
        </pre>
      </div>
      {cell.outputs.length > 0 ? (
        <div className="nb-outputs">
          {cell.outputs.map((o, j) => (
            <Output key={j} out={o} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Output({ out }: { out: SlimOutput }) {
  if (out.kind === "image") {
    return (
      <div className="nb-output nb-output-image">
        <img src={`data:${out.mime};base64,${out.b64}`} alt="notebook output" />
      </div>
    );
  }
  if (out.kind === "error") {
    return (
      <div className="nb-output nb-output-error">
        <div className="nb-output-error-head">
          {out.ename}: {out.evalue}
        </div>
        <pre className="nb-output-error-tb">{out.traceback}</pre>
      </div>
    );
  }
  return (
    <div className="nb-output nb-output-text">
      <pre>{out.text}</pre>
    </div>
  );
}

const mdComponents = {
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} target="_blank" rel="noreferrer" />
  ),
  code: ({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      const lang = languageFromClass(className);
      const code = String(children ?? "").replace(/\n$/, "");
      return (
        <pre className="nb-md-pre">
          <CodeBlock code={code} language={lang} />
        </pre>
      );
    }
    return (
      <code className="nb-md-inline" {...rest}>
        {children}
      </code>
    );
  },
  table: (props: React.TableHTMLAttributes<HTMLTableElement>) => (
    <div className="nb-md-table-wrap">
      <table className="nb-md-table" {...props} />
    </div>
  ),
};

export const NOTEBOOK_STYLES = `
.nb-status {
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-low);
  font: 400 12.5px/19px var(--font-mono);
}
.nb-status-error { color: var(--status-byzantine); border-color: var(--status-byzantine); }

.nb {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-top: var(--space-3);
}
.nb-cell { min-width: 0; }

/* --- markdown cells --- */
.nb-md {
  color: var(--text-hi);
  font: 400 14px/22px var(--font-sans);
}
.nb-md h1 { font: 600 22px/28px var(--font-sans); margin: var(--space-3) 0 var(--space-2); letter-spacing: -0.3px; color: var(--text-hi); }
.nb-md h2 { font: 600 18px/24px var(--font-sans); margin: var(--space-3) 0 var(--space-2); letter-spacing: -0.2px; color: var(--text-hi); }
.nb-md h3 { font: 600 15px/22px var(--font-sans); margin: var(--space-3) 0 6px; color: var(--text-hi); }
.nb-md h4, .nb-md h5, .nb-md h6 {
  font: 500 12px/16px var(--font-mono);
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-mid);
  margin: var(--space-2) 0 4px;
}
.nb-md p { margin: 0 0 var(--space-2); color: var(--text-mid); }
.nb-md ul, .nb-md ol { margin: 0 0 var(--space-2); padding-left: 22px; color: var(--text-mid); }
.nb-md li { margin: 0 0 4px; line-height: 21px; }
.nb-md li > p { margin: 0 0 4px; }
.nb-md hr { border: 0; border-top: 1px solid var(--border-subtle); margin: var(--space-3) 0; }
.nb-md a {
  color: var(--accent-primary);
  text-decoration: none;
  border-bottom: 1px dotted var(--accent-dim);
}
.nb-md a:hover { border-bottom-color: var(--accent-primary); }
.nb-md strong { color: var(--text-hi); font-weight: 600; }
.nb-md em { color: var(--text-hi); }
.nb-md blockquote {
  margin: var(--space-2) 0;
  padding: 6px var(--space-3);
  border-left: 2px solid var(--accent-dim);
  color: var(--text-mid);
  background: rgba(var(--accent-rgb), 0.04);
}
.nb-md-inline {
  font: 400 12px/16px var(--font-mono);
  background: rgba(var(--accent-rgb), 0.08);
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  padding: 0 4px;
  color: var(--accent-primary);
}
.nb-md-pre {
  margin: var(--space-2) 0;
  padding: var(--space-3);
  background: rgba(0, 0, 0, 0.30);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font: 400 12px/19px var(--font-mono);
  color: var(--text-hi);
}
.nb-md-table-wrap { overflow-x: auto; margin: var(--space-2) 0; }
.nb-md-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12.5px;
}
.nb-md-table th, .nb-md-table td {
  padding: 6px 10px;
  border: 1px solid var(--border-subtle);
  text-align: left;
  vertical-align: top;
  color: var(--text-mid);
}
.nb-md-table th {
  background: var(--surface-2);
  color: var(--text-hi);
  font-weight: 500;
  font: 500 11px/14px var(--font-mono);
  letter-spacing: 0.6px;
  text-transform: uppercase;
}
.nb-md-table tr:nth-child(even) td { background: rgba(0,0,0,0.12); }

/* --- code cells --- */
.nb-code {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 0;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.nb-code-gutter {
  padding: 10px 8px;
  background: rgba(0, 0, 0, 0.25);
  color: var(--accent-primary);
  font: 400 10.5px/14px var(--font-mono);
  letter-spacing: 0.3px;
  text-align: right;
  border-right: 1px solid var(--border-subtle);
  white-space: nowrap;
}
.nb-code-pre {
  margin: 0;
  padding: 10px var(--space-3);
  font: 400 12px/19px var(--font-mono);
  color: var(--text-hi);
  overflow-x: auto;
}
.nb-hl-code {
  display: block;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  white-space: pre;
}
.nb-hl-line { display: block; }

/* --- outputs --- */
.nb-outputs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding-left: 64px;
}
.nb-output { min-width: 0; }
.nb-output-text pre {
  margin: 0;
  padding: 8px var(--space-3);
  background: rgba(0,0,0,0.20);
  border-left: 2px solid var(--border-subtle);
  font: 400 11.5px/17px var(--font-mono);
  color: var(--text-mid);
  white-space: pre-wrap;
  overflow-x: auto;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.nb-output-image {
  padding: var(--space-2) var(--space-3);
  background: #f4f4f4;
  border-radius: var(--radius-sm);
  text-align: center;
}
.nb-output-image img {
  max-width: 100%;
  height: auto;
  display: inline-block;
}
.nb-output-error {
  padding: 8px var(--space-3);
  background: rgba(239, 90, 77, 0.06);
  border-left: 2px solid var(--status-byzantine);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.nb-output-error-head {
  color: var(--status-byzantine);
  font: 500 12px/18px var(--font-mono);
}
.nb-output-error-tb {
  margin: 4px 0 0;
  font: 400 11px/16px var(--font-mono);
  color: var(--text-mid);
  white-space: pre-wrap;
  overflow-x: auto;
}
`;
