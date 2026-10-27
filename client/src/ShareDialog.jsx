import { useEffect, useState } from 'react'
import Dialog from './Dialog.jsx'

export default function ShareDialog({ noteId, api, onClose }) {
  const [shares, setShares] = useState(null)
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('editor')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api(`/api/notes/${noteId}/shares`).then(setShares).catch((e) => setError(e.message))
  useEffect(() => { load() }, [noteId])

  const run = async (fn) => {
    setError('')
    setBusy(true)
    try { await fn(); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const setRoleFor = (name, r) => run(() => api(`/api/notes/${noteId}/shares`, { method: 'POST', body: { username: name, role: r } }))
  const add = (e) => {
    e.preventDefault()
    run(async () => { await setRoleFor(username, role); setUsername('') })
  }
  const remove = (userId) => run(() => api(`/api/notes/${noteId}/shares/${userId}`, { method: 'DELETE' }))

  return (
    <Dialog title="Share this note" onClose={onClose}>
      <form className="share-add" onSubmit={add}>
        <input placeholder="Their username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="editor">can edit</option>
          <option value="viewer">can view</option>
        </select>
        <button className="primary" disabled={busy || !username.trim()}>Share</button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {shares === null && !error && <p className="empty">Loading…</p>}
      {shares?.length === 0 && <p className="empty">Not shared with anyone yet.</p>}
      <ul className="share-list">
        {shares?.map((s) => (
          <li key={s.userId}>
            <span>{s.username}</span>
            <select value={s.role} disabled={busy} onChange={(e) => setRoleFor(s.username, e.target.value)}>
              <option value="editor">can edit</option>
              <option value="viewer">can view</option>
            </select>
            <button className="text-btn danger" disabled={busy} onClick={() => remove(s.userId)}>remove</button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
