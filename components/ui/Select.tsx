"use client"
import * as React from 'react'

type Option = { label: string; value: string }

export function Select({
  label,
  options,
  value,
  onChange,
  hint,
  name,
  disabled
}: {
  label?: string
  options: Option[]
  value?: string
  onChange?: (v: string) => void
  hint?: string
  name?: string
  disabled?: boolean
}) {
  return (
    <div>
      {label && <label className="mb-1 block text-sm text-neutral-300">{label}</label>}
      <select
        name={name}
        disabled={disabled}
        className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-neutral-950">
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  )
}

