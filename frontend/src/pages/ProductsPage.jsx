// src/pages/ProductsPage.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmt, resolveMediaUrl } from '../lib/api'
import { Plus, Search, Edit2, Trash2, Package, AlertTriangle, ImagePlus, X, Upload, Download, FileSpreadsheet } from 'lucide-react'
import toast from 'react-hot-toast'
import { TableLoadingRow } from '../components/ui/LoadingStates'
import { useConfirm } from '../components/ui/ConfirmDialog'
import './ProductImages.css'
import './ProductImport.css'

const EMPTY = { name:'', code:'', category_id:'', supplier_id:'', description:'', purchase_price:0, sale_price:0, stock_quantity:0, min_stock:5, barcode:'', unit:'pcs', tax_rate:20, tva_enabled:1, product_type:'product', is_active:1 }
const PAGE_SIZE = 100

export default function ProductsPage() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [products, setProducts]   = useState([])
  const [categories, setCategories] = useState([])
  const [suppliers, setSuppliers]   = useState([])
  const [q, setQ]       = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null)
  const [selected, setSelected] = useState(null)
  const [form, setForm]         = useState(EMPTY)
  const [saving, setSaving]     = useState(false)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [nextCode, setNextCode] = useState('')
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importStep, setImportStep] = useState('Choisissez un fichier CSV')
  const [importResult, setImportResult] = useState(null)
  const [settings, setSettings] = useState({})
  const fileInputRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { q: q || undefined, category_id: catFilter || undefined, product_type: typeFilter || undefined, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }
      const [p, c, s] = await Promise.all([
        api.get('/products', { params }),
        api.get('/categories'),
        api.get('/suppliers'),
      ])
      setProducts(p.data); setCategories(c.data); setSuppliers(s.data)
      api.get('/settings').then(({ data }) => setSettings(data || {})).catch(() => {})
    } finally { setLoading(false) }
  }, [q, catFilter, typeFilter, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, catFilter, typeFilter])

  const resetImageInput = () => {
    setImageFile(null)
    setImagePreview('')
  }

  const loadNextCode = async (productType = 'product') => {
    try {
      const { data } = await api.get('/products/next-code', { params: { product_type: productType } })
      setNextCode(data.code || '')
    } catch {
      setNextCode('')
    }
  }

  const openCreate = () => {
    setForm(EMPTY)
    setSelected(null)
    resetImageInput()
    loadNextCode(EMPTY.product_type)
    setModal('form')
  }
  const openImport = () => {
    setImportFile(null)
    setImporting(false)
    setImportProgress(0)
    setImportStep('Choisissez un fichier CSV')
    setImportResult(null)
    setModal('import')
  }
  const openEdit   = (p) => {
    setForm({ ...p, category_id: p.category_id || '', supplier_id: p.supplier_id || '' })
    setSelected(p)
    setNextCode('')
    resetImageInput()
    setModal('form')
  }

  const optimizeImage = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const maxSide = 900
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const width = Math.max(1, Math.round(img.width * scale))
      const height = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => {
        URL.revokeObjectURL(url)
        if (!blob) return reject(new Error('Compression image impossible'))
        const optimized = new File(
          [blob],
          `${file.name.replace(/\.[^.]+$/, '') || 'product'}.webp`,
          { type: 'image/webp' },
        )
        resolve(optimized)
      }, 'image/webp', 0.82)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image invalide'))
    }
    img.src = url
  })

  const handleImagePick = async (file) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Image JPG, PNG ou WebP uniquement')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image trop grande. Maximum 2 MB')
      return
    }
    try {
      const optimized = await optimizeImage(file)
      setImageFile(optimized)
      setImagePreview(URL.createObjectURL(optimized))
    } catch (e) {
      toast.error(e.message || 'Image invalide')
    }
  }

  const uploadProductImage = async (productId) => {
    if (!imageFile) return
    const data = new FormData()
    data.append('image', imageFile)
    await api.post(`/products/${productId}/image`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  }

  const deleteImage = async () => {
    if (!selected?.id) {
      resetImageInput()
      return
    }
    try {
      await api.delete(`/products/${selected.id}/image`)
      toast.success('Image supprimée')
      resetImageInput()
      setSelected(s => ({ ...s, image_path: null }))
      setForm(f => ({ ...f, image_path: null }))
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur suppression image')
    }
  }

  const handleSave = async () => {
    if (!form.name?.trim()) return toast.error('Le nom est obligatoire')
    setSaving(true)
    try {
      const payload = { ...form, purchase_price: +form.purchase_price||0, sale_price: +form.sale_price||0, stock_quantity: +form.stock_quantity||0, min_stock: +form.min_stock||0, tax_rate: +form.tax_rate||20, category_id: form.category_id||null, supplier_id: form.supplier_id||null }
      let saved
      if (!selected) {
        saved = await api.post('/products', payload)
        await uploadProductImage(saved.data.id)
        toast.success('Produit créé')
      }
      else {
        saved = await api.put(`/products/${selected.id}`, payload)
        await uploadProductImage(saved.data.id)
        toast.success('Produit mis à jour')
      }
      setModal(null); load()
    } catch(e) { toast.error(e.response?.data?.detail || 'Erreur') }
    finally { setSaving(false) }
  }

  const handleDelete = async (p) => {
    const ok = await confirm({
      title: 'Archiver le produit',
      message: `Archiver "${p.name}" ? Le produit ne sera plus propose dans les nouvelles operations.`,
      confirmText: 'Archiver',
      tone: 'danger',
    })
    if (!ok) return
    try { await api.delete(`/products/${p.id}`); toast.success('Produit archivé'); load() }
    catch(e) { toast.error('Erreur') }
  }

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleExport = async () => {
    try {
      const response = await api.get('/products/export', { responseType: 'blob' })
      downloadBlob(response.data, `products-${new Date().toISOString().slice(0, 10)}.csv`)
      toast.success('Export produits prepare')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur export')
    }
  }

  const handleTemplate = () => {
    const header = 'code;name;product_type;category;supplier;barcode;unit;purchase_price;sale_price;stock_quantity;min_stock;tax_rate;tva_enabled;description;is_active'
    const sample = 'PRD-EXEMPLE;Produit exemple;product;Categorie exemple;Fournisseur exemple;6110000000000;pcs;10;15;25;5;20;1;Description exemple;1'
    downloadBlob(new Blob([`\ufeff${header}\n${sample}\n`], { type: 'text/csv;charset=utf-8' }), 'modele-import-produits.csv')
  }

  const handleImportFile = (file) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Fichier CSV uniquement')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Fichier trop grand. Maximum 5 MB')
      return
    }
    setImportFile(file)
    setImportResult(null)
    setImportProgress(0)
    setImportStep('Pret pour import')
  }

  const handleImport = async () => {
    if (!importFile) return toast.error('Choisissez un fichier CSV')
    const data = new FormData()
    data.append('file', importFile)
    setImporting(true)
    setImportResult(null)
    setImportProgress(8)
    setImportStep('Preparation du fichier')
    try {
      const response = await api.post('/products/import', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
        onUploadProgress: event => {
          if (!event.total) return
          const pct = Math.round((event.loaded / event.total) * 55)
          setImportProgress(Math.min(65, 10 + pct))
          setImportStep('Upload du fichier')
        },
      })
      setImportStep('Synchronisation catalogue terminee')
      setImportProgress(100)
      setImportResult(response.data)
      toast.success('Import termine')
      load()
    } catch (e) {
      setImportProgress(0)
      setImportStep('Import interrompu')
      toast.error(e.response?.data?.detail || 'Erreur import')
    } finally {
      setImporting(false)
    }
  }

  const F = (key) => ({ value: form[key] ?? '', onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) })
  const productUnits = String(settings.product_units || 'pcs,kg,g,l,ml,m,m2,m3,boite,lot').split(',').map(item => item.trim()).filter(Boolean)
  const openCatalogSettings = () => navigate('/settings?tab=catalog')

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Produits & Services</h1>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={handleTemplate}><FileSpreadsheet size={16} /> Modele CSV</button>
          <button className="btn btn-secondary" onClick={handleExport}><Download size={16} /> Export</button>
          <button className="btn btn-secondary" onClick={openImport}><Upload size={16} /> Import</button>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Nouveau produit</button>
        </div>
      </div>

      <div className="card" style={{ padding:0 }}>
        <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)', display:'flex', gap:'.75rem', flexWrap:'wrap' }}>
          <div className="search-wrap" style={{ flex:'1 1 240px' }}>
            <Search size={15} className="search-icon" />
            <input placeholder="Rechercher produit, code, code-barres…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <select style={{ width:'auto' }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">Toutes catégories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select style={{ width:'auto' }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">Tous types</option>
            <option value="product">Produit</option>
            <option value="service">Service</option>
          </select>
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Produit</th><th>Code</th><th>Nom</th><th>Catégorie</th><th>P. Achat</th><th>P. Vente</th><th>Stock</th><th>Marge</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={9} label="Generation du catalogue produits..." />
              ) : products.length === 0 ? (
                <tr><td colSpan={9}><div className="empty-state"><Package size={40} /><p>Aucun produit</p></div></td></tr>
              ) : products.map(p => (
                <tr key={p.id}>
                  <td><ProductThumb product={p} /></td>
                  <td><span className="font-mono text-sm text-muted">{p.code}</span></td>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:'.5rem' }}>
                      <strong>{p.name}</strong>
                      {p.is_low_stock && <span className="badge badge-warning" style={{ fontSize:'.65rem' }}><AlertTriangle size={10} /> Faible</span>}
                    </div>
                    <div style={{ fontSize:'.75rem', color:'var(--text3)' }}>{p.product_type === 'service' ? 'Service' : `${p.unit}`}</div>
                  </td>
                  <td>{p.category_name || <span className="text-muted">—</span>}</td>
                  <td>{fmt(p.purchase_price)} MAD</td>
                  <td className="font-semibold">{fmt(p.sale_price)} MAD</td>
                  <td>
                    {p.product_type === 'product'
                      ? <span style={{ color: p.is_low_stock ? 'var(--danger)' : 'var(--success)' }}>{p.stock_quantity} {p.unit}</span>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <span style={{ color: p.margin_pct >= 20 ? 'var(--success)' : p.margin_pct > 0 ? 'var(--warning)' : 'var(--danger)' }}>
                      {fmt(p.margin_pct, 1)}%
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(p)} title="Modifier"><Edit2 size={14}/></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(p)} title="Archiver"><Trash2 size={14}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-pagination">
          <span>Page {page} - {products.length} lignes chargees</span>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page === 1}>Precedent</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => p + 1)} disabled={loading || products.length < PAGE_SIZE}>Suivant</button>
          </div>
        </div>
      </div>

      {modal === 'import' && (
        <div className="modal-overlay" onClick={e => !importing && e.target === e.currentTarget && setModal(null)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <div>
                <h2>Import produits</h2>
                <p className="import-subtitle">CSV optimise pour les catalogues volumineux.</p>
              </div>
              <button className="btn btn-secondary btn-sm btn-icon" disabled={importing} onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <div
                className={`import-dropzone ${importFile ? 'has-file' : ''}`}
                onClick={() => !importing && fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  disabled={importing}
                  onChange={e => handleImportFile(e.target.files?.[0])}
                />
                <FileSpreadsheet size={34} />
                <div>
                  <strong>{importFile ? importFile.name : 'Selectionner un fichier CSV'}</strong>
                  <span>{importFile ? `${(importFile.size / 1024).toFixed(1)} KB` : 'Colonnes: code, name, category, supplier, prix, stock, TVA...'}</span>
                </div>
              </div>

              <div className="import-progress-panel">
                <div className="import-progress-head">
                  <span>{importStep}</span>
                  <strong>{importProgress}%</strong>
                </div>
                <div className="import-progress-track">
                  <div className="import-progress-bar" style={{ width: `${importProgress}%` }} />
                </div>
                {importing && <p className="import-hint">Le serveur traite le fichier en bulk. Vous pouvez importer +1000 produits sans bloquer l'interface.</p>}
              </div>

              {importResult && (
                <div className="import-result">
                  <div><strong>{importResult.total}</strong><span>Lignes</span></div>
                  <div><strong>{importResult.created}</strong><span>Crees</span></div>
                  <div><strong>{importResult.updated}</strong><span>Mis a jour</span></div>
                  <div><strong>{importResult.skipped}</strong><span>Ignorees</span></div>
                </div>
              )}

              {importResult?.errors?.length > 0 && (
                <div className="import-errors">
                  <strong>Erreurs detectees</strong>
                  {importResult.errors.slice(0, 8).map((err, i) => (
                    <div key={i}>Ligne {err.row}: {err.message}</div>
                  ))}
                  {importResult.errors.length > 8 && <span>+ {importResult.errors.length - 8} autres erreurs</span>}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" disabled={importing} onClick={handleTemplate}>
                <FileSpreadsheet size={16} /> Modele CSV
              </button>
              <button className="btn btn-secondary" disabled={importing} onClick={() => setModal(null)}>Fermer</button>
              <button className="btn btn-primary" disabled={!importFile || importing} onClick={handleImport}>
                {importing ? <span className="spinner" style={{width:16,height:16}} /> : <Upload size={16} />}
                Lancer import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {modal === 'form' && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <h2>{!selected ? 'Nouveau produit' : 'Modifier produit'}</h2>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid form-grid-3" style={{ gap:'1rem' }}>
                <div className="form-group product-image-field" style={{ gridColumn:'1/-1' }}>
                  <label className="form-label">Image produit</label>
                  <div className="product-image-editor">
                    <ProductThumb product={{ ...form, image_path: imagePreview || form.image_path }} large />
                    <div className="product-image-actions">
                      <label className="btn btn-secondary">
                        <ImagePlus size={16} /> Choisir image
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          onChange={e => handleImagePick(e.target.files?.[0])}
                        />
                      </label>
                      {(imagePreview || form.image_path) && (
                        <button type="button" className="btn btn-danger" onClick={deleteImage}>
                          <X size={16} /> Supprimer
                        </button>
                      )}
                      <span className="text-sm text-muted">JPG, PNG ou WebP. Max 2 MB. Stockée hors base de données.</span>
                    </div>
                  </div>
                </div>
                <div className="form-group" style={{ gridColumn:'1/-1' }}>
                  <label className="form-label">Nom *</label>
                  <input {...F('name')} placeholder="Nom du produit ou service" />
                </div>
                <div className="form-group">
                  <label className="form-label">Code</label>
                  <input className="readonly-code-input" value={selected?.code || nextCode} disabled readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Code-barres</label>
                  <input {...F('barcode')} placeholder="EAN13…" />
                </div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select value={form.product_type} onChange={e => {
                    const productType = e.target.value
                    setForm(f => ({ ...f, product_type: productType }))
                    if (!selected) loadNextCode(productType)
                  }}>
                    <option value="product">Produit physique</option>
                    <option value="service">Service</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Catégorie</label>
                  <select value={form.category_id||''} onChange={e => setForm(f=>({...f,category_id:e.target.value||null}))}>
                    <option value="">— Aucune —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button type="button" className="btn btn-sm reference-action-btn" onClick={openCatalogSettings}>
                    <Plus size={14} /> Gerer les categories
                  </button>
                </div>
                <div className="form-group">
                  <label className="form-label">Fournisseur</label>
                  <select value={form.supplier_id||''} onChange={e => setForm(f=>({...f,supplier_id:e.target.value||null}))}>
                    <option value="">— Aucun —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.company_name}</option>)}
                  </select>
                  <button type="button" className="btn btn-sm reference-action-btn" onClick={() => navigate('/suppliers')}>
                    <Plus size={14} /> Gerer les fournisseurs
                  </button>
                </div>
                <div className="form-group">
                  <label className="form-label">Unité</label>
                  <select {...F('unit')}>
                    {productUnits.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <button type="button" className="btn btn-sm reference-action-btn" onClick={openCatalogSettings}>
                    <Plus size={14} /> Gerer les unites
                  </button>
                </div>
                <div className="form-group">
                  <label className="form-label">Prix d'achat (MAD)</label>
                  <input {...F('purchase_price')} type="number" min="0" step="0.01" />
                </div>
                <div className="form-group">
                  <label className="form-label">Prix de vente HT (MAD)</label>
                  <input {...F('sale_price')} type="number" min="0" step="0.01" />
                </div>
                <div className="form-group">
                  <label className="form-label">TVA (%)</label>
                  <select value={form.tax_rate||20} onChange={e => setForm(f=>({...f,tax_rate:+e.target.value}))}>
                    {[0,7,10,14,20].map(r => <option key={r} value={r}>{r}%</option>)}
                  </select>
                </div>
                {form.product_type !== 'service' && <>
                  <div className="form-group">
                    <label className="form-label">Stock actuel</label>
                    <input {...F('stock_quantity')} type="number" min="0" step="0.01" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Stock minimum</label>
                    <input {...F('min_stock')} type="number" min="0" step="0.01" />
                  </div>
                </>}
                <div className="form-group" style={{ gridColumn:'1/-1' }}>
                  <label className="form-label">Description</label>
                  <textarea {...F('description')} rows={2} placeholder="Description optionnelle..." />
                </div>
              </div>
              {/* Margin preview */}
              {+form.purchase_price > 0 && +form.sale_price > 0 && (
                <div className="alert alert-info" style={{ marginTop:'1rem' }}>
                  Marge prévue: <strong>{fmt(((form.sale_price - form.purchase_price) / form.purchase_price)*100, 1)}%</strong>
                  &nbsp;— Prix TTC: <strong>{fmt(+form.sale_price * (1 + (+form.tax_rate||20)/100))} MAD</strong>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <span className="spinner" style={{width:16,height:16}} /> : null}
                {!selected ? 'Créer' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ProductThumb({ product, large = false }) {
  const [failed, setFailed] = useState(false)
  const imageUrl = product?.image_path && !failed ? resolveMediaUrl(product.image_path) : ''

  useEffect(() => {
    setFailed(false)
  }, [product?.image_path])

  return (
    <div className={`product-thumb ${large ? 'large' : ''}`}>
      {imageUrl ? (
        <img src={imageUrl} alt={product.name || 'Produit'} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Package size={large ? 34 : 18} />
      )}
    </div>
  )
}
