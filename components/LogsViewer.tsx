"use client"
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from './ui/Button'

type LogLine = { t: number; raw: string }

export default function LogsViewer() {
  const [lines, setLines] = useState<LogLine[]>([])
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/api/stream/logs`
    const ws = new WebSocket(url)
    wsRef.current = ws
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)
    ws.onmessage = (ev) => {
      if (paused) return
      const t = Date.now()
      setLines((prev) => {
        const next = [...prev, { t, raw: ev.data as string }]
        // cap length to avoid runaway memory
        if (next.length > 2000) next.splice(0, next.length - 2000)
        return next
      })
    }
    return () => { try { ws.close() } catch {} }
  }, [paused])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const pretty = (raw: string) => {
    try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Live Logs</h2>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs ${connected ? 'bg-emerald-600/20 text-emerald-300' : 'bg-red-600/20 text-red-300'}`}>{connected ? 'connected' : 'disconnected'}</span>
          <Button type="button" onClick={() => setPaused((v) => !v)} className="px-3 py-1 text-xs">{paused ? 'Resume' : 'Pause'}</Button>
          <Button type="button" onClick={() => setLines([])} className="px-3 py-1 text-xs">Clear</Button>
        </div>
      </div>
      <div className="h-[70vh] overflow-auto rounded border border-neutral-900 bg-neutral-950 p-3">
        {lines.length === 0 && (
          <p className="text-sm text-neutral-500">Waiting for events… start or receive a call to see streaming logs.</p>
        )}
        {lines.map((l, i) => (
          <pre key={i} className="mb-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-200">
            <span className="text-neutral-500">[{new Date(l.t).toLocaleTimeString()}]</span> {pretty(l.raw)}
          </pre>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  )
}

