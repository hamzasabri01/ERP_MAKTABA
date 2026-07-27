// src/pages/ClientsPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { api, fmt, fmtDate, idempotencyHeaders, SETTLEMENT_METHODS } from '../lib/api'
import {
  AlertTriangle,
  CreditCard,
  Edit2,
  Eye,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Users,
  WalletCards,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { TableLoadingRow } from '../components/ui/LoadingStates'
import { useConfirm } from '../components/ui/ConfirmDialog'
import './ClientsPage.css'

const EMPTY = {
  name: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  tax_id: '',
  ice: '',
  payment_terms: 30,
  credit_limit: 0,
  notes: '',
}

export default function ClientsPage() {
  const confirm = useConfirm()
  const [clients, setClients] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [credit, setCredit] = useState(null)
  const [creditLoading, setCreditLoading] = useState(false)
  const [payForm, setPayForm] = useState({ amount: 0, payment_mode: 'cash' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/clients', { params: { q: q || undefined, limit: 300 } })
      setClients(data)
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => { load() }, [load])

  const totals = clients.reduce((acc, client) => {
    acc.sales += Number(client.total_sales || 0)
    acc.credit += Number(client.credit_balance || 0)
    acc.overdue += Number(client.overdue_amount || 0)
    return acc
  }, { sales: 0, credit: 0, overdue: 0 })

  const openCreate = () => {
    setForm(EMPTY)
    setSelected(null)
    setModal('create')
  }

  const openEdit = (client) => {
    setForm({ ...EMPTY, ...client })
    setSelected(client)
    setModal('edit')
  }

  const openView = async (client, targetModal = 'view') => {
    setSelected(client)
    setCredit(null)
    setModal(targetModal)
    setCreditLoading(true)
    try {
      const { data } = await api.get(`/clients/${client.id}/credit`)
      setCredit(data)
      setSelected(data.client)
      setPayForm({ amount: data.total_due || 0, payment_mode: 'cash' })
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur chargement credit')
    } finally {
      setCreditLoading(false)
    }
  }

  const handleSave = async () => {
    if (!form.name?.trim()) return toast.error('Le nom est obligatoire')
    setSaving(true)
    try {
      const payload = {
        ...form,
        payment_terms: Number(form.payment_terms || 0),
        credit_limit: Number(form.credit_limit || 0),
      }
      if (modal === 'create') {
        await api.post('/clients', payload)
        toast.success('Client cree')
      } else {
        await api.put(`/clients/${selected.id}`, payload)
        toast.success('Client mis a jour')
      }
      setModal(null)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (client) => {
    const ok = await confirm({
      title: 'Archiver le client',
      message: `Archiver "${client.name}" ? Les historiques et credits restent conserves.`,
      confirmText: 'Archiver',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/clients/${client.id}`)
      toast.success('Client archive')
      load()
    } catch {
      toast.error('Erreur')
    }
  }

  const handleCreditPayment = async () => {
    if (!selected?.id) return
    const amount = Number(payForm.amount || 0)
    if (amount <= 0) return toast.error('Montant invalide')

    setSaving(true)
    try {
      const { data } = await api.post(`/clients/${selected.id}/credit/payment`, {
        amount,
        payment_mode: payForm.payment_mode,
      }, { headers: idempotencyHeaders() })
      setCredit(data)
      setSelected(data.client)
      setPayForm({ amount: data.total_due || 0, payment_mode: payForm.payment_mode })
      toast.success('Paiement credit enregistre')
      load()
      if ((data.total_due || 0) <= 0) setModal('view')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur paiement credit')
    } finally {
      setSaving(false)
    }
  }

  const F = (key) => ({
    value: form[key] ?? '',
    onChange: e => setForm(current => ({ ...current, [key]: e.target.value })),
  })

  return (
    <div className="page-content clients-page">
      <div className="page-header">
        <h1 className="page-title">Clients & Crédit</h1>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Nouveau client</button>
      </div>

      <div className="client-credit-kpis">
        <div className="kpi-card blue"><div className="kpi-icon blue"><Users size={20} /></div><div className="kpi-value">{clients.length}</div><div className="kpi-label">Clients actifs</div></div>
        <div className="kpi-card green"><div className="kpi-icon green"><WalletCards size={20} /></div><div className="kpi-value">{fmt(totals.sales)}</div><div className="kpi-label">CA clients MAD</div></div>
        <div className="kpi-card orange"><div className="kpi-icon orange"><CreditCard size={20} /></div><div className="kpi-value">{fmt(totals.credit)}</div><div className="kpi-label">Crédit ouvert MAD</div></div>
        <div className="kpi-card red"><div className="kpi-icon red"><AlertTriangle size={20} /></div><div className="kpi-value">{fmt(totals.overdue)}</div><div className="kpi-label">Retard paiement MAD</div></div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="clients-toolbar">
          <div className="search-wrap">
            <Search size={15} className="search-icon" />
            <input placeholder="Rechercher client, téléphone..." value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Code</th><th>Nom</th><th>Téléphone</th><th>Ville</th>
              <th>CA Total</th><th>Solde crédit</th><th>Limite</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={8} label="Chargement clients et crédits..." />
              ) : clients.length === 0 ? (
                <tr><td colSpan={8}><div className="empty-state"><Users size={40} /><p>Aucun client trouvé</p></div></td></tr>
              ) : clients.map(client => (
                <tr key={client.id}>
                  <td><span className="font-mono text-sm text-muted">{client.code}</span></td>
                  <td><strong>{client.name}</strong></td>
                  <td>{client.phone || '—'}</td>
                  <td>{client.city || '—'}</td>
                  <td><span className="text-accent font-semibold">{fmt(client.total_sales)} MAD</span></td>
                  <td>
                    {client.credit_balance > 0 ? (
                      <div className="credit-cell">
                        <span className={client.overdue_amount > 0 ? 'text-danger' : 'text-warning'}>{fmt(client.credit_balance)} MAD</span>
                        <small>{client.open_invoices_count || 0} facture(s)</small>
                      </div>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <div className="credit-limit-cell">
                      <span>{client.credit_limit > 0 ? `${fmt(client.credit_limit)} MAD` : 'Illimité'}</span>
                      {client.credit_limit > 0 && <div className="credit-mini-track"><span style={{ width: `${Math.min(client.credit_usage_pct || 0, 100)}%` }} /></div>}
                    </div>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openView(client)} title="Voir"><Eye size={14} /></button>
                      <button className="btn btn-success btn-sm btn-icon" disabled={!client.credit_balance} onClick={() => openView(client, 'payment')} title="Encaisser crédit"><CreditCard size={14} /></button>
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(client)} title="Modifier"><Edit2 size={14} /></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(client)} title="Archiver"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(modal === 'create' || modal === 'edit') && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-header">
              <h2>{modal === 'create' ? 'Nouveau client' : 'Modifier client'}</h2>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>x</button>
            </div>
            <div className="modal-body">
              <div className="form-grid form-grid-2">
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Nom *</label>
                  <input {...F('name')} placeholder="Nom du client" />
                </div>
                <div className="form-group"><label className="form-label">Téléphone</label><input {...F('phone')} placeholder="06XX-XXXXXX" /></div>
                <div className="form-group"><label className="form-label">Email</label><input {...F('email')} type="email" placeholder="client@email.com" /></div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}><label className="form-label">Adresse</label><input {...F('address')} placeholder="Rue, numéro..." /></div>
                <div className="form-group"><label className="form-label">Ville</label><input {...F('city')} placeholder="Casablanca" /></div>
                <div className="form-group"><label className="form-label">Délai paiement (jours)</label><input {...F('payment_terms')} type="number" min="0" /></div>
                <div className="form-group"><label className="form-label">ICE</label><input {...F('ice')} placeholder="ICE" /></div>
                <div className="form-group"><label className="form-label">IF</label><input {...F('tax_id')} placeholder="Identifiant fiscal" /></div>
                <div className="form-group"><label className="form-label">Limite crédit (MAD)</label><input {...F('credit_limit')} type="number" min="0" step="100" /></div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}><label className="form-label">Notes</label><textarea {...F('notes')} rows={3} placeholder="Notes internes..." /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : null}
                {modal === 'create' ? 'Créer' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(modal === 'view' || modal === 'payment') && selected && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <h2>{selected.name}</h2>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>x</button>
            </div>
            <div className="modal-body">
              <div className="client-credit-summary">
                <div><span>Crédit ouvert</span><strong className={selected.credit_balance > 0 ? 'text-danger' : ''}>{fmt(selected.credit_balance)} MAD</strong></div>
                <div><span>Retard</span><strong className={selected.overdue_amount > 0 ? 'text-danger' : ''}>{fmt(selected.overdue_amount)} MAD</strong></div>
                <div><span>Disponible</span><strong>{selected.credit_limit > 0 ? `${fmt(selected.credit_available)} MAD` : 'Illimité'}</strong></div>
              </div>

              {selected.credit_limit > 0 && (
                <div className="credit-usage-block">
                  <div><span>Utilisation crédit</span><strong>{fmt(selected.credit_usage_pct, 1)}%</strong></div>
                  <div className="credit-usage-track"><span style={{ width: `${Math.min(selected.credit_usage_pct || 0, 100)}%` }} /></div>
                </div>
              )}

              <div className="client-info-grid">
                {[
                  ['Code', selected.code],
                  ['Téléphone', selected.phone],
                  ['Email', selected.email],
                  ['Ville', selected.city],
                  ['Adresse', selected.address],
                  ['ICE', selected.ice],
                  ['IF', selected.tax_id],
                  ['Délai paiement', `${selected.payment_terms} jours`],
                  ['CA Total', `${fmt(selected.total_sales)} MAD`],
                  ['Solde crédit', `${fmt(selected.credit_balance)} MAD`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value || '—'}</strong>
                  </div>
                ))}
              </div>

              {selected.notes && <div className="client-notes">{selected.notes}</div>}

              <div className="credit-ledger">
                <div className="credit-ledger-head">
                  <div><ReceiptText size={17} /> Factures ouvertes</div>
                  {creditLoading && <span className="spinner" style={{ width: 16, height: 16 }} />}
                </div>
                {!creditLoading && (!credit?.invoices || credit.invoices.length === 0) ? (
                  <div className="credit-empty">Aucune facture ouverte pour ce client.</div>
                ) : (
                  <div className="credit-invoices">
                    {(credit?.invoices || []).map(invoice => (
                      <div className="credit-invoice-row" key={invoice.id}>
                        <div>
                          <strong>{invoice.number}</strong>
                          <span>{fmtDate(invoice.date_time)} - échéance {invoice.due_date ? fmtDate(invoice.due_date) : 'non définie'}</span>
                        </div>
                        <div>
                          <strong className={invoice.overdue_days > 0 ? 'text-danger' : ''}>{fmt(invoice.balance_due)} MAD</strong>
                          <span>{invoice.overdue_days > 0 ? `${invoice.overdue_days} j retard` : `${fmt(invoice.paid_amount)} MAD payé`}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {modal === 'payment' && (
                <div className="credit-payment-panel">
                  <h3>Encaisser un paiement crédit</h3>
                  <div className="form-grid form-grid-2">
                    <div className="form-group">
                      <label className="form-label">Montant reçu</label>
                      <input type="number" min="0" step="0.01" value={payForm.amount} onChange={e => setPayForm(current => ({ ...current, amount: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Mode paiement</label>
                      <select value={payForm.payment_mode} onChange={e => setPayForm(current => ({ ...current, payment_mode: e.target.value }))}>
                        {SETTLEMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <p>Le paiement sera imputé automatiquement sur les factures les plus anciennes.</p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Fermer</button>
              {selected.credit_balance > 0 && modal !== 'payment' && (
                <button className="btn btn-success" onClick={() => setModal('payment')}><CreditCard size={16} /> Encaisser</button>
              )}
              {modal === 'payment' && (
                <button className="btn btn-success" onClick={handleCreditPayment} disabled={saving || creditLoading}>
                  {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <CreditCard size={16} />}
                  Valider paiement
                </button>
              )}
              <button className="btn btn-primary" onClick={() => openEdit(selected)}>Modifier</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
