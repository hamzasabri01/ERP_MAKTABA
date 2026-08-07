// src/pages/LoginPage.jsx
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Store,
  Sun,
  Moon,
  User,
} from 'lucide-react'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import { storageGet, storageRemove, storageSet } from '../lib/safeStorage'
import './LoginPage.css'

const REMEMBERED_USER_KEY = 'library-sabri-login-user'

export default function LoginPage() {
  const { login, completeMfaLogin } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)
  const rememberedUsername = storageGet(REMEMBERED_USER_KEY)
  const [form, setForm] = useState({ username: rememberedUsername, password: '' })
  const [rememberUsername, setRememberUsername] = useState(Boolean(rememberedUsername))
  const [capsLock, setCapsLock] = useState(false)
  const [loginState, setLoginState] = useState('idle')
  const [mfaToken, setMfaToken] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const sessionExpired = location.state?.reason === 'session-expired'

  const handleChange = (key, value) => {
    setForm(current => ({ ...current, [key]: value }))
  }

  const handleBackendLogin = async () => {
    const result = await login(form.username.trim(), form.password)
    if (result?.mfa_required) {
      setMfaToken(result.mfa_token)
      setOtp('')
      toast.success('Code MFA requis')
      return
    }
    if (rememberUsername) storageSet(REMEMBERED_USER_KEY, form.username.trim())
    else storageRemove(REMEMBERED_USER_KEY)
    setLoginState('success')
    toast.success('Connexion reussie')
    await new Promise(resolve => setTimeout(resolve, 320))
    navigate('/')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.username.trim() || !form.password) return
    if (mfaToken && !otp.trim()) return

    setLoading(true)
    try {
      if (mfaToken) {
        await completeMfaLogin(mfaToken, otp.trim())
        if (rememberUsername) storageSet(REMEMBERED_USER_KEY, form.username.trim())
        else storageRemove(REMEMBERED_USER_KEY)
        setLoginState('success')
        toast.success('Connexion MFA reussie')
        await new Promise(resolve => setTimeout(resolve, 320))
        navigate('/')
      } else {
        await handleBackendLogin()
      }
    } catch (err) {
      setLoginState('error')
      window.setTimeout(() => setLoginState('idle'), 520)
      if (err.response?.status === 403) {
        toast.error(err.response?.data?.detail || 'Utilisateur LIBRARY SABRI non autorise')
      } else if (!err.response) {
        toast.error('Connexion locale impossible. Vérifiez que le serveur est démarré.')
      } else {
        toast.error(err.response?.data?.detail || 'Identifiants invalides')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-shell">
      <div className="login-backdrop-aura" aria-hidden="true" />
      <div className="login-faith-mark" aria-hidden="true">
        <span className="login-faith-halo" />
        <img src="/brand/tawakkul-calligraphy.png" alt="" />
        <span className="login-faith-line" />
      </div>
      <section className="login-main-panel">
        <div className={`login-card login-state-${loginState}`}>
          <div className="login-topbar">
            <span />
            <button
              type="button"
              className="login-theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
              title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              <span>{theme === 'dark' ? 'Clair' : 'Sombre'}</span>
            </button>
          </div>

          <div className="login-brand-compact">
            <img src="/brand/sabri-library.png" alt="مــكـتبة صــبــري - LIBRARY SABRI" />
            <div>
              <strong>LIBRARY SABRI</strong>
              <span lang="ar" dir="rtl">مــكـتبة صــبــري</span>
            </div>
          </div>

          <div className="login-card-header">
            <div>
              <h2>Connexion</h2>
              <p>Bienvenue. Connectez-vous à votre espace de gestion.</p>
            </div>
            <div className="login-security-badge">
              <Store size={24} />
            </div>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            {sessionExpired && !mfaToken && (
              <div className="login-firebase-note" role="status">
                Votre session a expire ou a ete revoquee. Reconnectez-vous pour continuer.
              </div>
            )}
            {mfaToken && (
              <div className="login-firebase-note">
                Verification MFA requise. Saisissez le code a 6 chiffres de votre application Authenticator.
              </div>
            )}
            <div className="login-field">
              <label>Nom d'utilisateur</label>
              <div className="login-input-wrap">
                <User size={18} />
                <input
                  type="text"
                  autoFocus
                  autoComplete="username"
                  placeholder="admin"
                  value={form.username}
                  onChange={e => handleChange('username', e.target.value)}
                />
              </div>
            </div>

            <div className="login-field">
              <label>Mot de passe</label>
              <div className="login-input-wrap">
                <LockKeyhole size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Mot de passe"
                  value={form.password}
                  onChange={e => handleChange('password', e.target.value)}
                  onKeyUp={e => setCapsLock(e.getModifierState('CapsLock'))}
                  onKeyDown={e => setCapsLock(e.getModifierState('CapsLock'))}
                  onBlur={() => setCapsLock(false)}
                />
                <button
                  type="button"
                  className="login-eye-btn"
                  onClick={() => setShowPassword(value => !value)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {capsLock && <span className="login-caps-warning" role="status">Verr. Maj est activé</span>}
            </div>

            {mfaToken && (
              <div className="login-field">
                <label>Code MFA</label>
                <div className="login-input-wrap">
                  <KeyRound size={18} />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  placeholder="Code TOTP ou recuperation"
                  value={otp}
                  onChange={e => setOtp(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20))}
                  />
                </div>
              </div>
            )}

            <div className="login-helper-row">
              <label className="login-remember">
                <input type="checkbox" checked={rememberUsername} onChange={e => setRememberUsername(e.target.checked)} />
                <span>Se souvenir du nom</span>
              </label>
              {mfaToken && <button type="button" className="login-link-button" onClick={() => setMfaToken('')}>Retour</button>}
            </div>

            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? <span className="login-spinner" /> : loginState === 'success' ? <span className="login-success-check">✓</span> : <ArrowRight size={18} />}
              {loginState === 'success' ? 'Connexion réussie' : loading ? 'Verification...' : mfaToken ? 'Valider MFA' : 'Se connecter'}
            </button>
          </form>
          <p className="login-private-note"><LockKeyhole size={14} /> Application personnelle · utilisation locale</p>
        </div>
      </section>
    </main>
  )
}
