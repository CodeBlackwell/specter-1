import { useMemo, useRef, useState } from "react";
import { singleAgentLoopClosureTruth } from "@specter/sim-core";
import { Stack } from "../lib/Stack";
import { Cluster } from "../lib/Cluster";
import { Mono } from "../lib/Mono";
import { useCurrentSnapshot } from "./simStore";
import { type Hint, HoverHintOverlay } from "./HoverHint";
import {
  estimatedLandmarkHint,
  estimatedPoseHint,
  estimatedTrajectoryHint,
  landmarkErrorEdgeHint,
  loopClosureHint,
  truthLandmarkHint,
  truthPoseHint,
  truthTrajectoryHint,
} from "./slamHints";
import {
  SlamSceneBackground,
  SCENE_BOUNDS_L09,
  AGENT_R,
  LM_R,
  STROKE,
  HEADING_LEN,
  LABEL_FONT,
} from "./slamRender";

const POSE_R = 0.18;

export function SlamCanvas() {
  const snap = useCurrentSnapshot();
  const truth = useMemo(() => singleAgentLoopClosureTruth(), []);
  const [hint, setHint] = useState<Hint | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const slam = snap?.slam;
  if (!slam || slam.kind !== "single") return null;
  const trajectory = slam.trajectory ?? [];
  const landmarks = slam.landmarks;
  const closureEdges = slam.closureEdges ?? [];

  const trajPath = polylinePath(trajectory.map(([, p]) => [p.x, p.y]));
  const truthPath = polylinePath(truth.trajectory.map(([, p]) => [p.x, p.y]));
  const truthLm = new Map(truth.landmarks);
  const truthTraj = new Map(truth.trajectory.map(([id, p]) => [id, p]));
  const lastPose = trajectory[trajectory.length - 1]?.[1];

  return (
    <Stack gap={2} grow style={{ minHeight: 0 }}>
      <Cluster gap={2} align="center">
        <Mono size="sm" className="t-label" style={{ color: "var(--text-low)", letterSpacing: 1 }}>
          {slam.stageLabel}
        </Mono>
        <Mono size="sm" muted>
          step {slam.cycle + 1}/{slam.totalStages} · cost {slam.cost.toFixed(3)} · LM iter {slam.iterations} · closures {closureEdges.length}
        </Mono>
      </Cluster>
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}
      >
        <SlamSceneBackground bounds={SCENE_BOUNDS_L09}>
          <path
            d={truthPath}
            fill="none"
            stroke="var(--text-low)"
            strokeWidth={STROKE * 0.7}
            strokeDasharray="0.2 0.2"
            opacity={0.55}
            style={{ cursor: "help" }}
            onPointerEnter={() => setHint(truthTrajectoryHint())}
            onPointerLeave={() => setHint(null)}
          />
          {truth.trajectory.map(([id, p]) => (
            <circle
              key={`truth-${id}`}
              cx={p.x}
              cy={p.y}
              r={POSE_R * 0.65}
              fill="var(--text-low)"
              opacity={0.45}
              style={{ cursor: "help" }}
              onPointerEnter={() => setHint(truthPoseHint(id, p.x, p.y))}
              onPointerLeave={() => setHint(null)}
            />
          ))}
          {truth.landmarks.map(([id, [x, y]]) => (
            <rect
              key={`truth-lm-${id}`}
              x={x - LM_R}
              y={y - LM_R}
              width={LM_R * 2}
              height={LM_R * 2}
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
                    x1={t[0]}
                    y1={t[1]}
                    x2={x}
                    y2={y}
                    stroke="var(--status-flagged)"
                    strokeWidth={STROKE * 0.7}
                    opacity={0.7}
                    style={{ cursor: "help" }}
                    onPointerEnter={() => setHint(landmarkErrorEdgeHint(err))}
                    onPointerLeave={() => setHint(null)}
                  />
                ) : null}
                <rect
                  x={x - LM_R}
                  y={y - LM_R}
                  width={LM_R * 2}
                  height={LM_R * 2}
                  fill="var(--status-nominal)"
                  opacity={0.85}
                  style={{ cursor: "help" }}
                  onPointerEnter={() => setHint(estimatedLandmarkHint(id, x, y, t))}
                  onPointerLeave={() => setHint(null)}
                />
              </g>
            );
          })}
          {closureEdges.map((c, i) => {
            const from = trajectory.find(([id]) => id === c.fromId)?.[1];
            const to = trajectory.find(([id]) => id === c.toId)?.[1];
            if (!from || !to) return null;
            return (
              <g key={`closure-${i}`}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="var(--accent-primary)"
                  strokeWidth={STROKE * 1.4}
                  opacity={0.9}
                />
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="transparent"
                  strokeWidth={STROKE * 8}
                  style={{ cursor: "help" }}
                  onPointerEnter={() => setHint(loopClosureHint(c.fromId, c.toId))}
                  onPointerLeave={() => setHint(null)}
                />
              </g>
            );
          })}
          <path
            d={trajPath}
            fill="none"
            stroke="var(--status-nominal)"
            strokeWidth={STROKE * 1.2}
            style={{ cursor: "help" }}
            onPointerEnter={() => setHint(estimatedTrajectoryHint())}
            onPointerLeave={() => setHint(null)}
          />
          {trajectory.slice(0, -1).map(([id, p]) => {
            const t = truthTraj.get(id);
            return (
              <circle
                key={`est-${id}`}
                cx={p.x}
                cy={p.y}
                r={POSE_R}
                fill="var(--status-nominal)"
                fillOpacity={0.85}
                stroke="var(--surface-bg)"
                strokeWidth={STROKE * 0.5}
                style={{ cursor: "help" }}
                onPointerEnter={() =>
                  setHint(estimatedPoseHint(id, p.x, p.y, t ? { x: t.x, y: t.y } : undefined, false))
                }
                onPointerLeave={() => setHint(null)}
              />
            );
          })}
          {lastPose ? (
            <g
              style={{ cursor: "help" }}
              onPointerEnter={() => {
                const lastId = trajectory[trajectory.length - 1]![0];
                const t = truthTraj.get(lastId);
                setHint(estimatedPoseHint(lastId, lastPose.x, lastPose.y, t ? { x: t.x, y: t.y } : undefined, true));
              }}
              onPointerLeave={() => setHint(null)}
            >
              <circle
                cx={lastPose.x}
                cy={lastPose.y}
                r={AGENT_R * 0.75}
                fill="var(--accent-primary)"
                fillOpacity={0.22}
                stroke="var(--accent-primary)"
                strokeWidth={STROKE}
              />
              <line
                x1={lastPose.x}
                y1={lastPose.y}
                x2={lastPose.x + Math.cos(lastPose.theta) * HEADING_LEN * 0.75}
                y2={lastPose.y + Math.sin(lastPose.theta) * HEADING_LEN * 0.75}
                stroke="var(--accent-primary)"
                strokeWidth={STROKE}
              />
            </g>
          ) : null}
          {lastPose ? (
            <g transform="scale(1 -1)">
              <text
                x={lastPose.x}
                y={-(lastPose.y) - AGENT_R * 0.75 - LABEL_FONT * 0.4}
                fontSize={LABEL_FONT}
                fontFamily="var(--font-mono)"
                textAnchor="middle"
                fill="var(--text-hi)"
              >
                alpha
              </text>
            </g>
          ) : null}
        </SlamSceneBackground>
        <HoverHintOverlay hint={hint} containerRef={containerRef} />
      </div>
      <Mono size="sm" muted>
        Dashed grey = ground truth · solid green = estimate · orange = est-vs-truth landmark error · blue line = loop closure
      </Mono>
    </Stack>
  );
}

function polylinePath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
}
