import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, clearAccessToken, clearCsrfToken, csrfHeaders, refreshSession, setAccessToken, setCsrfToken } from './api'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)

  const clearSession = useCallback((expired = false) => {
    clearAccessToken()
    clearCsrfToken()
    setUser(null)
    setSessionExpired(expired)
  }, [])

  useEffect(() => {
    const handleExpired = () => clearSession(true)
    window.addEventListener('proerp:session-expired', handleExpired)
    return () => window.removeEventListener('proerp:session-expired', handleExpired)
  }, [clearSession])

  useEffect(() => {
    let mounted = true
    refreshSession({ silent: true })
      .then(data => {
        if (mounted && data?.user) setUser(data.user)
      })
      .catch(() => {
        if (mounted) clearSession(false)
      })
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [clearSession])

  const storeLogin = useCallback(data => {
    setAccessToken(data.access_token)
    setCsrfToken(data.csrf_token)
    setUser(data.user)
    setSessionExpired(false)
    return data.user
  }, [])

  const login = useCallback(async (username, password) => {
    clearSession(false)
    const { data } = await api.post('/auth/login', { username, password }, { skipAuthRefresh: true })
    if (data.mfa_required) return data
    return storeLogin(data)
  }, [clearSession, storeLogin])

  const completeMfaLogin = useCallback(async (mfaToken, code) => {
    clearSession(false)
    const { data } = await api.post('/auth/login/mfa', { mfa_token: mfaToken, code }, { skipAuthRefresh: true })
    return storeLogin(data)
  }, [clearSession, storeLogin])

  const firebaseLogin = useCallback(async idToken => {
    clearSession(false)
    const { data } = await api.post('/auth/firebase-login', { id_token: idToken }, { skipAuthRefresh: true })
    if (data.mfa_required) return data
    return storeLogin(data)
  }, [clearSession, storeLogin])

  const refreshUser = useCallback(async () => {
    const { data } = await api.get('/auth/me')
    setUser(data)
    return data
  }, [])

  const updateProfile = useCallback(async payload => {
    const { data } = await api.put('/auth/me', payload)
    setUser(data)
    return data
  }, [])

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const { data } = await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    })
    clearSession(false)
    return data
  }, [clearSession])

  const setupMfa = useCallback(async password => {
    const { data } = await api.post('/auth/mfa/setup', { password })
    return data
  }, [])

  const enableMfa = useCallback(async code => {
    const { data } = await api.post('/auth/mfa/enable', { code })
    setAccessToken(data.access_token)
    setCsrfToken(data.csrf_token)
    setUser(data.user)
    return data
  }, [])

  const disableMfa = useCallback(async (password, code) => {
    const { data } = await api.post('/auth/mfa/disable', { password, code })
    setAccessToken(data.access_token)
    setCsrfToken(data.csrf_token)
    setUser(data.user)
    return data.user
  }, [])

  const regenerateRecoveryCodes = useCallback(async (password, code) => {
    const { data } = await api.post('/auth/mfa/recovery-codes', { password, code })
    return data.recovery_codes || []
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', null, { headers: csrfHeaders(), skipAuthRefresh: true })
    } catch {
      // Local logout must remain available when the backend is offline.
    } finally {
      clearSession(false)
    }
  }, [clearSession])

  // Keep an open workstation signed in. Refresh tokens are rotated before the
  // short-lived access token expires, so normal use never jumps back to login.
  useEffect(() => {
    if (!user) return undefined
    const renew = () => refreshSession({ silent: true })
      .then(data => data?.user && setUser(data.user))
      .catch(() => {})
    const timer = window.setInterval(renew, 10 * 60 * 1000)
    const renewWhenActive = () => {
      if (document.visibilityState === 'visible') renew()
    }
    window.addEventListener('online', renew)
    document.addEventListener('visibilitychange', renewWhenActive)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', renew)
      document.removeEventListener('visibilitychange', renewWhenActive)
    }
  }, [user?.id])

  const hasPermission = useCallback(permission => {
    const permissions = user?.permissions || []
    return permissions.includes('all') || permissions.includes(permission)
  }, [user?.permissions])

  const displayName = user?.full_name?.trim() || user?.username || 'Utilisateur'
  const value = useMemo(() => ({
    user,
    login,
    completeMfaLogin,
    firebaseLogin,
    logout,
    loading,
    sessionExpired,
    hasPermission,
    displayName,
    refreshUser,
    updateProfile,
    changePassword,
    setupMfa,
    enableMfa,
    disableMfa,
    regenerateRecoveryCodes,
  }), [
    user, login, completeMfaLogin, firebaseLogin, logout, loading, sessionExpired,
    hasPermission, displayName, refreshUser, updateProfile, changePassword,
    setupMfa, enableMfa, disableMfa, regenerateRecoveryCodes,
  ])

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
