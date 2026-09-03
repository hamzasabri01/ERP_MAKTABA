import { getCompanyName, getLogoUrl } from '../../lib/brand'
import { fmt, isVatEnabled } from '../../lib/api'
import './ThermalReceipt.css'

const CODE128_PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212',
  '112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131',
  '311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321',
  '112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121',
  '313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114',
  '122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212',
  '124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113',
  '114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112',
]

function Code128Barcode({ value, compact = false }) {
  const text = String(value || '').replace(/[^\x20-\x7E]/g, '')
  if (!text) return null

  const values = [...text].map(char => char.charCodeAt(0) - 32)
  const checksum = (104 + values.reduce((sum, code, index) => sum + code * (index + 1), 0)) % 103
  const sequence = [104, ...values, checksum, 106]
  const modules = sequence.map(code => CODE128_PATTERNS[code]).join('')
  const totalWidth = [...modules].reduce((sum, width) => sum + Number(width), 0)
  const bars = []
  let x = 0
  let black = true

  for (const width of modules) {
    const moduleWidth = Number(width)
    if (black) bars.push(<rect key={x} x={x} y="0" width={moduleWidth} height="34" />)
    x += moduleWidth
    black = !black
  }

  return (
    <div className={`thermal-barcode ${compact ? 'is-compact' : ''}`} aria-label={`Code-barres ${text}`}>
      <svg viewBox={`0 0 ${totalWidth} 34`} role="img" aria-hidden="true" preserveAspectRatio="none">
        {bars}
      </svg>
      <span>{text}</span>
    </div>
  )
}

export async function printThermalReceipt() {
  // Let React commit the print portal before the browser snapshots the page.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  if (document.fonts?.ready) await document.fonts.ready

  const images = [...document.querySelectorAll('.thermal-print-active img')]
  await Promise.allSettled(images.map(image => {
    if (image.complete) return image.decode?.() || Promise.resolve()
    return new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true })
      image.addEventListener('error', resolve, { once: true })
    })
  }))

  window.print()
}

function receiptPaperWidth(settings = {}) {
  return Number(settings.receipt_paper_width) === 58 ? 58 : 80
}

export function ThermalReceiptPrintDocument({ sale, settings = {}, language = 'fr' }) {
  const copies = Math.min(Math.max(Number(settings.receipt_copies) || 1, 1), 5)
  const width = receiptPaperWidth(settings)
  return (
    <div className={`thermal-print-active thermal-paper-${width}`} style={{ '--thermal-paper-width': `${width}mm` }}>
      {Array.from({ length: copies }, (_, index) => (
        <div className="thermal-ticket-copy" key={index}>
          <ThermalReceipt sale={sale} settings={settings} language={language} />
        </div>
      ))}
    </div>
  )
}

const labels = {
  fr: {
    title: 'TICKET POS',
    ticketNo: 'N° ticket',
    date: 'Date',
    cashier: 'Caissier',
    client: 'Client',
    cashClient: 'CLIENT COMPTOIR',
    qty: 'Qté',
    unit: 'Unité',
    item: 'Article',
    price: 'Prix',
    total: 'Total',
    subtotal: 'Sous-total',
    tax: 'TVA',
    discount: 'Remise',
    itemsCount: 'Total articles',
    payment: 'Paiement',
    paid: 'Payé',
    advance: 'Avance',
    remaining: 'Reste',
    currency: 'MAD',
    footer: 'Merci pour votre visite',
  },
  ar: {
    title: 'تذكرة POS',
    ticketNo: 'رقم الطلب',
    date: 'التاريخ',
    cashier: 'البائع',
    client: 'المستلم',
    cashClient: 'زبون نقدي',
    qty: 'الكمية',
    unit: 'الوحدة',
    item: 'السلعة',
    price: 'السعر',
    total: 'المجموع',
    subtotal: 'المجموع الفرعي',
    tax: 'الضريبة',
    discount: 'الخصم',
    itemsCount: 'مجموع المواد',
    payment: 'الدفع',
    paid: 'المدفوع',
    advance: 'التسبيق',
    remaining: 'الباقي',
    currency: 'درهم',
    footer: 'شكرا على زيارتكم',
  },
}

function getLang(language) {
  return String(language || 'fr').startsWith('ar') ? 'ar' : 'fr'
}

function lineTotalTtc(item, vatEnabled) {
  const ht = Number(item.line_total || 0)
  return ht * (vatEnabled ? (1 + Number(item.tax_rate || 0) / 100) : 1)
}

function unitPriceTtc(item, vatEnabled) {
  return Number(item.unit_price || 0) * (vatEnabled ? (1 + Number(item.tax_rate || 0) / 100) : 1)
}

function formatDate(value, lang) {
  if (!value) return '-'
  return new Date(value).toLocaleString(lang === 'ar' ? 'ar-MA' : 'fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ThermalReceipt({ sale, settings = {}, language = 'fr', className = '' }) {
  if (!sale) return null

  const lang = getLang(language || settings.app_language)
  const t = labels[lang]
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const currency = settings.currency || t.currency
  const vatEnabled = isVatEnabled(settings)
  const logoUrl = getLogoUrl(settings)
  const paperWidth = receiptPaperWidth(settings)
  const company = getCompanyName(settings)
  const items = sale.items || []
  const itemsCount = items.reduce((acc, item) => acc + Number(item.quantity || 0), 0)
  const discountAmount = Math.max(0, Number(sale.subtotal || 0) + Number(sale.tax_amount || 0) - Number(sale.total_amount || 0))
  const footer = settings.receipt_footer || t.footer
  const client = sale.client_name && sale.client_name !== '-' && sale.client_name !== '—' ? sale.client_name : t.cashClient
  const remaining = Math.max(Number(sale.balance_due || 0), 0)

  return (
    <article
      className={`thermal-receipt thermal-paper-${paperWidth} ${className}`}
      style={{ '--thermal-paper-width': `${paperWidth}mm` }}
      dir={dir}
      lang={lang}
    >
      <header className="thermal-head">
        {settings.receipt_show_logo !== false && logoUrl && <img src={logoUrl} alt="" />}
        <strong>{company || 'LIBRARY SABRI'}</strong>
        {((settings.receipt_show_address !== false && settings.address)
          || (settings.receipt_show_phone !== false && settings.phone)
          || (settings.receipt_show_ice !== false && settings.ice)) && (
          <small>
            {settings.receipt_show_address !== false && settings.address && <span>{settings.address}</span>}
            {settings.receipt_show_phone !== false && settings.phone && <span>{settings.phone}</span>}
            {settings.receipt_show_ice !== false && settings.ice && <span>ICE: {settings.ice}</span>}
          </small>
        )}
        <div className="thermal-title">{t.title}</div>
        {settings.receipt_show_barcode !== false && (
          <Code128Barcode value={sale.number} compact={paperWidth === 58} />
        )}
      </header>

      <section className="thermal-meta">
        <div><span>{t.ticketNo}</span><b>{sale.number || '-'}</b></div>
        <div><span>{t.date}</span><b>{formatDate(sale.date_time, lang)}</b></div>
        <div><span>{t.cashier}</span><b>{sale.created_by_name || '-'}</b></div>
        <div className="thermal-client"><span>{t.client}</span><b>{client}</b></div>
      </section>

      <table className="thermal-table">
        <colgroup>
          <col className="thermal-col-qty" />
          <col className="thermal-col-unit" />
          <col className="thermal-col-item" />
          <col className="thermal-col-price" />
          <col className="thermal-col-total" />
        </colgroup>
        <thead>
          <tr>
            <th>{t.qty}</th>
            <th>{t.unit}</th>
            <th>{t.item}</th>
            <th>{t.price}</th>
            <th>{t.total}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id || index}>
              <td className="thermal-num">{fmt(item.quantity, 0)}{item.sale_unit ? ` ${item.sale_unit}` : ''}</td>
              <td className="thermal-unit">{item.unit || 'U'}</td>
              <td className="thermal-item-name">
                <strong>{item.product_name || item.description}</strong>
                {item.description && item.product_name && item.description !== item.product_name && <span>{item.description}</span>}
              </td>
              <td className="thermal-money">{fmt(unitPriceTtc(item, vatEnabled))}</td>
              <td className="thermal-money">{fmt(lineTotalTtc(item, vatEnabled))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="thermal-totals">
        <div><span>{t.subtotal}</span><b>{fmt((sale.subtotal || 0) + (sale.tax_amount || 0))} {currency}</b></div>
        {vatEnabled && Number(sale.tax_amount || 0) > 0 ? <div><span>{t.tax}</span><b>{fmt(sale.tax_amount)} {currency}</b></div> : null}
        {discountAmount > 0 && <div><span>{t.discount}</span><b>{fmt(discountAmount)} {currency}</b></div>}
        <div className="thermal-grand"><span>{t.total}</span><b>{fmt(sale.total_amount)} {currency}</b></div>
        {Number(sale.advance_amount || 0) > 0 && <div><span>{t.advance}</span><b>- {fmt(sale.advance_amount)} {currency}</b></div>}
        {Number(sale.advance_amount || 0) > 0 && <div className="thermal-grand"><span>{t.remaining}</span><b>{fmt(remaining)} {currency}</b></div>}
        <div><span>{t.itemsCount}</span><b>{fmt(itemsCount, 0)}</b></div>
      </section>

      <section className="thermal-payment">
        <div><span>{t.payment}</span><b>{sale.payment_mode || '-'}</b></div>
        <div><span>{t.paid}</span><b>{fmt(sale.paid_amount)} {currency}</b></div>
        {remaining > 0 && <div><span>{t.remaining}</span><b>{fmt(remaining)} {currency}</b></div>}
      </section>

      <footer className="thermal-footer">
        <strong>{footer}</strong>
      </footer>
    </article>
  )
}
