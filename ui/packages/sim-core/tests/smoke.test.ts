import { describe, it, expect } from "vitest";
import { SIM_CORE_VERSION } from "../src/index.js";

describe("sim-core smoke", () => {
  it("exports a version", () => {
    expect(SIM_CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
