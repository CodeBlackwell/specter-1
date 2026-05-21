import { useRef, useState } from "react";
import {
  MAP_PRESETS,
  beaconLayout,
  defaultPathFor,
  freehand,
  mapBounds,
  type Path,
} from "@specter/sim-core";
import { Chip, Cluster, Mono, Stack, Surface } from "../../lib";
import { useSimStore } from "../../sim";

const SVG_W = 360;
const SVG_H = 360;
const SVG_PAD = 16;
const HIT_RADIUS_M = 4;

type Tool = "MOVE" | "BEACON" | "WAYPOINT" | "ERASE";

const TOOLS: ReadonlyArray<{ id: Tool; label: string }> = [
  { id: "MOVE", label: "MOVE" },
  { id: "BEACON", label: "+BEACON" },
  { id: "WAYPOINT", label: "+WAYPOINT" },
  { id: "ERASE", label: "ERASE" },
];

export function MapEditor() {
  const mapPresetId = useSimStore((s) => s.mapPresetId);
  const beaconCount = useSimStore((s) => s.beaconCount);
  const beaconLayoutName = useSimStore((s) => s.beaconLayoutName);
  const beaconPositions = useSimStore((s) => s.beaconPositions);
  const setBeaconPositions = useSimStore((s) => s.setBeaconPositions);
  const flightPattern = useSimStore((s) => s.flightPattern);
  const pathPreset = useSimStore((s) => s.pathPreset);
  const pathWaypoints = useSimStore((s) => s.pathWaypoints);
  const setPathPreset = useSimStore((s) => s.setPathPreset);
  const setPathWaypoints = useSimStore((s) => s.setPathWaypoints);
  const mapTool = useSimStore((s) => s.mapTool);
  const setMapTool = useSimStore((s) => s.setMapTool);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const preset = MAP_PRESETS.find((p) => p.id === mapPresetId) ?? MAP_PRESETS[0]!;
  const bounds = mapBounds(preset);
  const effectiveBeacons: ReadonlyArray<[number, number]> =
    beaconPositions ??
    (beaconLayoutName === "custom"
      ? beaconLayout(preset.defaultBeaconLayout, preset.sizeM, beaconCount)
      : beaconLayout(beaconLayoutName, preset.sizeM, beaconCount));

  let path: Path | null = null;
  if (flightPattern === null) {
    if (pathWaypoints && pathWaypoints.length > 0) {
      path = freehand(pathWaypoints);
    } else if (pathPreset && pathPreset !== "FREEHAND") {
      path = defaultPathFor(pathPreset, {
        minX: bounds.xmin,
        minY: bounds.ymin,
        maxX: bounds.xmax,
        maxY: bounds.ymax,
      });
    }
  }

  const sx = (x: number) =>
    SVG_PAD + ((x - bounds.xmin) / (bounds.xmax - bounds.xmin)) * (SVG_W - 2 * SVG_PAD);
  const sy = (y: number) =>
    SVG_PAD + (1 - (y - bounds.ymin) / (bounds.ymax - bounds.ymin)) * (SVG_H - 2 * SVG_PAD);
  const inverseX = (px: number) =>
    bounds.xmin + ((px - SVG_PAD) / (SVG_W - 2 * SVG_PAD)) * (bounds.xmax - bounds.xmin);
  const inverseY = (py: number) =>
    bounds.ymax - ((py - SVG_PAD) / (SVG_H - 2 * SVG_PAD)) * (bounds.ymax - bounds.ymin);

  function svgPoint(e: React.PointerEvent<SVGSVGElement>): [number, number] | null {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = SVG_W / rect.width;
    const scaleY = SVG_H / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    return [inverseX(px), inverseY(py)];
  }

  function nearestBeaconIndex(pt: [number, number]): number | null {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < effectiveBeacons.length; i++) {
      const [bx, by] = effectiveBeacons[i]!;
      const d = Math.hypot(bx - pt[0], by - pt[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD <= HIT_RADIUS_M ? best : null;
  }

  function nearestWaypointIndex(pt: [number, number]): number | null {
    if (!pathWaypoints || pathWaypoints.length === 0) return null;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < pathWaypoints.length; i++) {
      const [wx, wy] = pathWaypoints[i]!;
      const d = Math.hypot(wx - pt[0], wy - pt[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD <= HIT_RADIUS_M ? best : null;
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (mapTool === null) return;
    const pt = svgPoint(e);
    if (!pt) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (mapTool === "MOVE") {
      const hit = nearestBeaconIndex(pt);
      if (hit !== null) setDragIndex(hit);
      return;
    }
    if (mapTool === "BEACON") {
      const next: Array<[number, number]> = [...effectiveBeacons.map(([x, y]) => [x, y] as [number, number]), pt];
      setBeaconPositions(next);
      return;
    }
    if (mapTool === "WAYPOINT") {
      const next: Array<[number, number]> = pathWaypoints
        ? [...pathWaypoints.map(([x, y]) => [x, y] as [number, number]), pt]
        : [pt];
      setPathWaypoints(next);
      if (pathPreset !== "FREEHAND") setPathPreset("FREEHAND");
      return;
    }
    if (mapTool === "ERASE") {
      const beaconHit = nearestBeaconIndex(pt);
      if (beaconHit !== null) {
        const next = effectiveBeacons
          .filter((_, i) => i !== beaconHit)
          .map(([x, y]) => [x, y] as [number, number]);
        setBeaconPositions(next);
        return;
      }
      const wpHit = nearestWaypointIndex(pt);
      if (wpHit !== null && pathWaypoints) {
        const next = pathWaypoints
          .filter((_, i) => i !== wpHit)
          .map(([x, y]) => [x, y] as [number, number]);
        setPathWaypoints(next.length > 0 ? next : null);
      }
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (mapTool !== "MOVE" || dragIndex === null) return;
    const pt = svgPoint(e);
    if (!pt) return;
    const next = effectiveBeacons.map(([x, y], i) =>
      i === dragIndex ? (pt as [number, number]) : ([x, y] as [number, number]),
    );
    setBeaconPositions(next);
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragIndex(null);
  }

  const customized = beaconPositions !== null || (pathWaypoints !== null && pathPreset === "FREEHAND");

  return (
    <Surface level={1} pad={3}>
      <Stack gap={2}>
        <Cluster gap={2} align="center">
          <Mono size="sm" muted className="t-label">
            Map preview
          </Mono>
          {customized ? (
            <Mono size="sm" style={{ color: "var(--accent-primary)" }}>
              · custom · unsaved
            </Mono>
          ) : null}
        </Cluster>
        <Cluster gap={1} wrap>
          {TOOLS.map((t) => (
            <Chip
              key={t.id}
              selected={mapTool === t.id}
              onClick={() => setMapTool(mapTool === t.id ? null : t.id)}
            >
              {t.label}
            </Chip>
          ))}
          {(beaconPositions !== null || pathWaypoints !== null) ? (
            <Chip
              onClick={() => {
                setBeaconPositions(null);
                setPathWaypoints(null);
              }}
            >
              RESET
            </Chip>
          ) : null}
        </Cluster>
        <div
          style={{
            width: SVG_W,
            height: SVG_H,
            maxWidth: "100%",
            alignSelf: "center",
            background: "rgba(0,0,0,0.25)",
            borderRadius: 4,
            border: "1px solid var(--border-subtle)",
            cursor: mapTool === null ? "default" : "crosshair",
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            width="100%"
            height="100%"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            aria-label="Map editor"
            style={{ touchAction: "none" }}
          >
            <rect
              x={sx(bounds.xmin)}
              y={sy(bounds.ymax)}
              width={sx(bounds.xmax) - sx(bounds.xmin)}
              height={sy(bounds.ymin) - sy(bounds.ymax)}
              fill="none"
              stroke="var(--text-low)"
              strokeDasharray="3 4"
            />
            {path
              ? path.waypoints.map((pt, i) => {
                  if (i === 0) return null;
                  const prev = path!.waypoints[i - 1]!;
                  return (
                    <line
                      key={`pl-${i}`}
                      x1={sx(prev[0])}
                      y1={sy(prev[1])}
                      x2={sx(pt[0])}
                      y2={sy(pt[1])}
                      stroke="var(--accent-primary)"
                      strokeWidth={1.5}
                      opacity={0.7}
                    />
                  );
                })
              : null}
            {path && path.closed && path.waypoints.length > 1 ? (
              <line
                x1={sx(path.waypoints[path.waypoints.length - 1]![0])}
                y1={sy(path.waypoints[path.waypoints.length - 1]![1])}
                x2={sx(path.waypoints[0]![0])}
                y2={sy(path.waypoints[0]![1])}
                stroke="var(--accent-primary)"
                strokeWidth={1.5}
                opacity={0.7}
              />
            ) : null}
            {pathWaypoints
              ? pathWaypoints.map(([x, y], i) => (
                  <circle
                    key={`wp-${i}`}
                    cx={sx(x)}
                    cy={sy(y)}
                    r={3}
                    fill="var(--accent-primary)"
                    opacity={0.9}
                  />
                ))
              : null}
            {effectiveBeacons.map(([x, y], i) => (
              <g key={`b-${i}`}>
                <circle cx={sx(x)} cy={sy(y)} r={4} fill="var(--accent-primary)" />
                <circle
                  cx={sx(x)}
                  cy={sy(y)}
                  r={10}
                  fill="none"
                  stroke="var(--accent-primary)"
                  strokeOpacity={0.3}
                />
              </g>
            ))}
          </svg>
        </div>
        <Mono size="sm" muted>
          {preset.sizeM.width}×{preset.sizeM.height} m · {effectiveBeacons.length} beacon
          {effectiveBeacons.length === 1 ? "" : "s"}
          {pathWaypoints && pathPreset === "FREEHAND"
            ? ` · ${pathWaypoints.length} waypoint${pathWaypoints.length === 1 ? "" : "s"}`
            : ""}
        </Mono>
      </Stack>
    </Surface>
  );
}
