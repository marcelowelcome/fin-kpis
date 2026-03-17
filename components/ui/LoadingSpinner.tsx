interface LoadingSpinnerProps {
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

export function LoadingSpinner({ label, size = 'md' }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4',
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <div
        className={`${sizeClasses[size]} border-slate-200 border-t-slate-600 rounded-full animate-spin`}
      />
      {label && <p className="text-sm text-slate-500">{label}</p>}
    </div>
  )
}
