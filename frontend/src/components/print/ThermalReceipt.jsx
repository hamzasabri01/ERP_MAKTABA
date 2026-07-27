import { getCompanyName, getLogoUrl } from '../../lib/brand'
import { fmt } from '../../lib/api'
import './ThermalReceipt.css'

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
    remaining: 'الباقي',
    currency: 'درهم',
    footer: 'شكرا على زيارتكم',
  },
}

function getLang(language) {
  return String(language || 'fr').startsWith('ar') ? 'ar' : 'fr'
}

function lineTotalTtc(item) {
  const ht = Number(item.line_total || 0)
  return ht * (1 + Number(item.tax_rate || 0) / 100)
}

function unitPriceTtc(item) {
  return Number(item.unit_price || 0) * (1 + Number(item.tax_rate || 0) / 100)
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
  const logoUrl = getLogoUrl(settings)
  const company = getCompanyName(settings)
  const items = sale.items || []
  const itemsCount = items.reduce((acc, item) => acc + Number(item.quantity || 0), 0)
  const discountAmount = Math.max(0, Number(sale.subtotal || 0) + Number(sale.tax_amount || 0) - Number(sale.total_amount || 0))
  const footer = settings.receipt_footer || t.footer
  const client = sale.client_name && sale.client_name !== '-' && sale.client_name !== '—' ? sale.client_name : t.cashClient
  const remaining = Math.max(Number(sale.balance_due || 0), 0)

  return (
    <article className={`thermal-receipt ${className}`} dir={dir} lang={lang}>
      <header className="thermal-head">
        {logoUrl && <img src={logoUrl} alt="" />}
        <strong>{company || 'ProERP'}</strong>
        {(settings.address || settings.phone || settings.ice) && (
          <small>
            {settings.address && <span>{settings.address}</span>}
            {settings.phone && <span>{settings.phone}</span>}
            {settings.ice && <span>ICE: {settings.ice}</span>}
          </small>
        )}
        <div className="thermal-title">{t.title}</div>
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
              <td className="thermal-num">{fmt(item.quantity, 0)}</td>
              <td className="thermal-unit">{item.unit || 'U'}</td>
              <td className="thermal-item-name">
                <strong>{item.product_name || item.description}</strong>
                {item.description && item.product_name && item.description !== item.product_name && <span>{item.description}</span>}
              </td>
              <td className="thermal-money">{fmt(unitPriceTtc(item))}</td>
              <td className="thermal-money">{fmt(lineTotalTtc(item))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="thermal-totals">
        <div><span>{t.subtotal}</span><b>{fmt((sale.subtotal || 0) + (sale.tax_amount || 0))} {currency}</b></div>
        {Number(sale.tax_amount || 0) > 0 && <div><span>{t.tax}</span><b>{fmt(sale.tax_amount)} {currency}</b></div>}
        {discountAmount > 0 && <div><span>{t.discount}</span><b>{fmt(discountAmount)} {currency}</b></div>}
        <div className="thermal-grand"><span>{t.total}</span><b>{fmt(sale.total_amount)} {currency}</b></div>
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
