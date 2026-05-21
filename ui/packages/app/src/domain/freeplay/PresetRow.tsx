import { useEffect, useMemo, useState } from "react";
import { Button, Chip, Cluster, Mono, Stack } from "../../lib";
import { useSimStore } from "../../sim";
import { BUILT_IN_PRESETS } from "./presets";
import {
  loadUserPresets,
  newPresetId,
  saveUserPresets,
  type ComposerPreset,
} from "./presetSchema";

export function PresetRow() {
  const state = useSimStore();
  const [userPresets, setUserPresets] = useState<ComposerPreset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [namingOpen, setNamingOpen] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    setUserPresets(loadUserPresets());
  }, []);

  const allPresets = useMemo<ComposerPreset[]>(
    () => [...BUILT_IN_PRESETS, ...userPresets],
    [userPresets],
  );

  function apply(preset: ComposerPreset) {
    setActiveId(preset.id);
    state.loadComposerPreset(preset);
  }

  function save() {
    if (!name.trim()) return;
    const preset: ComposerPreset = {
      id: newPresetId(),
      name: name.trim(),
      attackIds: state.attackIds,
      attackSchedules: state.attackSchedules,
      flightPattern: state.flightPattern,
      pathPreset: state.pathPreset,
      pathWaypoints: state.pathWaypoints,
      mapPresetId: state.mapPresetId,
      beaconCount: state.beaconCount,
      beaconLayoutName: state.beaconLayoutName,
      beaconPositions: state.beaconPositions,
    };
    const next = [...userPresets, preset];
    setUserPresets(next);
    saveUserPresets(next);
    setActiveId(preset.id);
    setNamingOpen(false);
    setName("");
  }

  function remove(presetId: string) {
    const next = userPresets.filter((p) => p.id !== presetId);
    setUserPresets(next);
    saveUserPresets(next);
    if (activeId === presetId) setActiveId(null);
  }

  return (
    <Stack gap={2}>
      <Cluster gap={2} align="center" wrap>
        <Mono size="sm" muted className="t-label" style={{ flexShrink: 0 }}>
          Preset
        </Mono>
        {allPresets.map((p) => (
          <span
            key={p.id}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <Chip selected={activeId === p.id} onClick={() => apply(p)}>
              {p.name}
            </Chip>
            {p.builtIn ? null : (
              <button
                type="button"
                aria-label={`Delete preset ${p.name}`}
                onClick={() => remove(p.id)}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "var(--text-low)",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: "0 2px",
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <Chip selected={activeId === null} onClick={() => setActiveId(null)}>
          CUSTOM
        </Chip>
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => setNamingOpen((v) => !v)}>
          {namingOpen ? "CANCEL" : "SAVE PRESET"}
        </Button>
      </Cluster>
      {namingOpen ? (
        <Cluster gap={2} align="center">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="preset name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setNamingOpen(false);
            }}
            style={{
              flex: 1,
              maxWidth: 240,
              padding: "6px 10px",
              background: "rgba(0,0,0,0.30)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 4,
              color: "var(--text-hi)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          />
          <Button size="sm" variant="primary" onClick={save} disabled={!name.trim()}>
            SAVE
          </Button>
        </Cluster>
      ) : null}
    </Stack>
  );
}
