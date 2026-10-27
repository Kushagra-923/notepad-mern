import { useEffect, useRef, useState } from 'react'
import ThemeToggle from './ThemeToggle.jsx'

export default function Auth({ onAuth, api, theme, onToggleTheme }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const googleBtn = useRef()

  useEffect(() => {
    let cancelled = false
    api('/api/auth/config')
      .then(({ googleClientId }) => {
        if (!googleClientId || cancelled) return
        const init = () => {
          window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: async ({ credential }) => {
              try {
                onAuth(await api('/api/auth/google', { method: 'POST', body: { credential } }))
              } catch (err) {
                setError(err.message)
              }
            },
          })
          window.google.accounts.id.renderButton(googleBtn.current, { theme: 'outline', size: 'large', width: 340 })
        }
        if (window.google?.accounts) return init()
        const script = document.createElement('script')
        script.src = 'https://accounts.google.com/gsi/client'
        script.async = true
        script.onload = init
        document.head.appendChild(script)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (busy) return
    if (!username.trim()) return setError('Enter your username or email')
    if (mode === 'register' && password.length < 6) return setError('Password must be at least 6 characters')
    setBusy(true)
    try {
      const data = await api(`/api/auth/${mode}`, { method: 'POST', body: { username: username.trim(), password } })
      onAuth(data)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-theme"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></div>
      <form className="auth" onSubmit={submit}>
        <div className="brand big">notepad</div>
        <p className="lead">{mode === 'login' ? 'Log in to your notes.' : 'Make an account.'}</p>
        <label>username or email<input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" /></label>
        <label>
          password
          <span className="pw">
            <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            <button type="button" className="text-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? 'hide' : 'show'}
            </button>
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'One moment…' : mode === 'login' ? 'Log in' : 'Sign up'}</button>
        <div ref={googleBtn} className="google" />
        <button type="button" className="text-btn switch" onClick={() => { setError(''); setMode(mode === 'login' ? 'register' : 'login') }}>
          {mode === 'login' ? 'no account? sign up' : 'have an account? log in'}
        </button>
      </form>
    </div>
  )
}
