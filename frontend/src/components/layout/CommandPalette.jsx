import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, Package, Search, Settings, ShoppingCart, Truck, Users, X } from 'lucide-react'
import { api } from '../../lib/api'

const ICONS = {
  product: Package,
  client: Users,
  supplier: Truck,
  sale: ShoppingCart,
  purchase: FileText,
  page: ArrowRight,
  settings: Settings,
}

const QUICK_ACTIONS = [
  { type: 'page', title: 'Tableau de bord', subtitle: 'Vue generale', path: '/dashboard' },
  { type: 'page', title: 'Nouveau produit', subtitle: 'Gestion produits', path: '/products?new=1' },
  { type: 'page', title: 'Nouvelle vente', subtitle: 'Facture vente', path: '/sales?new=1' },
  { type: 'page', title: 'Nouvel achat', subtitle: 'Facture achat', path: '/purchases?new=1' },
  { type: 'page', title: 'Point de vente', subtitle: 'POS runtime', path: '/pos' },
  { type: 'settings', title: 'Identite visuelle', subtitle: 'Logo, couleurs, facture', path: '/settings?tab=visual' },
]

function normalize(value) {
  return String(value || '').toLowerCase().trim()
}

export default function CommandPalette({ open, onClose, navItems, t }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [remoteItems, setRemoteItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)

  const pageItems = useMemo(() => {
    const nav = (navItems || []).map(item => ({
      type: 'page',
      title: t(item.labelKey),
      subtitle: 'Page application',
      path: item.path,
    }))
    return [...nav, ...QUICK_ACTIONS]
  }, [navItems, t])

  const localItems = useMemo(() => {
    const q = normalize(query)
    if (!q) return pageItems.slice(0, 8)
    return pageItems
      .filter(item => `${normalize(item.title)} ${normalize(item.subtitle)}`.includes(q))
      .slice(0, 8)
  }, [pageItems, query])

  const items = useMemo(() => [...localItems, ...remoteItems].slice(0, 12), [localItems, remoteItems])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setRemoteItems([])
    setActiveIndex(0)
    window.setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) {
      setRemoteItems([])
      setLoading(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const { data } = await api.get('/search', { params: { q, limit: 8 } })
        if (!cancelled) setRemoteItems(data.items || [])
      } catch {
        if (!cancelled) setRemoteItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  if (!open) return null

  const runItem = (item) => {
    if (!item?.path) return
    onClose()
    navigate(item.path)
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(index => Math.min(index + 1, Math.max(items.length - 1, 0)))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(index => Math.max(index - 1, 0))
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      runItem(items[activeIndex])
    }
  }

  return (
    <div className="command-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="command-panel" role="dialog" aria-modal="true">
        <div className="command-search">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Rechercher produit, client, facture..."
          />
          <button className="btn btn-secondary btn-icon btn-sm" onClick={onClose} aria-label="Fermer">
            <X size={16} />
          </button>
        </div>

        <div className="command-results">
          {loading && <div className="command-progress"><span /></div>}
          {items.length === 0 && (
            <div className="command-empty">
              <strong>Aucun resultat</strong>
              <small>Essayez un numero, un nom client ou une reference produit.</small>
            </div>
          )}
          {items.map((item, index) => {
            const Icon = ICONS[item.type] || ArrowRight
            return (
              <button
                key={`${item.type}-${item.path}-${index}`}
                className={`command-item ${index === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runItem(item)}
              >
                <span className="command-icon"><Icon size={17} /></span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <ArrowRight size={15} />
              </button>
            )
          })}
        </div>

        <div className="command-footer">
          <span>Ctrl K</span>
          <span>Entrer pour ouvrir</span>
        </div>
      </div>
    </div>
  )
}
