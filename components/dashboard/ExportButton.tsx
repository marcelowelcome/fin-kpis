'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'

interface ExportButtonProps {
  targetId: string
  filename?: string
}

export function ExportButton({ targetId, filename = 'dashboard' }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const element = document.getElementById(targetId)
      if (!element) return

      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#f8fafc',
      })

      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      })

      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const imgWidth = pageWidth - 20
      const imgHeight = (canvas.height * imgWidth) / canvas.width

      // Header
      pdf.setFontSize(10)
      pdf.setTextColor(100)
      pdf.text('DashWT — Dashboard Executivo · Welcome Trips', 10, 8)
      pdf.text(new Date().toLocaleDateString('pt-BR'), pageWidth - 10, 8, { align: 'right' })

      // Imagem do dashboard
      if (imgHeight <= pageHeight - 15) {
        pdf.addImage(imgData, 'PNG', 10, 12, imgWidth, imgHeight)
      } else {
        // Se maior que uma página, reduzir para caber
        const scaledHeight = pageHeight - 15
        const scaledWidth = (canvas.width * scaledHeight) / canvas.height
        pdf.addImage(imgData, 'PNG', 10, 12, scaledWidth, scaledHeight)
      }

      pdf.save(`${filename}.pdf`)
    } catch (err) {
      console.error('Export error:', err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-full hover:bg-slate-50 transition-colors disabled:opacity-50"
    >
      <Download size={14} />
      {exporting ? 'Exportando...' : 'PDF'}
    </button>
  )
}
