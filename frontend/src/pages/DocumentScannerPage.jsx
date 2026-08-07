import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Camera, Check, ClipboardPaste, Crop, Eye, FileArchive, FileCheck2, FileImage, FileText, GripVertical, ImagePlus, Lock, Plus, RefreshCw, RotateCw, ScanLine, SlidersHorizontal, Sparkles, Trash2, UploadCloud, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { api } from '../lib/api'
import { autoDetectDocumentCorners, defaultDocumentCorners, filterDocument, perspectiveDocument, rotateDocument, suggestDocumentAdjustments, validateDocumentCorners } from '../lib/documentScan'
import './DocumentScannerPage.css'

const FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'enhanced', label: 'Document net' },
  { id: 'color', label: 'Couleur nette' },
  { id: 'gray', label: 'Niveaux de gris' },
  { id: 'bw', label: 'Noir & blanc' },
]
const MAX_SESSION_PAGES = 12

// Canvases cannot be safely serialized in localStorage. This module-level
// draft keeps their full-resolution pixel buffers alive while React routes are
// changed, without uploading private documents or duplicating them in memory.
let scannerNavigationDraft = null

async function decodeImageFile(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' })
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function loadImageFile(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Choisissez une image JPG, PNG ou WebP')
  if (file.size > 20 * 1024 * 1024) throw new Error('Image trop volumineuse. Maximum 20 MB')
  const bitmap = await decodeImageFile(file)
  const scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return canvas
}

export default function DocumentScannerPage() {
  const confirm = useConfirm()
  const restoredDraft = useRef(scannerNavigationDraft).current
  const restoredIndex = restoredDraft?.pages?.length
    ? Math.max(0, Math.min(restoredDraft.activeIndex, restoredDraft.pages.length - 1))
    : -1
  const restoredPage = restoredIndex >= 0 ? restoredDraft.pages[restoredIndex] : null
  const editorRef = useRef(null)
  const previewRef = useRef(null)
  const sourceRef = useRef(restoredPage?.source || null)
  const correctedRef = useRef(restoredPage?.corrected || null)
  const resultRef = useRef(restoredPage?.result || null)
  const draggingRef = useRef(null)
  const draggedPageRef = useRef(null)
  const activePageIdRef = useRef(restoredPage?.id || null)
  const didDragPageRef = useRef(false)
  const [pages, setPages] = useState(() => restoredDraft?.pages || [])
  const [activeIndex, setActiveIndex] = useState(restoredIndex)
  const [draggedPageId, setDraggedPageId] = useState(null)
  const [dragOverPageId, setDragOverPageId] = useState(null)
  const [fileName, setFileName] = useState(restoredPage?.name || '')
  const [corners, setCorners] = useState(() => restoredPage?.corners || [])
  const [step, setStep] = useState(restoredPage ? (restoredPage.result ? 'preview' : 'crop') : 'empty')
  const [filter, setFilter] = useState(restoredPage?.filter || 'enhanced')
  const [brightness, setBrightness] = useState(restoredPage?.brightness ?? 4)
  const [contrast, setContrast] = useState(restoredPage?.contrast ?? 18)
  const [formatMode, setFormatMode] = useState(restoredPage?.formatMode || 'auto')
  const [processing, setProcessing] = useState(false)
  const [processingLabel, setProcessingLabel] = useState('Préparation des images…')
  const [dragActive, setDragActive] = useState(false)
  const [comparisonActive, setComparisonActive] = useState(false)
  const [comparisonPosition, setComparisonPosition] = useState(50)
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false)
  const [pdfName, setPdfName] = useState('documents-scannes')
  const [pdfQuality, setPdfQuality] = useState('high')
  const cornerValidation = useMemo(() => {
    const source = sourceRef.current
    return source && corners.length === 4
      ? validateDocumentCorners(corners, source.width, source.height)
      : { valid: false, reason: '' }
  }, [corners])
  const selectedCount = pages.filter(page => page.selected).length

  const drawEditor = useCallback(() => {
    const canvas = editorRef.current
    const source = sourceRef.current
    if (!canvas || !source || corners.length !== 4) return
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d')
    context.drawImage(source, 0, 0)
    context.save()
    context.fillStyle = 'rgba(3, 13, 25, .36)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.globalCompositeOperation = 'destination-out'
    context.beginPath()
    context.moveTo(corners[0].x, corners[0].y)
    corners.slice(1).forEach(point => context.lineTo(point.x, point.y))
    context.closePath()
    context.fill()
    context.restore()
    context.save()
    const validShape = validateDocumentCorners(corners, source.width, source.height).valid
    context.strokeStyle = validShape ? '#22c55e' : '#ef4444'
    context.lineWidth = Math.max(3, source.width / 550)
    context.shadowColor = validShape ? 'rgba(34,197,94,.55)' : 'rgba(239,68,68,.58)'
    context.shadowBlur = Math.max(5, source.width / 300)
    context.beginPath()
    context.moveTo(corners[0].x, corners[0].y)
    corners.slice(1).forEach(point => context.lineTo(point.x, point.y))
    context.closePath()
    context.stroke()
    corners.forEach((point, index) => {
      const radius = Math.max(12, source.width / 85)
      context.beginPath()
      context.arc(point.x, point.y, radius, 0, Math.PI * 2)
      context.fillStyle = '#fff'
      context.fill()
      context.lineWidth = Math.max(4, source.width / 450)
      context.strokeStyle = validShape ? '#16a34a' : '#dc2626'
      context.stroke()
      context.fillStyle = validShape ? '#166534' : '#991b1b'
      context.font = `700 ${Math.max(12, source.width / 95)}px sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(String(index + 1), point.x, point.y)
    })
    corners.forEach((point, index) => {
      const next = corners[(index + 1) % 4]
      const middle = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }
      const size = Math.max(18, source.width / 62)
      context.beginPath()
      context.roundRect(middle.x - size / 2, middle.y - size / 2, size, size, Math.max(3, size * .18))
      context.fillStyle = validShape ? 'rgba(255,255,255,.94)' : 'rgba(254,242,242,.95)'
      context.fill()
      context.lineWidth = Math.max(3, source.width / 520)
      context.strokeStyle = validShape ? '#22c55e' : '#ef4444'
      context.stroke()
      context.beginPath()
      if (index % 2 === 0) {
        context.moveTo(middle.x - size * .22, middle.y)
        context.lineTo(middle.x + size * .22, middle.y)
      } else {
        context.moveTo(middle.x, middle.y - size * .22)
        context.lineTo(middle.x, middle.y + size * .22)
      }
      context.strokeStyle = validShape ? '#15803d' : '#b91c1c'
      context.lineWidth = Math.max(2, source.width / 700)
      context.stroke()
    })
    const drag = draggingRef.current
    if (drag?.last) {
      const point = drag.last
      const lensRadius = Math.max(62, source.width / 18)
      const sourceRadius = lensRadius / 2.8
      let lensX = point.x + lensRadius * 1.35
      let lensY = point.y - lensRadius * 1.35
      if (lensX + lensRadius > canvas.width) lensX = point.x - lensRadius * 1.35
      if (lensY - lensRadius < 0) lensY = point.y + lensRadius * 1.35
      context.save()
      context.beginPath()
      context.arc(lensX, lensY, lensRadius, 0, Math.PI * 2)
      context.clip()
      context.fillStyle = '#fff'
      context.fillRect(lensX - lensRadius, lensY - lensRadius, lensRadius * 2, lensRadius * 2)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(source, point.x - sourceRadius, point.y - sourceRadius, sourceRadius * 2, sourceRadius * 2, lensX - lensRadius, lensY - lensRadius, lensRadius * 2, lensRadius * 2)
      context.strokeStyle = 'rgba(8,103,242,.85)'
      context.lineWidth = Math.max(2, source.width / 800)
      context.beginPath()
      context.moveTo(lensX - lensRadius, lensY)
      context.lineTo(lensX + lensRadius, lensY)
      context.moveTo(lensX, lensY - lensRadius)
      context.lineTo(lensX, lensY + lensRadius)
      context.stroke()
      context.restore()
      context.beginPath()
      context.arc(lensX, lensY, lensRadius, 0, Math.PI * 2)
      context.lineWidth = Math.max(5, source.width / 380)
      context.strokeStyle = '#fff'
      context.stroke()
      context.lineWidth = Math.max(2, source.width / 760)
      context.strokeStyle = '#1677ff'
      context.stroke()
    }
    context.restore()
  }, [corners])

  const drawPreview = useCallback(() => {
    const canvas = previewRef.current
    const result = resultRef.current
    if (!canvas || !result) return
    canvas.width = result.width
    canvas.height = result.height
    const context = canvas.getContext('2d')
    context.drawImage(result, 0, 0)
    if (comparisonActive && correctedRef.current) {
      const split = Math.round(canvas.width * comparisonPosition / 100)
      context.save()
      context.beginPath()
      context.rect(0, 0, split, canvas.height)
      context.clip()
      context.drawImage(correctedRef.current, 0, 0, canvas.width, canvas.height)
      context.restore()
      context.fillStyle = '#1677ff'
      context.fillRect(Math.max(0, split - 2), 0, 4, canvas.height)
    }
  }, [comparisonActive, comparisonPosition])

  useEffect(() => {
    if (step !== 'crop') return
    const frame = requestAnimationFrame(drawEditor)
    return () => cancelAnimationFrame(frame)
  }, [drawEditor, step])
  useEffect(() => { drawPreview() }, [drawPreview, step, filter, brightness, contrast, comparisonActive, comparisonPosition])
  useEffect(() => {
    if (activeIndex < 0) return
    setPages(current => current.map((page, index) => index === activeIndex ? {
      ...page,
      corners,
      corrected: correctedRef.current,
      result: resultRef.current,
      filter,
      brightness,
      contrast,
      formatMode,
    } : page))
  }, [activeIndex, brightness, contrast, corners, filter, formatMode, step])
  useEffect(() => {
    if (!pages.length || activeIndex < 0) {
      scannerNavigationDraft = null
      return
    }
    const savedPages = pages.map((page, index) => index === activeIndex ? {
      ...page,
      corners,
      corrected: correctedRef.current,
      result: resultRef.current,
      filter,
      brightness,
      contrast,
      formatMode,
    } : page)
    scannerNavigationDraft = {
      pages: savedPages,
      activeIndex,
      savedAt: Date.now(),
    }
  }, [activeIndex, brightness, contrast, corners, filter, formatMode, pages, step])
  useEffect(() => {
    if (!pdfPreviewOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = event => {
      if (event.key === 'Escape' && !processing) setPdfPreviewOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [pdfPreviewOpen, processing])

  const updateResult = useCallback((nextFilter = filter, nextBrightness = brightness, nextContrast = contrast) => {
    if (!correctedRef.current) return
    resultRef.current = filterDocument(correctedRef.current, nextFilter, nextBrightness, nextContrast)
    requestAnimationFrame(drawPreview)
  }, [brightness, contrast, drawPreview, filter])

  const activatePage = useCallback((page, index) => {
    sourceRef.current = page.source
    correctedRef.current = page.corrected || null
    resultRef.current = page.result || null
    setActiveIndex(index)
    setFileName(page.name)
    setCorners(page.corners)
    setFilter(page.filter || 'enhanced')
    setBrightness(page.brightness ?? 4)
    setContrast(page.contrast ?? 18)
    setFormatMode(page.formatMode || 'auto')
    setStep(page.result ? 'preview' : 'crop')
    activePageIdRef.current = page.id
  }, [])

  const appendImageFiles = useCallback(async rawFiles => {
    const existing = new Set(pages.map(page => page.fingerprint).filter(Boolean))
    const uniqueFiles = []
    let duplicateCount = 0
    for (const file of rawFiles) {
      const fingerprint = `${file.name.toLowerCase()}|${file.size}|${file.lastModified || 0}`
      if (existing.has(fingerprint)) {
        duplicateCount += 1
        continue
      }
      existing.add(fingerprint)
      uniqueFiles.push({ file, fingerprint })
    }
    const files = uniqueFiles
    if (!files.length) {
      if (duplicateCount) toast(`${duplicateCount} doublon(s) déjà présent(s) dans la session`)
      return
    }
    const availableSlots = Math.max(0, MAX_SESSION_PAGES - pages.length)
    if (!availableSlots) {
      toast.error(`Maximum ${MAX_SESSION_PAGES} pages par session`)
      return
    }
    setProcessing(true)
    try {
      const additions = []
      let rejected = 0
      for (let fileIndex = 0; fileIndex < files.slice(0, availableSlots).length; fileIndex += 1) {
        const { file, fingerprint } = files[fileIndex]
        setProcessingLabel(`Analyse de la page ${fileIndex + 1} sur ${Math.min(files.length, availableSlots)}…`)
        try {
          const source = await loadImageFile(file)
          const name = file.name.replace(/\.[^.]+$/, '')
          additions.push({
            id: `${Date.now()}-${additions.length}-${Math.random().toString(36).slice(2)}`,
            name,
            fingerprint,
            source,
            thumb: source.toDataURL('image/jpeg', .68),
            corners: autoDetectDocumentCorners(source),
            corrected: null,
            result: null,
            selected: true,
            filter: 'enhanced',
            brightness: 4,
            contrast: 18,
            formatMode: 'auto',
          })
        } catch {
          rejected += 1
        }
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      if (!additions.length) throw new Error('Aucune image valide n’a pu être ajoutée')
      const firstIndex = pages.length
      const nextPages = [...pages, ...additions]
      setPages(nextPages)
      activatePage(nextPages[firstIndex], firstIndex)
      toast.success(`${additions.length} page(s) ajoutée(s) · contours détectés`)
      if (duplicateCount) toast(`${duplicateCount} doublon(s) ignoré(s)`)
      if (rejected) toast.error(`${rejected} fichier(s) non valide(s) ignoré(s)`)
      if (files.length > availableSlots) toast.error(`Session limitée à ${MAX_SESSION_PAGES} pages pour éviter un manque de mémoire`)
    } catch (error) {
      toast.error(error.message || 'Lecture de l’image impossible')
    } finally {
      setProcessing(false)
      setProcessingLabel('Préparation des images…')
    }
  }, [activatePage, pages])

  useEffect(() => {
    const onPaste = event => {
      if (processing) return
      const images = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'))
      if (images.length) {
        event.preventDefault()
        appendImageFiles(images)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [appendImageFiles, processing])

  const dropImages = async event => {
    event.preventDefault()
    setDragActive(false)
    const dropped = [...(event.dataTransfer?.files || [])]
    const archive = dropped.find(file => /\.(zip|rar|7z|tar|cbz)$/i.test(file.name))
    if (archive && dropped.length === 1) {
      const transfer = new DataTransfer()
      transfer.items.add(archive)
      await chooseArchive({ target: { files: transfer.files, value: '' } })
      return
    }
    await appendImageFiles(dropped.filter(file => file.type.startsWith('image/')))
  }

  const chooseFile = async event => {
    const files = [...(event.target.files || [])]
    try {
      await appendImageFiles(files)
    } finally {
      event.target.value = ''
    }
  }

  const chooseArchive = async event => {
    const archive = event.target.files?.[0]
    if (!archive) return
    setProcessing(true)
    try {
      const formData = new FormData()
      formData.append('archive', archive)
      const { data } = await api.post('/document-scanner/extract-archive', formData, {
        timeout: 120000,
      })
      const files = await Promise.all((data.images || []).map(async image => {
        const response = await fetch(`data:${image.type};base64,${image.content}`)
        return new File([await response.blob()], image.name, { type:image.type })
      }))
      setProcessing(false)
      await appendImageFiles(files)
      if (data.ignored) toast(`${data.ignored} fichier(s) non-image ou excédentaire(s) ignoré(s)`)
    } catch (error) {
      const status = error.response?.status
      const message = status === 404 || status === 405
        ? 'Le module d’archives attend le redémarrage du serveur. Lancez APPLIQUER-CORRECTION-SCANNER.cmd une seule fois.'
        : error.response?.data?.detail || error.message || 'Extraction de l’archive impossible'
      toast.error(message)
    } finally {
      setProcessing(false)
      event.target.value = ''
    }
  }

  const canvasPoint = event => {
    const canvas = editorRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    }
  }

  const onPointerDown = event => {
    if (!editorRef.current || corners.length !== 4) return
    const point = canvasPoint(event)
    const nearestCorner = corners.reduce((best, corner, index) => {
      const distance = Math.hypot(corner.x - point.x, corner.y - point.y)
      return distance < best.distance ? { index, distance } : best
    }, { index: 0, distance: Number.POSITIVE_INFINITY })
    const grabRadius = 42 * editorRef.current.width / editorRef.current.getBoundingClientRect().width
    if (nearestCorner.distance <= grabRadius) {
      draggingRef.current = { kind: 'corner', index: nearestCorner.index, last: point }
    } else {
      const nearestEdge = corners.reduce((best, corner, index) => {
        const next = corners[(index + 1) % 4]
        const middle = { x: (corner.x + next.x) / 2, y: (corner.y + next.y) / 2 }
        const distance = Math.hypot(middle.x - point.x, middle.y - point.y)
        return distance < best.distance ? { index, distance } : best
      }, { index: 0, distance: Number.POSITIVE_INFINITY })
      if (nearestEdge.distance > grabRadius) return
      draggingRef.current = { kind: 'edge', index: nearestEdge.index, last: point }
    }
    editorRef.current.setPointerCapture(event.pointerId)
  }

  const onPointerMove = event => {
    if (draggingRef.current == null) return
    const point = canvasPoint(event)
    const drag = draggingRef.current
    if (drag.kind === 'corner') {
      setCorners(current => current.map((corner, index) => index === drag.index ? point : corner))
      draggingRef.current = { ...drag, last: point }
    } else {
      const deltaX = point.x - drag.last.x
      const deltaY = point.y - drag.last.y
      const firstIndex = drag.index
      const secondIndex = (drag.index + 1) % 4
      const canvas = editorRef.current
      setCorners(current => current.map((corner, index) => (
        index === firstIndex || index === secondIndex
          ? {
              x: Math.max(0, Math.min(canvas.width, corner.x + deltaX)),
              y: Math.max(0, Math.min(canvas.height, corner.y + deltaY)),
            }
          : corner
      )))
      draggingRef.current = { ...drag, last: point }
    }
  }

  const onPointerUp = event => {
    draggingRef.current = null
    editorRef.current?.releasePointerCapture?.(event.pointerId)
    requestAnimationFrame(drawEditor)
  }

  const correctPerspective = async () => {
    if (!sourceRef.current || corners.length !== 4 || processing) return
    setProcessing(true)
    await new Promise(resolve => requestAnimationFrame(resolve))
    try {
      correctedRef.current = perspectiveDocument(sourceRef.current, corners, { formatMode, maxDimension: 3200 })
      resultRef.current = filterDocument(correctedRef.current, filter, brightness, contrast)
      setStep('preview')
      toast.success('Document redressé avec succès')
    } catch (error) {
      toast.error(error.message || 'Les coins sélectionnés sont invalides')
    } finally {
      setProcessing(false)
    }
  }

  const currentPagesSnapshot = () => pages.map((page, index) => index === activeIndex ? {
    ...page,
    corners,
    corrected: correctedRef.current,
    result: resultRef.current,
    filter,
    brightness,
    contrast,
    formatMode,
  } : page)

  const scanAllPages = async () => {
    if (!pages.length || processing) return
    setProcessing(true)
    try {
      const next = currentPagesSnapshot()
      for (let index = 0; index < next.length; index += 1) {
        const page = next[index]
        const validation = validateDocumentCorners(page.corners, page.source.width, page.source.height)
        if (!validation.valid) throw new Error(`Page ${index + 1}: ${validation.reason}`)
        page.corrected = perspectiveDocument(page.source, page.corners, { formatMode: page.formatMode, maxDimension: 3200 })
        page.result = filterDocument(page.corrected, page.filter, page.brightness, page.contrast)
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      setPages(next)
      activatePage(next[activeIndex < 0 ? 0 : activeIndex], activeIndex < 0 ? 0 : activeIndex)
      toast.success(`${next.length} page(s) scannée(s) avec succès`)
    } catch (error) {
      toast.error(error.message || 'Traitement groupé impossible')
    } finally {
      setProcessing(false)
    }
  }

  const detectCornersAgain = async () => {
    if (!sourceRef.current || processing) return
    setProcessing(true)
    await new Promise(resolve => requestAnimationFrame(resolve))
    try {
      setCorners(autoDetectDocumentCorners(sourceRef.current))
      toast.success('Contours recalculés')
    } catch {
      setCorners(defaultDocumentCorners(sourceRef.current.width, sourceRef.current.height))
      toast.error('Détection difficile : ajustez les coins manuellement')
    } finally {
      setProcessing(false)
    }
  }

  const changeFilter = value => {
    setFilter(value)
    updateResult(value, brightness, contrast)
  }

  const changeAdjustment = (type, value) => {
    const number = Number(value)
    if (type === 'brightness') {
      setBrightness(number)
      updateResult(filter, number, contrast)
    } else {
      setContrast(number)
      updateResult(filter, brightness, number)
    }
  }

  const autoEnhance = () => {
    if (!correctedRef.current || processing) return
    const suggestion = suggestDocumentAdjustments(correctedRef.current)
    setFilter(suggestion.filter)
    setBrightness(suggestion.brightness)
    setContrast(suggestion.contrast)
    updateResult(suggestion.filter, suggestion.brightness, suggestion.contrast)
    toast.success(`Amélioration automatique · ${suggestion.filter === 'color' ? 'couleurs préservées' : 'texte optimisé'}`)
  }

  const rotate = () => {
    if (!correctedRef.current) return
    correctedRef.current = rotateDocument(correctedRef.current)
    updateResult()
  }

  const downloadImage = () => {
    if (!resultRef.current) return
    resultRef.current.toBlob(blob => {
      if (!blob) return toast.error('Création de l’image impossible')
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${fileName || 'document-scanner'}.jpg`
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 1500)
    }, 'image/jpeg', .97)
  }

  const openPdfPreview = () => {
    if (!selectedCount) return toast.error('Sélectionnez au moins une page')
    const chosen = currentPagesSnapshot().filter(page => page.selected)
    setPdfName(chosen.length === 1 ? chosen[0].name : 'documents-scannes')
    setPdfPreviewOpen(true)
  }

  const downloadPdf = async () => {
    if (!pages.length) return
    setProcessing(true)
    try {
      const snapshot = currentPagesSnapshot()
      const chosen = snapshot.filter(page => page.selected)
      if (!chosen.length) throw new Error('Sélectionnez au moins une page')
      for (let index = 0; index < chosen.length; index += 1) {
        const page = chosen[index]
        if (!page.result) {
          const validation = validateDocumentCorners(page.corners, page.source.width, page.source.height)
          if (!validation.valid) throw new Error(`Page ${index + 1}: ${validation.reason}`)
          page.corrected = perspectiveDocument(page.source, page.corners, { formatMode: page.formatMode, maxDimension: 3200 })
          page.result = filterDocument(page.corrected, page.filter, page.brightness, page.contrast)
        }
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      const qualityMap = {
        compact: { jpeg: .82, compression: 'FAST' },
        balanced: { jpeg: .91, compression: 'MEDIUM' },
        high: { jpeg: .97, compression: 'SLOW' },
      }
      const exportQuality = qualityMap[pdfQuality] || qualityMap.high
      const { jsPDF } = await import('jspdf')
      const firstCanvas = chosen[0].result
      const firstOrientation = firstCanvas.width > firstCanvas.height ? 'landscape' : 'portrait'
      const pdf = new jsPDF({ orientation: firstOrientation, unit: 'mm', format: 'a4', compress: true })
      chosen.forEach((page, index) => {
        const canvas = page.result
        const orientation = canvas.width > canvas.height ? 'landscape' : 'portrait'
        if (index > 0) pdf.addPage('a4', orientation)
        const pageWidth = pdf.internal.pageSize.getWidth()
        const pageHeight = pdf.internal.pageSize.getHeight()
        const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
        const width = canvas.width * ratio
        const height = canvas.height * ratio
        pdf.addImage(canvas.toDataURL('image/jpeg', exportQuality.jpeg), 'JPEG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height, undefined, exportQuality.compression)
      })
      const safeName = (pdfName || 'documents-scannes').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'documents-scannes'
      pdf.save(`${safeName}.pdf`)
      const downloadedCount = chosen.length
      setPdfPreviewOpen(false)
      reset()
      toast.success(`PDF créé avec ${downloadedCount} page(s) · mémoire du scanner libérée`)
    } catch (error) {
      toast.error(error.message || 'Création du PDF impossible')
    } finally {
      setProcessing(false)
    }
  }

  const togglePageSelection = index => {
    setPages(current => current.map((page, pageIndex) => pageIndex === index ? { ...page, selected: !page.selected } : page))
  }

  const selectAllPages = selected => {
    setPages(current => current.map(page => ({ ...page, selected })))
  }

  const onPageDragStart = (event, page) => {
    if (event.target.closest?.('.scanner-page-tools')) {
      event.preventDefault()
      return
    }
    const snapshot = currentPagesSnapshot()
    setPages(snapshot)
    draggedPageRef.current = page.id
    activePageIdRef.current = snapshot[activeIndex]?.id || null
    didDragPageRef.current = false
    setDraggedPageId(page.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', page.id)
    requestAnimationFrame(() => {
      didDragPageRef.current = true
    })
  }

  const onPageDragOver = (event, targetId) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const sourceId = draggedPageRef.current
    if (!sourceId || sourceId === targetId) return
    setDragOverPageId(targetId)
    const sourceIndex = pages.findIndex(page => page.id === sourceId)
    const targetIndex = pages.findIndex(page => page.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return
    const next = [...pages]
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    setPages(next)
    const nextActive = next.findIndex(page => page.id === activePageIdRef.current)
    if (nextActive >= 0) setActiveIndex(nextActive)
  }

  const onPageDragEnd = () => {
    draggedPageRef.current = null
    setDraggedPageId(null)
    setDragOverPageId(null)
    setTimeout(() => { didDragPageRef.current = false }, 0)
  }

  const openPageFromCard = (page, index) => {
    if (didDragPageRef.current) return
    activatePage(page, index)
  }

  const movePage = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= pages.length) return
    const next = currentPagesSnapshot()
    ;[next[index], next[target]] = [next[target], next[index]]
    const nextActive = activeIndex === index ? target : activeIndex === target ? index : activeIndex
    setPages(next)
    activatePage(next[nextActive], nextActive)
  }

  const removePage = index => {
    const next = currentPagesSnapshot().filter((_, pageIndex) => pageIndex !== index)
    setPages(next)
    if (!next.length) {
      sourceRef.current = null
      correctedRef.current = null
      resultRef.current = null
      setActiveIndex(-1)
      setCorners([])
      setStep('empty')
      setFileName('')
      return
    }
    const nextActive = index === activeIndex
      ? Math.min(index, next.length - 1)
      : index < activeIndex ? activeIndex - 1 : activeIndex
    activatePage(next[nextActive], nextActive)
  }

  const reset = () => {
    scannerNavigationDraft = null
    const canvases = new Set([
      sourceRef.current,
      correctedRef.current,
      resultRef.current,
      ...pages.flatMap(page => [page.source, page.corrected, page.result]),
    ].filter(Boolean))
    canvases.forEach(canvas => {
      // Resetting dimensions releases the large pixel backing store immediately.
      try {
        canvas.width = 1
        canvas.height = 1
      } catch {
        // A decoded image fallback has no writable canvas dimensions.
      }
    })
    sourceRef.current = null
    correctedRef.current = null
    resultRef.current = null
    setCorners([])
    setStep('empty')
    setFileName('')
    setPages([])
    setActiveIndex(-1)
  }

  const cancelSession = async () => {
    if (!pages.length) return
    const accepted = await confirm({
      title: 'Annuler la session de scan ?',
      message: `Les ${pages.length} page(s), les coins ajustés et les améliorations seront supprimés définitivement de cette session.`,
      confirmText: 'Annuler la session',
      cancelText: 'Conserver',
      tone: 'danger',
    })
    if (!accepted) return
    setPdfPreviewOpen(false)
    reset()
    toast.success('Session de scan annulée et mémoire libérée')
  }

  return (
    <div className="page-content document-scanner-page">
      <header className="page-header scanner-page-header">
        <div>
          <span className="scanner-eyebrow"><ScanLine size={15}/> Scanner intelligent</span>
          <h1 className="page-title">Scanner un document</h1>
          <p>Redressez une photo prise au téléphone et exportez-la comme un vrai scan.</p>
        </div>
        <div className="scanner-header-status">
          {pages.length ? <span className="scanner-draft-status"><Check size={14}/> Session conservée pendant la navigation</span> : null}
          <span className="scanner-private"><Lock size={15}/> Traitement privé sur cet appareil</span>
        </div>
      </header>

      {step === 'empty' ? (
        <section
          className={`scanner-upload-card ${dragActive ? 'is-dragging' : ''}`}
          onDragEnter={event => { event.preventDefault(); setDragActive(true) }}
          onDragOver={event => { event.preventDefault(); setDragActive(true) }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false) }}
          onDrop={dropImages}
        >
          <div className="scanner-drop-overlay"><UploadCloud size={42}/><strong>Déposez les fichiers ici</strong><span>Photos ou archive WhatsApp</span></div>
          <div className="scanner-upload-icon"><ImagePlus size={38}/></div>
          <h2>Ajoutez vos documents</h2>
          <p>Sélectionnez une ou plusieurs photos. Chaque page sera détectée et ajustée séparément avant la création du PDF.</p>
          <div className="scanner-upload-actions">
            <label className="btn btn-primary scanner-file-button">
              <ImagePlus size={18}/> Choisir les photos
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseFile}/>
            </label>
            <label className="btn btn-secondary scanner-file-button scanner-camera-button">
              <Camera size={18}/> Prendre une photo
              <input type="file" accept="image/*" capture="environment" onChange={chooseFile}/>
            </label>
            <label className="btn btn-secondary scanner-file-button scanner-archive-button">
              <FileArchive size={18}/> Importer ZIP / RAR
              <input type="file" accept=".zip,.rar,.7z,.tar,.cbz,application/zip,application/x-rar-compressed" onChange={chooseArchive}/>
            </label>
          </div>
          <small className="scanner-archive-hint">ZIP, RAR, 7Z, TAR ou CBZ · images WhatsApp extraites et triées automatiquement</small>
          <span className="scanner-paste-hint"><ClipboardPaste size={15}/> Vous pouvez aussi coller une image avec Ctrl + V</span>
          <div className="scanner-flow">
            <span><b>1</b> Photo</span><i/><span><b>2</b> Coins</span><i/><span><b>3</b> Amélioration</span><i/><span><b>4</b> PDF</span>
          </div>
        </section>
      ) : (
        <>
        <section className="scanner-pages-panel">
          <div className="scanner-pages-head">
            <div><b>{pages.length} page(s)</b><span>{selectedCount} sélectionnée(s) · maintenez puis glissez pour réorganiser</span></div>
            <div>
              <div className="scanner-selection-actions">
                <button type="button" onClick={() => selectAllPages(true)}>Tout</button>
                <button type="button" onClick={() => selectAllPages(false)}>Aucun</button>
              </div>
              <label className="btn btn-secondary scanner-file-button"><Plus size={16}/> Ajouter des pages<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseFile}/></label>
              <label className="btn btn-secondary scanner-file-button"><FileArchive size={16}/> Archive<input type="file" accept=".zip,.rar,.7z,.tar,.cbz" onChange={chooseArchive}/></label>
              <button className="btn btn-primary" onClick={scanAllPages} disabled={processing}>{processing ? <span className="spinner"/> : <Sparkles size={16}/>} Scanner toutes</button>
            </div>
          </div>
          <div className="scanner-pages-list">
            {pages.map((page, index) => (
              <article
                key={page.id}
                draggable={!processing}
                className={`scanner-page-thumb ${index === activeIndex ? 'active' : ''} ${draggedPageId === page.id ? 'dragging' : ''} ${dragOverPageId === page.id ? 'drag-over' : ''}`}
                onClick={() => openPageFromCard(page, index)}
                onDragStart={event => onPageDragStart(event, page)}
                onDragEnter={event => onPageDragOver(event, page.id)}
                onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
                onDrop={event => { event.preventDefault(); onPageDragEnd() }}
                onDragEnd={onPageDragEnd}
              >
                <div className="scanner-page-grip" aria-hidden="true"><GripVertical size={16}/></div>
                <div className="scanner-page-image"><img src={page.thumb} alt="" draggable="false"/><span>{index + 1}</span>{page.result ? <i><Check size={12}/></i> : null}</div>
                <div className="scanner-page-meta"><b title={page.name}>{page.name}</b><small>{page.result ? 'Scannée' : 'Contours à vérifier'}</small></div>
                <div className="scanner-page-tools" onClick={event => event.stopPropagation()}>
                  <button type="button" className={`scanner-page-check ${page.selected ? 'checked' : ''}`} onClick={() => togglePageSelection(index)} aria-label="Inclure dans le PDF"><Check size={13}/></button>
                  <button type="button" onClick={() => movePage(index, -1)} disabled={index === 0} aria-label="Monter"><ArrowUp size={13}/></button>
                  <button type="button" onClick={() => movePage(index, 1)} disabled={index === pages.length - 1} aria-label="Descendre"><ArrowDown size={13}/></button>
                  <button type="button" className="danger" onClick={() => removePage(index)} aria-label="Supprimer"><Trash2 size={13}/></button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <div className="scanner-workspace">
          <section className="scanner-stage-card">
            <div className="scanner-stage-head">
              <div>
                <span>{step === 'crop' ? 'Étape 1 sur 2' : 'Étape 2 sur 2'}</span>
                <h2>{step === 'crop' ? 'Ajustez les quatre coins' : 'Améliorez le résultat'}</h2>
              </div>
              <div className="scanner-session-actions">
                <button className="btn btn-secondary" onClick={reset}><RefreshCw size={16}/> Nouvelle session</button>
                <button className="btn btn-danger scanner-cancel-session" onClick={cancelSession}><Trash2 size={16}/> Annuler la session</button>
              </div>
            </div>
            {step === 'crop' ? (
              <>
                <p className="scanner-help">Les contours ont été détectés automatiquement. Déplacez uniquement les poignées qui nécessitent une correction précise.</p>
                <div className="scanner-canvas-shell is-editor">
                  <canvas
                    ref={editorRef}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                  />
                </div>
                {!cornerValidation.valid && cornerValidation.reason ? (
                  <div className="scanner-corner-error">{cornerValidation.reason}</div>
                ) : null}
                <div className="scanner-stage-actions">
                  <div className="scanner-corner-actions">
                    <button className="btn btn-secondary" onClick={detectCornersAgain} disabled={processing}><ScanLine size={17}/> Détection automatique</button>
                    <button className="btn btn-secondary" onClick={() => setCorners(defaultDocumentCorners(sourceRef.current.width, sourceRef.current.height))}><Crop size={17}/> Réinitialiser</button>
                  </div>
                  <button className="btn btn-primary" onClick={correctPerspective} disabled={processing || !cornerValidation.valid}>
                    {processing ? <span className="spinner"/> : <Sparkles size={17}/>} Corriger la perspective
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={`scanner-canvas-shell is-preview ${comparisonActive ? 'is-comparing' : ''}`}>
                  <canvas ref={previewRef}/>
                  {comparisonActive ? (
                    <div className="scanner-compare-control">
                      <span>Avant</span>
                      <input aria-label="Comparer avant et après" type="range" min="0" max="100" value={comparisonPosition} onChange={event => setComparisonPosition(Number(event.target.value))}/>
                      <span>Après</span>
                    </div>
                  ) : null}
                </div>
                <div className="scanner-stage-actions">
                  <button className="btn btn-secondary" onClick={() => setStep('crop')}><Crop size={17}/> Modifier les coins</button>
                  <div className="scanner-preview-actions">
                    <button className={`btn btn-secondary ${comparisonActive ? 'active' : ''}`} onClick={() => setComparisonActive(value => !value)}><Eye size={17}/> Avant / après</button>
                    <button className="btn btn-secondary" onClick={rotate}><RotateCw size={17}/> Rotation 90°</button>
                  </div>
                </div>
              </>
            )}
          </section>

          <aside className="scanner-controls-card">
            <div className="scanner-controls-title"><SlidersHorizontal size={19}/><div><h2>Finition du scan</h2><span>{fileName}</span></div></div>
            {step === 'preview' ? (
              <>
                <button className="btn btn-primary scanner-auto-enhance" onClick={autoEnhance} disabled={processing}><Sparkles size={17}/> Amélioration automatique</button>
                <div className="scanner-filter-grid">
                  {FILTERS.map(item => (
                    <button key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => changeFilter(item.id)}>
                      <span className={`filter-swatch filter-${item.id}`}/>{item.label}
                    </button>
                  ))}
                </div>
                <label className="scanner-range">
                  <span>Luminosité <b>{brightness > 0 ? `+${brightness}` : brightness}</b></span>
                  <input type="range" min="-35" max="35" value={brightness} onChange={event => changeAdjustment('brightness', event.target.value)}/>
                </label>
                <label className="scanner-range">
                  <span>Contraste <b>{contrast > 0 ? `+${contrast}` : contrast}</b></span>
                  <input type="range" min="-20" max="60" value={contrast} onChange={event => changeAdjustment('contrast', event.target.value)}/>
                </label>
                <div className="scanner-quality"><Sparkles size={17}/><span><b>Haute qualité</b><small>Ombres corrigées · netteté impression · JPEG 97%</small></span></div>
                <button className="btn btn-primary scanner-download-main" onClick={openPdfPreview} disabled={processing || !selectedCount}><FileText size={18}/> Vérifier le PDF · {selectedCount} page(s)</button>
                <button className="btn btn-secondary scanner-download-main" onClick={downloadImage}><FileImage size={18}/> Télécharger JPG</button>
              </>
            ) : (
              <div className="scanner-crop-options">
                <div className="scanner-crop-intro"><Crop size={30}/><strong>Proportions du document</strong><span>Le mode intelligent corrige la perspective sans écraser la feuille.</span></div>
                <div className="scanner-format-grid" role="radiogroup" aria-label="Format de sortie">
                  <button type="button" role="radio" aria-checked={formatMode === 'auto'} className={formatMode === 'auto' ? 'active' : ''} onClick={() => setFormatMode('auto')}>
                    <b>Intelligent</b><small>Recommandé · reconnaît A4</small>
                  </button>
                  <button type="button" role="radio" aria-checked={formatMode === 'free'} className={formatMode === 'free' ? 'active' : ''} onClick={() => setFormatMode('free')}>
                    <b>Libre</b><small>Respecte les côtés sélectionnés</small>
                  </button>
                  <button type="button" role="radio" aria-checked={formatMode === 'a4'} className={formatMode === 'a4' ? 'active' : ''} onClick={() => setFormatMode('a4')}>
                    <b>A4 exact</b><small>210 × 297 mm</small>
                  </button>
                </div>
              </div>
            )}
            <div className="scanner-privacy-note"><Lock size={15}/><span>Photos traitées localement · archives supprimées juste après extraction.</span></div>
          </aside>
        </div>
        </>
      )}
      {processing && step === 'empty' ? <div className="scanner-loading"><span className="spinner"/><strong>{processingLabel}</strong><small>Ne fermez pas cette page</small></div> : null}
      {pdfPreviewOpen ? (
        <div className="scanner-pdf-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPdfPreviewOpen(false) }}>
          <section className="scanner-pdf-dialog" role="dialog" aria-modal="true" aria-labelledby="scanner-pdf-title">
            <header>
              <div><span>Export final</span><h2 id="scanner-pdf-title"><FileCheck2 size={22}/> Vérifier le PDF</h2><p>{selectedCount} page(s), dans l’ordre affiché</p></div>
              <button type="button" className="dialog-close" onClick={() => setPdfPreviewOpen(false)} aria-label="Fermer"><X size={19}/></button>
            </header>
            <div className="scanner-pdf-pages">
              {currentPagesSnapshot().map((page, index) => page.selected ? (
                <article key={page.id}><img src={page.result?.toDataURL('image/jpeg', .55) || page.thumb} alt=""/><b>{index + 1}</b><span>{page.name}</span></article>
              ) : null)}
            </div>
            <div className="scanner-pdf-settings">
              <label><span>Nom du fichier</span><div className="scanner-pdf-name"><input value={pdfName} maxLength={90} onChange={event => setPdfName(event.target.value)}/><b>.pdf</b></div></label>
              <fieldset><legend>Qualité</legend>
                {[['compact','Compact','Email'],['balanced','Équilibrée','Usage courant'],['high','Haute','Impression']].map(([value,label,hint]) => (
                  <button type="button" key={value} className={pdfQuality === value ? 'active' : ''} onClick={() => setPdfQuality(value)}><b>{label}</b><small>{hint}</small></button>
                ))}
              </fieldset>
            </div>
            <footer><button className="btn btn-secondary" onClick={() => setPdfPreviewOpen(false)}>Retour</button><button className="btn btn-primary" onClick={downloadPdf} disabled={processing || !pdfName.trim()}>{processing ? <span className="spinner"/> : <FileText size={18}/>} Télécharger le PDF</button></footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
