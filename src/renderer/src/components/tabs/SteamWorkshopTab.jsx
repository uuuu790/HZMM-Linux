import { useState, useEffect, useRef } from 'react'
import { Search, X, ChevronLeft, ChevronRight, Download, Hammer } from 'lucide-react'
import { formatCount } from '../common/utils'
import SteamWorkshopDetailModal from '../modals/SteamWorkshopDetailModal'

const SORTS = [
  { id: 'trend', labelKey: 'steamWorkshopSortTrend' },
  { id: 'toprated', labelKey: 'steamWorkshopSortTopRated' },
  { id: 'mostrecent', labelKey: 'steamWorkshopSortRecent' },
]

export default function SteamWorkshopTab({ t }) {
  const [sort, setSort] = useState('trend')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hasNext, setHasNext] = useState(false)
  const [selected, setSelected] = useState(null)
  const reqId = useRef(0)

  // Debounce the search box (300ms); reset to page 1 on change.
  useEffect(() => {
    const id = setTimeout(() => { setDebounced(search); setPage(1) }, 300)
    return () => clearTimeout(id)
  }, [search])

  // Reset to page 1 when the sort changes.
  useEffect(() => { setPage(1) }, [sort])

  // Load a page whenever sort / search / page / refresh changes.
  useEffect(() => {
    const myId = ++reqId.current
    setLoading(true); setError(false)
    window.api.steam.browse({ sort, page, search: debounced })
      .then((res) => {
        if (myId !== reqId.current) return // stale response
        if (res && res.ok) { setItems(res.items); setHasNext(res.hasNext) }
        else { setError(true); setItems([]) }
      })
      .catch(() => { if (myId === reqId.current) { setError(true); setItems([]) } })
      .finally(() => { if (myId === reqId.current) setLoading(false) })
  }, [sort, debounced, page, refreshKey])

  return (
    <div className="animate-slide-up">
      {/* Header: search + sort */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.steamWorkshopSearch}
            className="w-full pl-11 pr-10 py-2.5 rounded-full bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/50"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear" className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-1 p-1 rounded-full bg-slate-100 dark:bg-slate-800/60">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${sort === s.id ? 'bg-sky-500 text-white shadow' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              {t[s.labelKey]}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex justify-center py-32"><div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : error ? (
        <div className="flex flex-col items-center py-32 text-center">
          <p className="text-sm text-slate-500 mb-3">{t.steamWorkshopError}</p>
          <button onClick={() => setRefreshKey((k) => k + 1)} className="px-4 py-2 rounded-full bg-sky-500 text-white text-sm font-bold hover:bg-sky-600">{t.steamWorkshopRetry}</button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center py-32 text-center text-slate-400">
          <Hammer className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">{t.steamWorkshopEmpty}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {items.map((item) => (
              <button key={item.id} onClick={() => setSelected(item)} className="group text-left rounded-2xl overflow-hidden bg-white/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-white/5 hover:-translate-y-1 hover:shadow-lg transition-all">
                <div className="aspect-video bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  {item.previewUrl && <img src={item.previewUrl} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />}
                </div>
                <div className="p-3">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-2 mb-1.5">{item.title}</h3>
                  <span className="flex items-center gap-1.5 text-xs text-slate-500" title={t.steamWorkshopSubscribers}>
                    <Download className="w-3.5 h-3.5" />{formatCount(item.subscriptions)}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-center gap-4 mt-8">
            <button disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous" className="w-10 h-10 rounded-full bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-white/10 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sky-50 dark:hover:bg-slate-700">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-bold text-slate-500 tabular-nums">{page}</span>
            <button disabled={!hasNext} onClick={() => setPage((p) => p + 1)} aria-label="Next" className="w-10 h-10 rounded-full bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-white/10 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sky-50 dark:hover:bg-slate-700">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </>
      )}

      {selected && <SteamWorkshopDetailModal item={selected} t={t} onClose={() => setSelected(null)} />}
    </div>
  )
}
