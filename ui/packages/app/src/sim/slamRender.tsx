import type { ReactNode } from "react";

/** Shared SVG vocabulary for SLAM canvases — sized to read like SwarmCanvas
 * drones within the SLAM scenes' tighter viewBoxes. The viewBox is fixed at
 * 8m × 8m (cooperative) / 8m × 4m (single-agent) so these constants land at
 * the same on-screen proportions as `SwarmCanvas`'s DRONE_R/LABEL_FONT in
 * the AO_WORLD viewBox. */
export const AGENT_R = 0.45;
export const LM_R = 0.32;
export const STROKE = 0.08;
export const HEADING_LEN = 0.75;
export const LABEL_FONT = 0.55;
export const SCENE_BOUNDS_COOP = { minX: -2, maxX: 6, minY: -2, maxY: 6 } as const;
export const SCENE_BOUNDS_L09 = { minX: -2, maxX: 6, minY: -2, maxY: 4 } as const;

type SceneBoundsProp = { minX: number; maxX: number; minY: number; maxY: number };

/** Renders the SLAM scene background — sector grid + flipped-y group, so the
 * canvas reads with mathematical y-up while SVG y-down is internal. */
export function SlamSceneBackground({
  children,
  bounds = SCENE_BOUNDS_COOP,
}: {
  children: ReactNode;
  bounds?: SceneBoundsProp;
}) {
  const vbW = bounds.maxX - bounds.minX;
  const vbH = bounds.maxY - bounds.minY;
  return (
    <svg
      viewBox={`${bounds.minX} ${bounds.minY} ${vbW} ${vbH}`}
      style={{ width: "100%", height: "100%", background: "var(--surface-1)" }}
      preserveAspectRatio="xMidYMid meet"
    >
      <g transform={`translate(0 ${bounds.minY + bounds.maxY}) scale(1 -1)`}>
        <SectorGrid bounds={bounds} />
        {children}
      </g>
    </svg>
  );
}

function SectorGrid({ bounds }: { bounds: SceneBoundsProp }) {
  const step = 1;
  const lines: ReactNode[] = [];
  for (let x = Math.ceil(bounds.minX); x <= bounds.maxX; x += step) {
    lines.push(
      <line
        key={`gx-${x}`}
        x1={x}
        y1={bounds.minY}
        x2={x}
        y2={bounds.maxY}
        stroke="var(--border-subtle)"
        strokeWidth={0.025}
        strokeOpacity={0.4}
      />,
    );
  }
  for (let y = Math.ceil(bounds.minY); y <= bounds.maxY; y += step) {
    lines.push(
      <line
        key={`gy-${y}`}
        x1={bounds.minX}
        y1={y}
        x2={bounds.maxX}
        y2={y}
        stroke="var(--border-subtle)"
        strokeWidth={0.025}
        strokeOpacity={0.4}
      />,
    );
  }
  return <g>{lines}</g>;
}
