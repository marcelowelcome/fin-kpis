'use client'

import { useSidebar } from '@/lib/sidebar-context'

export function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar()
  return (
    <main
      className={`pt-14 lg:pt-0 min-h-screen transition-all duration-200 ${
        collapsed ? 'lg:pl-16' : 'lg:pl-56'
      }`}
    >
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
        {children}
      </div>
    </main>
  )
}
