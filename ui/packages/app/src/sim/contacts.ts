import { type DetectionMap } from "./detection";
import { type Item } from "./world";

export type PhantomContact = {
  id: string;
  x: number;
  y: number;
  label: string;
};

export type MapAttack = {
  reporterId: string;
  phantomContacts: ReadonlyArray<PhantomContact>;
  suppressedItemIds: ReadonlyArray<string>;
};

export type ContactReport = {
  reporterId: string;
  contactId: string;
  kind: "real" | "phantom";
  x: number;
  y: number;
  firstReportedTick: number;
};

export type CopEntry = {
  contactId: string;
  kind: "real" | "phantom";
  x: number;
  y: number;
  reporters: ReadonlyArray<string>;
  trustWeight: number;
  surviving: boolean;
};

export function computeContactReports(
  detectionMap: DetectionMap,
  items: ReadonlyArray<Item>,
  mapAttacks: ReadonlyArray<MapAttack>,
  attackStartTick: number,
): ContactReport[] {
  const suppressKey = new Set<string>();
  for (const m of mapAttacks) {
    for (const id of m.suppressedItemIds) suppressKey.add(`${m.reporterId}|${id}`);
  }
  const reports: ContactReport[] = [];
  for (const item of items) {
    const seen = detectionMap[item.id] ?? {};
    for (const droneId of Object.keys(seen)) {
      const firstTick = seen[droneId]!;
      if (suppressKey.has(`${droneId}|${item.id}`)) continue;
      const c = centerOf(item);
      reports.push({
        reporterId: droneId,
        contactId: item.id,
        kind: "real",
        x: c.x,
        y: c.y,
        firstReportedTick: firstTick,
      });
    }
  }
  for (const m of mapAttacks) {
    for (const phantom of m.phantomContacts) {
      reports.push({
        reporterId: m.reporterId,
        contactId: phantom.id,
        kind: "phantom",
        x: phantom.x,
        y: phantom.y,
        firstReportedTick: attackStartTick,
      });
    }
  }
  return reports;
}

export const COP_TRUST_THRESHOLD = 0.5;

export function copView(
  reports: ReadonlyArray<ContactReport>,
  currentTick: number,
  reps: Record<string, number>,
): CopEntry[] {
  const grouped = new Map<string, { kind: "real" | "phantom"; x: number; y: number; reporters: string[] }>();
  for (const r of reports) {
    if (r.firstReportedTick > currentTick) continue;
    const g = grouped.get(r.contactId);
    if (g) {
      g.reporters.push(r.reporterId);
    } else {
      grouped.set(r.contactId, { kind: r.kind, x: r.x, y: r.y, reporters: [r.reporterId] });
    }
  }
  const out: CopEntry[] = [];
  for (const [contactId, g] of grouped) {
    let trustWeight = 0;
    for (const reporter of g.reporters) {
      trustWeight += reps[reporter] ?? 0.5;
    }
    out.push({
      contactId,
      kind: g.kind,
      x: g.x,
      y: g.y,
      reporters: g.reporters,
      trustWeight,
      surviving: trustWeight >= COP_TRUST_THRESHOLD,
    });
  }
  return out;
}

function centerOf(item: Item): { x: number; y: number } {
  if (item.kind === "uxo" || item.kind === "vehicle") return { x: item.x, y: item.y };
  return { x: item.x + item.w / 2, y: item.y + item.h / 2 };
}
