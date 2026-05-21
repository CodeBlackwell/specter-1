import { ATTACK_CATALOG, FAMILY_COLOR, type AttackEntry } from "../data/scenarios";
import { Chip, Cluster, Mono, Stack, Surface } from "../lib";
import { useSimStore } from "../sim";

type Props = {
  activeIds: ReadonlyArray<string>;
  onToggle: (entry: AttackEntry) => void;
};

const MIN_START_TICK = 0;
const MAX_START_TICK = 500;

export function AttackDock({ activeIds, onToggle }: Props) {
  const attackStartTick = useSimStore((s) => s.spec?.attackStartTick ?? 0);
  const setAttackStartTick = useSimStore((s) => s.setAttackStartTick);
  const activeSet = new Set(activeIds);
  const anyAttackLayer = ATTACK_CATALOG.some(
    (a) => activeSet.has(a.id) && a.family !== "trust-noop",
  );
  const composedCount = activeIds.filter((id) => id !== "honest").length;
  return (
    <Surface level={1} pad={2}>
      <Stack gap={2}>
        <Cluster gap={2} align="center" wrap>
          <Mono size="sm" muted className="t-label" style={{ flexShrink: 0 }}>
            Attacks {composedCount > 1 ? `(${composedCount} active)` : ""}
          </Mono>
          {ATTACK_CATALOG.map((a) => (
            <Chip
              key={a.id}
              selected={activeSet.has(a.id)}
              swatch={FAMILY_COLOR[a.family]}
              onClick={() => onToggle(a)}
              title={a.description}
            >
              {a.label}
            </Chip>
          ))}
        </Cluster>
        <Cluster gap={2} align="center">
          <Mono size="sm" muted className="t-label" style={{ flexShrink: 0 }}>
            Attack tick
          </Mono>
          <input
            type="range"
            min={MIN_START_TICK}
            max={MAX_START_TICK}
            step={5}
            value={attackStartTick}
            onChange={(e) => setAttackStartTick(Number(e.currentTarget.value))}
            disabled={!anyAttackLayer}
            style={{ flex: 1, minWidth: 160, opacity: anyAttackLayer ? 1 : 0.4 }}
          />
          <Mono size="sm" style={{ width: 56, textAlign: "right" }}>
            t={String(attackStartTick).padStart(3, "0")}
          </Mono>
        </Cluster>
      </Stack>
    </Surface>
  );
}
