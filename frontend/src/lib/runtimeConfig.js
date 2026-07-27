const FIRESTORE_VALUE_KEYS = [
  'stringValue',
  'booleanValue',
  'integerValue',
  'doubleValue',
]

const defaults = {
  api_base_url: import.meta.env.VITE_API_BASE_URL || '/api',
  maintenance_mode: false,
  app_version: '',
}

let runtimeConfig = { ...defaults }

function readFirestoreValue(value) {
  if (!value || typeof value !== 'object') return undefined
  for (const key of FIRESTORE_VALUE_KEYS) {
    if (key in value) return value[key]
  }
  return undefined
}

function decodeFirestoreDocument(doc) {
  const fields = doc?.fields || {}
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, readFirestoreValue(value)])
      .filter(([, value]) => value !== undefined),
  )
}

async function fetchFirebaseConfig() {
  const host = window.location.hostname
  const isFirebaseHost = host.endsWith('.web.app') || host.endsWith('.firebaseapp.com')
  const forceFirebaseConfig = import.meta.env.VITE_FORCE_FIREBASE_CONFIG === 'true'
  if (!isFirebaseHost && !forceFirebaseConfig) return {}

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
  const collection = import.meta.env.VITE_FIREBASE_CONFIG_COLLECTION || 'app_config'
  const documentId = import.meta.env.VITE_FIREBASE_CONFIG_DOC || 'public'

  if (!projectId) return {}

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${documentId}`
    const url = apiKey ? `${baseUrl}?key=${apiKey}` : baseUrl
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return {}
    return decodeFirestoreDocument(await response.json())
  } catch {
    return {}
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchHostedConfig() {
  try {
    const response = await fetch(`/runtime-config.json?ts=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return {}
    return await response.json()
  } catch {
    return {}
  }
}

export async function loadRuntimeConfig() {
  const [hostedConfig, firebaseConfig] = await Promise.all([
    fetchHostedConfig(),
    fetchFirebaseConfig(),
  ])
  runtimeConfig = {
    ...defaults,
    ...hostedConfig,
    ...firebaseConfig,
  }
  return runtimeConfig
}

export function getRuntimeConfig() {
  return runtimeConfig
}
