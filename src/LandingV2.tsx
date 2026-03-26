import { useEffect, useRef } from 'react'
import { Video } from 'lucide-react'
import './landing-v2.css'

export type LandingV2Props = {
  onLogin: () => void
  onRegister: () => void
}

export function LandingV2({ onLogin, onRegister }: LandingV2Props) {
  const base = import.meta.env.BASE_URL || '/'
  const asset = (name: string) => `${base}landing-preview/assets/${name}`
  const onetapMosaicRef = useRef<HTMLDivElement>(null)
  const videoCaseSlides = [
    asset('video-traffic-case-1.png'),
    asset('video-traffic-case-2.png'),
    asset('video-traffic-case-3.png'),
    asset('video-traffic-case-4.png'),
    asset('video-traffic-case-5.png'),
  ]

  const goStart = () => onRegister()

  useEffect(() => {
    const root = onetapMosaicRef.current
    if (!root) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      root.classList.add('lg2-onetap--visible')
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            root.classList.add('lg2-onetap--visible')
            io.disconnect()
            break
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(root)
    return () => io.disconnect()
  }, [])

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
              <div
                ref={onetapMosaicRef}
                className="lg2-media lg2-onetap-mosaic"
                aria-label="一键套图案例：六张延展图，上三下三"
              >
                <div className="lg2-onetap-cell lg2-onetap-cell--lead">
                  <img src={asset('onetap-1.png')} alt="主场景：生活氛围图" loading="lazy" decoding="async" />
                  <span className="lg2-onetap-badge">1 张延展 · 多场景</span>
                </div>
                <div className="lg2-onetap-cell">
                  <img src={asset('onetap-2.png')} alt="室内场景图" loading="lazy" decoding="async" />
                </div>
                <div className="lg2-onetap-cell">
                  <img src={asset('onetap-3.png')} alt="对比与陈列构图" loading="lazy" decoding="async" />
                </div>
                <div className="lg2-onetap-cell">
                  <img src={asset('onetap-4.png')} alt="材质与细节特写" loading="lazy" decoding="async" />
                </div>
                <div className="lg2-onetap-cell">
                  <img src={asset('onetap-5.png')} alt="结构与工艺视角" loading="lazy" decoding="async" />
                </div>
                <div className="lg2-onetap-cell">
                  <img src={asset('onetap-6.png')} alt="白底主图风格" loading="lazy" decoding="async" />
                </div>
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
              <div className="lg2-media lg2-batch-film" aria-label="批量生图案例：并行产出胶片滚动">
                <div className="lg2-batch-film-inner">
                  <div className="lg2-batch-film-track">
                    <div className="lg2-batch-film-chunk">
                      <figure className="lg2-batch-film-panel">
                        <img src={asset('batch-case-1.png')} alt="批量产出：白底主图" loading="lazy" decoding="async" />
                        <figcaption>并行 01</figcaption>
                      </figure>
                      <figure className="lg2-batch-film-panel">
                        <img src={asset('batch-case-2.png')} alt="批量产出：外景氛围" loading="lazy" decoding="async" />
                        <figcaption>并行 02</figcaption>
                      </figure>
                      <figure className="lg2-batch-film-panel">
                        <img src={asset('batch-case-3.png')} alt="批量产出：花园场景" loading="lazy" decoding="async" />
                        <figcaption>并行 03</figcaption>
                      </figure>
                    </div>
                    <div className="lg2-batch-film-chunk" aria-hidden={true}>
                      <figure className="lg2-batch-film-panel">
                        <img src={asset('batch-case-1.png')} alt="" loading="lazy" decoding="async" />
                        <figcaption>并行 01</figcaption>
                      </figure>
                      <figure className="lg2-batch-film-panel">
                        <img src={asset('batch-case-2.png')} alt="" loading="lazy" decoding="async" />
                        <figcaption>并行 02</figcaption>
                      </figure>
                      <figure className="lg2-batch-film-panel">
                        <img src={asset('batch-case-3.png')} alt="" loading="lazy" decoding="async" />
                        <figcaption>并行 03</figcaption>
                      </figure>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </article>

          <article className="lg2-m">
            <div className="lg2-m-grid">
              <div className="lg2-media lg2-scene-stage" aria-label="优质场景案例：淡入轮播，完整展示">
                <div className="lg2-scene-viewport">
                  <img
                    className="lg2-scene-slide"
                    src={asset('scene-case-1.png')}
                    alt="场景案例：礼盒与陈列"
                    loading="lazy"
                    decoding="async"
                  />
                  <img
                    className="lg2-scene-slide"
                    style={{ animationDelay: '-4s' }}
                    src={asset('scene-case-2.png')}
                    alt="场景案例：白底产品"
                    loading="lazy"
                    decoding="async"
                  />
                  <img
                    className="lg2-scene-slide"
                    style={{ animationDelay: '-8s' }}
                    src={asset('scene-case-3.png')}
                    alt="场景案例：桌面氛围"
                    loading="lazy"
                    decoding="async"
                  />
                  <img
                    className="lg2-scene-slide"
                    style={{ animationDelay: '-12s' }}
                    src={asset('scene-case-4.png')}
                    alt="场景案例：叠杯特写"
                    loading="lazy"
                    decoding="async"
                  />
                  <img
                    className="lg2-scene-slide"
                    style={{ animationDelay: '-16s' }}
                    src={asset('scene-case-5.png')}
                    alt="场景案例：釉感细节"
                    loading="lazy"
                    decoding="async"
                  />
                  <img
                    className="lg2-scene-slide"
                    style={{ animationDelay: '-20s' }}
                    src={asset('scene-case-6.png')}
                    alt="场景案例：生活使用感"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <span className="lg2-scene-chip">多场景一键延展</span>
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
              <div className="lg2-media lg2-video-case" aria-label="商品视频案例图轮播，逐张淡入淡出">
                <div className="lg2-video-carousel">
                  {videoCaseSlides.map((src, idx) => (
                    <img
                      key={src}
                      className="lg2-video-slide"
                      src={src}
                      alt={`商品视频案例图 ${idx + 1}`}
                      loading={idx === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                    />
                  ))}
                </div>
              </div>
            </div>
          </article>

          <article className="lg2-m">
            <div className="lg2-m-grid">
              <div className="lg2-media lg2-upscale lg2-upscale-square">
                <div className="lg2-upscale-half">
                  <span className="lg2-cap">放大前</span>
                  <img src={asset('upscale-before.png')} alt="放大前：1:1 完整展示" />
                </div>
                <div className="lg2-upscale-half">
                  <span className="lg2-cap">放大后</span>
                  <img src={asset('upscale-after.png')} alt="放大后：1:1 完整展示" />
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

          <article className="lg2-m">
            <div className="lg2-m-grid">
              <div className="lg2-m-info">
                <span className="lg2-k">图片翻译</span>
                <span className="lg2-mini">跨境上架</span>
                <h3>主图文案一键译成目标市场语言</h3>
                <ul>
                  <li>尽量保留版式与视觉结构，减少重做多语言主图</li>
                  <li>适合多站点、多语种同步上新</li>
                </ul>
                <button type="button" className="lg2-m-cta" onClick={goStart}>
                  立即去使用
                </button>
              </div>
              <div className="lg2-media lg2-translate-stage" aria-label="图片翻译案例：中英文对比">
                <div className="lg2-translate-compare">
                  <figure className="lg2-translate-col">
                    <img src={asset('translate-zh.png')} alt="中文主图案例" loading="lazy" decoding="async" />
                    <figcaption>中文原稿</figcaption>
                  </figure>
                  <span className="lg2-translate-vs" aria-hidden>
                    ⇄
                  </span>
                  <figure className="lg2-translate-col">
                    <img src={asset('translate-en.png')} alt="译为英文后的主图" loading="lazy" decoding="async" />
                    <figcaption>English</figcaption>
                  </figure>
                </div>
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}
