'use client'

interface Column<T> {
  key: string
  label: string
  render?: (row: T) => React.ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}

interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  emptyMessage?: string
  loading?: boolean
  onRowClick?: (row: T) => void
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  emptyMessage = 'Nenhum dado encontrado.',
  loading = false,
  onRowClick,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="animate-pulse space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-slate-100 rounded" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-medium text-slate-600 ${
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                } ${col.className ?? ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((row, i) => (
            <tr
              key={i}
              className={`hover:bg-slate-50 transition-colors ${
                onRowClick ? 'cursor-pointer' : ''
              }`}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-4 py-3 ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  } ${col.className ?? ''}`}
                >
                  {col.render ? col.render(row) : String(row[col.key] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
