'use client'

import { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, UIEvent as ReactUIEvent, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadActiveConversation, saveActiveConversation } from '../lib/conversation-state'
import { MAX_FILE_SIZE, validateFile } from '../lib/file-security'

type Mode = 'ask' | 'answer' | 'history'
type FileTarget = 'question' | 'answer'
type Attachment = { path: string; name: string; type: string; size: number; url?: string }
type Answer = { id: string; text: string; author: string; authorId: string; time: string; createdAt: string; attachment?: Attachment }
type Message = Answer
type Question = { id: string; author: string; authorId: string; text: string; time: string; createdAt: string; status: 'open' | 'answered' | 'hidden'; attachment?: Attachment; claimedBy?: string; claimedUntil?: string; answers: Answer[]; messages: Message[] }
type EditorState = { attachment: Attachment; target: FileTarget; text: string }

const EDITABLE_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'htm', 'xml', 'yml', 'yaml', 'sql', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'php', 'sh', 'rb']
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska']
const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/flac', 'audio/x-m4a']
const OFFICE_TYPES = ['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']

function isImageAttachment(file: Attachment) { return file.type.startsWith('image/') }
function isVideoAttachment(file: Attachment) { return file.type.startsWith('video/') || VIDEO_TYPES.includes(file.type) || ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v', 'mpeg', 'wmv'].includes(file.name.toLowerCase().split('.').pop() || '') }
function isAudioAttachment(file: Attachment) { return file.type.startsWith('audio/') || AUDIO_TYPES.includes(file.type) || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'mka'].includes(file.name.toLowerCase().split('.').pop() || '') }
function isOfficeAttachment(file: Attachment) { return OFFICE_TYPES.includes(file.type) || OFFICE_EXTENSIONS.includes(file.name.toLowerCase().split('.').pop() || '') }
function officeViewerUrl(file: Attachment) { return file.url ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}` : undefined }
function isEditableAttachment(file: Attachment) {
  const extension = file.name.toLowerCase().split('.').pop() || ''
  return file.type.startsWith('text/') || EDITABLE_EXTENSIONS.includes(extension) || ['application/json', 'application/javascript', 'application/xml', 'application/sql'].includes(file.type)
}
function formatFileSize(size: number) {
  if (!size) return 'Taille inconnue'
  if (size < 1024) return `${size} o`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`
}
function currentAttachment(file: File | undefined, preview: string, path = ''): Attachment | undefined { return file ? { path, name: file.name, type: file.type || 'application/octet-stream', size: file.size, url: preview } : undefined }

const CODE_KEYWORDS = new Set('as async await break case catch class const continue debugger default delete do else export extends finally for from function get if implements import in instanceof interface let new null of package private protected public return set static super switch this throw try type typeof undefined var void while with yield true false def elif except lambda pass raise and or not match fn pub use mod struct enum trait impl self'.split(' '))

function escapeHtml(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;') }
function codeExtension(name: string) { return name.toLowerCase().split('.').pop() || 'txt' }
function highlightCode(source: string, name: string) {
  const extension = codeExtension(name)
  const commentMarker = ['py', 'rb', 'sh', 'yaml', 'yml', 'toml'].includes(extension) ? '#' : '//'
  return source.split('\n').map(line => {
    let html = ''
    let index = 0
    while (index < line.length) {
      if (line.slice(index, index + commentMarker.length) === commentMarker) { html += `<span class="syntax-comment">${escapeHtml(line.slice(index))}</span>`; break }
      const character = line[index]
      if (character === '"' || character === "'" || character === '`') {
        const quote = character
        let end = index + 1
        while (end < line.length) { if (line[end] === '\\') end += 2; else if (line[end] === quote) { end += 1; break } else end += 1 }
        html += `<span class="syntax-string">${escapeHtml(line.slice(index, end))}</span>`
        index = end
        continue
      }
      const number = line.slice(index).match(/^(?:\d+(?:\.\d+)?|0x[0-9a-f]+)/i)
      if (number) { html += `<span class="syntax-number">${number[0]}</span>`; index += number[0].length; continue }
      const word = line.slice(index).match(/^[A-Za-z_$][\w$]*/)
      if (word) { const className = CODE_KEYWORDS.has(word[0]) ? 'syntax-keyword' : ''; html += className ? `<span class="${className}">${word[0]}</span>` : escapeHtml(word[0]); index += word[0].length; continue }
      html += escapeHtml(character)
      index += 1
    }
    return html || ' '
  }).join('\n')
}

function AttachmentView({ attachment, onEdit }: { attachment: Attachment; onEdit?: () => void }) {
  if (isImageAttachment(attachment) && attachment.url) return <img className="content-image" src={attachment.url} alt={`Fichier ${attachment.name}`} />
  if (isVideoAttachment(attachment) && attachment.url) return <div className="media-card"><video controls preload="metadata" src={attachment.url}>Ton navigateur ne peut pas lire cette vidéo.</video><div className="media-caption"><strong>{attachment.name}</strong><a href={attachment.url} target="_blank" rel="noreferrer">Ouvrir</a></div></div>
  if (isAudioAttachment(attachment) && attachment.url) return <div className="media-card audio-card"><audio controls preload="metadata" src={attachment.url}>Ton navigateur ne peut pas lire cet audio.</audio><div className="media-caption"><strong>{attachment.name}</strong><a href={attachment.url} target="_blank" rel="noreferrer">Ouvrir</a></div></div>
  if (attachment.type === 'application/pdf' && attachment.url) return <div className="pdf-card"><iframe src={attachment.url} title={`Aperçu de ${attachment.name}`} /><div className="file-actions"><a href={attachment.url} target="_blank" rel="noreferrer">Ouvrir dans un nouvel onglet</a></div></div>
  if (isOfficeAttachment(attachment) && officeViewerUrl(attachment)) return <div className="office-card"><iframe src={officeViewerUrl(attachment)} title={`Aperçu de ${attachment.name}`} /><div className="file-actions"><a href={attachment.url} target="_blank" rel="noreferrer">Ouvrir le fichier</a><a href={attachment.url} download={attachment.name}>Télécharger</a></div></div>
  return <div className="file-card"><span className="file-icon">{attachment.type === 'application/pdf' ? 'PDF' : isOfficeAttachment(attachment) ? 'OFFICE' : 'FILE'}</span><div className="file-info"><strong title={attachment.name}>{attachment.name}</strong><small>{attachment.type || 'type inconnu'} · {formatFileSize(attachment.size)}</small></div><div className="file-actions">{attachment.url && <><a href={attachment.url} target="_blank" rel="noreferrer">Ouvrir</a><a href={attachment.url} download={attachment.name}>Télécharger</a></>}{onEdit && <button type="button" onClick={onEdit}>Modifier</button>}</div></div>
}

function DrawingPad({ onSave, onClose }: { onSave: (file: File) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#202123')
  const [size, setSize] = useState(4)
  const drawing = useRef(false)
  useEffect(() => { const canvas = canvasRef.current; const context = canvas?.getContext('2d'); if (!canvas || !context) return; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height) }, [])
  function position(event: ReactPointerEvent<HTMLCanvasElement>) { const canvas = canvasRef.current!; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) } }
  function start(event: ReactPointerEvent<HTMLCanvasElement>) { const canvas = canvasRef.current; const context = canvas?.getContext('2d'); if (!canvas || !context) return; drawing.current = true; canvas.setPointerCapture(event.pointerId); const point = position(event); context.beginPath(); context.moveTo(point.x, point.y) }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const context = canvasRef.current?.getContext('2d'); if (!context) return; const point = position(event); context.strokeStyle = color; context.lineWidth = size; context.lineCap = 'round'; context.lineJoin = 'round'; context.lineTo(point.x, point.y); context.stroke() }
  function clear() { const canvas = canvasRef.current; const context = canvas?.getContext('2d'); if (!canvas || !context) return; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height) }
  function save() { canvasRef.current?.toBlob(blob => { if (blob) onSave(new File([blob], `dessin-${Date.now()}.png`, { type: 'image/png' })) }, 'image/png') }
  return <div className="drawing-modal modal-backdrop" onClick={onClose}><div className="drawing-card" onClick={event => event.stopPropagation()}><div className="drawing-heading"><div><span className="eyebrow">Atelier créatif</span><h2>Dessiner une réponse</h2></div><button className="modal-close" onClick={onClose} aria-label="Fermer">×</button></div><p className="drawing-help">Dessine avec ta souris ou ton doigt, puis envoie ton croquis avec ta réponse.</p><canvas ref={canvasRef} width={900} height={500} className="drawing-canvas" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false }} onPointerCancel={() => { drawing.current = false }} /><div className="drawing-tools"><div className="color-palette">{['#202123', '#695de5', '#e45757', '#29a875', '#ef9b35', '#3478db'].map(item => <button key={item} className={`color-choice ${color === item ? 'selected' : ''}`} style={{ backgroundColor: item }} onClick={() => setColor(item)} aria-label={`Couleur ${item}`} />)}</div><label className="brush-size">Épaisseur <input type="range" min="2" max="18" value={size} onChange={event => setSize(Number(event.target.value))} /></label><button className="clear-button" onClick={clear}>Effacer</button><button className="primary-button" onClick={save}>Utiliser ce dessin</button></div></div></div>
}

function FileEditor({ state, onClose, onSave }: { state: EditorState; onClose: () => void; onSave: (file: File, target: FileTarget) => void }) {
  const [text, setText] = useState(state.text)
  const [loading, setLoading] = useState(!state.text)
  const [error, setError] = useState('')
  const [historySize, setHistorySize] = useState(0)
  const [redoSize, setRedoSize] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLPreElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])

  useEffect(() => {
    if (state.text || !state.attachment.url) { setLoading(false); return }
    fetch(state.attachment.url).then(response => response.ok ? response.text() : Promise.reject(new Error())).then(setText).catch(() => setError('Ce fichier ne peut pas être lu dans l’éditeur.')).finally(() => setLoading(false))
  }, [state.attachment.url, state.text])

  function updateText(next: string) {
    if (next === text) return
    historyRef.current = [...historyRef.current, text].slice(-100)
    redoRef.current = []
    setHistorySize(historyRef.current.length)
    setRedoSize(0)
    setText(next)
  }

  function undo() {
    const previous = historyRef.current.pop()
    if (previous === undefined) return
    redoRef.current.push(text)
    setText(previous)
    setHistorySize(historyRef.current.length)
    setRedoSize(redoRef.current.length)
  }

  function redo() {
    const next = redoRef.current.pop()
    if (next === undefined) return
    historyRef.current.push(text)
    setText(next)
    setHistorySize(historyRef.current.length)
    setRedoSize(redoRef.current.length)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const modifier = event.metaKey || event.ctrlKey
    if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
    if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
    if (event.key === 'Tab') {
      event.preventDefault()
      const target = event.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      updateText(`${text.slice(0, start)}  ${text.slice(end)}`)
      requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2 })
    }
  }

  function syncScroll(event: ReactUIEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget
    if (previewRef.current) { previewRef.current.scrollTop = target.scrollTop; previewRef.current.scrollLeft = target.scrollLeft }
    if (lineNumbersRef.current) lineNumbersRef.current.style.transform = `translateY(-${target.scrollTop}px)`
  }

  const lines = Math.max(1, text.split('\\n').length)
  return <div className="modal-backdrop" onClick={onClose}><div className="file-editor-modal" onClick={event => event.stopPropagation()}><div className="file-editor-heading"><div><span className="eyebrow">Éditeur de code</span><h2>{state.attachment.name}</h2><small>{formatFileSize(state.attachment.size)} · {state.attachment.type || 'type inconnu'} · {lines} ligne{lines > 1 ? 's' : ''}</small></div><button className="modal-close" onClick={onClose} aria-label="Fermer">×</button></div>{loading ? <div className="editor-loading">Ouverture du fichier…</div> : error ? <div className="editor-error">{error}</div> : <><div className="editor-toolbar"><span className="editor-language">.{codeExtension(state.attachment.name)}</span><button type="button" onClick={undo} disabled={!historySize}>↶ Annuler</button><button type="button" onClick={redo} disabled={!redoSize}>↷ Rétablir</button><span className="editor-shortcuts">Ctrl/Cmd + Z · Ctrl/Cmd + Y</span></div><div className="code-editor-shell"><div className="line-numbers" aria-hidden="true"><div ref={lineNumbersRef}>{Array.from({ length: lines }, (_, index) => <span key={index}>{index + 1}</span>)}</div></div><div className="code-editor-stack"><pre ref={previewRef} className="code-highlight" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightCode(text, state.attachment.name) }} /><textarea ref={textareaRef} className="file-editor" value={text} onChange={event => updateText(event.target.value)} onScroll={syncScroll} onKeyDown={handleKeyDown} spellCheck={false} aria-label="Contenu du fichier" /></div></div></>}<div className="file-editor-actions"><button className="cancel-button" onClick={onClose}>Annuler</button><button className="primary-button" disabled={loading || Boolean(error)} onClick={() => onSave(new File([text], state.attachment.name, { type: state.attachment.type || 'text/plain' }), state.target)}>Joindre la version modifiée</button></div></div></div>
}

export default function Home() {
  const [mode, setMode] = useState<Mode>('ask')
  const [questions, setQuestions] = useState<Question[]>([])
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState('')
  const [user, setUser] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [configMissing, setConfigMissing] = useState(false)
  const [questionFile, setQuestionFile] = useState<File>()
  const [questionPreview, setQuestionPreview] = useState('')
  const [answerFile, setAnswerFile] = useState<File>()
  const [answerPreview, setAnswerPreview] = useState('')
  const [editor, setEditor] = useState<EditorState>()
  const [drawingOpen, setDrawingOpen] = useState(false)
  const [claimedId, setClaimedId] = useState('')
  const [seconds, setSeconds] = useState(60)
  const [timerPaused, setTimerPaused] = useState(false)
  const [notice, setNotice] = useState('')
  const [deleteQuestion, setDeleteQuestion] = useState<Question>()
  const [deletingQuestionId, setDeletingQuestionId] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeQuestionId, setActiveQuestionId] = useState('')
  const [questionsLoaded, setQuestionsLoaded] = useState(false)
  const currentUserIdRef = useRef('')
  const activeQuestionIdRef = useRef('')
  const questionsLoadedRef = useRef(false)
  const loadRequestRef = useRef(0)
  const inactivityTimerRef = useRef<number | undefined>(undefined)
  const lastClaimRefreshRef = useRef(0)

  function setActiveConversation(id: string) { activeQuestionIdRef.current = id; setActiveQuestionId(id); saveActiveConversation(window.localStorage, id) }
  function cacheQuestion(question: Question) { window.localStorage.setItem(`humain-gpt-question-${question.id}`, JSON.stringify({ ...question, attachment: undefined, answers: question.answers.map(item => ({ ...item, attachment: undefined })), messages: question.messages.map(item => ({ ...item, attachment: undefined })) })) }
  function readCachedActiveQuestion(userId: string) { if (!activeQuestionIdRef.current || !userId) return undefined; try { const raw = window.localStorage.getItem(`humain-gpt-question-${activeQuestionIdRef.current}`); const cached = raw ? JSON.parse(raw) as Question : undefined; return cached?.authorId === userId ? { ...cached, answers: cached.answers || [], messages: cached.messages || [] } : undefined } catch { return undefined } }

  useEffect(() => { const saved = loadActiveConversation(window.localStorage); if (saved) { activeQuestionIdRef.current = saved; setActiveQuestionId(saved) } }, [])
  const loggedIn = Boolean(user && currentUserId)
  const availableQuestions = useMemo(() => questions.filter(item => item.status === 'open'), [questions])
  const historyQuestions = useMemo(() => [...questions.filter(item => item.authorId === currentUserId || item.answers.some(answerItem => answerItem.authorId === currentUserId))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [questions, currentUserId])
  const activeQuestion = useMemo(() => questions.find(item => item.id === activeQuestionId), [questions, activeQuestionId])

  useEffect(() => {
    const client = supabase
    if (!client) { setConfigMissing(true); return }
    let active = true
    client.auth.getUser().then(({ data }) => { if (!active) return; const member = data.user; const id = member?.id || ''; currentUserIdRef.current = id; setCurrentUserId(id); setUser(member?.user_metadata?.display_name || member?.email?.split('@')[0] || ''); void loadQuestions(id) })
    const channel = client.channel('humain-gpt-live').on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, () => { void loadQuestions(currentUserIdRef.current) }).on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => { void loadQuestions(currentUserIdRef.current) }).on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => { void loadQuestions(currentUserIdRef.current) }).subscribe()
    const { data: listener } = client.auth.onAuthStateChange((event, session) => { if (event === 'INITIAL_SESSION') return; const member = session?.user; const id = member?.id || ''; if (id === currentUserIdRef.current && questionsLoadedRef.current) return; currentUserIdRef.current = id; setCurrentUserId(id); setUser(member?.user_metadata?.display_name || member?.email?.split('@')[0] || ''); void loadQuestions(id) })
    return () => { active = false; listener.subscription.unsubscribe(); void client.removeChannel(channel) }
  }, [])

  useEffect(() => { if (!currentUserId || !supabase) return; const refresh = () => { void loadQuestions(currentUserIdRef.current) }; const visibility = () => { if (document.visibilityState === 'visible') refresh() }; window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visibility); const timer = window.setInterval(refresh, 10000); return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visibility); window.clearInterval(timer) } }, [currentUserId])

  async function getFileUrl(client: NonNullable<typeof supabase>, path?: string) { if (!path) return undefined; const result = await client.storage.from('question-images').createSignedUrl(path, 3600); return result.data?.signedUrl }
  async function loadAttachment(client: NonNullable<typeof supabase>, row: any): Promise<Attachment | undefined> { const path = row.file_path || row.image_path; if (!path) return undefined; return { path, name: row.file_name || path.split('/').pop() || 'fichier', type: row.file_type || (row.image_path ? 'image/*' : 'application/octet-stream'), size: Number(row.file_size || 0), url: await getFileUrl(client, path) } }

  async function loadQuestions(userId = currentUserIdRef.current) {
    const client = supabase; if (!client) return; const requestId = ++loadRequestRef.current; setQuestionsLoaded(false); questionsLoadedRef.current = false
    const select = 'id,text,image_path,file_path,file_name,file_type,file_size,claimed_by,claimed_until,status,created_at,author_id'
    const openResult = await client.from('questions').select(select).eq('status', 'open').order('created_at', { ascending: false })
    if (openResult.error || !openResult.data) { const cached = readCachedActiveQuestion(userId); if (requestId === loadRequestRef.current) { if (cached) setQuestions(items => items.some(item => item.id === cached.id) ? items : [cached, ...items]); setQuestionsLoaded(true); questionsLoadedRef.current = true }; return }
    let data = openResult.data as any[]
    if (userId) { const own = await client.from('questions').select(select).eq('author_id', userId).neq('status', 'hidden'); const ownAnswers = await client.from('answers').select('question_id').eq('author_id', userId); const ids = Array.from(new Set((ownAnswers.data || []).map((item: any) => item.question_id))); const answered = ids.length ? await client.from('questions').select(select).in('id', ids).neq('status', 'hidden') : { data: [] }; data = [...data, ...(own.data || []), ...(answered.data || [])].filter((item: any, index: number, all: any[]) => all.findIndex(candidate => candidate.id === item.id) === index) }
    const questionIds = data.map(item => item.id); const answerRows: any[] = []; const messageRows: any[] = []
    if (questionIds.length) { const answers = await client.from('answers').select('id,question_id,text,image_path,file_path,file_name,file_type,file_size,created_at,author_id').in('question_id', questionIds).order('created_at', { ascending: true }); answerRows.push(...(answers.data || [])); const messages = await client.from('messages').select('id,question_id,text,image_path,file_path,file_name,file_type,file_size,created_at,author_id').in('question_id', questionIds).order('created_at', { ascending: true }); messageRows.push(...(messages.data || [])) }
    const authorIds = Array.from(new Set([...data.map(item => item.author_id), ...answerRows.map(item => item.author_id), ...messageRows.map(item => item.author_id)].filter(Boolean))); const profileMap: Record<string, string> = {}
    if (authorIds.length) { const profiles = await client.from('profiles').select('id,display_name').in('id', authorIds); (profiles.data || []).forEach((profile: any) => { profileMap[profile.id] = profile.display_name }) }
    const displayName = (id: string) => profileMap[id] || (id === userId ? user || 'Vous' : 'Membre'); const answersByQuestion: Record<string, Answer[]> = {}; const messagesByQuestion: Record<string, Message[]> = {}
    const answers = await Promise.all(answerRows.map(async (row): Promise<Answer & { questionId: string }> => ({ id: row.id, questionId: row.question_id, text: row.text, authorId: row.author_id, author: displayName(row.author_id), time: new Date(row.created_at).toLocaleString('fr-FR'), createdAt: row.created_at, attachment: await loadAttachment(client, row) })))
    answers.forEach(item => { answersByQuestion[item.questionId] = [...(answersByQuestion[item.questionId] || []), item] })
    const messages = await Promise.all(messageRows.map(async (row): Promise<Message & { questionId: string }> => ({ id: row.id, questionId: row.question_id, text: row.text, authorId: row.author_id, author: displayName(row.author_id), time: new Date(row.created_at).toLocaleString('fr-FR'), createdAt: row.created_at, attachment: await loadAttachment(client, row) })))
    messages.forEach(item => { messagesByQuestion[item.questionId] = [...(messagesByQuestion[item.questionId] || []), item] })
    let items = await Promise.all(data.map(async (row: any): Promise<Question> => ({ id: row.id, text: row.text, authorId: row.author_id, author: displayName(row.author_id), time: new Date(row.created_at).toLocaleString('fr-FR'), createdAt: row.created_at, status: row.status, claimedBy: row.claimed_by || undefined, claimedUntil: row.claimed_until || undefined, attachment: await loadAttachment(client, row), answers: answersByQuestion[row.id] || [], messages: messagesByQuestion[row.id] || [] })))
    if (requestId !== loadRequestRef.current) return; const cached = readCachedActiveQuestion(userId); if (cached && !items.some(item => item.id === cached.id)) items = [cached, ...items]; setQuestions(items); const loaded = items.find(item => item.id === activeQuestionIdRef.current); if (loaded) cacheQuestion(loaded); setQuestionsLoaded(true); questionsLoadedRef.current = true; if (userId && activeQuestionIdRef.current && !items.some(item => item.id === activeQuestionIdRef.current)) setActiveConversation('')
  }

  useEffect(() => { if (!claimedId || timerPaused) return; const timer = window.setInterval(() => setSeconds(value => value <= 1 ? 0 : value - 1), 1000); return () => window.clearInterval(timer) }, [claimedId, timerPaused])
  useEffect(() => { if (claimedId && seconds === 0 && !timerPaused) { setQuestions(items => items.map(item => item.id === claimedId ? { ...item, claimedBy: undefined } : item)); setClaimedId(''); setNotice('Le délai est terminé : la question est de nouveau disponible.') } }, [claimedId, seconds, timerPaused])
  useEffect(() => () => window.clearTimeout(inactivityTimerRef.current), [])

  function markAnswerActivity() {
    if (!claimedId) return
    setTimerPaused(true); setSeconds(60); window.clearTimeout(inactivityTimerRef.current); inactivityTimerRef.current = window.setTimeout(() => { setSeconds(60); void supabase?.rpc('refresh_claim', { question_uuid: claimedId }); setTimerPaused(false) }, 30000)
    const now = Date.now(); if (now - lastClaimRefreshRef.current > 10000) { lastClaimRefreshRef.current = now; void supabase?.rpc('refresh_claim', { question_uuid: claimedId }) }
  }
  async function chooseFile(event: ChangeEvent<HTMLInputElement>, target: FileTarget) { const file = event.target.files?.[0]; if (!file) return; try { await validateFile(file, file.name, file.type) } catch (error) { setNotice(error instanceof Error ? error.message : 'Le fichier a été refusé.'); event.target.value = ''; return }; const preview = URL.createObjectURL(file); if (target === 'question') { setQuestionFile(file); setQuestionPreview(preview) } else { setAnswerFile(file); setAnswerPreview(preview); markAnswerActivity() }; event.target.value = ''; setNotice('Le fichier sera automatiquement supprimé après 24 heures. Tu peux en envoyer 2 par jour maximum.') }
  function setDrawing(file: File) { setAnswerFile(file); setAnswerPreview(URL.createObjectURL(file)); setDrawingOpen(false); markAnswerActivity(); setNotice('Dessin ajouté à ta réponse.') }
  function removeAttachment(target: FileTarget) { if (target === 'question') { if (questionPreview) URL.revokeObjectURL(questionPreview); setQuestionFile(undefined); setQuestionPreview('') } else { if (answerPreview) URL.revokeObjectURL(answerPreview); setAnswerFile(undefined); setAnswerPreview('') } }
  function saveEditedFile(file: File, target: FileTarget) { const preview = URL.createObjectURL(file); removeAttachment(target); if (target === 'question') { setQuestionFile(file); setQuestionPreview(preview) } else { setAnswerFile(file); setAnswerPreview(preview); markAnswerActivity() }; setEditor(undefined); setNotice('Version modifiée jointe. Elle sera envoyée avec ton prochain message.') }
  async function uploadFile(file: File, userId: string, folder: string): Promise<{ path: string; name?: string; type?: string; size?: number; error: Error | null }> {
    const client = supabase
    if (!client) return { path: '', error: new Error('Supabase non configuré') }
    try {
      const validation = await validateFile(file, file.name, file.type)
      const { data: { session } } = await client.auth.getSession()
      if (!session?.access_token || session.user.id !== userId) return { path: '', error: new Error('Authentification requise') }
      const body = new FormData()
      body.append('file', file, validation.name)
      body.append('folder', folder)
      const response = await fetch('/api/files/upload', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body })
      const result = await response.json().catch(() => ({})) as { path?: string; name?: string; type?: string; size?: number; error?: string; remainingFilesToday?: number }
      if (!response.ok || !result.path) return { path: '', error: new Error(result.error || 'Le fichier a été refusé.') }
      if (result.remainingFilesToday === 0) setNotice('Fichier envoyé. Attention, tu as utilisé ton dernier envoi de fichier du jour.')
      return { path: result.path, name: result.name, type: result.type, size: result.size, error: null }
    } catch (error) {
      return { path: '', error: error instanceof Error ? error : new Error('Le fichier a été refusé.') }
    }
  }

  async function submitMessage(questionId: string, event: FormEvent) { event.preventDefault(); const client = supabase; if (!client) { setAuthOpen(true); return }; if (!draft.trim() && !questionFile) return; const { data: auth } = await client.auth.getUser(); if (!auth.user) { setAuthOpen(true); return }; let filePath: string | undefined; let uploadedFile: { name?: string; type?: string; size?: number } | undefined; if (questionFile) { const upload = await uploadFile(questionFile, auth.user.id, 'messages'); if (upload.error) { setNotice(`Le fichier n’a pas pu être envoyé : ${upload.error.message}`); return }; filePath = upload.path; uploadedFile = upload }; const result = await client.rpc('submit_message', { question_uuid: questionId, message_text: draft.trim(), message_file_path: filePath || null, message_file_name: uploadedFile?.name || questionFile?.name || null, message_file_type: uploadedFile?.type || questionFile?.type || 'application/octet-stream', message_file_size: uploadedFile?.size || questionFile?.size || null }); if (result.error) { setNotice(result.error.message); return }; const created = Array.isArray(result.data) ? result.data[0] : result.data; const createdAt = created?.created_at || new Date().toISOString(); const local: Message = { id: created?.id || `local-${Date.now()}`, text: created?.text || draft.trim() || 'Message avec fichier', authorId: auth.user.id, author: auth.user.user_metadata?.display_name || user || 'Membre', time: new Date(createdAt).toLocaleString('fr-FR'), createdAt, attachment: currentAttachment(questionFile, questionPreview, filePath) }; setQuestions(items => items.map(item => item.id === questionId ? { ...item, messages: [...item.messages, local] } : item)); setDraft(''); removeAttachment('question'); setNotice('Message ajouté à cette conversation.'); await loadQuestions(currentUserIdRef.current) }

  async function submitQuestion(event: FormEvent) { event.preventDefault(); const client = supabase; if (!client) { setAuthOpen(true); return }; if (!draft.trim() || draft.trim().length < 3) { setNotice('Écris au moins trois caractères pour poser ta question.'); return }; const { data: auth } = await client.auth.getUser(); if (!auth.user) { setAuthOpen(true); return }; let filePath: string | undefined; let uploadedFile: { name?: string; type?: string; size?: number } | undefined; if (questionFile) { const upload = await uploadFile(questionFile, auth.user.id, 'questions'); if (upload.error) { setNotice(`Le fichier n’a pas pu être envoyé : ${upload.error.message}`); return }; filePath = upload.path; uploadedFile = upload }; const result = await client.rpc('create_question', { question_text: draft.trim(), question_file_path: filePath || null, question_file_name: uploadedFile?.name || questionFile?.name || null, question_file_type: uploadedFile?.type || questionFile?.type || 'application/octet-stream', question_file_size: uploadedFile?.size || questionFile?.size || null }); const created = Array.isArray(result.data) ? result.data[0] : result.data; if (result.error) { setNotice(result.error.message); return }; if (created?.id) { const createdAt = created.created_at || new Date().toISOString(); const item: Question = { id: created.id, author: auth.user.user_metadata?.display_name || user || 'Vous', authorId: auth.user.id, text: draft.trim(), time: new Date(createdAt).toLocaleString('fr-FR'), createdAt, attachment: currentAttachment(questionFile, questionPreview, filePath), status: 'open', answers: [], messages: [] }; cacheQuestion(item); setQuestions(items => [item, ...items.filter(existing => existing.id !== item.id)]); setActiveConversation(item.id); setDraft(''); removeAttachment('question'); setNotice('Question envoyée. Une personne va pouvoir te répondre.'); await loadQuestions(auth.user.id) } }

  async function claimQuestion(question: Question) { const client = supabase; if (!client) { setAuthOpen(true); return }; const { data: auth } = await client.auth.getUser(); if (!auth.user) { setAuthOpen(true); return }; if (claimedId) return; const result = await client.rpc('claim_question', { question_uuid: question.id }); if (result.error) { setNotice('Cette question vient probablement d’être réservée par quelqu’un.'); await loadQuestions(); return }; setClaimedId(question.id); setSeconds(60); setTimerPaused(false); lastClaimRefreshRef.current = Date.now(); setQuestions(items => items.map(item => item.id === question.id ? { ...item, claimedBy: currentUserId } : item)); setNotice(question.authorId === currentUserId ? 'Tu peux maintenant répondre à ta propre question.' : 'Question réservée pour toi pendant 1 minute.') }

  async function submitAnswer(event: FormEvent) { event.preventDefault(); const client = supabase; if (!client || !claimedId || (!answer.trim() && !answerFile)) return; const { data: auth } = await client.auth.getUser(); if (!auth.user) { setAuthOpen(true); return }; let filePath: string | undefined; let uploadedFile: { name?: string; type?: string; size?: number } | undefined; if (answerFile) { const upload = await uploadFile(answerFile, auth.user.id, 'answers'); if (upload.error) { setNotice(`Le fichier n’a pas pu être envoyé : ${upload.error.message}`); return }; filePath = upload.path; uploadedFile = upload }; const questionId = claimedId; const result = await client.rpc('submit_answer', { question_uuid: questionId, answer_text: answer.trim(), answer_file_path: filePath || null, answer_file_name: uploadedFile?.name || answerFile?.name || null, answer_file_type: uploadedFile?.type || answerFile?.type || 'application/octet-stream', answer_file_size: uploadedFile?.size || answerFile?.size || null }); if (result.error) { setNotice(result.error.message); return }; const submitted = Array.isArray(result.data) ? result.data[0] : result.data; if (submitted?.id) { const createdAt = submitted.created_at || new Date().toISOString(); const local: Answer = { id: submitted.id, text: submitted.text || answer.trim() || 'Réponse avec fichier', authorId: auth.user.id, author: auth.user.user_metadata?.display_name || user || 'Membre', time: new Date(createdAt).toLocaleString('fr-FR'), createdAt, attachment: currentAttachment(answerFile, answerPreview, filePath) }; setQuestions(items => items.map(item => { if (item.id !== questionId) return item; const updated = { ...item, status: 'answered' as const, claimedBy: undefined, claimedUntil: undefined, answers: [...item.answers.filter(existing => existing.id !== local.id), local] }; cacheQuestion(updated); return updated })) }; setAnswer(''); removeAttachment('answer'); setClaimedId(''); setTimerPaused(false); window.clearTimeout(inactivityTimerRef.current); setNotice('Réponse envoyée. Elle est maintenant visible dans la conversation.'); await loadQuestions(currentUserIdRef.current) }

  async function permanentlyDeleteQuestion(question: Question) { const client = supabase; if (!client) { setAuthOpen(true); return }; if (deletingQuestionId) return; const { data: auth } = await client.auth.getUser(); if (!auth.user || auth.user.id !== question.authorId) { setNotice('Seule la personne qui a posé la question peut la supprimer.'); return }; setDeletingQuestionId(question.id); let result = await client.rpc('delete_question', { question_uuid: question.id }); if (result.error) { const fallback = await client.from('questions').delete().eq('id', question.id).eq('author_id', auth.user.id).select('id').maybeSingle(); if (fallback.error) { setDeletingQuestionId(''); setNotice(`Suppression impossible : ${fallback.error.message}`); return } }; setDeletingQuestionId(''); window.localStorage.removeItem(`humain-gpt-question-${question.id}`); if (activeQuestionIdRef.current === question.id) setActiveConversation(''); setQuestions(items => items.filter(item => item.id !== question.id)); setDeleteQuestion(undefined); setNotice('Conversation supprimée définitivement pour tout le monde.') }
  async function authenticate(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const client = supabase; if (!client) { setNotice('Configure Supabase dans .env.local ou Vercel.'); return }; const form = new FormData(event.currentTarget); const emailValue = String(form.get('email') || ''); const passwordValue = String(form.get('password') || ''); const result = authMode === 'signup' ? await client.auth.signUp({ email: emailValue, password: passwordValue, options: { data: { display_name: emailValue.split('@')[0] } } }) : await client.auth.signInWithPassword({ email: emailValue, password: passwordValue }); if (result.error) { setNotice(result.error.message); return }; if (result.data.user) { setCurrentUserId(result.data.user.id); currentUserIdRef.current = result.data.user.id; setUser(result.data.user.user_metadata?.display_name || emailValue.split('@')[0]); setAuthOpen(false); setNotice(authMode === 'signup' ? 'Compte créé. Vérifie ton email si demandé.' : 'Connexion réussie.') } }
  async function signOut() { await supabase?.auth.signOut(); setUser(''); setCurrentUserId(''); currentUserIdRef.current = ''; setMode('ask'); setActiveConversation(''); setNotice('Tu es déconnecté.') }
  function openAuth(kind: 'signin' | 'signup') { setAuthMode(kind); setAuthOpen(true) }

  return <main className={`chat-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="chat-sidebar"><div className="sidebar-top"><button className="brand" onClick={() => setMode('ask')}><span className="brand-mark">✦</span><span>HumainGPT</span></button><button className="collapse" onClick={() => setSidebarCollapsed(true)} aria-label="Réduire le menu">‹</button></div><button className="new-chat" onClick={() => { setMode('ask'); setDraft(''); setActiveConversation('') }}>＋ <span>Nouvelle question</span></button><button className={`sidebar-item ${mode === 'history' ? 'active' : ''}`} onClick={() => setMode('history')}>▤ <span>Mes conversations</span></button>{loggedIn && historyQuestions.length > 0 && <nav className="conversation-nav" aria-label="Conversations récentes">{historyQuestions.map(question => <div key={question.id} className={`conversation-nav-row ${question.id === activeQuestionId ? 'active' : ''}`}><button className="conversation-nav-item" title={question.text} onClick={() => { setActiveConversation(question.id); setMode('ask') }}><span className={`status-dot ${question.status}`} /><span>{shortTitle(question.text)}</span></button>{question.authorId === currentUserId && <button type="button" className="delete-conversation" onClick={() => setDeleteQuestion(question)} aria-label="Supprimer">🗑️</button>}</div>)}</nav>}<div className="sidebar-spacer" /><div className="sidebar-links"><button className="sidebar-item" onClick={() => setSettingsOpen(true)}>⚙ <span>Paramètres</span></button></div>{!loggedIn && <div className="sidebar-login"><strong>Participe à la communauté</strong><p>Connecte-toi pour poser des questions, répondre et partager des fichiers.</p><button onClick={() => openAuth('signin')}>Se connecter</button></div>}{loggedIn && <button className="account-sidebar" onClick={signOut}><span className="mini-avatar">{user[0]}</span><span>{user}</span><small>Se déconnecter</small></button>}</aside>
    {sidebarCollapsed && <button className="expand-sidebar" onClick={() => setSidebarCollapsed(false)} aria-label="Afficher le menu">›</button>}
    <section className="chat-main"><header className="chat-header"><button className="model-name" onClick={() => { setMode('ask'); setActiveConversation('') }}><span className="header-mark">✦</span> HumainGPT</button><div className="header-actions">{!loggedIn && <><button className="login-button" onClick={() => openAuth('signin')}>Se connecter</button><button className="signup-button" onClick={() => openAuth('signup')}>Inscription gratuite</button></>}</div></header><div className="chat-body">{notice && <div className="toast">{notice}<button onClick={() => setNotice('')} aria-label="Fermer la notification">×</button></div>}
      {mode === 'ask' && activeQuestion ? <ActiveConversation question={activeQuestion} currentUserId={currentUserId} draft={draft} questionFile={questionFile} questionPreview={questionPreview} onDraftChange={setDraft} onSubmit={event => submitMessage(activeQuestion.id, event)} onFile={event => chooseFile(event, 'question')} onRemoveFile={() => removeAttachment('question')} onOpenEditor={file => setEditor({ attachment: file, target: 'question', text: '' })} onNewQuestion={() => { setActiveConversation(''); setDraft('') }} /> : mode === 'ask' && !questionsLoaded && activeQuestionId ? <div className="conversation-loading"><span className="waiting-orb"><i /><i /><i /></span><strong>Ouverture de ta conversation…</strong></div> : mode === 'ask' && <><div className="hero"><div className="hero-mark">✦</div><h1>Qu’est-ce qui te ferait avancer ?</h1><p>Des réponses utiles, données par de vraies personnes.</p></div><form className="chat-composer" onSubmit={submitQuestion}><textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Écris ta question à la communauté..." /><div className="composer-actions"><label className="plus-button" title="Ajouter un fichier">＋<input type="file" accept="*/*" onChange={event => chooseFile(event, 'question')} /></label>{questionFile && <AttachmentPreview file={currentAttachment(questionFile, questionPreview)} onRemove={() => removeAttachment('question')} onEdit={isEditableAttachment(currentAttachment(questionFile, questionPreview)!) ? () => setEditor({ attachment: currentAttachment(questionFile, questionPreview)!, target: 'question', text: '' }) : undefined} />}{!questionFile && <span className="human-only">20 Mo max · 2 fichiers/jour · supprimés après 24h</span>}<button className={`send-button ${draft.trim().length >= 3 ? 'ready' : ''}`} disabled={draft.trim().length < 3} aria-label="Envoyer la question">↑</button></div></form><p className="composer-note">Tu pourras retrouver cette conversation dans <button type="button" onClick={() => setMode('history')}>Mes conversations</button>.</p></>}
      {mode === 'answer' && <><div className="section-heading"><div><span className="eyebrow">Entraide en direct</span><h1>Aide quelqu’un aujourd’hui.</h1><p>Choisis une question, lis tout le chat, puis écris une réponse.</p></div><span className="count-pill">{availableQuestions.length} disponible{availableQuestions.length > 1 ? 's' : ''}</span></div><div className="question-list">{availableQuestions.map(question => <QuestionCard key={question.id} question={question} selected={question.id === claimedId} seconds={seconds} timerPaused={timerPaused} answer={answer} answerFile={answerFile} answerPreview={answerPreview} currentUserId={currentUserId} onClaim={() => claimQuestion(question)} onAnswerChange={value => { setAnswer(value); markAnswerActivity() }} onSubmit={submitAnswer} onFile={event => chooseFile(event, 'answer')} onDraw={() => setDrawingOpen(true)} onRemoveFile={() => removeAttachment('answer')} onOpenEditor={file => setEditor({ attachment: file, target: 'answer', text: '' })} />)}</div>{availableQuestions.length === 0 && <EmptyState onClick={() => setMode('ask')} />}</>}
      {mode === 'history' && <><div className="section-heading"><div><span className="eyebrow">Ton espace personnel</span><h1>Historique des conversations.</h1><p>Retrouve tes questions, tes réponses et tes fichiers au même endroit.</p></div><span className="count-pill">{historyQuestions.length} conversation{historyQuestions.length > 1 ? 's' : ''}</span></div>{!loggedIn ? <EmptyState login={() => openAuth('signin')} /> : <div className="history-list">{historyQuestions.map(question => <HistoryCard key={question.id} question={question} currentUserId={currentUserId} onOpen={() => { setActiveConversation(question.id); setMode('ask') }} onDelete={() => setDeleteQuestion(question)} />)}</div>}{loggedIn && historyQuestions.length === 0 && <EmptyState onClick={() => setMode('ask')} />}</>}
    </div><footer>HumainGPT n’est pas une IA. Les réponses sont écrites par des personnes. <span>Conditions</span> · <span>Confidentialité</span></footer></section>
    {drawingOpen && <DrawingPad onSave={setDrawing} onClose={() => setDrawingOpen(false)} />}{editor && <FileEditor state={editor} onClose={() => setEditor(undefined)} onSave={saveEditedFile} />}{settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="settings-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setSettingsOpen(false)}>×</button><span className="eyebrow">Préférences</span><h2>Paramètres</h2><p>Choisis l’espace à ouvrir par défaut.</p><button className={mode === 'ask' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('ask'); setActiveConversation(''); setSettingsOpen(false) }}>✎ Poser une question <span>{mode === 'ask' ? '✓' : ''}</span></button><button className={mode === 'answer' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('answer'); setSettingsOpen(false) }}>◌ Questions ouvertes <span>{mode === 'answer' ? `${availableQuestions.length} ouverte${availableQuestions.length > 1 ? 's' : ''}` : ''}</span></button><button className={mode === 'history' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('history'); setSettingsOpen(false) }}>▤ Ouvrir l’historique <span>{mode === 'history' ? '✓' : ''}</span></button></div></div>}{configMissing && <div className="config-warning">Connecte Supabase avec tes variables d’environnement pour partager les conversations.</div>}{deleteQuestion && <div className="modal-backdrop" onClick={() => setDeleteQuestion(undefined)}><div className="delete-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setDeleteQuestion(undefined)} aria-label="Fermer">×</button><div className="delete-icon">⌫</div><span className="eyebrow danger-eyebrow">Action irréversible</span><h2>Supprimer cette conversation ?</h2><p>Cette conversation sera supprimée pour tout le monde et ne pourra pas être récupérée.</p><div className="delete-actions"><button className="cancel-button" onClick={() => setDeleteQuestion(undefined)}>Annuler</button><button className="danger-button" disabled={deletingQuestionId === deleteQuestion.id} onClick={() => void permanentlyDeleteQuestion(deleteQuestion)}>{deletingQuestionId === deleteQuestion.id ? 'Suppression…' : 'Supprimer pour tout le monde'}</button></div></div></div>}{authOpen && <div className="modal-backdrop" onClick={() => setAuthOpen(false)}><div className="auth-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setAuthOpen(false)}>×</button><div className="hero-mark">✦</div><span className="eyebrow">HumainGPT</span><h2>{authMode === 'signup' ? 'Créer ton compte' : 'Se connecter'}</h2><p>Un compte est nécessaire pour participer et retrouver ton historique.</p><form onSubmit={authenticate}><label>Email<input name="email" type="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="vous@exemple.com" /></label><label className="password-label">Mot de passe<input name="password" type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={6} placeholder="6 caractères minimum" /></label><button className="modal-submit">{authMode === 'signup' ? 'Créer mon compte' : 'Se connecter'}</button></form><button className="auth-switch" onClick={() => setAuthMode(authMode === 'signup' ? 'signin' : 'signup')}>{authMode === 'signup' ? 'J’ai déjà un compte' : 'Créer un compte gratuitement'}</button><small>Aucune IA ne répond aux questions ici.</small></div></div>}
  </main>
}

function AttachmentPreview({ file, onRemove, onEdit }: { file?: Attachment; onRemove: () => void; onEdit?: () => void }) { if (!file) return null; return <span className="attachment-preview"><span className="attachment-mini-icon">{isImageAttachment(file) ? 'IMG' : file.type === 'application/pdf' ? 'PDF' : 'FILE'}</span><span className="attachment-mini-name" title={file.name}>{file.name}</span>{onEdit && <button type="button" onClick={onEdit} aria-label="Modifier le fichier">✎</button>}<button type="button" onClick={onRemove} aria-label="Retirer le fichier">×</button></span> }

function ThreadAttachment({ attachment, onEdit }: { attachment?: Attachment; onEdit?: (file: Attachment) => void }) { return attachment ? <AttachmentView attachment={attachment} onEdit={onEdit && isEditableAttachment(attachment) ? () => onEdit(attachment) : undefined} /> : null }

function QuestionCard({ question, selected, seconds, timerPaused, answer, answerFile, answerPreview, currentUserId, onClaim, onAnswerChange, onSubmit, onFile, onDraw, onRemoveFile, onOpenEditor }: { question: Question; selected: boolean; seconds: number; timerPaused: boolean; answer: string; answerFile?: File; answerPreview: string; currentUserId: string; onClaim: () => void; onAnswerChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onDraw: () => void; onRemoveFile: () => void; onOpenEditor: (file: Attachment) => void }) {
  const thread = [...question.messages.map(item => ({ ...item, kind: 'message' as const })), ...question.answers.map(item => ({ ...item, kind: 'answer' as const }))].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  return <article className={`question-row ${selected ? 'selected' : ''}`}><div className="question-author"><span className="mini-avatar">{question.author[0]}</span><span><b>{question.author}{question.authorId === currentUserId ? ' · vous' : ''}</b><small>{question.time}</small></span></div><p>{question.text}</p><ThreadAttachment attachment={question.attachment} onEdit={onOpenEditor} />{thread.length > 0 && <div className="question-thread">{thread.map(item => <div className={`question-thread-item ${item.authorId === currentUserId ? 'mine' : ''}`} key={`${item.kind}-${item.id}`}><span className="mini-avatar">{item.author[0]}</span><div><strong>{item.authorId === currentUserId ? 'Vous' : item.author}</strong><small>{item.kind === 'answer' ? 'Réponse' : 'Message'}</small><p>{item.text}</p><ThreadAttachment attachment={item.attachment} onEdit={onOpenEditor} /></div></div>)}</div>}{selected ? <form className="answer-form" onSubmit={onSubmit}><div className="answer-toolbar"><span className={`countdown ${timerPaused ? 'paused' : ''}`}>{timerPaused ? 'Pause · 60s' : `${seconds}s`}</span><label className="tool-button" title="Ajouter un fichier">＋<input type="file" accept="*/*" onChange={onFile} /></label><button type="button" className="tool-button" onClick={onDraw} title="Dessiner">✎</button>{answerFile && <AttachmentPreview file={currentAttachment(answerFile, answerPreview)} onRemove={onRemoveFile} onEdit={isEditableAttachment(currentAttachment(answerFile, answerPreview)!) ? () => onOpenEditor(currentAttachment(answerFile, answerPreview)!) : undefined} />}<span className="toolbar-hint">Écriture ou fichier : pause · reprise après 30 s d’inactivité</span></div><textarea value={answer} onChange={event => onAnswerChange(event.target.value)} placeholder="Écris ta réponse..." /><button className="answer-submit" disabled={!answer.trim() && !answerFile}>Envoyer la réponse</button></form> : <button className="answer-link" disabled={Boolean(question.claimedBy)} onClick={onClaim}>{question.claimedBy === currentUserId ? 'Réservée par vous' : question.claimedBy ? 'Déjà réservée' : 'Répondre →'}</button>}</article>
}

function ActiveConversation({ question, currentUserId, draft, questionFile, questionPreview, onDraftChange, onSubmit, onFile, onRemoveFile, onOpenEditor, onNewQuestion }: { question: Question; currentUserId: string; draft: string; questionFile?: File; questionPreview: string; onDraftChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onRemoveFile: () => void; onOpenEditor: (file: Attachment) => void; onNewQuestion: () => void }) {
  const waiting = question.status === 'open' && question.answers.length === 0; const thread = [...question.messages.map(item => ({ ...item, kind: 'message' as const })), ...question.answers.map(item => ({ ...item, kind: 'answer' as const }))].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  return <div className="active-conversation"><div className="conversation-label"><span className="conversation-icon">✦</span><span>{shortTitle(question.text)}</span><span className="conversation-time">{question.time}</span></div><div className="conversation-thread"><div className={`message-card ${question.authorId === currentUserId ? 'message-own' : 'message-other'}`}><span className="mini-avatar">{question.author[0]}</span><div><strong>{question.authorId === currentUserId ? 'Vous' : question.author}</strong><small>{question.time}</small><p>{question.text}</p><ThreadAttachment attachment={question.attachment} onEdit={onOpenEditor} /></div></div>{thread.map(item => <div className={`message-card ${item.kind === 'answer' ? 'answer-message' : 'chat-message'} ${item.authorId === currentUserId ? 'message-own' : 'message-other'}`} key={`${item.kind}-${item.id}`}><span className="mini-avatar answer-avatar">{item.author[0]}</span><div><strong>{item.authorId === currentUserId ? 'Vous' : item.author}</strong><small>{item.kind === 'answer' ? 'Réponse' : 'Message'}</small><p>{item.text}</p><ThreadAttachment attachment={item.attachment} onEdit={onOpenEditor} /></div></div>)}{waiting && <div className="waiting-card"><span className="waiting-orb"><i /><i /><i /></span><div><strong>Réponse en cours</strong><span>Votre question a été envoyée à la communauté.</span></div></div>}</div><form className="conversation-composer" onSubmit={onSubmit}><textarea value={draft} onChange={event => onDraftChange(event.target.value)} placeholder="Poser un nouveau message" aria-label="Poser un nouveau message" /><div className="conversation-composer-actions"><label className="plus-button" title="Ajouter un fichier">＋<input type="file" accept="*/*" onChange={onFile} /></label>{questionFile && <AttachmentPreview file={currentAttachment(questionFile, questionPreview)} onRemove={onRemoveFile} onEdit={isEditableAttachment(currentAttachment(questionFile, questionPreview)!) ? () => onOpenEditor(currentAttachment(questionFile, questionPreview)!) : undefined} />}<button className={`composer-arrow ${draft.trim().length >= 1 ? 'ready' : ''}`} disabled={draft.trim().length < 1 && !questionFile} aria-label="Envoyer le message">↑</button></div></form><button className="new-conversation-link" onClick={onNewQuestion}>Effacer et commencer un nouveau chat</button></div>
}

function HistoryCard({ question, currentUserId, onOpen, onDelete }: { question: Question; currentUserId: string; onOpen: () => void; onDelete: () => void }) { return <article className="history-card"><div className="history-top"><span className={`status-dot ${question.status}`} /><span>{question.status === 'answered' ? 'Répondue' : 'En attente'}</span><time>{question.time}</time><button type="button" className="history-open" onClick={onOpen}>Ouvrir →</button>{question.authorId === currentUserId && <button type="button" className="history-delete" onClick={onDelete} aria-label="Supprimer définitivement">🗑️</button>}</div><div className="history-question"><span className="mini-avatar">{question.author[0]}</span><div><strong>{question.authorId === currentUserId ? 'Votre question' : `Question de ${question.author}`}</strong><p>{question.text}</p><ThreadAttachment attachment={question.attachment} /></div></div>{question.answers.map(item => <div className="history-answer" key={item.id}><span className="mini-avatar answer-avatar">{item.author[0]}</span><div><strong>{item.authorId === currentUserId ? 'Votre réponse' : item.author}</strong><small>{item.time}</small><p>{item.text}</p><ThreadAttachment attachment={item.attachment} /></div></div>)}</article> }
function shortTitle(text: string) { const compact = text.trim().replace(/\s+/g, ' '); return compact.length > 34 ? `${compact.slice(0, 34).trimEnd()}…` : compact || 'Nouvelle conversation' }
function EmptyState({ onClick, login }: { onClick?: () => void; login?: () => void }) { return <div className="empty-state"><div className="empty-icon">✓</div><strong>{login ? 'Connecte-toi pour retrouver ton historique' : 'Tout est calme pour le moment'}</strong><span>{login ? 'Tes conversations et tes réponses seront conservées ici.' : 'Les nouvelles questions apparaîtront ici dès leur publication.'}</span>{(onClick || login) && <button className="primary-button" onClick={login || onClick}>{login ? 'Se connecter' : 'Poser une question'}</button>}</div> }
