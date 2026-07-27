// src/components/layout/Layout.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import { api } from '../../lib/api'
import { getLogoUrl } from '../../lib/brand'
import { applyVisualIdentity } from '../../lib/visualIdentity'
import { useI18n } from '../../lib/i18n'
import CommandPalette from './CommandPalette'
import toast from 'react-hot-toast'
import {
  LayoutDashboard, Users, Package, ShoppingCart, Truck,
  TrendingDown, BarChart2, Settings, LogOut, ChevronDown,
  Wallet, UserCheck, Menu, X, Archive, ScanLine, UserCog, LogIn,
  Sun, Moon, Bell, Search, ShieldCheck
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

export default function Layout() {
  const { user, logout, hasPermission, displayName, updateProfile, changePassword, setupMfa, enableMfa, disableMfa, regenerateRecoveryCodes } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { t } = useI18n()
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
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const userMenuRef = useRef(null)
  const notificationsRef = useRef(null)

  const visibleNav = useMemo(
    () => NAV_ITEMS.filter(item => hasPermission(item.permission)),
    [hasPermission]
  )

  const grouped = useMemo(() => visibleNav.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {}), [visibleNav])

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
    let mounted = true
    const loadNotifications = () => {
      api.get('/notifications')
        .then(({ data }) => mounted && setNotifications(data.items || []))
        .catch(() => {})
    }
    loadNotifications()
    const timer = window.setInterval(loadNotifications, 60000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [])

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
          <img className="logo-icon logo-image" src={getLogoUrl(visualSettings)} alt="ProERP" />
          <span className="logo-text">{visualSettings.app_name || 'ProERP'}</span>
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
                  title={label}
                  data-tooltip={label}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setMobileOpen(false)}
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
          <button className="btn btn-secondary btn-sm" onClick={() => requestSensitiveAction('logout')} title={t('layout.logout')}>
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

      <div className="sidebar-wrapper desktop-only"><SidebarContent /></div>
      <div className={`sidebar-wrapper mobile-sidebar ${mobileOpen ? 'open' : ''}`}><SidebarContent mobile /></div>

      <main className="main-content">
        <header className="topbar">
          <button
            className={`btn btn-secondary btn-icon mobile-menu-btn ${!isMobile && !collapsed ? 'nav-close-mode' : ''}`}
            onClick={handleMenuToggle}
            aria-label={isMobile
              ? (mobileOpen ? t('layout.closeMenu') : t('layout.openMenu'))
              : (collapsed ? t('layout.showMenu') : t('layout.hideMenu'))
            }
          >
            {(isMobile ? mobileOpen : !collapsed) ? <X size={18} /> : <Menu size={18} />}
          </button>
          <button className="command-trigger" onClick={() => setCommandOpen(true)}>
            <Search size={16} />
            <span>Recherche</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-secondary btn-icon theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            aria-label={theme === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <div className="topbar-notifications" ref={notificationsRef}>
            <button
              className="btn btn-secondary btn-icon notification-btn"
              onClick={() => setNotificationsOpen(open => !open)}
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell size={17} />
              {notifications.length > 0 && <span>{notifications.length}</span>}
            </button>
            {notificationsOpen && (
              <div className="notifications-dropdown">
                <div className="notifications-head">
                  <strong>Notifications</strong>
                  <small>{notifications.length} alerte(s)</small>
                </div>
                {notifications.length === 0 ? (
                  <div className="notifications-empty">Aucune alerte importante.</div>
                ) : notifications.map((item, index) => (
                  <button
                    key={`${item.type}-${index}`}
                    className={`notification-item level-${item.level}`}
                    onClick={() => { setNotificationsOpen(false); navigate(item.path || '/dashboard') }}
                  >
                    <span />
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.message}</small>
                    </div>
                  </button>
                ))}
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

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        navItems={visibleNav}
        t={t}
      />
    </div>
  )
}
