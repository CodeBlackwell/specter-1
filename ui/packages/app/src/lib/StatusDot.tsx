import type { HTMLAttributes } from "react";

type Status = "nominal" | "flagged" | "byzantine" | "neutral";

type Props = HTMLAttributes<HTMLSpanElement> & {
  status: Status;
  size?: number;
};

const colorVar: Record<Status, string> = {
  nominal: "var(--status-nominal)",
  flagged: "var(--status-flagged)",
  byzantine: "var(--status-byzantine)",
  neutral: "var(--text-low)",
};

export function StatusDot({ status, size = 8, style, ...rest }: Props) {
  return (
    <span
      role="presentation"
      {...rest}
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-pill)",
        background: colorVar[status],
        display: "inline-block",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
