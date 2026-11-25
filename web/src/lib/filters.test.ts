import { describe, expect, it } from "vitest";
import { computeVisible, DEFAULT_FILTERS, filtersToParams, paramsToFilters, YEAR_MAX } from "./filters";
import { FLAG } from "./types";

const people = {
  n: 4,
  by: [1850, 1950, null, 1990],
  f: [FLAG.core | FLAG.laureate, FLAG.core, 0, FLAG.laureate],
  fc: [0, 1, -1, 0],
  c: [0, 1, -1, 0],
  countries: ["Germany", "United States"],
  gd: [0, 1, -1, 0],
  genders: ["male", "female"],
};

describe("URL <-> filters", () => {
  it("round-trips and omits defaults", () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
    const f = { ...DEFAULT_FILTERS, year: 1933, core: true, field: 2, country: "Germany", predicted: true };
    expect(paramsToFilters(filtersToParams(f))).toEqual(f);
  });
  it("clamps and sanitises bad input", () => {
    const f = paramsToFilters(new URLSearchParams("t=99999&field=abc"));
    expect(f.year).toBe(YEAR_MAX);
    expect(f.field).toBeNull();
    expect(paramsToFilters(new URLSearchParams("t=-5000")).year).toBe(-600);
  });
  it("preserves unrelated params like the selected person", () => {
    const p = filtersToParams({ ...DEFAULT_FILTERS, core: true }, new URLSearchParams("p=Q937"));
    expect(p.get("p")).toBe("Q937");
  });
});

describe("computeVisible", () => {
  it("time slider hides people not yet born; unknown birth only shown at end", () => {
    expect([...computeVisible(people, { ...DEFAULT_FILTERS, year: 1900 })]).toEqual([1, 0, 0, 0]);
    expect([...computeVisible(people, DEFAULT_FILTERS)]).toEqual([1, 1, 1, 1]);
  });
  it("combines filters", () => {
    expect([...computeVisible(people, { ...DEFAULT_FILTERS, core: true, laureates: true })]).toEqual([1, 0, 0, 0]);
    expect([...computeVisible(people, { ...DEFAULT_FILTERS, country: "United States" })]).toEqual([0, 1, 0, 0]);
    expect([...computeVisible(people, { ...DEFAULT_FILTERS, gender: "male", field: 0 })]).toEqual([1, 0, 0, 1]);
  });
});
