import type { CSSProperties, HTMLAttributes } from "react";
import { gapVar, type GapStep } from "./types";

type Props = HTMLAttributes<HTMLDivElement> & {
  gap?: GapStep;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  grow?: boolean;
};

export function Stack({ gap = 3, align, justify, grow, style, ...rest }: Props) {
  return (
    <div
      {...rest}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: gapVar(gap),
        alignItems: align,
        justifyContent: justify,
        minHeight: 0,
        flex: grow ? "1 1 auto" : undefined,
        ...style,
      }}
    />
  );
}
