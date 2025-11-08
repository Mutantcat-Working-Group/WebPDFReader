import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import './App.css'

// pdf.js
import * as pdfjsLib from 'pdfjs-dist'
// 使用 Vite 等现代打包器，把 worker 当作静态资源 URL 引入
// 若使用不同打包器，请根据其文档替换 '?url' 方案
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

type PDFDocumentProxy = any
type PDFPageProxy = any

function App() {
  const urlParam = useMemo(() => {
    const u = new URLSearchParams(window.location.search).get('url') || ''
    // 只允许 http/https
    if (!u || !/^https?:\/\//i.test(u)) return ''
    return u
  }, [])

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState<number>(1)
  const [numPages, setNumPages] = useState<number>(0)
  const [scale, setScale] = useState<number>(0.9) // base scale for manual zoom (default 90%)
  const scaleRef = useRef<number>(0.9)
  const [controlsVisible, setControlsVisible] = useState<boolean>(true)
  const [isMobile, setIsMobile] = useState<boolean>(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const pageCanvasRefs = useRef<Array<HTMLCanvasElement | null>>([])
  const renderTaskMapRef = useRef<Map<number, any>>(new Map())
  const visiblePagesRef = useRef<Set<number>>(new Set())
  const renderedGenRef = useRef<Map<number, number>>(new Map()) // 记录每页已用的代号
  const renderGenRef = useRef(0)
  const queueRef = useRef<number[]>([])
  const runningRef = useRef(0)
  const MAX_CONCURRENCY = 2
  const BUFFER = 2 // 可视前后缓冲页数

  const cancelAllRenderTasks = useCallback(() => {
    for (const [, task] of renderTaskMapRef.current) {
      try { task.cancel() } catch {}
    }
    renderTaskMapRef.current.clear()
  }, [])

  // 始终保存最新缩放到 ref，避免闭包中读取到旧值导致重绘尺寸回退
  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  // 配置 pdf.js worker
  useEffect(() => {
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker
  }, [])

  // 监听屏幕宽度以适配移动端（隐藏标题，缩放按钮用 +/-，尽量单行显示）
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 480px)')
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile((e as MediaQueryList).matches ?? (e as MediaQueryListEvent).matches)
    // 初始
    setIsMobile(mql.matches)
    // 监听变更（兼容老浏览器）
    if (mql.addEventListener) {
      mql.addEventListener('change', update as (this: MediaQueryList, ev: MediaQueryListEvent) => any)
    } else if ((mql as any).addListener) {
      ;(mql as any).addListener(update)
    }
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', update as (this: MediaQueryList, ev: MediaQueryListEvent) => any)
      } else if ((mql as any).removeListener) {
        ;(mql as any).removeListener(update)
      }
    }
  }, [])

  // 加载文档（启用范围请求并禁用自动预取）
  useEffect(() => {
    let cancelled = false
    async function load() {
      setError(null)
      setPdf(null)
      setNumPages(0)
      setPageNumber(1)
      if (!urlParam) { setError('请通过 ?url=https://example.com/file.pdf 指定 PDF 地址，本服务由 mutantcat.org 提供'); return }

      setLoading(true)
      try {
        const sp = new URLSearchParams(window.location.search)
        const sendCreds = sp.get('cred') === '1' || sp.get('credentials') === 'include'
        const auth = sp.get('auth')
        const headers = auth ? { Authorization: decodeURIComponent(auth) } : undefined

        // 规范化 URL，确保空格等字符被编码
        const normalizedUrl = encodeURI(urlParam)

        async function tryGetDocument(opts: any) {
          const task = pdfjsLib.getDocument({
            url: normalizedUrl,
            withCredentials: sendCreds,
            httpHeaders: headers,
            ...opts,
          })
          return await task.promise
        }

        let doc: PDFDocumentProxy | null = null
        try {
          // 首选（更快）：启用流式与 Range
          doc = await tryGetDocument({
            disableAutoFetch: true,
            disableStream: false,
            rangeChunkSize: 65536,
          })
        } catch (e: any) {
          console.warn('[PDF] 首选加载失败，尝试无 Range 回退: ', e)
          // 回退（更兼容）：禁用 Stream/Range，避免跨域/预检不通过
          doc = await tryGetDocument({
            disableAutoFetch: false,
            disableStream: true,
            disableRange: true,
          })
        }

        if (cancelled) return
        setPdf(doc)
        setNumPages(doc.numPages)
        renderedGenRef.current.clear()
        renderGenRef.current++
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '加载 PDF 失败（可能为 CORS/Range 不被允许）')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [urlParam])

  // 渲染指定页（保持等比，先决定是否居中）
  const renderPage = useCallback(async (doc: PDFDocumentProxy, pageNo: number, baseScale: number, gen: number) => {
    const container = containerRef.current
    const canvas = pageCanvasRefs.current[pageNo - 1]
    if (!container || !canvas) return
    if (renderedGenRef.current.get(pageNo) === gen) return // 已是最新

    const prevTask = renderTaskMapRef.current.get(pageNo)
    if (prevTask) { try { prevTask.cancel() } catch {} renderTaskMapRef.current.delete(pageNo) }

    const page: PDFPageProxy = await doc.getPage(pageNo)
    const unscaledViewport = page.getViewport({ scale: 1 })
    const containerWidth = container.clientWidth
    const widthScale = containerWidth / unscaledViewport.width
    const finalScale = widthScale * baseScale
    const viewport = page.getViewport({ scale: finalScale })

    const wrapper = document.getElementById(`pdf-page-${pageNo}`)
    if (wrapper) {
      const shouldCenter = viewport.width <= container.clientWidth
      wrapper.classList.toggle('centered', shouldCenter)
    }

  const ctx = canvas.getContext('2d')
    if (!ctx) return

  // 为避免在部分安卓/国产浏览器上超出 Canvas 尺寸/面积上限导致白屏，
  // 动态下调实际渲染像素密度（有效 DPR），CSS 尺寸保持不变
  const dpr = window.devicePixelRatio || 1
  // 经验上限：部分 Android/WebView 设备在 4096~8192 维度、~16MP 面积存在限制
  const ua = navigator.userAgent || ''
  const isConservativeDevice = /Android|Lenovo|Pad|ZUI|TB-|TB\-|PAD/i.test(ua)
  const MAX_DIM = isConservativeDevice ? 4096 : 8192
  const MAX_PIXELS = 16_000_000 // 约 16MP

  const targetPixelW = viewport.width * dpr
  const targetPixelH = viewport.height * dpr
  const area = targetPixelW * targetPixelH

  // 计算需要缩放的比例（<=1）
  const dimFactor = Math.min(1, MAX_DIM / Math.max(targetPixelW, targetPixelH))
  const areaFactor = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(area, 1)))
  const factor = Math.max(0.5, Math.min(dimFactor, areaFactor)) // 下限 0.5，避免过糊
  const effectiveDpr = dpr * factor

  const pixelW = Math.max(1, Math.floor(viewport.width * effectiveDpr))
  const pixelH = Math.max(1, Math.floor(viewport.height * effectiveDpr))
  canvas.width = pixelW
  canvas.height = pixelH
  // 保持布局尺寸不变（由浏览器缩放像素到 CSS 尺寸）
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`
  ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0)

    const task = page.render({ canvasContext: ctx, viewport })
    renderTaskMapRef.current.set(pageNo, task)
    await task.promise
    renderTaskMapRef.current.delete(pageNo)
    renderedGenRef.current.set(pageNo, gen)
  }, [])

  // 不再全量渲染，交由可视调度

  // 简单并发队列（提前声明，供 schedule 调用）
  const pump = useCallback(() => {
    if (!pdf) return
    while (runningRef.current < MAX_CONCURRENCY && queueRef.current.length) {
      const n = queueRef.current.shift()!
      runningRef.current++
      const baseScale = scaleRef.current
      renderPage(pdf, n, baseScale, renderGenRef.current).finally(() => {
        runningRef.current--
        pump()
      })
    }
  }, [pdf, renderPage])

  // 只渲染可视页+缓冲，不再后台全量渲染
  const schedule = useCallback(() => {
    if (!pdf || !numPages) return
    const gen = renderGenRef.current
    const container = containerRef.current
    if (!container) return

    // 直接扫描当前屏幕内的页（避免依赖 IO 的时序导致可视集合为空）
    const cRect = container.getBoundingClientRect()
    const margin = 600 // 与 IO 一致的预加载边距
    const nodes = Array.from(container.querySelectorAll('[data-page]')) as HTMLElement[]
    const vis = nodes
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const topIn = r.bottom >= cRect.top - margin
        const bottomIn = r.top <= cRect.bottom + margin
        return topIn && bottomIn
      })
      .map((el) => Number(el.dataset.page))
      .sort((a, b) => a - b)
    const set = new Set<number>(vis)
    const add = (n: number) => { if (n >= 1 && n <= numPages) set.add(n) }
    for (const n of vis) for (let i = 1; i <= BUFFER; i++) { add(n - i); add(n + i) }

    // 无论是否在可视集合内，确保当前页及邻居加入（避免可视集合偶发为空导致不重绘）
    add(pageNumber)
    for (let i = 1; i <= BUFFER; i++) { add(pageNumber - i); add(pageNumber + i) }

    // 构建队列（未最新渲染的页）
    const candidates = Array.from(set).filter(n => renderedGenRef.current.get(n) !== gen)
    // 按距离当前页排序，优先当前页附近，提升交互感知
    candidates.sort((a, b) => Math.abs(a - pageNumber) - Math.abs(b - pageNumber))
    queueRef.current = candidates
    pump()
  }, [pdf, numPages, pageNumber, pump])

  // pump 已上移

  // 计算当前可见页（含一定边距）
  const getVisiblePages = useCallback((): number[] => {
    const container = containerRef.current
    if (!container) return []
    const cRect = container.getBoundingClientRect()
    const margin = 200
    const nodes = Array.from(container.querySelectorAll('[data-page]')) as HTMLElement[]
    return nodes
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const topIn = r.bottom >= cRect.top - margin
        const bottomIn = r.top <= cRect.bottom + margin
        return topIn && bottomIn
      })
      .map((el) => Number(el.dataset.page))
      .sort((a, b) => a - b)
  }, [])

  // 立即强制重绘当前屏的页（用于点击缩放后立刻生效）
  const forceRerenderVisibleNow = useCallback((nextScale: number) => {
    if (!pdf || !numPages) return
    const container = containerRef.current
    const ratio = nextScale / scale

    // 先立刻调整当前屏幕内画布的 CSS 宽高，保证“纸张外框/页高”立即变化（影响布局）
    if (container && isFinite(ratio) && ratio > 0) {
      const visible = getVisiblePages()
      for (const n of visible) {
        const idx = n - 1
        const canvas = pageCanvasRefs.current[idx]
        const wrapper = document.getElementById(`pdf-page-${n}`)
        if (!canvas || !wrapper) continue
        // 清除可能存在的临时 transform（老版本残留）
        canvas.style.transform = ''
        delete (canvas as any).dataset?.tmpScale
        const currW = parseFloat(canvas.style.width || '') || canvas.getBoundingClientRect().width
        const currH = parseFloat(canvas.style.height || '') || canvas.getBoundingClientRect().height
        if (currW && currH) {
          const newW = Math.max(1, Math.round(currW * ratio))
          const newH = Math.max(1, Math.round(currH * ratio))
          canvas.style.width = `${newW}px`
          canvas.style.height = `${newH}px`
          // 根据新宽度预判是否需要居中
          const shouldCenter = newW <= container.clientWidth
          wrapper.classList.toggle('centered', shouldCenter)
        }
      }
    }

    // 新一代渲染，取消旧任务，再用 nextScale 重绘可见+邻居
    renderGenRef.current++
    cancelAllRenderTasks()
    const gen = renderGenRef.current
    const set = new Set<number>(getVisiblePages())
    const add = (n: number) => { if (n >= 1 && n <= numPages) set.add(n) }
    // 加入当前页邻居，避免临界区域未渲染
    add(pageNumber)
    for (let i = 1; i <= BUFFER; i++) { add(pageNumber - i); add(pageNumber + i) }
    // 直接同步触发这些页的绘制
    const list = Array.from(set).sort((a, b) => Math.abs(a - pageNumber) - Math.abs(b - pageNumber))
    list.forEach((n) => { void renderPage(pdf, n, nextScale, gen) })
  }, [pdf, numPages, pageNumber, BUFFER, cancelAllRenderTasks, getVisiblePages, renderPage, scale])

  // 观察可视页（更大的 rootMargin 让首屏更早渲染）
  useEffect(() => {
    const container = containerRef.current
    if (!container || !numPages) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page)
          if (e.isIntersecting) visiblePagesRef.current.add(n)
          else visiblePagesRef.current.delete(n)
        }
        schedule()
      },
      { root: container, threshold: 0.01, rootMargin: '600px 0px 600px 0px' }
    )
    const nodes = Array.from(container.querySelectorAll('[data-page]'))
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [numPages, schedule])

  // 缩放或窗口变化：仅刷新可视页+缓冲
  useEffect(() => {
    const onResize = () => { renderGenRef.current++; schedule() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [schedule])

  useEffect(() => {
    renderGenRef.current++
    cancelAllRenderTasks()
    schedule()
  }, [scale, schedule, cancelAllRenderTasks])

  // 翻页时滚动到内部容器，避免连带外层 iframe 滚动
  const scrollToPage = (target: number) => {
    const container = containerRef.current
    const el = document.getElementById(`pdf-page-${target}`)
    if (!container || !el) return
    const cRect = container.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const top = container.scrollTop + (eRect.top - cRect.top)
    container.scrollTo({ top, behavior: 'smooth' })
  }

  const goPrev = () => {
    setPageNumber((p) => {
      const n = Math.max(1, p - 1)
      scrollToPage(n)
      return n
    })
  }
  const goNext = () => {
    setPageNumber((p) => {
      const n = Math.min(numPages || p, p + 1)
      scrollToPage(n)
      return n
    })
  }
  const zoomIn = () => {
    const next = Math.min(5, +(scale + 0.2).toFixed(2))
    // 先同步更新 ref，确保后续调度使用最新缩放
    scaleRef.current = next
    setScale(next)
    forceRerenderVisibleNow(next)
  }
  const zoomOut = () => {
    const next = Math.max(0.2, +(scale - 0.2).toFixed(2))
    scaleRef.current = next
    setScale(next)
    forceRerenderVisibleNow(next)
  }

  // 根据滚动位置更新当前页码（简单估算：找到顶部最近的页）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = () => {
      const pages = Array.from(container.querySelectorAll('[data-page]')) as HTMLElement[]
      const containerTop = container.getBoundingClientRect().top
      let current = 1
      let minDelta = Number.POSITIVE_INFINITY
      for (const el of pages) {
        const rect = el.getBoundingClientRect()
        const delta = Math.abs(rect.top - containerTop)
        if (delta < minDelta) {
          minDelta = delta
          current = Number(el.dataset.page)
        }
      }
      setPageNumber(current)
    }
    container.addEventListener('scroll', handler)
    // 初始触发一次
    handler()
    return () => container.removeEventListener('scroll', handler)
  }, [])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} className="pdf-scroll-container">
        {loading && <div style={{ color: '#fff', padding: 12 }}>正在加载 PDF...</div>}
        {error && <div style={{ color: 'crimson', padding: 12 }}>{error}</div>}
        {!error && pdf && (
          <div>
            {Array.from({ length: numPages }, (_, i) => {
              const pageNo = i + 1
              // 若当前未渲染完成，给容器加 skeleton 类保证空白页居中
              const classes = ['pdf-page']
              if (!renderedGenRef.current.has(pageNo)) classes.push('skeleton')
              // 当缩放比例 <= 1 时，所有页面都应水平居中
              if (scale <= 1) classes.push('centered')
              return (
                <div
                  key={i}
                  id={`pdf-page-${pageNo}`}
                  data-page={pageNo}
                  className={classes.join(' ')}
                >
                  {/* 仅当进入可视区+缓冲后才提供 canvas 节点，避免过多 DOM 与绘制 */}
                  <canvas
                    ref={(el) => { pageCanvasRefs.current[i] = el }}
                    className="pdf-canvas"
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Toggle button for controls visibility */}
      <button
        className="pdf-toggle-visibility"
        onClick={() => setControlsVisible((v) => !v)}
        aria-label="切换工具栏"
      >
        {controlsVisible ? '隐藏工具' : '显示工具'}
      </button>

      {/* Floating bottom controls */}
      {controlsVisible && (
        <div className="pdf-controls">
          <div className="pdf-controls-inner">
            <button className="nav-btn" onClick={goPrev} disabled={!pdf || pageNumber <= 1}>上一页</button>
            <button className="nav-btn" onClick={goNext} disabled={!pdf || pageNumber >= numPages}>下一页</button>
            <span style={{ marginLeft: 8 }}>
              {isMobile
                ? `${pdf ? pageNumber : '-'} / ${pdf ? numPages : '-'}`
                : `第 ${pdf ? pageNumber : '-'} / ${pdf ? numPages : '-'} 页`}
            </span>
            <span style={{ width: 12 }} />
            <button className="zoom-btn" onClick={zoomOut} disabled={!pdf}>{isMobile ? '-' : '缩小'}</button>
            <button className="zoom-btn" onClick={zoomIn} disabled={!pdf}>{isMobile ? '+' : '放大'}</button>
            <span style={{ marginLeft: 8 }}>
              缩放: {`${Math.round(scale * 100)}%`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
