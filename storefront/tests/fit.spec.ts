import { expect, test } from "@playwright/test"
import { recommendFit } from "../src/lib/size-guide"

/**
 * Unit tests for the pure `recommendFit` (FRONTEND-24 "Find my size").
 *
 * No browser — these exercise the recommendation logic directly (Playwright runs
 * a spec that never touches `page` without launching Chromium). The relative
 * import sidesteps the `@lib` tsconfig alias, which the Playwright runner does
 * not resolve.
 */
test.describe("recommendFit", () => {
  test("returns null when height or weight is missing", () => {
    expect(recommendFit({ weightKg: 65 })).toBeNull()
    expect(recommendFit({ heightCm: 170 })).toBeNull()
    expect(recommendFit({})).toBeNull()
  })

  test("estimates both sizes from height + weight alone", () => {
    const r = recommendFit({ heightCm: 170, weightKg: 65 })
    expect(r).not.toBeNull()
    // 65kg at the 170cm reference falls in the M band (≤70kg).
    expect(r?.top).toBe("M")
    expect(r?.bottom).toBe("M")
    expect(r?.topBasis).toBe("estimate")
    expect(r?.bottomBasis).toBe("estimate")
  })

  test("a heavier frame estimates a larger size", () => {
    const light = recommendFit({ heightCm: 170, weightKg: 52 })
    const heavy = recommendFit({ heightCm: 170, weightKg: 95 })
    expect(light?.top).toBe("S")
    expect(heavy?.top).toBe("XL")
  })

  test("shorter frame at the same weight sizes up vs a taller frame", () => {
    // 71kg: just over the M band (≤70) at reference height.
    const tall = recommendFit({ heightCm: 185, weightKg: 71 })
    const short = recommendFit({ heightCm: 160, weightKg: 71 })
    expect(tall?.top).toBe("M") // taller → effectively lighter → stays M
    expect(short?.top).toBe("L") // shorter → effectively heavier → L
  })

  test("an exact chest overrides the estimate for tops", () => {
    // chest 98 sits inside the M range (96–100); estimate would be S at 50kg.
    const r = recommendFit({ heightCm: 170, weightKg: 50, chestCm: 98 })
    expect(r?.top).toBe("M")
    expect(r?.topBasis).toBe("measurement")
    expect(r?.bottom).toBe("S") // bottoms still estimated
    expect(r?.bottomBasis).toBe("estimate")
  })

  test("hip forces a larger bottom than waist alone", () => {
    // waist 72 → S (70–74); hip 102 → L (100–104). Larger wins → L.
    const r = recommendFit({
      heightCm: 170,
      weightKg: 65,
      waistCm: 72,
      hipCm: 102,
    })
    expect(r?.bottom).toBe("L")
    expect(r?.bottomBasis).toBe("measurement")
  })

  test("a between-sizes chest is rounded up with a note", () => {
    // 94 is in the gap between S (≤92) and M (96–100) → sized up to M.
    const r = recommendFit({ heightCm: 170, weightKg: 65, chestCm: 94 })
    expect(r?.top).toBe("M")
    expect(
      r?.notes.some((n) => n.toLowerCase().includes("between sizes"))
    ).toBe(true)
  })

  test("clamps and flags chest above the largest stocked size", () => {
    const r = recommendFit({ heightCm: 175, weightKg: 90, chestCm: 130 })
    expect(r?.top).toBe("XL")
    expect(r?.notes.some((n) => n.includes("largest stocked top"))).toBe(true)
  })

  test("always includes the Asian-fit reminder", () => {
    const r = recommendFit({ heightCm: 170, weightKg: 65 })
    expect(r?.notes.some((n) => n.includes("Asian fit"))).toBe(true)
  })
})
