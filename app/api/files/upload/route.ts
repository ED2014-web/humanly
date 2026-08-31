import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateFile } from '../../../../lib/file-security'

export const runtime = 'nodejs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const virustotalKey = process.env.VIRUSTOTAL_API_KEY

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

async function scanWithVirusTotal(file: File) {
  if (!virustotalKey) throw new Error('Antivirus non configuré : VIRUSTOTAL_API_KEY est requis pour accepter un fichier.')

  // Étape 1 : Upload du fichier vers VirusTotal
  const uploadBody = new FormData()
  uploadBody.append('file', file, file.name)
  const uploadRes = await fetch('https://www.virustotal.com/api/v3/files', {
    method: 'POST',
    headers: { 'x-apikey': virustotalKey },
    body: uploadBody,
    signal: AbortSignal.timeout(60000),
  })
  if (!uploadRes.ok) throw new Error('Service antivirus temporairement indisponible.')
  const { data } = (await uploadRes.json()) as { data: { id: string } }

  // Étape 2 : Attendre les résultats (polling)
  const analysisUrl = `https://www.virustotal.com/api/v3/analyses/${data.id}`
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 2000))
    const reportRes = await fetch(analysisUrl, {
      headers: { 'x-apikey': virustotalKey },
      signal: AbortSignal.timeout(15000),
    })
    if (!reportRes.ok) continue
    const report = (await reportRes.json()) as {
      data: { attributes: { status: string; stats: { malicious: number; suspicious: number } } }
    }
    if (report.data.attributes.status === 'completed') {
      const { malicious, suspicious } = report.data.attributes.stats
      if (malicious > 0 || suspicious > 0)
        throw new Error('Fichier refusé : menace détectée par l\'antivirus.')
      return
    }
  }
  throw new Error('Analyse antivirus trop longue : fichier refusé par sécurité.')
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
    await scanWithVirusTotal(file)
    const bytes = Buffer.from(await file.arrayBuffer())
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const path = `${folder}/${user.id}/${crypto.randomUUID()}-${validation.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`
    const upload = await admin.storage.from('question-images').upload(path, file, { contentType: validation.mime, upsert: false })
    if (upload.error) return fail(`Stockage impossible : ${upload.error.message}`, 502)
    const registry = await admin.from('file_uploads').insert({ path, uploader_id: user.id, file_name: validation.name, file_type: validation.mime, file_size: validation.size, sha256, scan_status: 'clean', scanner: 'virustotal' })
    if (registry.error) {
      await admin.storage.from('question-images').remove([path])
      return fail('Le fichier n\'a pas pu être enregistré comme fichier analysé.', 502)
    }
    return NextResponse.json({ path, name: validation.name, type: validation.mime, size: validation.size, scanStatus: 'clean' })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Fichier refusé.', 422)
  }
}
