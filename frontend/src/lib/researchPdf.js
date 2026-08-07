import { jsPDF } from 'jspdf'
import { api } from './api'

const PAGE = { width: 210, height: 297, margin: 18, bottom: 20 }
const FONT_URLS = {
  regular: '/fonts/amiri/Amiri-Regular.ttf',
  bold: '/fonts/amiri/Amiri-Bold.ttf',
}

function safeFileName(value) {
  return String(value || 'research').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100)
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

async function installFonts(doc) {
  const [regular, bold] = await Promise.all(FONT_URLS.regular ? Object.values(FONT_URLS).map(async url => {
    const response = await fetch(url)
    if (!response.ok) throw new Error('Impossible de charger la police du document')
    return arrayBufferToBase64(await response.arrayBuffer())
  }) : [])
  doc.addFileToVFS('Amiri-Regular.ttf', regular)
  doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal')
  doc.addFileToVFS('Amiri-Bold.ttf', bold)
  doc.addFont('Amiri-Bold.ttf', 'Amiri', 'bold')
}

function createWriter(doc, request) {
  const rtl = request.language === 'ar'
  let y = PAGE.margin
  let pageNumber = 1
  const contentWidth = PAGE.width - PAGE.margin * 2

  const decorate = () => {
    doc.setDrawColor(23, 105, 224)
    doc.setLineWidth(.7)
    doc.line(PAGE.margin, 12, PAGE.width - PAGE.margin, 12)
    doc.setFont('Amiri', 'normal'); doc.setFontSize(9); doc.setTextColor(104, 125, 143)
    doc.text(`${pageNumber}`, PAGE.width / 2, PAGE.height - 9, { align: 'center' })
  }
  const newPage = () => {
    decorate(); doc.addPage('a4', 'portrait'); pageNumber += 1; y = PAGE.margin
  }
  const ensure = height => { if (y + height > PAGE.height - PAGE.bottom) newPage() }
  const text = (value, { size = 13, bold = false, color = [20, 49, 73], gap = 3, lineHeight = 1.35, align } = {}) => {
    const clean = String(value || '').replace(/\r/g, '').trim()
    if (!clean) return
    doc.setFont('Amiri', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color)
    const lines = doc.splitTextToSize(clean, contentWidth)
    const lineHeightMm = size * .3528 * lineHeight
    for (const line of lines) {
      ensure(lineHeightMm + gap)
      doc.text(String(line), rtl ? PAGE.width - PAGE.margin : PAGE.margin, y, {
        align: align || (rtl ? 'right' : 'left'), baseline: 'top',
        isInputRtl: rtl, isOutputRtl: rtl,
      })
      y += lineHeightMm
    }
    y += gap
  }
  const space = amount => { ensure(amount); y += amount }
  const image = (dataUrl, width, height) => {
    const maxW = contentWidth
    const maxH = 85
    const ratio = Math.min(maxW / width, maxH / height, 1)
    const drawW = width * ratio; const drawH = height * ratio
    ensure(drawH + 10)
    doc.addImage(dataUrl, undefined, (PAGE.width - drawW) / 2, y, drawW, drawH, undefined, 'MEDIUM')
    y += drawH + 4
  }
  return { text, space, image, newPage, finish: decorate, get pageCount() { return pageNumber } }
}

async function blobToImage(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob)
  })
  const dimensions = await new Promise((resolve, reject) => {
    const image = new Image(); image.onerror = reject; image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.src = dataUrl
  })
  return { dataUrl, ...dimensions }
}

async function loadApprovedAssets(request) {
  const assets = (request.assets || []).filter(asset => asset.approval_status === 'APPROVED')
  const loaded = []
  for (const asset of assets) {
    try {
      const response = await api.get(asset.download_url, { responseType: 'blob' })
      loaded.push({ asset, ...(await blobToImage(response.data)) })
    } catch { /* one broken optional image must not invalidate the PDF */ }
  }
  return loaded
}

async function buildResearchPdf(request) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true })
  await installFonts(doc)
  const writer = createWriter(doc, request)
  const rtl = request.language === 'ar'
  const approvedImages = await loadApprovedAssets(request)

  writer.space(42)
  writer.text(request.topic, { size: 28, bold: true, color: [20, 49, 73], gap: 8, align: 'center' })
  writer.text(`${request.subject || ''} • ${request.custom_academic_level || request.academic_level || ''}`, { size: 14, color: [80, 109, 130], align: 'center' })
  writer.space(25)
  writer.text('LIBRARY SABRI', { size: 18, bold: true, color: [23, 105, 224], align: 'center', gap: 0 })
  writer.text('مــكـتبة صــبــري', { size: 18, bold: true, color: [23, 105, 224], align: 'center' })
  writer.text(request.reference, { size: 11, color: [104, 125, 143], align: 'center' })

  if (request.include_cover) writer.newPage()
  if (request.include_toc && request.sections?.length) {
    writer.text(rtl ? 'المحتويات' : 'Table des matières', { size: 23, bold: true, color: [23, 105, 224] })
    request.sections.forEach((section, index) => writer.text(`${index + 1}. ${section.title}`, { size: 14, gap: 2 }))
    writer.newPage()
  }

  for (const [index, section] of (request.sections || []).entries()) {
    writer.text(`${index + 1}. ${section.title}`, { size: 20, bold: true, color: [23, 105, 224], gap: 5 })
    writer.text(section.content, { size: 13, lineHeight: 1.45, gap: 7 })
    const matching = approvedImages.filter(({ asset }) => Number(asset.section_id) === Number(section.id))
    const fallback = !matching.length && approvedImages[index] ? [approvedImages[index]] : []
    for (const picture of [...matching, ...fallback]) {
      writer.image(picture.dataUrl, picture.width, picture.height)
      writer.text(picture.asset.caption || picture.asset.alt_text, { size: 10, color: [80, 109, 130], align: 'center', gap: 1 })
      writer.text(`${picture.asset.license_info || ''}${picture.asset.source_url ? ` — ${picture.asset.source_url}` : ''}`, { size: 8, color: [104, 125, 143], align: 'center', gap: 5 })
    }
  }

  if (request.include_references && request.sources?.length) {
    writer.text(rtl ? 'المراجع والمصادر' : 'Références et sources', { size: 20, bold: true, color: [23, 105, 224], gap: 5 })
    request.sources.forEach((source, index) => {
      writer.text(`${index + 1}. ${source.title}${source.publisher ? ` — ${source.publisher}` : ''}`, { size: 12, bold: true, gap: 1 })
      if (source.url) writer.text(source.url, { size: 9, color: [23, 105, 224], gap: 3 })
    })
  }
  writer.finish()
  return { doc, pageCount: writer.pageCount }
}

export async function downloadResearchPdf(request) {
  const { doc, pageCount } = await buildResearchPdf(request)
  const blob = doc.output('blob')
  doc.save(`${safeFileName(request.reference)}.pdf`)
  return { pageCount, fileSize: blob.size }
}

export async function previewResearchPdf(request, previewWindow) {
  const { doc, pageCount } = await buildResearchPdf(request)
  const blob = doc.output('blob'); const url = URL.createObjectURL(blob)
  if (previewWindow && !previewWindow.closed) previewWindow.location.replace(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 120000)
  return { pageCount, fileSize: blob.size }
}
