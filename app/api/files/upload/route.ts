import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateFile } from '../../../../lib/file-security'

export const runtime = 'nodejs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > 21 * 1024 * 1024) return fail('La requête dépasse la taille maximale autorisée.', 413)
  if (!supabaseUrl || !supabaseKey || !serviceRoleKey) return fail('Upload sécurisé non configuré côté serveur.', 503)
  try {
    const form = await request.formData()
    const file = form.get('file')
    const folder = form.get('folder')
    if (!(file instanceof File) || typeof folder !== 'string' || !['questions', 'answers', 'messages'].includes(folder)) return fail('Fichier ou destination invalide.')

    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) return fail('Authentification requise.', 401)
    const userClient = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } })
    const { data: { user }, error: userError } = await userClient.auth.getUser(authHeader.slice(7))
    if (userError || !user) return fail('Authentification invalide.', 401)

    const validation = await validateFile(file, file.name, file.type)
    const bytes = Buffer.from(await file.arrayBuffer())
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const path = `${folder}/${user.id}/${crypto.randomUUID()}-${validation.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`
    const upload = await admin.storage.from('question-images').upload(path, file, { contentType: validation.mime, upsert: false })
    if (upload.error) return fail(`Stockage impossible : ${upload.error.message}`, 502)
    const registry = await admin.from('file_uploads').insert({ path, uploader_id: user.id, file_name: validation.name, file_type: validation.mime, file_size: validation.size, sha256, scan_status: 'clean', scanner: 'none' })
    if (registry.error) {
      await admin.storage.from('question-images').remove([path])
      return fail('Le fichier n\'a pas pu être enregistré.', 502)
    }
    return NextResponse.json({ path, name: validation.name, type: validation.mime, size: validation.size, scanStatus: 'clean' })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Fichier refusé.', 422)
  }
}
