// src/pages/SuppliersPage.jsx
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { CreditCard, Edit2, Plus, Trash2, UserCheck, WalletCards } from 'lucide-react'
import { api, fmt, fmtDate, idempotencyHeaders } from '../lib/api'
import { useConfirm } from '../components/ui/ConfirmDialog'

const EMPTY = { company_name:'', contact_person:'', phone:'', email:'', address:'', city:'', tax_id:'', ice:'', notes:'', is_active:true }

export default function SuppliersPage() {
  const confirm = useConfirm()
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [q, setQ] = useState('')
  const [credit, setCredit] = useState(null)
  const [payAmount, setPayAmount] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/suppliers', { params: { q: q || undefined } })
      setSuppliers(data)
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setForm(EMPTY); setSelected(null); setModal('form') }
  const openEdit = (supplier) => { setForm({ ...supplier }); setSelected(supplier); setModal('form') }

  const handleSave = async () => {
    if (!form.company_name?.trim()) return toast.error('Le nom est obligatoire')
    setSaving(true)
    try {
      if (!selected) {
        await api.post('/suppliers', form)
        toast.success('Fournisseur cree')
      } else {
        await api.put(`/suppliers/${selected.id}`, form)
        toast.success('Mis a jour')
      }
      setModal(null)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (supplier) => {
    const ok = await confirm({
      title: 'Archiver fournisseur',
      message: `Archiver "${supplier.company_name}" ? Les achats et credits restent conserves.`,
      confirmText: 'Archiver',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/suppliers/${supplier.id}`)
      toast.success('Archive')
      load()
    } catch {
      toast.error('Erreur')
    }
  }

  const openCredit = async (supplier) => {
    const { data } = await api.get(`/suppliers/${supplier.id}/credit`)
    setCredit(data)
    setPayAmount(data.total_due || 0)
    setModal('credit')
  }

  const handleCreditPayment = async () => {
    if (!credit?.supplier?.id || +payAmount <= 0) return toast.error('Montant invalide')
    try {
      const { data } = await api.post(`/suppliers/${credit.supplier.id}/credit/payment`, { amount: +payAmount, payment_mode: 'cash' }, { headers: idempotencyHeaders() })
      setCredit(data)
      setPayAmount(data.total_due || 0)
      toast.success('Paiement fournisseur enregistre')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Paiement impossible')
    }
  }

  const F = (key) => ({ value: form[key] ?? '', onChange: e => setForm(current => ({ ...current, [key]: e.target.value })) })

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Fournisseurs</h1>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16}/> Nouveau fournisseur</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)' }}>
          <input placeholder="Rechercher..." value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Societe</th><th>Contact</th><th>Telephone</th><th>Ville</th><th>Credit</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign:'center', padding:'3rem' }}><span className="spinner" style={{ margin:'auto' }}/></td></tr>
              ) : suppliers.length === 0 ? (
                <tr><td colSpan={7}><div className="empty-state"><UserCheck size={40}/><p>Aucun fournisseur</p></div></td></tr>
              ) : suppliers.map(supplier => (
                <tr key={supplier.id}>
                  <td><span className="font-mono text-sm text-muted">{supplier.code}</span></td>
                  <td><strong>{supplier.company_name}</strong></td>
                  <td>{supplier.contact_person || '-'}</td>
                  <td>{supplier.phone || '-'}</td>
                  <td>{supplier.city || '-'}</td>
                  <td><strong style={{ color: supplier.credit_balance > 0 ? 'var(--warning)' : 'var(--success)' }}>{fmt(supplier.credit_balance)} MAD</strong></td>
                  <td><div className="flex gap-2">
                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openCredit(supplier)} title="Credit fournisseur"><WalletCards size={14}/></button>
                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(supplier)} title="Modifier"><Edit2 size={14}/></button>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(supplier)} title="Archiver"><Trash2 size={14}/></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal === 'form' && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-header"><h2>{!selected ? 'Nouveau fournisseur' : 'Modifier fournisseur'}</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>x</button></div>
            <div className="modal-body">
              <div className="form-grid form-grid-2" style={{ gap:'1rem' }}>
                <div className="form-group" style={{ gridColumn:'1/-1' }}><label className="form-label">Societe *</label><input {...F('company_name')} placeholder="Nom de la societe"/></div>
                <div className="form-group"><label className="form-label">Contact</label><input {...F('contact_person')} placeholder="Nom du contact"/></div>
                <div className="form-group"><label className="form-label">Telephone</label><input {...F('phone')}/></div>
                <div className="form-group"><label className="form-label">Email</label><input {...F('email')} type="email"/></div>
                <div className="form-group"><label className="form-label">Ville</label><input {...F('city')}/></div>
                <div className="form-group" style={{ gridColumn:'1/-1' }}><label className="form-label">Adresse</label><input {...F('address')}/></div>
                <div className="form-group"><label className="form-label">ICE</label><input {...F('ice')}/></div>
                <div className="form-group"><label className="form-label">IF</label><input {...F('tax_id')}/></div>
                <div className="form-group" style={{ gridColumn:'1/-1' }}><label className="form-label">Notes</label><textarea {...F('notes')} rows={2}/></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? <span className="spinner" style={{ width:16, height:16 }}/> : null}{!selected ? 'Creer' : 'Enregistrer'}</button>
            </div>
          </div>
        </div>
      )}

      {modal === 'credit' && credit && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal modal-lg">
            <div className="modal-header"><h2>Credit fournisseur - {credit.supplier.company_name}</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>x</button></div>
            <div className="modal-body">
              <div className="kpi-grid" style={{ marginBottom:'1rem' }}>
                <div className="kpi-card"><div className="kpi-label">Total achats</div><div className="kpi-value">{fmt(credit.total_purchases)} MAD</div></div>
                <div className="kpi-card"><div className="kpi-label">Reste a payer</div><div className="kpi-value">{fmt(credit.total_due)} MAD</div></div>
              </div>
              <div className="form-grid form-grid-2" style={{ marginBottom:'1rem' }}>
                <div className="form-group"><label className="form-label">Montant paiement</label><input type="number" min="0" value={payAmount} onChange={e => setPayAmount(e.target.value)} /></div>
                <div className="form-group" style={{ alignSelf:'end' }}><button className="btn btn-primary" onClick={handleCreditPayment}><CreditCard size={16}/> Enregistrer paiement</button></div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Numero</th><th>Date</th><th>Total</th><th>Paye</th><th>Reste</th><th>Statut</th></tr></thead>
                  <tbody>
                    {credit.purchases.length === 0 ? (
                      <tr><td colSpan={6}><div className="empty-state"><p>Aucune dette fournisseur</p></div></td></tr>
                    ) : credit.purchases.map(p => (
                      <tr key={p.id}><td>{p.number}</td><td>{fmtDate(p.date_time)}</td><td>{fmt(p.total_amount)} MAD</td><td>{fmt(p.paid_amount)} MAD</td><td>{fmt(p.balance_due)} MAD</td><td>{p.payment_status}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
