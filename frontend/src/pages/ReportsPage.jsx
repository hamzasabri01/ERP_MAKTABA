// src/pages/ReportsPage.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BarChart2, Boxes, CalendarDays, Download, PieChart as PieIcon,
  RefreshCw, ShoppingCart, TrendingDown, TrendingUp, Wallet
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie,
  PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { api, fmt } from '../lib/api'
import './ReportsPage.css'

const COLORS = ['#4f8ef7', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6']
const PERIODS = [
  ['daily', 'Aujourd hui'],
  ['weekly', 'Semaine'],
  ['monthly', 'Mois'],
  ['yearly', 'Annee'],
]

export default function ReportsPage() {
  const [overview, setOverview] = useState(null)
  const [period, setPeriod] = useState('monthly')
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadOverview = async (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const res = await api.get(`/reports/overview?period=${period}`)
      setOverview(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Impossible de charger les rapports. Verifiez la connexion API.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { loadOverview() }, [period])

  const summary = overview?.summary || {}
  const trend = overview?.trend || {}
  const cash = overview?.cash || {}
  const stock = overview?.stock || { products: [] }
  const categories = overview?.categories || []
  const timeseries = overview?.timeseries || []

  const pnlData = useMemo(() => ([
    { name: 'CA', value: summary.revenue || 0, color: '#4f8ef7' },
    { name: 'Cout', value: summary.cogs || 0, color: '#ef4444' },
    { name: 'Depenses', value: summary.expenses || 0, color: '#f59e0b' },
    { name: 'Benefice', value: summary.net_profit || 0, color: (summary.net_profit || 0) >= 0 ? '#22c55e' : '#ef4444' },
  ]), [summary])

  const cashData = [
    { name: 'Entrees', value: cash.cash_in || 0, color: '#22c55e' },
    { name: 'Sorties', value: cash.cash_out || 0, color: '#ef4444' },
    { name: 'Net', value: cash.net_cash || 0, color: (cash.net_cash || 0) >= 0 ? '#4f8ef7' : '#f59e0b' },
  ]

  const categoryTotal = categories.reduce((acc, item) => acc + Number(item.total || 0), 0)
  const topProducts = (stock.products || []).slice(0, 8)
  const lowProducts = (stock.products || []).filter(p => p.is_low).slice(0, 6)

  const cards = [
    { label: "Chiffre d'affaires", value: fmt(summary.revenue), suffix: 'MAD', icon: TrendingUp, tone: 'blue', trend: trend.revenue },
    { label: 'Benefice net', value: fmt(summary.net_profit), suffix: 'MAD', icon: Wallet, tone: (summary.net_profit || 0) >= 0 ? 'green' : 'red', trend: trend.net_profit },
    { label: 'Reste a encaisser', value: fmt(summary.unpaid), suffix: 'MAD', icon: AlertTriangle, tone: (summary.unpaid || 0) > 0 ? 'orange' : 'green' },
    { label: 'Valeur stock', value: fmt(stock.total_value), suffix: 'MAD', icon: Boxes, tone: 'purple', sub: `${stock.low_stock_count || 0} stock faible` },
  ]

  return (
    <div className="page-content reports-page">
      <section className="reports-hero">
        <div>
          <span className="reports-eyebrow"><CalendarDays size={15} /> Analyse financiere</span>
          <h1>Rapports & tableau de bord</h1>
          <p>{overview ? `Periode: ${overview.period.start} - ${overview.period.end}` : 'Lecture des indicateurs en cours'}</p>
        </div>
        <div className="reports-actions">
          <div className="reports-segmented">
            {PERIODS.map(([id, label]) => (
              <button key={id} className={period === id ? 'active' : ''} onClick={() => setPeriod(id)}>{label}</button>
            ))}
          </div>
          <button className="btn btn-secondary" onClick={() => loadOverview(true)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'spin-icon' : ''} />
            Actualiser
          </button>
        </div>
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? <ReportsSkeleton /> : (
        <>
          <section className="reports-kpis">
            {cards.map(card => <ReportCard key={card.label} {...card} />)}
          </section>

          <section className="reports-tabs">
            {[
              ['overview', 'Vue generale'],
              ['categories', 'Categories'],
              ['stock', 'Stock'],
              ['cash', 'Caisse'],
            ].map(([id, label]) => (
              <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>{label}</button>
            ))}
          </section>

          {activeTab === 'overview' && (
            <div className="reports-grid">
              <Panel title="Evolution" subtitle="Ventes, achats et depenses">
                <ResponsiveContainer width="100%" height={310}>
                  <AreaChart data={timeseries} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="reportRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f8ef7" stopOpacity={0.34} />
                        <stop offset="95%" stopColor="#4f8ef7" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="period" tick={{ fill: 'var(--text3)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} />
                    <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={compactMoney} />
                    <Tooltip content={<ReportTooltip />} />
                    <Legend wrapperStyle={{ color: 'var(--text2)', fontSize: 12 }} />
                    <Area type="monotone" dataKey="revenue" name="CA" stroke="#4f8ef7" strokeWidth={3} fill="url(#reportRevenue)" />
                    <Area type="monotone" dataKey="expenses" name="Depenses" stroke="#f59e0b" strokeWidth={2} fill="transparent" />
                    <Area type="monotone" dataKey="purchases" name="Achats" stroke="#8b5cf6" strokeWidth={2} fill="transparent" />
                  </AreaChart>
                </ResponsiveContainer>
              </Panel>

              <Panel title="P&L" subtitle={`Marge brute ${fmt(summary.margin_pct, 1)}%`}>
                <ResponsiveContainer width="100%" height={310}>
                  <BarChart data={pnlData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text3)', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={compactMoney} />
                    <Tooltip content={<SingleTooltip />} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {pnlData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>

              <section className="reports-strip">
                <MiniMetric label="Ventes" value={summary.sale_count || 0} icon={ShoppingCart} />
                <MiniMetric label="Achats" value={summary.purchase_count || 0} icon={Download} />
                <MiniMetric label="Encaisse" value={`${fmt(summary.paid)} MAD`} icon={Wallet} />
                <MiniMetric label="Depenses" value={`${fmt(summary.expenses)} MAD`} icon={TrendingDown} />
              </section>
            </div>
          )}

          {activeTab === 'categories' && (
            <div className="reports-category-grid">
              <Panel title="Ventes par categorie" subtitle={`${categories.length} categories`}>
                {categories.length === 0 ? <Empty text="Aucune vente dans cette periode" icon={PieIcon} /> : (
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <Pie data={categories} dataKey="total" nameKey="category" innerRadius="54%" outerRadius="76%" paddingAngle={2}>
                        {categories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<CategoryTooltip total={categoryTotal} />} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </Panel>

              <Panel title="Classement categories" subtitle="Contribution au chiffre d'affaires">
                <div className="category-list">
                  {categories.map((item, i) => {
                    const pct = categoryTotal > 0 ? (Number(item.total || 0) / categoryTotal) * 100 : 0
                    return (
                      <div className="category-row" key={item.category}>
                        <span style={{ background: COLORS[i % COLORS.length] }} />
                        <div>
                          <strong>{item.category}</strong>
                          <i><b style={{ width: `${Math.max(4, pct)}%`, background: COLORS[i % COLORS.length] }} /></i>
                        </div>
                        <em>{fmt(item.total)} MAD</em>
                      </div>
                    )
                  })}
                  {categories.length === 0 && <Empty text="Aucune donnee a afficher" icon={BarChart2} />}
                </div>
              </Panel>
            </div>
          )}

          {activeTab === 'stock' && (
            <div className="reports-stock-grid">
              <Panel title="Produits a surveiller" subtitle={`${stock.low_stock_count || 0} alertes`}>
                <div className="stock-warning-list">
                  {lowProducts.map(p => (
                    <div className="stock-warning" key={p.id}>
                      <div>
                        <strong>{p.name}</strong>
                        <small>{p.code} - min {p.min_stock}</small>
                      </div>
                      <span>{fmt(p.stock, 0)}</span>
                    </div>
                  ))}
                  {lowProducts.length === 0 && <Empty text="Aucune alerte stock" icon={Boxes} />}
                </div>
              </Panel>

              <Panel title="Valorisation stock" subtitle="Top produits par valeur">
                <div className="stock-table">
                  {topProducts.map(p => (
                    <div className="stock-row" key={p.id}>
                      <div>
                        <strong>{p.name}</strong>
                        <small>{p.category} - {p.code}</small>
                      </div>
                      <span>{fmt(p.stock, 0)}</span>
                      <em>{fmt(p.value)} MAD</em>
                    </div>
                  ))}
                  {topProducts.length === 0 && <Empty text="Aucun produit en stock" icon={Boxes} />}
                </div>
              </Panel>
            </div>
          )}

          {activeTab === 'cash' && (
            <div className="reports-cash-grid">
              {cashData.map(item => (
                <div className="cash-tile" key={item.name} style={{ '--cash-color': item.color }}>
                  <span>{item.name}</span>
                  <strong>{fmt(item.value)} MAD</strong>
                </div>
              ))}
              <Panel title="Mouvement caisse" subtitle="Entrees, sorties et net">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={cashData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text3)', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={compactMoney} />
                    <Tooltip content={<SingleTooltip />} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {cashData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ReportCard({ label, value, suffix, icon: Icon, tone, trend, sub }) {
  const trendValue = typeof trend === 'number' ? trend : null
  return (
    <article className={`report-card ${tone}`}>
      <div className="report-card-top">
        <span><Icon size={18} /></span>
        {trendValue !== null && <em className={trendValue >= 0 ? 'up' : 'down'}>{trendValue >= 0 ? '+' : ''}{fmt(trendValue, 1)}%</em>}
      </div>
      <strong>{value} {suffix}</strong>
      <p>{label}</p>
      {sub && <small>{sub}</small>}
    </article>
  )
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="report-panel">
      <div className="report-panel-header">
        <div>
          <h3>{title}</h3>
          {subtitle && <span>{subtitle}</span>}
        </div>
      </div>
      {children}
    </section>
  )
}

function MiniMetric({ label, value, icon: Icon }) {
  return (
    <div className="mini-metric">
      <span><Icon size={17} /></span>
      <div><strong>{value}</strong><small>{label}</small></div>
    </div>
  )
}

function ReportsSkeleton() {
  return (
    <>
      <section className="reports-kpis">{Array.from({ length: 4 }).map((_, i) => <div className="report-card skeleton" key={i} />)}</section>
      <div className="reports-grid">
        <div className="report-panel skeleton-panel" />
        <div className="report-panel skeleton-panel" />
      </div>
    </>
  )
}

function Empty({ text, icon: Icon }) {
  return <div className="reports-empty"><Icon size={34} /><span>{text}</span></div>
}

function ReportTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="report-tooltip">
      <span>{label}</span>
      {payload.map(item => <strong key={item.dataKey} style={{ color: item.stroke }}>{item.name}: {fmt(item.value)} MAD</strong>)}
    </div>
  )
}

function SingleTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return <div className="report-tooltip"><span>{label}</span><strong>{fmt(payload[0].value)} MAD</strong></div>
}

function CategoryTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const pct = total > 0 ? (Number(row.total || 0) / total) * 100 : 0
  return <div className="report-tooltip"><span>{row.category}</span><strong>{fmt(row.total)} MAD</strong><small>{fmt(pct, 1)}% du total</small></div>
}

function compactMoney(value) {
  const n = Number(value || 0)
  if (Math.abs(n) >= 1000000) return `${fmt(n / 1000000, 1)}M`
  if (Math.abs(n) >= 1000) return `${fmt(n / 1000, 0)}k`
  return fmt(n, 0)
}
