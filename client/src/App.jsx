import { useEffect, useRef, useState } from 'react'
import Auth from './Auth.jsx'
import ThemeToggle from './ThemeToggle.jsx'

const load = () => {
  try { return JSON.parse(localStorage.getItem('session')) } catch { return null }
}

const toDate = (s) => new Date(s.replace(' ', 'T') + 'Z')
const ago = (s) => {
  const sec = Math.max(0, (Date.now() - toDate(s)) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`
  return toDate(s).toLocaleDateString()
}
const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0)

export default function App() {
  const [session, setSession] = useState(load)
  const [notes, setNotes] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null) // null = closed, array = open
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light')
  const [conflict, setConflict] = useState(null) // { id, current } when someone else saved first
  const [loading, setLoading] = useState(true)
  const saveTimer = useRef()
  const saving = useRef(false)
  const saveAgain = useRef(null)
  const notesRef = useRef([])
  const conflictRef = useRef(null)
  const titleRef = useRef()
  const token = session?.token

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch {}
  }, [theme])
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  const logout = () => {
    localStorage.removeItem('session')
    setSession(null)
    setNotes([])
    setActiveId(null)
    setHistory(null)
  }

  const api = async (url, options) => {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      ...options,
      body: options?.body && JSON.stringify(options.body),
    })
    if (res.status === 401 && token) logout()
    const data = await res.json().catch(() => null)
    if (!res.ok) throw Object.assign(new Error(data?.error || res.statusText), { status: res.status, body: data })
    return data
  }

  const onAuth = (data) => {
    localStorage.setItem('session', JSON.stringify(data))
    setSession(data)
  }

  notesRef.current = notes
  conflictRef.current = conflict
  const active = notes.find((n) => n._id === activeId)

  // Update a note in state and in the ref at once, so a queued save sees the new version immediately
  const patchNote = (id, patch) => {
    notesRef.current = notesRef.current.map((n) => (n._id === id ? { ...n, ...patch } : n))
    setNotes(notesRef.current)
  }

  useEffect(() => {
    if (!token) return
    const t = setTimeout(() => {
      api(`/api/notes?q=${encodeURIComponent(search)}`)
        .then((n) => { setNotes(n); setError('') })
        .catch(() => setError('Cannot reach the server'))
        .finally(() => setLoading(false))
    }, 200)
    return () => clearTimeout(t)
  }, [search, token])

  // Saves are serialized: each one sends the latest text with the latest known version
  const save = async (id) => {
    if (conflictRef.current?.id === id) return
    if (saving.current) { saveAgain.current = id; return }
    saving.current = true
    try {
      const n = notesRef.current.find((x) => x._id === id)
      if (!n) return
      const saved = await api(`/api/notes/${id}`, { method: 'PUT', body: { title: n.title, content: n.content, version: n.version } })
      patchNote(id, { version: saved.version, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy })
      setStatus('Saved')
    } catch (e) {
      setStatus('')
      if (e.status === 409) setConflict({ id, current: e.body.current })
      else setError(e.message)
    } finally {
      saving.current = false
      if (saveAgain.current) { const next = saveAgain.current; saveAgain.current = null; await save(next) }
    }
  }

  // Send any unsaved edit right away (used before switching notes / opening history)
  const flush = async () => {
    if (!saveTimer.current) return
    clearTimeout(saveTimer.current)
    const id = saveTimer.current.id
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
    if (active && active.title === 'Untitled' && !active.content) titleRef.current?.select()
  }, [activeId])

  const addNote = async () => {
    try {
      await flush()
      const note = await api('/api/notes', { method: 'POST', body: { title: 'Untitled', content: '' } })
      setNotes((n) => [note, ...n])
      setActiveId(note._id)
      setHistory(null)
      setError('')
    } catch {
      setError('Could not create note')
    }
  }

  const edit = (field, value) => {
    patchNote(activeId, { [field]: value })
    setStatus('Saving…')
    clearTimeout(saveTimer.current)
    const id = activeId
    const timer = setTimeout(() => { saveTimer.current = null; save(id) }, 500)
    timer.id = id
    saveTimer.current = timer
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
    if (!confirm('Delete this note and its history?')) return
    try {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
      await api(`/api/notes/${activeId}`, { method: 'DELETE' })
      setNotes((all) => all.filter((n) => n._id !== activeId))
      setActiveId(null)
      setHistory(null)
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

  if (!token) return <Auth onAuth={onAuth} api={api} theme={theme} onToggleTheme={toggleTheme} />

  const preview = history?.find((v) => v.id === selectedVersion)

  return (
    <div className={`app ${active ? 'has-active' : ''}`}>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      <aside>
        <div className="side-head">
          <div className="brand">notepad</div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <div className="search-row">
          <input className="search" placeholder="Search notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="primary new" onClick={addNote}>New note</button>
        <ul>
          {notes.map((n) => (
            <li key={n._id} className={n._id === activeId ? 'active' : ''} onClick={() => select(n._id)}>
              <div className="li-top"><strong>{n.title || 'Untitled'}</strong><time className="mono">{ago(n.updatedAt)}</time></div>
              <small>{n.content.replace(/\s+/g, ' ').slice(0, 70) || 'No content'}</small>
            </li>
          ))}
          {loading && <p className="empty">Loading…</p>}
          {!loading && !notes.length && <p className="empty">{search ? 'Nothing matches.' : 'No notes yet.'}</p>}
        </ul>
        <div className="user">
          <span className="uname mono">{session.username}</span>
          <button className="text-btn" onClick={logout}>log out</button>
        </div>
      </aside>

      <main>
        {active ? (
          <>
            <div className="toolbar">
              <button className="text-btn back" onClick={() => select(null)} aria-label="Back to notes">← notes</button>
              <input ref={titleRef} className="title" value={active.title} onChange={(e) => edit('title', e.target.value)} placeholder="Untitled" />
              <span className="status mono">{status}</span>
              <button className={`text-btn ${history ? 'on' : ''}`} onClick={openHistory}>history</button>
              <button className="text-btn danger" onClick={remove}>delete</button>
            </div>
            {conflict?.id === activeId && (
              <div className="conflict">
                <span><strong>{conflict.current.updatedBy || 'Someone'}</strong> saved a newer version of this note.</span>
                <button className="text-btn" onClick={useTheirs}>use theirs</button>
                <button className="text-btn" onClick={keepMine}>keep mine</button>
              </div>
            )}
            <div className="editor-wrap">
              <div className="paper">
                <textarea placeholder="Start writing…" value={active.content} onChange={(e) => edit('content', e.target.value)} />
              </div>
              {history && (
                <div className="history">
                  <div className="h-head">
                    <strong>History</strong>
                    <button className="text-btn" onClick={() => setHistory(null)} aria-label="Close">close</button>
                  </div>
                  {history.length === 0 ? (
                    <p className="empty">Nothing yet. Earlier versions show up as you keep editing.</p>
                  ) : (
                    <>
                      <ul className="versions">
                        {history.map((v) => (
                          <li key={v.id} className={v.id === selectedVersion ? 'active' : ''} onClick={() => setSelectedVersion(v.id)}>
                            <span className="mono">{toDate(v.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            <small className="mono">{v.editedBy ? `${v.editedBy} · ` : ''}{words(v.content)}w</small>
                          </li>
                        ))}
                      </ul>
                      {preview && (
                        <div className="preview">
                          <h4>{preview.title}</h4>
                          <pre>{preview.content || '(empty)'}</pre>
                          <button className="primary" onClick={() => restore(preview.id)}>Restore this one</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="foot">
              <span className="mono">{words(active.content)} words, {active.content.length} chars</span>
              <span className="mono">edited {ago(active.updatedAt)}{active.updatedBy ? ` by ${active.updatedBy}` : ''}</span>
            </div>
          </>
        ) : (
          <div className="placeholder">
            <p>Nothing open.</p>
          </div>
        )}
      </main>
    </div>
  )
}
