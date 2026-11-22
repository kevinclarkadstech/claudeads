import { describe, expect, it } from "vitest";
import { addDays, isIsoDate, todayInTimezone } from "../src/worker/lib/dates";

describe("dates", () => {
  it("resolves 'today' in the ad account's timezone", () => {
    const instant = new Date("2026-11-22T03:00:00Z"); // still Nov 21 in New York
    expect(todayInTimezone("America/New_York", instant)).toBe("2026-11-21");
    expect(todayInTimezone("Europe/Berlin", instant)).toBe("2026-11-22");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-11-22", -29)).toBe("2026-10-24");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2026-11-22")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("22-11-2026")).toBe(false);
    expect(isIsoDate("2026-11-22'; drop table x")).toBe(false);
  });
});
