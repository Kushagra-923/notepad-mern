import sanitizeHtml from 'sanitize-html'

// Notes are rich text (TipTap HTML) that other users will render, so everything is
// whitelisted on the server before it is stored: no scripts, event handlers or arbitrary styles.
const HIGHLIGHT_COLOR = /^#[0-9a-fA-F]{3,8}$/

const OPTIONS = {
  allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr'],
  allowedAttributes: { mark: ['data-color', 'style'] },
  allowedStyles: { mark: { 'background-color': [HIGHLIGHT_COLOR], color: [/^inherit$/] } },
  allowedSchemes: [],
  disallowedTagsMode: 'discard',
}

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Plain text (older notes, API clients) becomes paragraphs
const looksLikeHtml = (s) => /<\/?[a-z][\s\S]*>/i.test(s)

export function toText(html) {
  const spaced = html.replace(/<\/(p|h[1-3]|li|blockquote|pre)>|<br\s*\/?>/gi, ' ')
  return decode(sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })).replace(/\s+/g, ' ').trim()
}

export function cleanContent(raw) {
  if (!raw) return ''
  const html = looksLikeHtml(raw)
    ? raw
    : raw.split(/\r?\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join('')
  const clean = sanitizeHtml(html, OPTIONS)
  return toText(clean) === '' && !/<hr/.test(clean) ? '' : clean
}
