import { useState } from 'react'
import { Video, Image, Zap, LogOut, User, Play, Download, RefreshCw, Sparkles, Menu, X, Upload, Scissors, Eraser, Wand2, Folder, ChevronRight, Check, Crown } from 'lucide-react'

const VIDEO_MODELS = [{ id: 'sora', name: 'Sora 2.0' }, { id: 'seedance', name: 'Seedance 1.5' }, { id: 'kling', name: 'Kling' }, { id: 'runway', name: 'Veo 3' }]
const IMAGE_MODELS = [{ id: 'seedream', name: 'Seedream 4.5' }, { id: 'midjourney', name: 'Midjourney' }, { id: 'flux', name: 'Flux' }]
const PACKAGES = [{ id: 'trial', name: '试用版', price: '¥0', features: ['每天3次', '基础功能'] }, { id: 'basic', name: '基础版', price: '¥69/月', features: ['每天20次', '全部模型'] }, { id: 'pro', name: '专业版', price: '¥249/月', features: ['无限次数', '4K输出'] }, { id: 'enterprise', name: '旗舰版', price: '¥1199/月', features: ['企业级', 'API接入'] }]

function App() {
  const [page, setPage] = useState<'landing' | 'login' | 'home'>('landing')
  const [user, setUser] = useState<{name: string; credits: number; package: string} | null>(null)
  const [mainNav, setMainNav] = useState<'create' | 'tools' | 'assets' | 'profile'>('create')
  const [subNav, setSubNav] = useState<'video' | 'image'>('video')
  const handleLogin = () => setUser({ name: '产品经理', credits: 800, package: 'trial' })

  if (page === 'landing') return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="fixed top-0 left-0 right-0 z-50 bg-black/20 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3"><div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center"><Video className="w-5 h-5 text-white" /></div><span className="text-xl font-bold text-white">TikGen AI</span></div>
          <div className="flex items-center space-x-4"><button onClick={() => setPage('login')} className="px-4 py-2 text-white/80">登录</button><button onClick={handleLogin} className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-lg">免费注册</button></div>
        </div>
      </div>
      <div className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold text-white mb-8">AI驱动的内容创作<br/><span className="bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 bg-clip-text text-transparent">释放无限创意</span></h1>
          <p className="text-xl text-white/70 mb-12">集成OpenAI Sora、Google Veo、字节Seedance等顶尖AI模型</p>
          <button onClick={handleLogin} className="px-8 py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl font-bold text-lg">立即开始创作</button>
        </div>
      </div>
      <div className="py-20 px-6 bg-black/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-16">核心功能</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10"><div className="w-14 h-14 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center mb-6"><Video className="w-7 h-7 text-white" /></div><h3 className="text-xl font-bold text-white mb-4">AI视频生成</h3><p className="text-white/60">输入文案自动生成视频</p></div>
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10"><div className="w-14 h-14 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center mb-6"><Image className="w-7 h-7 text-white" /></div><h3 className="text-xl font-bold text-white mb-4">AI图片生成</h3><p className="text-white/60">文字描述生成精美图片</p></div>
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10"><div className="w-14 h-14 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-xl flex items-center justify-center mb-6"><Sparkles className="w-7 h-7 text-white" /></div><h3 className="text-xl font-bold text-white mb-4">智能提示词</h3><p className="text-white/60">AI自动优化提示词</p></div>
          </div>
        </div>
      </div>
    </div>
  )

  if (page === 'login') return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <button onClick={() => setPage('landing')} className="text-white/60 mb-8 flex items-center"><ChevronRight className="w-5 h-5 rotate-180 mr-1" /> 返回</button>
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 border border-white/20">
          <h2 className="text-3xl font-bold text-white text-center mb-8">登录账号</h2>
          <div className="space-y-4">
            <input type="email" placeholder="邮箱地址" className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40" />
            <input type="password" placeholder="密码" className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40" />
            <button onClick={handleLogin} className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl">登录</button>
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
          <div className="text-xs font-medium text-gray-400 uppercase mb-2">创作</div>
          <NavBtn icon={<Video className="w-5 h-5" />} label="视频生成" active={mainNav === 'create' && subNav === 'video'} onClick={() => { setMainNav('create'); setSubNav('video') }} />
          <NavBtn icon={<Image className="w-5 h-5" />} label="图片生成" active={mainNav === 'create' && subNav === 'image'} onClick={() => { setMainNav('create'); setSubNav('image') }} />
          <div className="text-xs font-medium text-gray-400 uppercase mt-6 mb-2">工具</div>
          <NavBtn icon={<Scissors className="w-5 h-5" />} label="去字幕" disabled onClick={() => {}} />
          <NavBtn icon={<Eraser className="w-5 h-5" />} label="去水印" disabled onClick={() => {}} />
          <NavBtn icon={<Wand2 className="w-5 h-5" />} label="画质提升" disabled onClick={() => {}} />
          <div className="text-xs font-medium text-gray-400 uppercase mt-6 mb-2">资产库</div>
          <NavBtn icon={<Folder className="w-5 h-5" />} label="我的素材" active={mainNav === 'assets'} onClick={() => setMainNav('assets')} />
          <div className="text-xs font-medium text-gray-400 uppercase mt-6 mb-2">权益中心</div>
          <NavBtn icon={<Crown className="w-5 h-5" />} label="套餐充值" active={mainNav === 'profile'} onClick={() => setMainNav('profile')} />
        </nav>
      </aside>
      <main className="flex-1 ml-64">
        <header className="bg-white shadow-sm sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4"><button className="p-2 hover:bg-gray-100 rounded-lg"><Menu className="w-5 h-5" /></button><h1 className="text-xl font-bold">{mainNav === 'create' && subNav === 'video' && 'AI视频生成'}{mainNav === 'create' && subNav === 'image' && 'AI图片生成'}{mainNav === 'tools' && '工具'}{mainNav === 'assets' && '资产库'}{mainNav === 'profile' && '权益中心'}</h1></div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 bg-gradient-to-r from-pink-50 to-purple-50 px-4 py-2 rounded-full"><Zap className="w-5 h-5 text-pink-500" /><span className="font-bold text-pink-600">{user?.credits}</span><span className="text-sm text-pink-500">积分</span></div>
              <div className="flex items-center space-x-2 px-3 py-1.5 bg-amber-50 rounded-full"><Crown className="w-4 h-4 text-amber-500" /><span className="text-sm font-medium text-amber-700">{PACKAGES.find(p => p.id === user?.package)?.name}</span></div>
              <div className="flex items-center space-x-2"><div className="w-8 h-8 bg-gradient-to-r from-pink-500 to-purple-500 rounded-full flex items-center justify-center"><User className="w-4 h-4 text-white" /></div><span className="text-sm font-medium">{user?.name}</span></div>
              <button onClick={() => setPage('landing')} className="p-2 hover:bg-gray-100 rounded-lg"><LogOut className="w-5 h-5" /></button>
            </div>
          </div>
        </header>
        <div className="p-6">
          {mainNav === 'create' && subNav === 'video' && <VideoGenerator />}
          {mainNav === 'create' && subNav === 'image' && <ImageGenerator />}
          {mainNav === 'assets' && <div className="text-center py-20"><Folder className="w-20 h-20 mx-auto text-gray-300" /><p className="mt-4 text-gray-500">资产库开发中...</p></div>}
          {mainNav === 'profile' && <Packages />}
          {mainNav === 'tools' && <div className="text-center py-20 text-gray-500">工具功能下一版推出</div>}
        </div>
      </main>
    </div>
  )
}

function NavBtn({icon, label, active, onClick, disabled}: any) {
  return <button onClick={onClick} disabled={disabled} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white' : 'text-gray-600 hover:bg-gray-100'} ${disabled ? 'opacity-50' : ''}`}>{icon}<span>{label}</span>{disabled && <span className="text-xs bg-gray-200 px-2 py-0.5 rounded ml-auto">待上线</span>}</button>
}

function VideoGenerator() {
  const [refImage, setRefImage] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('sora')
  const [size, setSize] = useState('9:16')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedVideo, setGeneratedVideo] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalStep, setModalStep] = useState(1)
  const [productInfo, setProductInfo] = useState({ name: '', category: '', sellingPoints: '', targetAudience: '', language: '简体中文' })
  const [scripts, setScripts] = useState<string[]>([])
  const [selectedScript, setSelectedScript] = useState('')
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [tags, setTags] = useState<string[]>([])

  const handlePromptGen = async () => {
    if (!refImage) { alert('请先上传参考图'); return }
    setShowModal(true); setModalStep(1)
    await new Promise(r => setTimeout(r, 1500))
    setProductInfo({ name: '示例产品', category: '电子产品', sellingPoints: '高性能', targetAudience: '年轻用户', language: '简体中文' })
  }

  const handleNext = async () => {
    if (modalStep === 1) { setModalStep(2); await new Promise(r => setTimeout(r, 1500)); setScripts(['脚本1：展示产品外观，介绍核心卖点', '脚本2：使用场景演示，突出实用性', '脚本3：对比实验，展示产品优势']); setSelectedScript(scripts[0] || '脚本1') }
    else if (modalStep === 2) { setModalStep(3); setOptimizedPrompt(selectedScript) }
    else { setShowModal(false); setPrompt(optimizedPrompt || selectedScript) }
  }

  const handleOptimize = async (tag: string) => {
    const newTags = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]
    setTags(newTags)
    await new Promise(r => setTimeout(r, 1000))
    setOptimizedPrompt(selectedScript + '，' + newTags.join('，'))
  }

  const handleGenerate = async () => {
    if (!prompt) { alert('请输入视频描述'); return }
    setIsGenerating(true); setGeneratedVideo('')
    await new Promise(r => setTimeout(r, 3000))
    setGeneratedVideo('https://www.w3schools.com/html/mov_bbb.mp4')
    setIsGenerating(false)
  }

  if (showModal) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b flex items-center justify-between"><h3 className="text-xl font-bold">一键生成提示词</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5" /></button></div>
          <div className="px-6 py-4 border-b bg-gray-50 flex items-center">{['商品信息解析', '视频脚本', '提示词优化'].map((s, i) => (<div key={i} className="flex items-center"><div className={`w-8 h-8 rounded-full flex items-center justify-center ${modalStep > i + 1 ? 'bg-green-500 text-white' : modalStep === i + 1 ? 'bg-purple-500 text-white' : 'bg-gray-300'}`}>{modalStep > i + 1 ? <Check className="w-4 h-4" /> : i + 1}</div><span className={`ml-2 text-sm ${modalStep === i + 1 ? 'font-medium' : 'text-gray-400'}`}>{s}</span>{i < 2 && <div className="flex-1 h-0.5 bg-gray-200 mx-4" />}</div></div>))}</div>
          <div className="p-6">
            {modalStep === 1 && (<div className="space-y-4">{refImage && <img src={refImage} alt="参考图" className="max-h-40 rounded-lg" />}{['name', 'category', 'sellingPoints', 'targetAudience'].map(f => <div key={f}><label className="block text-sm font-medium mb-1">{f === 'name' ? '产品名称' : f === 'category' ? '产品类目' : f === 'sellingPoints' ? '核心卖点' : '目标人群'}</label><input value={productInfo[f as keyof typeof productInfo]} onChange={e => setProductInfo({...productInfo, [f]: e.target.value})} className="w-full px-4 py-2 border rounded-lg" /></div>)}<div><label className="block text-sm font-medium mb-1">视频语言</label><select value={productInfo.language} onChange={e => setProductInfo({...productInfo, language: e.target.value})} className="w-full px-4 py-2 border rounded-lg"><option>简体中文</option><option>English</option><option>日本語</option></select></div></div>)}
            {modalStep === 2 && (<div className="space-y-4"><p className="text-sm text-gray-500">选择或编辑视频脚本：</p>{scripts.map((s, i) => (<div key={i} className={`p-4 border-2 rounded-lg cursor-pointer ${selectedScript === s ? 'border-purple-500 bg-purple-50' : ''}`} onClick={() => setSelectedScript(s)}><div className="flex items-center"><div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mr-3 ${selectedScript === s ? 'border-purple-500 bg-purple-500' : 'border-gray-300'}`}>{selectedScript === s && <Check className="w-3 h-3 text-white" />}</div><p>{s}</p></div></div>))}<button onClick={() => { setScripts(['新脚本1', '新脚本2', '新脚本3']); setSelectedScript('新脚本1') }} className="text-purple-600 text-sm flex items-center"><RefreshCw className="w-4 h-4 mr-1" /> 换一批</button></div>)}
            {modalStep === 3 && (<div className="space-y-4"><div className="p-4 bg-gray-50 rounded-lg"><p className="text-sm text-gray-500 mb-2">当前脚本</p><p>{selectedScript}</p></div><div><p className="text-sm font-medium mb-2">提示词美化</p><div className="flex flex-wrap gap-2">{['真人感', '高端', '简洁', '详实', '电影感', 'TikTok风格'].map(tag => (<button key={tag} onClick={() => handleOptimize(tag)} className={`px-3 py-1 rounded-full text-sm ${tags.includes(tag) ? 'bg-purple-500 text-white' : 'bg-gray-100'}`}>{tag}</button>))}</div></div>{optimizedPrompt && <div className="p-4 bg-purple-50 rounded-lg"><p className="text-sm text-purple-600 mb-1">优化后</p><p>{optimizedPrompt}</p></div>}</div>)}
          </div>
          <div className="p-6 border-t flex justify-end space-x-3"><button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg">取消</button><button onClick={handleNext} className="px-4 py-2 bg-purple-500 text-white rounded-lg">{modalStep === 3 ? '确认' : '下一步'}</button></div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">创建视频</h2>
        <div className="mb-6"><label className="block text-sm font-medium mb-2">上传参考图</label><div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center relative"><input type="file" accept="image/*" onChange={(e: any) => e.target.files?.[0] && setRefImage(URL.createObjectURL(e.target.files[0]))} className="absolute inset-0 opacity-0 cursor-pointer" />{refImage ? <img src={refImage} alt="参考图" className="max-h-40 mx-auto" /> : <><Upload className="w-10 h-10 mx-auto text-gray-400" /><p className="text-gray-500 mt-2">点击上传参考图</p></>}</div></div>
        <button onClick={handlePromptGen} className="mb-4 w-full py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-lg flex items-center justify-center"><Sparkles className="w-5 h-5 mr-2" /> 一键生成提示词</button>
        <div className="mb-6"><label className="block text-sm font-medium mb-2">视频文案描述</label><textarea value={prompt} onChange={e => setPrompt(e.target.value)} className="w-full px-4 py-3 border rounded-xl min-h-[120px]" placeholder="描述视频内容..." /></div>
        <div className="grid grid-cols-2 gap-4 mb-4"><div><label className="block text-sm font-medium mb-1">AI模型</label><select value={model} onChange={e => setModel(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">{VIDEO_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div><div><label className="block text-sm font-medium mb-1">尺寸</label><select value={size} onChange={e => setSize(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm"><option value="9:16">竖版 9:16</option><option value="16:9">横版 16:9</option></select></div></div>
        <button onClick={handleGenerate} disabled={isGenerating || !prompt} className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50">{isGenerating ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin inline" />生成中...</> : '生成视频'}</button>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">生成结果</h2>
        {isGenerating ? <div className="h-96 flex flex-col items-center justify-center bg-gray-50 rounded-xl"><RefreshCw className="w-16 h-16 animate-spin text-purple-500" /><p className="mt-4 text-lg text-purple-600 font-medium">视频生成中...</p><p className="text-sm text-gray-500">预计需要3-5分钟，请稍候</p></div> : generatedVideo ? <div><video src={generatedVideo} className="w-full rounded-xl" controls /><div className="grid grid-cols-2 gap-4 mt-4"><button className="py-3 bg-gray-100 rounded-xl flex items-center justify-center"><Play className="w-5 h-5 mr-2" />预览</button><button className="py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl flex items-center justify-center"><Download className="w-5 h-5 mr-2" />下载</button></div></div> : <div className="h-96 flex items-center justify-center text-gray-400 border-2 border-dashed rounded-xl"><Video className="w-16 h-16 opacity-50" /></div>}
      </div>
    </div>
  )
}

function ImageGenerator() {
  const [refImage, setRefImage] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('seedream')
  const [size, setSize] = useState('1:1')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedImage, setGeneratedImage] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalStep, setModalStep] = useState(1)
  const [productInfo, setProductInfo] = useState({ name: '', category: '', sellingPoints: '', targetAudience: '', language: '简体中文' })
  const [optimizedPrompt, setOptimizedPrompt] = useState('')

  const handlePromptGen = async () => {
    if (!refImage) { alert('请先上传参考图'); return }
    setShowModal(true); setModalStep(1)
    await new Promise(r => setTimeout(r, 1500))
    setProductInfo({ name: '示例产品', category: '电子产品', sellingPoints: '高性能', targetAudience: '年轻用户', language: '简体中文' })
  }

  const handleNext = async () => {
    if (modalStep === 1) { setModalStep(2); setOptimizedPrompt(`${productInfo.name}，${productInfo.category}，${productInfo.sellingPoints}，${productInfo.targetAudience}`) }
    else { setShowModal(false); setPrompt(optimizedPrompt) }
  }

  const handleGenerate = async () => {
    if (!prompt) { alert('请输入图片描述'); return }
    setIsGenerating(true); setGeneratedImage('')
    await new Promise(r => setTimeout(r, 3000))
    setGeneratedImage('https://via.placeholder.com/512x512/9b59b6/ffffff?text=AI+Generated')
    setIsGenerating(false)
  }

  if (showModal) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl w-full max-w-2xl">
          <div className="p-6 border-b flex items-center justify-between"><h3 className="text-xl font-bold">一键生成提示词</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5" /></button></div>
          <div className="px-6 py-4 border-b bg-gray-50 flex items-center">{['商品信息解析', '图片优化提示词'].map((s, i) => (<div key={i} className="flex items-center"><div className={`w-8 h-8 rounded-full flex items-center justify-center ${modalStep > i + 1 ? 'bg-green-500 text-white' : modalStep === i + 1 ? 'bg-purple-500 text-white' : 'bg-gray-300'}`}>{modalStep > i + 1 ? <Check className="w-4 h-4" /> : i + 1}</div><span className={`ml-2 text-sm ${modalStep === i + 1 ? 'font-medium' : 'text-gray-400'}`}>{s}</span>{i < 1 && <div className="flex-1 h-0.5 bg-gray-200 mx-4" />}</div></div>))}</div>
          <div className="p-6">
            {modalStep === 1 && (<div className="space-y-4">{refImage && <img src={refImage} alt="参考图" className="max-h-40 rounded-lg" />}{['name', 'category', 'sellingPoints', 'targetAudience'].map(f => <div key={f}><label className="block text-sm font-medium mb-1">{f === 'name' ? '产品名称' : f === 'category' ? '产品类目' : f === 'sellingPoints' ? '核心卖点' : '目标人群'}</label><input value={productInfo[f as keyof typeof productInfo]} onChange={e => setProductInfo({...productInfo, [f]: e.target.value})} className="w-full px-4 py-2 border rounded-lg" /></div>)}<div><label className="block text-sm font-medium mb-1">图片语言</label><select value={productInfo.language} onChange={e => setProductInfo({...productInfo, language: e.target.value})} className="w-full px-4 py-2 border rounded-lg"><option>简体中文</option><option>English</option></select></div></div>)}
            {modalStep === 2 && (<div className="space-y-4"><label className="block text-sm font-medium mb-1">图片优化提示词</label><textarea value={optimizedPrompt} onChange={e => setOptimizedPrompt(e.target.value)} className="w-full px-4 py-3 border rounded-xl min-h-[150px]" /></div>)}
          </div>
          <div className="p-6 border-t flex justify-end space-x-3"><button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg">取消</button><button onClick={handleNext} className="px-4 py-2 bg-purple-500 text-white rounded-lg">{modalStep === 2 ? '确认' : '下一步'}</button></div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">创建图片</h2>
        <div className="mb-6"><label className="block text-sm font-medium mb-2">上传参考图</label><div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center relative"><input type="file" accept="image/*" onChange={(e: any) => e.target.files?.[0] && setRefImage(URL.createObjectURL(e.target.files[0]))} className="absolute inset-0 opacity-0 cursor-pointer" />{refImage ? <img src={refImage} alt="参考图" className="max-h-40 mx-auto" /> : <><Upload className="w-10 h-10 mx-auto text-gray-400" /><p className="text-gray-500 mt-2">点击上传参考图</p></>}</div></div>
        <button onClick={handlePromptGen} className="mb-4 w-full py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-lg flex items-center justify-center"><Sparkles className="w-5 h-5 mr-2" /> 一键生成提示词</button>
        <div className="mb-6"><label className="block text-sm font-medium mb-2">图片文案描述</label><textarea value={prompt} onChange={e => setPrompt(e.target.value)} className="w-full px-4 py-3 border rounded-xl min-h-[120px]" placeholder="描述图片内容..." /></div>
        <div className="grid grid-cols-2 gap-4 mb-4"><div><label className="block text-sm font-medium mb-1">AI模型</label><select value={model} onChange={e => setModel(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">{IMAGE_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div><div><label className="block text-sm font-medium mb-1">尺寸</label><select value={size} onChange={e => setSize(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm"><option value="1:1">1:1</option><option value="3:4">3:4</option><option value="9:16">9:16</option><option value="16:9">16:9</option></select></div></div>
        <button onClick={handleGenerate} disabled={isGenerating || !prompt} className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50">{isGenerating ? <><RefreshCw className="w-5 h-5 mr-2 animate-spin inline" />生成中...</> : '生成图片'}</button>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-6">生成结果</h2>
        {isGenerating ? <div className="h-96 flex flex-col items-center justify-center bg-gray-50 rounded-xl"><RefreshCw className="w-16 h-16 animate-spin text-purple-500" /><p className="mt-4 text-lg text-purple-600 font-medium">图片生成中...</p></div> : generatedImage ? <div><img src={generatedImage} alt="生成图片" className="w-full rounded-xl" /><div className="grid grid-cols-2 gap-4 mt-4"><button className="py-3 bg-gray-100 rounded-xl flex items-center justify-center"><Play className="w-5 h-5 mr-2" />预览</button><button className="py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl flex items-center justify-center"><Download className="w-5 h-5 mr-2" />下载</button></div></div> : <div className="h-96 flex items-center justify-center text-gray-400 border-2 border-dashed rounded-xl"><Image className="w-16 h-16 opacity-50" /></div>}
      </div>
    </div>
  )
}

function Packages() {
  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-8 text-center">选择您的套餐</h2>
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {PACKAGES.map(pkg => (
          <div key={pkg.id} className={`bg-white rounded-2xl p-6 shadow-lg border-2 ${pkg.id === 'basic' ?