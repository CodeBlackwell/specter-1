import { useMemo, useRef, useState } from "react";
import { cooperativeSlamTruth } from "@specter/sim-core";
import { Stack } from "../lib/Stack";
import { Cluster } from "../lib/Cluster";
import { Mono } from "../lib/Mono";
import { useCurrentSnapshot, useSimStore } from "./simStore";
import { type Hint, HoverHintOverlay } from "./HoverHint";
import {
  estimatedAgentHint,
  estimatedLandmarkHint,
  interRobotEdgeHint,
  landmarkErrorEdgeHint,
  reputationTraceHint,
  truthLandmarkHint,
  truthPoseHint,
} from "./slamHints";
import {
  SlamSceneBackground,
  AGENT_R,
  LM_R,
  STROKE,
  HEADING_LEN,
  LABEL_FONT,
} from "./slamRender";

const AGENT_IDS = ["A0", "A1", "A2", "A3"] as const;

const TRACE_W = 220;
const TRACE_H = 80;
const TRACE_PAD = 6;

function agentColor(id: string): string {
  return id === "A0" ? "var(--status-byzantine)" : "var(--status-nominal)";
}

/** L12 — closed loop. Stage progression (per-LM-iteration snapshots) is
 * driven by the global tick scrubber via simStore. The reputation trace
 * reads the full snapshot history so it always shows the complete arc,
 * with the active cycle marked. */
export function ClosedLoopSlamCanvas() {
  const snap = useCurrentSnapshot();
  const tickIndex = useSimStore((s) => s.tickIndex);
  const result = useSimStore((s) => s.result);
  const truth = useMemo(() => cooperativeSlamTruth(), []);
  const [hint, setHint] = useState<Hint | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const truthAgents = new Map(truth.agents);
  const truthLm = new Map(truth.landmarks);

  const traceData = useMemo(() => {
    const snapshots = result?.snapshots ?? [];
    return snapshots
      .map((s) => {
        const slamView = s.slam;
        if (!slamView || slamView.kind !== "cooperative" || !slamView.slamAgents) return null;
        const reps = new Map<string, number>();
        for (const a of slamView.slamAgents) reps.set(a.id, a.reputation);
        return { reps };
      })
      .filter((d): d is { reps: Map<string, number> } => d !== null);
  }, [result]);

  const slam = snap?.slam;
  if (!slam || slam.kind !== "cooperative" || !slam.slamAgents) return null;
  const slamAgents = slam.slamAgents;
  const landmarks = slam.landmarks;
  const interRobotEdges = slam.interRobotEdges ?? [];

  const traceLen = traceData.length;
  const cursorX = traceLen > 1 ? (Math.min(tickIndex, traceLen - 1) / (traceLen - 1)) * TRACE_W : 0;

  return (
    <Stack gap={2} grow style={{ minHeight: 0 }}>
      <Cluster gap={2} align="center">
        <Mono size="sm" className="t-label" style={{ color: "var(--text-low)", letterSpacing: 1 }}>
          {slam.stageLabel}
        </Mono>
        <Mono size="sm" muted>
          step {slam.cycle + 1}/{slam.totalStages} · cost {slam.cost.toFixed(3)} · LM iter {slam.iterations}
        </Mono>
      </Cluster>
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: "var(--space-2)" }}>
        <div
          ref={containerRef}
          style={{ flex: 1, minWidth: 0, display: "flex", position: "relative" }}
        >
          <SlamSceneBackground>
            {interRobotEdges.map((e, i) => {
              const from = slamAgents.find((a) => a.id === e.fromId)?.pose;
              const to = slamAgents.find((a) => a.id === e.toId)?.pose;
              if (!from || !to) return null;
              const distance = Math.hypot(to.x - from.x, to.y - from.y);
              return (
                <g key={`edge-${i}`}>
                  <line
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke="var(--accent-dim)"
                    strokeWidth={STROKE * 0.8}
                    strokeDasharray="0.15 0.15"
                    opacity={0.7}
                  />
                  <line
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke="transparent"
                    strokeWidth={STROKE * 6}
                    style={{ cursor: "help" }}
                    onPointerEnter={() => setHint(interRobotEdgeHint(e.fromId, e.toId, distance))}
                    onPointerLeave={() => setHint(null)}
                  />
                </g>
              );
            })}
            {slamAgents.map((a) => {
              const t = truthAgents.get(a.id);
              if (!t) return null;
              return (
                <circle
                  key={`truth-${a.id}`}
                  cx={t[0]} cy={t[1]} r={AGENT_R * 0.65}
                  fill="none"
                  stroke="var(--text-low)"
                  strokeWidth={STROKE * 0.6}
                  strokeDasharray="0.12 0.12"
                  opacity={0.55}
                  style={{ cursor: "help" }}
                  onPointerEnter={() => setHint(truthPoseHint(`${a.id}-truth`, t[0], t[1]))}
                  onPointerLeave={() => setHint(null)}
                />
              );
            })}
            {truth.landmarks.map(([id, [x, y]]) => (
              <rect
                key={`truth-lm-${id}`}
                x={x - LM_R} y={y - LM_R}
                width={LM_R * 2} height={LM_R * 2}
                fill="none"
                stroke="var(--text-low)"
                strokeWidth={STROKE * 0.6}
                opacity={0.45}
                style={{ cursor: "help" }}
                onPointerEnter={() => setHint(truthLandmarkHint(id, x, y))}
                onPointerLeave={() => setHint(null)}
              />
            ))}
            {landmarks.map(([id, [x, y]]) => {
              const t = truthLm.get(id);
              const err = t ? Math.hypot(x - t[0], y - t[1]) : 0;
              return (
                <g key={`est-lm-${id}`}>
                  {t ? (
                    <line
                      x1={t[0]} y1={t[1]} x2={x} y2={y}
                      stroke="var(--status-flagged)"
                      strokeWidth={STROKE * 0.7}
                      opacity={0.7}
                      style={{ cursor: "help" }}
                      onPointerEnter={() => setHint(landmarkErrorEdgeHint(err))}
                      onPointerLeave={() => setHint(null)}
                    />
                  ) : null}
                  <rect
                    x={x - LM_R} y={y - LM_R}
                    width={LM_R * 2} height={LM_R * 2}
                    fill="var(--status-nominal)"
                    opacity={0.85}
                    style={{ cursor: "help" }}
                    onPointerEnter={() => setHint(estimatedLandmarkHint(id, x, y, t))}
                    onPointerLeave={() => setHint(null)}
                  />
                </g>
              );
            })}
            {slamAgents.map((a) => {
              const t = truthAgents.get(a.id);
              const color = agentColor(a.id);
              const headingX = a.pose.x + Math.cos(a.pose.theta) * HEADING_LEN;
              const headingY = a.pose.y + Math.sin(a.pose.theta) * HEADING_LEN;
              const repOpacity = 0.35 + 0.65 * a.reputation;
              return (
                <g
                  key={`est-${a.id}`}
                  style={{ cursor: "help" }}
                  onPointerEnter={() =>
                    setHint(estimatedAgentHint(a.id, a.pose.x, a.pose.y, t, a.reputation))
                  }
                  onPointerLeave={() => setHint(null)}
                >
                  <circle
                    cx={a.pose.x}
                    cy={a.pose.y}
                    r={AGENT_R}
                    fill={color}
                    fillOpacity={0.22 * repOpacity}
                    stroke={color}
                    strokeWidth={STROKE}
                    strokeOpacity={repOpacity}
                  />
                  <line
                    x1={a.pose.x}
                    y1={a.pose.y}
                    x2={headingX}
                    y2={headingY}
                    stroke={color}
                    strokeWidth={STROKE}
                    strokeOpacity={repOpacity}
                  />
                </g>
              );
            })}
            <g transform="scale(1 -1)">
              {slamAgents.map((a) => (
                <g key={`label-${a.id}`}>
                  <text
                    x={a.pose.x}
                    y={-(a.pose.y) - AGENT_R - LABEL_FONT * 0.4}
                    fontSize={LABEL_FONT}
                    fontFamily="var(--font-mono)"
                    textAnchor="middle"
                    fill="var(--text-hi)"
                  >
                    {a.id}
                  </text>
                  <text
                    x={a.pose.x}
                    y={-(a.pose.y) + AGENT_R + LABEL_FONT}
                    fontSize={LABEL_FONT * 0.85}
                    fontFamily="var(--font-mono)"
                    textAnchor="middle"
                    fill={agentColor(a.id)}
                  >
                    {a.reputation.toFixed(2)}
                  </text>
                </g>
              ))}
            </g>
          </SlamSceneBackground>
          <HoverHintOverlay hint={hint} containerRef={containerRef} />
        </div>
        {traceLen > 1 ? (
          <div style={{ width: TRACE_W + 16, flexShrink: 0 }}>
            <Stack gap={1}>
              <Mono size="sm" muted>Reputation trace ({traceLen} steps)</Mono>
              <svg
                viewBox={`0 0 ${TRACE_W + TRACE_PAD * 2} ${TRACE_H + TRACE_PAD * 2}`}
                style={{ width: "100%", background: "var(--surface-1)" }}
              >
                <g transform={`translate(${TRACE_PAD} ${TRACE_PAD})`}>
                  <line x1={0} y1={TRACE_H} x2={TRACE_W} y2={TRACE_H} stroke="var(--text-low)" strokeWidth={0.5} />
                  <line x1={0} y1={0} x2={0} y2={TRACE_H} stroke="var(--text-low)" strokeWidth={0.5} />
                  <line x1={0} y1={TRACE_H / 2} x2={TRACE_W} y2={TRACE_H / 2} stroke="var(--text-low)" strokeWidth={0.3} strokeDasharray="2 2" />
                  <text x={2} y={TRACE_H / 2 - 2} fontSize={10} fontWeight={600} fontFamily="var(--font-mono)" fill="var(--text-mid)">0.5</text>
                  {AGENT_IDS.map((id) => {
                    const points = traceData
                      .map((d, i) => {
                        const r = d.reps.get(id) ?? 0.5;
                        const x = (i / (traceLen - 1)) * TRACE_W;
                        const y = TRACE_H * (1 - r);
                        return `${x},${y}`;
                      })
                      .join(" ");
                    return (
                      <polyline
                        key={id}
                        points={points}
                        fill="none"
                        stroke={agentColor(id)}
                        strokeWidth={1.5}
                        style={{ cursor: "help" }}
                        onPointerEnter={() => setHint(reputationTraceHint(id))}
                        onPointerLeave={() => setHint(null)}
                      />
                    );
                  })}
                  <line
                    x1={cursorX}
                    y1={0}
                    x2={cursorX}
                    y2={TRACE_H}
                    stroke="var(--accent-primary)"
                    strokeWidth={1}
                    opacity={0.7}
                  />
                </g>
              </svg>
              <Mono size="sm" muted>
                A0 (red) collapses · honest peers (green) rebound
              </Mono>
            </Stack>
          </div>
        ) : null}
      </div>
      <Mono size="sm" muted>
        Bidirectional trust ↔ SLAM: χ² evidence drops A0's rep cycle-by-cycle → DCS prior shrinks A0's factor weight → joint map recovers.
      </Mono>
    </Stack>
  );
}
