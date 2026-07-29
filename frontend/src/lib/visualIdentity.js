const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function color(value, fallback) {
  const next = String(value || '').trim()
  return HEX_COLOR.test(next) ? next : fallback
}

export function getVisualIdentity(settings = {}) {
  return {
    primary: color(settings.brand_primary_color, '#1769E0'),
    secondary: color(settings.brand_secondary_color, '#F59E0B'),
    success: color(settings.brand_success_color, '#16A34A'),
    document: color(settings.brand_document_color, '#111827'),
    logoSize: Math.min(Math.max(Number(settings.brand_print_logo_size || 42), 28), 96),
  }
}

export function applyVisualIdentity(settings = {}) {
  const identity = getVisualIdentity(settings)
  const root = document.documentElement
  root.style.setProperty('--accent', identity.primary)
  root.style.setProperty('--accent2', identity.secondary)
  root.style.setProperty('--brand-primary', identity.primary)
  root.style.setProperty('--brand-secondary', identity.secondary)
  root.style.setProperty('--accent-glow', `color-mix(in srgb, ${identity.primary} 15%, transparent)`)
  root.style.setProperty('--success', identity.success)
  root.style.setProperty('--brand-document-color', identity.document)
  root.style.setProperty('--brand-print-logo-size', `${identity.logoSize}px`)

  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', identity.primary)
}
