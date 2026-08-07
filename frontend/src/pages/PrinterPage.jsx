import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmt, fmtDateTime } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Copy, Droplets, Gauge, Plus, ScanLine, Settings2, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'
import './PrinterPage.css'

const TYPES = [
  { value:'bw', label:'Copie N&B', icon:Copy },
  { value:'color', label:'Copie couleur', icon:Droplets },
  { value:'scan', label:'Scan', icon:ScanLine },
]

export default function PrinterPage() {
  const { translate } = useI18n()
  const navigate = useNavigate()
  const [data, setData] = useState({ today:{ quantity:0,revenue:0,by_type:{} }, month:{ quantity:0,revenue:0,by_type:{} }, jobs:[], counters:[] })
  const [job, setJob] = useState({ service_type:'bw', quantity:1, unit_price:0, notes:'' })
  const [counter, setCounter] = useState({ bw_total:0, color_total:0, scan_total:0, notes:'' })
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/printer')
      setData(data)
      const last = data.counters?.[0]
      if (last) setCounter({ bw_total:last.bw_total, color_total:last.color_total, scan_total:last.scan_total, notes:'' })
    } catch (error) { toast.error(error.response?.data?.detail || 'Chargement imprimante impossible') }
  }, [])
  useEffect(() => { load() }, [load])

  const saveJob = async () => {
    if (saving || Number(job.quantity) < 1) return
    setSaving(true)
    try {
      await api.post('/printer/jobs', { ...job, quantity:Number(job.quantity), unit_price:Number(job.unit_price) })
      toast.success('Travail enregistré')
      setJob(current => ({ ...current, quantity:1, notes:'' }))
      load()
    } catch (error) { toast.error(error.response?.data?.detail || 'Enregistrement impossible') }
    finally { setSaving(false) }
  }
  const saveCounter = async () => {
    try {
      await api.post('/printer/counters', Object.fromEntries(Object.entries(counter).map(([k,v]) => [k, k.endsWith('_total') ? Number(v) : v])))
      toast.success('Compteur C454e enregistré')
      load()
    } catch (error) { toast.error(error.response?.data?.detail || 'Compteur invalide') }
  }
  const setup = async () => {
    try {
      const { data } = await api.post('/printer/setup-services')
      toast.success(data.count ? `${data.count} raccourci(s) ajouté(s) au POS` : 'Les raccourcis POS existent déjà')
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Installation des raccourcis impossible')
    }
  }

  return <div className="page-content printer-page">
    <header className="page-header">
      <div><h1 className="page-title">Konica Minolta C454e</h1><p>{translate('Suivi manuel des copies, scans, compteurs et coûts.')}</p></div>
      <div className="toolbar"><button className="btn btn-secondary" onClick={setup}><Settings2 size={16}/> Installer raccourcis POS</button><button className="btn btn-primary" onClick={() => navigate('/expenses')}><Plus size={16}/> Dépense impression</button></div>
    </header>
    <section className="printer-kpis">
      <Kpi label={translate("Copies aujourd'hui")} value={data.today.quantity} sub={`${fmt(data.today.revenue)} MAD`} />
      <Kpi label={translate('Copies ce mois')} value={data.month.quantity} sub={`${fmt(data.month.revenue)} MAD`} />
      <Kpi label={translate('N&B ce mois')} value={data.month.by_type?.bw || 0} sub={translate('pages')} />
      <Kpi label={translate('Résultat impression')} value={`${fmt(data.month_net || 0)} MAD`} sub={`${fmt(data.month_expenses || 0)} MAD ${translate('de charges')}`} />
    </section>
    <section className="printer-grid">
      <div className="card printer-entry">
        <h2><Copy size={19}/> Enregistrer un travail</h2>
        <div className="printer-type-picks">{TYPES.map(({value,label,icon:Icon}) => <button key={value} className={job.service_type===value?'active':''} onClick={() => setJob(j=>({...j,service_type:value}))}><Icon size={18}/>{translate(label)}</button>)}</div>
        <div className="form-grid cols-2"><label>Nombre de pages<input type="number" min="1" value={job.quantity} onChange={e=>setJob(j=>({...j,quantity:e.target.value}))}/></label><label>Prix unitaire libre<input type="number" min="0" step=".01" value={job.unit_price} onChange={e=>setJob(j=>({...j,unit_price:e.target.value}))}/></label></div>
        <label>Note<input value={job.notes} onChange={e=>setJob(j=>({...j,notes:e.target.value}))}/></label>
        <div className="printer-total"><span>Total</span><strong>{fmt(Number(job.quantity)*Number(job.unit_price))} MAD</strong></div>
        <button className="btn btn-primary" disabled={saving} onClick={saveJob}>Enregistrer</button>
      </div>
      <div className="card printer-entry">
        <h2><Gauge size={19}/> Relevé compteur</h2>
        <p className="text-muted text-sm">Saisie manuelle, sans connexion complexe à l'imprimante.</p>
        <div className="form-grid cols-3"><label>N&B total<input type="number" min="0" value={counter.bw_total} onChange={e=>setCounter(c=>({...c,bw_total:e.target.value}))}/></label><label>Couleur total<input type="number" min="0" value={counter.color_total} onChange={e=>setCounter(c=>({...c,color_total:e.target.value}))}/></label><label>Scan total<input type="number" min="0" value={counter.scan_total} onChange={e=>setCounter(c=>({...c,scan_total:e.target.value}))}/></label></div>
        <label>Note<input value={counter.notes} onChange={e=>setCounter(c=>({...c,notes:e.target.value}))}/></label>
        <button className="btn btn-secondary" onClick={saveCounter}>Sauvegarder le relevé</button>
        <div className="counter-history">{data.counters.slice(0,4).map(row=><div key={row.id}><span>{fmtDateTime(row.recorded_at)}</span><strong>N&B {row.bw_total} · C {row.color_total} · Scan {row.scan_total}</strong></div>)}</div>
      </div>
    </section>
    <section className="card"><h2 className="printer-history-title"><TrendingUp size={19}/> Historique du mois</h2><div className="table-wrap"><table><thead><tr><th>Date</th><th>Service</th><th>Quantité</th><th>Prix</th><th>Total</th><th>Note</th></tr></thead><tbody>{data.jobs.map(row=><tr key={row.id}><td>{fmtDateTime(row.date_time)}</td><td>{translate(row.service_label)}</td><td>{row.quantity}</td><td>{fmt(row.unit_price)} MAD</td><td><strong>{fmt(row.total_amount)} MAD</strong></td><td>{row.notes||'—'}</td></tr>)}</tbody></table></div></section>
  </div>
}
function Kpi({label,value,sub}) { return <article><span>{label}</span><strong>{value}</strong><small>{sub}</small></article> }
