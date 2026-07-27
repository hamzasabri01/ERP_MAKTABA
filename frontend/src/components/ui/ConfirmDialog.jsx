import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Trash2, X } from 'lucide-react'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)

  const confirm = useCallback((options) => new Promise(resolve => {
    setRequest({
      title: 'Confirmation',
      message: 'Voulez-vous continuer ?',
      confirmText: 'Confirmer',
      cancelText: 'Annuler',
      tone: 'warning',
      ...options,
      resolve,
    })
  }), [])

  const close = (answer) => {
    if (request?.resolve) request.resolve(answer)
    setRequest(null)
  }

  const value = useMemo(() => ({ confirm }), [confirm])
  const Icon = request?.tone === 'danger' ? Trash2 : request?.tone === 'success' ? CheckCircle2 : AlertTriangle

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request && (
        <div className="modal-overlay" onClick={event => event.target === event.currentTarget && close(false)}>
          <div className={`modal confirm-pro ${request.tone || 'warning'}`} role="dialog" aria-modal="true">
            <div className="confirm-pro-icon"><Icon size={22} /></div>
            <button className="confirm-pro-close" onClick={() => close(false)} aria-label="Fermer">
              <X size={16} />
            </button>
            <div className="modal-body">
              <h2>{request.title}</h2>
              <p>{request.message}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => close(false)}>{request.cancelText}</button>
              <button className={`btn ${request.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
                {request.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider')
  return ctx.confirm
}
