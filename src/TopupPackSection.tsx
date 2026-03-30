import { useEffect, useMemo, useState } from 'react'
import { Check, Zap } from 'lucide-react'
import { createOrder, getOrderStatus } from './api/payments'
import { Sentry } from './sentry'
import {
  CREDITS_PER_IMAGE,
  CREDITS_PER_VIDEO,
  TOPUP_CREDITS_PER_YUAN,
  TOPUP_PLAN_ID,
  creditsForTopupYuan,
  estimateImagesFromCredits,
  estimateVideosFromCredits,
} from './lib/billingCredits'

function xorpayQrImageSrc(qrPayload: string | undefined): string | null {
  const s = String(qrPayload || '').trim()
  if (!s) return null
  if (s.startsWith('data:image/')) return s
  if (/^https?:\/\//i.test(s) && /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(s)) return s
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(s)}`
}

export function TopupPackSection({
  onRefreshUser,
}: {
  onRefreshUser: () => Promise<void>
}) {
  const [amountRaw, setAmountRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [payError, setPayError] = useState('')
  const [checkingPaid, setCheckingPaid] = useState(false)
  const [payInfo, setPayInfo] = useState<{ orderId: string; qrcode?: string; payUrl?: string; status?: string } | null>(
    null,
  )
  const accessToken = typeof localStorage !== 'undefined' ? localStorage.getItem('tikgen.accessToken') || '' : ''

  const amountYuan = useMemo(() => {
    const n = parseInt(String(amountRaw || '').trim(), 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  }, [amountRaw])

  const preview = useMemo(() => {
    if (amountYuan <= 0) return { credits: 0, images: 0, videos: 0 }
    const credits = creditsForTopupYuan(amountYuan)
    return {
      credits,
      images: estimateImagesFromCredits(credits),
      videos: estimateVideosFromCredits(credits),
    }
  }, [amountYuan])

  useEffect(() => {
    if (!payInfo?.orderId || payInfo.status === 'paid') return
    let timer: ReturnType<typeof setTimeout> | null = null
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
        // ignore
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

  const onPay = async () => {
    setPayError('')
    if (amountYuan <= 0) {
      setPayError('请输入大于 0 的整数金额（元）。')
      return
    }
    if (!accessToken) {
      setPayError('请先登录')
      return
    }
    setBusy(true)
    try {
      const r = await createOrder({ planId: TOPUP_PLAN_ID, payType: 'alipay', amountYuan }, accessToken)
      Sentry.captureMessage('payment_topup_order_ok', { level: 'info', extra: { amountYuan } })
      setPayInfo({ orderId: r.orderId, qrcode: r.qrcode, payUrl: r.payUrl, status: 'created' })
    } catch (e: any) {
      Sentry.captureException(e, { extra: { scene: 'create_topup_order', amountYuan } })
      setPayError(e?.message || '下单失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="tikgen-panel rounded-2xl p-6 border border-white/10 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-white/95">积分加油包</h3>
          <p className="mt-1 text-sm text-white/60 leading-relaxed">
            按金额充值积分，支付成功后积分立即到账。兑换比例：1 元 = {TOPUP_CREDITS_PER_YUAN} 积分（单张图约 {CREDITS_PER_IMAGE}{' '}
            积分，单条视频约 {CREDITS_PER_VIDEO} 积分）。
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-white/75 mb-2">充值金额（元）</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="请输入正整数，例如 50"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value.replace(/\D/g, ''))}
            className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-lg font-medium text-white placeholder:text-white/35 focus:ring-2 focus:ring-violet-500/80 focus:border-violet-400/40 outline-none"
          />
        </div>

        {amountYuan > 0 ? (
          <div className="rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-500/20 via-fuchsia-500/10 to-white/[0.04] p-4 space-y-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-2 text-violet-200 font-semibold">
              <Zap className="w-5 h-5 text-amber-300/95 shrink-0" />
              预计获得 {preview.credits} 积分
            </div>
            <ul className="text-sm text-white/88 space-y-2">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  约可生成图片 {preview.images} 张（按每张 {CREDITS_PER_IMAGE} 积分估算）
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  约可生成视频 {preview.videos} 条（按每条 {CREDITS_PER_VIDEO} 积分估算）
                </span>
              </li>
            </ul>
          </div>
        ) : (
          <p className="text-sm text-white/45">输入金额后，将显示积分与可生成量预估。</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || amountYuan <= 0}
            onClick={() => void onPay()}
            className="px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? '下单中…' : '立即充值'}
          </button>
          <span className="text-sm text-white/50">当前仅支持支付宝</span>
        </div>

        {!!payError && (
          <div className="p-3 rounded-xl border border-red-400/35 bg-red-500/15 text-red-100 text-sm whitespace-pre-wrap">{payError}</div>
        )}
      </div>

      {payInfo && (
        <div className="mt-8 tikgen-panel rounded-2xl p-6 border border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-lg text-white/95">请扫码支付</div>
              <div className="text-sm text-white/55 mt-1">订单号：{payInfo.orderId}</div>
              <div className="text-sm mt-1 text-white/80">
                状态：
                <span className={`ml-1 font-medium ${payInfo.status === 'paid' ? 'text-emerald-400' : 'text-amber-300'}`}>
                  {payInfo.status === 'paid' ? '已支付，积分已到账' : '待支付'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPayInfo(null)}
              className="px-3 py-1.5 rounded-lg border border-white/15 text-white/85 text-sm hover:bg-white/[0.06]"
            >
              关闭
            </button>
          </div>
          <div className="mt-5 grid md:grid-cols-2 gap-6 items-center">
            <div className="flex flex-col items-center justify-center gap-2">
              {(() => {
                const src = xorpayQrImageSrc(payInfo.qrcode || payInfo.payUrl)
                return src ? (
                  <img src={src} alt="支付二维码" className="w-56 h-56 rounded-xl border border-white/15 bg-white object-contain" />
                ) : (
                  <div className="w-56 h-56 rounded-xl border border-white/12 bg-white/[0.04] flex items-center justify-center text-white/50 text-sm px-3 text-center">
                    未拿到支付串，请使用下方链接
                  </div>
                )
              })()}
            </div>
            <div>
              <div className="text-sm text-white/65 leading-relaxed">
                - 支付完成后积分自动入账
                <br />
                - 若二维码不可扫，可点击下方链接跳转支付
              </div>
              {payInfo.payUrl && (
                <a
                  href={payInfo.payUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold"
                >
                  打开支付页面
                </a>
              )}
              <button
                type="button"
                onClick={() => void checkPaidNow()}
                disabled={checkingPaid}
                className="mt-3 ml-0 md:ml-3 px-4 py-2 rounded-xl border border-white/18 text-white/90 font-medium hover:bg-white/[0.06] disabled:opacity-50"
              >
                {checkingPaid ? '检查中...' : '我已支付，检查到账'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
