import { AdminTabs } from '@/components/admin/AdminTabs'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <AdminTabs />
      {children}
    </div>
  )
}
