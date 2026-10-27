import { useEffect, useState } from 'react'
import Dialog from './Dialog.jsx'

export default function ShareDialog({ noteId, teams, teamId, api, onMoved, onChanged, onClose }) {
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
    try { await fn(); await load(); onChanged?.() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const setRoleFor = (name, r) => run(() => api(`/api/notes/${noteId}/shares`, { method: 'POST', body: { username: name, role: r } }))
  const add = (e) => {
    e.preventDefault()
    run(async () => { await setRoleFor(username, role); setUsername('') })
  }
  const remove = (userId) => run(() => api(`/api/notes/${noteId}/shares/${userId}`, { method: 'DELETE' }))

  const move = (value) => run(async () => {
    const note = await api(`/api/notes/${noteId}/team`, { method: 'PUT', body: { teamId: value === '' ? null : Number(value) } })
    onMoved(note)
  })
  const team = teams.find((t) => t.id === teamId)

  return (
    <Dialog title="Share this note" onClose={onClose}>
      {teams.length > 0 && (
        <label className="team-row">
          <span className="mono muted">team</span>
          <select value={teamId ?? ''} disabled={busy} onChange={(e) => move(e.target.value)}>
            <option value="">none (personal)</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
      {team && <p className="muted team-note">Everyone in <strong>{team.name}</strong> can edit this note.</p>}
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
