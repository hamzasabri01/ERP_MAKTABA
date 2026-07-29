// src/pages/Dashboard.jsx
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, ArrowRight, CalendarDays, Clock, RefreshCw, ShoppingCart,
  TrendingDown, TrendingUp, Users, Wallet
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { api, fmt, fmtDate } from '../lib/api'
import { useI18n } from '../lib/i18n'
import './Dashboard.css'

const CHART_COLORS = ['#4f8ef7', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

const statusBadge = (s, t) => {
  const label = t(`status.${s}`) || s
  return <span className={`badge badge-${s}`}>{label}</span>
}

export default function Dashboard() {
  const { t, locale, formatMoney, formatNumber } = useI18n()
  const [kpis, setKpis] = useState(null)
  const [chart, setChart] = useState([])
  const [topProd, setTop] = useState([])
  const [recent, setRecent] = useState([])
  const [alerts, setAlerts] = useState([])
  const [comparisons, setComparisons] = useState({})
  const [period, setPeriod] = useState('month')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadOverview = async (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true)
    try {
      const [kpiRes, topRes, recentRes, alertsRes, reportRes] = await Promise.all([
        api.get('/dashboard/kpis'),
        api.get('/dashboard/top-products'),
        api.get('/dashboard/recent-sales'),
        api.get('/dashboard/stock-alerts'),
        api.get('/reports/overview?period=monthly'),
      ])
      setKpis(kpiRes.data)
      setTop(topRes.data)
      setRecent(recentRes.data)
      setAlerts(alertsRes.data)
      setComparisons(reportRes.data?.comparisons || {})
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { loadOverview() }, [])

  useEffect(() => {
    api.get(`/dashboard/revenue-chart?period=${period}`).then(r => setChart(r.data))
  }, [period])

  const K = kpis || {}
  const health = useMemo(() => {
    const revenue = Number(K.month_revenue || 0)
    const profit = Number(K.month_profit || 0)
    const pending = Number(K.pending_amount || 0)
    const profitRate = revenue > 0 ? (profit / revenue) * 100 : 0
    const collectionRate = revenue > 0 ? Math.max(0, Math.min(100, ((revenue - pending) / revenue) * 100)) : 100
    return { profitRate, collectionRate }
  }, [K])

  const quickStats = [
    { label: t('dashboard.netMargin'), value: `${formatNumber(health.profitRate, 1)}%`, tone: health.profitRate >= 0 ? 'good' : 'bad', icon: health.profitRate >= 0 ? TrendingUp : TrendingDown },
    { label: t('dashboard.collectionRate'), value: `${formatNumber(health.collectionRate, 1)}%`, tone: health.collectionRate >= 80 ? 'good' : 'warn', icon: Wallet },
    { label: 'Caisse', value: K.cash_is_open ? formatMoney(K.cash_balance) : 'Fermée', tone: K.cash_is_open ? 'good' : 'warn', icon: Wallet },
    { label: t('dashboard.stockAlerts'), value: K.low_stock_count || 0, tone: (K.low_stock_count || 0) > 0 ? 'warn' : 'good', icon: AlertCircle },
  ]

  return (
    <div className="page-content dashboard-page">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-eyebrow">{t('dashboard.eyebrow')}</span>
          <h1>{t('dashboard.title')}</h1>
          <p><CalendarDays size={17} /> {new Date().toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="dashboard-school-art" aria-hidden="true">
          <span className="school-pencil" />
          <span className="school-ruler" />
          <span className="school-paperclip">⌇</span>
          <span className="school-spark school-spark-one">✦</span>
          <span className="school-spark school-spark-two">✧</span>
          <span className="school-notebook" />
        </div>
        <div className="dashboard-hero-actions">
          <Link className="btn btn-secondary" to="/reports">{t('nav.reports')} <ArrowRight size={16} /></Link>
          <button className="btn btn-primary" onClick={() => loadOverview(true)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'spin-icon' : ''} />
            {t('dashboard.refresh')}
          </button>
        </div>
      </section>

      <section className="dashboard-command">
        <div className="command-primary">
          <div className="command-icon"><TrendingUp size={20} /></div>
          <div><span>{t('dashboard.thisMonthRevenue')}</span>
            <strong>{formatMoney(K.month_revenue)}</strong>
            <small>{t('dashboard.today')}: {formatMoney(K.today_revenue)}</small>
          </div>
        </div>
        {quickStats.map(item => (
          <div className={`command-stat ${item.tone}`} key={item.label}>
            <div className="command-icon"><item.icon size={19} /></div>
            <div><span>{item.label}</span><strong>{item.value}</strong></div>
          </div>
        ))}
      </section>

      <section className="dashboard-kpis">
        {loading ? Array.from({ length: 9 }).map((_, i) => <KpiSkeleton key={i} />) : (
          <>
            <KpiCard color="blue" icon={TrendingUp} label={t('dashboard.thisMonthRevenue')} value={formatMoney(K.month_revenue)} sub={`${formatNumber(comparisons.month_vs_previous?.revenue || 0, 1)}% vs mois précédent`} link="/reports" />
            <KpiCard color="green" icon={Wallet} label={t('dashboard.netProfit')} value={formatMoney(K.month_profit)} sub={`${formatNumber(comparisons.month_vs_previous?.net_profit || 0, 1)}% vs mois précédent`} trend={health.profitRate >= 0 ? 'up' : 'down'} t={t} link="/reports" />
            <KpiCard color="orange" icon={Clock} label={t('dashboard.unpaidInvoices')} value={K.pending_invoices || 0} sub={`${formatMoney(K.pending_amount)} ${t('dashboard.pending')}`} link="/sales" />
            <KpiCard color="red" icon={TrendingDown} label={t('dashboard.expenses')} value={formatMoney(K.month_expenses)} sub={t('dashboard.thisMonth')} link="/reports" />
            <KpiCard color="green" icon={Wallet} label="Caisse" value={K.cash_is_open ? formatMoney(K.cash_balance) : 'Fermée'} sub={K.cash_is_open ? `Entrées ${formatMoney(K.cash_total_in)} - Sorties ${formatMoney(K.cash_total_out)}` : 'Aucune session ouverte'} link="/cash" />
            <KpiCard color="purple" icon={Users} label={t('dashboard.activeClients')} value={K.total_clients || 0} sub={t('dashboard.total')} link="/clients" />
            <KpiCard color="orange" icon={AlertCircle} label={t('dashboard.lowStock')} value={K.low_stock_count || 0} sub={t('dashboard.productsToWatch')} link="/stock?low=1" />
            <KpiCard color="blue" icon={ShoppingCart} label={t('dashboard.monthInvoices')} value={K.month_invoice_count || 0} sub={t('dashboard.totalCount')} link="/sales" />
          </>
        )}
      </section>

      <section className="dashboard-main-grid">
        <div className="dashboard-panel revenue-panel">
          <PanelHeader title={t('dashboard.revenueEvolution')} action={
            <div className="segmented">
              {['month', 'year'].map(p => (
                <button key={p} onClick={() => setPeriod(p)} className={period === p ? 'active' : ''}>
                  {p === 'month' ? t('dashboard.last30Days') : t('dashboard.last12Months')}
                </button>
              ))}
            </div>
          } />
          <ResponsiveContainer width="100%" height={275}>
            <AreaChart data={chart} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.38} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: 'var(--text3)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} />
              <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
              <Tooltip content={<ChartTooltip formatMoney={formatMoney} />} />
              <Area type="monotone" dataKey="revenue" stroke="var(--accent)" strokeWidth={3} fill="url(#revenueFill)" activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="dashboard-panel">
          <PanelHeader title={t('dashboard.topProducts')} subtitle={t('dashboard.thisMonth')} />
          <div className="top-products">
            {topProd.slice(0, 7).map((p, i) => {
              const max = Math.max(...topProd.map(x => Number(x.revenue || 0)), 1)
              const width = Math.max(8, (Number(p.revenue || 0) / max) * 100)
              return (
                <div className="top-product" key={p.product_id || i}>
                  <span className="rank">{i + 1}</span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>{t('dashboard.quantity')}: {formatNumber(p.qty, 0)}</small>
                    <i style={{ width: `${width}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  </div>
                  <em>{formatMoney(p.revenue)}</em>
                </div>
              )
            })}
            {topProd.length === 0 && <EmptyMini text={t('dashboard.noSalesMonth')} />}
          </div>
        </div>
      </section>

      <section className="dashboard-bottom-grid">
        <div className="dashboard-panel recent-panel">
          <PanelHeader title={t('dashboard.recentSales')} action={<Link to="/sales">{t('dashboard.seeAll')} <ArrowRight size={14} /></Link>} />
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('dashboard.number')}</th><th>{t('dashboard.client')}</th><th>{t('dashboard.date')}</th><th>{t('dashboard.amount')}</th><th>{t('dashboard.status')}</th></tr></thead>
              <tbody>
                {recent.map(s => (
                  <tr key={s.id}>
                    <td><span className="font-mono text-sm">{s.number}</span></td>
                    <td>{s.client_name}</td>
                    <td className="text-muted text-sm">{fmtDate(s.date)}</td>
                    <td><strong>{formatMoney(s.total)}</strong></td>
                    <td>{statusBadge(s.status, t)}</td>
                  </tr>
                ))}
                {recent.length === 0 && <tr><td colSpan={5}><EmptyMini text={t('dashboard.noRecentSales')} /></td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dashboard-panel alerts-panel">
          <PanelHeader title={t('dashboard.stockAlerts')} action={<Link to="/stock">{t('dashboard.seeAll')}</Link>} />
          <div className="stock-alert-list">
            {alerts.slice(0, 8).map(p => (
              <Link className="stock-alert" to="/stock" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small>{t('dashboard.min')}: {p.min_stock} {p.unit}</small>
                </div>
                <span className="badge badge-warning">{p.stock} {p.unit}</span>
              </Link>
            ))}
            {alerts.length === 0 && <EmptyMini text={t('dashboard.stockOk')} />}
          </div>
        </div>
      </section>
    </div>
  )
}

function PanelHeader({ title, subtitle, action }) {
  return (
    <div className="panel-header">
      <div>
        <h3>{title}</h3>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {action}
    </div>
  )
}

function KpiCard({ color, icon: Icon, label, value, sub, link, trend, t }) {
  const inner = (
    <div className={`dash-kpi ${color}`}>
      <div className="dash-kpi-top">
        <span><Icon size={18} /></span>
        {trend && <em className={trend}>{trend === 'up' ? t('status.stable') : t('status.risk')}</em>}
      </div>
      <strong>{value}</strong>
      <p>{label}</p>
      {sub && <small>{sub}</small>}
      <div className="dash-kpi-visual" aria-hidden="true">
        <Icon size={62} strokeWidth={1.25} />
        <svg viewBox="0 0 130 44" preserveAspectRatio="none">
          <path d="M0 39 C16 34, 20 19, 34 27 S52 38, 64 22 S82 31, 94 14 S111 28, 130 5" />
        </svg>
      </div>
    </div>
  )
  return link ? <Link className="dash-kpi-link" to={link}>{inner}</Link> : inner
}

function KpiSkeleton() {
  return <div className="dash-kpi skeleton"><span /><strong /><p /><small /></div>
}

function ChartTooltip({ active, payload, label, formatMoney }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <span>{label}</span>
      <strong>{formatMoney(payload[0].value)}</strong>
    </div>
  )
}

function EmptyMini({ text }) {
  return <div className="empty-mini">{text}</div>
}
