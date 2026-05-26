import { Cluster, Mono, Stack } from "../lib";
import { useSimStore, type AppMode } from "../sim";

const COPY = {
  kicker: "WORKSHOP · DESKTOP ONLY",
  title: "The Workshop runs the live swarm — it needs a wider screen.",
  body:
    "Twelve lessons drive a real simulation: a canvas plus an inspector panel plus a tick scrubber. " +
    "The layout assumes ~1280px+. Open it on a laptop and you'll see the agents move under attack. " +
    "On a phone, two things still work — read on.",
};

const DESTINATIONS: ReadonlyArray<{
  mode: AppMode;
  label: string;
  blurb: string;
}> = [
  {
    mode: "coursework",
    label: "Read the curriculum",
    blurb:
      "13 notebooks. Each one is intuition → measured claim → known limit. About 30 minutes end-to-end.",
  },
  {
    mode: "research",
    label: "Read the research brief",
    blurb:
      "Specific contributions, measurement tables, position in the literature. The audit surface in paper form.",
  },
];

export function MobileUnavailable() {
  const setMode = useSimStore((s) => s.setMode);
  const copy = COPY;
  return (
    <div className="mu-scroll">
      <div className="mu-wrap">
        <Stack gap={4}>
          <Stack gap={2}>
            <Mono size="sm" className="mu-kicker">
              {copy.kicker}
            </Mono>
            <h1 className="mu-title">{copy.title}</h1>
            <p className="mu-body">{copy.body}</p>
          </Stack>
          <div className="mu-cards">
            {DESTINATIONS.map((d) => (
              <button
                key={d.mode}
                type="button"
                className="mu-card"
                onClick={() => setMode(d.mode)}
              >
                <Cluster gap={2} align="center">
                  <Mono size="sm" className="mu-card-tag">
                    {d.mode.toUpperCase()}
                  </Mono>
                  <span className="mu-card-arrow" aria-hidden>
                    →
                  </span>
                </Cluster>
                <div className="mu-card-label">{d.label}</div>
                <div className="mu-card-blurb">{d.blurb}</div>
              </button>
            ))}
          </div>
          <p className="mu-foot">
            Or come back on a laptop.
          </p>
        </Stack>
      </div>
      <style>{styles}</style>
    </div>
  );
}

const styles = `
.mu-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-5) var(--space-3) var(--space-6);
}
.mu-wrap {
  max-width: 560px;
  margin: 0 auto;
}
.mu-kicker {
  color: var(--accent-primary);
  letter-spacing: 0.8px;
  text-transform: uppercase;
}
.mu-title {
  margin: 0;
  font: 600 22px/29px var(--font-sans);
  letter-spacing: -0.2px;
  color: var(--text-hi);
}
.mu-body {
  margin: 0;
  font: 400 14px/22px var(--font-sans);
  color: var(--text-mid);
}
.mu-cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.mu-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  padding: var(--space-3) var(--space-4);
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--accent-primary);
  border-radius: var(--radius-md);
  color: var(--text-hi);
  cursor: pointer;
  font: inherit;
  transition: background 120ms, border-color 120ms, transform 120ms;
}
.mu-card:hover,
.mu-card:focus-visible {
  background: var(--surface-2);
  border-color: var(--accent-primary);
  transform: translateY(-1px);
  outline: none;
}
.mu-card-tag {
  color: var(--accent-primary);
  letter-spacing: 0.8px;
}
.mu-card-arrow {
  color: var(--accent-primary);
  font-size: 16px;
  margin-left: auto;
}
.mu-card-label {
  font: 600 16px/22px var(--font-sans);
  color: var(--text-hi);
}
.mu-card-blurb {
  font: 400 13px/20px var(--font-sans);
  color: var(--text-mid);
}
.mu-foot {
  margin: 0;
  font: 400 12.5px/19px var(--font-sans);
  color: var(--text-low);
}
.mu-foot code {
  font: 400 12px/16px var(--font-mono);
  color: var(--accent-primary);
}
`;
