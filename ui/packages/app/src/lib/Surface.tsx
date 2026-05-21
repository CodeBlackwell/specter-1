import type { HTMLAttributes } from "react";
import { gapVar, type GapStep } from "./types";

type Props = HTMLAttributes<HTMLDivElement> & {
  level?: 1 | 2 | 3;
  pad?: GapStep;
  bordered?: boolean;
  radius?: "sm" | "md" | "lg";
};

export function Surface({
  level = 1,
  pad,
  bordered = true,
  radius = "md",
  style,
  ...rest
}: Props) {
  return (
    <div
      {...rest}
      style={{
        background: `var(--surface-${level})`,
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        border: bordered ? "1px solid var(--border-subtle)" : "0",
        borderRadius: `var(--radius-${radius})`,
        boxShadow: "var(--glass-shadow), var(--glass-inset)",
        padding: pad ? gapVar(pad) : undefined,
        minWidth: 0,
        ...style,
      }}
    />
  );
}
