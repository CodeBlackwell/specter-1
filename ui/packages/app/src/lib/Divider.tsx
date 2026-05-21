import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  orientation?: "horizontal" | "vertical";
};

export function Divider({ orientation = "horizontal", style, ...rest }: Props) {
  const isH = orientation === "horizontal";
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      {...rest}
      style={{
        background: "var(--border-subtle)",
        width: isH ? "100%" : 1,
        height: isH ? 1 : "100%",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
