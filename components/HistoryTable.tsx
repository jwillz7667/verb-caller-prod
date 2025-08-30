"use client"
import { useEffect, useMemo, useState } from 'react'
import { Button } from './ui/Button'
import toast from 'react-hot-toast'

type Call = {
  sid: string
  to?: string
  from?: string
  startTime?: string
  endTime?: string
  status?: string
}

type Recording = {
  sid: string
  callSid: string
  dateCreated: string
  duration?: string
  mediaUrl: string
}

export default function HistoryTable() {
  const [calls, setCalls] = useState<Call[]>([])
  const [recsByCall, setRecsByCall] = useState<Record<string, Recording[]>>({})
  const [loading, setLoading] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const c = await fetch('/api/calls').then((r) => r.json())
      setCalls(c)
      const rs: Recording[] = await fetch('/api/recordings').then((r) => r.json())
      const grouped: Record<string, Recording[]> = {}
      for (const r of rs) {
        if (!grouped[r.callSid]) grouped[r.callSid] = []
        grouped[r.callSid].push(r)
      }
      setRecsByCall(grouped)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent Calls</h2>
        <Button onClick={load} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-400">
              <th className="py-2">Call SID</th>
              <th className="py-2">To</th>
              <th className="py-2">From</th>
              <th className="py-2">Status</th>
              <th className="py-2">Recordings</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.sid} className="border-b border-neutral-900/60">
                <td className="py-2 font-mono text-xs">{c.sid}</td>
                <td className="py-2">{c.to}</td>
                <td className="py-2">{c.from}</td>
                <td className="py-2 capitalize">{c.status}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    {(recsByCall[c.sid] || []).map((r) => (
                      <audio key={r.sid} controls src={r.mediaUrl} className="max-w-[280px]"/>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
