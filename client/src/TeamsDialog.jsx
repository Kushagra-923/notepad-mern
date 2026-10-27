import { useState } from 'react'
import Dialog from './Dialog.jsx'

export default function TeamsDialog({ teams, myId, api, onChanged, onClose }) {
  const [name, setName] = useState('')
  const [adding, setAdding] = useState({}) // teamId -> username being typed
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn) => {
    setError('')
    setBusy(true)
    try { await fn(); await onChanged() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const create = (e) => {
    e.preventDefault()
    run(async () => { await api('/api/teams', { method: 'POST', body: { name } }); setName('') })
  }
  const addMember = (e, team) => {
    e.preventDefault()
    run(async () => {
      await api(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: adding[team.id] || '' } })
      setAdding((a) => ({ ...a, [team.id]: '' }))
    })
  }
  const removeMember = (team, userId, leaving) => {
    if (leaving && !confirm(`Leave "${team.name}"? You will lose access to its notes.`)) return
    run(() => api(`/api/teams/${team.id}/members/${userId}`, { method: 'DELETE' }))
  }
  const deleteTeam = (team) => {
    if (!confirm(`Delete "${team.name}"? Its notes become personal notes of whoever wrote them.`)) return
    run(() => api(`/api/teams/${team.id}`, { method: 'DELETE' }))
  }

  return (
    <Dialog title="Teams" onClose={onClose}>
      <form className="share-add" onSubmit={create}>
        <input placeholder="New team name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
        <button className="primary" disabled={busy || !name.trim()}>Create</button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {teams.length === 0 && <p className="empty">You are not in any team yet. Create one to share notes with a group.</p>}
      {teams.map((team) => (
        <section key={team.id} className="team">
          <div className="team-head">
            <strong>{team.name}</strong>
            <span className="mono muted">{team.noteCount} {team.noteCount === 1 ? 'note' : 'notes'}</span>
            {team.role === 'owner' && <button className="text-btn danger" disabled={busy} onClick={() => deleteTeam(team)}>delete team</button>}
          </div>
          <ul className="share-list">
            {team.members.map((m) => (
              <li key={m.userId}>
                <span>{m.username}{m.userId === myId ? ' (you)' : ''}</span>
                <span className="mono muted">{m.role}</span>
                {m.role !== 'owner' && (team.role === 'owner' || m.userId === myId) && (
                  <button className="text-btn danger" disabled={busy} onClick={() => removeMember(team, m.userId, m.userId === myId)}>
                    {m.userId === myId ? 'leave' : 'remove'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {team.role === 'owner' && (
            <form className="share-add" onSubmit={(e) => addMember(e, team)}>
              <input placeholder="Add member by username" value={adding[team.id] || ''} onChange={(e) => setAdding((a) => ({ ...a, [team.id]: e.target.value }))} />
              <button className="primary" disabled={busy || !(adding[team.id] || '').trim()}>Add</button>
            </form>
          )}
        </section>
      ))}
    </Dialog>
  )
}
