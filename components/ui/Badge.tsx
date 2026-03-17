import type { AlertaSeveridade } from '@/lib/schemas'

interface BadgeProps {
  label: string
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral'
}

const VARIANT_CLASSES: Record<string, string> = {
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-800',
  info: 'bg-blue-100 text-blue-800',
  neutral: 'bg-slate-100 text-slate-600',
}

export function Badge({ label, variant = 'neutral' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${VARIANT_CLASSES[variant]}`}
    >
      {label}
    </span>
  )
}

const SEVERITY_MAP: Record<AlertaSeveridade, BadgeProps['variant']> = {
  CRITICO: 'error',
  ATENCAO: 'warning',
  AVISO: 'info',
  INFO: 'neutral',
}

export function SeverityBadge({ severidade }: { severidade: AlertaSeveridade }) {
  return <Badge label={severidade} variant={SEVERITY_MAP[severidade]} />
}

export function StatusBadge({ status }: { status: 'success' | 'warning' | 'error' }) {
  const labels = { success: 'Sucesso', warning: 'Atenção', error: 'Erro' }
  return <Badge label={labels[status]} variant={status} />
}
