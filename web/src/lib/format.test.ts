import { describe, expect, it } from "vitest";
import { fmtLife, fmtYear, initials } from "./format";
import { toCSV } from "./export";
import { posToYear, yearToPos } from "../components/TimeSlider";

describe("format", () => {
  it("formats BCE and missing deaths honestly", () => {
    expect(fmtYear(-287)).toBe("287 BCE");
    expect(fmtLife(1850, null)).toBe("1850–?"); // pre-1910: missing, not alive
    expect(fmtLife(1960, null)).toBe("b. 1960");
    expect(fmtLife(-287, -212)).toBe("287 BCE–212 BCE");
  });
  it("initials", () => expect(initials("Marie Skłodowska Curie")).toBe("MC"));
  it("CSV escapes", () => {
    expect(toCSV([{ a: 'x,"y"', b: ["p", "q"], c: null }])).toBe('a,b,c\n"x,""y""",p; q,');
  });
  it("time slider scale is monotone and invertible", () => {
    for (const y of [-600, -100, 0, 1600, 1750, 1933, 2025]) expect(Math.abs(posToYear(yearToPos(y)) - y)).toBeLessThanOrEqual(1);
    expect(yearToPos(1900)).toBeGreaterThan(yearToPos(1600));
  });
});
