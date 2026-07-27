// src/pages/CashPage.jsx
import { useEffect, useMemo, useState } from 'react'
import { api, fmt, fmtDateTime, idempotencyHeaders, operationHeaders } from '../lib/api'
import { ArrowDownCircle, ArrowUpCircle, Clock3, Lock, RefreshCw, RotateCcw, ShieldCheck, Wallet, WalletCards } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../lib/AuthContext'
import './CashPage.css'

export default function CashPage() {
  const { hasPermission } = useAuth()
  const [current, setCurrent] = useState(null)
  const [sessions, setSessions] = useState([])
  const [transactions, setTransactions] = useState([])
  const [reconciliation, setReconciliation] = useState(null)
  const [creditReconciliation, setCreditReconciliation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ opening_balance: 0, notes: '' })
  const [closeForm, setCloseForm] = useState({ closing_balance: 0, notes: '', difference_reason: '' })
  const [txForm, setTxForm] = useState({ direction: 'in', amount: 0, description: '', reference: '' })
  const [reverseForm, setReverseForm] = useState({ transaction: null, reason: '' })
  const [saving, setSaving] = useState(false)

  const load = async (soft = false) => {
    soft ? setRefreshing(true) : setLoading(true)
    try {
      const [cur, all, tx, cashCheck, creditCheck] = await Promise.all([
        api.get('/cash/current'),
        api.get('/cash'),
        api.get('/cash/current/transactions'),
        api.get('/cash/reconciliation'),
        api.get('/cash/credit-reconciliation'),
      ])
      setCurrent(cur.data)
      setSessions(all.data || [])
      setTransactions(tx.data || [])
      setReconciliation(cashCheck.data)
      setCreditReconciliation(creditCheck.data)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur chargement caisse')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  const balance = current ? current.opening_balance + current.total_in - current.total_out : 0
  const cashAge = useMemo(() => {
    if (!current?.opened_at) return ''
    const diff = Date.now() - new Date(current.opened_at).getTime()
    const hours = Math.floor(diff / 3600000)
    const mins = Math.floor((diff % 3600000) / 60000)
    return `${hours}h ${mins}m`
  }, [current])

  const handleOpen = async () => {
    setSaving(true)
    try {
      await api.post('/cash/open', form, { headers: idempotencyHeaders() })
      toast.success('Caisse ouverte')
      setModal(null)
      load(true)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = async () => {
    if (!current) return
    setSaving(true)
    try {
      await api.post(`/cash/${current.id}/close`, closeForm, { headers: operationHeaders(current.version) })
      toast.success('Caisse clôturée')
      setModal(null)
      load(true)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const handleTx = async () => {
    if (!Number(txForm.amount) || Number(txForm.amount) <= 0) return toast.error('Montant invalide')
    if (!current) return
    setSaving(true)
    try {
      await api.post(
        `/cash/${current.id}/transaction`,
        { ...txForm, amount: Number(txForm.amount) },
        { headers: idempotencyHeaders() },
      )
      toast.success('Transaction enregistrée')
      setModal(null)
      load(true)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const handleReverse = async () => {
    if (!reverseForm.transaction || reverseForm.reason.trim().length < 3) return toast.error('Motif obligatoire')
    setSaving(true)
    try {
      await api.post(
        `/cash/transactions/${reverseForm.transaction.id}/reverse`,
        { reason: reverseForm.reason.trim() },
        { headers: idempotencyHeaders() },
      )
      toast.success('Contre-passation enregistrée')
      setModal(null)
      setReverseForm({ transaction: null, reason: '' })
      load(true)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Contre-passation impossible')
    } finally {
      setSaving(false)
    }
  }

  const openCash = () => {
    setForm({ opening_balance: 0, notes: '' })
    setModal('open')
  }

  const openTransaction = (direction = 'in') => {
    setTxForm({ direction, amount: 0, description: '', reference: '' })
    setModal('tx')
  }

  const openClose = () => {
    setCloseForm({ closing_balance: balance, notes: '', difference_reason: '' })
    setModal('close')
  }

  const openReverse = transaction => {
    setReverseForm({ transaction, reason: '' })
    setModal('reverse')
  }

  return (
    <div className="page-content cash-page">
      <section className={`cash-hero ${current ? 'open' : 'closed'}`}>
        <div>
          <span className="cash-eyebrow">{current ? 'Session active' : 'Aucune session active'}</span>
          <h1>Caisse</h1>
          <p>{current ? `Ouverte depuis ${cashAge} - ${fmtDateTime(current.opened_at)}` : 'Ouvrez une session pour enregistrer les mouvements de caisse.'}</p>
        </div>
        <div className="cash-actions">
          <button className="btn btn-secondary" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'cash-spin' : ''} /> Actualiser
          </button>
          {!current ? (
            <button className="btn btn-primary" onClick={openCash}><Wallet size={16} /> Ouvrir la caisse</button>
          ) : (
            <>
              <button className="btn btn-success" onClick={() => openTransaction('in')}><ArrowDownCircle size={16} /> Entrée</button>
              <button className="btn btn-danger" onClick={() => openTransaction('out')}><ArrowUpCircle size={16} /> Sortie</button>
              <button className="btn btn-secondary" onClick={openClose}><Lock size={16} /> Clôturer</button>
            </>
          )}
        </div>
      </section>

      <section className="cash-kpis">
        <CashKpi tone="success" icon={WalletCards} label="Solde actuel" value={`${fmt(balance)} MAD`} sub={current ? 'Disponible en caisse' : 'Caisse fermée'} />
        <CashKpi tone="accent" icon={Wallet} label="Fonds ouverture" value={`${fmt(current?.opening_balance || 0)} MAD`} sub="Base de session" />
        <CashKpi tone="in" icon={ArrowDownCircle} label="Entrées" value={`${fmt(current?.total_in || 0)} MAD`} sub="Ventes et ajouts" />
        <CashKpi tone="out" icon={ArrowUpCircle} label="Sorties" value={`${fmt(current?.total_out || 0)} MAD`} sub="Retraits et achats" />
      </section>

      <section className="cash-integrity-grid">
        <IntegrityCard
          title="Rapprochement caisse"
          ok={reconciliation?.ok}
          detail={reconciliation
            ? `${reconciliation.transaction_count} حركة · ${reconciliation.payment_count} دفعة · فرق ${fmt(reconciliation.difference)} MAD`
            : 'Vérification...'}
        />
        <IntegrityCard
          title="Rapprochement crédit"
          ok={creditReconciliation?.ok}
          detail={creditReconciliation
            ? `${creditReconciliation.client_count} client(s) · ${creditReconciliation.mismatch_count} écart(s)`
            : 'Vérification...'}
        />
      </section>

      {!current && !loading && (
        <div className="cash-empty-callout">
          <Wallet size={22} />
          <div>
            <strong>La caisse n'est pas ouverte</strong>
            <span>Les paiements en espèces sont bloqués jusqu’à l’ouverture d’une session, afin que chaque règlement soit réconciliable.</span>
          </div>
          <button className="btn btn-primary" onClick={openCash}>Ouvrir maintenant</button>
        </div>
      )}

      <section className="cash-grid">
        <div className="card cash-panel">
          <div className="cash-panel-head">
            <div><Clock3 size={17} /> Transactions de la session</div>
            <span>{transactions.length} mouvement(s)</span>
          </div>
          <div className="cash-transaction-list">
            {loading ? (
              <div className="cash-loading"><span className="spinner" /></div>
            ) : transactions.length === 0 ? (
              <div className="empty-state"><Wallet size={38} /><p>Aucune transaction</p></div>
            ) : transactions.map(tx => (
              <div className={`cash-transaction ${tx.direction}`} key={tx.id}>
                <span>{tx.direction === 'in' ? <ArrowDownCircle size={17} /> : <ArrowUpCircle size={17} />}</span>
                <div>
                  <strong>{tx.description || tx.source || 'Transaction caisse'}</strong>
                  <small>
                    {fmtDateTime(tx.created_at)} {tx.payment_reference || tx.reference ? `- ${tx.payment_reference || tx.reference}` : ''}
                    {tx.kind === 'reversal' ? ' · Contre-passation' : ''}
                  </small>
                </div>
                <em>{tx.direction === 'in' ? '+' : '-'}{fmt(tx.amount)} MAD</em>
                {hasPermission('cash.reverse') && tx.kind !== 'reversal' && (
                  <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openReverse(tx)} title="Contre-passer">
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card cash-panel sessions-panel">
          <div className="cash-panel-head">
            <div><Wallet size={17} /> Historique des sessions</div>
            <span>{sessions.length} session(s)</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ouverture</th><th>Solde</th><th>Entrées</th><th>Sorties</th><th>Écart</th><th>Statut</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ margin: 'auto' }} /></td></tr>
                : sessions.length === 0 ? <tr><td colSpan={6}><div className="empty-state"><Wallet size={40} /><p>Aucune session</p></div></td></tr>
                : sessions.map(session => {
                  const sessionBalance = (session.opening_balance || 0) + (session.total_in || 0) - (session.total_out || 0)
                  return (
                    <tr key={session.id}>
                      <td><strong className="text-sm">{fmtDateTime(session.opened_at)}</strong><div className="text-muted text-sm">{session.closed_at ? fmtDateTime(session.closed_at) : 'En cours'}</div></td>
                      <td>{fmt(session.closing_balance ?? sessionBalance)} MAD</td>
                      <td className="text-success">{fmt(session.total_in)} MAD</td>
                      <td className="text-danger">{fmt(session.total_out)} MAD</td>
                      <td className={session.difference == null ? 'text-muted' : session.difference < 0 ? 'text-danger' : 'text-success'}>
                        {session.difference != null ? `${session.difference > 0 ? '+' : ''}${fmt(session.difference)} MAD` : '—'}
                      </td>
                      <td>
                        <span className={`badge badge-${session.status}`}>{session.status === 'open' ? 'Ouverte' : 'Clôturée'}</span>
                        {session.approved_by ? <div className="text-muted text-sm">Écart approuvé</div> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {modal === 'open' && (
        <CashModal title="Ouvrir la caisse" onClose={() => setModal(null)}>
          <div className="form-group"><label className="form-label">Fonds d'ouverture (MAD)</label><input type="number" min="0" step="0.01" value={form.opening_balance} onChange={e => setForm(f => ({ ...f, opening_balance: Number(e.target.value) || 0 }))} /></div>
          <div className="form-group"><label className="form-label">Notes</label><textarea value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          <ModalActions saving={saving} onCancel={() => setModal(null)} onConfirm={handleOpen} confirmText="Ouvrir" />
        </CashModal>
      )}

      {modal === 'close' && (
        <CashModal title="Clôturer la caisse" onClose={() => setModal(null)}>
          <div className="cash-close-summary">
            <span>Solde théorique</span>
            <strong>{fmt(balance)} MAD</strong>
          </div>
          <div className="form-group"><label className="form-label">Montant compté</label><input type="number" min="0" step="0.01" value={closeForm.closing_balance} onChange={e => setCloseForm(f => ({ ...f, closing_balance: Number(e.target.value) || 0 }))} /></div>
          <div className="form-group"><label className="form-label">Notes</label><textarea value={closeForm.notes || ''} onChange={e => setCloseForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          {Number(closeForm.closing_balance) !== Number(balance) && (
            <>
              <div className={`alert ${closeForm.closing_balance < balance ? 'alert-danger' : 'alert-warning'}`}>
                Écart: {fmt(closeForm.closing_balance - balance)} MAD
              </div>
              <div className="form-group">
                <label className="form-label">Motif de l’écart *</label>
                <textarea value={closeForm.difference_reason || ''} onChange={e => setCloseForm(f => ({ ...f, difference_reason: e.target.value }))} rows={2} />
              </div>
            </>
          )}
          <ModalActions saving={saving} onCancel={() => setModal(null)} onConfirm={handleClose} confirmText="Clôturer" danger />
        </CashModal>
      )}

      {modal === 'tx' && (
        <CashModal title="Nouvelle transaction" onClose={() => setModal(null)}>
          <div className="cash-direction-toggle">
            <button className={txForm.direction === 'in' ? 'active in' : ''} onClick={() => setTxForm(f => ({ ...f, direction: 'in' }))}><ArrowDownCircle size={16} /> Entrée</button>
            <button className={txForm.direction === 'out' ? 'active out' : ''} onClick={() => setTxForm(f => ({ ...f, direction: 'out' }))}><ArrowUpCircle size={16} /> Sortie</button>
          </div>
          <div className="form-group"><label className="form-label">Montant (MAD) *</label><input type="number" min="0.01" step="0.01" value={txForm.amount || 0} onChange={e => setTxForm(f => ({ ...f, amount: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">Description</label><input value={txForm.description || ''} onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))} placeholder="Description..." /></div>
          <div className="form-group"><label className="form-label">Référence</label><input value={txForm.reference || ''} onChange={e => setTxForm(f => ({ ...f, reference: e.target.value }))} /></div>
          <ModalActions saving={saving} onCancel={() => setModal(null)} onConfirm={handleTx} confirmText="Enregistrer" />
        </CashModal>
      )}

      {modal === 'reverse' && (
        <CashModal title="Contre-passer la transaction" onClose={() => setModal(null)}>
          <div className="cash-close-summary">
            <span>Transaction originale</span>
            <strong>{fmt(reverseForm.transaction?.amount || 0)} MAD</strong>
          </div>
          <div className="form-group">
            <label className="form-label">Motif *</label>
            <textarea value={reverseForm.reason} onChange={e => setReverseForm(form => ({ ...form, reason: e.target.value }))} rows={3} />
          </div>
          <ModalActions saving={saving} onCancel={() => setModal(null)} onConfirm={handleReverse} confirmText="Contre-passer" danger />
        </CashModal>
      )}
    </div>
  )
}

function IntegrityCard({ title, ok, detail }) {
  return (
    <div className={`cash-integrity-card ${ok ? 'ok' : 'warning'}`}>
      <ShieldCheck size={19} />
      <div><strong>{title}</strong><span>{detail}</span></div>
    </div>
  )
}

function CashKpi({ tone, icon: Icon, label, value, sub }) {
  return (
    <div className={`cash-kpi ${tone}`}>
      <span><Icon size={18} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{sub}</em>
      </div>
    </div>
  )
}

function CashModal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal cash-modal">
        <div className="modal-header"><h2>{title}</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={onClose}>x</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

function ModalActions({ saving, onCancel, onConfirm, confirmText, danger = false }) {
  return (
    <div className="modal-footer">
      <button className="btn btn-secondary" onClick={onCancel}>Annuler</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={saving}>
        {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : null}
        {confirmText}
      </button>
    </div>
  )
}
