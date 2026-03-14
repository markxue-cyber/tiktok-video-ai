import { useState } from 'react'
import { 
  Upload, Video, Zap, LogOut, User, Play, Download, 
  RefreshCw, Sparkles, TrendingUp, AlertCircle, Menu, X,
  CreditCard, Settings as SettingsIcon, History as HistoryIcon, 
  Wallet as WalletIcon, Image as ImageIcon
} from 'lucide-react'

// 视频生成API调用
const generateVideoAPI = async (prompt: string, model: string): Promise<{videoUrl: string, taskId: string, message: string}> => {
  // 提交任务
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model })
  })
  
  const data = await response.json()
  console.log('Submit Response:', data)
  
  if (!data.success) {
    throw new Error(data.error || '提交失败')
  }
  
  // 返回任务ID和消息
  return {
    videoUrl: '',
    taskId: data.taskId,
    message: data.message || '视频生成中，预计需要3-5分钟'
  }
}

// 查询视频状态
const checkVideoStatus = async (taskId: string): Promise<{status: string, videoUrl: string, progress: string}> => {
  const response = await fetch(`/api/generate?taskId=${taskId}`)
  const data = await response.json()
  return {
    status: data.status,
    videoUrl: data.videoUrl || '',
    progress: data.progress || '0%'
  }
}

// 模拟视频生成
const simulateVideoGeneration = async (): Promise<string> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      // 使用更稳定的示例视频
      resolve('https://www.w3schools.com/html/mov_bbb.mp4')
    }, 3000)
  })
}

const MODELS = [
  { id: 'sora', name: 'OpenAI Sora', icon: '🚀', desc: '文生视频首选' },
  { id: 'kling', name: '快手 Kling', icon: '⚡', desc: '性价比高' },
  { id: 'runway', name: 'Runway', icon: '🎬', desc: '专业视频' },
  { id: 'seedance', name: '字节 Seedance', icon: '🏠', desc: '国产优质' },
]

const MOCK_HISTORY = [
  { id: 1, title: '耳机产品展示', model: 'kling', status: 'completed', date: '2024-01-15' },
  { id: 2, title: '美妆教程视频', model: 'sora', status: 'completed', date: '2024-01-14' },
  { id: 3, title: '食品带货视频', model: 'runway', status: 'processing', date: '2024-01-14' },
]

function App() {
  const [page, setPage] = useState<'login' | 'home'>('login')
  const [user, setUser] = useState<{name: string; email: string; credits: number} | null>(null)
  const [activeTab, setActiveTab] = useState<'clone' | 'generate' | 'credits' | 'history' | 'settings'>('generate')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null)
  const [videoPreview, setVideoPreview] = useState('')
  const [generatedVideo, setGeneratedVideo] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [generatedImage, setGeneratedImage] = useState('')
  const [selectedModel, setSelectedModel] = useState('sora')
  const [showPayment, setShowPayment] = useState(false)
  const [selectedPackage, setSelectedPackage] = useState<number|null>(null)
  const [apiStatus, setApiStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [useRealAPI, setUseRealAPI] = useState(false) // 默认使用模拟模式（开发测试用）

  const handleLogin = () => {
    setUser({ name: '产品经理', email: 'demo@example.com', credits: 800 })
    setPage('home')
  }

  const handleOptimize = async () => {
    setOptimizedPrompt('优化中...')
    await new Promise(r => setTimeout(r, 1000))
    setOptimizedPrompt(prompt + '，高清画质，专业灯光，TikTok风格')
  }

  const handleGenerate = async () => {
    if (!prompt) {
      alert('请输入视频描述！')
      return
    }
    if (user && user.credits < 50) { alert('积分不足!'); return }
    
    setIsGenerating(true)
    setProgress(0)
    setApiStatus('testing')
    setGeneratedVideo('submitting')
    
    try {
      // 提交任务
      const result = await generateVideoAPI(prompt, selectedModel)
      
      // 显示任务ID
      setGeneratedVideo(result.taskId)
      
      // 轮询查询状态
      const pollInterval = setInterval(async () => {
        try {
          const status = await checkVideoStatus(result.taskId)
          setProgress(parseInt(status.progress) || 0)
          
          if (status.status === 'SUCCESS' && status.videoUrl) {
            clearInterval(pollInterval)
            setGeneratedVideo(status.videoUrl)
            setProgress(100)
            setApiStatus('success')
            if (user) setUser({...user, credits: user.credits - 50})
          } else if (status.status === 'FAILURE') {
            clearInterval(pollInterval)
            setApiStatus('error')
            setGeneratedVideo('')
          }
        } catch (e) {
          console.error('查询失败:', e)
        }
      }, 5000) // 每5秒查询一次
      
      // 最多轮询10分钟
      setTimeout(() => {
        clearInterval(pollInterval)
        if (apiStatus === 'testing') {
          setIsGenerating(false)
        }
      }, 10 * 60 * 1000)
      
    } catch (error) {
      console.error('生成失败:', error)
      setApiStatus('error')
      alert('视频生成失败：' + (error as Error).message)
      setIsGenerating(false)
    }
  }

  const handleClone = async () => {
    if (!uploadedVideo) { alert('请先上传视频！'); return }
    if (user && user.credits < 80) { alert('积分不足!'); return }
    setIsGenerating(true)
    setProgress(0)
    setGeneratedVideo('')
    
    try {
      const result = await generateVideoAPI('', selectedModel)
      alert(result.message)
      
      const pollInterval = setInterval(async () => {
        try {
          const status = await checkVideoStatus(result.taskId)
          setProgress(parseInt(status.progress) || 0)
          
          if (status.status === 'SUCCESS' && status.videoUrl) {
            clearInterval(pollInterval)
            setGeneratedVideo(status.videoUrl)
            setProgress(100)
            if (user) setUser({...user, credits: user.credits - 80})
            alert('视频生成成功！')
          } else if (status.status === 'FAILURE') {
            clearInterval(pollInterval)
            alert('视频生成失败')
          }
        } catch (e) {
          console.error('查询失败:', e)
        }
      }, 5000)
      
      setTimeout(() => { clearInterval(pollInterval); setIsGenerating(false) }, 10 * 60 * 1000)
      
    } catch (error) {
      alert('提交失败：' + (error as Error).message)
      setIsGenerating(false)
    }
  }

  const handleRecharge = (i: number) => { setSelectedPackage(i); setShowPayment(true) }
  const confirmPay = () => {
    const cr = [100,500,1000]
    if (selectedPackage!==null && user) setUser({...user, credits: user.credits+cr[selectedPackage]})
    alert('充值成功!'); setShowPayment(false)
  }

  if (page === 'login') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-pink-500/30 rounded-full blur-3xl"></div>
        </div>
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 w-full max-w-md border border-white/20 relative z-10">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Video className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-white mb-2">TikGen AI</h1>
            <p className="text-white/60">TikTok 爆款视频生成平台</p>
          </div>
          <div className="space-y-4 mb-6">
            <input type="email" placeholder="邮箱地址" className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40" />
            <input type="password" placeholder="密码" className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40" />
          </div>
          <button onClick={handleLogin} className="w-full py-4 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 text-white font-bold rounded-xl">
            登录 / 注册
          </button>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="bg-white/5 rounded-lg p-3 text-center"><span className="text-2xl">🚀</span><p className="text-xs text-white/60 mt-1">Sora</p></div>
            <div className="bg-white/5 rounded-lg p-3 text-center"><span className="text-2xl">⚡</span><p className="text-xs text-white/60 mt-1">Kling</p></div>
            <div className="bg-white/5 rounded-lg p-3 text-center"><span className="text-2xl">🎬</span><p className="text-xs text-white/60 mt-1">Runway</p></div>
          </div>
          <div className="mt-4 p-3 bg-green-500/20 rounded-lg">
            <div className="flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
              <span className="ml-2 text-green-400 text-sm">小豆包API已准备就绪</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className={`${sidebarOpen?'w-64':'w-20'} bg-white shadow-xl fixed h-full z-30 transition-all`}>
        <div className="p-4 border-b flex items-center justify-between">
          <div className={`flex items-center space-x-3 ${!sidebarOpen&&'justify-center w-full'}`}>
            <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center">
              <Video className="w-5 h-5 text-white" />
            </div>
            {sidebarOpen && <span className="text-xl font-bold bg-gradient-to-r from-pink-600 to-purple-600 bg-clip-text text-transparent">TikGen AI</span>}
          </div>
        </div>
        <nav className="p-4 space-y-2">
          <NavItem icon={<Sparkles className="w-5 h-5" />} label="AI生成" active={activeTab==='generate'} onClick={()=>setActiveTab('generate')} o={sidebarOpen} />
          <NavItem icon={<TrendingUp className="w-5 h-5" />} label="一键复刻" active={activeTab==='clone'} onClick={()=>setActiveTab('clone')} o={sidebarOpen} />
          <NavItem icon={<HistoryIcon className="w-5 h-5" />} label="视频库" active={activeTab==='history'} onClick={()=>setActiveTab('history')} o={sidebarOpen} />
          <NavItem icon={<WalletIcon className="w-5 h-5" />} label="充值" active={activeTab==='credits'} onClick={()=>setActiveTab('credits')} o={sidebarOpen} />
          <NavItem icon={<SettingsIcon className="w-5 h-5" />} label="设置" active={activeTab==='settings'} onClick={()=>setActiveTab('settings')} o={sidebarOpen} />
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t">
          <div className={`flex items-center ${!sidebarOpen&&'justify-center'}`}>
            <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-white" /></div>
            {sidebarOpen && <div className="ml-3"><p className="text-sm font-medium">{user?.name}</p><p className="text-xs text-gray-500">{user?.email}</p></div>}
          </div>
        </div>
      </aside>

      <main className={`flex-1 ${sidebarOpen?'ml-64':'ml-20'} transition-all`}>
        <header className="bg-white shadow-sm sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button onClick={()=>setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-gray-100 rounded-lg"><Menu className="w-5 h-5" /></button>
              <div><h1 className="text-xl font-bold">{activeTab==='generate'&&'AI视频生成'}{activeTab==='clone'&&'一键复刻'}{activeTab==='history'&&'视频库'}{activeTab==='credits'&&'积分充值'}{activeTab==='settings'&&'设置'}</h1></div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 bg-gradient-to-r from-pink-50 to-purple-50 px-4 py-2 rounded-full"><Zap className="w-5 h-5 text-pink-500" /><span className="font-bold text-pink-600">{user?.credits}</span><span className="text-sm text-pink-500">积分</span></div>
              <button onClick={()=>setPage('login')} className="p-2 hover:bg-gray-100 rounded-lg"><LogOut className="w-5 h-5" /></button>
            </div>
          </div>
        </header>
        <div className="p-6">
          {activeTab==='generate' && <Generate p={prompt} setP={setPrompt} op={optimizedPrompt} setOp={setOptimizedPrompt} opt={handleOptimize} gi={generatedImage} setGi={setGeneratedImage} sm={selectedModel} setSm={setSelectedModel} ig={isGenerating} gp={progress} og={handleGenerate} gv={generatedVideo} models={MODELS} apiStatus={apiStatus} useRealAPI={useRealAPI} setUseRealAPI={setUseRealAPI} />}
          {activeTab==='clone' && <Clone uv={uploadedVideo} setUv={setUploadedVideo} vp={videoPreview} setVp={setVideoPreview} sm={selectedModel} setSm={setSelectedModel} ig={isGenerating} gp={progress} oc={handleClone} gv={generatedVideo} models={MODELS} />}
          {activeTab==='history' && <History history={MOCK_HISTORY} />}
          {activeTab==='credits' && <Credits user={user} onR={handleRecharge} />}
          {activeTab==='settings' && <Settings user={user} setUser={setUser} useRealAPI={useRealAPI} setUseRealAPI={setUseRealAPI} />}
        </div>
      </main>
      {showPayment && <Payment pI={selectedPackage} onC={confirmPay} onX={()=>setShowPayment(false)} />}
    </div>
  )
}

function NavItem({icon,label,active,onClick,o}:any){return(<button onClick={onClick} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl ${active?'bg-gradient-to-r from-pink-500 to-purple-500 text-white':'text-gray-600 hover:bg-gray-100'} ${!o&&'justify-center'}`}>{icon}{o&&<span>{label}</span>}</button>)}

function Generate({p,setP,op,setOp,opt,gi,setGi,sm,setSm,ig,gp,og,gv,models,apiStatus,useRealAPI,setUseRealAPI}:any){
  return(<div className="grid lg:grid-cols-2 gap-8">
    <div className="bg-white rounded-2xl p-6 shadow-lg">
      <h2 className="text-xl font-bold mb-6">创建视频</h2>
      
      <div className="mb-4 p-3 rounded-lg bg-gray-50 border">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className={`w-3 h-3 rounded-full ${apiStatus==='success'?'bg-green-500':apiStatus==='error'?'bg-red-500':apiStatus==='testing'?'bg-yellow-500':'bg-gray-300'}`}></div>
            <span className="ml-2 text-sm text-gray-600">API状态: {apiStatus==='success'?'已连接':apiStatus==='error'?'错误':apiStatus==='testing'?'生成中':'就绪'}</span>
          </div>
          <label className="flex items-center cursor-pointer">
            <span className="text-sm text-gray-500 mr-2">使用真实API</span>
            <div className="relative">
              <input type="checkbox" checked={useRealAPI} onChange={(e)=>setUseRealAPI(e.target.checked)} className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
            </div>
          </label>
        </div>
      </div>
      
      <div className="mb-6"><label className="block text-sm font-medium mb-3">选择模型</label>
        <div className="grid grid-cols-2 gap-3">{models.map((m:any)=>(<button key={m.id} onClick={()=>setSm(m.id)} className={`p-4 rounded-xl border-2 text-left ${sm===m.id?'border-purple-500 bg-purple-50':'border-gray-200'}`}><span className="text-2xl mr-2">{m.icon}</span><span className="font-semibold">{m.name}</span></button>))}</div>
      </div>
      <div className="mb-6"><label className="block text-sm font-medium mb-2">上传产品图片(可选)</label>
        <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center relative"><input type="file" accept="image/*" onChange={(e:any)=>e.target.files?.[0]&&setGi(URL.createObjectURL(e.target.files[0]))} className="absolute inset-0 opacity-0 cursor-pointer" /><ImageIcon className="w-10 h-10 mx-auto text-gray-400" /></div>
      </div>
      <div className="mb-6"><div className="flex justify-between mb-2"><label className="text-sm font-medium">视频描述</label><button onClick={opt} className="text-purple-600 text-sm flex"><Sparkles className="w-4 h-4 mr-1"/>AI优化</button></div><textarea value={p} onChange={(e:any)=>setP(e.target.value)} className="w-full px-4 py-3 rounded-xl border min-h-[120px]" placeholder="描述视频内容..." /></div>
      {op&&<div className="mb-4 p-3 bg-purple-50 rounded-lg text-sm text-purple-600">✨ {op}</div>}
      <div className="mb-4 p-3 bg-amber-50 rounded-lg flex"><AlertCircle className="w-5 h-5 text-amber-500 mr-2"/><span className="text-sm">消耗50积分</span></div>
      <button onClick={og} disabled={ig||(!p&&!gi)} className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50">{ig?<><RefreshCw className="w-5 h-5 mr-2 animate-spin inline"/>生成中{Math.round(gp)}%</>:<><Sparkles className="w-5 h-5 mr-2 inline"/>生成视频</>}</button>
      {ig&&<div className="mt-4"><div className="h-2 bg-gray-200 rounded-full"><div className="h-full bg-gradient-to-r from-pink-500 to-purple-500" style={{width:`${gp}%`}}></div></div></div>}
    </div>
    <div className="bg-white rounded-2xl p-6 shadow-lg"><h2 className="text-xl font-bold mb-6">生成结果</h2>
      {gv?<div><video src={gv} className="w-full rounded-xl" controls/><div className="grid grid-cols-2 gap-4 mt-4"><button className="py-3 bg-gray-100 rounded-xl"><Play className="w-5 h-5 mr-2 inline"/>预览</button><button className="py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl"><Download className="w-5 h-5 mr-2 inline"/>下载</button></div></div>:ig?<div className="h-96 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed rounded-xl bg-gray-50"><RefreshCw className="w-16 h-16 animate-spin text-purple-500"/><p className="mt-4 text-lg text-purple-600 font-medium">视频生成中...</p><p className="text-sm text-gray-500">预计需要3-5分钟，请稍候</p><p className="text-xs text-gray-400 mt-2">任务ID: {generatedVideo || '提交成功'}</p></div>:<div className="h-96 flex items-center justify-center text-gray-400 border-2 border-dashed rounded-xl"><Video className="w-16 h-16 opacity-50"/></div>}
    </div>
  </div>)}

function Clone({uv,setUv,vp,setVp,sm,setSm,ig,gp,oc,gv,models}:any){
  return(<div className="grid lg:grid-cols-2 gap-8">
    <div className="bg-white rounded-2xl p-6 shadow-lg">
      <h2 className="text-xl font-bold mb-2">上传爆款视频</h2><p className="text-gray-500 mb-6">AI智能复刻</p>
      <div className="mb-6"><label className="block text-sm font-medium mb-3">选择模型</label><div className="grid grid-cols-2 gap-3">{models.slice(0,2).map((m:any)=>(<button key={m.id} onClick={()=>setSm(m.id)} className={`p-3 rounded-xl border-2 ${sm===m.id?'border-purple-500 bg-purple-50':'border-gray-200'}`}><span className="text-xl mr-2">{m.icon}</span><span>{m.name}</span></button>))}</div></div>
      <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center relative"><input type="file" accept="video/*" onChange={(e:any)=>{if(e.target.files?.[0]){setUv(e.target.files[0]);setVp(URL.createObjectURL(e.target.files[0]))}}} className="absolute inset-0 opacity-0 cursor-pointer"/><Upload className="w-12 h-12 mx-auto text-gray-400"/><p className="text-gray-500 mt-2">点击上传视频</p></div>
      {vp&&<div className="mt-6"><video src={vp} className="w-full rounded-xl" controls/><div className="mt-4 p-3 bg-amber-50 rounded-lg"><span className="text-sm">消耗80积分</span></div><button onClick={oc} disabled={ig} className="w-full mt-4 py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl disabled:opacity-50">{ig?<RefreshCw className="w-5 h-5 mr-2 animate-spin inline"/>:'✨ '}复刻{ig&&` ${Math.round(gp)}%`}</button></div>}
    </div>
    <div className="bg-white rounded-2xl p-6 shadow-lg"><h2 className="text-xl font-bold mb-6">生成结果</h2>
      {gv?<div><video src={gv} className="w-full rounded-xl" controls/></div>:<div className="h-64 flex items-center justify-center text-gray-400">结果将显示在这里</div>}
    </div>
  </div>)}

function History({history}:any){return(<div className="bg-white rounded-2xl p-6 shadow-lg"><h2 className="text-xl font-bold mb-6">我的视频库</h2><div className="grid md:grid-cols-3 gap-4">{history.map((h:any)=>(<div key={h.id} className="border rounded-xl p-4"><div className="h-32 bg-gray-200 rounded-lg mb-3 flex items-center justify-center">{h.status==='processing'?<RefreshCw className="w-8 h-8 animate-spin text-gray-400"/>:<Video className="w-8 h-8 text-gray-400"/>}</div><h3 className="font-medium">{h.title}</h3><p className="text-sm text-gray-500 flex justify-between mt-2"><span>{h.model}</span><span>{h.date}</span></p></div>))}</div></div>)}

function Credits({user,onR}:any){const pk=[{c:100,p:30},{c:500,p:128,pop:true},{c:1000,p:228}];return(<div className="max-w-2xl mx-auto"><div className="bg-white rounded-2xl p-8 shadow-lg"><h2 className="text-2xl font-bold text-center mb-6">积分充值</h2><div className="bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-6 mb-8"><div className="flex justify-between"><div><p className="text-gray-600">当前积分</p><p className="text-4xl font-bold text-pink-600">{user?.credits}</p></div><Zap className="w-16 h-16 text-pink-300"/></div></div><div className="grid grid-cols-3 gap-4 mb-8">{pk.map((p,i)=>(<button key={i} onClick={()=>onR(i)} className={`p-4 rounded-xl border-2 text-center ${p.pop?'border-pink-500 bg-pink-50':'border-gray-200'}`}>{p.pop&&<span className="text-xs bg-pink-500 text-white px-2 py-0.5 rounded-full">最热</span>}<p className="text-2xl font-bold mt-2">{p.c}</p><p className="text-gray-500">积分</p><p className="text-pink-600 font-bold">¥{p.p}</p></button>))}</div><button className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl">立即充值</button></div></div>)}

function Settings({user,setUser,useRealAPI,setUseRealAPI}:any){return(<div className="max-w-2xl mx-auto"><div className="bg-white rounded-2xl p-8 shadow-lg"><h2 className="text-2xl font-bold mb-6">账户设置</h2>
      <div className="space-y-4 mb-6">
        <div><label className="block text-sm font-medium mb-2">用户名</label><input type="text" defaultValue={user?.name} className="w-full px-4 py-3 rounded-xl border"/></div>
        <div><label className="block text-sm font-medium mb-2">邮箱</label><input type="email" defaultValue={user?.email} className="w-full px-4 py-3 rounded-xl border"/></div>
      </div>
      <div className="border-t pt-6">
        <h3 className="font-medium mb-4">API 设置</h3>
        <div className="p-4 bg-gray-50 rounded-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">小豆包API</p>
              <p className="text-sm text-gray-500">sk-Yn9a05...（已配置）</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-sm ${useRealAPI?'bg-green-100 text-green-700':'bg-gray-200 text-gray-500'}`}>
              {useRealAPI?'已启用':'未启用'}
            </div>
          </div>
        </div>
      </div>
      <button className="w-full py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl mt-6">保存修改</button>
    </div></div>)}

function Payment({pI,onC,onX}:any){return(<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-white rounded-2xl p-6 w-full max-w-md"><div className="flex justify-between mb-4"><h3 className="text-xl font-bold">确认支付</h3><button onClick={onX}><X className="w-5 h-5"/></button></div><p className="text-center text-2xl font-bold mb-6">¥{[30,128,228][pI||0]}</p><div className="flex justify-center space-x-4 mb-6"><CreditCard className="w-8 h-8 text-purple-500"/><WalletIcon className="w-8 h-8 text-gray-300"/></div><button onClick={onC} className="w-full py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl">确认支付</button></div></div>)}

export default App
