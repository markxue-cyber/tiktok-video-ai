/**
 * AI 生成图/视频写入资产库时做指纹去重，避免「生成回调 + 历史同步」重复创建同一条资产。
 * 用户上传（user_upload）不走此逻辑。
 * 返回入库后的稳定 URL（服务端会将远程临时图镜像到 Supabase 公开存储）。
 */
import { createAssetAPI } from '../api/assets'

/** 资产库（App 内 Assets）监听此事件，AI 归档成功后立刻刷新列表 */
export const AI_ASSET_CREATED_EVENT = 'tikgen:ai-asset-created' as const

const LS_KEY = 'tikgen.archivedMediaFp.v1'
/** 原始地址指纹 → 入库后的永久公开 URL（与指纹表同步裁剪） */
const LS_PERM_URL_KEY = 'tikgen.archivedMediaPermUrl.v1'
const MAX_ENTRIES = 5000
const MAX_PERM_ENTRIES = 5000

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

function loadPermMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_PERM_URL_KEY)
    const o = raw ? JSON.parse(raw) : {}
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch {
    return {}
  }
}

function savePermMap(m: Record<string, string>) {
  try {
    const entries = Object.entries(m)
    const tail =
      entries.length > MAX_PERM_ENTRIES ? Object.fromEntries(entries.slice(-MAX_PERM_ENTRIES)) : m
    localStorage.setItem(LS_PERM_URL_KEY, JSON.stringify(tail))
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
}): Promise<string | null> {
  const url = String(params.url || '').trim()
  if (!url) return null
  /** 已是本库 Supabase 公开地址，无需再入库（避免历史同步重复创建资产） */
  if (/\/storage\/v1\/object\/public\/assets\//.test(url)) {
    return url
  }
  const fp = mediaUrlFingerprint(url)
  if (!fp) return null

  const permMap = loadPermMap()
  if (permMap[fp]) {
    return permMap[fp]
  }

  const set = loadFpSet()
  if (set.has(fp)) {
    return permMap[fp] || url
  }

  try {
    const data = await createAssetAPI({
      source: 'ai_generated',
      type: params.type,
      url,
      name: params.name,
      metadata: params.metadata,
    })
    const permanent = String(data?.asset?.url || '').trim() || url
    set.add(fp)
    saveFpSet(set)
    permMap[fp] = permanent
    savePermMap(permMap)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(AI_ASSET_CREATED_EVENT, { detail: { type: params.type } }),
      )
    }
    return permanent
  } catch (e) {
    console.error('[assets] archiveAiMediaOnce failed:', e)
    return null
  }
}
