"use client"

import { type FormEvent, useEffect, useState } from "react"
import PillButton from "../../components/ui/PillButton"
import {
  FIT_LIMITS,
  type FitBasis,
  type FitInput,
  type FitRecommendation,
  recommendFit,
} from "@lib/size-guide"

/**
 * "Find my size" calculator (FRONTEND-24 follow-up).
 *
 * Client Component — the only interactive piece on `/size-guide`. The customer
 * enters height + weight (the easy path) and, optionally, exact chest / waist /
 * hip measurements to refine it; `recommendFit` (pure, in `@lib/size-guide`)
 * returns a top + bottom size. Everything runs in the browser: no body metric is
 * sent to or stored on the server (security.md PII minimisation), which the
 * privacy line states to the customer.
 *
 * Styling reuses the search-pill field treatment (soft-cloud fill, ink focus
 * border, pill radius) that DeliveryForm established for checkout fields — no new
 * primitive — plus the shared `PillButton`. Tokens only: no accent (reserved for
 * sale price + the KHQR CTA), no shadows/gradients/`dark:`. Errors render in ink,
 * since the palette has no error colour and accent is off-limits.
 */

interface Fields {
  height: string
  weight: string
  chest: string
  waist: string
  hip: string
}

const EMPTY_FIELDS: Fields = {
  height: "",
  weight: "",
  chest: "",
  waist: "",
  hip: "",
}

const FIELD =
  "h-12 w-full rounded-pill border-2 border-transparent bg-soft-cloud px-4 text-base font-normal leading-normal text-ink outline-none placeholder:text-mute focus:border-ink focus:bg-canvas"
const LABEL = "text-sm font-medium leading-normal text-ink"

interface NumberFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  min: number
  max: number
  required?: boolean
  placeholder?: string
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  required,
  placeholder,
}: NumberFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step="0.5"
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD}
      />
    </div>
  )
}

/** Parse a field to a number, or `null` when blank. Throws a message string when out of range. */
function parseField(
  raw: string,
  label: string,
  bounds: { min: number; max: number },
  required: boolean
): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") {
    if (required) throw `Please enter your ${label.toLowerCase()}.`
    return null
  }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) throw `${label} must be a number.`
  if (value < bounds.min || value > bounds.max) {
    throw `${label} should be between ${bounds.min} and ${bounds.max}.`
  }
  return value
}

const BASIS_LABEL: Record<FitBasis, string> = {
  measurement: "from your measurements",
  estimate: "estimated from height & weight",
}

export default function FitFinder() {
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS)
  const [result, setResult] = useState<FitRecommendation | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Progressive enhancement: the calculator is JS-only, so keep the submit
  // disabled until the component has mounted. This prevents a pre-hydration
  // native form submit (which would reload the page to nothing) and gives the
  // E2E spec a deterministic "interactive" signal to wait on.
  const [isReady, setIsReady] = useState(false)
  useEffect(() => setIsReady(true), [])

  const set = (field: keyof Fields) => (value: string) =>
    setFields((prev) => ({ ...prev, [field]: value }))

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const input: FitInput = {
        heightCm:
          parseField(fields.height, "Height", FIT_LIMITS.heightCm, true) ??
          undefined,
        weightKg:
          parseField(fields.weight, "Weight", FIT_LIMITS.weightKg, true) ??
          undefined,
        chestCm:
          parseField(fields.chest, "Chest", FIT_LIMITS.chestCm, false) ??
          undefined,
        waistCm:
          parseField(fields.waist, "Waist", FIT_LIMITS.waistCm, false) ??
          undefined,
        hipCm:
          parseField(fields.hip, "Hip", FIT_LIMITS.hipCm, false) ?? undefined,
      }
      const recommendation = recommendFit(input)
      if (!recommendation) {
        setError("Please enter your height and weight to get a suggestion.")
        setResult(null)
        return
      }
      setError(null)
      setResult(recommendation)
    } catch (message) {
      // parseField throws a customer-safe string; never log body metrics (security.md).
      setError(
        typeof message === "string" ? message : "Please check your entries."
      )
      setResult(null)
    }
  }

  const handleReset = () => {
    setFields(EMPTY_FIELDS)
    setResult(null)
    setError(null)
  }

  return (
    <section
      aria-labelledby="fit-finder-heading"
      className="flex flex-col gap-4 rounded-large border border-hairline p-4 min-[600px]:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="fit-finder-heading" className="text-base font-medium text-ink">
          Find my size
        </h2>
        <p className="text-sm font-normal leading-normal text-mute">
          Enter your height and weight for an instant suggestion. Add exact
          measurements below for a more precise fit.
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-4 min-[600px]:grid-cols-2">
          <NumberField
            id="fit-height"
            label="Height (cm)"
            value={fields.height}
            onChange={set("height")}
            min={FIT_LIMITS.heightCm.min}
            max={FIT_LIMITS.heightCm.max}
            required
            placeholder="e.g. 170"
          />
          <NumberField
            id="fit-weight"
            label="Weight (kg)"
            value={fields.weight}
            onChange={set("weight")}
            min={FIT_LIMITS.weightKg.min}
            max={FIT_LIMITS.weightKg.max}
            required
            placeholder="e.g. 65"
          />
        </div>

        <details className="border-t border-hairline pt-4">
          <summary className="cursor-pointer list-none text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            Add exact measurements (optional)
          </summary>
          <div className="mt-4 grid grid-cols-1 gap-4 min-[600px]:grid-cols-3">
            <NumberField
              id="fit-chest"
              label="Chest (cm)"
              value={fields.chest}
              onChange={set("chest")}
              min={FIT_LIMITS.chestCm.min}
              max={FIT_LIMITS.chestCm.max}
              placeholder="optional"
            />
            <NumberField
              id="fit-waist"
              label="Waist (cm)"
              value={fields.waist}
              onChange={set("waist")}
              min={FIT_LIMITS.waistCm.min}
              max={FIT_LIMITS.waistCm.max}
              placeholder="optional"
            />
            <NumberField
              id="fit-hip"
              label="Hip (cm)"
              value={fields.hip}
              onChange={set("hip")}
              min={FIT_LIMITS.hipCm.min}
              max={FIT_LIMITS.hipCm.max}
              placeholder="optional"
            />
          </div>
        </details>

        <div className="flex items-center gap-4">
          <PillButton type="submit" disabled={!isReady}>
            Find my size
          </PillButton>
          <button
            type="button"
            onClick={handleReset}
            className="text-sm font-medium text-mute underline underline-offset-2 transition-opacity hover:opacity-70"
          >
            Reset
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="text-sm font-medium leading-normal text-ink">
          {error}
        </p>
      ) : null}

      <div aria-live="polite">
        {result ? (
          <div className="flex flex-col gap-4 border border-hairline bg-soft-cloud p-4">
            <h3 className="text-base font-medium text-ink">
              Your recommended size
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-3xl font-medium leading-tight text-ink">
                  {result.top}
                </span>
                <span className="text-xs font-medium leading-normal text-mute">
                  Tops · {BASIS_LABEL[result.topBasis]}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-3xl font-medium leading-tight text-ink">
                  {result.bottom}
                </span>
                <span className="text-xs font-medium leading-normal text-mute">
                  Bottoms · {BASIS_LABEL[result.bottomBasis]}
                </span>
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {result.notes.map((note) => (
                <li
                  key={note}
                  className="text-sm font-normal leading-normal text-mute"
                >
                  {note}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <p className="text-xs font-normal leading-normal text-mute">
        Calculated on your device — nothing is saved or sent.
      </p>
    </section>
  )
}
