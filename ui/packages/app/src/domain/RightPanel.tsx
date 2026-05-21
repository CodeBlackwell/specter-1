import { useMemo } from "react";
import type { ReactNode } from "react";
import type { TickSnapshot } from "@specter/sim-core";
import { Cluster, Mono, Pill, Stack, Surface } from "../lib";
import { LESSONS } from "../data/lessons";
import { TrustPanel } from "./TrustPanel";
import { SlamMetricsPanel } from "./SlamMetricsPanel";

type Props = {
  snapshot: TickSnapshot | null;
  lessonId: string;
};

export function RightPanel({ snapshot, lessonId }: Props) {
  const lesson = LESSONS.find((l) => l.id === lessonId) ?? LESSONS[0]!;
  const isSlamLesson = lesson.trunk === "slam";
  return (
    <Stack
      gap={2}
      style={{
        flex: "0 0 400px",
        minWidth: 320,
        minHeight: 0,
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <Surface level={1} pad={4}>
        <Stack gap={3}>
          <Stack gap={1}>
            <Mono size="sm" muted className="t-label">
              Inspector · Lesson {lesson.id}
            </Mono>
            <span className="t-h3" style={{ color: "var(--text-hi)" }}>
              {lesson.title}
            </span>
          </Stack>
          {isSlamLesson ? (
            <Section label="Intuition">
              <SlamIntuitionBlock snapshot={snapshot} />
            </Section>
          ) : (
            <>
              <Section label="Intuition">
                <IntuitionBlock snapshot={snapshot} />
              </Section>
              <Section label="Claim">
                <ClaimBlock snapshot={snapshot} />
              </Section>
              <Section label="Limit">
                <LimitBlock />
              </Section>
            </>
          )}
        </Stack>
      </Surface>

      {isSlamLesson ? (
        <SlamMetricsPanel snapshot={snapshot} />
      ) : (
        <TrustPanel snapshot={snapshot} />
      )}
    </Stack>
  );
}

function SlamIntuitionBlock({ snapshot }: { snapshot: TickSnapshot | null }) {
  const slam = snapshot?.slam;
  return (
    <Stack gap={2}>
      <Mono size="code" muted>
        cost = Σ rᵀ Ω r
      </Mono>
      <p className="t-bodyS" style={{ margin: 0, color: "var(--text-mid)" }}>
        Pose-graph SLAM frames mapping as least-squares: every odometry, landmark,
        and loop-closure factor contributes a weighted residual; LM steps drive
        their sum down. Loop closures (L09) and reputation-weighted information
        matrices (L12) are different ways of telling the optimizer which residuals
        to trust.
      </p>
      <Cluster gap={4}>
        <Stack gap={1}>
          <Mono size="sm" muted className="t-labelSm">stage</Mono>
          <Mono size="lg" style={{ color: "var(--accent-primary)" }}>
            {slam ? `${slam.cycle + 1}/${slam.totalStages}` : "—"}
          </Mono>
        </Stack>
        <Stack gap={1}>
          <Mono size="sm" muted className="t-labelSm">cost</Mono>
          <Mono size="lg" style={{ color: "var(--text-hi)" }}>
            {slam ? slam.cost.toFixed(3) : "—"}
          </Mono>
        </Stack>
      </Cluster>
    </Stack>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack
      gap={2}
      style={{
        paddingTop: "var(--space-2)",
        borderTop: "1px solid var(--border-subtle)",
      }}
    >
      <Mono size="sm" muted className="t-label">
        {label}
      </Mono>
      {children}
    </Stack>
  );
}

function IntuitionBlock({ snapshot }: { snapshot: TickSnapshot | null }) {
  const reps = snapshot
    ? Object.values(
        Object.keys(snapshot.consensusReputations).length > 0
          ? snapshot.consensusReputations
          : snapshot.reputations,
      )
    : [];
  const avg = reps.length ? reps.reduce((a, b) => a + b, 0) / reps.length : null;
  const min = reps.length ? Math.min(...reps) : null;
  return (
    <Stack gap={2}>
      <Mono size="code" muted>
        score = α / (α + β)
      </Mono>
      <p className="t-bodyS" style={{ margin: 0, color: "var(--text-mid)" }}>
        Each peer carries a Beta(α, β) reputation. α grows on agreement, β on disagreement.
        Old evidence decays with a 10s half-life so peers can rehabilitate.
      </p>
      <Cluster gap={4}>
        <Stack gap={1}>
          <Mono size="sm" muted className="t-labelSm">swarm avg</Mono>
          <Mono size="lg" style={{ color: "var(--accent-primary)" }}>
            {avg !== null ? avg.toFixed(2) : "—"}
          </Mono>
        </Stack>
        <Stack gap={1}>
          <Mono size="sm" muted className="t-labelSm">min peer</Mono>
          <Mono size="lg" style={{
            color: min !== null && min < 0.4 ? "var(--status-byzantine)" : "var(--text-hi)",
          }}>
            {min !== null ? min.toFixed(2) : "—"}
          </Mono>
        </Stack>
      </Cluster>
    </Stack>
  );
}

function ClaimBlock({ snapshot }: { snapshot: TickSnapshot | null }) {
  const cohortsThisTick = snapshot?.newCohortEvents ?? [];
  const tier1 = cohortsThisTick.filter((c) => c.tier_used === "t1").length;
  const tier2 = cohortsThisTick.filter((c) => c.tier_used === "t2").length;
  const skipped = cohortsThisTick.filter((c) => c.tier_used === "skip").length;
  const embeddability = useMemo(() => {
    const t2 = cohortsThisTick.find((c) => c.embeddability_score != null);
    return t2?.embeddability_score ?? null;
  }, [cohortsThisTick]);

  return (
    <Stack gap={2}>
      <Stack gap={1}>
        <Mono size="sm" muted className="t-labelSm">
          cohorts this tick
        </Mono>
        <Cluster gap={2} wrap>
          <Pill tone={tier1 > 0 ? "accent" : "neutral"}>Tier 1 · {tier1}</Pill>
          <Pill tone={tier2 > 0 ? "byzantine" : "neutral"}>Tier 2 · {tier2}</Pill>
          <Pill>skip · {skipped}</Pill>
        </Cluster>
      </Stack>
      {embeddability != null ? (
        <Stack gap={1}>
          <Mono size="sm" muted className="t-labelSm">
            embeddability (τ = 0.05)
          </Mono>
          <Mono size="lg" style={{
            color: embeddability > 0.05 ? "var(--status-byzantine)" : "var(--status-nominal)",
          }}>
            {embeddability.toFixed(4)}
          </Mono>
        </Stack>
      ) : null}
      <p className="t-bodyS" style={{ margin: 0, color: "var(--text-mid)" }}>
        Tier 1: pairwise reciprocal range. Tier 2: MDS embeddability when k ≥ 3.
      </p>
    </Stack>
  );
}

function LimitBlock() {
  return (
    <p className="t-bodyS" style={{ margin: 0, color: "var(--text-mid)" }}>
      Symmetric colluder pairs at N &lt; 8 may not cross the lying-edge threshold within a
      single cohort. Multi-tick evidence accumulates over the decay window.
    </p>
  );
}

