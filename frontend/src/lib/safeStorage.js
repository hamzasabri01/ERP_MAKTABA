export function storageGet(key, fallback = '') {
  try {
    const value = window.localStorage.getItem(key)
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

export function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, String(value))
    return true
  } catch {
    return false
  }
}

export function storageRemove(key) {
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function storageJson(key, fallback = null) {
  try {
    return JSON.parse(storageGet(key, 'null')) ?? fallback
  } catch {
    return fallback
  }
}
