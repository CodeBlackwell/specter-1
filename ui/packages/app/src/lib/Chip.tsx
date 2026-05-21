import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  swatch?: string;
};

export function Chip({
  selected = false,
  swatch,
  children,
  className,
  type = "button",
  ...rest
}: Props) {
  const cls = ["chip", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} aria-pressed={selected} {...rest}>
      {swatch ? <span className="chip__swatch" style={{ background: swatch }} /> : null}
      {children}
    </button>
  );
}
