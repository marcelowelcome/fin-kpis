'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/upload', label: 'Upload', icon: '📤' },
  { href: '/historico', label: 'Histórico', icon: '📋' },
  { href: '/metas', label: 'Metas', icon: '🎯' },
  { href: '/qualidade', label: 'Qualidade', icon: '✅' },
]

export function Navigation() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 lg:fixed lg:inset-y-0 bg-slate-900 text-white">
        <div className="px-4 py-6 border-b border-slate-700">
          <h1 className="text-lg font-bold tracking-tight">DashWT</h1>
          <p className="text-xs text-slate-400 mt-1">Welcome Trips</p>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive(pathname, item.href)
                  ? 'bg-slate-700 text-white font-medium'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Top bar mobile */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <div>
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
                    ? 'bg-slate-700 text-white font-medium'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="text-base">{item.icon}</span>
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
