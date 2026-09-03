// src/pages/SalesPage.jsx
import { useState, useEffect, useCallback, useMemo, useId } from 'react'
import { createPortal } from 'react-dom'
import { api, apiErrorMessage, fmt, fmtDate, fmtDateTime, isVatEnabled, operationHeaders, PAYMENT_METHODS, SETTLEMENT_METHODS, paymentModeLabel } from '../lib/api'
import { Plus, Search, Edit2, Trash2, Check, X, CreditCard, Eye, ShoppingCart, Printer, Download, FileCheck2, Sparkles, RotateCcw, Mail, Send, CalendarDays, FileSpreadsheet } from 'lucide-react'
import toast from 'react-hot-toast'
import { TableLoadingRow } from '../components/ui/LoadingStates'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { getCompanyName, getLogoUrl } from '../lib/brand'
import { downloadSalePdf, previewSalePdf } from '../lib/documentPdf'
import { useI18n } from '../lib/i18n'
import { storageJson, storageRemove, storageSet } from '../lib/safeStorage'
import { printThermalReceipt, ThermalReceiptPrintDocument } from '../components/print/ThermalReceipt'
import './SalesPrint.css'
import './SalesPage.css'

const DOC_TYPES = [
  { value:'invoice',     label:'Factures' },
  { value:'quote',       label:'Devis' },
  { value:'delivery',    label:'Bons de livraison' },
  { value:'credit_note', label:'Avoirs' },
]

const DOC_TITLES = {
  invoice: 'Facture',
  quote: 'Devis',
  delivery: 'Bon de livraison',
  credit_note: 'Avoir',
}

const STATUS_LABELS = { draft:'Brouillon', confirmed:'Confirmé', partially_paid:'Partiellement payé', paid:'Payé', cancelled:'Annulé' }
const EMPTY_SALE = { doc_type:'invoice', client_id:'', date_time:'', notes:'', discount:0, payment_mode:'cash', paid_amount:0, advance_amount:0, items:[] }
const EMPTY_ITEM = { product_id:'', description:'', quantity:1, unit_price:0, purchase_price:0, discount:0, tax_rate:20, sale_unit:'' }
const PAGE_SIZE = 80
const SALES_DRAFT_KEY = 'maktaba_sales_document_draft_v1'

function readSalesDraft() {
  const saved = storageJson(SALES_DRAFT_KEY)
  if (saved?.version !== 1 || !saved.form || !Array.isArray(saved.form.items)) return null
  return {
    ...EMPTY_SALE,
    ...saved.form,
    items: saved.form.items.length ? saved.form.items : [{ ...EMPTY_ITEM }],
  }
}

function writeSalesDraft(form) {
  storageSet(SALES_DRAFT_KEY, JSON.stringify({
    version: 1,
    saved_at: new Date().toISOString(),
    form,
  }))
}

const localIsoDate = value => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const salesReportRange = period => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  if (period === 'weekly') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    end.setTime(start.getTime())
    end.setDate(start.getDate() + 6)
  } else if (period === 'monthly') {
    start.setDate(1)
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 0)
  } else if (period === 'yearly') {
    start.setMonth(0, 1)
    end.setFullYear(start.getFullYear(), 11, 31)
  }
  return { start_date: localIsoDate(start), end_date: localIsoDate(end) }
}

function buildSalePayload(form) {
  return {
    ...form,
    client_id: form.client_id || null,
    date_time: form.date_time || null,
    due_date: form.due_date || null,
    discount: form.discount || 0,
    paid_amount: 0,
    advance_amount: Number(form.advance_amount || 0),
    items: (form.items || []).filter(item => item.product_id).map(item => ({
      ...item,
      product_id: item.product_id || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      purchase_price: item.purchase_price || 0,
      discount: item.discount || 0,
      tax_rate: item.tax_rate ?? 0,
    })),
  }
}

function ProductSearchSelect({ products, value, onChange }) {
  const selectedProduct = products.find(product => product.id === Number(value))
  const [query, setQuery] = useState(selectedProduct?.name || '')
  const listId = useId()

  useEffect(() => {
    if (selectedProduct) setQuery(selectedProduct.name)
  }, [selectedProduct?.name])

  return (
    <div className="sales-product-search">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        aria-label="Rechercher et sélectionner un produit"
        list={listId}
        placeholder="Rechercher un produit…"
        value={query}
        onChange={event => {
          const nextQuery = event.target.value
          setQuery(nextQuery)
          const match = products.find(product => product.name?.toLocaleLowerCase() === nextQuery.trim().toLocaleLowerCase())
          if (match) {
            const accepted = onChange(String(match.id))
            if (accepted === false) setQuery('')
          }
          else if (value) onChange('')
        }}
      />
      <datalist id={listId}>
        {products.map(product => <option key={product.id} value={product.name}>{product.barcode || ''}</option>)}
      </datalist>
    </div>
  )
}

export default function SalesPage() {
  const confirm = useConfirm()
  const { language } = useI18n()
  const [docType, setDocType]   = useState('invoice')
  const [sales, setSales]       = useState([])
  const [clients, setClients]   = useState([])
  const [products, setProducts] = useState([])
  const [q, setQ]               = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [modal, setModal]       = useState(null) // null | 'form' | 'view' | 'pay'
  const [selected, setSelected] = useState(null)
  const [form, setForm]         = useState(EMPTY_SALE)
  const [saving, setSaving]     = useState(false)
  const [payAmt, setPayAmt]     = useState(0)
  const [payMode, setPayMode]   = useState('cash')
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)
  const [previewingPdf, setPreviewingPdf] = useState(false)
  const [settings, setSettings] = useState({})
  const [payments, setPayments] = useState([])
  const [timeline, setTimeline] = useState([])
  const [printTarget, setPrintTarget] = useState('')
  const [serverPreview, setServerPreview] = useState(null)
  const [returnForm, setReturnForm] = useState({ reason:'', resolution:'exchange', items:[], exchange_items:[] })
  const [returnSaving, setReturnSaving] = useState(false)
  const [serviceLineDraft, setServiceLineDraft] = useState(null)
  const [reportDialog, setReportDialog] = useState(false)
  const [reportSending, setReportSending] = useState(false)
  const [reportForm, setReportForm] = useState(() => ({ period_type:'monthly', ...salesReportRange('monthly') }))
  const [reportRecipients, setReportRecipients] = useState([])
  const [reportRecipientDraft, setReportRecipientDraft] = useState('')
  const currency = serverPreview?.currency_code || settings.currency || 'MAD'
  const paymentModes = SETTLEMENT_METHODS
  const vatEnabled = isVatEnabled(settings)
  const taxRates = String(settings.tax_rates || '0,7,10,14,20').split(',').map(Number).filter(Number.isFinite)

  const openReportDialog = () => {
    const hasCustomFilter = Boolean(dateFrom && dateTo)
    const savedRecipients = String(settings.report_email_recipients || settings.smtp_from_email || '').split(/[;,]/).map(value => value.trim().toLowerCase()).filter(Boolean)
    setReportForm({
      period_type: hasCustomFilter ? 'custom' : 'monthly',
      ...(hasCustomFilter ? { start_date:dateFrom, end_date:dateTo } : salesReportRange('monthly')),
    })
    setReportRecipients([...new Set(savedRecipients)])
    setReportRecipientDraft('')
    setReportDialog(true)
  }

  const changeReportPeriod = period => setReportForm(current => period === 'custom'
    ? { ...current, period_type:period }
    : { ...current, period_type:period, ...salesReportRange(period) })

  const normalizeRecipientList = value => String(value || '').split(/[;,\s]+/).map(item => item.trim().toLowerCase()).filter(Boolean)
  const isValidRecipient = value => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value)

  const addReportRecipients = rawValue => {
    const candidates = normalizeRecipientList(rawValue)
    const invalid = candidates.find(value => !isValidRecipient(value))
    if (invalid) {
      toast.error(`Adresse email invalide: ${invalid}`)
      return false
    }
    setReportRecipients(current => [...new Set([...current, ...candidates])])
    setReportRecipientDraft('')
    return true
  }

  const sendSalesReport = async () => {
    const pending = normalizeRecipientList(reportRecipientDraft)
    const recipients = [...new Set([...reportRecipients, ...pending])]
    if (!recipients.length) return toast.error('Ajoutez au moins une adresse email')
    const invalid = recipients.find(value => !isValidRecipient(value))
    if (invalid) return toast.error(`Adresse email invalide: ${invalid}`)
    if (!reportForm.start_date || !reportForm.end_date || reportForm.start_date > reportForm.end_date) return toast.error('La periode selectionnee est invalide')
    setReportSending(true)
    try {
      const { data } = await api.post('/reports/email/send', { ...reportForm, recipients:recipients.join(',') })
      toast.success(`Rapport envoye a ${data.recipients?.length || recipients.length} destinataire(s)`)
      setReportDialog(false)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Impossible d'envoyer le rapport"))
    } finally {
      setReportSending(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [salesRes, clientsRes, productsRes, settingsRes] = await Promise.allSettled([
        api.get('/sales', { params: {
          doc_type: docType,
          q: q || undefined,
          status: statusFilter || undefined,
          client_id: clientFilter || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          skip: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        } }),
        api.get('/clients', { params: { limit: 500 } }),
        api.get('/products', { params: { limit: 500 } }),
        api.get('/settings'),
      ])

      if (salesRes.status === 'rejected') {
        throw salesRes.reason
      }

      setSales(Array.isArray(salesRes.value.data) ? salesRes.value.data : [])
      if (clientsRes.status === 'fulfilled') setClients(Array.isArray(clientsRes.value.data) ? clientsRes.value.data : [])
      if (productsRes.status === 'fulfilled') setProducts(Array.isArray(productsRes.value.data) ? productsRes.value.data : [])
      if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value.data || {})

      ;[clientsRes, productsRes, settingsRes].forEach(res => {
        if (res.status === 'rejected') console.warn('Optional sales data failed to load', res.reason)
      })
    } catch (e) {
      const message = apiErrorMessage(e, 'Impossible de charger les ventes. Verifiez la connexion API.')
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [docType, q, statusFilter, clientFilter, dateFrom, dateTo, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [docType, q, statusFilter, clientFilter, dateFrom, dateTo])
  useEffect(() => {
    const resetPrintTarget = () => setPrintTarget('')
    window.addEventListener('afterprint', resetPrintTarget)
    return () => window.removeEventListener('afterprint', resetPrintTarget)
  }, [])

  const openCreate = () => {
    const savedDraft = readSalesDraft()
    setForm(savedDraft || { ...EMPTY_SALE, doc_type: docType, items: [{ ...EMPTY_ITEM }] })
    setServerPreview(null)
    setSelected(null); setModal('form')
    if (savedDraft) toast.success('Brouillon récupéré automatiquement')
  }
  const openEdit = async (summary) => {
    try {
      const { data: sale } = await api.get(`/sales/${summary.id}`)
      const items = (sale.items || []).map(item => ({
        product_id: item.product_id || '',
        description: item.product_name || item.description || '',
        quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)),
        unit_price: item.unit_price,
        purchase_price: item.purchase_price,
        discount: item.discount,
        tax_rate: item.tax_rate,
        product_type: products.find(product => product.id === item.product_id)?.product_type,
        sale_unit: item.sale_unit || products.find(product => product.id === item.product_id)?.unit || 'pcs',
        base_unit: products.find(product => product.id === item.product_id)?.unit || 'pcs',
        secondary_unit: products.find(product => product.id === item.product_id)?.sale_unit || '',
        secondary_factor: Number(products.find(product => product.id === item.product_id)?.sale_to_base_factor || 1),
        secondary_price: Number(products.find(product => product.id === item.product_id)?.sale_unit_price || 0),
        base_price: Number(products.find(product => product.id === item.product_id)?.sale_price || item.unit_price || 0),
      }))
      setForm({
        doc_type: sale.doc_type,
        client_id: sale.client_id || '',
        date_time: sale.date_time?.slice(0, 16) || '',
        notes: sale.notes,
        discount: sale.discount,
        payment_mode: sale.payment_mode,
        paid_amount: sale.paid_amount,
        advance_amount: sale.advance_amount || 0,
        items: items.length ? items : [{ ...EMPTY_ITEM }],
      })
      setServerPreview(null)
      setSelected(sale)
      setModal('form')
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Impossible de charger le document'))
    }
  }
  const openView = async (s) => {
    const [saleRes, paymentRes, auditRes] = await Promise.allSettled([
      api.get(`/sales/${s.id}`),
      api.get('/payments', { params: { document_type: 'sale', document_id: s.id } }),
      api.get('/audit', { params: { entity: 'sale', entity_id: s.id, limit: 20 } }),
    ])
    if (saleRes.status === 'rejected') throw saleRes.reason
    setSelected(saleRes.value.data)
    setPayments(paymentRes.status === 'fulfilled' ? paymentRes.value.data || [] : [])
    setTimeline(auditRes.status === 'fulfilled' ? auditRes.value.data || [] : [])
    setModal('view')
  }
  const printDocument = async () => {
    if (!selected || previewingPdf) return
    const previewWindow = window.open('', '_blank')
    if (previewWindow) {
      previewWindow.document.title = 'Préparation du PDF…'
      previewWindow.document.body.innerHTML = '<p style="font:16px system-ui;padding:24px">Préparation du PDF…</p>'
    }
    setPreviewingPdf(true)
    try {
      await previewSalePdf(selected, settings, previewWindow)
    } catch (error) {
      previewWindow?.close()
      toast.error('Impossible de préparer le PDF')
    } finally {
      setPreviewingPdf(false)
    }
  }
  const printTicket = async () => {
    setPrintTarget('ticket')
    await printThermalReceipt()
  }
  const openReturn = () => {
    setReturnForm({
      reason:'',
      resolution:'exchange',
      items:(selected.items || []).map(item => {
        const product = products.find(row => row.id === item.product_id)
        return {
          sale_item_id:item.id,
          name:item.product_name || item.description,
          max:item.quantity,
          sale_unit:item.sale_unit || product?.unit || 'pcs',
          quantity:0,
          condition:'resalable',
          restock:product?.product_type !== 'service',
          product_type:product?.product_type || '',
          credit_unit:Number(item.total_amount || item.line_total || 0) / Math.max(Number(item.quantity) || 1, 1),
        }
      }),
      exchange_items:[],
    })
    setModal('return')
  }
  const submitReturn = async () => {
    const items = returnForm.items
      .filter(item => Number(item.quantity) > 0)
      .map(({ sale_item_id, quantity, condition, restock }) => ({
        sale_item_id,
        quantity:Number(quantity),
        condition,
        restock:Boolean(restock && condition === 'resalable'),
      }))
    if (!items.length) return toast.error('Sélectionnez au moins un article')
    if (returnForm.reason.trim().length < 3) return toast.error('Indiquez le motif du retour')
    const exchangeItems = returnForm.exchange_items
      .filter(item => item.product_id && Number(item.quantity) > 0)
      .map(item => ({
        product_id:Number(item.product_id),
        description:item.description,
        quantity:Number(item.quantity),
        unit_price:Number(item.unit_price),
        discount:0,
        tax_rate:Number(item.tax_rate || 0),
        price_override_reason:item.price_override_reason || '',
      }))
    if (returnForm.resolution === 'exchange' && !exchangeItems.length) {
      return toast.error('Ajoutez au moins un article de remplacement')
    }
    if (returnSaving) return
    setReturnSaving(true)
    try {
      const { data } = await api.post(`/sales/${selected.id}/return`, {
        items,
        reason:returnForm.reason,
        resolution:returnForm.resolution,
        exchange_items:returnForm.resolution === 'exchange' ? exchangeItems : [],
      }, { headers:operationHeaders(undefined) })
      const difference = Number(data.price_difference || 0)
      const settlement = difference > 0
        ? `Le client doit payer ${fmt(difference)} ${currency}`
        : difference < 0
          ? `À rembourser au client : ${fmt(Math.abs(difference))} ${currency}`
          : 'Échange équilibré, aucun montant restant'
      toast.success(returnForm.resolution === 'exchange'
        ? `Échange enregistré (${data.exchange_invoice_number}). ${settlement}`
        : 'Retour enregistré avec mise à jour précise du stock')
      setModal(null)
      load()
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Retour impossible'))
    } finally {
      setReturnSaving(false)
    }
  }

  const returnCreditBeforeDiscount = returnForm.items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.credit_unit) || 0), 0
  )
  const returnCredit = returnCreditBeforeDiscount * (1 - Number(selected?.discount || 0) / 100)
  const exchangeTotal = returnForm.exchange_items.reduce(
    (sum, item) => {
      const base = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)
      const taxFactor = vatEnabled && (settings.price_tax_mode || 'exclusive') === 'exclusive'
        ? 1 + Number(item.tax_rate || 0) / 100
        : 1
      return sum + base * taxFactor
    }, 0
  )
  const exchangeDifference = exchangeTotal - returnCredit
  const addExchangeItem = () => setReturnForm(form => ({
    ...form,
    exchange_items:[...form.exchange_items, { product_id:'', description:'', quantity:1, unit_price:0, tax_rate:0 }],
  }))
  const updateExchangeItem = (index, patch) => setReturnForm(form => ({
    ...form,
    exchange_items:form.exchange_items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
  }))
  const selectExchangeProduct = (index, productId) => {
    const product = products.find(item => item.id === Number(productId))
    updateExchangeItem(index, {
      product_id:productId,
      description:product?.name || '',
      unit_price:Number(product?.sale_price || 0),
      tax_rate:product?.tva_enabled ? Number(product.tax_rate || 0) : 0,
      price_override_reason:'',
    })
  }

  const handleConfirm = async (s) => {
    try { await api.post(`/sales/${s.id}/confirm`, {}, { headers: operationHeaders(s.version) }); toast.success('Confirmé'); load() }
    catch(e) { toast.error(apiErrorMessage(e, 'Erreur')) }
  }
  const handleCancel = async (s) => {
    const ok = await confirm({
      title: 'Annuler la vente',
      message: `Annuler ${s.number || 'ce document'} ? Le stock sera ajuste si le document est confirme.`,
      confirmText: 'Annuler la vente',
      tone: 'danger',
    })
    if (!ok) return
    try { await api.post(`/sales/${s.id}/cancel`, {}, { headers: operationHeaders(s.version) }); toast.success('Annulé'); load() }
    catch(e) { toast.error(apiErrorMessage(e, 'Erreur')) }
  }
  const handleConvertQuote = async (s) => {
    const ok = await confirm({
      title: 'Convertir en facture',
      message: `Convertir ${s.number} en facture ? Le stock sera verifie maintenant puis reserve a la confirmation.`,
      confirmText: 'Convertir',
      tone: 'success',
    })
    if (!ok) return
    try {
      const { data } = await api.post(
        `/sales/${s.id}/convert-to-invoice`,
        {},
        { headers: operationHeaders(s.version) },
      )
      toast.success(`Facture creee: ${data.number}`)
      setDocType('invoice')
      load()
    } catch(e) { toast.error(apiErrorMessage(e, 'Conversion impossible')) }
  }
  const handleDownload = async (s) => {
    if (downloadingId === s.id) return
    setDownloadingId(s.id)
    try {
      const { data } = await api.get(`/sales/${s.id}`)
      await downloadSalePdf(data, settings)
      toast.success('PDF téléchargé')
    } catch(e) { toast.error(apiErrorMessage(e, 'Téléchargement PDF impossible')) }
    finally { setDownloadingId(null) }
  }
  const exportList = () => {
    const rows = sales.map(s => ({
      numero: s.number,
      type: s.doc_type,
      client: s.client_name,
      date: fmtDateTime(s.date_time),
      utilisateur: s.created_by_name || '',
      total: s.total_amount,
      paye: s.paid_amount,
      reste: s.balance_due,
      statut: STATUS_LABELS[s.status] || s.status,
    }))
    downloadCsv(`ventes-${docType}.csv`, rows)
  }
  const handleDelete = async (s) => {
    const ok = await confirm({
      title: 'Supprimer le document',
      message: `Supprimer ${s.number || 'ce document'} ? Cette action est definitive.`,
      confirmText: 'Supprimer',
      tone: 'danger',
    })
    if (!ok) return
    try { await api.delete(`/sales/${s.id}`, { headers: operationHeaders(s.version, { idempotent: false }) }); toast.success('Supprimé'); load() }
    catch(e) { toast.error(apiErrorMessage(e, 'Erreur')) }
  }
  const handlePayment = async () => {
    if (!payAmt || +payAmt <= 0) return toast.error('Montant invalide')
    if (+payAmt > Number(selected.balance_due) + 0.001) return toast.error(`Le paiement ne peut pas dépasser le reste de ${fmt(selected.balance_due)} ${currency}`)
    setPaymentSaving(true)
    try {
      await api.post(`/sales/${selected.id}/payment`, { amount: +payAmt, payment_mode: payMode }, { headers: operationHeaders(selected.version) })
      toast.success('Paiement enregistré'); setModal(null); load()
    } catch(e) { toast.error(apiErrorMessage(e, 'Erreur')) }
    finally { setPaymentSaving(false) }
  }

  // Line item helpers
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }))
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }))
  const updateItem = (i, key, val) => setForm(f => {
    const items = [...f.items]
    items[i] = { ...items[i], [key]: val }
    if (key === 'product_id' && val) {
      const p = products.find(p => p.id === +val)
      if (p) {
        items[i].unit_price = p.sale_price
        items[i].purchase_price = p.purchase_price
        items[i].tax_rate = vatEnabled ? p.tax_rate : 0
        items[i].description = p.name
        items[i].sale_unit = p.unit || 'pcs'
        items[i].base_unit = p.unit || 'pcs'
        items[i].secondary_unit = p.sale_unit || ''
        items[i].secondary_factor = Number(p.sale_to_base_factor || 1)
        items[i].secondary_price = Number(p.sale_unit_price || 0)
        items[i].base_price = Number(p.sale_price || 0)
      }
    }
    return { ...f, items }
  })

  const selectLineProduct = (index, value) => {
    if (!value) {
      setForm(current => ({
        ...current,
        items: current.items.map((item, itemIndex) => itemIndex === index ? {
          ...item,
          product_id: '',
          description: '',
          unit_price: 0,
          purchase_price: 0,
          product_type: undefined,
          pricing_mode: undefined,
        } : item),
      }))
      return true
    }
    const duplicateIndex = form.items.findIndex((item, itemIndex) => itemIndex !== index && Number(item.product_id) === Number(value))
    if (duplicateIndex >= 0) {
      toast.error(`Ce produit existe déjà à la ligne ${duplicateIndex + 1}. Augmentez sa quantité.`)
      window.requestAnimationFrame(() => {
        const input = document.querySelector(`[data-sales-quantity="${duplicateIndex}"]`)
        input?.scrollIntoView({ behavior:'smooth', block:'center' })
        input?.focus()
        input?.select()
      })
      return false
    }
    const product = products.find(item => item.id === Number(value))
    if (!product) return false
    if (product.product_type === 'service') {
      setServiceLineDraft({
        index,
        product,
        quantity: 1,
        unit_price: '',
      })
      return true
    }
    setForm(current => {
      const items = [...current.items]
      const currentItem = { ...items[index], product_id:value }
      currentItem.unit_price = product.sale_price
      currentItem.purchase_price = product.purchase_price
      currentItem.tax_rate = vatEnabled ? product.tax_rate : 0
      currentItem.description = product.name
      currentItem.sale_unit = product.unit || 'pcs'
      currentItem.base_unit = product.unit || 'pcs'
      currentItem.secondary_unit = product.sale_unit || ''
      currentItem.secondary_factor = Number(product.sale_to_base_factor || 1)
      currentItem.secondary_price = Number(product.sale_unit_price || 0)
      currentItem.base_price = Number(product.sale_price || 0)
      items[index] = currentItem
      if (index === items.length - 1) items.push({ ...EMPTY_ITEM })
      return { ...current, items }
    })
    return true
  }

  const selectLineUnit = (index, value) => setForm(current => ({
    ...current,
    items: current.items.map((item, itemIndex) => itemIndex !== index ? item : {
      ...item,
      sale_unit: value,
      unit_price: value === item.secondary_unit ? item.secondary_price : item.base_price,
      purchase_price: Number(products.find(product => product.id === Number(item.product_id))?.purchase_price || 0)
        * (value === item.secondary_unit ? Number(item.secondary_factor || 1) : 1),
    }),
  }))

  const commitServiceLine = () => {
    const quantity = Number(serviceLineDraft?.quantity)
    const unitPrice = Number(String(serviceLineDraft?.unit_price || '').replace(',', '.'))
    if (!Number.isInteger(quantity) || quantity <= 0) return toast.error('La quantité doit être un nombre entier positif')
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return toast.error('Saisissez un prix par pcs strictement positif')
    const { index, product } = serviceLineDraft
    setForm(current => {
      const items = current.items.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        product_id: product.id,
        description: product.name,
        quantity,
        unit_price: unitPrice,
        purchase_price: product.purchase_price,
        tax_rate: vatEnabled ? product.tax_rate : 0,
        product_type: 'service',
        pricing_mode: product.pricing_mode,
      } : item)
      if (index === items.length - 1) items.push({ ...EMPTY_ITEM })
      return { ...current, items }
    })
    setServiceLineDraft(null)
  }

  // Totals
  const computeTotals = (items, discount) => {
    let sub = 0, tax = 0
    items.forEach(item => {
      const lt = (item.quantity||1) * (item.unit_price||0) * (1-(item.discount||0)/100)
      sub += lt
      if (vatEnabled) tax += lt * (item.tax_rate ?? 0)/100
    })
    if (discount > 0) { const d = sub * discount/100; sub -= d; tax *= (1-discount/100) }
    return { subtotal: sub, tax_amount: tax, total: sub + tax }
  }
  const localTotals = computeTotals(form.items||[], +form.discount||0)
  const totals = serverPreview
    ? { subtotal: serverPreview.subtotal, tax_amount: serverPreview.tax_amount, total: serverPreview.total_amount }
    : localTotals
  const previewPayload = useMemo(() => buildSalePayload(form), [form])

  useEffect(() => {
    if (modal === 'form' && !selected) writeSalesDraft(form)
  }, [form, modal, selected])

  useEffect(() => {
    if (modal !== 'form' || !previewPayload.items.length) {
      setServerPreview(null)
      return undefined
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api.post('/sales/preview', previewPayload, { signal: controller.signal })
        .then(({ data }) => setServerPreview(data))
        .catch(error => {
          if (error.code !== 'ERR_CANCELED') setServerPreview(null)
        })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [modal, previewPayload])

  const handleSave = async () => {
    const completedItems = (form.items || []).filter(item => item.product_id)
    if (completedItems.length === 0) return toast.error('Ajoutez au moins une ligne')
    const invalidLine = completedItems.findIndex(item =>
      !Number.isInteger(Number(item.quantity))
      || Number(item.quantity) <= 0
      || !Number.isFinite(Number(item.unit_price))
      || Number(item.unit_price) <= 0
      || Number(item.discount) < 0
      || Number(item.discount) > 100
    )
    if (invalidLine >= 0) return toast.error(`Vérifiez le produit, la quantité, le prix et la remise de la ligne ${invalidLine + 1}`)
    setSaving(true)
    try {
      const payload = buildSalePayload(form)
      const { data: exact } = await api.post('/sales/preview', payload)
      setServerPreview(exact)
      if (!selected) { await api.post('/sales', payload); toast.success('Document créé') }
      else { await api.put(`/sales/${selected.id}`, payload, { headers: operationHeaders(selected.version, { idempotent: false }) }); toast.success('Document mis à jour') }
      if (!selected) storageRemove(SALES_DRAFT_KEY)
      setModal(null); load()
    } catch(e) { toast.error(apiErrorMessage(e, 'Erreur')) }
    finally { setSaving(false) }
  }

  return (
    <div className="page-content sales-page">
      <div className="page-header">
        <h1 className="page-title">Ventes</h1>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={exportList} disabled={loading || sales.length === 0}><Download size={16} /> Export CSV</button>
          <button className="btn btn-secondary sales-report-button" onClick={openReportDialog}><Mail size={16} /> Envoyer rapport</button>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Nouveau</button>
        </div>
      </div>

      {/* Doc type tabs */}
      <div className="tabs">
        {DOC_TYPES.map(dt => (
          <button key={dt.value} className={`tab ${docType===dt.value?'active':''}`} onClick={() => setDocType(dt.value)}>
            {dt.label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding:0 }}>
        <div className="sales-filters">
          <div className="search-wrap sales-filter-search">
            <Search size={15} className="search-icon" />
            <input placeholder="Rechercher par numéro…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <select aria-label="Filtrer par statut" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="Filtrer par client" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
            <option value="">Tous les clients</option>
            {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <label className="sales-date-filter"><span>Du</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} /></label>
          <label className="sales-date-filter"><span>Au</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} /></label>
          {(q || statusFilter || clientFilter || dateFrom || dateTo) && (
            <button className="btn btn-secondary sales-filter-reset" onClick={() => {
              setQ('')
              setStatusFilter('')
              setClientFilter('')
              setDateFrom('')
              setDateTo('')
            }}><RotateCcw size={15}/> Réinitialiser</button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Numéro</th><th>Client</th><th>Date</th><th>Utilisateur</th><th>Total</th><th>Payé</th><th>Reste</th><th>Statut</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={9} label="Chargement des ventes..." />
              ) : loadError ? (
                <tr><td colSpan={9}><LoadError message={loadError} onRetry={load} /></td></tr>
              ) : sales.length === 0 ? (
                <tr><td colSpan={9}><div className="empty-state"><ShoppingCart size={40}/><p>Aucun document</p></div></td></tr>
              ) : sales.map(s => (
                <tr key={s.id} className={`document-row status-${s.status}`}>
                  <td><span className="font-mono text-sm">{s.number}</span></td>
                  <td>{s.client_name}</td>
                  <td className="text-muted text-sm">{fmtDate(s.date_time)}</td>
                  <td className="text-muted text-sm">{s.created_by_name || '—'}</td>
                  <td className="font-semibold">{fmt(s.total_amount)} MAD</td>
                  <td style={{ color:'var(--success)' }}>{fmt(s.paid_amount)} MAD</td>
                  <td style={{ color: s.balance_due > 0 ? 'var(--danger)' : 'var(--text3)' }}>{s.balance_due > 0 ? `${fmt(s.balance_due)} MAD` : '—'}</td>
                  <td><span className={`badge badge-${s.status}`}>{STATUS_LABELS[s.status]||s.status}</span></td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openView(s)} title="Voir"><Eye size={14}/></button>
                      <button className="btn btn-secondary btn-sm btn-icon" disabled={downloadingId === s.id} onClick={() => handleDownload(s)} title="Télécharger PDF">
                        {downloadingId === s.id ? <span className="spinner" style={{width:14,height:14}}/> : <Download size={14}/>}
                      </button>
                      {s.status === 'draft' && <>
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(s)} title="Modifier"><Edit2 size={14}/></button>
                        <button className="btn btn-success btn-sm btn-icon" onClick={() => handleConfirm(s)} title="Confirmer"><Check size={14}/></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(s)} title="Supprimer"><Trash2 size={14}/></button>
                      </>}
                      {['confirmed', 'partially_paid'].includes(s.status) && <>
                        <button className="btn btn-primary btn-sm btn-icon" onClick={() => { setSelected(s); setPayAmt(s.balance_due); setModal('pay') }} title="Paiement"><CreditCard size={14}/></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleCancel(s)} title="Annuler"><X size={14}/></button>
                      </>}
                      {s.doc_type === 'quote' && s.status !== 'cancelled' && <button className="btn btn-primary btn-sm btn-icon" onClick={() => handleConvertQuote(s)} title="Convertir en facture et déduire le stock"><FileCheck2 size={14}/></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-pagination">
          <span>Page {page} - {sales.length} documents charges</span>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page === 1}>Precedent</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => p + 1)} disabled={loading || sales.length < PAGE_SIZE}>Suivant</button>
          </div>
        </div>
      </div>

      {reportDialog && (
        <div className="modal-overlay sales-report-overlay" onClick={event => event.target === event.currentTarget && !reportSending && setReportDialog(false)}>
          <div className="modal sales-report-modal" role="dialog" aria-modal="true" aria-labelledby="sales-report-title">
            <div className="modal-header sales-report-header">
              <div className="sales-report-heading">
                <span className="sales-report-icon"><Send size={22} /></span>
                <div><span className="sales-report-eyebrow">RAPPORT DES VENTES</span><h2 id="sales-report-title">Envoyer par email</h2><p>Rapport detaille avec factures et utilisateurs.</p></div>
              </div>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setReportDialog(false)} disabled={reportSending} aria-label="Fermer"><X size={17}/></button>
            </div>
            <div className="modal-body sales-report-body">
              <div className="form-group">
                <label className="form-label">Destinataires</label>
                <div className="sales-report-recipient-box">
                  {reportRecipients.map(recipient => <span className="sales-report-recipient" key={recipient}><Mail size={13}/>{recipient}<button type="button" onClick={() => setReportRecipients(current => current.filter(value => value !== recipient))} aria-label={`Supprimer ${recipient}`}><X size={13}/></button></span>)}
                  <div className="sales-report-recipient-entry">
                    <input autoFocus type="email" value={reportRecipientDraft} onChange={event => setReportRecipientDraft(event.target.value)} onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ',' || event.key === ';') { event.preventDefault(); addReportRecipients(reportRecipientDraft) }
                      if (event.key === 'Backspace' && !reportRecipientDraft && reportRecipients.length) setReportRecipients(current => current.slice(0, -1))
                    }} onBlur={() => reportRecipientDraft.trim() && addReportRecipients(reportRecipientDraft)} placeholder="Ajouter une adresse email" />
                    <button type="button" className="btn btn-secondary btn-sm" onMouseDown={event => event.preventDefault()} onClick={() => addReportRecipients(reportRecipientDraft)} disabled={!reportRecipientDraft.trim()}><Plus size={15}/> Ajouter</button>
                  </div>
                </div>
                <small className="text-muted">Appuyez sur Entrée après chaque adresse. Les doublons sont supprimés automatiquement.</small>
              </div>
              <div className="form-group">
                <label className="form-label">Periode</label>
                <select value={reportForm.period_type} onChange={event => changeReportPeriod(event.target.value)}>
                  <option value="daily">Aujourd'hui</option><option value="weekly">Cette semaine (lundi - dimanche)</option><option value="monthly">Ce mois</option><option value="yearly">Cette annee</option><option value="custom">Personnalisee</option>
                </select>
              </div>
              <div className="sales-report-dates">
                <div className="form-group"><label className="form-label">Date debut</label><input type="date" value={reportForm.start_date} max={reportForm.end_date || undefined} readOnly={reportForm.period_type !== 'custom'} onChange={event => setReportForm(current => ({ ...current, start_date:event.target.value }))}/></div>
                <div className="form-group"><label className="form-label">Date fin</label><input type="date" value={reportForm.end_date} min={reportForm.start_date || undefined} readOnly={reportForm.period_type !== 'custom'} onChange={event => setReportForm(current => ({ ...current, end_date:event.target.value }))}/></div>
              </div>
              <div className="sales-report-period"><CalendarDays size={17}/><span>Du <strong>{fmtDate(reportForm.start_date)}</strong> au <strong>{fmtDate(reportForm.end_date)}</strong></span></div>
              <div className="sales-report-contents">
                <div><Mail size={18}/><span><strong>Rapport HTML</strong><small>Indicateurs, CA, caisse et utilisateurs</small></span></div>
                <div><FileSpreadsheet size={18}/><span><strong>Fichier Excel joint</strong><small>Une feuille separee pour chaque facture</small></span></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setReportDialog(false)} disabled={reportSending}>Annuler</button>
              <button className="btn btn-primary" onClick={sendSalesReport} disabled={reportSending}>{reportSending ? <span className="spinner" style={{width:16,height:16}}/> : <Send size={16}/>} {reportSending ? 'Envoi en cours...' : 'Envoyer le rapport'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {modal === 'form' && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setModal(null)}>
          <div className="modal modal-xl">
            <div className="modal-header">
              <h2>{!selected ? 'Nouveau document' : 'Modifier document'}</h2>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Header */}
              <div className="form-grid form-grid-3" style={{ gap:'1rem', marginBottom:'1.5rem' }}>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select value={form.doc_type} onChange={e => setForm(f=>({...f,doc_type:e.target.value}))}>
                    {DOC_TYPES.map(dt => <option key={dt.value} value={dt.value}>{dt.label.replace(/s$/,'')}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Client</label>
                  <select value={form.client_id||''} onChange={e => setForm(f=>({...f,client_id:e.target.value||null}))}>
                    <option value="">— Sélectionner —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="datetime-local" value={form.date_time||''} onChange={e => setForm(f=>({...f,date_time:e.target.value}))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Mode de paiement</label>
                  <select value={form.payment_mode} onChange={e => setForm(f=>({...f,payment_mode:e.target.value}))}>
                    {PAYMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Remise globale (%)</label>
                  <input type="number" min="0" max="100" value={form.discount||0} onChange={e => setForm(f=>({...f,discount:+e.target.value||0}))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Avance client</label>
                  <input type="number" min="0" step="0.01" value={form.advance_amount || 0} onChange={e => setForm(f => ({ ...f, advance_amount:Math.max(0, Number(e.target.value) || 0) }))} />
                </div>
                <div className="form-group" style={{ gridColumn:'1/-1' }}>
                  <label className="form-label">Notes</label>
                  <textarea value={form.notes||''} onChange={e => setForm(f=>({...f,notes:e.target.value}))} rows={2} placeholder="Notes internes…" />
                </div>
              </div>

              {/* Items */}
              <div className="sales-lines-section">
                <div className="sales-lines-heading">
                  <div><h3>Lignes</h3>{!selected ? <span className="sales-autosave-status"><Check size={12}/> Brouillon sauvegardé automatiquement</span> : null}</div>
                  <button className="btn btn-secondary btn-sm" onClick={addItem}><Plus size={14}/> Ajouter ligne</button>
                </div>
                <div className="sales-lines-table-wrap">
                  <table className="sales-lines-table">
                    <thead><tr>
                      <th>Produit</th>
                      <th>Unité</th>
                      <th>Qté</th>
                      <th>Prix unit. HT</th>
                      <th>Remise %</th>
                      {vatEnabled ? <th>TVA %</th> : null}
                      <th>Total HT</th>
                      <th aria-label="Actions"></th>
                    </tr></thead>
                    <tbody>
                      {form.items.map((item, i) => {
                        const lt = (item.quantity||1)*(item.unit_price||0)*(1-(item.discount||0)/100)
                        return (
                          <tr key={i}>
                            <td className="sales-line-product">
                              <ProductSearchSelect products={products} value={item.product_id || ''} onChange={value => selectLineProduct(i, value)} />
                            </td>
                            <td>
                              <select aria-label="Unité de vente" value={item.sale_unit || item.base_unit || ''} disabled={!item.product_id || !item.secondary_unit} onChange={event => selectLineUnit(i, event.target.value)}>
                                <option value={item.base_unit || item.sale_unit || 'pcs'}>{item.base_unit || item.sale_unit || 'pcs'}</option>
                                {item.secondary_unit && Number(item.secondary_factor) > 1 && Number(item.secondary_price) > 0
                                  ? <option value={item.secondary_unit}>{item.secondary_unit} ({fmt(item.secondary_factor, 0)} {item.base_unit})</option>
                                  : null}
                              </select>
                            </td>
                            <td className="sales-line-quantity"><input
                              data-sales-quantity={i}
                              aria-label="Quantité"
                              type="number"
                              inputMode="numeric"
                              min="1"
                              step="1"
                              value={item.quantity}
                              onKeyDown={e => {
                                if (['.', ',', 'e', 'E', '+', '-'].includes(e.key)) e.preventDefault()
                              }}
                              onChange={e => updateItem(i, 'quantity', Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                            /></td>
                            <td>
                              <input aria-label="Prix unitaire HT" type="number" min="0.01" step="0.01" value={item.unit_price} onChange={e => updateItem(i,'unit_price',+e.target.value||0)} />
                              {item.product_type === 'service' ? <small className="sales-service-unit">Prix / pcs</small> : null}
                            </td>
                            <td><input aria-label="Remise en pourcentage" type="number" min="0" max="100" value={item.discount} onChange={e => updateItem(i,'discount',+e.target.value||0)} /></td>
                            {vatEnabled ? <td>
                              <select aria-label="TVA" value={item.tax_rate} onChange={e => updateItem(i,'tax_rate',+e.target.value)}>
                                {taxRates.map(r => <option key={r} value={r}>{r}%</option>)}
                              </select>
                            </td> : null}
                            <td className="sales-line-total">{fmt(lt)} {currency}</td>
                            <td className="sales-line-remove"><button aria-label="Supprimer la ligne" title="Supprimer la ligne" className="btn btn-danger btn-sm btn-icon" onClick={() => removeItem(i)}><X size={14}/></button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div style={{ display:'flex', justifyContent:'flex-end' }}>
                <div style={{ minWidth:280, display:'flex', flexDirection:'column', gap:'.4rem', padding:'1rem', background:'var(--bg3)', borderRadius:'var(--radius-sm)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.875rem' }}>
                    <span className="text-muted">Sous-total:</span><span>{fmt(totals.subtotal)} {currency}</span>
                  </div>
                  {vatEnabled ? <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.875rem' }}>
                    <span className="text-muted">TVA:</span><span>{fmt(totals.tax_amount)} {currency}</span>
                  </div> : null}
                  <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:'1.1rem', borderTop:'1px solid var(--border)', paddingTop:'.4rem', marginTop:'.2rem' }}>
                    <span>Total:</span><span style={{ color:'var(--accent)' }}>{fmt(totals.total)} {currency}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', color:'var(--success)', fontWeight:700 }}><span>Avance:</span><span>- {fmt(form.advance_amount)} {currency}</span></div>
                  <div style={{ display:'flex', justifyContent:'space-between', color:'var(--danger)', fontWeight:800, fontSize:'1rem' }}><span>Reste à payer:</span><span>{fmt(Math.max(totals.total - Number(form.advance_amount || 0), 0))} {currency}</span></div>
                  <small className="text-muted">{serverPreview ? 'Total exact calculé par le serveur' : 'Vérification du total en cours…'}</small>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <span className="spinner" style={{width:16,height:16}} /> : null}
                {!selected ? 'Créer' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {serviceLineDraft && (
        <div className="modal-overlay sales-service-overlay" onClick={event => event.target === event.currentTarget && setServiceLineDraft(null)}>
          <div className="modal sales-service-modal">
            <div className="modal-header">
              <div><span className="sales-service-eyebrow">Service sans stock</span><h2>{serviceLineDraft.product.name}</h2></div>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setServiceLineDraft(null)}>✕</button>
            </div>
            <div className="modal-body sales-service-body">
              <div className="sales-service-icon"><Sparkles size={26}/></div>
              <p>Définissez le prix facturé à ce client pour chaque pcs.</p>
              <div className="form-grid form-grid-2">
                <div className="form-group">
                  <label className="form-label">Quantité (pcs)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={serviceLineDraft.quantity}
                    onKeyDown={event => {
                      if (['.', ',', 'e', 'E', '+', '-'].includes(event.key)) event.preventDefault()
                    }}
                    onChange={event => setServiceLineDraft(draft => ({
                      ...draft,
                      quantity: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                    }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Prix pour 1 pcs ({currency})</label>
                  <input autoFocus type="number" min="0.01" step="0.01" value={serviceLineDraft.unit_price} onChange={event => setServiceLineDraft(draft => ({ ...draft, unit_price:event.target.value }))}/>
                </div>
              </div>
              <div className="sales-service-total">
                <span>Total HT</span>
                <strong>{fmt(Number(String(serviceLineDraft.quantity).replace(',', '.')) * Number(String(serviceLineDraft.unit_price).replace(',', '.')) || 0)} {currency}</strong>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setServiceLineDraft(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={commitServiceLine}><Plus size={15}/> Ajouter à la facture</button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {modal === 'view' && selected && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setModal(null)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <div>
                <h2>{selected.number}</h2>
                <div style={{ display:'flex', gap:'.5rem', marginTop:'.25rem' }}>
                  <span className={`badge badge-${selected.status}`}>{STATUS_LABELS[selected.status]||selected.status}</span>
                </div>
              </div>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginBottom:'1.5rem' }}>
                <div><span className="text-muted text-sm">Client:</span><div className="font-semibold">{selected.client_name}</div></div>
                <div><span className="text-muted text-sm">Date:</span><div>{fmtDateTime(selected.date_time)}</div></div>
                <div><span className="text-muted text-sm">Dernière mise à jour:</span><div>{fmtDateTime(selected.updated_at)}</div></div>
                <div><span className="text-muted text-sm">Utilisateur:</span><div>{selected.created_by_name || '—'}</div></div>
                <div><span className="text-muted text-sm">Mode paiement:</span><div>{paymentModeLabel(selected.payment_mode)}</div></div>
                <div><span className="text-muted text-sm">Remise:</span><div>{selected.discount}%</div></div>
              </div>
              <div className="table-wrap" style={{ marginBottom:'1rem' }}>
                <table style={{ fontSize:'.875rem' }}>
                  <thead><tr><th>Description</th><th>Qté</th><th>Prix</th><th>Remise</th>{vatEnabled ? <th>TVA</th> : null}<th>Total</th></tr></thead>
                  <tbody>
                    {selected.items.map(i => (
                      <tr key={i.id}>
                        <td>{i.product_name || i.description}</td>
                        <td>{i.quantity}</td>
                        <td>{fmt(i.unit_price)} MAD</td>
                        <td>{i.discount}%</td>
                        {vatEnabled ? <td>{i.tax_rate}%</td> : null}
                        <td className="font-semibold">{fmt(i.line_total)} MAD</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end' }}>
                <div style={{ minWidth:280, display:'flex', flexDirection:'column', gap:'.4rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.875rem' }}><span className="text-muted">Sous-total:</span><span>{fmt(selected.subtotal)} {selected.currency_code || currency}</span></div>
                  {vatEnabled ? <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.875rem' }}><span className="text-muted">TVA:</span><span>{fmt(selected.tax_amount)} {selected.currency_code || currency}</span></div> : null}
                  {vatEnabled ? (selected.tax_breakdown || []).map(row => <div key={row.rate} style={{ display:'flex', justifyContent:'space-between', fontSize:'.8rem' }}><span className="text-muted">TVA {fmt(row.rate)}%</span><span>{fmt(row.tax_amount)} {selected.currency_code || currency}</span></div>) : null}
                  <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:'1.1rem', borderTop:'1px solid var(--border)', paddingTop:'.4rem' }}>
                    <span>Total TTC:</span><span style={{ color:'var(--accent)' }}>{fmt(selected.total_amount)} MAD</span>
                  </div>
                  {Number(selected.advance_amount || 0) > 0 && <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.875rem' }}><span style={{ color:'var(--success)' }}>Avance:</span><span style={{ color:'var(--success)' }}>{fmt(selected.advance_amount)} MAD</span></div>}
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.875rem' }}><span style={{ color:'var(--success)' }}>Payé:</span><span style={{ color:'var(--success)' }}>{fmt(selected.paid_amount)} MAD</span></div>
                  {selected.balance_due > 0 && (
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.875rem', fontWeight:600 }}><span style={{ color:'var(--danger)' }}>Reste:</span><span style={{ color:'var(--danger)' }}>{fmt(selected.balance_due)} MAD</span></div>
                  )}
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:'1rem', marginTop:'1rem' }}>
                <div className="card" style={{ padding:'1rem' }}>
                  <h3 style={{ fontSize:'.95rem', marginBottom:'.75rem' }}>Paiements</h3>
                  {payments.length === 0 ? <p className="text-muted text-sm">Aucun paiement enregistre.</p> : payments.map(p => (
                    <div key={p.id} style={{ display:'flex', justifyContent:'space-between', gap:'.75rem', padding:'.45rem 0', borderTop:'1px solid var(--border)' }}>
                      <span><strong>{paymentModeLabel(p.payment_mode)}</strong><br/><small className="text-muted">{p.payment_reference || p.reference}<br/>{fmtDateTime(p.created_at)}</small></span>
                      <strong style={{ color:'var(--success)' }}>{fmt(p.amount)} MAD</strong>
                    </div>
                  ))}
                </div>
                <div className="card" style={{ padding:'1rem' }}>
                  <h3 style={{ fontSize:'.95rem', marginBottom:'.75rem' }}>Timeline</h3>
                  {timeline.length === 0 ? <p className="text-muted text-sm">Aucune trace disponible.</p> : timeline.map(log => (
                    <div key={log.id} style={{ padding:'.45rem 0', borderTop:'1px solid var(--border)' }}>
                      <strong>{log.summary || log.action}</strong>
                      <div className="text-muted text-sm">{fmtDateTime(log.created_at)} - {log.created_by_name || '-'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={printDocument} disabled={previewingPdf}>
                {previewingPdf ? <span className="spinner" style={{width:15,height:15}}/> : <Printer size={15}/>} PDF / Imprimer
              </button>
              {selected.doc_type === 'invoice' && (
                <button className="btn btn-secondary" onClick={printTicket}>
                  <Printer size={15} /> Ticket POS
                </button>
              )}
              {selected.doc_type === 'invoice' && ['confirmed', 'partially_paid', 'paid'].includes(selected.status) && (
                <button className="btn btn-secondary" onClick={openReturn}>Retour / échange</button>
              )}
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Fermer</button>
              {['confirmed', 'partially_paid'].includes(selected.status) && selected.balance_due > 0 && (
                <button className="btn btn-primary" onClick={() => { setPayAmt(selected.balance_due); setModal('pay') }}>
                  <CreditCard size={15} /> Encaisser
                </button>
              )}
            </div>
            {printTarget === 'document' && <PrintableSalesDocument sale={selected} settings={settings} />}
            {printTarget === 'ticket' && createPortal(
              <ThermalReceiptPrintDocument sale={selected} settings={settings} language={language} />,
              document.body,
            )}
          </div>
        </div>
      )}

      {modal === 'return' && selected && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setModal('view')}>
          <div className="modal">
            <div className="modal-header"><h2>Retour — {selected.number}</h2><button className="btn btn-secondary btn-icon" onClick={() => setModal('view')}>✕</button></div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Traitement</label>
                <select value={returnForm.resolution} onChange={e => setReturnForm(f => ({ ...f, resolution:e.target.value }))}>
                  <option value="exchange">Échange</option>
                  <option value="credit">Avoir client</option>
                  <option value="refund">Remboursement à traiter</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Motif *</label>
                <textarea value={returnForm.reason} onChange={e => setReturnForm(f => ({ ...f, reason:e.target.value }))} rows={2} />
              </div>
              <div className="return-help">
                Le stock n'est augmenté que pour un article déclaré <strong>revendable</strong>.
                Les services et les articles endommagés restent hors stock.
              </div>
              <div className="table-wrap return-table">
                <table><thead><tr><th>Article</th><th>Vendu</th><th>À retourner</th><th>État</th><th>Stock</th></tr></thead>
                  <tbody>{returnForm.items.map((item, index) => (
                    <tr key={item.sale_item_id}>
                      <td>{item.name}</td><td>{item.max} {item.sale_unit}</td>
                      <td><input type="number" min="0" max={item.max} step="1" value={item.quantity} onChange={e => setReturnForm(f => ({ ...f, items:f.items.map((row, i) => i === index ? { ...row, quantity:e.target.value } : row) }))} /></td>
                      <td>
                        <select
                          value={item.condition}
                          disabled={item.product_type === 'service'}
                          onChange={e => setReturnForm(f => ({ ...f, items:f.items.map((row, i) => i === index ? {
                            ...row,
                            condition:e.target.value,
                            restock:e.target.value === 'resalable',
                          } : row) }))}
                        >
                          <option value="resalable">Revendable</option>
                          <option value="damaged">Endommagé</option>
                        </select>
                      </td>
                      <td>
                        <span className={`return-stock-badge ${item.restock && item.condition === 'resalable' ? 'in' : 'out'}`}>
                          {item.product_type === 'service' ? 'Sans stock' : item.restock && item.condition === 'resalable' ? 'Réintégré' : 'Non réintégré'}
                        </span>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {returnForm.resolution === 'exchange' && (
                <section className="exchange-panel">
                  <div className="exchange-panel-header">
                    <div><strong>Articles de remplacement</strong><span>Une facture liée sera créée automatiquement.</span></div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={addExchangeItem}><Plus size={15}/> Ajouter</button>
                  </div>
                  {returnForm.exchange_items.map((item, index) => (
                    <div className="exchange-line" key={index}>
                      <select value={item.product_id} onChange={e => selectExchangeProduct(index, e.target.value)}>
                        <option value="">— Produit de remplacement —</option>
                        {products.filter(product => product.is_active).map(product => (
                          <option key={product.id} value={product.id}>{product.name}</option>
                        ))}
                      </select>
                      <input aria-label="Quantité de remplacement" type="number" min="1" step="1" value={item.quantity} onChange={e => updateExchangeItem(index, { quantity:e.target.value })}/>
                      <input aria-label="Prix unitaire de remplacement" type="number" min="0" step=".01" value={item.unit_price} onChange={e => updateExchangeItem(index, { unit_price:e.target.value, price_override_reason:'Prix convenu pour échange' })}/>
                      <strong>{fmt((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))} {currency}</strong>
                      <button type="button" className="btn btn-danger btn-icon" onClick={() => setReturnForm(form => ({ ...form, exchange_items:form.exchange_items.filter((_, i) => i !== index) }))}><X size={16}/></button>
                    </div>
                  ))}
                </section>
              )}
              <div className="return-summary">
                <div><span>Valeur du retour</span><strong>{fmt(returnCredit)} {currency}</strong></div>
                {returnForm.resolution === 'exchange' && <>
                  <div><span>Valeur du remplacement</span><strong>{fmt(exchangeTotal)} {currency}</strong></div>
                  <div className={exchangeDifference > 0 ? 'customer-pays' : exchangeDifference < 0 ? 'customer-refund' : 'balanced'}>
                    <span>{exchangeDifference > 0 ? 'À payer par le client' : exchangeDifference < 0 ? 'À rembourser au client' : 'Différence'}</span>
                    <strong>{fmt(Math.abs(exchangeDifference))} {currency}</strong>
                  </div>
                </>}
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setModal('view')}>Annuler</button><button className="btn btn-primary" disabled={returnSaving} onClick={submitReturn}>{returnSaving ? <span className="spinner"/> : <RotateCcw size={16}/>} Confirmer le retour</button></div>
          </div>
        </div>
      )}

      {/* Pay Modal */}
      {modal === 'pay' && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth:400 }}>
            <div className="modal-header">
              <h2>Enregistrer un paiement</h2>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
              <div className="form-group">
                <label className="form-label">Montant (MAD)</label>
                <input type="number" min="0.01" max={selected.balance_due} step="0.01" value={payAmt} onChange={e => setPayAmt(+e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Mode de paiement</label>
                <select value={payMode} onChange={e => setPayMode(e.target.value)}>
                  {paymentModes.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-success" onClick={handlePayment} disabled={paymentSaving}>
                {paymentSaving ? <span className="spinner" style={{ width:15, height:15 }}/> : <Check size={15}/>}
                Confirmer paiement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LoadError({ message, onRetry }) {
  return (
    <div className="empty-state">
      <ShoppingCart size={40} />
      <p>{message}</p>
      <button className="btn btn-secondary btn-sm" onClick={onRetry}>Recharger</button>
    </div>
  )
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function downloadCsv(filename, rows) {
  const headers = Object.keys(rows[0] || {})
  const csv = [
    headers.join(';'),
    ...rows.map(row => headers.map(key => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(';')),
  ].join('\n')
  downloadBlob(filename, `\ufeff${csv}`, 'text/csv;charset=utf-8')
}

function downloadHtmlFile(filename, html) {
  downloadBlob(filename, html, 'text/html;charset=utf-8')
}

function buildSalesDocumentHtml(sale, settings) {
  const currency = settings.currency || 'MAD'
  const vatEnabled = isVatEnabled(settings)
  const title = DOC_TITLES[sale.doc_type] || 'Document'
  const logoUrl = getLogoUrl(settings)
  const rows = (sale.items || []).map(item => `
    <tr>
      <td>${escapeHtml(item.product_name || item.description)}</td>
      <td>${fmt(item.quantity, 0)} ${escapeHtml(item.sale_unit || '')}</td>
      <td>${fmt(item.unit_price)} ${currency}</td>
      <td>${fmt(item.discount)}%</td>
      ${vatEnabled ? `<td>${fmt(item.tax_rate)}%</td>` : ''}
      <td>${fmt(item.line_total)} ${currency}</td>
    </tr>
  `).join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(sale.number)}</title>
<style>${documentPrintCss()}</style></head>
<body><main class="sheet">
  <header><div class="brand"><img src="${escapeHtml(logoUrl)}" alt=""><div><strong>${escapeHtml(getCompanyName(settings))}</strong><span>${escapeHtml(settings.address || '')}</span><span>${escapeHtml(settings.phone || '')}</span><span>${escapeHtml(settings.email || '')}</span></div></div><div class="meta"><h1>${escapeHtml(title)}</h1><b>${escapeHtml(sale.number)}</b><span>Date: ${fmtDate(sale.date_time)}</span><span>Utilisateur: ${escapeHtml(sale.created_by_name || '-')}</span></div></header>
  <section class="parties"><div><h2>Client</h2><b>${escapeHtml(sale.client_name || 'Client comptoir')}</b><span>Telephone: ${escapeHtml(sale.client_phone || '-')}</span></div><div><h2>Paiement</h2><span>Mode: ${escapeHtml(paymentModeLabel(sale.payment_mode))}</span><span>Avance: ${fmt(sale.advance_amount)} ${currency}</span><span>Reste: ${fmt(sale.balance_due)} ${currency}</span></div></section>
  <table><thead><tr><th>Designation</th><th>Qte</th><th>PU</th><th>Remise</th>${vatEnabled ? '<th>TVA</th>' : ''}<th>Total</th></tr></thead><tbody>${rows}</tbody></table>
  <section class="bottom"><div><h2>Notes</h2><p>${escapeHtml(sale.notes || settings.invoice_notes || 'Merci pour votre confiance.')}</p><div class="library-stamp">CACHET DE LA LIBRAIRIE</div></div><aside><p><span>Sous-total</span><b>${fmt(sale.subtotal)} ${currency}</b></p>${vatEnabled ? `<p><span>TVA</span><b>${fmt(sale.tax_amount)} ${currency}</b></p>` : ''}<p><span>Total</span><b>${fmt(sale.total_amount)} ${currency}</b></p><p><span>Avance</span><b>- ${fmt(sale.advance_amount)} ${currency}</b></p><p class="total"><span>Reste a payer</span><b>${fmt(sale.balance_due)} ${currency}</b></p></aside></section>
  <footer>${escapeHtml(getCompanyName(settings))} - Document genere par ${escapeHtml(sale.created_by_name || 'LIBRARY SABRI')}</footer>
</main></body></html>`
}

function documentPrintCss() {
  return `body{margin:0;background:#f1f5f9;color:#111827;font-family:Arial,Helvetica,sans-serif}.sheet{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:16mm}header,.parties,.bottom,aside p,footer{display:flex;justify-content:space-between;gap:16px}header{border-bottom:2px solid #111827;padding-bottom:14px;margin-bottom:18px}.brand{display:flex;gap:12px;align-items:flex-start}.brand img{width:42px;height:42px;object-fit:contain}.brand strong{display:block;font-size:24px}.brand span,.meta span,.parties span{display:block;color:#4b5563;font-size:12px;margin-top:4px}.meta{text-align:right}.meta h1{margin:0;text-transform:uppercase;font-size:28px}.parties{margin-bottom:18px}.parties>div{width:48%;border:1px solid #d1d5db;padding:10px;min-height:82px}h2{font-size:12px;text-transform:uppercase;color:#6b7280;margin:0 0 6px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:18px}th{background:#111827;color:#fff;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #e5e7eb}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.bottom>div{width:52%;color:#4b5563}.library-stamp{width:72mm;height:30mm;margin-top:12mm;border:1px solid #94a3b8;border-radius:3px;text-align:center;padding-top:6px;font-size:10px;font-weight:bold}aside{width:270px}aside p{border-bottom:1px solid #e5e7eb;padding-bottom:6px}.total{background:#111827;color:#fff;padding:10px!important;border-bottom:0!important}footer{margin-top:28px;border-top:1px solid #e5e7eb;padding-top:8px;color:#6b7280;font-size:10px}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none}@page{size:A4;margin:0}}`
}

function PrintableSalesDocument({ sale, settings }) {
  const currency = settings.currency || 'MAD'
  const vatEnabled = isVatEnabled(settings)
  const title = DOC_TITLES[sale.doc_type] || 'Document'
  const clientLabel = sale.client_name && sale.client_name !== '—' ? sale.client_name : 'Client comptoir'
  const amountDue = Math.max(Number(sale.balance_due || 0), 0)
  const logoUrl = getLogoUrl(settings)

  return (
    <div className="sales-print-doc" aria-hidden="true">
      <div className="print-sheet">
        <header className="print-header">
          <div className="print-brand-lockup">
            <img className="print-logo" src={logoUrl} alt="" />
            <div>
            <div className="print-brand">{getCompanyName(settings)}</div>
            <div className="print-company">
              {settings.address && <span>{settings.address}</span>}
              {settings.city && <span>{settings.city}</span>}
              {settings.phone && <span>Tél: {settings.phone}</span>}
              {settings.email && <span>Email: {settings.email}</span>}
              {settings.ice && <span>ICE: {settings.ice}</span>}
              {settings.if_number && <span>IF: {settings.if_number}</span>}
              {settings.rc && <span>RC: {settings.rc}</span>}
            </div>
            </div>
          </div>
          <div className="print-doc-meta">
            <h1>{title}</h1>
            <strong>{sale.number}</strong>
            <span>Date: {fmtDate(sale.date_time)}</span>
            {sale.updated_at && <span>Maj: {fmtDateTime(sale.updated_at)}</span>}
            <span>Utilisateur: {sale.created_by_name || '-'}</span>
            <span>Statut: {STATUS_LABELS[sale.status] || sale.status}</span>
          </div>
        </header>

        <section className="print-parties">
          <div>
            <h2>Client</h2>
            <strong>{clientLabel}</strong>
            <span>Téléphone: {sale.client_phone || '-'}</span>
          </div>
          <div>
            <h2>Paiement</h2>
            <span>Mode: {paymentModeLabel(sale.payment_mode)}</span>
            <span>Avance: {fmt(sale.advance_amount)} {currency}</span>
            <span>Reste: {fmt(amountDue)} {currency}</span>
          </div>
        </section>

        <table className="print-table">
          <thead>
            <tr>
              <th>Désignation</th>
              <th>Qté</th>
              <th>PU</th>
              <th>Remise</th>
              {vatEnabled ? <th>TVA</th> : null}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map(item => (
              <tr key={item.id}>
                <td>{item.product_name || item.description}</td>
                <td>{fmt(item.quantity, 0)} {item.sale_unit || ''}</td>
                <td>{fmt(item.unit_price)} {currency}</td>
                <td>{fmt(item.discount)}%</td>
                {vatEnabled ? <td>{fmt(item.tax_rate)}%</td> : null}
                <td>{fmt(item.line_total)} {currency}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="print-bottom">
          <div className="print-notes">
            <h2>Notes</h2>
            <p>{sale.notes || 'Merci pour votre confiance.'}</p>
            <div className="print-library-stamp">CACHET DE LA LIBRAIRIE</div>
          </div>
          <div className="print-totals">
            <div><span>Sous-total HT</span><strong>{fmt(sale.subtotal)} {currency}</strong></div>
            {vatEnabled ? <div><span>TVA</span><strong>{fmt(sale.tax_amount)} {currency}</strong></div> : null}
            {Number(sale.discount || 0) > 0 && (
              <div><span>Remise globale</span><strong>{fmt(sale.discount)}%</strong></div>
            )}
            <div className="print-grand-total"><span>Total</span><strong>{fmt(sale.total_amount)} {currency}</strong></div>
            <div><span>Avance</span><strong>- {fmt(sale.advance_amount)} {currency}</strong></div>
            <div className="print-grand-total"><span>Reste à payer</span><strong>{fmt(amountDue)} {currency}</strong></div>
          </div>
        </section>

        <footer className="print-footer">
          <span>{settings.name || 'LIBRARY SABRI'} - Document généré par {sale.created_by_name || 'LIBRARY SABRI'}</span>
        </footer>
      </div>
    </div>
  )
}
