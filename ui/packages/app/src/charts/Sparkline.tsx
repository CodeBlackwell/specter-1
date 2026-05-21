type Props = {
  data: ReadonlyArray<number>;
  width?: number;
  height?: number;
  threshold?: number;
  detectionIndex?: number;
  cursorIndex?: number;
  yMin?: number;
  yMax?: number;
  barColor?: string;
  finalColor?: string;
  thresholdColor?: string;
  detectionColor?: string;
  cursorColor?: string;
  ariaLabel?: string;
};

export function Sparkline({
  data,
  width = 220,
  height = 36,
  threshold,
  detectionIndex,
  cursorIndex,
  yMin = 0,
  yMax = 1,
  barColor = "var(--border-strong)",
  finalColor = "var(--text-mid)",
  thresholdColor = "var(--status-flagged)",
  detectionColor = "var(--status-byzantine)",
  cursorColor = "var(--accent-primary)",
  ariaLabel,
}: Props) {
  if (data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel ?? "empty sparkline"}
      />
    );
  }

  const range = yMax - yMin || 1;
  const slot = width / data.length;
  const barWidth = Math.max(1, slot - 1);
  const toY = (v: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, v));
    return height - ((clamped - yMin) / range) * height;
  };
  const lastIndex = data.length - 1;
  const detectionX =
    detectionIndex != null && detectionIndex >= 0 && detectionIndex < data.length
      ? detectionIndex * slot + slot / 2
      : null;
  const cursorActive = cursorIndex != null && cursorIndex >= 0 && cursorIndex < data.length;
  const highlightIndex = cursorActive ? cursorIndex! : lastIndex;
  const cursorX = cursorActive ? cursorIndex! * slot + slot / 2 : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? `sparkline of ${data.length} samples`}
      style={{ display: "block" }}
    >
      {data.map((v, i) => {
        const y = toY(v);
        const x = i * slot;
        const isHighlight = i === highlightIndex;
        const isFuture = cursorActive && i > cursorIndex!;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={Math.max(1, height - y)}
            fill={isHighlight ? finalColor : barColor}
            fillOpacity={isFuture ? 0.25 : 1}
          />
        );
      })}
      {threshold != null ? (
        <line
          x1={0}
          x2={width}
          y1={toY(threshold)}
          y2={toY(threshold)}
          stroke={thresholdColor}
          strokeDasharray="3 3"
          strokeWidth={1}
        />
      ) : null}
      {detectionX != null ? (
        <line
          x1={detectionX}
          x2={detectionX}
          y1={0}
          y2={height}
          stroke={detectionColor}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      ) : null}
      {cursorX != null ? (
        <line
          x1={cursorX}
          x2={cursorX}
          y1={0}
          y2={height}
          stroke={cursorColor}
          strokeWidth={1}
          strokeOpacity={0.85}
        />
      ) : null}
    </svg>
  );
}
