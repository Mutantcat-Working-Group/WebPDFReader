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
  const [controlsVisible, setControlsVisible] = useState<boolean>(true)
  const [isMobile, setIsMobile] = useState<boolean>(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const pageCanvasRefs = useRef<Array<HTMLCanvasElement | null>>([])
  const renderTaskMapRef = useRef<Map<number, any>>(new Map())
// 新增：可视页集合与渲染代数
  const visiblePagesRef = useRef<Set<number>>(new Set())
  const renderGenRef = useRef(0)

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

  // 加载文档
  useEffect(() => {
    let cancelled = false
    async function load() {
      setError(null)
      setPdf(null)
      setNumPages(0)
  setPageNumber(1)

      if (!urlParam) {
        setError('请指定 PDF 地址 - 本服务由mutantcat.org提供')
        return
      }

      setLoading(true)
      try {
        // 允许跨域；目标服务器需开启 CORS
        const loadingTask = pdfjsLib.getDocument({
          url: urlParam,
          withCredentials: false,
        })
        const doc: PDFDocumentProxy = await loadingTask.promise
        if (cancelled) return
        setPdf(doc)
        setNumPages(doc.numPages)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '加载 PDF 失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // 仅首次和 url 变化时执行
  }, [urlParam])

  // 渲染指定页到对应 canvas
  const renderPage = useCallback(async (
    doc: PDFDocumentProxy,
    pageNo: number,
    baseScale: number
  ) => {
    const container = containerRef.current
    const canvas = pageCanvasRefs.current[pageNo - 1]
    if (!container || !canvas) return

    const prevTask = renderTaskMapRef.current.get(pageNo)
    if (prevTask) {
      try { prevTask.cancel() } catch {}
      renderTaskMapRef.current.delete(pageNo)
    }

    const page: PDFPageProxy = await doc.getPage(pageNo)

    // 计算最终缩放：始终适配容器宽度 * 手动缩放
    const unscaledViewport = page.getViewport({ scale: 1 })
    const containerWidth = container.clientWidth
    const widthScale = containerWidth / unscaledViewport.width
    const finalScale = widthScale * baseScale
    const viewport = page.getViewport({ scale: finalScale })

    // 提前决定是否居中，避免初始左对齐闪动
    const pageWrapper = document.getElementById(`pdf-page-${pageNo}`)
    if (pageWrapper) {
      const shouldCenter = viewport.width <= container.clientWidth
      pageWrapper.classList.toggle('centered', shouldCenter)
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const renderTask = page.render({ canvasContext: ctx, viewport })
    renderTaskMapRef.current.set(pageNo, renderTask)
    await renderTask.promise
    renderTaskMapRef.current.delete(pageNo)
  }, [])

  // 在 pdf / 页码 / 缩放变化时渲染
  // 初次加载与缩放变化时渲染所有页（简单实现，可优化：懒加载/虚拟化）
  useEffect(() => {
    if (!pdf || !numPages) return
    for (let i = 1; i <= numPages; i++) {
      renderPage(pdf, i, scale)
    }
  }, [pdf, numPages, scale, renderPage])

  // 新增：用 IntersectionObserver 追踪可视页
  useEffect(() => {
    const container = containerRef.current
    if (!container || !numPages) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          const pageNo = Number(el.dataset.page)
          if (entry.isIntersecting) {
            visiblePagesRef.current.add(pageNo)
          } else {
            visiblePagesRef.current.delete(pageNo)
          }
        }
      },
      { root: container, threshold: 0.1, rootMargin: '200px 0px 200px 0px' }
    )
    const nodes = Array.from(container.querySelectorAll('[data-page]'))
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [numPages])

  // 新增：优先渲染可视页，其余分批渲染
  const renderPrioritized = useCallback(() => {
    if (!pdf || !numPages) return
    const gen = ++renderGenRef.current

    const all = Array.from({ length: numPages }, (_, i) => i + 1)
    const visible = Array.from(visiblePagesRef.current).sort((a, b) => a - b)
    const rest = all.filter((n) => !visible.includes(n))

    ;(async () => {
      // 先渲染可视页（顺序执行，保证尽快看到）
      for (const n of visible) {
        if (renderGenRef.current !== gen) return
        await renderPage(pdf, n, scale)
      }

      // 剩余页分批在空闲时渲染，降低卡顿
      const ric: any = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 0))
      let idx = 0
      function step() {
        if (renderGenRef.current !== gen) return
        const batch = rest.slice(idx, idx + 2) // 每次最多两页
        idx += batch.length
        batch.forEach((n) => renderPage(pdf, n, scale)) // 并行触发即可，会自行排队
        if (idx < rest.length) ric(step)
      }
      ric(step)
    })()
  }, [pdf, numPages, scale, renderPage])

  // 首次加载与缩放时触发优先渲染
  useEffect(() => {
    renderPrioritized()
  }, [renderPrioritized])

  // 窗口尺寸变化时也走优先渲染
  useEffect(() => {
    const onResize = () => renderPrioritized()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [renderPrioritized])

  // 平滑滚动到目标页（仅滚动内部容器）
  const scrollToPage = (target: number) => {
    const container = containerRef.current
    const el = document.getElementById(`pdf-page-${target}`)
    if (!container || !el) return
    const cRect = container.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const targetTop = container.scrollTop + (eRect.top - cRect.top)
    container.scrollTo({ top: targetTop, behavior: 'smooth' })
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
            {Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                id={`pdf-page-${i + 1}`}
                data-page={i + 1}
                className="pdf-page"
              >
                <canvas
                  ref={(el) => { pageCanvasRefs.current[i] = el }}
                  className="pdf-canvas"
                />
              </div>
            ))}
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
