import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { applyApiBaseUrl } from './lib/api'
import { loadRuntimeConfig } from './lib/runtimeConfig'
import './index.css'

loadRuntimeConfig().then(config => {
  applyApiBaseUrl(config.api_base_url)

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
