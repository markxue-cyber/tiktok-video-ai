import { Video } from 'lucide-react'
import './landing-v2.css'

export type LandingV2Props = {
  onLogin: () => void
  onRegister: () => void
}

export function LandingV2({ onLogin, onRegister }: LandingV2Props) {
  const base = import.meta.env.BASE_URL || '/'
  const asset = (name: string) => `${base}landing-preview/assets/${name}`

  const goStart = () => onRegister()

  return (
    <div className="lg2-root">
      <header className="lg2-topbar">
        <div className="lg2-topbar-inner">
          <div className="lg2-brand">
            <div className="lg2-brand-mark" aria-hidden>
              <Video className="h-5 w-5" strokeWidth={2.25} />
            </div>
            <span className="lg2-brand-name">TikGen AI</span>
          </div>
          <div className="lg2-top-actions">
            <button type="button" className="lg2-btn-ghost" onClick={onLogin}>
              登录
            </button>
            <button type="button" className="lg2-btn-primary" onClick={onRegister}>
              注册
            </button>
          </div>
        </div>
      </header>

      <main className="lg2-wrap">
        <section className="lg2-hero">
          <span className="lg2-tag">电商AI增长引擎</span>
          <h1>
            用一张商品图
            <br />
            <span className="lg2-g">生成整套高转化内容资产</span>
          </h1>
          <p className="lg2-sub">
            面向跨境与品牌团队，把图像生产从「逐张手工」升级为「风格一致、批量产出、可复用」的自动化流水线。
            从商品套图、批量生图到商品视频，一次输入，持续放大流量效率。
          </p>
          <div className="lg2-cta-row">
            <button type="button" className="lg2-btn-main" onClick={goStart}>
              立即免费体验
            </button>
          </div>
        </section>

        <section className="lg2-modules" aria-label="产品功能">
          <article className="lg2-m">
            <div className="lg2-m-grid">
              <div className="lg2-media">
                <img className="lg2-main-img" src={asset('module-onetap.png')} alt="一键套图案例" />
              </div>
              <div className="lg2-m-info">
                <span className="lg2-k">一键套图</span>
                <span className="lg2-mini">电商套图</span>
                <h3>一图扩展全套上架素材</h3>
                <ul>
                  <li>A+、卖点、场景、特写一键生成</li>
                  <li>风格统一，直接可投放</li>
                </ul>
                <button type="button" className="lg2-m-cta" onClick={goStart}>
                  立即去使用
                </button>
              </div>
            </div>
          </article>

          <article className="lg2-m">
            <div className="lg2-m-grid lg2-flip">
              <div className="lg2-m-info">
                <span className="lg2-k">批量生图</span>
                <span className="lg2-mini">爆单常备</span>
                <h3>需求爆发也能稳定交付</h3>
                <ul>
                  <li>批量任务统一生产，效率更高</li>
                  <li>单图成本更低，团队更轻松</li>
                </ul>
                <button type="button" className="lg2-m-cta" onClick={goStart}>
                  立即去使用
                </button>
              </div>
              <div className="lg2-media">
                <img className="lg2-main-img" src={asset('module-batch.png')} alt="批量生图案例" />
              </div>
            </div>
          </article>

          <article className="lg2-m">
            <div className="lg2-m-grid">
              <div className="lg2-media">
                <img className="lg2-main-img" src={asset('module-bg-main.png')} alt="商品换背景案例" />
                <img className="lg2-thumb-img" src={asset('module-bg-thumb.png')} alt="原图参考" />
              </div>
              <div className="lg2-m-info">
                <span className="lg2-k">商品换背景</span>
                <span className="lg2-mini">场景升级</span>
                <h3>优质场景图，快速生成</h3>
                <ul>
                  <li>简单底图即可，AI 搭配逼真场景</li>
                  <li>减少场地与时间限制，凸显质感</li>
                </ul>
                <button type="button" className="lg2-m-cta" onClick={goStart}>
                  立即去使用
                </button>
              </div>
            </div>
          </article>

          <article className="lg2-m">
            <div className="lg2-m-grid lg2-flip">
              <div className="lg2-m-info">
                <span className="lg2-k">商品视频</span>
                <span className="lg2-mini">动态展示</span>
                <h3>让商品动起来，抢占视频流量</h3>
                <ul>
                  <li>仅需一张图，快速生成动态视频</li>
                  <li>适配平台主推视频位，提升点击</li>
                </ul>
                <button type="button" className="lg2-m-cta" onClick={goStart}>
                  立即去使用
                </button>
              </div>
              <div className="lg2-media">
                <img className="lg2-main-img" src={asset('module-video.png')} alt="商品视频案例" />
              </div>
            </div>
          </article>

          <article className="lg2-m">
            <div className="lg2-m-grid">
              <div className="lg2-media lg2-upscale">
                <div className="lg2-upscale-half">
                  <span className="lg2-cap">放大前</span>
                  <img src={asset('upscale-before.png')} alt="放大前" />
                </div>
                <div className="lg2-upscale-half">
                  <span className="lg2-cap">放大后</span>
                  <img src={asset('upscale-after.png')} alt="放大后" />
                </div>
              </div>
              <div className="lg2-m-info">
                <span className="lg2-k">高清放大</span>
                <span className="lg2-mini">细节还原</span>
                <h3>放大后仍清晰，细节可投放</h3>
                <ul>
                  <li>提升分辨率，边缘与纹理更利落</li>
                  <li>适合主图、放大查看与印刷物料</li>
                </ul>
                <button type="button" className="lg2-m-cta" onClick={goStart}>
                  立即去使用
                </button>
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}
