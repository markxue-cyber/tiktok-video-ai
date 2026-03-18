import { useEffect, useMemo, useRef, useState } from 'react'
import { Video, Image, Zap, LogOut, User, Play, Download, RefreshCw, Sparkles, Menu, X, Upload, Scissors, Eraser, Wand2, Folder, ChevronRight, Check, Crown, WandSparkles, ShieldCheck, Library, Settings2 } from 'lucide-react'
import { checkVideoStatus, generateVideoAPI } from './api/video'
import { beautifyScript, generateImagePrompt, generateVideoScripts, parseProductInfo, type ProductInfo } from './api/ai'

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
const IMAGE_MODELS = [
  { id: 'seedream', name: 'Seedream 4.5' },
  { id: 'midjourney', name: 'Midjourney' },
  { id: 'flux', name: 'Flux' },
]
const PACKAGES = [{ id: 'trial', name: '试用版', price: '¥0', features: ['每天3次', '基础功能'] }, { id: 'basic', name: '基础版', price: '¥69/月', features: ['每天20次', '全部模型'] }, { id: 'pro', name: '专业版', price: '¥249/月', features: ['无限次数', '4K输出'] }, { id: 'enterprise', name: '旗舰版', price: '¥1199/月', features: ['企业级', 'API接入'] }]

function App() {
  const [page, setPage] = useState<'landing' | 'auth' | 'home'>('landing')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [user, setUser] = useState<{ name: string; credits: number; package: string; packageExpiresAt: string } | null>(null)
  const [mainNav, setMainNav] = useState<'create' | 'tools' | 'assets' | 'benefits'>('create')
  const [createNav, setCreateNav] = useState<'video' | 'image'>('video')
  const [toolNav, setToolNav] = useState<'subtitle' | 'watermark' | 'upscale'>('subtitle')

  const handleLogin = () =>
    setUser({
      name: 'haoxue',
      credits: 800,
      package: 'trial',
      packageExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    })

  const currentPackage = useMemo(() => PACKAGES.find((p) => p.id === user?.package), [user?.package])

  if (page === 'landing')
    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="fixed top-0 left-0 right-0 z-50 bg-black/20 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3"><div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center"><Video className="w-5 h-5 text-white" /></div><span className="text-xl font-bold text-white">TikGen AI</span></div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                setAuthMode('login')
                setPage('auth')
              }}
              className="px-4 py-2 text-white/80 hover:text-white"
            >
              登录
            </button>
            <button
              onClick={() => {
                setAuthMode('register')
                setPage('auth')
              }}
              className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-lg font-medium"
            >
              注册
            </button>
          </div>
        </div>
      </div>
      <div className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold text-white mb-8">AI驱动的内容创作<br/><span className="bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 bg-clip-text text-transparent">释放无限创意</span></h1>
          <p className="text-xl text-white/70 mb-12">集成OpenAI Sora、Google Veo、字节Seedance等顶尖AI模型</p>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => {
                setAuthMode('register')
                setPage('auth')
              }}
              className="px-8 py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl font-bold text-lg"
            >
              立即开始创作
            </button>
            <button className="px-8 py-4 bg-white/10 text-white rounded-xl font-bold text-lg border border-white/20 hover:bg-white/15">
              观看演示
            </button>
          </div>
        </div>
      </div>
      <div className="py-20 px-6 bg-black/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-16">核心功能</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10"><div className="w-14 h-14 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center mb-6"><Video className="w-7 h-7 text-white" /></div><h3 className="text-xl font-bold text-white mb-4">AI视频生成</h3><p className="text-white/60">输入文案自动生成视频</p></div>
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10"><div className="w-14 h-14 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center mb-6"><Image className="w-7 h-7 text-white" /></div><h3 className="text-xl font-bold text-white mb-4">AI图片生成</h3><p className="text-white/60">文字描述生成精美图片</p></div>
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10"><div className="w-14 h-14 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-xl flex items-center justify-center mb-6"><Sparkles className="w-7 h-7 text-white" /></div><h3 className="text-xl font-bold text-white mb-4">智能提示词</h3><p className="text-white/60">GPT-4o 自动解析商品并生成脚本/提示词</p></div>
          </div>
          <div className="grid md:grid-cols-3 gap-6 mt-10">
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 text-white">
                <ShieldCheck className="w-5 h-5 text-emerald-300" />
                <span className="font-semibold">企业级稳定</span>
              </div>
              <p className="text-white/60 mt-2 text-sm">任务式生成 + 进度轮询，支持异步产出。</p>
            </div>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 text-white">
                <WandSparkles className="w-5 h-5 text-pink-300" />
                <span className="font-semibold">一键工作流</span>
              </div>
              <p className="text-white/60 mt-2 text-sm">参考图 → 商品解析 → 脚本 → 提示词 → 生成。</p>
            </div>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 text-white">
                <Library className="w-5 h-5 text-indigo-300" />
                <span className="font-semibold">资产沉淀</span>
              </div>
              <p className="text-white/60 mt-2 text-sm">用户上传与AI生成素材自动归档到资产库。</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (page === 'auth')
    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <button onClick={() => setPage('landing')} className="text-white/60 mb-8 flex items-center hover:text-white">
          <ChevronRight className="w-5 h-5 rotate-180 mr-1" /> 返回
        </button>
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 border border-white/20">
          <h2 className="text-3xl font-bold text-white text-center mb-8">{authMode === 'login' ? '登录账号' : '注册账号'}</h2>
          <div className="space-y-4">
            <input type="email" placeholder="邮箱地址" className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40" />
            <input type="password" placeholder="密码" className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40" />
            {authMode === 'register' && (
              <input type="password" placeholder="确认密码" className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 outline-none focus:border-white/40" />
            )}
            <button
              onClick={() => {
                handleLogin()
                setPage('home')
              }}
              className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl"
            >
              {authMode === 'login' ? '登录' : '注册并登录'}
            </button>
            <div className="text-center text-white/60 text-sm">
              {authMode === 'login' ? (
                <button
                  className="hover:text-white"
                  onClick={() => setAuthMode('register')}
                >
                  没有账号？去注册
                </button>
              ) : (
                <button
                  className="hover:text-white"
                  onClick={() => setAuthMode('login')}
                >
                  已有账号？去登录
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-64 bg-white shadow-xl fixed h-full z-30">
        <div className="p-4 border-b"><div className="flex items-center space-x-3"><div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center"><Video className="w-5 h-5 text-white" /></div><span className="text-xl font-bold bg-gradient-to-r from-pink-600 to-purple-600 bg-clip-text text-transparent">TikGen AI</span></div></div>
        <nav className="p-4 space-y-2">
          <NavPrimary icon={<Wand2 className="w-5 h-5" />} label="创作" active={mainNav === 'create'} onClick={() => setMainNav('create')} />
          {mainNav === 'create' && (
            <div className="pl-3 space-y-1">
              <NavSecondary icon={<Video className="w-4 h-4" />} label="视频生成" active={createNav === 'video'} onClick={() => setCreateNav('video')} />
              <NavSecondary icon={<Image className="w-4 h-4" />} label="图片生成" active={createNav === 'image'} onClick={() => setCreateNav('image')} />
            </div>
          )}

          <NavPrimary icon={<Settings2 className="w-5 h-5" />} label="工具" active={mainNav === 'tools'} onClick={() => setMainNav('tools')} />
          {mainNav === 'tools' && (
            <div className="pl-3 space-y-1">
              <NavSecondary icon={<Scissors className="w-4 h-4" />} label="去字幕" active={toolNav === 'subtitle'} onClick={() => setToolNav('subtitle')} />
              <NavSecondary icon={<Eraser className="w-4 h-4" />} label="去水印" active={toolNav === 'watermark'} onClick={() => setToolNav('watermark')} />
              <NavSecondary icon={<WandSparkles className="w-4 h-4" />} label="画质提升" active={toolNav === 'upscale'} onClick={() => setToolNav('upscale')} />
            </div>
          )}

          <NavPrimary icon={<Folder className="w-5 h-5" />} label="资产库" active={mainNav === 'assets'} onClick={() => setMainNav('assets')} />
          <NavPrimary icon={<Crown className="w-5 h-5" />} label="个人权益" active={mainNav === 'benefits'} onClick={() => setMainNav('benefits')} />
        </nav>
      </aside>
      <main className="flex-1 ml-64">
        <header className="bg-white shadow-sm sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button className="p-2 hover:bg-gray-100 rounded-lg"><Menu className="w-5 h-5" /></button>
              <h1 className="text-xl font-bold">
                {mainNav === 'create' && createNav === 'video' && '视频生成'}
                {mainNav === 'create' && createNav === 'image' && '图片生成'}
                {mainNav === 'tools' && (toolNav === 'subtitle' ? '去字幕' : toolNav === 'watermark' ? '去水印' : '画质提升')}
                {mainNav === 'assets' && '资产库'}
                {mainNav === 'benefits' && '个人权益'}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 bg-gradient-to-r from-pink-50 to-purple-50 px-4 py-2 rounded-full"><Zap className="w-5 h-5 text-pink-500" /><span className="font-bold text-pink-600">{user?.credits}</span><span className="text-sm text-pink-500">积分</span></div>
              <div className="flex items-center space-x-2 px-3 py-1.5 bg-amber-50 rounded-full">
                <Crown className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium text-amber-700">{currentPackage?.name}</span>
                <span className="text-xs text-amber-600/80">至 {user?.packageExpiresAt}</span>
              </div>
              <div className="flex items-center space-x-2"><div className="w-8 h-8 bg-gradient-to-r from-pink-500 to-purple-500 rounded-full flex items-center justify-center"><User className="w-4 h-4 text-white" /></div><span className="text-sm font-medium">{user?.name}</span></div>
              <button
                onClick={() => {
                  setUser(null)
                  setPage('landing')
                }}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>
        <div className="p-6">
          {mainNav === 'create' && createNav === 'video' && <VideoGenerator />}
          {mainNav === 'create' && createNav === 'image' && <ImageGenerator />}
          {mainNav === 'assets' && <Assets />}
          {mainNav === 'benefits' && <Packages />}
          {mainNav === 'tools' && <div className="text-center py-20 text-gray-500">工具功能下一版推出</div>}
        </div>
      </main>
    </div>
  )
}

function NavPrimary({ icon, label, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${
        active ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  )
}

function NavSecondary({ icon, label, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center space-x-2 px-4 py-2 rounded-lg transition-all text-sm ${
        active ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function VideoGenerator() {
  const [refImagePreviewUrl, setRefImagePreviewUrl] = useState('')
  const [refImageDataUrl, setRefImageDataUrl] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('sora-2')
  const [size, setSize] = useState<VideoAspect>('9:16')
  const [resolution, setResolution] = useState<VideoRes>('720p')
  const [durationSec, setDurationSec] = useState<VideoDur>(10)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedVideo, setGeneratedVideo] = useState('')
  const [taskId, setTaskId] = useState('')
  const [progress, setProgress] = useState('0%')
  const [statusText, setStatusText] = useState('')
  const [errorText, setErrorText] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalStep, setModalStep] = useState(1)
  const [productInfo, setProductInfo] = useState<ProductInfo>({ name: '', category: '', sellingPoints: '', targetAudience: '', language: '简体中文' })
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
  const stopPollingRef = useRef(false)

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
      stopPollingRef.current = true
    }
  }, [])

  const handlePromptGen = async () => {
    if (!refImageDataUrl) { alert('请先上传参考图'); return }
    setShowModal(true)
    setModalStep(1)
    setAiError('')
    setIsAiBusy(true)
    try {
      const parsed = await parseProductInfo({ refImage: refImageDataUrl, language: productInfo.language || '简体中文', kind: 'video' })
      setProductInfo(parsed)
    } catch (e: any) {
      setAiError(e?.message || '解析失败')
    } finally {
      setIsAiBusy(false)
    }
  }

  const handleNext = async () => {
    setAiError('')
    if (modalStep === 1) {
      setModalStep(2)
      setIsAiBusy(true)
      try {
        const r = await generateVideoScripts({ product: productInfo, language: productInfo.language, refImage: refImageDataUrl })
        setScripts(r.scripts)
        setScriptBatches([r.scripts])
        setScriptBatchIdx(0)
        setScriptRefreshCount(0)
        setSelectedScript(r.scripts[0] || '')
      } catch (e: any) {
        setAiError(e?.message || '脚本生成失败')
      } finally {
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
    try {
      const r = await generateVideoScripts({ product: productInfo, language: productInfo.language, refImage: refImageDataUrl })
      setScriptBatches((prev) => [...prev, r.scripts])
      setScriptBatchIdx(scriptBatches.length)
      setScriptRefreshCount((c) => Math.min(2, c + 1))
      setScripts(r.scripts)
      setSelectedScript(r.scripts[0] || '')
    } catch (e: any) {
      setAiError(e?.message || '脚本生成失败')
    } finally {
      setIsAiBusy(false)
    }
  }

  const handleOptimize = async (tag: string) => {
    const newTags = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]
    setTags(newTags)
    setAiError('')
    setIsAiBusy(true)
    try {
      const r = await beautifyScript({ script: selectedScript, tags: newTags, language: productInfo.language })
      setOptimizedPrompt(r.optimized)
    } catch (e: any) {
      setAiError(e?.message || '优化失败')
    } finally {
      setIsAiBusy(false)
    }
  }

  const finalVideoPrompt = useMemo(() => {
    const base = optimizedPrompt || selectedScript || prompt
    const info = `产品名称：${productInfo.name}\n产品类目：${productInfo.category}\n核心卖点：${productInfo.sellingPoints}\n目标人群：${productInfo.targetAudience}\n语言：${productInfo.language}`
    return [
      '你是电商短视频导演，请生成一条适合TikTok竖屏的写实商品视频。',
      '要求：10-15秒、镜头节奏快、画面干净高级、突出商品细节与使用场景、避免夸大功效与违规表述。',
      `参考商品信息：\n${info}`,
      `脚本/提示词：\n${base}`,
      `参数：画幅${size}，分辨率${resolution}，时长${durationSec}s。`,
    ].join('\n\n')
  }, [optimizedPrompt, selectedScript, prompt, productInfo, size, resolution, durationSec])

  const handleGenerate = async () => {
    if (!refImageDataUrl) { alert('请先上传参考图'); return }
    if (!prompt) { alert('请输入视频文案描述'); return }
    stopPollingRef.current = false
    setIsGenerating(true)
    setGeneratedVideo('')
    setErrorText('')
    setProgress('0%')
    setStatusText('任务提交中...')
    setTaskId('')

    try {
      const submit = await generateVideoAPI(finalVideoPrompt, model, { aspectRatio: size, durationSec, resolution, refImage: refImageDataUrl })
      setTaskId(submit.taskId)
      setStatusText(submit.message || '视频生成中...')

      for (let i = 0; i < 120; i++) { // 最多轮询约10分钟
        if (stopPollingRef.current) return
        await new Promise(r => setTimeout(r, 5000))
        if (stopPollingRef.current) return

        const s = await checkVideoStatus(submit.taskId)
        setProgress(s.progress || '0%')

        const status = (s.status || '').toLowerCase()
        if (status === 'succeeded' || status === 'success' || status === 'completed') {
          if (!s.videoUrl) throw new Error('任务完成但未返回视频地址')
          setGeneratedVideo(s.videoUrl)
          setStatusText('生成完成')
          setIsGenerating(false)
          return
        }

        if (status === 'failed' || status === 'error') {
          throw new Error(s.failReason || '生成失败')
        }

        setStatusText(`生成中... ${s.progress || ''}`.trim())
      }

      throw new Error('生成超时，请稍后在任务列表中查看')
    } catch (e: any) {
      setErrorText(e?.message || '生成失败')
      setIsGenerating(false)
      setStatusText('')
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
              <div className="bg-white shadow-lg border rounded-2xl px-6 py-5 flex items-center">
                <RefreshCw className="w-5 h-5 text-purple-600 animate-spin mr-3" />
                <div>
              <div className="font-medium">
                {modalStep === 3 ? '视频脚本优化中' : modalStep === 2 ? '视频脚本创作中' : '商品信息AI解析中'}
              </div>
                  <div className="text-sm text-gray-500">请稍等，预计几秒钟...</div>
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
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">创建视频</h2>
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">上传参考图</label>
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center relative">
            <input
              type="file"
              accept="image/*"
              onChange={(e: any) => {
                const f: File | undefined = e.target.files?.[0]
                if (!f) return
                const preview = URL.createObjectURL(f)
                setRefImagePreviewUrl(preview)
                const reader = new FileReader()
                reader.onload = () => setRefImageDataUrl(String(reader.result || ''))
                reader.readAsDataURL(f)
              }}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            {refImagePreviewUrl ? (
              <img src={refImagePreviewUrl} alt="参考图" className="max-h-40 mx-auto" />
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto text-gray-400" />
                <p className="text-gray-500 mt-2">点击上传参考图</p>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1">AI模型</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">分辨率</label>
            <select value={resolution} onChange={(e) => setResolution(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {caps.resolutions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">视频时长</label>
            <select value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value) as any)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {caps.durations.map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">尺寸</label>
            <select value={size} onChange={(e) => setSize(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg text-sm">
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
            <label className="block text-sm font-medium">视频文案描述</label>
            <button
              onClick={handlePromptGen}
              className="px-3 py-1.5 rounded-full text-sm bg-purple-50 text-purple-700 hover:bg-purple-100 flex items-center"
            >
              <Sparkles className="w-4 h-4 mr-1" /> 一键生成提示词
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full px-4 py-3 border rounded-xl min-h-[140px]"
            placeholder="输入商品卖点/场景/风格，或使用一键生成提示词..."
          />
        </div>
        <button onClick={handleGenerate} disabled={isGenerating || !prompt} className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50">{isGenerating ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin inline" />生成中...</> : '生成视频'}</button>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">生成结果</h2>
        {isGenerating ? (
          <div className="h-96 flex flex-col items-center justify-center bg-gray-50 rounded-xl px-6 text-center">
            <RefreshCw className="w-16 h-16 animate-spin text-purple-500" />
            <p className="mt-4 text-lg text-purple-600 font-medium">{statusText || '视频生成中...'}</p>
            <p className="text-sm text-gray-500 mt-1">进度：{progress}</p>
            {taskId && <p className="text-xs text-gray-400 mt-3 break-all">任务ID：{taskId}</p>}
          </div>
        ) : errorText ? (
          <div className="h-96 flex flex-col items-center justify-center text-center bg-red-50 rounded-xl px-6">
            <p className="text-red-600 font-medium">生成失败</p>
            <p className="text-sm text-red-500 mt-2 break-words">{errorText}</p>
            {taskId && <p className="text-xs text-red-400 mt-3 break-all">任务ID：{taskId}</p>}
          </div>
        ) : generatedVideo ? (
          <div>
            <video src={generatedVideo} className="w-full rounded-xl" controls />
            <div className="grid grid-cols-2 gap-4 mt-4">
              <button className="py-3 bg-gray-100 rounded-xl flex items-center justify-center"><Play className="w-5 h-5 mr-2" />预览</button>
              <a href={generatedVideo} download className="py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl flex items-center justify-center">
                <Download className="w-5 h-5 mr-2" />下载
              </a>
            </div>
          </div>
        ) : (
          <div className="h-96 flex items-center justify-center text-gray-400 border-2 border-dashed rounded-xl"><Video className="w-16 h-16 opacity-50" /></div>
        )}
      </div>
    </div>
  )
}

function ImageGenerator() {
  const [refImagePreviewUrl, setRefImagePreviewUrl] = useState('')
  const [refImageDataUrl, setRefImageDataUrl] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('seedream')
  const [size, setSize] = useState<'1:1' | '3:4' | '4:3' | '9:16' | '16:9'>('1:1')
  const [resolution, setResolution] = useState<'2k' | '4k'>('2k')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedImage, setGeneratedImage] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalStep, setModalStep] = useState(1)
  const [productInfo, setProductInfo] = useState<ProductInfo>({ name: '', category: '', sellingPoints: '', targetAudience: '', language: '简体中文' })
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [isAiBusy, setIsAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')

  const handlePromptGen = async () => {
    if (!refImageDataUrl) {
      alert('请先上传参考图')
      return
    }
    setShowModal(true)
    setModalStep(1)
    setAiError('')
    setIsAiBusy(true)
    try {
      const parsed = await parseProductInfo({ refImage: refImageDataUrl, language: productInfo.language || '简体中文', kind: 'image' })
      setProductInfo(parsed)
    } catch (e: any) {
      setAiError(e?.message || '解析失败')
    } finally {
      setIsAiBusy(false)
    }
  }

  const handleNext = async () => {
    setAiError('')
    if (modalStep === 1) {
      setModalStep(2)
      setIsAiBusy(true)
      try {
        const r = await generateImagePrompt({ product: productInfo, language: productInfo.language })
        setOptimizedPrompt(r.prompt)
      } catch (e: any) {
        setAiError(e?.message || '提示词生成失败')
      } finally {
        setIsAiBusy(false)
      }
      return
    }
    setShowModal(false)
    setPrompt(optimizedPrompt)
  }

  const handleGenerate = async () => {
    if (!prompt) {
      alert('请输入图片描述')
      return
    }
    setIsGenerating(true)
    setGeneratedImage('')
    await new Promise((r) => setTimeout(r, 2500))
    setGeneratedImage('https://via.placeholder.com/1024x1024/9b59b6/ffffff?text=AI+Generated')
    setIsGenerating(false)
  }

  if (showModal) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl w-full max-w-2xl">
          <div className="p-6 border-b flex items-center justify-between"><h3 className="text-xl font-bold">一键生成提示词</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5" /></button></div>
          <div className="px-6 py-4 border-b bg-gray-50 flex items-center">
            {['商品信息解析', '图片优化提示词'].map((s, i) => (
              <div key={i} className="flex items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${modalStep > i + 1 ? 'bg-green-500 text-white' : modalStep === i + 1 ? 'bg-purple-500 text-white' : 'bg-gray-300'}`}>
                  {modalStep > i + 1 ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`ml-2 text-sm ${modalStep === i + 1 ? 'font-medium' : 'text-gray-400'}`}>{s}</span>
                {i < 1 && <div className="flex-1 h-0.5 bg-gray-200 mx-4" />}
              </div>
            ))}
          </div>
          <div className="p-6">
            {modalStep === 1 && (<div className="space-y-4">{refImagePreviewUrl && <img src={refImagePreviewUrl} alt="参考图" className="max-h-40 rounded-lg" />}{['name', 'category', 'sellingPoints', 'targetAudience'].map(f => <div key={f}><label className="block text-sm font-medium mb-1">{f === 'name' ? '产品名称' : f === 'category' ? '产品类目' : f === 'sellingPoints' ? '核心卖点' : '目标人群'}</label><input value={productInfo[f as keyof typeof productInfo]} onChange={e => setProductInfo({...productInfo, [f]: e.target.value})} className="w-full px-4 py-2 border rounded-lg" /></div>)}<div><label className="block text-sm font-medium mb-1">图片语言</label><select value={productInfo.language} onChange={e => setProductInfo({...productInfo, language: e.target.value})} className="w-full px-4 py-2 border rounded-lg"><option>简体中文</option><option>English</option></select></div></div>)}
            {modalStep === 2 && (<div className="space-y-4"><label className="block text-sm font-medium mb-1">图片优化提示词</label><textarea value={optimizedPrompt} onChange={e => setOptimizedPrompt(e.target.value)} className="w-full px-4 py-3 border rounded-xl min-h-[150px]" /></div>)}
            {!!aiError && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{aiError}</div>}
          </div>
          <div className="p-6 border-t flex justify-end space-x-3">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg">取消</button>
            <button disabled={isAiBusy} onClick={handleNext} className="px-4 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50">
              {isAiBusy ? '处理中...' : modalStep === 2 ? '确认' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">创建图片</h2>
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">上传参考图</label>
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center relative">
            <input
              type="file"
              accept="image/*"
              onChange={(e: any) => {
                const f: File | undefined = e.target.files?.[0]
                if (!f) return
                const preview = URL.createObjectURL(f)
                setRefImagePreviewUrl(preview)
                const reader = new FileReader()
                reader.onload = () => setRefImageDataUrl(String(reader.result || ''))
                reader.readAsDataURL(f)
              }}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            {refImagePreviewUrl ? (
              <img src={refImagePreviewUrl} alt="参考图" className="max-h-40 mx-auto" />
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto text-gray-400" />
                <p className="text-gray-500 mt-2">点击上传参考图</p>
              </>
            )}
          </div>
        </div>
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">图片文案描述</label>
            <button
              onClick={handlePromptGen}
              className="px-3 py-1.5 rounded-full text-sm bg-purple-50 text-purple-700 hover:bg-purple-100 flex items-center"
            >
              <Sparkles className="w-4 h-4 mr-1" /> 一键生成提示词
            </button>
          </div>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} className="w-full px-4 py-3 border rounded-xl min-h-[140px]" placeholder="输入画面描述/风格，或使用一键生成提示词..." />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1">AI模型</label>
            <select value={model} onChange={e => setModel(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {IMAGE_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">尺寸</label>
            <select value={size} onChange={e => setSize(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="1:1">1:1</option>
              <option value="3:4">3:4</option>
              <option value="4:3">4:3</option>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </select>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-1">分辨率</label>
          <select value={resolution} onChange={e => setResolution(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg text-sm">
            <option value="2k">2k</option>
            <option value="4k">4k</option>
          </select>
        </div>
        <button onClick={handleGenerate} disabled={isGenerating || !prompt} className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50">{isGenerating ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin inline" />生成中...</> : '生成图片'}</button>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">生成结果</h2>
        {isGenerating ? (
          <div className="h-96 flex flex-col items-center justify-center bg-gray-50 rounded-xl px-6 text-center">
            <RefreshCw className="w-16 h-16 animate-spin text-purple-500" />
            <p className="mt-4 text-lg text-purple-600 font-medium">图片生成中，请稍等...</p>
          </div>
        ) : generatedImage ? (
          <div>
            <img src={generatedImage} alt="生成图片" className="w-full rounded-xl" />
            <div className="grid grid-cols-2 gap-4 mt-4">
              <button className="py-3 bg-gray-100 rounded-xl flex items-center justify-center"><Play className="w-5 h-5 mr-2" />预览</button>
              <a href={generatedImage} download className="py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl flex items-center justify-center">
                <Download className="w-5 h-5 mr-2" />下载
              </a>
            </div>
          </div>
        ) : (
          <div className="h-96 flex items-center justify-center text-gray-400 border-2 border-dashed rounded-xl"><Image className="w-16 h-16 opacity-50" /></div>
        )}
      </div>
    </div>
  )
}

function Assets() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">资产库</h2>
        <button className="px-4 py-2 bg-gray-900 text-white rounded-lg">上传素材</button>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-lg">
          <h3 className="font-bold mb-3">用户上传</h3>
          <p className="text-sm text-gray-500">展示用户上传的图片/视频。创作模块上传内容也会自动归档到这里（下一版接入）。</p>
          <div className="mt-6 h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">暂无素材</div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-lg">
          <h3 className="font-bold mb-3">AI生成</h3>
          <p className="text-sm text-gray-500">展示视频生成、图片生成与工具模块产出的素材（下一版接入）。</p>
          <div className="mt-6 h-48 border-2 border-dashed rounded-xl flex items-center justify-center text-gray-400">暂无生成记录</div>
        </div>
      </div>
    </div>
  )
}

function Packages() {
  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold mb-8 text-center">选择您的套餐</h2>
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {PACKAGES.map((pkg) => (
          <div
            key={pkg.id}
            className={`bg-white rounded-2xl p-6 shadow-lg border-2 ${pkg.id === 'basic' ? 'border-purple-500' : 'border-transparent'}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">{pkg.name}</h3>
              {pkg.id === 'basic' && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">推荐</span>}
            </div>
            <div className="mt-4">
              <div className="text-3xl font-extrabold">{pkg.price}</div>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-gray-600">
              {pkg.features.map((f) => (
                <li key={f} className="flex items-center">
                  <Check className="w-4 h-4 text-green-500 mr-2" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              className={`mt-6 w-full py-3 rounded-xl font-bold ${
                pkg.id === 'trial' ? 'bg-gray-100 text-gray-700' : 'bg-gradient-to-r from-pink-500 to-purple-500 text-white'
              }`}
              onClick={() => alert('支付/订阅流程未接入')}
            >
              {pkg.id === 'trial' ? '当前试用' : '立即开通'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App