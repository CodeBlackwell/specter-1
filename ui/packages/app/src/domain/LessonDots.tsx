import { LESSONS, TRUNK_COLORS } from "../data/lessons";

type Props = {
  activeLessonId: string;
  onSelect: (id: string) => void;
};

const MONO_STACK =
  '"Courier New", "Courier Prime", Courier, ui-monospace, Menlo, monospace';

type Section = { label: string; ids: ReadonlyArray<string> };

const SECTIONS: ReadonlyArray<Section> = [
  { label: "Wire", ids: ["01"] },
  { label: "Trust math", ids: ["02", "03", "04", "05", "06", "07"] },
  { label: "Map", ids: ["08"] },
  { label: "SLAM stack", ids: ["09", "10", "11", "12", "14"] },
  { label: "Identity", ids: ["13"] },
];

export function LessonNameplates({ activeLessonId, onSelect }: Props) {
  const activeIdx = LESSONS.findIndex((l) => l.id === activeLessonId);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        rowGap: 8,
        columnGap: 14,
        padding: "var(--space-2) var(--space-3)",
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--surface-1)",
        alignItems: "stretch",
      }}
    >
      {SECTIONS.map((section) => {
        const items = section.ids
          .map((id) => LESSONS.find((l) => l.id === id))
          .filter((l): l is (typeof LESSONS)[number] => l !== undefined);
        if (items.length === 0) return null;
        const isActiveSection = items.some((l) => l.id === activeLessonId);
        return (
          <div
            key={section.label}
            style={{
              display: "inline-flex",
              flexDirection: "column",
              gap: 4,
              paddingLeft: 10,
              borderLeft: `1px solid ${
                isActiveSection ? "var(--accent-primary)" : "var(--border-subtle)"
              }`,
            }}
          >
            <span
              style={{
                fontFamily: MONO_STACK,
                fontSize: 11,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                color: isActiveSection
                  ? "var(--accent-primary)"
                  : "var(--text-mid)",
                fontWeight: 700,
              }}
            >
              {section.label}
            </span>
            <div style={{ display: "inline-flex", gap: 6 }}>
              {items.map((l) => {
                const isActive = l.id === activeLessonId;
                const completed =
                  LESSONS.findIndex((x) => x.id === l.id) < activeIdx;
                const trunk = TRUNK_COLORS[l.trunk];
                return (
                  <button
                    key={l.id}
                    onClick={() => onSelect(l.id)}
                    title={`${l.id} · ${l.title}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "baseline",
                      gap: 8,
                      padding: "5px 11px",
                      border: `1px solid ${isActive ? trunk : "var(--border-subtle)"}`,
                      borderLeft: `3px solid ${trunk}`,
                      borderRadius: 6,
                      background: isActive ? trunk : "var(--surface-0)",
                      color: isActive
                        ? "var(--surface-0)"
                        : completed
                          ? "var(--text-hi)"
                          : "var(--text-mid)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: MONO_STACK,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      transition:
                        "background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease",
                      transform: isActive ? "translateY(-1px)" : "none",
                      boxShadow: isActive
                        ? "0 2px 8px rgba(0,0,0,0.25)"
                        : "none",
                    }}
                  >
                    <span style={{ fontSize: 12, opacity: isActive ? 0.95 : 0.8, fontWeight: 700 }}>
                      {l.id}
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.2, letterSpacing: 0.3 }}>
                      {l.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const LessonDots = LessonNameplates;
