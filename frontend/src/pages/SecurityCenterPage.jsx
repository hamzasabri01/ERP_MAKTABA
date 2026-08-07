import { useEffect, useState } from 'react'
import {
  Activity, AlertTriangle, CheckCircle2, Fingerprint, KeyRound,
  RefreshCw, ShieldAlert, ShieldCheck, Users
} from 'lucide-react'
import { api, fmtDateTime } from '../lib/api'
import { useI18n } from '../lib/i18n'
import './SecurityCenterPage.css'

export default function SecurityCenterPage() {
  const { language, t, translate } = useI18n()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = async (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const res = await api.get('/security-center/overview')
      setData(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Impossible de charger le Security Center')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  const metrics = data?.metrics || {}
  const integrity = data?.integrity || {}
  const riskLevel = data?.risk_level || 'low'
  const localizeAlert = (alert) => {
    if (language !== 'ar') return alert
    const titles = {
      'Brute force possible': 'احتمال وجود هجوم تخمين',
      'Activite sensible elevee': 'ارتفاع العمليات الحساسة',
      'Integrite audit compromise': 'سلامة سجل التدقيق متضررة',
      'MFA non deploye': 'التحقق الثنائي غير مفعّل',
      'Etat stable': 'الحالة مستقرة',
    }
    let message = alert.message || ''
    message = message.replace(/^(\d+) tentatives echouees dans 24h$/i, '$1 محاولة فاشلة خلال 24 ساعة')
    message = message.replace(/^(\d+) actions critiques dans 24h$/i, '$1 عملية حساسة خلال 24 ساعة')
    message = message.replace(/^La chaine hash contient des incoherences$/i, 'تحتوي سلسلة التحقق على اختلافات')
    message = message.replace(/^Aucun utilisateur actif n'a active le deuxieme facteur$/i, 'لم يفعّل أي مستخدم نشط التحقق الثنائي')
    message = message.replace(/^Aucun signal critique detecte$/i, 'لم يتم اكتشاف أي مؤشر خطير')
    return { ...alert, title: titles[alert.title] || alert.title, message }
  }

  return (
    <div className="page-content security-page">
      <section className={`security-hero risk-${riskLevel}`}>
        <div>
          <span className="security-eyebrow"><ShieldCheck size={15} /> {t('security.eyebrow')}</span>
          <h1>{t('security.title')}</h1>
          <p>{t('security.subtitle')}</p>
        </div>
        <button className="btn btn-secondary" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? 'spin-icon' : ''} />
          {t('security.refresh')}
        </button>
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? <SecuritySkeleton /> : (
        <>
          <section className="security-overview">
            <div className={`risk-card risk-${riskLevel}`}>
              <div className="risk-ring"><strong>{data.risk_score}</strong><span>/100</span></div>
              <div>
                <span>{t('security.riskScore')}</span>
                <h3>{riskLevel === 'high' ? t('security.riskHigh') : riskLevel === 'medium' ? t('security.riskMedium') : t('security.riskLow')}</h3>
                <p>{t('security.riskHelp')}</p>
              </div>
            </div>
            <MetricCard icon={KeyRound} label={t('security.failedLogins')} value={metrics.failed_logins_24h || 0} tone={(metrics.failed_logins_24h || 0) > 0 ? 'warn' : 'good'} />
            <MetricCard icon={CheckCircle2} label={t('security.successfulLogins')} value={metrics.successful_logins_24h || 0} tone="good" />
            <MetricCard icon={ShieldAlert} label={t('security.sensitiveActions')} value={metrics.sensitive_actions_24h || 0} tone={(metrics.sensitive_actions_24h || 0) > 0 ? 'warn' : 'good'} />
            <MetricCard icon={Fingerprint} label={t('security.uniqueIps')} value={metrics.unique_ips_7d || 0} tone="info" />
            <MetricCard icon={Users} label={t('security.activeUsers')} value={metrics.active_users || 0} tone="info" />
            <MetricCard icon={KeyRound} label={t('security.mfaCoverage')} value={`${metrics.mfa_coverage_pct || 0}%`} tone={(metrics.mfa_coverage_pct || 0) > 0 ? 'good' : 'warn'} />
          </section>

          <section className="security-grid">
            <Panel title={t('security.alerts')} subtitle={t('security.alertsHint')}>
              <div className="security-alert-list">
                {(data.alerts || []).map(localizeAlert).map((alert, index) => (
                  <div className={`security-alert level-${alert.level}`} key={`${alert.title}-${index}`}>
                    <AlertTriangle size={18} />
                    <div>
                      <strong>{alert.title}</strong>
                      <span>{alert.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title={t('security.auditIntegrity')} subtitle={t('security.auditHint')}>
              <div className={`integrity-box ${integrity.ok ? 'ok' : 'bad'}`}>
                {integrity.ok ? <CheckCircle2 size={26} /> : <ShieldAlert size={26} />}
                <div>
                  <strong>{integrity.ok ? t('security.journalValid') : t('security.inconsistency')}</strong>
                  <span>{t('security.logsSummary', { checked: integrity.checked || 0, legacy: integrity.legacy_count || 0 })}</span>
                </div>
              </div>
              <div className="hash-preview">
                <span>{t('security.lastHash')}</span>
                <code>{integrity.last_hash || t('security.unavailable')}</code>
              </div>
            </Panel>
          </section>

          <section className="security-grid wide">
            <Panel title={t('security.recentActivity')} subtitle={t('security.recentActivityHint')}>
              <ActivityTable rows={data.recent_activity || []} language={language} t={t} translate={translate} />
            </Panel>
            <Panel title={t('security.failedAttempts')} subtitle={t('security.failedAttemptsHint')}>
              <ActivityTable rows={data.failed_logins || []} compact language={language} t={t} translate={translate} />
            </Panel>
          </section>
        </>
      )}
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, tone }) {
  return (
    <article className={`security-metric ${tone}`}>
      <span><Icon size={18} /></span>
      <strong>{value}</strong>
      <p>{label}</p>
    </article>
  )
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="security-panel">
      <div className="security-panel-head">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      {children}
    </section>
  )
}

function ActivityTable({ rows, compact = false, language, t, translate }) {
  if (!rows.length) return <div className="security-empty">{t('security.noData')}</div>
  const actionLabels = language === 'ar' ? {
    login_success: 'دخول ناجح', login_failed: 'دخول فاشل', logout: 'تسجيل الخروج',
    create: 'إنشاء', update: 'تعديل', delete: 'حذف', stock_adjust: 'تعديل المخزون',
    mfa_enabled: 'تفعيل التحقق الثنائي', mfa_disabled: 'تعطيل التحقق الثنائي',
  } : {}
  return (
    <div className="security-activity">
      {rows.map(row => (
        <div className="activity-row" key={row.id}>
          <span className={`action-chip action-${row.action}`}>{actionLabels[row.action] || row.action}</span>
          <div>
            <strong>{row.summary ? translate(row.summary) : `${row.entity} ${row.entity_id}`}</strong>
            <small>{fmtDateTime(row.created_at)} - {row.created_by_name || t('security.system')} {row.ip_address ? `- ${row.ip_address}` : ''}</small>
            {!compact && row.log_hash && <code>{row.log_hash}</code>}
          </div>
        </div>
      ))}
    </div>
  )
}

function SecuritySkeleton() {
  return (
    <>
      <section className="security-overview">
        {Array.from({ length: 6 }).map((_, i) => <div className="security-metric skeleton" key={i} />)}
      </section>
      <section className="security-grid">
        <div className="security-panel skeleton-panel" />
        <div className="security-panel skeleton-panel" />
      </section>
    </>
  )
}
