import { LESSONS, TRUNK_COLORS, type Lesson } from "../data/lessons";
import { Cluster, Mono, Stack, StatusDot, Surface } from "../lib";

type Props = {
  activeLessonId: string;
  onSelect: (id: string) => void;
};

export function CurriculumRail({ activeLessonId, onSelect }: Props) {
  const activeIdx = LESSONS.findIndex((l) => l.id === activeLessonId);
  const positionLabel = activeIdx >= 0
    ? `${String(activeIdx + 1).padStart(2, "0")}/${String(LESSONS.length).padStart(2, "0")}`
    : `--/${String(LESSONS.length).padStart(2, "0")}`;
  return (
    <Surface
      level={1}
      pad={4}
      style={{
        flex: "0 0 220px",
        minWidth: 200,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Stack gap={3} style={{ height: "100%", minHeight: 0 }}>
        <Cluster gap={2} justify="space-between" style={{ flexShrink: 0 }}>
          <Mono size="sm" muted className="t-label">
            Curriculum
          </Mono>
          <Mono size="sm" muted>
            {positionLabel}
          </Mono>
        </Cluster>
        <Stack gap={1} style={{ overflowY: "auto", minHeight: 0 }}>
          {LESSONS.map((l) => (
            <LessonRow
              key={l.id}
              lesson={l}
              active={l.id === activeLessonId}
              onClick={() => onSelect(l.id)}
            />
          ))}
        </Stack>
      </Stack>
    </Surface>
  );
}

function LessonRow({
  lesson,
  active,
  onClick,
}: {
  lesson: Lesson;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        padding: "var(--space-2)",
        borderRadius: "var(--radius-md)",
        background: active ? "var(--surface-2)" : "transparent",
        border: active ? "1px solid var(--border-strong)" : "1px solid transparent",
      }}
    >
      <Cluster gap={2} align="center">
        <span
          style={{
            width: 3,
            height: 22,
            background: TRUNK_COLORS[lesson.trunk],
            borderRadius: 2,
            flexShrink: 0,
          }}
        />
        <Mono size="sm" muted style={{ width: 24 }}>
          {lesson.id}
        </Mono>
        <Stack gap={1} grow style={{ minWidth: 0 }}>
          <span className="t-h3" style={{ color: active ? "var(--text-hi)" : "var(--text-mid)" }}>
            {lesson.title}
          </span>
          <Mono size="sm" muted style={{ fontSize: 11.5, lineHeight: "15px" }}>
            {lesson.blurb}
          </Mono>
        </Stack>
        <StatusDot status={lesson.index === 1 ? "nominal" : "neutral"} size={6} />
      </Cluster>
    </button>
  );
}
