import { Suspense } from 'react'
import { DashboardClient } from '@/components/dashboard/DashboardClient'

export const dynamic = 'force-dynamic'

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Carregando…</div>}>
      <DashboardClient />
    </Suspense>
  )
}
