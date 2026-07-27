// src/pages/ExpensesPage.jsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmt, fmtDate, idempotencyHeaders, paymentModeValue, SETTLEMENT_METHODS } from '../lib/api'
import { CalendarDays, Edit2, Filter, Plus, ReceiptText, Search, Trash2, TrendingDown, WalletCards } from 'lucide-react'
import toast from 'react-hot-toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import './ExpensesPage.css'

const EMPTY = { date: '', category: 'Autre', description: '', amount: 0, payment_method: 'cash', reference: '', notes: '' }

export default function ExpensesPage() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [expenses, setExpenses] = useState([])
  const [categories, setCategories] = useState([])
  const paymentModes = SETTLEMENT_METHODS
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [expensesRes, categoriesRes] = await Promise.all([
        api.get('/expenses', { params: { limit: 500 } }),
        api.get('/expenses/categories'),
      ])
      setExpenses(expensesRes.data || [])
      setCategories(categoriesRes.data || [])
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur chargement depenses')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const now = new Date()
  const filteredExpenses = useMemo(() => {
    const q = query.trim().toLowerCase()
    return expenses.filter(expense => {
      const d = new Date(expense.date)
      const sameMonth = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      const sameYear = d.getFullYear() === now.getFullYear()
      const periodOk = periodFilter === 'all' || (periodFilter === 'month' && sameMonth) || (periodFilter === 'year' && sameYear)
      const categoryOk = !categoryFilter || expense.category === categoryFilter
      const queryOk = !q
        || expense.description?.toLowerCase().includes(q)
        || expense.category?.toLowerCase().includes(q)
        || expense.reference?.toLowerCase().includes(q)
      return periodOk && categoryOk && queryOk
    })
  }, [expenses, query, categoryFilter, periodFilter])

  const metrics = useMemo(() => {
    const total = filteredExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const monthTotal = expenses
      .filter(item => {
        const d = new Date(item.date)
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      })
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const average = filteredExpenses.length ? total / filteredExpenses.length : 0
    const byCategory = categories.map(category => {
      const amount = filteredExpenses.filter(item => item.category === category).reduce((sum, item) => sum + Number(item.amount || 0), 0)
      return { category, amount }
    }).filter(item => item.amount > 0).sort((a, b) => b.amount - a.amount)
    return { total, monthTotal, average, byCategory }
  }, [expenses, filteredExpenses, categories])

  const openCreate = () => {
    setForm({ ...EMPTY, category: categories[0] || 'Autre', payment_method: paymentModes[0].value, date: new Date().toISOString().slice(0, 16) })
    setSelected(null)
    setModal('form')
  }

  const openEdit = (expense) => {
    setForm({ ...expense, payment_method: paymentModeValue(expense.payment_method), date: expense.date?.slice(0, 16) || '' })
    setSelected(expense)
    setModal('form')
  }

  const handleSave = async () => {
    if (!form.description?.trim()) return toast.error('La description est obligatoire')
    if (!Number(form.amount)) return toast.error('Le montant est obligatoire')
    setSaving(true)
    try {
      const payload = { ...form, amount: Number(form.amount) }
      if (!selected) {
        await api.post('/expenses', payload, { headers: idempotencyHeaders() })
        toast.success('Dépense créée')
      } else {
        await api.put(`/expenses/${selected.id}`, payload, { headers: idempotencyHeaders() })
        toast.success('Dépense mise à jour')
      }
      setModal(null)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (expense) => {
    const ok = await confirm({
      title: 'Supprimer dépense',
      message: `Supprimer cette dépense de ${fmt(expense.amount)} MAD ?`,
      confirmText: 'Supprimer',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/expenses/${expense.id}`, { headers: idempotencyHeaders() })
      toast.success('Dépense supprimée')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Suppression impossible')
    }
  }

  const F = key => ({ value: form[key] ?? '', onChange: e => setForm(current => ({ ...current, [key]: e.target.value })) })
  const openCatalogSettings = () => navigate('/settings?tab=catalog')

  return (
    <div className="page-content expenses-page">
      <div className="page-header expenses-header">
        <div>
          <h1 className="page-title">Dépenses</h1>
          <p>Suivi des charges, catégories et modes de paiement.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Nouvelle dépense</button>
      </div>

      <section className="expenses-kpis">
        <ExpenseKpi icon={TrendingDown} tone="danger" label="Total filtré" value={`${fmt(metrics.total)} MAD`} sub={`${filteredExpenses.length} ligne(s)`} />
        <ExpenseKpi icon={CalendarDays} tone="warning" label="Ce mois" value={`${fmt(metrics.monthTotal)} MAD`} sub={now.toLocaleDateString('fr-MA', { month: 'long', year: 'numeric' })} />
        <ExpenseKpi icon={WalletCards} tone="success" label="Moyenne" value={`${fmt(metrics.average)} MAD`} sub="Par dépense filtrée" />
        <ExpenseKpi icon={ReceiptText} tone="accent" label="Catégories" value={metrics.byCategory.length} sub="Avec mouvement" />
      </section>

      <section className="expenses-layout">
        <aside className="expenses-sidebar">
          <div className="expenses-filter-card">
            <div className="expenses-filter-title"><Filter size={16} /> Filtres</div>
            <div className="search-wrap">
              <Search size={15} className="search-icon" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Recherche description, référence..." />
            </div>
            <select value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}>
              <option value="all">Toutes périodes</option>
              <option value="month">Ce mois</option>
              <option value="year">Cette année</option>
            </select>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="">Toutes catégories</option>
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
            <button className="btn btn-sm reference-action-btn" onClick={openCatalogSettings}>
              <Plus size={14} /> Gérer référentiels
            </button>
          </div>

          <div className="expenses-category-card">
            <strong>Répartition</strong>
            {metrics.byCategory.length === 0 ? (
              <span className="text-muted text-sm">Aucune dépense dans ce filtre.</span>
            ) : metrics.byCategory.slice(0, 8).map(item => {
              const pct = metrics.total ? Math.round((item.amount / metrics.total) * 100) : 0
              return (
                <div className="expense-category-row" key={item.category}>
                  <div><span>{item.category}</span><em>{pct}%</em></div>
                  <i><b style={{ width: `${Math.max(4, pct)}%` }} /></i>
                  <strong>{fmt(item.amount)} MAD</strong>
                </div>
              )
            })}
          </div>
        </aside>

        <section className="card expenses-table-card">
          <div className="expenses-table-head">
            <div>
              <strong>Historique des dépenses</strong>
              <span>{filteredExpenses.length} résultat(s)</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Catégorie</th><th>Description</th><th>Montant</th><th>Paiement</th><th>Réf.</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ margin: 'auto' }} /></td></tr>
                ) : filteredExpenses.length === 0 ? (
                  <tr><td colSpan={7}><div className="empty-state"><TrendingDown size={40} /><p>Aucune dépense</p></div></td></tr>
                ) : filteredExpenses.map(expense => (
                  <tr key={expense.id}>
                    <td className="text-muted text-sm">{fmtDate(expense.date)}</td>
                    <td><span className="badge badge-info">{expense.category}</span></td>
                    <td><strong>{expense.description}</strong>{expense.notes && <div className="text-muted text-sm">{expense.notes}</div>}</td>
                    <td className="font-semibold text-danger">{fmt(expense.amount)} MAD</td>
                    <td>{expense.payment_method}</td>
                    <td className="text-muted text-sm">{expense.reference || '—'}</td>
                    <td>
                      <div className="flex gap-2">
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(expense)}><Edit2 size={14} /></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(expense)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {modal === 'form' && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-header"><h2>{!selected ? 'Nouvelle dépense' : 'Modifier dépense'}</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>x</button></div>
            <div className="modal-body">
              <div className="form-grid form-grid-2" style={{ gap: '1rem' }}>
                <div className="form-group"><label className="form-label">Date</label><input type="datetime-local" {...F('date')} /></div>
                <div className="form-group">
                  <label className="form-label">Catégorie</label>
                  <select {...F('category')}>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
                  <button type="button" className="btn btn-sm reference-action-btn" onClick={openCatalogSettings}><Plus size={14} /> Gérer catégories</button>
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}><label className="form-label">Description *</label><input {...F('description')} placeholder="Description de la dépense" /></div>
                <div className="form-group"><label className="form-label">Montant (MAD) *</label><input type="number" min="0" step="0.01" {...F('amount')} /></div>
                <div className="form-group">
                  <label className="form-label">Mode paiement</label>
                  <select {...F('payment_method')}>{paymentModes.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select>
                  <button type="button" className="btn btn-sm reference-action-btn" onClick={openCatalogSettings}><Plus size={14} /> Gérer paiements</button>
                </div>
                <div className="form-group"><label className="form-label">Référence</label><input {...F('reference')} placeholder="N° reçu, facture..." /></div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}><label className="form-label">Notes</label><textarea {...F('notes')} rows={2} /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : null}{!selected ? 'Créer' : 'Enregistrer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ExpenseKpi({ icon: Icon, tone, label, value, sub }) {
  return (
    <div className={`expense-kpi ${tone}`}>
      <span><Icon size={18} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{sub}</em>
      </div>
    </div>
  )
}
