import { useEffect } from "react";
import { useSimStore } from "./simStore";

export function useTickLoop(): void {
  const isPlaying = useSimStore((s) => s.isPlaying);
  const hz = useSimStore((s) => s.playbackHz);
  const step = useSimStore((s) => s.step);

  useEffect(() => {
    if (!isPlaying) return;
    const period = 1000 / hz;
    let last = performance.now();
    let accum = 0;
    let raf = 0;
    const tick = (now: number) => {
      accum += now - last;
      last = now;
      while (accum >= period) {
        if (!useSimStore.getState().isPlaying) {
          accum = 0;
          return;
        }
        step(1);
        accum -= period;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, hz, step]);
}
