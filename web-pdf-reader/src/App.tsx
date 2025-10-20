import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import './App.css'

// pdf.js
import * as pdfjsLib from 'pdfjs-dist'
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

type PDFDocumentProxy = any
type PDFPageProxy = any

function App() {
  const urlParam = useMemo(() => {
    const u = new URLSearchParams(window.location.search).get('url') || ''
    if (!u || !/^https?:\/\//i.test(u)) return ''
    return u
  }, [])

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState<number>(1)
  const [numPages, setNumPages] = useState<number>(0)
  const [scale, setScale] = useState<number>(0.9) // 默认 90%
  const [controlsVisible, setControlsVisible] = useState<boolean>(true)
  const [isMobile, setIsMobile] = useState<boolean>(false)

  const containerRef = useRef<HTMLDivElement | null>(null)

  // 仅为已挂载页保存 canvas 引用：pageNo -> canvas
  const pageCanvasRefs = useRef<Map<number, HTMLCanvasElement | null>>(new Map())
  // 每页的渲染任务
  const renderTaskMapRef = useRef<Map<number, any>>(new Map())
  // 已渲染代号（避免重复重绘）
  const renderedGenRef = useRef<Map<number, number>>(new Map())
  const renderGenRef = useRef(0)

  // 可视页集合、已挂载页集合（用于虚拟化）
  const visiblePagesRef = useRef<Set<number>>(new Set())
  const [mountedPages, setMountedPages] = useState<Set<number>>(new Set())

  // 估算高度：用第一页的宽高比作为默认比值，未测量页面用估算撑高
  const pageHeightsRef = useRef<Map<number, number>>(new Map())
  const avgRatioRef = useRef<number>(1.414) // 默认近似 A4 纵向

  // 渲染并发与缓冲
  const runningRef = useRef(0)
  const queueRef = useRef<number[]>([])
  const MAX_CONCURRENCY = (navigator as any)?.hardwareConcurrency && (navigator as any).hardwareConcurrency <= 4 ? 1 : 2
  const BUFFER = 2 // 可视前后缓冲页数

  // 配置 pdf.js worker
  useEffect(() => {
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker
  }, [])

  // 移动端检测
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 480px)')
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener?.('change', update as any)
    ;(mql as any).addListener?.(update)
    return () => {
      mql.removeEventListener?.('change', update as any)
      ;(mql as any).removeListener?.(update)
    }
  }, [])

  // 估算高度（未渲染页使用）
  const estimateHeightPx = useCallback(() => {
    const container = containerRef.current
    if (!container) return 800
    const w = container.clientWidth
    return Math.max(1, Math.floor(w * scale * avgRatioRef.current))
  }, [scale])

  // 加载文档（范围请求，禁预取）
  useEffect(() => {
    let cancelled = false
    async function load() {
      setError(null)
      setPdf(null)
      setNumPages(0)
      setPageNumber(1)
      pageHeightsRef.current.clear()
      renderedGenRef.current.clear()
      renderGenRef.current++

      if (!urlParam) { setError('请通过 ?url=https://example.com/file.pdf 指定 PDF 地址'); return }

      setLoading(true)
      try {
        const sp = new URLSearchParams(window.location.search)
        const sendCreds = sp.get('cred') === '1' || sp.get('credentials') === 'include'
        const auth = sp.get('auth')
        const headers = auth ? { Authorization: decodeURIComponent(auth) } : undefined

        const loadingTask = pdfjsLib.getDocument({
          url: urlParam,
          withCredentials: sendCreds,
          httpHeaders: headers,
          disableAutoFetch: true,
          rangeChunkSize: 65536,
          disableStream: false,
        })
        const doc: PDFDocumentProxy = await loadingTask.promise
        if (cancelled) return

        // 取第一页比值作为估算
        try {
          const p1: PDFPageProxy = await doc.getPage(1)
          const vp = p1.getViewport({ scale: 1 })
          if (vp && vp.width > 0) avgRatioRef.current = vp.height / vp.width
        } catch {}

        setPdf(doc)
        setNumPages(doc.numPages)

        // 初次挂载首屏附近少量页，避免空白
        setMountedPages(new Set([1, 2, 3, 4, 5]))
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '加载 PDF 失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [urlParam])

  // 渲染指定页（等比；在绘制前决定居中与占位；记录高度）
  const renderPage = useCallback(async (doc: PDFDocumentProxy, pageNo: number, baseScale: number, gen: number) => {
    const container = containerRef.current
    const canvas = pageCanvasRefs.current.get(pageNo) || null
    if (!container || !canvas) return
    if (renderedGenRef.current.get(pageNo) === gen) return
    if (!mountedPages.has(pageNo)) return

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
      wrapper.classList.add('mounted')
      wrapper.classList.add('loading') // 开始渲染：进入 loading
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 先隐藏默认 300x150 小白框，等设置好尺寸再显示
    canvas.style.display = 'none'

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 尺寸就绪后再展示
    canvas.style.display = 'block'

    const task = page.render({ canvasContext: ctx, viewport })
    renderTaskMapRef.current.set(pageNo, task)
    try {
      await task.promise
      renderedGenRef.current.set(pageNo, gen)
      pageHeightsRef.current.set(pageNo, Math.floor(viewport.height))
    } finally {
      renderTaskMapRef.current.delete(pageNo)
      // 结束渲染：退出 loading
      const w = document.getElementById(`pdf-page-${pageNo}`)
      w?.classList.remove('loading')
    }
  }, [mountedPages])

  // 并发队列
  const pump = useCallback(() => {
    if (!pdf) return
    while (runningRef.current < MAX_CONCURRENCY && queueRef.current.length) {
      const n = queueRef.current.shift()!
      // 若该页不再需要，跳过
      if (!mountedPages.has(n)) continue
      runningRef.current++
      renderPage(pdf, n, scale, renderGenRef.current).finally(() => {
        runningRef.current--
        pump()
      })
    }
  }, [pdf, renderPage, scale, mountedPages])

  // 计划渲染：可视页 + 缓冲；同时更新“挂载页”集合
  const schedule = useCallback(() => {
    if (!pdf || !numPages) return
    const gen = renderGenRef.current
    const vis = Array.from(visiblePagesRef.current).sort((a, b) => a - b)
    const set = new Set<number>(vis)
    const add = (n: number) => { if (n >= 1 && n <= numPages) set.add(n) }
    for (const n of vis) for (let i = 1; i <= BUFFER; i++) { add(n - i); add(n + i) }
    if (set.size === 0) { set.add(1); set.add(2) } // 兜底

    // 更新挂载页（避免频繁 setState：只有变化时才更新）
    setMountedPages(prev => {
      let changed = prev.size !== set.size
      if (!changed) for (const v of set) { if (!prev.has(v)) { changed = true; break } }
      return changed ? new Set(set) : prev
    })

    // 构建绘制队列：仅需更新到最新代号的页
    queueRef.current = Array.from(set).filter(n => renderedGenRef.current.get(n) !== gen)
    queueRef.current.sort((a, b) => a - b)
    pump()
  }, [pdf, numPages, pump])

  // 观察可视页（rootMargin 大一些，提前准备）
  useEffect(() => {
    const container = containerRef.current
    if (!container || !numPages) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const n = Number((e.target as HTMLElement).dataset.page)
        if (e.isIntersecting) visiblePagesRef.current.add(n)
        else visiblePagesRef.current.delete(n)
      }
      schedule()
    }, { root: container, threshold: 0.01, rootMargin: '600px 0px 600px 0px' })
    const nodes = Array.from(container.querySelectorAll('[data-page]'))
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [numPages, schedule])

  // 尺寸或缩放变化：刷新代号，仅渲染窗口内页
  useEffect(() => {
    const onResize = () => {
      renderedGenRef.current.clear()
      pageHeightsRef.current.clear()
      renderGenRef.current++
      schedule()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [schedule])

  useEffect(() => {
    renderedGenRef.current.clear()
    pageHeightsRef.current.clear()
    renderGenRef.current++
    schedule()
  }, [scale, schedule])

  // 当挂载集合变化：取消不再需要的渲染任务（节流负载）
  useEffect(() => {
    for (const [pageNo, task] of renderTaskMapRef.current) {
      if (!mountedPages.has(pageNo)) {
        try { task.cancel() } catch {}
        renderTaskMapRef.current.delete(pageNo)
      }
    }
    // 继续推进绘制
    pump()
  }, [mountedPages, pump])

  // 翻页：只滚动内部容器
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
  const zoomIn = () => setScale((s) => Math.min(5, +(s + 0.2).toFixed(2)))
  const zoomOut = () => setScale((s) => Math.max(0.2, +(s - 0.2).toFixed(2)))

  // 仅基于“已挂载页”估算当前页，避免遍历所有节点
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = () => {
      const pages = Array.from(container.querySelectorAll('.pdf-page.mounted')) as HTMLElement[]
      const containerTop = container.getBoundingClientRect().top
      let current = pageNumber
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
    handler()
    return () => container.removeEventListener('scroll', handler)
  }, [pageNumber])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} className="pdf-scroll-container">
        {loading && <div style={{ color: '#333', padding: 12 }}>正在加载 PDF...</div>}
        {error && <div style={{ color: 'crimson', padding: 12 }}>{error}</div>}
        {!error && pdf && (
          <div>
            {Array.from({ length: numPages }, (_, i) => {
              const pageNo = i + 1
              const mounted = mountedPages.has(pageNo)
              const placeholderH = pageHeightsRef.current.get(pageNo) ?? estimateHeightPx()
              return (
                <div
                  key={pageNo}
                  id={`pdf-page-${pageNo}`}
                  data-page={pageNo}
                  className={`pdf-page${mounted ? ' mounted loading' : ' loading'}`} // 未挂载或渲染中都显示骨架
                  style={!mounted ? { height: `${placeholderH}px` } : undefined}
                >
                  {mounted ? (
                    <canvas
                      ref={(el) => {
                        if (el) pageCanvasRefs.current.set(pageNo, el)
                        else pageCanvasRefs.current.delete(pageNo)
                      }}
                      className="pdf-canvas"
                    />
                  ) : null}
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
            <span style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>
              缩放: {`${Math.round(scale * 100)}%`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
