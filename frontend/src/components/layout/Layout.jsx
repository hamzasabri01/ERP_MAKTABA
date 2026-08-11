// src/components/layout/Layout.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import { api } from '../../lib/api'
import { getLogoUrl } from '../../lib/brand'
import { applyVisualIdentity } from '../../lib/visualIdentity'
import { useI18n } from '../../lib/i18n'
import { storageJson, storageSet } from '../../lib/safeStorage'
import { playSound, setSoundsEnabled, soundsEnabled, subscribeSoundSetting } from '../../lib/soundFeedback'
import CommandPalette from './CommandPalette'
import { useConfirm } from '../ui/ConfirmDialog'
import toast from 'react-hot-toast'
import {
  LayoutDashboard, Users, Package, ShoppingCart, Truck,
  TrendingDown, BarChart2, Settings, LogOut, ChevronDown,
  Wallet, UserCheck, Menu, X, Archive, ScanLine, UserCog, LogIn,
  Sun, Moon, Bell, Search, ShieldCheck, Printer, ScanText, PanelLeftClose, PanelLeftOpen
  , CheckCheck, RefreshCw, AlertTriangle, PackageX, GraduationCap, Volume2, VolumeX
} from 'lucide-react'
import './Layout.css'

export const NAV_ITEMS = [
  { path: '/dashboard',  icon: LayoutDashboard, labelKey: 'nav.dashboard', group: 'main',     permission: 'dashboard' },
  { path: '/pos',        icon: ScanLine,        labelKey: 'nav.pos',       group: 'main',     permission: 'pos' },
  { path: '/sales',      icon: ShoppingCart,    labelKey: 'nav.sales',     group: 'main',     permission: 'sales' },
  { path: '/purchases',  icon: Truck,           labelKey: 'nav.purchases', group: 'main',     permission: 'purchases' },
  { path: '/clients',    icon: Users,           labelKey: 'nav.clients',   group: 'contacts', permission: 'clients' },
  { path: '/suppliers',  icon: UserCheck,       labelKey: 'nav.suppliers', group: 'contacts', permission: 'suppliers' },
  { path: '/products',   icon: Package,         labelKey: 'nav.products',  group: 'stock',    permission: 'products' },
  { path: '/stock',      icon: Archive,         labelKey: 'nav.stock',     group: 'stock',    permission: 'stock' },
  { path: '/expenses',   icon: TrendingDown,    labelKey: 'nav.expenses',  group: 'finance',  permission: 'expenses' },
  { path: '/printer',    icon: Printer,         labelKey: 'nav.printer',   group: 'finance',  permission: 'expenses' },
  { path: '/document-scanner', icon: ScanText,   labelKey: 'nav.documentScanner', group: 'finance', permission: 'expenses' },
  { path: '/research',   icon: GraduationCap,    labelKey: 'nav.research', group: 'finance', permission: 'research.view', feature: 'research' },
  { path: '/cash',       icon: Wallet,          labelKey: 'nav.cash',      group: 'finance',  permission: 'cash' },
  { path: '/reports',    icon: BarChart2,       labelKey: 'nav.reports',   group: 'finance',  permission: 'reports' },
  { path: '/security',   icon: ShieldCheck,     labelKey: 'nav.security',  group: 'admin',    permission: 'settings' },
  { path: '/users',      icon: Users,           labelKey: 'nav.users',     group: 'admin',    permission: 'users' },
  { path: '/settings',   icon: Settings,        labelKey: 'nav.settings',  group: 'admin',    permission: 'settings' },
]

const GROUPS = {
  main: 'group.main',
  contacts: 'group.contacts',
  stock: 'group.stock',
  finance: 'group.finance',
  admin: 'group.admin',
}

const ADHKAR_BY_PERIOD = {
  morning: {
    label: 'أذكار الصباح',
    items: [
      'أصبحنا وأصبح الملك لله، والحمد لله',
      'اللهم بك أصبحنا وبك أمسينا وبك نحيا وبك نموت وإليك النشور',
      'رضيت بالله رباً، وبالإسلام ديناً، وبمحمد ﷺ نبياً',
      'اللهم إني أسألك خير هذا اليوم فتحه ونصره ونوره وبركته وهداه',
    ],
  },
  evening: {
    label: 'أذكار المساء',
    items: [
      'أمسينا وأمسى الملك لله، والحمد لله',
      'اللهم بك أمسينا وبك أصبحنا وبك نحيا وبك نموت وإليك المصير',
      'رضيت بالله رباً، وبالإسلام ديناً، وبمحمد ﷺ نبياً',
      'اللهم إني أسألك خير هذه الليلة وخير ما بعدها',
    ],
  },
  general: {
    label: 'ذِكــر وطمـأنـيـة',
    items: [
      'سبحان الله وبحمده، سبحان الله العظيم',
      'أستغفر الله العظيم وأتوب إليه',
      'لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير',
      'الله أكبر، والحمد لله، ولا حول ولا قوة إلا بالله',
      'اللهم صل وسلم وبارك على نبينا محمد',
    ],
  },
}

function AdhkarTicker() {
  const [hour, setHour] = useState(() => new Date().getHours())

  useEffect(() => {
    const timer = window.setInterval(() => setHour(new Date().getHours()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const period = hour >= 5 && hour < 12 ? 'morning' : hour >= 17 || hour < 1 ? 'evening' : 'general'
  const content = ADHKAR_BY_PERIOD[period]
  // Each half of the marquee must be wider than the largest supported viewport.
  // Repeating the phrases inside both identical halves keeps the loop seamless.
  const continuousItems = [...content.items, ...content.items]
  return (
    <section className={`adhkar-ticker adhkar-${period}`} dir="rtl" aria-label={content.label}>
      <div className="adhkar-label">
        <span className="adhkar-label-icon" aria-hidden="true">✦</span>
        <strong>{content.label}</strong>
      </div>
      <div className="adhkar-viewport">
        <div className="adhkar-track">
          {[0, 1].map(copy => (
            <div className="adhkar-set" key={`${period}-set-${copy}`} aria-hidden={copy === 1}>
              {continuousItems.map((item, index) => (
                <span className="adhkar-item" key={`${period}-${copy}-${index}`}>
                  {item}
                  <i aria-hidden="true">❖</i>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <span className="adhkar-end-mark" aria-hidden="true">۞</span>
    </section>
  )
}

export default function Layout() {
  const { user, logout, hasPermission, displayName, updateProfile, changePassword, setupMfa, enableMfa, disableMfa, regenerateRecoveryCodes } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { t, language } = useI18n()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileForm, setProfileForm] = useState({ full_name: '', email: '' })
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [mfaSetup, setMfaSetup] = useState(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaPassword, setMfaPassword] = useState('')
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState([])
  const [savingMfa, setSavingMfa] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [visualSettings, setVisualSettings] = useState({})
  const [notifications, setNotifications] = useState([])
  const [notificationMeta, setNotificationMeta] = useState({})
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [readNotificationKeys, setReadNotificationKeys] = useState(() => {
    try {
      const saved = storageJson('library-sabri:read-notifications', [])
      return Array.isArray(saved) ? saved : []
    }
    catch { return [] }
  })
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(() => soundsEnabled())
  const [commandOpen, setCommandOpen] = useState(false)
  const [researchEnabled, setResearchEnabled] = useState(false)
  const [navTooltip, setNavTooltip] = useState(null)
  const userMenuRef = useRef(null)
  const notificationsRef = useRef(null)
  const knownNotificationsRef = useRef(null)
  const notificationRefreshRef = useRef(null)

  useEffect(() => subscribeSoundSetting(setSoundOn), [])

  const visibleNav = useMemo(
    () => NAV_ITEMS.filter(item => hasPermission(item.permission) && (!item.feature || (item.feature === 'research' && researchEnabled))),
    [hasPermission, researchEnabled]
  )

  useEffect(() => {
    let active = true
    api.get('/research/config')
      .then(({ data }) => { if (active) setResearchEnabled(Boolean(data?.enabled)) })
      .catch(() => { if (active) setResearchEnabled(false) })
    return () => { active = false }
  }, [])

  const grouped = useMemo(() => visibleNav.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {}), [visibleNav])

  const notificationKey = useCallback(
    item => `${item.id || item.type}:${item.updated_at || item.message || ''}`,
    []
  )
  const unreadNotifications = useMemo(
    () => notifications.filter(item => !readNotificationKeys.includes(notificationKey(item))),
    [notificationKey, notifications, readNotificationKeys]
  )

  const notificationCopy = useCallback(item => {
    if (language !== 'ar') return { title: item.title, message: item.message }
    const quantity = Number(item.quantity || 0)
    const current = Number(item.quantity || 0)
    const minimum = Number(item.min_stock || 0)
    if (item.type === 'stock_out') {
      return { title: 'نفاد المخزون', message: `${quantity} منتج دون مخزون متاح` }
    }
    if (item.type === 'stock_low') {
      return { title: 'مخزون منخفض', message: `${quantity} منتج بلغ الحد الأدنى للمخزون` }
    }
    if (item.type === 'stock_product') {
      return {
        title: item.title,
        message: current <= 0
          ? `نفد المخزون · الكمية الحالية: ${current} قطعة`
          : `المتبقي ${current} قطعة · الحد الأدنى: ${minimum}`,
      }
    }
    if (item.type === 'clients') {
      const amount = String(item.message || '').match(/[\d.,]+/)?.[0] || '0'
      return { title: 'مستحقات العملاء', message: `${amount} درهم متبقية للتحصيل` }
    }
    if (item.type === 'suppliers') {
      const amount = String(item.message || '').match(/[\d.,]+/)?.[0] || '0'
      return { title: 'ديون الموردين', message: `${amount} درهم متبقية للأداء` }
    }
    if (item.type === 'cash') {
      return {
        title: 'الصندوق مفتوح',
        message: String(item.message || '').replace(/^Session ouverte depuis\s*/i, 'الجلسة مفتوحة منذ '),
      }
    }
    return { title: item.title, message: item.message }
  }, [language])

  const openNotification = useCallback(item => {
    const key = notificationKey(item)
    setReadNotificationKeys(current => {
      const next = [...new Set([...current, key])].slice(-250)
      storageSet('library-sabri:read-notifications', JSON.stringify(next))
      return next
    })
    setNotificationsOpen(false)
    navigate(item.path || '/dashboard')
  }, [navigate, notificationKey])

  const loadNotifications = useCallback(async ({ announce = false } = {}) => {
    setNotificationsLoading(true)
    try {
      const { data } = await api.get('/notifications')
      const nextItems = data.items || []
      const nextKeys = new Set(nextItems.map(notificationKey))
      if (announce && knownNotificationsRef.current) {
        const freshStockAlert = nextItems.find(item =>
          item.type?.startsWith('stock')
          && !knownNotificationsRef.current.has(notificationKey(item))
        )
        if (freshStockAlert) {
          playSound(freshStockAlert.level === 'danger' ? 'warning' : 'notification')
          const StockToastIcon = freshStockAlert.level === 'danger' ? PackageX : AlertTriangle
          toast.custom(currentToast => (
            <button
              type="button"
              className={`runtime-stock-toast level-${freshStockAlert.level}${currentToast.visible ? ' is-visible' : ''}`}
              onClick={() => {
                toast.dismiss(currentToast.id)
                openNotification(freshStockAlert)
              }}
            >
              <span className="runtime-stock-toast-icon">
                <StockToastIcon size={19} />
              </span>
              <span className="runtime-stock-toast-copy">
                <strong>{notificationCopy(freshStockAlert).title}</strong>
                <small>{notificationCopy(freshStockAlert).message}</small>
              </span>
              <span
                className="runtime-stock-toast-close"
                role="button"
                aria-label="Fermer"
                onClick={event => {
                  event.stopPropagation()
                  toast.dismiss(currentToast.id)
                }}
              >
                <X size={15} />
              </span>
              <i className="runtime-stock-toast-progress" />
            </button>
          ), {
            id: `runtime-${notificationKey(freshStockAlert)}`,
            duration: 3200,
            position: language === 'ar' ? 'bottom-left' : 'bottom-right',
          })
        }
      }
      knownNotificationsRef.current = nextKeys
      setNotifications(nextItems)
      setNotificationMeta(data || {})
    } catch {
      // A temporary network failure must not erase the last known alerts.
    } finally {
      setNotificationsLoading(false)
    }
  }, [language, notificationCopy, notificationKey, openNotification])

  const markAllNotificationsRead = () => {
    const keys = notifications.map(notificationKey)
    setReadNotificationKeys(keys)
    storageSet('library-sabri:read-notifications', JSON.stringify(keys))
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const switchUser = async () => {
    await logout()
    navigate('/login')
  }

  const requestSensitiveAction = (type) => {
    setUserMenuOpen(false)
    setConfirmAction(type)
  }

  const confirmSensitiveAction = async () => {
    const action = confirmAction
    setConfirmAction(null)
    if (action === 'switch') await switchUser()
    if (action === 'logout') await handleLogout()
  }

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth <= 768
      setIsMobile(nextIsMobile)
      if (!nextIsMobile) setMobileOpen(false)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('menu-open', mobileOpen)
    return () => document.body.classList.remove('menu-open')
  }, [mobileOpen])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(open => !open)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!userMenuOpen) return

    const handlePointerDown = (event) => {
      if (!userMenuRef.current?.contains(event.target)) setUserMenuOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setUserMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [userMenuOpen])

  useEffect(() => {
    if (!notificationsOpen) return
    const handlePointerDown = (event) => {
      if (!notificationsRef.current?.contains(event.target)) setNotificationsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [notificationsOpen])

  useEffect(() => {
    const dirtyMessage = language === 'ar'
      ? 'توجد تعديلات غير محفوظة. هل تريد إغلاق النافذة؟'
      : 'Des modifications ne sont pas enregistrées. Fermer la fenêtre ?'
    const actionLocks = new WeakMap()
    let focusTimer = 0

    const getOpenDialogs = () => Array.from(document.querySelectorAll('.modal-overlay'))
      .filter(overlay => overlay.getClientRects().length > 0)
    const getTopDialog = () => getOpenDialogs().at(-1)
    const confirmDiscardChanges = () => confirm({
      title: language === 'ar' ? 'تعديلات غير محفوظة' : 'Modifications non enregistrées',
      message: dirtyMessage,
      confirmText: language === 'ar' ? 'إغلاق دون حفظ' : 'Fermer sans enregistrer',
      cancelText: language === 'ar' ? 'متابعة التعديل' : 'Continuer la modification',
      tone: 'warning',
    })
    const requestClose = async (overlay) => {
      if (!overlay) return
      if (overlay.dataset.dialogDirty === 'true' && !(await confirmDiscardChanges())) return
      overlay.dataset.dialogAllowClose = 'true'
      const closeButton = overlay.querySelector('.modal-header .btn-icon, [data-modal-close]')
      if (closeButton) closeButton.click()
      else overlay.dispatchEvent(new MouseEvent('click', { bubbles:true }))
      window.setTimeout(() => delete overlay.dataset.dialogAllowClose, 0)
    }
    const focusFirstField = (overlay) => {
      window.clearTimeout(focusTimer)
      focusTimer = window.setTimeout(() => {
        if (!document.body.contains(overlay)) return
        const target = overlay.querySelector('[autofocus]')
          || overlay.querySelector('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)')
          || overlay.querySelector('button:not(:disabled)')
        target?.focus({ preventScroll:true })
        if (target?.matches('input:not([type="date"]):not([type="datetime-local"]), textarea')) target.select?.()
      }, 70)
    }
    const observer = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return
        if (node.matches('.modal-overlay')) focusFirstField(node)
        node.querySelectorAll?.('.modal-overlay').forEach(focusFirstField)
      }))
    })
    const handleInput = (event) => {
      const overlay = event.target.closest?.('.modal-overlay')
      if (overlay && event.isTrusted) overlay.dataset.dialogDirty = 'true'
    }
    const handleClick = (event) => {
      const overlay = event.target.closest?.('.modal-overlay')
      if (!overlay) return

      const bodyAction = event.target.closest?.('.modal-body button')
      if (bodyAction && !bodyAction.disabled) overlay.dataset.dialogDirty = 'true'

      const action = event.target.closest?.('.modal-footer .btn-primary, .modal-footer .btn-success')
      if (action && !action.disabled) {
        const dialogs = getOpenDialogs()
        if (dialogs.length > 1) dialogs.at(-2).dataset.dialogDirty = 'true'
        const now = Date.now()
        if (now - (actionLocks.get(action) || 0) < 900) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        actionLocks.set(action, now)
      }

      const label = event.target.closest?.('button')?.textContent?.trim() || ''
      const isBackdrop = event.target === overlay
      const isHeaderClose = Boolean(event.target.closest?.('.modal-header .btn-icon, [data-modal-close]'))
      const isCancelButton = Boolean(
        event.target.closest?.('.modal-footer .btn-secondary')
        && /^(annuler|fermer|cancel|close|إلغاء|إغلاق)/i.test(label)
      )
      if (
        overlay.dataset.dialogDirty === 'true'
        && overlay.dataset.dialogAllowClose !== 'true'
        && (isBackdrop || isHeaderClose || isCancelButton)
      ) {
        event.preventDefault()
        event.stopPropagation()
        requestClose(overlay)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const overlay = getTopDialog()
      if (!overlay) return
      event.preventDefault()
      event.stopPropagation()
      requestClose(overlay)
    }

    observer.observe(document.body, { childList:true, subtree:true })
    document.addEventListener('input', handleInput, true)
    document.addEventListener('change', handleInput, true)
    document.addEventListener('click', handleClick, true)
    document.addEventListener('keydown', handleKeyDown, true)
    getOpenDialogs().forEach(focusFirstField)
    return () => {
      observer.disconnect()
      window.clearTimeout(focusTimer)
      document.removeEventListener('input', handleInput, true)
      document.removeEventListener('change', handleInput, true)
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [confirm, language])

  useEffect(() => {
    setProfileForm({
      full_name: user?.full_name || '',
      email: user?.email || '',
    })
  }, [user])

  useEffect(() => {
    let mounted = true
    api.get('/settings')
      .then(({ data }) => {
        if (!mounted) return
        setVisualSettings(data || {})
        applyVisualIdentity(data || {})
      })
      .catch(() => {})
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    loadNotifications()
    const scheduleRefresh = () => {
      window.clearTimeout(notificationRefreshRef.current)
      notificationRefreshRef.current = window.setTimeout(
        () => loadNotifications({ announce: true }),
        350
      )
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadNotifications({ announce: true })
    }
    window.addEventListener('proerp:data-changed', scheduleRefresh)
    window.addEventListener('focus', scheduleRefresh)
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(() => loadNotifications({ announce: true }), 15000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(notificationRefreshRef.current)
      window.removeEventListener('proerp:data-changed', scheduleRefresh)
      window.removeEventListener('focus', scheduleRefresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loadNotifications])

  const handleMenuToggle = () => {
    if (isMobile) {
      setMobileOpen(open => !open)
      return
    }
    setCollapsed(value => !value)
  }

  const openProfile = () => {
    setUserMenuOpen(false)
    setProfileOpen(true)
  }

  const saveProfile = async () => {
    setSavingProfile(true)
    try {
      await updateProfile(profileForm)
      toast.success(t('common.profileUpdated'))
      setProfileOpen(false)
    } catch (e) {
      toast.error(e.response?.data?.detail || t('common.profileUpdateError'))
    } finally {
      setSavingProfile(false)
    }
  }

  const savePassword = async () => {
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      toast.error('La confirmation du mot de passe ne correspond pas')
      return
    }
    setSavingProfile(true)
    try {
      await changePassword(passwordForm.current_password, passwordForm.new_password)
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' })
      toast.success('Mot de passe modifie. Reconnexion requise.')
      setProfileOpen(false)
      navigate('/login', { replace: true })
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Modification du mot de passe impossible')
    } finally {
      setSavingProfile(false)
    }
  }

  const startMfaSetup = async () => {
    if (!mfaPassword) return toast.error('Mot de passe actuel requis')
    setSavingMfa(true)
    try {
      const data = await setupMfa(mfaPassword)
      setMfaSetup(data)
      toast.success('Secret MFA genere')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Impossible de preparer MFA')
    } finally {
      setSavingMfa(false)
    }
  }

  const confirmMfa = async () => {
    setSavingMfa(true)
    try {
      const data = await enableMfa(mfaCode)
      setMfaRecoveryCodes(data.recovery_codes || [])
      setMfaCode('')
      setMfaSetup(null)
      setMfaPassword('')
      toast.success('MFA active')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Code MFA invalide')
    } finally {
      setSavingMfa(false)
    }
  }

  const turnOffMfa = async () => {
    setSavingMfa(true)
    try {
      await disableMfa(mfaPassword, mfaCode)
      setMfaCode('')
      setMfaPassword('')
      setMfaSetup(null)
      toast.success('MFA desactive')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Desactivation impossible')
    } finally {
      setSavingMfa(false)
    }
  }

  const refreshRecoveryCodes = async () => {
    if (!mfaPassword || mfaCode.length !== 6) return toast.error('Mot de passe et code TOTP requis')
    setSavingMfa(true)
    try {
      const codes = await regenerateRecoveryCodes(mfaPassword, mfaCode)
      setMfaRecoveryCodes(codes)
      setMfaCode('')
      setMfaPassword('')
      toast.success('Nouveaux codes de recuperation generes')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Regeneration impossible')
    } finally {
      setSavingMfa(false)
    }
  }

  const SidebarContent = ({ mobile = false } = {}) => {
    const isCollapsed = !mobile && collapsed

    return (
      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-logo">
          <button
            type="button"
            className="sidebar-logo-refresh"
            onClick={() => window.location.reload()}
            aria-label={language === 'ar' ? 'تحديث التطبيق' : "Actualiser l'application"}
          >
            <img className="logo-icon logo-image" src={getLogoUrl(visualSettings)} alt={language === 'ar' ? 'مــكـتبة صــبــري' : 'LIBRARY SABRI'} />
          </button>
          <span className="logo-text">
            <strong>{language === 'ar' ? 'مــكـتبة صــبــري' : 'LIBRARY SABRI'}</strong>
            <small>{language === 'ar' ? 'LIBRARY SABRI' : 'مــكـتبة صــبــري'}</small>
          </span>
        </div>

        <nav className="sidebar-nav">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="nav-group">
              <span className="nav-group-label">{t(GROUPS[group])}</span>
              {items.map(({ path, icon: Icon, labelKey }) => {
                const label = t(labelKey)
                return (
                <NavLink
                  key={path}
                  to={path}
                  data-tooltip={label}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setNavTooltip(null)
                    setMobileOpen(false)
                  }}
                  onMouseEnter={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    if (isCollapsed) {
                      setNavTooltip({
                        label,
                        top: rect.top + (rect.height / 2),
                        left: language === 'ar' ? rect.left - 13 : rect.right + 13,
                        rtl: language === 'ar',
                      })
                    }
                  }}
                  onMouseLeave={() => setNavTooltip(null)}
                  onFocus={(event) => {
                    if (!isCollapsed) return
                    const rect = event.currentTarget.getBoundingClientRect()
                    setNavTooltip({
                      label,
                      top: rect.top + (rect.height / 2),
                      left: language === 'ar' ? rect.left - 13 : rect.right + 13,
                      rtl: language === 'ar',
                    })
                  }}
                  onBlur={() => setNavTooltip(null)}
                >
                  <Icon size={18} />
                  <span className="nav-item-label">{label}</span>
                </NavLink>
              )})}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!isCollapsed && (
            <div className="user-info">
              <div className="user-avatar">{displayName[0].toUpperCase()}</div>
              <div className="user-details">
                <div className="user-name">{displayName}</div>
                <div className="user-role">{user?.role_name || t('common.user')}</div>
              </div>
            </div>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => requestSensitiveAction('logout')} aria-label={t('layout.logout')}>
            <LogOut size={15} />
            {!isCollapsed && <span>{t('layout.logout')}</span>}
          </button>
        </div>
      </aside>
    )
  }

  return (
    <div className={`app-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {mobileOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)} />}

      <div className="sidebar-wrapper desktop-only">{SidebarContent()}</div>
      <div className={`sidebar-wrapper mobile-sidebar ${mobileOpen ? 'open' : ''}`}>{SidebarContent({ mobile: true })}</div>

      <main className="main-content">
        <header className="topbar">
          <button
            className={`btn btn-secondary btn-icon mobile-menu-btn ${!isMobile ? 'sidebar-panel-control' : mobileOpen ? 'nav-close-mode' : ''}`}
            onClick={handleMenuToggle}
            aria-label={isMobile
              ? (mobileOpen ? t('layout.closeMenu') : t('layout.openMenu'))
              : (collapsed ? t('layout.showMenu') : t('layout.hideMenu'))
            }
          >
            {isMobile
              ? (mobileOpen ? <X size={18} /> : <Menu size={18} />)
              : (collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />)
            }
          </button>
          <button className="command-trigger" onClick={() => setCommandOpen(true)}>
            <Search size={16} />
            <span>{t('common.search')}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div style={{ flex: 1 }} />
          <button
            className={`theme-toggle theme-toggle-${theme}${language === 'ar' ? ' theme-toggle-ar' : ''}`}
            onClick={toggleTheme}
            aria-label={language === 'ar'
              ? (theme === 'dark' ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي')
              : (theme === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre')}
            aria-pressed={theme === 'dark'}
          >
            <span className="theme-toggle-label" aria-hidden="true">
              <strong>
                {language === 'ar'
                  ? (theme === 'dark' ? 'الوضع الليلي' : 'الوضع النهاري')
                  : (theme === 'dark' ? t('common.themeDark') : t('common.themeLight'))}
              </strong>
              {language !== 'ar' && <small>{t('common.themeMode')}</small>}
            </span>
            <span className="theme-toggle-thumb" aria-hidden="true">
              <span className="theme-sun"><Sun size={23} /></span>
              <span className="theme-moon"><Moon size={22} /></span>
              <i className="theme-star theme-star-one">✦</i>
              <i className="theme-star theme-star-two">•</i>
            </span>
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-icon sound-toggle-btn${soundOn ? ' is-on' : ' is-muted'}`}
            onClick={() => {
              const enabled = setSoundsEnabled(!soundOn)
              toast(enabled
                ? (language === 'ar' ? 'تم تشغيل أصوات التطبيق' : 'Sons de l’application activés')
                : (language === 'ar' ? 'تم كتم أصوات التطبيق' : 'Sons de l’application coupés'))
            }}
            aria-label={language === 'ar'
              ? (soundOn ? 'كتم أصوات التطبيق' : 'تشغيل أصوات التطبيق')
              : (soundOn ? "Couper les sons de l’application" : "Activer les sons de l’application")}
            aria-pressed={soundOn}
            title={language === 'ar' ? (soundOn ? 'الأصوات مفعلة' : 'الأصوات مكتومة') : (soundOn ? 'Sons activés' : 'Sons coupés')}
            data-sound="none"
          >
            {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <div className="topbar-notifications" ref={notificationsRef}>
            <button
              className="btn btn-secondary btn-icon notification-btn"
              onClick={() => setNotificationsOpen(open => !open)}
              aria-label={language === 'ar' ? 'الإشعارات' : 'Notifications'}
              aria-haspopup="menu"
              aria-expanded={notificationsOpen}
            >
              <Bell size={17} />
            </button>
            {unreadNotifications.length > 0 && (
              <span className="notification-count" aria-label={language === 'ar' ? `${unreadNotifications.length} إشعار غير مقروء` : `${unreadNotifications.length} notification(s) non lue(s)`}>
                {unreadNotifications.length > 99 ? '99+' : unreadNotifications.length}
              </span>
            )}
            {notificationsOpen && (
              <div className="notifications-dropdown" role="menu">
                <div className="notifications-head">
                  <div>
                    <strong>{language === 'ar' ? 'الإشعارات' : 'Notifications'}</strong>
                    <small>
                      {language === 'ar'
                        ? `${notificationMeta.stock_alert_count || 0} تنبيه مخزون · ${unreadNotifications.length} غير مقروء`
                        : `${notificationMeta.stock_alert_count || 0} stock · ${unreadNotifications.length} non lue(s)`}
                    </small>
                  </div>
                  <div className="notifications-actions">
                    <button
                      type="button"
                      className={`notification-tool${notificationsLoading ? ' is-loading' : ''}`}
                      onClick={() => loadNotifications({ announce: false })}
                      aria-label={language === 'ar' ? 'تحديث الإشعارات' : 'Actualiser les notifications'}
                      disabled={notificationsLoading}
                    >
                      <RefreshCw size={15} />
                    </button>
                    <button
                      type="button"
                      className="notification-tool"
                      onClick={markAllNotificationsRead}
                      aria-label={language === 'ar' ? 'تحديد الكل كمقروء' : 'Tout marquer comme lu'}
                      disabled={!unreadNotifications.length}
                    >
                      <CheckCheck size={16} />
                    </button>
                  </div>
                </div>
                {notifications.length === 0 ? (
                  <div className="notifications-empty">
                    <CheckCheck size={24} />
                    <strong>{language === 'ar' ? 'كل شيء محدّث' : 'Tout est à jour'}</strong>
                    <small>{language === 'ar' ? 'لا توجد تنبيهات مهمة حالياً.' : 'Aucune alerte importante pour le moment.'}</small>
                  </div>
                ) : notifications.map(item => {
                  const isUnread = !readNotificationKeys.includes(notificationKey(item))
                  const StatusIcon = item.type === 'stock_out' ? PackageX : AlertTriangle
                  return (
                  <button
                    key={notificationKey(item)}
                    className={`notification-item level-${item.level}${isUnread ? ' is-unread' : ''}`}
                    onClick={() => openNotification(item)}
                  >
                    <span className="notification-item-icon"><StatusIcon size={16} /></span>
                    <div>
                      <strong>{notificationCopy(item).title}</strong>
                      <small>{notificationCopy(item).message}</small>
                    </div>
                    {isUnread && <i className="notification-unread-dot" aria-label={language === 'ar' ? 'غير مقروء' : 'Non lue'} />}
                  </button>
                )})}
                <div className="notifications-runtime">
                  <span className="runtime-pulse" />
                  {language === 'ar' ? 'تحديث تلقائي · كل 15 ثانية' : 'Mise à jour automatique · toutes les 15 secondes'}
                </div>
              </div>
            )}
          </div>
          <div className="topbar-user-menu" ref={userMenuRef}>
            <button
              className={`topbar-user ${userMenuOpen ? 'open' : ''}`}
              onClick={() => setUserMenuOpen(open => !open)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <div className="user-avatar sm">{displayName[0].toUpperCase()}</div>
              <span className="text-sm text-muted">{displayName}</span>
              <ChevronDown size={15} />
            </button>

            {userMenuOpen && (
              <div className="user-dropdown" role="menu">
                <div className="user-dropdown-head">
                  <div className="user-avatar">{displayName[0].toUpperCase()}</div>
                  <div>
                    <strong>{displayName}</strong>
                    <span>{user?.role_name || t('common.user')}</span>
                  </div>
                </div>
                <button onClick={openProfile} role="menuitem">
                  <UserCog size={16} />
                  <span>{t('layout.myProfile')}</span>
                </button>
                {hasPermission('settings') && (
                  <button onClick={() => { setUserMenuOpen(false); navigate('/settings') }} role="menuitem">
                    <UserCog size={16} />
                    <span>{t('layout.userSettings')}</span>
                  </button>
                )}
                {hasPermission('users') && (
                  <button onClick={() => { setUserMenuOpen(false); navigate('/users') }} role="menuitem">
                    <Users size={16} />
                    <span>{t('layout.userManagement')}</span>
                  </button>
                )}
                <button onClick={() => requestSensitiveAction('switch')} role="menuitem">
                  <LogIn size={16} />
                  <span>{t('layout.switchUser')}</span>
                </button>
                <button className="danger" onClick={() => requestSensitiveAction('logout')} role="menuitem">
                  <LogOut size={16} />
                  <span>{t('layout.logout')}</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <AdhkarTicker />

        <div className="page-wrapper">
          <Outlet />
        </div>
      </main>

      {profileOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setProfileOpen(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2>{t('layout.myProfile')}</h2>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setProfileOpen(false)}>x</button>
            </div>
            <div className="modal-body">
              <div className="form-grid form-grid-2">
                <div className="form-group">
                  <label className="form-label">{t('common.username')}</label>
                  <input value={user?.username || ''} readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('common.role')}</label>
                  <input value={user?.role_name || t('common.user')} readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('common.fullName')}</label>
                  <input
                    value={profileForm.full_name}
                    onChange={e => setProfileForm(form => ({ ...form, full_name: e.target.value }))}
                    placeholder={t('common.fullName')}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('common.email')}</label>
                  <input
                    value={profileForm.email}
                    onChange={e => setProfileForm(form => ({ ...form, email: e.target.value }))}
                    type="email"
                    placeholder="email@exemple.com"
                  />
                </div>
              </div>
              <div className="profile-security-box">
                <div>
                  <strong>Changer le mot de passe</strong>
                  <span>Le mot de passe actuel est obligatoire et toutes les sessions seront revoquees.</span>
                </div>
                <div className="mfa-setup-panel">
                  <input type="password" autoComplete="current-password" placeholder="Mot de passe actuel" value={passwordForm.current_password} onChange={e => setPasswordForm(form => ({ ...form, current_password: e.target.value }))} />
                  <input type="password" autoComplete="new-password" placeholder="Nouveau mot de passe" value={passwordForm.new_password} onChange={e => setPasswordForm(form => ({ ...form, new_password: e.target.value }))} />
                  <input type="password" autoComplete="new-password" placeholder="Confirmer le nouveau mot de passe" value={passwordForm.confirm_password} onChange={e => setPasswordForm(form => ({ ...form, confirm_password: e.target.value }))} />
                  <button className="btn btn-secondary" onClick={savePassword} disabled={savingProfile || !passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password}>Changer et fermer les sessions</button>
                </div>
              </div>
              <div className="profile-security-box">
                <div>
                  <strong>Authentification MFA</strong>
                  <span>{user?.mfa_enabled ? 'Deuxieme facteur actif sur ce compte.' : 'Ajoutez un code TOTP avec Google Authenticator, Microsoft Authenticator ou equivalent.'}</span>
                </div>
                {!user?.mfa_enabled ? (
                  <>
                    <input
                      value={mfaPassword}
                      onChange={e => setMfaPassword(e.target.value)}
                      type="password"
                      autoComplete="current-password"
                      placeholder="Mot de passe actuel"
                    />
                    <button className="btn btn-secondary" onClick={startMfaSetup} disabled={savingMfa}>
                      <ShieldCheck size={16} />
                      Generer secret MFA
                    </button>
                    {mfaSetup && (
                      <div className="mfa-setup-panel">
                        <label className="form-label">Secret TOTP</label>
                        <code>{mfaSetup.secret}</code>
                        <small>Ajoutez ce secret dans votre application Authenticator, puis validez avec le code genere.</small>
                        <input
                          value={mfaCode}
                          onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          inputMode="numeric"
                          placeholder="Code a 6 chiffres"
                        />
                        <button className="btn btn-primary" onClick={confirmMfa} disabled={savingMfa || mfaCode.length !== 6}>
                          Activer MFA
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mfa-setup-panel">
                    <input
                      value={mfaPassword}
                      onChange={e => setMfaPassword(e.target.value)}
                      type="password"
                      placeholder="Mot de passe actuel"
                    />
                    <input
                      value={mfaCode}
                      onChange={e => setMfaCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20))}
                      placeholder="Code MFA ou recuperation"
                    />
                    <button className="btn btn-danger" onClick={turnOffMfa} disabled={savingMfa || !mfaPassword || !mfaCode}>
                      Desactiver MFA
                    </button>
                    <button className="btn btn-secondary" onClick={refreshRecoveryCodes} disabled={savingMfa || !mfaPassword || mfaCode.length !== 6}>
                      Regenerer les codes de recuperation
                    </button>
                  </div>
                )}
                {mfaRecoveryCodes.length > 0 && (
                  <div className="mfa-setup-panel" role="status">
                    <strong>Codes de recuperation — affiches une seule fois</strong>
                    <small>Conservez-les hors ligne. Chaque code ne peut etre utilise qu'une fois.</small>
                    <code>{mfaRecoveryCodes.join('\n')}</code>
                    <button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(mfaRecoveryCodes.join('\n'))}>Copier les codes</button>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setProfileOpen(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? <span className="spinner" style={{ width: 16, height: 16 }} /> : null}
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirmAction(null)}>
          <div className="modal confirm-dialog">
            <div className="modal-header">
              <h2>{confirmAction === 'switch' ? t('layout.switchTitle') : t('layout.logoutTitle')}</h2>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setConfirmAction(null)}>x</button>
            </div>
            <div className="modal-body">
              <p>
                {confirmAction === 'switch'
                  ? t('layout.switchText')
                  : t('layout.logoutText')}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>{t('common.cancel')}</button>
              <button className="btn btn-danger" onClick={confirmSensitiveAction}>
                {confirmAction === 'switch' ? <LogIn size={16} /> : <LogOut size={16} />}
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {navTooltip && (
        <div
          className={`sidebar-nav-tooltip${navTooltip.rtl ? ' is-rtl' : ''}`}
          style={{ top: navTooltip.top, left: navTooltip.left }}
          role="tooltip"
        >
          {navTooltip.label}
        </div>
      )}

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        navItems={visibleNav}
        t={t}
      />
    </div>
  )
}
