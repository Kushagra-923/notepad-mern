export const toDate = (s) => new Date(s)

export const ago = (s) => {
  const sec = Math.max(0, (Date.now() - toDate(s)) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`
  return toDate(s).toLocaleDateString()
}

export const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0)

export const userIdOf = (token) => {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub } catch { return null }
}
