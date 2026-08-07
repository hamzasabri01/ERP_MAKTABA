// src/pages/ReportsPage.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BarChart2, Boxes, CalendarDays, Clock3, Download, FileSpreadsheet,
  FileText, PackageX, PieChart as PieIcon, RefreshCw, ShoppingCart,
  TrendingDown, TrendingUp, Wallet, X, Check
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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [detailCard, setDetailCard] = useState(null)

  const loadOverview = async (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const params = { period }
      if (period === 'custom') {
        params.start_date = startDate
        params.end_date = endDate
      }
      const res = await api.get('/reports/overview', { params })
      setOverview(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Impossible de charger les rapports. Verifiez la connexion API.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (period !== 'custom') loadOverview()
  }, [period])

  const selectPeriod = nextPeriod => {
    if (nextPeriod === 'custom') {
      const fallbackEnd = new Date()
      const fallbackStart = new Date(fallbackEnd.getFullYear(), fallbackEnd.getMonth(), 1)
      setStartDate(overview?.period?.start || fallbackStart.toISOString().slice(0, 10))
      setEndDate(overview?.period?.end || fallbackEnd.toISOString().slice(0, 10))
    }
    setPeriod(nextPeriod)
  }

  const customRangeValid = Boolean(startDate && endDate && startDate <= endDate)
  const customRangeApplied = period === 'custom' && overview?.period?.start === startDate && overview?.period?.end === endDate

  const summary = overview?.summary || {}
  const trend = overview?.trend || {}
  const cash = overview?.cash || {}
  const stock = overview?.stock || { products: [] }
  const categories = overview?.categories || []
  const timeseries = overview?.timeseries || []
  const topItems = overview?.top_items || []
  const reportUsers = overview?.users || []
  const dormantProducts = overview?.dormant_products || []
  const hourlyPerformance = overview?.hourly_performance || []
  const comparisons = overview?.comparisons || {}

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
    { label: "Chiffre d'affaires", value: fmt(summary.revenue), suffix: 'MAD', icon: TrendingUp, tone: 'blue', trend: trend.revenue, detail: `Période précédente : ${fmt(overview?.previous?.revenue)} MAD` },
    { label: 'Bénéfice réel', value: fmt(summary.net_profit), suffix: 'MAD', icon: Wallet, tone: (summary.net_profit || 0) >= 0 ? 'green' : 'red', trend: trend.net_profit, detail: `Marge brute ${fmt(summary.gross_profit)} MAD − dépenses ${fmt(summary.expenses)} MAD` },
    { label: 'Reste à encaisser', value: fmt(summary.unpaid), suffix: 'MAD', icon: AlertTriangle, tone: (summary.unpaid || 0) > 0 ? 'orange' : 'green', detail: `Encaissé : ${fmt(summary.paid)} MAD sur ${fmt(summary.revenue)} MAD` },
    { label: 'Valeur stock', value: fmt(stock.total_value), suffix: 'MAD', icon: Boxes, tone: 'purple', sub: `${stock.low_stock_count || 0} stock faible`, detail: `${stock.products?.length || 0} produits valorisés` },
  ]

  const exportExcel = () => {
    if (!overview) return
    const rows = [
      ['Indicateur', 'Valeur'],
      ["Chiffre d'affaires", summary.revenue],
      ['Coût des ventes', summary.cogs],
      ['Dépenses', summary.expenses],
      ['Bénéfice réel', summary.net_profit],
      [],
      ['Produit / service', 'Type', 'Quantité', 'CA', 'Bénéfice brut'],
      ...topItems.map(item => [item.name, item.product_type, item.quantity, item.revenue, item.gross_profit]),
      [],
      ['Utilisateur', 'Nombre de factures', "Chiffre d'affaires", 'Montant encaissé'],
      ...reportUsers.map(item => [item.user_name, item.invoice_count, item.revenue, item.paid]),
    ]
    const xmlEscape = value => String(value ?? '').replace(/[<>&'"]/g, char => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
    })[char])
    const worksheet = rows.map(row => `<Row>${row.map(value => {
      const numeric = value !== '' && value != null && Number.isFinite(Number(value))
      return `<Cell><Data ss:Type="${numeric ? 'Number' : 'String'}">${xmlEscape(value)}</Data></Cell>`
    }).join('')}</Row>`).join('')
    const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Rapport"><Table>${worksheet}</Table></Worksheet></Workbook>`
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' }))
    link.download = `rapport-${overview.period.start}-${overview.period.end}.xls`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const exportPdf = async () => {
    if (!overview) return
    const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF()
    doc.setFontSize(18)
    doc.setTextColor(25, 73, 150)
    doc.text('LIBRARY SABRI - Rapport', 14, 18)
    doc.setFontSize(10)
    doc.setTextColor(80)
    doc.text(`Periode : ${overview.period.start} au ${overview.period.end}`, 14, 26)
    autoTable(doc, {
      startY: 33,
      head: [['Indicateur', 'Valeur MAD']],
      body: [
        ["Chiffre d'affaires", fmt(summary.revenue)],
        ['Cout des ventes', fmt(summary.cogs)],
        ['Depenses', fmt(summary.expenses)],
        ['Benefice reel', fmt(summary.net_profit)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [35, 105, 220] },
    })
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 10,
      head: [['Produit / service', 'Type', 'Qte', 'CA', 'Benefice']],
      body: topItems.map(item => [item.name, item.product_type, fmt(item.quantity, 2), fmt(item.revenue), fmt(item.gross_profit)]),
      theme: 'striped',
      headStyles: { fillColor: [20, 158, 120] },
    })
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 10,
      head: [['Utilisateur', 'Factures', 'CA', 'Encaisse']],
      body: reportUsers.map(item => [item.user_name, item.invoice_count, fmt(item.revenue), fmt(item.paid)]),
      theme: 'striped',
      headStyles: { fillColor: [124, 58, 237] },
    })
    doc.save(`rapport-${overview.period.start}-${overview.period.end}.pdf`)
  }

  return (
    <div className="page-content reports-page">
      <section className="reports-hero">
        <div>
          <span className="reports-eyebrow"><CalendarDays size={15} /> Analyse financiere</span>
          <h1>Rapports & tableau de bord</h1>
          <p>{overview ? `Periode: ${overview.period.start} - ${overview.period.end}` : 'Lecture des indicateurs en cours'}</p>
        </div>
        <div className={`reports-actions ${period === 'custom' ? 'is-custom' : ''}`}>
          <div className="reports-controls-row">
            <div className="reports-segmented">
              {PERIODS.map(([id, label]) => (
                <button key={id} className={period === id ? 'active' : ''} onClick={() => selectPeriod(id)}>{label}</button>
              ))}
              <button className={period === 'custom' ? 'active' : ''} onClick={() => selectPeriod('custom')}>Personnalisé</button>
            </div>
            <div className="reports-export-actions">
              <button className="btn btn-secondary" onClick={exportPdf} disabled={!overview}><FileText size={16} /> PDF</button>
              <button className="btn btn-secondary" onClick={exportExcel} disabled={!overview}><FileSpreadsheet size={16} /> Excel</button>
              <button className="btn btn-secondary" onClick={() => loadOverview(true)} disabled={refreshing}>
                <RefreshCw size={16} className={refreshing ? 'spin-icon' : ''} /> Actualiser
              </button>
            </div>
          </div>
          {period === 'custom' && <div className="reports-date-filter" role="group" aria-label="Periode personnalisee">
            <span className="reports-date-filter-icon"><CalendarDays size={20}/></span>
            <label><span>Date de debut</span><input type="date" value={startDate} max={endDate || undefined} onChange={e => setStartDate(e.target.value)} /></label>
            <span className="reports-date-arrow">→</span>
            <label><span>Date de fin</span><input type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} /></label>
            <button className={`btn btn-primary reports-apply-range ${customRangeApplied ? 'is-applied' : ''}`} disabled={!customRangeValid || customRangeApplied || loading} onClick={() => loadOverview()}>{customRangeApplied ? <Check size={16}/> : <CalendarDays size={16}/>} {customRangeApplied ? 'Appliquée' : 'Appliquer'}</button>
          </div>}
        </div>
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? <ReportsSkeleton /> : (
        <>
          <section className="reports-kpis">
            {cards.map(card => <ReportCard key={card.label} {...card} onClick={() => setDetailCard(card)} />)}
          </section>

          <section className="reports-tabs">
            {[
              ['overview', 'Vue generale'],
              ['categories', 'Categories'],
              ['stock', 'Stock'],
              ['cash', 'Caisse'],
              ['performance', 'Performance horaire'],
              ['products', 'Produits & services'],
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

          {activeTab === 'performance' && (
            <div className="reports-grid">
              <Panel title="Performance par heure" subtitle="Repérez les heures de pointe">
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={hourlyPerformance}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="hour" tick={{ fill: 'var(--text3)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} tickFormatter={compactMoney} />
                    <Tooltip content={<ReportTooltip />} />
                    <Bar dataKey="revenue" name="CA" fill="#4f8ef7" radius={[7, 7, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Comparaisons rapides" subtitle="Aujourd'hui et mois en cours">
                <div className="comparison-list">
                  <Comparison label="Aujourd'hui / hier" value={comparisons.today_vs_yesterday?.revenue} amount={comparisons.today?.revenue} />
                  <Comparison label="Ventes aujourd'hui / hier" value={comparisons.today_vs_yesterday?.sale_count} amount={comparisons.today?.sale_count} money={false} />
                  <Comparison label="Mois / mois précédent" value={comparisons.month_vs_previous?.revenue} amount={comparisons.month?.revenue} />
                  <Comparison label="Bénéfice / mois précédent" value={comparisons.month_vs_previous?.net_profit} amount={comparisons.month?.net_profit} />
                </div>
              </Panel>
            </div>
          )}

          {activeTab === 'products' && (
            <div className="reports-stock-grid">
              <Panel title="Meilleures ventes" subtitle="Produits et services">
                <div className="analytics-table">
                  {topItems.map((item, index) => <div key={`${item.product_id}-${index}`}>
                    <b>{index + 1}</b><span><strong>{item.name}</strong><small>{item.product_type === 'service' ? 'Service' : 'Produit'}</small></span>
                    <em>{fmt(item.quantity, 2)} · {fmt(item.revenue)} MAD</em>
                  </div>)}
                  {!topItems.length && <Empty text="Aucune vente sur la période" icon={ShoppingCart} />}
                </div>
              </Panel>
              <Panel title="Produits dormants" subtitle="Aucune vente depuis au moins 60 jours">
                <div className="analytics-table dormant">
                  {dormantProducts.map(item => <div key={item.product_id}>
                    <PackageX size={17} /><span><strong>{item.name}</strong><small>{item.last_sale_at ? `${item.inactive_days} jours sans vente` : 'Jamais vendu'}</small></span>
                    <em>{fmt(item.stock, 2)} · {fmt(item.stock_value)} MAD</em>
                  </div>)}
                  {!dormantProducts.length && <Empty text="Aucun produit dormant" icon={PackageX} />}
                </div>
              </Panel>
            </div>
          )}
        </>
      )}

      {detailCard && <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDetailCard(null)}>
        <div className="modal report-detail-modal">
          <div className="modal-header"><h2>{detailCard.label}</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={() => setDetailCard(null)}><X size={17} /></button></div>
          <div className="modal-body">
            <detailCard.icon size={34} />
            <strong>{detailCard.value} {detailCard.suffix}</strong>
            <p>{detailCard.detail}</p>
            {typeof detailCard.trend === 'number' && <span className={detailCard.trend >= 0 ? 'text-success' : 'text-danger'}>{detailCard.trend >= 0 ? '+' : ''}{fmt(detailCard.trend, 1)}% par rapport à la période précédente</span>}
          </div>
        </div>
      </div>}
    </div>
  )
}

function ReportCard({ label, value, suffix, icon: Icon, tone, trend, sub, onClick }) {
  const trendValue = typeof trend === 'number' ? trend : null
  return (
    <article className={`report-card ${tone}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onClick?.()}>
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

function Comparison({ label, value, amount, money = true }) {
  const variation = Number(value || 0)
  return <div className="comparison-row">
    <span><small>{label}</small><strong>{money ? `${fmt(amount)} MAD` : fmt(amount, 0)}</strong></span>
    <em className={variation >= 0 ? 'up' : 'down'}>{variation >= 0 ? '+' : ''}{fmt(variation, 1)}%</em>
  </div>
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
