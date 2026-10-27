import { useEffect } from 'react'

export default function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title}>
        <div className="h-head">
          <strong>{title}</strong>
          <button className="text-btn" onClick={onClose}>close</button>
        </div>
        {children}
      </div>
    </div>
  )
}
