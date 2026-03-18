'use client'

import { Building2, Plane, Heart, Briefcase } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Tab {
  id: string
  label: string
  icon: LucideIcon
  color: string
}

const TABS: Tab[] = [
  { id: 'group', label: 'Group', icon: Building2, color: '#1e293b' },
  { id: 'trips', label: 'Trips', icon: Plane, color: '#10b981' },
  { id: 'weddings', label: 'Weddings', icon: Heart, color: '#D4AC0D' },
  { id: 'corp', label: 'Corp', icon: Briefcase, color: '#3b82f6' },
]

interface CompanyTabsProps {
  activeTab: string
  onTabChange: (tabId: string) => void
}

export function CompanyTabs({ activeTab, onTabChange }: CompanyTabsProps) {
  return (
    <div className="flex gap-1 border-b border-slate-200">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              flex items-center gap-2 px-4 py-2.5 text-sm font-medium
              border-b-2 transition-all duration-200 -mb-px
              ${isActive
                ? 'text-slate-900'
                : 'text-slate-400 hover:text-slate-600 border-transparent'
              }
            `}
            style={isActive ? { borderBottomColor: tab.color } : undefined}
          >
            <Icon size={16} strokeWidth={1.75} style={isActive ? { color: tab.color } : undefined} />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
