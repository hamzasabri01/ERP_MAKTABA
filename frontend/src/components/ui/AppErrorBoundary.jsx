import { Component } from 'react'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'

export default class AppErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Recovered React render error', error, info)
  }

  reload = () => window.location.reload()

  goHome = () => {
    const base = window.location.pathname.startsWith('/erp') ? '/erp' : ''
    window.location.assign(`${base}/dashboard`)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="app-crash" role="alert" aria-live="assertive">
        <section className="app-crash-card">
          <span className="app-crash-icon"><AlertTriangle size={30} /></span>
          <div>
            <p className="app-crash-eyebrow">LIBRARY SABRI</p>
            <h1>Une erreur d’affichage a été interceptée</h1>
            <p>
              Vos données ne sont pas supprimées. Rechargez la page pour reprendre le travail.
              Si l’erreur concerne une page précise, revenez au tableau de bord.
            </p>
          </div>
          <div className="app-crash-actions">
            <button type="button" className="btn btn-primary" onClick={this.reload}>
              <RefreshCw size={17} /> Recharger
            </button>
            <button type="button" className="btn btn-secondary" onClick={this.goHome}>
              <Home size={17} /> Tableau de bord
            </button>
          </div>
          {import.meta.env.DEV ? (
            <details>
              <summary>Détail technique</summary>
              <pre>{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
            </details>
          ) : null}
        </section>
      </main>
    )
  }
}
