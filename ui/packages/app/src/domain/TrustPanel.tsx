import { useMemo } from "react";
import type { TickSnapshot } from "@specter/sim-core";
import { Mono, Stack, Surface } from "../lib";
import {
  type Tier1Edge,
  type Tier2Edge,
  type TrustView,
  TIER1_THRESHOLD_M,
  TIER2_TAU as TAU,
  computeTrustView,
} from "../sim/trust";

const VIEW_W = 300;
const VIEW_H = 170;
const VIEW_PAD = 18;
const TIER1_BAR_MAX = TIER1_THRESHOLD_M * 4;
const TIER2_BAR_MAX = TAU * 4;

type Props = {
  snapshot: TickSnapshot | null;
};

export function TrustPanel({ snapshot }: Props) {
  const view = useMemo(() => computeTrustView(snapshot), [snapshot]);
  const hasData = view.agentIds.length >= 3;
  return (
    <Surface
      level={1}
      pad={3}
      style={{
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <Mono size="sm" muted className="t-label" style={{ flexShrink: 0 }}>
        Trust layer · pairwise residuals
      </Mono>
      {hasData ? (
        <>
          <MetricsRow view={view} />
          <EmbeddingSvg view={view} />
          <CoverageLine view={view} />
          <CalloutStack view={view} />
        </>
      ) : (
        <Mono size="sm" muted style={{ color: "var(--text-low)" }}>
          fewer than 3 drones — trust layer undefined
        </Mono>
      )}
    </Surface>
  );
}

function MetricsRow({ view }: { view: TrustView }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-2)" }}>
      <MetricCard
        label="Tier 1 · max Δ"
        value={`${view.tier1MaxDelta.toFixed(2)}m`}
        thresholdLabel={`> ${TIER1_THRESHOLD_M.toFixed(2)}m`}
        tripped={view.tier1MaxDelta > TIER1_THRESHOLD_M}
        pct={Math.min(100, (view.tier1MaxDelta / TIER1_BAR_MAX) * 100)}
        threshPct={(TIER1_THRESHOLD_M / TIER1_BAR_MAX) * 100}
      />
      <MetricCard
        label="Tier 2 · embed"
        value={view.embeddability.toFixed(3)}
        thresholdLabel={`> ${TAU.toFixed(2)}`}
        tripped={view.embeddability >= TAU}
        pct={Math.min(100, (view.embeddability / TIER2_BAR_MAX) * 100)}
        threshPct={(TAU / TIER2_BAR_MAX) * 100}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  thresholdLabel,
  tripped,
  pct,
  threshPct,
}: {
  label: string;
  value: string;
  thresholdLabel: string;
  tripped: boolean;
  pct: number;
  threshPct: number;
}) {
  const color = tripped ? "var(--status-byzantine)" : "var(--status-nominal)";
  return (
    <div
      style={{
        flex: 1,
        padding: "6px 8px",
        background: "var(--surface-2)",
        borderRadius: "var(--radius-sm)",
        border: tripped ? "1px solid var(--status-byzantine)" : "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-mid)",
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, color, fontWeight: 600 }}>
        {value}
      </span>
      <div style={{ position: "relative", width: "100%", height: 12 }}>
        <div
          style={{
            position: "absolute",
            top: 2,
            left: 0,
            right: 0,
            height: 8,
            background: "var(--surface-1)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${pct}%`, height: "100%", background: color }} />
        </div>
        <div
          style={{
            position: "absolute",
            left: `calc(${threshPct}% - 1px)`,
            top: 0,
            width: 2,
            height: 12,
            background: "var(--text-hi)",
            borderRadius: 1,
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: tripped ? 700 : 500,
          color: tripped ? "var(--status-byzantine)" : "var(--text-low)",
          letterSpacing: 0.5,
        }}
      >
        {tripped ? `FIRES · ${thresholdLabel}` : `nominal · ${thresholdLabel}`}
      </span>
    </div>
  );
}

function EmbeddingSvg({ view }: { view: TrustView }) {
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of view.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    return { minX, maxX, minY, maxY, dx, dy };
  }, [view.points]);

  const project = (x: number, y: number): [number, number] => {
    const scaleX = (VIEW_W - 2 * VIEW_PAD) / bounds.dx;
    const scaleY = (VIEW_H - 2 * VIEW_PAD) / bounds.dy;
    const scale = Math.min(scaleX, scaleY);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    return [
      VIEW_W / 2 + (x - centerX) * scale,
      VIEW_H / 2 - (y - centerY) * scale,
    ];
  };

  const tier1Lookup = new Map<string, number>();
  for (const e of view.tier1Edges) tier1Lookup.set(edgeKey(e.i, e.j), e.delta);
  const maxTier2 = view.tier2Top?.residual ?? 0;
  const tier2TopKey = view.tier2Top ? edgeKey(view.tier2Top.i, view.tier2Top.j) : null;
  const tier1TopKey = view.tier1Top ? edgeKey(view.tier1Top.i, view.tier1Top.j) : null;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      style={{
        background: "var(--surface-2)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      {view.tier2Edges.map((e) => {
        const key = edgeKey(e.i, e.j);
        const tier1Delta = tier1Lookup.get(key) ?? 0;
        const tier2Norm = maxTier2 > 0 ? e.residual / maxTier2 : 0;
        const tier1Tripped = tier1Delta > TIER1_THRESHOLD_M;
        const tier2Lying = e.residual > 0;
        return (
          <Edge
            key={`e-${key}`}
            edge={e}
            points={view.points}
            project={project}
            tier1Tripped={tier1Tripped}
            tier2Lying={tier2Lying}
            tier2Norm={tier2Norm}
            isTier1Top={key === tier1TopKey && tier1Tripped}
            isTier2Top={key === tier2TopKey}
          />
        );
      })}
      {view.points.map((p, i) => {
        const [px, py] = project(p[0], p[1]);
        return (
          <g key={`p-${i}`}>
            <circle cx={px} cy={py} r={4} fill="var(--accent-primary)" />
            <text
              x={px + 7}
              y={py + 4}
              fontSize={11}
              fontWeight={600}
              fontFamily="var(--font-mono)"
              fill="var(--text-hi)"
              stroke="var(--chassis-dark)"
              strokeWidth={3}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {view.agentIds[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Edge({
  edge,
  points,
  project,
  tier1Tripped,
  tier2Lying,
  tier2Norm,
  isTier1Top,
  isTier2Top,
}: {
  edge: Tier2Edge;
  points: ReadonlyArray<readonly [number, number]>;
  project: (x: number, y: number) => [number, number];
  tier1Tripped: boolean;
  tier2Lying: boolean;
  tier2Norm: number;
  isTier1Top: boolean;
  isTier2Top: boolean;
}) {
  const a = points[edge.i]!;
  const b = points[edge.j]!;
  const [ax, ay] = project(a[0], a[1]);
  const [bx, by] = project(b[0], b[1]);
  const flagged = tier1Tripped || tier2Lying;
  const both = tier1Tripped && tier2Lying;
  const isTop = isTier1Top || isTier2Top;
  const color = both
    ? "var(--status-byzantine)"
    : flagged
      ? "var(--status-flagged)"
      : "var(--border-subtle)";
  const severity = Math.max(tier2Norm, tier1Tripped ? 0.6 : 0);
  const strokeWidth = 0.6 + severity * 2.4;
  const opacity = flagged ? 0.85 : 0.3;
  return (
    <>
      {isTop && (
        <line
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          stroke={color}
          strokeWidth={strokeWidth + 4}
          strokeOpacity={0.22}
          strokeLinecap="round"
        />
      )}
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={strokeWidth} strokeOpacity={opacity} />
    </>
  );
}

function CoverageLine({ view }: { view: TrustView }) {
  return (
    <Mono size="sm" muted style={{ color: "var(--text-low)", fontSize: 11 }}>
      {view.observedPairs}/{view.totalPairs} pairs observed this tick · rest filled with geometric truth
    </Mono>
  );
}

function CalloutStack({ view }: { view: TrustView }) {
  return (
    <Stack gap={1}>
      <TierCallout tier={1} edge={view.tier1Top} view={view} />
      <TierCallout tier={2} edge={view.tier2Top} view={view} />
    </Stack>
  );
}

function TierCallout({
  tier,
  edge,
  view,
}: {
  tier: 1 | 2;
  edge: Tier1Edge | Tier2Edge | null;
  view: TrustView;
}) {
  const tripped = edge
    ? tier === 1
      ? (edge as Tier1Edge).delta > TIER1_THRESHOLD_M
      : (edge as Tier2Edge).residual > 0
    : false;
  const pair = edge
    ? `${view.agentIds[edge.i]} ↔ ${view.agentIds[edge.j]}`
    : tier === 1
      ? "no reciprocal disagreement"
      : "no triangle violation";
  const detail = edge
    ? tier === 1
      ? `Δ ${(edge as Tier1Edge).delta.toFixed(2)}m`
      : `excess ${(edge as Tier2Edge).residual.toFixed(2)}m`
    : "—";
  return (
    <div
      style={{
        padding: "6px 10px",
        background: tripped ? "rgba(239, 90, 77, 0.10)" : "transparent",
        border: `1px solid ${tripped ? "var(--status-byzantine)" : "var(--border-subtle)"}`,
        borderRadius: "var(--radius-sm)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: tripped ? "var(--status-byzantine)" : "var(--text-low)",
        display: "flex",
        alignItems: "baseline",
        gap: 10,
      }}
    >
      <span style={{ letterSpacing: 1, fontSize: 11, fontWeight: 700, width: 52 }}>
        TIER {tier}
      </span>
      <span style={{ color: edge ? "var(--text-hi)" : "var(--text-low)", fontWeight: edge ? 600 : 400 }}>
        {pair}
      </span>
      <span style={{ marginLeft: "auto" }}>{detail}</span>
    </div>
  );
}

function edgeKey(i: number, j: number): string {
  return i < j ? `${i}-${j}` : `${j}-${i}`;
}
