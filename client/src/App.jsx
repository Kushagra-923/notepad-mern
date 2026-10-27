import { useEffect, useRef, useState } from 'react'
import Auth from './Auth.jsx'
import Sidebar from './Sidebar.jsx'
import HistoryPanel from './HistoryPanel.jsx'
import ShareDialog from './ShareDialog.jsx'
import TeamsDialog from './TeamsDialog.jsx'
import Editor from './Editor.jsx'
import { ago, words, textOf, userIdOf } from './lib.js'

const OFFLINE = 'Cannot reach the server.'

const loadSession = () => {
  try { return JSON.parse(localStorage.getItem('session')) } catch { return null }
}

export default function App() {
  const [session, setSession] = useState(loadSession)
  const [notes, setNotes] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState('all')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null) // null = closed, array = open
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [teams, setTeams] = useState([])
  const [teamsOpen, setTeamsOpen] = useState(false)
  const [conflict, setConflict] = useState(null) // { id, current } when someone else saved first
  const [loading, setLoading] = useState(true)
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light')
  const saveTimer = useRef()
  const saving = useRef(false)
  const saveAgain = useRef(null)
  const retryTimer = useRef()
  const notesRef = useRef([])
  const conflictRef = useRef(null)
  const activeIdRef = useRef(null)
  const titleRef = useRef()
  const token = session?.token
  const myId = token ? userIdOf(token) : null

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch {}
  }, [theme])
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  const logout = () => {
    clearTimeout(retryTimer.current)
    localStorage.removeItem('session')
    setSession(null)
    setNotes([])
    notesRef.current = []
    setActiveId(null)
    setHistory(null)
    setSharing(false)
    setTeams([])
    setTeamsOpen(false)
    setScope('all')
    setLoading(true)
  }

  // Send any unsaved edit first, so signing out never drops the last few words
  const signOut = async () => {
    await flush()
    logout()
  }

  const api = async (url, options) => {
    let res
    try {
      res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        ...options,
        body: options?.body && JSON.stringify(options.body),
      })
    } catch {
      throw Object.assign(new Error('Cannot reach the server. Check your connection.'), { status: 0 })
    }
    const data = await res.json().catch(() => null)
    if (res.status === 401 && token) {
      logout()
      setError('Your session expired. Please log in again.')
    }
    if (!res.ok) throw Object.assign(new Error(data?.error || res.statusText), { status: res.status, body: data })
    return data
  }

  const onAuth = (data) => {
    localStorage.setItem('session', JSON.stringify(data))
    setSession(data)
    setError('')
  }

  notesRef.current = notes
  conflictRef.current = conflict
  activeIdRef.current = activeId
  const active = notes.find((n) => n._id === activeId)
  const loaded = active && active.content !== undefined
  const readOnly = active?.role === 'viewer'

  // Update a note in state and in the ref at once, so a queued save sees the new version immediately
  const patchNote = (id, patch) => {
    notesRef.current = notesRef.current.map((n) => (n._id === id ? { ...n, ...patch } : n))
    setNotes(notesRef.current)
  }
  const dropNote = (id) => {
    notesRef.current = notesRef.current.filter((n) => n._id !== id)
    setNotes(notesRef.current)
    if (activeIdRef.current === id) { setActiveId(null); setHistory(null); setSharing(false) }
  }

  // ----- list -----
  // Notes that aren't open are replaced by the fresh list entry; the open note keeps its text and version.
  const mergeList = (incoming) => {
    const prev = new Map(notesRef.current.map((n) => [n._id, n]))
    const open = activeIdRef.current
    const next = incoming.map((n) => {
      const old = prev.get(n._id)
      if (n._id !== open || !old) return n
      return { ...old, preview: n.preview, role: n.role, ownerName: n.ownerName }
    })
    if (open && !next.some((n) => n._id === open) && prev.has(open)) next.unshift(prev.get(open)) // keep the open note even if the filter hides it
    notesRef.current = next
    setNotes(next)
  }
  const loadList = async () => mergeList(await api(`/api/notes?scope=${scope}&q=${encodeURIComponent(search)}`))

  useEffect(() => {
    if (!token) return
    const t = setTimeout(() => {
      loadList()
        .then(() => setError(''))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false))
    }, 200)
    return () => clearTimeout(t)
  }, [search, scope, token])

  useEffect(() => {
    if (!token) return
    const i = setInterval(() => loadList().catch(() => {}), 15000)
    return () => clearInterval(i)
  }, [search, scope, token])

  // ----- teams -----
  const loadTeams = async () => {
    const data = await api('/api/teams')
    setTeams(data)
    if (scope.startsWith('team:') && !data.some((t) => `team:${t.id}` === scope)) setScope('all') // left or deleted
  }
  useEffect(() => {
    if (!token) return
    loadTeams().catch(() => {})
    const i = setInterval(() => loadTeams().catch(() => {}), 30000)
    return () => clearInterval(i)
  }, [token, scope])

  // ----- open note: load it, then keep it fresh so collaborators' edits appear -----
  const refresh = async (id) => {
    try {
      const fresh = await api(`/api/notes/${id}`)
      const local = notesRef.current.find((n) => n._id === id)
      if (!local) return
      const dirty = saveTimer.current?.id === id || saving.current
      if (local.content === undefined || (fresh.version > local.version && !dirty && conflictRef.current?.id !== id)) patchNote(id, fresh)
      else patchNote(id, { role: fresh.role, teamId: fresh.teamId, teamName: fresh.teamName })
    } catch (e) {
      if (e.status === 404) { dropNote(id); setError('That note is no longer available to you.') }
      // other failures (offline, server restarting) are retried by the next poll
    }
  }

  useEffect(() => {
    if (!token || !activeId) return
    refresh(activeId)
    const i = setInterval(() => refresh(activeId), 4000)
    return () => clearInterval(i)
  }, [activeId, token])

  // ----- saving -----
  // Saves are serialized: each one sends the latest text with the latest known version
  const save = async (id) => {
    if (conflictRef.current?.id === id) return
    if (saving.current) { saveAgain.current = id; return }
    saving.current = true
    try {
      const n = notesRef.current.find((x) => x._id === id)
      if (!n || n.content === undefined || n.role === 'viewer') return
      const saved = await api(`/api/notes/${id}`, { method: 'PUT', body: { title: n.title, content: n.content, version: n.version } })
      patchNote(id, { version: saved.version, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy })
      setStatus('Saved')
      setError((msg) => (msg.startsWith(OFFLINE) ? '' : msg))
    } catch (e) {
      if (e.status === 409) { setStatus(''); setConflict({ id, current: e.body.current }) }
      else if (e.status === 403) { setStatus(''); setError(e.message); refresh(id) }
      else if (e.status === 0) {
        // offline: keep the text in the editor and try again until it goes through
        setStatus('Not saved yet')
        setError(`${OFFLINE} Your changes will be saved when you reconnect.`)
        clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(() => save(id), 3000)
      } else { setStatus(''); setError(e.message) }
    } finally {
      saving.current = false
      if (saveAgain.current) { const next = saveAgain.current; saveAgain.current = null; await save(next) }
    }
  }

  // Send any unsaved edit right away (used before switching notes / opening history / sharing)
  const flush = async () => {
    if (!saveTimer.current) return
    const { timer, id } = saveTimer.current
    clearTimeout(timer)
    saveTimer.current = null
    await save(id)
  }

  const select = async (id) => {
    await flush()
    setActiveId(id)
    setHistory(null)
    setSelectedVersion(null)
  }

  useEffect(() => {
    if (loaded && !readOnly && active.title === 'Untitled' && !active.content) titleRef.current?.select()
  }, [activeId, loaded])

  const addNote = async () => {
    try {
      await flush()
      const teamId = scope.startsWith('team:') ? Number(scope.slice(5)) : null
      const note = await api('/api/notes', { method: 'POST', body: { title: 'Untitled', content: '', teamId } })
      if (scope === 'shared') setScope('mine')
      notesRef.current = [note, ...notesRef.current]
      setNotes(notesRef.current)
      setActiveId(note._id)
      setHistory(null)
      setError('')
    } catch (e) {
      setError(`Could not create note: ${e.message}`)
    }
  }

  const edit = (field, value) => {
    patchNote(activeId, { [field]: value })
    setStatus('Saving…')
    clearTimeout(saveTimer.current?.timer)
    clearTimeout(retryTimer.current)
    const id = activeId
    // browsers return a number from setTimeout, so keep the id next to it instead of on it
    saveTimer.current = { id, timer: setTimeout(() => { saveTimer.current = null; save(id) }, 500) }
  }

  const keepMine = async () => {
    const { id, current } = conflict
    const n = notesRef.current.find((x) => x._id === id)
    try {
      const saved = await api(`/api/notes/${id}`, { method: 'PUT', body: { title: n.title, content: n.content, version: current.version } })
      patchNote(id, { version: saved.version, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy })
      setConflict(null)
      setStatus('Saved')
    } catch (e) {
      if (e.status === 409) setConflict({ id, current: e.body.current })
      else setError(e.message)
    }
  }

  const useTheirs = () => {
    patchNote(conflict.id, conflict.current)
    setConflict(null)
    setStatus('')
  }

  const remove = async () => {
    if (!confirm('Delete this note for everyone, including its history?')) return
    try {
      clearTimeout(saveTimer.current?.timer)
      saveTimer.current = null
      await api(`/api/notes/${activeId}`, { method: 'DELETE' })
      dropNote(activeId)
    } catch (e) {
      setError(e.message)
    }
  }

  const leave = async () => {
    if (!confirm('Remove this note from your list? The owner keeps it.')) return
    try {
      await api(`/api/notes/${activeId}/shares/${myId}`, { method: 'DELETE' })
      dropNote(activeId)
    } catch (e) {
      setError(e.message)
    }
  }

  const openHistory = async () => {
    if (history) return setHistory(null)
    await flush()
    try {
      const versions = await api(`/api/notes/${activeId}/history`)
      setHistory(versions)
      setSelectedVersion(versions[0]?.id ?? null)
    } catch (e) {
      setError(e.message)
    }
  }

  const restore = async (versionId) => {
    try {
      const note = await api(`/api/notes/${activeId}/restore/${versionId}`, { method: 'POST' })
      patchNote(note._id, note)
      setConflict(null)
      setHistory(await api(`/api/notes/${activeId}/history`))
      setStatus('Restored')
    } catch (e) {
      setError(e.message)
    }
  }

  const openShare = async () => {
    await flush()
    setSharing(true)
  }

  if (!token) return (
    <>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <Auth onAuth={onAuth} api={api} theme={theme} onToggleTheme={toggleTheme} />
    </>
  )

  return (
    <div className={`app ${active ? 'has-active' : ''}`}>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      <Sidebar
        notes={notes} teams={teams} onManageTeams={() => setTeamsOpen(true)} activeId={activeId} onSelect={select} onNew={addNote}
        search={search} onSearch={setSearch} scope={scope} onScope={setScope}
        loading={loading} username={session.username} onLogout={signOut}
        theme={theme} onToggleTheme={toggleTheme}
      />

      <main>
        {active ? (
          <>
            <div className="toolbar">
              <button className="text-btn back" onClick={() => select(null)} aria-label="Back to notes">← notes</button>
              <input ref={titleRef} className="title" value={active.title} readOnly={readOnly || !loaded} maxLength={200} onChange={(e) => edit('title', e.target.value)} placeholder="Untitled" />
              <span className="status mono">{status}</span>
              <button className={`text-btn ${history ? 'on' : ''}`} onClick={openHistory} disabled={!loaded}>history</button>
              {active.role === 'owner' ? (
                <>
                  <button className="text-btn" onClick={openShare} disabled={!loaded}>share</button>
                  <button className="text-btn danger" onClick={remove}>delete</button>
                </>
              ) : (
                !active.teamId && <button className="text-btn danger" onClick={leave}>leave</button>
              )}
            </div>
            {active.teamId && <div className="notice">Team note: everyone in <strong>{active.teamName}</strong> can edit this.</div>}
            {readOnly && <div className="notice">View only. <strong>{active.ownerName}</strong> shared this note with you as a viewer.</div>}
            {conflict?.id === activeId && (
              <div className="conflict">
                <span><strong>{conflict.current.updatedBy || 'Someone'}</strong> saved a newer version of this note.</span>
                <button className="text-btn" onClick={useTheirs}>use theirs</button>
                <button className="text-btn" onClick={keepMine}>keep mine</button>
              </div>
            )}
            <div className="editor-wrap">
              {loaded ? (
                <Editor noteId={active._id} content={active.content} editable={!readOnly} onChange={(html) => edit('content', html)} />
              ) : (
                <div className="editor-col"><div className="paper"><p className="empty paper-msg">Loading…</p></div></div>
              )}
              {history && (
                <HistoryPanel
                  versions={history} selected={selectedVersion} onSelect={setSelectedVersion}
                  onRestore={restore} canRestore={!readOnly} onClose={() => setHistory(null)}
                />
              )}
            </div>
            <div className="foot">
              <span className="mono">{loaded ? `${words(textOf(active.content))} ${words(textOf(active.content)) === 1 ? 'word' : 'words'}` : ''}</span>
              <span className="mono">edited {ago(active.updatedAt)}{active.updatedBy ? ` by ${active.updatedBy}` : ''}</span>
            </div>
          </>
        ) : (
          <div className="placeholder"><p>Nothing open.</p></div>
        )}
      </main>

      {sharing && active && (
        <ShareDialog
          noteId={active._id} teams={teams} teamId={active.teamId} api={api}
          onMoved={(note) => { patchNote(note._id, { teamId: note.teamId, teamName: note.teamName, role: note.role }); loadTeams().catch(() => {}) }}
          onClose={() => setSharing(false)}
        />
      )}
      {teamsOpen && (
        <TeamsDialog
          teams={teams} myId={myId} api={api}
          onChanged={async () => {
            await loadTeams()
            await loadList().catch(() => {})
            if (activeIdRef.current) await refresh(activeIdRef.current) // access may just have changed
          }}
          onClose={() => setTeamsOpen(false)}
        />
      )}
    </div>
  )
}
