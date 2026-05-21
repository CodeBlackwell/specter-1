import { useState } from "react";
import type { SlamView, TickSnapshot } from "@specter/sim-core";
import { Mono, Stack, Surface } from "../lib";
import { ATTACK_SCENE, LESSON_SCENE } from "../data/sceneCopy";
import { RichText } from "./RichText";

function slamPhase(
  slam: SlamView,
  hasAttacker: boolean,
  attackStartTick: number,
): { phaseLabel: string; phaseColor: string } {
  const isAttackStage = hasAttacker && slam.cycle >= attackStartTick;
  const stage = `STAGE ${slam.cycle + 1}/${slam.totalStages} · ${slam.stageLabel}`;
  return {
    phaseLabel: stage,
    phaseColor: isAttackStage ? "var(--status-byzantine)" : "var(--accent-primary)",
  };
}

type Props = {
  snapshot: TickSnapshot | null;
  lessonId: string | null;
  attackId: string | null;
  attackStartTick: number;
};

export function SceneBriefing({ snapshot, lessonId, attackId, attackStartTick }: Props) {
  const [expanded, setExpanded] = useState(true);
  const lessonCopy = lessonId ? LESSON_SCENE[lessonId] : undefined;
  const attackCopy = attackId ? ATTACK_SCENE[attackId] : undefined;
  const currentTick = snapshot?.tick ?? 0;
  const slam = snapshot?.slam;
  const hasAttacker = attackId !== null && attackId !== "honest";
  const inWarmup = hasAttacker && attackStartTick > 0 && currentTick < attackStartTick;
  const { phaseLabel, phaseColor } = slam
    ? slamPhase(slam, hasAttacker, attackStartTick)
    : {
        phaseLabel: !hasAttacker
          ? "HONEST"
          : inWarmup
            ? `WARMUP · arms at t${attackStartTick}`
            : `ATTACK LIVE · since t${attackStartTick}`,
        phaseColor: !hasAttacker
          ? "var(--text-low)"
          : inWarmup
            ? "var(--status-nominal)"
            : "var(--status-byzantine)",
      };

  return (
    <Surface
      level={1}
      pad={2}
      style={{ cursor: "pointer" }}
      onClick={() => setExpanded((v) => !v)}
    >
      <Stack gap={expanded ? 2 : 1}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "var(--space-2) var(--space-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            fontWeight: 600,
            minWidth: 0,
          }}
        >
          <span style={{ color: "var(--text-low)", letterSpacing: 1 }}>SCENE</span>
          <span
            style={{
              color: "var(--text-hi)",
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            {lessonCopy?.heading ?? `Lesson ${lessonId ?? ""}`}
          </span>
          <span style={{ color: phaseColor, letterSpacing: 1 }}>{phaseLabel}</span>
          {attackId && attackId !== "honest" ? (
            <span style={{ color: "var(--text-mid)", fontWeight: 400 }}>· {attackId}</span>
          ) : null}
          <span
            style={{
              color: "var(--text-low)",
              fontSize: 11,
              fontWeight: 500,
              marginLeft: "auto",
            }}
          >
            {expanded ? "▾ collapse" : "▸ expand"}
          </span>
        </div>
        {expanded ? (
          <Stack gap={3} style={{ paddingTop: "var(--space-1)" }}>
            {lessonCopy ? <RichText source={lessonCopy.body} /> : null}
            {attackCopy ? (
              <div
                style={{
                  paddingTop: "var(--space-2)",
                  borderTop: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-1)",
                }}
              >
                <Mono size="sm" muted className="t-label">
                  ATTACK · {attackId}
                </Mono>
                <RichText source={attackCopy} />
              </div>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Surface>
  );
}
