import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { Navigation } from '@/components/ui/Navigation'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

export const metadata: Metadata = {
  title: 'DashWT — Dashboard Executivo',
  description: 'Dashboard Executivo de Vendas — Welcome Trips',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-50 text-slate-900`}
      >
        <Navigation />
        {/* Main content: offset by sidebar on desktop, offset by top bar on mobile */}
        <main className="lg:pl-56 pt-14 lg:pt-0 min-h-screen">
          <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </body>
    </html>
  )
}
