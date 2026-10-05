'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, ScanSearch, type LucideIcon } from 'lucide-react'

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/admin/usuarios', label: 'Usuários', icon: Users },
  { href: '/admin/auditoria', label: 'Auditoria', icon: ScanSearch },
]

export function AdminTabs() {
  const pathname = usePathname()
  return (
    <div className="flex gap-1 border-b border-slate-200">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const ativo = pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-200 -mb-px ${
              ativo ? 'text-slate-900 border-blue-500' : 'text-slate-400 hover:text-slate-600 border-transparent'
            }`}
          >
            <Icon size={16} strokeWidth={1.75} className={ativo ? 'text-blue-500' : undefined} />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
