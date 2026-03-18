'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase'
import {
  LayoutDashboard,
  Upload,
  Target,
  ShieldCheck,
  Users,
  LogOut,
  BarChart3,
  type LucideIcon,
} from 'lucide-react'

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/vendedores', label: 'Vendedores', icon: Users },
  { href: '/upload', label: 'Upload', icon: Upload },
  { href: '/metas', label: 'Metas', icon: Target },
  { href: '/qualidade', label: 'Qualidade', icon: ShieldCheck },
]

export function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Não mostrar nav na página de login
  if (pathname === '/login') return null

  const handleLogout = async () => {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 lg:fixed lg:inset-y-0 bg-slate-900 text-white">
        <div className="px-4 py-6 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} strokeWidth={1.75} className="text-blue-400" />
            <h1 className="text-lg font-bold tracking-tight">DashWT</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">Welcome Trips</p>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive(pathname, item.href)
                  ? 'bg-slate-800 text-white font-medium border-l-2 border-blue-400'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <item.icon size={18} strokeWidth={1.75} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-2 py-4 border-t border-slate-700">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors w-full"
          >
            <LogOut size={18} strokeWidth={1.75} />
            Sair
          </button>
        </div>
      </aside>

      {/* Top bar mobile */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} strokeWidth={1.75} className="text-blue-400" />
          <h1 className="text-lg font-bold">DashWT</h1>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg hover:bg-slate-800"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <nav className="absolute top-14 left-0 right-0 bg-slate-900 px-4 py-3 space-y-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive(pathname, item.href)
                    ? 'bg-slate-800 text-white font-medium border-l-2 border-blue-400'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <item.icon size={18} strokeWidth={1.75} />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  )
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}
