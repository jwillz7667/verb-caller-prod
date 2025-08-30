import Nav from '@/components/Nav'
import DashboardForm from '@/components/DashboardForm'
import ControlSettings from '@/components/ControlSettings'

export default function Page() {
  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Dashboard</h1>
        <DashboardForm />
        <div className="mt-8" />
        <ControlSettings />
      </main>
    </div>
  )
}
