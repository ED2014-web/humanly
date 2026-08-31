export const MAX_FILE_SIZE = 30 * 1024 * 1024

const BLOCKED_EXTENSIONS = new Set([
  'ade', 'adp', 'app', 'apk', 'bat', 'bin', 'cab', 'cmd', 'com', 'cpl', 'dll', 'dmg', 'exe', 'gadget',
  'hta', 'jar', 'jsb', 'jse', 'lib', 'lnk', 'msi', 'msp', 'mst', 'ocx', 'pif', 'ps1', 'scr', 'shb', 'sys', 'docm', 'pptm', 'xlsb', 'xlsm',
  'vb', 'vbe', 'vbs', 'vxd', 'wsc', 'wsf', 'wsh', 'iso', 'img', 'svg',
])

const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'css', 'html', 'htm', 'xml', 'yml', 'yaml', 'sql', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'php', 'sh', 'rb', 'js', 'jsx', 'ts', 'tsx']

const MIME_BY_EXTENSION: Record<string, string[]> = {
  aac: ['audio/aac', 'application/octet-stream'],
  avi: ['video/x-msvideo', 'video/avi', 'application/octet-stream'],
  csv: ['text/csv', 'text/plain', 'application/csv'],
  doc: ['application/msword', 'application/octet-stream'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
  flac: ['audio/flac', 'audio/x-flac', 'application/octet-stream'],
  mka: ['audio/x-matroska', 'application/octet-stream'],
  mkv: ['video/x-matroska', 'application/x-matroska', 'application/octet-stream'],
  gif: ['image/gif'],
  gz: ['application/gzip', 'application/x-gzip', 'application/octet-stream'],
  html: ['text/html', 'application/xhtml+xml', 'text/plain'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  json: ['application/json', 'text/json', 'text/plain'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'application/octet-stream'],
  md: ['text/markdown', 'text/plain'],
  mp3: ['audio/mpeg', 'audio/mp3', 'application/octet-stream'],
  m4v: ['video/x-m4v', 'video/mp4', 'application/octet-stream'],
  mov: ['video/quicktime', 'video/x-quicktime', 'application/octet-stream'],
  mp4: ['video/mp4', 'application/mp4', 'application/octet-stream'],
  mpeg: ['video/mpeg', 'application/octet-stream'],
  odg: ['application/vnd.oasis.opendocument.graphics', 'application/zip', 'application/octet-stream'],
  odp: ['application/vnd.oasis.opendocument.presentation', 'application/zip', 'application/octet-stream'],
  ods: ['application/vnd.oasis.opendocument.spreadsheet', 'application/zip', 'application/octet-stream'],
  odt: ['application/vnd.oasis.opendocument.text', 'application/zip', 'application/octet-stream'],
  ogg: ['audio/ogg', 'video/ogg', 'application/ogg', 'application/octet-stream'],
  pdf: ['application/pdf'],
  png: ['image/png'],
  ppt: ['application/vnd.ms-powerpoint', 'application/octet-stream'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/octet-stream'],
  py: ['text/x-python', 'text/plain', 'application/octet-stream'],
  rar: ['application/vnd.rar', 'application/x-rar-compressed', 'application/octet-stream'],
  rtf: ['application/rtf', 'text/rtf', 'text/plain'],
  tar: ['application/x-tar', 'application/octet-stream'],
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'],
  webm: ['video/webm', 'audio/webm', 'application/octet-stream'],
  wmv: ['video/x-ms-wmv', 'application/octet-stream'],
  webp: ['image/webp'],
  xls: ['application/vnd.ms-excel', 'application/octet-stream'],
  xlsm: ['application/vnd.ms-excel.sheet.macroenabled.12', 'application/zip', 'application/octet-stream'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'],
  xlsb: ['application/vnd.ms-excel.sheet.binary.macroenabled.12', 'application/zip', 'application/octet-stream'],
  xml: ['application/xml', 'text/xml', 'text/plain'],
  yaml: ['application/yaml', 'text/yaml', 'text/plain'],
  yml: ['application/yaml', 'text/yaml', 'text/plain'],
  zip: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
  zst: ['application/zstd', 'application/octet-stream'],
}

function extensionOf(name: string) {
  return name.toLowerCase().split('.').pop() || ''
}

function startsWithBytes(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value)
}

function isUtf8Text(bytes: Uint8Array) {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

function signatureMatches(extension: string, bytes: Uint8Array) {
  if (!bytes.length) return true
  if (TEXT_EXTENSIONS.includes(extension) || ['csv', 'json'].includes(extension)) return isUtf8Text(bytes)
  if (['jpg', 'jpeg'].includes(extension)) return startsWithBytes(bytes, [0xff, 0xd8, 0xff])
  if (extension === 'png') return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (extension === 'gif') return new TextDecoder().decode(bytes.slice(0, 6)) === 'GIF87a' || new TextDecoder().decode(bytes.slice(0, 6)) === 'GIF89a'
  if (extension === 'webp') return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  if (extension === 'pdf') return new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
  if (['doc', 'xls', 'ppt'].includes(extension)) return startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'odg', 'zip'].includes(extension)) return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06])
  if (['mp4', 'm4a', 'm4v'].includes(extension)) return new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp'
  if (['webm', 'mka'].includes(extension)) return startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])
  if (extension === 'mp3') return new TextDecoder().decode(bytes.slice(0, 3)) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  if (extension === 'wav') return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WAVE'
  if (extension === 'ogg') return new TextDecoder().decode(bytes.slice(0, 4)) === 'OggS'
  if (extension === 'aac') return new TextDecoder().decode(bytes.slice(0, 4)) === 'ADIF' || (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0)
  if (extension === 'flac') return new TextDecoder().decode(bytes.slice(0, 4)) === 'fLaC'
  if (extension === 'gz') return startsWithBytes(bytes, [0x1f, 0x8b])
  if (extension === 'rar') return new TextDecoder().decode(bytes.slice(0, 7)) === 'Rar!\u001a\u0007'
  if (extension === 'rtf') return new TextDecoder().decode(bytes.slice(0, 5)) === '{\\rtf'
  if (extension === 'tar') return new TextDecoder().decode(bytes.slice(257, 262)) === 'ustar'
  if (extension === 'zst') return startsWithBytes(bytes, [0x28, 0xb5, 0x2f, 0xfd])
  if (extension === 'avi') return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'AVI '
  if (extension === 'mpeg') return startsWithBytes(bytes, [0x00, 0x00, 0x01, 0xba]) || startsWithBytes(bytes, [0x00, 0x00, 0x01, 0xb3])
  if (extension === 'wmv') return startsWithBytes(bytes, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9])
  return !MIME_BY_EXTENSION[extension]
}

function detectedMime(extension: string, bytes: Uint8Array) {
  if (!bytes.length) return undefined
  if ((TEXT_EXTENSIONS.includes(extension) || ['csv', 'json'].includes(extension)) && isUtf8Text(bytes)) return 'text/plain'
  if (['jpg', 'jpeg'].includes(extension) && startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (extension === 'png' && startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (extension === 'gif' && (new TextDecoder().decode(bytes.slice(0, 6)) === 'GIF87a' || new TextDecoder().decode(bytes.slice(0, 6)) === 'GIF89a')) return 'image/gif'
  if (extension === 'webp' && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  if (extension === 'pdf' && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return 'application/pdf'
  if (['doc', 'xls', 'ppt'].includes(extension) && startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/x-ole-storage'
  if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'odg', 'zip'].includes(extension) && (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06]))) return 'application/zip'
  if (['mp4', 'm4a'].includes(extension) && new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp') return extension === 'm4a' ? 'audio/mp4' : 'video/mp4'
  if (extension === 'webm' && startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm'
  if (extension === 'mp3' && (new TextDecoder().decode(bytes.slice(0, 3)) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return 'audio/mpeg'
  if (extension === 'wav' && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WAVE') return 'audio/wav'
  if (extension === 'ogg' && new TextDecoder().decode(bytes.slice(0, 4)) === 'OggS') return 'application/ogg'
  if (extension === 'aac' && (new TextDecoder().decode(bytes.slice(0, 4)) === 'ADIF' || (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0))) return 'audio/aac'
  if (extension === 'flac' && new TextDecoder().decode(bytes.slice(0, 4)) === 'fLaC') return 'audio/flac'
  if (extension === 'gz' && startsWithBytes(bytes, [0x1f, 0x8b])) return 'application/gzip'
  if (extension === 'rar' && new TextDecoder().decode(bytes.slice(0, 7)) === 'Rar!\u001a\u0007') return 'application/vnd.rar'
  if (extension === 'rtf' && new TextDecoder().decode(bytes.slice(0, 5)) === '{\\rtf') return 'application/rtf'
  if (extension === 'tar' && new TextDecoder().decode(bytes.slice(257, 262)) === 'ustar') return 'application/x-tar'
  if (extension === 'zst' && startsWithBytes(bytes, [0x28, 0xb5, 0x2f, 0xfd])) return 'application/zstd'
  if (extension === 'avi' && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'AVI ') return 'video/x-msvideo'
  if (extension === 'mpeg' && (startsWithBytes(bytes, [0x00, 0x00, 0x01, 0xba]) || startsWithBytes(bytes, [0x00, 0x00, 0x01, 0xb3]))) return 'video/mpeg'
  if (extension === 'wmv' && startsWithBytes(bytes, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9])) return 'video/x-ms-wmv'
  return undefined
}

export async function validateFile(file: Blob, name: string, declaredType: string) {
  const cleanName = name.normalize('NFKC').trim()
  const extension = extensionOf(cleanName)
  const mime = (declaredType || 'application/octet-stream').toLowerCase().split(';')[0].trim()
  if (!cleanName || cleanName.length > 180 || /[\u0000-\u001f\u007f\\/]/.test(cleanName)) throw new Error('Nom de fichier invalide.')
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) throw new Error('Le fichier doit faire entre 1 octet et 30 Mo.')
  if (!extension || BLOCKED_EXTENSIONS.has(extension)) throw new Error('Cette extension de fichier est bloquée pour des raisons de sécurité.')
  const expectedMimes = MIME_BY_EXTENSION[extension]
  if (!expectedMimes && !TEXT_EXTENSIONS.includes(extension)) throw new Error(`L’extension .${extension} n’est pas autorisée.`)
  if (expectedMimes && !expectedMimes.includes(mime) && mime !== 'application/octet-stream') throw new Error(`Le type MIME ne correspond pas à l’extension .${extension}.`)
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer())
  if (!signatureMatches(extension, bytes)) throw new Error('La signature du fichier ne correspond pas à son extension.')
  const detected = detectedMime(extension, bytes)
  if (detected === 'application/x-ole-storage' && !['doc', 'xls', 'ppt'].includes(extension)) throw new Error('Le contenu binaire ne correspond pas au format annoncé.')
  if (detected === 'application/zip' && !['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'odg', 'zip'].includes(extension)) throw new Error('Le contenu compressé ne correspond pas à l’extension annoncée.')
  const isTextFile = TEXT_EXTENSIONS.includes(extension) || ['csv', 'json'].includes(extension)
  const acceptedTextMime = mime === 'application/octet-stream' || mime.startsWith('text/') || ['application/json', 'application/javascript', 'application/xml', 'application/sql'].includes(mime)
  if (isTextFile && !acceptedTextMime) throw new Error('Le type MIME déclaré ne correspond pas à un fichier texte.')
  if (detected && !isTextFile && !['application/octet-stream', 'text/plain', 'application/json', 'text/json', 'text/markdown', 'text/csv'].includes(mime) && !expectedMimes?.includes(mime)) throw new Error('Le type MIME déclaré ne correspond pas à la signature du fichier.')
  // Les fichiers texte sont toujours servis comme texte brut pour empêcher
  // qu’un HTML ou un script joint soit exécuté depuis le domaine de l’app.
  const normalizedMime = isTextFile ? 'text/plain' : mime === 'application/octet-stream'
    ? expectedMimes?.find(candidate => candidate !== 'application/octet-stream' && candidate !== 'application/zip') || detected || mime
    : mime
  return { name: cleanName, extension, mime: normalizedMime, detectedMime: detected, size: file.size }
}
