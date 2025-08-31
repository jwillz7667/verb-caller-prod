import Nav from '@/components/Nav'
import HistoryTable from '@/components/HistoryTable'

export default function HistoryPage() {
  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Recordings</h1>
        <HistoryTable />
      </main>
    </div>
  )
}
