import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
  Video,
  Image,
  Zap,
  LogOut,
  User,
  Play,
  Download,
  RefreshCw,
  Sparkles,
  X,
  Upload,
  Wand2,
  Folder,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  Check,
  Circle,
  Crown,
  WandSparkles,
  ShieldCheck,
  Library,
  Eye,
  EyeOff,
  MessageSquare,
  Bell,
  Info,
  Clock,
  Box,
  Maximize2,
  Pencil,
  ListTodo,
  Languages,
  Eraser,
  Clapperboard,
  Wrench,
  Minimize2,
  Trash2,
  LayoutGrid,
  Layers,
} from 'lucide-react'
import { checkVideoStatus, generateVideoAPI } from './api/video'
import {
  beautifyScript,
  generateImagePrompt,
  generateVideoScripts,
  imageScenePlan,
  imageWorkbenchAnalysis,
  parseProductInfo,
  polishImageGenPrompt,
  DEFAULT_PRODUCT_INFO,
  type ProductInfo,
} from './api/ai'
import {
  ECOMMERCE_COPY_LANGUAGES,
  ECOMMERCE_TARGET_MARKETS,
  ECOMMERCE_TARGET_PLATFORMS,
} from './config/ecommerceTargeting'
import { generateImageAPI } from './api/image'
import { applyImageStyleTags } from './api/imageStyle'
import { apiLogin, apiMe, apiRefresh, apiRegister, apiResendSignup, apiRecoverPassword, apiUpdatePassword } from './api/auth'
import { createOrder, getOrderStatus } from './api/payments'
import { createAssetAPI, deleteAssetAPI, listAssetsAPI, updateAssetAPI, type AssetItem } from './api/assets'
import { VideoUpscaleWorkbench } from './VideoUpscaleWorkbench'
import { AI_ASSET_CREATED_EVENT, archiveAiMediaOnce } from './utils/archiveAiMediaOnce'
import { listTasksAPI, type GenerationTaskItem } from './api/tasks'
import { getMonitoringStatsAPI, type MonitoringStats } from './api/monitoring'
import { getModelAvailabilityAPI } from './api/modelAvailability'
import {
  adminDeletePackageConfig,
  adminListAnnouncements,
  adminListModelControls,
  adminListPackageConfigs,
  adminListSupportTickets,
  adminListUsers,
  adminUpdateModelControl,
  adminUpdateSupportTicket,
  adminUpdateUser,
  adminUpsertAnnouncement,
  adminUpsertPackageConfig,
  type AdminSupportTicketItem,
  type AdminUserItem,
} from './api/admin'
import { listPackageConfigsPublic, type PackageConfigItem } from './api/packageConfigs'
import { listAnnouncementsPublic } from './api/announcements'
import { createSupportTicket, listMySupportTickets, type SupportTicketItem } from './api/support'
import { IMAGE_TEMPLATES, VIDEO_TEMPLATES, type ImageTemplatePreset, type VideoTemplatePreset } from './config/templates'
import { Sentry } from './sentry'
import {
  TIKGEN_IG_IDB,
  TIKGEN_IG_LS_BOARD,
  TIKGEN_IG_LS_BOARD_SIMPLE,
  TIKGEN_IG_LS_HISTORY,
  TIKGEN_IG_LS_HISTORY_SIMPLE,
  isLikelyPersistedImageUrl,
  loadSceneRunBoardFromLocalStorage,
  mergeImageGenHistorySnapshots,
  stripBoardForLocalStorage,
  stripHistoryForLocalStorage,
  tikgenIgIdbDelete,
  tikgenIgIdbGet,
  tikgenIgIdbSet,
  tryLocalStorageSetJson,
  type TikgenWorkspaceSnapshotV1,
  type VideoGeneratorWorkspaceV1,
} from './tikgenImageGenPersistence'
import './workbench-theme.css'
import { ImageToolWorkbench } from './ImageToolWorkbench'
import { RemoveBackgroundWorkbench } from './RemoveBackgroundWorkbench'
import { LandingV2 } from './LandingV2'
import { buildDownloadProxyUrl, triggerProxyDownload } from './utils/downloadProxy'

// 视频模型列表来自聚合API报错提示（会随账号权限变化而变化）
const VIDEO_MODELS = [
  { id: 'sora-2', name: 'Sora 2.0' },
  { id: 'sora-2-pro', name: 'Sora 2.0 Pro' },
  { id: 'sora-2-vip', name: 'Sora 2.0 VIP' },
  { id: 'sora_video2', name: 'Sora Video2' },
  { id: 'gpt-video-2', name: 'GPT Video 2' },
  { id: 'gpt-video-2-pro', name: 'GPT Video 2 Pro' },
  { id: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro' },
  { id: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro' },
  { id: 'veo3', name: 'Veo 3' },
  { id: 'veo3-fast', name: 'Veo 3 Fast' },
  { id: 'veo3-pro', name: 'Veo 3 Pro' },
  { id: 'veo2', name: 'Veo 2' },
  { id: 'veo2-fast', name: 'Veo 2 Fast' },
  { id: 'wan2.6-t2v', name: 'Wan 2.6 T2V' },
  { id: 'wan2.6-i2v', name: 'Wan 2.6 I2V' },
  { id: 'wan2.6-r2v', name: 'Wan 2.6 R2V' },
]

const VIDEO_ASPECT_OPTIONS = ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'] as const
const VIDEO_RES_OPTIONS = ['480p', '720p', '1080p', '1440p', '2160p'] as const // 2160p=4K
const VIDEO_DUR_OPTIONS = [4, 5, 6, 8, 10, 12, 15, 20, 30] as const

type VideoAspect = (typeof VIDEO_ASPECT_OPTIONS)[number]
type VideoRes = (typeof VIDEO_RES_OPTIONS)[number]
type VideoDur = (typeof VIDEO_DUR_OPTIONS)[number]

type VideoModelCaps = {
  aspectRatios: VideoAspect[]
  resolutions: VideoRes[]
  durations: VideoDur[]
  defaults: { aspectRatio: VideoAspect; resolution: VideoRes; durationSec: VideoDur }
}

// 不同模型对参数支持范围不同（后续可按聚合API返回进一步精细化）
const VIDEO_MODEL_CAPS: Record<string, VideoModelCaps> = {
  // Sora 系列：一般支持横竖屏 + 720/1080 + 10/15
  'sora-2': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
  'sora-2-pro': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '1080p', durationSec: 10 } },
  'sora-2-vip': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '1080p', durationSec: 10 } },
  'sora_video2': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },

  // GPT Video
  'gpt-video-2': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
  'gpt-video-2-pro': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '1080p', durationSec: 10 } },

  // Seedance
  'doubao-seedance-1-5-pro-251215': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
  'doubao-seedance-1-0-pro-250528': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: ['480p', '720p', '1080p'], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },

  // Veo
  'veo3': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '16:9', resolution: '1080p', durationSec: 10 } },
  'veo3-fast': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: ['480p', '720p', '1080p'], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '16:9', resolution: '720p', durationSec: 10 } },
  'veo3-pro': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: ['720p', '1080p', '1440p', '2160p'], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '16:9', resolution: '2160p', durationSec: 10 } },
  'veo2': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: [...VIDEO_RES_OPTIONS], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '16:9', resolution: '1080p', durationSec: 10 } },
  'veo2-fast': { aspectRatios: [...VIDEO_ASPECT_OPTIONS], resolutions: ['480p', '720p', '1080p'], durations: [...VIDEO_DUR_OPTIONS], defaults: { aspectRatio: '16:9', resolution: '720p', durationSec: 10 } },

  // Wan：通常更保守（先给 720p + 10s 默认；仍允许 15s 以便用户试）
  'wan2.6-t2v': { aspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4'], resolutions: ['480p', '720p', '1080p'], durations: [4, 5, 6, 8, 10, 12, 15], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
  'wan2.6-i2v': { aspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4'], resolutions: ['480p', '720p', '1080p'], durations: [4, 5, 6, 8, 10, 12, 15], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
  'wan2.6-r2v': { aspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4'], resolutions: ['480p', '720p', '1080p'], durations: [4, 5, 6, 8, 10, 12, 15], defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 } },
}
// 图片模型列表：先覆盖聚合端常见可用项（可按账号权限增减）
const IMAGE_MODELS = [
  { id: 'nano-banana-2', name: 'Nano Banana 2' },
  { id: 'seedream', name: 'Seedream 4.5' },
  { id: 'seedream-4.5', name: 'Seedream 4.5 (Alt)' },
  { id: 'flux', name: 'FLUX' },
  { id: 'flux-dev', name: 'FLUX Dev' },
  { id: 'flux-pro', name: 'FLUX Pro' },
  { id: 'sdxl', name: 'SDXL' },
  { id: 'dalle-3', name: 'DALL·E 3' },
  { id: 'midjourney', name: 'Midjourney' },
]

const TEMP_UNAVAILABLE_IMAGE_MODEL_RULES: Array<{ test: RegExp; reason: string }> = [{ test: /midjourney|^mj_/i, reason: '当前通道暂不可用' }]

function getImageModelUnavailableReason(id: string): string {
  const s = String(id || '')
  for (const r of TEMP_UNAVAILABLE_IMAGE_MODEL_RULES) {
    if (r.test.test(s)) return r.reason
  }
  return ''
}

const IMAGE_GEN_HISTORY_MAX = 100

type ImageGenHistoryTask = {
  id: string
  ts: number
  refThumb: string
  /** 商品名称（大字展示）；旧存档可能为空 */
  productName?: string
  prompt: string
  modelId: string
  modelLabel: string
  aspect: string
  resolutionLabel: string
  requestedCount: number
  /** active：进行中；完成后为 completed / failed */
  status: 'active' | 'completed' | 'failed'
  outputUrls: string[]
  /** 多场景批量出图时各张对应的场景标题 */
  sceneLabels?: string[]
  /** 与各 outputUrls 对齐的短说明（旧存档；新记录优先用 sceneDescriptions 悬停展示） */
  sceneTeasers?: string[]
  /** 与各 outputUrls 对齐的完整场景说明（description + imagePrompt），悬停场景名展示 */
  sceneDescriptions?: string[]
  /** 活跃任务实时槽位快照：用于历史卡展示「生成中」动效，不因切到新任务而消失 */
  sceneSlots?: Array<{
    title: string
    status: 'pending' | 'generating' | 'done' | 'failed'
    imageUrl?: string
    error?: string
    description?: string
    imagePrompt?: string
  }>
  errorMessage?: string
  /** 顶部提示条用的简短分类，避免对用户展示 UNKNOWN */
  errorHintCode?: string
}

function loadImageGenHistoryFromStorage(lsKey: string = TIKGEN_IG_LS_HISTORY): ImageGenHistoryTask[] {
  try {
    const raw = localStorage.getItem(lsKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x: any) => x && typeof x.id === 'string' && typeof x.ts === 'number')
      .map((t: any) => ({
        ...t,
        status:
          t.status === 'active' || t.status === 'failed' || t.status === 'completed'
            ? t.status
            : 'completed',
      }))
      .slice(0, IMAGE_GEN_HISTORY_MAX) as ImageGenHistoryTask[]
  } catch {
    return []
  }
}

type ImageSceneRow = {
  key: string
  title: string
  description: string
  imagePrompt: string
  selected: boolean
}

type ImageWorkbenchStyleRow = {
  title: string
  description: string
  imagePrompt?: string
  /** 用户「自定义方案」卡片 */
  isCustom?: boolean
}

type SceneRunSlot = {
  key: string
  title: string
  description: string
  imagePrompt: string
  /** 是否参与批量出图，默认 true */
  selected: boolean
  status: 'pending' | 'generating' | 'done' | 'failed'
  imageUrl?: string
  error?: string
}

type SceneRunBoard = {
  id: string
  ts: number
  refThumb: string
  basePrompt: string
  slots: SceneRunSlot[]
}

/** 是否允许点「一键生成图片」：已选中里仍有 pending / failed 即可（可与其它槽并发生成中） */
function sceneBoardAllowsBatchGenerate(board: SceneRunBoard | null): boolean {
  if (!board) return false
  const sel = board.slots.filter((s) => s.selected)
  return sel.length > 0
}

/** 删除主参考/放弃看板时：把进行中的槽视为未出图，便于历史记为「已完成」且只展示已出好的图 */
function sceneBoardForgetInflightSlots(board: SceneRunBoard): SceneRunBoard {
  return {
    ...board,
    slots: board.slots.map((s) =>
      s.status === 'generating'
        ? { ...s, status: 'pending' as const, error: undefined, imageUrl: undefined }
        : s,
    ),
  }
}

type SceneSlotGenResult =
  | { slotIndex: number; ok: true; imageUrl: string }
  | { slotIndex: number; ok: false; error: string }

const IMAGE_SCENE_BLUEPRINT = [
  { key: 'commercial_white', title: '商业白底主图' },
  { key: 'selling_focus', title: '卖点聚焦图' },
  { key: 'lifestyle', title: '场景生活图' },
  { key: 'comparison', title: '对比/效果图' },
  { key: 'detail', title: '产品细节图' },
  { key: 'atmosphere', title: '氛围创意图' },
] as const

/**
 * 单槽出图时追加在提示词末尾：爆款风格（主描述）与「当前场景格」在背景/环境上冲突时，
 * 明确以本格为最高优先级（避免例如：风格写深色工业风 + 白底主图格 → 生成黑底怪图）。
 */
function sceneSlotPromptPrioritySuffix(slotKey: string): string {
  switch (slotKey) {
    case 'commercial_white':
      return [
        '',
        '【场景优先级·最高｜商业白底主图】',
        '本张背景必须为纯白或极浅灰的无缝电商棚拍底（接近 #FFFFFF），柔光箱均匀布光，无生硬暗角条带。',
        '若上文「爆款风格/出图主描述」含深色全图背景、黑色/夜景、工业水泥墙、重色渐变底等，仅可保留为「商品材质、对比与布光气质」的参考，不得把整张图做成深色底、黑底、或黑场反白边的非标准主图。',
        '禁止：整体黑底/大面积深灰环境墙作为主背景。',
      ].join('\n')
    case 'lifestyle':
      return [
        '',
        '【场景优先级·最高｜场景生活图】',
        '本张需要可感知的生活/使用环境（背景可虚化）。若上文强调「仅白底/无环境」，以本条生活场景为准，商品主体仍须清晰、适合电商投放。',
        '若商品为服装/可穿戴类且用真人展示穿搭：采用中景或半身取景，人物须包含完整头部（正面/侧面/背面均可，头顶与发际线须在画内），禁止裁到肩线以上、无头顶的「无头」构图；可略远距离或背部展示以弱化面部细节，但不得断头式裁切。',
      ].join('\n')
    case 'atmosphere':
      return [
        '',
        '【场景优先级·最高｜氛围创意图】',
        '本张允许较强氛围光、冷暖对比或情绪光。若上文写死「极简白底」，仅适用于其它格子；本张以氛围表现为准，商品须仍可识别。',
        '若画面含真人穿着/使用商品：须保留完整头颈肩关系，禁止无头裁切（同场景生活图的人像构图规范）。',
      ].join('\n')
    case 'selling_focus':
    case 'detail':
      return [
        '',
        '【场景优先级】本张为特写/细节：背景须干净虚化或极简棚拍，以大场景环境描写抢戏为次；主体细节最优先。',
      ].join('\n')
    case 'comparison':
      return [
        '',
        '【场景优先级】本张为对比/效果向构图：若上文背景描写与对比布局冲突，以本条对比构图与信息层级为准。',
      ].join('\n')
    default:
      return ''
  }
}

/** 主描述（DNA）与场景增量之间的桥接说明，减少模型把两层当互斥指令 */
const PROMPT_DNA_SCENE_BRIDGE = [
  '',
  '【叠提示策略】上文为爆款主描述（DNA：材质、惯用光型、色调气质、主体与清晰度标准）。以下「当前生成场景」为本张增量；背景/环境/景别以本段及文末「场景优先级」为准。DNA 的气质应落实到商品本体的布光与材质上，勿与本格背景合同对打。',
  '',
].join('\n')

/** 合并主描述与场景格文案，并追加冲突消解后缀 */
function mergeScenePromptForSlot(
  basePrompt: string,
  slot: Pick<SceneRunSlot, 'key' | 'title' | 'description' | 'imagePrompt'>,
) {
  const extra = [slot.imagePrompt, slot.description].filter(Boolean).join('\n')
  const tail = sceneSlotPromptPrioritySuffix(slot.key)
  return `${basePrompt.trim()}${PROMPT_DNA_SCENE_BRIDGE}【当前生成场景：${slot.title}】\n${extra}${tail}`.trim()
}

function imageHistoryDayKey(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function imageHistoryRelativeZh(ts: number) {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 55) return '刚刚'
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))} 分钟前`
  if (sec < 86400) return `${Math.max(1, Math.floor(sec / 3600))} 小时前`
  if (sec < 86400 * 7) return `${Math.max(1, Math.floor(sec / 86400))} 天前`
  return imageHistoryDayKey(ts)
}

function groupImageHistoryByDay(tasks: ImageGenHistoryTask[]) {
  const sorted = [...tasks].sort((a, b) => b.ts - a.ts)
  const order: string[] = []
  const seen = new Set<string>()
  const byDay: Record<string, ImageGenHistoryTask[]> = {}
  for (const t of sorted) {
    const k = imageHistoryDayKey(t.ts)
    if (!seen.has(k)) {
      seen.add(k)
      order.push(k)
    }
    if (!byDay[k]) byDay[k] = []
    byDay[k].push(t)
  }
  return order.map((day) => ({ day, tasks: byDay[day] }))
}

/** 生成历史场景名：去掉全角/半角括号及其中内容；括号内文案收集后用于悬停浮层 */
function splitSceneHistoryTitleForDisplay(raw: string): { display: string; parenHints: string } {
  const s = String(raw || '').trim()
  if (!s) return { display: '', parenHints: '' }
  const inner: string[] = []
  const re = /[（(]([^)）]*)[)）]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const g = String(m[1] || '').trim()
    if (g) inner.push(g)
  }
  const display = s.replace(/[（(][^)）]*[)）]/g, ' ').replace(/\s+/g, ' ').trim()
  return { display, parenHints: inner.join('；') }
}

/** 从商品分析笔记中解析「产品名称」等行，供历史卡片标题等兜底 */
function extractProductNameFromAnalysisNotes(text: string): string {
  const lines = String(text || '').split(/\n/)
  const patterns = [
    /^产品名称\s*[：:]\s*(.+)$/,
    /^商品名称\s*[：:]\s*(.+)$/,
    /^品名\s*[：:]\s*(.+)$/,
    /^名称\s*[：:]\s*(.+)$/,
    /^Product\s*name\s*[：:]\s*(.+)$/i,
  ]
  for (const line of lines) {
    const t = line.trim()
    for (const re of patterns) {
      const m = t.match(re)
      if (m) {
        const v = String(m[1] || '').trim()
        if (v && v !== '未知' && v !== '未标注') return v
      }
    }
  }
  return ''
}

/** 商品分析：不展示值为「未知」「未标注」的行 */
function filterProductAnalysisText(raw: string): string {
  const lines = String(raw || '').split(/\n/)
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    const m = t.match(/^([^：:]+)\s*[：:]\s*(.*)$/)
    if (m) {
      const v = String(m[2] || '').trim()
      if (v === '未知' || v === '未标注') continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/** 一键分析：商品分析区渐进展示（长行再拆段，观感更丝滑） */
function buildProductAnalysisRevealSteps(full: string): string[] {
  const s = String(full || '')
  if (!s.trim()) return ['']
  const lines = s.split('\n')
  const expanded: string[] = []
  const maxChunk = 48

  const chunkLongLine = (line: string) => {
    let rest = line
    while (rest.length > 0) {
      if (rest.length <= maxChunk) {
        expanded.push(rest)
        break
      }
      let cut = maxChunk
      const windowEnd = Math.min(rest.length, maxChunk + 14)
      const slice = rest.slice(0, windowEnd)
      const punct = Math.max(
        slice.lastIndexOf('、'),
        slice.lastIndexOf('，'),
        slice.lastIndexOf('；'),
        slice.lastIndexOf(' '),
        slice.lastIndexOf('　'),
      )
      if (punct > Math.floor(maxChunk * 0.45)) cut = punct + 1
      expanded.push(rest.slice(0, cut))
      rest = rest.slice(cut).replace(/^[、，；\s　]+/, '')
    }
  }

  for (const line of lines) {
    if (!line.trim()) {
      expanded.push('')
      continue
    }
    if (line.length <= maxChunk + 8) expanded.push(line)
    else chunkLongLine(line)
  }

  if (expanded.length === 0) return ['']
  const steps: string[] = []
  for (let i = 1; i <= expanded.length; i += 1) {
    steps.push(expanded.slice(0, i).join('\n'))
  }
  return steps
}

/** 爆款风格卡片外露文案：约 4 行内（超出由 line-clamp 截断） */
function styleCardSummary(text: string, maxChars = 220): string {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length <= maxChars) return s
  return s.slice(0, maxChars)
}

/** 卡片列表里展示的摘要：自定义方案以用户输入（出图主描述）为准，其余优先短说明 */
function hotStyleCardPreviewText(st: { isCustom?: boolean; description?: string; imagePrompt?: string }): string {
  if (st.isCustom) return String(st.imagePrompt || st.description || '').trim()
  return String(st.description || '').trim() || String(st.imagePrompt || '').trim()
}

/** 收集爆款风格网格内其它卡片矩形（不含当前悬停卡片），用于浮层避让 */
function getHotStyleSchemeObstacleRects(grid: HTMLElement | null, anchor: HTMLElement | null): DOMRect[] {
  if (!grid || !anchor) return []
  return Array.from(grid.querySelectorAll<HTMLElement>('[data-hot-style-scheme-card]'))
    .filter((el) => el !== anchor)
    .map((el) => el.getBoundingClientRect())
}

function normalizePopBox(
  rawLeft: number,
  rawTop: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): { left: number; top: number; width: number } {
  return {
    left: Math.max(8, Math.min(rawLeft, vw - w - 8)),
    top: Math.max(8, Math.min(rawTop, vh - h - 8)),
    width: w,
  }
}

function popoverOverlapsAnyObstacle(
  left: number,
  top: number,
  w: number,
  h: number,
  obstacles: DOMRect[],
  pad: number,
): boolean {
  const right = left + w
  const bottom = top + h
  for (const o of obstacles) {
    if (left < o.right + pad && right > o.left - pad && top < o.bottom + pad && bottom > o.top - pad) return true
  }
  return false
}

/**
 * 出图主描述悬停浮层：贴在卡片外侧，避让其它爆款风格卡片（含下一行、相邻列），避免挡点击。
 */
function computeWorkbenchStylePromptPopoverPosition(
  cardRect: DOMRect,
  otherCardRects: DOMRect[],
): { top: number; left: number; width: number } {
  const GAP = 10
  const PAD = 2
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const w = Math.max(176, Math.min(cardRect.width * 0.45, 320))
  const estH = Math.min(288, vh * 0.55)
  /** 含当前卡片：浮层不可压在任何方案卡片上（含自己与其它格、下一行） */
  const blockers = [...otherCardRects, cardRect]

  const tryBox = (rawLeft: number, rawTop: number) => {
    const p = normalizePopBox(rawLeft, rawTop, w, estH, vw, vh)
    if (popoverOverlapsAnyObstacle(p.left, p.top, w, estH, blockers, PAD)) return null
    return p
  }

  const attempts: Array<[number, number]> = [
    [cardRect.right + GAP, cardRect.top + 2],
    [cardRect.left - w - GAP, cardRect.top + 2],
    [Math.max(8, cardRect.right - w), cardRect.top - estH - GAP],
    [Math.max(8, cardRect.left), cardRect.top - estH - GAP],
    [cardRect.left + (cardRect.width - w) / 2, cardRect.bottom + GAP],
    [vw - w - 8, cardRect.top + 2],
    [8, cardRect.top + 2],
  ]

  for (const [lx, ty] of attempts) {
    const r = tryBox(lx, ty)
    if (r) return r
  }

  for (let dy = -280; dy <= 280; dy += 10) {
    const top = cardRect.top + 2 + dy
    for (const left of [cardRect.right + GAP, cardRect.left - w - GAP]) {
      const r = tryBox(left, top)
      if (r) return r
    }
  }

  return normalizePopBox(cardRect.right + GAP, cardRect.top + 2, w, estH, vw, vh)
}

/** 生成历史等窄卡片用的一行级摘要 */
function styleCardTeaser(text: string, maxChars = 40): string {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length <= maxChars) return s
  return s.slice(0, maxChars)
}

/** 旧版 API 不足 4 条时曾用「请上传图」补齐；已传图用户会误解，收到后统一替换 */
function sanitizeWorkbenchStylesFromApi<T extends { title: string; description: string; imagePrompt?: string }>(
  styles: T[],
): T[] {
  const legacyNeedle = '请上传清晰的商品主参考图后重新分析，以生成更贴合类目的风格建议'
  const descFallback =
    '偏电商主图向的备选构图与光感，强调主体清晰与背景层次，可在编辑中按卖点继续细化。'
  const promptSnippet = '背景简洁、光影干净，突出商品材质与轮廓，适合主图与投放延展。'
  const legacyPattern = /请上传清晰的商品主参考图后重新分析，以生成更贴合类目的风格建议。?/g
  return styles.map((s) => {
    let description = String(s.description || '').trim()
    let imagePrompt = String(s.imagePrompt || '').trim()
    if (description.includes(legacyNeedle)) description = descFallback
    if (imagePrompt.includes(legacyNeedle)) imagePrompt = imagePrompt.replace(legacyPattern, promptSnippet)
    return { ...s, description, imagePrompt }
  })
}

const SCENE_TAG_CLASS =
  'inline-flex max-w-full items-center rounded-full border border-white/12 bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-white/95 shadow-sm backdrop-blur-sm'

/** 生成历史结果卡片：场景名（无椭圆标签底，居中、略大） */
const IMAGE_HISTORY_SCENE_TITLE_CLASS =
  'block w-full text-center text-[13px] sm:text-sm font-semibold leading-snug tracking-wide text-violet-100/95 drop-shadow-[0_1px_8px_rgba(139,92,246,0.25)] line-clamp-2 break-words'

/** 场景占位：SVG 噪点贴图，叠在强模糊层上模拟胶片颗粒、减轻「纯 CSS 渐变」塑料感 */
const SCENE_SLOT_PLACEHOLDER_GRAIN_TILE =
  'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 512 512\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\' x=\'-20%25\' y=\'-20%25\' width=\'140%25\' height=\'140%25\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.72\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3CfeColorMatrix type=\'saturate\' values=\'0\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.55\'/%3E%3C/svg%3E")'

const IMAGE_ASPECT_OPTIONS = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'] as const
const IMAGE_RES_OPTIONS = ['1024', '1536', '2048', '4096'] as const // 通用档位（部分模型会映射到2k/4k）

type ImageAspect = (typeof IMAGE_ASPECT_OPTIONS)[number]
type ImageRes = (typeof IMAGE_RES_OPTIONS)[number]

const IMAGE_GEN_HISTORY_PLAN_LABEL = '爆款风格：'
/** 旧版生成历史正文前缀，展示时统一换成爆款风格： */
const IMAGE_GEN_HISTORY_PLAN_LABEL_LEGACY = '画面方案：'

/** 生成历史列表/悬停全文：分隔线后为爆款风格说明，统一带「爆款风格：」前缀（兼容旧「画面方案：」与无前缀） */
function formatImageGenHistoryPromptDisplay(prompt: string): string {
  const p = String(prompt || '')
  const sep = '\n────────\n'
  const idx = p.indexOf(sep)
  if (idx < 0) return p || '（无提示词）'
  const head = p.slice(0, idx + sep.length)
  let body = p.slice(idx + sep.length)
  if (body.startsWith(IMAGE_GEN_HISTORY_PLAN_LABEL_LEGACY)) {
    body = IMAGE_GEN_HISTORY_PLAN_LABEL + body.slice(IMAGE_GEN_HISTORY_PLAN_LABEL_LEGACY.length)
  } else if (body.startsWith('提示词：')) {
    /* 图片生成（简版）存档：保留「提示词：」前缀，勿改成爆款风格 */
  } else if (body && !body.startsWith(IMAGE_GEN_HISTORY_PLAN_LABEL)) {
    body = IMAGE_GEN_HISTORY_PLAN_LABEL + body
  }
  return head + body
}

type SceneFailureKind = 'quota' | 'payment' | 'cancelled' | 'other'

function classifySceneSlotError(err: string): SceneFailureKind {
  const e = String(err || '')
  if (/今日额度|额度已用尽|quota/i.test(e)) return 'quota'
  if (/请先完成本产品内|付费订单|PAYMENT_REQUIRED/i.test(e)) return 'payment'
  if (/已取消|已中断|abort/i.test(e)) return 'cancelled'
  return 'other'
}

function summarizeSceneBatchFailures(
  failedSelected: { title: string; error?: string }[],
  mode: { type: 'all_failed' } | { type: 'partial'; successCount: number },
): { text: string; code: string } {
  if (!failedSelected.length) return { text: '', code: 'UNKNOWN' }
  if (failedSelected.length === 1) {
    const s = failedSelected[0]
    const err = String(s.error || '失败')
    const k = classifySceneSlotError(err)
    const code =
      k === 'quota' ? 'QUOTA_EXHAUSTED' : k === 'payment' ? 'PAYMENT_REQUIRED' : k === 'cancelled' ? 'CANCELLED' : 'UNKNOWN'
    return { text: `${s.title}：${err}`, code }
  }

  const counts: Record<SceneFailureKind, number> = { quota: 0, payment: 0, cancelled: 0, other: 0 }
  for (const s of failedSelected) {
    counts[classifySceneSlotError(String(s.error || ''))]++
  }

  const parts: string[] = []
  if (counts.quota) parts.push(`今日额度已用尽（${counts.quota} 张），可升级套餐或次日再试`)
  if (counts.payment) parts.push(`需先完成本产品内付费（${counts.payment} 张），请前往套餐页购买`)
  if (counts.cancelled) parts.push(`任务已中断（${counts.cancelled} 张），请留在本页后重试`)
  if (counts.other) parts.push(`生成失败（${counts.other} 张），请稍后重试`)

  const nonZeroKinds = (['quota', 'payment', 'cancelled', 'other'] as const).filter((x) => counts[x] > 0)
  const code =
    nonZeroKinds.length === 1
      ? nonZeroKinds[0] === 'quota'
        ? 'QUOTA_EXHAUSTED'
        : nonZeroKinds[0] === 'payment'
          ? 'PAYMENT_REQUIRED'
          : nonZeroKinds[0] === 'cancelled'
            ? 'CANCELLED'
            : 'UNKNOWN'
      : 'PARTIAL'

  const n = failedSelected.length
  if (mode.type === 'all_failed') {
    return {
      text: `本次共 ${n} 张未生成。${parts.join('；')}。`,
      code,
    }
  }
  return {
    text: `已生成 ${mode.successCount} 张；另有 ${n} 张未成功：${parts.join('；')}。`,
    code,
  }
}

/** 由当前场景看板同步到「生成历史」的一条记录（支持进行中 / 增量更新） */
function buildHistoryTaskFromSceneBoard(
  board: SceneRunBoard,
  modelId: string,
  modelLabel: string,
  aspect: ImageAspect,
  resolutionLabel: string,
  productName?: string,
  productAnalysisNotes?: string,
  /** 图片生成（简版）：历史文案用「提示词」而非「爆款风格」 */
  simpleHistory?: boolean,
): ImageGenHistoryTask {
  const slots = board.slots
  const selected = slots.filter((s) => s.selected)
  const anySelected = selected.length > 0
  const doneSlots = selected.filter((s) => s.status === 'done' && s.imageUrl)
  const failedSelected = selected.filter((s) => s.status === 'failed')
  const generating = selected.some((s) => s.status === 'generating')

  const outputUrls = doneSlots.map((s) => s.imageUrl!)
  const sceneLabels = doneSlots.map((s) => s.title)
  const sceneTeasers = doneSlots.map((s) =>
    styleCardTeaser((s.description || s.imagePrompt || '').replace(/\s+/g, ' ').trim(), 42),
  )
  const sceneDescriptions = doneSlots.map((s) => {
    const d = String(s.description || '').trim()
    const ip = String(s.imagePrompt || '').trim()
    if (d && ip) return `${d}\n\n${ip}`
    return d || ip || ''
  })

  const basePrompt = board.basePrompt || ''
  const planLabel = simpleHistory ? '提示词：' : IMAGE_GEN_HISTORY_PLAN_LABEL
  const basePromptStored = basePrompt ? `${planLabel}${basePrompt.slice(0, 2000)}` : ''
  const titlesLead = simpleHistory ? '镜头方案：' : '多场景：'
  const titlesLine = (anySelected ? selected : slots).map((s) => s.title).join('、')

  /** 仅当有槽位正在请求出图时为 active；全为 pending 属于「仅预览方案」，不记入生成历史 */
  let status: 'active' | 'completed' | 'failed'
  if (!anySelected) {
    status = 'completed'
  } else if (generating) {
    status = 'active'
  } else if (!outputUrls.length && failedSelected.length) {
    status = 'failed'
  } else {
    status = 'completed'
  }

  let errorMessage: string | undefined
  let errorHintCode: string | undefined
  if (status === 'failed' && failedSelected.length) {
    const f = summarizeSceneBatchFailures(failedSelected, { type: 'all_failed' })
    errorMessage = f.text
    errorHintCode = f.code
  } else if (status === 'completed' && failedSelected.length) {
    const f = summarizeSceneBatchFailures(failedSelected, { type: 'partial', successCount: doneSlots.length })
    errorMessage = f.text
    errorHintCode = f.code
  }

  const pn =
    String(productName || '').trim() ||
    extractProductNameFromAnalysisNotes(String(productAnalysisNotes || ''))
  return {
    id: board.id,
    ts: board.ts,
    refThumb: board.refThumb,
    ...(pn ? { productName: pn } : {}),
    prompt: `${titlesLead}${titlesLine}\n────────\n${basePromptStored}`,
    modelId,
    modelLabel,
    aspect,
    resolutionLabel,
    requestedCount: selected.length,
    status,
    outputUrls,
    sceneLabels,
    sceneTeasers,
    sceneDescriptions,
    sceneSlots: selected.map((s) => ({
      title: s.title,
      status: s.status,
      imageUrl: s.imageUrl,
      error: s.error,
      description: s.description,
      imagePrompt: s.imagePrompt,
    })),
    errorMessage,
    errorHintCode,
  }
}

type ImageModelCaps = {
  aspectRatios: ImageAspect[]
  resolutions: ImageRes[]
  defaults: { aspectRatio: ImageAspect; resolution: ImageRes }
}

const IMAGE_MODEL_CAPS: Record<string, ImageModelCaps> = {
  'nano-banana-2': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['2048', '4096'], defaults: { aspectRatio: '1:1', resolution: '2048' } },
  seedream: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['2048', '4096'], defaults: { aspectRatio: '1:1', resolution: '2048' } },
  'seedream-4.5': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['2048', '4096'], defaults: { aspectRatio: '1:1', resolution: '2048' } },
  flux: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536', '2048'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  'flux-dev': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  'flux-pro': { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536', '2048'], defaults: { aspectRatio: '1:1', resolution: '1536' } },
  sdxl: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '1536'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  'dalle-3': { aspectRatios: ['1:1', '9:16', '16:9'], resolutions: ['1024', '2048'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
  midjourney: { aspectRatios: [...IMAGE_ASPECT_OPTIONS], resolutions: ['1024', '2048'], defaults: { aspectRatio: '1:1', resolution: '1024' } },
}
const DEFAULT_PACKAGES: PackageConfigItem[] = [
  { plan_id: 'trial', name: '试用版', price_cents: 0, currency: 'CNY', daily_quota: 3, features: ['每天3次', '基础功能'], enabled: true, display_order: 10, apply_mode: 'new_only', grace_days: 0 },
  { plan_id: 'basic', name: '基础版', price_cents: 6900, currency: 'CNY', daily_quota: 20, features: ['每天20次', '全部模型'], enabled: true, display_order: 20, apply_mode: 'new_only', grace_days: 0 },
  { plan_id: 'pro', name: '专业版', price_cents: 24900, currency: 'CNY', daily_quota: 999999, features: ['高配额', '4K输出'], enabled: true, display_order: 30, apply_mode: 'new_only', grace_days: 0 },
  { plan_id: 'enterprise', name: '旗舰版', price_cents: 119900, currency: 'CNY', daily_quota: 999999, features: ['企业级', 'API接入'], enabled: true, display_order: 40, apply_mode: 'new_only', grace_days: 0 },
]

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function guessAssetType(file: File): 'image' | 'video' {
  return String(file.type || '').startsWith('video/') ? 'video' : 'image'
}

async function safeArchiveAsset(params: {
  source: 'user_upload' | 'ai_generated'
  type: 'image' | 'video'
  url: string
  name?: string
  metadata?: any
}): Promise<string | null> {
  try {
    if (!params.url) return null
    if (params.source === 'ai_generated') {
      return await archiveAiMediaOnce({
        url: params.url,
        type: params.type,
        name: params.name,
        metadata: params.metadata,
      })
    }
    const data = await createAssetAPI(params)
    return String(data?.asset?.url || params.url || '').trim() || null
  } catch (e) {
    // Never block core generation/upload UX due to archive write failure.
    // Keep a trace for debugging when user reports missing assets.
    console.error('[assets] archive failed:', e)
    return null
  }
}

function GenerationLoadingCard({
  title,
  subtitle,
  chips,
  statusText,
  progressText,
}: {
  title: string
  subtitle: string
  chips?: readonly string[]
  statusText?: string
  progressText?: string
}) {
  return (
    <div className="h-96 rounded-xl border border-white/10 bg-[linear-gradient(180deg,#080a14,#03040a)] px-6 text-center flex flex-col items-center justify-center">
      <div className="relative w-[88px] h-[88px] mb-3">
        <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-purple-400 animate-spin" />
        <div className="absolute inset-[14px] rounded-full border-[3px] border-transparent border-r-cyan-300 [animation:spin_1s_linear_infinite_reverse]" />
      </div>
      <h3 className="text-[28px] leading-none font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-white/70">{subtitle}</p>
      {Array.isArray(chips) && chips.length > 0 ? (
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          {chips.map((chip) => (
            <span key={chip} className="px-2.5 py-1 rounded-full text-xs border border-white/15 bg-white/5 text-white/80">
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      {statusText ? <p className="mt-4 text-sm text-white/75">{statusText}</p> : null}
      {progressText ? <p className="mt-1 text-xs text-white/55">{progressText}</p> : null}
    </div>
  )
}

const LOADING_COPY = {
  tech: {
    image: {
      title: '电商套图生成中',
      subtitle: '正在进行多阶段渲染与细节增强，请稍等片刻...',
      chips: ['构图', '光影', '质检'],
    },
    video: {
      title: '视频生成中',
      subtitle: '正在计算运镜轨迹与画面细节，请稍等片刻...',
      chips: ['构图', '运镜', '质检'],
    },
  },
  premium: {
    image: {
      title: '电商套图生成中',
      subtitle: '高品质画面正在精修中，请稍候...',
      chips: ['构图美学', '光影层次', '品质校验'],
    },
    video: {
      title: '视频生成中',
      subtitle: '高阶视觉表达正在生成中，请稍候...',
      chips: ['镜头语言', '节奏质感', '品质校验'],
    },
  },
} as const

const ACTIVE_LOADING_COPY_STYLE: keyof typeof LOADING_COPY = 'tech'

const ASSETS_CACHE_KEY = 'tikgen.assets.cache.v1'
let assetsMemoryCache: {
  userUploads: AssetItem[]
  aiOutputs: AssetItem[]
  userOffset: number
  aiOffset: number
  userHasMore: boolean
  aiHasMore: boolean
  ts: number
} | null = null
let assetsPrefetching = false
let assetsPrefetchAt = 0
let assetsWarmupDoneForToken = ''
const SESSION_KEY = 'tikgen.session'
const SUPPORT_TICKET_ENABLED = false
/** 设为 true 可恢复侧栏「模板库」入口与页面 */
const TEMPLATES_LIBRARY_ENABLED = false

function parseSessionFromUrl(): null | {
  access_token: string
  refresh_token?: string
  expires_at?: number
  token_type?: string
  type?: string
} {
  try {
    if (typeof window === 'undefined') return null
    const grab = (raw: string) => {
      const cleaned = raw.startsWith('#') ? raw.slice(1) : raw
      const sp = new URLSearchParams(cleaned)
      const access_token = String(sp.get('access_token') || '')
      const refresh_token = String(sp.get('refresh_token') || '')
      const type = String(sp.get('type') || '')
      if (!access_token) return null
      // Some password recovery reset links may omit refresh_token.
      if (type === 'recovery') {
        // For recovery flows we only need access_token to call our update endpoint.
        if (!access_token) return null
      } else {
        // For other flows, keep the previous requirement.
        if (!refresh_token) return null
      }
      const expires_at = sp.get('expires_at') ? Number(sp.get('expires_at')) : undefined
      const token_type = String(sp.get('token_type') || '')
      return {
        access_token,
        refresh_token: type === 'recovery' ? refresh_token || undefined : refresh_token,
        expires_at: Number.isFinite(expires_at as any) ? expires_at : undefined,
        token_type: token_type || undefined,
        type: type || undefined,
      }
    }

    const hash = String(window.location.hash || '')
    if (hash) {
      const fromHash = grab(hash)
      if (fromHash) return fromHash
    }

    const search = String(window.location.search || '')
    if (search) {
      const cleaned = search.startsWith('?') ? search.slice(1) : search
      const fromSearch = grab(cleaned)
      if (fromSearch) return fromSearch
    }

    return null
  } catch {
    return null
  }
}

async function prefetchAssetsCacheIfNeeded() {
  if (assetsPrefetching) return
  const now = Date.now()
  // Avoid repeated prefetches when user hovers repeatedly.
  if (now - assetsPrefetchAt < 15000) return
  // Fresh enough cache, skip prefetch.
  if (assetsMemoryCache && now - Number(assetsMemoryCache.ts || 0) < 30000) return
  if (!localStorage.getItem('tikgen.accessToken')) return
  assetsPrefetching = true
  try {
    const [u, a] = await Promise.all([
      listAssetsAPI({ source: 'user_upload', limit: 12, offset: 0 }),
      listAssetsAPI({ source: 'ai_generated', limit: 12, offset: 0 }),
    ])
    const payload = {
      userUploads: Array.isArray(u.assets) ? u.assets : [],
      aiOutputs: Array.isArray(a.assets) ? a.assets : [],
      userOffset: Number(u.nextOffset ?? (u.assets?.length || 0)),
      aiOffset: Number(a.nextOffset ?? (a.assets?.length || 0)),
      userHasMore: Boolean(u.hasMore),
      aiHasMore: Boolean(a.hasMore),
      ts: Date.now(),
    }
    assetsMemoryCache = payload
    try {
      localStorage.setItem(ASSETS_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // ignore cache write errors
    }
  } catch {
    // ignore prefetch errors, do not block navigation
  } finally {
    assetsPrefetchAt = Date.now()
    assetsPrefetching = false
  }
}

/** 图片创作二级：图片生成（简版）/ 电商套图 / 图片工具 */
type ImageSubNavId = 'imageGen' | 'ecommerce' | 'tools'

/** 图片工具三级 Tab（侧栏 flyout、URL workspace=、工作台子导航共用） */
type ImageToolsTabId = 'removeBg' | 'upscale' | 'translate' | 'compress'
/** 视频创作二级：生成 / 增强（workspace: video.generate | video.upscale） */
type VideoSubNavId = 'generate' | 'upscale'

const IMAGE_TOOLS_TAB_ITEMS: { id: ImageToolsTabId; label: string; icon: ReactNode }[] = [
  { id: 'removeBg', label: '去除背景', icon: <Eraser className="w-4 h-4 shrink-0" /> },
  { id: 'upscale', label: '高清放大', icon: <Maximize2 className="w-4 h-4 shrink-0" /> },
  { id: 'compress', label: '图片压缩', icon: <Minimize2 className="w-4 h-4 shrink-0" /> },
  { id: 'translate', label: '图片翻译', icon: <Languages className="w-4 h-4 shrink-0" /> },
]

const FIRST_IMAGE_TOOL_TAB: ImageToolsTabId = IMAGE_TOOLS_TAB_ITEMS[0]!.id
const FIRST_VIDEO_SUB_NAV: VideoSubNavId = 'generate'

function isImageToolsTabId(v: string): v is ImageToolsTabId {
  return (IMAGE_TOOLS_TAB_ITEMS as readonly { id: ImageToolsTabId }[]).some((x) => x.id === v)
}

function isImageSubNavId(v: string): v is ImageSubNavId {
  return v === 'imageGen' || v === 'ecommerce' || v === 'tools'
}

function isVideoSubNavId(v: string): v is VideoSubNavId {
  return v === 'generate' || v === 'upscale'
}

function normalizeVideoSubNavId(v: string | null | undefined): VideoSubNavId {
  if (v === 'generate' || v === 'upscale') return v
  return FIRST_VIDEO_SUB_NAV
}

function workspaceParamFromNav(
  mainNav: 'image' | 'video' | 'creativePlaza' | 'templates' | 'tasks' | 'assets' | 'benefits' | 'developer',
  imageSubNav: ImageSubNavId,
  imageToolsTab: ImageToolsTabId,
  videoSubNav: VideoSubNavId,
): string | null {
  if (mainNav === 'image' && imageSubNav === 'imageGen') return 'image.imageGen'
  if (mainNav === 'image' && imageSubNav === 'ecommerce') return 'image.ecommerce'
  if (mainNav === 'image' && imageSubNav === 'tools') return `image.tools.${imageToolsTab}`
  if (mainNav === 'video') return `video.${videoSubNav}`
  return null
}

function App() {
  const urlSession = parseSessionFromUrl()
  const urlType = urlSession?.type || ''
  const [page, setPage] = useState<'landing' | 'auth' | 'home'>(() => {
    if (localStorage.getItem('tikgen.accessToken')) return 'home'
    if (urlType === 'recovery') return 'auth'
    if (urlSession?.access_token) return 'home'
    return 'landing'
  })
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'recover' | 'recoverReset'>(() => {
    return urlType === 'recovery' ? 'recoverReset' : 'login'
  })
  const [user, setUser] = useState<{
    id?: string
    name: string
    email?: string
    credits: number
    package: string
    packageExpiresAt: string
    /** 是否在本产品内至少有一条已支付订单（生图/视频权限） */
    hasPaidProduct?: boolean
  } | null>(null)
  const [accessToken, setAccessToken] = useState<string>(() => {
    const stored = localStorage.getItem('tikgen.accessToken')
    if (stored) return stored
    if (urlType === 'recovery') return ''
    return urlSession?.access_token || ''
  })
  const [recoveryAccessToken, setRecoveryAccessToken] = useState<string>(() => {
    if (urlType === 'recovery') return urlSession?.access_token || ''
    return ''
  })
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authPassword2, setAuthPassword2] = useState('')
  const [authShowPassword, setAuthShowPassword] = useState(false)
  const [authShowPassword2, setAuthShowPassword2] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authResendBusy, setAuthResendBusy] = useState(false)
  const [mainNav, setMainNav] = useState<
    'image' | 'video' | 'creativePlaza' | 'templates' | 'tasks' | 'assets' | 'benefits' | 'developer'
  >('image')
  const [imageSubNav, setImageSubNav] = useState<ImageSubNavId>(() => {
    try {
      const v = sessionStorage.getItem('tikgen.sess.imageSubNav')
      if (v === 'generate') return 'ecommerce'
      if (v && isImageSubNavId(v)) return v
    } catch {
      // ignore
    }
    return 'ecommerce'
  })
  const [imageToolsTab, setImageToolsTab] = useState<ImageToolsTabId>(() => {
    try {
      const v = sessionStorage.getItem('tikgen.sess.imageToolsTab')
      if (v && isImageToolsTabId(v)) return v
    } catch {
      // ignore
    }
    return FIRST_IMAGE_TOOL_TAB
  })
  const [videoSubNav, setVideoSubNav] = useState<VideoSubNavId>(() => {
    try {
      const v = sessionStorage.getItem('tikgen.sess.videoSubNav')
      if (v === 'generate' || v === 'upscale') return v
      // 迁移：旧版「视频分析」下线 → 默认进视频生成
      if (v === 'analyze') return 'generate'
      // 迁移：旧版二级「视频工具」+ session 中的 tab
      if (v === 'tools') {
        const tab = sessionStorage.getItem('tikgen.sess.videoToolsTab')
        return normalizeVideoSubNavId(tab)
      }
    } catch {
      // ignore
    }
    return FIRST_VIDEO_SUB_NAV
  })
  const [videoTemplatePreset, setVideoTemplatePreset] = useState<VideoTemplatePreset | null>(null)
  const [imageTemplatePreset, setImageTemplatePreset] = useState<ImageTemplatePreset | null>(null)
  const [packageCatalog, setPackageCatalog] = useState<PackageConfigItem[]>(DEFAULT_PACKAGES)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [showAnnouncements, setShowAnnouncements] = useState(false)
  const [announcements, setAnnouncements] = useState<any[]>([])
  const [annBusy, setAnnBusy] = useState(false)
  const [readAnnouncementIds, setReadAnnouncementIds] = useState<string[]>([])
  const announcementsRef = useRef<HTMLDivElement | null>(null)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem('tikgen.sess.imageSubNav', imageSubNav)
    } catch {
      // ignore
    }
  }, [imageSubNav])

  useEffect(() => {
    try {
      sessionStorage.setItem('tikgen.sess.imageToolsTab', imageToolsTab)
    } catch {
      // ignore
    }
  }, [imageToolsTab])

  useEffect(() => {
    try {
      sessionStorage.setItem('tikgen.sess.videoSubNav', videoSubNav)
    } catch {
      // ignore
    }
  }, [videoSubNav])

  /** 深链：?workspace=image.tools.upscale | image.generate | video.generate | video.upscale（兼容 video.tools.*、video.analyze）（先于 URL 同步执行，避免竞态） */
  useLayoutEffect(() => {
    if (page !== 'home' || typeof window === 'undefined') return
    try {
      const sp = new URLSearchParams(window.location.search)
      const w = sp.get('workspace')?.trim()
      if (!w) return
      const parts = w.split('.').filter(Boolean)
      if (parts[0] === 'image') {
        if (parts[1] === 'imageGen') {
          setMainNav('image')
          setImageSubNav('imageGen')
        } else if (parts[1] === 'ecommerce') {
          setMainNav('image')
          setImageSubNav('ecommerce')
        } else if (parts[1] === 'generate') {
          setMainNav('image')
          setImageSubNav('ecommerce')
        } else if (parts[1] === 'tools') {
          setMainNav('image')
          setImageSubNav('tools')
          if (parts[2] && isImageToolsTabId(parts[2])) setImageToolsTab(parts[2])
          else setImageToolsTab(FIRST_IMAGE_TOOL_TAB)
        }
      } else if (parts[0] === 'video') {
        setMainNav('video')
        if (parts[1] === 'generate' || parts[1] === 'upscale') {
          setVideoSubNav(parts[1])
        } else if (parts[1] === 'analyze') {
          setVideoSubNav('generate')
        } else if (parts[1] === 'tools') {
          if (parts[2] && isVideoSubNavId(parts[2])) setVideoSubNav(parts[2])
          else setVideoSubNav(normalizeVideoSubNavId(parts[2]))
        } else {
          setVideoSubNav(FIRST_VIDEO_SUB_NAV)
        }
      }
      sp.delete('workspace')
      const rest = sp.toString()
      const nextUrl = `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash || ''}`
      window.history.replaceState(null, '', nextUrl)
    } catch {
      // ignore
    }
  }, [page])

  /** 侧栏三级菜单：同步 flush DOM，避免内容已切换而 Tab 高亮滞后一帧 */
  const goImageToolsTab = useCallback((tab: ImageToolsTabId) => {
    flushSync(() => {
      setMainNav('image')
      setImageSubNav('tools')
      setImageToolsTab(tab)
    })
  }, [])
  const goVideoSubNav = useCallback((sub: VideoSubNavId) => {
    flushSync(() => {
      setMainNav('video')
      setVideoSubNav(sub)
    })
  }, [])

  /** 图片创作二级：同步 flush DOM，避免选中背景块滞后（与视频二级 goVideoSubNav 一致） */
  const goImageSubNav = useCallback((sub: ImageSubNavId) => {
    flushSync(() => {
      setMainNav('image')
      setImageSubNav(sub)
    })
  }, [])

  /** 工作台顶部 Tab 点击：同步提交，避免与主题 transition 叠加产生高亮滞后 */
  const onWorkbenchImageTabChange = useCallback((t: ImageToolsTabId) => {
    flushSync(() => setImageToolsTab(t))
  }, [])

  /** 与当前页同步 workspace 参数；延后两帧再 replaceState，让 Tab 高亮与内容先完成绘制 */
  useEffect(() => {
    if (page !== 'home' || typeof window === 'undefined') return
    let cancelled = false
    const raf = { inner: null as number | null }
    const id0 = requestAnimationFrame(() => {
      raf.inner = requestAnimationFrame(() => {
        if (cancelled) return
        try {
          const nextW = workspaceParamFromNav(mainNav, imageSubNav, imageToolsTab, videoSubNav)
          const sp = new URLSearchParams(window.location.search)
          if (nextW) sp.set('workspace', nextW)
          else sp.delete('workspace')
          const qs = sp.toString()
          const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`
          const cur = `${window.location.pathname}${window.location.search}${window.location.hash || ''}`
          if (nextUrl !== cur) window.history.replaceState(null, '', nextUrl)
        } catch {
          // ignore
        }
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id0)
      if (raf.inner != null) cancelAnimationFrame(raf.inner)
    }
  }, [page, mainNav, imageSubNav, imageToolsTab, videoSubNav])

  const readSession = () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  const saveSession = (session: any) => {
    try {
      if (!session?.access_token) return
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      localStorage.setItem('tikgen.accessToken', String(session.access_token))
    } catch {
      // ignore
    }
  }

  const clearSession = () => {
    localStorage.removeItem('tikgen.accessToken')
    localStorage.removeItem(SESSION_KEY)
  }

  useEffect(() => {
    ;(async () => {
      if (!accessToken) return
      try {
        const me = await apiMe(accessToken)
        const plan = me?.subscription?.planId || 'trial'
        const end = me?.subscription?.currentPeriodEnd ? String(me.subscription.currentPeriodEnd).slice(0, 10) : ''
        setUser({
          id: me?.user?.id,
          name: me?.user?.name || me?.user?.email || '用户',
          email: me?.user?.email,
          credits: 0,
          package: plan,
          packageExpiresAt: end,
          hasPaidProduct: !!me?.hasPaidProduct,
        })
        setPage('home')
        // Keep "处理中..." until we leave the auth page.
        setAuthBusy(false)
      } catch {
        try {
          const sess = readSession()
          const rt = String(sess?.refresh_token || '').trim()
          if (!rt) throw new Error('missing refresh token')
          const rr = await apiRefresh(rt)
          const nextSession = rr?.session || null
          if (!nextSession?.access_token) throw new Error('refresh failed')
          saveSession(nextSession)
          const nextToken = String(nextSession.access_token)
          setAccessToken(nextToken)

          const me = await apiMe(nextToken)
          const plan = me?.subscription?.planId || 'trial'
          const end = me?.subscription?.currentPeriodEnd ? String(me.subscription.currentPeriodEnd).slice(0, 10) : ''
          setUser({
            id: me?.user?.id,
            name: me?.user?.name || me?.user?.email || '用户',
            email: me?.user?.email,
            credits: 0,
            package: plan,
            packageExpiresAt: end,
            hasPaidProduct: !!me?.hasPaidProduct,
          })
          setPage('home')
          // Keep "处理中..." until we leave the auth page.
          setAuthBusy(false)
        } catch {
          clearSession()
          setAccessToken('')
          setUser(null)
          setAuthBusy(false)
          setPage('landing')
        }
      } finally {
        // no-op
      }
    })()
  }, [accessToken])

  // If user lands on a Supabase recovery link, access/refresh tokens can be stored in URL hash or query.
  // We need to persist them into localStorage so the rest of the app can treat the user as logged in.
  // If it's a password recovery reset link, we should NOT auto-login; instead show a "set new password" UI.
  useEffect(() => {
    if (localStorage.getItem('tikgen.accessToken')) return
    const hs = parseSessionFromUrl()
    if (!hs?.access_token) return
    if (hs.type !== 'recovery' && !hs?.refresh_token) return
    try {
      if (hs.type === 'recovery') {
        setRecoveryAccessToken(hs.access_token)
        setAuthMode('recoverReset')
        setPage('auth')
        return
      }
      saveSession(hs)
      setAccessToken(hs.access_token)
      setPage('home')
    } catch {
      // ignore and let apiMe handle it
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = () => {
    clearSession()
    setAccessToken('')
    setUser(null)
    setPage('landing')
  }

  const currentPackage = useMemo(() => packageCatalog.find((p) => p.plan_id === user?.package) || DEFAULT_PACKAGES.find((p) => p.plan_id === user?.package), [packageCatalog, user?.package])
  const creditsSummary = useMemo(() => {
    const remaining = Math.max(0, Number(user?.credits || 0))
    const quotaRaw = Number(currentPackage?.daily_quota || 0)
    const hasFiniteQuota = Number.isFinite(quotaRaw) && quotaRaw > 0 && quotaRaw < 900000
    const total = hasFiniteQuota ? quotaRaw : 0
    const used = hasFiniteQuota ? Math.min(total, Math.max(0, total - remaining)) : 0
    const ratio = hasFiniteQuota && total > 0 ? used / total : 0
    return { remaining, hasFiniteQuota, total, used, ratio }
  }, [currentPackage?.daily_quota, user?.credits])
  const gotoBenefits = useCallback(() => {
    setMainNav('benefits')
  }, [])
  const isDevAdmin = useMemo(() => {
    const email = String(user?.email || '').toLowerCase()
    return ['haoxue2027@gmail.com'].includes(email)
  }, [user?.email])

  useEffect(() => {
    if (!isDevAdmin && mainNav === 'developer') {
      setMainNav('image')
      setImageSubNav('ecommerce')
    }
  }, [isDevAdmin, mainNav])

  useEffect(() => {
    if (!TEMPLATES_LIBRARY_ENABLED && mainNav === 'templates') {
      setMainNav('image')
      setImageSubNav('ecommerce')
    }
  }, [mainNav])

  useEffect(() => {
    if (!accessToken || page !== 'home') return
    if (assetsWarmupDoneForToken === accessToken) return
    assetsWarmupDoneForToken = accessToken

    let cancelled = false
    const run = () => {
      if (cancelled) return
      void prefetchAssetsCacheIfNeeded()
    }

    const ric = (window as any).requestIdleCallback
    const cic = (window as any).cancelIdleCallback
    let idleId: any = null
    let timerId: any = null
    if (typeof ric === 'function') idleId = ric(run, { timeout: 1200 })
    else timerId = setTimeout(run, 300)

    return () => {
      cancelled = true
      if (idleId != null && typeof cic === 'function') cic(idleId)
      if (timerId != null) clearTimeout(timerId)
    }
  }, [accessToken, page])

  useEffect(() => {
    if (page !== 'home') return
    ;(async () => {
      try {
        const r = await listPackageConfigsPublic()
        const rows = (r.configs || []).filter((x) => x.enabled !== false)
        if (rows.length) setPackageCatalog(rows)
      } catch {
        // ignore package catalog fetch errors
      }
    })()
  }, [page])

  const currentPageLabel = useMemo(() => {
    if (mainNav === 'image') {
      if (imageSubNav === 'imageGen') return '图片生成'
      if (imageSubNav === 'ecommerce') return '电商套图'
      if (imageSubNav === 'tools') {
        if (imageToolsTab === 'removeBg') return '图片工具-去除背景'
        if (imageToolsTab === 'upscale') return '图片工具-高清放大'
        if (imageToolsTab === 'compress') return '图片工具-图片压缩'
        if (imageToolsTab === 'translate') return '图片工具-图片翻译'
        return '图片工具'
      }
    }
    if (mainNav === 'video') {
      if (videoSubNav === 'generate') return '视频生成'
      if (videoSubNav === 'upscale') return '视频增强'
    }
    if (TEMPLATES_LIBRARY_ENABLED && mainNav === 'templates') return '模板与案例库'
    if (mainNav === 'creativePlaza') return '创意广场'
    if (mainNav === 'tasks') return '任务中心'
    if (mainNav === 'assets') return '资产库'
    if (mainNav === 'benefits') return '个人权益'
    if (mainNav === 'developer' && isDevAdmin) return '开发者后台'
    return '电商套图'
  }, [mainNav, imageSubNav, imageToolsTab, videoSubNav, isDevAdmin])

  const ANN_READ_KEY = user?.id ? `tikgen.ann.read.${user.id}` : 'tikgen.ann.read.guest'

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ANN_READ_KEY) || '[]'
      const ids = JSON.parse(raw)
      setReadAnnouncementIds(Array.isArray(ids) ? ids.map(String) : [])
    } catch {
      setReadAnnouncementIds([])
    }
  }, [ANN_READ_KEY])

  const unreadCount = useMemo(() => {
    const readSet = new Set(readAnnouncementIds.map(String))
    return announcements.filter((a) => !readSet.has(String(a.id))).length
  }, [announcements, readAnnouncementIds])

  const markAnnouncementsRead = () => {
    const ids = announcements.map((a) => String(a.id))
    setReadAnnouncementIds(ids)
    try {
      localStorage.setItem(ANN_READ_KEY, JSON.stringify(ids))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!accessToken) return
    ;(async () => {
      try {
        setAnnBusy(true)
        const planId = String(user?.package || 'all')
        const r = await listAnnouncementsPublic(planId)
        setAnnouncements(Array.isArray(r.announcements) ? r.announcements : [])
      } catch {
        setAnnouncements([])
      } finally {
        setAnnBusy(false)
      }
    })()
  }, [accessToken, user?.package])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('tikgen.nav.collapsed.v1')
      setNavCollapsed(raw === '1')
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('tikgen.nav.collapsed.v1', navCollapsed ? '1' : '0')
    } catch {
      // ignore
    }
  }, [navCollapsed])

  useEffect(() => {
    if (!showAnnouncements) return
    const onPointerDown = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null
      if (!target) return
      if (announcementsRef.current?.contains(target)) return
      setShowAnnouncements(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [showAnnouncements])

  useEffect(() => {
    if (!showUserMenu) return
    const onPointerDown = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null
      if (!target) return
      if (userMenuRef.current?.contains(target)) return
      setShowUserMenu(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [showUserMenu])

  if (page === 'landing')
    return (
      <LandingV2
        onLogin={() => {
          setAuthMode('login')
          setPage('auth')
        }}
        onRegister={() => {
          setAuthMode('register')
          setPage('auth')
        }}
      />
    )

  if (page === 'auth')
    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <button onClick={() => setPage('landing')} className="text-white/60 mb-8 flex items-center hover:text-white">
          <ChevronRight className="w-5 h-5 rotate-180 mr-1" /> 返回
        </button>
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 border border-white/20">
          <h2 className="text-3xl font-bold text-white text-center mb-8">
            {authMode === 'login' ? '登录账号' : authMode === 'register' ? '注册账号' : '重置密码'}
          </h2>
          <div className="space-y-4">
            <input value={authEmail} onChange={(e)=>setAuthEmail(e.target.value)} type="email" placeholder="邮箱地址" className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40" />
            {authMode !== 'recover' && authMode !== 'recoverReset' ? (
              <div className="relative">
                <input
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  type={authShowPassword ? 'text' : 'password'}
                  placeholder="密码"
                  className="w-full px-5 py-4 pr-14 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  aria-label={authShowPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setAuthShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                >
                  {authShowPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
          </div>
            ) : (
              // recoverReset 模式：也要展示新密码输入框
              <div className="relative">
                <input
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  type={authShowPassword ? 'text' : 'password'}
                  placeholder="新密码"
                  className="w-full px-5 py-4 pr-14 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  aria-label={authShowPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setAuthShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                >
                  {authShowPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
        </div>
            )}
            {(authMode === 'register' || authMode === 'recoverReset') && (
              <div className="relative">
                <input
                  value={authPassword2}
                  onChange={(e) => setAuthPassword2(e.target.value)}
                  type={authShowPassword2 ? 'text' : 'password'}
                  placeholder={authMode === 'recoverReset' ? '确认新密码' : '确认密码'}
                  className="w-full px-5 py-4 pr-14 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  aria-label={authShowPassword2 ? '隐藏确认密码' : '显示确认密码'}
                  onClick={() => setAuthShowPassword2((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                >
                  {authShowPassword2 ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            )}
            {authMode === 'login' && (
              <button
                type="button"
                onClick={() => {
                  setAuthError('')
                  setAuthNotice('')
                  setAuthMode('recover')
                }}
                className="w-full text-center text-white/60 hover:text-white text-sm"
              >
                忘记密码？
              </button>
            )}
            <button
              disabled={authBusy}
              onClick={async () => {
                setAuthError('')
                if (authMode === 'register') {
                  const cooldownUntil = Number(localStorage.getItem('tikgen.authCooldownUntil') || 0)
                  if (Date.now() < cooldownUntil) {
                    const minutes = Math.ceil((cooldownUntil - Date.now()) / 60000)
                    return setAuthError(`触发注册限流，请等待 ${minutes} 分钟后再试`)
                  }
                }
                if (!authEmail) return setAuthError('请输入邮箱地址')
                if ((authMode === 'login' || authMode === 'register' || authMode === 'recoverReset') && !authPassword)
                  return setAuthError(authMode === 'recoverReset' ? '请输入新密码' : '请输入密码')
                if ((authMode === 'register' || authMode === 'recoverReset') && authPassword !== authPassword2) return setAuthError('两次密码不一致')
                setAuthBusy(true)
                let keepBusyAfterToken = false
                try {
                  const data =
                    authMode === 'recover'
                      ? await apiRecoverPassword({ email: authEmail })
                      : authMode === 'recoverReset'
                        ? await apiUpdatePassword({ accessToken: recoveryAccessToken, password: authPassword })
                        : authMode === 'register'
                          ? await apiRegister({ email: authEmail, password: authPassword })
                          : await apiLogin({ email: authEmail, password: authPassword })
                  if (authMode === 'register' && data?.needsEmailConfirm) {
                    setAuthMode('login')
                    throw new Error('注册成功：请先去邮箱点击验证链接，然后再回来登录')
                  }
                  if (authMode === 'recover' && data?.success) {
                    setAuthMode('login')
                    setAuthNotice('已发送重置密码邮件，请在 5-10 分钟内检查收件箱/垃圾箱。')
                    return
                  }
                  if (authMode === 'recoverReset' && data?.success) {
                    try {
                      window.location.hash = ''
                    } catch {
                      // ignore
                    }
                    setRecoveryAccessToken('')
                    setAuthPassword('')
                    setAuthPassword2('')
                    setAuthMode('login')
                    setAuthNotice('密码已更新，请使用新密码登录')
                    return
                  }
                  const session = data?.session || null
                  const token = session?.access_token
                  if (!token) throw new Error('登录成功但未返回 token')
                  saveSession(session)
                  Sentry.captureMessage('auth_login_success', { level: 'info', extra: { mode: authMode } })
                  setAccessToken(token)
                  // 登录成功后还需要等 apiMe(accessToken) 完成校验才会跳转首页；
                  // 为了避免按钮文案在等待期间回到“登录”，这里保留 busy 状态，交由 accessToken effect 统一置回。
                  keepBusyAfterToken = true
                } catch (e:any) {
                  const msg = String(e?.message || '登录失败')
                  Sentry.captureException(e, { extra: { scene: 'auth_submit', mode: authMode } })
                  if (authMode === 'register' && msg.toLowerCase().includes('rate limit')) {
                    // Supabase auth has strict anti-abuse limits. We keep a short local cooldown
                    // to prevent repeated requests from the same browser/IP.
                    const cooldownMs = 60 * 60 * 1000
                    localStorage.setItem('tikgen.authCooldownUntil', String(Date.now() + cooldownMs))
                    return setAuthError('触发注册限流，请稍后约 60 分钟再试')
                  }
                  setAuthError(msg)
                } finally {
                  if (!keepBusyAfterToken) setAuthBusy(false)
                }
              }}
              className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl"
            >
              {authBusy
                ? '处理中...'
                : authMode === 'login'
                  ? '登录'
                  : authMode === 'register'
                    ? '注册并登录'
                    : authMode === 'recover'
                      ? '发送重置邮件'
                      : '保存新密码'}
            </button>
            {!!authNotice && <div className="text-sm text-emerald-200 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">{authNotice}</div>}
            {!!authError && (
              <div className="text-sm text-red-200 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                {authError}
                {(() => {
                  const msg = String(authError || '')
                  // 兜底：不同 Supabase/不同步骤可能返回略有差异的提示文案
                  const indicatesEmailConfirm =
                    (/邮箱/.test(msg) && /验证/.test(msg)) ||
                    /验证链接/.test(msg) ||
                    /email.*confirm/i.test(msg) ||
                    /not confirmed/i.test(msg) ||
                    /confirmed/i.test(msg)

                  if (!indicatesEmailConfirm) return null
                  return (
                  <div className="mt-3 flex">
                    <button
                      disabled={authResendBusy}
                      onClick={async () => {
                        if (!authEmail) return setAuthError('请输入邮箱地址后再重发')
                        setAuthError('')
                        setAuthNotice('')
                        setAuthResendBusy(true)
                        try {
                          await apiResendSignup({ email: authEmail })
                          setAuthNotice('已重新发送邮箱验证，请稍后查收（可能在垃圾箱/Promotion）')
                        } catch (e: any) {
                          setAuthError(e?.message || '重发失败')
                        } finally {
                          setAuthResendBusy(false)
                        }
                      }}
                      className="w-full py-2 rounded-lg text-sm bg-red-500/20 border border-red-500/30 text-red-100 hover:bg-red-500/30 disabled:opacity-50"
                    >
                      {authResendBusy ? '重发中...' : '重新发送验证邮件'}
                    </button>
                  </div>
                  )
                })()}
              </div>
            )}
            <div className="text-center text-white/60 text-sm">
              {authMode === 'login' ? (
                <button className="hover:text-white" onClick={() => setAuthMode('register')}>
                  没有账号？去注册
                </button>
              ) : authMode === 'register' ? (
                <button className="hover:text-white" onClick={() => setAuthMode('login')}>
                  已有账号？去登录
                </button>
              ) : (
                <button className="hover:text-white" onClick={() => setAuthMode('login')}>
                  返回登录
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const refreshCurrentUser = async () => {
    if (!accessToken) return
    try {
      const me = await apiMe(accessToken)
      const plan = me?.subscription?.planId || 'trial'
      const end = me?.subscription?.currentPeriodEnd ? String(me.subscription.currentPeriodEnd).slice(0, 10) : ''
      setUser({
        id: me?.user?.id,
        name: me?.user?.name || me?.user?.email || '用户',
        email: me?.user?.email,
        credits: 0,
        package: plan,
        packageExpiresAt: end,
        hasPaidProduct: !!me?.hasPaidProduct,
      })
    } catch {
      // ignore refresh failures in manual action
    }
  }

  const isAdminBypass = String(user?.email || '').trim().toLowerCase() === 'haoxue2027@gmail.com'
  const canGenerateMedia = isAdminBypass || Boolean(user?.hasPaidProduct)

  return (
    <div className="min-h-screen min-w-[1280px] bg-gray-50 flex workbench-root">
      <aside className={`${navCollapsed ? 'w-20' : 'w-64'} bg-white shadow-xl fixed h-full z-30 transition-all relative overflow-visible`}>
        <div className="p-4 border-b">
          <div className={`flex items-center ${navCollapsed ? 'justify-center' : 'justify-between'}`}>
            {!navCollapsed ? (
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center"><Video className="w-5 h-5 text-white" /></div>
                <span className="text-xl font-bold bg-gradient-to-r from-pink-600 to-purple-600 bg-clip-text text-transparent">TikGen AI</span>
              </div>
            ) : (
              <div className="w-10 h-10" aria-hidden="true" />
            )}
          </div>
        </div>
        <button
          onClick={() => setNavCollapsed((v) => !v)}
          className={`absolute top-5 ${navCollapsed ? 'left-1/2 -translate-x-1/2' : 'right-3'} w-7 h-7 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/80`}
          title={navCollapsed ? '展开导航' : '收起导航'}
          aria-label={navCollapsed ? '展开导航' : '收起导航'}
        >
          {navCollapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
        </button>
        <nav className={`p-3 space-y-2 ${navCollapsed ? 'items-center' : ''}`}>
          {navCollapsed ? (
            <>
              <NavPrimary
                collapsed
                icon={<Sparkles className="w-5 h-5" />}
                label="图片生成"
                active={mainNav === 'image' && imageSubNav === 'imageGen'}
                onClick={() => goImageSubNav('imageGen')}
              />
              <NavPrimary
                collapsed
                icon={<Layers className="w-5 h-5" />}
                label="电商套图"
                badge="推荐"
                active={mainNav === 'image' && imageSubNav === 'ecommerce'}
                onClick={() => goImageSubNav('ecommerce')}
              />
              <NavCollapsedToolsFlyout
                icon={<Wrench className="w-5 h-5" />}
                label="图片工具"
                active={mainNav === 'image' && imageSubNav === 'tools'}
                flyoutItems={IMAGE_TOOLS_TAB_ITEMS.map(({ id, label }) => ({ id, label }))}
                onClickDefault={() => goImageToolsTab(FIRST_IMAGE_TOOL_TAB)}
                onPickTool={(id) => {
                  if (!isImageToolsTabId(id)) return
                  goImageToolsTab(id)
                }}
              />
              <NavPrimary
                collapsed
                icon={<Video className="w-5 h-5" />}
                label="视频生成"
                active={mainNav === 'video' && videoSubNav === 'generate'}
                onClick={() => goVideoSubNav('generate')}
              />
              <NavPrimary
                collapsed
                icon={<WandSparkles className="w-5 h-5" />}
                label="视频增强"
                active={mainNav === 'video' && videoSubNav === 'upscale'}
                onClick={() => goVideoSubNav('upscale')}
              />
              <NavPrimary
                collapsed
                icon={<LayoutGrid className="w-5 h-5" />}
                label="创意广场"
                active={mainNav === 'creativePlaza'}
                onClick={() => setMainNav('creativePlaza')}
              />
              {TEMPLATES_LIBRARY_ENABLED ? (
                <NavPrimary collapsed icon={<Library className="w-5 h-5" />} label="模板库" active={mainNav === 'templates'} onClick={() => setMainNav('templates')} />
              ) : null}
              <NavPrimary collapsed icon={<ListTodo className="w-5 h-5" />} label="任务中心" active={mainNav === 'tasks'} onClick={() => setMainNav('tasks')} />
              <NavPrimary
                collapsed
                icon={<Folder className="w-5 h-5" />}
                label="资产库"
                active={mainNav === 'assets'}
                onMouseEnter={() => {
                  void prefetchAssetsCacheIfNeeded()
                }}
                onClick={() => setMainNav('assets')}
              />
              <NavPrimary collapsed icon={<Crown className="w-5 h-5" />} label="个人权益" active={mainNav === 'benefits'} onClick={() => setMainNav('benefits')} />
              {isDevAdmin ? (
                <NavPrimary
                  collapsed
                  icon={<ShieldCheck className="w-5 h-5" />}
                  label="开发者后台"
                  active={mainNav === 'developer'}
                  onClick={() => setMainNav('developer')}
                />
              ) : null}
            </>
          ) : (
            <>
              <NavPrimary
                collapsed={false}
                icon={<Image className="w-5 h-5" />}
                label="图片创作"
                active={mainNav === 'image'}
                onClick={() => goImageSubNav('imageGen')}
              />
              <div className="pl-3 space-y-1">
                <NavSecondary
                  collapsed={false}
                  icon={<Sparkles className="w-4 h-4" />}
                  label="图片生成"
                  active={mainNav === 'image' && imageSubNav === 'imageGen'}
                  onClick={() => goImageSubNav('imageGen')}
                />
                <NavSecondary
                  collapsed={false}
                  icon={<Layers className="w-4 h-4" />}
                  label="电商套图"
                  badge="推荐"
                  active={mainNav === 'image' && imageSubNav === 'ecommerce'}
                  onClick={() => goImageSubNav('ecommerce')}
                />
                <NavSecondaryToolsFlyout
                  icon={<Wrench className="w-4 h-4" />}
                  label="图片工具"
                  active={mainNav === 'image' && imageSubNav === 'tools'}
                  flyoutItems={IMAGE_TOOLS_TAB_ITEMS.map(({ id, label }) => ({ id, label }))}
                  activeThirdId={mainNav === 'image' && imageSubNav === 'tools' ? imageToolsTab : null}
                  onActivateDefault={() => goImageToolsTab(FIRST_IMAGE_TOOL_TAB)}
                  onPickThird={(id) => {
                    if (!isImageToolsTabId(id)) return
                    goImageToolsTab(id)
                  }}
                />
              </div>

              <NavPrimary
                collapsed={false}
                icon={<Clapperboard className="w-5 h-5" />}
                label="视频创作"
                active={mainNav === 'video'}
                onClick={() => {
                  setMainNav('video')
                  setVideoSubNav(FIRST_VIDEO_SUB_NAV)
                }}
              />
              <div className="pl-3 space-y-1">
                <NavSecondary
                  collapsed={false}
                  icon={<Video className="w-4 h-4" />}
                  label="视频生成"
                  active={mainNav === 'video' && videoSubNav === 'generate'}
                  onClick={() => goVideoSubNav('generate')}
                />
                <NavSecondary
                  collapsed={false}
                  icon={<WandSparkles className="w-4 h-4" />}
                  label="视频增强"
                  active={mainNav === 'video' && videoSubNav === 'upscale'}
                  onClick={() => goVideoSubNav('upscale')}
                />
              </div>

              <NavPrimary
                collapsed={false}
                icon={<LayoutGrid className="w-5 h-5" />}
                label="创意广场"
                active={mainNav === 'creativePlaza'}
                onClick={() => setMainNav('creativePlaza')}
              />
              {TEMPLATES_LIBRARY_ENABLED ? (
                <NavPrimary collapsed={false} icon={<Library className="w-5 h-5" />} label="模板库" active={mainNav === 'templates'} onClick={() => setMainNav('templates')} />
              ) : null}
              <NavPrimary collapsed={false} icon={<ListTodo className="w-5 h-5" />} label="任务中心" active={mainNav === 'tasks'} onClick={() => setMainNav('tasks')} />
              <NavPrimary
                collapsed={false}
                icon={<Folder className="w-5 h-5" />}
                label="资产库"
                active={mainNav === 'assets'}
                onMouseEnter={() => {
                  void prefetchAssetsCacheIfNeeded()
                }}
                onClick={() => setMainNav('assets')}
              />
              <NavPrimary collapsed={false} icon={<Crown className="w-5 h-5" />} label="个人权益" active={mainNav === 'benefits'} onClick={() => setMainNav('benefits')} />
              {isDevAdmin ? (
                <NavPrimary
                  collapsed={false}
                  icon={<ShieldCheck className="w-5 h-5" />}
                  label="开发者后台"
                  active={mainNav === 'developer'}
                  onClick={() => setMainNav('developer')}
                />
              ) : null}
            </>
          )}
        </nav>
      </aside>
      <main className={`flex-1 ${navCollapsed ? 'ml-20' : 'ml-64'} transition-all`}>
        <header className="bg-white shadow-sm sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold">
                {mainNav === 'image' && imageSubNav === 'imageGen' && '图片生成'}
                {mainNav === 'image' && imageSubNav === 'ecommerce' && '电商套图'}
                {mainNav === 'image' && imageSubNav === 'tools' && imageToolsTab === 'removeBg' && '图片工具 · 去除背景'}
                {mainNav === 'image' && imageSubNav === 'tools' && imageToolsTab === 'upscale' && '图片工具 · 高清放大'}
                {mainNav === 'image' && imageSubNav === 'tools' && imageToolsTab === 'compress' && '图片工具 · 图片压缩'}
                {mainNav === 'image' && imageSubNav === 'tools' && imageToolsTab === 'translate' && '图片工具 · 图片翻译'}
                {mainNav === 'video' && videoSubNav === 'generate' && '视频生成'}
                {mainNav === 'video' && videoSubNav === 'upscale' && '视频增强'}
                {TEMPLATES_LIBRARY_ENABLED && mainNav === 'templates' && '模板与案例库'}
                {mainNav === 'creativePlaza' && '创意广场'}
                {mainNav === 'tasks' && '任务中心'}
                {mainNav === 'assets' && '资产库'}
                {mainNav === 'benefits' && '个人权益'}
                {mainNav === 'developer' && isDevAdmin && '开发者后台'}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div ref={announcementsRef} className="relative">
                <button
                  onClick={() => {
                    const next = !showAnnouncements
                    setShowAnnouncements(next)
                    if (next) markAnnouncementsRead()
                  }}
                  className="workbench-topicon-btn p-2 rounded-lg"
                  title="公告通知"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-pink-500 text-white text-[10px] leading-4 text-center">{Math.min(unreadCount, 9)}</span>}
                </button>
                {showAnnouncements && (
                  <div className="workbench-ann-panel absolute right-0 mt-2 w-96 max-h-96 overflow-auto bg-white border rounded-xl shadow-xl z-30 p-3">
                    <div className="text-sm font-semibold mb-2">公告中心</div>
                    {annBusy ? (
                      <div className="text-xs text-gray-500 py-2">加载中...</div>
                    ) : announcements.length === 0 ? (
                      <div className="text-xs text-gray-500 py-2">暂无公告</div>
                    ) : (
                      <div className="space-y-2">
                        {announcements.slice(0, 20).map((a) => (
                          <div key={a.id} className="workbench-ann-item border rounded-lg p-2.5">
                            <div className="text-sm font-medium">{a.title || '公告'}</div>
                            <div className="text-xs text-gray-500 mt-1">{String(a.published_at || a.created_at || '').slice(0, 10)}</div>
                            <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap line-clamp-3">{a.content}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {SUPPORT_TICKET_ENABLED ? (
                <button onClick={() => setShowFeedback(true)} className="workbench-topicon-btn p-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700" title="工单/客服">
                  <MessageSquare className="w-5 h-5" />
                </button>
              ) : null}
              <button onClick={() => setShowHelp(true)} className="workbench-topicon-btn p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700" title="帮助中心">
                <Library className="w-5 h-5" />
              </button>
              <div className="relative group/credits">
                <div
                  className="workbench-topinfo-pill flex items-center h-9 space-x-1.5 px-3 rounded-full cursor-default select-none"
                  title="当前积分"
                >
                  <Zap className="workbench-topinfo-icon-zap w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
                  <span className="font-bold text-base leading-none tabular-nums">{user?.credits}</span>
                  <span className="text-sm leading-none opacity-90">积分</span>
                </div>
                <div className="workbench-credits-pop pointer-events-none absolute right-0 top-[calc(100%+10px)] z-50 w-[360px] rounded-2xl border border-white/18 bg-[#121522] p-4 opacity-0 shadow-[0_22px_56px_rgba(0,0,0,0.52)] transition-all duration-150 group-hover/credits:pointer-events-auto group-hover/credits:opacity-100 group-hover/credits:translate-y-0 translate-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[19px] leading-tight text-white/95 font-semibold tracking-normal">{currentPackage?.name || '试用版'}</div>
                      <div className="mt-1 text-[13px] leading-tight text-white/60">将在 {user?.packageExpiresAt || '--'} 到期并暂停</div>
                    </div>
                    <Zap className="workbench-topinfo-icon-zap mt-0.5 h-4.5 w-4.5 shrink-0" strokeWidth={2.25} />
                  </div>
                  <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.09] ring-1 ring-inset ring-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-white/92 to-amber-500/80 transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, Math.round((creditsSummary.hasFiniteQuota ? creditsSummary.ratio : 1) * 100)))}%` }}
                    />
                  </div>
                  {creditsSummary.hasFiniteQuota ? (
                    <div className="mt-3 flex items-center justify-between text-white/90">
                      <span className="text-[16px] leading-none tabular-nums tracking-normal font-medium">
                        {creditsSummary.used}/{creditsSummary.total} 积分
                      </span>
                      <span className="text-[14px] leading-none tabular-nums text-white/72">剩余 {creditsSummary.remaining} 积分</span>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center justify-between text-white/90">
                      <span className="text-[14px] leading-none">当前套餐为不限量</span>
                      <span className="text-[14px] leading-none tabular-nums text-white/72">剩余 {creditsSummary.remaining} 积分</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={gotoBenefits}
                    className="mt-4 w-full rounded-xl border border-white/14 bg-white/[0.06] py-2.5 text-[14px] leading-none text-white/90 transition-colors hover:bg-white/[0.10] hover:border-white/22"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Crown className="h-3.5 w-3.5" />
                      升级/续费
                    </span>
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={gotoBenefits}
                className="workbench-topinfo-pill flex items-center h-9 gap-x-1.5 px-3 rounded-full select-none cursor-pointer"
                title="查看个人权益"
              >
                <Crown className="workbench-topinfo-icon-crown w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
                <span className="text-sm leading-none font-medium">{currentPackage?.name}</span>
                <span className="text-sm leading-none opacity-80 whitespace-nowrap">至 {user?.packageExpiresAt}</span>
              </button>
              <div ref={userMenuRef} className="relative">
                <button
                  onClick={() => setShowUserMenu((v) => !v)}
                  className="workbench-user-btn flex items-center space-x-2 px-2 py-1 rounded-lg"
                >
                  <div className="workbench-user-avatar w-8 h-8 bg-gradient-to-r from-pink-500 to-purple-500 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-sm font-medium workbench-user-name">{user?.name}</span>
                </button>
                {showUserMenu && (
                  <div className="workbench-user-menu-pop absolute right-0 mt-2 w-36 bg-white border rounded-lg shadow-lg z-30 p-1">
                    <button
                      onClick={() => {
                        setShowUserMenu(false)
                        handleLogout()
                      }}
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 text-sm text-gray-700 flex items-center"
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        <div className="p-6">
          {/* Keep generators mounted so in-flight tasks survive nav switches. */}
          <div className={mainNav === 'image' && imageSubNav === 'imageGen' ? '' : 'hidden'}>
            <ImageGenerator
              variant="simple"
              visible={mainNav === 'image' && imageSubNav === 'imageGen'}
              templatePreset={imageTemplatePreset}
              onTemplateApplied={() => setImageTemplatePreset(null)}
              canGenerate={canGenerateMedia}
            />
          </div>
          <div className={mainNav === 'image' && imageSubNav === 'ecommerce' ? '' : 'hidden'}>
            <ImageGenerator
              variant="ecommerce"
              visible={mainNav === 'image' && imageSubNav === 'ecommerce'}
              templatePreset={imageTemplatePreset}
              onTemplateApplied={() => setImageTemplatePreset(null)}
              canGenerate={canGenerateMedia}
            />
          </div>
          {/* 保持挂载：在「图片创作 / 其它主导航」与「图片工具」之间切换时不丢失各工具台状态 */}
          <div className={mainNav === 'image' && imageSubNav === 'tools' ? '' : 'hidden'}>
            <ImageToolsWorkbench tab={imageToolsTab} onTabChange={onWorkbenchImageTabChange} canGenerate={canGenerateMedia} />
          </div>
          <div className={mainNav === 'video' && videoSubNav === 'generate' ? '' : 'hidden'}>
            <VideoGenerator
              templatePreset={videoTemplatePreset}
              onTemplateApplied={() => setVideoTemplatePreset(null)}
              canGenerate={canGenerateMedia}
            />
          </div>
          <div className={mainNav === 'video' && videoSubNav === 'upscale' ? '' : 'hidden'}>
            <VideoUpscaleWorkbench canGenerate={canGenerateMedia} />
          </div>
          {mainNav === 'creativePlaza' ? <CreativePlazaPage /> : null}
          {TEMPLATES_LIBRARY_ENABLED && mainNav === 'templates' && (
            <TemplatesLibrary
              onApplyVideo={(preset) => {
                setVideoTemplatePreset(preset)
                setMainNav('video')
                setVideoSubNav('generate')
              }}
              onApplyImage={(preset) => {
                setImageTemplatePreset(preset)
                setMainNav('image')
                setImageSubNav('ecommerce')
              }}
            />
          )}
          {mainNav === 'assets' && <Assets />}
          {mainNav === 'benefits' && <Packages user={user} onRefreshUser={refreshCurrentUser} packages={packageCatalog} />}
          {mainNav === 'tasks' && <TaskCenter />}
          {mainNav === 'developer' && isDevAdmin && <DeveloperConsole />}
        </div>
      </main>
      {SUPPORT_TICKET_ENABLED ? <FeedbackLite open={showFeedback} onClose={() => setShowFeedback(false)} currentPage={currentPageLabel} /> : null}
      {showHelp && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">帮助中心</h3>
              <button onClick={() => setShowHelp(false)} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <HelpCenter />
          </div>
        </div>
      )}
    </div>
  )
}

function CreativePlazaPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-2xl border p-10 shadow-sm text-center">
        <LayoutGrid className="w-14 h-14 mx-auto text-purple-500 mb-4" strokeWidth={1.5} />
        <h2 className="text-xl font-bold text-gray-900">创意广场</h2>
        <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
          精选灵感、模板案例与社区活动将在这里聚合，便于发现爆款思路与可复用创意。功能建设中，敬请期待。
        </p>
      </div>
    </div>
  )
}

/** 单层底边线 + 下划线指示当前项，避免多层圆角框嵌套 */
function WorkbenchSubTabNav<T extends string>({
  ariaLabel,
  items,
  tab,
  onTabChange,
}: {
  ariaLabel: string
  items: { id: T; label: string; icon: ReactNode }[]
  tab: T
  onTabChange: (id: T) => void
}) {
  return (
    <nav className="workbench-subtab-nav flex flex-wrap gap-x-0.5 border-b border-white/15" aria-label={ariaLabel}>
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onTabChange(t.id)}
          className={`-mb-px inline-flex min-h-[2.5rem] items-center justify-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-none sm:px-4 ${
            tab === t.id
              ? 'border-pink-400 text-white'
              : 'border-transparent text-white/55 hover:border-white/25 hover:text-white/90'
          }`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </nav>
  )
}

function ImageToolsWorkbench({
  tab,
  onTabChange,
  canGenerate,
}: {
  tab: ImageToolsTabId
  onTabChange: (t: ImageToolsTabId) => void
  canGenerate: boolean
}) {
  return (
    <div className="space-y-6">
      <WorkbenchSubTabNav ariaLabel="图片工具" items={IMAGE_TOOLS_TAB_ITEMS} tab={tab} onTabChange={onTabChange} />
      {/* 保持挂载，避免切换 Tab 时 React 状态与未落盘的 IDB 写入丢失 */}
      <div className={tab === 'removeBg' ? 'block' : 'hidden'} aria-hidden={tab !== 'removeBg'}>
        <RemoveBackgroundWorkbench canGenerate={canGenerate} />
      </div>
      <div className={tab === 'upscale' ? 'block' : 'hidden'} aria-hidden={tab !== 'upscale'}>
        <ImageToolWorkbench tool="upscale" canGenerate={canGenerate} />
      </div>
      <div className={tab === 'compress' ? 'block' : 'hidden'} aria-hidden={tab !== 'compress'}>
        <ImageToolWorkbench tool="compress" canGenerate={canGenerate} />
      </div>
      <div className={tab === 'translate' ? 'block' : 'hidden'} aria-hidden={tab !== 'translate'}>
        <ImageToolWorkbench tool="translate" canGenerate={canGenerate} />
      </div>
    </div>
  )
}

function NavPrimary({ icon, label, active, onClick, onMouseEnter, collapsed, clickable = true, badge = '' }: any) {
  return (
    <button
      onMouseEnter={onMouseEnter}
      onClick={clickable ? onClick : undefined}
      title={collapsed ? label : undefined}
      className={`group relative w-full flex items-center ${collapsed ? 'justify-center px-2 overflow-visible' : 'space-x-3 px-4'} py-3 rounded-xl transition-[background-color,box-shadow] duration-200 ${
        active
          ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow-none'
          : clickable
            ? 'bg-transparent text-gray-700 hover:bg-white/[0.06]'
            : 'bg-transparent text-gray-600 cursor-default'
      }`}
    >
      {icon}
      {!collapsed && (
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">{label}</span>
          {badge ? (
            <span className="inline-flex items-center rounded-full border border-violet-300/40 bg-violet-500/12 px-1.5 py-[2px] text-[10px] font-medium leading-none tracking-wide text-violet-200/95 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
              {badge}
            </span>
          ) : null}
        </span>
      )}
      {collapsed && <span className="workbench-nav-tip">{label}</span>}
    </button>
  )
}

function NavSecondary({ icon, label, active, onClick, collapsed, className = '', badge = '' }: any) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center space-x-2 px-4 py-2 rounded-lg transition-[background-color,box-shadow] duration-75 ease-out text-sm ${
        active ? 'bg-purple-50 text-purple-700 shadow-none' : 'bg-transparent text-gray-600 hover:bg-white/[0.06]'
      } ${className}`}
    >
      {icon}
      {!collapsed && (
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate">{label}</span>
          {badge ? (
            <span className="inline-flex items-center rounded-full border border-violet-300/40 bg-violet-500/12 px-1.5 py-[2px] text-[10px] font-medium leading-none tracking-wide text-violet-200/95 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
              {badge}
            </span>
          ) : null}
        </span>
      )}
    </button>
  )
}

/** 展开侧栏：二级「图片工具」悬停显示三级目录 */
function NavSecondaryToolsFlyout({
  icon,
  label,
  active,
  flyoutItems,
  activeThirdId,
  onActivateDefault,
  onPickThird,
}: {
  icon: ReactNode
  label: string
  active: boolean
  flyoutItems: { id: string; label: string }[]
  activeThirdId: string | null
  onActivateDefault: () => void
  onPickThird: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={onActivateDefault}
        title={label}
        className={`w-full flex items-center justify-between gap-1 px-4 py-2 rounded-lg transition-[background-color,box-shadow] duration-75 ease-out text-sm ${
          active ? 'bg-purple-50 text-purple-700 shadow-none' : 'bg-transparent text-gray-600 hover:bg-white/[0.06]'
        }`}
      >
        <span className="flex items-center space-x-2 min-w-0">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <ChevronRight className={`w-3.5 h-3.5 shrink-0 opacity-45 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
      </button>
      {open ? (
        <div
          className="absolute left-full top-0 z-[90] pl-2 -ml-1 min-h-[36px]"
          role="menu"
          aria-label={`${label}子功能`}
        >
          <div className="workbench-sidebar-flyout rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl min-w-[10rem]">
            {flyoutItems.map((it) => (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                className={`w-full text-left px-3 py-2 text-sm transition-[background-color] duration-150 hover:bg-gray-50 ${
                  active && activeThirdId === it.id ? 'text-purple-700 font-medium bg-purple-50/60' : 'text-gray-700'
                }`}
                onClick={() => {
                  onPickThird(it.id)
                  setOpen(false)
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 收起侧栏：图标 + 悬停三级菜单 */
function NavCollapsedToolsFlyout({
  icon,
  label,
  active,
  flyoutItems,
  onClickDefault,
  onPickTool,
}: {
  icon: ReactNode
  label: string
  active: boolean
  flyoutItems: { id: string; label: string }[]
  onClickDefault: () => void
  onPickTool: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="relative w-full overflow-visible flex justify-center px-2"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <NavPrimary collapsed icon={icon} label={label} active={active} onClick={onClickDefault} />
      {open ? (
        <div
          className="absolute left-full top-0 z-[90] pl-2 -ml-1"
          role="menu"
          aria-label={`${label}子功能`}
        >
          <div className="workbench-sidebar-flyout rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl min-w-[9.5rem]">
            {flyoutItems.map((it) => (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                className="w-full text-left px-3 py-2 text-sm text-gray-700 transition-[background-color] duration-150 hover:bg-gray-50"
                onClick={() => {
                  onPickTool(it.id)
                  setOpen(false)
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TemplatesLibrary({
  onApplyVideo,
  onApplyImage,
}: {
  onApplyVideo: (preset: VideoTemplatePreset) => void
  onApplyImage: (preset: ImageTemplatePreset) => void
}) {
  const [tab, setTab] = useState<'video' | 'image'>('video')

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow-sm border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">模板与案例库</h2>
            <p className="text-sm text-gray-500 mt-1">选择模板后一键套用到创作页，快速开始生成。</p>
          </div>
          <div className="inline-flex rounded-xl border bg-gray-50 p-1">
            <button
              className={`px-4 py-2 rounded-lg text-sm ${tab === 'video' ? 'bg-white shadow text-purple-700' : 'text-gray-600'}`}
              onClick={() => setTab('video')}
            >
              视频模板
            </button>
            <button
              className={`px-4 py-2 rounded-lg text-sm ${tab === 'image' ? 'bg-white shadow text-purple-700' : 'text-gray-600'}`}
              onClick={() => setTab('image')}
            >
              图片模板
            </button>
          </div>
        </div>
      </div>

      {tab === 'video' && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {VIDEO_TEMPLATES.map((t) => (
            <div key={t.id} className="bg-white rounded-2xl border p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{t.title}</h3>
                <span className="text-xs px-2 py-1 rounded-full bg-purple-50 text-purple-700">视频</span>
              </div>
              <p className="text-sm text-gray-600 mt-2 min-h-[40px]">{t.subtitle}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {t.tags.map((x) => (
                  <span key={x} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                    {x}
                  </span>
                ))}
              </div>
              <button
                className="mt-4 w-full py-2.5 rounded-lg bg-gradient-to-r from-pink-500 to-purple-500 text-white text-sm font-medium"
                onClick={() => onApplyVideo(t.preset)}
              >
                一键套用到视频生成
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'image' && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {IMAGE_TEMPLATES.map((t) => (
            <div key={t.id} className="bg-white rounded-2xl border p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{t.title}</h3>
                <span className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">图片</span>
              </div>
              <p className="text-sm text-gray-600 mt-2 min-h-[40px]">{t.subtitle}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {t.tags.map((x) => (
                  <span key={x} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                    {x}
                  </span>
                ))}
              </div>
              <button
                className="mt-4 w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-sm font-medium"
                onClick={() => onApplyImage(t.preset)}
              >
                一键套用到电商套图
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FeedbackLite({
  open,
  onClose,
  currentPage,
}: {
  open: boolean
  onClose: () => void
  currentPage: string
}) {
  const [kind, setKind] = useState<'bug' | 'suggestion' | 'other'>('bug')
  const [desc, setDesc] = useState('')
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [recentTickets, setRecentTickets] = useState<SupportTicketItem[]>([])
  const [legacyCount, setLegacyCount] = useState(0)

  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const r = await listMySupportTickets(8)
        setRecentTickets(r.tickets || [])
      } catch (e: any) {
        setNotice(e?.message || '获取工单失败，请稍后重试')
        setRecentTickets([])
      }
      try {
        const raw = localStorage.getItem('tikgen.support.tickets.v1')
        const parsed = raw ? JSON.parse(raw) : []
        setLegacyCount(Array.isArray(parsed) ? parsed.length : 0)
      } catch {
        setLegacyCount(0)
      }
    })()
  }, [open])

  if (!open) return null

  const statusLabel: Record<string, string> = { open: '待处理', in_progress: '处理中', resolved: '已解决', closed: '已关闭' }
  const kindLabel: Record<string, string> = { bug: 'Bug/报错', suggestion: '功能建议', other: '其他' }

  const handleSubmit = async () => {
    if (!desc.trim()) {
      setNotice('请先填写问题描述')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const subject = `[${kindLabel[kind] || '反馈'}] ${currentPage}`
      const r = await createSupportTicket({
        kind,
        subject,
        content: desc.trim(),
        email: email.trim(),
        page: currentPage,
      })
      setNotice(`工单 ${r.ticket.ticket_no} 已提交，我们会尽快处理。`)
      setDesc('')
      const list = await listMySupportTickets(8)
      setRecentTickets(list.tickets || [])
    } catch (e: any) {
      setNotice(e?.message || '提交工单失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl border shadow-2xl">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-xl font-bold">工单/客服入口（轻量版）</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">问题类型</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg">
              <option value="bug">Bug/报错</option>
              <option value="suggestion">功能建议</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">问题描述</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={5} className="w-full px-3 py-2 border rounded-lg" placeholder="请描述复现步骤、期望结果、实际结果..." />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">联系邮箱（可选）</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="用于客服回访" />
          </div>
          {!!notice && <div className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg p-2">{notice}</div>}
          <div className="rounded-xl border p-3 bg-gray-50">
            <div className="text-sm font-semibold text-gray-800 mb-2">最近工单（服务端）</div>
            {recentTickets.length === 0 ? (
              <div className="text-xs text-gray-500">暂无记录</div>
            ) : (
              <div className="space-y-2 max-h-36 overflow-y-auto">
                {recentTickets.map((t) => (
                  <div key={t.id} className="text-xs bg-white border rounded-lg p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700">{t.ticket_no}</span>
                      <span className="text-gray-500">{new Date(t.created_at).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{kindLabel[t.kind] || t.kind}</span>
                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{statusLabel[t.status] || t.status}</span>
                    </div>
                    <div className="text-gray-600 mt-1">{t.content.slice(0, 40) || '(空)'}{t.content.length > 40 ? '...' : ''}</div>
                    {t.admin_note ? <div className="mt-1 text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">官方回复：{t.admin_note}</div> : null}
                  </div>
                ))}
              </div>
            )}
            {legacyCount > 0 ? <div className="mt-2 text-[11px] text-gray-500">本机历史记录 {legacyCount} 条（旧版）。</div> : null}
          </div>
        </div>
        <div className="p-5 border-t flex items-center justify-between">
          <div className="text-xs text-gray-500">提交后可在此处查看处理状态</div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 border rounded-lg">取消</button>
            <button disabled={busy} onClick={handleSubmit} className="px-4 py-2 rounded-lg bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-50">
              {busy ? '提交中...' : '提交工单'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HelpCenter() {
  const [keyword, setKeyword] = useState('')
  const faqSections = [
    {
      title: '账号与登录',
      items: [
        { q: '登录提示 Invalid login credentials 怎么办？', a: '确认账号密码；若忘记密码请使用“忘记密码”；若刚注册请先完成邮箱验证。' },
        { q: '点击重置密码邮件后没有进入设置新密码页面？', a: '建议使用无痕窗口打开链接；若仍异常，请附上截图与链接参数反馈。' },
      ],
    },
    {
      title: '电商套图/视频生成',
      items: [
        {
          q: '如何分享链接直达某个工具 Tab？',
          a: '在地址栏使用查询参数 workspace，例如：图片工具·高清放大为 ?workspace=image.tools.upscale；图片生成为 ?workspace=image.imageGen；电商套图为 ?workspace=image.ecommerce（旧版 ?workspace=image.generate 仍会打开电商套图）；视频生成为 ?workspace=video.generate；视频增强为 ?workspace=video.upscale。（旧链接 video.tools.*、video.analyze 仍会自动跳转。）进入页面后会同步地址栏。',
        },
        { q: '模型不可用怎么处理？', a: '切换到标记为可用的模型后重试；优先选择非“暂不可用”模型。' },
        { q: '生成超时怎么办？', a: '先去任务中心查看状态；若失败可点击“重试（保留参数）”，必要时降低分辨率/时长。' },
        { q: 'DALL·E 3 尺寸错误怎么办？', a: '该模型只支持固定三档尺寸。系统已自动映射，刷新后重试即可。' },
      ],
    },
    {
      title: '额度与套餐',
      items: [
        { q: '提示“今日额度已用尽”怎么办？', a: '说明已达到当日上限，可升级套餐或等待次日恢复。' },
      ],
    },
  ]

  const errorCodeGuide = [
    { code: 'MODEL_UNAVAILABLE', action: '切换可用模型后重试。' },
    { code: 'QUOTA_EXHAUSTED', action: '升级套餐或等待次日额度恢复。' },
    { code: 'UPSTREAM_TIMEOUT', action: '稍后重试，必要时降低分辨率/时长。' },
    { code: 'UPSTREAM_NO_TASKID', action: '上游返回异常，建议重试并保留 request id。' },
    { code: 'NO_OUTPUT', action: '上游未返回结果，建议更换模型重试。' },
    { code: 'UNKNOWN', action: '复制完整报错与任务ID，通过反馈入口提交。' },
  ]

  const kw = keyword.trim().toLowerCase()
  const filteredSections = faqSections
    .map((sec) => ({ ...sec, items: sec.items.filter((it) => !kw || `${it.q} ${it.a}`.toLowerCase().includes(kw)) }))
    .filter((sec) => sec.items.length > 0)

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border p-6 shadow-sm">
        <h2 className="text-xl font-bold">帮助中心 / FAQ</h2>
        <p className="text-sm text-gray-500 mt-1">先搜索关键词；若仍无法解决，请联系管理员。</p>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索关键词（登录失败、额度、模型不可用、超时）"
          className="w-full mt-4 px-4 py-2.5 border rounded-lg"
        />
      </div>

      <div className="bg-white rounded-2xl border p-6 shadow-sm">
        <h3 className="font-semibold mb-3">错误码对照</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {errorCodeGuide.map((x) => (
            <div key={x.code} className="rounded-lg border p-3 bg-gray-50">
              <div className="text-sm font-medium text-gray-900">{x.code}</div>
              <div className="text-sm text-gray-600 mt-1">{x.action}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {filteredSections.map((sec) => (
          <div key={sec.title} className="bg-white rounded-2xl border p-6 shadow-sm">
            <h3 className="font-semibold mb-3">{sec.title}</h3>
            <div className="space-y-3">
              {sec.items.map((item, idx) => (
                <details key={`${sec.title}-${idx}`} className="group border rounded-lg p-3">
                  <summary className="cursor-pointer font-medium text-gray-900">{item.q}</summary>
                  <p className="text-sm text-gray-600 mt-2 leading-6">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        ))}
        {filteredSections.length === 0 && <div className="bg-white rounded-2xl border p-8 text-center text-gray-500">没有匹配到结果，可换关键词试试。</div>}
      </div>
    </div>
  )
}

function VideoGenerator({
  templatePreset,
  onTemplateApplied,
  canGenerate,
}: {
  templatePreset: VideoTemplatePreset | null
  onTemplateApplied: () => void
  canGenerate: boolean
}) {
  type VideoGenTaskItem = {
    id: string
    createdAt: number
    prompt: string
    model: string
    size: string
    resolution: string
    durationSec: number
    taskId: string
    status: 'processing' | 'completed' | 'failed'
    progress: string
    statusText: string
    errorText: string
    errorCode: string
    videoUrl: string
  }

  const [refImagePreviewUrl, setRefImagePreviewUrl] = useState('')
  const [refImageDataUrl, setRefImageDataUrl] = useState('')
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [assetTab, setAssetTab] = useState<'user_upload' | 'ai_generated'>('user_upload')
  const [assetList, setAssetList] = useState<AssetItem[]>([])
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetSelectedIds, setAssetSelectedIds] = useState<Set<string>>(new Set())
  const [refUploadBusy, setRefUploadBusy] = useState(false)
  const assetCacheRef = useRef<{ user_upload: AssetItem[] | null; ai_generated: AssetItem[] | null }>({ user_upload: null, ai_generated: null })
  const videoRefUploadInputRef = useRef<HTMLInputElement | null>(null)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('sora-2')
  const [size, setSize] = useState<VideoAspect>('9:16')
  const [resolution, setResolution] = useState<VideoRes>('720p')
  const [durationSec, setDurationSec] = useState<VideoDur>(10)
  const [videoTasks, setVideoTasks] = useState<VideoGenTaskItem[]>([])
  const [activeTaskId, setActiveTaskId] = useState('')
  const [resultLightbox, setResultLightbox] = useState<{ url: string; title: string } | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [modalStep, setModalStep] = useState(1)
  const [productInfo, setProductInfo] = useState<ProductInfo>({ ...DEFAULT_PRODUCT_INFO })
  const [scripts, setScripts] = useState<string[]>([])
  const [scriptBatches, setScriptBatches] = useState<string[][]>([])
  const [scriptBatchIdx, setScriptBatchIdx] = useState(0)
  const [scriptRefreshCount, setScriptRefreshCount] = useState(0)
  const [selectedScript, setSelectedScript] = useState('')
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [isAiBusy, setIsAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [unavailableVideoMap, setUnavailableVideoMap] = useState<Record<string, string>>({})
  const aiJobRef = useRef(0)
  const pollRunningRef = useRef<Set<string>>(new Set())
  const unmountedRef = useRef(false)
  const [videoGenPersistenceReady, setVideoGenPersistenceReady] = useState(false)
  const skipVideoGenPersistRef = useRef(true)
  const resumeVideoGenPollRef = useRef<string[]>([])
  /** 已从 IndexedDB 恢复工作台时，避免可用性接口再把模型覆盖成「推荐模型」 */
  const restoredVideoGenWorkspaceRef = useRef(false)

  const updateVideoTask = useCallback((taskId: string, patch: Partial<VideoGenTaskItem>) => {
    setVideoTasks((prev) => prev.map((t) => (t.taskId === taskId ? { ...t, ...patch } : t)))
  }, [])

  const activeTask = useMemo<VideoGenTaskItem | null>(() => {
    if (!videoTasks.length) return null
    const picked = activeTaskId ? videoTasks.find((t) => t.taskId === activeTaskId) : null
    if (picked) return picked
    return videoTasks.find((t) => t.status === 'processing') || videoTasks[0]
  }, [videoTasks, activeTaskId])

  const processingCount = useMemo(() => videoTasks.filter((t) => t.status === 'processing').length, [videoTasks])

  useEffect(() => {
    void (async () => {
      try {
        const w = await tikgenIgIdbGet<VideoGeneratorWorkspaceV1>(TIKGEN_IG_IDB.videoGeneratorWorkspace)
        if (w && w.v === 1) {
          restoredVideoGenWorkspaceRef.current = true
          setPrompt(String(w.prompt || ''))
          setModel(String(w.model || 'sora-2'))
          setSize((w.size as VideoAspect) || '9:16')
          setResolution((w.resolution as VideoRes) || '720p')
          setDurationSec((Number(w.durationSec) as VideoDur) || 10)
          const dataRef = String(w.refImageDataUrl || '')
          const prevRaw = String(w.refImagePreviewUrl || '')
          const previewOk = prevRaw && !prevRaw.startsWith('blob:') ? prevRaw : dataRef
          setRefImagePreviewUrl(previewOk)
          setRefImageDataUrl(dataRef)
          const pi = w.productInfo as ProductInfo | undefined
          if (pi && typeof pi === 'object') {
            setProductInfo({
              ...DEFAULT_PRODUCT_INFO,
              name: String(pi.name || ''),
              category: String(pi.category || ''),
              sellingPoints: String(pi.sellingPoints || ''),
              targetAudience: String(pi.targetAudience || ''),
              language: String(pi.language || DEFAULT_PRODUCT_INFO.language),
              targetPlatform: String((pi as ProductInfo).targetPlatform || DEFAULT_PRODUCT_INFO.targetPlatform),
              targetMarket: String((pi as ProductInfo).targetMarket || DEFAULT_PRODUCT_INFO.targetMarket),
            })
          }
          setScripts(Array.isArray(w.scripts) ? w.scripts.map(String) : [])
          setScriptBatches(Array.isArray(w.scriptBatches) ? w.scriptBatches.map((b) => (Array.isArray(b) ? b.map(String) : [])) : [])
          setScriptBatchIdx(Number(w.scriptBatchIdx) || 0)
          setScriptRefreshCount(Number(w.scriptRefreshCount) || 0)
          setSelectedScript(String(w.selectedScript || ''))
          setOptimizedPrompt(String(w.optimizedPrompt || ''))
          setTags(Array.isArray(w.tags) ? w.tags.map(String) : [])
          const restoredTasks = Array.isArray((w as any).videoTasks)
            ? ((w as any).videoTasks as any[])
                .map((x) => ({
                  id: String(x?.id || x?.taskId || crypto.randomUUID()),
                  createdAt: Number(x?.createdAt || Date.now()),
                  prompt: String(x?.prompt || ''),
                  model: String(x?.model || w.model || 'sora-2'),
                  size: String(x?.size || w.size || '9:16'),
                  resolution: String(x?.resolution || w.resolution || '720p'),
                  durationSec: Number(x?.durationSec || w.durationSec || 10),
                  taskId: String(x?.taskId || ''),
                  status: x?.status === 'completed' || x?.status === 'failed' ? x.status : 'processing',
                  progress: String(x?.progress || '0%'),
                  statusText: String(x?.statusText || ''),
                  errorText: String(x?.errorText || ''),
                  errorCode: String(x?.errorCode || 'UNKNOWN'),
                  videoUrl: String(x?.videoUrl || ''),
                }))
                .filter((x) => x.taskId)
            : []
          if (restoredTasks.length) {
            setVideoTasks(restoredTasks.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20))
            const at = String((w as any).activeTaskId || restoredTasks[0]?.taskId || '')
            setActiveTaskId(at)
            resumeVideoGenPollRef.current = restoredTasks.filter((x) => x.status === 'processing').map((x) => x.taskId)
          } else if (w.taskId) {
            const oldOne: VideoGenTaskItem = {
              id: crypto.randomUUID(),
              createdAt: Date.now(),
              prompt: String(w.prompt || ''),
              model: String(w.model || 'sora-2'),
              size: String(w.size || '9:16'),
              resolution: String(w.resolution || '720p'),
              durationSec: Number(w.durationSec || 10),
              taskId: String(w.taskId || ''),
              status: w.generatedVideo ? 'completed' : w.errorText ? 'failed' : 'processing',
              progress: String(w.progress || '0%'),
              statusText: String(w.statusText || ''),
              errorText: String(w.errorText || ''),
              errorCode: String(w.errorCode || 'UNKNOWN'),
              videoUrl: String(w.generatedVideo || ''),
            }
            setVideoTasks([oldOne])
            setActiveTaskId(oldOne.taskId)
            resumeVideoGenPollRef.current = oldOne.status === 'processing' ? [oldOne.taskId] : []
          }
        }
      } catch {
        // ignore
      }
      skipVideoGenPersistRef.current = true
      setVideoGenPersistenceReady(true)
    })()
  }, [])

  useEffect(() => {
    if (!videoGenPersistenceReady) return
    if (skipVideoGenPersistRef.current) {
      skipVideoGenPersistRef.current = false
      return
    }
    const refPrev =
      refImagePreviewUrl.startsWith('blob:') && refImageDataUrl ? refImageDataUrl : refImagePreviewUrl
    const snap: VideoGeneratorWorkspaceV1 = {
      v: 1,
      prompt,
      model,
      size,
      resolution,
      durationSec,
      refImagePreviewUrl: refPrev,
      refImageDataUrl,
      productInfo: { ...productInfo } as unknown as Record<string, unknown>,
      scripts,
      scriptBatches,
      scriptBatchIdx,
      scriptRefreshCount,
      selectedScript,
      optimizedPrompt,
      tags,
      generatedVideo: activeTask?.videoUrl || '',
      taskId: activeTask?.taskId || '',
      progress: activeTask?.progress || '0%',
      statusText: activeTask?.statusText || '',
      errorText: activeTask?.errorText || '',
      errorCode: activeTask?.errorCode || 'UNKNOWN',
      isGenerating: activeTask?.status === 'processing',
      videoTasks: videoTasks.slice(0, 20),
      activeTaskId: activeTask?.taskId || activeTaskId,
    }
    void tikgenIgIdbSet(TIKGEN_IG_IDB.videoGeneratorWorkspace, snap)
  }, [
    videoGenPersistenceReady,
    prompt,
    model,
    size,
    resolution,
    durationSec,
    refImagePreviewUrl,
    refImageDataUrl,
    productInfo,
    scripts,
    scriptBatches,
    scriptBatchIdx,
    scriptRefreshCount,
    selectedScript,
    optimizedPrompt,
    tags,
    activeTask,
    videoTasks,
    activeTaskId,
  ])

  useEffect(() => {
    ;(async () => {
      try {
        const token = localStorage.getItem('tikgen.accessToken') || ''
        if (!token) return
        const r = await getModelAvailabilityAPI(token)
        const map: Record<string, string> = {}
        for (const x of r.video || []) map[String(x.id)] = String(x.reason || '暂不可用')
        try {
          const resp = await fetch('/api/model-controls?type=video')
          const data = await resp.json()
          if (data?.success && Array.isArray(data.controls)) {
            let recommended = ''
            for (const c of data.controls) {
              const id = String(c.model_id || '')
              if (!id) continue
              if (c.enabled === false) map[id] = String(c.note || '后台已禁用')
              if (!recommended && c.recommended === true && c.enabled !== false) recommended = id
            }
            if (
              recommended &&
              VIDEO_MODELS.some((m) => m.id === recommended) &&
              !restoredVideoGenWorkspaceRef.current
            ) {
              setModel(recommended)
            }
          }
        } catch {
          // ignore controls loading failures
        }
        setUnavailableVideoMap(map)
      } catch {
        // ignore
      }
    })()
  }, [])

  // NOTE: 能力探测会触发聚合API计费请求，已在后端默认禁用。

  const caps = useMemo<VideoModelCaps>(() => {
    const base =
      VIDEO_MODEL_CAPS[model] || {
        aspectRatios: ['9:16', '16:9'],
        resolutions: ['720p', '1080p'],
        durations: [10, 15],
        defaults: { aspectRatio: '9:16', resolution: '720p', durationSec: 10 },
      }
    return base
  }, [model])

  // 模型切换时：如果当前选择不被支持，自动回落到该模型默认值
  useEffect(() => {
    if (!caps.aspectRatios.includes(size)) setSize(caps.defaults.aspectRatio)
    if (!caps.resolutions.includes(resolution)) setResolution(caps.defaults.resolution)
    if (!caps.durations.includes(durationSec)) setDurationSec(caps.defaults.durationSec)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  useEffect(() => {
    if (!templatePreset) return
    if (templatePreset.model) setModel(String(templatePreset.model))
    if (templatePreset.aspectRatio) setSize(String(templatePreset.aspectRatio) as VideoAspect)
    if (templatePreset.resolution) setResolution(String(templatePreset.resolution) as VideoRes)
    if (templatePreset.durationSec) setDurationSec(Number(templatePreset.durationSec) as VideoDur)
    setPrompt(String(templatePreset.prompt || ''))
    onTemplateApplied()
  }, [templatePreset, onTemplateApplied])

  const revokeVideoRefBlobUrl = (url: string) => {
    if (url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }
  }

  const clearVideoRefImage = () => {
    setRefImagePreviewUrl((prev) => {
      revokeVideoRefBlobUrl(prev)
      return ''
    })
    setRefImageDataUrl('')
  }

  const handleVideoRefLocalFiles = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f || !String(f.type || '').startsWith('image/')) return
    setRefImagePreviewUrl((prev) => {
      revokeVideoRefBlobUrl(prev)
      return URL.createObjectURL(f)
    })
    setRefImageDataUrl('')
    setRefUploadBusy(true)
    try {
      const dataUrl = await fileToDataUrl(f)
      setRefImageDataUrl(dataUrl)
      // 资产入库走后台，不阻塞「选图完成」体感（与其它产品「秒显预览」一致）
      void safeArchiveAsset({
        source: 'user_upload',
        type: 'image',
        url: dataUrl,
        name: f.name,
        metadata: { from: 'video_generator_ref', mime: f.type, size: f.size },
      })
    } finally {
      setRefUploadBusy(false)
    }
  }

  const loadVideoAssetPicker = async (source: 'user_upload' | 'ai_generated') => {
    const cached = assetCacheRef.current[source]
    if (cached && cached.length) {
      setAssetList(cached)
      return
    }
    setAssetBusy(true)
    try {
      const r = await listAssetsAPI({ source, type: 'image', limit: 60, offset: 0 })
      const rows = (r.assets || []).filter((x) => x.type === 'image')
      setAssetList(rows)
      assetCacheRef.current[source] = rows
    } finally {
      setAssetBusy(false)
    }
  }

  useEffect(() => {
    if (!showAssetPicker) return
    void loadVideoAssetPicker(assetTab)
  }, [showAssetPicker, assetTab])

  const toggleVideoAssetPick = (id: string) => {
    setAssetSelectedIds((prev) => {
      if (prev.has(id)) return new Set()
      return new Set([id])
    })
  }

  const confirmVideoAssetPick = () => {
    const picked = assetList.find((x) => assetSelectedIds.has(x.id))
    setAssetSelectedIds(new Set())
    setShowAssetPicker(false)
    if (!picked) return
    setRefImagePreviewUrl((prev) => {
      revokeVideoRefBlobUrl(prev)
      return picked.url
    })
    setRefImageDataUrl(picked.url)
  }

  const renderScriptStructured = (raw: string) => {
    let text = String(raw || '')
    // 兼容服务端/模型偶发把 {"scripts":[...]} 整段塞进单条脚本
    if (text.trim().startsWith('{') && text.includes('"scripts"')) {
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed?.scripts) && parsed.scripts[0]) text = String(parsed.scripts[0])
      } catch {
        // ignore
      }
    }

    // 兼容 [镜头1]/[开场钩子] + 英文管道符
    text = text
      .replace(/\[开场钩子\]/g, '【开场钩子】')
      .replace(/\[收尾CTA\]/g, '【收尾CTA】')
      .replace(/\[镜头(\d+)\]/g, '【镜头$1】')
      .replace(/\s*\|\s*/g, '｜')

    // 一次性解决：模型经常把整条脚本输出成“一段话”，但内部含有【镜头X】标记
    // 这里把这些标记强制断行，确保结构化解析稳定
    text = text
      .replace(/\s*(【开场钩子】)/g, '\n$1')
      .replace(/\s*(【镜头\d+】)/g, '\n$1')
      .replace(/\s*(【收尾CTA】)/g, '\n$1')
      .replace(/^\s*\n/, '')
      .replace(/\n{2,}/g, '\n')

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)

    const hook = lines.find((l) => l.includes('【开场钩子】'))?.replace('【开场钩子】', '').trim()
    const cta = lines.find((l) => l.includes('【收尾CTA】'))?.replace('【收尾CTA】', '').trim()
    const shots = lines
      .filter((l) => l.startsWith('【镜头'))
      .map((l) => {
        const m = l.match(/^【镜头(\d+)】(.*)$/)
        const idx = m?.[1] || ''
        const rest = (m?.[2] || '').trim()
        const parts = rest.split('｜').map((p) => p.trim())
        const get = (prefix: string) => parts.find((p) => p.startsWith(prefix))?.slice(prefix.length).trim() || ''
        return { idx, scene: get('画面：'), subtitle: get('字幕：'), voice: get('口播：') }
      })

    return (
      <div className="space-y-3">
        {hook && (
          <div className="rounded-xl bg-white/60 border border-purple-200 p-3">
            <div className="text-xs text-purple-600 font-medium mb-1">开场钩子</div>
            <div className="text-sm text-gray-900">{hook}</div>
          </div>
        )}
        {shots.length > 0 && (
          <div className="rounded-xl bg-white/60 border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 text-xs font-medium text-gray-600">镜头清单</div>
            <div className="divide-y">
              {shots.map((s, i) => (
                <div key={i} className="p-3 grid grid-cols-12 gap-3">
                  <div className="col-span-2">
                    <div className="inline-flex items-center px-2 py-1 rounded-lg bg-purple-100 text-purple-700 text-xs font-semibold">
                      镜头{s.idx || i + 1}
                    </div>
                  </div>
                  <div className="col-span-10 space-y-1 text-sm">
                    {s.scene && <div><span className="text-gray-500">画面：</span><span className="text-gray-900">{s.scene}</span></div>}
                    {s.subtitle && <div><span className="text-gray-500">字幕：</span><span className="text-gray-900">{s.subtitle}</span></div>}
                    {s.voice && <div><span className="text-gray-500">口播：</span><span className="text-gray-900">{s.voice}</span></div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {cta && (
          <div className="rounded-xl bg-white/60 border border-emerald-200 p-3">
            <div className="text-xs text-emerald-700 font-medium mb-1">收尾 CTA</div>
            <div className="text-sm text-gray-900">{cta}</div>
          </div>
        )}
        {(shots.length === 0 || !cta) && raw && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <div className="text-xs font-medium text-amber-700 mb-1">原文（未完整解析为分镜）</div>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">{raw}</div>
          </div>
        )}
      </div>
    )
  }

  useEffect(() => {
    return () => {
      unmountedRef.current = true
    }
  }, [])

  const handlePromptGen = async () => {
    if (!refImageDataUrl) { alert('请先上传参考图'); return }
    setShowModal(true)
    setModalStep(1)
    setAiError('')
    const jobId = ++aiJobRef.current
    setIsAiBusy(true)
    try {
      const parsed = await parseProductInfo({ refImage: refImageDataUrl, language: productInfo.language || '简体中文', kind: 'video' })
      if (jobId !== aiJobRef.current) return
      setProductInfo(parsed)
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '解析失败')
    } finally {
      if (jobId !== aiJobRef.current) return
      setIsAiBusy(false)
    }
  }

  const handleNext = async () => {
    setAiError('')
    if (modalStep === 1) {
      setModalStep(2)
      const jobId = ++aiJobRef.current
      setIsAiBusy(true)
      try {
        const r = await generateVideoScripts({
          product: productInfo,
          language: productInfo.language,
          refImage: refImageDataUrl,
          durationSec,
          aspectRatio: size,
          resolution,
        })
        if (jobId !== aiJobRef.current) return
        setScripts(r.scripts)
        setScriptBatches([r.scripts])
        setScriptBatchIdx(0)
        setScriptRefreshCount(0)
        setSelectedScript(r.scripts[0] || '')
      } catch (e: any) {
        if (jobId !== aiJobRef.current) return
        setAiError(e?.message || '脚本生成失败')
      } finally {
        if (jobId !== aiJobRef.current) return
        setIsAiBusy(false)
      }
      return
    }
    if (modalStep === 2) {
      setModalStep(3)
      setOptimizedPrompt(selectedScript)
      return
    }
    setShowModal(false)
    setPrompt(optimizedPrompt || selectedScript)
  }

  const handlePrev = () => {
    if (modalStep === 1) return
    if (modalStep === 2) setModalStep(1)
    else setModalStep(2)
  }

  const handleRefreshScripts = async () => {
    if (modalStep !== 2) return
    setAiError('')
    if (scriptBatches.length >= 3) {
      const nextIdx = (scriptBatchIdx + 1) % 3
      setScriptBatchIdx(nextIdx)
      const next = scriptBatches[nextIdx] || []
      setScripts(next)
      setSelectedScript(next[0] || '')
      return
    }

    setIsAiBusy(true)
    const jobId = ++aiJobRef.current
    try {
      const r = await generateVideoScripts({
        product: productInfo,
        language: productInfo.language,
        refImage: refImageDataUrl,
        durationSec,
        aspectRatio: size,
        resolution,
      })
      if (jobId !== aiJobRef.current) return
      setScriptBatches((prev) => [...prev, r.scripts])
      setScriptBatchIdx(scriptBatches.length)
      setScriptRefreshCount((c) => Math.min(2, c + 1))
      setScripts(r.scripts)
      setSelectedScript(r.scripts[0] || '')
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '脚本生成失败')
    } finally {
      if (jobId !== aiJobRef.current) return
      setIsAiBusy(false)
    }
  }

  const handleOptimize = async (tag: string) => {
    const newTags = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]
    setTags(newTags)
    setAiError('')
    const jobId = ++aiJobRef.current
    setIsAiBusy(true)
    try {
      const r = await beautifyScript({ script: selectedScript, tags: newTags, language: productInfo.language })
      if (jobId !== aiJobRef.current) return
      setOptimizedPrompt(r.optimized)
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '优化失败')
    } finally {
      if (jobId !== aiJobRef.current) return
      setIsAiBusy(false)
    }
  }

  const handleCloseAiBusy = () => {
    aiJobRef.current += 1 // invalidate in-flight AI responses
    setIsAiBusy(false)
    setAiError('')
    if (modalStep === 1) {
      setShowModal(false)
      return
    }
    if (modalStep === 2) {
      setModalStep(1)
      return
    }
    setModalStep(2)
  }

  const finalVideoPrompt = useMemo(() => {
    const base = optimizedPrompt || selectedScript || prompt
    const info = [
      `[视频参数]`,
      `- 总时长：约 ${durationSec}s`,
      `- 画幅：${size}`,
      `- 分辨率：${resolution}`,
      ``,
      `[商品信息]`,
      `- 名称：${productInfo.name}`,
      `- 类目：${productInfo.category}`,
      `- 核心卖点：${productInfo.sellingPoints}`,
      `- 目标人群：${productInfo.targetAudience}`,
      `- 输出语言：${productInfo.language}`,
    ].join('\n')

    const storyboardScript = String(base || '').trim()

    return [
      '你是电商短视频导演。请生成一条写实的商品展示视频（非动画）。',
      '',
      '【硬性要求】',
      `- 总时长：约 ${durationSec}s（镜头节奏与信息密度必须匹配该时长，避免拖沓或塞不下）`,
      `- 画幅：${size}；分辨率：${resolution}`,
      '- 画面：干净、高级、写实，光影自然；突出商品细节与使用动作/使用场景',
      '- 合规：避免医疗/绝对化/夸大承诺；不出现“保证/治愈/永久/100%”等表述',
      '- 文案展示：不要把整段脚本文字铺满画面；字幕仅保留关键短句即可',
      '',
      '【执行方式】',
      '- 请严格按下方“镜头化脚本”执行：保持镜头顺序、镜头数量、每个镜头的核心含义不变',
      '- 你可以在每个镜头里补充更具体的画面细节（景别/镜头运动/光影/道具/背景），但不要新增虚构参数/功效/价格优惠信息',
      '',
      info,
      '',
      '[镜头化脚本（必须执行）]',
      storyboardScript || '(脚本为空)',
    ].join('\n')
  }, [optimizedPrompt, selectedScript, prompt, productInfo, size, resolution, durationSec])

  const pollVideoGenerateTask = useCallback(
    async (submitTaskId: string, meta: { model: string; size: string; resolution: string; durationSec: number }) => {
      if (pollRunningRef.current.has(submitTaskId)) return
      pollRunningRef.current.add(submitTaskId)
      try {
        for (let i = 0; i < 120; i++) {
          if (unmountedRef.current) return
          await new Promise((r) => setTimeout(r, 5000))
          if (unmountedRef.current) return

          const s = await checkVideoStatus(submitTaskId)
          updateVideoTask(submitTaskId, {
            progress: s.progress || '0%',
            statusText: `生成中... ${s.progress || ''}`.trim(),
          })

          const status = (s.status || '').toLowerCase()
          if (status === 'succeeded' || status === 'success' || status === 'completed') {
            if (!s.videoUrl) throw new Error('任务完成但未返回视频地址')
            updateVideoTask(submitTaskId, {
              status: 'completed',
              videoUrl: s.videoUrl,
              progress: '100%',
              statusText: '生成完成',
              errorText: '',
              errorCode: 'UNKNOWN',
            })
            Sentry.captureMessage('video_generation_success', { level: 'info', extra: { taskId: submitTaskId, model: meta.model } })
            await safeArchiveAsset({
              source: 'ai_generated',
              type: 'video',
              url: s.videoUrl,
              name: `video-${Date.now()}.mp4`,
              metadata: { from: 'video_generator', model: meta.model, size: meta.size, resolution: meta.resolution, durationSec: meta.durationSec },
            })
            return
          }

          if (status === 'failed' || status === 'error') {
            const err: any = new Error(s.failReason || '生成失败')
            err.code = s.failCode || 'UNKNOWN'
            throw err
          }
        }

        const err: any = new Error('生成超时，请稍后在任务列表中查看')
        err.code = 'UPSTREAM_TIMEOUT'
        throw err
      } catch (e: any) {
        Sentry.captureException(e, { extra: { scene: 'video_generate', model: meta.model } })
        updateVideoTask(submitTaskId, {
          status: 'failed',
          errorText: e?.message || '生成失败',
          errorCode: e?.code || 'UNKNOWN',
          statusText: '',
        })
      } finally {
        pollRunningRef.current.delete(submitTaskId)
      }
    },
    [updateVideoTask],
  )

  useEffect(() => {
    if (!videoGenPersistenceReady || resumeVideoGenPollRef.current.length === 0) return
    const queue = [...resumeVideoGenPollRef.current]
    resumeVideoGenPollRef.current = []
    queue.forEach((tid) => {
      const t = videoTasks.find((x) => x.taskId === tid)
      if (!t) return
      void pollVideoGenerateTask(tid, {
        model: t.model,
        size: t.size,
        resolution: t.resolution,
        durationSec: t.durationSec,
      })
    })
  }, [videoGenPersistenceReady, videoTasks, pollVideoGenerateTask])

  const handleGenerate = async () => {
    if (!canGenerate) {
      alert('请先完成本产品内付费（购买套餐）后再生成视频')
      return
    }
    if (!refImageDataUrl) { alert('请先上传参考图'); return }
    if (!prompt) { alert('请输入视频文案描述'); return }

    try {
      const submit = await generateVideoAPI(finalVideoPrompt, model, { aspectRatio: size, durationSec, resolution, refImage: refImageDataUrl })
      const item: VideoGenTaskItem = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        prompt: String(prompt || '').slice(0, 160),
        model,
        size,
        resolution,
        durationSec,
        taskId: submit.taskId,
        status: 'processing',
        progress: '0%',
        statusText: submit.message || '视频生成中...',
        errorText: '',
        errorCode: 'UNKNOWN',
        videoUrl: '',
      }
      setVideoTasks((prev) => [item, ...prev.filter((x) => x.taskId !== item.taskId)].slice(0, 20))
      setActiveTaskId(item.taskId)
      void pollVideoGenerateTask(item.taskId, {
        model: item.model,
        size: item.size,
        resolution: item.resolution,
        durationSec: item.durationSec,
      })
    } catch (e: any) {
      Sentry.captureException(e, { extra: { scene: 'video_generate', model } })
      const failed: VideoGenTaskItem = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        prompt: String(prompt || '').slice(0, 160),
        model,
        size,
        resolution,
        durationSec,
        taskId: `failed_${Date.now()}`,
        status: 'failed',
        progress: '0%',
        statusText: '',
        errorText: e?.message || '生成失败',
        errorCode: e?.code || 'UNKNOWN',
        videoUrl: '',
      }
      setVideoTasks((prev) => [failed, ...prev].slice(0, 20))
      setActiveTaskId(failed.taskId)
    }
  }

  if (showModal) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
          <div className="p-6 border-b flex items-center justify-between"><h3 className="text-xl font-bold">一键生成提示词</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5" /></button></div>
          <div className="px-6 py-4 border-b bg-gray-50 flex items-center">
            {['商品信息解析', '视频脚本', '提示词优化'].map((s, i) => (
              <div key={i} className="flex items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${modalStep > i + 1 ? 'bg-green-500 text-white' : modalStep === i + 1 ? 'bg-purple-500 text-white' : 'bg-gray-300'}`}>
                  {modalStep > i + 1 ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`ml-2 text-sm ${modalStep === i + 1 ? 'font-medium' : 'text-gray-400'}`}>{s}</span>
                {i < 2 && <div className="flex-1 h-0.5 bg-gray-200 mx-4" />}
              </div>
            ))}
          </div>
          <div className="p-6">
            {modalStep === 1 && (
              <div className="space-y-4">
                {refImagePreviewUrl && <img src={refImagePreviewUrl} alt="参考图" className="max-h-40 rounded-lg" />}
                {['name', 'category', 'sellingPoints', 'targetAudience'].map((f) => (
                  <div key={f}>
                    <label className="block text-sm font-medium mb-1">
                      {f === 'name' ? '产品名称' : f === 'category' ? '产品类目' : f === 'sellingPoints' ? '核心卖点' : '目标人群'}
                    </label>
                    <input
                      value={productInfo[f as keyof typeof productInfo]}
                      onChange={(e) => setProductInfo({ ...productInfo, [f]: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                    />
          </div>
                ))}
                <div>
                  <label className="block text-sm font-medium mb-1">视频语言</label>
                  <select
                    value={productInfo.language}
                    onChange={(e) => setProductInfo({ ...productInfo, language: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                  >
                    <option>简体中文</option>
                    <option>English</option>
                    <option>日本語</option>
                  </select>
                </div>

                {/* 尺寸/时长已移到主页面参考图下方配置 */}
              </div>
            )}
            {modalStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">选择或编辑视频脚本：</p>
                  <button onClick={handleRefreshScripts} className="text-purple-600 text-sm flex items-center">
                    <RefreshCw className="w-4 h-4 mr-1" /> 换一批
                  </button>
                </div>
                <div className="text-xs text-gray-400">
                  批次：{scriptBatchIdx + 1}/{Math.max(1, scriptBatches.length)}（最多生成3批，之后循环切换）
                </div>
                {scripts.map((s, i) => (
                  <div
                    key={i}
                    className={`p-4 border-2 rounded-lg ${selectedScript === s ? 'border-purple-500 bg-purple-50' : 'border-gray-200'}`}
                    onClick={() => setSelectedScript(s)}
                  >
                    <div className="flex items-start">
                      <div className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center mr-3 ${selectedScript === s ? 'border-purple-500 bg-purple-500' : 'border-gray-300'}`}>
                        {selectedScript === s && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="w-full">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs text-gray-500">脚本{i + 1}</div>
                          <button
                            className="text-xs text-purple-700 hover:text-purple-800"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingIdx((cur) => (cur === i ? null : i))
                            }}
                          >
                            {editingIdx === i ? '完成编辑' : '编辑'}
                          </button>
                        </div>
                        {editingIdx === i ? (
                          <textarea
                            value={s}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const v = e.target.value
                              setScripts((prev) => prev.map((x, idx) => (idx === i ? v : x)))
                              setScriptBatches((prev) => prev.map((batch, bi) => (bi === scriptBatchIdx ? batch.map((x, idx) => (idx === i ? v : x)) : batch)))
                              if (selectedScript === s) setSelectedScript(v)
                            }}
                            className="w-full bg-white/70 border rounded-xl px-3 py-2 outline-none text-sm leading-6 resize-y"
                            rows={10}
                          />
                        ) : (
                          renderScriptStructured(s)
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {modalStep === 3 && (
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500 mb-2">当前脚本</p>
                  <p className="whitespace-pre-wrap text-sm text-gray-900">{selectedScript}</p>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">提示词美化（风格标签）</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      '真人感',
                      '高端',
                      '简洁',
                      '详实',
                      '电影感',
                      '强钩子',
                      '痛点对比',
                      '测评感',
                      '种草口吻',
                      'TikTok风格',
                      '口播优先',
                      '字幕更强',
                      '价格友好（不报价格）',
                    ].map((tag) => (
                      <button
                        key={tag}
                        onClick={() => handleOptimize(tag)}
                        className={`px-3 py-1 rounded-full text-sm ${
                          tags.includes(tag) ? 'bg-purple-500 text-white' : 'bg-gray-100'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">提示：可多选组合风格；优化会保持镜头结构不变，仅调整表达与镜头语言。</p>
                </div>
                {optimizedPrompt && (
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <p className="text-sm text-purple-600 mb-1">优化后</p>
                    <p className="whitespace-pre-wrap text-sm text-gray-900">{optimizedPrompt}</p>
                  </div>
                )}
              </div>
            )}
            {!!aiError && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{aiError}</div>}
          </div>
          {isAiBusy && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center rounded-2xl">
              <div className="relative bg-white shadow-lg border rounded-2xl px-8 py-7 min-w-[360px] max-w-md w-[min(100%,420px)]">
                <button
                  onClick={handleCloseAiBusy}
                  className="absolute right-3 top-3 p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-white/10"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex flex-col items-center text-center pt-1">
                  <RefreshCw className="w-5 h-5 text-purple-600 animate-spin mb-3 shrink-0" />
                  <div className="font-medium">
                    {modalStep === 3 ? '视频脚本优化中' : modalStep === 2 ? '视频脚本创作中' : '商品信息AI解析中'}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">请稍等，预计几秒钟...</div>
                </div>
              </div>
            </div>
          )}
          <div className="p-6 border-t flex items-center justify-between">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg">取消</button>
            <div className="flex items-center gap-3">
              {modalStep > 1 && (
                <button onClick={handlePrev} className="px-4 py-2 border rounded-lg">上一步</button>
              )}
              <button disabled={isAiBusy} onClick={handleNext} className="px-4 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50">
                {isAiBusy ? '处理中...' : modalStep === 3 ? '确认' : '下一步'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="tikgen-panel rounded-2xl p-6">
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2 text-white/75">上传参考图</label>
          <div
            className={`tikgen-ref-dropzone rounded-xl p-2.5 relative transition-shadow ${refImagePreviewUrl ? 'cursor-default' : 'cursor-pointer'}`}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDrop={async (e) => {
              e.preventDefault()
              e.stopPropagation()
              await handleVideoRefLocalFiles(e.dataTransfer?.files || null)
            }}
            onClick={() => {
              if (!refImagePreviewUrl) videoRefUploadInputRef.current?.click()
            }}
          >
            <input
              ref={videoRefUploadInputRef}
              type="file"
              accept="image/*"
              disabled={refUploadBusy}
              onChange={async (e: any) => {
                await handleVideoRefLocalFiles(e.target.files || null)
                e.target.value = ''
              }}
              className="hidden"
            />
            {refImagePreviewUrl ? (
              <div className="flex flex-col items-center justify-center gap-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                <img src={refImagePreviewUrl} alt="参考图" className="max-h-40 mx-auto rounded-lg ring-1 ring-inset ring-white/12" />
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={refUploadBusy}
                    onClick={() => videoRefUploadInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] text-white/80 ring-1 ring-inset ring-white/[0.07] hover:bg-white/[0.08] hover:ring-white/[0.12] disabled:opacity-50"
                  >
                    选择文件
                  </button>
                  <button
                    type="button"
                    disabled={refUploadBusy}
                    onClick={() => {
                      setAssetSelectedIds(new Set())
                      setShowAssetPicker(true)
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] text-white/80 ring-1 ring-inset ring-white/[0.07] hover:bg-white/[0.08] hover:ring-white/[0.12] disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    <Folder className="w-3.5 h-3.5 text-white/45" aria-hidden />
                    从资产库选择
                  </button>
                  <button
                    type="button"
                    disabled={refUploadBusy}
                    onClick={clearVideoRefImage}
                    className="px-3 py-1.5 rounded-lg text-xs text-red-300/95 ring-1 ring-inset ring-red-400/22 hover:bg-red-500/12 disabled:opacity-50"
                  >
                    清除
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[104px] flex-col items-center justify-center gap-2.5 py-4 text-center">
                <Upload className="w-7 h-7 mx-auto text-white/35" />
                <div className="text-sm font-medium text-white/75">点击或拖拽上传</div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={refUploadBusy}
                    onClick={(e) => {
                      e.stopPropagation()
                      videoRefUploadInputRef.current?.click()
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs cursor-pointer bg-white/[0.04] text-white/80 ring-1 ring-inset ring-white/[0.07] hover:bg-white/[0.08] hover:ring-white/[0.12] disabled:opacity-50"
                  >
                    选择文件
                  </button>
                  <button
                    type="button"
                    disabled={refUploadBusy}
                    onClick={(e) => {
                      e.stopPropagation()
                      setAssetSelectedIds(new Set())
                      setShowAssetPicker(true)
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] text-white/80 ring-1 ring-inset ring-white/[0.07] hover:bg-white/[0.08] hover:ring-white/[0.12] disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    <Folder className="w-3.5 h-3.5 text-white/45" aria-hidden />
                    从资产库选择
                  </button>
                </div>
              </div>
            )}
            {refUploadBusy && !refImagePreviewUrl ? (
              <div className="absolute inset-0 rounded-xl bg-black/35 backdrop-blur-[1px] flex items-center justify-center">
                <div className="text-sm text-white/90 flex items-center">
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  处理中...
                </div>
              </div>
            ) : null}
          </div>
          {refUploadBusy ? (
            <div className="mt-2 text-xs text-white/45">
              {refImagePreviewUrl ? '正在准备图片（用于生成），请稍候…' : '正在处理参考图，请稍候…'}
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1 text-white/75">AI模型</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="tikgen-spec-select w-full appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-3 pr-3 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.08] transition-shadow hover:ring-white/12 focus:ring-2 focus:ring-violet-400/35"
            >
              {VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.id} disabled={!!unavailableVideoMap[m.id]}>
                  {m.name}
                  {unavailableVideoMap[m.id] ? '（暂不可用）' : ''}
                </option>
              ))}
            </select>
            {unavailableVideoMap[model] ? <div className="mt-1 text-xs text-amber-300/90">当前模型暂不可用，请切换其他模型。</div> : null}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-white/75">分辨率</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as any)}
              className="tikgen-spec-select w-full appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-3 pr-3 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.08] transition-shadow hover:ring-white/12 focus:ring-2 focus:ring-violet-400/35"
            >
              {caps.resolutions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-white/75">视频时长</label>
            <select
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value) as any)}
              className="tikgen-spec-select w-full appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-3 pr-3 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.08] transition-shadow hover:ring-white/12 focus:ring-2 focus:ring-violet-400/35"
            >
              {caps.durations.map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-white/75">尺寸</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value as any)}
              className="tikgen-spec-select w-full appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-3 pr-3 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.08] transition-shadow hover:ring-white/12 focus:ring-2 focus:ring-violet-400/35"
            >
              {caps.aspectRatios.map((ar) => (
                <option key={ar} value={ar}>
                  {ar}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-white/75">视频文案描述</label>
            <button
              onClick={handlePromptGen}
              className="px-3 py-1.5 rounded-full text-sm bg-white/10 text-violet-200 hover:bg-white/15 flex items-center ring-1 ring-inset ring-white/[0.08]"
            >
              <Sparkles className="w-4 h-4 mr-1" /> 一键生成提示词
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full px-4 py-3 rounded-xl min-h-[140px] bg-black/25 border border-white/10 text-white/90 placeholder:text-white/35 outline-none focus:ring-2 focus:ring-violet-400/30"
            placeholder="输入商品卖点/场景/风格，或使用一键生成提示词..."
          />
        </div>
        <div>
          <button
            onClick={handleGenerate}
            disabled={!prompt || !canGenerate}
            title={!canGenerate ? '请先完成本产品内付费（购买套餐）后再生成视频' : undefined}
            className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50"
          >
            {processingCount > 0 ? <>再提交一个（进行中 {processingCount}）</> : '生成视频'}
          </button>
          {!canGenerate ? (
            <div className="mt-2 text-xs text-amber-300/95 text-center">请开通会员</div>
          ) : null}
        </div>
      </div>
      <div className="tikgen-panel rounded-2xl p-6">
        <h2 className="text-xl font-bold mb-6 text-white/95">生成结果</h2>
        {activeTask?.status === 'processing' ? (
          <div className="mb-5">
            <GenerationLoadingCard
              title={LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].video.title}
              subtitle={LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].video.subtitle}
              chips={LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].video.chips}
              statusText={activeTask.statusText || '视频生成中...'}
              progressText={`进度：${activeTask.progress || '0%'}${activeTask.taskId ? ` | 任务ID：${activeTask.taskId}` : ''}`}
            />
          </div>
        ) : null}

        {videoTasks.length === 0 ? (
          <div className="h-96 flex items-center justify-center text-white/40 border border-white/12 rounded-xl bg-white/[0.02]">
            <Video className="w-16 h-16 opacity-40" />
          </div>
        ) : (
          <div className="space-y-3">
            {videoTasks.map((t) => (
              <div
                key={t.id}
                className={`rounded-xl border p-3 ${
                  activeTaskId === t.taskId ? 'border-violet-300/40 bg-white/[0.07]' : 'border-white/12 bg-white/[0.03]'
                }`}
                onClick={() => setActiveTaskId(t.taskId)}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs text-white/60 truncate">
                    {new Date(t.createdAt).toLocaleTimeString()} · {t.model} · {t.size} · {t.resolution}
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      t.status === 'completed'
                        ? 'border-emerald-400/35 text-emerald-200 bg-emerald-500/12'
                        : t.status === 'failed'
                          ? 'border-red-400/35 text-red-200 bg-red-500/12'
                          : 'border-amber-400/35 text-amber-200 bg-amber-500/12'
                    }`}
                  >
                    {t.status === 'completed' ? '已完成' : t.status === 'failed' ? '失败' : `生成中 ${t.progress || '0%'}`}
                  </span>
                </div>

                {t.status === 'completed' && t.videoUrl ? (
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                    <video
                      src={t.videoUrl}
                      className="w-full h-44 rounded-lg object-contain bg-black"
                      controls
                      playsInline
                    />
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setResultLightbox({ url: t.videoUrl, title: `任务 ${t.taskId}` })
                        }}
                        className="px-3 py-2 rounded-lg text-xs bg-white/[0.08] ring-1 ring-inset ring-white/[0.12] hover:bg-white/[0.12]"
                      >
                        放大
                      </button>
                      <a
                        href={buildDownloadProxyUrl(t.videoUrl, `${t.taskId || 'video'}.mp4`)}
                        download
                        onClick={(e) => e.stopPropagation()}
                        className="px-3 py-2 rounded-lg text-xs text-center bg-gradient-to-r from-pink-500 to-purple-500 text-white"
                      >
                        下载
                      </a>
                    </div>
                  </div>
                ) : t.status === 'failed' ? (
                  <div className="text-xs text-red-300/90 break-words">
                    {t.errorText || '生成失败'} {t.errorCode && t.errorCode !== 'UNKNOWN' ? `（${t.errorCode}）` : ''}
                  </div>
                ) : (
                  <div className="text-xs text-white/60">任务提交中... {t.statusText || ''}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    {resultLightbox ? (
      <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
        <div className="w-full max-w-5xl bg-black rounded-2xl border border-white/15 p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="text-xs text-white/70 truncate">{resultLightbox.title}</div>
            <button
              type="button"
              onClick={() => setResultLightbox(null)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white"
              aria-label="关闭视频预览"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <video src={resultLightbox.url} className="w-full max-h-[80vh] rounded-xl bg-black" controls autoPlay playsInline />
        </div>
      </div>
    ) : null}
    {showAssetPicker && (
      <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
        <div className="w-full max-w-6xl max-h-[88vh] overflow-hidden bg-white rounded-2xl border shadow-2xl flex flex-col">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <div className="text-lg font-semibold">从资产库选择参考图</div>
            <button type="button" onClick={() => setShowAssetPicker(false)} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="关闭">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="px-5 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAssetTab('user_upload')}
                className={`px-3 py-1.5 rounded-lg text-sm border-2 ${assetTab === 'user_upload' ? 'bg-gray-900 text-white border-purple-400 shadow-[0_0_0_1px_rgba(167,139,250,0.55)]' : 'bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200/70'}`}
              >
                本地上传
              </button>
              <button
                type="button"
                onClick={() => setAssetTab('ai_generated')}
                className={`px-3 py-1.5 rounded-lg text-sm border-2 ${assetTab === 'ai_generated' ? 'bg-gray-900 text-white border-purple-400 shadow-[0_0_0_1px_rgba(167,139,250,0.55)]' : 'bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200/70'}`}
              >
                AI 生成
              </button>
            </div>
            <div className="text-sm text-gray-500">已选 {assetSelectedIds.size}/1</div>
          </div>
          <div className="p-5 overflow-auto flex-1">
            {assetBusy ? (
              <div className="text-sm text-gray-500">加载中...</div>
            ) : assetList.length === 0 ? (
              <div className="text-sm text-gray-500">暂无可选图片资产</div>
            ) : (
              <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {assetList.map((a) => {
                  const checked = assetSelectedIds.has(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleVideoAssetPick(a.id)}
                      className={`relative rounded-xl overflow-hidden border transition-all ${checked ? 'border-purple-500 ring-2 ring-purple-300 shadow-[0_0_0_2px_rgba(168,85,247,.35)]' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <img src={a.url} alt={a.name || 'asset'} className="w-full h-24 object-cover" />
                      {checked && (
                        <div className="absolute right-1.5 top-1.5 w-5 h-5 rounded-full bg-purple-600 text-white text-xs flex items-center justify-center">
                          ✓
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
            <button type="button" onClick={() => setShowAssetPicker(false)} className="px-4 py-2 rounded-lg border">
              取消
            </button>
            <button type="button" onClick={confirmVideoAssetPick} className="px-4 py-2 rounded-lg bg-purple-600 text-white">
              确认选择{assetSelectedIds.size ? `（${assetSelectedIds.size}）` : ''}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

/** 电商套图页：hover / 聚焦显示说明；图标无按钮方框感 */
function ImageFormTip({ text, wide, label = '查看说明' }: { text: string; wide?: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div
      className="relative inline-flex items-center shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="image-form-tip-trigger inline-flex cursor-help text-violet-400/65 hover:text-violet-200/95 transition-colors duration-150" aria-label={label}>
        <Info className="w-[15px] h-[15px]" strokeWidth={1.5} aria-hidden />
      </span>
      {open ? (
        <div className="absolute left-0 top-full z-[300] -mt-1.5 pt-1.5" role="tooltip">
          <div
            className={`image-form-tip-pop rounded-xl border px-3 py-2.5 text-xs leading-relaxed max-h-[min(70vh,24rem)] overflow-y-auto ${wide ? 'w-[min(22rem,calc(100vw-2rem))]' : 'w-[min(19rem,calc(100vw-2rem))]'}`}
          >
            <div className="whitespace-pre-wrap text-white">{text}</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ImageGenerator({
  templatePreset,
  onTemplateApplied,
  variant = 'ecommerce',
  visible = true,
  canGenerate,
}: {
  templatePreset: ImageTemplatePreset | null
  onTemplateApplied: () => void
  /** simple：提示词直出，无爆款风格与场景勾选；ecommerce：电商套图完整流程 */
  variant?: 'ecommerce' | 'simple'
  /** 为 false 时不写入共享 refs（避免隐藏实例覆盖） */
  visible?: boolean
  /** 是否已完成本产品内付费（生图 API 权限） */
  canGenerate: boolean
}) {
  const isSimpleImageGen = variant === 'simple'
  const idbWorkspaceKey = isSimpleImageGen ? TIKGEN_IG_IDB.workspaceSimple : TIKGEN_IG_IDB.workspace
  const idbBoardKey = isSimpleImageGen ? TIKGEN_IG_IDB.boardSimple : TIKGEN_IG_IDB.board
  const idbHistoryKey = isSimpleImageGen ? TIKGEN_IG_IDB.historySimple : TIKGEN_IG_IDB.history
  const lsHistoryKey = isSimpleImageGen ? TIKGEN_IG_LS_HISTORY_SIMPLE : TIKGEN_IG_LS_HISTORY
  const lsBoardKey = isSimpleImageGen ? TIKGEN_IG_LS_BOARD_SIMPLE : TIKGEN_IG_LS_BOARD
  const [refImagePreviewUrl, setRefImagePreviewUrl] = useState('')
  const [refImageDataUrl, setRefImageDataUrl] = useState('')
  const [refImages, setRefImages] = useState<Array<{ id: string; url: string; name?: string; source: 'local' | 'asset' }>>([])
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [assetTab, setAssetTab] = useState<'user_upload' | 'ai_generated'>('user_upload')
  const [assetList, setAssetList] = useState<AssetItem[]>([])
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetSelectedIds, setAssetSelectedIds] = useState<Set<string>>(new Set())
  const [refUploadNotice, setRefUploadNotice] = useState('')
  const [refUploadBusy, setRefUploadBusy] = useState(false)
  const [previewRefImage, setPreviewRefImage] = useState<{ url: string; name: string; index: number } | null>(null)
  const [draggingRefId, setDraggingRefId] = useState('')
  const refUploadInputRef = useRef<HTMLInputElement | null>(null)
  const assetCacheRef = useRef<{ user_upload: AssetItem[] | null; ai_generated: AssetItem[] | null }>({ user_upload: null, ai_generated: null })
  const [prompt, setPrompt] = useState('')
  /** 图片生成（简版）：主提示词输入，不参与爆款风格链路 */
  const [simpleDirectPrompt, setSimpleDirectPrompt] = useState('')
  const [simplePromptPolishBusy, setSimplePromptPolishBusy] = useState(false)
  /** 简版批量出图：切换 Tab / 卸载时中止未完成的 fetch，避免后台继续占并发 */
  const imageGenSimpleBatchAbortRef = useRef<AbortController | null>(null)
  /** 记录简版面板是否曾处于可见，用于仅在「可见→不可见」时 abort，避免 effect cleanup 误杀（如 React Strict Mode 重挂载） */
  const prevSimpleImageGenVisibleRef = useRef<boolean | null>(null)
  const [model, setModel] = useState('nano-banana-2')
  const [size, setSize] = useState<ImageAspect>('1:1')
  const [resolution, setResolution] = useState<ImageRes>('2048')
  const [imageGenHistory, setImageGenHistory] = useState<ImageGenHistoryTask[]>([])
  /** 生成历史缩略图加载失败（临时链过期、空链等） */
  const [histImageLoadFailed, setHistImageLoadFailed] = useState<Record<string, true>>({})
  const [historyLightbox, setHistoryLightbox] = useState<{ url: string; downloadName?: string } | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [modalStep, setModalStep] = useState(1)
  const [productInfo, setProductInfo] = useState<ProductInfo>({ ...DEFAULT_PRODUCT_INFO })
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [optimizedNegativePrompt, setOptimizedNegativePrompt] = useState('')
  const [promptParts, setPromptParts] = useState<any>({})
  const [sceneMode, setSceneMode] = useState<'clean' | 'lite'>('clean')
  const [categoryHint, setCategoryHint] = useState('other')
  const [selectedStyleTags, setSelectedStyleTags] = useState<string[]>([])
  const [genProgress, setGenProgress] = useState(0)
  const [genErrorText, setGenErrorText] = useState('')
  const [genErrorCode, setGenErrorCode] = useState('UNKNOWN')
  const [isAiBusy, setIsAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const aiJobRef = useRef(0)
  const [promptGenOutputSettings, setPromptGenOutputSettings] = useState<{ aspect: ImageAspect; resolution: ImageRes } | null>(null)
  const [promptRegenBusy, setPromptRegenBusy] = useState(false)
  /** 与 promptRegenBusy 同步：各按钮独立「生成描述中」文案 */
  const [promptRegenSource, setPromptRegenSource] = useState<
    'oneClick' | 'product' | 'styles' | 'styleCard' | 'spec' | null
  >(null)
  /** 仅顶部「重新分析」整条 full 分析 */
  const [workbenchFullAnalysisBusy, setWorkbenchFullAnalysisBusy] = useState(false)
  /** 仅商品区「AI 生成」第一步 */
  const [productAnalysisOnlyBusy, setProductAnalysisOnlyBusy] = useState(false)
  /** 仅爆款风格行「重新分析」第一步 */
  const [hotStylesReanalyzeBusy, setHotStylesReanalyzeBusy] = useState(false)
  const [oneClickNeedRefHint, setOneClickNeedRefHint] = useState(false)
  const oneClickHintTimerRef = useRef(0)
  /** 一键分析拆分阶段：用于文案与爆款区骨架 */
  const [oneClickAnalysisPhase, setOneClickAnalysisPhase] = useState<'product' | 'styles' | null>(null)
  const productAnalysisRevealTimerRef = useRef<number | null>(null)
  const productAnalysisWorkbenchTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  /** 商品分析渐进写入时：轻微高亮，提示「正在流出」 */
  const [productAnalysisStreamReveal, setProductAnalysisStreamReveal] = useState(false)
  /** 每完成一次一键分析里的「爆款风格」请求 +1，用于卡片渐入动画重放 */
  const [hotStylesRevealEpoch, setHotStylesRevealEpoch] = useState(0)
  /** 商品分析 + 爆款风格：默认折叠，上传参考图并点击「一键分析」后展开 */
  const [productStylePanelOpen, setProductStylePanelOpen] = useState(false)
  const [productAnalysisText, setProductAnalysisText] = useState('')
  const [hotStyles, setHotStyles] = useState<ImageWorkbenchStyleRow[]>([])
  const [selectedHotStyleIndex, setSelectedHotStyleIndex] = useState(0)
  /** 电商套图：一次批量生成图片数量（1-6） */
  const [imageGenerateCount, setImageGenerateCount] = useState(1)
  const [sceneRunBoard, setSceneRunBoard] = useState<SceneRunBoard | null>(null)
  /** IndexedDB / localStorage 恢复完成前禁止写入，避免用空状态覆盖已保存数据 */
  const [imageGenPersistenceReady, setImageGenPersistenceReady] = useState(false)
  const sceneRunBoardRef = useRef<SceneRunBoard | null>(null)
  /** 并行多波「一键生成」计数，避免互斥导致第二批无法点击 */
  const sceneBatchDepthRef = useRef(0)
  const [sceneBoardPreparing, setSceneBoardPreparing] = useState(false)
  const [customStyleModalOpen, setCustomStyleModalOpen] = useState(false)
  const [customStylePromptOnly, setCustomStylePromptOnly] = useState('')
  const [styleCardEditIndex, setStyleCardEditIndex] = useState<number | null>(null)
  const [styleCardEditDraft, setStyleCardEditDraft] = useState({ title: '', description: '', imagePrompt: '' })
  /** 爆款风格「出图主描述」悬停浮层：挂到 body + fixed，避免被下方卡片 / 层叠上下文挡住 */
  const [stylePromptHoverIdx, setStylePromptHoverIdx] = useState<number | null>(null)
  const [stylePromptPopBox, setStylePromptPopBox] = useState<{ top: number; left: number; width: number } | null>(null)
  const stylePromptAnchorRef = useRef<HTMLDivElement | null>(null)
  const stylePromptLeaveTimerRef = useRef<number | null>(null)
  const [sceneBatchGenerating, setSceneBatchGenerating] = useState(false)
  /** 各场景槽出图进度（API 无真实进度，按耗时指数趋近 ~94%） */
  const [sceneSlotGenProgress, setSceneSlotGenProgress] = useState<Record<number, number>>({})
  const sceneGenProgressTimersRef = useRef<Record<number, number>>({})
  const imageGenRootRef = useRef<HTMLDivElement | null>(null)
  const imageGenHistoryTopRef = useRef<HTMLDivElement | null>(null)
  /** 历史卡并发任务的百分比刷新时钟（旧任务挪到下方后仍持续跳动） */
  const [historyProgressNow, setHistoryProgressNow] = useState(() => Date.now())
  const [imageScenes, setImageScenes] = useState<ImageSceneRow[]>(() =>
    IMAGE_SCENE_BLUEPRINT.map((b) => ({
      key: b.key,
      title: b.title,
      description: '',
      imagePrompt: '',
      selected: true,
    })),
  )
  const [scenesPlanBusy, setScenesPlanBusy] = useState(false)
  const scenePlanJobRef = useRef(0)
  const [imageModels, setImageModels] = useState<{ id: string; name: string }[]>(IMAGE_MODELS)
  const [unavailableImageMap, setUnavailableImageMap] = useState<Record<string, string>>({})
  const imageModelOptions = useMemo(
    () =>
      imageModels.map((m) => ({
        ...m,
        unavailableReason: unavailableImageMap[m.id] || getImageModelUnavailableReason(m.id),
      })),
    [imageModels, unavailableImageMap],
  )
  const MAX_REF_IMAGES = 5

  useEffect(() => {
    let cancelled = false
    const boardFromRaw = (p: Record<string, unknown> | null): SceneRunBoard | null => {
      if (!p || typeof p.id !== 'string' || typeof p.ts !== 'number' || !Array.isArray(p.slots)) return null
      return {
        id: p.id,
        ts: p.ts,
        refThumb: String(p.refThumb || ''),
        basePrompt: String(p.basePrompt || ''),
        slots: p.slots as SceneRunSlot[],
      }
    }
    void (async () => {
      const [hIdb, bIdb, refsIdb, wsIdb] = await Promise.all([
        tikgenIgIdbGet<ImageGenHistoryTask[]>(idbHistoryKey),
        tikgenIgIdbGet<SceneRunBoard>(idbBoardKey),
        tikgenIgIdbGet<Array<{ id: string; url: string; name?: string; source: 'local' | 'asset' }>>(TIKGEN_IG_IDB.refs),
        tikgenIgIdbGet<TikgenWorkspaceSnapshotV1>(idbWorkspaceKey),
      ])
      if (cancelled) return

      const hLs = loadImageGenHistoryFromStorage(lsHistoryKey)
      const hMerged = mergeImageGenHistorySnapshots(hIdb, hLs) as unknown[]
      const hMerge = hMerged
        .filter((x: any) => x && typeof x.id === 'string' && typeof x.ts === 'number')
        .map((t: any) => ({
          ...t,
          refThumb: String(t.refThumb || ''),
          outputUrls: Array.isArray(t.outputUrls) ? t.outputUrls.map((u: unknown) => String(u || '')) : [],
          status:
            t.status === 'active' || t.status === 'failed' || t.status === 'completed'
              ? t.status
              : 'completed',
        }))
        .slice(0, IMAGE_GEN_HISTORY_MAX) as ImageGenHistoryTask[]
      setImageGenHistory(hMerge)

      const bLs = boardFromRaw(loadSceneRunBoardFromLocalStorage(lsBoardKey))
      const bMerge = bIdb && bIdb.id && Array.isArray(bIdb.slots) && bIdb.slots.length > 0 ? bIdb : bLs
      if (bMerge) setSceneRunBoard(bMerge)

      if (refsIdb && Array.isArray(refsIdb) && refsIdb.length) setRefImages(refsIdb)

      if (wsIdb && wsIdb.v === 1) {
        if (isSimpleImageGen) {
          setSimpleDirectPrompt(String(wsIdb.prompt ?? ''))
        } else {
          setPrompt(String(wsIdb.prompt ?? ''))
        }
        setOptimizedPrompt(String(wsIdb.optimizedPrompt ?? ''))
        setOptimizedNegativePrompt(String(wsIdb.optimizedNegativePrompt ?? ''))
        setProductAnalysisText(String(wsIdb.productAnalysisText ?? ''))
        const pi = wsIdb.productInfo
        if (pi && typeof pi === 'object') {
          const p = pi as ProductInfo
          setProductInfo({
            ...DEFAULT_PRODUCT_INFO,
            name: String(p.name ?? ''),
            category: String(p.category ?? ''),
            sellingPoints: String(p.sellingPoints ?? ''),
            targetAudience: String(p.targetAudience ?? ''),
            language: String(p.language ?? DEFAULT_PRODUCT_INFO.language),
            targetPlatform: String(p.targetPlatform ?? DEFAULT_PRODUCT_INFO.targetPlatform),
            targetMarket: String(p.targetMarket ?? DEFAULT_PRODUCT_INFO.targetMarket),
          })
        }
        if (!isSimpleImageGen) {
          if (Array.isArray(wsIdb.hotStyles)) setHotStyles(wsIdb.hotStyles as ImageWorkbenchStyleRow[])
          setSelectedHotStyleIndex(Number(wsIdb.selectedHotStyleIndex) || 0)
        } else {
          setHotStyles([])
          setSelectedHotStyleIndex(0)
          const c = Number((wsIdb as TikgenWorkspaceSnapshotV1).imageGenerateCount || 1)
          setImageGenerateCount(Math.min(6, Math.max(1, Number.isFinite(c) ? c : 1)))
        }
        setProductStylePanelOpen(Boolean(wsIdb.productStylePanelOpen))
        if (wsIdb.model) setModel(String(wsIdb.model))
        if (wsIdb.size && IMAGE_ASPECT_OPTIONS.includes(wsIdb.size as ImageAspect)) setSize(wsIdb.size as ImageAspect)
        if (wsIdb.resolution && IMAGE_RES_OPTIONS.includes(wsIdb.resolution as ImageRes))
          setResolution(wsIdb.resolution as ImageRes)
        if (wsIdb.sceneMode === 'clean' || wsIdb.sceneMode === 'lite') setSceneMode(wsIdb.sceneMode)
        if (wsIdb.promptGenOutputSettings?.aspect && wsIdb.promptGenOutputSettings?.resolution) {
          const a = wsIdb.promptGenOutputSettings.aspect
          const r = wsIdb.promptGenOutputSettings.resolution
          if (IMAGE_ASPECT_OPTIONS.includes(a as ImageAspect) && IMAGE_RES_OPTIONS.includes(r as ImageRes)) {
            setPromptGenOutputSettings({ aspect: a as ImageAspect, resolution: r as ImageRes })
          }
        }
        if (Array.isArray(wsIdb.imageScenes) && wsIdb.imageScenes.length)
          setImageScenes(wsIdb.imageScenes as ImageSceneRow[])
      }

      setImageGenPersistenceReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (stylePromptHoverIdx === null) return
    const sync = () => {
      const el = stylePromptAnchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const grid = el.closest('[data-hot-styles-grid]') as HTMLElement | null
      const obstacles = getHotStyleSchemeObstacleRects(grid, el)
      const next = computeWorkbenchStylePromptPopoverPosition(r, obstacles)
      setStylePromptPopBox((prev) => {
        if (prev && prev.top === next.top && prev.left === next.left && prev.width === next.width) return prev
        return next
      })
    }
    sync()
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
    }
  }, [stylePromptHoverIdx])

  useEffect(() => {
    if (!customStyleModalOpen && styleCardEditIndex === null) return
    if (stylePromptLeaveTimerRef.current != null) {
      window.clearTimeout(stylePromptLeaveTimerRef.current)
      stylePromptLeaveTimerRef.current = null
    }
    setStylePromptHoverIdx(null)
    setStylePromptPopBox(null)
    stylePromptAnchorRef.current = null
  }, [customStyleModalOpen, styleCardEditIndex])

  useEffect(() => {
    if (stylePromptHoverIdx === null) return
    if (!hotStyles[stylePromptHoverIdx]) {
      if (stylePromptLeaveTimerRef.current != null) {
        window.clearTimeout(stylePromptLeaveTimerRef.current)
        stylePromptLeaveTimerRef.current = null
      }
      setStylePromptHoverIdx(null)
      setStylePromptPopBox(null)
      stylePromptAnchorRef.current = null
    }
  }, [hotStyles, stylePromptHoverIdx])

  useEffect(() => {
    return () => {
      if (productAnalysisRevealTimerRef.current != null) {
        window.clearTimeout(productAnalysisRevealTimerRef.current)
        productAnalysisRevealTimerRef.current = null
      }
    }
  }, [])

  const historyGrouped = useMemo(() => {
    /**
     * 电商套图：仅当当前看板仍有进行中任务时，临时隐藏同 id 历史，避免重复。
     * 一旦全部完成/失败，历史应立即可见（避免用户误以为记录消失）。
     * 简版无右侧看板，始终显示历史。
     */
    const boardHasInFlight =
      !!sceneRunBoard &&
      sceneRunBoard.slots.some((s) => s.selected && s.status === 'generating')
    const dedupeBoard = !isSimpleImageGen && !!sceneRunBoard && boardHasInFlight
    const list = dedupeBoard ? imageGenHistory.filter((t) => t.id !== sceneRunBoard!.id) : imageGenHistory
    return groupImageHistoryByDay(list)
  }, [imageGenHistory, sceneRunBoard, isSimpleImageGen])

  /** 场景看板 / 生成历史大标题：优先结构化「产品名称」，否则从商品分析笔记解析 */
  const imageWorkbenchCardTitle = useMemo(
    () =>
      (productInfo.name || '').trim() ||
      extractProductNameFromAnalysisNotes(productAnalysisText) ||
      '商品场景',
    [productInfo.name, productAnalysisText],
  )

  useEffect(() => {
    if (!imageGenPersistenceReady || !visible) return
    const slice = imageGenHistory.slice(0, IMAGE_GEN_HISTORY_MAX)
    void tikgenIgIdbSet(idbHistoryKey, slice)
    tryLocalStorageSetJson(lsHistoryKey, stripHistoryForLocalStorage(slice))
  }, [imageGenHistory, imageGenPersistenceReady, visible, idbHistoryKey, lsHistoryKey])

  /** 电商套图历史：将仍为临时链的成片镜像入库，并把 Supabase 永久 URL 写回 outputUrls（刷新后仍可预览） */
  useEffect(() => {
    if (!imageGenPersistenceReady || !visible) return
    let cancelled = false
    void (async () => {
      for (const task of imageGenHistory) {
        if (cancelled) return
        if (task.status === 'failed') continue
        const urls = task.outputUrls || []
        for (let i = 0; i < urls.length; i++) {
          if (cancelled) return
          const url = String(urls[i] || '').trim()
          if (!url) continue
          if (/\/storage\/v1\/object\/public\/assets\//.test(url)) continue
          const archived = await safeArchiveAsset({
            source: 'ai_generated',
            type: 'image',
            url,
            name: `tikgen-${task.id}-${i + 1}.png`,
            metadata: {
              from: 'image_generator',
              task_id: task.id,
              index: i,
              modelLabel: task.modelLabel,
              sync: 'history',
            },
          })
          if (cancelled) return
          if (
            archived &&
            archived !== url &&
            /\/storage\/v1\/object\/public\/assets\//.test(archived)
          ) {
            setImageGenHistory((prev) =>
              prev.map((t) => {
                if (t.id !== task.id) return t
                const next = [...(t.outputUrls || [])]
                if (String(next[i] || '').trim() !== url) return t
                next[i] = archived
                return { ...t, outputUrls: next }
              }),
            )
          }
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [imageGenHistory, imageGenPersistenceReady, visible])

  useEffect(() => {
    sceneRunBoardRef.current = sceneRunBoard
  }, [sceneRunBoard])

  /** 简版：仅在面板从可见变为不可见时中止出图（切走子导航/离开图片模块），不在每次 effect cleanup 中止 */
  useEffect(() => {
    if (!isSimpleImageGen) return
    const prev = prevSimpleImageGenVisibleRef.current
    prevSimpleImageGenVisibleRef.current = visible
    if (prev === true && visible === false) {
      imageGenSimpleBatchAbortRef.current?.abort()
      imageGenSimpleBatchAbortRef.current = null
    }
  }, [isSimpleImageGen, visible])

  /** 简版：每张出图完成后再次尝试写入资产库（与槽位内归档互补，保证列表及时刷新） */
  useEffect(() => {
    if (!isSimpleImageGen || !visible || !sceneRunBoard) return
    for (let i = 0; i < sceneRunBoard.slots.length; i++) {
      const s = sceneRunBoard.slots[i]
      if (s.status !== 'done' || !s.imageUrl) continue
      void safeArchiveAsset({
        source: 'ai_generated',
        type: 'image',
        url: s.imageUrl,
        name: `tikgen-${sceneRunBoard.id}-${i + 1}.png`,
        metadata: {
          from: 'image_generator',
          task_id: sceneRunBoard.id,
          index: i,
          sync: 'simple_slot_watch',
          variant: 'simple',
        },
      })
    }
  }, [isSimpleImageGen, visible, sceneRunBoard])

  /** 简版：全部槽位结束后收起看板，仅保留生成历史（避免与同 id 记录产生理解歧义） */
  useEffect(() => {
    if (!isSimpleImageGen || !sceneRunBoard) return
    const sel = sceneRunBoard.slots.filter((s) => s.selected)
    if (!sel.length) return
    const allTerminal = sel.every((s) => s.status === 'done' || s.status === 'failed')
    if (!allTerminal) return
    const id = sceneRunBoard.id
    const t = window.setTimeout(() => {
      setSceneRunBoard((b) => (b && b.id === id ? null : b))
    }, 600)
    return () => window.clearTimeout(t)
  }, [isSimpleImageGen, sceneRunBoard])

  const sceneBoardSlotGenSignature = useMemo(() => {
    if (!sceneRunBoard) return ''
    return `${sceneRunBoard.id}|${sceneRunBoard.slots.map((s) => s.status).join(',')}`
  }, [sceneRunBoard])

  useEffect(() => {
    if (!sceneRunBoard) {
      Object.values(sceneGenProgressTimersRef.current).forEach((t) => window.clearInterval(t))
      sceneGenProgressTimersRef.current = {}
      setSceneSlotGenProgress({})
      return
    }
    const genIdx = sceneRunBoard.slots
      .map((s, i) => (s.status === 'generating' ? i : -1))
      .filter((i) => i >= 0)
    Object.keys(sceneGenProgressTimersRef.current).forEach((ks) => {
      const idx = Number(ks)
      if (!genIdx.includes(idx)) {
        window.clearInterval(sceneGenProgressTimersRef.current[idx])
        delete sceneGenProgressTimersRef.current[idx]
      }
    })
    setSceneSlotGenProgress((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        if (!genIdx.includes(Number(k))) delete next[Number(k)]
      }
      return next
    })
    const cap = 94
    const tauMs = 44000
    for (const idx of genIdx) {
      if (sceneGenProgressTimersRef.current[idx] != null) continue
      setSceneSlotGenProgress((p) => ({ ...p, [idx]: Math.max(p[idx] ?? 0, 2) }))
      const startedAt = Date.now()
      sceneGenProgressTimersRef.current[idx] = window.setInterval(() => {
        const elapsed = Date.now() - startedAt
        const eased = 1 - Math.exp(-elapsed / tauMs)
        const v = Math.min(cap, Math.round(2 + (cap - 2) * eased))
        setSceneSlotGenProgress((p) => ({ ...p, [idx]: v }))
      }, 320)
    }
  }, [sceneBoardSlotGenSignature])

  useEffect(() => {
    return () => {
      Object.values(sceneGenProgressTimersRef.current).forEach((t) => window.clearInterval(t))
      sceneGenProgressTimersRef.current = {}
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setHistoryProgressNow(Date.now()), 850)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!imageGenPersistenceReady) return
    void (async () => {
      if (sceneRunBoard) {
        await tikgenIgIdbSet(idbBoardKey, sceneRunBoard)
        tryLocalStorageSetJson(
          lsBoardKey,
          stripBoardForLocalStorage(sceneRunBoard as unknown as Record<string, unknown>),
        )
      } else {
        await tikgenIgIdbDelete(idbBoardKey)
        try {
          localStorage.removeItem(lsBoardKey)
        } catch {
          // ignore
        }
      }
    })()
  }, [sceneRunBoard, imageGenPersistenceReady, idbBoardKey, lsBoardKey])

  useEffect(() => {
    if (!imageGenPersistenceReady || !visible) return
    void tikgenIgIdbSet(TIKGEN_IG_IDB.refs, refImages)
  }, [refImages, imageGenPersistenceReady, visible])

  useEffect(() => {
    if (!imageGenPersistenceReady || !visible) return
    const ws: TikgenWorkspaceSnapshotV1 = {
      v: 1,
      prompt: isSimpleImageGen ? simpleDirectPrompt : prompt,
      optimizedPrompt,
      optimizedNegativePrompt,
      productAnalysisText,
      productInfo: { ...productInfo },
      hotStyles: isSimpleImageGen ? [] : hotStyles,
      selectedHotStyleIndex: isSimpleImageGen ? 0 : selectedHotStyleIndex,
      productStylePanelOpen,
      model,
      size,
      resolution,
      sceneMode,
      imageGenerateCount: isSimpleImageGen ? imageGenerateCount : 1,
      promptGenOutputSettings: promptGenOutputSettings
        ? { aspect: promptGenOutputSettings.aspect, resolution: promptGenOutputSettings.resolution }
        : null,
      imageScenes,
    }
    const t = window.setTimeout(() => {
      void tikgenIgIdbSet(idbWorkspaceKey, ws)
    }, 400)
    return () => window.clearTimeout(t)
  }, [
    imageGenPersistenceReady,
    visible,
    idbWorkspaceKey,
    isSimpleImageGen,
    simpleDirectPrompt,
    prompt,
    optimizedPrompt,
    optimizedNegativePrompt,
    productAnalysisText,
    productInfo,
    hotStyles,
    selectedHotStyleIndex,
    productStylePanelOpen,
    model,
    size,
    resolution,
    sceneMode,
    imageGenerateCount,
    promptGenOutputSettings,
    imageScenes,
  ])

  const sceneHistorySentryLoggedRef = useRef<Set<string>>(new Set())

  const upsertImageHistoryFromBoard = useCallback(
    (board: SceneRunBoard) => {
      const resLb =
        resolution === '1024' ? '1k' : resolution === '1536' ? '1.5k' : resolution === '2048' ? '2k' : resolution === '4096' ? '4k' : String(resolution)
      const modelLabel = imageModelOptions.find((m) => m.id === model)?.name || model
      const built = buildHistoryTaskFromSceneBoard(
        board,
        model,
        modelLabel,
        size,
        resLb,
        productInfo.name?.trim(),
        productAnalysisText,
        isSimpleImageGen,
      )
      const urlScore = (urls: string[] | undefined) =>
        (urls || []).filter((u) => String(u || '').trim()).length
      const slotScore = (slots: ImageGenHistoryTask['sceneSlots'] | undefined) =>
        (slots || []).reduce((n, s) => n + (s.status === 'done' ? 3 : s.status === 'generating' ? 2 : s.status === 'failed' ? 1 : 0), 0)
      setImageGenHistory((prev) => {
        const i = prev.findIndex((t) => t.id === built.id)
        if (i < 0) return [built, ...prev].slice(0, IMAGE_GEN_HISTORY_MAX)
        const old = prev[i]
        const mergedName = (built.productName || '').trim() || old.productName
        /** 并行多波出图时，较晚的闭包可能带着较「旧」的 board 快照写入，避免用更少成片覆盖已有 outputUrls */
        const newScore = urlScore(built.outputUrls)
        const oldScore = urlScore(old.outputUrls)
        const keepOldOutputs = oldScore > newScore
        const keepOldSceneSlots = slotScore(old.sceneSlots) > slotScore(built.sceneSlots)
        const merged: ImageGenHistoryTask = {
          ...built,
          ts: old.ts,
          ...(mergedName ? { productName: mergedName } : {}),
          ...(keepOldOutputs
            ? {
                outputUrls: [...(old.outputUrls || [])],
                sceneLabels: old.sceneLabels?.length ? old.sceneLabels : built.sceneLabels,
                sceneTeasers: old.sceneTeasers?.length ? old.sceneTeasers : built.sceneTeasers,
                sceneDescriptions: old.sceneDescriptions?.length ? old.sceneDescriptions : built.sceneDescriptions,
              }
            : {}),
          ...(keepOldSceneSlots ? { sceneSlots: old.sceneSlots } : {}),
        }
        return [merged, ...prev.filter((_, j) => j !== i)].slice(0, IMAGE_GEN_HISTORY_MAX)
      })

      if (built.status === 'failed') {
        const failLine = built.errorMessage || '生成失败'
        setGenErrorText(failLine)
        setGenErrorCode(built.errorHintCode || 'UNKNOWN')
      } else if (built.status === 'completed' && built.errorMessage) {
        setGenErrorText(built.errorMessage)
        setGenErrorCode(built.errorHintCode || 'PARTIAL')
      } else if (built.status === 'completed') {
        setGenErrorText('')
        setGenErrorCode('UNKNOWN')
        const selDone = board.slots.filter((s) => s.selected)
        const allTerminal = selDone.length > 0 && selDone.every((s) => s.status === 'done' || s.status === 'failed')
        if (
          built.outputUrls.length > 0 &&
          allTerminal &&
          !sceneHistorySentryLoggedRef.current.has(built.id)
        ) {
          sceneHistorySentryLoggedRef.current.add(built.id)
          Sentry.captureMessage('image_generation_success', {
            level: 'info',
            extra: { model, size, resolution, scenes: built.outputUrls.length },
          })
        }
      } else {
        setGenErrorText('')
        setGenErrorCode('UNKNOWN')
      }
    },
    [model, size, resolution, imageModelOptions, productInfo.name, productAnalysisText, isSimpleImageGen],
  )

  /** 场景看板 ⇄ 生成历史：实时同步（进行中增量、多轮合并同一 id、刷新后可从 localStorage 恢复看板） */
  useEffect(() => {
    if (!sceneRunBoard || !sceneRunBoard.slots.length) return
    const imageWorkStarted = sceneRunBoard.slots.some(
      (s) => s.status === 'generating' || s.status === 'done' || s.status === 'failed',
    )
    /** 仅点了「一键生成图片」或单张出图后才有历史；仅「免费生成预览」不写入，避免换主图后残留假「生成中」 */
    if (!imageWorkStarted) {
      setImageGenHistory((prev) => prev.filter((t) => t.id !== sceneRunBoard.id))
      setGenErrorText('')
      setGenErrorCode('UNKNOWN')
      return
    }
    upsertImageHistoryFromBoard(sceneRunBoard)
  }, [sceneRunBoard, upsertImageHistoryFromBoard])

  useEffect(() => {
    const first = refImages[0]?.url || ''
    setRefImagePreviewUrl(first)
    setRefImageDataUrl(first)
  }, [refImages])

  useEffect(() => {
    if (refImages.length > 0) {
      setOneClickNeedRefHint(false)
      window.clearTimeout(oneClickHintTimerRef.current)
    }
  }, [refImages.length])

  useEffect(() => {
    if (refImages.length === 0) setProductStylePanelOpen(false)
  }, [refImages.length])

  useEffect(() => {
    return () => window.clearTimeout(oneClickHintTimerRef.current)
  }, [])

  const removeRefImage = (id: string) => {
    setRefImages((prev) => prev.filter((x) => x.id !== id))
  }

  /** 删除主参考图后清空与本次分析/场景相关的编辑态（不删生成历史归档） */
  const clearImageGenPageAfterMainRefRemoved = () => {
    const snap = sceneRunBoardRef.current
    const hasInFlight = !!snap?.slots.some((s) => s.selected && s.status === 'generating')
    const productNameSnap = productInfo.name?.trim() || ''
    if (!hasInFlight && snap?.slots.some((s) => s.status === 'done' && s.imageUrl)) {
      const resLb =
        resolution === '1024' ? '1k' : resolution === '1536' ? '1.5k' : resolution === '2048' ? '2k' : resolution === '4096' ? '4k' : String(resolution)
      const modelLabel = imageModelOptions.find((m) => m.id === model)?.name || model
      const normalized = sceneBoardForgetInflightSlots(snap)
      const built = buildHistoryTaskFromSceneBoard(
        normalized,
        model,
        modelLabel,
        size,
        resLb,
        productNameSnap,
        productAnalysisText,
        isSimpleImageGen,
      )
      setImageGenHistory((prev) => {
        const i = prev.findIndex((t) => t.id === built.id)
        const keepTs = i >= 0 ? prev[i].ts : built.ts
        const rest = prev.filter((t) => t.id !== built.id)
        return [{ ...built, ts: keepTs }, ...rest].slice(0, IMAGE_GEN_HISTORY_MAX)
      })
    } else if (snap && !hasInFlight) {
      setImageGenHistory((prev) => prev.filter((t) => t.id !== snap.id))
    }

    /** 存在进行中任务时，保留看板/历史与批量状态，避免任务从页面瞬间消失 */
    if (!hasInFlight) {
      sceneBatchDepthRef.current = 0
      setSceneBatchGenerating(false)
    }
    setHotStyles([])
    setSelectedHotStyleIndex(0)
    setProductAnalysisText('')
    setProductInfo({ ...DEFAULT_PRODUCT_INFO })
    if (!hasInFlight) setSceneRunBoard(null)
    setPrompt('')
    setOptimizedPrompt('')
    setOptimizedNegativePrompt('')
    setPromptParts({})
    setPromptGenOutputSettings(null)
    setCategoryHint('other')
    setImageScenes(
      IMAGE_SCENE_BLUEPRINT.map((b) => ({
        key: b.key,
        title: b.title,
        description: '',
        imagePrompt: '',
        selected: true,
      })),
    )
    setProductStylePanelOpen(false)
    setGenErrorText('')
    setGenErrorCode('UNKNOWN')
    setSimpleDirectPrompt('')
  }

  const requestRemoveRefImage = (id: string, slotIndex: number) => {
    const isMain = slotIndex === 0
    const hasInFlight = !!sceneRunBoardRef.current?.slots.some(
      (s) => s.selected && s.status === 'generating',
    )
    const hasAnalysisOrBoard = isSimpleImageGen
      ? simpleDirectPrompt.trim() !== '' || sceneRunBoard != null
      : hotStyles.length > 0 || productAnalysisText.trim() !== '' || sceneRunBoard != null
    if (isMain && hasAnalysisOrBoard) {
      const ok = window.confirm(
        isSimpleImageGen
          ? hasInFlight
            ? '删除主参考图后，当前提示词会被清空，但进行中的生成任务会继续并保留在生成历史中。是否继续删除？'
            : '删除主参考图后，当前提示词与进行中的生成任务将被清空。是否继续删除？'
          : hasInFlight
            ? '删除主参考图后，商品分析/爆款风格会被清空；进行中的生成任务不会中断，仍会继续显示在生成历史中。是否继续删除？'
            : '删除主参考图后，当前页面内的商品分析、爆款风格与场景看板等内容将被清空。是否继续删除？',
      )
      if (!ok) return
      clearImageGenPageAfterMainRefRemoved()
    }
    removeRefImage(id)
  }

  const moveRefImage = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return
    setRefImages((prev) => {
      const fromIdx = prev.findIndex((x) => x.id === fromId)
      const toIdx = prev.findIndex((x) => x.id === toId)
      if (fromIdx < 0 || toIdx < 0) return prev
      const next = [...prev]
      const [picked] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, picked)
      return next
    })
  }

  const handleLocalRefUpload = async (files: FileList | null) => {
    if (!files?.length) return
    const remain = Math.max(0, MAX_REF_IMAGES - refImages.length)
    if (remain <= 0) {
      setRefUploadNotice('最大可支持上传5张')
      return
    }
    if (files.length > remain) setRefUploadNotice('最大可支持上传5张')
    else setRefUploadNotice('')
    const picked = Array.from(files).slice(0, remain)
    setRefUploadBusy(true)
    try {
      const baseTs = Date.now()
      const next = await Promise.all(
        picked.map(async (f, i) => {
          const dataUrl = await fileToDataUrl(f)
          void safeArchiveAsset({
            source: 'user_upload',
            type: 'image',
            url: dataUrl,
            name: f.name,
            metadata: { from: 'image_generator_ref_multi', mime: f.type, size: f.size },
          })
          return {
            id: `local_${baseTs}_${i}_${Math.random().toString(16).slice(2)}`,
            url: dataUrl,
            name: f.name,
            source: 'local' as const,
          }
        }),
      )
      setRefImages((prev) => [...prev, ...next].slice(0, MAX_REF_IMAGES))
    } finally {
      setRefUploadBusy(false)
    }
  }

  const loadAssetPicker = async (source: 'user_upload' | 'ai_generated') => {
    const cached = assetCacheRef.current[source]
    if (cached && cached.length) {
      setAssetList(cached)
      return
    }
    setAssetBusy(true)
    try {
      const r = await listAssetsAPI({ source, type: 'image', limit: 60, offset: 0 })
      const rows = (r.assets || []).filter((x) => x.type === 'image')
      setAssetList(rows)
      assetCacheRef.current[source] = rows
    } finally {
      setAssetBusy(false)
    }
  }

  useEffect(() => {
    if (!showAssetPicker) return
    void loadAssetPicker(assetTab)
  }, [showAssetPicker, assetTab])

  const toggleAssetPick = (id: string) => {
    setAssetSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else {
        const already = refImages.length + next.size
        if (already >= MAX_REF_IMAGES) return next
        next.add(id)
      }
      return next
    })
  }

  const confirmAssetPick = () => {
    const picked = assetList.filter((x) => assetSelectedIds.has(x.id)).map((x) => ({ id: `asset_${x.id}`, url: x.url, name: x.name || '资产图片', source: 'asset' as const }))
    if (picked.length) setRefImages((prev) => [...prev, ...picked].slice(0, MAX_REF_IMAGES))
    setAssetSelectedIds(new Set())
    setShowAssetPicker(false)
  }

  useEffect(() => {
    if (!previewRefImage) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewRefImage(null)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [previewRefImage])

  useEffect(() => {
    if (!historyLightbox) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHistoryLightbox(null)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [historyLightbox])

  useEffect(() => {
    ;(async () => {
      try {
        const token = localStorage.getItem('tikgen.accessToken') || ''
        if (!token) return
        const r = await getModelAvailabilityAPI(token)
        const map: Record<string, string> = {}
        for (const x of r.image || []) map[String(x.id)] = String(x.reason || '暂不可用')
        try {
          const resp = await fetch('/api/model-controls?type=image')
          const data = await resp.json()
          if (data?.success && Array.isArray(data.controls)) {
            let recommended = ''
            for (const c of data.controls) {
              const id = String(c.model_id || '')
              if (!id) continue
              if (c.enabled === false) map[id] = String(c.note || '后台已禁用')
              if (!recommended && c.recommended === true && c.enabled !== false) recommended = id
            }
            if (recommended) setModel(recommended)
          }
        } catch {
          // ignore controls loading failures
        }
        setUnavailableImageMap(map)
      } catch {
        // ignore
      }
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const resp = await fetch('/api/models')
        const text = await resp.text()
        const data = (() => {
          try {
            return JSON.parse(text)
          } catch {
            return { success: false, error: text }
          }
        })()
        if (!resp.ok || !data?.success) return
        const list = data?.data?.data
        if (!Array.isArray(list)) return
        const looksLikeImageModel = (id: string) => {
          const s = String(id || '').toLowerCase()
          return (
            s.includes('nano-banana') ||
            s.includes('flux') ||
            s.includes('seedream') ||
            s.includes('dall-e') ||
            s.includes('gpt-image') ||
            s.includes('midjourney') ||
            s.includes('ideogram') ||
            s.includes('recraft') ||
            s.includes('qwen-image') ||
            s.includes('kolors') ||
            s.includes('stable-diffusion')
          )
        }

        const imgs = list
          .filter((m: any) => {
            const id = String(m?.id || '')
            const types: string[] = Array.isArray(m?.supported_endpoint_types) ? m.supported_endpoint_types.map(String) : []
            // 部分模型（如 nano-banana 系列）可能未标注 image-generation，但仍可用于电商套图
            return types.includes('image-generation') || looksLikeImageModel(id)
          })
          .map((m: any) => ({ id: String(m.id), name: String(m.id) }))
        if (imgs.length) {
          // merge with friendly names
          const friendly = new Map(IMAGE_MODELS.map((x) => [x.id, x.name]))
          const merged = imgs.map((x: any) => ({ id: x.id, name: friendly.get(x.id) || x.name }))
          setImageModels(merged)
          if (!merged.some((x: any) => x.id === model)) setModel(merged[0].id)
        }
      } catch {
        // ignore
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const imageCaps = useMemo<ImageModelCaps>(() => {
    // 若模型ID包含明确分辨率后缀（如 *-2k/*-4k/*-512px），优先按后缀限制分辨率
    const id = String(model || '')
    const bySuffix = (() => {
      if (/-4k\b/i.test(id)) return { resolutions: ['4096'] as ImageRes[], defaults: { aspectRatio: '1:1' as ImageAspect, resolution: '4096' as ImageRes } }
      if (/-2k\b/i.test(id)) return { resolutions: ['2048'] as ImageRes[], defaults: { aspectRatio: '1:1' as ImageAspect, resolution: '2048' as ImageRes } }
      if (/512px/i.test(id)) return { resolutions: ['1024'] as ImageRes[], defaults: { aspectRatio: '1:1' as ImageAspect, resolution: '1024' as ImageRes } }
      return null
    })()

    const base =
      IMAGE_MODEL_CAPS[model] || {
        aspectRatios: [...IMAGE_ASPECT_OPTIONS],
        resolutions: [...IMAGE_RES_OPTIONS],
        defaults: { aspectRatio: '1:1', resolution: '1024' },
      }
    if (bySuffix) return { ...base, resolutions: bySuffix.resolutions, defaults: { ...base.defaults, ...bySuffix.defaults } }
    return base
  }, [model])

  useEffect(() => {
    if (!imageCaps.aspectRatios.includes(size)) setSize(imageCaps.defaults.aspectRatio)
    if (!imageCaps.resolutions.includes(resolution)) setResolution(imageCaps.defaults.resolution)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  useEffect(() => {
    const selected = imageModelOptions.find((x) => x.id === model)
    if (selected && !selected.unavailableReason) return
    const firstAvailable = imageModelOptions.find((x) => !x.unavailableReason)
    if (firstAvailable && firstAvailable.id !== model) setModel(firstAvailable.id)
  }, [imageModelOptions, model])

  useEffect(() => {
    if (!templatePreset || !visible) return
    if (templatePreset.model) setModel(String(templatePreset.model))
    if (templatePreset.aspectRatio) setSize(String(templatePreset.aspectRatio) as ImageAspect)
    if (templatePreset.resolution) setResolution(String(templatePreset.resolution) as ImageRes)
    if (isSimpleImageGen) setSimpleDirectPrompt(String(templatePreset.prompt || ''))
    else setPrompt(String(templatePreset.prompt || ''))
    setPromptGenOutputSettings(null)
    onTemplateApplied()
  }, [templatePreset, onTemplateApplied, visible, isSimpleImageGen])

  /** 卡片上已有完整 imagePrompt 时直接应用；否则走 image-prompt 接口兜底 */
  const regeneratePromptFromStyleApi = async (idx: number) => {
    if (!hotStyles[idx]) return
    const jobId = ++aiJobRef.current
    setPromptRegenSource('styleCard')
    setPromptRegenBusy(true)
    setAiError('')
    try {
      const aspectRatio = size
      const res = resolution
      const st = hotStyles[idx]
      const r = await generateImagePrompt({
        product: productInfo,
        language: productInfo.language || '简体中文',
        aspectRatio,
        resolution: res,
        sceneMode,
        hotSellingStyle: { title: st.title, description: st.description },
        productAnalysisNotes: productAnalysisText.trim() || undefined,
      })
      applyGeneratedImagePrompt(jobId, r, aspectRatio, res, { title: st.title, description: st.description })
      const merged = String(r.prompt || '').trim()
      if (merged) {
        setHotStyles((prev) => prev.map((s, i) => (i === idx ? { ...s, imagePrompt: merged } : s)))
      }
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      alert(e?.message || '更新画面描述失败')
    } finally {
      if (jobId === aiJobRef.current) {
        setPromptRegenBusy(false)
        setPromptRegenSource(null)
      }
    }
  }

  const selectHotStyleCard = (idx: number) => {
    if (!hotStyles[idx]) return
    setSelectedHotStyleIndex(idx)
    const st = hotStyles[idx]
    if (String(st.imagePrompt || '').trim()) {
      const jobId = ++aiJobRef.current
      applyStyleCardAsMainPrompt(jobId, st)
      return
    }
    void regeneratePromptFromStyleApi(idx)
  }

  const clearProductAnalysisRevealTimers = () => {
    if (productAnalysisRevealTimerRef.current != null) {
      window.clearTimeout(productAnalysisRevealTimerRef.current)
      productAnalysisRevealTimerRef.current = null
    }
    setProductAnalysisStreamReveal(false)
  }

  const scheduleProductAnalysisReveal = (jobId: number, fullText: string) => {
    clearProductAnalysisRevealTimers()
    setProductAnalysisStreamReveal(true)
    const steps = buildProductAnalysisRevealSteps(fullText)
    let i = 0
    const scrollTextareaToEnd = () => {
      requestAnimationFrame(() => {
        const el = productAnalysisWorkbenchTextareaRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
      })
    }
    const tick = () => {
      if (jobId !== aiJobRef.current) return
      setProductAnalysisText(steps[i] ?? '')
      scrollTextareaToEnd()
      i += 1
      if (i >= steps.length) {
        productAnalysisRevealTimerRef.current = null
        setProductAnalysisStreamReveal(false)
        scrollTextareaToEnd()
        return
      }
      const prev = steps[i - 1] ?? ''
      const cur = steps[i] ?? ''
      const delta = Math.max(1, cur.length - prev.length)
      /** 大段略慢、小段轻快，整体更顺滑 */
      const delay = Math.min(175, Math.max(16, 20 + Math.sqrt(delta) * 2.35))
      productAnalysisRevealTimerRef.current = window.setTimeout(tick, delay)
    }
    productAnalysisRevealTimerRef.current = window.setTimeout(tick, 0)
  }

  const handleOneClickFill = async () => {
    if (!refImages.length) {
      window.clearTimeout(oneClickHintTimerRef.current)
      setOneClickNeedRefHint(true)
      oneClickHintTimerRef.current = window.setTimeout(() => setOneClickNeedRefHint(false), 4500)
      return
    }
    const jobId = ++aiJobRef.current
    setOneClickNeedRefHint(false)
    setAiError('')
    clearProductAnalysisRevealTimers()
    setProductStylePanelOpen(true)
    setOneClickAnalysisPhase('product')
    setWorkbenchFullAnalysisBusy(true)

    const hotStylesRollback = hotStyles.slice()
    let nextProduct: ProductInfo = productInfo
    let analysisText = productAnalysisText
    let styles: ImageWorkbenchStyleRow[] = []
    let gotProductResponse = false
    try {
      const wProduct = await imageWorkbenchAnalysis({
        refImage: refImageDataUrl,
        language: productInfo.language || '简体中文',
        mode: 'product',
        targetPlatform: productInfo.targetPlatform,
        targetMarket: productInfo.targetMarket,
      })
      if (jobId !== aiJobRef.current) return
      gotProductResponse = true
      nextProduct = {
        ...productInfo,
        name: wProduct.product?.name || '',
        category: wProduct.product?.category || '',
        sellingPoints: wProduct.product?.sellingPoints || '',
        targetAudience: wProduct.product?.targetAudience || '',
        language: wProduct.product?.language || productInfo.language || '简体中文',
      }
      analysisText = filterProductAnalysisText(wProduct.productAnalysisText || '')
      setProductInfo(nextProduct)
      scheduleProductAnalysisReveal(jobId, analysisText)

      setOneClickAnalysisPhase('styles')
      setHotStyles([])

      const wStyles = await imageWorkbenchAnalysis({
        refImage: refImageDataUrl,
        language: nextProduct.language || '简体中文',
        mode: 'styles',
        targetPlatform: nextProduct.targetPlatform,
        targetMarket: nextProduct.targetMarket,
      })
      if (jobId !== aiJobRef.current) return
      styles = sanitizeWorkbenchStylesFromApi(wStyles.styles || [])
      setHotStyles(styles)
      setHotStylesRevealEpoch((e) => e + 1)
      setSelectedHotStyleIndex(0)
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      clearProductAnalysisRevealTimers()
      setHotStyles(hotStylesRollback)
      if (gotProductResponse) setProductAnalysisText(analysisText)
      setAiError(e?.message || '分析失败')
      return
    } finally {
      if (aiJobRef.current === jobId) {
        setWorkbenchFullAnalysisBusy(false)
        setOneClickAnalysisPhase(null)
      }
    }
    if (jobId !== aiJobRef.current) return
    const style0 = styles[0]
    const ip0 = String(style0?.imagePrompt || '').trim()
    if (ip0 && jobId === aiJobRef.current) {
      applyStyleCardAsMainPrompt(jobId, style0, nextProduct)
      setProductStylePanelOpen(true)
      return
    }
    setPromptRegenSource('oneClick')
    setPromptRegenBusy(true)
    try {
      const aspectRatio = size
      const res = resolution
      const r = await generateImagePrompt({
        product: nextProduct,
        language: nextProduct.language || '简体中文',
        aspectRatio,
        resolution: res,
        sceneMode,
        hotSellingStyle: style0?.description ? { title: style0.title, description: style0.description } : undefined,
        productAnalysisNotes: analysisText.trim() || undefined,
      })
      if (jobId !== aiJobRef.current) return
      applyGeneratedImagePrompt(
        jobId,
        r,
        aspectRatio,
        res,
        style0?.description ? { title: style0.title, description: style0.description } : null,
        nextProduct,
      )
      const merged0 = String(r.prompt || '').trim()
      if (merged0) {
        setHotStyles((prev) => prev.map((s, i) => (i === 0 ? { ...s, imagePrompt: merged0 } : s)))
      }
      setProductStylePanelOpen(true)
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '生成出图描述失败')
    } finally {
      if (jobId === aiJobRef.current) {
        setPromptRegenBusy(false)
        setPromptRegenSource(null)
      }
    }
  }

  const handleProductAnalysisAiOnly = async () => {
    if (!refImages.length) {
      window.clearTimeout(oneClickHintTimerRef.current)
      setOneClickNeedRefHint(true)
      oneClickHintTimerRef.current = window.setTimeout(() => setOneClickNeedRefHint(false), 4500)
      return
    }
    const selStyleIdx = selectedHotStyleIndex
    const stylePick = hotStyles[selStyleIdx]
    const jobId = ++aiJobRef.current
    setAiError('')
    clearProductAnalysisRevealTimers()
    setProductAnalysisOnlyBusy(true)
    let nextProduct: ProductInfo = productInfo
    let analysisText = productAnalysisText
    try {
      const w = await imageWorkbenchAnalysis({
        refImage: refImageDataUrl,
        language: productInfo.language || '简体中文',
        mode: 'product',
        targetPlatform: productInfo.targetPlatform,
        targetMarket: productInfo.targetMarket,
      })
      if (jobId !== aiJobRef.current) return
      nextProduct = {
        ...productInfo,
        name: w.product?.name || '',
        category: w.product?.category || '',
        sellingPoints: w.product?.sellingPoints || '',
        targetAudience: w.product?.targetAudience || '',
        language: w.product?.language || productInfo.language || '简体中文',
      }
      analysisText = filterProductAnalysisText(w.productAnalysisText || '')
      setProductAnalysisText(analysisText)
      setProductInfo(nextProduct)
      setHotStyles((prev) => prev.map((s) => ({ ...s, imagePrompt: '' })))
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '商品分析失败')
      return
    } finally {
      if (aiJobRef.current === jobId) setProductAnalysisOnlyBusy(false)
    }
    if (jobId !== aiJobRef.current) return
    setPromptRegenSource('product')
    setPromptRegenBusy(true)
    try {
      const aspectRatio = size
      const res = resolution
      const r = await generateImagePrompt({
        product: nextProduct,
        language: nextProduct.language || '简体中文',
        aspectRatio,
        resolution: res,
        sceneMode,
        hotSellingStyle: stylePick?.description
          ? { title: stylePick.title, description: stylePick.description }
          : undefined,
        productAnalysisNotes: analysisText.trim() || undefined,
      })
      applyGeneratedImagePrompt(
        jobId,
        r,
        aspectRatio,
        res,
        stylePick?.description ? { title: stylePick.title, description: stylePick.description } : null,
        nextProduct,
      )
      const mergedP = String(r.prompt || '').trim()
      if (mergedP) {
        setHotStyles((prev) => prev.map((s, i) => (i === selStyleIdx ? { ...s, imagePrompt: mergedP } : s)))
      }
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '生成出图描述失败')
    } finally {
      if (jobId === aiJobRef.current) {
        setPromptRegenBusy(false)
        setPromptRegenSource(null)
      }
    }
  }

  const handleHotStylesReanalyze = async () => {
    if (!refImages.length) {
      window.clearTimeout(oneClickHintTimerRef.current)
      setOneClickNeedRefHint(true)
      oneClickHintTimerRef.current = window.setTimeout(() => setOneClickNeedRefHint(false), 4500)
      return
    }
    const jobId = ++aiJobRef.current
    setAiError('')
    setHotStylesReanalyzeBusy(true)
    let styles: { title: string; description: string; imagePrompt?: string }[] = []
    let nextIdx = 0
    try {
      const w = await imageWorkbenchAnalysis({
        refImage: refImageDataUrl,
        language: productInfo.language || '简体中文',
        mode: 'styles',
        targetPlatform: productInfo.targetPlatform,
        targetMarket: productInfo.targetMarket,
      })
      if (jobId !== aiJobRef.current) return
      styles = sanitizeWorkbenchStylesFromApi(w.styles || [])
      nextIdx = Math.min(selectedHotStyleIndex, Math.max(0, styles.length - 1))
      setHotStyles(styles)
      setSelectedHotStyleIndex(nextIdx)
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '爆款风格分析失败')
      return
    } finally {
      if (aiJobRef.current === jobId) setHotStylesReanalyzeBusy(false)
    }
    if (jobId !== aiJobRef.current) return
    const pick = styles[nextIdx]
    const ip = String(pick?.imagePrompt || '').trim()
    if (ip && jobId === aiJobRef.current) {
      applyStyleCardAsMainPrompt(jobId, pick)
      return
    }
    setPromptRegenSource('styles')
    setPromptRegenBusy(true)
    try {
      const aspectRatio = size
      const res = resolution
      const r = await generateImagePrompt({
        product: productInfo,
        language: productInfo.language || '简体中文',
        aspectRatio,
        resolution: res,
        sceneMode,
        hotSellingStyle: pick?.description ? { title: pick.title, description: pick.description } : undefined,
        productAnalysisNotes: productAnalysisText.trim() || undefined,
      })
      applyGeneratedImagePrompt(
        jobId,
        r,
        aspectRatio,
        res,
        pick?.description ? { title: pick.title, description: pick.description } : null,
      )
      const mergedH = String(r.prompt || '').trim()
      if (mergedH) {
        setHotStyles((prev) => prev.map((s, i) => (i === nextIdx ? { ...s, imagePrompt: mergedH } : s)))
      }
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || '生成出图描述失败')
    } finally {
      if (jobId === aiJobRef.current) {
        setPromptRegenBusy(false)
        setPromptRegenSource(null)
      }
    }
  }

  const handleRegeneratePromptWithCurrentOutput = async () => {
    if (!refImages.length) {
      setOneClickNeedRefHint(true)
      window.clearTimeout(oneClickHintTimerRef.current)
      oneClickHintTimerRef.current = window.setTimeout(() => setOneClickNeedRefHint(false), 4500)
      return
    }
    const jobId = ++aiJobRef.current
    setPromptRegenSource('spec')
    setPromptRegenBusy(true)
    setAiError('')
    try {
      const aspectRatio = size
      const res = resolution
      const r = await generateImagePrompt({
        product: productInfo,
        language: productInfo.language || '简体中文',
        aspectRatio,
        resolution: res,
        sceneMode,
        hotSellingStyle:
          hotStyles[selectedHotStyleIndex]?.description
            ? {
                title: hotStyles[selectedHotStyleIndex].title,
                description: hotStyles[selectedHotStyleIndex].description,
              }
            : undefined,
        productAnalysisNotes: productAnalysisText.trim() || undefined,
      })
      if (jobId !== aiJobRef.current) return
      const hs = hotStyles[selectedHotStyleIndex]
      applyGeneratedImagePrompt(
        jobId,
        r,
        aspectRatio,
        res,
        hs?.description ? { title: hs.title, description: hs.description } : null,
      )
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      alert(e?.message || '重新生成失败')
    } finally {
      if (jobId === aiJobRef.current) {
        setPromptRegenBusy(false)
        setPromptRegenSource(null)
      }
    }
  }

  const handleNext = async () => {
    setAiError('')
    if (modalStep === 1) {
      setModalStep(2)
      const jobId = ++aiJobRef.current
      setIsAiBusy(true)
      try {
        const aspectRatio = size
        const res = resolution
        const r = await generateImagePrompt({
          product: productInfo,
          language: productInfo.language,
          aspectRatio,
          resolution: res,
          sceneMode,
          hotSellingStyle:
            hotStyles[selectedHotStyleIndex]?.description
              ? {
                  title: hotStyles[selectedHotStyleIndex].title,
                  description: hotStyles[selectedHotStyleIndex].description,
                }
              : undefined,
          productAnalysisNotes: productAnalysisText.trim() || undefined,
        })
        if (jobId !== aiJobRef.current) return
        const hs = hotStyles[selectedHotStyleIndex]
        applyGeneratedImagePrompt(
          jobId,
          r,
          aspectRatio,
          res,
          hs?.description ? { title: hs.title, description: hs.description } : null,
        )
      } catch (e: any) {
        if (jobId !== aiJobRef.current) return
        setAiError(e?.message || '提示词生成失败')
      } finally {
        if (jobId !== aiJobRef.current) return
        setIsAiBusy(false)
      }
      return
    }
    setShowModal(false)
    setPrompt(optimizedPrompt)
  }

  const handlePrev = () => {
    if (isAiBusy) return
    if (modalStep > 1) setModalStep(modalStep - 1)
  }

  const handleStepJump = (target: 1 | 2) => {
    if (isAiBusy) return
    if (target === modalStep) return
    if (target === 1) {
      setModalStep(1)
      return
    }
    if (modalStep === 1 && !optimizedPrompt && !Object.keys(promptParts || {}).length) {
      void handleNext()
      return
    }
    setModalStep(2)
  }

  const startSmoothGenProgress = () => {
    const startedAt = Date.now()
    // 指数趋近上限：在不知道真实耗时时，避免 20s 内就顶到 97% 然后长时间不动
    const cap = 95
    const tauMs = 44000 // 越大整体越慢；约 90s 时在 80%+，约 2–3 分钟仍不会贴死上限
    const tickMs = 320
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt
      const eased = 1 - Math.exp(-elapsed / tauMs)
      const target = 2 + (cap - 2) * eased
      setGenProgress((p) => Math.max(p, Math.min(cap, Math.round(target))))
    }, tickMs)
    return () => clearInterval(timer)
  }

  const completeGenProgress = async () => {
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        let done = false
        setGenProgress((p) => {
          if (p >= 100) {
            done = true
            return 100
          }
          const step = p >= 96 ? 1 : p >= 90 ? 2 : 3
          return Math.min(100, p + step)
        })
        if (done) {
          clearInterval(timer)
          resolve()
        }
      }, 40)
    })
  }

  const buildPromptFromParts = (parts: any) => {
    const pick = (k: string) => String(parts?.[k] || '').trim()
    const segs = [pick('subject'), pick('scene'), pick('composition'), pick('lighting'), pick('camera'), pick('style'), pick('quality'), pick('extra')].filter(Boolean)
    return segs.join('，')
  }

  const IMAGE_STYLE_TAGS = [
    { id: 'clean', label: '主图干净' },
    { id: 'premium', label: '高端棚拍' },
    { id: 'lifestyle', label: '生活场景' },
    { id: 'macro', label: '细节特写' },
    { id: 'clarity', label: '信息清晰' },
    { id: 'texture', label: '质感提升' },
  ] as const

  const applyLocalStyleRule = (tagLabel: string, parts: any) => {
    const next = { ...(parts || {}) }
    const append = (k: string, v: string) => {
      const base = String(next?.[k] || '').trim()
      next[k] = base ? `${base}；${v}` : v
    }
    switch (tagLabel) {
      case '生活场景':
        append('scene', '生活场景但背景弱化：与商品相关的环境，背景轻虚化，不抢主体，画面干净')
        append('composition', '主体占画面60–80%，场景元素1–2个做陪衬，不遮挡主体')
        append('lighting', '自然柔光，真实但不杂乱，避免强阴影')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'clutter, messy background, distracting objects'))
        break
      case '细节特写':
        append('camera', '微距/近景特写，50–90mm，浅景深，对焦在关键结构细节')
        append('composition', '突出关键卖点细节（材质纹理/接口/按键/结构），主体占比更高')
        append('quality', '细节锐利，纹理真实，边缘干净')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'soft focus, motion blur, low detail'))
        break
      case '信息清晰':
        append('composition', '构图规整，主体居中或三分法，背景纯净，留白用于贴标，信息层级清晰')
        append('lighting', '均匀柔光，减少戏剧化光影')
        append('style', '电商主图风格，清晰直观，少艺术化')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'dramatic lighting, heavy vignette, artsy, clutter'))
        break
      case '质感提升':
        append('lighting', '高级柔光箱+轮廓光，控制高光不过曝，材质高光自然')
        append('style', '真实商业摄影，材质更真实（避免塑料感/油腻感）')
        append('quality', '高动态范围，干净锐利，细节丰富')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'plastic, oily, waxy, over-sharpen, oversaturated'))
        break
      case '高端棚拍':
        append('lighting', '三点布光/柔光箱，精致高光与边缘轮廓光，干净反射')
        append('scene', '高级摄影棚背景（纯色/高级渐变/微纹理），干净无噪点')
        append('style', 'premium commercial product photography')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'cheap look, harsh shadow, noisy background'))
        break
      case '主图干净':
        append('scene', '棚拍纯色/轻渐变背景，无杂物，道具极少')
        append('composition', '主体约70–80%，边缘干净，四周留白用于贴标')
        setOptimizedNegativePrompt((prev) => mergeNegative(prev, 'props, clutter, busy background'))
        break
      default:
        break
    }
    return next
  }

  const toggleStyleTag = (tagLabel: string) => {
    setSelectedStyleTags((prev) => {
      const has = prev.includes(tagLabel)
      const nextSel = has ? prev.filter((x) => x !== tagLabel) : [...prev, tagLabel]
      return nextSel
    })
    // 本地规则即时生效（只做追加；取消选择不做回滚，避免惊跳）
    const nextParts = applyLocalStyleRule(tagLabel, promptParts)
    setPromptParts(nextParts)
    setOptimizedPrompt(buildPromptFromParts(nextParts))
  }

  const handleAiPolish = async () => {
    const tags = selectedStyleTags
    if (!tags.length) return
    setAiError('')
    const jobId = ++aiJobRef.current
    setIsAiBusy(true)
    try {
      const currentParts = Object.keys(promptParts || {}).length ? promptParts : {}
      const learned = loadCategoryTweaks(String(categoryHint || 'other'))
      const result = await applyImageStyleTags({
        tags,
        language: productInfo.language || '简体中文',
        parts: currentParts,
        prompt: optimizedPrompt || '',
        negativePrompt: optimizedNegativePrompt || '',
        aspectRatio: size,
        resolution,
        product: productInfo,
        categoryHint,
        sceneMode,
        learnedTweaks: learned,
      })
      if (jobId !== aiJobRef.current) return
      setPromptParts(result.parts || currentParts)
      const nextPrompt = result.prompt || buildPromptFromParts(result.parts || currentParts)
      setOptimizedPrompt(nextPrompt)
      setOptimizedNegativePrompt(result.negativePrompt || '')
      setSelectedStyleTags([])
    } catch (e: any) {
      if (jobId !== aiJobRef.current) return
      setAiError(e?.message || 'AI精修失败')
    } finally {
      if (jobId !== aiJobRef.current) return
      setIsAiBusy(false)
    }
  }

  const handleCloseAiBusy = () => {
    aiJobRef.current += 1
    setIsAiBusy(false)
    setWorkbenchFullAnalysisBusy(false)
    setProductAnalysisOnlyBusy(false)
    setHotStylesReanalyzeBusy(false)
    setPromptRegenBusy(false)
    setPromptRegenSource(null)
    setAiError('')
    if (modalStep === 1) {
      setShowModal(false)
      return
    }
    setModalStep(1)
  }

  const applyInfographicTemplate = (tpl: 'feature' | 'scene') => {
    const baseNeg =
      'blurry, lowres, watermark, logo, unreadable text, garbled text, misspelled words, duplicate product, extra tools, extra handles, extra nozzles, deformed, broken proportions, messy background, harsh shadows, overexposed, underexposed, noise'
    const neg = baseNeg

    if (tpl === 'feature') {
      const m: 'clean' | 'lite' = 'clean'
      setSceneMode(m)
      const parts = applySceneModePreset(m, {
        subject: '参考图同款产品一致（外形/配色/结构/角度保持一致），商业级质感，边缘清晰',
        scene: '浅色干净渐变背景（可带轻微浅绿/浅灰），信息图海报风格',
        composition: '主体占画面60–80%，左上角留出标题区，右上角留出参数标注区，中下方留出局部放大圈区域',
        lighting: '柔光箱棚拍光，细节清晰，高级质感，不过曝不过暗',
        camera: '50mm，近景产品主视角，轻微透视，画面干净',
        style: '电商功能示意信息图（Amazon卖点图风格），图标/箭头/标注清晰',
        quality: '高清，锐利，文字清晰可读，无乱码，无水印',
        extra:
          '版式要求：包含“180° ROTARY ADJUSTMENT / Switching Between Two Modes / 0°-180° Rotation Range”等标题与标注；加入弧形箭头、旋转范围示意、圆形局部放大圈展示旋转关节；整体排版规整，留白用于贴标',
      })
      setPromptParts(parts)
      setOptimizedNegativePrompt((prev) => mergeNegative(prev, neg))
      setOptimizedPrompt(buildPromptFromParts(parts))
      return
    }

    const m: 'clean' | 'lite' = 'lite'
    setSceneMode(m)
    const parts = applySceneModePreset(m, {
      subject: '参考图同款产品一致（外形/配色/结构保持一致），商业摄影质感，主体清晰',
      scene: '电商投放海报：左侧生活场景使用照（户外/庭院吹落叶等），右侧信息面板对比卖点列表',
      composition:
        '1:1海报版式：左侧大图人物使用场景（不需要人脸特写），右侧浅色信息面板；主体占比60–80%，信息面板内容清晰可读，层级分明',
      lighting: '自然柔光 + 轻轮廓光，真实场景但不杂乱，主体清晰',
      camera: '35–50mm，中景到近景，人物+产品同框，背景轻虚化',
      style: '电商场景对比海报（投放素材风格），勾选/叉号列表+小窗格对比',
      quality: '高清，锐利，文字清晰可读，无乱码，无水印',
      extra:
        '版式要求：顶部大标题“GOOD SUBSTITUTE FOR TRADITIONAL BLOWERS”；右侧包含绿色勾选卖点列表与红色叉号对比列表；右侧可有2–3个小场景窗格做对比示意；整体背景干净不抢主体',
    })
    setPromptParts(parts)
    setOptimizedNegativePrompt((prev) => mergeNegative(prev, neg))
    setOptimizedPrompt(buildPromptFromParts(parts))
  }

  const applySceneModePreset = (mode: 'clean' | 'lite', parts: any) => {
    const next = { ...(parts || {}) }
    // composition：强制加入电商主体占比规则（第一次生成时也会在后端 prompt 里约束）
    const baseComp = String(next.composition || '').trim()
    const compRule = '主体占画面60–80%（建议约70%），主体清晰锐利，留白用于贴标，背景不抢戏'
    next.composition = baseComp ? `${baseComp}；${compRule}` : compRule

    if (mode === 'clean') {
      const scene = '电商主图棚拍，纯色或轻渐变背景，干净无杂物（极少道具可选且不抢主体）'
      next.scene = String(next.scene || '').trim() ? `${String(next.scene).trim()}；${scene}` : scene
    } else {
      const scene = '电商投放轻场景：加入1–2个弱化场景元素/道具（虚化/弱化、不抢主体），背景依然干净'
      next.scene = String(next.scene || '').trim() ? `${String(next.scene).trim()}；${scene}` : scene
    }
    return next
  }

  const LS_KEY_IMG_TWEAKS = 'tikgen.imgTweaks.v1'
  const loadCategoryTweaks = (hint: string) => {
    try {
      const raw = localStorage.getItem(LS_KEY_IMG_TWEAKS)
      const obj = raw ? JSON.parse(raw) : {}
      return obj?.[hint] || null
    } catch {
      return null
    }
  }
  const saveCategoryTweaks = (hint: string, patch: any) => {
    try {
      const raw = localStorage.getItem(LS_KEY_IMG_TWEAKS)
      const obj = raw ? JSON.parse(raw) : {}
      const prev = obj?.[hint] || {}
      obj[hint] = { ...prev, ...patch, updatedAt: Date.now() }
      localStorage.setItem(LS_KEY_IMG_TWEAKS, JSON.stringify(obj))
    } catch {
      // ignore
    }
  }

  const applyLearnedTweaks = (hint: string, parts: any) => {
    const t = loadCategoryTweaks(hint)
    if (!t) return parts
    const next = { ...(parts || {}) }
    if (t.compositionAdd) next.composition = String(next.composition || '').trim() ? `${String(next.composition).trim()}；${t.compositionAdd}` : t.compositionAdd
    if (t.sceneAdd) next.scene = String(next.scene || '').trim() ? `${String(next.scene).trim()}；${t.sceneAdd}` : t.sceneAdd
    if (t.negativeAdd) setOptimizedNegativePrompt((prev) => mergeNegative(prev, t.negativeAdd))
    return next
  }

  const runImageScenePlan = async (
    basePromptText: string,
    hotStyleOverride?: { title: string; description: string } | null,
    productOverride?: ProductInfo,
  ): Promise<ImageSceneRow[] | null> => {
    const base = String(basePromptText || '').trim()
    if (!base) {
      const empty = IMAGE_SCENE_BLUEPRINT.map((b) => ({
        key: b.key,
        title: b.title,
        description: '',
        imagePrompt: '',
        selected: true,
      }))
      setImageScenes(empty)
      return empty
    }
    const jid = ++scenePlanJobRef.current
    setScenesPlanBusy(true)
    try {
      const stylePick =
        hotStyleOverride === null
          ? undefined
          : hotStyleOverride !== undefined
            ? hotStyleOverride
            : hotStyles[selectedHotStyleIndex]?.description
              ? hotStyles[selectedHotStyleIndex]
              : undefined
      const prod = productOverride || productInfo
      const slimStyle =
        stylePick && (stylePick.title || stylePick.description)
          ? { title: stylePick.title, description: stylePick.description }
          : undefined
      const r = await imageScenePlan({
        basePrompt: base,
        negativePrompt: optimizedNegativePrompt || undefined,
        product: prod,
        productAnalysisNotes: productAnalysisText.trim() || undefined,
        hotSellingStyle: slimStyle,
        language: prod.language || '简体中文',
      })
      if (jid !== scenePlanJobRef.current) return null
      const list = r.scenes || []
      const baseRows = IMAGE_SCENE_BLUEPRINT.map((bp, i) => {
        const ai = (list[i] || {}) as {
          title?: string
          description?: string
          imagePrompt?: string
          prompt?: string
        }
        return {
          key: bp.key,
          title: String(ai.title || bp.title).trim() || bp.title,
          description: String(ai.description || '').trim(),
          imagePrompt: String(ai.imagePrompt || ai.prompt || '').trim(),
          selected: true as boolean,
        }
      })
      setImageScenes((prev) =>
        baseRows.map((row) => ({
          ...row,
          selected: prev.find((p) => p.key === row.key)?.selected ?? true,
        })),
      )
      return baseRows
    } catch (e: any) {
      if (jid !== scenePlanJobRef.current) return null
      setAiError(e?.message || '场景方案生成失败')
      return null
    } finally {
      if (jid === scenePlanJobRef.current) setScenesPlanBusy(false)
    }
  }

  const refreshImageScenesPlanWithPrompt = async (
    basePromptText: string,
    hotStyleOverride?: { title: string; description: string } | null,
    productOverride?: ProductInfo,
  ) => {
    await runImageScenePlan(basePromptText, hotStyleOverride, productOverride)
  }

  const STYLE_CARD_DEFAULT_NEGATIVE =
    '模糊，低清，畸形，水印，乱码文字，多余主体，杂乱背景，过曝，欠曝，噪点，塑料感，油腻感'

  /** 方向 B：每条风格卡片自带完整出图主描述，选中即生效 */
  const applyStyleCardAsMainPrompt = (
    jobId: number,
    style: { title: string; description: string; imagePrompt?: string },
    productForScenes?: ProductInfo,
  ) => {
    if (jobId !== aiJobRef.current) return
    const text = String(style.imagePrompt || '').trim()
    if (!text) return
    setPrompt(text)
    setOptimizedPrompt(text)
    setOptimizedNegativePrompt((prev) => (String(prev || '').trim() ? prev : STYLE_CARD_DEFAULT_NEGATIVE))
    setPromptParts({})
    setCategoryHint('other')
    setPromptGenOutputSettings({ aspect: size, resolution })
    const prod = productForScenes || productInfo
    void refreshImageScenesPlanWithPrompt(
      text,
      { title: style.title, description: style.description },
      prod,
    )
  }

  const applyGeneratedImagePrompt = (
    jobId: number,
    r: Awaited<ReturnType<typeof generateImagePrompt>>,
    aspectRatio: ImageAspect,
    res: ImageRes,
    hotStyleForScenes?: { title: string; description: string } | null,
    productForScenes?: ProductInfo,
  ) => {
    if (jobId !== aiJobRef.current) return
    setOptimizedNegativePrompt(r.negativePrompt || '')
    const hint = String((r as any)?.categoryHint || 'other')
    setCategoryHint(hint)
    const presetParts = applySceneModePreset(sceneMode, r.parts || {})
    const initialParts = applyLearnedTweaks(hint, presetParts)
    const nextP = r.prompt || buildPromptFromParts(initialParts)
    setOptimizedPrompt(nextP)
    setPrompt(nextP)
    setPromptParts(initialParts)
    setPromptGenOutputSettings({ aspect: aspectRatio, resolution: res })
    const slimHot =
      hotStyleForScenes === undefined || hotStyleForScenes === null
        ? hotStyleForScenes
        : { title: hotStyleForScenes.title, description: hotStyleForScenes.description }
    void refreshImageScenesPlanWithPrompt(nextP, slimHot, productForScenes)
  }

  const applySceneSlotResultsToBoard = (boardId: string, results: SceneSlotGenResult[]) => {
    if (!results.length) return
    setSceneRunBoard((b) => {
      if (!b || b.id !== boardId) return b
      const byI = new Map(results.map((r) => [r.slotIndex, r]))
      return {
        ...b,
        slots: b.slots.map((s, i) => {
          const row = byI.get(i)
          if (!row) return s
          if (row.ok === true) return { ...s, status: 'done' as const, imageUrl: row.imageUrl, error: undefined }
          return { ...s, status: 'failed' as const, error: row.error, imageUrl: undefined }
        }),
      }
    })
  }

  const executeSceneSlotGenerationOnce = async (
    boardId: string,
    slotIndex: number,
    basePrompt: string,
    slot: SceneRunSlot,
    refUrl: string | undefined,
    neg: string | undefined,
    signal?: AbortSignal,
  ): Promise<SceneSlotGenResult> => {
    if (!canGenerate) return { slotIndex, ok: false, error: '请先完成本产品内付费后再生成图片' }
    if (!slot.selected) return { slotIndex, ok: false, error: '未选中' }
    if (signal?.aborted) return { slotIndex, ok: false, error: '已取消' }
    // 简版图片生成：严格使用用户输入提示词，不叠加场景增量约束
    const mergedPrompt = isSimpleImageGen ? String(basePrompt || '').trim() : mergeScenePromptForSlot(basePrompt, slot)
    try {
      const r = await generateImageAPI({
        prompt: mergedPrompt,
        negativePrompt: neg,
        model,
        aspectRatio: size,
        resolution,
        refImage: refUrl,
        imageCount: 1,
        signal,
      })
      const archivedUrl = await safeArchiveAsset({
        source: 'ai_generated',
        type: 'image',
        url: r.imageUrl,
        name: `image-${boardId}-${slotIndex + 1}.png`,
        metadata: { from: 'image_generator', model, size, resolution, scene: slot.title, variant: isSimpleImageGen ? 'simple' : 'ecommerce' },
      })
      const outUrl =
        archivedUrl && isLikelyPersistedImageUrl(archivedUrl) ? archivedUrl : r.imageUrl
      return { slotIndex, ok: true, imageUrl: outUrl }
    } catch (e: any) {
      if (e?.name === 'AbortError' || signal?.aborted) return { slotIndex, ok: false, error: '已取消' }
      Sentry.captureException(e, { extra: { scene: 'image_generate', model, size, resolution, sceneTitle: slot.title } })
      return { slotIndex, ok: false, error: e?.message || '失败' }
    }
  }

  const handlePolishSimplePrompt = async () => {
    const raw = simpleDirectPrompt.trim()
    if (!raw || simplePromptPolishBusy) return
    setSimplePromptPolishBusy(true)
    setAiError('')
    try {
      const { polished } = await polishImageGenPrompt({
        prompt: raw,
        language: productInfo.language || '简体中文',
      })
      setSimpleDirectPrompt(String(polished || '').trim() || raw)
    } catch (e: any) {
      setAiError(e?.message || '提示词优化失败')
    } finally {
      setSimplePromptPolishBusy(false)
    }
  }

  const handlePrepareSceneBoard = async () => {
    if (!refImages.length) {
      alert('请至少上传1张参考图')
      return
    }
    if (!prompt.trim()) {
      alert('请先用「重新分析」或「AI 生成」生成出图描述，再点击「免费生成预览」')
      return
    }
    if (typeof window !== 'undefined') {
      const scrollAllTop = () => {
        // 1) 优先把右侧「生成历史」面板顶端滚到可视区（用户期望锚点）
        imageGenHistoryTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
        // 2) 兜底：若锚点不可用，回退到模块顶端
        imageGenRootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        // 3) 再把所有可滚动祖先容器回顶（含 main / 局部滚动面板）
        let node = imageGenRootRef.current?.parentElement || null
        while (node) {
          const style = window.getComputedStyle(node)
          const canScrollY =
            (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight + 2
          if (canScrollY) node.scrollTo({ top: 0, behavior: 'smooth' })
          node = node.parentElement
        }
        // 4) 最后兜底 document / window
        document.documentElement.scrollTo({ top: 0, behavior: 'smooth' })
        document.body.scrollTo({ top: 0, behavior: 'smooth' })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
      scrollAllTop()
      window.setTimeout(scrollAllTop, 0)
      window.setTimeout(scrollAllTop, 180)
    }
    setGenErrorText('')
    setGenErrorCode('UNKNOWN')
    setSceneBoardPreparing(true)
    setGenProgress(1)
    const stopProgress = startSmoothGenProgress()
    try {
      const rows = await runImageScenePlan(prompt, undefined, undefined)
      if (!rows) {
        stopProgress()
        setGenProgress(0)
        return
      }
      const taskId = `ig_${Date.now()}_${Math.random().toString(16).slice(2)}`
      const refThumb = refImageDataUrl || refImages[0]?.url || ''
      setSceneRunBoard({
        id: taskId,
        ts: Date.now(),
        refThumb,
        basePrompt: prompt.trim(),
        slots: rows.map((sc) => ({
          key: sc.key,
          title: sc.title,
          description: sc.description,
          imagePrompt: sc.imagePrompt,
          selected: true,
          status: 'pending' as const,
        })),
      })
      stopProgress()
      await completeGenProgress()
    } catch (e: any) {
      stopProgress()
      setGenProgress(0)
      setGenErrorText(e?.message || '场景规划失败')
      setGenErrorCode(e?.code || 'UNKNOWN')
    } finally {
      setSceneBoardPreparing(false)
    }
  }

  /** 图片生成（简版）：规划 6 场景后立即批量出图，不在右侧展示场景勾选板 */
  const handleSimpleStartGenerate = async () => {
    if (!canGenerate) {
      alert('请先完成本产品内付费（购买套餐）后再生成图片')
      return
    }
    if (!refImages.length) {
      alert('请至少上传1张参考图')
      return
    }
    const base = simpleDirectPrompt.trim()
    if (!base) {
      alert('请输入提示词')
      return
    }
    setGenErrorText('')
    setGenErrorCode('UNKNOWN')
    setSceneBoardPreparing(true)
    setGenProgress(1)
    const stopProgress = startSmoothGenProgress()
    try {
      const taskId = `ig_${Date.now()}_${Math.random().toString(16).slice(2)}`
      const refThumb = refImageDataUrl || refImages[0]?.url || ''
      const outputCount = Math.min(6, Math.max(1, imageGenerateCount))
      const builtBoard: SceneRunBoard = {
        id: taskId,
        ts: Date.now(),
        refThumb,
        basePrompt: base,
        slots: Array.from({ length: outputCount }).map((_, idx) => ({
          key: `simple_${idx + 1}`,
          title: `图片 ${idx + 1}`,
          description: '',
          imagePrompt: '',
          selected: true,
          status: 'pending' as const,
        })),
      }
      flushSync(() => {
        setSceneRunBoard(builtBoard)
      })
      stopProgress()
      await completeGenProgress()
      await runBatchGenerateForBoard(builtBoard)
    } catch (e: any) {
      stopProgress()
      setGenProgress(0)
      setGenErrorText(e?.message || '生成失败')
      setGenErrorCode(e?.code || 'UNKNOWN')
    } finally {
      setSceneBoardPreparing(false)
    }
  }

  const runSceneSlotGeneration = async (
    boardId: string,
    slotIndex: number,
    basePrompt: string,
    slot: SceneRunSlot,
  ) => {
    const ref = refImageDataUrl || undefined
    const neg = optimizedNegativePrompt || undefined
    const result = await executeSceneSlotGenerationOnce(boardId, slotIndex, basePrompt, slot, ref, neg)
    applySceneSlotResultsToBoard(boardId, [result])
  }

  const handleGenerateSceneSlot = async (boardId: string, slotIndex: number) => {
    if (!canGenerate) return
    const board = sceneRunBoardRef.current
    if (!board || board.id !== boardId) return
    const slot = board.slots[slotIndex]
    if (!slot || !slot.selected) return
    if (slot.status === 'generating') return
    if (slot.status === 'done') return
    if (!refImages.length || !board.basePrompt.trim()) return

    setSceneRunBoard((b) => {
      if (!b || b.id !== boardId) return b
      return {
        ...b,
        slots: b.slots.map((s, i) => (i === slotIndex ? { ...s, status: 'generating' as const, error: undefined } : s)),
      }
    })

    await new Promise<void>((r) => setTimeout(r, 0))
    const bLive = sceneRunBoardRef.current
    if (!bLive || bLive.id !== boardId) return
    const sl = bLive.slots[slotIndex]
    if (!sl || sl.status !== 'generating') return

    await runSceneSlotGeneration(boardId, slotIndex, bLive.basePrompt, sl)
  }

  const toggleSceneSlotSelected = (boardId: string, slotIndex: number) => {
    setSceneRunBoard((b) => {
      if (!b || b.id !== boardId) return b
      const cur = b.slots[slotIndex]
      if (cur?.status === 'generating') return b
      return {
        ...b,
        slots: b.slots.map((s, i) => (i === slotIndex ? { ...s, selected: !s.selected } : s)),
      }
    })
  }

  const runBatchGenerateForBoard = async (snap: SceneRunBoard | null) => {
    if (!canGenerate) {
      setGenErrorText('请先完成本产品内付费（购买套餐）后再生成图片')
      setGenErrorCode('PAYMENT_REQUIRED')
      return
    }
    if (!snap || !refImages.length || !snap.basePrompt.trim()) return
    const selEntries = snap.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.selected)
    if (!selEntries.length) return

    const targetEntries = isSimpleImageGen ? selEntries.slice(0, imageGenerateCount) : selEntries
    const indices: number[] = []
    targetEntries.forEach(({ s, i }) => {
      if (s.status === 'pending' || s.status === 'failed') indices.push(i)
    })
    if (!indices.length) return

    let batchSignal: AbortSignal | undefined
    if (isSimpleImageGen) {
      const ac = new AbortController()
      imageGenSimpleBatchAbortRef.current = ac
      batchSignal = ac.signal
    }

    const basePrompt = snap.basePrompt
    const slotSnap = indices.map((i) => ({ i, slot: { ...snap.slots[i] } }))
    const refUrl = refImageDataUrl || undefined
    const neg = optimizedNegativePrompt || undefined
    sceneBatchDepthRef.current += 1
    setSceneBatchGenerating(true)
    setGenErrorText('')
    setGenErrorCode('UNKNOWN')
    const pendingSet = new Set(indices)
    const boardGenerating: SceneRunBoard = {
      ...snap,
      slots: snap.slots.map((s, i) =>
        pendingSet.has(i)
          ? { ...s, status: 'generating' as const, error: undefined, imageUrl: undefined }
          : s,
      ),
    }
    setSceneRunBoard((b) => {
      if (!b || b.id !== snap.id) return b
      return boardGenerating
    })
    upsertImageHistoryFromBoard(boardGenerating)
    try {
      await new Promise<void>((r) => setTimeout(r, 0))
      let boardLive = boardGenerating
      const tasks = slotSnap.map(async ({ i, slot }) => {
        const result = await executeSceneSlotGenerationOnce(snap.id, i, basePrompt, slot, refUrl, neg, batchSignal)
        boardLive = {
          ...boardLive,
          slots: boardLive.slots.map((s, si) => {
            if (si !== i) return s
            if (result.ok) return { ...s, status: 'done' as const, imageUrl: result.imageUrl, error: undefined }
            return { ...s, status: 'failed' as const, imageUrl: undefined, error: 'error' in result ? result.error : '失败' }
          }),
        }
        applySceneSlotResultsToBoard(snap.id, [result])
        upsertImageHistoryFromBoard(boardLive)
      })
      await Promise.all(tasks)
    } finally {
      if (isSimpleImageGen && imageGenSimpleBatchAbortRef.current?.signal === batchSignal) {
        imageGenSimpleBatchAbortRef.current = null
      }
      sceneBatchDepthRef.current = Math.max(0, sceneBatchDepthRef.current - 1)
      setSceneBatchGenerating(sceneBatchDepthRef.current > 0)
    }
  }

  const cloneBoardForNewBatchRun = (board: SceneRunBoard): SceneRunBoard => ({
    ...board,
    id: `ig_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    slots: board.slots.map((s) =>
      s.selected
        ? {
            ...s,
            status: 'pending' as const,
            imageUrl: undefined,
            error: undefined,
          }
        : s,
    ),
  })

  const handleBatchGenerateSelectedScenes = async () => {
    const current = sceneRunBoardRef.current
    if (!current) return
    const hasInFlight = current.slots.some((s) => s.selected && s.status === 'generating')
    const target = hasInFlight ? cloneBoardForNewBatchRun(current) : current
    if (hasInFlight) {
      flushSync(() => {
        setSceneRunBoard(target)
      })
    }
    await runBatchGenerateForBoard(target)
  }

  const handleRetryGenBanner = async () => {
    if (!sceneRunBoard) {
      if (isSimpleImageGen) void handleSimpleStartGenerate()
      else void handlePrepareSceneBoard()
      return
    }
    await runBatchGenerateForBoard(sceneRunBoardRef.current)
  }

  const downloadUrlsStaggered = (items: { url: string; name: string }[]) => {
    items.forEach((item, i) => {
      window.setTimeout(() => {
        triggerProxyDownload(item.url, item.name)
      }, i * 450)
    })
  }

  const handleDownloadAllSceneBoard = () => {
    const b = sceneRunBoardRef.current
    if (!b) return
    const items: { url: string; name: string }[] = []
    b.slots.forEach((s, i) => {
      if (s.imageUrl)
        items.push({
          url: s.imageUrl,
          name: `tikgen-${b.id}-${i + 1}-${String(s.title).slice(0, 20)}.png`,
        })
    })
    if (items.length) downloadUrlsStaggered(items)
  }

  const handleDownloadAllHistoryTask = (task: ImageGenHistoryTask) => {
    const items = task.outputUrls
      .map((url, idx) => ({ url: String(url || '').trim(), idx }))
      .filter(({ url }) => isLikelyPersistedImageUrl(url))
      .map(({ url, idx }) => ({
        url,
        name: `tikgen-${task.id}-${idx + 1}.png`,
      }))
    if (items.length) downloadUrlsStaggered(items)
  }

  const removeImageGenHistoryTask = (taskId: string) => {
    setImageGenHistory((prev) => {
      const t = prev.find((x) => x.id === taskId)
      if (t?.status === 'active') return prev
      return prev.filter((x) => x.id !== taskId)
    })
  }

  const mergeNegative = (base: string, add: string) => {
    const a = String(base || '')
    const b = String(add || '')
    const norm = (s: string) =>
      s
        .split(/[,，\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
    const set = new Set([...norm(a), ...norm(b)])
    return Array.from(set).join(', ')
  }

  const formatImageResLabel = (r: ImageRes) =>
    r === '1024' ? '1k' : r === '1536' ? '1.5k' : r === '2048' ? '2k' : r === '4096' ? '4k' : String(r)
  const outputSpecsMismatch =
    !!promptGenOutputSettings &&
    (promptGenOutputSettings.aspect !== size || promptGenOutputSettings.resolution !== resolution)
  const currentSceneBoardGenerating =
    !!sceneRunBoard && sceneRunBoard.slots.some((s) => s.selected && s.status === 'generating')

  const workbenchOpsLocked =
    workbenchFullAnalysisBusy ||
    productAnalysisOnlyBusy ||
    hotStylesReanalyzeBusy ||
    promptRegenBusy ||
    isAiBusy
  const oneClickReanalyzeLocked = workbenchOpsLocked
  const productAiOnlyLocked =
    workbenchFullAnalysisBusy ||
    productAnalysisOnlyBusy ||
    (promptRegenBusy && promptRegenSource === 'product') ||
    isAiBusy
  const hotStylesAnalyzing =
    hotStylesReanalyzeBusy ||
    (workbenchFullAnalysisBusy && oneClickAnalysisPhase === 'styles') ||
    (promptRegenBusy && promptRegenSource === 'oneClick')
  const hotStyleCardsEditable = !hotStylesAnalyzing
  const hotStylesReanalyzeLocked =
    workbenchFullAnalysisBusy ||
    hotStylesReanalyzeBusy ||
    (promptRegenBusy && promptRegenSource === 'styles') ||
    isAiBusy

  /** 电商套图 · 商品分析：接口解析中（独立「AI 生成」或一键分析的商品阶段） */
  const showProductAnalysisParsingOverlay =
    productAnalysisOnlyBusy || (workbenchFullAnalysisBusy && oneClickAnalysisPhase === 'product')

  /** 商品分析正文：生成/流式输出/紧随其后的出图描述生成中不可编辑，避免与 AI 写入冲突 */
  const productAnalysisNotesLocked =
    workbenchFullAnalysisBusy ||
    productAnalysisOnlyBusy ||
    productAnalysisStreamReveal ||
    (promptRegenBusy && promptRegenSource === 'product')

  if (showModal) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
          <div className="p-6 border-b flex items-center justify-between"><h3 className="text-xl font-bold">结构化提示词 · 高级编辑</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5" /></button></div>
          <div className="px-6 py-4 border-b bg-gray-50">
            <div className="flex items-center justify-center gap-4">
              {[{ title: '商品信息解析', idx: 1 as const }, { title: '图片优化提示词', idx: 2 as const }].map((step, i) => {
                const done = modalStep > step.idx
                const active = modalStep === step.idx
                return (
                  <div key={step.idx} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => handleStepJump(step.idx)}
                      className="flex items-center gap-2"
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${
                        done ? 'bg-green-500 border-green-400 text-white' : active ? 'bg-purple-600 border-purple-400 text-white shadow-[0_0_0_2px_rgba(168,85,247,0.35)]' : 'bg-gray-200 border-gray-300 text-gray-600'
                      }`}>
                        {done ? <Check className="w-4 h-4" /> : step.idx}
                      </div>
                      <span className={`text-sm ${active ? 'font-semibold text-purple-700' : done ? 'text-green-700' : 'text-gray-500'}`}>{step.title}</span>
                    </button>
                    {i < 1 && <div className={`w-16 h-0.5 mx-3 ${modalStep > step.idx ? 'bg-green-400' : 'bg-gray-300'}`} />}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="p-6">
            {modalStep === 1 && (<div className="space-y-4">{refImagePreviewUrl && <img src={refImagePreviewUrl} alt="参考图" className="max-h-40 rounded-lg" />}{['name', 'category', 'sellingPoints', 'targetAudience'].map(f => <div key={f}><label className="block text-sm font-medium mb-1">{f === 'name' ? '产品名称' : f === 'category' ? '产品类目' : f === 'sellingPoints' ? '核心卖点' : '目标人群'}</label><input value={productInfo[f as keyof typeof productInfo]} onChange={e => setProductInfo({...productInfo, [f]: e.target.value})} className="w-full px-4 py-2 border rounded-lg" /></div>)}<div><label className="block text-sm font-medium mb-1">图片语言</label><select value={productInfo.language} onChange={e => setProductInfo({...productInfo, language: e.target.value})} className="w-full px-4 py-2 border rounded-lg"><option>简体中文</option><option>English</option></select></div></div>)}
            {modalStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium">图片优化提示词</label>
                  <div className="flex flex-wrap gap-2">
                    <div className="flex items-center bg-gray-100 rounded-full p-1 mr-1">
                      <button
                        disabled={isAiBusy}
                        onClick={() => applyInfographicTemplate('feature')}
                        className="px-3 py-1 rounded-full text-xs bg-white shadow text-gray-900 disabled:opacity-50"
                      >
                        功能示意图
                      </button>
                      <button
                        disabled={isAiBusy}
                        onClick={() => applyInfographicTemplate('scene')}
                        className="px-3 py-1 rounded-full text-xs bg-white shadow text-gray-900 disabled:opacity-50"
                      >
                        场景对比海报
                      </button>
          </div>
                    <div className="flex items-center bg-gray-100 rounded-full p-1 mr-1">
                      <button
                        onClick={() => {
                          const m: 'clean' | 'lite' = 'clean'
                          setSceneMode(m)
                          const next = applySceneModePreset(m, promptParts)
                          setPromptParts(next)
                          setOptimizedPrompt(buildPromptFromParts(next))
                        }}
                        className={`px-3 py-1 rounded-full text-xs ${sceneMode === 'clean' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
                      >
                        主图干净
                      </button>
                      <button
                        onClick={() => {
                          const m: 'clean' | 'lite' = 'lite'
                          setSceneMode(m)
                          const next = applySceneModePreset(m, promptParts)
                          setPromptParts(next)
                          setOptimizedPrompt(buildPromptFromParts(next))
                        }}
                        className={`px-3 py-1 rounded-full text-xs ${sceneMode === 'lite' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
                      >
                        轻场景
                      </button>
                    </div>
                    {IMAGE_STYLE_TAGS.map((t) => (
                      <button
                        key={t.id}
                        disabled={isAiBusy}
                        onClick={() => toggleStyleTag(t.label)}
                        className={`px-2.5 py-1 rounded-full text-xs border disabled:opacity-50 ${
                          selectedStyleTags.includes(t.label)
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                    <button
                      disabled={isAiBusy || selectedStyleTags.length === 0}
                      onClick={handleAiPolish}
                      className="px-3 py-1 rounded-full text-xs bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-50"
                    >
                      AI精修{selectedStyleTags.length ? `（${selectedStyleTags.length}）` : ''}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { k: 'subject', label: '主体' },
                    { k: 'scene', label: '场景' },
                    { k: 'composition', label: '构图' },
                    { k: 'lighting', label: '光影' },
                    { k: 'camera', label: '镜头' },
                    { k: 'style', label: '风格' },
                    { k: 'quality', label: '质量' },
                    { k: 'extra', label: '补充' },
                  ].map((x) => (
                    <div key={x.k} className="md:col-span-1">
                      <label className="block text-xs text-gray-600 mb-1">{x.label}</label>
                      <input
                        value={String(promptParts?.[x.k] || '')}
                        onChange={(e) => {
                          const next = { ...(promptParts || {}), [x.k]: e.target.value }
                          setPromptParts(next)
                          // 同步更新最终 prompt，保证生成用的是最新结构化内容
                          setOptimizedPrompt(buildPromptFromParts(next))
                        }}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        placeholder={`填写${x.label}（可留空）`}
                      />
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">负面词（避免项）</label>
                  <textarea
                    value={optimizedNegativePrompt}
                    onChange={(e) => setOptimizedNegativePrompt(e.target.value)}
                    className="w-full px-4 py-3 border rounded-xl min-h-[90px]"
                    placeholder="例如：模糊，低清，畸形，多余物体，文字水印，过曝，噪点，杂乱背景…"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">最终 prompt（可直接编辑）</label>
                  <textarea value={optimizedPrompt} onChange={e => setOptimizedPrompt(e.target.value)} className="w-full px-4 py-3 border rounded-xl min-h-[120px]" />
                </div>
              </div>
            )}
            {!!aiError && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{aiError}</div>}
          </div>
          {isAiBusy && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center rounded-2xl">
              <div className="relative bg-white shadow-lg border rounded-2xl px-8 py-7 min-w-[360px] max-w-md w-[min(100%,420px)]">
                <button
                  onClick={handleCloseAiBusy}
                  className="absolute right-3 top-3 p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-white/10"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex flex-col items-center text-center pt-1">
                  <RefreshCw className="w-5 h-5 text-purple-600 animate-spin mb-3 shrink-0" />
                  <div className="font-medium">{modalStep === 2 ? '出图描述与结构化提示词生成中' : '商品信息编辑'}</div>
                  <div className="text-sm text-gray-500 mt-1">请稍等，预计几秒钟...</div>
                </div>
              </div>
            </div>
          )}
          <div className="p-6 border-t flex items-center justify-between">
            <div>
              {modalStep > 1 ? (
                <button onClick={handlePrev} disabled={isAiBusy} className="px-4 py-2 border rounded-lg disabled:opacity-50">上一步</button>
              ) : (
                <div />
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg">取消</button>
              <button disabled={isAiBusy} onClick={handleNext} className="px-4 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50">
                {isAiBusy ? '处理中...' : modalStep === 2 ? '确认' : '下一步'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
    <div ref={imageGenRootRef} className="grid grid-cols-2 gap-6 min-w-[1120px]">
      <div className="tikgen-panel rounded-2xl p-4 sm:p-5 overflow-visible">
        <div className="flex flex-col gap-6">
        <section>
          <div className="mb-2 flex items-center gap-1.5">
            <div className="tikgen-module-title text-xs font-semibold uppercase tracking-wide">模型与规格</div>
            <ImageFormTip
              wide
              label="说明"
              text={`模型、分辨率与画幅在同一行设置。切换模型后，分辨率与比例的可选项会随模型能力变化。

一键生成提示词会结合当前画幅与分辨率优化文案；若之后修改了画幅或分辨率，建议重新生成提示词。`}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1 sm:min-w-[160px] sm:flex-[1.35]">
              <label htmlFor="tikgen-image-model" className="sr-only">
                模型选择
              </label>
              <div className="relative">
                <Box className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" strokeWidth={1.75} />
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <select
                  id="tikgen-image-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="tikgen-spec-select w-full appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-9 pr-9 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.1] transition-shadow hover:ring-white/16 focus:ring-2 focus:ring-violet-400/35"
                >
                  {imageModelOptions.map((m) => (
                    <option key={m.id} value={m.id} disabled={!!m.unavailableReason}>
                      {m.name}
                      {m.unavailableReason ? `（暂不可用）` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="w-full shrink-0 sm:w-[min(28%,9.5rem)] sm:max-w-[10rem]">
              <label htmlFor="tikgen-image-resolution" className="sr-only">
                分辨率选择
              </label>
              <div className="relative">
                <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-400/85" strokeWidth={2} aria-hidden />
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <select
                  id="tikgen-image-resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as ImageRes)}
                  className="tikgen-spec-select w-full appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-9 pr-9 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.1] transition-shadow hover:ring-white/16 focus:ring-2 focus:ring-violet-400/35"
                >
                  {imageCaps.resolutions.map((r) => (
                    <option key={r} value={r}>
                      {r === '1024' ? '1K' : r === '1536' ? '1.5K' : r === '2048' ? '2K' : r === '4096' ? '4K' : r}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="w-full shrink-0 sm:w-[min(22%,6.5rem)] sm:max-w-[7rem]">
              <label htmlFor="tikgen-image-aspect" className="sr-only">
                图片比例
              </label>
              <div className="relative">
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <select
                  id="tikgen-image-aspect"
                  value={size}
                  onChange={(e) => setSize(e.target.value as ImageAspect)}
                  className="tikgen-spec-select w-full appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-3 pr-9 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.1] transition-shadow hover:ring-white/16 focus:ring-2 focus:ring-violet-400/35"
                >
                  {imageCaps.aspectRatios.map((ar) => (
                    <option key={ar} value={ar}>
                      {ar}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="tikgen-module-title text-xs font-semibold uppercase tracking-wide">参考图</div>
              <ImageFormTip
                wide
                label="参考图说明"
                text={`支持 1–5 张，JPG / PNG / WEBP，单张 ≤10MB。

第一张为「主参考」，可拖拽调整顺序；主参考对构图与商品识别影响最大。

可点击上传区域、或下方按钮从本地上传 / 资产库选择。`}
              />
            </div>
            <div className="text-xs text-white/50 shrink-0 tabular-nums">{refImages.length}/{MAX_REF_IMAGES}</div>
          </div>
          <div
            className="tikgen-ref-dropzone rounded-xl p-2.5 relative cursor-pointer"
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDrop={async (e) => {
              e.preventDefault()
              e.stopPropagation()
              await handleLocalRefUpload(e.dataTransfer?.files || null)
            }}
            onClick={() => refUploadInputRef.current?.click()}
          >
            <input
              ref={refUploadInputRef}
              type="file"
              accept="image/*"
              multiple
              disabled={refUploadBusy}
              onChange={async (e: any) => {
                await handleLocalRefUpload(e.target.files || null)
                e.target.value = ''
              }}
              className="hidden"
            />
            {refImages.length ? (
              <div className="space-y-2">
                <div className="grid grid-cols-4 md:grid-cols-5 gap-2">
                  {refImages.map((img, i) => (
                    <div
                      key={img.id}
                      draggable
                      onDragStart={() => setDraggingRefId(img.id)}
                      onDragEnd={() => setDraggingRefId('')}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        moveRefImage(draggingRefId, img.id)
                        setDraggingRefId('')
                      }}
                      className={`relative rounded-lg overflow-hidden bg-black/35 ring-1 ring-inset ring-white/[0.1] ${
                        draggingRefId === img.id ? 'opacity-60 ring-violet-400/45' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPreviewRefImage({ url: img.url, name: img.name || `参考图${i + 1}`, index: i })
                        }}
                        className="block w-full"
                        title="点击预览"
                      >
                        <img src={img.url} alt={img.name || `参考图${i + 1}`} className="w-full h-20 object-cover" />
                      </button>
                      {i === 0 && <span className="absolute left-1 top-1 text-xs px-2 py-1 rounded bg-black/65 text-white font-medium">主参考</span>}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setPreviewRefImage({ url: img.url, name: img.name || `参考图${i + 1}`, index: i })
                        }}
                        className="absolute left-1 bottom-1 h-5 px-1.5 rounded bg-black/60 text-white text-[10px] inline-flex items-center gap-1"
                        title="预览"
                      >
                        <Eye className="w-3 h-3" /> 预览
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          requestRemoveRefImage(img.id, i)
                        }}
                        className="absolute right-1 top-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {refImages.length < MAX_REF_IMAGES ? (
                    <>
                      <button
                        type="button"
                      disabled={refUploadBusy}
                        onClick={(e) => {
                          e.stopPropagation()
                          refUploadInputRef.current?.click()
                        }}
                        className="h-20 rounded-lg flex flex-col items-center justify-center gap-1 bg-white/[0.04] text-white/50 ring-1 ring-inset ring-white/[0.06] transition-colors hover:bg-white/[0.07] hover:ring-white/[0.1] hover:text-white/65"
                      >
                        <Upload className="w-4 h-4" />
                        <span className="text-[11px]">上传</span>
                      </button>
                      <button
                        type="button"
                      disabled={refUploadBusy}
                        onClick={(e) => {
                          e.stopPropagation()
                          setAssetSelectedIds(new Set())
                          setShowAssetPicker(true)
                        }}
                        className="h-20 rounded-lg flex flex-col items-center justify-center gap-1 bg-white/[0.04] text-white/50 ring-1 ring-inset ring-white/[0.06] transition-colors hover:bg-white/[0.07] hover:ring-white/[0.1] hover:text-white/65"
                      >
                        <Folder className="w-4 h-4" />
                        <span className="text-[11px]">从资产库选择</span>
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[104px] flex-col items-center justify-center gap-2.5 py-4 text-center">
                <Upload className="w-7 h-7 mx-auto text-white/35" />
                <div className="text-sm font-medium text-white/75">点击或拖拽上传</div>
                <div className="flex items-center justify-center gap-2">
                  <label
                    className="px-3 py-1.5 rounded-lg text-xs cursor-pointer bg-white/[0.04] ring-1 ring-inset ring-white/[0.07] hover:bg-white/[0.08] hover:ring-white/[0.12] text-white/80"
                    onClick={(e) => {
                      e.stopPropagation()
                      refUploadInputRef.current?.click()
                    }}
                  >
                    选择文件
                  </label>
                  <button
                    type="button"
                    disabled={refUploadBusy}
                    onClick={(e) => {
                      e.stopPropagation()
                      setAssetSelectedIds(new Set())
                      setShowAssetPicker(true)
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] ring-1 ring-inset ring-white/[0.07] hover:bg-white/[0.08] hover:ring-white/[0.12] text-white/80"
                  >
                    从资产库选择
                  </button>
                </div>
              </div>
            )}
            {refUploadBusy && refImages.length === 0 ? (
              <div className="absolute inset-0 rounded-xl bg-black/40 backdrop-blur-sm flex items-center justify-center">
                <div className="text-sm text-white/90 flex items-center">
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  处理中...
                </div>
              </div>
            ) : null}
          </div>
          {refUploadNotice ? <div className="mt-2 text-xs text-amber-500">{refUploadNotice}</div> : null}
          {refUploadBusy ? (
            <div className="mt-1 text-xs text-white/45">
              {refImages.length ? '正在添加图片，请稍候…' : '正在处理图片，请稍候…'}
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="tikgen-module-title text-xs font-semibold uppercase tracking-wide">投放定向</div>
            <ImageFormTip
              wide
              label="说明"
              text={`目标平台、目标市场与文案语言会参与：商品分析语境、爆款风格 DNA、6 场景规划与出图主描述生成，使主图习惯、生活场景符号与色调更贴近投放渠道。

修改后建议重新「重新分析」或「免费生成预览」以刷新场景文案；不改变参考图识别结果。`}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="tikgen-target-platform" className="text-xs font-medium text-white/70">
                目标平台
              </label>
              <div className="relative min-w-0">
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <select
                  id="tikgen-target-platform"
                  value={productInfo.targetPlatform}
                  onChange={(e) => setProductInfo({ ...productInfo, targetPlatform: e.target.value })}
                  className="tikgen-spec-select w-full min-w-0 appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-3 pr-9 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.1] transition-shadow hover:ring-white/16 focus:ring-2 focus:ring-violet-400/35"
                >
                  {ECOMMERCE_TARGET_PLATFORMS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="tikgen-target-market" className="text-xs font-medium text-white/70">
                目标市场
              </label>
              <div className="relative min-w-0">
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <select
                  id="tikgen-target-market"
                  value={productInfo.targetMarket}
                  onChange={(e) => setProductInfo({ ...productInfo, targetMarket: e.target.value })}
                  className="tikgen-spec-select w-full min-w-0 appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-3 pr-9 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.1] transition-shadow hover:ring-white/16 focus:ring-2 focus:ring-violet-400/35"
                >
                  {ECOMMERCE_TARGET_MARKETS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="tikgen-copy-language" className="text-xs font-medium text-white/70">
                文案语言
              </label>
              <div className="relative min-w-0">
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <select
                  id="tikgen-copy-language"
                  value={productInfo.language}
                  onChange={(e) => setProductInfo({ ...productInfo, language: e.target.value })}
                  className="tikgen-spec-select w-full min-w-0 appearance-none rounded-lg border-0 bg-black/35 py-2.5 pl-3 pr-9 text-sm text-white/92 outline-none ring-1 ring-inset ring-white/[0.1] transition-shadow hover:ring-white/16 focus:ring-2 focus:ring-violet-400/35"
                >
                  {ECOMMERCE_COPY_LANGUAGES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {aiError ? (
          <div className="rounded-lg border border-red-400/25 bg-red-500/12 px-3 py-2 text-xs text-red-200/95">{aiError}</div>
        ) : null}

        {isSimpleImageGen ? (
          <section className="flex flex-col gap-2">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="tikgen-module-title text-xs font-semibold uppercase tracking-wide">提示词</div>
                <ImageFormTip
                  wide
                  label="说明"
                  text="描述你想要的画面内容、风格和构图；生成时将直接使用你输入的提示词，并结合参考图与模型参数出图。"
                />
              </div>
              <button
                type="button"
                onClick={() => void handlePolishSimplePrompt()}
                disabled={simplePromptPolishBusy || !simpleDirectPrompt.trim() || sceneBoardPreparing || sceneBatchGenerating}
                title={!simpleDirectPrompt.trim() ? '请先输入提示词' : '使用 GPT-4o 润色当前提示词'}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  simplePromptPolishBusy
                    ? 'cursor-wait bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/35'
                    : simpleDirectPrompt.trim()
                      ? 'bg-white/[0.08] text-violet-200 ring-1 ring-violet-400/25 hover:bg-violet-500/15 hover:ring-violet-400/40'
                      : 'cursor-not-allowed bg-white/[0.04] text-white/35 ring-1 ring-white/[0.08]'
                }`}
              >
                {simplePromptPolishBusy ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    <span className="tikgen-shimmer-text">优化中…</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="h-3.5 w-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                    优化提示词
                  </>
                )}
              </button>
            </div>
            <textarea
              value={simpleDirectPrompt}
              readOnly={simplePromptPolishBusy}
              onChange={(e) => setSimpleDirectPrompt(e.target.value)}
              className={`w-full min-h-[168px] rounded-xl bg-black/25 px-3 py-2.5 text-sm leading-relaxed text-white/88 placeholder:text-white/35 ring-1 ring-inset ring-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 resize-y transition-[box-shadow] duration-300 ${
                simplePromptPolishBusy ? 'cursor-wait opacity-[0.92] workbench-product-analysis-streaming' : ''
              }`}
              placeholder="例如：产品在阳光下的木质桌面上，清新自然光，浅景深，电商主图风格…"
            />
            <div className="rounded-xl bg-black/20 px-3 py-2.5 ring-1 ring-inset ring-white/[0.08]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-white/70">
                  生成数量
                  <span className="ml-1 text-white/45">（默认 1 张，可选 1-6 张）</span>
                </div>
                <div className="relative">
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
                  <select
                    value={imageGenerateCount}
                    onChange={(e) => setImageGenerateCount(Math.min(6, Math.max(1, Number(e.target.value) || 1)))}
                    className="tikgen-spec-select appearance-none rounded-lg border-0 bg-black/35 py-1.5 pl-2.5 pr-8 text-xs text-white/90 outline-none ring-1 ring-inset ring-white/[0.12] hover:ring-white/18 focus:ring-2 focus:ring-violet-400/35"
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} 张
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            {simplePromptPolishBusy ? (
              <p className="text-[11px] text-violet-200/85 flex items-center gap-1.5" role="status">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" aria-hidden />
                GPT-4o 正在润色提示词，请稍候…
              </p>
            ) : null}
          </section>
        ) : null}

        {!isSimpleImageGen && productStylePanelOpen ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="tikgen-module-title text-xs font-semibold uppercase tracking-wide">商品分析与爆款风格</div>
              <ImageFormTip
                wide
                label="说明"
                text={`「重新分析」会同时刷新商品分析与 4 套爆款风格（模型按「DNA + 场景增量」策略生成，并结合上方「投放定向」：目标平台、目标市场、文案语言）。

【爆款风格 和 6 场景分别管什么】
· 爆款风格 = 整条素材的「总路线」：气质、叙事、光影基调（会写进当前出图主描述）。
· 6 场景 = 在同一条路线下，拆成 6 种「镜头分工」：白底主图、卖点特写、生活方式…方便一次出齐投放图。
两边文案可能都提到背景/光线，属于正常叠加，不是填错。出每一张图时 = 主描述 + 当前这一格的拍法；需要纯白底时请勾选「商业白底主图」等对应格。
出图时系统会在提示词末尾自动加「场景优先级」说明：例如白底主图格会强制纯白棚拍底，避免爆款风格里写的深色/工业风背景把整张图带偏。

【爆款风格怎么写：少冲突、效果还能叠满】
· 分工：爆款风格 = 全组「气质与拍法基因（DNA）」；6 场景 = 每一张的「镜头任务」。像不像同一套片 = DNA；这一张是主图还是种草 = 场景格。
· DNA 里优先写可迁移项：材质做工、光型（柔光/轮廓/冷暖）、色彩气质、情绪词、商业摄影基准（锐利、还原色、少畸变）——白底/特写/生活/氛围都能继承。
· DNA 里避免「全图唯一环境合同」：忌写死整张只能是黑底/水泥墙/夜景窗外；强环境交给「场景生活图」「氛围创意图」或由 6 场景规划的增量写清。
· 白底主图要工业/科技感时：用「棚拍级质感、结构高光、边缘利落、明暗落在形体上」写气质，不要写大面积深色底；白底合同交给白底格 + 系统优先级句。

【进阶：分层叠提示，让模型吃满两层】
· 模型实际读到的大致是：DNA（主描述）+ 当前格的标题与增量文案 + 系统自动「场景优先级」句。思路是 DNA 提供连贯性，每格只追加「本张差异」，不要在两处各写一套矛盾背景。
· 建议只写在爆款里：品牌级气质、材质词汇、默认光型偏好、整体色调方向、禁止项（不要水印/不要多主体等若你坚持可写进商品分析或负向）。
· 建议只写在场景格/规划结果里：具体背景（白/虚化的家/夜光）、景别（全景/特写）、构图任务（居中主图 vs 斜线动感）、本张道具强度。
· 两边都碰「光」时：DNA 定「用什么灯感」（柔光箱+轻轮廓）；格只定「本张怎么用灯」（侧逆光勾边 / 大柔光平铺），避免格再写一套完全相反的灯感除非你想刻意对比。

【按格配合表（DNA 不变，格负责增量）】
· 商业白底主图：DNA=质感+光型基因；格=纯白无缝底+居中+电商留白；DNA 勿锁暗场全图背景。
· 卖点聚焦：DNA=材质高光与清晰标准；格=近景微距+浅景深+指哪打哪的结构；勿在 DNA 编造未给出的参数文案。
· 场景生活：DNA=色调与情绪；格=具体生活场+背景虚化；服装真人穿搭须中景/半身、头顶入画，避免无头胸像。DNA 勿写「全程无环境」。
· 对比/效果：DNA=利落清晰；格=对比构图/信息层级；勿编造数据与认证。
· 产品细节：DNA=做工基因；格=角度/拼接/细节陈列；DNA 勿抢大场景。
· 氛围创意：DNA=色温气质即可；格=强氛围、允许环境光——与暗调气质相关的「释放口」通常在这格；含真人时同样避免无头裁切。

【工作流与自检】
· 顺序：写好 DNA → 免费生成预览看 6 条是否同源 → 必要时编辑单格文案或重规划 → 勾选批量出图。
· 三问：① 删掉 DNA 里所有「背景/环境」句，气质还剩吗？② 白底格是否只负责底与构图、不被 DNA 暗环境绑架？③ 是否至少有一格（生活/氛围）能接住你想表达的环境与情绪？

点「免费生成预览」规划 6 场景后，在右侧勾选卡片并批量出图；点击卡片任意区域可切换选中。`}
              />
            </div>
            <div className="flex flex-col items-end sm:items-center sm:flex-row gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleOneClickFill()}
                disabled={oneClickReanalyzeLocked}
                title={refImages.length ? '重新分析商品与爆款风格' : '需先上传参考图'}
                className={`flex shrink-0 items-center rounded-full px-3 py-1.5 text-sm transition-colors ${
                  oneClickReanalyzeLocked
                    ? 'cursor-not-allowed border border-white/10 bg-white/[0.06] text-white/40 opacity-45'
                    : refImages.length
                      ? 'border border-transparent bg-purple-50 text-purple-700 hover:bg-purple-100'
                      : 'cursor-pointer border border-white/[0.10] bg-white/[0.05] text-white/38 hover:bg-white/[0.08] hover:text-white/50'
                }`}
              >
                {workbenchFullAnalysisBusy || (promptRegenBusy && promptRegenSource === 'oneClick') ? (
                  <RefreshCw className="mr-1 h-4 w-4 shrink-0 animate-spin opacity-90" />
                ) : (
                  <Wand2 className="mr-1 h-4 w-4 shrink-0 opacity-90" />
                )}
                {workbenchFullAnalysisBusy
                  ? oneClickAnalysisPhase === 'product'
                    ? '分析商品中…'
                    : oneClickAnalysisPhase === 'styles'
                      ? '生成爆款风格中…'
                      : '分析中…'
                  : promptRegenBusy && promptRegenSource === 'oneClick'
                    ? '生成描述中…'
                    : '重新分析'}
              </button>
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-white/88">商品分析</span>
              <button
                type="button"
                onClick={() => void handleProductAnalysisAiOnly()}
                disabled={productAiOnlyLocked}
                className="px-2.5 py-1 rounded-full text-xs flex items-center gap-1 bg-white/[0.08] text-violet-200 border border-violet-400/25 hover:bg-white/[0.12] disabled:opacity-45"
              >
                {productAnalysisOnlyBusy || (promptRegenBusy && promptRegenSource === 'product') ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {productAnalysisOnlyBusy
                  ? '分析中…'
                  : promptRegenBusy && promptRegenSource === 'product'
                    ? '生成描述中…'
                    : 'AI 生成'}
              </button>
            </div>
            {workbenchFullAnalysisBusy && oneClickAnalysisPhase === 'styles' ? (
              <p
                className="workbench-oneclick-status text-[11px] text-violet-200/80 mb-1.5"
                role="status"
              >
                商品分析已就绪，正在生成 4 套爆款风格…
              </p>
            ) : null}
            <div className="relative min-h-[140px]">
              {showProductAnalysisParsingOverlay ? (
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2 py-1 text-[11px] text-white/55">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-300 animate-pulse" />
                  <span>商品分析中…</span>
                </div>
              ) : null}
              <textarea
              ref={productAnalysisWorkbenchTextareaRef}
              value={productAnalysisText}
              readOnly={productAnalysisNotesLocked}
              onChange={(e) => setProductAnalysisText(e.target.value)}
              className={`w-full min-h-[140px] rounded-xl bg-black/25 px-3 py-2.5 text-sm leading-relaxed text-white/88 placeholder:text-white/35 ring-1 ring-inset ring-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 transition-[opacity,box-shadow] duration-300 ${
                productAnalysisNotesLocked ? 'resize-none cursor-not-allowed opacity-[0.92]' : 'resize-y'
              } ${productAnalysisStreamReveal ? 'workbench-product-analysis-streaming' : ''}`}
              placeholder="产品名称、类目、卖点、目标人群、期望场景、尺寸参数等（可由 AI 生成后自行修改）"
            />
            </div>
          </div>

          <div className="overflow-visible">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-white/88">爆款风格</span>
                <ImageFormTip
                  wide
                  label="操作说明"
                  text="点卡片切换爆款风格；悬停卡片可看完整「出图主描述」；点铅笔编辑。可添加「自定义方案」。

与 6 场景：这里写 DNA（材质、光型、色调、情绪），格子里写「本张背景/景别/构图」。叠提示时避免两处各写一套矛盾环境；细则与按格配合表见顶部「说明」。"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleHotStylesReanalyze()}
                disabled={hotStylesReanalyzeLocked}
                className="px-2.5 py-1 rounded-full text-xs flex items-center gap-1 shrink-0 bg-white/[0.08] text-violet-200 border border-violet-400/25 hover:bg-white/[0.12] disabled:opacity-45"
              >
                {hotStylesReanalyzeBusy || (promptRegenBusy && promptRegenSource === 'styles') ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {hotStylesReanalyzeBusy
                  ? '分析中…'
                  : promptRegenBusy && promptRegenSource === 'styles'
                    ? '生成描述中…'
                    : '重新分析'}
              </button>
            </div>
            {hotStyles.length === 0 ? (
              workbenchFullAnalysisBusy && (oneClickAnalysisPhase === 'product' || oneClickAnalysisPhase === 'styles') ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 items-stretch gap-3 overflow-visible">
                    {[0, 1, 2, 3].map((slot) => (
                      <div
                        key={slot}
                        className="workbench-hs-skeleton-slot workbench-skeleton-shimmer relative overflow-hidden rounded-2xl bg-[#16161c] ring-1 ring-inset ring-white/[0.1] px-3.5 py-3 min-h-[7.5rem]"
                        style={{ '--wb-sk': slot } as CSSProperties}
                      >
                        <div className="relative z-[1] h-4 w-16 rounded-md bg-white/[0.08]" />
                        <div className="relative z-[1] mt-3 space-y-2">
                          <div className="h-2 w-full rounded bg-white/[0.06]" />
                          <div className="h-2 rounded bg-white/[0.06] w-[85%]" />
                          <div className="h-2 rounded bg-white/[0.06] w-[60%]" />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="workbench-oneclick-status text-center text-[11px] text-white/42" role="status">
                    {oneClickAnalysisPhase === 'product'
                      ? '爆款风格将在商品分析完成后生成…'
                      : '正在生成爆款风格方案…'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-xl bg-black/20 py-6 text-center text-xs text-white/40 ring-1 ring-inset ring-white/[0.07]">
                    上传主参考图后，点击顶部或本行右侧「重新分析」生成爆款风格（标题建议 4 字）
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomStylePromptOnly('')
                      setCustomStyleModalOpen(true)
                    }}
                    className="flex min-h-0 w-full flex-col items-center justify-center rounded-2xl bg-black/15 px-3.5 py-6 text-center ring-1 ring-inset ring-white/[0.08] transition-colors hover:bg-[#1e1e26] hover:ring-violet-400/25"
                  >
                    <span className="text-sm font-semibold text-violet-200">自定义方案</span>
                    <span className="text-[10px] text-white/45 mt-1">用一段话描述你想要的画面与商品关系</span>
                  </button>
                </div>
              )
            ) : (
              <div className="grid grid-cols-2 items-stretch gap-3 overflow-visible" data-hot-styles-grid>
                {hotStyles.map((st, idx) => (
                  <div
                    key={`${hotStylesRevealEpoch}-${idx}-${st.title}`}
                    data-hot-style-scheme-card
                    role="button"
                    tabIndex={0}
                    onClick={() => !promptRegenBusy && selectHotStyleCard(idx)}
                    onKeyDown={(e) => {
                      if (promptRegenBusy) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectHotStyleCard(idx)
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (promptRegenBusy) return
                      if (stylePromptLeaveTimerRef.current != null) {
                        window.clearTimeout(stylePromptLeaveTimerRef.current)
                        stylePromptLeaveTimerRef.current = null
                      }
                      const el = e.currentTarget
                      stylePromptAnchorRef.current = el
                      setStylePromptHoverIdx(idx)
                      const apply = () => {
                        const grid = el.closest('[data-hot-styles-grid]') as HTMLElement | null
                        const obstacles = getHotStyleSchemeObstacleRects(grid, el)
                        setStylePromptPopBox(computeWorkbenchStylePromptPopoverPosition(el.getBoundingClientRect(), obstacles))
                      }
                      apply()
                      requestAnimationFrame(apply)
                    }}
                    onMouseLeave={() => {
                      const t = window.setTimeout(() => {
                        setStylePromptHoverIdx(null)
                        setStylePromptPopBox(null)
                        stylePromptAnchorRef.current = null
                        stylePromptLeaveTimerRef.current = null
                      }, 200)
                      stylePromptLeaveTimerRef.current = t
                    }}
                    className={`relative overflow-visible rounded-2xl px-3.5 pb-3 pt-3 text-left outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                      selectedHotStyleIndex === idx
                        ? 'bg-gradient-to-b from-violet-500/[0.2] to-[#1a1528] ring-2 ring-violet-400/35'
                        : 'bg-[#16161c] ring-1 ring-inset ring-white/[0.1] hover:bg-[#1f1f28] hover:ring-white/16'
                    } ${promptRegenBusy ? 'pointer-events-none brightness-[0.85] saturate-75' : 'cursor-pointer'}${
                      hotStylesRevealEpoch > 0 ? ' workbench-hot-style-card-reveal' : ''
                    }`}
                    style={
                      hotStylesRevealEpoch > 0
                        ? ({ animationDelay: `${idx * 118}ms` } satisfies CSSProperties)
                        : undefined
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white/95 leading-tight line-clamp-1 pr-1">{st.title}</h3>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!hotStyleCardsEditable) return
                          setStyleCardEditDraft({
                            title: st.title,
                            description: st.description,
                            imagePrompt: st.imagePrompt || '',
                          })
                          setStyleCardEditIndex(idx)
                        }}
                        disabled={!hotStyleCardsEditable}
                        className={`shrink-0 rounded-md bg-black/40 p-1.5 text-violet-200/95 ring-1 ring-inset ring-white/10 transition-colors ${
                          hotStyleCardsEditable
                            ? 'hover:bg-violet-500/15 hover:ring-violet-400/35'
                            : 'cursor-not-allowed opacity-45'
                        }`}
                        title={hotStyleCardsEditable ? '编辑方案' : '爆款风格分析中，暂不可编辑'}
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>
                    <p className="mt-2 min-h-[4.5rem] text-[11px] leading-[1.45] text-white/55 line-clamp-4">
                      {styleCardSummary(hotStyleCardPreviewText(st)) || '\u00a0'}
                    </p>
                  </div>
                ))}
                {!hotStyles.some((s) => s.isCustom) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomStylePromptOnly('')
                      setCustomStyleModalOpen(true)
                    }}
                    className="flex h-full min-h-0 flex-col items-center justify-center self-stretch rounded-2xl bg-[#16161c] px-3.5 py-3 text-center ring-1 ring-inset ring-white/[0.1] transition-colors hover:bg-[#1f1f28] hover:ring-violet-400/25"
                  >
                    <span className="text-sm font-semibold text-violet-200">自定义方案</span>
                    <span className="mt-1.5 line-clamp-2 text-[10px] leading-snug text-white/45">一段话描述画面、风格与卖点</span>
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {outputSpecsMismatch ? (
            <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100/95">
              <span>
                输出规格已变更（当前 {size} / {formatImageResLabel(resolution)}，生成描述时为 {promptGenOutputSettings!.aspect} /{' '}
                {formatImageResLabel(promptGenOutputSettings!.resolution)}）。建议按新规格重新生成。
              </span>
              <button
                type="button"
                disabled={workbenchOpsLocked}
                onClick={() => void handleRegeneratePromptWithCurrentOutput()}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500/90 text-amber-950 text-xs font-medium hover:bg-amber-400 disabled:opacity-50"
              >
                {promptRegenBusy ? (
                  <>
                    <RefreshCw className="w-3 h-3 inline mr-1 animate-spin" />
                    生成中...
                  </>
                ) : (
                  '按当前设置重新生成'
                )}
              </button>
            </div>
          ) : null}
        </section>
        ) : null}

        <div className={`flex flex-col gap-5 ${!isSimpleImageGen && productStylePanelOpen ? 'mt-1' : 'mt-6'}`}>
          {!isSimpleImageGen && !productStylePanelOpen && refImages.length > 0 ? (
            <div className="space-y-2">
              {oneClickNeedRefHint ? (
                <span className="block text-center text-xs text-amber-400/95" role="status">
                  请先上传参考图
                </span>
              ) : null}
              <p className="text-[11px] leading-relaxed text-white/42">
                <span className="text-white/55">先分析商品</span>
                <span className="text-white/30"> · </span>
                <span className="text-white/38">生成主提示词与 4 套爆款风格</span>
              </p>
              <button
                type="button"
                onClick={() => void handleOneClickFill()}
                disabled={workbenchOpsLocked}
                title="分析商品信息并生成 4 套爆款风格"
                className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-colors ${
                  workbenchOpsLocked
                    ? 'cursor-not-allowed bg-white/[0.05] text-white/32'
                    : 'bg-violet-600/85 text-white hover:bg-violet-500/90'
                }`}
              >
                {workbenchFullAnalysisBusy || (promptRegenBusy && promptRegenSource === 'oneClick') ? (
                  <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4 shrink-0" strokeWidth={2} />
                )}
                {workbenchFullAnalysisBusy
                  ? oneClickAnalysisPhase === 'product'
                    ? '分析商品中…'
                    : oneClickAnalysisPhase === 'styles'
                      ? '生成爆款风格中…'
                      : '分析中…'
                  : promptRegenBusy && promptRegenSource === 'oneClick'
                    ? '生成描述中…'
                    : '一键分析商品及爆款风格'}
              </button>
            </div>
          ) : null}

          {/* 简版：始终显示「开始生成」；电商：已传图但未完成「一键分析」前只露出分析按钮；未传图或已展开模块后显示免费生成预览 */}
          {isSimpleImageGen ? (
            <div>
              <button
                type="button"
                onClick={() => void handleSimpleStartGenerate()}
                disabled={
                  sceneBoardPreparing ||
                  simplePromptPolishBusy ||
                  !simpleDirectPrompt.trim() ||
                  !refImages.length ||
                  !canGenerate
                }
                title={
                  !canGenerate
                    ? '请先完成本产品内付费（购买套餐）后再生成图片'
                    : !refImages.length
                      ? '请先上传参考图'
                      : !simpleDirectPrompt.trim()
                        ? '请输入提示词'
                        : '根据提示词规划并立即生成图片'
                }
                className={`relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl py-4 text-base font-bold tracking-wide transition-all duration-200 ${
                  sceneBoardPreparing ||
                  (simpleDirectPrompt.trim() && refImages.length > 0 && canGenerate)
                    ? 'bg-gradient-to-r from-fuchsia-500 via-purple-500 to-indigo-600 text-white shadow-[0_12px_36px_-8px_rgba(192,80,250,0.45)] [text-shadow:0_1px_2px_rgba(0,0,0,0.2)] hover:enabled:shadow-[0_16px_44px_-8px_rgba(192,80,250,0.55)] hover:enabled:brightness-[1.04] active:enabled:scale-[0.995] active:enabled:brightness-100 disabled:cursor-not-allowed'
                    : 'cursor-not-allowed bg-white/[0.06] text-white/35'
                }`}
              >
                {!sceneBoardPreparing && simpleDirectPrompt.trim() && refImages.length > 0 && canGenerate ? (
                  <span
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-transparent to-white/[0.1] opacity-80"
                    aria-hidden
                  />
                ) : null}
                {sceneBoardPreparing ? (
                  <>
                    <RefreshCw className="relative h-5 w-5 shrink-0 animate-spin" />
                    <span className="relative">正在规划场景…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="relative h-5 w-5 shrink-0 drop-shadow-sm" strokeWidth={2.25} />
                    <span className="relative">开始生成</span>
                  </>
                )}
              </button>
              {!canGenerate ? (
                <div className="mt-2 text-xs text-amber-300/95 text-center">请开通会员</div>
              ) : null}
            </div>
          ) : productStylePanelOpen || refImages.length === 0 ? (
            <div>
              <button
                type="button"
                onClick={() => void handlePrepareSceneBoard()}
                disabled={sceneBoardPreparing || !prompt.trim() || !refImages.length}
                title={
                  !refImages.length
                    ? '请先上传参考图'
                    : !prompt.trim()
                      ? '请先生成出图主描述（一键分析或选中爆款风格）'
                      : '在爆款风格/主描述基础上，规划 6 种电商镜头分工（可与主描述有少量重复，出图时会叠加强调当前格）'
                }
                className={`relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl py-4 text-base font-bold tracking-wide transition-all duration-200 ${
                  sceneBoardPreparing || (prompt.trim() && refImages.length > 0)
                    ? 'bg-gradient-to-r from-fuchsia-500 via-purple-500 to-indigo-600 text-white shadow-[0_12px_36px_-8px_rgba(192,80,250,0.45)] [text-shadow:0_1px_2px_rgba(0,0,0,0.2)] hover:enabled:shadow-[0_16px_44px_-8px_rgba(192,80,250,0.55)] hover:enabled:brightness-[1.04] active:enabled:scale-[0.995] active:enabled:brightness-100 disabled:cursor-wait'
                    : 'cursor-not-allowed bg-white/[0.06] text-white/35'
                }`}
              >
                {!sceneBoardPreparing && prompt.trim() && refImages.length > 0 ? (
                  <span
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-transparent to-white/[0.1] opacity-80"
                    aria-hidden
                  />
                ) : null}
                {sceneBoardPreparing ? (
                  <>
                    <RefreshCw className="relative h-5 w-5 shrink-0 animate-spin" />
                    <span className="relative">正在规划场景…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="relative h-5 w-5 shrink-0 drop-shadow-sm" strokeWidth={2.25} />
                    <span className="relative">免费生成预览</span>
                  </>
                )}
              </button>
            </div>
          ) : null}
        </div>
        </div>
      </div>
      <div ref={imageGenHistoryTopRef} className="tikgen-panel rounded-2xl p-4 sm:p-5 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto overflow-x-visible">
        <h2 className="text-xl font-bold mb-3 text-white/95">生成历史</h2>
        {genErrorText && !sceneBoardPreparing ? (
          <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-100/95 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span className="break-words">
              <span className="font-medium">上次失败</span> · {genErrorText}
              {(() => {
                const hint =
                  genErrorCode === 'CANCELLED'
                    ? '已中断'
                    : genErrorCode === 'PARTIAL'
                      ? '多种原因'
                      : genErrorCode === 'QUOTA_EXHAUSTED'
                        ? '今日额度已用尽'
                        : genErrorCode === 'PAYMENT_REQUIRED'
                          ? '需先完成付费'
                          : genErrorCode === 'UNKNOWN'
                            ? ''
                            : genErrorCode
                return hint ? (
                  <span className="text-red-300/80 ml-1">（{hint}）</span>
                ) : null
              })()}
            </span>
            {genErrorCode !== 'QUOTA_EXHAUSTED' && genErrorCode !== 'PAYMENT_REQUIRED' ? (
              <button
                type="button"
                onClick={() => void handleRetryGenBanner()}
                disabled={sceneBoardPreparing || (isSimpleImageGen && sceneBatchGenerating)}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs bg-red-500/30 border border-red-400/35 hover:bg-red-500/40 disabled:opacity-50"
              >
                重试
              </button>
            ) : null}
          </div>
        ) : null}
        {sceneBoardPreparing || (isSimpleImageGen && sceneBatchGenerating) ? (
          <div className="mb-6">
            <GenerationLoadingCard
              title={isSimpleImageGen ? '图片生成中' : LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].image.title}
              subtitle={
                isSimpleImageGen
                  ? sceneBoardPreparing
                    ? '正在根据提示词规划场景，完成后将自动开始出图…'
                    : '正在并行生成图片，结果将实时出现在下方生成历史并同步到资产库…'
                  : '正在规划 6 组场景，完成后可在右侧用「一键生成图片」批量出图'
              }
              chips={LOADING_COPY[ACTIVE_LOADING_COPY_STYLE].image.chips}
              progressText={
                sceneBoardPreparing
                  ? `准备进度：${Math.max(1, Math.min(99, genProgress))}%`
                  : isSimpleImageGen
                    ? '出图进行中…'
                    : `准备进度：${Math.max(1, Math.min(99, genProgress))}%`
              }
            />
          </div>
        ) : null}
        {!isSimpleImageGen && sceneRunBoard ? (
          <div className="mb-8 overflow-visible rounded-xl bg-black/20 p-4 ring-1 ring-inset ring-white/[0.07]">
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3
                    className="text-base font-semibold text-white/95 leading-snug truncate"
                    title={imageWorkbenchCardTitle !== '商品场景' ? imageWorkbenchCardTitle : undefined}
                  >
                    {imageWorkbenchCardTitle}
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex rounded-full border border-white/12 bg-black/35 px-2 py-0.5 text-[10px] text-white/75">
                      {imageModelOptions.find((m) => m.id === model)?.name || model}
                    </span>
                    <span className="inline-flex rounded-full border border-white/12 bg-black/35 px-2 py-0.5 text-[10px] text-white/75">
                      {size}
                    </span>
                    <span className="inline-flex rounded-full border border-white/12 bg-black/35 px-2 py-0.5 text-[10px] text-white/75 uppercase tracking-wide">
                      {formatImageResLabel(resolution)}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/45">
                    以下 6 格在<strong className="font-medium text-white/58">当前爆款风格 / 主描述</strong>
                    之上标注「每张图的镜头类型」；可只勾选需要的格再批量生成。与主描述有重复用词时，以<strong className="font-medium text-white/58">当前格标题与说明</strong>
                    为准。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={currentSceneBoardGenerating || !sceneBoardAllowsBatchGenerate(sceneRunBoard) || !canGenerate}
                    title={!canGenerate ? '请先完成本产品内付费（购买套餐）后再生成图片' : undefined}
                    onClick={() => void handleBatchGenerateSelectedScenes()}
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {currentSceneBoardGenerating ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 inline mr-1 animate-spin" />
                        生成中…
                      </>
                    ) : (
                      '一键生成图片'
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={!sceneRunBoard.slots.some((s) => s.imageUrl)}
                    onClick={() => handleDownloadAllSceneBoard()}
                    className="px-3 py-2 rounded-xl text-xs font-medium border border-white/20 text-white/90 hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    <Download className="w-3.5 h-3.5 inline mr-1" />
                    下载全部
                  </button>
                  {!canGenerate ? (
                    <span className="text-xs text-amber-300/95">请开通会员</span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-stretch overflow-visible">
              {sceneRunBoard.slots.map((slot, sidx) => {
                const rawDesc = (slot.description || slot.imagePrompt || '').replace(/\s+/g, ' ').trim()
                const hoverFull = styleCardSummary(rawDesc, 400)
                const mosaicThumb = sceneRunBoard.refThumb || refImageDataUrl || ''
                /** 占位：以主参考图为底做「高斯模糊照片」，避免琥珀色渐变盖住真实色相 */
                const mosaicBase = (
                  <>
                    {mosaicThumb ? (
                      <>
                        <img
                          src={mosaicThumb}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover scale-[1.45] blur-[64px] saturate-[1.12] brightness-[0.94] contrast-[1.04]"
                          draggable={false}
                        />
                        <img
                          src={mosaicThumb}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover scale-[1.18] blur-[36px] opacity-[0.55] translate-x-[2%] -translate-y-[1.5%]"
                          draggable={false}
                        />
                        <img
                          src={mosaicThumb}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover scale-105 blur-[14px] opacity-[0.18]"
                          draggable={false}
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/45" />
                        <div className="absolute inset-0 backdrop-blur-[8px] bg-white/[0.04]" />
                        <div
                          className="absolute inset-0 pointer-events-none opacity-[0.16] mix-blend-overlay"
                          style={{
                            backgroundImage: SCENE_SLOT_PLACEHOLDER_GRAIN_TILE,
                            backgroundSize: '88px 88px',
                          }}
                        />
                        <div className="absolute inset-0 ring-1 ring-inset ring-white/[0.09]" />
                      </>
                    ) : (
                      <div className="absolute inset-0 overflow-hidden">
                        <div
                          className="absolute -inset-[40%] scale-[1.65] blur-[56px] opacity-[0.88]"
                          style={{
                            background:
                              'radial-gradient(ellipse 88% 52% at 22% 32%, rgba(148,163,184,0.48), transparent 52%), radial-gradient(ellipse 72% 58% at 80% 24%, rgba(99,102,241,0.32), transparent 50%), radial-gradient(ellipse 62% 48% at 52% 82%, rgba(51,65,85,0.42), transparent 48%), radial-gradient(ellipse 58% 44% at 68% 58%, rgba(129,140,248,0.22), transparent 46%)',
                          }}
                        />
                        <div className="absolute inset-0 backdrop-blur-2xl bg-slate-950/40" />
                        <div className="absolute inset-0 bg-gradient-to-b from-slate-400/[0.04] via-transparent to-black/40" />
                        <div
                          className="absolute inset-0 pointer-events-none opacity-[0.22] mix-blend-soft-light"
                          style={{
                            backgroundImage: SCENE_SLOT_PLACEHOLDER_GRAIN_TILE,
                            backgroundSize: '112px 112px',
                          }}
                        />
                      </div>
                    )}
                  </>
                )
                const selectionMark = (
                  <div className="absolute inset-0 z-[0] flex items-center justify-center pointer-events-none">
                    {slot.selected ? (
                      <Check className="w-7 h-7 text-emerald-400/95 drop-shadow-md" strokeWidth={2.5} aria-hidden />
                    ) : (
                      <Circle className="w-7 h-7 text-white/30" strokeWidth={2} aria-hidden />
                    )}
                  </div>
                )
                const isSlotGenerating = slot.status === 'generating'
                const genPct = isSlotGenerating ? Math.max(1, Math.min(99, sceneSlotGenProgress[sidx] ?? 2)) : 0
                return (
                  <div
                    key={slot.key}
                    role="button"
                    tabIndex={isSlotGenerating ? -1 : 0}
                    aria-busy={isSlotGenerating}
                    aria-disabled={isSlotGenerating}
                    onClick={() => {
                      if (isSlotGenerating) return
                      toggleSceneSlotSelected(sceneRunBoard.id, sidx)
                    }}
                    onKeyDown={(e) => {
                      if (isSlotGenerating) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleSceneSlotSelected(sceneRunBoard.id, sidx)
                      }
                    }}
                    className={`flex h-full min-h-0 flex-col overflow-visible rounded-2xl border text-center transition-[opacity,box-shadow] ${
                      slot.selected
                        ? 'border-white/18 bg-black/28 shadow-[0_0_0_1px_rgba(167,139,250,0.2)]'
                        : 'border-white/[0.07] bg-black/12 opacity-55'
                    } ${isSlotGenerating ? 'cursor-wait pointer-events-none' : 'cursor-pointer'}`}
                  >
                    {/* 固定顶栏高度：标题最多 2 行 + 描述 1 行；顶栏 overflow-visible 避免描述 hover 浮层被卡片裁切 */}
                    <div className="relative z-10 flex h-[5.25rem] shrink-0 flex-col overflow-visible px-2.5 pb-1.5 pt-2">
                      <div className="flex min-h-0 flex-1 items-center justify-center">
                        <span
                          className={`${SCENE_TAG_CLASS} line-clamp-2 max-h-[2.6rem] min-w-0 w-full justify-center overflow-hidden text-center text-[10px] leading-snug`}
                        >
                          {slot.title}
                        </span>
                      </div>
                      <div className="relative group/desc z-20 mt-1 h-5 shrink-0">
                        <p className="text-[10px] leading-5 text-white/48 truncate cursor-default select-none">
                          {rawDesc || '\u00a0'}
                        </p>
                        {rawDesc ? (
                          <div
                            className="workbench-solid-hover-pop pointer-events-none absolute left-1/2 z-[300] min-w-[13rem] max-w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 bottom-full mb-1.5 rounded-xl border px-3 py-2 text-[11px] leading-relaxed text-white shadow-2xl whitespace-normal opacity-0 translate-y-1 transition-[opacity,transform] duration-100 ease-out group-hover/desc:opacity-100 group-hover/desc:translate-y-0"
                            role="tooltip"
                          >
                            {hoverFull}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="group/sc relative aspect-square w-full overflow-hidden rounded-b-2xl bg-zinc-900/30">
                      {slot.status === 'done' && slot.imageUrl ? (
                        <>
                          <img
                            src={slot.imageUrl}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover pointer-events-none select-none"
                            draggable={false}
                          />
                          <div
                            className="pointer-events-none absolute inset-0 z-[1] bg-black/0 opacity-0 transition-opacity group-hover/sc:bg-black/45 group-hover/sc:opacity-100"
                            aria-hidden
                          />
                          <button
                            type="button"
                            className="absolute inset-0 z-[2] cursor-zoom-in touch-manipulation border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/55 focus-visible:ring-inset"
                            title="点击放大预览"
                            aria-label="放大预览图片"
                            onClick={(e) => {
                              e.stopPropagation()
                              setHistoryLightbox({
                                url: slot.imageUrl!,
                                downloadName: `tikgen-${sceneRunBoard.id}-${sidx + 1}.png`,
                              })
                            }}
                          />
                          <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center">
                            <button
                              type="button"
                              className="pointer-events-none rounded-full border border-white/25 bg-white/15 p-2.5 text-white opacity-0 transition-opacity group-hover/sc:pointer-events-auto group-hover/sc:opacity-100 hover:bg-white/25"
                              title="预览"
                              onClick={(e) => {
                                e.stopPropagation()
                                setHistoryLightbox({
                                  url: slot.imageUrl!,
                                  downloadName: `tikgen-${sceneRunBoard.id}-${sidx + 1}.png`,
                                })
                              }}
                            >
                              <Eye className="h-6 w-6" />
                            </button>
                          </div>
                          <a
                            href={buildDownloadProxyUrl(slot.imageUrl || '', `tikgen-${sceneRunBoard.id}-${sidx + 1}.png`)}
                            download={`tikgen-${sceneRunBoard.id}-${sidx + 1}.png`}
                            rel="noreferrer"
                            className="pointer-events-none absolute right-2 top-2 z-[3] rounded-full border border-white/20 bg-black/70 p-1.5 text-white opacity-0 transition-opacity group-hover/sc:pointer-events-auto group-hover/sc:opacity-100 hover:bg-black/85"
                            title="下载"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </>
                      ) : slot.status === 'generating' ? (
                        <div className="absolute inset-0">
                          {mosaicBase}
                          {selectionMark}
                          <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2.5 bg-black/35 px-4 text-white/92 text-[11px] backdrop-blur-[3px]">
                            <RefreshCw className="w-7 h-7 animate-spin opacity-90" aria-hidden />
                            <span className="tabular-nums text-sm font-semibold tracking-tight">{genPct}%</span>
                            <div className="h-1.5 w-[min(88%,7rem)] overflow-hidden rounded-full bg-white/12">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-violet-400/90 to-fuchsia-400/85 transition-[width] duration-300 ease-out"
                                style={{ width: `${genPct}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-white/65">生成中…</span>
                          </div>
                        </div>
                      ) : slot.status === 'failed' && slot.selected ? (
                        <div className="absolute inset-0">
                          {mosaicBase}
                          {selectionMark}
                          <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1.5 px-2 text-center text-[11px] text-red-100/95 bg-red-950/35 backdrop-blur-[2px]">
                            <span>生成失败</span>
                            <span className="text-[10px] text-white/50 line-clamp-2">{slot.error}</span>
                            <button
                              type="button"
                              disabled={!canGenerate}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleGenerateSceneSlot(sceneRunBoard.id, sidx)
                              }}
                              className="mt-1 text-xs text-violet-200 underline disabled:opacity-40"
                            >
                              单张重试
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="absolute inset-0">
                          {mosaicBase}
                          {selectionMark}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
        {imageGenHistory.length === 0 && !sceneBoardPreparing && !sceneRunBoard ? (
          <div className="min-h-[200px] flex flex-col items-center justify-center text-center text-white/45 border border-white/12 rounded-xl bg-white/[0.02] px-6 mb-6">
            <Image className="w-14 h-14 mb-3 opacity-35" />
            <p className="text-sm text-white/55">暂无归档记录</p>
            <p className="text-xs text-white/40 mt-1 max-w-xs">
              {isSimpleImageGen
                ? '在左侧填写提示词并上传参考图，点击「开始生成」；进度与结果保存在生成历史中，刷新页面仍可继续。'
                : '左侧「免费生成预览」加载 6 场景后，在此点击「一键生成图片」批量出图；进度与结果会保存在生成历史中，刷新页面仍可继续。'}
            </p>
          </div>
        ) : null}
        {historyGrouped.length > 0 ? (
          <div className="space-y-10 pb-2">
            {historyGrouped.map(({ day, tasks }) => (
              <div key={day}>
                <div className="text-sm font-semibold text-white/90 mb-3">{day}</div>
                <div className="flex flex-col gap-4">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="image-history-card rounded-2xl border border-white/14 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md"
                    >
                      <div className="mb-2.5 flex items-start justify-between gap-2">
                        <h3 className="min-w-0 flex-1 text-lg font-bold leading-snug text-white/95 sm:text-xl pr-1">
                          {(task.productName || '').trim() || '商品场景'}
                        </h3>
                        {task.status !== 'active' ? (
                          <button
                            type="button"
                            onClick={() => removeImageGenHistoryTask(task.id)}
                            className="shrink-0 rounded-md p-1.5 text-white/28 transition-colors hover:bg-white/[0.06] hover:text-white/48 focus:outline-none focus-visible:text-white/55 focus-visible:ring-1 focus-visible:ring-white/20"
                            title="删除此条记录"
                            aria-label="删除此条记录"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        ) : null}
                      </div>
                      <div className="mb-3 overflow-x-auto overflow-y-hidden pb-0.5 [scrollbar-width:thin]">
                        <div className="flex w-max min-w-full flex-nowrap items-center gap-2">
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75">
                            <Clock className="w-3 h-3 text-violet-300/85 shrink-0" strokeWidth={2} />
                            {imageHistoryRelativeZh(task.ts)}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75">
                            <Box className="w-3 h-3 text-violet-300/85 shrink-0" strokeWidth={2} />
                            {task.modelLabel}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75">
                            <Maximize2 className="w-3 h-3 text-violet-300/85 shrink-0" strokeWidth={2} />
                            {task.aspect}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] border border-white/12 px-2.5 py-1 text-[10px] text-white/75 uppercase tracking-wide">
                            {task.resolutionLabel}
                          </span>
                          <span
                            className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium border ${
                              task.status === 'completed'
                                ? 'bg-emerald-500/18 text-emerald-100 border-emerald-400/28'
                                : task.status === 'active'
                                  ? 'bg-amber-500/18 text-amber-100 border-amber-400/30'
                                  : 'bg-red-500/15 text-red-100 border-red-400/25'
                            }`}
                          >
                            {task.status === 'completed' ? '已完成' : task.status === 'active' ? '生成中' : '失败'}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-3 items-start mb-3">
                        <button
                          type="button"
                          className="shrink-0 w-14 h-14 rounded-xl overflow-hidden border border-white/15 bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
                          onClick={() => {
                            if (task.refThumb) setHistoryLightbox({ url: task.refThumb, downloadName: `reference-${task.id}.png` })
                          }}
                          title="点击放大参考图"
                        >
                          {task.refThumb ? (
                            <img src={task.refThumb} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-white/30">无</div>
                          )}
                        </button>
                        <div className="group/prompt relative flex-1 min-w-0">
                          <p className="image-history-prompt-clamp text-xs text-white/78 leading-relaxed text-left cursor-help break-words">
                            {formatImageGenHistoryPromptDisplay(task.prompt)}
                          </p>
                          <div className="pointer-events-none absolute left-0 top-full z-[280] -mt-1 w-full max-w-[min(100%,22rem)] pt-1 opacity-0 transition-opacity duration-75 ease-out group-hover/prompt:pointer-events-auto group-hover/prompt:opacity-100">
                            <div className="image-form-tip-pop rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed text-white max-h-52 overflow-y-auto whitespace-pre-wrap break-words">
                              {formatImageGenHistoryPromptDisplay(task.prompt)}
                            </div>
                          </div>
                        </div>
                      </div>
                      {task.status === 'failed' && task.errorMessage ? (
                        <p className="text-[11px] text-red-300/90 mb-3 break-words">{task.errorMessage}</p>
                      ) : null}
                      {task.outputUrls.length > 0 || (task.status === 'active' && task.requestedCount > task.outputUrls.length) ? (
                        <div className="space-y-2">
                          {task.outputUrls.length > 0 ? (
                            <button
                              type="button"
                              disabled={
                                task.outputUrls.filter((u) => isLikelyPersistedImageUrl(String(u || '').trim()))
                                  .length === 0
                              }
                              onClick={() => handleDownloadAllHistoryTask(task)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-white/18 text-white/85 hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Download className="w-3.5 h-3.5" />
                              下载全部图片（
                              {
                                task.outputUrls.filter((u) => isLikelyPersistedImageUrl(String(u || '').trim()))
                                  .length
                              }
                              ）
                            </button>
                          ) : null}
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {task.outputUrls.map((url, idx) => {
                              const urlClean = String(url || '').trim()
                              const histKey = `${task.id}:${idx}`
                              const urlMissing = !isLikelyPersistedImageUrl(urlClean)
                              const urlBroken = urlMissing || Boolean(histImageLoadFailed[histKey])
                              const rawLabel = task.sceneLabels?.[idx] || `图 ${idx + 1}`
                              const { display: titleSansParen, parenHints } = splitSceneHistoryTitleForDisplay(rawLabel)
                              const labelDisplay = titleSansParen || `图 ${idx + 1}`
                              const descTail =
                                (task.sceneDescriptions?.[idx] || '').trim() ||
                                (task.sceneTeasers?.[idx] || '').trim() ||
                                styleCardTeaser(
                                  String(task.prompt || '')
                                    .split(/\n────────\n/)[1]
                                    ?.replace(/^\s*(画面方案|爆款风格)：/, '')
                                    .replace(/\s+/g, ' ')
                                    .trim() || '',
                                  400,
                                )
                              const descParts: string[] = []
                              if (parenHints) descParts.push(`【标题补充】${parenHints}`)
                              if (descTail) descParts.push(descTail)
                              const descFull = descParts.join('\n\n').trim()
                              return (
                                <div
                                  key={`${task.id}_out_${idx}`}
                                  className="flex flex-col overflow-visible rounded-2xl border border-white/12 bg-black/30 group/out"
                                >
                                  <div className="relative z-20 shrink-0 rounded-t-2xl bg-black/30 px-2.5 pb-1.5 pt-2.5">
                                    <div
                                      className={`relative group/histscene mx-auto max-w-full ${descFull ? 'cursor-help' : ''}`}
                                    >
                                      <span className={IMAGE_HISTORY_SCENE_TITLE_CLASS} title={rawLabel}>
                                        {labelDisplay}
                                      </span>
                                      {descFull ? (
                                        <div
                                          className="image-form-tip-pop pointer-events-none absolute left-1/2 z-[300] min-w-[13rem] max-w-[min(22rem,calc(100vw-1.5rem))] -translate-x-1/2 bottom-full translate-y-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed text-white max-h-[min(12rem,40vh)] overflow-y-auto whitespace-pre-wrap break-words opacity-0 transition-[opacity] duration-100 ease-out group-hover/histscene:pointer-events-auto group-hover/histscene:opacity-100"
                                          role="tooltip"
                                        >
                                          {descFull}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="relative aspect-square w-full overflow-hidden rounded-b-2xl bg-black/35">
                                    {urlBroken ? (
                                      <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 px-3 py-4 text-center">
                                        <Image className="w-9 h-9 text-white/25 shrink-0" aria-hidden />
                                        <p className="text-[11px] leading-snug text-white/50">
                                          {urlMissing
                                            ? '无有效图片地址（本地记录可能不完整）'
                                            : '图片链接已失效或无法加载'}
                                        </p>
                                        <p className="text-[10px] leading-snug text-white/35">
                                          聚合 API 返回的地址可能是临时链，过期后无法预览。新图会自动尝试同步到「资产」；也可在资产页按时间查找。
                                        </p>
                                      </div>
                                    ) : (
                                      <>
                                        <img
                                          src={urlClean}
                                          alt=""
                                          className="absolute inset-0 h-full w-full object-cover pointer-events-none select-none"
                                          draggable={false}
                                          onError={() =>
                                            setHistImageLoadFailed((p) => ({ ...p, [histKey]: true }))
                                          }
                                        />
                                        <a
                                          href={buildDownloadProxyUrl(urlClean, `tikgen-${task.id}-${idx + 1}.png`)}
                                          download={`tikgen-${task.id}-${idx + 1}.png`}
                                          rel="noreferrer"
                                          className="absolute right-2 top-2 z-[3] rounded-full border border-white/20 bg-black/70 p-2 text-white opacity-0 transition-opacity pointer-events-none hover:bg-black/85 group-hover/out:pointer-events-auto group-hover/out:opacity-100"
                                          title="下载"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <Download className="w-4 h-4" />
                                        </a>
                                        <button
                                          type="button"
                                          className="absolute inset-0 z-[2] cursor-zoom-in touch-manipulation border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 focus-visible:ring-inset"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setHistoryLightbox({
                                              url: urlClean,
                                              downloadName: `tikgen-${task.id}-${idx + 1}.png`,
                                            })
                                          }}
                                          title="点击放大预览"
                                          aria-label="放大预览图片"
                                        />
                                      </>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                            {task.status === 'active'
                              ? (() => {
                                  const inflightSlots =
                                    (task.sceneSlots || []).filter(
                                      (s) => s.status === 'generating' || s.status === 'pending',
                                    ) || []
                                  const fallbackCount = Math.max(0, task.requestedCount - task.outputUrls.length)
                                  const list =
                                    inflightSlots.length > 0
                                      ? inflightSlots
                                      : Array.from({ length: fallbackCount }).map((_, i) => ({
                                          title: `图 ${task.outputUrls.length + i + 1}`,
                                          status: 'generating' as const,
                                        }))
                                  return list.map((slot, i) => {
                                    const cap = 94
                                    const tauMs = 44000
                                    const elapsed = Math.max(0, historyProgressNow - task.ts - i * 800)
                                    const eased = 1 - Math.exp(-elapsed / tauMs)
                                    const pct = Math.max(2, Math.min(cap, Math.round(2 + (cap - 2) * eased)))
                                    return (
                                      <div
                                        key={`${task.id}_pending_${i}`}
                                        className="flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-black/30"
                                      >
                                        <div className="relative z-20 shrink-0 rounded-t-2xl bg-black/30 px-2.5 pb-1.5 pt-2.5">
                                          <span className={IMAGE_HISTORY_SCENE_TITLE_CLASS}>{slot.title || `图 ${i + 1}`}</span>
                                        </div>
                                        <div className="relative aspect-square w-full overflow-hidden rounded-b-2xl bg-black/45">
                                          {task.refThumb ? (
                                            <img
                                              src={task.refThumb}
                                              alt=""
                                              className="absolute inset-0 h-full w-full object-cover scale-[1.26] blur-[24px] opacity-55"
                                              draggable={false}
                                            />
                                          ) : null}
                                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/36 px-4 text-white/88">
                                            <RefreshCw className="w-6 h-6 animate-spin opacity-90" aria-hidden />
                                            <span className="tabular-nums text-sm font-semibold tracking-tight">{pct}%</span>
                                            <div className="h-1.5 w-[min(88%,7rem)] overflow-hidden rounded-full bg-white/12">
                                              <div
                                                className="h-full rounded-full bg-gradient-to-r from-violet-400/90 to-fuchsia-400/85 transition-[width] duration-300 ease-out"
                                                style={{ width: `${pct}%` }}
                                              />
                                            </div>
                                            <span className="text-[10px] text-white/65">生成中…</span>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })
                                })()
                              : null}
                          </div>
                        </div>
                      ) : task.status === 'active' ? (
                        <p className="text-[11px] text-white/45 mb-1">出图进行中，首张完成后将显示在下面…</p>
                      ) : task.status === 'completed' || task.status === 'failed' ? (
                        <p className="text-[11px] text-white/40">未返回图片地址</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
    {typeof document !== 'undefined' &&
    stylePromptHoverIdx !== null &&
    stylePromptPopBox &&
    hotStyles[stylePromptHoverIdx] != null
      ? createPortal(
          <div
            className="image-form-tip-pop fixed z-[10050] rounded-xl border border-white/22 bg-[#121218] p-3 text-[11px] leading-relaxed text-white shadow-[0_20px_50px_rgba(0,0,0,0.9)] ring-2 ring-black/60"
            style={{
              top: stylePromptPopBox.top,
              left: stylePromptPopBox.left,
              width: stylePromptPopBox.width,
              maxHeight: 'min(18rem, 55vh)',
              overflowY: 'auto',
              pointerEvents: 'auto',
            }}
            onMouseEnter={() => {
              if (stylePromptLeaveTimerRef.current != null) {
                window.clearTimeout(stylePromptLeaveTimerRef.current)
                stylePromptLeaveTimerRef.current = null
              }
            }}
            onMouseLeave={() => {
              const t = window.setTimeout(() => {
                setStylePromptHoverIdx(null)
                setStylePromptPopBox(null)
                stylePromptAnchorRef.current = null
                stylePromptLeaveTimerRef.current = null
              }, 200)
              stylePromptLeaveTimerRef.current = t
            }}
            onClick={(e) => e.stopPropagation()}
            role="tooltip"
          >
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-violet-300">出图主描述</div>
            <div className="whitespace-pre-wrap break-words text-white/88">
              {String(hotStyles[stylePromptHoverIdx]?.imagePrompt || '').trim() || '（暂无，可点击铅笔编辑后填写）'}
            </div>
          </div>,
          document.body,
        )
      : null}
    {customStyleModalOpen ? (
      <div
        className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
        onClick={() => setCustomStyleModalOpen(false)}
        role="presentation"
      >
        <div
          className="w-full max-w-lg rounded-2xl border border-white/15 bg-zinc-900 shadow-2xl p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">自定义方案</h3>
            <button type="button" onClick={() => setCustomStyleModalOpen(false)} className="p-1 rounded-lg hover:bg-white/10 text-white/80">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-white/48">
            用自然语言写清画面即可：背景与光线、商品位置与占比、是否需要人物或道具、整体风格与氛围。保存后会写入「出图主描述」并自动选用该方案。
          </p>
          <textarea
            value={customStylePromptOnly}
            onChange={(e) => setCustomStylePromptOnly(e.target.value)}
            rows={10}
            className="min-h-[200px] w-full resize-y rounded-xl border border-white/12 bg-black/30 px-3 py-2.5 text-sm leading-relaxed text-white/90 placeholder:text-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
            placeholder="例如：纯白摄影棚顶光，商品居中略偏下约占画面 65%，轻微倒影；背景干净无杂物，偏电商主图、高对比清晰质感……"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCustomStyleModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-white/15 text-white/80 text-sm hover:bg-white/5"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!customStylePromptOnly.trim()}
              onClick={() => {
                const prompt = customStylePromptOnly.trim()
                if (!prompt) return
                const row: ImageWorkbenchStyleRow = {
                  title: '自定义方案',
                  description: prompt,
                  imagePrompt: prompt,
                  isCustom: true,
                }
                const stripped = hotStyles.filter((s) => !s.isCustom)
                const firstCustomIdx = hotStyles.findIndex((s) => s.isCustom)
                const nextList =
                  firstCustomIdx >= 0
                    ? [...stripped.slice(0, firstCustomIdx), row, ...stripped.slice(firstCustomIdx)]
                    : [...hotStyles, row]
                const sel = nextList.findIndex((s) => s.isCustom)
                setHotStyles(nextList)
                setSelectedHotStyleIndex(sel >= 0 ? sel : 0)
                setCustomStyleModalOpen(false)
                const jobId = ++aiJobRef.current
                applyStyleCardAsMainPrompt(jobId, row)
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
            >
              保存并选用
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {styleCardEditIndex !== null ? (
      <div
        className="fixed inset-0 z-[71] bg-black/70 flex items-center justify-center p-4"
        onClick={() => setStyleCardEditIndex(null)}
        role="presentation"
      >
        <div
          className="w-full max-w-lg rounded-2xl border border-white/15 bg-zinc-900 shadow-2xl p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">编辑爆款风格</h3>
            <button
              type="button"
              onClick={() => setStyleCardEditIndex(null)}
              className="p-1 rounded-lg hover:bg-white/10 text-white/80"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-white/55 mb-1">标题</label>
              <input
                value={styleCardEditDraft.title}
                onChange={(e) => setStyleCardEditDraft((d) => ({ ...d, title: e.target.value }))}
                disabled={!hotStyleCardsEditable}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/12 text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/55 mb-1">短说明</label>
              <textarea
                value={styleCardEditDraft.description}
                onChange={(e) => setStyleCardEditDraft((d) => ({ ...d, description: e.target.value }))}
                rows={3}
                disabled={!hotStyleCardsEditable}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/12 text-white text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/55 mb-1">出图主描述</label>
              <textarea
                value={styleCardEditDraft.imagePrompt}
                onChange={(e) => setStyleCardEditDraft((d) => ({ ...d, imagePrompt: e.target.value }))}
                rows={8}
                disabled={!hotStyleCardsEditable}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/12 text-white text-sm resize-y min-h-[160px]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => setStyleCardEditIndex(null)}
              className="px-4 py-2 rounded-xl border border-white/15 text-white/80 text-sm hover:bg-white/5"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!hotStyleCardsEditable}
              onClick={() => {
                if (!hotStyleCardsEditable) return
                const idx = styleCardEditIndex
                if (idx === null) return
                const title = styleCardEditDraft.title.trim()
                const description = styleCardEditDraft.description.trim()
                const imagePrompt = styleCardEditDraft.imagePrompt.trim()
                setHotStyles((prev) =>
                  prev.map((s, i) => (i === idx ? { ...s, title: title || s.title, description, imagePrompt } : s)),
                )
                if (selectedHotStyleIndex === idx) {
                  setPrompt(imagePrompt)
                  setOptimizedPrompt(imagePrompt)
                }
                setStyleCardEditIndex(null)
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {showAssetPicker && (
      <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
        <div className="w-full max-w-6xl max-h-[88vh] overflow-hidden bg-white rounded-2xl border shadow-2xl flex flex-col">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <div className="text-lg font-semibold">从资产库选择</div>
            <button onClick={() => setShowAssetPicker(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="px-5 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAssetTab('user_upload')}
                className={`px-3 py-1.5 rounded-lg text-sm border-2 ${assetTab === 'user_upload' ? 'bg-gray-900 text-white border-purple-400 shadow-[0_0_0_1px_rgba(167,139,250,0.55)]' : 'bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200/70'}`}
              >
                本地上传
              </button>
              <button
                onClick={() => setAssetTab('ai_generated')}
                className={`px-3 py-1.5 rounded-lg text-sm border-2 ${assetTab === 'ai_generated' ? 'bg-gray-900 text-white border-purple-400 shadow-[0_0_0_1px_rgba(167,139,250,0.55)]' : 'bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200/70'}`}
              >
                AI 生成
              </button>
            </div>
            <div className="text-sm text-gray-500">已选 {assetSelectedIds.size}/{Math.max(0, MAX_REF_IMAGES - refImages.length)}</div>
          </div>
          <div className="p-5 overflow-auto flex-1">
            {assetBusy ? (
              <div className="text-sm text-gray-500">加载中...</div>
            ) : assetList.length === 0 ? (
              <div className="text-sm text-gray-500">暂无可选图片资产</div>
            ) : (
              <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {assetList.map((a) => {
                  const checked = assetSelectedIds.has(a.id)
                  return (
                    <button
                      key={a.id}
                      onClick={() => toggleAssetPick(a.id)}
                      className={`relative rounded-xl overflow-hidden border transition-all ${checked ? 'border-purple-500 ring-2 ring-purple-300 shadow-[0_0_0_2px_rgba(168,85,247,.35)]' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <img src={a.url} alt={a.name || 'asset'} className="w-full h-24 object-cover" />
                      {checked && (
                        <div className="absolute right-1.5 top-1.5 w-5 h-5 rounded-full bg-purple-600 text-white text-xs flex items-center justify-center">
                          ✓
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
            <button onClick={() => setShowAssetPicker(false)} className="px-4 py-2 rounded-lg border">取消</button>
            <button onClick={confirmAssetPick} className="px-4 py-2 rounded-lg bg-purple-600 text-white">确认选择（{assetSelectedIds.size}）</button>
          </div>
        </div>
      </div>
    )}
    {previewRefImage && (
      <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreviewRefImage(null)}>
        <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setPreviewRefImage(null)}
            className="absolute -top-10 right-0 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
          >
            关闭
          </button>
          <div className="rounded-2xl border border-white/20 bg-white/5 p-2">
            <img src={previewRefImage.url} alt={previewRefImage.name} className="w-full max-h-[78vh] object-contain rounded-xl" />
          </div>
          <div className="mt-2 text-center text-xs text-white/70">
            {previewRefImage.name}（{previewRefImage.index + 1}/{refImages.length}）
          </div>
        </div>
      </div>
    )}
    {historyLightbox && (
      <div
        className="fixed inset-0 z-[10060] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
        onClick={() => setHistoryLightbox(null)}
        role="presentation"
      >
        <div
          className="relative max-w-5xl w-full flex flex-col items-stretch gap-3"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <div className="flex items-center justify-end gap-2">
            <a
              href={buildDownloadProxyUrl(historyLightbox.url, historyLightbox.downloadName || 'tikgen-image.png')}
              download={historyLightbox.downloadName || 'tikgen-image.png'}
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gradient-to-r from-pink-500 to-purple-500 text-white font-medium hover:opacity-95"
            >
              <Download className="w-4 h-4" />
              下载
            </a>
            <button
              type="button"
              onClick={() => setHistoryLightbox(null)}
              className="px-3 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/18 text-white border border-white/15"
            >
              关闭
            </button>
          </div>
          <div className="rounded-2xl border border-white/18 bg-white/[0.06] p-2">
            <img src={historyLightbox.url} alt="" className="w-full max-h-[78vh] object-contain rounded-xl mx-auto" />
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function Assets() {
  const PAGE_SIZE = 12
  const [userUploads, setUserUploads] = useState<AssetItem[]>([])
  const [aiOutputs, setAiOutputs] = useState<AssetItem[]>([])
  const [userOffset, setUserOffset] = useState(0)
  const [aiOffset, setAiOffset] = useState(0)
  const [userHasMore, setUserHasMore] = useState(true)
  const [aiHasMore, setAiHasMore] = useState(true)
  const [userFilter, setUserFilter] = useState<'all' | 'image' | 'video'>('all')
  const [aiFilter, setAiFilter] = useState<'all' | 'image' | 'video'>('all')
  const [loading, setLoading] = useState(false)
  const [loadingMoreUser, setLoadingMoreUser] = useState(false)
  const [loadingMoreAi, setLoadingMoreAi] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchKeyword, setSearchKeyword] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest')
  const [previewAsset, setPreviewAsset] = useState<AssetItem | null>(null)
  const initializedRef = useRef(false)
  const reloadAiAssetsRef = useRef<() => Promise<void>>(async () => {})

  const saveCache = (next: {
    userUploads: AssetItem[]
    aiOutputs: AssetItem[]
    userOffset: number
    aiOffset: number
    userHasMore: boolean
    aiHasMore: boolean
  }) => {
    const payload = { ...next, ts: Date.now() }
    assetsMemoryCache = payload
    try {
      localStorage.setItem(ASSETS_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // ignore cache write errors
    }
  }

  const applyCache = (cached: any) => {
    setUserUploads(Array.isArray(cached?.userUploads) ? cached.userUploads : [])
    setAiOutputs(Array.isArray(cached?.aiOutputs) ? cached.aiOutputs : [])
    setUserOffset(Number(cached?.userOffset || 0))
    setAiOffset(Number(cached?.aiOffset || 0))
    setUserHasMore(Boolean(cached?.userHasMore))
    setAiHasMore(Boolean(cached?.aiHasMore))
  }

  const loadSource = async (source: 'user_upload' | 'ai_generated', reset: boolean) => {
    const isUser = source === 'user_upload'
    const filter = isUser ? userFilter : aiFilter
    const currentOffset = reset ? 0 : isUser ? userOffset : aiOffset
    const r = await listAssetsAPI({
      source,
      type: filter === 'all' ? undefined : filter,
      limit: PAGE_SIZE,
      offset: currentOffset,
    })
    const list = r.assets || []
    if (isUser) {
      if (reset) setUserUploads(list)
      else setUserUploads((prev) => [...prev, ...list])
      const nextOffset = r.nextOffset ?? currentOffset + list.length
      setUserOffset(nextOffset)
      setUserHasMore(Boolean(r.hasMore))
      saveCache({
        userUploads: reset ? list : [...userUploads, ...list],
        aiOutputs,
        userOffset: nextOffset,
        aiOffset,
        userHasMore: Boolean(r.hasMore),
        aiHasMore,
      })
    } else {
      if (reset) setAiOutputs(list)
      else setAiOutputs((prev) => [...prev, ...list])
      const nextOffset = r.nextOffset ?? currentOffset + list.length
      setAiOffset(nextOffset)
      setAiHasMore(Boolean(r.hasMore))
      saveCache({
        userUploads,
        aiOutputs: reset ? list : [...aiOutputs, ...list],
        userOffset,
        aiOffset: nextOffset,
        userHasMore,
        aiHasMore: Boolean(r.hasMore),
      })
    }
  }

  reloadAiAssetsRef.current = async () => {
    try {
      await loadSource('ai_generated', true)
    } catch {
      // 静默失败，用户可手动刷新资产库
    }
  }

  const refreshAll = async () => {
    setLoading(true)
    setError('')
    try {
      await Promise.all([loadSource('user_upload', true), loadSource('ai_generated', true)])
    } catch (e: any) {
      setError(e?.message || '获取资产失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // 先用缓存秒开，再静默刷新，避免每次进资产库都白屏等待
    const fromMem = assetsMemoryCache
    if (fromMem) applyCache(fromMem)
    if (!fromMem) {
      try {
        const raw = localStorage.getItem(ASSETS_CACHE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          applyCache(parsed)
          assetsMemoryCache = parsed
        }
      } catch {
        // ignore cache parse errors
      }
    }
    refreshAll()
    initializedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      void reloadAiAssetsRef.current()
    }
    window.addEventListener(AI_ASSET_CREATED_EVENT, handler)
    return () => window.removeEventListener(AI_ASSET_CREATED_EVENT, handler)
  }, [])

  useEffect(() => {
    if (!initializedRef.current) return
    // filter changed -> reset this section pagination
    ;(async () => {
      try {
        await loadSource('user_upload', true)
      } catch {
        // handled in UI on next manual refresh
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFilter])

  useEffect(() => {
    if (!initializedRef.current) return
    ;(async () => {
      try {
        await loadSource('ai_generated', true)
      } catch {
        // handled in UI on next manual refresh
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiFilter])

  const handleStandaloneUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    setError('')
    try {
      for (const f of Array.from(files)) {
        const dataUrl = await fileToDataUrl(f)
        await createAssetAPI({
          source: 'user_upload',
          type: guessAssetType(f),
          url: dataUrl,
          name: f.name,
          metadata: { from: 'assets_upload', mime: f.type, size: f.size },
        })
      }
      await refreshAll()
    } catch (e: any) {
      setError(e?.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleRename = async (a: AssetItem) => {
    const next = window.prompt('输入新的资产名称', a.name || '')
    if (next == null) return
    setBusyId(a.id)
    setError('')
    try {
      await updateAssetAPI({ id: a.id, name: next })
      if (a.source === 'user_upload') await loadSource('user_upload', true)
      else await loadSource('ai_generated', true)
    } catch (e: any) {
      setError(e?.message || '重命名失败')
    } finally {
      setBusyId('')
    }
  }

  const handleDelete = async (a: AssetItem) => {
    if (!window.confirm('确认删除该资产吗？删除后不可恢复。')) return
    setBusyId(a.id)
    setError('')
    try {
      await deleteAssetAPI(a.id)
      if (a.source === 'user_upload') {
        setUserUploads((prev) => prev.filter((x) => x.id !== a.id))
      } else {
        setAiOutputs((prev) => prev.filter((x) => x.id !== a.id))
      }
    } catch (e: any) {
      setError(e?.message || '删除失败')
    } finally {
      setBusyId('')
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyView = (items: AssetItem[]) => {
    const kw = searchKeyword.trim().toLowerCase()
    const filtered = kw
      ? items.filter((a) => {
          const name = String(a.name || '').toLowerCase()
          const meta = JSON.stringify(a.metadata || {}).toLowerCase()
          return name.includes(kw) || meta.includes(kw)
        })
      : items
    return [...filtered].sort((a, b) => {
      const ta = new Date(a.created_at).getTime()
      const tb = new Date(b.created_at).getTime()
      return sortBy === 'newest' ? tb - ta : ta - tb
    })
  }

  const shownUserUploads = applyView(userUploads)
  const shownAiOutputs = applyView(aiOutputs)

  const handleBatchDelete = async () => {
    if (!selectedIds.size) return
    if (!window.confirm(`确认批量删除 ${selectedIds.size} 个资产吗？删除后不可恢复。`)) return
    setError('')
    const ids = Array.from(selectedIds)
    try {
      for (const id of ids) {
        await deleteAssetAPI(id)
      }
      setSelectedIds(new Set())
      setUserUploads((prev) => prev.filter((x) => !ids.includes(x.id)))
      setAiOutputs((prev) => prev.filter((x) => !ids.includes(x.id)))
    } catch (e: any) {
      setError(e?.message || '批量删除失败')
    }
  }

  useEffect(() => {
    if (!previewAsset) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewAsset(null)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [previewAsset])

  const renderAssetCard = (a: AssetItem) => {
    const isImage = a.type === 'image'
    const checked = selectedIds.has(a.id)
    return (
      <div key={a.id} className="rounded-xl border bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <label className="inline-flex items-center gap-1 text-xs text-gray-500">
            <input type="checkbox" checked={checked} onChange={() => toggleSelect(a.id)} />
            选择
          </label>
          <span className="text-[11px] text-gray-400">{a.type === 'image' ? '图片' : '视频'}</span>
        </div>
        <button
          type="button"
          onClick={() => setPreviewAsset(a)}
          className="w-full h-28 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden"
          title="点击放大预览"
        >
          {isImage ? (
            <img src={a.url} alt={a.name || 'asset'} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          ) : (
            <video src={a.url} className="w-full h-full object-cover" preload="metadata" />
          )}
        </button>
        <div className="mt-2 text-xs text-gray-600 truncate">{a.name || `${a.type} 资产`}</div>
        <div className="mt-1 text-[11px] text-gray-400">{new Date(a.created_at).toLocaleString()}</div>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setPreviewAsset(a)} className="text-xs px-2 py-1 rounded border">预览</button>
          <a href={buildDownloadProxyUrl(a.url, a.name || 'asset-file')} download className="text-xs px-2 py-1 rounded border">下载</a>
          <button disabled={busyId === a.id} onClick={() => handleRename(a)} className="text-xs px-2 py-1 rounded border disabled:opacity-50">重命名</button>
          <button disabled={busyId === a.id} onClick={() => handleDelete(a)} className="text-xs px-2 py-1 rounded border text-red-600 border-red-200 disabled:opacity-50">删除</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">资产库</h2>
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 border rounded-lg text-sm bg-white"
          >
            <option value="newest">按时间：最新</option>
            <option value="oldest">按时间：最早</option>
          </select>
          <input
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜索名称/备注"
            className="px-3 py-2 border rounded-lg text-sm w-44"
          />
          <button
            disabled={!selectedIds.size}
            onClick={handleBatchDelete}
            className="px-3 py-2 border rounded-lg text-sm text-red-600 border-red-200 disabled:opacity-50"
          >
            批量删除({selectedIds.size})
          </button>
          <button onClick={refreshAll} className="px-3 py-2 border rounded-lg text-sm">刷新</button>
          <label className="px-4 py-2 bg-gray-900 text-white rounded-lg cursor-pointer">
            {uploading ? '上传中...' : '上传素材'}
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => handleStandaloneUpload(e.target.files)}
            />
          </label>
        </div>
      </div>
      {!!error && <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}
      <div className="grid md:grid-cols-2 gap-6">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">本地上传</h3>
            <div className="flex items-center gap-1">
              {(['all', 'image', 'video'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setUserFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded-lg border ${userFilter === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600'}`}
                >
                  {f === 'all' ? '全部' : f === 'image' ? '图片' : '视频'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-gray-500">包含：本地上传（创作模块上传 + 资产库手动上传），均归档到当前账号。</p>
          <div className="mt-4">
            {loading ? (
              <div className="h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">加载中...</div>
            ) : shownUserUploads.length ? (
              <>
                <div className="grid grid-cols-2 gap-3 max-h-[420px] overflow-auto pr-1">{shownUserUploads.map(renderAssetCard)}</div>
                {userHasMore && (
                  <button
                    disabled={loadingMoreUser}
                    onClick={async () => {
                      setLoadingMoreUser(true)
                      try {
                        await loadSource('user_upload', false)
                      } finally {
                        setLoadingMoreUser(false)
                      }
                    }}
                    className="mt-3 w-full py-2 rounded-lg border text-sm disabled:opacity-50"
                  >
                    {loadingMoreUser ? '加载中...' : '加载更多'}
                  </button>
                )}
              </>
            ) : (
              <div className="h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">暂无素材</div>
            )}
          </div>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">AI生成</h3>
            <div className="flex items-center gap-1">
              {(['all', 'image', 'video'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setAiFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded-lg border ${aiFilter === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600'}`}
                >
                  {f === 'all' ? '全部' : f === 'image' ? '图片' : '视频'}
                </button>
              ))}
      </div>
          </div>
          <p className="text-sm text-gray-500">包含：视频生成、电商套图成功后的结果，自动归档到当前账号。</p>
          <div className="mt-4">
            {loading ? (
              <div className="h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">加载中...</div>
            ) : shownAiOutputs.length ? (
              <>
                <div className="grid grid-cols-2 gap-3 max-h-[420px] overflow-auto pr-1">{shownAiOutputs.map(renderAssetCard)}</div>
                {aiHasMore && (
                  <button
                    disabled={loadingMoreAi}
                    onClick={async () => {
                      setLoadingMoreAi(true)
                      try {
                        await loadSource('ai_generated', false)
                      } finally {
                        setLoadingMoreAi(false)
                      }
                    }}
                    className="mt-3 w-full py-2 rounded-lg border text-sm disabled:opacity-50"
                  >
                    {loadingMoreAi ? '加载中...' : '加载更多'}
                  </button>
                )}
              </>
            ) : (
              <div className="h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">暂无生成记录</div>
            )}
          </div>
        </div>
      </div>
      {previewAsset && (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreviewAsset(null)}>
          <div className="relative w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewAsset(null)}
              className="absolute -top-10 right-0 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
            >
              关闭
            </button>
            <div className="rounded-2xl border border-white/20 bg-white/5 p-2">
              {previewAsset.type === 'image' ? (
                <img src={previewAsset.url} alt={previewAsset.name || 'asset'} className="w-full max-h-[78vh] object-contain rounded-xl" />
              ) : (
                <video src={previewAsset.url} className="w-full max-h-[78vh] rounded-xl bg-black" controls autoPlay />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskCenter() {
  const PAGE_SIZE = 20
  const [tasks, setTasks] = useState<GenerationTaskItem[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'video' | 'image'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'processing' | 'succeeded' | 'failed'>('all')
  const [previewTaskMedia, setPreviewTaskMedia] = useState<{ url: string; type: 'image' | 'video'; title?: string } | null>(null)

  const load = async (reset: boolean) => {
    const current = reset ? 0 : offset
    const r = await listTasksAPI({
      type: typeFilter === 'all' ? undefined : typeFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
      limit: PAGE_SIZE,
      offset: current,
    })
    const rows = r.tasks || []
    if (reset) setTasks(rows)
    else setTasks((prev) => [...prev, ...rows])
    setOffset(r.nextOffset ?? current + rows.length)
    setHasMore(Boolean(r.hasMore))
  }

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        await load(true)
      } catch (e: any) {
        setError(e?.message || '获取任务失败')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter])

  const statusLabel = (s: string) => {
    const v = String(s || '').toLowerCase()
    if (v === 'submitted') return '已提交'
    if (v === 'processing' || v === 'running' || v === 'in_progress') return '生成中'
    if (v === 'succeeded' || v === 'success' || v === 'completed') return '成功'
    if (v === 'failed' || v === 'error') return '失败'
    return v || '未知'
  }

  const statusClass = (s: string) => {
    const v = String(s || '').toLowerCase()
    if (v === 'succeeded' || v === 'success' || v === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    if (v === 'failed' || v === 'error') return 'bg-red-50 text-red-700 border-red-200'
    if (v === 'processing' || v === 'running' || v === 'in_progress' || v === 'submitted') return 'bg-amber-50 text-amber-700 border-amber-200'
    return 'bg-gray-50 text-gray-700 border-gray-200'
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">任务中心</h2>
          <div className="flex items-center gap-2">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="all">全部类型</option>
              <option value="video">视频</option>
              <option value="image">图片</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="all">全部状态</option>
              <option value="submitted">已提交</option>
              <option value="processing">生成中</option>
              <option value="succeeded">成功</option>
              <option value="failed">失败</option>
            </select>
            <button
              onClick={async () => {
                setLoading(true)
                setError('')
                try {
                  await load(true)
                } catch (e: any) {
                  setError(e?.message || '刷新失败')
                } finally {
                  setLoading(false)
                }
              }}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              刷新
            </button>
          </div>
        </div>

        {!!error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

        {loading ? (
          <div className="h-44 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">任务加载中...</div>
        ) : tasks.length ? (
          <div className="space-y-3">
            {tasks.map((t) => (
              <div key={t.id} className="rounded-xl border p-4 bg-white">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm px-2 py-0.5 rounded bg-gray-100 text-gray-700">{t.type === 'video' ? '视频' : '图片'}</span>
                      <span className={`text-sm px-2 py-0.5 rounded border ${statusClass(t.status)}`}>{statusLabel(t.status)}</span>
                    </div>
                    <div className="mt-2 text-sm text-gray-700 truncate">模型：{t.model || '-'}</div>
                    <div className="mt-1 text-xs text-gray-400">创建时间：{new Date(t.created_at).toLocaleString()}</div>
                    {t.provider_task_id ? <div className="mt-1 text-xs text-gray-400 break-all">任务ID：{t.provider_task_id}</div> : null}
                  </div>
                  <div className="flex items-center gap-3">
                    {t.output_url ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewTaskMedia({
                              url: t.output_url!,
                              type: t.type === 'video' ? 'video' : 'image',
                              title: `${t.type === 'video' ? '视频' : '图片'}任务预览`,
                            })
                          }
                          className="group relative w-36 h-24 rounded-lg overflow-hidden border border-gray-200 bg-black/5"
                          title={t.type === 'video' ? '点击播放/放大' : '点击放大预览'}
                        >
                          {t.type === 'video' ? (
                            <>
                              <video src={t.output_url} className="w-full h-full object-contain bg-black" muted playsInline preload="metadata" />
                              <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-black/25 group-hover:bg-black/35 transition-colors">
                                <Play className="w-7 h-7 text-white drop-shadow" />
                              </div>
                            </>
                          ) : (
                            <img src={t.output_url} alt="" className="w-full h-full object-cover" />
                          )}
                        </button>
                        <a href={t.output_url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border text-sm">预览</a>
                        <a href={buildDownloadProxyUrl(t.output_url, `task-${t.id || 'output'}.mp4`)} download className="px-3 py-2 rounded-lg border text-sm">下载</a>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">暂无结果</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {hasMore && (
              <button
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true)
                  try {
                    await load(false)
                  } catch (e: any) {
                    setError(e?.message || '加载更多失败')
                  } finally {
                    setLoadingMore(false)
                  }
                }}
                className="w-full py-2 rounded-lg border text-sm disabled:opacity-50"
              >
                {loadingMore ? '加载中...' : '加载更多'}
              </button>
            )}
          </div>
        ) : (
          <div className="h-44 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">暂无任务记录</div>
        )}
      </div>
      {previewTaskMedia ? (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreviewTaskMedia(null)}>
          <div className="relative w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewTaskMedia(null)}
              className="absolute -top-10 right-0 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
            >
              关闭
            </button>
            <div className="rounded-2xl border border-white/20 bg-white/5 p-2">
              {previewTaskMedia.type === 'video' ? (
                <video src={previewTaskMedia.url} className="w-full max-h-[78vh] rounded-xl bg-black" controls autoPlay playsInline />
              ) : (
                <img src={previewTaskMedia.url} alt={previewTaskMedia.title || '任务结果预览'} className="w-full max-h-[78vh] object-contain rounded-xl" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DeveloperConsole() {
  const [tab, setTab] = useState<'monitor' | 'users' | 'models' | 'packages' | 'announcements' | 'tickets'>('users')
  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="bg-white rounded-2xl p-3 shadow border flex items-center gap-2 flex-wrap">
        <button onClick={() => setTab('users')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'users' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>用户管理</button>
        <button onClick={() => setTab('models')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'models' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>模型开关</button>
        <button onClick={() => setTab('packages')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'packages' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>套餐管理</button>
        <button onClick={() => setTab('announcements')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'announcements' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>公告发布</button>
        {SUPPORT_TICKET_ENABLED ? (
          <button onClick={() => setTab('tickets')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'tickets' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>工单管理</button>
        ) : null}
        <button onClick={() => setTab('monitor')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'monitor' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>系统监控</button>
      </div>
      {tab === 'users' && <AdminUsersPanel />}
      {tab === 'models' && <AdminModelControlsPanel />}
      {tab === 'packages' && <AdminPackagesPanel />}
      {tab === 'announcements' && <AdminAnnouncementsPanel />}
      {SUPPORT_TICKET_ENABLED && tab === 'tickets' && <AdminSupportTicketsPanel />}
      {tab === 'monitor' && <AdminMonitoringPanel />}
    </div>
  )
}

function AdminUsersPanel() {
  const [q, setQ] = useState('')
  const [plan, setPlan] = useState('')
  const [frozen, setFrozen] = useState<'all' | 'true' | 'false'>('all')
  const [users, setUsers] = useState<AdminUserItem[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await adminListUsers({ q, plan: plan || undefined, frozen: frozen === 'all' ? undefined : frozen, limit: 100 })
      setUsers(r.users || [])
    } catch (e: any) {
      setErr(e?.message || '加载用户失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setPlanForUser = async (userId: string, planId: string) => {
    setNotice('')
    try {
      await adminUpdateUser({ userId, action: 'setPlan', planId })
      setNotice('套餐更新成功')
      await load()
    } catch (e: any) {
      setErr(e?.message || '更新套餐失败')
    }
  }

  const toggleFreeze = async (userId: string, isFrozen: boolean) => {
    setNotice('')
    try {
      await adminUpdateUser({ userId, action: 'setFrozen', isFrozen, freezeReason: isFrozen ? '运营后台手动冻结' : '' })
      setNotice(isFrozen ? '用户已冻结' : '用户已解冻')
      await load()
    } catch (e: any) {
      setErr(e?.message || '更新冻结状态失败')
    }
  }

  const planLabel: Record<string, string> = {
    trial: '试用版',
    basic: '基础版',
    pro: '专业版',
    enterprise: '旗舰版',
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">用户管理</h3>
          <p className="text-sm text-gray-500 mt-1">查询用户、改套餐、冻结/解冻账号</p>
        </div>
        <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">{busy ? '刷新中...' : '刷新'}</button>
      </div>
      <div className="grid md:grid-cols-4 gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索邮箱/昵称" className="px-3 py-2 border rounded-lg" />
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="px-3 py-2 border rounded-lg">
          <option value="">全部套餐</option>
          <option value="trial">{planLabel.trial}</option>
          <option value="basic">{planLabel.basic}</option>
          <option value="pro">{planLabel.pro}</option>
          <option value="enterprise">{planLabel.enterprise}</option>
        </select>
        <select value={frozen} onChange={(e) => setFrozen(e.target.value as any)} className="px-3 py-2 border rounded-lg">
          <option value="all">全部状态</option>
          <option value="false">未冻结</option>
          <option value="true">已冻结</option>
        </select>
        <button onClick={() => void load()} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">查询</button>
      </div>
      {!!err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
      {!!notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{notice}</div>}
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02] shadow-[0_18px_50px_rgba(2,6,23,0.32)]">
        <table className="min-w-full text-sm">
          <thead className="bg-white/[0.03] text-white/60">
            <tr>
              <th className="text-left px-4 py-3 font-medium">用户</th>
              <th className="text-left px-4 py-3 font-medium">套餐</th>
              <th className="text-left px-4 py-3 font-medium">状态</th>
              <th className="text-left px-4 py-3 font-medium">注册时间</th>
              <th className="text-left px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-white/10 hover:bg-white/[0.03] transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-white/90">{u.display_name || '-'}</div>
                  <div className="text-xs text-white/55">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={String(u.subscription?.plan_id || 'trial')}
                    onChange={(e) => void setPlanForUser(u.id, e.target.value)}
                    className="px-2.5 py-1.5 border border-white/15 bg-white/[0.03] rounded-lg text-white/85"
                  >
                    <option value="trial">{planLabel.trial}</option>
                    <option value="basic">{planLabel.basic}</option>
                    <option value="pro">{planLabel.pro}</option>
                    <option value="enterprise">{planLabel.enterprise}</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  {u.is_frozen ? (
                    <span className="text-xs px-2.5 py-1 rounded-full border border-red-300/25 bg-red-500/15 text-red-200">已冻结</span>
                  ) : (
                    <span className="text-xs px-2.5 py-1 rounded-full border border-emerald-300/25 bg-emerald-500/15 text-emerald-200">正常</span>
                  )}
                </td>
                <td className="px-4 py-3 text-white/65">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => void toggleFreeze(u.id, !u.is_frozen)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                      u.is_frozen
                        ? 'border-emerald-300/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/18'
                        : 'border-red-300/30 bg-red-500/10 text-red-200 hover:bg-red-500/18'
                    }`}
                  >
                    {u.is_frozen ? '解冻' : '冻结'}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-white/45">暂无用户数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AdminModelControlsPanel() {
  const [type, setType] = useState<'video' | 'image' | 'llm'>('video')
  const [controls, setControls] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const allModelIds = useMemo(() => {
    const list = type === 'video' ? VIDEO_MODELS.map((m) => m.id) : type === 'image' ? IMAGE_MODELS.map((m) => m.id) : ['gpt-4o']
    const fromDb = controls.map((c) => String(c.model_id || '')).filter(Boolean)
    return Array.from(new Set([...list, ...fromDb]))
  }, [type, controls])

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await adminListModelControls(type)
      setControls(r.controls || [])
    } catch (e: any) {
      setErr(e?.message || '加载模型开关失败')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  const byId = useMemo(() => {
    const map: Record<string, any> = {}
    for (const c of controls) map[String(c.model_id)] = c
    return map
  }, [controls])

  const save = async (modelId: string, patch: { enabled?: boolean; recommended?: boolean; note?: string }) => {
    setNotice('')
    try {
      const cur = byId[modelId] || {}
      await adminUpdateModelControl({
        modelId,
        type,
        enabled: patch.enabled != null ? patch.enabled : cur.enabled !== false,
        recommended: patch.recommended != null ? patch.recommended : !!cur.recommended,
        note: patch.note != null ? patch.note : cur.note || '',
      })
      setNotice('模型配置已保存')
      await load()
    } catch (e: any) {
      setErr(e?.message || '保存模型配置失败')
    }
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">模型开关</h3>
          <p className="text-sm text-gray-500 mt-1">控制模型可用/禁用与推荐默认</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="video">video</option>
            <option value="image">image</option>
            <option value="llm">llm</option>
          </select>
          <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">{busy ? '刷新中...' : '刷新'}</button>
        </div>
      </div>
      {!!err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
      {!!notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{notice}</div>}
      <div className="space-y-2">
        {allModelIds.map((id) => {
          const item = byId[id] || {}
          const enabled = item.enabled !== false
          const recommended = !!item.recommended
          return (
            <div key={id} className="border rounded-lg p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-sm">{id}</div>
                <div className="text-xs text-gray-500">{item.note || '-'}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => void save(id, { enabled: !enabled })} className={`px-2 py-1 text-xs rounded-lg ${enabled ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {enabled ? '禁用' : '启用'}
                </button>
                <button onClick={() => void save(id, { recommended: !recommended, enabled: true })} className={`px-2 py-1 text-xs rounded-lg ${recommended ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>
                  {recommended ? '取消推荐' : '设为推荐'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AdminPackagesPanel() {
  const [configs, setConfigs] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [savingPlanId, setSavingPlanId] = useState<string>('')
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const FIXED_PLAN_IDS = ['trial', 'basic', 'pro', 'enterprise']

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await adminListPackageConfigs()
      setConfigs(r.configs || [])
    } catch (e: any) {
      setErr(e?.message || '加载套餐配置失败')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const updateOne = async (planId: string, patch: any) => {
    setConfigs((prev) => {
      const idx = prev.findIndex((x) => String(x?.plan_id || '') === String(planId))
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], ...patch }
        return next
      }
      const base = DEFAULT_PACKAGES.find((p) => p.plan_id === planId) || {}
      return [...prev, { ...base, plan_id: planId, ...patch }]
    })
  }

  const saveOne = async (row: any) => {
    setNotice('')
    setErr('')
    setSavingPlanId(String(row.plan_id || ''))
    try {
      const features = String(row.featuresText || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
      await adminUpsertPackageConfig({
        planId: row.plan_id,
        name: row.name,
        priceCents: Number(row.price_cents || 0),
        currency: row.currency || 'CNY',
        dailyQuota: Number(row.daily_quota || 0),
        features,
        modelWhitelist: Array.isArray(row.model_whitelist) ? row.model_whitelist : [],
        enabled: row.enabled !== false,
        displayOrder: Number(row.display_order || 100),
        applyMode: String(row.apply_mode || 'new_only'),
        graceDays: Number(row.grace_days || 0),
        effectiveFrom: row.effective_from || null,
      })
      setNotice(`套餐 ${row.plan_id} 已保存`)
      await load()
    } catch (e: any) {
      setErr(e?.message || '保存套餐失败')
    } finally {
      setSavingPlanId('')
      // 无论保存成功与否，都退出编辑态，避免出现“保存后仍可编辑/需点取消”的体验问题
      setEditingPlanId(null)
    }
  }

  const rows = FIXED_PLAN_IDS.map((pid) => {
    const base = DEFAULT_PACKAGES.find((p) => p.plan_id === pid) || ({} as any)
    const r = configs.find((x) => String(x?.plan_id || '') === String(pid)) || {}
    const merged = { ...base, ...r, plan_id: pid }
    const feats = Array.isArray(merged.features) ? merged.features : []
    // textarea 的输入值会写到 merged.featuresText（非 features 数组），这里要优先取用户编辑内容。
    const featuresText =
      typeof merged.featuresText === 'string' ? merged.featuresText : Array.isArray(merged.features) ? merged.features.join('\n') : ''
    return {
      ...merged,
      featuresText,
      apply_mode: merged.apply_mode || 'new_only',
      grace_days: Number(merged.grace_days ?? 0),
      display_order: Number(merged.display_order ?? 100),
      effective_from: merged.effective_from || '',
    }
  })

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">套餐管理（配置化）</h3>
          <p className="text-sm text-gray-500 mt-1">可配置价格、日额度、特性文案</p>
        </div>
        <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">{busy ? '刷新中...' : '刷新'}</button>
      </div>
      {!!err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
      {!!notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{notice}</div>}
      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((r, idx) => {
          const isEditing = editingPlanId === r.plan_id
          return (
          <div key={r.plan_id} className="border rounded-xl p-5 space-y-3 bg-white">
            <div className="font-semibold flex items-center justify-between gap-3">
              <span>{r.plan_id}</span>
              <span className={`text-xs px-2 py-1 rounded-full ${r.enabled === false ? 'bg-gray-100 text-gray-600' : 'bg-emerald-100 text-emerald-700'}`}>
                {r.enabled === false ? '已禁用' : '可用'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">套餐名称（展示给用户）</div>
                <input
                  value={r.name || ''}
                  disabled={!isEditing}
                  onChange={(e) => void updateOne(r.plan_id, { name: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="套餐名称"
                />
              </div>
              <div>
                {!isEditing ? (
                  <button onClick={() => setEditingPlanId(r.plan_id)} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">
                    编辑
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      disabled={savingPlanId === r.plan_id}
                      onClick={() => void saveOne(r)}
                      className={`px-3 py-2 rounded-lg text-white text-sm ${savingPlanId === r.plan_id ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600'}`}
                    >
                      {savingPlanId === r.plan_id ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingPlanId(null)
                        setSavingPlanId('')
                        void load()
                      }}
                      className="px-3 py-2 rounded-lg border text-gray-700 text-sm bg-white"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-gray-500 mb-1">价格（分）</div>
                <input
                  value={r.price_cents ?? 0}
                  disabled={!isEditing}
                  onChange={(e) => void updateOne(r.plan_id, { price_cents: Number(e.target.value || 0) })}
                  className={`px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="价格(分)"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">日额度</div>
                <input
                  value={r.daily_quota ?? 0}
                  disabled={!isEditing}
                  onChange={(e) => void updateOne(r.plan_id, { daily_quota: Number(e.target.value || 0) })}
                  className={`px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="日额度"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-gray-500 mb-1">排序权重（越小越靠前）</div>
                <input
                  value={r.display_order ?? 100}
                  disabled={!isEditing}
                  onChange={(e) => void updateOne(r.plan_id, { display_order: Number(e.target.value || 100) })}
                  className={`px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="排序权重"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">老用户宽限天数</div>
                <input
                  value={r.grace_days ?? 0}
                  disabled={!isEditing}
                  onChange={(e) => void updateOne(r.plan_id, { grace_days: Number(e.target.value || 0) })}
                  className={`px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="老用户宽限天数"
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">生效范围</div>
              <select
                value={r.apply_mode || 'new_only'}
                disabled={!isEditing}
                onChange={(e) => void updateOne(r.plan_id, { apply_mode: e.target.value })}
                className={`w-full px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
              >
                <option value="new_only">仅新用户生效（默认）</option>
                <option value="all_users">新老用户都生效</option>
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">生效时间（ISO，可空；空=立刻）</div>
              <input
                value={r.effective_from || ''}
                disabled={!isEditing}
                onChange={(e) => void updateOne(r.plan_id, { effective_from: e.target.value })}
                className={`w-full px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                placeholder="生效时间(ISO，可空)"
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">特性文案（每行一个，展示给用户）</div>
              <textarea
                value={r.featuresText || ''}
                disabled={!isEditing}
                onChange={(e) => void updateOne(r.plan_id, { featuresText: e.target.value })}
                rows={4}
                className={`w-full px-3 py-2 border rounded-lg ${!isEditing ? 'bg-gray-50 text-gray-500' : ''}`}
                placeholder="每行一个特性"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={r.enabled !== false}
                disabled={!isEditing}
                onChange={(e) => void updateOne(r.plan_id, { enabled: e.target.checked })}
              />
              启用
            </label>
          </div>
          )
        })}
      </div>
    </div>
  )
}

function AdminAnnouncementsPanel() {
  const [list, setList] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<any>({ title: '', content: '', type: 'system', target: 'all', status: 'draft' })

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await adminListAnnouncements()
      setList(r.announcements || [])
    } catch (e: any) {
      setErr(e?.message || '加载公告失败')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const submit = async () => {
    setNotice('')
    try {
      await adminUpsertAnnouncement(form)
      setNotice('公告已保存')
      setForm({ title: '', content: '', type: 'system', target: 'all', status: 'draft' })
      await load()
    } catch (e: any) {
      setErr(e?.message || '保存公告失败')
    }
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">公告发布（定向触达）</h3>
          <p className="text-sm text-gray-500 mt-1">按目标用户发布草稿/上线/下线公告</p>
        </div>
        <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">{busy ? '刷新中...' : '刷新'}</button>
      </div>
      {!!err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
      {!!notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{notice}</div>}
      <div className="border rounded-xl p-4 space-y-3">
        <input value={form.title} onChange={(e) => setForm((x: any) => ({ ...x, title: e.target.value }))} className="w-full px-3 py-2 border rounded-lg" placeholder="公告标题" />
        <textarea value={form.content} onChange={(e) => setForm((x: any) => ({ ...x, content: e.target.value }))} rows={4} className="w-full px-3 py-2 border rounded-lg" placeholder="公告内容" />
        <div className="grid grid-cols-3 gap-2">
          <select value={form.type} onChange={(e) => setForm((x: any) => ({ ...x, type: e.target.value }))} className="px-3 py-2 border rounded-lg">
            <option value="system">系统通知</option>
            <option value="activity">活动公告</option>
            <option value="release">版本发布</option>
          </select>
          <select value={form.target} onChange={(e) => setForm((x: any) => ({ ...x, target: e.target.value }))} className="px-3 py-2 border rounded-lg">
            <option value="all">全部用户</option>
            <option value="trial">试用版用户</option>
            <option value="basic">基础版用户</option>
            <option value="pro">专业版用户</option>
            <option value="enterprise">旗舰版用户</option>
          </select>
          <select value={form.status} onChange={(e) => setForm((x: any) => ({ ...x, status: e.target.value }))} className="px-3 py-2 border rounded-lg">
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="offline">已下线</option>
          </select>
        </div>
        <button onClick={() => void submit()} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">保存公告</button>
      </div>
      <div className="space-y-2">
        {list.map((a) => (
          <div key={a.id} className="border rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">{a.title}</div>
              <div className="text-xs text-gray-500">
                {{ draft: '草稿', published: '已发布', offline: '已下线' }[String(a.status)] || a.status} ·{' '}
                {{ all: '全部用户', trial: '试用版', basic: '基础版', pro: '专业版', enterprise: '旗舰版' }[String(a.target)] || a.target}
              </div>
            </div>
            <div className="text-sm text-gray-600 mt-1 line-clamp-2">{a.content}</div>
            <div className="mt-2">
              <button onClick={() => setForm({ id: a.id, title: a.title, content: a.content, type: a.type, target: a.target, status: a.status || 'draft' })} className="px-2 py-1 rounded border text-xs">
                编辑
              </button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="text-sm text-gray-400 py-4 text-center">暂无公告</div>}
      </div>
    </div>
  )
}

function AdminSupportTicketsPanel() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'open' | 'in_progress' | 'resolved' | 'closed'>('all')
  const [tickets, setTickets] = useState<AdminSupportTicketItem[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<AdminSupportTicketItem | null>(null)
  const [updating, setUpdating] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')

  const statusLabel: Record<string, string> = { open: '待处理', in_progress: '处理中', resolved: '已解决', closed: '已关闭' }
  const priorityLabel: Record<string, string> = { low: '低', normal: '中', high: '高', urgent: '紧急' }
  const kindLabel: Record<string, string> = { bug: 'Bug/报错', suggestion: '功能建议', other: '其他' }

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await adminListSupportTickets({ q, status, limit: 100 })
      setTickets(r.tickets || [])
    } catch (e: any) {
      setErr(e?.message || '加载工单失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateTicket = async (params: { status?: 'open' | 'in_progress' | 'resolved' | 'closed'; priority?: 'low' | 'normal' | 'high' | 'urgent' }) => {
    if (!selected) return
    setUpdating(true)
    setErr('')
    setNotice('')
    try {
      await adminUpdateSupportTicket({ ticketId: selected.id, ...params, adminNote: noteDraft })
      setNotice('工单更新成功')
      await load()
      const latest = tickets.find((x) => x.id === selected.id)
      if (latest) setSelected(latest)
    } catch (e: any) {
      setErr(e?.message || '更新工单失败')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">工单管理</h3>
          <p className="text-sm text-gray-500 mt-1">查看用户工单、更新状态与备注</p>
        </div>
        <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">{busy ? '刷新中...' : '刷新'}</button>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索工单号/邮箱/主题" className="px-3 py-2 border rounded-lg" />
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="px-3 py-2 border rounded-lg">
          <option value="all">全部状态</option>
          <option value="open">待处理</option>
          <option value="in_progress">处理中</option>
          <option value="resolved">已解决</option>
          <option value="closed">已关闭</option>
        </select>
        <button onClick={() => void load()} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">查询</button>
      </div>
      {!!err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{err}</div>}
      {!!notice && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{notice}</div>}

      <div className="overflow-x-auto border rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-3 py-2">工单号</th>
              <th className="text-left px-3 py-2">类型</th>
              <th className="text-left px-3 py-2">用户</th>
              <th className="text-left px-3 py-2">状态</th>
              <th className="text-left px-3 py-2">优先级</th>
              <th className="text-left px-3 py-2">提交时间</th>
              <th className="text-left px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-2 font-medium">{t.ticket_no}</td>
                <td className="px-3 py-2">{kindLabel[t.kind] || t.kind}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{t.email || t.user_id}</td>
                <td className="px-3 py-2">{statusLabel[t.status] || t.status}</td>
                <td className="px-3 py-2">{priorityLabel[t.priority] || t.priority}</td>
                <td className="px-3 py-2 text-gray-600">{new Date(t.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => {
                      setSelected(t)
                      setNoteDraft(String(t.admin_note || ''))
                    }}
                    className="px-2.5 py-1 rounded border text-xs"
                  >
                    处理
                  </button>
                </td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-400">暂无工单数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="rounded-xl border p-4 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">工单详情：{selected.ticket_no}</div>
            <button onClick={() => setSelected(null)} className="px-2 py-1 rounded border text-xs">关闭</button>
          </div>
          <div className="text-sm text-gray-700">主题：{selected.subject}</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">描述：{selected.content}</div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">状态</label>
              <select
                value={selected.status}
                onChange={async (e) => {
                  const next = e.target.value as 'open' | 'in_progress' | 'resolved' | 'closed'
                  setSelected((prev) => (prev ? { ...prev, status: next } : prev))
                  await updateTicket({ status: next })
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                disabled={updating}
              >
                <option value="open">待处理</option>
                <option value="in_progress">处理中</option>
                <option value="resolved">已解决</option>
                <option value="closed">已关闭</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">优先级</label>
              <select
                value={selected.priority}
                onChange={async (e) => {
                  const next = e.target.value as 'low' | 'normal' | 'high' | 'urgent'
                  setSelected((prev) => (prev ? { ...prev, priority: next } : prev))
                  await updateTicket({ priority: next })
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                disabled={updating}
              >
                <option value="low">低</option>
                <option value="normal">中</option>
                <option value="high">高</option>
                <option value="urgent">紧急</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">管理员备注</label>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder="输入处理说明..."
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => void updateTicket({})}
              disabled={updating}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-50"
            >
              {updating ? '保存中...' : '保存备注'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AdminMonitoringPanel() {
  const accessToken = localStorage.getItem('tikgen.accessToken') || ''
  const [stats, setStats] = useState<MonitoringStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scope, setScope] = useState<'system' | 'self'>('system')

  const load = async () => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const s = await getMonitoringStatsAPI(accessToken, scope)
      setStats(s)
    } catch (e: any) {
      setError(e?.message || '获取监控统计失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">系统稳定性监控</h2>
            <p className="text-sm text-gray-500 mt-1">近24小时任务与支付分布</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={scope} onChange={(e) => setScope(e.target.value as any)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="system">全系统</option>
              <option value="self">仅我自己</option>
            </select>
            <button onClick={() => void load()} className="px-3 py-2 border rounded-lg text-sm">
              {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>

        {!!error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

        {stats ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="rounded-lg border p-3 bg-gray-50"><div className="text-xs text-gray-500">任务总数</div><div className="text-xl font-bold">{stats.total}</div></div>
              <div className="rounded-lg border p-3 bg-red-50"><div className="text-xs text-red-500">失败率</div><div className="text-xl font-bold text-red-600">{(stats.failedRate * 100).toFixed(1)}%</div></div>
              <div className="rounded-lg border p-3 bg-emerald-50"><div className="text-xs text-emerald-600">成功</div><div className="text-xl font-bold text-emerald-700">{stats.byStatus.succeeded}</div></div>
              <div className="rounded-lg border p-3 bg-amber-50"><div className="text-xs text-amber-600">处理中</div><div className="text-xl font-bold text-amber-700">{stats.byStatus.processing + stats.byStatus.submitted}</div></div>
              <div className="rounded-lg border p-3 bg-white"><div className="text-xs text-gray-500">图片任务</div><div className="text-xl font-bold">{stats.byType.image}</div></div>
              <div className="rounded-lg border p-3 bg-white"><div className="text-xs text-gray-500">视频任务</div><div className="text-xl font-bold">{stats.byType.video}</div></div>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-4">
              <div className="rounded-lg border p-4">
                <div className="font-medium mb-2">错误分布 TOP</div>
                {stats.errorTop.length ? (
                  <div className="space-y-2">
                    {stats.errorTop.map((x, i) => (
                      <div key={i} className="text-sm flex items-center justify-between gap-2">
                        <span className="truncate text-gray-700">{x.message}</span>
                        <span className="text-red-600 font-semibold">{x.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">暂无错误</div>
                )}
              </div>
              <div className="rounded-lg border p-4">
                <div className="font-medium mb-2">支付状态分布（24h）</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded bg-gray-50 px-3 py-2">created：<span className="font-semibold">{stats.orders24h.byStatus.created}</span></div>
                  <div className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">paid：<span className="font-semibold">{stats.orders24h.byStatus.paid}</span></div>
                  <div className="rounded bg-red-50 px-3 py-2 text-red-700">failed：<span className="font-semibold">{stats.orders24h.byStatus.failed}</span></div>
                  <div className="rounded bg-gray-50 px-3 py-2">refunded：<span className="font-semibold">{stats.orders24h.byStatus.refunded}</span></div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="h-40 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">监控统计加载中...</div>
        )}
      </div>
    </div>
  )
}

/** XorPay：支付宝为 info.qr 链接、微信常为 code_url；多为支付串而非图片 URL，需生成可扫的二维码图 */
function xorpayQrImageSrc(qrPayload: string | undefined): string | null {
  const s = String(qrPayload || '').trim()
  if (!s) return null
  if (s.startsWith('data:image/')) return s
  if (/^https?:\/\//i.test(s) && /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(s)) return s
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(s)}`
}

function Packages({ user, onRefreshUser, packages }: { user: any; onRefreshUser: () => Promise<void>; packages: PackageConfigItem[] }) {
  const [busyPlan, setBusyPlan] = useState('')
  const [payError, setPayError] = useState('')
  const [checkingPaid, setCheckingPaid] = useState(false)
  const [payInfo, setPayInfo] = useState<{ orderId: string; qrcode?: string; payUrl?: string; status?: string; planId?: string } | null>(null)
  const accessToken = localStorage.getItem('tikgen.accessToken') || ''

  useEffect(() => {
    if (!payInfo?.orderId || payInfo.status === 'paid') return
    let timer: any = null
    let stopped = false
    let tries = 0
    const run = async () => {
      if (stopped || !accessToken || !payInfo?.orderId) return
      tries += 1
      try {
        const r = await getOrderStatus(payInfo.orderId, accessToken)
        const st = String(r.order?.status || '').toLowerCase()
        if (st === 'paid') {
          setPayInfo((prev) => (prev ? { ...prev, status: 'paid' } : prev))
          await onRefreshUser()
          return
        }
      } catch {
        // ignore transient polling failures
      }
      if (tries < 60) timer = setTimeout(run, 3000)
    }
    timer = setTimeout(run, 2500)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [payInfo?.orderId, payInfo?.status, accessToken, onRefreshUser])

  const checkPaidNow = async () => {
    if (!payInfo?.orderId || !accessToken) return
    setCheckingPaid(true)
    setPayError('')
    try {
      const r = await getOrderStatus(payInfo.orderId, accessToken)
      const st = String(r.order?.status || '').toLowerCase()
      if (st === 'paid') {
        setPayInfo((prev) => (prev ? { ...prev, status: 'paid' } : prev))
        await onRefreshUser()
      } else {
        setPayError('订单尚未支付完成，请完成付款后再检查。')
      }
    } catch (e: any) {
      setPayError(e?.message || '检查支付状态失败')
    } finally {
      setCheckingPaid(false)
    }
  }

  const currentPlanName = useMemo(() => {
    const planId = String(user?.package || 'trial')
    const byConfig = (packages || []).find((p) => String(p.plan_id) === planId)?.name
    if (byConfig) return byConfig
    return { trial: '试用版', basic: '基础版', pro: '专业版', enterprise: '旗舰版' }[planId as 'trial' | 'basic' | 'pro' | 'enterprise'] || planId
  }, [packages, user?.package])

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold mb-8 text-center">选择您的套餐</h2>
      <div className="mb-6 bg-white rounded-2xl p-4 shadow border flex items-center justify-between">
        <div className="text-sm text-gray-600">
          当前套餐：
          <span className="font-semibold text-gray-900 ml-1">{currentPlanName}</span>
          {user?.packageExpiresAt ? <span className="ml-3">到期：{user.packageExpiresAt}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">支付方式</span>
          <span className="px-3 py-2 rounded-lg text-sm bg-gray-50 border text-gray-800 font-medium">支付宝</span>
        </div>
      </div>
      {payInfo && (
        <div className="mb-8 bg-white rounded-2xl p-6 shadow-lg border">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-lg">请扫码支付</div>
              <div className="text-sm text-gray-500 mt-1">订单号：{payInfo.orderId}</div>
              <div className="text-sm mt-1">
                状态：
                <span className={`ml-1 font-medium ${payInfo.status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {payInfo.status === 'paid' ? '已支付，权益已更新' : '待支付'}
                </span>
              </div>
            </div>
            <button onClick={() => setPayInfo(null)} className="px-3 py-1.5 rounded-lg border text-sm">关闭</button>
          </div>
          <div className="mt-5 grid md:grid-cols-2 gap-6 items-center">
            <div className="flex flex-col items-center justify-center gap-2">
              {(() => {
                const src = xorpayQrImageSrc(payInfo.qrcode || payInfo.payUrl)
                return src ? (
                  <img src={src} alt="支付二维码" className="w-56 h-56 rounded-xl border bg-white object-contain" />
                ) : (
                  <div className="w-56 h-56 rounded-xl border bg-gray-50 flex flex-col items-center justify-center gap-2 px-3 text-center text-gray-400 text-sm">
                    <span>未拿到支付串</span>
                    <span className="text-xs text-gray-400">请用下方「打开支付页面」或重试下单</span>
                  </div>
                )
              })()}
            </div>
            <div>
              <div className="text-sm text-gray-600">
                - 当前仅支持支付宝（由 XorPay 收单）<br />
                - 支付完成后，返回页面刷新权益<br />
                - 若二维码不可扫，可点击下方链接跳转支付
              </div>
              {payInfo.payUrl && (
                <a href={payInfo.payUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold">
                  打开支付页面
                </a>
              )}
              <button
                onClick={checkPaidNow}
                disabled={checkingPaid}
                className="mt-3 ml-0 md:ml-3 px-4 py-2 rounded-xl border font-medium disabled:opacity-50"
              >
                {checkingPaid ? '检查中...' : '我已支付，检查到账'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {packages
          .filter((x) => x.enabled !== false)
          .sort((a, b) => {
            const pa = Number(a.price_cents || 0)
            const pb = Number(b.price_cents || 0)
            if (pa !== pb) return pa - pb
            return Number(a.display_order || 100) - Number(b.display_order || 100)
          })
          .map((pkg) => {
            const isCurrent = String(user?.package || '') === String(pkg.plan_id)
            const priceYuan = Number(pkg.price_cents || 0) / 100
            const displayPrice = priceYuan <= 0 ? '¥0' : `¥${priceYuan}/月`
            const features = Array.isArray(pkg.features) ? pkg.features : []
            return (
          <div
            key={pkg.plan_id}
            className={`bg-white rounded-2xl p-6 shadow-lg border-2 ${isCurrent ? 'border-purple-500' : 'border-transparent'}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">{pkg.name}</h3>
              {isCurrent && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">当前套餐</span>}
            </div>
            <div className="mt-4">
              <div className="text-3xl font-extrabold">{displayPrice}</div>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-gray-600">
              {features.map((f) => (
                <li key={f} className="flex items-center">
                  <Check className="w-4 h-4 text-green-500 mr-2" />
                  <span>{f}</span>
                </li>
              ))}
              {pkg.apply_mode && (
                <li className="text-xs text-gray-500 mt-2">
                  生效规则：{pkg.apply_mode === 'all_users' ? `新老用户都生效${pkg.grace_days ? `（宽限${pkg.grace_days}天）` : ''}` : '仅新用户生效'}
                </li>
              )}
            </ul>
            <button
              className={`mt-6 w-full py-3 rounded-xl font-bold ${
                priceYuan <= 0 || isCurrent ? 'bg-gray-100 text-gray-700' : 'bg-gradient-to-r from-pink-500 to-purple-500 text-white'
              }`}
              disabled={busyPlan === pkg.plan_id}
              onClick={async () => {
                setPayError('')
                if (priceYuan <= 0 || isCurrent) return
                if (!accessToken) return alert('请先登录')
                setBusyPlan(pkg.plan_id)
                try {
                  const r = await createOrder({ planId: pkg.plan_id, payType: 'alipay' }, accessToken)
                  Sentry.captureMessage('payment_order_create_success', { level: 'info', extra: { planId: pkg.plan_id, payType: 'alipay' } })
                  setPayInfo({ orderId: r.orderId, qrcode: r.qrcode, payUrl: r.payUrl, status: 'created', planId: pkg.plan_id })
                } catch (e: any) {
                  Sentry.captureException(e, { extra: { scene: 'create_order', planId: pkg.plan_id, payType: 'alipay' } })
                  setPayError(e?.message || '下单失败')
                } finally {
                  setBusyPlan('')
                }
              }}
            >
              {isCurrent ? '当前套餐' : priceYuan <= 0 ? '免费套餐' : busyPlan === pkg.plan_id ? '下单中...' : '立即开通'}
            </button>
          </div>
        )})}
      </div>
      {!!payError && (
        <div className="mt-6 p-3 rounded-xl bg-red-50 text-red-600 text-sm whitespace-pre-wrap break-words leading-relaxed">{payError}</div>
      )}
    </div>
  )
}

export default App