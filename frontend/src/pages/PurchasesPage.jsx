// src/pages/PurchasesPage.jsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, fmt, fmtDate, fmtDateTime, operationHeaders, SETTLEMENT_METHODS, paymentModeLabel } from '../lib/api'
import { Plus, Search, Eye, Trash2, Check, CreditCard, Truck, Printer, Download, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { TableLoadingRow } from '../components/ui/LoadingStates'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { getCompanyName, getLogoUrl } from '../lib/brand'
import './SalesPrint.css'

const STATUS_LABELS = { draft:'Brouillon', confirmed:'Confirmé', partially_received:'Partiellement reçu', received:'Reçu', partially_paid:'Partiellement payé', paid:'Payé', cancelled:'Annulé' }
const EMPTY_PURCHASE = { doc_type:'order', supplier_id:'', date_time:'', notes:'', discount:0, items:[] }
const EMPTY_ITEM = { product_id:'', description:'', quantity:1, unit_price:0, discount:0, tax_rate:20 }
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
  const [payAmt, setPayAmt]       = useState(0)
  const [payMode, setPayMode]     = useState('cash')
  const [settings, setSettings]   = useState({})
  const [payments, setPayments]   = useState([])
  const [timeline, setTimeline]   = useState([])
  const [receiveQuantities, setReceiveQuantities] = useState({})
  const [serverPreview, setServerPreview] = useState(null)
  const currency = serverPreview?.currency_code || settings.currency || 'MAD'
  const paymentModes = SETTLEMENT_METHODS
  const taxRates = String(settings.tax_rates || '0,7,10,14,20').split(',').map(Number).filter(Number.isFinite)

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
  const printDocument = () => setTimeout(() => window.print(), 50)

  const openReceive = async (p) => {
    try {
      const { data } = await api.get(`/purchases/${p.id}`)
      setSelected(data)
      setReceiveQuantities(Object.fromEntries(data.items.map(item => [item.id, item.remaining_quantity])))
      setModal('receive')
    } catch(e) { toast.error(e.response?.data?.detail||'Erreur') }
  }
  const handleReceive = async () => {
    const items = selected.items
      .map(item => ({ item_id:item.id, quantity:Number(receiveQuantities[item.id] || 0) }))
      .filter(item => item.quantity > 0)
    if (!items.length) return toast.error('Saisissez au moins une quantité reçue')
    try { await api.post(`/purchases/${selected.id}/receive`, { items }, { headers: operationHeaders(selected.version) }); toast.success('Réception enregistrée, stock mis à jour'); setModal(null); load() }
    catch(e) { toast.error(e.response?.data?.detail||'Erreur') }
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
    try {
      const { data } = await api.get(`/purchases/${p.id}`)
      downloadHtmlFile(`${data.number || 'achat'}.html`, buildPurchaseDocumentHtml(data, settings))
      toast.success('Document telecharge')
    } catch(e) { toast.error(e.response?.data?.detail || 'Telechargement impossible') }
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
    try { await api.post(`/purchases/${selected.id}/payment`,{amount:+payAmt,payment_mode:payMode},{ headers:operationHeaders(selected.version) }); toast.success('Paiement enregistré'); setModal(null); load() }
    catch(e) { toast.error(e.response?.data?.detail||'Erreur') }
  }

  const addItem = () => setForm(f=>({...f,items:[...f.items,{...EMPTY_ITEM}]}))
  const removeItem = (i) => setForm(f=>({...f,items:f.items.filter((_,idx)=>idx!==i)}))
  const updateItem = (i,key,val) => setForm(f=>{
    const items=[...f.items]; items[i]={...items[i],[key]:val}
    if(key==='product_id'&&val){ const p=products.find(p=>p.id===+val); if(p){items[i].unit_price=p.purchase_price;items[i].description=p.name;items[i].tax_rate=p.tax_rate} }
    return {...f,items}
  })

  const totals = (form.items||[]).reduce((acc,i)=>{
    const line=(i.quantity||1)*(i.unit_price||0)*(1-(i.discount||0)/100)
    const lt=line*(1-(form.discount||0)/100); const tax=lt*(i.tax_rate ?? 0)/100
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
    setSaving(true)
    try {
      const payload = buildPurchasePayload(form)
      const { data: exact } = await api.post('/purchases/preview', payload)
      setServerPreview(exact)
      await api.post('/purchases',payload); toast.success('Commande créée'); setModal(null); load()
    } catch(e){toast.error(e.response?.data?.detail||'Erreur')}
    finally{setSaving(false)}
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Achats</h1>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={exportList} disabled={loading || purchases.length === 0}><Download size={16}/> Export CSV</button>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={16}/> Nouvelle commande</button>
        </div>
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
                <tr key={p.id}>
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
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={()=>handleDownload(p)} title="Telecharger"><Download size={14}/></button>
                      {p.status==='draft'&&<>
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
          <div className="modal modal-xl">
            <div className="modal-header"><h2>Nouvelle commande d'achat</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={()=>setModal(null)}>✕</button></div>
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
              <div style={{marginBottom:'1rem'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'.75rem'}}>
                  <h3>Articles</h3>
                  <button className="btn btn-secondary btn-sm" onClick={addItem}><Plus size={14}/> Ligne</button>
                </div>
                <div className="table-wrap">
                  <table style={{fontSize:'.8rem'}}>
                    <thead><tr><th style={{minWidth:180}}>Produit</th><th style={{width:80}}>Qté</th><th style={{width:120}}>Prix unit.</th><th style={{width:80}}>Remise%</th><th style={{width:80}}>TVA%</th><th style={{width:120}}>Total</th><th style={{width:40}}></th></tr></thead>
                    <tbody>
                      {form.items.map((item,i)=>{
                        const lt=(item.quantity||1)*(item.unit_price||0)
                        return(
                          <tr key={i}>
                            <td>
                              <select value={item.product_id||''} onChange={e=>updateItem(i,'product_id',e.target.value)} style={{marginBottom:'.25rem'}}>
                                <option value="">— Produit —</option>
                                {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              <input value={item.description||''} onChange={e=>updateItem(i,'description',e.target.value)} placeholder="Description..." />
                            </td>
                            <td><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={e=>updateItem(i,'quantity',+e.target.value||1)} /></td>
                            <td><input type="number" min="0" step="0.01" value={item.unit_price} onChange={e=>updateItem(i,'unit_price',+e.target.value||0)} /></td>
                            <td><input type="number" min="0" max="100" step="0.01" value={item.discount || 0} onChange={e=>updateItem(i,'discount',e.target.value)} /></td>
                            <td><select value={item.tax_rate} onChange={e=>updateItem(i,'tax_rate',+e.target.value)}>{taxRates.map(r=><option key={r} value={r}>{r}%</option>)}</select></td>
                            <td className="font-semibold">{fmt(lt)} {currency}</td>
                            <td><button className="btn btn-danger btn-sm btn-icon" onClick={()=>removeItem(i)}>✕</button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{textAlign:'right',marginTop:'1rem',padding:'1rem',background:'var(--bg3)',borderRadius:'var(--radius-sm)',display:'flex',flexDirection:'column',gap:'.3rem',alignItems:'flex-end'}}>
                  <div className="text-sm text-muted">Sous-total: <strong>{fmt(exactTotals.sub)} {currency}</strong></div>
                  <div className="text-sm text-muted">TVA: <strong>{fmt(exactTotals.tax)} {currency}</strong></div>
                  <div style={{fontSize:'1.1rem',fontWeight:700}}>Total: <span style={{color:'var(--accent)'}}>{fmt(exactTotals.total)} {currency}</span></div>
                  <small className="text-muted">{serverPreview ? 'Total exact calculé par le serveur' : 'Vérification du total en cours…'}</small>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?<span className="spinner" style={{width:16,height:16}}/>:null} Créer commande</button>
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
                  <thead><tr><th>Produit</th><th>Qté</th><th>Reçu</th><th>Prix</th><th>TVA</th><th>Total</th></tr></thead>
                  <tbody>
                    {selected.items.map(i=><tr key={i.id}><td>{i.product_name||i.description}</td><td>{i.quantity}</td><td>{i.received_quantity}</td><td>{fmt(i.unit_price)} {selected.currency_code || currency}</td><td>{i.tax_rate}%</td><td className="font-semibold">{fmt(i.line_total)} {selected.currency_code || currency}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div style={{textAlign:'right',marginTop:'1rem'}}>
                {(selected.tax_breakdown || []).map(row => <div key={row.rate} className="text-sm text-muted">TVA {fmt(row.rate)}%: {fmt(row.tax_amount)} {selected.currency_code || currency}</div>)}
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
              <button className="btn btn-secondary" onClick={printDocument}>
                <Printer size={15} /> PDF / Imprimer
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
              <button className="btn btn-success" onClick={handlePayment}><Check size={15}/> Confirmer</button>
            </div>
          </div>
        </div>
      )}

      {modal==='receive'&&selected&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal modal-lg">
            <div className="modal-header"><h2>Réception {selected.number}</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={()=>setModal(null)}>✕</button></div>
            <div className="modal-body">
              <p className="text-muted text-sm" style={{marginBottom:'1rem'}}>Indiquez uniquement les quantités reçues maintenant. Le stock ne sera augmenté que de ces quantités.</p>
              <div className="table-wrap">
                <table><thead><tr><th>Produit</th><th>Commandé</th><th>Déjà reçu</th><th>Réception actuelle</th></tr></thead><tbody>
                  {selected.items.filter(item=>item.remaining_quantity>0).map(item=><tr key={item.id}>
                    <td>{item.product_name||item.description}</td><td>{item.quantity}</td><td>{item.received_quantity}</td>
                    <td><input type="number" min="0" max={item.remaining_quantity} step="0.01" value={receiveQuantities[item.id]??''} onChange={e=>setReceiveQuantities(current=>({...current,[item.id]:e.target.value}))} aria-label={`Quantité reçue pour ${item.product_name||item.description}`} /></td>
                  </tr>)}
                </tbody></table>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setModal(null)}>Annuler</button><button className="btn btn-success" onClick={handleReceive}><Truck size={15}/> Enregistrer la réception</button></div>
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
  const amountDue = Math.max(Number(purchase.total_amount || 0) - Number(purchase.paid_amount || 0), 0)
  const logoUrl = getLogoUrl(settings)
  const rows = (purchase.items || []).map(item => `
    <tr><td>${escapeHtml(item.product_name || item.description)}</td><td>${fmt(item.quantity, 0)}</td><td>${fmt(item.unit_price)} ${currency}</td><td>${fmt(item.tax_rate)}%</td><td>${fmt(item.line_total)} ${currency}</td></tr>
  `).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(purchase.number)}</title><style>${documentPrintCss()}</style></head><body><main class="sheet"><header><div class="brand"><img src="${escapeHtml(logoUrl)}" alt=""><div><strong>${escapeHtml(getCompanyName(settings))}</strong><span>${escapeHtml(settings.address || '')}</span><span>${escapeHtml(settings.phone || '')}</span></div></div><div class="meta"><h1>Bon de commande</h1><b>${escapeHtml(purchase.number)}</b><span>Date: ${fmtDate(purchase.date_time)}</span><span>Utilisateur: ${escapeHtml(purchase.created_by_name || '-')}</span></div></header><section class="parties"><div><h2>Fournisseur</h2><b>${escapeHtml(purchase.supplier_name || 'Fournisseur')}</b></div><div><h2>Paiement</h2><span>Statut: ${escapeHtml(purchase.payment_status || '-')}</span><span>Paye: ${fmt(purchase.paid_amount)} ${currency}</span><span>Reste: ${fmt(amountDue)} ${currency}</span></div></section><table><thead><tr><th>Designation</th><th>Qte</th><th>PU HT</th><th>TVA</th><th>Total HT</th></tr></thead><tbody>${rows}</tbody></table><section class="bottom"><div><h2>Notes</h2><p>${escapeHtml(purchase.notes || settings.purchase_terms || 'Bon de commande fournisseur.')}</p></div><aside><p><span>Sous-total</span><b>${fmt(purchase.subtotal)} ${currency}</b></p><p><span>TVA</span><b>${fmt(purchase.tax_amount)} ${currency}</b></p><p class="total"><span>Total TTC</span><b>${fmt(purchase.total_amount)} ${currency}</b></p></aside></section><footer>${escapeHtml(getCompanyName(settings))} - Document genere par ${escapeHtml(purchase.created_by_name || 'ProERP Web')}</footer></main></body></html>`
}

function PrintablePurchaseDocument({ purchase, settings }) {
  const currency = settings.currency || 'MAD'
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
              <th>PU HT</th>
              <th>TVA</th>
              <th>Total HT</th>
            </tr>
          </thead>
          <tbody>
            {purchase.items.map(item => (
              <tr key={item.id}>
                <td>{item.product_name || item.description}</td>
                <td>{fmt(item.quantity, 0)}</td>
                <td>{fmt(item.unit_price)} {currency}</td>
                <td>{fmt(item.tax_rate)}%</td>
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
            <div><span>TVA</span><strong>{fmt(purchase.tax_amount)} {currency}</strong></div>
            <div className="print-grand-total"><span>Total TTC</span><strong>{fmt(purchase.total_amount)} {currency}</strong></div>
          </div>
        </section>

        <footer className="print-footer">
          <span>{settings.name || 'ProERP'} - Document généré par {purchase.created_by_name || 'ProERP Web'} le {fmtDateTime(new Date())}</span>
        </footer>
      </div>
    </div>
  )
}
