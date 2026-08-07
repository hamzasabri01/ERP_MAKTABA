import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpenCheck, Check, Download, FilePlus2, ImagePlus, Printer, RefreshCw, Save, Search, Sparkles, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import { useI18n } from '../lib/i18n'
import './ResearchPage.css'

const EMPTY_FORM = {
  customer_id: '', student_first_name: '', contact_info: '', topic: '', subject: '', academic_level: 'primary', custom_academic_level: '', language: 'fr',
  language_level: 'simple', target_pages: 3, page_count_mode: 'approximate', include_cover: true,
  include_toc: false, include_introduction: true, include_conclusion: true, include_images: false,
  requested_image_count: 0, include_references: true, country_context: 'Morocco',
  teacher_instructions: '', internal_notes: '', requested_delivery_at: '', output_format: 'pdf', print_color_mode: 'bw',
  print_copies: 1, binding_preference: 'none',
}

const STATUS_LABELS = {
  DRAFT: 'Brouillon', OUTLINE_PENDING: 'Préparation du plan', OUTLINE_READY: 'Plan à vérifier',
  OUTLINE_APPROVED: 'Plan approuvé', GENERATING: 'Génération', REVIEW_REQUIRED: 'Révision requise',
  APPROVED: 'Approuvé', EXPORTING: 'Export', EXPORTED: 'Exporté', PRINTED: 'Imprimé',
  COMPLETED: 'Terminé', CANCELLED: 'Annulé', FAILED: 'Échec',
}

const errorMessage = error => error.response?.data?.detail || 'Opération impossible. Réessayez.'

function ResearchAssetCard({ asset, canApprove, onApproved }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    let objectUrl = ''
    api.get(asset.download_url, { responseType: 'blob' }).then(({ data }) => {
      objectUrl = URL.createObjectURL(data)
      if (active) setUrl(objectUrl)
    }).catch(() => {})
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [asset.id, asset.download_url])
  return <div className="research-asset-card">
    <div className="research-asset-preview">{url ? <img src={url} alt={asset.alt_text || asset.caption || asset.original_file_name} /> : <ImagePlus size={24} />}</div>
    <div><strong>{asset.caption || asset.original_file_name}</strong><small>{asset.source_url ? 'Image web avec source' : 'Image ajoutée manuellement'} · {Math.round(asset.file_size / 1024)} Ko · {asset.approval_status}</small>{asset.license_info && <small>{asset.license_info}</small>}</div>
    {canApprove && asset.approval_status !== 'APPROVED' && <button className="btn btn-secondary btn-sm" onClick={() => onApproved(asset.id)}>Approuver</button>}
  </div>
}

function CreateRequestDialog({ config, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [clients, setClients] = useState([])
  const [saving, setSaving] = useState(false)
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  useEffect(() => {
    api.get('/clients', { params: { limit: 500 } }).then(({ data }) => setClients(Array.isArray(data) ? data : data.items || [])).catch(() => setClients([]))
  }, [])

  const submit = async event => {
    event.preventDefault()
    if (!form.topic.trim()) return toast.error('Le sujet est obligatoire')
    setSaving(true)
    try {
      const payload = {
        ...form,
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        requested_delivery_at: form.requested_delivery_at || null,
        target_pages: Number(form.target_pages),
        requested_image_count: form.include_images ? Number(form.requested_image_count) : 0,
        print_copies: Number(form.print_copies),
      }
      const { data } = await api.post('/research/requests', payload)
      toast.success('Demande créée')
      onCreated(data)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" role="presentation">
      <form className="modal research-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="research-create-title">
        <div className="modal-header">
          <div><span className="research-eyebrow">RECHERCHE SCOLAIRE</span><h2 id="research-create-title">Nouvelle demande</h2></div>
          <button type="button" className="btn btn-secondary btn-icon" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="modal-body research-form-body">
          <div className="form-grid form-grid-2">
            <div className="form-group"><label className="form-label">Client existant</label><select value={form.customer_id} onChange={e => set('customer_id', e.target.value)}><option value="">— Client comptoir —</option>{clients.map(client => <option value={client.id} key={client.id}>{client.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Prénom de l'élève</label><input maxLength={100} value={form.student_first_name} onChange={e => set('student_first_name', e.target.value)} /></div>
            <div className="form-group research-span-2"><label className="form-label">Sujet *</label><input autoFocus maxLength={300} value={form.topic} onChange={e => set('topic', e.target.value)} placeholder="Ex. Le cycle de l'eau" /></div>
            <div className="form-group"><label className="form-label">Matière</label><input maxLength={120} value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="Sciences" /></div>
            <div className="form-group"><label className="form-label">Niveau scolaire *</label><select value={form.academic_level} onChange={e => set('academic_level', e.target.value)}><option value="primary">Primaire</option><option value="middle">Collège</option><option value="high">Lycée</option><option value="university">Université</option><option value="custom">Personnalisé</option></select></div>
            {form.academic_level === 'custom' && <div className="form-group"><label className="form-label">Niveau personnalisé *</label><input value={form.custom_academic_level} onChange={e => set('custom_academic_level', e.target.value)} /></div>}
            <div className="form-group"><label className="form-label">Langue *</label><select value={form.language} onChange={e => set('language', e.target.value)}><option value="ar">العربية</option><option value="fr">Français</option><option value="en">English</option></select></div>
            <div className="form-group"><label className="form-label">Difficulté</label><select value={form.language_level} onChange={e => set('language_level', e.target.value)}><option value="very_simple">Très simple</option><option value="simple">Simple</option><option value="intermediate">Intermédiaire</option><option value="advanced">Avancé</option><option value="academic">Académique</option></select></div>
            <div className="form-group"><label className="form-label">Pages ciblées</label><input type="number" min="1" max={config.max_pages} value={form.target_pages} onChange={e => set('target_pages', e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Mode pages</label><select value={form.page_count_mode} onChange={e => set('page_count_mode', e.target.value)}><option value="approximate">Approximatif</option><option value="strict">Strict</option></select></div>
            <div className="form-group"><label className="form-label">Livraison demandée</label><input type="datetime-local" value={form.requested_delivery_at} onChange={e => set('requested_delivery_at', e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Format</label><select value={form.output_format} onChange={e => set('output_format', e.target.value)}><option value="pdf">PDF</option><option value="docx">DOCX</option><option value="both">PDF + DOCX</option></select></div>
            <div className="form-group"><label className="form-label">Impression</label><select value={form.print_color_mode} onChange={e => set('print_color_mode', e.target.value)}><option value="bw">Noir et blanc</option><option value="color">Couleur</option><option value="mixed">Mixte</option></select></div>
            <div className="form-group"><label className="form-label">Reliure</label><select value={form.binding_preference} onChange={e => set('binding_preference', e.target.value)}><option value="none">Aucune</option><option value="staple">Agrafée</option><option value="spiral">Spirale</option><option value="folder">Chemise</option></select></div>
            <div className="form-group research-span-2"><label className="form-label">Consignes de l'enseignant</label><textarea rows="3" maxLength={5000} value={form.teacher_instructions} onChange={e => set('teacher_instructions', e.target.value)} /></div>
          </div>
          <div className="research-options" aria-label="Options du document">
            {[['include_cover', 'Page de garde'], ['include_toc', 'Sommaire'], ['include_introduction', 'Introduction'], ['include_conclusion', 'Conclusion'], ['include_references', 'Références'], ['include_images', 'Images']].map(([key, label]) => (
              <label key={key} className="research-option"><input type="checkbox" checked={form[key]} onChange={e => set(key, e.target.checked)} /><span>{label}</span></label>
            ))}
          </div>
          {form.include_images && <div className="form-group"><label className="form-label">Nombre d'images</label><input type="number" min="0" max={config.max_images} value={form.requested_image_count} onChange={e => set('requested_image_count', e.target.value)} /></div>}
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <FilePlus2 size={17} />} Créer</button></div>
      </form>
    </div>
  )
}

function ResearchEditor({ request, onReload }) {
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState('')
  const [outline, setOutline] = useState(request.outline)
  const [sections, setSections] = useState(request.sections || [])
  const [sourceTitle, setSourceTitle] = useState('')
  useEffect(() => { setOutline(request.outline); setSections(request.sections || []) }, [request])

  const run = async (key, operation, success) => {
    setBusy(key)
    try { await operation(); toast.success(success); await onReload() } catch (error) { toast.error(errorMessage(error)) } finally { setBusy('') }
  }

  const saveOutline = () => run('outline-save', () => api.patch(`/research/requests/${request.id}/outline`, outline), 'Plan sauvegardé')
  const saveSection = section => run(`section-${section.id}`, () => api.patch(`/research/sections/${section.id}`, { title: section.title, content: section.content, change_reason: 'manual_save' }), 'Section sauvegardée')
  const exportPdf = () => run('export-pdf', async () => {
    const { data } = await api.post(`/research/requests/${request.id}/export-pdf`, null, { responseType: 'blob' })
    const url = URL.createObjectURL(data); const link = document.createElement('a')
    link.href = url; link.download = `${request.reference}.pdf`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'PDF téléchargé et export enregistré')
  const exportDocx = () => run('export-docx', async () => {
    const { data } = await api.post(`/research/requests/${request.id}/export-docx`, null, { responseType: 'blob' })
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = `${request.reference}.docx`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'DOCX téléchargé')
  const printPdf = async () => {
    const previewWindow = window.open('', '_blank')
    if (!previewWindow) return toast.error("Autorisez les fenêtres contextuelles pour imprimer")
    setBusy('print')
    try {
      const { data } = await api.post(`/research/requests/${request.id}/export-pdf`, null, { responseType: 'blob' })
      const url = URL.createObjectURL(data)
      previewWindow.location.replace(url)
      setTimeout(() => URL.revokeObjectURL(url), 120000)
      await api.post(`/research/requests/${request.id}/mark-printed`)
      toast.success("Aperçu d'impression ouvert")
      await onReload()
    } catch (error) {
      previewWindow.close()
      toast.error(errorMessage(error))
    } finally { setBusy('') }
  }
  const preparePos = () => run('prepare-pos', async () => {
    const { data } = await api.post(`/research/requests/${request.id}/prepare-pos`)
    navigate(`/pos?search=${encodeURIComponent(data.code)}&research=${encodeURIComponent(request.reference)}&price=${encodeURIComponent(data.suggested_price)}`)
  }, 'Service préparé dans le POS')
  const uploadAsset = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const form = new FormData()
    form.append('image', file)
    form.append('caption', file.name)
    await run('asset-upload', () => api.post(`/research/requests/${request.id}/assets`, form), 'Image ajoutée; approbation requise')
  }
  const approveAsset = assetId => run(`asset-${assetId}`, () => api.post(`/research/assets/${assetId}/approve`), 'Image approuvée')
  const addSource = () => {
    if (!sourceTitle.trim()) return toast.error('Titre de la source obligatoire')
    return run('source-add', () => api.post(`/research/requests/${request.id}/sources`, { title: sourceTitle.trim(), source_type: 'manual' }).then(() => setSourceTitle('')), 'Source ajoutée; vérification requise')
  }
  const verifySource = sourceId => run(`source-${sourceId}`, () => api.post(`/research/sources/${sourceId}/verify`, { status: 'VERIFIED' }), 'Source vérifiée')
  const restoreVersion = (sectionId, versionId) => run(`restore-${versionId}`, () => api.post(`/research/sections/${sectionId}/restore`, { version_id: versionId }), 'Version restaurée')

  return (
    <div className="research-editor">
      <aside className="card research-request-meta">
        <span className={`badge research-status status-${request.status.toLowerCase()}`}>{STATUS_LABELS[request.status] || request.status}</span>
        <h2>{request.topic}</h2><span className="font-mono text-sm">{request.reference}</span>
        <dl><div><dt>Langue</dt><dd>{request.language.toUpperCase()}</dd></div><div><dt>Pages</dt><dd>{request.estimated_pages} / {request.target_pages}</dd></div><div><dt>Mots</dt><dd>{request.total_words}</dd></div><div><dt>Estimation</dt><dd>{request.estimated_price.toFixed(2)} MAD</dd></div></dl>
        {request.status === 'DRAFT' && hasPermission('research.generate') && <button className="btn btn-primary" disabled={busy} onClick={() => run('outline', () => api.post(`/research/requests/${request.id}/generate-outline`), 'Plan généré')}><Sparkles size={17} /> Générer le plan</button>}
        {['REVIEW_REQUIRED', 'APPROVED', 'EXPORTED'].includes(request.status) && hasPermission('research.generate') && <button className="btn btn-secondary" disabled={busy} onClick={() => run('outline-web', () => api.post(`/research/requests/${request.id}/generate-outline`), 'Nouvelle structure web générée')}><Sparkles size={17} /> Reconstruire depuis le web</button>}
        {request.status === 'OUTLINE_READY' && hasPermission('research.approve') && <button className="btn btn-primary" disabled={busy} onClick={() => run('approve-outline', () => api.post(`/research/requests/${request.id}/approve-outline`), 'Plan approuvé')}><Check size={17} /> Approuver le plan</button>}
        {request.status === 'OUTLINE_APPROVED' && hasPermission('research.generate') && <button className="btn btn-primary" disabled={busy} onClick={() => run('sections', () => api.post(`/research/requests/${request.id}/generate-sections`), 'Sections générées')}><Sparkles size={17} /> Générer les sections</button>}
        {request.status === 'REVIEW_REQUIRED' && hasPermission('research.edit') && <button className="btn btn-secondary" disabled={busy} onClick={() => run('quality', async () => { const { data } = await api.post(`/research/requests/${request.id}/quality-check`); toast(data.passed ? `Qualité: ${data.overall_score}%` : `Actions requises: ${data.required_actions.length}`) }, 'Contrôle terminé')}><BookOpenCheck size={17} /> Contrôle qualité</button>}
        {request.status === 'REVIEW_REQUIRED' && hasPermission('research.approve') && <button className="btn btn-primary" disabled={busy} onClick={() => run('approve', () => api.post(`/research/requests/${request.id}/approve`), 'Recherche approuvée')}><Check size={17} /> Approbation finale</button>}
        {['APPROVED', 'EXPORTED'].includes(request.status) && hasPermission('research.export') && <button className="btn btn-primary" disabled={busy} onClick={exportPdf}><Download size={17} /> Télécharger PDF</button>}
        {['APPROVED', 'EXPORTED'].includes(request.status) && hasPermission('research.export') && <button className="btn btn-secondary" disabled={busy} onClick={exportDocx}><Download size={17} /> Télécharger DOCX</button>}
        {['APPROVED', 'EXPORTED', 'PRINTED', 'COMPLETED'].includes(request.status) && hasPermission('research.print') && hasPermission('research.export') && <button className="btn btn-secondary" disabled={busy} onClick={printPdf}><Printer size={17} /> Imprimer</button>}
        {['APPROVED', 'EXPORTED', 'PRINTED', 'COMPLETED'].includes(request.status) && hasPermission('pos') && hasPermission('research.create') && <button className="btn btn-secondary" disabled={busy} onClick={preparePos}>Ouvrir dans le POS</button>}
      </aside>
      <section className="research-content-column">
        {request.include_references && <div className="card research-sources-panel">
          <div className="research-section-head"><div><span className="research-eyebrow">RÉFÉRENCES</span><h2>Sources vérifiables</h2></div></div>
          {hasPermission('research.edit') && <div className="research-source-form"><input maxLength={300} value={sourceTitle} onChange={e => setSourceTitle(e.target.value)} placeholder="Titre du livre, document ou site…" /><button className="btn btn-secondary" disabled={busy} onClick={addSource}>Ajouter</button></div>}
          <div className="research-source-list">{(request.sources || []).map(source => <div key={source.id}><div><strong>{source.title}</strong><small>{source.source_type} · {source.verification_status}</small></div>{hasPermission('research.approve') && source.verification_status === 'PENDING' && <button className="btn btn-secondary btn-sm" onClick={() => verifySource(source.id)}>Vérifier</button>}</div>)}{!request.sources?.length && <p className="text-muted">Aucune source confirmée. Les références suggérées par AI ne sont jamais validées automatiquement.</p>}</div>
        </div>}
        {request.include_images && <div className="card research-assets-panel">
          <div className="research-section-head"><div><span className="research-eyebrow">MÉDIAS CONTRÔLÉS</span><h2>Images du document</h2></div><div className="flex gap-2">{hasPermission('research.generate') && <button className="btn btn-secondary" disabled={busy} onClick={() => run('discover-images', () => api.post(`/research/requests/${request.id}/discover-images`), 'Images web trouvées; vérifiez-les avant approbation')}><Search size={16} /> Rechercher sur le web</button>}{hasPermission('research.edit') && <label className="btn btn-secondary"><ImagePlus size={16} /> Ajouter une image<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={uploadAsset} /></label>}</div></div>
          <div className="research-assets-grid">{(request.assets || []).map(asset => <ResearchAssetCard key={asset.id} asset={asset} canApprove={hasPermission('research.approve')} onApproved={approveAsset} />)}{!request.assets?.length && <p className="text-muted">Aucune image. Les fichiers restent privés et doivent être approuvés.</p>}</div>
        </div>}
        {outline && <div className="card research-outline-card">
          <div className="research-section-head"><div><span className="research-eyebrow">PLAN VALIDÉ PAR L'EMPLOYÉ</span><h2>Structure de la recherche</h2></div>{request.status === 'OUTLINE_READY' && <button className="btn btn-secondary" onClick={saveOutline} disabled={busy}><Save size={16} /> Sauvegarder</button>}</div>
          <input className="research-title-input" value={outline.title || ''} disabled={request.status !== 'OUTLINE_READY'} onChange={e => setOutline(current => ({ ...current, title: e.target.value }))} />
          {(outline.sections || []).map((section, index) => <div className="research-outline-row" key={`${section.order}-${index}`}><span>{section.order}</span><input value={section.title} disabled={request.status !== 'OUTLINE_READY'} onChange={e => setOutline(current => ({ ...current, sections: current.sections.map((item, itemIndex) => itemIndex === index ? { ...item, title: e.target.value } : item) }))} /><strong>{section.target_words} mots</strong></div>)}
        </div>}
        {sections.map((section, index) => <article className="card research-section-card" key={section.id} dir={request.language === 'ar' ? 'rtl' : 'ltr'}>
          <div className="research-section-head"><div><span className="research-eyebrow">SECTION {index + 1}</span><input className="research-section-title" value={section.title} onChange={e => setSections(current => current.map(item => item.id === section.id ? { ...item, title: e.target.value } : item))} /></div><span>{section.content.trim().split(/\s+/).filter(Boolean).length} mots</span></div>
          <textarea className="research-editor-area" value={section.content || ''} onChange={e => setSections(current => current.map(item => item.id === section.id ? { ...item, content: e.target.value } : item))} disabled={request.status !== 'REVIEW_REQUIRED'} />
          {request.status === 'REVIEW_REQUIRED' && <div className="research-section-actions"><button className="btn btn-secondary" disabled={busy === `section-${section.id}`} onClick={() => saveSection(section)}><Save size={16} /> Sauvegarder cette section</button>{hasPermission('research.generate') && <button className="btn btn-secondary" disabled={busy} onClick={() => run(`rewrite-${section.id}`, () => api.post(`/research/sections/${section.id}/rewrite`, { action: 'correct_language' }), 'Section corrigée')}><Sparkles size={16} /> Corriger la langue</button>}</div>}
          {section.versions?.length > 0 && <details className="research-versions"><summary>Historique ({section.versions.length})</summary><div>{section.versions.slice().reverse().map(version => <button className="btn btn-secondary btn-sm" key={version.id} disabled={request.status !== 'REVIEW_REQUIRED' || busy} onClick={() => restoreVersion(section.id, version.id)}>v{version.version_number} · {version.change_reason}</button>)}</div></details>}
        </article>)}
        {!outline && <div className="card research-empty"><BookOpenCheck size={38} /><h2>Le plan sera affiché ici</h2><p>La génération complète reste bloquée jusqu'à l'approbation explicite du plan.</p></div>}
      </section>
    </div>
  )
}

export default function ResearchPage() {
  const { hasPermission } = useAuth()
  const { language, translate } = useI18n()
  const [config, setConfig] = useState(null)
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  const loadList = useCallback(async () => {
    const { data } = await api.get('/research/requests', { params: { search, page_size: 100 } })
    setItems(data.items || [])
  }, [search])

  const loadDetail = useCallback(async id => {
    const { data } = await api.get(`/research/requests/${id}`)
    setSelected(data)
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([api.get('/research/config'), api.get('/research/requests', { params: { page_size: 100 } })])
      .then(([configuration, requests]) => { if (active) { setConfig(configuration.data); setItems(requests.data.items || []) } })
      .catch(error => toast.error(errorMessage(error)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => loadList().catch(error => toast.error(errorMessage(error))), 300)
    return () => clearTimeout(timer)
  }, [loadList])

  const metrics = useMemo(() => ({ total: items.length, draft: items.filter(item => item.status === 'DRAFT').length, review: items.filter(item => item.status === 'REVIEW_REQUIRED').length, done: items.filter(item => ['COMPLETED', 'PRINTED', 'EXPORTED'].includes(item.status)).length }), [items])
  if (loading) return <div className="page-content"><div className="card research-empty"><RefreshCw className="spin" /> Chargement du module…</div></div>
  if (!config?.enabled) return <div className="page-content"><div className="card research-empty"><h1>Module désactivé</h1><p>Activez RESEARCH_MODULE_ENABLED côté serveur.</p></div></div>

  return (
    <div className="page-content research-page" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="page-header"><div><span className="research-eyebrow">ASSISTANT PÉDAGOGIQUE</span><h1 className="page-title">{language === 'ar' ? 'مساعد البحوث المدرسية' : 'Recherches scolaires'}</h1><p className="text-muted">Création contrôlée, révision humaine et historique complet.</p></div>{hasPermission('research.create') && <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><FilePlus2 size={18} /> Nouvelle demande</button>}</div>
      {!selected && <>
        <div className="research-metrics">{[['Demandes', metrics.total], ['Brouillons', metrics.draft], ['À réviser', metrics.review], ['Finalisées', metrics.done]].map(([label, value]) => <div className="card" key={label}><span>{translate(label)}</span><strong>{value}</strong></div>)}</div>
        <div className="card research-list-card">
          <div className="research-list-toolbar"><div className="research-search"><Search size={18} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Référence, sujet ou matière…" /></div><button className="btn btn-secondary btn-icon" onClick={() => loadList()} aria-label="Actualiser"><RefreshCw size={17} /></button></div>
          <div className="table-wrap"><table><thead><tr><th>Référence</th><th>Sujet</th><th>Niveau</th><th>Langue</th><th>Pages</th><th>Statut</th><th>Prix</th></tr></thead><tbody>{items.map(item => <tr key={item.id} className="research-list-row" onClick={() => loadDetail(item.id)}><td className="font-mono">{item.reference}</td><td><strong>{item.topic}</strong><small>{item.subject || '—'}</small></td><td>{translate(item.academic_level)}</td><td>{item.language.toUpperCase()}</td><td>{item.target_pages}</td><td><span className={`badge research-status status-${item.status.toLowerCase()}`}>{translate(STATUS_LABELS[item.status] || item.status)}</span></td><td>{Number(item.estimated_price).toFixed(2)} MAD</td></tr>)}</tbody></table></div>
        </div>
      </>}
      {selected && <><button className="btn btn-secondary research-back" onClick={() => setSelected(null)}>← Retour aux demandes</button><ResearchEditor request={selected} onReload={() => loadDetail(selected.id)} /></>}
      {createOpen && <CreateRequestDialog config={config} onClose={() => setCreateOpen(false)} onCreated={data => { setCreateOpen(false); loadList(); loadDetail(data.id) }} />}
    </div>
  )
}
