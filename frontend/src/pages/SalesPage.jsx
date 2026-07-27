// src/pages/SalesPage.jsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, fmt, fmtDate, fmtDateTime, operationHeaders, PAYMENT_METHODS, SETTLEMENT_METHODS, paymentModeLabel } from '../lib/api'
import { Plus, Search, Edit2, Trash2, Check, X, CreditCard, Eye, ShoppingCart, Printer, Download, FileCheck2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { TableLoadingRow } from '../components/ui/LoadingStates'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { getCompanyName, getLogoUrl } from '../lib/brand'
import { useI18n } from '../lib/i18n'
import ThermalReceipt from '../components/print/ThermalReceipt'
import './SalesPrint.css'

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
const EMPTY_SALE = { doc_type:'invoice', client_id:'', date_time:'', notes:'', discount:0, payment_mode:'cash', paid_amount:0, items:[] }
const EMPTY_ITEM = { product_id:'', description:'', quantity:1, unit_price:0, purchase_price:0, discount:0, tax_rate:20 }
const PAGE_SIZE = 80

function buildSalePayload(form) {
  return {
    ...form,
    client_id: form.client_id || null,
    date_time: form.date_time || null,
    due_date: form.due_date || null,
    discount: form.discount || 0,
    paid_amount: 0,
    items: (form.items || []).map(item => ({
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

export default function SalesPage() {
  const confirm = useConfirm()
  const { language } = useI18n()
  const [docType, setDocType]   = useState('invoice')
  const [sales, setSales]       = useState([])
  const [clients, setClients]   = useState([])
  const [products, setProducts] = useState([])
  const [q, setQ]               = useState('')
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [modal, setModal]       = useState(null) // null | 'form' | 'view' | 'pay'
  const [selected, setSelected] = useState(null)
  const [form, setForm]         = useState(EMPTY_SALE)
  const [saving, setSaving]     = useState(false)
  const [payAmt, setPayAmt]     = useState(0)
  const [payMode, setPayMode]   = useState('cash')
  const [settings, setSettings] = useState({})
  const [payments, setPayments] = useState([])
  const [timeline, setTimeline] = useState([])
  const [printTarget, setPrintTarget] = useState('')
  const [serverPreview, setServerPreview] = useState(null)
  const currency = serverPreview?.currency_code || settings.currency || 'MAD'
  const paymentModes = SETTLEMENT_METHODS
  const taxRates = String(settings.tax_rates || '0,7,10,14,20').split(',').map(Number).filter(Number.isFinite)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [salesRes, clientsRes, productsRes, settingsRes] = await Promise.allSettled([
        api.get('/sales', { params: { doc_type: docType, q: q || undefined, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE } }),
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
      const message = e.response?.data?.detail || 'Impossible de charger les ventes. Verifiez la connexion API.'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [docType, q, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [docType, q])
  useEffect(() => {
    const resetPrintTarget = () => setPrintTarget('')
    window.addEventListener('afterprint', resetPrintTarget)
    return () => window.removeEventListener('afterprint', resetPrintTarget)
  }, [])

  const openCreate = () => {
    setForm({ ...EMPTY_SALE, doc_type: docType, items: [{ ...EMPTY_ITEM }] })
    setServerPreview(null)
    setSelected(null); setModal('form')
  }
  const openEdit = (s) => {
    setForm({
      doc_type: s.doc_type, client_id: s.client_id||'', date_time: s.date_time?.slice(0,16)||'',
      notes: s.notes, discount: s.discount, payment_mode: s.payment_mode, paid_amount: s.paid_amount,
      items: s.items.map(i => ({ product_id: i.product_id||'', description: i.description, quantity: i.quantity, unit_price: i.unit_price, purchase_price: i.purchase_price, discount: i.discount, tax_rate: i.tax_rate }))
    })
    if (form.items.length === 0) form.items.push({ ...EMPTY_ITEM })
    setServerPreview(null); setSelected(s); setModal('form')
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
  const printDocument = () => {
    setPrintTarget('document')
    setTimeout(() => window.print(), 50)
  }
  const printTicket = () => {
    setPrintTarget('ticket')
    setTimeout(() => window.print(), 50)
  }

  const handleConfirm = async (s) => {
    try { await api.post(`/sales/${s.id}/confirm`, {}, { headers: operationHeaders(s.version) }); toast.success('Confirmé'); load() }
    catch(e) { toast.error(e.response?.data?.detail || 'Erreur') }
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
    catch(e) { toast.error(e.response?.data?.detail || 'Erreur') }
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
      const { data } = await api.post(`/sales/${s.id}/convert-to-invoice`)
      toast.success(`Facture creee: ${data.number}`)
      setDocType('invoice')
      load()
    } catch(e) { toast.error(e.response?.data?.detail || 'Conversion impossible') }
  }
  const handleDownload = async (s) => {
    try {
      const { data } = await api.get(`/sales/${s.id}`)
      downloadHtmlFile(`${data.number || 'document'}.html`, buildSalesDocumentHtml(data, settings))
      toast.success('Document telecharge')
    } catch(e) { toast.error(e.response?.data?.detail || 'Telechargement impossible') }
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
    catch(e) { toast.error(e.response?.data?.detail || 'Erreur') }
  }
  const handlePayment = async () => {
    if (!payAmt || +payAmt <= 0) return toast.error('Montant invalide')
    try {
      await api.post(`/sales/${selected.id}/payment`, { amount: +payAmt, payment_mode: payMode }, { headers: operationHeaders(selected.version) })
      toast.success('Paiement enregistré'); setModal(null); load()
    } catch(e) { toast.error(e.response?.data?.detail || 'Erreur') }
  }

  // Line item helpers
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }))
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }))
  const updateItem = (i, key, val) => setForm(f => {
    const items = [...f.items]
    items[i] = { ...items[i], [key]: val }
    if (key === 'product_id' && val) {
      const p = products.find(p => p.id === +val)
      if (p) { items[i].unit_price = p.sale_price; items[i].purchase_price = p.purchase_price; items[i].tax_rate = p.tax_rate; items[i].description = p.name }
    }
    return { ...f, items }
  })

  // Totals
  const computeTotals = (items, discount) => {
    let sub = 0, tax = 0
    items.forEach(item => {
      const lt = (item.quantity||1) * (item.unit_price||0) * (1-(item.discount||0)/100)
      sub += lt; tax += lt * (item.tax_rate ?? 0)/100
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
    if ((form.items||[]).length === 0) return toast.error('Ajoutez au moins une ligne')
    setSaving(true)
    try {
      const payload = buildSalePayload(form)
      const { data: exact } = await api.post('/sales/preview', payload)
      setServerPreview(exact)
      if (!selected) { await api.post('/sales', payload); toast.success('Document créé') }
      else { await api.put(`/sales/${selected.id}`, payload, { headers: operationHeaders(selected.version, { idempotent: false }) }); toast.success('Document mis à jour') }
      setModal(null); load()
    } catch(e) { toast.error(e.response?.data?.detail || 'Erreur') }
    finally { setSaving(false) }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Ventes</h1>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={exportList} disabled={loading || sales.length === 0}><Download size={16} /> Export CSV</button>
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
        <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)' }}>
          <div className="search-wrap" style={{ maxWidth:340 }}>
            <Search size={15} className="search-icon" />
            <input placeholder="Rechercher par numéro…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
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
                <tr key={s.id}>
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
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={() => handleDownload(s)} title="Telecharger"><Download size={14}/></button>
                      {s.status === 'draft' && <>
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(s)} title="Modifier"><Edit2 size={14}/></button>
                        {s.doc_type === 'quote' && <button className="btn btn-primary btn-sm btn-icon" onClick={() => handleConvertQuote(s)} title="Convertir en facture"><FileCheck2 size={14}/></button>}
                        <button className="btn btn-success btn-sm btn-icon" onClick={() => handleConfirm(s)} title="Confirmer"><Check size={14}/></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(s)} title="Supprimer"><Trash2 size={14}/></button>
                      </>}
                      {['confirmed', 'partially_paid'].includes(s.status) && <>
                        <button className="btn btn-primary btn-sm btn-icon" onClick={() => { setSelected(s); setPayAmt(s.balance_due); setModal('pay') }} title="Paiement"><CreditCard size={14}/></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleCancel(s)} title="Annuler"><X size={14}/></button>
                      </>}
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
                  <label className="form-label">Paiement</label>
                  <div className="text-muted text-sm">Disponible après confirmation du document.</div>
                </div>
                <div className="form-group" style={{ gridColumn:'1/-1' }}>
                  <label className="form-label">Notes</label>
                  <textarea value={form.notes||''} onChange={e => setForm(f=>({...f,notes:e.target.value}))} rows={2} placeholder="Notes internes…" />
                </div>
              </div>

              {/* Items */}
              <div style={{ marginBottom:'1rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'.75rem' }}>
                  <h3>Lignes</h3>
                  <button className="btn btn-secondary btn-sm" onClick={addItem}><Plus size={14}/> Ajouter ligne</button>
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ fontSize:'.8rem' }}>
                    <thead><tr>
                      <th style={{ minWidth:180 }}>Produit / Description</th>
                      <th style={{ width:70 }}>Qté</th>
                      <th style={{ width:110 }}>Prix unit. HT</th>
                      <th style={{ width:75 }}>Remise %</th>
                      <th style={{ width:80 }}>TVA %</th>
                      <th style={{ width:110 }}>Total HT</th>
                      <th style={{ width:40 }}></th>
                    </tr></thead>
                    <tbody>
                      {form.items.map((item, i) => {
                        const lt = (item.quantity||1)*(item.unit_price||0)*(1-(item.discount||0)/100)
                        return (
                          <tr key={i}>
                            <td>
                              <select value={item.product_id||''} onChange={e => updateItem(i,'product_id',e.target.value)} style={{ marginBottom:'.25rem' }}>
                                <option value="">— Produit —</option>
                                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              <input value={item.description||''} onChange={e => updateItem(i,'description',e.target.value)} placeholder="Description..." />
                            </td>
                            <td><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={e => updateItem(i,'quantity',+e.target.value||1)} /></td>
                            <td><input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateItem(i,'unit_price',+e.target.value||0)} /></td>
                            <td><input type="number" min="0" max="100" value={item.discount} onChange={e => updateItem(i,'discount',+e.target.value||0)} /></td>
                            <td>
                              <select value={item.tax_rate} onChange={e => updateItem(i,'tax_rate',+e.target.value)}>
                                {taxRates.map(r => <option key={r} value={r}>{r}%</option>)}
                              </select>
                            </td>
                            <td style={{ fontWeight:600 }}>{fmt(lt)} {currency}</td>
                            <td><button className="btn btn-danger btn-sm btn-icon" onClick={() => removeItem(i)}><X size={12}/></button></td>
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
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.875rem' }}>
                    <span className="text-muted">TVA:</span><span>{fmt(totals.tax_amount)} {currency}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:'1.1rem', borderTop:'1px solid var(--border)', paddingTop:'.4rem', marginTop:'.2rem' }}>
                    <span>Total:</span><span style={{ color:'var(--accent)' }}>{fmt(totals.total)} {currency}</span>
                  </div>
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
                  <thead><tr><th>Description</th><th>Qté</th><th>Prix HT</th><th>Remise</th><th>TVA</th><th>Total HT</th></tr></thead>
                  <tbody>
                    {selected.items.map(i => (
                      <tr key={i.id}>
                        <td>{i.product_name || i.description}</td>
                        <td>{i.quantity}</td>
                        <td>{fmt(i.unit_price)} MAD</td>
                        <td>{i.discount}%</td>
                        <td>{i.tax_rate}%</td>
                        <td className="font-semibold">{fmt(i.line_total)} MAD</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end' }}>
                <div style={{ minWidth:280, display:'flex', flexDirection:'column', gap:'.4rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.875rem' }}><span className="text-muted">Sous-total:</span><span>{fmt(selected.subtotal)} {selected.currency_code || currency}</span></div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.875rem' }}><span className="text-muted">TVA:</span><span>{fmt(selected.tax_amount)} {selected.currency_code || currency}</span></div>
                  {(selected.tax_breakdown || []).map(row => <div key={row.rate} style={{ display:'flex', justifyContent:'space-between', fontSize:'.8rem' }}><span className="text-muted">TVA {fmt(row.rate)}%</span><span>{fmt(row.tax_amount)} {selected.currency_code || currency}</span></div>)}
                  <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:'1.1rem', borderTop:'1px solid var(--border)', paddingTop:'.4rem' }}>
                    <span>Total TTC:</span><span style={{ color:'var(--accent)' }}>{fmt(selected.total_amount)} MAD</span>
                  </div>
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
              <button className="btn btn-secondary" onClick={printDocument}>
                <Printer size={15} /> PDF / Imprimer
              </button>
              {selected.doc_type === 'invoice' && (
                <button className="btn btn-secondary" onClick={printTicket}>
                  <Printer size={15} /> Ticket POS
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Fermer</button>
              {['confirmed', 'partially_paid'].includes(selected.status) && selected.balance_due > 0 && (
                <button className="btn btn-primary" onClick={() => { setPayAmt(selected.balance_due); setModal('pay') }}>
                  <CreditCard size={15} /> Encaisser
                </button>
              )}
            </div>
            {printTarget === 'document' && <PrintableSalesDocument sale={selected} settings={settings} />}
            {printTarget === 'ticket' && (
              <div className="thermal-print-active">
                <ThermalReceipt sale={selected} settings={settings} language={language} />
              </div>
            )}
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
              <button className="btn btn-success" onClick={handlePayment}><Check size={15}/> Confirmer paiement</button>
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
  const title = DOC_TITLES[sale.doc_type] || 'Document'
  const logoUrl = getLogoUrl(settings)
  const rows = (sale.items || []).map(item => `
    <tr>
      <td>${escapeHtml(item.product_name || item.description)}</td>
      <td>${fmt(item.quantity, 0)}</td>
      <td>${fmt(item.unit_price)} ${currency}</td>
      <td>${fmt(item.discount)}%</td>
      <td>${fmt(item.tax_rate)}%</td>
      <td>${fmt(item.line_total)} ${currency}</td>
    </tr>
  `).join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(sale.number)}</title>
<style>${documentPrintCss()}</style></head>
<body><main class="sheet">
  <header><div class="brand"><img src="${escapeHtml(logoUrl)}" alt=""><div><strong>${escapeHtml(getCompanyName(settings))}</strong><span>${escapeHtml(settings.address || '')}</span><span>${escapeHtml(settings.phone || '')}</span></div></div><div class="meta"><h1>${escapeHtml(title)}</h1><b>${escapeHtml(sale.number)}</b><span>Date: ${fmtDate(sale.date_time)}</span><span>Utilisateur: ${escapeHtml(sale.created_by_name || '-')}</span></div></header>
  <section class="parties"><div><h2>Client</h2><b>${escapeHtml(sale.client_name || 'Client comptoir')}</b></div><div><h2>Paiement</h2><span>Mode: ${escapeHtml(paymentModeLabel(sale.payment_mode))}</span><span>Paye: ${fmt(sale.paid_amount)} ${currency}</span><span>Reste: ${fmt(sale.balance_due)} ${currency}</span></div></section>
  <table><thead><tr><th>Designation</th><th>Qte</th><th>PU HT</th><th>Remise</th><th>TVA</th><th>Total HT</th></tr></thead><tbody>${rows}</tbody></table>
  <section class="bottom"><div><h2>Notes</h2><p>${escapeHtml(sale.notes || settings.invoice_notes || 'Merci pour votre confiance.')}</p></div><aside><p><span>Sous-total</span><b>${fmt(sale.subtotal)} ${currency}</b></p><p><span>TVA</span><b>${fmt(sale.tax_amount)} ${currency}</b></p><p class="total"><span>Total TTC</span><b>${fmt(sale.total_amount)} ${currency}</b></p></aside></section>
  <footer>${escapeHtml(getCompanyName(settings))} - Document genere par ${escapeHtml(sale.created_by_name || 'ProERP Web')}</footer>
</main></body></html>`
}

function documentPrintCss() {
  return `body{margin:0;background:#f1f5f9;color:#111827;font-family:Arial,Helvetica,sans-serif}.sheet{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:16mm}header,.parties,.bottom,aside p,footer{display:flex;justify-content:space-between;gap:16px}header{border-bottom:2px solid #111827;padding-bottom:14px;margin-bottom:18px}.brand{display:flex;gap:12px;align-items:flex-start}.brand img{width:42px;height:42px;object-fit:contain}.brand strong{display:block;font-size:24px}.brand span,.meta span{display:block;color:#4b5563;font-size:12px}.meta{text-align:right}.meta h1{margin:0;text-transform:uppercase;font-size:28px}.parties{margin-bottom:18px}.parties>div{width:48%;border:1px solid #d1d5db;padding:10px;min-height:82px}h2{font-size:12px;text-transform:uppercase;color:#6b7280;margin:0 0 6px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:18px}th{background:#111827;color:#fff;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #e5e7eb}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.bottom>div{width:52%;color:#4b5563}aside{width:270px}aside p{border-bottom:1px solid #e5e7eb;padding-bottom:6px}.total{background:#111827;color:#fff;padding:10px!important;border-bottom:0!important}footer{margin-top:28px;border-top:1px solid #e5e7eb;padding-top:8px;color:#6b7280;font-size:10px}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none}@page{size:A4;margin:0}}`
}

function PrintableSalesDocument({ sale, settings }) {
  const currency = settings.currency || 'MAD'
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
          </div>
          <div>
            <h2>Paiement</h2>
            <span>Mode: {paymentModeLabel(sale.payment_mode)}</span>
            <span>Payé: {fmt(sale.paid_amount)} {currency}</span>
            <span>Reste: {fmt(amountDue)} {currency}</span>
          </div>
        </section>

        <table className="print-table">
          <thead>
            <tr>
              <th>Désignation</th>
              <th>Qté</th>
              <th>PU HT</th>
              <th>Remise</th>
              <th>TVA</th>
              <th>Total HT</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map(item => (
              <tr key={item.id}>
                <td>{item.product_name || item.description}</td>
                <td>{fmt(item.quantity, 0)}</td>
                <td>{fmt(item.unit_price)} {currency}</td>
                <td>{fmt(item.discount)}%</td>
                <td>{fmt(item.tax_rate)}%</td>
                <td>{fmt(item.line_total)} {currency}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="print-bottom">
          <div className="print-notes">
            <h2>Notes</h2>
            <p>{sale.notes || 'Merci pour votre confiance.'}</p>
          </div>
          <div className="print-totals">
            <div><span>Sous-total HT</span><strong>{fmt(sale.subtotal)} {currency}</strong></div>
            <div><span>TVA</span><strong>{fmt(sale.tax_amount)} {currency}</strong></div>
            {Number(sale.discount || 0) > 0 && (
              <div><span>Remise globale</span><strong>{fmt(sale.discount)}%</strong></div>
            )}
            <div className="print-grand-total"><span>Total TTC</span><strong>{fmt(sale.total_amount)} {currency}</strong></div>
          </div>
        </section>

        <footer className="print-footer">
          <span>{settings.name || 'ProERP'} - Document généré par {sale.created_by_name || 'ProERP Web'}</span>
        </footer>
      </div>
    </div>
  )
}
