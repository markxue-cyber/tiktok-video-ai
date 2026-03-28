# 首页对话出图：时效优化与模型选型（基于当前架构）

## 1. 现状（已实现）

| 环节 | 说明 |
|------|------|
| 第一轮 | 流式 GPT-4o 做电商结构化分析（`splitPipeline`） |
| 第二轮 | 原同步：`vision` 校验 → 提示词优化（GPT JSON）→ `nano-banana-2` 出图（经 `XIAO_DOU_BAO` 兼容 `/images/generations`） |
| **异步（新）** | 第二轮默认 `asyncImageGen`：立即 **202** + `imageJobId`，后台 `waitUntil` 跑同一套出图逻辑，结果写入 **`generation_tasks`**；前端 **轮询** `GET /api/home-chat-gen-status?id=` |

**效果**：浏览器不再长时间占用单次 `fetch`，避免网关/客户端先超时；后台仍在 **同一 Vercel 函数 `maxDuration` 预算**内执行（与 `waitUntil` 合计），极端慢时仍需 **队列/独立 Worker**（见下文）。

**关闭异步（调试用）**：请求体 `asyncImageGen: false` 或环境变量 `HOME_CHAT_SYNC_IMAGE_GEN=1`。

## 2. 根因回顾

- **主要耗时**：图像生成 API（常几十秒～两分钟+）+ 串行 GPT 调用；非 Supabase 记账。
- **Vercel**：单函数有 `maxDuration` 上限；同步 HTTP 拖到上限会 **504**。
- **治本方向**：异步化（已做第一步）+ 可选 **独立长任务运行时**（Cloud Run / Supabase Edge Cron / QStash + Worker）彻底脱离 Serverless 墙钟。

## 3. 模型与「国内是否更快」

当前代码已通过 **同一套 OpenAI 兼容网关**（`XIAO_DOU_BAO_AI_BASE_URL`）调 GPT 与画图模型；`api/image-generate.ts` 已对 **seedream / flux / nano-banana** 等做了 `reference_image` 等字段适配。

- **Seedream（即梦系图像）**：若网关提供 **`seedream*` 模型 id** 且国内节点更近，**RTT 与排队**可能优于海外链路；**单张耗时**仍取决于模型算力与队列，需 **A/B 实测 P50/P95**。
- **「Seedance」**：一般为 **视频** 能力品牌名，与 **静态商品图** 不是同一 SKU；选型时不要混用。
- **建议落地步骤**  
  1. 在 **`model_controls`** 里为首页默认图模增加可切换项（如 `nano-banana-2` vs `seedream-xxx`）。  
  2. `parseHomeParams` / 前端高级参数增加 **「出图模型」**（默认保持现网）。  
  3. 打 **`home_image_gen_ok` 埋点** 带 `model`、耗时，对比失败率与 P95。  
  4. **合规与画风**：换模后需复测商品一致性、白底/场景指令是否稳定。

**GPT 是否换国内**：分析质量与工具链成熟度通常仍选 **多模态 GPT-4o**；若换国内 LLM，需单独评估 **JSON 意图、结构化分析格式** 的稳定性，成本是改造成本而非单纯「更快」。

## 4. 后续可增强（按优先级）

1. **队列化**：`generation_tasks.status=queued` 由 **专用 Worker** 消费（不占用 `home-chat-turn` 的 `waitUntil` 预算）。  
2. **SSE/WebSocket**：用一条长连接推进度（「优化中 / 出图中」），替代纯轮询。  
3. **产品默认**：弱网默认 **1 张 + 预览**；多比例/A-B 高级项默认关（已有部分逻辑）。  
4. **提示词优化**：对「快捷指令」可走 **模板短路**，跳过 GPT 优化以省 5～20s。

## 5. 相关文件

- `api/home-chat-turn.ts` — 异步分支、`executeHomeChatImageJobInBackground`  
- `api/_homeChatImageJob.ts` — `generation_tasks` 读写  
- `GET /api/home-chat-gen-status`（`vercel.json` rewrite 到 `home-chat-turn`，与 POST 共用同一函数）— 轮询查询  
- `src/api/homeChat.ts` — `homeChatGenStatusAPI`  
- `src/HomeChatModule.tsx` — 轮询与错误码  
- `vercel.json` — `maxDuration`  
