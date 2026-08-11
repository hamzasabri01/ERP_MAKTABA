const SOUND_KEY = 'library-sabri:sound-enabled'
const SOUND_EVENT = 'library-sabri:sound-setting'

let audioContext = null
let masterGain = null
let lastPlayedAt = 0
let removeUnlockListeners = null

const patterns = {
  click: [[520, .035, .035, 'sine', .055]],
  add: [[520, .045, .025, 'sine', .07], [720, .055, .02, 'sine', .065]],
  scan: [[880, .045, .015, 'square', .055], [1320, .07, .02, 'sine', .075]],
  notification: [[660, .08, .02, 'sine', .07], [880, .1, .035, 'sine', .08]],
  warning: [[440, .1, .025, 'triangle', .075], [350, .12, .04, 'triangle', .07]],
  error: [[260, .105, .025, 'sawtooth', .065], [190, .16, .04, 'triangle', .065]],
  success: [[523, .07, .025, 'sine', .07], [659, .08, .02, 'sine', .075], [784, .13, .035, 'sine', .085]],
  payment: [[523, .065, .02, 'sine', .075], [659, .075, .02, 'sine', .08], [988, .17, .04, 'triangle', .095]],
}

export function soundsEnabled() {
  try { return window.localStorage.getItem(SOUND_KEY) !== 'false' }
  catch { return true }
}

export function setSoundsEnabled(enabled) {
  const next = Boolean(enabled)
  try { window.localStorage.setItem(SOUND_KEY, String(next)) } catch { /* optional preference */ }
  window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail:next }))
  if (next) {
    unlockAudio()
    window.setTimeout(() => playSound('success', { bypassThrottle:true }), 30)
  }
  return next
}

export function subscribeSoundSetting(callback) {
  const handler = event => callback(Boolean(event.detail))
  window.addEventListener(SOUND_EVENT, handler)
  return () => window.removeEventListener(SOUND_EVENT, handler)
}

function getAudioContext() {
  if (typeof window === 'undefined') return null
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext()
    masterGain = audioContext.createGain()
    masterGain.gain.value = .72
    masterGain.connect(audioContext.destination)
  }
  return audioContext
}

export function unlockAudio() {
  const context = getAudioContext()
  if (context?.state === 'suspended') context.resume().catch(() => {})
  return context
}

export function playSound(name = 'click', options = {}) {
  if (!soundsEnabled()) return false
  const pattern = patterns[name] || patterns.click
  const nowMs = performance.now()
  const throttle = name === 'click' ? 65 : 120
  if (!options.bypassThrottle && nowMs - lastPlayedAt < throttle) return false

  const context = unlockAudio()
  if (!context || context.state !== 'running') return false
  lastPlayedAt = nowMs
  let offset = 0
  pattern.forEach(([frequency, duration, gap, type, volume]) => {
    const start = context.currentTime + offset
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, start)
    gain.gain.setValueAtTime(.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + .008)
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration)
    oscillator.connect(gain)
    gain.connect(masterGain)
    oscillator.start(start)
    oscillator.stop(start + duration + .02)
    offset += duration + gap
  })
  return true
}

export function installUiSoundFeedback() {
  const unlock = () => unlockAudio()
  const click = event => {
    const control = event.target.closest?.('button, [role="button"], a.btn')
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return
    if (control.matches('[data-sound="none"]')) return
    if (control.matches('.btn-danger, [data-sound="danger"]')) playSound('warning')
    else if (control.matches('.pos-pay-btn, [data-sound="payment"]')) playSound('add')
    else if (control.matches('.btn-primary, .btn-success, [data-sound="important"]')) playSound('add')
    else playSound('click')
  }
  document.addEventListener('pointerdown', unlock, { passive:true })
  document.addEventListener('keydown', unlock, { passive:true })
  document.addEventListener('click', click)
  removeUnlockListeners = () => {
    document.removeEventListener('pointerdown', unlock)
    document.removeEventListener('keydown', unlock)
    document.removeEventListener('click', click)
  }
  return () => {
    removeUnlockListeners?.()
    removeUnlockListeners = null
  }
}
