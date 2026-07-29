import { useEffect, useRef, useState } from 'react'
import { Barcode, Camera, CameraOff, CheckCircle2, Keyboard, Send, Wifi } from 'lucide-react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import './MobileScannerPage.css'

const API_ROOT = '/api/mobile-scanner'

export default function MobileScannerPage() {
  const token = new URLSearchParams(window.location.search).get('session') || ''
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const controlsRef = useRef(null)
  const readerRef = useRef(new BrowserMultiFormatReader())
  const lastScanRef = useRef({ value: '', at: 0 })
  const [status, setStatus] = useState('connecting')
  const [message, setMessage] = useState('Connexion au point de vente…')
  const [manual, setManual] = useState('')
  const [cameraRunning, setCameraRunning] = useState(false)
  const [lastCode, setLastCode] = useState('')

  const sendCode = async rawValue => {
    const barcode = String(rawValue || '').trim()
    if (!barcode || !token) return
    const now = Date.now()
    if (lastScanRef.current.value === barcode && now - lastScanRef.current.at < 1400) return
    lastScanRef.current = { value: barcode, at: now }
    try {
      const response = await fetch(`${API_ROOT}/sessions/${encodeURIComponent(token)}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Envoi impossible')
      setLastCode(barcode)
      setStatus('success')
      setMessage(`Code ${barcode} envoyé au POS`)
      navigator.vibrate?.([55, 45, 90])
      setTimeout(() => setStatus('ready'), 900)
    } catch (error) {
      setStatus('error')
      setMessage(error.message || 'Connexion perdue')
    }
  }

  const stopCamera = () => {
    controlsRef.current?.stop?.()
    controlsRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setCameraRunning(false)
  }

  const startCamera = async () => {
    if (!window.isSecureContext) {
      setStatus('error')
      setMessage('Ouvrez le nouveau QR Code HTTPS affiché dans le POS pour activer la caméra en direct.')
      return
    }
    try {
      stopCamera()
      const controls = await readerRef.current.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        videoRef.current,
        (result) => {
          const value = result?.getText?.()
          if (value) sendCode(value)
        },
      )
      controlsRef.current = controls
      streamRef.current = videoRef.current?.srcObject
      setCameraRunning(true)
      setStatus('ready')
      setMessage('Placez le code-barres dans le cadre')
    } catch {
      setStatus('error')
      setMessage('Accès caméra refusé. Vérifiez l’autorisation du navigateur.')
    }
  }

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('Lien scanner invalide')
      return undefined
    }
    const keepAlive = () => fetch(`${API_ROOT}/sessions/${encodeURIComponent(token)}`)
      .then(response => {
        if (!response.ok) throw new Error('Session expirée')
        setStatus('ready')
        setMessage(current => current.includes('envoyé au POS') ? current : 'Téléphone connecté au POS')
      })
      .catch(error => {
        setStatus('error')
        setMessage(error.message)
      })
    keepAlive()
    const heartbeat = window.setInterval(keepAlive, 60_000)
    return () => {
      window.clearInterval(heartbeat)
      stopCamera()
    }
  }, [token])

  return (
    <main className="mobile-scanner-page">
      <section className="mobile-scanner-card">
        <header>
          <span className="scanner-logo"><Barcode size={28}/></span>
          <div><strong>LIBRARY SABRI</strong><small>Scanner mobile POS</small></div>
          <Wifi size={20} className={status === 'error' ? 'is-offline' : 'is-online'}/>
        </header>

        <div className={`scanner-status is-${status}`}>
          {status === 'success' ? <CheckCircle2 size={20}/> : status === 'error' ? <CameraOff size={20}/> : <Wifi size={20}/>}
          <span>{message}</span>
        </div>

        <div className={`scanner-camera ${cameraRunning ? 'is-running' : ''}`}>
          <video ref={videoRef} playsInline muted />
          <div className="scanner-frame"><i/><i/><i/><i/></div>
          {!cameraRunning && <div className="scanner-camera-empty"><Camera size={44}/><span>Caméra arrière</span></div>}
          {lastCode && <div className="scanner-last-code"><CheckCircle2 size={16}/> {lastCode}</div>}
        </div>

        <button className="scanner-main-action" onClick={cameraRunning ? stopCamera : startCamera}>
          {cameraRunning ? <CameraOff size={20}/> : <Camera size={20}/>}
          {cameraRunning
            ? 'Arrêter la caméra'
            : 'Démarrer le scan direct'}
        </button>

        <div className="scanner-divider"><span>ou saisir le code</span></div>
        <form onSubmit={event => { event.preventDefault(); sendCode(manual); setManual('') }}>
          <div className="scanner-manual">
            <Keyboard size={19}/>
            <input value={manual} onChange={event => setManual(event.target.value)} inputMode="numeric" placeholder="Ex. 611000100001"/>
            <button type="submit" disabled={!manual.trim()} aria-label="Envoyer"><Send size={19}/></button>
          </div>
        </form>
        <footer>Gardez cette page ouverte pendant l’encaissement.</footer>
      </section>
    </main>
  )
}
