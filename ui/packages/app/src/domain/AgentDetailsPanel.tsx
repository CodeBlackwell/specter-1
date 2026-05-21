import { useMemo, useState } from "react";
import type { TickSnapshot } from "@specter/sim-core";
import { Mono, Stack, Surface } from "../lib";
import { Sparkline } from "../charts";
import { useSimStore } from "../sim";

const BYZ = 0.4;
const FLAGGED = 0.55;
const LYING_GAP = 0.5;

type Status = "nominal" | "flagged" | "byzantine";

function statusOf(rep: number): Status {
  if (rep < BYZ) return "byzantine";
  if (rep < FLAGGED) return "flagged";
  return "nominal";
}

function colorOf(s: Status): string {
  if (s === "byzantine") return "var(--status-byzantine)";
  if (s === "flagged") return "var(--status-flagged)";
  return "var(--status-nominal)";
}

function statusLabel(s: Status): string {
  return s === "byzantine" ? "BYZANTINE" : s === "flagged" ? "FLAGGED" : "NOMINAL";
}

function statusGlyph(s: Status): string {
  return s === "byzantine" ? "✗" : s === "flagged" ? "△" : "●";
}

export function AgentDetailsPanel({ snapshot }: { snapshot: TickSnapshot | null }) {
  const selectedAgentId = useSimStore((s) => s.selectedAgentId);
  const setSelectedAgent = useSimStore((s) => s.setSelectedAgent);
  const result = useSimStore((s) => s.result);
  const tickIndex = useSimStore((s) => s.tickIndex);
  const attackStartTick = useSimStore((s) => s.spec?.attackStartTick ?? 0);

  const consensusSeries = useMemo(() => {
    if (!result || !selectedAgentId) return [] as number[];
    return result.snapshots.map(
      (s) => s.consensusReputations[selectedAgentId] ?? s.reputations[selectedAgentId] ?? 0.5,
    );
  }, [result, selectedAgentId]);

  if (!snapshot || !selectedAgentId) return null;
  const agent = snapshot.agents.find((a) => a.id === selectedAgentId);
  if (!agent) return null;

  const consensus = snapshot.consensusReputations[selectedAgentId] ?? 0.5;
  const status = statusOf(consensus);
  const color = colorOf(status);

  const otherAgents = snapshot.agents.filter((a) => a.id !== selectedAgentId && !a.phantom);
  const swarmView = otherAgents.map((a) => ({
    id: a.id,
    rep: snapshot.perAgentReputations[a.id]?.[selectedAgentId] ?? 0.5,
  }));
  const ownView = otherAgents.map((a) => {
    const beta = snapshot.perAgentBeta?.[selectedAgentId]?.[a.id];
    const rep = snapshot.perAgentReputations[selectedAgentId]?.[a.id] ?? 0.5;
    const obs = snapshot.observations.find(
      (o) => o.observer_id === selectedAgentId && o.subject_id === a.id,
    );
    return {
      id: a.id,
      rep,
      alpha: beta?.[0],
      beta: beta?.[1],
      range: obs?.range_m,
    };
  });

  const residuals = snapshot.observations
    .filter((o) => o.observer_id === selectedAgentId)
    .map((o) => {
      const subject = snapshot.agents.find((a) => a.id === o.subject_id);
      if (!subject) return null;
      const actual = Math.hypot(subject.x - agent.x, subject.y - agent.y);
      return {
        peerId: o.subject_id,
        claimed: o.range_m,
        actual,
        delta: o.range_m - actual,
      };
    })
    .filter((r): r is { peerId: string; claimed: number; actual: number; delta: number } => r !== null);
  const lyingEdges = residuals.filter((r) => Math.abs(r.delta) > LYING_GAP);

  let minRep = Infinity;
  let minIdx = 0;
  for (let i = 0; i < consensusSeries.length; i++) {
    if (consensusSeries[i]! < minRep) {
      minRep = consensusSeries[i]!;
      minIdx = i;
    }
  }
  if (!isFinite(minRep)) minRep = consensus;

  const flagging = swarmView.filter((p) => p.rep < BYZ).length;
  const trusting = swarmView.filter((p) => p.rep >= FLAGGED).length;
  const outliers =
    flagging > 0 ? swarmView.filter((p) => p.rep >= FLAGGED).map((p) => p.id) : [];

  const summary =
    flagging > 0
      ? `${agent.id} is flagged by ${flagging} of ${swarmView.length} peers.`
      : `${agent.id} is trusted by ${trusting} of ${swarmView.length} peers.`;

  const detectionIndex = attackStartTick > 0 ? attackStartTick - 1 : undefined;

  return (
    <Surface
      level={1}
      pad={2}
      style={{
        borderColor: color,
        borderWidth: 1,
        borderStyle: "solid",
      }}
    >
      <Stack gap={2}>
        <VerdictRow
          id={agent.id}
          glyph={statusGlyph(status)}
          label={statusLabel(status)}
          color={color}
          rep={consensus}
          onClose={() => setSelectedAgent(null)}
        />
        <p
          className="t-bodyS"
          style={{ margin: 0, color: "var(--text-mid)", lineHeight: "16px" }}
        >
          {summary}
        </p>
        <Section title={`SWARM VIEW OF ${agent.id}`} hint="what each peer thinks">
          <Stack gap={1}>
            {swarmView.map((p) => (
              <PeerBar key={p.id} id={p.id} rep={p.rep} />
            ))}
          </Stack>
          <StatsRow consensus={consensus} minRep={minRep} minIdx={minIdx} />
          {consensusSeries.length > 1 ? (
            <Sparkline
              data={consensusSeries}
              width={300}
              height={22}
              yMin={0}
              yMax={1}
              threshold={BYZ}
              cursorIndex={tickIndex}
              detectionIndex={detectionIndex}
              finalColor={color}
              barColor="var(--border-strong)"
            />
          ) : null}
          {outliers.length > 0 && flagging > 0 ? (
            <Mono size="sm" style={{ color: "var(--status-flagged)", fontSize: 12, fontWeight: 600 }}>
              ⚠ {outliers.length} outlier{outliers.length > 1 ? "s" : ""} ({outliers.join(", ")}) — possible colluders
            </Mono>
          ) : null}
        </Section>
        <Section title={`${agent.id}'S VIEW OF SWARM`} hint="who they trust and how strongly">
          <Stack gap={1}>
            {ownView.map((p) => (
              <PeerOwnRow key={p.id} {...p} />
            ))}
          </Stack>
        </Section>
        {residuals.length > 0 ? <ResidualsExpander residuals={residuals} lying={lyingEdges} /> : null}
      </Stack>
    </Surface>
  );
}

function VerdictRow({
  id,
  glyph,
  label,
  color,
  rep,
  onClose,
}: {
  id: string;
  glyph: string;
  label: string;
  color: string;
  rep: number;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color, fontFamily: "var(--font-mono)", fontSize: 14 }}>{glyph}</span>
      <Mono size="md" style={{ color: "var(--text-hi)" }}>{id}</Mono>
      <Mono size="sm" style={{ color, letterSpacing: 1 }}>{label}</Mono>
      <span style={{ flex: 1 }} />
      <Mono size="md" style={{ color }}>{rep.toFixed(2)}</Mono>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close details"
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "2px 6px",
          color: "var(--text-low)",
          fontFamily: "var(--font-mono)",
          fontSize: 14,
        }}
      >
        ×
      </button>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap={1} style={{ paddingTop: 4, borderTop: "1px solid var(--border-subtle)" }}>
      <Mono size="sm" className="t-label" style={{ color: "var(--text-low)", letterSpacing: 1 }}>
        {title}
      </Mono>
      <Mono size="sm" muted style={{ fontSize: 11.5, color: "var(--text-low)", fontStyle: "italic" }}>
        {hint}
      </Mono>
      {children}
    </Stack>
  );
}

function PeerBar({ id, rep }: { id: string; rep: number }) {
  const color = colorOf(statusOf(rep));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
      <Mono size="sm" style={{ width: 26, color: "var(--text-hi)", fontWeight: 600 }}>{id}</Mono>
      <RepBar rep={rep} color={color} />
      <Mono size="sm" style={{ width: 40, textAlign: "right", color, fontWeight: 600 }}>{rep.toFixed(2)}</Mono>
    </div>
  );
}

function PeerOwnRow({
  id,
  rep,
  alpha,
  beta,
  range,
}: {
  id: string;
  rep: number;
  alpha: number | undefined;
  beta: number | undefined;
  range: number | undefined;
}) {
  const color = colorOf(statusOf(rep));
  const ab =
    alpha !== undefined && beta !== undefined
      ? `${alpha.toFixed(1)}/${beta.toFixed(1)}`
      : "—";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
      <Mono size="sm" style={{ width: 26, color: "var(--text-hi)", fontWeight: 600 }}>{id}</Mono>
      <Mono size="sm" style={{ width: 60, textAlign: "right", color: "var(--text-low)", fontSize: 11.5 }}>
        {ab}
      </Mono>
      <RepBar rep={rep} color={color} />
      <Mono size="sm" style={{ width: 36, textAlign: "right", color, fontWeight: 600 }}>{rep.toFixed(2)}</Mono>
      <Mono
        size="sm"
        style={{
          width: 44,
          textAlign: "right",
          color: range !== undefined ? "var(--accent-primary)" : "var(--text-low)",
          fontSize: 11.5,
        }}
      >
        {range !== undefined ? `${range.toFixed(1)}m` : "—"}
      </Mono>
    </div>
  );
}

function RepBar({ rep, color }: { rep: number; color: string }) {
  const pct = Math.max(0, Math.min(1, rep)) * 100;
  return (
    <div
      style={{
        flex: 1,
        height: 6,
        background: "var(--surface-2)",
        borderRadius: 3,
        overflow: "hidden",
        minWidth: 40,
      }}
    >
      <div style={{ width: `${pct}%`, height: "100%", background: color }} />
    </div>
  );
}

function StatsRow({
  consensus,
  minRep,
  minIdx,
}: {
  consensus: number;
  minRep: number;
  minIdx: number;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
      <Mono size="sm" muted style={{ color: "var(--text-low)" }}>
        consensus {consensus.toFixed(2)}
      </Mono>
      <Mono size="sm" muted style={{ color: "var(--text-low)" }}>
        min {minRep.toFixed(2)} @ t{minIdx + 1}
      </Mono>
    </div>
  );
}

function ResidualsExpander({
  residuals,
  lying,
}: {
  residuals: Array<{ peerId: string; claimed: number; actual: number; delta: number }>;
  lying: Array<{ peerId: string; claimed: number; actual: number; delta: number }>;
}) {
  const [open, setOpen] = useState(lying.length > 0);
  return (
    <Stack gap={1} style={{ paddingTop: 4, borderTop: "1px solid var(--border-subtle)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: lying.length > 0 ? "var(--status-byzantine)" : "var(--text-low)",
          letterSpacing: 0.5,
        }}
      >
        {open ? "▾" : "▸"} range residuals · {lying.length} lying edge{lying.length === 1 ? "" : "s"}
      </button>
      {open
        ? residuals.map((r) => {
            const isLying = Math.abs(r.delta) > LYING_GAP;
            const color = isLying ? "var(--status-byzantine)" : "var(--text-low)";
            const sign = r.delta >= 0 ? "+" : "−";
            return (
              <div
                key={r.peerId}
                style={{
                  display: "flex",
                  gap: 6,
                  fontSize: 11.5,
                  fontFamily: "var(--font-mono)",
                  color: isLying ? "var(--text-hi)" : "var(--text-mid)",
                }}
              >
                <span style={{ width: 24 }}>{r.peerId}</span>
                <span style={{ width: 60, textAlign: "right" }}>
                  claimed {r.claimed.toFixed(1)}
                </span>
                <span style={{ width: 60, textAlign: "right", color: "var(--text-low)" }}>
                  actual {r.actual.toFixed(1)}
                </span>
                <span style={{ flex: 1, textAlign: "right", color }}>
                  Δ {sign}
                  {Math.abs(r.delta).toFixed(1)}
                  {isLying ? " !" : ""}
                </span>
              </div>
            );
          })
        : null}
    </Stack>
  );
}
