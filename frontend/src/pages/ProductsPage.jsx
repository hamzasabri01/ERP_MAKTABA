// src/pages/ProductsPage.jsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api, fmt, isVatEnabled, resolveMediaUrl } from '../lib/api'
import { Plus, Search, Edit2, Trash2, Package, AlertTriangle, Barcode, Boxes, Check, ImagePlus, Minus, Smartphone, Sparkles, ShoppingBag, Wifi, X, Upload, Download, FileSpreadsheet, Printer } from 'lucide-react'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import { TableLoadingRow } from '../components/ui/LoadingStates'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { downloadProductLabelsPdf, isValidEan13, ProductLabel, ProductLabelsPrintDocument, printProductLabels } from '../components/print/ProductLabels'
import './ProductImages.css'
import './ProductImport.css'
import './ProductsPage.css'

const EMPTY = { name:'', code:'', category_id:'', supplier_id:'', description:'', purchase_price:0, sale_price:0, stock_quantity:0, min_stock:5, barcode:'', unit:'pcs', purchase_unit:'pcs', purchase_to_base_factor:1, allow_fractional_sale:false, tax_rate:20, tva_enabled:1, product_type:'product', pricing_mode:'fixed', is_active:1 }
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
  const [selectedProductIds, setSelectedProductIds] = useState(() => new Set())
  const [bulkArchiving, setBulkArchiving] = useState(false)
  const [generatingEan, setGeneratingEan] = useState(false)
  const [labelPrint, setLabelPrint] = useState({ open:false, printing:false, downloading:false, repairing:false, copies:1, size:'50x30', showName:true, showPrice:true })
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
  const [catalogTotals, setCatalogTotals] = useState({ total:0, product:0, service:0, bundle:0, low:0 })
  const [bundleComponents, setBundleComponents] = useState([])
  const [eanScanner, setEanScanner] = useState(null)
  const [eanScannerModalOpen, setEanScannerModalOpen] = useState(false)
  const [eanArmed, setEanArmed] = useState(false)
  const [eanScannerStarting, setEanScannerStarting] = useState(false)
  const vatEnabled = isVatEnabled(settings)
  const fileInputRef = useRef(null)
  const eanCursorRef = useRef(0)
  const eanProcessingRef = useRef(false)
  const productMap = useMemo(() => new Map(products.map(product => [product.id, product])), [products])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { q: q || undefined, category_id: catFilter || undefined, product_type: typeFilter || undefined, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }
      const [p, c, s, stats] = await Promise.all([
        api.get('/products', { params }),
        api.get('/categories'),
        api.get('/suppliers'),
        api.get('/products/stats'),
      ])
      setProducts(p.data)
      setSelectedProductIds(current => {
        const visibleIds = new Set(p.data.map(product => product.id))
        return new Set([...current].filter(id => visibleIds.has(id)))
      })
      setCategories(c.data); setSuppliers(s.data); setCatalogTotals(stats.data)
      api.get('/settings').then(({ data }) => setSettings(data || {})).catch(() => {})
    } finally { setLoading(false) }
  }, [q, catFilter, typeFilter, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, catFilter, typeFilter])
  useEffect(() => {
    if (modal !== 'form') setEanArmed(false)
  }, [modal])

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
    setBundleComponents([])
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
  const openEdit   = async (p) => {
    setForm({ ...p, category_id: p.category_id || '', supplier_id: p.supplier_id || '' })
    setSelected(p)
    setNextCode('')
    resetImageInput()
    setBundleComponents([])
    if (p.product_type === 'bundle') {
      try {
        const { data } = await api.get(`/products/${p.id}/components`)
        setBundleComponents((data || []).map(row => ({ product_id:row.product_id, quantity:row.quantity })))
      } catch {
        toast.error('Impossible de charger la composition du pack')
      }
    }
    setModal('form')
  }

  const stopEanScanner = useCallback(async ({ keepPhoneSuccess = false } = {}) => {
    const token = eanScanner?.token
    setEanScannerModalOpen(false)
    setEanArmed(false)
    setEanScanner(null)
    eanCursorRef.current = 0
    eanProcessingRef.current = false
    if (token) {
      const close = () => api.delete(`/mobile-scanner/sessions/${token}`).catch(() => {})
      if (keepPhoneSuccess) window.setTimeout(close, 4000)
      else close()
    }
  }, [eanScanner?.token])

  const openEanScanner = async () => {
    if (eanScanner?.token) {
      setEanArmed(true)
      if (eanScanner.connected) {
        setEanScannerModalOpen(false)
        toast.success('Scanner prêt — présentez le code EAN devant le téléphone', { icon:'📱' })
      } else {
        setEanScannerModalOpen(true)
      }
      return
    }
    setEanScannerStarting(true)
    try {
      const { data } = await api.post('/mobile-scanner/sessions')
      const current = new URL(window.location.href)
      if (!data.public_url && current.protocol !== 'https:') {
        throw new Error('Le tunnel HTTPS du scanner est temporairement indisponible. Réessayez dans quelques secondes.')
      }
      const localHost = ['localhost', '127.0.0.1', '::1'].includes(current.hostname)
      const host = localHost ? data.lan_ip : current.hostname
      const basePath = window.location.pathname.startsWith('/erp') ? '/erp' : ''
      const localUrl = `${current.protocol}//${host}${current.port ? `:${current.port}` : ''}${basePath}/mobile-scanner?session=${encodeURIComponent(data.token)}`
      const scannerUrl = data.public_url
        ? `${String(data.public_url).replace(/\/$/, '')}/mobile-scanner?session=${encodeURIComponent(data.token)}`
        : localUrl
      const qrDataUrl = await QRCode.toDataURL(scannerUrl, {
        width: 300,
        margin: 1,
        color: { dark: '#102b58', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      eanCursorRef.current = 0
      setEanScanner({ ...data, url:scannerUrl, qrDataUrl, connected:false })
      setEanArmed(true)
      setEanScannerModalOpen(true)
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || 'Impossible de démarrer le scanner EAN')
    } finally {
      setEanScannerStarting(false)
    }
  }

  useEffect(() => {
    if (!eanScanner?.token) return undefined
    let stopped = false
    const poll = async () => {
      if (eanProcessingRef.current) return
      try {
        const { data } = await api.get(`/mobile-scanner/sessions/${eanScanner.token}/events`, {
          params: { after: eanCursorRef.current },
        })
        if (stopped) return
        setEanScanner(current => current ? { ...current, connected:Boolean(data.connected) } : current)
        const events = data.events || []
        if (!events.length) return
        if (!eanArmed) {
          eanCursorRef.current = Math.max(...events.map(event => Number(event.id || 0)), eanCursorRef.current)
          return
        }
        const event = events[0]
        eanProcessingRef.current = true
        eanCursorRef.current = Number(event.id || eanCursorRef.current)
        const barcode = String(event.barcode || '').trim()
        const response = await api.get('/products', { params:{ q:barcode, limit:20 } })
        const duplicate = (response.data || []).find(product =>
          String(product.barcode || '').trim() === barcode && product.id !== selected?.id
        )
        if (duplicate) {
          toast.error(`Ce code EAN appartient déjà à « ${duplicate.name} »`)
          eanProcessingRef.current = false
          return
        }
        setForm(current => ({ ...current, barcode }))
        toast.success(`Code EAN ${barcode} ajouté`)
        setEanArmed(false)
        setEanScannerModalOpen(false)
        eanProcessingRef.current = false
      } catch (error) {
        if (!stopped && error.response?.status === 404) {
          setEanScanner(null)
          toast.error('Session scanner expirée. Relancez le scan EAN.')
        }
        eanProcessingRef.current = false
      }
    }
    poll()
    const timer = window.setInterval(poll, 700)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [eanScanner?.token, eanArmed, selected?.id])

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
      const payload = { ...form, purchase_price: +form.purchase_price||0, sale_price: +form.sale_price||0, stock_quantity: +form.stock_quantity||0, min_stock: +form.min_stock||0, purchase_to_base_factor: +form.purchase_to_base_factor||1, tax_rate: +form.tax_rate||20, category_id: form.category_id||null, supplier_id: form.supplier_id||null }
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
      if (payload.product_type === 'bundle') {
        if (!bundleComponents.length || bundleComponents.some(row => !row.product_id || !(row.quantity > 0))) {
          throw new Error('Ajoutez des produits valides au pack scolaire')
        }
        await api.put(`/products/${saved.data.id}/components`, { components:bundleComponents })
      }
      setModal(null); load()
    } catch(e) { toast.error(e.response?.data?.detail || e.message || 'Erreur') }
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

  const selectedProducts = products.filter(product => selectedProductIds.has(product.id))
  const allVisibleSelected = products.length > 0 && selectedProducts.length === products.length
  const someVisibleSelected = selectedProducts.length > 0 && !allVisibleSelected

  const toggleProductSelection = (productId) => {
    setSelectedProductIds(current => {
      const next = new Set(current)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const toggleAllVisibleProducts = () => {
    setSelectedProductIds(allVisibleSelected ? new Set() : new Set(products.map(product => product.id)))
  }

  const productsUsedInLocalPosDraft = (ids) => {
    const selectedIds = new Set(ids.map(Number))
    const used = new Set()
    try {
      const activeDraft = JSON.parse(localStorage.getItem('maktaba_pos_active_draft_v1') || 'null')
      ;(activeDraft?.cart || []).forEach(line => {
        if (selectedIds.has(Number(line?.product_id))) used.add(Number(line.product_id))
      })
      const heldDraft = JSON.parse(localStorage.getItem('proerp_pos_held_cart') || 'null')
      ;(Array.isArray(heldDraft) ? heldDraft : []).forEach(line => {
        if (selectedIds.has(Number(line?.product_id))) used.add(Number(line.product_id))
      })
    } catch {
      // A malformed local draft must not prevent catalog maintenance.
    }
    return selectedProducts.filter(product => used.has(product.id))
  }

  const handleBulkArchive = async () => {
    const ids = selectedProducts.map(product => product.id)
    if (!ids.length) return
    const draftProducts = productsUsedInLocalPosDraft(ids)
    if (draftProducts.length) {
      toast.error(`Retirez d'abord du brouillon POS : ${draftProducts.slice(0, 3).map(product => product.name).join(', ')}${draftProducts.length > 3 ? '…' : ''}`)
      return
    }
    const ok = await confirm({
      title: `Archiver ${ids.length} élément(s)`,
      message: 'Ils disparaîtront du POS et des nouvelles opérations. Les ventes, factures et chiffres d’affaires historiques resteront inchangés.',
      confirmText: 'Archiver la sélection',
      tone: 'danger',
    })
    if (!ok) return
    setBulkArchiving(true)
    try {
      const { data } = await api.post('/products/bulk/archive', { product_ids: ids })
      toast.success(`${data.archived_count} élément(s) archivé(s)`)
      setSelectedProductIds(new Set())
      await load()
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Impossible d’archiver la sélection')
    } finally {
      setBulkArchiving(false)
    }
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
    const header = 'code;name;product_type;pricing_mode;category;supplier;barcode;unit;purchase_unit;purchase_to_base_factor;allow_fractional_sale;purchase_price;sale_price;stock_quantity;min_stock;tax_rate;tva_enabled;description;is_active'
    const sample = 'PRD-EXEMPLE;Cahier scolaire;product;fixed;Papeterie;Fournisseur exemple;6110000000000;pcs;boite;12;0;10;15;25;5;20;1;Cahier exemple;1'
    downloadBlob(new Blob([`\ufeff${header}\n${sample}\n`], { type: 'text/csv;charset=utf-8' }), 'modele-import-produits.csv')
  }

  const handleGenerateMissingEan = async () => {
    const ok = await confirm({
      title:'Générer les codes EAN manquants',
      message:'Un EAN-13 interne unique sera attribué uniquement aux produits et packs actifs qui n’en possèdent pas. Les codes existants resteront inchangés.',
      confirmText:'Générer les EAN',
      tone:'success',
    })
    if (!ok || generatingEan) return
    setGeneratingEan(true)
    try {
      const { data } = await api.post('/products/bulk/generate-ean')
      toast.success(data.generated_count
        ? `${data.generated_count} code(s) EAN-13 généré(s)`
        : 'Tous les produits possèdent déjà un code EAN')
      await load()
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Impossible de générer les codes EAN')
    } finally {
      setGeneratingEan(false)
    }
  }

  const openLabelPrint = async () => {
    let printable = selectedProducts.filter(product => isValidEan13(product.barcode))
    const invalid = selectedProducts.filter(product => (
      product.product_type !== 'service' && !isValidEan13(product.barcode)
    ))
    if (invalid.length) {
      const repair = await confirm({
        title:`Corriger ${invalid.length} code(s) EAN`,
        message:'Le chiffre de contrôle sera recalculé sans changer les 12 premiers chiffres. Les codes manquants recevront un EAN-13 interne unique.',
        confirmText:'Corriger et continuer',
        tone:'success',
      })
      if (repair) {
        setLabelPrint(current => ({ ...current, repairing:true }))
        try {
          const { data } = await api.post('/products/bulk/repair-ean', {
            product_ids:invalid.map(product => product.id),
          })
          const repairedById = new Map(data.products.map(product => [product.id, product.barcode]))
          const correctedSelection = selectedProducts.map(product => (
            repairedById.has(product.id) ? { ...product, barcode:repairedById.get(product.id) } : product
          ))
          setProducts(current => current.map(product => (
            repairedById.has(product.id) ? { ...product, barcode:repairedById.get(product.id) } : product
          )))
          printable = correctedSelection.filter(product => isValidEan13(product.barcode))
          toast.success(`${data.repaired_count} code(s) EAN-13 corrigé(s)`)
        } catch (error) {
          toast.error(error.response?.data?.detail || 'Impossible de corriger les codes EAN')
        } finally {
          setLabelPrint(current => ({ ...current, repairing:false }))
        }
      }
    }
    if (!printable.length) return toast.error('Aucun produit avec un EAN-13 valide')
    const ignored = selectedProducts.length - printable.length
    if (ignored) toast(`${ignored} service(s) ou code(s) non EAN seront ignorés`, { icon:'ℹ️' })
    setLabelPrint(current => ({ ...current, open:true, printing:false }))
  }

  const handlePrintLabels = async () => {
    if (labelPrint.printing) return
    setLabelPrint(current => ({ ...current, printing:true }))
    try {
      await printProductLabels()
    } finally {
      setLabelPrint(current => ({ ...current, printing:false }))
    }
  }

  const handleDownloadLabelsPdf = async () => {
    if (labelPrint.downloading) return
    const printable = selectedProducts.filter(product => isValidEan13(product.barcode))
    if (!printable.length) return toast.error('Aucun EAN-13 valide à exporter')
    setLabelPrint(current => ({ ...current, downloading:true }))
    try {
      await downloadProductLabelsPdf({
        products:printable,
        copies:labelPrint.copies,
        size:labelPrint.size,
        currency:settings.currency || 'MAD',
        showName:labelPrint.showName,
        showPrice:labelPrint.showPrice,
      })
      toast.success('PDF des étiquettes téléchargé')
    } catch {
      toast.error('Impossible de générer le PDF des étiquettes')
    } finally {
      setLabelPrint(current => ({ ...current, downloading:false }))
    }
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
    <div className="page-content products-page">
      <div className="page-header">
        <div><h1 className="page-title">Catalogue</h1><p className="products-subtitle">Produits scolaires, services rapides et packs prêts à vendre.</p></div>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={handleGenerateMissingEan} disabled={generatingEan}>
            <Barcode size={16} /> {generatingEan ? 'Génération…' : 'Générer EAN'}
          </button>
          <button className="btn btn-secondary" onClick={handleTemplate}><FileSpreadsheet size={16} /> Modele CSV</button>
          <button className="btn btn-secondary" onClick={handleExport}><Download size={16} /> Export</button>
          <button className="btn btn-secondary" onClick={openImport}><Upload size={16} /> Import</button>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Nouvel élément</button>
        </div>
      </div>

      <div className="products-stats">
        <button className={typeFilter === '' ? 'active' : ''} onClick={() => setTypeFilter('')}><Boxes /><span><strong>{catalogTotals.total}</strong>Tout le catalogue</span></button>
        <button className={typeFilter === 'product' ? 'active' : ''} onClick={() => setTypeFilter('product')}><Package /><span><strong>{catalogTotals.product}</strong>Produits</span></button>
        <button className={typeFilter === 'service' ? 'active' : ''} onClick={() => setTypeFilter('service')}><Sparkles /><span><strong>{catalogTotals.service}</strong>Services</span></button>
        <button className={typeFilter === 'bundle' ? 'active' : ''} onClick={() => setTypeFilter('bundle')}><ShoppingBag /><span><strong>{catalogTotals.bundle}</strong>Packs scolaires</span></button>
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
            <option value="bundle">Pack scolaire</option>
          </select>
        </div>

        {selectedProducts.length > 0 && (
          <div className="catalog-bulk-bar">
            <div>
              <span className="catalog-selection-count">{selectedProducts.length}</span>
              <strong>élément(s) sélectionné(s)</strong>
              <small>Les documents et le chiffre d’affaires historiques seront conservés.</small>
            </div>
            <div className="catalog-bulk-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedProductIds(new Set())} disabled={bulkArchiving}>Annuler la sélection</button>
              <button className="btn btn-secondary btn-sm" onClick={openLabelPrint} disabled={bulkArchiving}>
                <Printer size={15} /> Imprimer étiquettes
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleBulkArchive} disabled={bulkArchiving}>
                <Trash2 size={15} /> {bulkArchiving ? 'Archivage…' : 'Archiver'}
              </button>
            </div>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead><tr>
              <th className="catalog-select-cell">
                <button
                  className="catalog-checkbox"
                  type="button"
                  role="checkbox"
                  aria-checked={someVisibleSelected ? 'mixed' : allVisibleSelected}
                  data-state={someVisibleSelected ? 'mixed' : allVisibleSelected ? 'checked' : 'unchecked'}
                  onClick={toggleAllVisibleProducts}
                  aria-label="Sélectionner tous les produits visibles"
                >
                  {someVisibleSelected ? <Minus size={13} strokeWidth={3} /> : allVisibleSelected ? <Check size={13} strokeWidth={3} /> : null}
                </button>
              </th>
              <th>Produit</th><th>Code</th><th>Nom</th><th>Catégorie</th><th>P. Achat</th><th>P. Vente</th><th>Stock</th><th>Marge</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={10} label="Generation du catalogue produits..." />
              ) : products.length === 0 ? (
                <tr><td colSpan={10}><div className="empty-state"><Package size={40} /><p>Aucun produit</p></div></td></tr>
              ) : products.map(p => (
                <tr key={p.id} className={`catalog-row type-${p.product_type} ${selectedProductIds.has(p.id) ? 'is-selected' : ''}`}>
                  <td className="catalog-select-cell">
                    <button
                      className="catalog-checkbox"
                      type="button"
                      role="checkbox"
                      aria-checked={selectedProductIds.has(p.id)}
                      data-state={selectedProductIds.has(p.id) ? 'checked' : 'unchecked'}
                      onClick={() => toggleProductSelection(p.id)}
                      aria-label={`Sélectionner ${p.name}`}
                    >
                      {selectedProductIds.has(p.id) ? <Check size={13} strokeWidth={3} /> : null}
                    </button>
                  </td>
                  <td><ProductThumb product={p} /></td>
                  <td><span className="font-mono text-sm text-muted">{p.code}</span></td>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:'.5rem' }}>
                      <strong>{p.name}</strong>
                      {p.is_low_stock && <span className="badge badge-warning" style={{ fontSize:'.65rem' }}><AlertTriangle size={10} /> Faible</span>}
                    </div>
                    <div className={`product-type-label type-${p.product_type}`}>{p.product_type === 'service' ? 'Service sans stock' : p.product_type === 'bundle' ? 'Pack scolaire' : `Stock en ${p.unit}`}</div>
                  </td>
                  <td>{p.category_name || <span className="text-muted">—</span>}</td>
                  <td>{p.product_type === 'service' ? <span className="text-muted">—</span> : `${fmt(p.purchase_price)} MAD`}</td>
                  <td className="font-semibold">{fmt(p.sale_price)} MAD</td>
                  <td>
                    {p.product_type === 'product'
                      ? <span style={{ color: p.is_low_stock ? 'var(--danger)' : 'var(--success)' }}>{p.stock_quantity} {p.unit}</span>
                      : p.product_type === 'bundle'
                        ? <span className="bundle-availability">{p.stock_quantity} pack(s)</span>
                        : <span className="text-muted">Sans stock</span>}
                  </td>
                  <td>
                    {p.product_type === 'service' ? <span className="text-muted">—</span> : <span style={{ color: p.margin_pct >= 20 ? 'var(--success)' : p.margin_pct > 0 ? 'var(--warning)' : 'var(--danger)' }}>{fmt(p.margin_pct, 1)}%</span>}
                  </td>
                  <td>
                    <div className="flex gap-2 catalog-row-actions">
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

      {labelPrint.open && (
        <div className="modal-overlay" onClick={event => event.target === event.currentTarget && setLabelPrint(current => ({ ...current, open:false }))}>
          <div className="modal" style={{ maxWidth:680 }}>
            <div className="modal-header">
              <div><span className="modal-eyebrow">Catalogue · EAN-13</span><h2>Imprimer les étiquettes</h2></div>
              <button className="btn btn-secondary btn-icon" onClick={() => setLabelPrint(current => ({ ...current, open:false }))}><X size={17}/></button>
            </div>
            <div className="modal-body">
              <div className="form-grid cols-2">
                <div className="form-group">
                  <label className="form-label">Format du label</label>
                  <select value={labelPrint.size} onChange={event => setLabelPrint(current => ({ ...current, size:event.target.value }))}>
                    <option value="40x30">40 × 30 mm</option>
                    <option value="50x30">50 × 30 mm</option>
                    <option value="70x37">70 × 37 mm</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Copies par produit</label>
                  <input type="number" min="1" max="20" step="1" value={labelPrint.copies} onChange={event => setLabelPrint(current => ({ ...current, copies:Math.min(Math.max(Number(event.target.value) || 1, 1), 20) }))}/>
                </div>
              </div>
              <div className="flex gap-3" style={{ marginBlock:'.8rem' }}>
                <label className="checkbox-label"><input type="checkbox" checked={labelPrint.showName} onChange={event => setLabelPrint(current => ({ ...current, showName:event.target.checked }))}/> Nom du produit</label>
                <label className="checkbox-label"><input type="checkbox" checked={labelPrint.showPrice} onChange={event => setLabelPrint(current => ({ ...current, showPrice:event.target.checked }))}/> Prix de vente</label>
              </div>
              <div className="product-label-preview">
                <ProductLabel
                  product={selectedProducts.find(product => isValidEan13(product.barcode)) || selectedProducts[0]}
                  currency={settings.currency || 'MAD'}
                  showName={labelPrint.showName}
                  showPrice={labelPrint.showPrice}
                />
              </div>
              <p className="text-muted text-sm" style={{ marginTop:'.7rem' }}>
                {selectedProducts.filter(product => isValidEan13(product.barcode)).length} produit(s) × {labelPrint.copies} copie(s)
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setLabelPrint(current => ({ ...current, open:false }))}>Annuler</button>
              <button className="btn btn-secondary" disabled={labelPrint.downloading} onClick={handleDownloadLabelsPdf}>
                <Download size={16}/> {labelPrint.downloading ? 'Génération…' : 'Télécharger PDF'}
              </button>
              <button className="btn btn-primary" disabled={labelPrint.printing} onClick={handlePrintLabels}><Printer size={16}/> {labelPrint.printing ? 'Préparation…' : 'Imprimer'}</button>
            </div>
          </div>
        </div>
      )}

      {labelPrint.open && createPortal(
        <ProductLabelsPrintDocument
          products={selectedProducts.filter(product => isValidEan13(product.barcode))}
          copies={labelPrint.copies}
          size={labelPrint.size}
          currency={settings.currency || 'MAD'}
          showName={labelPrint.showName}
          showPrice={labelPrint.showPrice}
        />,
        document.body,
      )}

      {modal === 'import' && (
        <div className="modal-overlay" onClick={e => !importing && e.target === e.currentTarget && setModal(null)}>
          <div className="modal modal-xl product-form-modal">
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
                  <span>{importFile ? `${(importFile.size / 1024).toFixed(1)} KB` : `Colonnes: code, name, category, supplier, prix, stock${vatEnabled ? ', TVA' : ''}...`}</span>
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
              <div><span className="modal-eyebrow">Catalogue</span><h2>{!selected ? 'Nouvel élément' : `Modifier ${selected.name}`}</h2></div>
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
                <div className="form-group ean-form-group" style={{ gridColumn:'span 2' }}>
                  <label className="form-label">Code EAN</label>
                  <div className={`ean-scanner-field ${form.barcode ? 'has-value' : ''}`}>
                    <Barcode size={18}/>
                    <input
                      value={form.barcode || ''}
                      onChange={event => setForm(current => ({ ...current, barcode:event.target.value.replace(/\s/g, '') }))}
                      placeholder="Scanner ou saisir le code EAN"
                      aria-label="Code EAN"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={100}
                    />
                    <button
                      type="button"
                      className={`btn btn-secondary ean-scan-trigger ${eanScanner?.connected ? 'is-connected' : ''} ${eanArmed ? 'is-armed' : ''}`}
                      onClick={openEanScanner}
                      disabled={eanScannerStarting}
                    >
                      {eanScannerStarting ? <span className="spinner" style={{width:16,height:16}}/> : <Smartphone size={17}/>}
                      {eanScanner?.connected ? (eanArmed ? 'En attente…' : 'Scanner maintenant') : 'Connecter Scanner'}
                    </button>
                    {form.barcode && (
                      <button type="button" className="btn btn-secondary btn-icon ean-clear-btn" onClick={() => setForm(current => ({ ...current, barcode:'' }))} title="Effacer le code EAN">
                        <X size={15}/>
                      </button>
                    )}
                  </div>
                  <small className={`ean-field-hint ${eanScanner?.connected ? 'is-connected' : ''}`}>
                    {form.barcode
                      ? 'Code EAN modifiable manuellement ou remplaçable par un nouveau scan'
                      : eanArmed
                        ? 'Présentez maintenant le code devant la caméra du téléphone'
                        : eanScanner?.connected
                          ? 'Téléphone connecté — scannez ou saisissez le code manuellement'
                          : 'Saisissez le code manuellement ou connectez le téléphone une seule fois'}
                  </small>
                </div>
                <div className="form-group product-type-picker" style={{ gridColumn:'1/-1' }}>
                  <label className="form-label">Type d'élément</label>
                  <div>
                    {[
                      { value:'product', label:'Produit physique', detail:'Stock, achat et vente', icon:Package },
                      { value:'service', label:'Service', detail:'Sans gestion de stock', icon:Sparkles },
                      { value:'bundle', label:'Pack scolaire', detail:'Composé de plusieurs produits', icon:ShoppingBag },
                    ].map(option => {
                      const Icon = option.icon
                      return <button type="button" key={option.value} className={form.product_type === option.value ? 'active' : ''} onClick={() => {
                        const productType = option.value
                    setForm(f => ({
                      ...f,
                      product_type: productType,
                      pricing_mode: productType === 'service' ? 'editable' : 'fixed',
                      unit: productType === 'service' && f.unit === 'pcs' ? 'page' : f.unit,
                    }))
                    if (!selected) loadNextCode(productType)
                      }}><Icon size={19}/><span><strong>{option.label}</strong><small>{option.detail}</small></span></button>
                    })}
                  </div>
                </div>
                {form.product_type === 'service' && (
                  <div className="form-group">
                    <label className="form-label">Tarification du service</label>
                    <select {...F('pricing_mode')}>
                      <option value="fixed">Prix fixe</option>
                      <option value="editable">Prix proposé, modifiable en caisse</option>
                      <option value="manual">Prix à saisir à chaque vente</option>
                    </select>
                  </div>
                )}
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
                  <label className="form-label">Unité de vente et de stock</label>
                  <select {...F('unit')}>
                    {productUnits.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <button type="button" className="btn btn-sm reference-action-btn" onClick={openCatalogSettings}>
                    <Plus size={14} /> Gerer les unites
                  </button>
                </div>
                {form.product_type === 'product' && (<>
                  <div className="form-group">
                    <label className="form-label">Unité d'achat</label>
                    <select {...F('purchase_unit')}>
                      {productUnits.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Contenu de l'unité d'achat</label>
                    <input {...F('purchase_to_base_factor')} type="number" min="0.0001" step="0.0001" />
                    <small className="text-muted">1 {form.purchase_unit || 'unité'} = {form.purchase_to_base_factor || 1} {form.unit || 'pièce'}(s)</small>
                  </div>
                  <div className="form-group fractional-option-group">
                    <span className="form-label">Vente fractionnée</span>
                    <label className="fractional-option">
                      <input
                        type="checkbox"
                        checked={Boolean(form.allow_fractional_sale)}
                        onChange={e => setForm(f => ({ ...f, allow_fractional_sale: e.target.checked }))}
                      />
                      <span className="fractional-switch" aria-hidden="true"><i /></span>
                      <span className="fractional-copy">
                        <strong>Quantités décimales</strong>
                        <small>{form.allow_fractional_sale ? 'Autorisées' : 'Désactivées'}</small>
                      </span>
                    </label>
                  </div>
                </>)}
                {form.product_type === 'bundle' && (
                  <div className="form-group bundle-builder" style={{ gridColumn:'1/-1' }}>
                    <div className="bundle-builder-head">
                      <div><label className="form-label">Composition du pack scolaire</label><small>Le stock du pack dépend du composant disponible en plus petite quantité.</small></div>
                      <span>{bundleComponents.length} composant(s)</span>
                    </div>
                    {bundleComponents.map((component, index) => (
                      <div className="bundle-component-row" key={index}>
                        <select
                          value={component.product_id}
                          onChange={e => setBundleComponents(rows => rows.map((row, i) => i === index ? { ...row, product_id:+e.target.value } : row))}
                        >
                          <option value="">— Produit —</option>
                          {products.filter(p => p.product_type === 'product').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <input
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          value={component.quantity}
                          onChange={e => setBundleComponents(rows => rows.map((row, i) => i === index ? { ...row, quantity:+e.target.value||1 } : row))}
                          placeholder="Quantité"
                        />
                        <div className="bundle-component-stock">
                          {component.product_id ? <>
                            <strong>{fmt(productMap.get(+component.product_id)?.stock_quantity || 0, 0)} {productMap.get(+component.product_id)?.unit || ''}</strong>
                            <span>disponible</span>
                          </> : <span>Choisissez un produit</span>}
                        </div>
                        <button type="button" className="btn btn-danger btn-icon" onClick={() => setBundleComponents(rows => rows.filter((_, i) => i !== index))}>×</button>
                      </div>
                    ))}
                    {bundleComponents.length === 0 && <div className="bundle-builder-empty"><ShoppingBag size={28}/><strong>Pack vide</strong><span>Ajoutez les articles qui composent cette liste scolaire.</span></div>}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBundleComponents(rows => [...rows, { product_id:'', quantity:1 }])}>
                      <Plus size={14} /> Ajouter un produit au pack
                    </button>
                    {bundleComponents.some(component => component.product_id) && (
                      <div className="bundle-capacity-preview">
                        <span>Capacité estimée</span>
                        <strong>{Math.min(...bundleComponents.filter(component => component.product_id && component.quantity > 0).map(component => Math.floor((productMap.get(+component.product_id)?.stock_quantity || 0) / component.quantity)))} pack(s)</strong>
                      </div>
                    )}
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Prix d'achat (MAD)</label>
                  <input {...F('purchase_price')} type="number" min="0" step="0.01" />
                </div>
                <div className="form-group">
                  <label className="form-label">{vatEnabled ? 'Prix de vente HT (MAD)' : 'Prix de vente (MAD)'}</label>
                  <input {...F('sale_price')} type="number" min="0" step="0.01" />
                </div>
                {vatEnabled ? <div className="form-group">
                  <label className="form-label">TVA (%)</label>
                  <select value={form.tax_rate||20} onChange={e => setForm(f=>({...f,tax_rate:+e.target.value}))}>
                    {[0,7,10,14,20].map(r => <option key={r} value={r}>{r}%</option>)}
                  </select>
                </div> : null}
                {form.product_type === 'product' && <>
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
                  {vatEnabled ? <>&nbsp;— Prix TTC: <strong>{fmt(+form.sale_price * (1 + (+form.tax_rate||20)/100))} MAD</strong></> : null}
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

      {eanScannerModalOpen && eanScanner && (
        <div className="modal-overlay ean-scanner-overlay">
          <div className="modal ean-scanner-modal" role="dialog" aria-modal="true" aria-labelledby="ean-scanner-title">
            <div className="modal-header">
              <div><span className="modal-eyebrow">Catalogue · EAN</span><h2 id="ean-scanner-title">Scanner le code du produit</h2></div>
              <button className="btn btn-secondary btn-icon" onClick={() => setEanScannerModalOpen(false)} aria-label="Fermer"><X size={17}/></button>
            </div>
            <div className="modal-body ean-scanner-body">
              <div className="ean-scanner-qr">
                <img src={eanScanner.qrDataUrl} alt="QR Code pour scanner le code EAN"/>
                <span aria-hidden="true"/>
              </div>
              <div className="ean-scanner-copy">
                <span className={`ean-connection-state ${eanScanner.connected ? 'is-connected' : ''}`}>
                  <Wifi size={17}/>
                  {eanScanner.connected ? 'Téléphone connecté — présentez le code EAN' : 'En attente du téléphone…'}
                </span>
                <h3>Un seul scan suffit</h3>
                <p>Ouvrez ce QR Code avec le téléphone, démarrez la caméra puis placez-la devant le code-barres du produit.</p>
                <div className="ean-scan-flow">
                  <span><strong>1</strong> Ouvrir</span>
                  <span><strong>2</strong> Viser</span>
                  <span><strong>3</strong> EAN ajouté</span>
                </div>
                <small>Gardez la page Scanner ouverte sur le téléphone. Elle servira pour tous les produits suivants.</small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-danger" onClick={() => stopEanScanner()}>Déconnecter le téléphone</button>
              <button className="btn btn-primary" onClick={() => setEanScannerModalOpen(false)}>Continuer en arrière-plan</button>
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
