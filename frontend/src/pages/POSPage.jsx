// src/pages/POSPage.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Banknote, Barcode, Boxes, Calculator, CheckCircle2, CreditCard, Minus, Package, Pause, Plus,
  Printer, Receipt, RotateCcw, Search, ShoppingBag, Smartphone, Sparkles, Trash2, User, Wifi, X
} from 'lucide-react'
import QRCode from 'qrcode'
import { api, apiErrorMessage, fmt, fmtDateTime, isVatEnabled, operationHeaders, resolveMediaUrl, SETTLEMENT_METHODS } from '../lib/api'
import { PageLoader } from '../components/ui/LoadingStates'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useI18n } from '../lib/i18n'
import ThermalReceipt, { printThermalReceipt, ThermalReceiptPrintDocument } from '../components/print/ThermalReceipt'
import './POSPage.css'
import { storageGet, storageJson, storageRemove, storageSet } from '../lib/safeStorage'

const HELD_KEY = 'proerp_pos_held_cart'
const DRAFT_KEY = 'maktaba_pos_active_draft_v1'
const LAST_TICKET_KEY = 'maktaba_pos_last_ticket_id'
const PRODUCT_GRID_ROWS = 3

const emptyPayment = { mode: 'cash', received: '', discount: 0, client_id: '' }

function readPosDraft() {
  try {
    const parsed = storageJson(DRAFT_KEY)
    if (parsed?.version !== 1 || !Array.isArray(parsed.cart)) {
      return { cart: [], payment: emptyPayment }
    }
    const cart = parsed.cart
      .filter(item => Number(item?.product_id) > 0 && Number(item?.unit_price) >= 0)
      .map(item => ({
        ...item,
        quantity: Number(item?.quantity) > 0 ? item.quantity : 1,
        discount: Number(item?.discount) >= 0 ? Math.min(Number(item.discount), 100) : 0,
      }))
    return { cart, payment: { ...emptyPayment, ...(parsed.payment || {}) } }
  } catch {
    storageRemove(DRAFT_KEY)
    return { cart: [], payment: emptyPayment }
  }
}

function writePosDraft(cart, payment) {
  try {
    if (!cart.length) {
      storageRemove(DRAFT_KEY)
      return
    }
    storageSet(DRAFT_KEY, JSON.stringify({
      version: 1,
      saved_at: new Date().toISOString(),
      cart,
      payment: {
        mode: payment.mode,
        discount: payment.discount,
        client_id: payment.client_id,
        received: payment.received,
      },
    }))
  } catch {
    // Keep checkout usable when browser storage is blocked or full.
  }
}

function toNumber(value, fallback = 0) {
  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value
  const n = Number(normalized)
  return Number.isFinite(n) ? n : fallback
}

function lineTotal(item, vatEnabled = true) {
  const qty = toNumber(item.quantity, 1)
  const price = toNumber(item.unit_price)
  const discount = toNumber(item.discount)
  const net = qty * price * (1 - discount / 100)
  const tax = vatEnabled ? net * toNumber(item.tax_rate, 20) / 100 : 0
  return { net, tax, total: net + tax }
}

function secondarySaleEnabled(product) {
  return product?.product_type === 'product'
    && String(product.sale_unit || '').trim()
    && toNumber(product.sale_to_base_factor, 1) > 1
    && toNumber(product.sale_unit_price) > 0
}

function stockLabel(product) {
  const stock = Math.max(0, Math.floor(toNumber(product.stock_quantity)))
  if (!secondarySaleEnabled(product)) return `${stock} ${product.unit || 'pcs'}`
  const factor = Math.floor(toNumber(product.sale_to_base_factor, 1))
  return `${Math.floor(stock / factor)} ${product.sale_unit} + ${stock % factor} ${product.unit || 'pcs'}`
}

export default function POSPage() {
  const [searchParams] = useSearchParams()
  const confirm = useConfirm()
  const { language } = useI18n()
  const [products, setProducts] = useState([])
  const [clients, setClients] = useState([])
  const [categories, setCategories] = useState([])
  const [cart, setCart] = useState(() => readPosDraft().cart)
  const [query, setQuery] = useState(() => searchParams.get('search') || '')
  const [categoryId, setCategoryId] = useState('')
  const [catalogMode, setCatalogMode] = useState('all')
  const [serviceDraft, setServiceDraft] = useState(null)
  const [bundleDraft, setBundleDraft] = useState(null)
  const [payment, setPayment] = useState(() => readPosDraft().payment)
  const [loading, setLoading] = useState(true)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSale, setLastSale] = useState(null)
  const [productPage, setProductPage] = useState(1)
  const [productPageSize, setProductPageSize] = useState(9)
  const [settings, setSettings] = useState({})
  const [serverPreview, setServerPreview] = useState(null)
  const [mobileScanner, setMobileScanner] = useState(null)
  const [scannerModalOpen, setScannerModalOpen] = useState(false)
  const [scannerStarting, setScannerStarting] = useState(false)
  const searchRef = useRef(null)
  const productGridRef = useRef(null)
  const cartRef = useRef(cart)
  const paymentRef = useRef(payment)
  const autoPrintedSaleRef = useRef(null)
  cartRef.current = cart
  paymentRef.current = payment

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const loadAllProducts = async () => {
        const pageSize = 500
        const all = []
        for (let skip = 0; ; skip += pageSize) {
          const { data } = await api.get('/products', { params: { skip, limit: pageSize } })
          all.push(...data)
          if (data.length < pageSize) return all
        }
      }
      const [allProducts, c, cat, settingsRes] = await Promise.all([
        loadAllProducts(),
        api.get('/clients', { params: { limit: 500 } }),
        api.get('/categories'),
        api.get('/settings'),
      ])
      setProducts(allProducts)
      setClients(c.data)
      setCategories(cat.data)
      setSettings(settingsRes.data || {})
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erreur de chargement POS'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!lastSale || !settings.receipt_auto_print || autoPrintedSaleRef.current === lastSale.id) return
    autoPrintedSaleRef.current = lastSale.id
    printThermalReceipt()
  }, [lastSale, settings.receipt_auto_print])

  useEffect(() => {
    writePosDraft(cart, payment)
  }, [cart, payment.mode, payment.discount, payment.client_id, payment.received])

  useEffect(() => {
    const persistLatestDraft = () => writePosDraft(cartRef.current, paymentRef.current)
    window.addEventListener('pagehide', persistLatestDraft)
    return () => {
      persistLatestDraft()
      window.removeEventListener('pagehide', persistLatestDraft)
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'F9' && cart.length) {
        e.preventDefault()
        setCheckoutOpen(true)
      }
      if (e.key === 'Escape' && checkoutOpen) setCheckoutOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart.length, checkoutOpen])

  useEffect(() => {
    setProductPage(1)
  }, [query, categoryId, catalogMode])

  useEffect(() => {
    const grid = productGridRef.current
    if (!grid) return

    const syncPageSize = () => {
      const columns = window.getComputedStyle(grid).gridTemplateColumns
        .split(' ')
        .filter(Boolean).length
      setProductPageSize(Math.max(PRODUCT_GRID_ROWS, columns * PRODUCT_GRID_ROWS))
    }

    syncPageSize()
    const observer = new ResizeObserver(syncPageSize)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [loading])

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter(p => {
      const inCategory = !categoryId || String(p.category_id || '') === String(categoryId)
      const inMode = catalogMode === 'all' || p.product_type === catalogMode
      const matches = !q
        || p.name?.toLowerCase().includes(q)
        || p.code?.toLowerCase().includes(q)
        || p.barcode?.toLowerCase().includes(q)
      return inCategory && inMode && matches
    })
  }, [products, query, categoryId, catalogMode])
  const paymentModes = SETTLEMENT_METHODS
  const vatEnabled = isVatEnabled(settings)
  const taxRates = useMemo(() => String(settings.tax_rates || '0,7,10,14,20').split(',').map(Number).filter(Number.isFinite), [settings.tax_rates])

  const productPageCount = Math.max(1, Math.ceil(filteredProducts.length / productPageSize))
  const currentProductPage = Math.min(productPage, productPageCount)
  useEffect(() => {
    if (productPage > productPageCount) setProductPage(productPageCount)
  }, [productPage, productPageCount])

  const pagedProducts = useMemo(() => {
    const start = (currentProductPage - 1) * productPageSize
    return filteredProducts.slice(start, start + productPageSize)
  }, [filteredProducts, currentProductPage, productPageSize])
  const productStart = filteredProducts.length === 0 ? 0 : (currentProductPage - 1) * productPageSize + 1
  const productEnd = Math.min(currentProductPage * productPageSize, filteredProducts.length)

  const totals = useMemo(() => {
    const lines = cart.reduce((acc, item) => {
      const lt = lineTotal(item, vatEnabled)
      acc.subtotal += lt.net
      acc.tax += lt.tax
      acc.total += lt.total
      return acc
    }, { subtotal: 0, tax: 0, total: 0 })
    const discount = Math.min(Math.max(toNumber(payment.discount), 0), 100)
    const factor = 1 - discount / 100
    return {
      subtotal: lines.subtotal * factor,
      tax: lines.tax * factor,
      total: lines.total * factor,
      discount,
      received: toNumber(payment.received),
    }
  }, [cart, payment.discount, payment.received, vatEnabled])

  const previewPayload = useMemo(() => ({
    doc_type: 'invoice',
    client_id: payment.client_id || null,
    discount: payment.discount || 0,
    payment_mode: payment.mode,
    paid_amount: 0,
    notes: 'Vente POS',
    items: cart.map(item => ({
      product_id: item.product_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount: item.discount || 0,
      tax_rate: vatEnabled ? (item.tax_rate ?? 0) : 0,
      price_override_reason: item.price_override_reason || '',
      sale_unit: item.sale_unit || item.base_unit || '',
    })),
  }), [cart, payment.client_id, payment.discount, payment.mode, vatEnabled])

  useEffect(() => {
    if (!cart.length) {
      setServerPreview(null)
      return undefined
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api.post('/sales/preview', previewPayload, { signal: controller.signal })
        .then(({ data }) => setServerPreview(data))
        .catch(error => { if (error.code !== 'ERR_CANCELED') setServerPreview(null) })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [cart.length, previewPayload])

  const authoritativeTotals = serverPreview ? {
    ...totals,
    subtotal: serverPreview.subtotal,
    tax: serverPreview.tax_amount,
    total: serverPreview.total_amount,
  } : totals
  const currency = serverPreview?.currency_code || settings.currency || 'MAD'

  const changeDue = Math.max(0, totals.received - authoritativeTotals.total)
  const remaining = Math.max(0, authoritativeTotals.total - totals.received)

  const syncCartWithStock = useCallback((stockProducts, showToast = true) => {
    let adjusted = false
    let removed = false
    const byId = new Map(stockProducts.map(p => [p.id, p]))
    setCart(prev => prev.flatMap(item => {
      const fresh = byId.get(item.product_id)
      if (!fresh || !['product', 'bundle'].includes(fresh.product_type)) return [item]
      const available = Math.max(0, toNumber(fresh.stock_quantity))
      if (available <= 0) {
        adjusted = true
        removed = true
        return []
      }
      const factor = Math.max(1, toNumber(item.conversion_factor, 1))
      const availableUnits = Math.floor(available / factor)
      if (toNumber(item.quantity, 1) > availableUnits) {
        adjusted = true
        return availableUnits > 0
          ? [{ ...item, quantity: availableUnits, stock_quantity: available, max_quantity:availableUnits }]
          : []
      }
      return [{ ...item, stock_quantity: available, max_quantity:availableUnits }]
    }))
    if (adjusted && showToast) {
      toast.error(removed
        ? 'Certains produits sont hors stock et ont été retirés'
        : 'Quantité ajustée selon le stock disponible'
      )
    }
    return adjusted
  }, [])

  const addProduct = (product, configured = null) => {
    if (product.product_type === 'service' && !configured) {
      setServiceDraft({
        product,
        quantity: 1,
        unit_price: product.pricing_mode === 'fixed' ? toNumber(product.sale_price) : '',
      })
      return
    }
    if (product.product_type === 'bundle' && !configured) {
      setBundleDraft({ product, components:null, loading:true })
      api.get(`/products/${product.id}/components`)
        .then(({ data }) => setBundleDraft(current => current?.product.id === product.id ? { ...current, components:data || [], loading:false } : current))
        .catch(() => {
          setBundleDraft(null)
          toast.error('Impossible de charger la composition du pack')
        })
      return
    }
    const available = Math.max(0, toNumber(product.stock_quantity))
    if (['product', 'bundle'].includes(product.product_type) && available <= 0) {
      toast.error('Stock insuffisant')
      return
    }
    setCart(prev => {
      const found = prev.find(i => i.product_id === product.id)
      if (found) {
        const nextQty = toNumber(found.quantity, 1) + toNumber(configured?.quantity, 1)
        const maximum = Math.floor(available / Math.max(1, toNumber(found.conversion_factor, 1)))
        if (['product', 'bundle'].includes(product.product_type) && nextQty > maximum) {
          toast.error(`Stock disponible: ${fmt(maximum, 0)} ${found.sale_unit || product.unit || ''}`)
          return prev.map(i => i.product_id === product.id
            ? { ...i, quantity: maximum, stock_quantity: available, max_quantity:maximum }
            : i
          )
        }
        return prev.map(i => i.product_id === product.id
          ? {
              ...i,
              quantity: nextQty,
              unit_price: configured?.unit_price != null ? toNumber(configured.unit_price) : i.unit_price,
              stock_quantity: available,
            }
          : i
        )
      }
      return [...prev, {
        product_id: product.id,
        code: product.code,
        name: product.name,
        description: product.name,
        quantity: toNumber(configured?.quantity, 1),
        unit_price: configured?.unit_price != null
          ? toNumber(configured.unit_price)
          : (product.product_type === 'service' && product.pricing_mode === 'manual' ? 0 : toNumber(product.sale_price)),
        catalog_unit_price: toNumber(product.sale_price),
        pricing_mode: product.pricing_mode || (product.product_type === 'service' ? 'editable' : 'fixed'),
        price_override_reason: '',
        purchase_price: toNumber(product.purchase_price),
        discount: 0,
        tax_rate: vatEnabled ? toNumber(product.tax_rate, 20) : 0,
        stock_quantity: available,
        product_type: product.product_type,
        allow_fractional_sale: Boolean(product.allow_fractional_sale),
        base_unit: product.unit || 'pcs',
        sale_unit: product.unit || 'pcs',
        conversion_factor: 1,
        max_quantity: available,
        secondary_unit: secondarySaleEnabled(product) ? product.sale_unit : '',
        secondary_factor: secondarySaleEnabled(product) ? toNumber(product.sale_to_base_factor, 1) : 1,
        secondary_price: secondarySaleEnabled(product) ? toNumber(product.sale_unit_price) : 0,
        base_price: toNumber(product.sale_price),
      }]
    })
  }

  const openMobileScanner = async () => {
    if (mobileScanner?.token) {
      setScannerModalOpen(true)
      return
    }
    setScannerStarting(true)
    try {
      const { data } = await api.post('/mobile-scanner/sessions', null, { timeout:45000 })
      const current = new URL(window.location.href)
      if (!data.public_url && current.protocol !== 'https:') {
        throw new Error('Le tunnel HTTPS du scanner est temporairement indisponible. Réessayez dans quelques secondes.')
      }
      const localHost = ['localhost', '127.0.0.1', '::1'].includes(current.hostname)
      const host = localHost ? data.lan_ip : current.hostname
      const basePath = window.location.pathname.startsWith('/erp') ? '/erp' : ''
      const localScannerUrl = `${current.protocol}//${host}${current.port ? `:${current.port}` : ''}${basePath}/mobile-scanner?session=${encodeURIComponent(data.token)}`
      const scannerUrl = data.public_url
        ? `${String(data.public_url).replace(/\/$/, '')}/mobile-scanner?session=${encodeURIComponent(data.token)}`
        : localScannerUrl
      const qrDataUrl = await QRCode.toDataURL(scannerUrl, {
        width: 320,
        margin: 1,
        color: { dark: '#102b58', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      setMobileScanner({ ...data, url: scannerUrl, qrDataUrl, connected: false, lastEvent: 0 })
      setScannerModalOpen(true)
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Impossible de démarrer le scanner mobile'))
    } finally {
      setScannerStarting(false)
    }
  }

  const closeMobileScanner = async () => {
    setScannerModalOpen(false)
  }

  const stopMobileScanner = async () => {
    const token = mobileScanner?.token
    setScannerModalOpen(false)
    setMobileScanner(null)
    if (token) api.delete(`/mobile-scanner/sessions/${token}`).catch(() => {})
  }

  useEffect(() => {
    if (!mobileScanner?.token) return undefined
    let stopped = false
    let cursor = mobileScanner.lastEvent || 0
    const poll = async () => {
      try {
        const { data } = await api.get(`/mobile-scanner/sessions/${mobileScanner.token}/events`, { params: { after: cursor } })
        if (stopped) return
        setMobileScanner(current => current ? { ...current, connected: Boolean(data.connected) } : current)
        for (const event of data.events || []) {
          cursor = Math.max(cursor, Number(event.id || 0))
          const code = String(event.barcode || '').trim().toLowerCase()
          const product = products.find(item =>
            String(item.barcode || '').trim().toLowerCase() === code
            || String(item.code || '').trim().toLowerCase() === code
          )
          if (product) {
            addProduct(product)
            toast.success(`${product.name} ajouté depuis le téléphone`, { icon: '📱' })
          } else {
            setQuery(event.barcode)
            toast.error(`Code ${event.barcode} introuvable dans le catalogue`)
          }
        }
        setMobileScanner(current => current ? { ...current, lastEvent: cursor } : current)
      } catch (error) {
        if (!stopped && error.response?.status === 404) {
          toast.error('La session scanner mobile a expiré')
          setMobileScanner(null)
        }
      }
    }
    poll()
    const timer = window.setInterval(poll, 700)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [mobileScanner?.token, products])

  const commitService = () => {
    const quantity = toNumber(serviceDraft?.quantity)
    const unitPrice = toNumber(serviceDraft?.unit_price, -1)
    if (quantity <= 0) return toast.error('La quantité doit être positive')
    if (unitPrice <= 0) return toast.error('Le prix du service doit être strictement positif')
    addProduct(serviceDraft.product, { quantity, unit_price: unitPrice })
    setServiceDraft(null)
  }

  const addBySearch = () => {
    const q = query.trim().toLowerCase()
    if (!q) return
    const exact = products.find(p =>
      p.barcode?.toLowerCase() === q || p.code?.toLowerCase() === q
    )
    if (exact) {
      addProduct(exact)
      setQuery('')
      return
    }
    if (filteredProducts.length === 1) {
      addProduct(filteredProducts[0])
      setQuery('')
    }
  }

  const updateQty = (productId, quantity) => {
    // Keep the line while the cashier clears the field to type a new quantity.
    if (quantity === '') {
      setCart(prev => prev.map(item => item.product_id === productId
        ? { ...item, quantity: '' }
        : item
      ))
      return
    }
    const qty = Math.max(0, toNumber(quantity))
    setCart(prev => prev.map(item => {
      if (item.product_id !== productId) return item
      if (qty <= 0) return { ...item, quantity: 1 }
      const maximum = Math.max(0, toNumber(item.max_quantity, item.stock_quantity))
      if (['product', 'bundle'].includes(item.product_type) && qty > maximum) {
        toast.error(`Quantité ajustée au stock disponible: ${fmt(maximum, 0)} ${item.sale_unit || ''}`)
        return { ...item, quantity: maximum }
      }
      return { ...item, quantity: qty }
    }))
  }

  const normalizeQty = (productId, quantity) => {
    if (quantity === '' || toNumber(quantity) <= 0) updateQty(productId, 1)
  }

  const removeLine = (productId) => {
    setCart(prev => prev.filter(item => item.product_id !== productId))
  }

  const updateLine = (productId, key, value) => {
    const nextValue = value === ''
      ? ''
      : key === 'discount'
        ? Math.min(100, Math.max(0, toNumber(value)))
        : toNumber(value)
    setCart(prev => prev.map(item => item.product_id === productId
      ? { ...item, [key]: nextValue }
      : item
    ))
  }

  const normalizeLineValue = (productId, key, value, fallback = 0) => {
    if (value === '') updateLine(productId, key, fallback)
  }

  const changeSaleUnit = (productId, saleUnit) => {
    setCart(prev => prev.map(item => {
      if (item.product_id !== productId) return item
      const secondary = saleUnit === item.secondary_unit && item.secondary_unit
      const factor = secondary ? Math.max(2, toNumber(item.secondary_factor, 1)) : 1
      const maximum = Math.floor(Math.max(0, toNumber(item.stock_quantity)) / factor)
      return {
        ...item,
        sale_unit: secondary ? item.secondary_unit : item.base_unit,
        conversion_factor: factor,
        unit_price: secondary ? item.secondary_price : item.base_price,
        catalog_unit_price: secondary ? item.secondary_price : item.base_price,
        max_quantity: maximum,
        quantity: Math.min(Math.max(1, toNumber(item.quantity, 1)), maximum || 1),
        price_override_reason: '',
      }
    }))
  }

  const clearCart = async () => {
    if (!cart.length) return
    const ok = await confirm({
      title: 'Vider le panier',
      message: 'Supprimer toutes les lignes du panier POS en cours ?',
      confirmText: 'Vider',
      tone: 'danger',
    })
    if (!ok) return
    cartRef.current = []
    paymentRef.current = emptyPayment
    setCart([])
    setPayment(emptyPayment)
    storageRemove(DRAFT_KEY)
    storageRemove(HELD_KEY)
  }

  const holdCart = () => {
    if (!cart.length) return toast.error('Panier vide')
    if (!storageSet(HELD_KEY, JSON.stringify(cart))) return toast.error('Stockage local indisponible')
    toast.success('Panier mis en attente')
  }

  const restoreCart = () => {
    const saved = storageGet(HELD_KEY)
    if (!saved) return toast.error('Aucun panier en attente')
    try {
      setCart(JSON.parse(saved))
      toast.success('Panier restauré')
    } catch {
      toast.error('Panier en attente invalide')
    }
  }

  const finishSale = async () => {
    if (!cart.length) return toast.error('Ajoutez au moins un produit')
    const invalidLine = cart.findIndex(item => {
      const quantity = toNumber(item.quantity, Number.NaN)
      const discount = toNumber(item.discount, Number.NaN)
      const unitPrice = toNumber(item.unit_price, Number.NaN)
      return !Number.isFinite(quantity) || quantity <= 0
        || (!item.allow_fractional_sale && !Number.isInteger(quantity))
        || !Number.isFinite(unitPrice) || unitPrice < 0
        || !Number.isFinite(discount) || discount < 0 || discount > 100
    })
    if (invalidLine >= 0) return toast.error(`Vérifiez la quantité, le prix et la remise de la ligne ${invalidLine + 1}`)
    const received = toNumber(payment.received, Number.NaN)
    if (!Number.isFinite(received) || received < 0) return toast.error('Le montant reçu est invalide')
    setSaving(true)
    let createdSale = null
    let confirmedSale = null
    try {
      const productIds = [...new Set(cart.map(item => item.product_id))]
      const freshRows = await Promise.all(productIds.map(id => api.get(`/products/${id}`).then(response => response.data)))
      setProducts(previous => {
        const freshById = new Map(freshRows.map(item => [item.id, item]))
        return previous.map(item => freshById.get(item.id) || item)
      })
      if (syncCartWithStock(freshRows)) {
        setSaving(false)
        return
      }
      const payload = previewPayload
      const { data: exact } = await api.post('/sales/preview', payload)
      setServerPreview(exact)
      if (Number(exact.total_amount) <= 0) {
        toast.error('Le total du ticket doit être strictement positif')
        return
      }
      if (received < Number(exact.total_amount)) {
        toast.error(`Montant reçu insuffisant. Total exact: ${fmt(exact.total_amount)} ${exact.currency_code}`)
        return
      }
      const created = await api.post('/sales', payload)
      createdSale = created.data
      const confirmed = await api.post(`/sales/${createdSale.id}/confirm`, {}, { headers: operationHeaders(createdSale.version) })
      confirmedSale = confirmed.data
      const paymentAmount = Number(confirmedSale.total_amount)
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        throw new Error('INVALID_CONFIRMED_TOTAL')
      }
      const paid = await api.post(`/sales/${createdSale.id}/payment`, {
        amount: paymentAmount,
        payment_mode: payment.mode,
      }, { headers: operationHeaders(confirmedSale.version) })
      setLastSale(paid.data)
      storageSet(LAST_TICKET_KEY, String(paid.data.id))
      cartRef.current = []
      paymentRef.current = emptyPayment
      setCart([])
      setPayment(emptyPayment)
      storageRemove(DRAFT_KEY)
      storageRemove(HELD_KEY)
      setCheckoutOpen(false)
      await load()
      toast.success(`Ticket ${paid.data.number} encaissé`)
    } catch (e) {
      if (createdSale && !confirmedSale) {
        try {
          const { data: currentSale } = await api.get(`/sales/${createdSale.id}`)
          if (currentSale.status === 'draft') {
            await api.delete(`/sales/${createdSale.id}`, {
              headers: operationHeaders(currentSale.version, { idempotent: false }),
            })
          } else {
            confirmedSale = currentSale
          }
        } catch {
          // The original API error below remains the most useful message.
        }
      }
      if (confirmedSale) {
        setLastSale(confirmedSale)
        storageSet(LAST_TICKET_KEY, String(confirmedSale.id))
        cartRef.current = []
        paymentRef.current = emptyPayment
        setCart([])
        setPayment(emptyPayment)
        storageRemove(DRAFT_KEY)
        storageRemove(HELD_KEY)
        setCheckoutOpen(false)
        toast.error(`La facture ${confirmedSale.number} est confirmée mais non encaissée. Enregistrez son paiement depuis Ventes.`)
        return
      }
      toast.error(
        e.message === 'INVALID_CONFIRMED_TOTAL'
          ? 'Le serveur a retourné un total invalide. La vente n’a pas été encaissée.'
          : apiErrorMessage(e, 'Erreur encaissement')
      )
    } finally {
      setSaving(false)
    }
  }

  const printReceipt = () => printThermalReceipt()
  const reopenLastTicket = async () => {
    const id = Number(storageGet(LAST_TICKET_KEY))
    if (!Number.isInteger(id) || id <= 0) return toast.error('Aucun ticket précédent disponible')
    try {
      const { data } = await api.get(`/sales/${id}`)
      setLastSale(data)
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Impossible de charger le dernier ticket'))
    }
  }

  return (
    <div className="pos-page">
      <div className="pos-header">
        <div>
          <h1 className="page-title">Point de vente</h1>
          <p>Vente rapide, stock contrôlé, paiement immédiat</p>
          {cart.length ? <span className="pos-draft-status"><Pause size={12}/> Brouillon sauvegardé automatiquement · {cart.length} ligne(s)</span> : null}
        </div>
        <div className="pos-actions">
          <button className="btn btn-secondary" onClick={reopenLastTicket}><Printer size={16} /> Dernier ticket</button>
          <button className="btn btn-secondary" onClick={restoreCart}><RotateCcw size={16} /> Reprendre</button>
          <button className="btn btn-secondary" onClick={holdCart}><Pause size={16} /> Attente</button>
          <button className="btn btn-danger" onClick={clearCart}><Trash2 size={16} /> Vider</button>
        </div>
      </div>

      <div className="pos-shell">
        <section className="pos-catalog">
          <div className="pos-catalog-tabs" role="tablist" aria-label="Type de catalogue">
            <button className={catalogMode === 'all' ? 'active' : ''} onClick={() => setCatalogMode('all')}><Boxes size={16} /> Tout</button>
            <button className={catalogMode === 'product' ? 'active' : ''} onClick={() => setCatalogMode('product')}><Package size={16} /> Produits</button>
            <button className={catalogMode === 'service' ? 'active' : ''} onClick={() => setCatalogMode('service')}><Sparkles size={16} /> Services</button>
            <button className={catalogMode === 'bundle' ? 'active' : ''} onClick={() => setCatalogMode('bundle')}><ShoppingBag size={16} /> Packs</button>
          </div>
          <div className="pos-toolbar">
            <div className="search-wrap pos-search">
              <Search size={16} className="search-icon" />
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addBySearch() }}
                placeholder="Scanner ou rechercher produit (F2)"
              />
            </div>
            <button className="btn btn-primary btn-icon" onClick={addBySearch} title="Ajouter par code">
              <Barcode size={18} />
            </button>
            <button
              className={`btn btn-secondary btn-icon pos-mobile-scan-btn ${mobileScanner?.token ? 'is-active' : ''}`}
              onClick={openMobileScanner}
              disabled={scannerStarting}
              title={mobileScanner?.token ? 'Scanner mobile actif — afficher la connexion' : 'Scanner avec le téléphone'}
              aria-label="Scanner avec le téléphone"
            >
              {scannerStarting ? <span className="spinner" style={{width:16,height:16}}/> : <Smartphone size={18}/>}
            </button>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">Toutes catégories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="pos-loading"><PageLoader title="Preparation POS" detail="Synchronisation du catalogue, clients et categories..." /></div>
          ) : (
            <>
              <div className="pos-grid-meta">
                <span>{productStart}-{productEnd} / {filteredProducts.length} produits</span>
                <div className="pos-grid-pager">
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={currentProductPage <= 1}
                    onClick={() => setProductPage(p => Math.max(1, p - 1))}
                  >
                    Précédent
                  </button>
                  <strong>{currentProductPage} / {productPageCount}</strong>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={currentProductPage >= productPageCount}
                    onClick={() => setProductPage(p => Math.min(productPageCount, p + 1))}
                  >
                    Suivant
                  </button>
                </div>
              </div>
              <div className="pos-grid" ref={productGridRef}>
                {pagedProducts.length === 0 && (
                  <div className="pos-catalog-empty"><Search size={28} /><strong>Aucun résultat</strong><span>Essayez un autre mot ou type de catalogue.</span></div>
                )}
                {pagedProducts.map(p => {
                  const cartLine = cart.find(item => item.product_id === p.id)
                  return (
                  <button key={p.id} className={`pos-product type-${p.product_type} ${cartLine ? 'in-cart' : ''}`} onClick={() => addProduct(p)}>
                    <div className="pos-product-image">
                      <PosProductImage product={p} />
                      {cartLine && <span className="pos-product-cart-count">×{fmt(cartLine.quantity, 0)}</span>}
                      <span className={`pos-type-badge type-${p.product_type}`}>
                        {p.product_type === 'service' ? 'Service' : p.product_type === 'bundle' ? 'Pack' : 'Produit'}
                      </span>
                    </div>
                    <span className="pos-product-code">{p.code || p.barcode || 'PROD'}</span>
                    <strong>{p.name}</strong>
                    <span>{fmt(p.sale_price)} {currency}</span>
                    {p.product_type === 'service'
                      ? <small className="service-hint">{p.pricing_mode === 'manual' ? 'Prix à saisir' : 'Sans stock'}</small>
                      : <small className={p.is_low_stock ? 'stock-low' : ''}>
                          {p.product_type === 'bundle' ? `Packs disponibles: ${fmt(p.stock_quantity, 0)}` : `Stock: ${stockLabel(p)}`}
                        </small>}
                    {p.updated_at && <small>Maj: {fmtDateTime(p.updated_at)}</small>}
                  </button>
                )})}
              </div>
            </>
          )}

      {scannerModalOpen && mobileScanner && (
        <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) closeMobileScanner() }}>
          <div className="modal pos-mobile-scanner-modal" role="dialog" aria-modal="true" aria-labelledby="mobile-scanner-title">
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">POS connecté</span>
                <h2 id="mobile-scanner-title">Scanner avec le téléphone</h2>
              </div>
              <button className="btn btn-secondary btn-icon" onClick={closeMobileScanner} aria-label="Fermer"><X size={17}/></button>
            </div>
            <div className="modal-body pos-mobile-scanner-body">
              <div className="pos-scanner-qr-wrap">
                <img src={mobileScanner.qrDataUrl} alt="QR Code de connexion du scanner mobile"/>
                <span className="pos-scanner-corners" aria-hidden="true"/>
              </div>
              <div className="pos-scanner-instructions">
                <span className={`pos-scanner-connection ${mobileScanner.connected ? 'is-connected' : ''}`}>
                  <Wifi size={17}/>
                  {mobileScanner.connected ? 'Téléphone connecté' : 'En attente du téléphone…'}
                </span>
                <h3>Scannez ce QR Code</h3>
                <ol>
                  <li>Connectez le téléphone au même Wi-Fi que cet ordinateur.</li>
                  <li>Ouvrez l’appareil photo et scannez le QR Code.</li>
                  <li>Scannez ensuite les produits : ils seront ajoutés automatiquement.</li>
                </ol>
                <div className="pos-scanner-url">{mobileScanner.url}</div>
                {!mobileScanner.public_url && !window.isSecureContext && (
                  <p className="pos-scanner-security-note">
                    Le tunnel HTTPS du scanner n’est pas disponible. Redémarrez l’application pour activer la caméra en direct.
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-danger" onClick={stopMobileScanner}>Arrêter le scanner</button>
              <button className="btn btn-primary" onClick={closeMobileScanner}>Continuer en arrière-plan</button>
            </div>
          </div>
        </div>
      )}
        </section>

        <aside className="pos-cart">
          <div className="pos-cart-title">
            <div><Receipt size={18} /> Ticket</div>
            <span>{cart.length} ligne(s)</span>
          </div>

          <div className="pos-cart-lines">
            {cart.length === 0 ? (
              <div className="pos-empty">
                <ShoppingBag size={38} />
                <span>Panier vide</span>
              </div>
            ) : cart.map(item => {
              const lt = lineTotal(item, vatEnabled)
              return (
                <div className={`pos-line type-${item.product_type}`} key={item.product_id}>
                  <div className="pos-line-main">
                    <div>
                      <strong>{item.name}</strong>
                      <small className={`pos-line-kind type-${item.product_type}`}>{item.product_type === 'service' ? 'Service' : item.product_type === 'bundle' ? 'Pack scolaire' : item.code || 'Produit'}</small>
                    </div>
                    <span className="pos-line-price">
                      <b>{fmt(item.unit_price)} {currency}</b>
                      <small>× {fmt(item.quantity, 0)} {item.sale_unit || ''}</small>
                    </span>
                  </div>
                  <div className="pos-line-controls">
                    <button className="btn btn-secondary btn-icon btn-sm" onClick={() => updateQty(item.product_id, Math.max(1, toNumber(item.quantity, 1) - 1))}><Minus size={14} /></button>
                    <input type="number" min="1" step="1" value={item.quantity} onChange={e => updateQty(item.product_id, e.target.value)} onBlur={e => normalizeQty(item.product_id, e.target.value)} />
                    <button className="btn btn-secondary btn-icon btn-sm" onClick={() => updateQty(item.product_id, toNumber(item.quantity, 1) + 1)}><Plus size={14} /></button>
                    <button className="btn btn-danger btn-icon btn-sm" onClick={() => removeLine(item.product_id)}><Trash2 size={14} /></button>
                  </div>
                  <div className="pos-line-extra">
                    {item.product_type === 'product' && item.secondary_unit ? (
                      <label>Unité
                        <select value={item.sale_unit || item.base_unit} onChange={event => changeSaleUnit(item.product_id, event.target.value)}>
                          <option value={item.base_unit}>{item.base_unit} · {fmt(item.base_price)} {currency}</option>
                          <option value={item.secondary_unit}>{item.secondary_unit} ({fmt(item.secondary_factor, 0)} {item.base_unit}) · {fmt(item.secondary_price)} {currency}</option>
                        </select>
                      </label>
                    ) : null}
                    {item.product_type === 'service' && item.pricing_mode !== 'fixed' && (
                      <label>Prix unitaire
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unit_price}
                          onChange={e => updateLine(item.product_id, 'unit_price', e.target.value)}
                        />
                      </label>
                    )}
                    <label>Remise %<input type="number" min="0" max="100" value={item.discount} onChange={e => updateLine(item.product_id, 'discount', e.target.value)} onBlur={e => normalizeLineValue(item.product_id, 'discount', e.target.value, 0)} /></label>
                    {vatEnabled ? <label>TVA %<select value={item.tax_rate} onChange={e => updateLine(item.product_id, 'tax_rate', e.target.value)}>{taxRates.map(rate => <option key={rate} value={rate}>{rate}%</option>)}</select></label> : null}
                    <strong>{fmt(lt.total)} {currency}</strong>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="pos-summary">
            <div><span>Sous-total</span><strong>{fmt(authoritativeTotals.subtotal)} {currency}</strong></div>
            {vatEnabled ? <div><span>TVA</span><strong>{fmt(authoritativeTotals.tax)} {currency}</strong></div> : null}
            <label>Remise globale %
              <input type="number" min="0" max="100" value={payment.discount} onChange={e => setPayment(p => ({ ...p, discount: e.target.value }))} />
            </label>
            <div className="pos-total"><span>Total</span><strong>{fmt(authoritativeTotals.total)} {currency}</strong></div>
            <small>{serverPreview ? 'Total exact serveur' : 'Vérification du total…'}</small>
          </div>

          <button className="btn btn-primary pos-pay-btn" disabled={!cart.length} onClick={() => {
            setPayment(p => ({ ...p, received: Number(authoritativeTotals.total).toFixed(2) }))
            setCheckoutOpen(true)
          }}>
            <Calculator size={18} /> Encaisser (F9)
          </button>
        </aside>
      </div>

      {serviceDraft && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setServiceDraft(null)}>
          <div className="modal pos-service-modal">
            <div className="modal-header">
              <div><span className="modal-eyebrow">Service rapide</span><h2>{serviceDraft.product.name}</h2></div>
              <button className="btn btn-secondary btn-icon" onClick={() => setServiceDraft(null)}>✕</button>
            </div>
            <div className="modal-body pos-service-body">
              <div className="pos-service-icon"><Sparkles size={28} /></div>
              <div className="form-grid form-grid-2">
                <div className="form-group">
                  <label className="form-label">Quantité (pcs)</label>
                  <input autoFocus type="number" min="0.0001" step="1" value={serviceDraft.quantity} onChange={e => setServiceDraft(draft => ({ ...draft, quantity:e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Prix pour 1 pcs ({currency})</label>
                  <input disabled={serviceDraft.product.pricing_mode === 'fixed'} type="number" min="0.01" step="0.01" value={serviceDraft.unit_price} onChange={e => setServiceDraft(draft => ({ ...draft, unit_price:e.target.value }))} />
                  {serviceDraft.product.pricing_mode === 'fixed' && <small className="text-muted">Prix fixe défini dans le catalogue.</small>}
                </div>
              </div>
              <div className="pos-service-total"><span>Total estimé</span><strong>{fmt(toNumber(serviceDraft.quantity) * toNumber(serviceDraft.unit_price))} {currency}</strong></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setServiceDraft(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={commitService}><Plus size={16} /> Ajouter au ticket</button>
            </div>
          </div>
        </div>
      )}

      {bundleDraft && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setBundleDraft(null)}>
          <div className="modal pos-bundle-modal">
            <div className="modal-header">
              <div><span className="modal-eyebrow">Pack scolaire</span><h2>{bundleDraft.product.name}</h2></div>
              <button className="btn btn-secondary btn-icon" onClick={() => setBundleDraft(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="pos-bundle-summary">
                <div><span>Prix</span><strong>{fmt(bundleDraft.product.sale_price)} {currency}</strong></div>
                <div><span>Disponible</span><strong>{fmt(bundleDraft.product.stock_quantity, 0)} pack(s)</strong></div>
              </div>
              <h3 className="pos-bundle-title">Contenu du pack</h3>
              {bundleDraft.loading ? <div className="pos-bundle-loading">Chargement de la composition…</div> : (
                <div className="pos-bundle-components">
                  {bundleDraft.components.map(component => (
                    <div key={component.id}><Package size={17}/><span><strong>{component.product_name}</strong><small>{fmt(component.quantity, 2)} {component.unit}</small></span></div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setBundleDraft(null)}>Annuler</button>
              <button className="btn btn-primary" disabled={bundleDraft.loading || !bundleDraft.components?.length} onClick={() => {
                addProduct(bundleDraft.product, { quantity:1 })
                setBundleDraft(null)
              }}><Plus size={16}/> Ajouter le pack</button>
            </div>
          </div>
        </div>
      )}

      {checkoutOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setCheckoutOpen(false)}>
          <div className="modal pos-checkout">
            <div className="modal-header">
              <h2>Encaissement POS</h2>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setCheckoutOpen(false)}>x</button>
            </div>
            <div className="modal-body pos-checkout-body">
              <div className="form-group">
                <label className="form-label"><User size={14} /> Client</label>
                <select value={payment.client_id} onChange={e => setPayment(p => ({ ...p, client_id: e.target.value }))}>
                  <option value="">Client comptoir</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><CreditCard size={14} /> Mode paiement</label>
                <select value={payment.mode} onChange={e => setPayment(p => ({ ...p, mode: e.target.value }))}>
                  {paymentModes.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><Banknote size={14} /> Montant reçu</label>
                <input autoFocus type="number" min="0" step="0.01" value={payment.received} onChange={e => setPayment(p => ({ ...p, received: e.target.value }))} />
                <small className="pos-payment-help">Somme remise par le client — ce n’est pas le prix du service.</small>
              </div>
              <div className="pos-tender-grid">
                {[50, 100, 200, 500].map(v => (
                  <button key={v} className="btn btn-secondary" onClick={() => setPayment(p => ({ ...p, received: String(toNumber(p.received) + v) }))}>
                    +{v}
                  </button>
                ))}
                <button className="btn btn-secondary" onClick={() => setPayment(p => ({ ...p, received: Number(authoritativeTotals.total).toFixed(2) }))}>Exact</button>
                <button className="btn btn-secondary" onClick={() => setPayment(p => ({ ...p, received: '' }))}>Effacer</button>
              </div>
              <div className="pos-checkout-total">
                <div><span>Total</span><strong>{fmt(authoritativeTotals.total)} {currency}</strong></div>
                <div><span>Reçu</span><strong>{fmt(totals.received)} {currency}</strong></div>
                <div className={remaining > 0 ? 'due' : 'change'}>
                  <span>{remaining > 0 ? 'Reste' : 'Monnaie'}</span>
                  <strong>{fmt(remaining > 0 ? remaining : changeDue)} {currency}</strong>
                </div>
              </div>
              {remaining > 0 ? (
                <div className="pos-payment-warning">
                  Montant insuffisant : ajoutez {fmt(remaining)} {currency} ou cliquez sur « Exact ».
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCheckoutOpen(false)}>Annuler</button>
              <button className="btn btn-success" onClick={finishSale} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <Receipt size={16} />}
                Valider vente
              </button>
            </div>
          </div>
        </div>
      )}

      {lastSale && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setLastSale(null)}>
          <div className="modal pos-receipt-modal">
            <div className="modal-header pos-sale-success no-print">
              <div className="pos-sale-success-title">
                <span className="pos-sale-success-icon"><CheckCircle2 size={25} /></span>
                <div>
                  <small>Vente validée avec succès</small>
                  <h2>Ticket {lastSale.number}</h2>
                </div>
              </div>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setLastSale(null)}>x</button>
            </div>
            <div className="modal-body">
              <div className="receipt-paper no-print">
                <h2>LIBRARY SABRI</h2>
                <p>{lastSale.number}</p>
                <p>{new Date(lastSale.date_time).toLocaleString('fr-MA')}</p>
                <p>Utilisateur: {lastSale.created_by_name || '-'}</p>
                <hr />
                {lastSale.items.map(i => (
                  <div className="receipt-line" key={i.id}>
                    <span>{i.product_name || i.description} x {fmt(i.quantity, 0)}</span>
                    <strong>{fmt(i.line_total * (vatEnabled ? (1 + i.tax_rate / 100) : 1))}</strong>
                  </div>
                ))}
                <hr />
                <div className="receipt-line"><span>Total TTC</span><strong>{fmt(lastSale.total_amount)} MAD</strong></div>
                <div className="receipt-line"><span>Payé</span><strong>{fmt(lastSale.paid_amount)} MAD</strong></div>
                <p>Merci pour votre visite</p>
              </div>
              <div className="no-print">
                <ThermalReceipt sale={lastSale} settings={settings} language={language} />
              </div>
              {createPortal(
                <ThermalReceiptPrintDocument sale={lastSale} settings={settings} language={language} />,
                document.body,
              )}
            </div>
            <div className="modal-footer no-print">
              <button className="btn btn-secondary" onClick={() => setLastSale(null)}>Fermer</button>
              <button className="btn btn-primary" onClick={printReceipt}><Printer size={16} /> Imprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PosProductImage({ product }) {
  const [failed, setFailed] = useState(false)
  const imageUrl = product?.image_path && !failed ? resolveMediaUrl(product.image_path) : ''

  useEffect(() => {
    setFailed(false)
  }, [product?.image_path])

  if (!imageUrl) return <ShoppingBag size={24} />
  return <img src={imageUrl} alt={product.name} loading="lazy" onError={() => setFailed(true)} />
}
