/**
 * AI 生成图/视频写入资产库时做指纹去重，避免「生成回调 + 历史同步」重复创建同一条资产。
 * 用户上传（user_upload）不走此逻辑。
 */
import { createAssetAPI } from '../api/assets'

const LS_KEY = 'tikgen.archivedMediaFp.v1'
const MAX_ENTRIES = 5000

function loadFpSet(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveFpSet(s: Set<string>) {
  try {
    const arr = [...s]
    const tail = arr.length > MAX_ENTRIES ? arr.slice(-MAX_ENTRIES) : arr
    localStorage.setItem(LS_KEY, JSON.stringify(tail))
  } catch {
    // ignore quota
  }
}

/** 长 URL / data URL 用短指纹，避免 localStorage 爆掉 */
export function mediaUrlFingerprint(url: string): string {
  const u = String(url || '')
  if (!u) return ''
  if (u.length <= 400) return u
  let h = 0
  const step = Math.max(1, Math.floor(u.length / 2000))
  for (let i = 0; i < u.length; i += step) h = (h * 33 + u.charCodeAt(i)) >>> 0
  return `${u.slice(0, 80)}|len:${u.length}|h:${h}`
}

export async function archiveAiMediaOnce(params: {
  url: string
  type: 'image' | 'video'
  name?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const url = String(params.url || '').trim()
  if (!url) return
  const fp = mediaUrlFingerprint(url)
  if (!fp) return
  const set = loadFpSet()
  if (set.has(fp)) return
  try {
    await createAssetAPI({
      source: 'ai_generated',
      type: params.type,
      url,
      name: params.name,
      metadata: params.metadata,
    })
    set.add(fp)
    saveFpSet(set)
  } catch (e) {
    console.error('[assets] archiveAiMediaOnce failed:', e)
  }
}
