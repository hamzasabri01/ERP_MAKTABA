import './ProductLabels.css'

const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111']
const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100']
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']

export function ean13Bits(value) {
  const code = String(value || '').trim()
  if (!isValidEan13(code)) return ''
  const left = [...code.slice(1, 7)].map((digit, index) => (
    PARITY[Number(code[0])][index] === 'L' ? L[Number(digit)] : G[Number(digit)]
  )).join('')
  const right = [...code.slice(7)].map(digit => R[Number(digit)]).join('')
  return `101${left}01010${right}101`
}

export function isValidEan13(value) {
  const code = String(value || '').trim()
  if (!/^\d{13}$/.test(code)) return false
  const weightedSum = [...code.slice(0, 12)].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  )
  return Number(code[12]) === (10 - weightedSum % 10) % 10
}

export function Ean13Barcode({ value }) {
  const bits = ean13Bits(value)
  if (!bits) return <div className="product-label-no-ean">EAN-13 invalide</div>
  const code = String(value)
  return (
    <div className="product-label-barcode" aria-label={`EAN ${value}`}>
      <svg viewBox="-11 0 113 48" role="img" preserveAspectRatio="none">
        {[...bits].map((bit, index) => bit === '1' ? (
          <rect
            key={index}
            x={index}
            y="0"
            width="1"
            height={index < 3 || (index >= 45 && index < 50) || index >= 92 ? 48 : 42}
          />
        ) : null)}
      </svg>
      <div className="product-label-ean-digits" aria-hidden="true">
        <span>{code[0]}</span>
        <span>{code.slice(1, 7)}</span>
        <span>{code.slice(7)}</span>
      </div>
    </div>
  )
}

export function ProductLabel({ product, currency = 'MAD', showName = true, showPrice = true }) {
  return (
    <article className="product-price-label">
      {showName && <strong className="product-label-name">{product.name}</strong>}
      <Ean13Barcode value={product.barcode} />
      {showPrice && <div className="product-label-price">{Number(product.sale_price || 0).toFixed(2)} <span>{currency}</span></div>}
    </article>
  )
}

export function ProductLabelsPrintDocument({
  products,
  copies = 1,
  size = '50x30',
  currency = 'MAD',
  showName = true,
  showPrice = true,
}) {
  const labels = products.flatMap(product => Array.from(
    { length: Math.min(Math.max(Number(copies) || 1, 1), 20) },
    (_, copy) => ({ product, key:`${product.id}-${copy}` }),
  ))
  return (
    <div className={`product-label-print-active label-size-${size}`}>
      {labels.map(({ product, key }) => (
        <ProductLabel key={key} product={product} currency={currency} showName={showName} showPrice={showPrice} />
      ))}
    </div>
  )
}

export async function printProductLabels() {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  if (document.fonts?.ready) await document.fonts.ready
  window.print()
}

export async function downloadProductLabelsPdf({
  products,
  copies = 1,
  size = '50x30',
  currency = 'MAD',
  showName = true,
  showPrice = true,
}) {
  const { jsPDF } = await import('jspdf')
  const dimensions = {
    '40x30':[40, 30],
    '50x30':[50, 30],
    '70x37':[70, 37],
  }
  const [labelWidth, labelHeight] = dimensions[size] || dimensions['50x30']
  const margin = 8
  const gap = 2
  const columns = Math.max(1, Math.floor((210 - margin * 2 + gap) / (labelWidth + gap)))
  const rows = Math.max(1, Math.floor((297 - margin * 2 + gap) / (labelHeight + gap)))
  const labelsPerPage = columns * rows
  const labels = products.flatMap(product => Array.from(
    { length:Math.min(Math.max(Number(copies) || 1, 1), 20) },
    () => product,
  ))
  const pdf = new jsPDF({ unit:'mm', format:'a4', orientation:'portrait', compress:true })

  labels.forEach((product, index) => {
    if (index > 0 && index % labelsPerPage === 0) pdf.addPage()
    const pageIndex = index % labelsPerPage
    const column = pageIndex % columns
    const row = Math.floor(pageIndex / columns)
    const x = margin + column * (labelWidth + gap)
    const y = margin + row * (labelHeight + gap)
    const bits = ean13Bits(product.barcode)

    pdf.setDrawColor(205, 214, 226)
    pdf.setLineWidth(.2)
    pdf.roundedRect(x, y, labelWidth, labelHeight, 1.5, 1.5)

    let barY = y + 3
    if (showName) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(labelWidth <= 40 ? 7 : 8)
      pdf.setTextColor(11, 35, 68)
      const maxNameWidth = labelWidth - 5
      let name = String(product.name || '')
      while (name.length > 3 && pdf.getTextWidth(name) > maxNameWidth) name = `${name.slice(0, -2)}…`
      pdf.text(name, x + labelWidth / 2, y + 4.2, { align:'center' })
      barY = y + 6
    }

    if (bits) {
      const quietModules = 113
      const drawableWidth = labelWidth - 5
      const moduleWidth = drawableWidth / quietModules
      const barsX = x + 2.5 + 11 * moduleWidth
      const normalHeight = labelHeight >= 37 ? 15 : 12
      pdf.setFillColor(0, 0, 0)
      ;[...bits].forEach((bit, bitIndex) => {
        if (bit !== '1') return
        const guard = bitIndex < 3 || (bitIndex >= 45 && bitIndex < 50) || bitIndex >= 92
        pdf.rect(barsX + bitIndex * moduleWidth, barY, moduleWidth * 1.02, guard ? normalHeight + 2 : normalHeight, 'F')
      })
      const code = String(product.barcode)
      const digitY = barY + normalHeight + 3.2
      pdf.setFont('courier', 'bold')
      pdf.setFontSize(labelWidth <= 40 ? 8 : 9)
      pdf.setTextColor(0, 0, 0)
      pdf.text(code[0], x + 3, digitY)
      pdf.text(code.slice(1, 7), x + labelWidth * .38, digitY, { align:'center' })
      pdf.text(code.slice(7), x + labelWidth * .76, digitY, { align:'center' })
    }

    if (showPrice) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(labelWidth <= 40 ? 10 : 12)
      pdf.setTextColor(7, 95, 216)
      pdf.text(
        `${Number(product.sale_price || 0).toFixed(2)} ${currency}`,
        x + labelWidth / 2,
        y + labelHeight - 2.2,
        { align:'center' },
      )
    }
  })

  pdf.save(`etiquettes-ean-${new Date().toISOString().slice(0, 10)}.pdf`)
}
