import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'

export const HIGHLIGHTS = [['yellow', '#fde68a'], ['green', '#bbf7d0'], ['pink', '#fbcfe8'], ['blue', '#bfdbfe']]

const asHtml = (editor) => (editor.isEmpty ? '' : editor.getHTML())

function Swatches({ editor, active }) {
  return (
    <>
      {HIGHLIGHTS.map(([name, color]) => (
        <button
          key={name} type="button" className={`swatch ${active === color ? 'on' : ''}`} style={{ background: color }}
          title={`Highlight ${name}`} aria-label={`Highlight ${name}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
        />
      ))}
      <button type="button" className="text-btn" title="Remove highlight" aria-label="Remove highlight" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().unsetHighlight().run()}>
        clear
      </button>
    </>
  )
}

export default function Editor({ noteId, content, editable, onChange }) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2] } }),
        Highlight.configure({ multicolor: true }),
        Placeholder.configure({ placeholder: 'Start writing…' }),
      ],
      content,
      editable,
      editorProps: { attributes: { class: 'tiptap rich', 'aria-label': 'Note text' } },
      onUpdate: ({ editor: e }) => onChangeRef.current(asHtml(e)),
    },
    [noteId]
  )

  // Text changed from outside (collaborator, restore, "use theirs"): show it, keeping the cursor where it was
  useEffect(() => {
    if (!editor || editor.isDestroyed || asHtml(editor) === content) return
    const { from, to } = editor.state.selection
    editor.commands.setContent(content || '', { emitUpdate: false })
    const end = editor.state.doc.content.size
    if (editor.isFocused) editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) })
  }, [content, editor])

  useEffect(() => { editor?.setEditable(editable) }, [editable, editor])

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e && {
        bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
        h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }),
        bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), quote: e.isActive('blockquote'),
        highlight: e.getAttributes('highlight').color || null,
      },
  })

  const run = (fn) => (e) => { e.preventDefault(); fn(editor.chain().focus()).run() }
  const Btn = ({ on, label, title, onClick, className = '' }) => (
    <button type="button" className={`fmt ${on ? 'on' : ''} ${className}`} title={title} aria-label={title} aria-pressed={!!on} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {label}
    </button>
  )

  return (
    <div className="editor-col">
      {editable && editor && state && (
        <div className="fmtbar" role="toolbar" aria-label="Formatting">
          <Btn on={state.bold} label="B" title="Bold" className="b" onClick={run((c) => c.toggleBold())} />
          <Btn on={state.italic} label="I" title="Italic" className="i" onClick={run((c) => c.toggleItalic())} />
          <Btn on={state.underline} label="U" title="Underline" className="u" onClick={run((c) => c.toggleUnderline())} />
          <Btn on={state.strike} label="S" title="Strikethrough" className="s" onClick={run((c) => c.toggleStrike())} />
          <span className="sep" />
          <Btn on={state.h1} label="H1" title="Heading" onClick={run((c) => c.toggleHeading({ level: 1 }))} />
          <Btn on={state.h2} label="H2" title="Subheading" onClick={run((c) => c.toggleHeading({ level: 2 }))} />
          <Btn on={state.bullet} label="• list" title="Bullet list" onClick={run((c) => c.toggleBulletList())} />
          <Btn on={state.ordered} label="1. list" title="Numbered list" onClick={run((c) => c.toggleOrderedList())} />
          <Btn on={state.quote} label="quote" title="Quote" onClick={run((c) => c.toggleBlockquote())} />
          <span className="sep" />
          <span className="mono muted hl-label">highlight</span>
          <Swatches editor={editor} active={state.highlight} />
        </div>
      )}
      <div className="paper">
        {editor ? <EditorContent editor={editor} /> : <p className="empty paper-msg">Loading…</p>}
      </div>
      {editable && editor && state && (
        <BubbleMenu editor={editor} options={{ placement: 'top' }}>
          <div className="bubble"><Swatches editor={editor} active={state.highlight} /></div>
        </BubbleMenu>
      )}
    </div>
  )
}
