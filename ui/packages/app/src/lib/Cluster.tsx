import type { CSSProperties, HTMLAttributes } from "react";
import { gapVar, type GapStep } from "./types";

type Props = HTMLAttributes<HTMLDivElement> & {
  gap?: GapStep;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
  grow?: boolean;
};

export function Cluster({
  gap = 2,
  align = "center",
  justify,
  wrap,
  grow,
  style,
  ...rest
}: Props) {
  return (
    <div
      {...rest}
      style={{
        display: "flex",
        flexDirection: "row",
        gap: gapVar(gap),
        alignItems: align,
        justifyContent: justify,
        flexWrap: wrap ? "wrap" : "nowrap",
        minWidth: 0,
        flex: grow ? "1 1 auto" : undefined,
        ...style,
      }}
    />
  );
}
