import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { BellRing, Check, Clock3, MapPin, MoonStar, PauseCircle, Play, RefreshCw, Volume2, VolumeX, X } from 'lucide-react'
import { api } from '../../lib/api'
import { storageGet, storageJson, storageSet } from '../../lib/safeStorage'

const PRAYERS = [
  ['Fajr', 'الفجر', 'Fajr'], ['Dhuhr', 'الظهر', 'Dhohr'], ['Asr', 'العصر', 'Asr'],
  ['Maghrib', 'المغرب', 'Maghrib'], ['Isha', 'العشاء', 'Icha'],
]
const ENABLED_KEY = 'library-sabri:prayer-alerts'
const PAUSE_KEY = 'library-sabri:prayer-pause-media'
const EVENTS_KEY = 'library-sabri:prayer-events-v2'
const AUDIO_KEY = 'library-sabri:adhan-volume'
const TIMEZONE = 'Africa/Casablanca'

const enabledSetting = key => storageGet(key) !== 'false'
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function minuteOfDay(time) {
  const [hours, minutes] = String(time || '').split(':').map(Number)
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : -1
}

function zonedClock(date, timezone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return {
    date:`${values.year}-${values.month}-${values.day}`,
    minute:Number(values.hour) * 60 + Number(values.minute),
    second:Number(values.second),
  }
}

function browserNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try { new Notification(title, { body, icon:'/brand/sabri-library.png', tag:`prayer-${title}`, renotify:true }) } catch { /* toast remains */ }
}

function eventWasHandled(key) {
  const events = storageJson(EVENTS_KEY, {}) || {}
  return Boolean(events[key])
}

function rememberEvent(key) {
  const events = storageJson(EVENTS_KEY, {}) || {}
  const next = { ...events, [key]:Date.now() }
  const recent = Object.fromEntries(Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, 30))
  storageSet(EVENTS_KEY, JSON.stringify(recent))
}

export default function PrayerTimesWidget({ language = 'fr' }) {
  const [data, setData] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [alertsEnabled, setAlertsEnabled] = useState(() => enabledSetting(ENABLED_KEY))
  // Media control is opt-in: a blind Windows play/pause key must never start
  // media that the user had already paused themselves.
  const [pauseMedia, setPauseMedia] = useState(() => storageGet(PAUSE_KEY) === 'true')
  const [volume, setVolume] = useState(() => clamp(Number(storageGet(AUDIO_KEY, '.86')) || .86, .15, 1))
  const [audioReady, setAudioReady] = useState(false)
  const [audioError, setAudioError] = useState(false)
  const [adhanActive, setAdhanActive] = useState(false)
  const audioRef = useRef(null)
  const rootRef = useRef(null)
  const lastClockRef = useRef(null)

  const load = useCallback(async ({ quiet = false } = {}) => {
    setLoading(true)
    try {
      const { data: payload } = await api.get('/prayer-times/today', { timeout:15000 })
      setData(payload)
      if (!quiet) toast.success(language === 'ar' ? 'تم تحديث مواقيت الصلاة' : 'Horaires de prière actualisés')
    } catch {
      if (!quiet) toast.error(language === 'ar' ? 'تعذر تحديث مواقيت الصلاة' : 'Mise à jour des horaires impossible')
    } finally {
      setLoading(false)
    }
  }, [language])

  useEffect(() => { load({ quiet:true }) }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (data?.date && zonedClock(now, data.timezone).date !== data.date) load({ quiet:true })
  }, [data?.date, data?.timezone, load, now])
  useEffect(() => {
    const outside = event => { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])

  const clock = useMemo(() => zonedClock(now, data?.timezone || TIMEZONE), [data?.timezone, now])
  const nextPrayer = useMemo(() => {
    if (!data?.timings) return null
    for (const [key, ar, fr] of PRAYERS) {
      const at = minuteOfDay(data.timings[key])
      if (at >= clock.minute) return { key, ar, fr, time:data.timings[key], minutes:at - clock.minute }
    }
    const [key, ar, fr] = PRAYERS[0]
    return { key, ar, fr, time:data.timings[key], minutes:1440 - clock.minute + minuteOfDay(data.timings[key]), tomorrow:true }
  }, [clock.minute, data])

  const stopAdhan = useCallback(() => {
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.currentTime = 0 }
    setAdhanActive(false)
    api.post('/prayer-times/media/resume').catch(() => {})
  }, [])

  const startAdhan = useCallback(async (prayer, manual = false) => {
    if (adhanActive || audioError) return
    const audio = audioRef.current
    if (!audio) return
    let mediaPaused = false
    if (pauseMedia) {
      try { await api.post('/prayer-times/media/pause'); mediaPaused = true } catch { /* adhan should still play */ }
    }
    audio.currentTime = 0
    audio.volume = volume
    try {
      await audio.play()
      setAdhanActive(true)
      if (!manual) {
        toast.success(`حان الآن موعد صلاة ${prayer.ar} في برشيد`, { duration:9000, icon:'🕌' })
        browserNotification(`أذان ${prayer.ar}`, `حان الآن موعد صلاة ${prayer.ar} بمدينة برشيد`)
      }
    } catch {
      if (mediaPaused) api.post('/prayer-times/media/resume').catch(() => {})
      toast.error(language === 'ar' ? 'اضغط على «تجربة الأذان» للسماح بالصوت' : "Cliquez sur « Tester l’adhan » pour autoriser le son")
    }
  }, [adhanActive, audioError, language, pauseMedia, volume])

  useEffect(() => {
    if (!alertsEnabled || !data?.timings) { lastClockRef.current = clock; return }
    const previous = lastClockRef.current
    lastClockRef.current = clock
    PRAYERS.forEach(([key, ar, fr]) => {
      const prayerMinute = minuteOfDay(data.timings[key])
      const beforeKey = `${data.date}:${key}:before`
      const adhanKey = `${data.date}:${key}:adhan`
      const crossed = target => previous?.date === clock.date && previous.minute < target && clock.minute >= target
      const withinCurrentMinute = target => clock.minute === target
      if ((withinCurrentMinute(prayerMinute - 5) || crossed(prayerMinute - 5)) && !eventWasHandled(beforeKey)) {
        rememberEvent(beforeKey)
        toast(`بقيت 5 دقائق على أذان ${ar} في برشيد`, { duration:6500, icon:'🕌' })
        browserNotification(`اقترب أذان ${ar}`, 'بقيت 5 دقائق على موعد الصلاة في برشيد')
      }
      if ((withinCurrentMinute(prayerMinute) || crossed(prayerMinute)) && !eventWasHandled(adhanKey)) {
        rememberEvent(adhanKey)
        startAdhan({ key, ar, fr, time:data.timings[key] })
      }
    })
  }, [alertsEnabled, clock, data, startAdhan])

  const requestNotifications = async () => {
    if (!('Notification' in window)) return toast.error('إشعارات Windows غير مدعومة في هذا المتصفح')
    const permission = await Notification.requestPermission()
    toast(permission === 'granted' ? 'تم تفعيل إشعارات Windows' : 'لم يتم السماح بإشعارات Windows')
  }

  const countdown = nextPrayer
    ? nextPrayer.minutes <= 0 ? (language === 'ar' ? 'الآن' : 'Maintenant')
      : nextPrayer.minutes < 60 ? `${nextPrayer.minutes} min`
        : `${Math.floor(nextPrayer.minutes / 60)} h ${nextPrayer.minutes % 60} min`
    : '—'
  const label = language === 'ar' ? nextPrayer?.ar : nextPrayer?.fr

  return (
    <div className="prayer-widget" ref={rootRef}>
      <audio
        ref={audioRef}
        src="/audio/adhan.ogg"
        preload="auto"
        onCanPlayThrough={() => { setAudioReady(true); setAudioError(false) }}
        onEnded={stopAdhan}
        onError={() => { setAudioReady(false); setAudioError(true); setAdhanActive(false) }}
      />
      <button type="button" className={`prayer-chip${adhanActive ? ' is-adhan' : ''}`} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="dialog" data-sound="none">
        <span className="prayer-chip-icon"><MoonStar size={19}/></span>
        <span>
          <small>{adhanActive ? 'الأذان الآن' : (language === 'ar' ? `بعد ${countdown}` : `Dans ${countdown}`)}</small>
          <strong>{adhanActive ? 'حي على الصلاة' : `${label || '—'} · ${nextPrayer?.time || '--:--'}`}</strong>
        </span>
      </button>
      {open ? <section className="prayer-popover" dir={language === 'ar' ? 'rtl' : 'ltr'} role="dialog" aria-label={language === 'ar' ? 'مواقيت الصلاة' : 'Horaires de prière'}>
        <header>
          <div><span><MapPin size={14}/> {language === 'ar' ? 'برشيد' : 'Berrechid'}</span><h3>{language === 'ar' ? 'مواقيت الصلاة' : 'Horaires de prière'}</h3></div>
          <div className="prayer-header-actions"><button type="button" className={loading ? 'is-loading' : ''} onClick={() => load()} disabled={loading} aria-label="Actualiser"><RefreshCw size={15}/></button><button type="button" onClick={() => setOpen(false)} aria-label="Fermer"><X size={16}/></button></div>
        </header>
        <div className="prayer-list">
          {PRAYERS.map(([key, ar, fr]) => <div key={key} className={nextPrayer?.key === key ? 'is-next' : ''}><span>{language === 'ar' ? ar : fr}<small>{language === 'ar' ? key : ar}</small></span><strong>{data?.timings?.[key] || '--:--'}</strong>{nextPrayer?.key === key ? <i><Clock3 size={12}/> {language === 'ar' ? 'القادمة' : 'Suivante'}</i> : null}</div>)}
        </div>
        <div className="prayer-next-summary"><MoonStar size={18}/><span><small>{language === 'ar' ? 'الصلاة القادمة' : 'Prochaine prière'}</small><b>{label || '—'} · {nextPrayer?.time || '--:--'}</b></span><strong>{countdown}</strong></div>
        <div className="prayer-options">
          <label><input type="checkbox" checked={alertsEnabled} onChange={event => { setAlertsEnabled(event.target.checked); storageSet(ENABLED_KEY, String(event.target.checked)) }}/><span><BellRing size={16}/><b>{language === 'ar' ? 'إشعارات الأذان' : 'Alertes de prière'}</b><small>{language === 'ar' ? 'قبل الموعد بخمس دقائق وعند الأذان' : "5 minutes avant et à l’heure de l’adhan"}</small></span></label>
          <label><input type="checkbox" checked={pauseMedia} onChange={event => { setPauseMedia(event.target.checked); storageSet(PAUSE_KEY, String(event.target.checked)) }}/><span><PauseCircle size={16}/><b>{language === 'ar' ? 'إيقاف الوسائط أثناء الأذان' : "Suspendre les médias pendant l’adhan"}</b><small>YouTube · Spotify · Windows</small></span></label>
          <label className="prayer-volume"><Volume2 size={16}/><span><b>{language === 'ar' ? 'مستوى صوت الأذان' : "Volume de l’adhan"}</b><input type="range" min="15" max="100" value={Math.round(volume * 100)} onChange={event => { const next = Number(event.target.value) / 100; setVolume(next); storageSet(AUDIO_KEY, String(next)); if (audioRef.current) audioRef.current.volume = next }}/></span><strong>{Math.round(volume * 100)}%</strong></label>
        </div>
        {audioError ? <div className="prayer-audio-status is-error"><VolumeX size={15}/>{language === 'ar' ? 'تعذر تحميل ملف الأذان' : "Impossible de charger le fichier audio"}</div> : <div className={`prayer-audio-status${audioReady ? ' is-ready' : ''}`}><Volume2 size={15}/>{audioReady ? (language === 'ar' ? 'ملف الأذان جاهز' : 'Audio prêt') : (language === 'ar' ? 'جارٍ تجهيز الصوت…' : 'Préparation audio…')}</div>}
        <div className="prayer-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={requestNotifications}><BellRing size={14}/> {language === 'ar' ? 'إشعارات Windows' : 'Notifications Windows'}</button>
          {adhanActive
            ? <button type="button" className="btn btn-danger btn-sm" onClick={stopAdhan}><X size={14}/> {language === 'ar' ? 'إيقاف الأذان' : "Arrêter l’adhan"}</button>
            : <button type="button" className="btn btn-primary btn-sm" onClick={() => startAdhan(nextPrayer || { ar:'الصلاة', fr:'Prière' }, true)} disabled={audioError}><Play size={14}/> {language === 'ar' ? 'تجربة الأذان' : "Tester l’adhan"}</button>}
        </div>
        <footer><Check size={12}/> {language === 'ar' ? 'طريقة الحساب الرسمية للمغرب' : 'Méthode officielle du Maroc'} · {data?.cached ? (language === 'ar' ? 'نسخة محفوظة' : 'Cache local') : (language === 'ar' ? 'محدّث اليوم' : "À jour aujourd’hui")}</footer>
      </section> : null}
    </div>
  )
}
