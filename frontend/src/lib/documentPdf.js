import { fmt, isVatEnabled, paymentModeLabel } from './api'
import { getCompanyName, getLogoUrl } from './brand'

const BLUE = [23, 105, 224]
const NAVY = [20, 49, 73]
const MUTED = [91, 113, 128]
const LINE = [216, 230, 233]
const PAPER = [248, 251, 252]

function safeName(value, fallback) {
  return String(value || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
}

function dateLabel(value, withTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('fr-MA', withTime
    ? { dateStyle:'short', timeStyle:'short' }
    : { dateStyle:'short' }).format(date)
}

async function imageData(url) {
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function arabicBrandData() {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1100
    canvas.height = 180
    const context = canvas.getContext('2d')
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.direction = 'rtl'
    context.textAlign = 'right'
    context.textBaseline = 'middle'
    context.fillStyle = '#1769e0'
    context.font = '700 76px "Noto Kufi Arabic", Tahoma, Arial, sans-serif'
    context.fillText('مــــكـتبـة صـــبـري', 1060, 92)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function money(value, currency) {
  return `${fmt(value)} ${currency}`
}

function partyName(value, fallback) {
  const clean = String(value || '').trim()
  return !clean || clean === '—' || clean === '-' ? fallback : clean
}

function drawHeader(doc, { title, number, date, user, settings, logo, arabicBrand, wordmark }) {
  if (wordmark) {
    try { doc.addImage(wordmark, 'PNG', 14, 7, 86, 28.7, undefined, 'FAST') } catch { /* fallback below */ }
  } else if (logo) {
    try { doc.addImage(logo, undefined, 14, 12, 18, 18, undefined, 'FAST') } catch { /* text fallback below */ }
  }
  const brandX = logo ? 36 : 14
  if (!wordmark) {
    doc.setTextColor(...NAVY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.text(getCompanyName(settings) || 'LIBRARY SABRI', brandX, 18.5)
    if (arabicBrand) {
      try { doc.addImage(arabicBrand, 'PNG', brandX, 21.5, 48, 8, undefined, 'FAST') } catch { /* logo remains sufficient */ }
    }
  }
  doc.setTextColor(...MUTED)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const companyLine = [settings.address, settings.phone].filter(Boolean).join('  •  ')
  if (companyLine) doc.text(companyLine, 14, 39)

  doc.setTextColor(...BLUE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(title, 196, 17, { align:'right' })
  doc.setTextColor(...NAVY)
  doc.setFontSize(10)
  doc.text(number || '—', 196, 23, { align:'right' })
  doc.setTextColor(...MUTED)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Date : ${dateLabel(date)}`, 196, 28, { align:'right' })
  doc.text(`Utilisateur : ${user || '—'}`, 196, 32, { align:'right' })

  doc.setDrawColor(245, 158, 11)
  doc.setLineWidth(1.4)
  doc.line(14, 42, 54, 42)
  doc.setDrawColor(...BLUE)
  doc.line(54, 42, 196, 42)
}

function drawInfoBox(doc, x, y, width, title, lines) {
  doc.setFillColor(...PAPER)
  doc.setDrawColor(...LINE)
  doc.roundedRect(x, y, width, 26, 2, 2, 'FD')
  doc.setTextColor(...BLUE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text(title.toUpperCase(), x + 4, y + 6)
  doc.setTextColor(...NAVY)
  doc.setFontSize(8.5)
  lines.filter(Boolean).slice(0, 3).forEach((line, index) => {
    doc.setFont('helvetica', index === 0 ? 'bold' : 'normal')
    doc.text(String(line), x + 4, y + 12 + index * 5)
  })
}

function drawTotals(doc, startY, rows, currency, note) {
  const x = 120
  const width = 76
  const topRows = rows.slice(0, -1)
  const totalRow = rows.at(-1)
  const top = startY - 5
  const topHeight = topRows.length * 9
  const totalHeight = 17
  const panelHeight = topHeight + totalHeight
  doc.setFillColor(250, 252, 254)
  doc.setDrawColor(...LINE)
  doc.setLineWidth(.65)
  doc.roundedRect(x, top, width, panelHeight, 3, 3, 'FD')

  topRows.forEach((row, index) => {
    const baseline = top + 6 + index * 9
    doc.setTextColor(...MUTED)
    doc.setFont('helvetica', index === 0 ? 'normal' : 'bold')
    doc.setFontSize(9)
    doc.text(row[0], x + 5, baseline)
    doc.setTextColor(...NAVY)
    doc.setFont('helvetica', 'bold')
    doc.text(money(row[1], currency), x + width - 5, baseline, { align:'right' })
    if (index < topRows.length - 1) {
      doc.setDrawColor(...LINE)
      doc.setLineWidth(.25)
      doc.line(x + 4, top + (index + 1) * 9, x + width - 4, top + (index + 1) * 9)
    }
  })

  const totalY = top + topHeight
  doc.setFillColor(...BLUE)
  doc.roundedRect(x + .7, totalY, width - 1.4, totalHeight - .7, 2.4, 2.4, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12.5)
  doc.text(totalRow[0], x + 5, totalY + 10.8)
  doc.text(money(totalRow[1], currency), x + width - 5, totalY + 10.8, { align:'right' })

  if (note) {
    doc.setTextColor(...MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text('Notes', 14, startY)
    doc.setTextColor(...NAVY)
    doc.text(doc.splitTextToSize(String(note), 90), 14, startY + 6)
  }
  return top + panelHeight
}

function addFooter(doc, settings) {
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(...LINE)
    doc.line(14, 283, 196, 283)
    doc.setTextColor(...MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(`${getCompanyName(settings) || 'LIBRARY SABRI'} — Document généré par l'application locale`, 14, 288)
    doc.text(`Page ${page}/${pages}`, 196, 288, { align:'right' })
  }
}

async function pdfTools() {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  return { jsPDF, autoTable }
}

async function createSalePdf(sale, settings = {}) {
  const { jsPDF, autoTable } = await pdfTools()
  const doc = new jsPDF({ unit:'mm', format:'a4', compress:true })
  const currency = sale.currency_code || settings.currency || 'MAD'
  const vat = isVatEnabled(settings)
  const logo = await imageData(getLogoUrl(settings))
  const wordmark = await imageData('/brand/library-sabri-wordmark.png')
  const arabicBrand = arabicBrandData()
  const title = {
    invoice:'FACTURE',
    quote:'DEVIS',
    delivery:'BON DE LIVRAISON',
    credit_note:'AVOIR',
  }[sale.doc_type] || 'DOCUMENT'

  drawHeader(doc, { title, number:sale.number, date:sale.date_time, user:sale.created_by_name, settings, logo, arabicBrand, wordmark })
  drawInfoBox(doc, 14, 48, 87, 'Client', [partyName(sale.client_name, 'Client comptoir')])
  drawInfoBox(doc, 109, 48, 87, 'Paiement', [
    `Mode : ${paymentModeLabel(sale.payment_mode)}`,
    `Payé : ${money(sale.paid_amount, currency)}`,
    `Reste : ${money(sale.balance_due, currency)}`,
  ])

  const head = [['DÉSIGNATION', 'QTÉ', 'PU HT', 'REMISE', ...(vat ? ['TVA'] : []), 'TOTAL']]
  const body = (sale.items || []).map(item => [
    item.product_name || item.description || 'Article',
    fmt(item.quantity, 0),
    money(item.unit_price, currency),
    `${fmt(item.discount || 0)} %`,
    ...(vat ? [`${fmt(item.tax_rate || 0)} %`] : []),
    money(item.line_total, currency),
  ])
  autoTable(doc, {
    startY:80,
    head,
    body,
    theme:'plain',
    margin:{ left:14, right:14, bottom:28 },
    styles:{ font:'helvetica', fontSize:8, cellPadding:2.7, textColor:NAVY, lineColor:LINE, lineWidth:{ bottom:.15 } },
    headStyles:{ fillColor:BLUE, textColor:[255,255,255], fontStyle:'bold', cellPadding:3.2 },
    columnStyles:{
      0:{ cellWidth:'auto' },
      1:{ halign:'center', cellWidth:15 },
      2:{ halign:'right', cellWidth:27 },
      3:{ halign:'center', cellWidth:21 },
      ...(vat ? { 4:{ halign:'center', cellWidth:17 }, 5:{ halign:'right', cellWidth:29 } } : { 4:{ halign:'right', cellWidth:31 } }),
    },
    alternateRowStyles:{ fillColor:PAPER },
  })
  const totals = [['Sous-total HT', sale.subtotal]]
  if (vat) totals.push(['TVA', sale.tax_amount])
  totals.push(['TOTAL', sale.total_amount])
  drawTotals(doc, Math.max(doc.lastAutoTable.finalY + 10, 118), totals, currency, sale.notes)
  addFooter(doc, settings)
  return doc
}

async function createPurchasePdf(purchase, settings = {}) {
  const { jsPDF, autoTable } = await pdfTools()
  const doc = new jsPDF({ unit:'mm', format:'a4', compress:true })
  const currency = purchase.currency_code || settings.currency || 'MAD'
  const vat = isVatEnabled(settings)
  const logo = await imageData(getLogoUrl(settings))
  const wordmark = await imageData('/brand/library-sabri-wordmark.png')
  const arabicBrand = arabicBrandData()
  drawHeader(doc, { title:'BON DE COMMANDE', number:purchase.number, date:purchase.date_time, user:purchase.created_by_name, settings, logo, arabicBrand, wordmark })
  drawInfoBox(doc, 14, 48, 87, 'Fournisseur', [partyName(purchase.supplier_name, 'Fournisseur')])
  drawInfoBox(doc, 109, 48, 87, 'Commande', [
    `Livraison prévue : ${dateLabel(purchase.expected_date)}`,
    `Payé : ${money(purchase.paid_amount, currency)}`,
    `Reste : ${money(Number(purchase.total_amount) - Number(purchase.paid_amount), currency)}`,
  ])
  const head = [['DÉSIGNATION', 'QTÉ', 'UNITÉ', 'PU HT', ...(vat ? ['TVA'] : []), 'TOTAL']]
  const body = (purchase.items || []).map(item => [
    item.product_name || item.description || 'Article',
    fmt(item.quantity, 0),
    item.purchase_unit || 'pcs',
    money(item.unit_price, currency),
    ...(vat ? [`${fmt(item.tax_rate || 0)} %`] : []),
    money(item.line_total, currency),
  ])
  autoTable(doc, {
    startY:80,
    head,
    body,
    theme:'plain',
    margin:{ left:14, right:14, bottom:28 },
    styles:{ font:'helvetica', fontSize:8, cellPadding:2.7, textColor:NAVY, lineColor:LINE, lineWidth:{ bottom:.15 } },
    headStyles:{ fillColor:BLUE, textColor:[255,255,255], fontStyle:'bold', cellPadding:3.2 },
    columnStyles:{
      0:{ cellWidth:'auto' },
      1:{ halign:'center', cellWidth:15 },
      2:{ halign:'center', cellWidth:22 },
      3:{ halign:'right', cellWidth:29 },
      ...(vat ? { 4:{ halign:'center', cellWidth:17 }, 5:{ halign:'right', cellWidth:29 } } : { 4:{ halign:'right', cellWidth:31 } }),
    },
    alternateRowStyles:{ fillColor:PAPER },
  })
  const totals = [['Sous-total HT', purchase.subtotal]]
  if (vat) totals.push(['TVA', purchase.tax_amount])
  totals.push(['TOTAL', purchase.total_amount])
  drawTotals(doc, Math.max(doc.lastAutoTable.finalY + 10, 118), totals, currency, purchase.notes)
  addFooter(doc, settings)
  return doc
}

function openPdfDocument(doc, previewWindow) {
  const blobUrl = URL.createObjectURL(doc.output('blob'))
  if (previewWindow && !previewWindow.closed) {
    previewWindow.location.replace(blobUrl)
  } else {
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.target = '_blank'
    anchor.rel = 'noopener'
    anchor.click()
  }
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120000)
}

export async function downloadSalePdf(sale, settings = {}) {
  const doc = await createSalePdf(sale, settings)
  doc.save(`${safeName(sale.number, 'facture')}.pdf`)
}

export async function previewSalePdf(sale, settings = {}, previewWindow) {
  const doc = await createSalePdf(sale, settings)
  openPdfDocument(doc, previewWindow)
}

export async function downloadPurchasePdf(purchase, settings = {}) {
  const doc = await createPurchasePdf(purchase, settings)
  doc.save(`${safeName(purchase.number, 'achat')}.pdf`)
}

export async function previewPurchasePdf(purchase, settings = {}, previewWindow) {
  const doc = await createPurchasePdf(purchase, settings)
  openPdfDocument(doc, previewWindow)
}
