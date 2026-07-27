// src/lib/api.js
import axios from 'axios'
import { getRuntimeConfig } from './runtimeConfig'

export const api = axios.create({
  baseURL: getRuntimeConfig().api_base_url,
  timeout: 30000,
  withCredentials: true,
})

const newOperationKey = () => globalThis.crypto?.randomUUID?.()
  || `op-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function operationHeaders(version, { idempotent = true } = {}) {
  const headers = { 'If-Match': String(version ?? 1) }
  if (idempotent) headers['Idempotency-Key'] = newOperationKey()
  return headers
}

export function idempotencyHeaders() {
  return { 'Idempotency-Key': newOperationKey() }
}

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Espèces' },
  { value: 'card', label: 'Carte' },
  { value: 'bank', label: 'Virement bancaire' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'credit', label: 'Crédit' },
]

export const SETTLEMENT_METHODS = PAYMENT_METHODS.filter(method => method.value !== 'credit')

export function paymentModeValue(value) {
  const aliases = {
    espece: 'cash',
    'espèce': 'cash',
    espèces: 'cash',
    carte: 'card',
    virement: 'bank',
    banque: 'bank',
    chèque: 'cheque',
    cheque: 'cheque',
    crédit: 'credit',
  }
  const raw = String(value || '').trim()
  return aliases[raw.toLowerCase()] || raw.toLowerCase()
}

export function paymentModeLabel(value) {
  const raw = String(value || '').trim()
  const normalized = paymentModeValue(raw)
  return PAYMENT_METHODS.find(method => method.value === normalized)?.label || raw || '—'
}

let accessToken = ''
let csrfToken = ''
let refreshPromise = null

export function setAccessToken(token = '') {
  accessToken = String(token || '')
}

export function clearAccessToken() {
  accessToken = ''
}

export function setCsrfToken(token = '') {
  csrfToken = String(token || '')
}

export function clearCsrfToken() {
  csrfToken = ''
}

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`
  const match = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix))
  return match ? decodeURIComponent(match.slice(prefix.length)) : ''
}

export async function refreshSession({ silent = false } = {}) {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      let currentCsrf = csrfToken || readCookie('proerp_csrf')
      if (!currentCsrf) {
        const { data } = await api.get('/auth/csrf', { skipAuthRefresh: true })
        currentCsrf = data.csrf_token || ''
        setCsrfToken(currentCsrf)
      }
      if (!currentCsrf) return null
      const { data } = await api.post('/auth/refresh', null, {
        headers: { 'X-CSRF-Token': currentCsrf },
        skipAuthRefresh: true,
      })
      setAccessToken(data.access_token)
      setCsrfToken(data.csrf_token)
      return data
    })().catch(error => {
      clearAccessToken()
      if (!silent) window.dispatchEvent(new CustomEvent('proerp:session-expired'))
      throw error
    }).finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export function csrfHeaders() {
  const token = csrfToken || readCookie('proerp_csrf')
  return token ? { 'X-CSRF-Token': token } : {}
}

export function applyApiBaseUrl(baseURL) {
  api.defaults.baseURL = baseURL || '/api'
}

export function resolveMediaUrl(path) {
  if (!path) return ''
  const value = String(path)
  if (/^(blob:|data:|https?:\/\/)/i.test(value)) return value

  const baseURL = String(api.defaults.baseURL || getRuntimeConfig().api_base_url || '/api')
  const absoluteBase = baseURL.startsWith('http')
    ? baseURL
    : new URL(baseURL, window.location.origin).href
  const apiOrigin = absoluteBase.replace(/\/api\/?$/, '').replace(/\/$/, '')
  const mediaPath = value.startsWith('/') ? value : `/${value}`

  return `${apiOrigin}${mediaPath}`
}

api.interceptors.request.use(cfg => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`
  return cfg
})

api.interceptors.response.use(
  res => res,
  async err => {
    const requestUrl = String(err.config?.url || '')
    const isAuthRequest = ['/auth/login', '/auth/firebase-login', '/auth/refresh', '/auth/logout', '/auth/csrf']
      .some(path => requestUrl.includes(path))
    const isLoginPage = window.location.pathname === '/login'
    const canRefresh = err.response?.status === 401 && !isAuthRequest && !isLoginPage && !err.config?.skipAuthRefresh && !err.config?._retried
    if (canRefresh) {
      try {
        await refreshSession()
        err.config._retried = true
        return api.request(err.config)
      } catch {
        // refreshSession emits the session-expired event.
      }
    }
    return Promise.reject(err)
  }
)

export const fmt = (n, decimals = 2) =>
  Number(n || 0).toLocaleString('fr-MA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

export const fmtDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-MA', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export const fmtDateTime = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleString('fr-MA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
