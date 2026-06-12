"use client"

import { useState } from "react"

import PillButton from "../ui/PillButton"
import { updateCustomer } from "@lib/data/customer"
import { isValidCambodiaPhone } from "@lib/validation/phone"

/**
 * Edit the signed-in customer's name + phone. Email is provider-supplied and
 * shown read-only. Controlled fields so the phone can be validated against the
 * shared Cambodia regex (security.md / PRD) BEFORE any `updateCustomer` request —
 * an invalid phone never reaches the network.
 *
 * design.md: reuses the project field surface (soft-cloud fill, pill radius, ink
 * focus border — the DeliveryForm convention) and the `PillButton` primitive for
 * the ink Save CTA. Tokens only; accent stays reserved (sale price + KHQR).
 */

interface ProfileFormProps {
  firstName: string
  lastName: string
  phone: string
  email: string
}

const LABEL = "text-base font-medium leading-normal text-ink"
const FIELD_BASE =
  "w-full border-2 border-transparent bg-soft-cloud text-base font-normal leading-normal text-ink outline-none placeholder:text-mute focus:border-ink focus:bg-canvas"
const INPUT = `${FIELD_BASE} h-12 rounded-pill px-4`
const INPUT_READONLY = `${INPUT} cursor-not-allowed text-mute`

type Status = "idle" | "saving" | "saved" | "error"

export default function ProfileForm({
  firstName,
  lastName,
  phone,
  email,
}: ProfileFormProps) {
  const [form, setForm] = useState({ firstName, lastName, phone })
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (form.phone && !isValidCambodiaPhone(form.phone)) {
      setError("Enter a valid Cambodia phone number.")
      setStatus("error")
      return
    }

    setStatus("saving")
    try {
      await updateCustomer({
        first_name: form.firstName,
        last_name: form.lastName,
        phone: form.phone,
      })
      setStatus("saved")
    } catch {
      setError("Could not save. Please try again.")
      setStatus("error")
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className={LABEL} htmlFor="first_name">
          First name
        </label>
        <input
          id="first_name"
          className={INPUT}
          value={form.firstName}
          onChange={(e) => setForm({ ...form, firstName: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={LABEL} htmlFor="last_name">
          Last name
        </label>
        <input
          id="last_name"
          className={INPUT}
          value={form.lastName}
          onChange={(e) => setForm({ ...form, lastName: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={LABEL} htmlFor="phone">
          Phone
        </label>
        <input
          id="phone"
          inputMode="tel"
          className={INPUT}
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={LABEL} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className={INPUT_READONLY}
          value={email}
          disabled
          readOnly
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="text-base font-medium leading-normal text-ink"
        >
          {error}
        </p>
      ) : null}
      {status === "saved" ? (
        <p className="text-base font-medium leading-normal text-mute">Saved.</p>
      ) : null}

      <PillButton type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save changes"}
      </PillButton>
    </form>
  )
}
