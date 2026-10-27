import ThemeToggle from './ThemeToggle.jsx'
import { ago } from './lib.js'

const SCOPES = [['all', 'all'], ['mine', 'mine'], ['shared', 'shared with me']]

export default function Sidebar({ notes, teams, activeId, onSelect, onNew, search, onSearch, scope, onScope, onManageTeams, loading, username, onLogout, theme, onToggleTheme }) {
  return (
    <aside>
      <div className="side-head">
        <div className="brand">notepad</div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <div className="search-row">
        <input className="search" placeholder="Search notes…" value={search} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <div className="tabs">
        {SCOPES.map(([key, label]) => (
          <button key={key} className={`text-btn ${scope === key ? 'on' : ''}`} onClick={() => onScope(key)}>{label}</button>
        ))}
        {teams.map((t) => (
          <button key={t.id} className={`text-btn ${scope === `team:${t.id}` ? 'on' : ''}`} onClick={() => onScope(`team:${t.id}`)}>{t.name}</button>
        ))}
        <button className="text-btn manage" onClick={onManageTeams}>+ teams</button>
      </div>
      <button className="primary new" onClick={onNew}>{scope.startsWith('team:') ? 'New team note' : 'New note'}</button>
      <ul>
        {notes.map((n) => (
          <li key={n._id} className={n._id === activeId ? 'active' : ''} onClick={() => onSelect(n._id)}>
            <div className="li-top"><strong>{n.title || 'Untitled'}</strong><time className="mono">{ago(n.updatedAt)}</time></div>
            <small>{(n.content ?? n.preview ?? '').replace(/\s+/g, ' ').slice(0, 70) || 'No content'}</small>
            {n.teamName
              ? <span className="badge mono">team · {n.teamName}</span>
              : n.role !== 'owner' && <span className="badge mono">{n.role} · from {n.ownerName}</span>}
          </li>
        ))}
        {loading && <p className="empty">Loading…</p>}
        {!loading && !notes.length && (
          <p className="empty">{search ? 'Nothing matches.' : scope === 'shared' ? 'Nothing has been shared with you yet.' : scope.startsWith('team:') ? 'No notes in this team yet.' : 'No notes yet.'}</p>
        )}
      </ul>
      <div className="user">
        <span className="uname mono">{username}</span>
        <button className="text-btn" onClick={onLogout}>log out</button>
      </div>
    </aside>
  )
}
