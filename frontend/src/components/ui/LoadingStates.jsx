export function PageLoader({ title = 'Chargement', detail = 'Preparation de la page...' }) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <div className="page-loader-card">
        <div className="page-loader-brand" aria-hidden="true">
          <span className="page-loader-orbit"><i /><i /><i /></span>
          <div className="page-loader-icon">
            <img src="/brand/sabri-library.png" alt="" />
          </div>
        </div>
        <div className="page-loader-copy">
          <span className="page-loader-name">LIBRARY SABRI</span>
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
        <div className="page-loader-dots" aria-hidden="true"><i /><i /><i /></div>
        <div className="page-loader-track">
          <span />
        </div>
      </div>
    </div>
  )
}

export function TableLoadingRow({ colSpan = 1, label = 'Chargement des donnees...' }) {
  return (
    <tr>
      <td colSpan={colSpan} className="table-loading-cell">
        <div className="table-loading-panel">
          <div className="table-loading-head">
            <span className="table-loading-pulse" />
            <strong>{label}</strong>
          </div>
          <div className="table-loading-lines">
            <span />
            <span />
            <span />
          </div>
          <div className="page-loader-track compact">
            <span />
          </div>
        </div>
      </td>
    </tr>
  )
}
