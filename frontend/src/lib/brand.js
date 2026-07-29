import { resolveMediaUrl } from './api'

export const DEFAULT_LOGO_URL = '/brand/sabri-library.png'
export const DEFAULT_WORDMARK_URL = '/brand/proerp-wordmark.svg'

export function getLogoUrl(settings = {}, fallback = DEFAULT_LOGO_URL) {
  return settings.logo_url ? resolveMediaUrl(settings.logo_url) : fallback
}

export function getCompanyName(settings = {}) {
  return settings.name || settings.store_name || settings.app_name || 'LIBRARY SABRI'
}
