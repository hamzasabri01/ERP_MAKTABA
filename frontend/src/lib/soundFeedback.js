const SOUND_KEY = 'library-sabri:sound-enabled'
const SOUND_EVENT = 'library-sabri:sound-setting'

let audioContext = null
let masterGain = null
let lastPlayedAt = 0
let removeUnlockListeners = null

const patterns = {
  click: [[520, .045, .025, 'sine', .11]],
  add: [[520, .055, .02, 'sine', .13], [720, .075, .02, 'sine', .12]],
  scan: [[880, .055, .012, 'square', .105], [1320, .095, .02, 'sine', .14]],
  notification: [[660, .1, .02, 'sine', .13], [880, .14, .035, 'sine', .15]],
  warning: [[440, .12, .025, 'triangle', .14], [350, .16, .04, 'triangle', .13]],
  error: [[260, .13, .025, 'sawtooth', .12], [190, .2, .04, 'triangle', .13]],
  success: [[523, .085, .02, 'sine', .13], [659, .1, .02, 'sine', .14], [784, .17, .035, 'sine', .16]],
  payment: [[523, .08, .02, 'sine', .14], [659, .1, .02, 'sine', .15], [988, .22, .04, 'triangle', .18]],
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
    window.setTimeout(() => playSound('success', { bypassThrottle:true }), 80)
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
    masterGain.gain.value = .92
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

  const context = getAudioContext()
  if (!context) return false
  lastPlayedAt = nowMs
  const emit = () => {
    let offset = 0
    pattern.forEach(([frequency, duration, gap, type, volume]) => {
      const start = context.currentTime + .008 + offset
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
      oscillator.stop(start + duration + .025)
      offset += duration + gap
    })
  }
  if (context.state === 'running') emit()
  else context.resume().then(emit).catch(() => {})
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
