export type BriefingProminence = "xl" | "l" | "m" | "s";
export type TrustTiers = "none" | "t1" | "t2" | "both";

export type LessonLayout = {
  showRepStrip: boolean;
  trustTiers: TrustTiers;
  briefingProminence: BriefingProminence;
};

export const LESSON_LAYOUTS: Record<string, LessonLayout> = {
  "01": { showRepStrip: false, trustTiers: "none", briefingProminence: "xl" },
  "02": { showRepStrip: true,  trustTiers: "t1",   briefingProminence: "l"  },
  "03": { showRepStrip: true,  trustTiers: "t2",   briefingProminence: "m"  },
  "04": { showRepStrip: true,  trustTiers: "t1",   briefingProminence: "m"  },
  "05": { showRepStrip: true,  trustTiers: "t1",   briefingProminence: "m"  },
  "06": { showRepStrip: true,  trustTiers: "t1",   briefingProminence: "l"  },
  "07": { showRepStrip: true,  trustTiers: "t1",   briefingProminence: "l"  },
  "08": { showRepStrip: true,  trustTiers: "both", briefingProminence: "m"  },
  // SLAM lessons (ADR 0019): right rail is swapped to SlamMetricsPanel in
  // WorkshopLayout/RightPanel — trustTiers/showRepStrip are not consulted on
  // these lessons, but kept for completeness.
  "09": { showRepStrip: false, trustTiers: "none", briefingProminence: "l"  },
  "10": { showRepStrip: false, trustTiers: "none", briefingProminence: "l"  },
  "11": { showRepStrip: false, trustTiers: "none", briefingProminence: "l"  },
  "12": { showRepStrip: false, trustTiers: "none", briefingProminence: "l"  },
  // Wave 4 — identity-lifecycle rail (Coverage Parity PRD). Wire layer is
  // the only attack surface; no trust-tier movement to show.
  "13": { showRepStrip: false, trustTiers: "none", briefingProminence: "xl" },
  // ADR 0022 — singleton-trusted-window lie. SLAM trunk; SlamMetricsPanel
  // owns the right rail. Briefing carries the conceptual weight because the
  // defense (per-factor information cap) isn't visible at landmark-position
  // resolution.
  "14": { showRepStrip: false, trustTiers: "none", briefingProminence: "l"  },
};

export function layoutFor(lessonId: string): LessonLayout {
  return LESSON_LAYOUTS[lessonId] ?? LESSON_LAYOUTS["08"]!;
}
