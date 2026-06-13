/**
 * Size-guide reference data + fit recommendation (FRONTEND-24 and its
 * "Find my size" follow-up).
 *
 * Single source of truth for the `/size-guide` info page AND the interactive
 * fit finder. The NUMERIC fit tables (`TOP_FIT` / `BOTTOM_FIT`) are the source;
 * the display rows (`TOPS` / `BOTTOMS`) and the recommendation logic both derive
 * from them, so a chart cell and a recommendation can never disagree. All
 * measurements are body measurements in centimetres; the US/EU/UK columns are
 * approximate international equivalents for each alpha size.
 *
 * `recommendFit` is a PURE function — it runs entirely in the browser (the fit
 * finder is a Client Component), so a customer's height/weight/measurements are
 * never sent to or stored on the server. Body metrics are deliberately kept out
 * of the v1 PII set (security.md); keeping the maths client-side honours that.
 *
 * NOTE: every range below is an EN 13402-informed PLACEHOLDER, shifted one step
 * down to reflect the Asian-cut fit of the shop's stock (so our "S" maps to a US
 * "XS", etc. — the one-size-down idea the `SIZE_NOTE` tells customers). They are
 * NOT measured from the actual garments, and the height/weight estimate is a
 * heuristic, not a fitting. The owner MUST replace the ranges (and re-check the
 * weight bands) with real tape measurements of stock before launch — this is the
 * size-guide equivalent of `delivery.ts`'s enforcement note. Until then, treat
 * every figure as directional only.
 */

/** Inclusive numeric range in centimetres. */
export interface CmRange {
  min: number
  max: number
}

/** Render a range the way the charts show it (en-dash, no unit — the column header carries "cm"). */
const fmtRange = (r: CmRange): string => `${r.min}–${r.max}`

/** Numeric fit row for tops — chest / shoulder / length girths (cm) + intl equivalents. */
export interface TopFit {
  size: string
  chest: CmRange
  shoulder: CmRange
  length: CmRange
  us: string
  eu: string
  uk: string
}

/** Numeric fit row for bottoms — waist / hip / inseam (cm) + intl equivalents. */
export interface BottomFit {
  size: string
  waist: CmRange
  hip: CmRange
  inseam: CmRange
  us: string
  eu: string
  uk: string
}

/** Tops fit table (source of truth for the Tops chart + the recommender). */
export const TOP_FIT: readonly TopFit[] = [
  {
    size: "S",
    chest: { min: 88, max: 92 },
    shoulder: { min: 42, max: 44 },
    length: { min: 66, max: 68 },
    us: "XS",
    eu: "44",
    uk: "34",
  },
  {
    size: "M",
    chest: { min: 96, max: 100 },
    shoulder: { min: 44, max: 46 },
    length: { min: 69, max: 71 },
    us: "S",
    eu: "46",
    uk: "36",
  },
  {
    size: "L",
    chest: { min: 104, max: 108 },
    shoulder: { min: 46, max: 48 },
    length: { min: 72, max: 74 },
    us: "M",
    eu: "48",
    uk: "38",
  },
  {
    size: "XL",
    chest: { min: 112, max: 116 },
    shoulder: { min: 48, max: 50 },
    length: { min: 75, max: 77 },
    us: "L",
    eu: "50",
    uk: "40",
  },
]

/** Bottoms fit table (source of truth for the Bottoms chart + the recommender). */
export const BOTTOM_FIT: readonly BottomFit[] = [
  {
    size: "S",
    waist: { min: 70, max: 74 },
    hip: { min: 88, max: 92 },
    inseam: { min: 74, max: 76 },
    us: "28",
    eu: "44",
    uk: "28",
  },
  {
    size: "M",
    waist: { min: 76, max: 80 },
    hip: { min: 94, max: 98 },
    inseam: { min: 76, max: 78 },
    us: "30",
    eu: "46",
    uk: "30",
  },
  {
    size: "L",
    waist: { min: 82, max: 86 },
    hip: { min: 100, max: 104 },
    inseam: { min: 78, max: 80 },
    us: "32",
    eu: "48",
    uk: "32",
  },
  {
    size: "XL",
    waist: { min: 88, max: 92 },
    hip: { min: 106, max: 110 },
    inseam: { min: 80, max: 82 },
    us: "34",
    eu: "50",
    uk: "34",
  },
]

/** A display measurement row: alpha size + measurements + intl equivalents (all strings). */
export type TopRow = {
  size: string
  chest: string
  shoulder: string
  length: string
  us: string
  eu: string
  uk: string
}

export type BottomRow = {
  size: string
  waist: string
  hip: string
  inseam: string
  us: string
  eu: string
  uk: string
}

/** Tops chart rows — derived from `TOP_FIT` so the chart can never drift from the recommender. */
export const TOPS: readonly TopRow[] = TOP_FIT.map((f) => ({
  size: f.size,
  chest: fmtRange(f.chest),
  shoulder: fmtRange(f.shoulder),
  length: fmtRange(f.length),
  us: f.us,
  eu: f.eu,
  uk: f.uk,
}))

/** Bottoms chart rows — derived from `BOTTOM_FIT`. */
export const BOTTOMS: readonly BottomRow[] = BOTTOM_FIT.map((f) => ({
  size: f.size,
  waist: fmtRange(f.waist),
  hip: fmtRange(f.hip),
  inseam: fmtRange(f.inseam),
  us: f.us,
  eu: f.eu,
  uk: f.uk,
}))

/** One table column — `key` indexes a row, `label` is the rendered header cell. */
export interface SizeColumn {
  key: string
  label: string
}

/** A measurement chart: a titled table of size rows keyed by its columns. */
export interface SizeChart {
  title: string
  columns: readonly SizeColumn[]
  rows: readonly Record<string, string>[]
}

const TOP_COLUMNS: readonly SizeColumn[] = [
  { key: "size", label: "Size" },
  { key: "chest", label: "Chest (cm)" },
  { key: "shoulder", label: "Shoulder (cm)" },
  { key: "length", label: "Length (cm)" },
  { key: "us", label: "US" },
  { key: "eu", label: "EU" },
  { key: "uk", label: "UK" },
]

const BOTTOM_COLUMNS: readonly SizeColumn[] = [
  { key: "size", label: "Size" },
  { key: "waist", label: "Waist (cm)" },
  { key: "hip", label: "Hip (cm)" },
  { key: "inseam", label: "Inseam (cm)" },
  { key: "us", label: "US" },
  { key: "eu", label: "EU" },
  { key: "uk", label: "UK" },
]

/**
 * Charts in render order. The page maps over this — columns drive the header
 * row and the per-cell lookup, so adding a column or a size never touches the
 * page. (`TopRow`/`BottomRow` are all-string object types, hence assignable to
 * the generic `Record<string, string>` row shape.)
 */
export const SIZE_CHARTS: readonly SizeChart[] = [
  { title: "Tops", columns: TOP_COLUMNS, rows: TOPS },
  { title: "Bottoms", columns: BOTTOM_COLUMNS, rows: BOTTOMS },
]

/** A "how to measure" tip for one body part. */
export interface MeasureTip {
  part: string
  how: string
}

/** Plain-language tips for taking the three core body measurements. */
export const HOW_TO_MEASURE: readonly MeasureTip[] = [
  {
    part: "Chest",
    how: "Measure around the fullest part of your chest, keeping the tape level under your arms and flat across your shoulder blades.",
  },
  {
    part: "Waist",
    how: "Measure around your natural waistline — the narrowest part of your torso — keeping the tape comfortably loose.",
  },
  {
    part: "Hip",
    how: "Measure around the fullest part of your hips, standing with your feet together.",
  },
]

/** Asia-fit guidance shown above the charts (CLAUDE.md: English-first v1). */
export const SIZE_NOTE: string =
  "Our garments are cut for an Asian fit and run about one size smaller than US/EU sizing. If you're between sizes, size up."

// ---------------------------------------------------------------------------
// Fit recommendation — "Find my size"
// ---------------------------------------------------------------------------

/**
 * Plausible entry bounds per field (cm / kg). The form rejects anything outside
 * these; the recommender itself clamps, so a tampered value can only ever map to
 * a real stocked size (S–XL), never crash.
 */
export const FIT_LIMITS = {
  heightCm: { min: 120, max: 220 },
  weightKg: { min: 30, max: 200 },
  chestCm: { min: 60, max: 160 },
  waistCm: { min: 50, max: 160 },
  hipCm: { min: 60, max: 170 },
} as const

/** Customer-entered body metrics. Height + weight are the baseline; the three measurements are optional refinements. */
export interface FitInput {
  heightCm?: number
  weightKg?: number
  chestCm?: number
  waistCm?: number
  hipCm?: number
}

/** Whether a suggested size came from an exact measurement or the height/weight estimate. */
export type FitBasis = "measurement" | "estimate"

export interface FitRecommendation {
  top: string
  bottom: string
  topBasis: FitBasis
  bottomBasis: FitBasis
  /** Customer-facing caveats (between-sizes, clamped at the extremes, the Asian-fit reminder). */
  notes: readonly string[]
}

const ASIAN_FIT_NOTE =
  "Sizes reflect our Asian fit (about one size smaller than US/EU). If you're between sizes or unsure, message us before ordering."

// Height/weight estimate — calibrated for a ~170 cm frame; each cm away from the
// reference nudges the "effective weight" so a shorter, heavier frame sizes up
// and a taller, leaner frame sizes down. Placeholders the owner can re-tune.
const REFERENCE_HEIGHT_CM = 170
const HEIGHT_WEIGHT_FACTOR = 0.4 // kg of effective weight per cm from the reference height
const WEIGHT_BANDS: readonly { size: string; maxKg: number }[] = [
  { size: "S", maxKg: 58 },
  { size: "M", maxKg: 70 },
  { size: "L", maxKg: 82 },
  { size: "XL", maxKg: Infinity },
]

function isFiniteNum(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function estimateFromHeightWeight(heightCm: number, weightKg: number): string {
  const effectiveKg =
    weightKg + (REFERENCE_HEIGHT_CM - heightCm) * HEIGHT_WEIGHT_FACTOR
  const band = WEIGHT_BANDS.find((b) => effectiveKg <= b.maxKg)
  return (band ?? WEIGHT_BANDS[WEIGHT_BANDS.length - 1]).size
}

interface RangeMatch {
  size: string
  index: number
  betweenSizes: boolean
  belowSmallest: boolean
  aboveLargest: boolean
}

/** Map a measurement to the stocked size whose range contains it, clamping (and flagging) the extremes. */
function matchByRange<T extends { size: string }>(
  rows: readonly T[],
  value: number,
  pick: (row: T) => CmRange
): RangeMatch {
  if (value < pick(rows[0]).min) {
    return {
      size: rows[0].size,
      index: 0,
      betweenSizes: false,
      belowSmallest: true,
      aboveLargest: false,
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const range = pick(rows[i])
    if (value <= range.max) {
      // value > previous band's max but < this band's min → it fell in a gap and got sized up into this band.
      return {
        size: rows[i].size,
        index: i,
        betweenSizes: value < range.min,
        belowSmallest: false,
        aboveLargest: false,
      }
    }
  }
  const last = rows.length - 1
  return {
    size: rows[last].size,
    index: last,
    betweenSizes: false,
    belowSmallest: false,
    aboveLargest: true,
  }
}

/**
 * Recommend a top and bottom size from body metrics.
 *
 * Height + weight are required and give the baseline estimate (same size for
 * both, since overall body size can't tell tops from bottoms apart). An exact
 * chest refines the top; an exact waist and/or hip refine the bottom — and when
 * both waist and hip are given, the LARGER wins (you can't fit smaller than your
 * hips). Returns `null` only when height/weight are missing.
 */
export function recommendFit(input: FitInput): FitRecommendation | null {
  if (!isFiniteNum(input.heightCm) || !isFiniteNum(input.weightKg)) return null

  const estimate = estimateFromHeightWeight(input.heightCm, input.weightKg)
  const notes: string[] = []

  // Tops — chest measurement wins, else the estimate.
  let top = estimate
  let topBasis: FitBasis = "estimate"
  if (isFiniteNum(input.chestCm)) {
    const m = matchByRange(TOP_FIT, input.chestCm, (r) => r.chest)
    top = m.size
    topBasis = "measurement"
    if (m.betweenSizes)
      notes.push(
        "Your chest is between sizes — we picked the larger top for a comfortable fit."
      )
    if (m.belowSmallest)
      notes.push(
        "Your chest is below our smallest top (S), so an S may fit loosely."
      )
    if (m.aboveLargest)
      notes.push("Your chest is above our largest stocked top (XL).")
  }

  // Bottoms — waist and/or hip refine the estimate; the larger of the two wins.
  let bottom = estimate
  let bottomBasis: FitBasis = "estimate"
  const waistGiven = isFiniteNum(input.waistCm)
  const hipGiven = isFiniteNum(input.hipCm)
  if (waistGiven || hipGiven) {
    bottomBasis = "measurement"
    let best: RangeMatch | null = null
    if (waistGiven) {
      best = matchByRange(BOTTOM_FIT, input.waistCm as number, (r) => r.waist)
    }
    if (hipGiven) {
      const hipMatch = matchByRange(
        BOTTOM_FIT,
        input.hipCm as number,
        (r) => r.hip
      )
      if (!best || hipMatch.index > best.index) best = hipMatch
    }
    const m = best as RangeMatch
    bottom = m.size
    if (m.betweenSizes)
      notes.push(
        "Your waist/hip is between sizes — we picked the larger bottom."
      )
    if (m.belowSmallest)
      notes.push(
        "Your waist is below our smallest bottom (S), so an S may fit loosely."
      )
    if (m.aboveLargest)
      notes.push("Your measurements are above our largest stocked bottom (XL).")
  }

  notes.push(ASIAN_FIT_NOTE)
  return { top, bottom, topBasis, bottomBasis, notes }
}
