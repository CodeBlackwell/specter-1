import type { HTMLAttributes } from "react";

type Tone = "neutral" | "nominal" | "flagged" | "byzantine" | "accent";

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
};

export function Pill({ tone = "neutral", className, ...rest }: Props) {
  const cls = ["pill", tone !== "neutral" && `pill--${tone}`, className]
    .filter(Boolean)
    .join(" ");
  return <span className={cls} {...rest} />;
}
