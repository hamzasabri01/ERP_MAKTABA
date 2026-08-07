import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { applyApiBaseUrl } from './lib/api'
import { loadRuntimeConfig } from './lib/runtimeConfig'
import './index.css'

loadRuntimeConfig().catch(error => {
  console.warn('Runtime configuration unavailable; using local defaults.', error)
  return { api_base_url: '/api' }
}).then(config => {
  applyApiBaseUrl(config?.api_base_url || '/api')

  const root = document.getElementById('root')
  if (!root) throw new Error('Application root element is missing')
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
