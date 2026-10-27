export default function ThemeToggle({ theme, onToggle }) {
  return (
    <button className="text-btn mono" onClick={onToggle} aria-label="Toggle dark mode">
      {theme === 'dark' ? 'light' : 'dark'}
    </button>
  )
}
