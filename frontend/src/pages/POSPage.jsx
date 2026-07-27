// src/pages/POSPage.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Banknote, Barcode, Calculator, CreditCard, Minus, Pause, Plus,
  Printer, Receipt, RotateCcw, Search, ShoppingBag, Trash2, User
} from 'lucide-react'
import { api, fmt, fmtDateTime, operationHeaders, resolveMediaUrl, SETTLEMENT_METHODS } from '../lib/api'
import { PageLoader } from '../components/ui/LoadingStates'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useI18n } from '../lib/i18n'
import ThermalReceipt from '../components/print/ThermalReceipt'
import './POSPage.css'

const HELD_KEY = 'proerp_pos_held_cart'
const PRODUCT_GRID_ROWS = 3

const emptyPayment = { mode: 'cash', received: '', discount: 0, client_id: '' }

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function lineTotal(item) {
  const qty = toNumber(item.quantity, 1)
  const price = toNumber(item.unit_price)
  const discount = toNumber(item.discount)
  const net = qty * price * (1 - discount / 100)
  const tax = net * toNumber(item.tax_rate, 20) / 100
  return { net, tax, total: net + tax }
}

export default function POSPage() {
  const confirm = useConfirm()
  const { language } = useI18n()
  const [products, setProducts] = useState([])
  const [clients, setClients] = useState([])
  const [categories, setCategories] = useState([])
  const [cart, setCart] = useState([])
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [payment, setPayment] = useState(emptyPayment)
  const [loading, setLoading] = useState(true)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSale, setLastSale] = useState(null)
  const [productPage, setProductPage] = useState(1)
  const [productPageSize, setProductPageSize] = useState(9)
  const [settings, setSettings] = useState({})
  const [serverPreview, setServerPreview] = useState(null)
  const searchRef = useRef(null)
  const productGridRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, c, cat, settingsRes] = await Promise.all([
        api.get('/products', { params: { limit: 500 } }),
        api.get('/clients', { params: { limit: 500 } }),
        api.get('/categories'),
        api.get('/settings'),
      ])
      setProducts(p.data)
      setClients(c.data)
      setCategories(cat.data)
      setSettings(settingsRes.data || {})
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur de chargement POS')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const saved = localStorage.getItem(HELD_KEY)
    if (saved) {
      try { setCart(JSON.parse(saved)) } catch {}
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
  }, [query, categoryId])

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
      const matches = !q
        || p.name?.toLowerCase().includes(q)
        || p.code?.toLowerCase().includes(q)
        || p.barcode?.toLowerCase().includes(q)
      return inCategory && matches
    })
  }, [products, query, categoryId])
  const paymentModes = SETTLEMENT_METHODS
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
      const lt = lineTotal(item)
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
  }, [cart, payment.discount, payment.received])

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
      purchase_price: item.purchase_price,
      discount: item.discount || 0,
      tax_rate: item.tax_rate ?? 0,
    })),
  }), [cart, payment.client_id, payment.discount, payment.mode])

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
      if (!fresh || fresh.product_type !== 'product') return [item]
      const available = Math.max(0, toNumber(fresh.stock_quantity))
      if (available <= 0) {
        adjusted = true
        removed = true
        return []
      }
      if (toNumber(item.quantity, 1) > available) {
        adjusted = true
        return [{ ...item, quantity: available, stock_quantity: available }]
      }
      return [{ ...item, stock_quantity: available }]
    }))
    if (adjusted && showToast) {
      toast.error(removed
        ? 'Certains produits sont hors stock et ont été retirés'
        : 'Quantité ajustée selon le stock disponible'
      )
    }
    return adjusted
  }, [])

  const addProduct = (product) => {
    const available = Math.max(0, toNumber(product.stock_quantity))
    if (product.product_type === 'product' && available <= 0) {
      toast.error('Stock insuffisant')
      return
    }
    setCart(prev => {
      const found = prev.find(i => i.product_id === product.id)
      if (found) {
        const nextQty = toNumber(found.quantity, 1) + 1
        if (product.product_type === 'product' && nextQty > available) {
          toast.error(`Stock disponible: ${fmt(available, 0)} ${product.unit || ''}`)
          return prev.map(i => i.product_id === product.id
            ? { ...i, quantity: available, stock_quantity: available }
            : i
          )
        }
        return prev.map(i => i.product_id === product.id
          ? { ...i, quantity: nextQty, stock_quantity: available }
          : i
        )
      }
      return [...prev, {
        product_id: product.id,
        code: product.code,
        name: product.name,
        description: product.name,
        quantity: 1,
        unit_price: toNumber(product.sale_price),
        purchase_price: toNumber(product.purchase_price),
        discount: 0,
        tax_rate: toNumber(product.tax_rate, 20),
        stock_quantity: available,
        product_type: product.product_type,
      }]
    })
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
    const qty = Math.max(0, toNumber(quantity))
    setCart(prev => prev.flatMap(item => {
      if (item.product_id !== productId) return [item]
      if (qty <= 0) return []
      if (item.product_type === 'product' && qty > item.stock_quantity) {
        toast.error(`Quantité ajustée au stock disponible: ${fmt(item.stock_quantity, 0)}`)
        return [{ ...item, quantity: item.stock_quantity }]
      }
      return [{ ...item, quantity: qty }]
    }))
  }

  const updateLine = (productId, key, value) => {
    setCart(prev => prev.map(item => item.product_id === productId
      ? { ...item, [key]: toNumber(value) }
      : item
    ))
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
    setCart([])
    setPayment(emptyPayment)
    localStorage.removeItem(HELD_KEY)
  }

  const holdCart = () => {
    if (!cart.length) return toast.error('Panier vide')
    localStorage.setItem(HELD_KEY, JSON.stringify(cart))
    toast.success('Panier mis en attente')
  }

  const restoreCart = () => {
    const saved = localStorage.getItem(HELD_KEY)
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
    setSaving(true)
    try {
      const freshProducts = await api.get('/products', { params: { limit: 500 } })
      setProducts(freshProducts.data)
      if (syncCartWithStock(freshProducts.data)) {
        setSaving(false)
        return
      }
      const payload = previewPayload
      const { data: exact } = await api.post('/sales/preview', payload)
      setServerPreview(exact)
      if (totals.received < Number(exact.total_amount)) {
        toast.error(`Montant reçu insuffisant. Total exact: ${fmt(exact.total_amount)} ${exact.currency_code}`)
        return
      }
      const created = await api.post('/sales', payload)
      const confirmed = await api.post(`/sales/${created.data.id}/confirm`, {}, { headers: operationHeaders(created.data.version) })
      const paid = await api.post(`/sales/${created.data.id}/payment`, {
        amount: created.data.total_amount,
        payment_mode: payment.mode,
      }, { headers: operationHeaders(confirmed.data.version) })
      setLastSale(paid.data)
      setCart([])
      setPayment(emptyPayment)
      localStorage.removeItem(HELD_KEY)
      setCheckoutOpen(false)
      await load()
      toast.success(`Ticket ${paid.data.number} encaissé`)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur encaissement')
    } finally {
      setSaving(false)
    }
  }

  const printReceipt = () => setTimeout(() => window.print(), 50)

  return (
    <div className="pos-page">
      <div className="pos-header">
        <div>
          <h1 className="page-title">Point de vente</h1>
          <p>Vente rapide, stock contrôlé, paiement immédiat</p>
        </div>
        <div className="pos-actions">
          <button className="btn btn-secondary" onClick={restoreCart}><RotateCcw size={16} /> Reprendre</button>
          <button className="btn btn-secondary" onClick={holdCart}><Pause size={16} /> Attente</button>
          <button className="btn btn-danger" onClick={clearCart}><Trash2 size={16} /> Vider</button>
        </div>
      </div>

      <div className="pos-shell">
        <section className="pos-catalog">
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
                {pagedProducts.map(p => (
                  <button key={p.id} className="pos-product" onClick={() => addProduct(p)}>
                    <div className="pos-product-image">
                      <PosProductImage product={p} />
                    </div>
                    <span className="pos-product-code">{p.code || p.barcode || 'PROD'}</span>
                    <strong>{p.name}</strong>
                    <span>{fmt(p.sale_price)} {currency}</span>
                    <small className={p.is_low_stock ? 'stock-low' : ''}>
                      Stock: {fmt(p.stock_quantity, 0)} {p.unit || ''}
                    </small>
                    {p.updated_at && <small>Maj: {fmtDateTime(p.updated_at)}</small>}
                  </button>
                ))}
              </div>
            </>
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
              const lt = lineTotal(item)
              return (
                <div className="pos-line" key={item.product_id}>
                  <div className="pos-line-main">
                    <strong>{item.name}</strong>
                    <span>{fmt(item.unit_price)} {currency} x {fmt(item.quantity, 0)}</span>
                  </div>
                  <div className="pos-line-controls">
                    <button className="btn btn-secondary btn-icon btn-sm" onClick={() => updateQty(item.product_id, item.quantity - 1)}><Minus size={14} /></button>
                    <input type="number" min="0" step="1" value={item.quantity} onChange={e => updateQty(item.product_id, e.target.value)} />
                    <button className="btn btn-secondary btn-icon btn-sm" onClick={() => updateQty(item.product_id, item.quantity + 1)}><Plus size={14} /></button>
                    <button className="btn btn-danger btn-icon btn-sm" onClick={() => updateQty(item.product_id, 0)}><Trash2 size={14} /></button>
                  </div>
                  <div className="pos-line-extra">
                    <label>Remise %<input type="number" min="0" max="100" value={item.discount} onChange={e => updateLine(item.product_id, 'discount', e.target.value)} /></label>
                    <label>TVA %<select value={item.tax_rate} onChange={e => updateLine(item.product_id, 'tax_rate', e.target.value)}>{taxRates.map(rate => <option key={rate} value={rate}>{rate}%</option>)}</select></label>
                    <strong>{fmt(lt.total)} {currency}</strong>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="pos-summary">
            <div><span>Sous-total</span><strong>{fmt(authoritativeTotals.subtotal)} {currency}</strong></div>
            <div><span>TVA</span><strong>{fmt(authoritativeTotals.tax)} {currency}</strong></div>
            <label>Remise globale %
              <input type="number" min="0" max="100" value={payment.discount} onChange={e => setPayment(p => ({ ...p, discount: e.target.value }))} />
            </label>
            <div className="pos-total"><span>Total</span><strong>{fmt(authoritativeTotals.total)} {currency}</strong></div>
            <small>{serverPreview ? 'Total exact serveur' : 'Vérification du total…'}</small>
          </div>

          <button className="btn btn-primary pos-pay-btn" disabled={!cart.length} onClick={() => {
            setPayment(p => ({ ...p, received: p.received || Number(authoritativeTotals.total).toFixed(2) }))
            setCheckoutOpen(true)
          }}>
            <Calculator size={18} /> Encaisser (F9)
          </button>
        </aside>
      </div>

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
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCheckoutOpen(false)}>Annuler</button>
              <button className="btn btn-success" onClick={finishSale} disabled={saving || remaining > 0}>
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
            <div className="modal-header no-print">
              <h2>Ticket {lastSale.number}</h2>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setLastSale(null)}>x</button>
            </div>
            <div className="modal-body">
              <div className="receipt-paper no-print">
                <h2>Maktaba Print</h2>
                <p>{lastSale.number}</p>
                <p>{new Date(lastSale.date_time).toLocaleString('fr-MA')}</p>
                <p>Utilisateur: {lastSale.created_by_name || '-'}</p>
                <hr />
                {lastSale.items.map(i => (
                  <div className="receipt-line" key={i.id}>
                    <span>{i.product_name || i.description} x {fmt(i.quantity, 0)}</span>
                    <strong>{fmt(i.line_total * (1 + i.tax_rate / 100))}</strong>
                  </div>
                ))}
                <hr />
                <div className="receipt-line"><span>Total TTC</span><strong>{fmt(lastSale.total_amount)} MAD</strong></div>
                <div className="receipt-line"><span>Payé</span><strong>{fmt(lastSale.paid_amount)} MAD</strong></div>
                <p>Merci pour votre visite</p>
              </div>
              <div className="thermal-print-active">
                <ThermalReceipt sale={lastSale} settings={settings} language={language} />
              </div>
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
