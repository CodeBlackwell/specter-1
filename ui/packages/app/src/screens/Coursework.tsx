import { useEffect, useRef, useState } from "react";
import { Cluster, LinkifyRefs, Mono, Pill, Stack, adrPath, adrUrl } from "../lib";
import { useSimStore } from "../sim";
import { ARCS, NOTEBOOKS, type Arc, type Notebook } from "../data/notebooks";
import { NotebookRenderer, NOTEBOOK_STYLES } from "./NotebookRenderer";

const READING_PATHS: ReadonlyArray<{ who: string; path: string; why: string }> = [
  {
    who: "Hardware integrator",
    path: "09 → 01 → 02 → 13 → 06 → 07",
    why: "Notebook 09's ABC-seam diagram is the porting contract; 13 covers the roster/key boundary you'll re-implement against a real attestation provider.",
  },
  {
    who: "Reviewer — 30 min top-down",
    path: "01 → 03 → 06 → 10 → 12 → 09",
    why: "Each ends with a measured claim cell citing tests/eval/. Stop after any notebook and you have a verified subclaim.",
  },
  {
    who: "Security engineer auditing trust math",
    path: "03 → 04 → 08 → 02 → 13",
    why: "Beta dynamics → range-only voting → attack battery → identity → roster/key lifecycle. The full math + boundary surface.",
  },
  {
    who: "SLAM researcher",
    path: "05 → 06 → 10 → 11 → 12",
    why: "Sensor realism → local SLAM → pose-graph + loop closure → cooperative SLAM under pose_lie → exogenous-prior DCS recovering symmetry.",
  },
  {
    who: "Curious first-time visitor",
    path: "01 → 03 → 12 → 09",
    why: "Crypto envelope → reputation math → trust↔SLAM coupling → full Byzantine swarm.",
  },
];

const ARC_BLURBS: Record<Arc, string> = {
  "Foundations": "Wire integrity and identity — the boundary the rest of the system rests on.",
  "Trust": "Beta(α, β) reputation, range-only voting, gossip — the math that turns raw observations into a defensible trust scalar.",
  "Sim & SLAM": "Sensor noise budget and the local-SLAM stack — what each agent computes before the swarm starts talking.",
  "Composition": "Putting it all together: the attack-battery tour and the full Byzantine-swarm demo.",
};

const NAV_PRELUDE: ReadonlyArray<{ id: string; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "manifesto", label: "Discipline" },
  { id: "paths", label: "Reading paths" },
];

const arcSlug = (arc: Arc) => arc.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const notebookSlug = (id: string) => `n${id}`;

const GITHUB_NOTEBOOK_BASE =
  "https://github.com/CodeBlackwell/specter-1/blob/main/notebooks";
const notebookGithubUrl = (slug: string) => `${GITHUB_NOTEBOOK_BASE}/${slug}.ipynb`;

const Linkify = ({ text }: { text: string }) => (
  <LinkifyRefs text={text} className="cw-adr-link" />
);

export function Coursework() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>(NAV_PRELUDE[0]!.id);

  const ids: string[] = [
    ...NAV_PRELUDE.map((p) => p.id),
    ...ARCS.flatMap((arc) => [arcSlug(arc), ...NOTEBOOKS.filter((n) => n.arc === arc).map((n) => notebookSlug(n.id))]),
  ];

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { root, rootMargin: "-20% 0px -65% 0px", threshold: 0 },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [ids.join("|")]);

  const goTo = (id: string) => {
    const scroller = scrollRef.current;
    const el = document.getElementById(id);
    if (!el || !scroller) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Lazy-mounted notebooks above the target finish fetching and grow after the
    // smooth scroll has already locked in its target offset — re-anchor briefly
    // so the final resting position is the section the user clicked.
    const content = scroller.firstElementChild;
    if (!content) return;
    const ro = new ResizeObserver(() => {
      const target = document.getElementById(id);
      target?.scrollIntoView({ behavior: "auto", block: "start" });
    });
    ro.observe(content);
    window.setTimeout(() => ro.disconnect(), 2000);
  };

  return (
    <div
      ref={scrollRef}
      data-cw-scroll
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "var(--space-5) var(--space-6) var(--space-6)",
      }}
    >
      <div className="cw-layout">
        <TocNav active={active} onSelect={goTo} />
        <main className="cw-main">
          <Stack gap={6}>
            <section id="overview" className="cw-anchor">
              <Masthead />
            </section>
            <section id="manifesto" className="cw-anchor">
              <Manifesto />
            </section>
            <section id="paths" className="cw-anchor">
              <ReadingPaths />
            </section>
            {ARCS.map((arc) => {
              const items = NOTEBOOKS.filter((n) => n.arc === arc);
              if (items.length === 0) return null;
              return <ArcSection key={arc} arc={arc} items={items} />;
            })}
            <Footnote />
          </Stack>
        </main>
      </div>
      <style>{styles}</style>
      <style>{NOTEBOOK_STYLES}</style>
    </div>
  );
}

function TocNav({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <aside className="cw-rail">
      <div className="cw-toc">
        <Mono size="sm" muted className="t-label cw-toc-head">
          Contents
        </Mono>
        <ul className="cw-toc-list">
          {NAV_PRELUDE.map((p) => (
            <TocItem key={p.id} id={p.id} label={p.label} active={active === p.id} onSelect={onSelect} />
          ))}
          {ARCS.map((arc) => {
            const items = NOTEBOOKS.filter((n) => n.arc === arc);
            if (items.length === 0) return null;
            const arcId = arcSlug(arc);
            return (
              <li key={arc} className="cw-toc-group">
                <TocItem id={arcId} label={arc} active={active === arcId} onSelect={onSelect} group />
                <ul className="cw-toc-sublist">
                  {items.map((n) => {
                    const id = notebookSlug(n.id);
                    return (
                      <TocItem
                        key={n.id}
                        id={id}
                        label={`${n.id} · ${n.title}`}
                        active={active === id}
                        onSelect={onSelect}
                        sub
                      />
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

function TocItem({
  id,
  label,
  active,
  onSelect,
  group = false,
  sub = false,
}: {
  id: string;
  label: string;
  active: boolean;
  onSelect: (id: string) => void;
  group?: boolean;
  sub?: boolean;
}) {
  const cls = ["cw-toc-link", group && "cw-toc-link-group", sub && "cw-toc-link-sub", active && "cw-toc-link-active"]
    .filter(Boolean)
    .join(" ");
  return (
    <li>
      <button type="button" className={cls} onClick={() => onSelect(id)}>
        <span className="cw-toc-marker" aria-hidden />
        <span className="cw-toc-text">{label}</span>
      </button>
    </li>
  );
}

function Masthead() {
  return (
    <header className="cw-mast">
      <Cluster gap={2} align="center">
        <Mono size="sm" muted className="t-label">
          SPECTER · 1
        </Mono>
        <span className="cw-mast-meta">Workshop curriculum</span>
        <span className="cw-mast-meta">13 notebooks · ~5 min wall-clock</span>
      </Cluster>
      <h1 className="cw-mast-title">
        When robots map together, any one of them can lie —
        <span className="cw-mast-emph"> these 13 notebooks teach you to detect and survive the liar without trusting anyone.</span>
      </h1>
      <p className="cw-mast-lede">
        <strong className="cw-mast-tag">The problem.</strong> A swarm builds a shared map by
        gossiping observations. One compromised peer — lying about its pose, forging an
        identity, colluding with a twin — can poison that map for everyone. Mutual
        corroboration isn't enough: two liars can vouch for each other.
      </p>
      <p className="cw-mast-lede">
        <strong className="cw-mast-tag">What you'll learn, in order.</strong> Sign the wire so
        no one can forge a message (N01). Score peers with Beta(α,β) reputation that decays on
        contradiction (N02–N03). Vote on range-only geometry so colluders can't fake a pose
        (N04). Tour the attack battery — fuzz, mid-mission flip, partition+gossip, Sybil
        presence, map corruption (N05–N08). Build local then cooperative SLAM (N09–N11).
        Couple trust ↔ SLAM so the reputation scalar gates the pose graph (N12–N13).
      </p>
      <p className="cw-mast-lede">
        <strong className="cw-mast-tag">The contract.</strong> Every notebook ends with a
        measured claim cell that cites the CI-gated test in{" "}
        <Linkify text="tests/eval" />. Read one — verified subclaim. Read all 13 in
        ~30 minutes — full Byzantine-resilient stack.
      </p>
      <div className="cw-mast-rubric" aria-label="How to read each notebook">
        <div className="cw-rubric-head">
          <Mono size="sm" muted className="t-label">
            How to read each notebook
          </Mono>
          <span className="cw-rubric-sub">
            Every entry follows the same three-beat structure laid out by the
            workshop-as-audit-surface design (<Linkify text="docs/adr/0014-workshop-notebooks-as-audit-surface.md" />).
          </span>
        </div>
        <ol className="cw-rubric-list">
          <RubricRow
            tag="Intuition"
            body="Build the mental model — what is this concept, why does it matter, what does it look like running."
          />
          <RubricRow
            tag="Claim"
            body="Run the real library, then assert a measured bound. Each claim cites the test in tests/eval/ that gates it in CI."
          />
          <RubricRow
            tag="Limit"
            body="Name the residual gap honestly. Where the claim stops holding, and which ADR / THREAT_MODEL entry captures it."
          />
        </ol>
      </div>
    </header>
  );
}

function RubricRow({ tag, body }: { tag: string; body: string }) {
  return (
    <li className="cw-rubric-row">
      <span className="cw-rubric-tag">{tag}</span>
      <span className="cw-rubric-body">
        <Linkify text={body} />
      </span>
    </li>
  );
}

function Manifesto() {
  return (
    <Stack gap={3}>
      <SectionHead label="Discipline" sub="What makes these notebooks an audit surface instead of a tutorial." />
      <div className="cw-manifesto">
        <ManifestoCard
          head="Import-only"
          body="Notebooks call the real library — no parallel reimplementation, no drift. If a library function gets renamed, every notebook fails CI before a learner is misled."
        />
        <ManifestoCard
          head="Three cell types"
          body="Intuition, claim, limit — the workshop-as-audit-surface contract (docs/adr/0014-workshop-notebooks-as-audit-surface.md). Intuition builds the mental model. Claim cites a measured bound from tests/eval/. Limit names the residual gap honestly."
        />
        <ManifestoCard
          head="CI-gated"
          body="The CI workflow re-executes every notebook end-to-end via nbconvert on every PR. Drift fails the build."
        />
      </div>
    </Stack>
  );
}

function ManifestoCard({ head, body }: { head: string; body: string }) {
  return (
    <div className="cw-manifesto-card">
      <Mono size="sm" className="cw-manifesto-head">
        {head}
      </Mono>
      <p className="cw-manifesto-body">
        <Linkify text={body} />
      </p>
    </div>
  );
}

function ReadingPaths() {
  return (
    <Stack gap={3}>
      <SectionHead label="Reading paths" sub="Different readers want different things." />
      <div className="cw-paths">
        {READING_PATHS.map((p) => (
          <div key={p.who} className="cw-path">
            <div className="cw-path-who">{p.who}</div>
            <Mono size="sm" className="cw-path-route">
              {p.path}
            </Mono>
            <div className="cw-path-why">
              <Linkify text={p.why} />
            </div>
          </div>
        ))}
      </div>
    </Stack>
  );
}

function ArcSection({ arc, items }: { arc: Arc; items: ReadonlyArray<Notebook> }) {
  return (
    <section id={arcSlug(arc)} className="cw-anchor">
      <Stack gap={3}>
        <SectionHead label={arc} sub={ARC_BLURBS[arc]} />
        <Stack gap={3}>
          {items.map((n) => (
            <NotebookEntry key={n.id} notebook={n} />
          ))}
        </Stack>
      </Stack>
    </section>
  );
}

function NotebookEntry({ notebook }: { notebook: Notebook }) {
  const setMode = useSimStore((s) => s.setMode);
  const selectLesson = useSimStore((s) => s.selectLesson);
  const articleRef = useRef<HTMLElement>(null);
  const [mountCells, setMountCells] = useState(false);

  useEffect(() => {
    const el = articleRef.current;
    if (!el || mountCells) return;
    const scroller = el.closest('[data-cw-scroll]') as HTMLElement | null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setMountCells(true);
          observer.disconnect();
        }
      },
      { root: scroller, rootMargin: "300px 0px 300px 0px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mountCells]);

  const tryLive = notebook.liveLesson
    ? () => {
        selectLesson(notebook.liveLesson!);
        setMode("workshop");
      }
    : undefined;

  return (
    <article ref={articleRef} id={notebookSlug(notebook.id)} className="cw-entry cw-anchor">
      <div className="cw-entry-num">{notebook.id}</div>
      <div className="cw-entry-body">
        <header className="cw-entry-head">
          <h2 className="cw-entry-title">{notebook.title}</h2>
          <Cluster gap={1} align="center">
            <a
              className="cw-entry-slug"
              href={notebookGithubUrl(notebook.slug)}
              target="_blank"
              rel="noopener noreferrer"
              title="View on GitHub"
            >
              <code>notebooks/{notebook.slug}.ipynb</code>
              <span aria-hidden="true" style={{ marginLeft: 6, opacity: 0.7 }}>
                ↗
              </span>
            </a>
            <Pill tone="accent">{notebook.arc}</Pill>
          </Cluster>
        </header>
        <p className="cw-entry-teaches">
          <Linkify text={notebook.teaches} />
        </p>
        <div className="cw-entry-meta">
          <MetaItem label="Proves" body={notebook.proves} mono />
          <MetaItem label="Known limit" body={notebook.limit} />
        </div>
        {tryLive ? (
          <Cluster gap={2} align="center" style={{ marginTop: 4 }}>
            <button type="button" className="cw-entry-live" onClick={tryLive}>
              ▶ Try it live
            </button>
            <Mono size="sm" muted>
              → Workshop · L{notebook.liveLesson}
            </Mono>
          </Cluster>
        ) : null}
        {mountCells ? <NotebookRenderer id={notebook.id} /> : null}
      </div>
    </article>
  );
}

function MetaItem({ label, body, mono = false }: { label: string; body: string; mono?: boolean }) {
  return (
    <div className="cw-meta-item">
      <Mono size="sm" muted className="t-label cw-meta-label">
        {label}
      </Mono>
      <div className={mono ? "cw-meta-body cw-mono" : "cw-meta-body"}>
        <Linkify text={body} />
      </div>
    </div>
  );
}

function SectionHead({ label, sub }: { label: string; sub: string }) {
  return (
    <header className="cw-section-head">
      <h2 className="cw-section-title">{label}</h2>
      <p className="cw-section-sub">{sub}</p>
      <span className="cw-section-rule" />
    </header>
  );
}

function Footnote() {
  return (
    <footer className="cw-footnote">
      <p>
        Run all 13 end-to-end with{" "}
        <code className="cw-inline-code">just workshop-check</code> — five minutes of laptop
        wall-clock and the curriculum is verified intact against the library. Or open them in
        Jupyter with <code className="cw-inline-code">just workshop</code> and step through one by
        one. The discipline behind this format lives in the workshop-as-audit-surface
        ADR (<a
          className="cw-inline-code cw-adr-link"
          href={adrUrl("0014")}
          target="_blank"
          rel="noopener noreferrer"
        >{adrPath("0014")}</a>).
      </p>
    </footer>
  );
}

const styles = `
.cw-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: var(--space-5);
  max-width: 1140px;
  margin: 0 auto;
}
.cw-main { min-width: 0; max-width: 820px; }

.cw-anchor { scroll-margin-top: 24px; }

/* === RAIL (TOC) === */
.cw-rail {
  position: sticky;
  top: 0;
  align-self: start;
  max-height: calc(100vh - 100px);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-right: var(--space-2);
}
.cw-toc {
  flex: 1 1 60%;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3) 0 var(--space-2);
}
.cw-toc::-webkit-scrollbar { width: 4px; }
.cw-toc::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 2px; }
.cw-toc-head {
  display: block;
  padding-left: 16px;
  margin-bottom: var(--space-2);
}
.cw-toc-list,
.cw-toc-sublist {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cw-toc-group { margin-top: var(--space-2); }
.cw-toc-sublist { margin-top: 2px; }

.cw-toc-link {
  width: 100%;
  background: transparent;
  border: 0;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  cursor: pointer;
  color: var(--text-mid);
  font: 400 13.5px/19px var(--font-sans);
  border-radius: var(--radius-sm);
  transition: color 120ms, background 120ms;
}
.cw-toc-marker {
  width: 2px;
  align-self: stretch;
  background: transparent;
  border-radius: 2px;
  transition: background 120ms;
}
.cw-toc-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-toc-link:hover { color: var(--text-hi); background: rgba(255,255,255,0.03); }
.cw-toc-link:hover .cw-toc-marker { background: var(--border-strong); }

.cw-toc-link-group {
  font: 700 12px/15px var(--font-mono);
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-mid);
  margin-top: var(--space-1);
}
.cw-toc-link-sub {
  padding-left: 16px;
  font-size: 13px;
  color: var(--text-mid);
}

.cw-toc-link-active {
  color: var(--accent-primary);
  background: var(--accent-dim);
}
.cw-toc-link-active .cw-toc-marker { background: var(--accent-primary); }
.cw-toc-link-active.cw-toc-link-group { color: var(--accent-primary); }

/* === MASTHEAD === */
.cw-mast {
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-strong);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.cw-mast-meta {
  font: 600 12px/15px var(--font-mono);
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-mid);
  padding: 3px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}
.cw-mast-title {
  margin: 0;
  font: 600 32px/40px var(--font-sans);
  letter-spacing: -0.6px;
  color: var(--text-hi);
}
.cw-mast-emph { color: var(--accent-primary); }
.cw-mast-lede {
  margin: 0;
  font: 400 15.5px/25px var(--font-sans);
  color: var(--text-mid);
  max-width: 700px;
}
.cw-mast-tag {
  color: var(--text-hi);
  font-weight: 700;
  margin-right: 4px;
}
.cw-mast-rubric {
  margin-top: var(--space-2);
  padding: var(--space-3) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 680px;
}
.cw-rubric-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cw-rubric-sub {
  font: 400 13.5px/20px var(--font-sans);
  color: var(--text-mid);
}
.cw-rubric-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}
.cw-rubric-row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: var(--space-2);
  align-items: baseline;
}
.cw-rubric-tag {
  font: 700 11.5px/16px var(--font-mono);
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--accent-primary);
}
.cw-rubric-body {
  font: 400 14px/21px var(--font-sans);
  color: var(--text-mid);
}

/* === ADR LINKS === */
.cw-adr-link {
  color: var(--accent-primary);
  text-decoration: none;
  border-bottom: 1px dotted var(--accent-primary);
  transition: color 120ms, border-color 120ms;
}
.cw-adr-link:hover {
  color: var(--text-hi);
  border-bottom-color: var(--text-hi);
}

/* === MANIFESTO === */
.cw-manifesto {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-3);
}
.cw-manifesto-card {
  padding: var(--space-3) var(--space-4);
  border-left: 2px solid var(--accent-dim);
  background: rgba(var(--accent-rgb), 0.04);
}
.cw-manifesto-head {
  color: var(--accent-primary);
  display: block;
  margin-bottom: 4px;
}
.cw-manifesto-body {
  margin: 0;
  font: 400 14px/22px var(--font-sans);
  color: var(--text-mid);
}

/* === SECTION HEAD === */
.cw-section-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.cw-section-title {
  margin: 0;
  font: 700 13.5px/18px var(--font-mono);
  color: var(--accent-primary);
  text-transform: uppercase;
  letter-spacing: 1.2px;
}
.cw-section-sub {
  margin: 0;
  font: 400 14px/21px var(--font-sans);
  color: var(--text-mid);
  flex: 1 1 auto;
  min-width: 240px;
}
.cw-section-rule {
  flex: 0 0 100%;
  height: 1px;
  background: linear-gradient(90deg, var(--border-strong), transparent);
  margin-top: 4px;
}

/* === READING PATHS === */
.cw-paths {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-2) var(--space-4);
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-3);
}
.cw-path {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: var(--space-2);
}
.cw-path-who {
  font: 600 14px/21px var(--font-sans);
  color: var(--text-hi);
}
.cw-path-route {
  color: var(--accent-primary);
  font-size: 13px;
  font-weight: 500;
}
.cw-path-why {
  font: 400 13.5px/21px var(--font-sans);
  color: var(--text-mid);
}

/* === NOTEBOOK ENTRIES === */
.cw-entry {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--border-subtle);
}
.cw-entry-num {
  font-size: 40px;
  line-height: 1;
  color: var(--accent-primary);
  font-family: var(--font-mono);
  font-weight: 600;
  padding-top: 2px;
  text-shadow: 0 0 18px rgba(var(--accent-rgb), 0.30);
}
.cw-entry-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.cw-entry-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cw-entry-title {
  margin: 0;
  font: 600 23px/30px var(--font-sans);
  letter-spacing: -0.3px;
  color: var(--text-hi);
}
.cw-entry-slug {
  font: 500 12.5px/17px var(--font-mono);
  color: var(--text-mid);
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--border-subtle);
  padding: 2px 8px;
  border-radius: 4px;
  text-decoration: none;
  transition: color 120ms, border-color 120ms, background 120ms;
}
.cw-entry-slug:hover {
  color: var(--accent-primary);
  border-color: var(--accent-dim);
  background: rgba(var(--accent-rgb), 0.08);
}
.cw-entry-teaches {
  margin: 0;
  font: 400 15px/23px var(--font-sans);
  color: var(--text-mid);
}
.cw-entry-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: rgba(0,0,0,0.20);
  border-left: 2px solid var(--border-subtle);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.cw-meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cw-meta-label { display: block; }
.cw-meta-body {
  font: 400 13.5px/21px var(--font-sans);
  color: var(--text-hi);
}
.cw-meta-body.cw-mono {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--accent-primary);
  word-break: break-all;
}

.cw-entry-live {
  background: transparent;
  border: 1px solid var(--accent-primary);
  color: var(--accent-primary);
  border-radius: var(--radius-pill);
  padding: 5px 16px;
  font: 600 12px/17px var(--font-mono);
  letter-spacing: 0.8px;
  cursor: pointer;
  transition: background 120ms, color 120ms, box-shadow 120ms;
}
.cw-entry-live:focus-visible {
  outline: 1px solid var(--accent-primary);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-dim);
}
.cw-entry-live:hover {
  background: var(--accent-primary);
  color: var(--surface-bg);
}

.cw-footnote {
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-4);
}
.cw-footnote p {
  margin: 0;
  font: 400 14px/23px var(--font-sans);
  color: var(--text-mid);
  max-width: 740px;
}
.cw-inline-code {
  font: 500 12.5px/17px var(--font-mono);
  background: rgba(var(--accent-rgb), 0.10);
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--accent-primary);
}

@media (max-width: 880px) {
  .cw-layout { grid-template-columns: 1fr; }
  .cw-rail { position: relative; max-height: none; }
}

@media (max-width: 720px) {
  [data-cw-scroll] { padding: var(--space-3) var(--space-3) var(--space-5) !important; }
  .cw-mast-title { font-size: 22px; line-height: 29px; letter-spacing: -0.3px; }
  .cw-mast-lede { font-size: 13.5px; line-height: 21px; }
  .cw-entry { grid-template-columns: 1fr; gap: var(--space-2); padding: var(--space-3) 0; }
  .cw-entry-num { font-size: 22px; padding-top: 0; }
  .cw-entry-title { font-size: 18px; line-height: 24px; }
  .cw-entry-head { gap: 6px; }
  .cw-entry-meta { grid-template-columns: 1fr; padding: var(--space-2); }
  .cw-rubric-row { grid-template-columns: 1fr; gap: 2px; }
}
`;
