import { toDate, words } from './lib.js'

export default function HistoryPanel({ versions, selected, onSelect, onRestore, canRestore, onClose }) {
  const preview = versions.find((v) => v.id === selected)
  return (
    <div className="history">
      <div className="h-head">
        <strong>History</strong>
        <button className="text-btn" onClick={onClose} aria-label="Close">close</button>
      </div>
      {versions.length === 0 ? (
        <p className="empty">Nothing yet. Earlier versions show up as you keep editing.</p>
      ) : (
        <>
          <ul className="versions">
            {versions.map((v) => (
              <li key={v.id} className={v.id === selected ? 'active' : ''} onClick={() => onSelect(v.id)}>
                <span className="mono">{toDate(v.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <small className="mono">{v.editedBy ? `${v.editedBy} · ` : ''}{words(v.content)}w</small>
              </li>
            ))}
          </ul>
          {preview && (
            <div className="preview">
              <h4>{preview.title}</h4>
              <pre>{preview.content || '(empty)'}</pre>
              {canRestore
                ? <button className="primary" onClick={() => onRestore(preview.id)}>Restore this one</button>
                : <p className="muted mono">View only: you can't restore versions.</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
