import { useEffect, useState } from 'react'
import {
  Activity, AlertTriangle, CheckCircle2, Fingerprint, KeyRound,
  RefreshCw, ShieldAlert, ShieldCheck, Users
} from 'lucide-react'
import { api, fmtDateTime } from '../lib/api'
import './SecurityCenterPage.css'

export default function SecurityCenterPage() {
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

  return (
    <div className="page-content security-page">
      <section className={`security-hero risk-${riskLevel}`}>
        <div>
          <span className="security-eyebrow"><ShieldCheck size={15} /> Cybersecurity module</span>
          <h1>Security Center</h1>
          <p>Supervision des connexions, journal d'audit, score de risque et integrite hash-chain.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? 'spin-icon' : ''} />
          Actualiser
        </button>
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? <SecuritySkeleton /> : (
        <>
          <section className="security-overview">
            <div className={`risk-card risk-${riskLevel}`}>
              <div className="risk-ring"><strong>{data.risk_score}</strong><span>/100</span></div>
              <div>
                <span>Risk score</span>
                <h3>{riskLevel === 'high' ? 'Risque eleve' : riskLevel === 'medium' ? 'Risque moyen' : 'Risque faible'}</h3>
                <p>Calcule depuis les tentatives echouees, actions sensibles et integrite du journal.</p>
              </div>
            </div>
            <MetricCard icon={KeyRound} label="Failed logins 24h" value={metrics.failed_logins_24h || 0} tone={(metrics.failed_logins_24h || 0) > 0 ? 'warn' : 'good'} />
            <MetricCard icon={CheckCircle2} label="Successful logins 24h" value={metrics.successful_logins_24h || 0} tone="good" />
            <MetricCard icon={ShieldAlert} label="Actions sensibles 24h" value={metrics.sensitive_actions_24h || 0} tone={(metrics.sensitive_actions_24h || 0) > 0 ? 'warn' : 'good'} />
            <MetricCard icon={Fingerprint} label="IPs uniques 7j" value={metrics.unique_ips_7d || 0} tone="info" />
            <MetricCard icon={Users} label="Utilisateurs actifs" value={metrics.active_users || 0} tone="info" />
            <MetricCard icon={KeyRound} label="Couverture MFA" value={`${metrics.mfa_coverage_pct || 0}%`} tone={(metrics.mfa_coverage_pct || 0) > 0 ? 'good' : 'warn'} />
          </section>

          <section className="security-grid">
            <Panel title="Alertes de securite" subtitle="Detection simple des evenements suspects">
              <div className="security-alert-list">
                {(data.alerts || []).map((alert, index) => (
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

            <Panel title="Audit integrity" subtitle="Hash chain inspiree blockchain">
              <div className={`integrity-box ${integrity.ok ? 'ok' : 'bad'}`}>
                {integrity.ok ? <CheckCircle2 size={26} /> : <ShieldAlert size={26} />}
                <div>
                  <strong>{integrity.ok ? 'Journal integre' : 'Incoherence detectee'}</strong>
                  <span>{integrity.checked || 0} logs verifies - {integrity.legacy_count || 0} anciens logs sans hash</span>
                </div>
              </div>
              <div className="hash-preview">
                <span>Dernier hash</span>
                <code>{integrity.last_hash || 'non disponible'}</code>
              </div>
            </Panel>
          </section>

          <section className="security-grid wide">
            <Panel title="Activite recente" subtitle="Operations sensibles et metier">
              <ActivityTable rows={data.recent_activity || []} />
            </Panel>
            <Panel title="Tentatives echouees" subtitle="Suivi anti brute-force">
              <ActivityTable rows={data.failed_logins || []} compact />
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

function ActivityTable({ rows, compact = false }) {
  if (!rows.length) return <div className="security-empty">Aucune donnee.</div>
  return (
    <div className="security-activity">
      {rows.map(row => (
        <div className="activity-row" key={row.id}>
          <span className={`action-chip action-${row.action}`}>{row.action}</span>
          <div>
            <strong>{row.summary || `${row.entity} ${row.entity_id}`}</strong>
            <small>{fmtDateTime(row.created_at)} - {row.created_by_name || 'system'} {row.ip_address ? `- ${row.ip_address}` : ''}</small>
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
