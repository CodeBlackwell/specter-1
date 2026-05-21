import type { HTMLAttributes } from "react";

type Size = "sm" | "md" | "lg" | "code";

type Props = HTMLAttributes<HTMLSpanElement> & {
  size?: Size;
  muted?: boolean;
};

const sizeClass: Record<Size, string> = {
  sm: "t-numSm",
  md: "t-numMd",
  lg: "t-numLg",
  code: "t-code",
};

export function Mono({ size = "md", muted, className, style, ...rest }: Props) {
  const cls = [sizeClass[size], className].filter(Boolean).join(" ");
  return (
    <span
      className={cls}
      style={{ color: muted ? "var(--text-mid)" : undefined, ...style }}
      {...rest}
    />
  );
}
