// swyr://note/<id>: a focused editor for one note. Title on top, rich text below, saved as Markdown 500 ms after each edit.
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import type { EditorView } from '@tiptap/pm/view'
import { Bold, Code, Heading1, Heading2, ImagePlus, Italic, Link2, List, ListChecks, ListOrdered, StickyNote } from 'lucide-react'
import '../../common/base.css'
import '../page.css'
import './note.css'
import type { NoteDocument } from '@shared/types'
import { invoke, startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import { debounce, docIdFromLocation, onDocUpdated, readAsDataUrl } from './doc'

const DOC_ID = docIdFromLocation()
const UNTITLED = 'Untitled note'
const SAVE_MS = 500

type Loaded = (NoteDocument & { rev?: number }) | null | undefined

/** paste or drop image files: they go into the note as data URLs */
function insertImages(view: EditorView, files: File[]): boolean {
  const images = files.filter((f) => f.type.startsWith('image/'))
  if (!images.length) return false
  for (const f of images) {
    void readAsDataUrl(f).then((src) => {
      const node = view.state.schema.nodes.image?.create({ src, alt: f.name || 'image' })
      if (node) view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
    })
  }
  return true
}

function ToolButton({ on, title, onClick, children }: { on?: boolean; title: string; onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      className={`flex h-8 w-8 items-center justify-center rounded-lg ${on ? 'bg-[var(--select)] text-[var(--accent)]' : 'hover:bg-[var(--select)]'}`}
      title={title}
      aria-label={title}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor, onLink, onImage }: { editor: Editor; onLink: () => void; onImage: () => void }): ReactNode {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      code: e.isActive('code'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      link: e.isActive('link')
    })
  })
  const c = (): ReturnType<Editor['chain']> => editor.chain().focus()
  return (
    <div className="note-toolbar flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
      <ToolButton on={st.h1} title="Heading 1" onClick={() => c().toggleHeading({ level: 1 }).run()}>
        <Heading1 size={17} strokeWidth={2} />
      </ToolButton>
      <ToolButton on={st.h2} title="Heading 2" onClick={() => c().toggleHeading({ level: 2 }).run()}>
        <Heading2 size={17} strokeWidth={2} />
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-[var(--card-border)]" />
      <ToolButton on={st.bold} title="Bold (⌘B)" onClick={() => c().toggleBold().run()}>
        <Bold size={16} strokeWidth={2.2} />
      </ToolButton>
      <ToolButton on={st.italic} title="Italic (⌘I)" onClick={() => c().toggleItalic().run()}>
        <Italic size={16} strokeWidth={2.2} />
      </ToolButton>
      <ToolButton on={st.code} title="Code (⌘E)" onClick={() => c().toggleCode().run()}>
        <Code size={16} strokeWidth={2.2} />
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-[var(--card-border)]" />
      <ToolButton on={st.bullet} title="Bulleted list" onClick={() => c().toggleBulletList().run()}>
        <List size={17} strokeWidth={2} />
      </ToolButton>
      <ToolButton on={st.ordered} title="Numbered list" onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered size={17} strokeWidth={2} />
      </ToolButton>
      <ToolButton on={st.task} title="Checklist" onClick={() => c().toggleTaskList().run()}>
        <ListChecks size={17} strokeWidth={2} />
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-[var(--card-border)]" />
      <ToolButton on={st.link} title="Link" onClick={onLink}>
        <Link2 size={17} strokeWidth={2} />
      </ToolButton>
      <ToolButton title="Insert image" onClick={onImage}>
        <ImagePlus size={17} strokeWidth={2} />
      </ToolButton>
    </div>
  )
}

function LinkField({ editor, onDone }: { editor: Editor; onDone: () => void }): ReactNode {
  const [href, setHref] = useState(() => String(editor.getAttributes('link').href ?? ''))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const apply = (): void => {
    const v = href.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!v) chain.unsetLink().run()
    else {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
      if (editor.state.selection.empty && !editor.isActive('link')) editor.chain().focus().insertContent({ type: 'text', text: v, marks: [{ type: 'link', attrs: { href: url } }] }).run()
      else chain.setLink({ href: url }).run()
    }
    onDone()
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        ref={ref}
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply()
          if (e.key === 'Escape') onDone()
        }}
        placeholder="Paste or type a link"
        aria-label="Link address"
        className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2.5 text-[14px] outline-none focus:border-[var(--accent)]"
      />
      <button className="h-8 rounded-lg bg-[var(--fg)] px-3 text-[13px] font-semibold text-(color:--content)" onClick={apply}>
        Apply
      </button>
      <button className="h-8 rounded-lg px-3 text-[13px] font-semibold hover:bg-[var(--select)]" onClick={onDone}>
        Cancel
      </button>
    </div>
  )
}

function NotePage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  useSpaceTheme(space, vs?.systemDark ?? false)
  const [doc, setDoc] = useState<Loaded>(undefined)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<'saved' | 'saving' | 'idle'>('idle')
  const [linking, setLinking] = useState(false)
  const rev = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, heading: { levels: [1, 2, 3] } }),
      Link.configure({ autolink: true, linkOnPaste: true, openOnClick: true, defaultProtocol: 'https', HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
      Image.configure({ allowBase64: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Write something, paste a link or an image…' }),
      Markdown
    ],
    editorProps: {
      attributes: { class: 'note-prose', 'aria-label': 'Note' },
      handlePaste: (view, event) => insertImages(view, [...(event.clipboardData?.files ?? [])]),
      handleDrop: (view, event) => insertImages(view, [...((event as DragEvent).dataTransfer?.files ?? [])])
    }
  })

  const saver = useMemo(
    () =>
      debounce((markdown: string) => {
        setStatus('saving')
        void invoke('note.setContent', { docId: DOC_ID, markdown, baseRev: rev.current }).then((res) => {
          const r = res as { ok?: boolean; rev?: number } | null
          if (r && r.ok === false) {
            // the note changed elsewhere first: show that version
            void invoke('note.get', { docId: DOC_ID }).then((d) => {
              const nd = d as (NoteDocument & { rev?: number }) | null
              if (nd && editor) {
                rev.current = nd.rev ?? rev.current
                editor.commands.setContent(nd.markdown, { contentType: 'markdown', emitUpdate: false })
              }
            })
          }
          setStatus('saved')
        })
      }, SAVE_MS),
    [editor]
  )
  const titleSaver = useMemo(() => debounce((t: string) => void invoke('note.setTitle', { docId: DOC_ID, title: t, fromPage: true }), 300), [])

  // load the note, then follow changes made outside the page (note.setContent from a command)
  useEffect(() => {
    if (!editor) return
    const off = onDocUpdated(DOC_ID, (u) => {
      if (typeof u.markdown === 'string') {
        saver.cancel()
        rev.current = u.rev ?? rev.current
        editor.commands.setContent(u.markdown, { contentType: 'markdown', emitUpdate: false })
      }
      if (typeof u.title === 'string') {
        setTitle(u.title)
      }
    })
    void invoke('note.get', { docId: DOC_ID }).then((d) => {
      const nd = d as (NoteDocument & { rev?: number }) | null
      setDoc(nd)
      if (!nd) return
      rev.current = nd.rev ?? 0
      setTitle(nd.title)
      editor.commands.setContent(nd.markdown, { contentType: 'markdown', emitUpdate: false })
      if (!nd.markdown) editor.commands.focus('end')
    })
    const onUpdate = (): void => saver.run(editor.getMarkdown())
    editor.on('update', onUpdate)
    const flush = (): void => saver.flush()
    window.addEventListener('beforeunload', flush)
    return () => {
      off()
      editor.off('update', onUpdate)
      window.removeEventListener('beforeunload', flush)
      saver.flush()
    }
  }, [editor, saver])

  useEffect(() => {
    document.title = title.trim() || UNTITLED
  }, [title])

  if (!DOC_ID || doc === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center" data-missing="note">
        <StickyNote size={30} strokeWidth={1.8} />
        <h1 className="text-[20px] font-bold">This note no longer exists</h1>
        <p className="max-w-[380px] text-[14px] leading-6">It was deleted from the Library. Notes you close or archive are kept; only Delete removes them.</p>
      </div>
    )
  }

  return (
    <div className="note-page min-h-screen">
      <header className="note-head sticky top-0 z-10">
        <div className="mx-auto max-w-[760px] px-10 pt-10 pb-2">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold">
            <StickyNote size={14} strokeWidth={2} />
            <span>Note</span>
            <span className="ml-auto tabular-nums" aria-live="polite">
              {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
            </span>
          </div>
          <input
            className="note-title w-full bg-transparent text-[32px] font-bold leading-tight outline-none"
            value={title}
            placeholder={UNTITLED}
            aria-label="Title"
            onChange={(e) => {
              setTitle(e.target.value)
              titleSaver.run(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault()
                editor?.commands.focus('start')
              }
            }}
          />
          {editor && (
            <div className="mt-3">
              <Toolbar editor={editor} onLink={() => setLinking((v) => !v)} onImage={() => fileRef.current?.click()} />
              {linking && <LinkField editor={editor} onDone={() => setLinking(false)} />}
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[760px] px-10 pt-4 pb-24">
        <EditorContent editor={editor} />
      </main>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (editor && files.length) insertImages(editor.view, files)
        }}
      />
    </div>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<NotePage />)
