// src/pages/StockPage.jsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmt, fmtDateTime, idempotencyHeaders, operationHeaders } from '../lib/api'
import QRCode from 'qrcode'
import {
  Activity,
  AlertTriangle,
  Archive,
  Boxes,
  ClipboardList,
  Clock3,
  Filter,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { TableLoadingRow } from '../components/ui/LoadingStates'
import { useI18n } from '../lib/i18n'
import './StockPage.css'

const EMPTY_ADJUST = { product_id: '', quantity: 0, movement_type: 'adjustment', notes: '', unit_cost: 0, reference: 'MANUAL' }
const INVENTORY_LIMIT = 250
const MOVEMENT_COLORS = { in: 'success', out: 'danger', adjustment: 'accent', inventory: 'warning' }

export default function StockPage() {
  const { language, t } = useI18n()
  const movementLabels = useMemo(() => ({
    in: t('stock.movementIn'),
    out: t('stock.movementOut'),
    adjustment: t('stock.movementAdjustment'),
    inventory: t('stock.inventory'),
  }), [t])
  const unitLabel = useCallback(unit => (language === 'ar' && unit === 'pcs' ? 'قطعة' : unit), [language])
  const [searchParams] = useSearchParams()
  const [movements, setMovements] = useState([])
  const [products, setProducts] = useState([])
  const [summary, setSummary] = useState(null)
  const [reconciliation, setReconciliation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY_ADJUST)
  const [saving, setSaving] = useState(false)
  const [stockFilter, setStockFilter] = useState(() => {
    const requested = searchParams.get('status')
    return ['out', 'low', 'healthy'].includes(requested) ? requested : 'all'
  })
  const [query, setQuery] = useState('')
  const [movementType, setMovementType] = useState('')
  const [selectedProductId, setSelectedProductId] = useState(() => searchParams.get('product') || '')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [inventoryRows, setInventoryRows] = useState([])
  const [inventorySession, setInventorySession] = useState(null)
  const [inventoryQuery, setInventoryQuery] = useState('')
  const [inventoryBarcode, setInventoryBarcode] = useState('')
  const [inventorySaving, setInventorySaving] = useState(false)
  const [reorderOpen, setReorderOpen] = useState(false)
  const [reorderData, setReorderData] = useState(null)
  const [reorderLoading, setReorderLoading] = useState(false)
  const [inventoryScanner, setInventoryScanner] = useState(null)
  const [inventoryScannerOpen, setInventoryScannerOpen] = useState(false)
  const inventoryScannerCursor = useRef(0)
  const inventoryScannedProducts = useRef(new Set())

  useEffect(() => {
    const status = searchParams.get('status')
    const product = searchParams.get('product')
    if (['out', 'low', 'healthy'].includes(status)) setStockFilter(status)
    else if (!status) setStockFilter('all')
    setSelectedProductId(product || '')
  }, [searchParams])

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true)
    else setLoading(true)
    try {
      const productParams = { product_type: 'product', limit: 800 }
      const movementParams = {
        limit: 300,
        product_id: selectedProductId || undefined,
        movement_type: movementType || undefined,
      }
      const [summaryRes, reconciliationRes, movementRes, productRes] = await Promise.all([
        api.get('/stock/summary'),
        api.get('/stock/reconciliation'),
        api.get('/stock', { params: movementParams }),
        api.get('/products', { params: productParams }),
      ])
      setSummary(summaryRes.data)
      setReconciliation(reconciliationRes.data)
      setMovements(movementRes.data)
      setProducts(productRes.data)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur chargement stock')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [movementType, selectedProductId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!autoRefresh || modal || inventoryOpen) return undefined
    const timer = window.setInterval(() => load(true), 10000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, modal, inventoryOpen, load])

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter(product => {
      const matchesText = !q
        || product.name?.toLowerCase().includes(q)
        || product.code?.toLowerCase().includes(q)
        || product.barcode?.toLowerCase().includes(q)
      const quantity = Number(product.stock_quantity || 0)
      const matchesStatus = stockFilter === 'all'
        || (stockFilter === 'out' && quantity <= 0)
        || (stockFilter === 'low' && product.is_low_stock && quantity > 0)
        || (stockFilter === 'healthy' && !product.is_low_stock && quantity > 0)
      return matchesText && matchesStatus
    })
  }, [products, query, stockFilter])

  const selectedProduct = products.find(product => String(product.id) === String(form.product_id))
  const projectedStock = useMemo(() => {
    if (!selectedProduct) return null
    const current = Number(selectedProduct.stock_quantity || 0)
    const qty = Number(form.quantity || 0)
    if (form.movement_type === 'in') return current + qty
    if (form.movement_type === 'out') return Math.max(current - qty, 0)
    return qty
  }, [form.movement_type, form.quantity, selectedProduct])

  const openAdjust = (product = null, movement = 'adjustment') => {
    setForm({
      ...EMPTY_ADJUST,
      product_id: product?.id || '',
      quantity: movement === 'adjustment' || movement === 'inventory' ? Number(product?.stock_quantity || 0) : 0,
      movement_type: movement,
      unit_cost: Number(product?.purchase_price || 0),
    })
    setModal(true)
  }

  const handleAdjust = async () => {
    if (!form.product_id) return toast.error('Sélectionnez un produit')
    if (Number(form.quantity) < 0 || form.quantity === '') return toast.error('Quantité invalide')
    setSaving(true)
    try {
      const payload = {
        ...form,
        product_id: Number(form.product_id),
        quantity: Number(form.quantity || 0),
        unit_cost: Number(form.unit_cost || 0),
      }
      const { data } = await api.post('/stock/adjust', payload, { headers: idempotencyHeaders() })
      toast.success(`Stock mis à jour: ${fmt(data.new_stock, 2)}`)
      setModal(false)
      load(true)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur stock')
    } finally {
      setSaving(false)
    }
  }

  const openInventory = async () => {
    setInventorySaving(true)
    try {
      const selected = products.slice(0, INVENTORY_LIMIT)
      const { data } = await api.post('/stock/inventory-sessions', {
        product_ids: selected.map(product => product.id),
        notes: 'Inventaire rapide',
        warehouse_code: 'MAIN',
      }, { headers: idempotencyHeaders() })
      setInventorySession(data)
      setInventoryRows(data.lines.map(line => ({
        barcode: selected.find(product => product.id === line.product_id)?.barcode || '',
        product_id: line.product_id,
        code: line.product_code,
        name: line.product_name,
        unit: line.unit,
        current: Number(line.expected_qty || 0),
        quantity: Number(line.expected_qty || 0),
        movement_id: line.movement_id,
      })))
      setInventoryQuery('')
      setInventoryBarcode('')
      inventoryScannedProducts.current = new Set()
      setInventoryOpen(true)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Impossible de demarrer l’inventaire')
    } finally {
      setInventorySaving(false)
    }
  }

  const filteredInventoryRows = useMemo(() => {
    const q = inventoryQuery.trim().toLowerCase()
    if (!q) return inventoryRows
    return inventoryRows.filter(row =>
      row.name?.toLowerCase().includes(q)
      || row.code?.toLowerCase().includes(q)
    )
  }, [inventoryRows, inventoryQuery])

  const inventoryDiff = useMemo(() => inventoryRows.reduce((acc, row) => {
    const diff = Number(row.quantity || 0) - Number(row.current || 0)
    if (diff !== 0) acc.changed += 1
    if (diff > 0) acc.surplus += diff
    if (diff < 0) acc.shortage += Math.abs(diff)
    acc.totalDiff += diff
    return acc
  }, { changed: 0, totalDiff: 0, surplus: 0, shortage: 0 }), [inventoryRows])

  const updateInventoryQty = (productId, quantity) => {
    setInventoryRows(rows => rows.map(row => row.product_id === productId ? { ...row, quantity } : row))
  }

  const applyInventoryBarcode = useCallback(rawValue => {
    const value = String(rawValue || '').trim().toLowerCase()
    if (!value) return
    const row = inventoryRows.find(item =>
      item.barcode?.toLowerCase() === value || item.code?.toLowerCase() === value
    )
    if (!row) {
      toast.error('Code-barres introuvable dans cet inventaire')
      return
    }
    const alreadyScanned = inventoryScannedProducts.current.has(row.product_id)
    const nextQuantity = alreadyScanned ? Number(row.quantity || 0) + 1 : 1
    inventoryScannedProducts.current.add(row.product_id)
    updateInventoryQty(row.product_id, nextQuantity)
    setInventoryQuery(row.code || row.name)
    setInventoryBarcode('')
    toast.success(`${row.name}: ${fmt(nextQuantity, 2)}`, { duration: 900 })
  }, [inventoryRows])

  const handleInventoryBarcode = event => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    applyInventoryBarcode(inventoryBarcode)
  }

  const openReorderSuggestions = async () => {
    setReorderOpen(true)
    setReorderLoading(true)
    try {
      const { data } = await api.get('/stock/reorder-suggestions')
      setReorderData(data)
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Impossible de calculer le réapprovisionnement')
    } finally {
      setReorderLoading(false)
    }
  }

  const openInventoryPhoneScanner = async () => {
    if (inventoryScanner?.token) {
      setInventoryScannerOpen(true)
      return
    }
    try {
      const { data } = await api.post('/mobile-scanner/sessions')
      const current = new URL(window.location.href)
      const localHost = ['localhost', '127.0.0.1', '::1'].includes(current.hostname)
      const host = localHost ? data.lan_ip : current.hostname
      const basePath = window.location.pathname.startsWith('/erp') ? '/erp' : ''
      const localUrl = `${current.protocol}//${host}${current.port ? `:${current.port}` : ''}${basePath}/mobile-scanner?session=${encodeURIComponent(data.token)}`
      const scannerUrl = data.public_url
        ? `${String(data.public_url).replace(/\/$/, '')}/mobile-scanner?session=${encodeURIComponent(data.token)}`
        : localUrl
      const qrDataUrl = await QRCode.toDataURL(scannerUrl, {
        width: 280, margin: 1,
        color: { dark: '#102b58', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      inventoryScannerCursor.current = 0
      setInventoryScanner({ ...data, url: scannerUrl, qrDataUrl, connected: false })
      setInventoryScannerOpen(true)
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Impossible de connecter le scanner téléphone')
    }
  }

  useEffect(() => {
    if (!inventoryScanner?.token || !inventoryOpen) return undefined
    let stopped = false
    const poll = async () => {
      try {
        const { data } = await api.get(`/mobile-scanner/sessions/${inventoryScanner.token}/events`, {
          params: { after: inventoryScannerCursor.current },
        })
        if (stopped) return
        setInventoryScanner(current => current ? { ...current, connected: Boolean(data.connected) } : current)
        for (const event of data.events || []) {
          inventoryScannerCursor.current = Math.max(inventoryScannerCursor.current, Number(event.id || 0))
          applyInventoryBarcode(event.barcode)
        }
      } catch (error) {
        if (!stopped && error.response?.status === 404) {
          setInventoryScanner(null)
          setInventoryScannerOpen(false)
          toast.error('Session scanner expirée')
        }
      }
    }
    poll()
    const timer = window.setInterval(poll, 900)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [inventoryScanner?.token, inventoryOpen, applyInventoryBarcode])

  const handleInventoryCount = async () => {
    if (!inventorySession) return
    setInventorySaving(true)
    try {
      const { data } = await api.post(`/stock/inventory-sessions/${inventorySession.id}/count`, {
        items: inventoryRows.map(row => ({ product_id: row.product_id, quantity: Number(row.quantity || 0) })),
      }, { headers: operationHeaders(inventorySession.version) })
      setInventorySession(data)
      toast.success('Comptage enregistré. Vérifiez les écarts avant validation.')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Comptage impossible')
    } finally {
      setInventorySaving(false)
    }
  }

  const handleInventoryValidate = async () => {
    if (!inventorySession) return
    setInventorySaving(true)
    try {
      const { data } = await api.post(
        `/stock/inventory-sessions/${inventorySession.id}/validate`,
        {},
        { headers: operationHeaders(inventorySession.version) },
      )
      setInventorySession(data)
      setInventoryRows(rows => rows.map(row => {
        const line = data.lines.find(item => item.product_id === row.product_id)
        return { ...row, movement_id: line?.movement_id || null }
      }))
      toast.success(`${data.lines.filter(line => line.movement_id).length} écart(s) validé(s)`)
      await load(true)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Validation impossible')
    } finally {
      setInventorySaving(false)
    }
  }

  const lowStock = products.filter(product => product.is_low_stock)
  const outOfStock = products.filter(product => Number(product.stock_quantity || 0) <= 0)

  return (
    <div className="page-content stock-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('stock.title')}</h1>
          <p className="stock-runtime-text">
            {t('stock.runtime')} {summary?.runtime_at ? fmtDateTime(summary.runtime_at) : '...'}
            {refreshing ? <span>{t('stock.syncing')}</span> : null}
          </p>
        </div>
        <div className="toolbar">
          <button className={`btn btn-secondary ${autoRefresh ? 'stock-live' : ''}`} onClick={() => setAutoRefresh(value => !value)}>
            <Activity size={16} /> {t('stock.live')}
          </button>
          <button className="btn btn-secondary" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'stock-spin' : ''} /> {t('stock.refresh')}
          </button>
          <button className="btn btn-secondary" onClick={openInventory} disabled={loading || products.length === 0}>
            {inventorySaving && !inventoryOpen ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <ClipboardList size={16} />} {t('stock.inventory')}
          </button>
          <button className="btn btn-secondary" onClick={openReorderSuggestions}>
            <ShoppingCart size={16} /> {t('stock.reorder')}
          </button>
          <button className="btn btn-primary" onClick={() => openAdjust()}><Plus size={16} /> {t('stock.newMovement')}</button>
        </div>
      </div>

      <div className={`stock-reconciliation ${reconciliation?.ok ? 'is-ok' : 'has-errors'}`}>
        <ShieldCheck size={19} />
        <div>
          <strong>{reconciliation?.ok ? t('stock.reconciled') : t('stock.reconciliationMismatch')}</strong>
          <span>
            {reconciliation
              ? t('stock.reconciliationSummary', { products: reconciliation.checked_products, movements: reconciliation.movement_count, mismatches: reconciliation.mismatch_count })
              : t('stock.verifying')}
          </span>
        </div>
        <span className="stock-warehouse">{t('stock.warehouse')} {reconciliation?.warehouse_code || 'MAIN'}</span>
      </div>

      <div className="stock-kpis">
        <div className="kpi-card blue"><div className="kpi-icon blue"><Boxes size={20} /></div><div className="kpi-value">{summary?.products_count || 0}</div><div className="kpi-label">{t('stock.trackedProducts')}</div></div>
        <div className="kpi-card green"><div className="kpi-icon green"><PackageCheck size={20} /></div><div className="kpi-value">{fmt(summary?.stock_value || 0)}</div><div className="kpi-label">{t('stock.stockValue')}</div></div>
        <div className="kpi-card orange"><div className="kpi-icon orange"><AlertTriangle size={20} /></div><div className="kpi-value">{summary?.low_stock_count || 0}</div><div className="kpi-label">{t('stock.lowStock')}</div></div>
        <div className="kpi-card red"><div className="kpi-icon red"><Archive size={20} /></div><div className="kpi-value">{summary?.out_of_stock_count || 0}</div><div className="kpi-label">{t('stock.outOfStock')}</div></div>
      </div>

      {(lowStock.length > 0 || outOfStock.length > 0) && (
        <div className="alert alert-warning">
          <AlertTriangle size={18} />
          <div>
            <strong>{t('stock.alertSummary', { low: lowStock.length, out: outOfStock.length })}</strong>
            {' '}
            {lowStock.slice(0, 5).map(product => product.name).join(', ')}
            {lowStock.length > 5 ? '...' : ''}
          </div>
        </div>
      )}

      <div className="stock-filters">
        <div className="search-wrap">
          <Search size={15} className="search-icon" />
          <input placeholder={t('stock.searchPlaceholder')} value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="stock-status-tabs" aria-label="Filtrer les niveaux de stock">
          {[
            ['all', t('stock.all')],
            ['healthy', t('stock.available')],
            ['low', t('stock.low')],
            ['out', t('stock.out')],
          ].map(([value, label]) => (
            <button key={value} className={stockFilter === value ? 'active' : ''} onClick={() => setStockFilter(value)}>{label}</button>
          ))}
        </div>
        <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}>
          <option value="">{t('stock.allMovements')}</option>
          {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <select value={movementType} onChange={e => setMovementType(e.target.value)}>
          <option value="">{t('stock.allTypes')}</option>
          {Object.entries(movementLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>

      <div className="stock-grid">
        <section className="card stock-panel">
          <div className="stock-panel-head">
            <div><Boxes size={17} /> {t('stock.levels')}</div>
            <span>{t('stock.productsCount', { count: filteredProducts.length })}</span>
          </div>
          <div className="table-wrap stock-table-scroll">
            <table>
              <thead><tr><th>{t('stock.product')}</th><th>{t('stock.stock')}</th><th>{t('stock.minimum')}</th><th>{t('stock.value')}</th><th></th></tr></thead>
              <tbody>
                {loading ? (
                  <TableLoadingRow colSpan={5} label="Synchronisation stock runtime..." />
                ) : filteredProducts.length === 0 ? (
                  <tr><td colSpan={5}><div className="empty-state"><Boxes size={38} /><p>Aucun produit</p></div></td></tr>
                ) : filteredProducts.map(product => (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                      <div className="text-muted text-sm">{product.code}</div>
                    </td>
                    <td>
                      <div className="stock-level">
                        <strong className={Number(product.stock_quantity || 0) <= 0 ? 'text-danger' : product.is_low_stock ? 'text-warning' : 'text-success'}>
                          {fmt(product.stock_quantity, 2)}
                        </strong>
                        <span>{unitLabel(product.unit)}</span>
                      </div>
                      {product.is_low_stock && <span className="badge badge-warning">{t('stock.low')}</span>}
                    </td>
                    <td className="text-muted text-sm">{fmt(product.min_stock, 2)} {unitLabel(product.unit)}</td>
                    <td>{fmt(product.stock_value)} MAD</td>
                    <td>
                      <div className="flex gap-2">
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openAdjust(product, 'in')} title="Entrée"><Plus size={14} /></button>
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openAdjust(product, 'inventory')} title="Inventaire"><Filter size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card stock-panel">
          <div className="stock-panel-head">
            <div><Clock3 size={17} /> {t('stock.latestMovements')}</div>
            <span>{t('stock.todayCount', { count: summary?.movements_today || 0 })}</span>
          </div>
          <div className="table-wrap stock-table-scroll">
            <table>
              <thead><tr><th>{t('stock.product')}</th><th>{t('stock.type')}</th><th>{t('stock.quantity')}</th><th>{t('stock.before')}</th><th>{t('stock.after')}</th><th>{t('stock.user')}</th><th>{t('stock.date')}</th></tr></thead>
              <tbody>
                {loading ? (
                  <TableLoadingRow colSpan={7} label="Chargement mouvements..." />
                ) : movements.length === 0 ? (
                  <tr><td colSpan={7}><div className="empty-state"><Activity size={38} /><p>Aucun mouvement</p></div></td></tr>
                ) : movements.slice(0, 80).map(movement => {
                  const color = MOVEMENT_COLORS[movement.movement_type] || 'accent'
                  const sign = movement.movement_type === 'out' ? '-' : movement.movement_type === 'adjustment' || movement.movement_type === 'inventory' ? '' : '+'
                  return (
                    <tr key={movement.id}>
                      <td>
                        <strong className="text-sm">{movement.product_name}</strong>
                        {movement.reference && <div className="text-muted text-sm">{movement.reference}</div>}
                      </td>
                      <td><span className={`stock-movement-badge ${color}`}>{movementLabels[movement.movement_type] || movement.movement_type}</span></td>
                      <td className={movement.movement_type === 'out' ? 'text-danger font-semibold' : 'text-success font-semibold'}>{sign}{fmt(movement.quantity, 2)}</td>
                      <td className="text-muted">{fmt(movement.before_qty, 2)}</td>
                      <td>{fmt(movement.after_qty, 2)}</td>
                      <td className="text-muted text-sm">{movement.created_by_name || '—'}</td>
                      <td className="text-muted text-sm">{fmtDateTime(movement.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>Mouvement de stock</h2>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(false)}>x</button>
            </div>
            <div className="modal-body">
              <div className="form-grid form-grid-2">
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Produit *</label>
                  <select value={form.product_id || ''} onChange={e => {
                    const product = products.find(item => String(item.id) === String(e.target.value))
                    setForm(current => ({
                      ...current,
                      product_id: e.target.value,
                      unit_cost: Number(product?.purchase_price || 0),
                      quantity: current.movement_type === 'adjustment' || current.movement_type === 'inventory' ? Number(product?.stock_quantity || 0) : current.quantity,
                    }))
                  }}>
                    <option value="">Sélectionner</option>
                    {products.map(product => <option key={product.id} value={product.id}>{product.name} - stock: {fmt(product.stock_quantity, 2)} {product.unit}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select value={form.movement_type} onChange={e => setForm(current => ({ ...current, movement_type: e.target.value }))}>
                    <option value="adjustment">Ajustement exact</option>
                    <option value="inventory">Inventaire exact</option>
                    <option value="in">Entrée</option>
                    <option value="out">Sortie</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">{form.movement_type === 'in' || form.movement_type === 'out' ? 'Quantité mouvement' : 'Stock exact'}</label>
                  <input type="number" min="0" step="0.01" value={form.quantity} onChange={e => setForm(current => ({ ...current, quantity: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Coût unitaire</label>
                  <input type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => setForm(current => ({ ...current, unit_cost: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Référence</label>
                  <input value={form.reference} onChange={e => setForm(current => ({ ...current, reference: e.target.value }))} placeholder="MANUAL, INV-..." />
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Notes</label>
                  <textarea value={form.notes || ''} onChange={e => setForm(current => ({ ...current, notes: e.target.value }))} rows={2} placeholder="Raison du mouvement..." />
                </div>
              </div>
              {selectedProduct && (
                <div className="stock-preview">
                  <div><span>Actuel</span><strong>{fmt(selectedProduct.stock_quantity, 2)} {selectedProduct.unit}</strong></div>
                  <div><span>Après mouvement</span><strong>{fmt(projectedStock, 2)} {selectedProduct.unit}</strong></div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleAdjust} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : null}
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {inventoryOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setInventoryOpen(false)}>
          <div className="modal modal-lg stock-inventory-modal">
            <div className="modal-header">
              <div>
                <h2>Inventaire rapide</h2>
                <p className="text-muted text-sm">
                  {inventorySession?.reference} · {inventorySession?.status === 'draft' ? 'Brouillon' : inventorySession?.status === 'counted' ? 'Compté, en attente de validation' : 'Validé'}
                </p>
              </div>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setInventoryOpen(false)}>x</button>
            </div>
            <div className="modal-body">
              <div className="stock-inventory-toolbar">
                <div className="search-wrap">
                  <Search size={15} className="search-icon" />
                  <input placeholder="Rechercher dans l'inventaire..." value={inventoryQuery} onChange={e => setInventoryQuery(e.target.value)} />
                </div>
                <div className="stock-inventory-summary">
                  <span>{inventoryDiff.changed} ecart(s)</span>
                  <strong>{inventoryDiff.totalDiff > 0 ? '+' : ''}{fmt(inventoryDiff.totalDiff, 2)}</strong>
                </div>
              </div>
              {inventorySession?.status === 'draft' ? (
                <div className="stock-barcode-counter">
                  <div>
                    <strong>Comptage par code-barres</strong>
                    <span>Scannez puis appuyez sur Entrée : chaque scan ajoute une unité.</span>
                  </div>
                  <div className="search-wrap">
                    <Search size={15} className="search-icon" />
                    <input
                      autoFocus
                      value={inventoryBarcode}
                      onChange={event => setInventoryBarcode(event.target.value)}
                      onKeyDown={handleInventoryBarcode}
                      placeholder="Scanner un code-barres…"
                    />
                  </div>
                  <button className="btn btn-secondary" onClick={openInventoryPhoneScanner}>
                    <Smartphone size={16} /> Scanner avec téléphone
                  </button>
                </div>
              ) : null}
              <div className="stock-difference-cards">
                <div><span>Lignes modifiées</span><strong>{inventoryDiff.changed}</strong></div>
                <div className="positive"><span>Surplus</span><strong>+{fmt(inventoryDiff.surplus, 2)}</strong></div>
                <div className="negative"><span>Manquant</span><strong>-{fmt(inventoryDiff.shortage, 2)}</strong></div>
              </div>
              {products.length > INVENTORY_LIMIT && (
                <div className="settings-note">
                  Affichage limite aux {INVENTORY_LIMIT} premiers produits pour garder l'interface rapide.
                </div>
              )}
              <div className="table-wrap stock-inventory-table">
                <table>
                  <thead><tr><th>Produit</th><th>Actuel</th><th>Compte</th><th>Ecart</th></tr></thead>
                  <tbody>
                    {filteredInventoryRows.map(row => {
                      const diff = Number(row.quantity || 0) - Number(row.current || 0)
                      return (
                        <tr key={row.product_id} className={diff !== 0 ? 'stock-row-changed' : ''}>
                          <td><strong>{row.name}</strong><div className="text-muted text-sm">{row.code}</div></td>
                          <td>{fmt(row.current, 2)} {row.unit}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.quantity}
                              onChange={e => updateInventoryQty(row.product_id, e.target.value)}
                              disabled={inventorySession?.status !== 'draft'}
                            />
                          </td>
                          <td className={diff < 0 ? 'text-danger font-semibold' : diff > 0 ? 'text-success font-semibold' : 'text-muted'}>
                            {diff > 0 ? '+' : ''}{fmt(diff, 2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setInventoryOpen(false)}>Annuler</button>
              {inventorySession?.status === 'draft' && (
                <button className="btn btn-primary" onClick={handleInventoryCount} disabled={inventorySaving}>
                  {inventorySaving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <ClipboardList size={16} />}
                  Enregistrer le comptage
                </button>
              )}
              {inventorySession?.status === 'counted' && (
                <button className="btn btn-primary" onClick={handleInventoryValidate} disabled={inventorySaving}>
                  {inventorySaving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <ShieldCheck size={16} />}
                  Valider les écarts
                </button>
              )}
              {inventorySession?.status === 'validated' && (
                <button className="btn btn-primary" onClick={() => setInventoryOpen(false)}>Terminer</button>
              )}
            </div>
          </div>
        </div>
      )}

      {reorderOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setReorderOpen(false)}>
          <div className="modal modal-lg stock-reorder-modal">
            <div className="modal-header">
              <div>
                <h2>Propositions de réapprovisionnement</h2>
                <p className="text-muted text-sm">Vitesse de vente sur 30 jours · délai 14 jours · sécurité 7 jours</p>
              </div>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setReorderOpen(false)}><X size={17} /></button>
            </div>
            <div className="modal-body">
              <div className="table-wrap stock-reorder-table">
                <table>
                  <thead><tr><th>Produit</th><th>Stock</th><th>Ventes 30 j</th><th>Vitesse / j</th><th>Couverture</th><th>À commander</th></tr></thead>
                  <tbody>
                    {reorderLoading ? (
                      <TableLoadingRow colSpan={6} label="Calcul des besoins..." />
                    ) : !reorderData?.items?.length ? (
                      <tr><td colSpan={6}><div className="empty-state"><PackageCheck size={38} /><p>Aucun réapprovisionnement nécessaire</p></div></td></tr>
                    ) : reorderData.items.map(item => (
                      <tr key={item.product_id} className={item.is_out_of_stock ? 'stock-row-critical' : ''}>
                        <td><strong>{item.product_name}</strong><div className="text-muted text-sm">{item.product_code}</div></td>
                        <td>{fmt(item.current_stock, 2)} {item.unit}</td>
                        <td>{fmt(item.sales_quantity, 2)}</td>
                        <td>{fmt(item.daily_velocity, 2)}</td>
                        <td>{item.days_cover == null ? 'Pas de vente' : `${fmt(item.days_cover, 1)} j`}</td>
                        <td><span className="stock-order-quantity">+{fmt(item.suggested_quantity, 0)} {item.unit}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setReorderOpen(false)}>Terminer</button>
            </div>
          </div>
        </div>
      )}

      {inventoryScannerOpen && inventoryScanner && (
        <div className="modal-overlay stock-scanner-layer" onClick={e => e.target === e.currentTarget && setInventoryScannerOpen(false)}>
          <div className="modal stock-scanner-modal">
            <div className="modal-header">
              <div><h2>Scanner d'inventaire</h2><p className="text-muted text-sm">Connexion unique pour toute la session</p></div>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setInventoryScannerOpen(false)}><X size={17} /></button>
            </div>
            <div className="modal-body">
              <img src={inventoryScanner.qrDataUrl} alt="QR scanner inventaire" className="stock-scanner-qr" />
              <div className={`stock-phone-status ${inventoryScanner.connected ? 'is-connected' : ''}`}>
                <Wifi size={17} />
                {inventoryScanner.connected ? 'Téléphone connecté — scannez les produits' : 'Scannez ce QR une seule fois avec le téléphone'}
              </div>
              <p className="text-muted text-sm">Gardez la page ouverte sur le téléphone. Chaque code détecté met à jour immédiatement le comptage.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
