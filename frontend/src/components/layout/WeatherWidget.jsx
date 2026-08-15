import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cloud, CloudFog, CloudLightning, CloudRain, Droplets, Gauge, MapPin, Moon, RefreshCw, Sun, Sunrise, Sunset, Wind, X } from 'lucide-react'
import { api } from '../../lib/api'

const weatherMeta = (code, isDay = true, ar = false) => {
  if (code === 0) return { kind:isDay ? 'clear' : 'night', label:ar ? (isDay ? 'صحو' : 'سماء صافية') : (isDay ? 'Ensoleillé' : 'Nuit claire'), Icon:isDay ? Sun : Moon }
  if (code <= 3) return { kind:'cloudy', label:ar ? 'غائم جزئياً' : 'Partiellement nuageux', Icon:Cloud }
  if (code <= 48) return { kind:'fog', label:ar ? 'ضباب' : 'Brouillard', Icon:CloudFog }
  if (code <= 67 || (code >= 80 && code <= 82)) return { kind:'rain', label:ar ? 'أمطار' : 'Pluie', Icon:CloudRain }
  if (code >= 95) return { kind:'storm', label:ar ? 'عواصف رعدية' : 'Orages', Icon:CloudLightning }
  return { kind:'cloudy', label:ar ? 'غائم' : 'Nuageux', Icon:Cloud }
}

const round = value => Math.round(Number(value) || 0)
const hourLabel = (stamp, language) => stamp ? new Intl.DateTimeFormat(language === 'ar' ? 'ar-MA' : 'fr-FR', { hour:'2-digit', minute:'2-digit' }).format(new Date(stamp)) : '--:--'
const dayLabel = (stamp, language, index) => index === 0 ? (language === 'ar' ? 'اليوم' : "Aujourd’hui") : new Intl.DateTimeFormat(language === 'ar' ? 'ar-MA' : 'fr-FR', { weekday:'short' }).format(new Date(`${stamp}T12:00:00`))

function WeatherArt({ meta, size = 'small' }) {
  const Icon = meta.Icon
  return <span className={`weather-art weather-art-${size} is-${meta.kind}`} aria-hidden="true">
    <span className="weather-orb"/>
    <span className="weather-sprite"/>
    <Icon className="weather-main-icon"/>
    {meta.kind === 'rain' ? <><i className="weather-drop d1"/><i className="weather-drop d2"/><i className="weather-drop d3"/></> : null}
    {meta.kind === 'storm' ? <i className="weather-bolt">ϟ</i> : null}
    {meta.kind === 'cloudy' || meta.kind === 'fog' ? <i className="weather-drift"/> : null}
  </span>
}

export default function WeatherWidget({ language = 'fr' }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const rootRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: payload } = await api.get('/weather/berrechid', { timeout:15000 })
      setData(payload)
    } catch { /* keep the last successful reading */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(); const timer = window.setInterval(load, 10 * 60_000); return () => window.clearInterval(timer) }, [load])
  useEffect(() => {
    const close = event => { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const current = data?.current
  const meta = useMemo(() => weatherMeta(current?.weather_code ?? 0, current?.is_day !== 0, language === 'ar'), [current?.is_day, current?.weather_code, language])

  return <div className="weather-widget" ref={rootRef}>
    <button type="button" className={`weather-chip is-${meta.kind}`} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="dialog">
      <WeatherArt meta={meta}/>
      <span className="weather-chip-copy"><span className="weather-chip-place"><MapPin size={9}/>{language === 'ar' ? 'برشيد' : 'Berrechid'}</span><strong>{current ? `${round(current.temperature_2m)}°` : '—°'}</strong><small>{meta.label}</small></span>
    </button>
    {open ? <section className={`weather-popover is-${meta.kind}`} dir={language === 'ar' ? 'rtl' : 'ltr'} role="dialog" aria-label={language === 'ar' ? 'طقس برشيد' : 'Météo à Berrechid'}>
      <div className="weather-sky"><span className="weather-sky-glow"/><span className="weather-cloud c1"/><span className="weather-cloud c2"/></div>
      <header>
        <div><span><MapPin size={13}/>{language === 'ar' ? 'برشيد، المغرب' : 'Berrechid, Maroc'}</span><h3>{language === 'ar' ? 'الطقس الآن' : 'Météo actuelle'}</h3></div>
        <div><button type="button" className={loading ? 'is-loading' : ''} onClick={load} aria-label={language === 'ar' ? 'تحديث' : 'Actualiser'}><RefreshCw size={15}/></button><button type="button" onClick={() => setOpen(false)} aria-label={language === 'ar' ? 'إغلاق' : 'Fermer'}><X size={16}/></button></div>
      </header>
      <div className="weather-current">
        <div><WeatherArt meta={meta} size="large"/><span><strong>{current ? `${round(current.temperature_2m)}°` : '—°'}</strong><b>{meta.label}</b><small>{language === 'ar' ? 'المحسوسة' : 'Ressenti'} {round(current?.apparent_temperature)}°</small></span></div>
        <div className="weather-hi-low"><span>{round(data?.daily?.[0]?.temperature_max)}°</span><i>/</i><span>{round(data?.daily?.[0]?.temperature_min)}°</span></div>
      </div>
      <div className="weather-facts">
        <span><Droplets size={15}/><small>{language === 'ar' ? 'الرطوبة' : 'Humidité'}</small><b>{round(current?.relative_humidity_2m)}%</b></span>
        <span><Wind size={15}/><small>{language === 'ar' ? 'الرياح' : 'Vent'}</small><b>{round(current?.wind_speed_10m)} km/h</b></span>
        <span><CloudRain size={15}/><small>{language === 'ar' ? 'الأمطار' : 'Pluie'}</small><b>{round(data?.daily?.[0]?.precipitation_probability)}%</b></span>
        <span><Gauge size={15}/><small>{language === 'ar' ? 'الأشعة UV' : 'Indice UV'}</small><b>{round(data?.daily?.[0]?.uv_index_max)}</b></span>
      </div>
      <div className="weather-section">
        <h4>{language === 'ar' ? 'التوقعات بالساعات' : 'Prévisions heure par heure'}</h4>
        <div className="weather-hourly">{data?.hourly?.slice(0, 8).map((item, index) => { const itemMeta = weatherMeta(item.weather_code, true, language === 'ar'); return <div key={item.time}><small>{index === 0 ? (language === 'ar' ? 'الآن' : 'Maint.') : hourLabel(item.time, language)}</small><WeatherArt meta={itemMeta} size="mini"/><b>{round(item.temperature)}°</b><span><Droplets size={10}/>{round(item.precipitation_probability)}%</span></div> })}</div>
      </div>
      <div className="weather-section weather-week"><h4>{language === 'ar' ? 'توقعات الأيام القادمة' : 'Prévisions sur 7 jours'}</h4>{data?.daily?.slice(0, 7).map((day, index) => { const itemMeta = weatherMeta(day.weather_code, true, language === 'ar'); return <div key={day.date}><b>{dayLabel(day.date, language, index)}</b><WeatherArt meta={itemMeta} size="mini"/><small><Droplets size={10}/>{round(day.precipitation_probability)}%</small><span>{round(day.temperature_max)}° <i>{round(day.temperature_min)}°</i></span></div> })}</div>
      <footer><span><Sunrise size={12}/>{hourLabel(data?.daily?.[0]?.sunrise, language)}</span><span>{language === 'ar' ? 'بيانات الطقس من Open‑Meteo' : 'Données météo Open‑Meteo'}</span><span><Sunset size={12}/>{hourLabel(data?.daily?.[0]?.sunset, language)}</span></footer>
    </section> : null}
  </div>
}
