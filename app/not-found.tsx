import Link from 'next/link'

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <h2 className="text-xl font-bold text-slate-900 mb-2">Pagina nao encontrada</h2>
      <p className="text-sm text-slate-500 mb-4">
        A pagina que voce procura nao existe ou foi removida.
      </p>
      <Link
        href="/"
        className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
      >
        Voltar ao Dashboard
      </Link>
    </div>
  )
}
