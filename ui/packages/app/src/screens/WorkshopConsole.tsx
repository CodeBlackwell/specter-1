import { useEffect, useState } from "react";
import { type AttackEntry } from "../data/scenarios";
import { LESSONS } from "../data/lessons";
import { layoutFor } from "../data/lessonLayouts";
import { Mono, Stack, Surface, useIsMobile } from "../lib";
import { TopBar } from "../domain/TopBar";
import { CurriculumRail } from "../domain/CurriculumRail";
import { AttackDock } from "../domain/AttackDock";
import { Composer } from "../domain/freeplay/Composer";
import { LessonDots } from "../domain/LessonDots";
import { LessonAdvanceOverlay } from "../domain/LessonAdvanceOverlay";
import { PlayerOverlay } from "../domain/PlayerOverlay";
import { KeyInCodePanel } from "../domain/KeyInCodePanel";
import { WelcomeToast } from "../domain/WelcomeToast";
import { MobileUnavailable } from "../domain/MobileUnavailable";
import { TrustPanel } from "../domain/TrustPanel";
import { SlamMetricsPanel } from "../domain/SlamMetricsPanel";
import {
  AgentRepList,
  ClosedLoopSlamCanvas,
  CooperativeSlamCanvas,
  SlamCanvas,
  SwarmCanvas,
  TickScrubber,
  useContactReports,
  useCoverageGrid,
  useCurrentSnapshot,
  useDetectionMap,
  useMapAttacks,
  usePhantomWitnesses,
  useRejections,
  useSimStore,
  useTickLoop,
} from "../sim";
import { SceneBriefing } from "../domain/SceneBriefing";
import { RightPanel } from "../domain/RightPanel";
import { AgentDetailsPanel } from "../domain/AgentDetailsPanel";
import { Research } from "./Research";
import { Coursework } from "./Coursework";

const DEFAULT_LESSON = "01";
const DEFAULT_ATTACK = "honest";

export function WorkshopConsole() {
  const mode = useSimStore((s) => s.mode);
  const lessonId = useSimStore((s) => s.lessonId);
  const attackIds = useSimStore((s) => s.attackIds);
  const selectLesson = useSimStore((s) => s.selectLesson);
  const nextLesson = useSimStore((s) => s.nextLesson);
  const prevLesson = useSimStore((s) => s.prevLesson);
  const toggleAttack = useSimStore((s) => s.toggleAttack);
  const setPlaying = useSimStore((s) => s.setPlaying);
  const step = useSimStore((s) => s.step);
  const isPlaying = useSimStore((s) => s.isPlaying);
  const autoAdvance = useSimStore((s) => s.autoAdvance);
  const endedDuringPlayback = useSimStore((s) => s.endedDuringPlayback);
  const clearEndedFlag = useSimStore((s) => s.clearEndedFlag);
  const attackStartTick = useSimStore((s) => s.spec?.attackStartTick ?? 0);
  const snapshot = useCurrentSnapshot();
  const detectionMap = useDetectionMap();
  const coverageGrid = useCoverageGrid();
  const mapAttacks = useMapAttacks();
  const contactReports = useContactReports();
  const phantomWitnesses = usePhantomWitnesses();
  const rejections = useRejections();
  const [advanceTo, setAdvanceTo] = useState<{ id: string; title: string } | null>(null);
  const isMobile = useIsMobile();
  const welcomeDismissed = useSimStore((s) => s.welcomeDismissed);
  useTickLoop();

  useEffect(() => {
    if (lessonId === null && welcomeDismissed) selectLesson(DEFAULT_LESSON);
  }, [lessonId, selectLesson, welcomeDismissed]);

  const prefetchLessons = useSimStore((s) => s.prefetchLessons);
  const loadingProgress = useSimStore((s) => s.loadingProgress);
  useEffect(() => {
    if (loadingProgress < 1 || lessonId === null) return;
    const idx = LESSONS.findIndex((l) => l.id === lessonId);
    if (idx < 0) return;
    const order: string[] = [];
    for (let offset = 1; offset < LESSONS.length; offset++) {
      const after = LESSONS[idx + offset];
      const before = LESSONS[idx - offset];
      if (after) order.push(after.id);
      if (before) order.push(before.id);
    }
    const idle = (window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
    }).requestIdleCallback;
    const fire = () => prefetchLessons(order);
    if (idle) {
      const handle = idle(fire);
      return () => {
        (window as Window & { cancelIdleCallback?: (h: number) => void })
          .cancelIdleCallback?.(handle);
      };
    }
    const handle = setTimeout(fire, 0);
    return () => clearTimeout(handle);
  }, [loadingProgress, lessonId, prefetchLessons]);

  useEffect(() => {
    if (!endedDuringPlayback) return;
    const idx = LESSONS.findIndex((l) => l.id === lessonId);
    if (idx < 0 || idx >= LESSONS.length - 1) {
      clearEndedFlag();
      return;
    }
    if (mode === "workshop") {
      const next = LESSONS[idx + 1]!;
      setAdvanceTo({ id: next.id, title: next.title });
      return;
    }
    if (autoAdvance) {
      clearEndedFlag();
      nextLesson();
    }
  }, [endedDuringPlayback, autoAdvance, mode, lessonId, nextLesson, clearEndedFlag]);

  useEffect(() => {
    setAdvanceTo(null);
  }, [lessonId, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (advanceTo) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying(!isPlaying);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        nextLesson();
      } else if (e.key === "[") {
        e.preventDefault();
        prevLesson();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advanceTo, isPlaying, setPlaying, step, nextLesson, prevLesson]);

  const handleAttack = (entry: AttackEntry) => toggleAttack(entry.id);
  const activeAttackForBriefing = attackIds[attackIds.length - 1] ?? null;
  const activeLesson = lessonId ?? DEFAULT_LESSON;
  const lessonChip = `${activeLesson} ${lessonTitleShort(activeLesson)}`;
  const layout = layoutFor(activeLesson);
  const isSlamLesson = LESSONS.find((l) => l.id === activeLesson)?.trunk === "slam";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>
      <TopBar lessonChip={lessonChip} />
      {mode === "workshop" && !isMobile ? (
        <LessonDots activeLessonId={activeLesson} onSelect={selectLesson} />
      ) : null}
      {mode === "research" ? (
        <Research />
      ) : mode === "coursework" ? (
        <Coursework />
      ) : isMobile && (mode === "workshop" || mode === "freeplay") ? (
        <MobileUnavailable mode={mode} />
      ) : mode === "workshop" ? (
        <WorkshopLayout
          activeLesson={activeLesson}
          activeAttackForBriefing={activeAttackForBriefing}
          attackStartTick={attackStartTick}
          snapshot={snapshot}
          detectionMap={detectionMap}
          coverageGrid={coverageGrid}
          mapAttacks={mapAttacks}
          contactReports={contactReports}
          phantomWitnesses={phantomWitnesses}
          rejections={rejections}
          showRepStrip={layout.showRepStrip}
          showTrustPanel={layout.trustTiers !== "none"}
          isSlamLesson={isSlamLesson}
          onSelectLesson={selectLesson}
        />
      ) : (
        <FreePlayLayout
          activeLesson={activeLesson}
          activeAttackForBriefing={activeAttackForBriefing}
          attackIds={attackIds}
          attackStartTick={attackStartTick}
          snapshot={snapshot}
          detectionMap={detectionMap}
          coverageGrid={coverageGrid}
          mapAttacks={mapAttacks}
          contactReports={contactReports}
          phantomWitnesses={phantomWitnesses}
          rejections={rejections}
          isSlamLesson={isSlamLesson}
          onSelectLesson={selectLesson}
          onToggleAttack={handleAttack}
        />
      )}
      {advanceTo ? (
        <LessonAdvanceOverlay
          nextId={advanceTo.id}
          nextTitle={advanceTo.title}
          onContinue={() => {
            setAdvanceTo(null);
            clearEndedFlag();
            nextLesson();
          }}
          onCancel={() => {
            setAdvanceTo(null);
            clearEndedFlag();
          }}
        />
      ) : null}
      <WelcomeToast />
    </div>
  );
}

type SharedSimProps = {
  activeLesson: string;
  activeAttackForBriefing: string | null;
  attackStartTick: number;
  snapshot: ReturnType<typeof useCurrentSnapshot>;
  detectionMap: ReturnType<typeof useDetectionMap>;
  coverageGrid: ReturnType<typeof useCoverageGrid>;
  mapAttacks: ReturnType<typeof useMapAttacks>;
  contactReports: ReturnType<typeof useContactReports>;
  phantomWitnesses: ReturnType<typeof usePhantomWitnesses>;
  rejections: ReturnType<typeof useRejections>;
  onSelectLesson: (id: string) => void;
};

function WorkshopLayout({
  activeLesson,
  activeAttackForBriefing,
  attackStartTick,
  snapshot,
  detectionMap,
  coverageGrid,
  mapAttacks,
  contactReports,
  phantomWitnesses,
  rejections,
  showRepStrip,
  showTrustPanel,
  isSlamLesson,
  onSelectLesson,
}: SharedSimProps & {
  showRepStrip: boolean;
  showTrustPanel: boolean;
  isSlamLesson: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        gap: "var(--space-3)",
        padding: "var(--space-3)",
      }}
    >
      <Surface
        level={1}
        pad={3}
        style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", position: "relative" }}
      >
        {activeLesson === "09" ? (
          <SlamCanvas />
        ) : activeLesson === "10" ? (
          <CooperativeSlamCanvas scenario="honest" />
        ) : activeLesson === "11" ? (
          <CooperativeSlamCanvas scenario="pose_lie_naive" />
        ) : activeLesson === "12" || activeLesson === "14" ? (
          <ClosedLoopSlamCanvas />
        ) : (
          <SwarmCanvas
            snapshot={snapshot}
            detectionMap={detectionMap}
            coverageGrid={coverageGrid}
            mapAttacks={mapAttacks}
            contactReports={contactReports}
            phantomWitnesses={phantomWitnesses}
            rejections={rejections}
            showRangeCircles
          />
        )}
        <PlayerOverlay />
      </Surface>
      <div
        style={{
          flex: "0 0 360px",
          minWidth: 320,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {isSlamLesson ? null : <AgentDetailsPanel snapshot={snapshot} />}
        <SceneBriefing
          snapshot={snapshot}
          lessonId={activeLesson}
          attackId={activeAttackForBriefing}
          attackStartTick={attackStartTick}
        />
        <KeyInCodePanel lessonId={activeLesson} />
        {isSlamLesson ? (
          <SlamMetricsPanel snapshot={snapshot} />
        ) : (
          <>
            {showRepStrip ? (
              <Surface level={1} pad={2}>
                <Stack gap={2}>
                  <Mono size="sm" muted className="t-label">
                    Reputations · this tick
                  </Mono>
                  <AgentRepList snapshot={snapshot} layout="vertical" />
                </Stack>
              </Surface>
            ) : null}
            {showTrustPanel ? <TrustPanel snapshot={snapshot} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function FreePlayLayout({
  snapshot,
  detectionMap,
  coverageGrid,
  mapAttacks,
  contactReports,
  rejections,
}: SharedSimProps & {
  attackIds: ReadonlyArray<string>;
  onToggleAttack: (entry: AttackEntry) => void;
  isSlamLesson: boolean;
}) {
  const isRunning = useSimStore((s) => s.isRunning);
  if (!isRunning) {
    return <Composer />;
  }
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        gap: "var(--space-3)",
        padding: "var(--space-3)",
      }}
    >
      <Stack gap={2} grow style={{ minWidth: 0 }}>
        <Surface level={1} pad={3} style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <SwarmCanvas
            snapshot={snapshot}
            detectionMap={detectionMap}
            coverageGrid={coverageGrid}
            mapAttacks={mapAttacks}
            contactReports={contactReports}
            rejections={rejections}
            showRangeCircles
          />
        </Surface>
        <Surface level={1} pad={2}>
          <TickScrubber />
        </Surface>
      </Stack>
      <div style={{ flex: "0 0 360px", minWidth: 320, minHeight: 0, display: "flex" }}>
        <TrustPanel snapshot={snapshot} />
      </div>
    </div>
  );
}

function lessonTitleShort(id: string): string {
  const map: Record<string, string> = {
    "01": "WIRE BOUNDARY",
    "02": "BETA + RECOVERY",
    "03": "TIER 2 COLLUDERS",
    "04": "SENSOR FAULTS",
    "05": "MID-MISSION FLIP",
    "06": "PARTITION + GOSSIP",
    "07": "SYBIL PRESENCE",
    "08": "MAP CORRUPTION",
    "09": "SLAM 101",
    "10": "COOP SLAM",
    "11": "BYZ SLAM",
    "12": "TRUST PRIOR",
    "13": "ROSTER GUARD",
    "14": "SINGLETON LIE",
  };
  return map[id] ?? "";
}
