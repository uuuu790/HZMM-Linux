import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ExternalLink, Download, Star, Eye, Calendar, HardDrive } from 'lucide-react'
import { bbcodeToHtml } from '../../utils/bbcode'
import { formatCount, formatBytes, formatDate } from '../common/utils'

export default function SteamWorkshopDetailModal({ item, t, onClose }) {
  // Close on Escape (matches NexusModDetailModal). Declared before the early
  // return so the hook order stays stable across renders.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!item) return null
  const descriptionHtml = item.descriptionBBCode ? bbcodeToHtml(item.descriptionBBCode) : null

  const openInSteam = () => window.api.system.openExternal(item.url)
  const onBodyClick = (e) => {
    const a = e.target.closest('a')
    if (a && a.href) { e.preventDefault(); window.api.system.openExternal(a.href) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-3xl bg-white dark:bg-slate-900 shadow-2xl flex flex-col animate-slide-up" onClick={(e) => e.stopPropagation()}>
        {/* Banner */}
        <div className="relative h-44 sm:h-52 shrink-0 bg-gradient-to-br from-sky-500/30 to-indigo-600/30">
          {item.previewUrl && <img src={item.previewUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors">
            <X className="w-5 h-5" />
          </button>
          <h2 className="absolute bottom-4 left-6 right-6 text-2xl font-black text-white drop-shadow-lg line-clamp-2">{item.title}</h2>
        </div>

        {/* Stat row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3 border-b border-slate-200/60 dark:border-white/5 text-sm text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5" title={t.steamWorkshopSubscribers}><Download className="w-4 h-4" />{formatCount(item.subscriptions)}</span>
          <span className="flex items-center gap-1.5" title={t.steamWorkshopFavorites}><Star className="w-4 h-4" />{formatCount(item.favorited)}</span>
          <span className="flex items-center gap-1.5" title={t.steamWorkshopViews}><Eye className="w-4 h-4" />{formatCount(item.views)}</span>
          <span className="flex items-center gap-1.5" title={t.steamWorkshopUpdated}><Calendar className="w-4 h-4" />{formatDate(item.timeUpdated)}</span>
          <span className="flex items-center gap-1.5" title={t.steamWorkshopSize}><HardDrive className="w-4 h-4" />{formatBytes(item.fileSize)}</span>
          <button onClick={openInSteam} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors">
            <ExternalLink className="w-3.5 h-3.5" />{t.steamWorkshopOpenInSteam}
          </button>
        </div>

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-6 pt-3">
            {item.tags.map((tag) => (
              <span key={tag} className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">{tag}</span>
            ))}
          </div>
        )}

        {/* Description (reuses the Nexus BBCode styling) */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {descriptionHtml
            ? <div className="nexus-description" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
            : <p className="text-sm text-slate-400">—</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
