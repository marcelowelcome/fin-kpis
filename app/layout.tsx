import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { Navigation } from '@/components/ui/Navigation'
import { SidebarProvider } from '@/lib/sidebar-context'
import { MainContent } from '@/components/ui/MainContent'

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
  description: 'Dashboard Executivo de Vendas — Welcome Group',
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
        <SidebarProvider>
          <Navigation />
          <MainContent>{children}</MainContent>
        </SidebarProvider>
      </body>
    </html>
  )
}
