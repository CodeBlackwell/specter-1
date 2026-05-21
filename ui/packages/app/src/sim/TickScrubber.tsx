import { useMemo } from "react";
import { Button, Cluster, Mono, Stack } from "../lib";
import { useSimStore } from "./simStore";
import { LESSONS } from "../data/lessons";

type Annotation = {
  tick: number;
  label: string;
  tone: "danger" | "warn";
};

const EVENT_LABEL: Record<string, string> = {
  swap_key: "key rotated",
  replay_storm: "replay started",
  forged_envelope: "forged emitter",
};

export function TickScrubber() {
  const total = useSimStore((s) => s.result?.snapshots.length ?? 0);
  const tickIndex = useSimStore((s) => s.tickIndex);
  const isPlaying = useSimStore((s) => s.isPlaying);
  const lessonId = useSimStore((s) => s.lessonId);
  const autoAdvance = useSimStore((s) => s.autoAdvance);
  const attackStartTick = useSimStore((s) => s.spec?.attackStartTick ?? 0);
  const hasAttackers = useSimStore((s) => (s.spec?.attackers?.length ?? 0) > 0);
  const rejections = useSimStore((s) => s.rejections);
  const step = useSimStore((s) => s.step);
  const setTick = useSimStore((s) => s.setTick);
  const reset = useSimStore((s) => s.reset);
  const setPlaying = useSimStore((s) => s.setPlaying);
  const prevLesson = useSimStore((s) => s.prevLesson);
  const nextLesson = useSimStore((s) => s.nextLesson);
  const setAutoAdvance = useSimStore((s) => s.setAutoAdvance);

  const annotations = useMemo<Annotation[]>(() => {
    const out: Annotation[] = [];
    if (hasAttackers && attackStartTick > 0) {
      out.push({ tick: attackStartTick, label: "attack starts", tone: "danger" });
    }
    const seenKey = new Set<string>();
    for (const r of rejections) {
      const ev = r.causedByEvent;
      if (!ev) continue;
      if (ev.atTick === attackStartTick && ev.kind !== "swap_key" && ev.kind !== "replay_storm") {
        // Skip duplicates of the generic attack-start mark.
        continue;
      }
      const key = `${ev.kind}@${ev.atTick}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      out.push({
        tick: ev.atTick,
        label: EVENT_LABEL[ev.kind] ?? ev.kind,
        tone: ev.atTick === attackStartTick ? "danger" : "warn",
      });
    }
    return out;
  }, [hasAttackers, attackStartTick, rejections]);

  const lessonIdx = LESSONS.findIndex((l) => l.id === lessonId);
  const canPrev = lessonIdx > 0;
  const canNext = lessonIdx >= 0 && lessonIdx < LESSONS.length - 1;
  const displayTick = total === 0 ? 0 : tickIndex + 1;
  const denom = total || 1;

  return (
    <Stack gap={2}>
      <Cluster gap={3} align="center">
        <Button size="sm" variant="ghost" onClick={prevLesson} disabled={!canPrev}>
          ◂◂ Prev
        </Button>
        <Button
          variant={isPlaying ? "danger" : "primary"}
          size="sm"
          onClick={() => setPlaying(!isPlaying)}
          disabled={total === 0}
        >
          {isPlaying ? "Pause" : "Run"}
        </Button>
        <Button size="sm" onClick={() => step(1)} disabled={total === 0}>
          Step ▸
        </Button>
        <Button size="sm" variant="ghost" onClick={() => step(-1)} disabled={tickIndex <= 0}>
          ◂ Back
        </Button>
        <Button size="sm" variant="ghost" onClick={reset} disabled={total === 0}>
          Reset
        </Button>
        <Button size="sm" variant="ghost" onClick={nextLesson} disabled={!canNext}>
          Next ▸▸
        </Button>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-mid)",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => setAutoAdvance(e.target.checked)}
          />
          auto-advance
        </label>
        <Mono size="md" muted>
          tick
        </Mono>
        <Mono size="md">
          {String(displayTick).padStart(4, "0")} / {String(denom).padStart(4, "0")}
        </Mono>
      </Cluster>
      <div style={{ position: "relative", width: "100%" }}>
        <input
          type="range"
          min={0}
          max={Math.max(total - 1, 0)}
          value={tickIndex}
          onChange={(e) => setTick(Number(e.target.value))}
          disabled={total === 0}
          style={{
            width: "100%",
            accentColor: "var(--accent-primary)",
            display: "block",
          }}
        />
        {total > 1
          ? annotations.map((a, i) => {
              const x = (Math.min(a.tick - 1, total - 1) / (total - 1)) * 100;
              const color = a.tone === "danger" ? "var(--status-byzantine)" : "var(--accent-warn)";
              return (
                <div
                  key={`anno-${i}-${a.tick}-${a.label}`}
                  style={{
                    position: "absolute",
                    left: `${x}%`,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: color,
                    opacity: 0.85,
                    pointerEvents: "none",
                    transform: "translateX(-1px)",
                  }}
                  title={`${a.label} @ tick ${a.tick}`}
                />
              );
            })
          : null}
      </div>
    </Stack>
  );
}
