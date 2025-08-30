"use client"
import * as React from 'react'

export function Toggle({ label, checked, onChange, hint, name }: { label?: string; checked?: boolean; onChange?: (v: boolean) => void; hint?: string; name?: string }) {
  return (
    <div>
      {label && <label className="mb-1 block text-sm text-neutral-300">{label}</label>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange?.(!checked)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full ${checked ? 'bg-brand-600' : 'bg-neutral-700'}`}
          name={name}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
        <span className="text-sm text-neutral-400">{checked ? 'Enabled' : 'Disabled'}</span>
      </div>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  )
}

