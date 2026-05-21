import { ATTACK_CATALOG, FAMILY_COLOR, type AttackEntry } from "../../data/scenarios";
import { Chip, Cluster, Mono, Stack, Surface } from "../../lib";
import { useSimStore } from "../../sim";

const TICK_MIN = 0;
const TICK_MAX = 900;
const TICK_STEP = 5;

export function ScheduleBlock() {
  const attackIds = useSimStore((s) => s.attackIds);
  const attackSchedules = useSimStore((s) => s.attackSchedules);
  const toggleAttack = useSimStore((s) => s.toggleAttack);
  const setAttackSchedule = useSimStore((s) => s.setAttackSchedule);

  const activeSet = new Set(attackIds);
  const selectable = ATTACK_CATALOG.filter((a) => a.id !== "honest" && !a.trustLayerNoop);

  return (
    <Surface level={1} pad={3}>
      <Stack gap={3}>
        <Mono size="sm" muted className="t-label">
          Schedule
        </Mono>
        <Cluster gap={2} wrap>
          {selectable.map((a) => (
            <Chip
              key={a.id}
              selected={activeSet.has(a.id)}
              swatch={FAMILY_COLOR[a.family]}
              onClick={() => toggleAttack(a.id)}
              title={a.description}
            >
              {a.label}
            </Chip>
          ))}
        </Cluster>
        {attackIds.length === 0 ? (
          <Mono size="sm" muted>
            No attacks selected · launch will run the honest baseline.
          </Mono>
        ) : (
          <Stack gap={2}>
            {attackIds.map((id) => {
              const entry = ATTACK_CATALOG.find((a) => a.id === id);
              if (!entry) return null;
              const w = attackSchedules[id] ?? { startTick: 0, endTick: TICK_MAX };
              return (
                <AttackRow
                  key={id}
                  entry={entry}
                  startTick={w.startTick}
                  endTick={w.endTick}
                  onChange={(window) => setAttackSchedule(id, window)}
                  onRemove={() => toggleAttack(id)}
                />
              );
            })}
          </Stack>
        )}
      </Stack>
    </Surface>
  );
}

function AttackRow({
  entry,
  startTick,
  endTick,
  onChange,
  onRemove,
}: {
  entry: AttackEntry;
  startTick: number;
  endTick: number;
  onChange: (window: { startTick?: number; endTick?: number }) => void;
  onRemove: () => void;
}) {
  const duration = endTick - startTick;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-3)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 4,
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <Cluster gap={2} align="center">
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 8,
            background: FAMILY_COLOR[entry.family],
            flexShrink: 0,
          }}
        />
        <Mono size="sm" style={{ flex: 1 }}>
          {entry.label}
        </Mono>
        <Mono size="sm" muted>
          {startTick}→{endTick} · Δ{duration}
        </Mono>
        <button
          type="button"
          aria-label={`Remove ${entry.label}`}
          onClick={onRemove}
          style={{
            background: "transparent",
            border: 0,
            color: "var(--text-low)",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </Cluster>
      <RangeSlider
        min={TICK_MIN}
        max={TICK_MAX}
        step={TICK_STEP}
        startValue={startTick}
        endValue={endTick}
        onChange={onChange}
      />
    </div>
  );
}

function RangeSlider({
  min,
  max,
  step,
  startValue,
  endValue,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  startValue: number;
  endValue: number;
  onChange: (window: { startTick?: number; endTick?: number }) => void;
}) {
  const range = max - min;
  const startPct = ((startValue - min) / range) * 100;
  const endPct = ((endValue - min) / range) * 100;
  return (
    <div style={{ position: "relative", height: 28, width: "100%" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 12,
          height: 4,
          background: "var(--border-subtle)",
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${startPct}%`,
          right: `${100 - endPct}%`,
          top: 12,
          height: 4,
          background: "var(--accent-primary)",
          borderRadius: 2,
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={startValue}
        onChange={(e) => onChange({ startTick: Number(e.currentTarget.value) })}
        aria-label="Window start tick"
        className="composer-range-thumb"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          width: "100%",
          zIndex: startPct > 50 ? 4 : 3,
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={endValue}
        onChange={(e) => onChange({ endTick: Number(e.currentTarget.value) })}
        aria-label="Window end tick"
        className="composer-range-thumb"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          width: "100%",
          zIndex: endPct < 50 ? 4 : 3,
        }}
      />
    </div>
  );
}
