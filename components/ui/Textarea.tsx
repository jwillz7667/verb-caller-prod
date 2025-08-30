"use client"
import * as React from 'react'
import { cn } from '@/lib/utils'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string
  hint?: string
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, hint, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="mb-1 block text-sm text-neutral-300">{label}</label>
        )}
        <textarea
          className={cn(
            'min-h-[120px] w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none ring-0 focus:border-brand-500',
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
Textarea.displayName = 'Textarea'

