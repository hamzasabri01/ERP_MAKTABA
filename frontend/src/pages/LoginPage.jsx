// src/pages/LoginPage.jsx
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  Server,
  ShieldCheck,
  Sun,
  Moon,
  User,
  Wifi,
} from 'lucide-react'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import { getRuntimeConfig } from '../lib/runtimeConfig'
import {
  firebaseAuthErrorMessage,
  getFirebaseAuthConfig,
  isFirebaseAuthConfigured,
  signInWithFirebaseEmail,
} from '../lib/firebaseAuth'
import './LoginPage.css'

export default function LoginPage() {
  const { login, completeMfaLogin, firebaseLogin } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const runtimeConfig = getRuntimeConfig()
  const firebaseConfig = getFirebaseAuthConfig()
  const firebaseReady = isFirebaseAuthConfigured()
  const [mode, setMode] = useState('local')
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [mfaToken, setMfaToken] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const sessionExpired = location.state?.reason === 'session-expired'

  const apiBaseUrl = runtimeConfig.api_base_url
  const activeMode = firebaseReady ? mode : 'local'
  const usernameLabel = activeMode === 'firebase' ? 'Email Firebase' : "Nom d'utilisateur"
  const usernamePlaceholder = activeMode === 'firebase' ? 'admin@maktaba.local' : 'admin'
  const usernameValue = activeMode === 'firebase' ? form.email : form.username

  const statusItems = useMemo(() => ([
    {
      icon: <Server size={18} />,
      title: 'API local controle',
      detail: apiBaseUrl?.replace('/api', '') || 'Configuration runtime',
    },
    {
      icon: <Cloud size={18} />,
      title: firebaseReady ? 'Firebase connecte' : 'Firebase Auth optionnel',
      detail: firebaseReady ? firebaseConfig.projectId : 'Ajoutez VITE_FIREBASE_API_KEY pour activer',
    },
    {
      icon: <ShieldCheck size={18} />,
      title: 'Session securisee',
      detail: 'Jeton local, permissions et roles magasin',
    },
  ]), [apiBaseUrl, firebaseConfig.projectId, firebaseReady])

  const handleChange = (key, value) => {
    setForm(current => ({ ...current, [key]: value }))
  }

  const handleFirebaseTabClick = () => {
    if (!firebaseReady) {
      toast.error('Firebase Auth non configure. Ajoutez VITE_FIREBASE_API_KEY dans frontend/.env')
      return
    }
    setMode('firebase')
  }

  const handleBackendLogin = async () => {
    const result = await login(form.username.trim(), form.password)
    if (result?.mfa_required) {
      setMfaToken(result.mfa_token)
      setOtp('')
      toast.success('Code MFA requis')
      return
    }
    toast.success('Connexion reussie')
    navigate('/')
  }

  const handleFirebaseLogin = async () => {
    const firebaseUser = await signInWithFirebaseEmail(form.email.trim(), form.password)
    const result = await firebaseLogin(firebaseUser.idToken)
    if (result?.mfa_required) {
      setMfaToken(result.mfa_token)
      setOtp('')
      toast.success('Code MFA requis apres Firebase')
      return
    }
    toast.success('Connexion Firebase validee')
    navigate('/')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const username = activeMode === 'firebase' ? form.email : form.username
    if (!username.trim() || !form.password) return
    if (mfaToken && !otp.trim()) return

    setLoading(true)
    try {
      if (mfaToken) {
        await completeMfaLogin(mfaToken, otp.trim())
        toast.success('Connexion MFA reussie')
        navigate('/')
      } else if (activeMode === 'firebase') {
        await handleFirebaseLogin()
      } else {
        await handleBackendLogin()
      }
    } catch (err) {
      if (err.response?.status === 403) {
        toast.error(err.response?.data?.detail || 'Utilisateur Maktaba Print non autorise')
      } else if (activeMode === 'firebase' && !err.response) {
        toast.error(firebaseAuthErrorMessage(err.message))
      } else if (!err.response) {
        toast.error('Connexion API impossible. Verifiez le tunnel, serveur local ou CORS.')
      } else {
        toast.error(err.response?.data?.detail || 'Identifiants invalides')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-brand-panel" aria-label="Maktaba Print security overview">
        <div className="login-logo-lockup">
          <img className="login-logo-mark" src="/brand/proerp-logo.svg" alt="Maktaba Print" />
          <div>
            <p className="login-logo-title">Maktaba Print</p>
            <p className="login-logo-subtitle">Librairie, copie et impression</p>
          </div>
        </div>

        <div className="login-brand-copy">
          <span className="login-kicker">
            <LockKeyhole size={15} />
            Gestion locale securisee
          </span>
          <h1>Ventes, stock et impressions au meme comptoir.</h1>
          <p>
            Suivez les fournitures scolaires, les tickets POS, les factures, les services de photocopie et les impressions depuis une interface unique.
          </p>
          <div className="login-access-chips" aria-label="Etat de connexion">
            <span><Wifi size={15} /> LAN pret</span>
            <span><CheckCircle2 size={15} /> Stock controle</span>
          </div>
        </div>

        <div className="login-status-stack">
          {statusItems.map((item) => (
            <div className="login-status-item" key={item.title}>
              <span className="login-status-dot" />
              {item.icon}
              <div>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="login-main-panel">
        <div className="login-card">
          <div className="login-topbar">
            <span className="login-mode-chip">
              {activeMode === 'firebase' ? <Cloud size={15} /> : <Server size={15} />}
              {activeMode === 'firebase' ? 'Firebase Auth' : 'Serveur local'}
            </span>
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

          <div className="login-card-header">
            <div>
              <h2>Connexion</h2>
              <p>Choisissez la methode adaptee a votre installation.</p>
            </div>
            <div className="login-security-badge">
              <KeyRound size={22} />
            </div>
          </div>

          <div className="login-auth-tabs" role="tablist" aria-label="Authentication method">
            <button
              type="button"
              className={activeMode === 'local' ? 'active' : ''}
              onClick={() => setMode('local')}
            >
              <Server size={16} />
              <span>Magasin local</span>
            </button>
            <button
              type="button"
              className={[
                activeMode === 'firebase' ? 'active' : '',
                !firebaseReady ? 'pending' : '',
              ].filter(Boolean).join(' ')}
              onClick={handleFirebaseTabClick}
              title={firebaseReady ? 'Firebase Auth' : 'Ajoutez VITE_FIREBASE_API_KEY'}
            >
              <Cloud size={16} />
              <span>Firebase</span>
            </button>
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
              <label>{usernameLabel}</label>
              <div className="login-input-wrap">
                {activeMode === 'firebase' ? <Mail size={18} /> : <User size={18} />}
                <input
                  type={activeMode === 'firebase' ? 'email' : 'text'}
                  autoFocus
                  autoComplete={activeMode === 'firebase' ? 'email' : 'username'}
                  placeholder={usernamePlaceholder}
                  value={usernameValue}
                  onChange={e => handleChange(activeMode === 'firebase' ? 'email' : 'username', e.target.value)}
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
              <span>{mfaToken ? 'Le challenge MFA expire apres quelques minutes.' : activeMode === 'firebase' ? 'Firebase verifie le compte, Maktaba Print garde les roles.' : import.meta.env.DEV ? 'Compte initial disponible uniquement en environnement local.' : 'Contactez votre administrateur pour obtenir un acces.'}</span>
              {mfaToken && <button type="button" className="login-link-button" onClick={() => setMfaToken('')}>Retour</button>}
            </div>

            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? <span className="login-spinner" /> : <ArrowRight size={18} />}
              {loading ? 'Verification...' : mfaToken ? 'Valider MFA' : 'Se connecter'}
            </button>
          </form>

          {!firebaseReady && (
            <div className="login-firebase-note">
              Firebase Auth est pret cote UI. Pour l'activer, ajoutez la cle Web API Firebase dans <strong>frontend/.env</strong>.
            </div>
          )}

          <div className="login-api-pill">
            API: <code>{apiBaseUrl}</code>
          </div>
        </div>
      </section>
    </main>
  )
}
