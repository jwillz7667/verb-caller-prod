"use client"
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from './Button'
import toast from 'react-hot-toast'

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          toast.success('Copied')
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error('Copy failed')
        }
      }}
      className="px-2 py-1 text-xs"
      aria-label={label || 'Copy'}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  )
}

