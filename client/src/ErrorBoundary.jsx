import { Component } from 'react'

// Last line of defence: a rendering bug shows a message and a reload button instead of a blank page
export default class ErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) { console.error('UI crashed:', error) }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="auth-page">
        <div className="auth">
          <div className="brand big">notepad</div>
          <p className="lead">Something went wrong. Your saved notes are safe.</p>
          <button className="primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}
