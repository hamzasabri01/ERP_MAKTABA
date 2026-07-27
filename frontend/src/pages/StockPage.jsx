// src/pages/StockPage.jsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, fmt, fmtDateTime, idempotencyHeaders, operationHeaders } from '../lib/api'
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
} from 'lucide-react'
import toast from 'react-hot-toast'
import { TableLoadingRow } from '../components/ui/LoadingStates'
import './StockPage.css'

const EMPTY_ADJUST = { product_id: '', quantity: 0, movement_type: 'adjustment', notes: '', unit_cost: 0, reference: 'MANUAL' }
const INVENTORY_LIMIT = 250
const MOVEMENT_LABELS = { in: 'Entrée', out: 'Sortie', adjustment: 'Ajustement', inventory: 'Inventaire' }
const MOVEMENT_COLORS = { in: 'success', out: 'danger', adjustment: 'accent', inventory: 'warning' }

export default function StockPage() {
  const [movements, setMovements] = useState([])
  const [products, setProducts] = useState([])
  const [summary, setSummary] = useState(null)
  const [reconciliation, setReconciliation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY_ADJUST)
  const [saving, setSaving] = useState(false)
  const [lowOnly, setLowOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [movementType, setMovementType] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [inventoryRows, setInventoryRows] = useState([])
  const [inventorySession, setInventorySession] = useState(null)
  const [inventoryQuery, setInventoryQuery] = useState('')
  const [inventorySaving, setInventorySaving] = useState(false)

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true)
    else setLoading(true)
    try {
      const productParams = { product_type: 'product', limit: 800, low_stock: lowOnly || undefined }
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
  }, [lowOnly, movementType, selectedProductId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!autoRefresh || modal || inventoryOpen) return undefined
    const timer = window.setInterval(() => load(true), 10000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, modal, inventoryOpen, load])

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products
    return products.filter(product =>
      product.name?.toLowerCase().includes(q)
      || product.code?.toLowerCase().includes(q)
      || product.barcode?.toLowerCase().includes(q)
    )
  }, [products, query])

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
        product_id: line.product_id,
        code: line.product_code,
        name: line.product_name,
        unit: line.unit,
        current: Number(line.expected_qty || 0),
        quantity: Number(line.expected_qty || 0),
        movement_id: line.movement_id,
      })))
      setInventoryQuery('')
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
    acc.totalDiff += diff
    return acc
  }, { changed: 0, totalDiff: 0 }), [inventoryRows])

  const updateInventoryQty = (productId, quantity) => {
    setInventoryRows(rows => rows.map(row => row.product_id === productId ? { ...row, quantity } : row))
  }

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
          <h1 className="page-title">Gestion du stock</h1>
          <p className="stock-runtime-text">
            Runtime {summary?.runtime_at ? fmtDateTime(summary.runtime_at) : '...'}
            {refreshing ? <span>Synchronisation...</span> : null}
          </p>
        </div>
        <div className="toolbar">
          <button className={`btn btn-secondary ${autoRefresh ? 'stock-live' : ''}`} onClick={() => setAutoRefresh(value => !value)}>
            <Activity size={16} /> Live
          </button>
          <button className="btn btn-secondary" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'stock-spin' : ''} /> Actualiser
          </button>
          <button className="btn btn-secondary" onClick={openInventory} disabled={loading || products.length === 0}>
            {inventorySaving && !inventoryOpen ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <ClipboardList size={16} />} Inventaire
          </button>
          <button className="btn btn-primary" onClick={() => openAdjust()}><Plus size={16} /> Mouvement stock</button>
        </div>
      </div>

      <div className={`stock-reconciliation ${reconciliation?.ok ? 'is-ok' : 'has-errors'}`}>
        <ShieldCheck size={19} />
        <div>
          <strong>{reconciliation?.ok ? 'Stock réconcilié' : 'Écart de réconciliation détecté'}</strong>
          <span>
            {reconciliation
              ? `${reconciliation.checked_products} produit(s), ${reconciliation.movement_count} mouvement(s), ${reconciliation.mismatch_count} écart(s)`
              : 'Vérification en cours...'}
          </span>
        </div>
        <span className="stock-warehouse">Entrepôt {reconciliation?.warehouse_code || 'MAIN'}</span>
      </div>

      <div className="stock-kpis">
        <div className="kpi-card blue"><div className="kpi-icon blue"><Boxes size={20} /></div><div className="kpi-value">{summary?.products_count || 0}</div><div className="kpi-label">Produits suivis</div></div>
        <div className="kpi-card green"><div className="kpi-icon green"><PackageCheck size={20} /></div><div className="kpi-value">{fmt(summary?.stock_value || 0)}</div><div className="kpi-label">Valeur stock MAD</div></div>
        <div className="kpi-card orange"><div className="kpi-icon orange"><AlertTriangle size={20} /></div><div className="kpi-value">{summary?.low_stock_count || 0}</div><div className="kpi-label">Stock faible</div></div>
        <div className="kpi-card red"><div className="kpi-icon red"><Archive size={20} /></div><div className="kpi-value">{summary?.out_of_stock_count || 0}</div><div className="kpi-label">Rupture stock</div></div>
      </div>

      {(lowStock.length > 0 || outOfStock.length > 0) && (
        <div className="alert alert-warning">
          <AlertTriangle size={18} />
          <div>
            <strong>{lowStock.length} stock faible, {outOfStock.length} rupture.</strong>
            {' '}
            {lowStock.slice(0, 5).map(product => product.name).join(', ')}
            {lowStock.length > 5 ? '...' : ''}
          </div>
        </div>
      )}

      <div className="stock-filters">
        <div className="search-wrap">
          <Search size={15} className="search-icon" />
          <input placeholder="Rechercher produit, code, code-barres..." value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <button className={`btn btn-sm ${!lowOnly ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLowOnly(false)}>Tous</button>
        <button className={`btn btn-sm ${lowOnly ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLowOnly(true)}>Stock faible</button>
        <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}>
          <option value="">Tous les mouvements</option>
          {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <select value={movementType} onChange={e => setMovementType(e.target.value)}>
          <option value="">Tous types</option>
          {Object.entries(MOVEMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>

      <div className="stock-grid">
        <section className="card stock-panel">
          <div className="stock-panel-head">
            <div><Boxes size={17} /> Niveaux de stock</div>
            <span>{filteredProducts.length} produit(s)</span>
          </div>
          <div className="table-wrap stock-table-scroll">
            <table>
              <thead><tr><th>Produit</th><th>Stock</th><th>Min</th><th>Valeur</th><th></th></tr></thead>
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
                        <span>{product.unit}</span>
                      </div>
                      {product.is_low_stock && <span className="badge badge-warning">Faible</span>}
                    </td>
                    <td className="text-muted text-sm">{fmt(product.min_stock, 2)} {product.unit}</td>
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
            <div><Clock3 size={17} /> Derniers mouvements</div>
            <span>{summary?.movements_today || 0} aujourd'hui</span>
          </div>
          <div className="table-wrap stock-table-scroll">
            <table>
              <thead><tr><th>Produit</th><th>Type</th><th>Qté</th><th>Avant</th><th>Après</th><th>Utilisateur</th><th>Date</th></tr></thead>
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
                      <td><span className={`stock-movement-badge ${color}`}>{MOVEMENT_LABELS[movement.movement_type] || movement.movement_type}</span></td>
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
    </div>
  )
}
