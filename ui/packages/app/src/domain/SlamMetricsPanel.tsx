import { useMemo } from "react";
import type { TickSnapshot } from "@specter/sim-core";
import { Mono, Stack, Surface } from "../lib";
import { Sparkline } from "../charts";
import { useSimStore } from "../sim";

type Props = { snapshot: TickSnapshot | null };

/** SLAM-layer right-rail panel for L09–L12. Mirrors TrustPanel's vocabulary
 * (Surface + MetricCard + sparkline) but reads pose-graph state instead of
 * Beta evidence. */
export function SlamMetricsPanel({ snapshot }: Props) {
  const result = useSimStore((s) => s.result);
  const tickIndex = useSimStore((s) => s.tickIndex);

  const costSeries = useMemo(() => {
    const snaps = result?.snapshots ?? [];
    const out: number[] = [];
    for (const s of snaps) {
      if (s.slam) out.push(s.slam.cost);
    }
    return out;
  }, [result]);

  const slam = snapshot?.slam;
  if (!slam) return null;

  const closureCount = slam.closureEdges?.length ?? 0;
  const interRobotCount = slam.interRobotEdges?.length ?? 0;
  const landmarkCount = slam.landmarks.length;
  const agentCount = slam.slamAgents?.length ?? (slam.trajectory ? 1 : 0);
  const traceLen = costSeries.length;
  const costMax = costSeries.reduce((m, v) => Math.max(m, v), 0);
  const costNormalized = costSeries.map((v) => (costMax > 0 ? v / costMax : 0));

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
        SLAM layer · pose-graph state
      </Mono>
      <StageHeader slam={slam} />
      <MetricsRow
        cost={slam.cost}
        iterations={slam.iterations}
        factorCount={landmarkCount + interRobotCount + closureCount}
      />
      <CountRow
        agents={agentCount}
        landmarks={landmarkCount}
        interRobot={interRobotCount}
        closures={closureCount}
      />
      {traceLen > 1 ? (
        <Stack gap={1}>
          <Mono size="sm" muted style={{ color: "var(--text-low)", fontSize: 11, fontWeight: 500 }}>
            cost / max — {traceLen} stages
          </Mono>
          <Sparkline
            data={costNormalized}
            width={300}
            height={28}
            yMin={0}
            yMax={1}
            cursorIndex={Math.min(tickIndex, traceLen - 1)}
            finalColor="var(--accent-primary)"
            barColor="var(--border-strong)"
          />
        </Stack>
      ) : null}
      {slam.slamAgents ? <RepRow agents={slam.slamAgents} /> : null}
    </Surface>
  );
}

function StageHeader({ slam }: { slam: NonNullable<TickSnapshot["slam"]> }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "var(--space-2)",
        paddingBottom: 4,
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <Mono size="md" style={{ color: "var(--text-hi)" }}>
        {slam.stageLabel}
      </Mono>
      <Mono size="sm" muted style={{ color: "var(--text-low)", fontSize: 11, fontWeight: 500 }}>
        stage {slam.cycle + 1} / {slam.totalStages}
      </Mono>
    </div>
  );
}

function MetricsRow({
  cost,
  iterations,
  factorCount,
}: {
  cost: number;
  iterations: number;
  factorCount: number;
}) {
  return (
    <div style={{ display: "flex", gap: "var(--space-2)" }}>
      <MetricCard label="cost" value={cost.toFixed(3)} />
      <MetricCard label="iter" value={String(iterations)} />
      <MetricCard label="factors" value={String(factorCount)} />
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: 1,
        padding: "6px 8px",
        background: "var(--surface-2)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-subtle)",
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
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          color: "var(--text-hi)",
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function CountRow({
  agents,
  landmarks,
  interRobot,
  closures,
}: {
  agents: number;
  landmarks: number;
  interRobot: number;
  closures: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--space-3)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: 500,
        color: "var(--text-mid)",
      }}
    >
      <span>{agents} agents</span>
      <span>{landmarks} landmarks</span>
      {interRobot > 0 ? <span>{interRobot} inter-robot edges</span> : null}
      {closures > 0 ? (
        <span style={{ color: "var(--accent-primary)" }}>{closures} loop closures</span>
      ) : null}
    </div>
  );
}

function RepRow({
  agents,
}: {
  agents: NonNullable<NonNullable<TickSnapshot["slam"]>["slamAgents"]>;
}) {
  return (
    <Stack gap={1} style={{ paddingTop: 4, borderTop: "1px solid var(--border-subtle)" }}>
      <Mono size="sm" muted className="t-label" style={{ color: "var(--text-low)" }}>
        SLAM-layer reputation
      </Mono>
      {agents.map((a) => {
        const color =
          a.reputation < 0.4
            ? "var(--status-byzantine)"
            : a.reputation < 0.55
              ? "var(--status-flagged)"
              : "var(--status-nominal)";
        return (
          <div
            key={a.id}
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}
          >
            <Mono size="sm" style={{ width: 28, color: "var(--text-hi)" }}>
              {a.id}
            </Mono>
            <div
              style={{
                flex: 1,
                height: 6,
                background: "var(--surface-2)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(1, a.reputation)) * 100}%`,
                  height: "100%",
                  background: color,
                }}
              />
            </div>
            <Mono size="sm" style={{ width: 36, textAlign: "right", color }}>
              {a.reputation.toFixed(2)}
            </Mono>
          </div>
        );
      })}
    </Stack>
  );
}
