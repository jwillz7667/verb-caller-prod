"use client"
import Link from 'next/link'
import { PhoneCall, History, Bot } from 'lucide-react'

export default function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-800/60 bg-black/60 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2 text-white">
          <Bot className="h-6 w-6 text-brand-400" />
          <span className="text-lg font-semibold tracking-tight">AIVoiceCaller</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-neutral-300">
          <Link href="/" className="flex items-center gap-2 hover:text-white">
            <PhoneCall className="h-4 w-4" /> Playground
          </Link>
          <Link href="/history" className="flex items-center gap-2 hover:text-white">
            <History className="h-4 w-4" /> Recordings
          </Link>
          <a
            href="https://platform.openai.com/docs/guides/realtime"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-2 text-neutral-400 hover:text-white sm:flex"
          >
            Docs
          </a>
        </nav>
      </div>
    </header>
  )
}
