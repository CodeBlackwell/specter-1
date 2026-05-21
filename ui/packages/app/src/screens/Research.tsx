import { Cluster, LinkifyRefs, Mono, Pill, Stack, Surface } from "../lib";
import {
  ABSTRACT,
  ANGLE,
  BASELINES,
  CONTRIBUTIONS,
  DETECTION_LATENCY,
  MATRIX_CM_VS_MDS,
  MATRIX_COORDINATED_COLLUDERS,
  MATRIX_HIGH_REP_LIAR,
  MATRIX_SHORT_HORIZON,
  REFERENCES,
  type Contribution,
  type Matrix,
  type MatrixRow,
  type Verdict,
} from "../data/research";

export function Research() {
  return (
    <div
      className="research-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "var(--space-5) var(--space-6) var(--space-6)",
      }}
    >
      <div className="research-layout">
        <LeftRail />
        <main className="research-main">
          <Stack gap={6}>
            <Hero />
            <Section id="angle" label="01" title="Exploratory angle">
              <Prose>
                {ANGLE.map((p, i) => (
                  <p key={i} className="research-p">
                    {p}
                  </p>
                ))}
              </Prose>
            </Section>

            <Section id="contributions" label="02" title="Specific contributions">
              <ContributionsGrid />
            </Section>

            <Section id="measurements" label="03" title="Measurements">
              <Stack gap={5}>
                <MatrixBlock matrix={MATRIX_COORDINATED_COLLUDERS} highlight />
                <MatrixBlock matrix={MATRIX_SHORT_HORIZON} />
                <MatrixBlock matrix={MATRIX_HIGH_REP_LIAR} />
                <CmVsMdsBlock />
                <DetectionLatencyBlock />
              </Stack>
            </Section>

            <Section id="baselines" label="04" title="Position in the literature">
              <BaselinesTable />
            </Section>

            <Section id="references" label="05" title="References">
              <ReferencesBlock />
            </Section>

            <Colophon />
          </Stack>
        </main>
      </div>
      <style>{styles}</style>
    </div>
  );
}

const SECTION_NAV: ReadonlyArray<{ id: string; num: string; title: string }> = [
  { id: "abstract", num: "00", title: "Abstract" },
  { id: "angle", num: "01", title: "Exploratory angle" },
  { id: "contributions", num: "02", title: "Specific contributions" },
  { id: "measurements", num: "03", title: "Measurements" },
  { id: "baselines", num: "04", title: "Position in the literature" },
  { id: "references", num: "05", title: "References" },
];

const MEASUREMENT_SUB_NAV: ReadonlyArray<{ id: string; title: string }> = [
  { id: "tbl-coordinated", title: "T1 · Coordinated colluders" },
  { id: "tbl-short-horizon", title: "T2 · Short-horizon recovery" },
  { id: "tbl-high-rep-liar", title: "T3 · High-rep liar" },
  { id: "tbl-cm-vs-mds", title: "T4 · CM vs MDS sweep" },
  { id: "tbl-detection-latency", title: "T5 · Detection latency" },
];

type GlossaryEntry = { term: string; expansion: string; note?: string };

const ACRONYMS: ReadonlyArray<GlossaryEntry> = [
  { term: "ADR", expansion: "Architecture Decision Record" },
  { term: "CM", expansion: "Cayley-Menger (determinant)" },
  { term: "DCS", expansion: "Dynamic Covariance Scaling", note: "[4]" },
  { term: "GNC", expansion: "Graduated Non-Convexity", note: "[6]" },
  { term: "IMU", expansion: "Inertial Measurement Unit" },
  { term: "LM", expansion: "Levenberg-Marquardt (optimizer)" },
  { term: "MDS", expansion: "Multi-Dimensional Scaling" },
  { term: "NLOS", expansion: "Non-Line-Of-Sight" },
  { term: "PCM", expansion: "Pairwise Consistent Measurement", note: "[8]" },
  { term: "RA-L", expansion: "IEEE Robotics & Automation Letters" },
  { term: "SC", expansion: "Switchable Constraints", note: "[5]" },
  { term: "SLAM", expansion: "Simultaneous Localization And Mapping" },
  { term: "T-RO", expansion: "IEEE Transactions on Robotics" },
  { term: "UWB", expansion: "Ultra-Wide Band (ranging radio)" },
  { term: "W-MSR", expansion: "Weighted Mean-Subsequence-Reduced consensus", note: "[9]" },
];

const TERMS: ReadonlyArray<GlossaryEntry> = [
  { term: "Beta(α,β)", expansion: "per-peer reputation distribution; α counts agreement evidence, β counts disagreement" },
  { term: "Byzantine", expansion: "peer that may emit arbitrary (lying) data, including coordinated lies" },
  { term: "Cohort", expansion: "set of peers participating in a single trust-voting round" },
  { term: "Geman-McClure", expansion: "robust kernel underlying GNC: w = (μ/(μ+χ²))²" },
  { term: "Loop closure", expansion: "re-recognizing a previously-visited location to cancel accumulated drift" },
  { term: "Ω (info matrix)", expansion: "inverse covariance; the per-factor weight inside the pose graph" },
  { term: "Sybil", expansion: "adversary creating multiple fake identities to inflate apparent quorum" },
  { term: "Tier 1", expansion: "reciprocal-range residual voting — fires when |r(O→S) − r(S→O)| > k·σ" },
  { term: "Tier 2", expansion: "classical-MDS embeddability voting over the cohort distance matrix" },
  { term: "SE(2)", expansion: "special Euclidean group in 2D — planar rigid pose (x, y, θ)" },
  { term: "Sim(2)", expansion: "similarity group in 2D — SE(2) plus a scale factor" },
  { term: "χ² (chi-squared)", expansion: "squared whitened residual rᵀ Ω r — outlier classifier input" },
];

function LeftRail() {
  return (
    <aside className="research-rail" aria-label="Research page nav and glossary">
      <nav className="rail-nav">
        <Mono size="sm" muted className="t-label rail-heading">
          Contents
        </Mono>
        <ul className="rail-list">
          {SECTION_NAV.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="rail-link">
                <span className="rail-link-num">{s.num}</span>
                <span className="rail-link-title">{s.title}</span>
              </a>
              {s.id === "measurements" ? (
                <ul className="rail-list rail-sublist">
                  {MEASUREMENT_SUB_NAV.map((sub) => (
                    <li key={sub.id}>
                      <a href={`#${sub.id}`} className="rail-link rail-sublink">
                        {sub.title}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </nav>
      <Glossary heading="Acronyms" entries={ACRONYMS} />
      <Glossary heading="Terms" entries={TERMS} />
    </aside>
  );
}

function Glossary({
  heading,
  entries,
}: {
  heading: string;
  entries: ReadonlyArray<GlossaryEntry>;
}) {
  return (
    <section className="rail-glossary">
      <Mono size="sm" muted className="t-label rail-heading">
        {heading}
      </Mono>
      <dl className="glossary-list">
        {entries.map((e) => (
          <div key={e.term} className="glossary-row">
            <dt className="glossary-term">
              {e.term}
              {e.note ? <span className="glossary-note"> {e.note}</span> : null}
            </dt>
            <dd className="glossary-expansion">{e.expansion}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Hero() {
  return (
    <header
      id="abstract"
      style={{ paddingBottom: "var(--space-4)", borderBottom: "1px solid var(--border-strong)", scrollMarginTop: 16 }}
    >
      <Stack gap={3}>
        <Cluster gap={2} align="center">
          <Mono size="sm" muted className="t-label">
            SPECTER · 1
          </Mono>
          <span className="paper-meta">Technical brief</span>
          <span className="paper-meta">v. 2026-05-18</span>
        </Cluster>
        <h1 className="paper-title">
          Byzantine-resilient cooperative SLAM,
          <span style={{ color: "var(--accent-primary)" }}> measured against the field</span>
        </h1>
        <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 360px", minWidth: 0 }}>
            <div className="paper-section-tag">Abstract</div>
            <p className="research-p">{ABSTRACT}</p>
          </div>
          <aside style={{ flex: "0 1 240px", minWidth: 220 }}>
            <div className="paper-section-tag">At-a-glance</div>
            <ul className="paper-margin-list">
              <li>
                <span className="ok">+17×</span> short-horizon advantage over GNC-only at the trust-recovery edge
              </li>
              <li>
                <span className="ok">1.0 m</span> recovery gap on coordinated colluders where DCS, GNC, and SC all fail
              </li>
              <li>
                <span className="ok">15 orders</span> dynamic-range blowup measured in the Cayley-Menger alternative
              </li>
              <li>
                <span className="ok">100%</span> blame-attribution rate at <Code>N ≥ 10</Code> for MDS residuals
              </li>
            </ul>
          </aside>
        </div>
      </Stack>
    </header>
  );
}

function Section({
  id,
  label,
  title,
  children,
}: {
  id: string;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ scrollMarginTop: 16 }}>
      <Stack gap={3}>
        <header className="section-head">
          <span className="section-num">§ {label}</span>
          <h2 className="section-title">{title}</h2>
          <span className="section-rule" />
        </header>
        {children}
      </Stack>
    </section>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 760 }}>{children}</div>;
}

function ContributionsGrid() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
        gap: "var(--space-3)",
      }}
    >
      {CONTRIBUTIONS.map((c) => (
        <ContributionCard key={c.num} c={c} />
      ))}
    </div>
  );
}

function ContributionCard({ c }: { c: Contribution }) {
  return (
    <Surface level={2} pad={3} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <Cluster gap={2} align="center">
        <Mono size="sm" style={{ color: "var(--accent-primary)" }}>
          C{c.num}
        </Mono>
        <h3 className="card-title">
          <LinkifyRefs text={c.title} className="research-ref" />
        </h3>
        <div style={{ flex: 1 }} />
        <StatusPill status={c.status} />
      </Cluster>
      <Field label="Claim" body={c.claim} />
      <Field label="Mechanism" body={c.mechanism} mono />
      <Field label="Extends" body={c.extends} />
      <Field label="Measured" body={c.evidence} />
      <Cluster gap={1} align="center" style={{ marginTop: "auto", flexWrap: "wrap" }}>
        <Mono size="sm" muted className="t-label">
          Cites
        </Mono>
        {c.refs.map((r) => (
          <RefChip key={r} num={r} />
        ))}
      </Cluster>
    </Surface>
  );
}

function StatusPill({ status }: { status: Contribution["status"] }) {
  if (status === "measured") return <Pill tone="nominal">MEASURED</Pill>;
  if (status === "deferred") return <Pill tone="flagged">DEFERRED</Pill>;
  return <Pill tone="accent">EXPLORATORY</Pill>;
}

function Field({ label, body, mono = false }: { label: string; body: string; mono?: boolean }) {
  return (
    <div>
      <Mono size="sm" muted className="t-label" style={{ display: "block", marginBottom: 2 }}>
        {label}
      </Mono>
      <p className={mono ? "research-p mono" : "research-p"} style={{ marginBottom: 0 }}>
        <LinkifyRefs text={body} className="research-ref" />
      </p>
    </div>
  );
}

function MatrixBlock({ matrix, highlight = false }: { matrix: Matrix; highlight?: boolean }) {
  return (
    <figure
      id={`tbl-${matrix.id}`}
      className={highlight ? "matrix-fig matrix-fig-hero" : "matrix-fig"}
      style={{ scrollMarginTop: 16 }}
    >
      <figcaption className="matrix-caption">
        <span className="matrix-label">{matrix.caption}</span>
        <p className="matrix-setup">{matrix.setup}</p>
      </figcaption>
      <div className="matrix-table-wrap">
        <table className="matrix-table">
          <thead>
            <tr>
              {matrix.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((r) => (
              <MatrixRowEl key={r.approach} row={r} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="matrix-bottomline">
        <span className="paper-section-tag">Result</span>
        <p className="research-p">
          <LinkifyRefs text={matrix.bottomLine} className="research-ref" />
        </p>
        <Mono size="sm" muted className="matrix-test">
          ↳ <LinkifyRefs text={matrix.test} className="research-ref" />
        </Mono>
      </div>
    </figure>
  );
}

function MatrixRowEl({ row }: { row: MatrixRow }) {
  return (
    <tr className={row.isSpecter ? "matrix-row matrix-row-specter" : "matrix-row"}>
      <td className="matrix-approach">
        <div className="matrix-approach-name">
          {row.approach}
          {row.ref ? <RefChip num={row.ref} /> : null}
        </div>
      </td>
      {row.cells.map((cell, i) => (
        <td key={i} className={`matrix-cell verdict-${cell.verdict ?? "neutral"}`}>
          <span className="matrix-cell-value">{cell.value}</span>
          {cell.note ? <span className="matrix-cell-note">{cell.note}</span> : null}
        </td>
      ))}
    </tr>
  );
}

function CmVsMdsBlock() {
  return (
    <figure id="tbl-cm-vs-mds" className="matrix-fig" style={{ scrollMarginTop: 16 }}>
      <figcaption className="matrix-caption">
        <span className="matrix-label">
          Table 4. Cayley-Menger determinant vs. eigenvalue-residual MDS — Byzantine-cohort
          consistency over the swarm-operating sweep <Code>N = 4 … 20</Code> (M = 50 trials each).
        </span>
        <p className="matrix-setup">
          Random 2D point configurations in a <Code>[−10, 10]²</Code> arena with UWB-class noise{" "}
          <Code>σ = 0.1 m</Code>. Honest geometry vs. colluder-pair condition (symmetric +3 m bias).
          A useful discriminator must cleanly separate the two columns within each row across all{" "}
          <Code>N</Code>.
        </p>
      </figcaption>
      <div className="matrix-table-wrap">
        <table className="matrix-table cmds-table">
          <thead>
            <tr>
              <th rowSpan={2}>N</th>
              <th colSpan={3} className="group-header verdict-loss-bg">
                Cayley-Menger <span className="group-tag">unbounded scale</span>
              </th>
              <th colSpan={3} className="group-header verdict-win-bg">
                MDS embeddability <span className="group-tag">specter-1 substrate</span>
              </th>
              <th colSpan={2} className="group-header">
                MDS blame attribution
              </th>
            </tr>
            <tr>
              <th>honest log₁₀|det|</th>
              <th>colluder log₁₀|det|</th>
              <th>gap</th>
              <th>honest score</th>
              <th>colluder score</th>
              <th>separation</th>
              <th>single-liar top-1</th>
              <th>colluder top-2</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX_CM_VS_MDS.map((r) => (
              <tr key={r.n} className="matrix-row">
                <td className="matrix-approach"><Code>{r.n}</Code></td>
                <td className="matrix-cell mono"><Code>{r.cmHonest}</Code></td>
                <td className="matrix-cell mono"><Code>{r.cmColluder}</Code></td>
                <td className="matrix-cell verdict-loss mono"><Code>{r.cmGap}</Code></td>
                <td className="matrix-cell mono"><Code>{r.mdsHonest}</Code></td>
                <td className="matrix-cell mono"><Code>{r.mdsColluder}</Code></td>
                <td className="matrix-cell verdict-win mono"><Code>{r.mdsSeparation}</Code></td>
                <td className={`matrix-cell mono ${rateVerdict(r.blameTop1)}`}><Code>{r.blameTop1}</Code></td>
                <td className={`matrix-cell mono ${rateVerdict(r.blameTop2)}`}><Code>{r.blameTop2}</Code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="matrix-bottomline">
        <span className="paper-section-tag">Result</span>
        <p className="research-p">
          The CM determinant grows by{" "}
          <strong className="ok">15 orders of magnitude</strong> across the honest sweep alone,
          while the attacker-induced excess is only ~1.5–2 orders — honest±2σ overlaps the colluder
          mean at every <Code>N</Code>, so no fixed threshold separates the two. The MDS score stays
          bounded in <Code>[0.003, 0.10]</Code> with a stable 2–13× separation; per-point residual
          blame attribution reaches <span className="ok">100%</span> at{" "}
          <Code>N ≥ 12</Code>. The range-only trust voting decision locks MDS as the
          Tier 2 substrate on this measurement
          (<LinkifyRefs text="docs/adr/0015-range-only-trust-voting.md" className="research-ref" />).
        </p>
        <Mono size="sm" muted className="matrix-test">
          ↳ <LinkifyRefs text="experiments/cm_vs_mds_sweep.py" className="research-ref" />
          {" · "}
          <LinkifyRefs text="experiments/cm_vs_mds_results.json" className="research-ref" />
        </Mono>
      </div>
    </figure>
  );
}

function rateVerdict(s: string): string {
  const pct = parseInt(s, 10);
  if (pct >= 90) return "verdict-win";
  if (pct >= 50) return "verdict-tie";
  return "verdict-loss";
}

function DetectionLatencyBlock() {
  return (
    <figure id="tbl-detection-latency" className="matrix-fig" style={{ scrollMarginTop: 16 }}>
      <figcaption className="matrix-caption">
        <span className="matrix-label">
          Table 5. Detection latency and false-positive rate over the six attack classes in the
          eval battery.
        </span>
        <p className="matrix-setup">
          One scenario per threat, agent count <Code>N = 6</Code>, run length 500 ticks, attack
          start tick 100. Detection is recorded when the attacker's median consensus reputation
          first crosses <Code>0.5</Code> (downward) or, for Sybil/phantom threats, when presence
          is denied.
        </p>
      </figcaption>
      <div className="matrix-table-wrap">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>Threat</th>
              <th>Defending layer</th>
              <th>Detected by</th>
              <th>False positives</th>
            </tr>
          </thead>
          <tbody>
            {DETECTION_LATENCY.map((d) => (
              <tr key={d.threat} className="matrix-row">
                <td className="matrix-approach">{d.threat}</td>
                <td className="matrix-cell">{d.layer}</td>
                <td className={`matrix-cell mono verdict-${d.verdict}`}><Code>{d.detected}</Code></td>
                <td className="matrix-cell mono"><Code>{d.fpr}</Code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="matrix-bottomline">
        <span className="paper-section-tag">Result</span>
        <p className="research-p">
          Every published threat class in the project's threat model
          (<LinkifyRefs text="docs/THREAT_MODEL.md" className="research-ref" />) resolves within
          the attack budget at 0% false-positive rate over the eval-scenario battery. The numbers
          in this table are the load-bearing claims in the threat model; each is regenerated on
          every CI run.
        </p>
        <Mono size="sm" muted className="matrix-test">
          ↳ <LinkifyRefs text="tests/eval/scenarios.py" className="research-ref" /> ·
          regenerate with <Code>uv run pytest tests/eval/ -v</Code>
        </Mono>
      </div>
    </figure>
  );
}

function BaselinesTable() {
  return (
    <Surface level={2} style={{ overflow: "hidden", padding: 0 }}>
      <table className="baselines-table">
        <thead>
          <tr>
            <th>Approach</th>
            <th>Ref</th>
            <th>Evidence channel</th>
            <th>Limit relative to specter-1</th>
          </tr>
        </thead>
        <tbody>
          {BASELINES.map((b) => (
            <tr key={b.approach}>
              <td className="baseline-name">{b.approach}</td>
              <td>
                <RefChip num={b.ref} />
              </td>
              <td className="muted">{b.channel}</td>
              <td className="muted">{b.weakness}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Surface>
  );
}

function ReferencesBlock() {
  return (
    <Surface level={2} pad={4}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))",
          gap: "var(--space-3) var(--space-5)",
        }}
      >
        {REFERENCES.map((c) => (
          <div key={c.ref} id={`ref-${c.ref}`} className="ref-entry">
            <Mono size="sm" className="ref-num">
              [{c.ref}]
            </Mono>
            <div className="ref-body">
              <div className="ref-authors">{c.authors}</div>
              <div className="ref-title">
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.title}
                  </a>
                ) : (
                  c.title
                )}
              </div>
              <div className="ref-venue">{c.venue}</div>
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}

function Colophon() {
  return (
    <footer className="colophon">
      <Cluster gap={2} align="center">
        <Mono size="sm" muted className="t-label">
          Reproducibility
        </Mono>
        <Pill tone="nominal">OPEN SOURCE</Pill>
      </Cluster>
      <p className="research-p">
        Every measurement reproduces from a test in the eval scenario battery
        (<LinkifyRefs text="tests/eval" className="research-ref" />) and a documented baseline
        (<LinkifyRefs text="docs/BASELINES.md" className="research-ref" />) or threat-model entry
        (<LinkifyRefs text="docs/THREAT_MODEL.md" className="research-ref" />). Design
        decisions live as Architecture Decision Records
        (<LinkifyRefs text="docs/adr" className="research-ref" />). The TypeScript port
        (<LinkifyRefs text="ui/packages/sim-core" className="research-ref" />) is gated to
        byte-exact parity with the Python reference via <Code>just ui-fixtures</Code>. Numbers,
        not diagrams, decide which ideas are kept.
      </p>
    </footer>
  );
}

function RefChip({ num }: { num: string }) {
  return (
    <a href={`#ref-${num}`} className="ref-chip">
      [{num}]
    </a>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="paper-code">{children}</code>;
}

const styles = `
.research-layout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
  max-width: 1320px;
  margin: 0 auto;
}
.research-main {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 1040px;
}
.research-rail {
  flex: 0 0 240px;
  position: sticky;
  top: 0;
  align-self: flex-start;
  max-height: calc(100vh - var(--space-5) - var(--space-6));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-right: var(--space-2);
  font-family: var(--font-sans);
}
.research-rail::-webkit-scrollbar { width: 6px; }
.research-rail::-webkit-scrollbar-track { background: transparent; }
.research-rail::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 3px; }

.rail-heading {
  display: block;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 6px;
}

.rail-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rail-link {
  display: flex;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 3px;
  text-decoration: none;
  font: 500 13.5px/19px var(--font-sans);
  color: var(--text-mid);
  border-left: 2px solid transparent;
  transition: background 120ms, color 120ms, border-color 120ms;
}
.rail-link:hover {
  background: rgba(var(--accent-rgb), 0.06);
  color: var(--text-hi);
  border-left-color: var(--accent-dim);
}
.rail-link:focus-visible {
  outline: 1px solid var(--accent-primary);
  outline-offset: 2px;
}
.rail-link-num {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-low);
  letter-spacing: 0.4px;
  flex-shrink: 0;
  width: 20px;
}
.rail-link-title {
  flex: 1;
  min-width: 0;
}
.rail-sublist {
  margin-top: 2px;
  margin-left: 24px;
  border-left: 1px solid var(--border-subtle);
  padding-left: 10px;
}
.rail-sublink {
  font: 500 12.5px/17px var(--font-mono);
  color: var(--text-low);
  padding: 4px 6px;
  letter-spacing: 0.2px;
}
.rail-sublink:hover {
  color: var(--accent-primary);
}

.rail-glossary {
  display: flex;
  flex-direction: column;
}
.glossary-list {
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.glossary-row {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px 8px;
  margin: 2px -8px 0;
  border-radius: 4px;
  border-left: 2px solid transparent;
  outline: none;
  transition:
    background 140ms ease-out,
    box-shadow 200ms ease-out,
    border-color 140ms ease-out,
    transform 140ms ease-out;
}
.glossary-row:first-of-type {
  margin-top: 0;
}
.glossary-row:hover,
.glossary-row:focus-visible {
  background: rgba(var(--accent-rgb), 0.07);
  border-left-color: var(--accent-primary);
  box-shadow: 0 0 0 1px rgba(var(--accent-rgb), 0.18), 0 0 18px rgba(var(--accent-rgb), 0.22);
  transform: translateX(1px);
}
.glossary-term {
  font: 600 12.5px/18px var(--font-mono);
  letter-spacing: 0.3px;
  color: var(--accent-primary);
  margin: 0;
  transition: color 140ms ease-out, font-weight 140ms ease-out, text-shadow 200ms ease-out, letter-spacing 140ms ease-out;
}
.glossary-row:hover .glossary-term,
.glossary-row:focus-visible .glossary-term {
  color: var(--text-hi);
  font-weight: 800;
  letter-spacing: 0.5px;
  text-shadow: 0 0 8px rgba(var(--accent-rgb), 0.45);
}
.glossary-note {
  font-weight: 500;
  font-size: 11.5px;
  color: var(--accent-primary);
  letter-spacing: 0.2px;
}
.glossary-row:hover .glossary-note,
.glossary-row:focus-visible .glossary-note {
  color: var(--text-hi);
}
.glossary-expansion {
  margin: 0;
  font: 400 12.5px/18px var(--font-sans);
  color: var(--text-mid);
  transition: color 140ms ease-out;
}
.glossary-row:hover .glossary-expansion,
.glossary-row:focus-visible .glossary-expansion {
  color: var(--text-hi);
}

@media (max-width: 900px) {
  .research-layout {
    flex-direction: column;
  }
  .research-rail {
    flex: 0 0 auto;
    width: 100%;
    position: static;
    max-height: none;
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: var(--space-3);
  }
  .research-main {
    max-width: 100%;
  }
}

@media (max-width: 720px) {
  .research-scroll { padding: var(--space-3) var(--space-3) var(--space-5) !important; }
  .paper-title { font: 600 24px/30px var(--font-sans); letter-spacing: -0.3px; }
  .research-p { font-size: 13px; line-height: 20px; }
  .matrix-table th, .matrix-table td { padding: 8px 10px; }
  .matrix-caption { padding: var(--space-2) var(--space-3); }
  .matrix-bottomline { padding: var(--space-2) var(--space-3); }
  .section-title { font-size: 17px; line-height: 23px; }
  .paper-margin-list { padding-left: var(--space-2); }
}

.research-p {
  margin: 0 0 var(--space-2) 0;
  color: var(--text-hi);
  font-size: 15px;
  line-height: 23px;
  font-family: var(--font-sans);
}
.research-p.mono {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 20px;
  color: var(--text-mid);
}
.research-p:last-child { margin-bottom: 0; }

.paper-title {
  margin: 0;
  font: 600 38px/46px var(--font-sans);
  letter-spacing: -0.6px;
  max-width: 900px;
}

.paper-meta {
  font: 600 12px/15px var(--font-mono);
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-mid);
  padding: 3px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.paper-section-tag {
  display: inline-block;
  font: 700 11px/14px var(--font-mono);
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--accent-primary);
  margin-bottom: var(--space-2);
}

.paper-margin-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-left: 2px solid var(--accent-dim);
  padding-left: var(--space-3);
}
.paper-margin-list li {
  font: 400 13.5px/21px var(--font-sans);
  color: var(--text-mid);
  margin: 0 0 10px 0;
}
.paper-margin-list .ok { color: var(--status-nominal); font-weight: 700; font-family: var(--font-mono); }

.paper-code {
  font: 500 12.5px/17px var(--font-mono);
  background: rgba(var(--accent-rgb), 0.10);
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--accent-primary);
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}
.section-num {
  font: 700 13px/18px var(--font-mono);
  letter-spacing: 0.6px;
  color: var(--accent-primary);
}
.section-title {
  margin: 0;
  font: 600 22px/29px var(--font-sans);
  letter-spacing: -0.2px;
  color: var(--text-hi);
}
.section-rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--border-strong), transparent);
}

.card-title {
  margin: 0;
  font: 600 15.5px/22px var(--font-sans);
  letter-spacing: -0.1px;
  color: var(--text-hi);
}

/* === MATRICES === */
.matrix-fig {
  margin: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-shadow);
  overflow: hidden;
}
.matrix-fig-hero {
  border-color: var(--accent-dim);
  box-shadow: 0 0 0 1px var(--accent-dim), var(--glass-shadow);
}
.matrix-caption {
  padding: var(--space-3) var(--space-4) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  background: rgba(0,0,0,0.15);
}
.matrix-label {
  display: block;
  font: 600 13px/20px var(--font-mono);
  letter-spacing: 0.4px;
  color: var(--text-hi);
  margin-bottom: 6px;
}
.matrix-setup {
  margin: 0;
  font: 400 13.5px/21px var(--font-sans);
  color: var(--text-mid);
  max-width: 920px;
}
.matrix-table-wrap {
  overflow-x: auto;
}
.matrix-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-sans);
}
.matrix-table th {
  text-align: left;
  padding: 12px 14px;
  font: 700 11.5px/15px var(--font-mono);
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-mid);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-strong);
  white-space: nowrap;
}
.matrix-table th.group-header {
  text-align: center;
  border-bottom: 1px solid var(--border-subtle);
  font-weight: 700;
  color: var(--text-hi);
  font-size: 12.5px;
}
.matrix-table th.group-header .group-tag {
  display: block;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--text-low);
  margin-top: 3px;
}
.matrix-table th.verdict-win-bg { background: rgba(63, 201, 122, 0.10); color: var(--status-nominal); }
.matrix-table th.verdict-loss-bg { background: rgba(239, 90, 77, 0.10); color: var(--status-byzantine); }

.matrix-table td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 14px;
  line-height: 20px;
  vertical-align: middle;
}
.matrix-table tbody tr:last-child td { border-bottom: 0; }

.matrix-approach { color: var(--text-hi); font-weight: 500; }
.matrix-approach-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.matrix-row-specter {
  background: linear-gradient(90deg, rgba(63, 201, 122, 0.08), rgba(var(--accent-rgb), 0.04));
  box-shadow: inset 3px 0 0 var(--status-nominal);
}
.matrix-row-specter .matrix-approach { color: var(--text-hi); font-weight: 600; }

.matrix-cell { color: var(--text-mid); font-family: var(--font-sans); }
.matrix-cell.mono { font-family: var(--font-mono); font-size: 13px; }
.matrix-cell-value { display: block; }
.matrix-cell-note {
  display: block;
  font-size: 11.5px;
  font-family: var(--font-mono);
  color: var(--text-low);
  margin-top: 3px;
}

.verdict-win { color: var(--status-nominal); }
.verdict-win .matrix-cell-value { color: var(--status-nominal); font-weight: 500; }
.matrix-cell.verdict-win { background: rgba(63, 201, 122, 0.07); }

.verdict-loss { color: var(--status-byzantine); }
.verdict-loss .matrix-cell-value { color: var(--status-byzantine); }
.matrix-cell.verdict-loss { background: rgba(239, 90, 77, 0.06); }

.verdict-tie { color: var(--text-mid); }
.matrix-cell.verdict-tie { background: rgba(240, 168, 58, 0.04); }

.verdict-neutral { color: var(--text-mid); }

.matrix-bottomline {
  padding: var(--space-3) var(--space-4);
  background: rgba(0,0,0,0.20);
  border-top: 1px solid var(--border-subtle);
}
.matrix-test {
  display: block;
  margin-top: 8px;
  color: var(--text-low);
  font-size: 12px;
}

/* === BASELINES TABLE === */
.baselines-table {
  width: 100%;
  border-collapse: collapse;
}
.baselines-table th {
  text-align: left;
  padding: 12px 14px;
  font: 700 11.5px/15px var(--font-mono);
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-mid);
  background: var(--surface-3);
  border-bottom: 1px solid var(--border-strong);
}
.baselines-table td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 14px;
  line-height: 20px;
  vertical-align: top;
}
.baselines-table tbody tr:last-child td { border-bottom: 0; }
.baseline-name { font-weight: 500; color: var(--text-hi); }
.muted { color: var(--text-mid); }

/* === REFERENCES === */
.ref-entry {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  scroll-margin-top: 80px;
}
.ref-num {
  color: var(--accent-primary);
  min-width: 30px;
  text-align: right;
  flex-shrink: 0;
  padding-top: 1px;
}
.ref-body { min-width: 0; }
.ref-authors {
  color: var(--text-mid);
  font: 400 13px/19px var(--font-sans);
}
.ref-title {
  color: var(--text-hi);
  font: 600 14.5px/21px var(--font-sans);
}
.ref-title a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px dotted var(--text-low);
}
.ref-title a:hover { color: var(--accent-primary); border-bottom-color: var(--accent-primary); }
.ref-venue {
  color: var(--text-low);
  font: 400 12px/17px var(--font-mono);
}

.ref-chip {
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--accent-primary);
  background: var(--accent-dim);
  border-radius: 3px;
  padding: 2px 7px;
  text-decoration: none;
  white-space: nowrap;
}
.ref-chip:hover { background: rgba(var(--accent-rgb), 0.30); }

.colophon {
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.research-ref {
  color: var(--accent-primary);
  text-decoration: none;
  font-family: var(--font-mono);
  font-size: 0.92em;
  border-bottom: 1px dotted var(--accent-primary);
  transition: color 120ms, border-color 120ms;
  word-break: break-all;
}
.research-ref:hover {
  color: var(--text-hi);
  border-bottom-color: var(--text-hi);
}
`;
