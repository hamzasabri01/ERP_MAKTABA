// src/pages/PurchasesPage.jsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, fmt, fmtDate, fmtDateTime, isVatEnabled, operationHeaders, SETTLEMENT_METHODS, paymentModeLabel } from '../lib/api'
import { Plus, Search, Eye, Edit2, Trash2, Check, CreditCard, Truck, Printer, Download, X, Boxes, AlertTriangle, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { TableLoadingRow } from '../components/ui/LoadingStates'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { getCompanyName, getLogoUrl } from '../lib/brand'
import { downloadPurchasePdf, previewPurchasePdf } from '../lib/documentPdf'
import './SalesPrint.css'
import './PurchasesPage.css'

const STATUS_LABELS = { draft:'Brouillon', confirmed:'Confirmé', partially_received:'Partiellement reçu', received:'Reçu', partially_paid:'Partiellement payé', paid:'Payé', cancelled:'Annulé' }
const EMPTY_PURCHASE = { doc_type:'order', supplier_id:'', date_time:'', notes:'', discount:0, items:[] }
const EMPTY_ITEM = { product_id:'', description:'', quantity:1, unit_price:0, purchase_unit:'pcs', conversion_factor:1, discount:0, tax_rate:20 }
const PAGE_SIZE = 80

function buildPurchasePayload(form) {
  return {
    ...form,
    supplier_id: form.supplier_id || null,
    date_time: form.date_time || null,
    expected_date: form.expected_date || null,
    discount: form.discount || 0,
    items: (form.items || []).map(item => ({
      ...item,
      product_id: item.product_id || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount: item.discount || 0,
      tax_rate: item.tax_rate ?? 0,
    })),
  }
}

export default function PurchasesPage() {
  const confirm = useConfirm()
  const [purchases, setPurchases] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts]   = useState([])
  const [q, setQ]                 = useState('')
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState('')
  const [modal, setModal]         = useState(null)
  const [selected, setSelected]   = useState(null)
  const [form, setForm]           = useState(EMPTY_PURCHASE)
  const [saving, setSaving]       = useState(false)
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)
  const [previewingPdf, setPreviewingPdf] = useState(false)
  const [payAmt, setPayAmt]       = useState(0)
  const [payMode, setPayMode]     = useState('cash')
  const [settings, setSettings]   = useState({})
  const [payments, setPayments]   = useState([])
  const [timeline, setTimeline]   = useState([])
  const [receiveQuantities, setReceiveQuantities] = useState({})
  const [serverPreview, setServerPreview] = useState(null)
  const currency = serverPreview?.currency_code || settings.currency || 'MAD'
  const paymentModes = SETTLEMENT_METHODS
  const vatEnabled = isVatEnabled(settings)
  const taxRates = String(settings.tax_rates || '0,7,10,14,20').split(',').map(Number).filter(Number.isFinite)
  const productMap = useMemo(() => new Map(products.map(product => [Number(product.id), product])), [products])
  const purchaseStats = useMemo(() => purchases.reduce((stats, purchase) => {
    const total = Number(purchase.total_amount || 0)
    const paid = Number(purchase.paid_amount || 0)
    stats.total += total
    stats.remaining += Math.max(0, total - paid)
    if (['confirmed', 'partially_received'].includes(purchase.status)) stats.awaiting += 1
    return stats
  }, { total: 0, remaining: 0, awaiting: 0 }), [purchases])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [purchasesRes, suppliersRes, productsRes, settingsRes] = await Promise.allSettled([
        api.get('/purchases', { params: { q: q || undefined, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE } }),
        api.get('/suppliers'),
        api.get('/products', { params: { limit: 500 } }),
        api.get('/settings'),
      ])

      if (purchasesRes.status === 'rejected') {
        throw purchasesRes.reason
      }

      setPurchases(Array.isArray(purchasesRes.value.data) ? purchasesRes.value.data : [])
      if (suppliersRes.status === 'fulfilled') setSuppliers(Array.isArray(suppliersRes.value.data) ? suppliersRes.value.data : [])
      if (productsRes.status === 'fulfilled') setProducts(Array.isArray(productsRes.value.data) ? productsRes.value.data : [])
      if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value.data || {})

      ;[suppliersRes, productsRes, settingsRes].forEach(res => {
        if (res.status === 'rejected') console.warn('Optional purchase data failed to load', res.reason)
      })
    } catch (e) {
      const message = e.response?.data?.detail || 'Impossible de charger les achats. Verifiez la connexion API.'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [q, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q])

  const openCreate = () => { setForm({ ...EMPTY_PURCHASE, items:[{...EMPTY_ITEM}] }); setServerPreview(null); setSelected(null); setModal('form') }
  const openEdit = async (summary) => {
    try {
      const { data: purchase } = await api.get(`/purchases/${summary.id}`)
      const items = (purchase.items || []).map(item => ({
        product_id:item.product_id || '',
        description:item.product_name || item.description || '',
        quantity:Math.max(1, Math.trunc(Number(item.quantity) || 1)),
        unit_price:item.unit_price,
        purchase_unit:item.purchase_unit || 'pcs',
        conversion_factor:item.conversion_factor || 1,
        discount:item.discount || 0,
        tax_rate:item.tax_rate || 0,
      }))
      setForm({
        doc_type:purchase.doc_type,
        supplier_id:purchase.supplier_id || '',
        date_time:purchase.date_time?.slice(0, 16) || '',
        expected_date:purchase.expected_date?.slice(0, 10) || '',
        notes:purchase.notes || '',
        discount:purchase.discount || 0,
        items:items.length ? items : [{ ...EMPTY_ITEM }],
      })
      setServerPreview(null)
      setSelected(purchase)
      setModal('form')
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Impossible de charger la commande')
    }
  }
  const openView   = async (p) => {
    const [purchaseRes, paymentRes, auditRes] = await Promise.allSettled([
      api.get(`/purchases/${p.id}`),
      api.get('/payments', { params: { document_type: 'purchase', document_id: p.id } }),
      api.get('/audit', { params: { entity: 'purchase', entity_id: p.id, limit: 20 } }),
    ])
    if (purchaseRes.status === 'rejected') throw purchaseRes.reason
    setSelected(purchaseRes.value.data)
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
      await previewPurchasePdf(selected, settings, previewWindow)
    } catch (error) {
      previewWindow?.close()
      toast.error('Impossible de préparer le PDF')
    } finally {
      setPreviewingPdf(false)
    }
  }

  const openReceive = async (p) => {
    try {
      const { data } = await api.get(`/purchases/${p.id}`)
      setSelected(data)
      setReceiveQuantities(Object.fromEntries(data.items.map(item => [item.id, Math.max(0, Math.trunc(Number(item.remaining_quantity) || 0))])))
      setModal('receive')
    } catch(e) { toast.error(e.response?.data?.detail||'Erreur') }
  }
  const handleReceive = async () => {
    const items = selected.items
      .map(item => ({ item_id:item.id, quantity:Number(receiveQuantities[item.id] || 0) }))
      .filter(item => item.quantity > 0)
    if (!items.length) return toast.error('Saisissez au moins une quantité reçue')
    const invalidItem = items.find(item => !Number.isInteger(item.quantity) || item.quantity <= 0)
    if (invalidItem) return toast.error('Les quantités reçues doivent être des nombres entiers positifs')
    const exceedsRemaining = items.find(received => {
      const line = selected.items.find(item => item.id === received.item_id)
      return received.quantity > Number(line?.remaining_quantity || 0)
    })
    if (exceedsRemaining) return toast.error('Une quantité reçue dépasse la quantité restante')
    setReceiving(true)
    try { await api.post(`/purchases/${selected.id}/receive`, { items }, { headers: operationHeaders(selected.version) }); toast.success('Réception enregistrée, stock mis à jour'); setModal(null); load() }
    catch(e) { toast.error(e.response?.data?.detail||'Erreur') }
    finally { setReceiving(false) }
  }
  const handleConfirm = async (p) => {
    try { await api.post(`/purchases/${p.id}/confirm`, {}, { headers: operationHeaders(p.version) }); toast.success('Commande confirmée'); load() }
    catch(e) { toast.error(e.response?.data?.detail||'Erreur') }
  }
  const handleCancel = async (p) => {
    const ok = await confirm({ title:'Annuler la commande', message:`Annuler ${p.number} ?`, confirmText:'Annuler', tone:'danger' })
    if (!ok) return
    try { await api.post(`/purchases/${p.id}/cancel`, {}, { headers: operationHeaders(p.version) }); toast.success('Commande annulée'); load() }
    catch(e) { toast.error(e.response?.data?.detail||'Erreur') }
  }
  const handleDownload = async (p) => {
    if (downloadingId === p.id) return
    setDownloadingId(p.id)
    try {
      const { data } = await api.get(`/purchases/${p.id}`)
      await downloadPurchasePdf(data, settings)
      toast.success('PDF téléchargé')
    } catch(e) { toast.error(e.response?.data?.detail || 'Téléchargement PDF impossible') }
    finally { setDownloadingId(null) }
  }
  const exportList = () => {
    const rows = purchases.map(p => ({
      numero: p.number,
      fournisseur: p.supplier_name,
      date: fmtDateTime(p.date_time),
      utilisateur: p.created_by_name || '',
      total: p.total_amount,
      paye: p.paid_amount,
      statut: STATUS_LABELS[p.status] || p.status,
      paiement: p.payment_status,
    }))
    downloadCsv('achats.csv', rows)
  }
  const handleDelete = async (p) => {
    const ok = await confirm({
      title: 'Supprimer achat',
      message: `Supprimer ${p.number || 'cet achat'} ? Cette action est definitive.`,
      confirmText: 'Supprimer',
      tone: 'danger',
    })
    if (!ok) return
    try { await api.delete(`/purchases/${p.id}`, { headers: operationHeaders(p.version, { idempotent:false }) }); toast.success('Supprimé'); load() }
    catch(e) { toast.error(e.response?.data?.detail||'Erreur') }
  }
  const handlePayment = async () => {
    if (!payAmt || +payAmt<=0) return toast.error('Montant invalide')
    const remaining = Number(selected.total_amount || 0) - Number(selected.paid_amount || 0)
    if (+payAmt > remaining + 0.001) return toast.error(`Le paiement ne peut pas dépasser le reste de ${fmt(remaining)} ${currency}`)
    setPaymentSaving(true)
    try { await api.post(`/purchases/${selected.id}/payment`,{amount:+payAmt,payment_mode:payMode},{ headers:operationHeaders(selected.version) }); toast.success('Paiement enregistré'); setModal(null); load() }
    catch(e) { toast.error(e.response?.data?.detail||'Erreur') }
    finally { setPaymentSaving(false) }
  }

  const addItem = () => setForm(f=>({...f,items:[...f.items,{...EMPTY_ITEM}]}))
  const removeItem = (i) => setForm(f=>({...f,items:f.items.filter((_,idx)=>idx!==i)}))
  const updateItem = (i,key,val) => setForm(f=>{
    const items=[...f.items]; items[i]={...items[i],[key]:val}
    if(key==='product_id'&&!val){
      items[i] = { ...items[i], product_id:'', description:'', unit_price:0, purchase_unit:'pcs', conversion_factor:1, tax_rate:0 }
    }
    if(key==='product_id'&&val){
      const p=products.find(p=>p.id===+val)
      if(p){
        const factor=Number(p.purchase_to_base_factor||1)
        items[i].unit_price=Number(p.purchase_price||0)*factor
        items[i].description=p.name
        items[i].tax_rate=vatEnabled ? p.tax_rate : 0
        items[i].purchase_unit=p.purchase_unit||p.unit||'pcs'
        items[i].conversion_factor=factor
      }
    }
    return {...f,items}
  })

  const totals = (form.items||[]).reduce((acc,i)=>{
    const line=(i.quantity||1)*(i.unit_price||0)*(1-(i.discount||0)/100)
    const lt=line*(1-(form.discount||0)/100); const tax=vatEnabled ? lt*(i.tax_rate ?? 0)/100 : 0
    return {sub:acc.sub+lt, tax:acc.tax+tax, total:acc.total+lt+tax}
  },{sub:0,tax:0,total:0})
  const exactTotals = serverPreview
    ? { sub: serverPreview.subtotal, tax: serverPreview.tax_amount, total: serverPreview.total_amount }
    : totals
  const previewPayload = useMemo(() => buildPurchasePayload(form), [form])

  useEffect(() => {
    if (modal !== 'form' || !previewPayload.items.length) {
      setServerPreview(null)
      return undefined
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api.post('/purchases/preview', previewPayload, { signal: controller.signal })
        .then(({ data }) => setServerPreview(data))
        .catch(error => { if (error.code !== 'ERR_CANCELED') setServerPreview(null) })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [modal, previewPayload])

  const handleSave = async () => {
    if(!(form.items||[]).length) return toast.error('Ajoutez au moins une ligne')
    if (!form.supplier_id) return toast.error('Sélectionnez un fournisseur')
    const invalidLine = form.items.findIndex(item =>
      !item.product_id
      || !Number.isInteger(Number(item.quantity))
      || Number(item.quantity) <= 0
      || !Number.isFinite(Number(item.conversion_factor))
      || Number(item.conversion_factor) <= 0
      || !Number.isFinite(Number(item.unit_price))
      || Number(item.unit_price) <= 0
      || Number(item.discount) < 0
      || Number(item.discount) > 100
    )
    if (invalidLine >= 0) return toast.error(`Vérifiez le produit, la quantité, la conversion, le prix et la remise de la ligne ${invalidLine + 1}`)
    setSaving(true)
    try {
      const payload = buildPurchasePayload(form)
      const { data: exact } = await api.post('/purchases/preview', payload)
      setServerPreview(exact)
      if (selected) {
        await api.put(`/purchases/${selected.id}`, payload, { headers:operationHeaders(selected.version, { idempotent:false }) })
        toast.success('Commande mise à jour')
      } else {
        await api.post('/purchases',payload)
        toast.success('Commande créée')
      }
      setModal(null); load()
    } catch(e){toast.error(e.response?.data?.detail||'Erreur')}
    finally{setSaving(false)}
  }

  return (
    <div className="page-content purchases-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Achats</h1>
          <p className="purchases-subtitle">Commandes, conversions d’unités et réceptions fournisseur</p>
        </div>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={exportList} disabled={loading || purchases.length === 0}><Download size={16}/> Export CSV</button>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={16}/> Nouvelle commande</button>
        </div>
      </div>
      <div className="purchase-kpis">
        <div className="purchase-kpi"><span className="purchase-kpi-icon blue"><Boxes size={19}/></span><div><small>Commandes affichées</small><strong>{purchases.length}</strong></div></div>
        <div className="purchase-kpi"><span className="purchase-kpi-icon green"><TrendingUp size={19}/></span><div><small>Montant commandé</small><strong>{fmt(purchaseStats.total)} MAD</strong></div></div>
        <div className="purchase-kpi"><span className="purchase-kpi-icon orange"><Truck size={19}/></span><div><small>Réceptions en attente</small><strong>{purchaseStats.awaiting}</strong></div></div>
        <div className="purchase-kpi"><span className="purchase-kpi-icon red"><CreditCard size={19}/></span><div><small>Reste à payer</small><strong>{fmt(purchaseStats.remaining)} MAD</strong></div></div>
      </div>
      <div className="card" style={{padding:0}}>
        <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)' }}>
          <div className="search-wrap" style={{ maxWidth:340 }}>
            <Search size={15} className="search-icon" />
            <input placeholder="Rechercher par numero..." value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Numéro</th><th>Fournisseur</th><th>Date</th><th>Utilisateur</th><th>Total</th><th>Payé</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? <TableLoadingRow colSpan={8} label="Chargement des achats..." />
              : loadError ? <tr><td colSpan={8}><LoadError message={loadError} onRetry={load} /></td></tr>
              : purchases.length===0 ? <tr><td colSpan={8}><div className="empty-state"><Truck size={40}/><p>Aucune commande</p></div></td></tr>
              : purchases.map(p=>(
                <tr key={p.id} className={`document-row status-${p.status}`}>
                  <td><span className="font-mono text-sm">{p.number}</span></td>
                  <td>{p.supplier_name}</td>
                  <td className="text-muted text-sm">{fmtDate(p.date_time)}</td>
                  <td className="text-muted text-sm">{p.created_by_name || '—'}</td>
                  <td className="font-semibold">{fmt(p.total_amount)} MAD</td>
                  <td style={{color:'var(--success)'}}>{fmt(p.paid_amount)} MAD</td>
                  <td><span className={`badge badge-${p.status}`}>{STATUS_LABELS[p.status]||p.status}</span></td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={()=>openView(p)} title="Voir"><Eye size={14}/></button>
                      <button className="btn btn-secondary btn-sm btn-icon" disabled={downloadingId === p.id} onClick={()=>handleDownload(p)} title="Télécharger PDF">
                        {downloadingId === p.id ? <span className="spinner" style={{width:14,height:14}}/> : <Download size={14}/>}
                      </button>
                      {p.status==='draft'&&<>
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={()=>openEdit(p)} title="Modifier"><Edit2 size={14}/></button>
                        <button className="btn btn-success btn-sm btn-icon" onClick={()=>handleConfirm(p)} title="Confirmer"><Check size={14}/></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={()=>handleDelete(p)} title="Supprimer"><Trash2 size={14}/></button>
                      </>}
                      {p.status==='confirmed'&&<>
                        <button className="btn btn-success btn-sm btn-icon" onClick={()=>openReceive(p)} title="Enregistrer une réception"><Truck size={14}/></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={()=>handleCancel(p)} title="Annuler"><X size={14}/></button>
                      </>}
                      {p.status==='partially_received'&&
                        <button className="btn btn-success btn-sm btn-icon" onClick={()=>openReceive(p)} title="Recevoir le restant"><Truck size={14}/></button>
                      }
                      {['received','partially_paid'].includes(p.status)&&p.payment_status!=='paid'&&
                        <button className="btn btn-primary btn-sm btn-icon" onClick={()=>{setSelected(p);setPayAmt(p.total_amount-p.paid_amount);setModal('pay')}} title="Payer"><CreditCard size={14}/></button>
                      }
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-pagination">
          <span>Page {page} - {purchases.length} achats charges</span>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page === 1}>Precedent</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => p + 1)} disabled={loading || purchases.length < PAGE_SIZE}>Suivant</button>
          </div>
        </div>
      </div>

      {modal==='form'&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal modal-xl purchase-form-modal">
            <div className="modal-header"><div><span className="purchase-eyebrow">Approvisionnement</span><h2>{selected ? "Modifier la commande d'achat" : "Nouvelle commande d'achat"}</h2></div><button className="btn btn-secondary btn-sm btn-icon" onClick={()=>setModal(null)}>✕</button></div>
            <div className="modal-body">
              <div className="form-grid form-grid-3" style={{gap:'1rem',marginBottom:'1.5rem'}}>
                <div className="form-group">
                  <label className="form-label">Fournisseur</label>
                  <select value={form.supplier_id||''} onChange={e=>setForm(f=>({...f,supplier_id:e.target.value||null}))}>
                    <option value="">— Sélectionner —</option>
                    {suppliers.map(s=><option key={s.id} value={s.id}>{s.company_name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="datetime-local" value={form.date_time||''} onChange={e=>setForm(f=>({...f,date_time:e.target.value}))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Date livraison prévue</label>
                  <input type="date" value={form.expected_date||''} onChange={e=>setForm(f=>({...f,expected_date:e.target.value}))} />
                </div>
                <div className="form-group" style={{gridColumn:'1/-1'}}>
                  <label className="form-label">Notes</label>
                  <textarea value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} />
                </div>
                <div className="form-group">
                  <label className="form-label">Remise globale %</label>
                  <input type="number" min="0" max="100" step="0.01" value={form.discount || 0} onChange={e=>setForm(f=>({...f,discount:e.target.value}))} />
                </div>
              </div>
              <div className="purchase-lines-section">
                <div className="purchase-lines-heading">
                  <h3>Articles</h3>
                  <button className="btn btn-secondary btn-sm" onClick={addItem}><Plus size={14}/> Ajouter une ligne</button>
                </div>
                <div className="purchase-lines-table-wrap">
                  <table className="purchase-lines-table">
                    <thead><tr><th>Produit</th><th>Qté achat</th><th>Unité</th><th>Conversion</th><th>Prix/unité achat</th><th>Remise %</th>{vatEnabled ? <th>TVA %</th> : null}<th>Total</th><th aria-label="Actions"></th></tr></thead>
                    <tbody>
                      {form.items.map((item,i)=>{
                        const lt=(item.quantity||1)*(item.unit_price||0)
                        const product = productMap.get(Number(item.product_id))
                        const factor = Number(item.conversion_factor || 1)
                        const baseCost = factor > 0 ? Number(item.unit_price || 0) / factor : 0
                        const previousCost = Number(product?.purchase_price || 0)
                        const costDelta = previousCost > 0 ? ((baseCost - previousCost) / previousCost) * 100 : 0
                        return(
                          <tr key={i} className={Math.abs(costDelta) >= 5 ? 'purchase-cost-changed' : ''}>
                            <td className="purchase-line-product">
                              <select value={item.product_id||''} onChange={e=>updateItem(i,'product_id',e.target.value)}>
                                <option value="">— Produit —</option>
                                {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            </td>
                            <td className="purchase-line-quantity"><input
                              aria-label="Quantité achetée"
                              type="number"
                              inputMode="numeric"
                              min="1"
                              step="1"
                              value={item.quantity}
                              onKeyDown={e => {
                                if (['.', ',', 'e', 'E', '+', '-'].includes(e.key)) e.preventDefault()
                              }}
                              onChange={e=>updateItem(i,'quantity',Math.max(1, Math.trunc(Number(e.target.value)||1)))}
                            /></td>
                            <td><input value={item.purchase_unit||''} onChange={e=>updateItem(i,'purchase_unit',e.target.value)} /></td>
                            <td>
                              <input type="number" min="0.0001" step="0.0001" value={item.conversion_factor||1} onChange={e=>updateItem(i,'conversion_factor',+e.target.value||1)} />
                              <small className="purchase-conversion">{fmt(item.quantity || 0, 2)} {item.purchase_unit || 'unité'} → <strong>{fmt((item.quantity||0)*factor,2)} {product?.unit || 'unité(s) stock'}</strong></small>
                            </td>
                            <td>
                              <input type="number" min="0" step="0.01" value={item.unit_price} onChange={e=>updateItem(i,'unit_price',+e.target.value||0)} />
                              <small className="purchase-base-cost">{fmt(baseCost)} {currency}/{product?.unit || 'unité'}</small>
                              {product && Math.abs(costDelta) >= 5 ? <small className={`purchase-cost-alert ${costDelta > 0 ? 'up' : 'down'}`}><AlertTriangle size={11}/>{costDelta > 0 ? '+' : ''}{fmt(costDelta, 1)}% vs ancien coût</small> : null}
                            </td>
                            <td><input type="number" min="0" max="100" step="0.01" value={item.discount || 0} onChange={e=>updateItem(i,'discount',e.target.value)} /></td>
                            {vatEnabled ? <td><select value={item.tax_rate} onChange={e=>updateItem(i,'tax_rate',+e.target.value)}>{taxRates.map(r=><option key={r} value={r}>{r}%</option>)}</select></td> : null}
                            <td className="purchase-line-total">{fmt(lt)} {currency}</td>
                            <td className="purchase-line-remove"><button aria-label="Supprimer la ligne" title="Supprimer la ligne" className="btn btn-danger btn-sm btn-icon" onClick={()=>removeItem(i)}><X size={14}/></button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{textAlign:'right',marginTop:'1rem',padding:'1rem',background:'var(--bg3)',borderRadius:'var(--radius-sm)',display:'flex',flexDirection:'column',gap:'.3rem',alignItems:'flex-end'}}>
                  <div className="text-sm text-muted">Sous-total: <strong>{fmt(exactTotals.sub)} {currency}</strong></div>
                  {vatEnabled ? <div className="text-sm text-muted">TVA: <strong>{fmt(exactTotals.tax)} {currency}</strong></div> : null}
                  <div style={{fontSize:'1.1rem',fontWeight:700}}>Total: <span style={{color:'var(--accent)'}}>{fmt(exactTotals.total)} {currency}</span></div>
                  <small className="text-muted">{serverPreview ? 'Total exact calculé par le serveur' : 'Vérification du total en cours…'}</small>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?<span className="spinner" style={{width:16,height:16}}/>:null} {selected ? 'Enregistrer' : 'Créer commande'}</button>
            </div>
          </div>
        </div>
      )}

      {modal==='view'&&selected&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal modal-lg">
            <div className="modal-header"><h2>{selected.number}</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={()=>setModal(null)}>✕</button></div>
            <div className="modal-body">
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1rem'}}>
                <div><div className="text-muted text-sm">Fournisseur</div><div className="font-semibold">{selected.supplier_name}</div></div>
                <div><div className="text-muted text-sm">Date</div><div>{fmtDate(selected.date_time)}</div></div>
                <div><div className="text-muted text-sm">Utilisateur</div><div>{selected.created_by_name || '—'}</div></div>
                <div><div className="text-muted text-sm">Statut</div><span className={`badge badge-${selected.status}`}>{STATUS_LABELS[selected.status]||selected.status}</span></div>
                <div><div className="text-muted text-sm">Paiement</div><span className="badge badge-info">{selected.payment_status}</span></div>
              </div>
              <div className="table-wrap">
                <table style={{fontSize:'.875rem'}}>
                  <thead><tr><th>Produit</th><th>Qté</th><th>Reçu</th><th>Prix</th>{vatEnabled ? <th>TVA</th> : null}<th>Total</th></tr></thead>
                  <tbody>
                    {selected.items.map(i=><tr key={i.id}><td>{i.product_name||i.description}</td><td>{i.quantity}</td><td>{i.received_quantity}</td><td>{fmt(i.unit_price)} {selected.currency_code || currency}</td>{vatEnabled ? <td>{i.tax_rate}%</td> : null}<td className="font-semibold">{fmt(i.line_total)} {selected.currency_code || currency}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div style={{textAlign:'right',marginTop:'1rem'}}>
                {vatEnabled ? (selected.tax_breakdown || []).map(row => <div key={row.rate} className="text-sm text-muted">TVA {fmt(row.rate)}%: {fmt(row.tax_amount)} {selected.currency_code || currency}</div>) : null}
                <div style={{fontWeight:700,fontSize:'1.1rem'}}>Total: <span style={{color:'var(--accent)'}}>{fmt(selected.total_amount)} {selected.currency_code || currency}</span></div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:'1rem', marginTop:'1rem' }}>
                <div className="card" style={{ padding:'1rem' }}>
                  <h3 style={{ fontSize:'.95rem', marginBottom:'.75rem' }}>Paiements</h3>
                  {payments.length === 0 ? <p className="text-muted text-sm">Aucun paiement enregistre.</p> : payments.map(p => (
                    <div key={p.id} style={{ display:'flex', justifyContent:'space-between', gap:'.75rem', padding:'.45rem 0', borderTop:'1px solid var(--border)' }}>
                      <span><strong>{paymentModeLabel(p.payment_mode)}</strong><br/><small className="text-muted">{p.payment_reference || p.reference}<br/>{fmtDateTime(p.created_at)}</small></span>
                      <strong style={{ color:'var(--danger)' }}>{fmt(p.amount)} MAD</strong>
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
              <button className="btn btn-secondary" onClick={()=>setModal(null)}>Fermer</button>
            </div>
            <PrintablePurchaseDocument purchase={selected} settings={settings} />
          </div>
        </div>
      )}

      {modal==='pay'&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal" style={{maxWidth:380}}>
            <div className="modal-header"><h2>Paiement fournisseur</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={()=>setModal(null)}>✕</button></div>
            <div className="modal-body">
              <div className="form-group"><label className="form-label">Montant (MAD)</label><input type="number" min="0.01" max={selected.total_amount-selected.paid_amount} step="0.01" value={payAmt} onChange={e=>setPayAmt(+e.target.value)} /></div>
              <div className="form-group"><label className="form-label">Mode paiement</label><select value={payMode} onChange={e=>setPayMode(e.target.value)}>{paymentModes.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setModal(null)}>Annuler</button>
              <button className="btn btn-success" onClick={handlePayment} disabled={paymentSaving}>
                {paymentSaving ? <span className="spinner" style={{width:15,height:15}}/> : <Check size={15}/>}
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {modal==='receive'&&selected&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal modal-lg purchase-receive-modal">
            <div className="modal-header"><div><span className="purchase-eyebrow">Entrée en stock</span><h2>Réception {selected.number}</h2></div><button className="btn btn-secondary btn-sm btn-icon" onClick={()=>setModal(null)}>✕</button></div>
            <div className="modal-body">
              <p className="text-muted text-sm" style={{marginBottom:'1rem'}}>Indiquez uniquement les quantités reçues maintenant. Le stock ne sera augmenté que de ces quantités.</p>
              <div className="table-wrap">
                <table><thead><tr><th>Produit</th><th>Commandé</th><th>Déjà reçu</th><th>Réception actuelle</th><th>Entrée stock</th></tr></thead><tbody>
                  {selected.items.filter(item=>item.remaining_quantity>0).map(item=><tr key={item.id}>
                    <td><strong>{item.product_name||item.description}</strong><small className="purchase-unit-hint">1 {item.purchase_unit || 'unité'} = {fmt(item.conversion_factor || 1, 2)} unité(s) stock</small></td><td>{fmt(item.quantity, 0)} {item.purchase_unit}</td><td>{fmt(item.received_quantity, 0)} {item.purchase_unit}</td>
                    <td><input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max={item.remaining_quantity}
                      step="1"
                      value={receiveQuantities[item.id]??''}
                      onKeyDown={e => {
                        if (['.', ',', 'e', 'E', '+', '-'].includes(e.key)) e.preventDefault()
                      }}
                      onChange={e=>setReceiveQuantities(current=>({...current,[item.id]:Math.max(0, Math.trunc(Number(e.target.value)||0))}))}
                      aria-label={`Quantité reçue pour ${item.product_name||item.description}`}
                    /></td>
                    <td><span className="purchase-stock-in">+{fmt(Number(receiveQuantities[item.id] || 0) * Number(item.conversion_factor || 1), 2)}</span></td>
                  </tr>)}
                </tbody></table>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setModal(null)}>Annuler</button><button className="btn btn-success" onClick={handleReceive} disabled={receiving}>{receiving ? <span className="spinner" style={{width:15,height:15}}/> : <Truck size={15}/>} Enregistrer la réception</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function LoadError({ message, onRetry }) {
  return (
    <div className="empty-state">
      <Truck size={40} />
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

function documentPrintCss() {
  return `body{margin:0;background:#f1f5f9;color:#111827;font-family:Arial,Helvetica,sans-serif}.sheet{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:16mm}header,.parties,.bottom,aside p,footer{display:flex;justify-content:space-between;gap:16px}header{border-bottom:2px solid #111827;padding-bottom:14px;margin-bottom:18px}.brand{display:flex;gap:12px;align-items:flex-start}.brand img{width:42px;height:42px;object-fit:contain}.brand strong{display:block;font-size:24px}.brand span,.meta span{display:block;color:#4b5563;font-size:12px}.meta{text-align:right}.meta h1{margin:0;text-transform:uppercase;font-size:28px}.parties{margin-bottom:18px}.parties>div{width:48%;border:1px solid #d1d5db;padding:10px;min-height:82px}h2{font-size:12px;text-transform:uppercase;color:#6b7280;margin:0 0 6px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:18px}th{background:#111827;color:#fff;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #e5e7eb}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.bottom>div{width:52%;color:#4b5563}aside{width:270px}aside p{border-bottom:1px solid #e5e7eb;padding-bottom:6px}.total{background:#111827;color:#fff;padding:10px!important;border-bottom:0!important}footer{margin-top:28px;border-top:1px solid #e5e7eb;padding-top:8px;color:#6b7280;font-size:10px}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none}@page{size:A4;margin:0}}`
}

function buildPurchaseDocumentHtml(purchase, settings) {
  const currency = settings.currency || 'MAD'
  const vatEnabled = isVatEnabled(settings)
  const amountDue = Math.max(Number(purchase.total_amount || 0) - Number(purchase.paid_amount || 0), 0)
  const logoUrl = getLogoUrl(settings)
  const rows = (purchase.items || []).map(item => `
    <tr><td>${escapeHtml(item.product_name || item.description)}</td><td>${fmt(item.quantity, 0)}</td><td>${fmt(item.unit_price)} ${currency}</td>${vatEnabled ? `<td>${fmt(item.tax_rate)}%</td>` : ''}<td>${fmt(item.line_total)} ${currency}</td></tr>
  `).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(purchase.number)}</title><style>${documentPrintCss()}</style></head><body><main class="sheet"><header><div class="brand"><img src="${escapeHtml(logoUrl)}" alt=""><div><strong>${escapeHtml(getCompanyName(settings))}</strong><span>${escapeHtml(settings.address || '')}</span><span>${escapeHtml(settings.phone || '')}</span></div></div><div class="meta"><h1>Bon de commande</h1><b>${escapeHtml(purchase.number)}</b><span>Date: ${fmtDate(purchase.date_time)}</span><span>Utilisateur: ${escapeHtml(purchase.created_by_name || '-')}</span></div></header><section class="parties"><div><h2>Fournisseur</h2><b>${escapeHtml(purchase.supplier_name || 'Fournisseur')}</b></div><div><h2>Paiement</h2><span>Statut: ${escapeHtml(purchase.payment_status || '-')}</span><span>Paye: ${fmt(purchase.paid_amount)} ${currency}</span><span>Reste: ${fmt(amountDue)} ${currency}</span></div></section><table><thead><tr><th>Designation</th><th>Qte</th><th>PU</th>${vatEnabled ? '<th>TVA</th>' : ''}<th>Total</th></tr></thead><tbody>${rows}</tbody></table><section class="bottom"><div><h2>Notes</h2><p>${escapeHtml(purchase.notes || settings.purchase_terms || 'Bon de commande fournisseur.')}</p></div><aside><p><span>Sous-total</span><b>${fmt(purchase.subtotal)} ${currency}</b></p>${vatEnabled ? `<p><span>TVA</span><b>${fmt(purchase.tax_amount)} ${currency}</b></p>` : ''}<p class="total"><span>Total</span><b>${fmt(purchase.total_amount)} ${currency}</b></p></aside></section><footer>${escapeHtml(getCompanyName(settings))} - Document genere par ${escapeHtml(purchase.created_by_name || 'LIBRARY SABRI')}</footer></main></body></html>`
}

function PrintablePurchaseDocument({ purchase, settings }) {
  const currency = settings.currency || 'MAD'
  const vatEnabled = isVatEnabled(settings)
  const supplierLabel = purchase.supplier_name && purchase.supplier_name !== 'â€”' ? purchase.supplier_name : 'Fournisseur'
  const amountDue = Math.max(Number(purchase.total_amount || 0) - Number(purchase.paid_amount || 0), 0)
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
              {settings.phone && <span>Tel: {settings.phone}</span>}
              {settings.email && <span>Email: {settings.email}</span>}
              {settings.ice && <span>ICE: {settings.ice}</span>}
              {settings.if_number && <span>IF: {settings.if_number}</span>}
              {settings.rc && <span>RC: {settings.rc}</span>}
            </div>
            </div>
          </div>
          <div className="print-doc-meta">
            <h1>Bon de commande</h1>
            <strong>{purchase.number}</strong>
            <span>Date: {fmtDate(purchase.date_time)}</span>
            {purchase.expected_date && <span>Livraison prevue: {fmtDate(purchase.expected_date)}</span>}
            <span>Utilisateur: {purchase.created_by_name || '-'}</span>
            <span>Statut: {STATUS_LABELS[purchase.status] || purchase.status}</span>
          </div>
        </header>

        <section className="print-parties">
          <div>
            <h2>Fournisseur</h2>
            <strong>{supplierLabel}</strong>
          </div>
          <div>
            <h2>Paiement</h2>
            <span>Statut: {purchase.payment_status || '-'}</span>
            <span>Paye: {fmt(purchase.paid_amount)} {currency}</span>
            <span>Reste: {fmt(amountDue)} {currency}</span>
          </div>
        </section>

        <table className="print-table">
          <thead>
            <tr>
              <th>Designation</th>
              <th>Qte</th>
              <th>PU</th>
              {vatEnabled ? <th>TVA</th> : null}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {purchase.items.map(item => (
              <tr key={item.id}>
                <td>{item.product_name || item.description}</td>
                <td>{fmt(item.quantity, 0)}</td>
                <td>{fmt(item.unit_price)} {currency}</td>
                {vatEnabled ? <td>{fmt(item.tax_rate)}%</td> : null}
                <td>{fmt(item.line_total)} {currency}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="print-bottom">
          <div className="print-notes">
            <h2>Notes</h2>
            <p>{purchase.notes || settings.purchase_terms || 'Bon de commande fournisseur.'}</p>
          </div>
          <div className="print-totals">
            <div><span>Sous-total HT</span><strong>{fmt(purchase.subtotal)} {currency}</strong></div>
            {vatEnabled ? <div><span>TVA</span><strong>{fmt(purchase.tax_amount)} {currency}</strong></div> : null}
            <div className="print-grand-total"><span>Total</span><strong>{fmt(purchase.total_amount)} {currency}</strong></div>
          </div>
        </section>

        <footer className="print-footer">
          <span>{settings.name || 'LIBRARY SABRI'} - Document généré par {purchase.created_by_name || 'LIBRARY SABRI'} le {fmtDateTime(new Date())}</span>
        </footer>
      </div>
    </div>
  )
}
