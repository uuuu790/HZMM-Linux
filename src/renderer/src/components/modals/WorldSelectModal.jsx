import React, { useState, useMemo } from 'react'
import { Save, X, RefreshCw, Check } from 'lucide-react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { formatBytes } from '../common/utils'

const WorldSelectModal = ({ isOpen, onClose, worlds, loading, onConfirm, t }) => {
  useEscapeKey(onClose, isOpen)
  const [selectedWorlds, setSelectedWorlds] = useState(() => new Set())

  // Reset selection when worlds change (all selected by default)
  React.useEffect(() => {
    if (worlds && worlds.length > 0) {
      setSelectedWorlds(new Set(worlds.map((w) => w.name)))
    }
  }, [worlds])

  const totalSelectedSize = useMemo(() => {
    if (!worlds) return 0
    return worlds
      .filter((w) => selectedWorlds.has(w.name))
      .reduce((sum, w) => sum + (w.totalSize || 0), 0)
  }, [worlds, selectedWorlds])

  const allSelected = worlds && worlds.length > 0 && selectedWorlds.size === worlds.length

  const toggleWorld = (name) => {
    setSelectedWorlds((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (allSelected) {
      setSelectedWorlds(new Set())
    } else {
      setSelectedWorlds(new Set(worlds.map((w) => w.name)))
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-select-modal-title"
        className="relative w-full max-w-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border border-white/60 dark:border-slate-700/50 overflow-hidden animate-modal-spring"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <h3 id="world-select-modal-title" className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Save className="w-5 h-5" style={{ color: 'var(--accent-500)' }} />
            {t.backupSelectWorlds || 'Select Worlds to Backup'}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
              <RefreshCw
                className="w-8 h-8 animate-spin"
                style={{ color: 'var(--accent-500)' }}
              />
              <p className="text-sm font-medium">{t.backupScanning || 'Scanning saves...'}</p>
            </div>
          ) : worlds && worlds.length > 0 ? (
            <div className="flex flex-col gap-3">
              {/* Select All row */}
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40 cursor-pointer select-none"
                onClick={toggleAll}
              >
                <div
                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                    allSelected
                      ? 'border-transparent'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                  style={allSelected ? { backgroundColor: 'var(--accent-500)' } : {}}
                >
                  {allSelected && <Check className="w-3.5 h-3.5 text-white" />}
                </div>
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200 flex-1">
                  {t.backupSelectAll || 'Select All'}
                </span>
                <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                  {formatBytes(totalSelectedSize)}
                </span>
              </div>

              {/* World list */}
              {worlds.map((world) => {
                const checked = selectedWorlds.has(world.name)
                return (
                  <div
                    key={world.name}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-slate-200/60 dark:border-slate-700/40 cursor-pointer select-none hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                    onClick={() => toggleWorld(world.name)}
                  >
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                        checked
                          ? 'border-transparent'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                      style={checked ? { backgroundColor: 'var(--accent-500)' } : {}}
                    >
                      {checked && <Check className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                        {world.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                        {formatBytes(world.totalSize || 0)}
                        {world.lastModified && (
                          <span className="ml-2">
                            · {t.backupLastPlayed || 'Last played'}{' '}
                            {new Date(world.lastModified).toLocaleDateString()}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                )
              })}

              {/* Confirm button */}
              <button
                onClick={() => onConfirm(Array.from(selectedWorlds))}
                disabled={selectedWorlds.size === 0}
                className={`w-full py-3 mt-1 text-sm font-bold rounded-full text-white transition-all duration-300 active:scale-[0.98] shadow-md hover:shadow-lg ${
                  selectedWorlds.size === 0 ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                style={{
                  background:
                    'linear-gradient(to right, var(--gradient-from), var(--gradient-to))'
                }}
              >
                <Save className="w-4 h-4 inline mr-2" />
                {t.backupCreate || 'Create Backup'} ({selectedWorlds.size} {t.backupSelectedCount || 'selected'})
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
              <p className="text-sm font-medium">
                {t.backupNoWorlds || 'No world saves found'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default WorldSelectModal
