"use client"
import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  hint?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, hint, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="mb-1 block text-sm text-neutral-300">{label}</label>
        )}
        <input
          type={type}
          className={cn(
            'w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none ring-0 focus:border-brand-500',
            className
          )}
          ref={ref}
          {...props}
        />
        {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

