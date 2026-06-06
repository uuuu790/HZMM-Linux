import { useState, useMemo } from 'react';
import GlassCard from '../common/GlassCard';
import { Save, Plus, CheckCircle, Play, Trash2, RefreshCw, ChevronDown, Box, Puzzle } from 'lucide-react';

function ProfilesTab({
  t,
  isDark: _isDark,
  modules,
  profiles,
  activeProfileId,
  newProfileName,
  setNewProfileName,
  handleCreateProfile,
  handleApplyProfile,
  handleDeleteProfile,
  applyingProfileId,
}) {
  const [expandedId, setExpandedId] = useState(null);

  // Build a lookup map from filename to module info
  const moduleMap = useMemo(() => {
    const map = {};
    for (const m of modules) {
      map[m.filename] = m;
    }
    return map;
  }, [modules]);

  return (
    <div className="flex flex-col gap-4 w-full animate-slide-up duration-500">
      <div className="flex items-center gap-3 mb-2 px-4">
        <div className="p-2 rounded-full shadow-inner transition-colors duration-700" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', color: 'var(--accent-500)' }}>
          <Save className="w-5 h-5" />
        </div>
        <h3 className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-wide transition-colors duration-700">{t.profiles}</h3>
        <span className="ml-2 px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold transition-colors duration-700 shadow-inner">{profiles.length}</span>
      </div>

      {/* Create new profile */}
      <div className="px-2">
        <GlassCard isPill={false} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 px-5 py-4 md:px-6 md:py-5">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="p-2.5 rounded-full shadow-inner shrink-0" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--accent-500)' }}>
              <Plus className="w-5 h-5" />
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 transition-colors duration-700">{t.saveAsProfile}</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium transition-colors duration-700">{t.currentConfig}: {modules.filter(m => m.enabled).length} {t.profileModCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-slate-100/50 dark:bg-slate-950/40 p-1.5 rounded-full border border-slate-200/50 dark:border-slate-800/50 shadow-inner transition-colors duration-500">
            <input
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
              placeholder={t.profilePlaceholder}
              className="w-full sm:w-40 lg:w-52 px-4 py-2 text-xs rounded-full bg-transparent text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none transition-all font-medium focus:bg-white/50 dark:focus:bg-slate-900/50"
            />
            <button
              onClick={handleCreateProfile}
              disabled={!newProfileName.trim()}
              className="px-4 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              style={{ backgroundColor: 'var(--accent-500)' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent-600)'; e.currentTarget.style.boxShadow = `0 10px 15px -3px rgba(var(--accent-rgb), 0.3)`; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.boxShadow = ''; }}
            >
              {t.newProfile}
            </button>
          </div>
        </GlassCard>
      </div>

      {/* Profile list */}
      {profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 mb-4">
            <Save className="w-10 h-10" />
          </div>
          <h4 className="text-lg font-bold text-slate-500 dark:text-slate-400 mb-1">{t.noProfiles}</h4>
          <p className="text-sm text-slate-400 dark:text-slate-500">{t.createFirstProfile}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-2">
          {profiles.map((profile, index) => {
            const enabledMods = profile.enabledModFilenames || [];
            const enabledCount = enabledMods.length;
            const isActive = activeProfileId === profile.id;
            const isExpanded = expandedId === profile.id;
            return (
              <div
                key={profile.id}
                className="animate-slide-up"
                style={{ animationFillMode: 'both', animationDelay: `${index * 60}ms`, animationDuration: '600ms' }}
              >
                <GlassCard isPill={false} className={`group flex flex-col px-4 py-3 md:px-5 md:py-3.5 relative ${isActive ? 'ring-2 bg-white/80 dark:bg-slate-800/80 shadow-[0_8px_24px_rgba(0,0,0,0.08)]' : ''}`}
                  style={isActive ? { '--tw-ring-color': 'rgba(var(--accent-rgb), 0.5)' } : undefined}>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : profile.id)}>
                    <div className={`p-2.5 rounded-full shrink-0 transition-all duration-500 shadow-sm ${isActive ? '' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'} group-hover:scale-110`}
                      style={isActive ? { backgroundColor: 'var(--accent-100)', color: 'var(--accent-500)' } : undefined}>
                      <Save className="w-5 h-5" />
                    </div>

                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700 ">{profile.name}</h4>
                        {isActive && (
                          <span className="flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border" style={{ backgroundColor: 'var(--accent-100)', color: 'var(--accent-600)', borderColor: 'rgba(var(--accent-rgb), 0.2)' }}>
                            <CheckCircle className="w-2.5 h-2.5" /> {t.activeProfile}
                          </span>
                        )}
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium transition-colors duration-700">
                        {enabledCount} {t.profileModCount} · {profile.createdAt}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleApplyProfile(profile.id); }}
                        disabled={!!applyingProfileId}
                        className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-full transition-all duration-300 active:scale-95 shadow-sm ${
                          isActive
                            ? 'text-white'
                            : 'bg-slate-800 dark:bg-slate-700 text-white'
                        } ${applyingProfileId === profile.id ? 'opacity-80 pointer-events-none' : ''}`}
                        style={isActive ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 6px -1px rgba(var(--accent-rgb), 0.3)' } : undefined}
                        onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)'; } }}
                        onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.boxShadow = ''; } }}
                      >
                        {applyingProfileId === profile.id
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : <Play className="w-3 h-3 fill-white" />
                        } {t.applyProfile}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.id); }}
                        className="p-2 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/20 transition-all duration-300 hover:scale-110 active:scale-95"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {enabledMods.length > 0 && (() => {
                    const pakMods = [];
                    const ue4ssMods = [];
                    const unknownMods = [];
                    for (const filename of enabledMods) {
                      const mod = moduleMap[filename];
                      const displayName = mod?.title || filename.replace(/\.(pak|disabled)/gi, '').replace(/_P$/, '').replace(/_/g, ' ').replace(/-/g, ' ');
                      if (mod?.type === 'PAK') pakMods.push({ filename, name: displayName });
                      else if (mod?.type === 'UE4SS') ue4ssMods.push({ filename, name: displayName });
                      else unknownMods.push({ filename, name: displayName });
                    }
                    const groups = [
                      { label: 'UE4SS Mods', icon: Puzzle, mods: ue4ssMods, dotColor: '#34d399', iconColor: '#10b981' },
                      { label: 'PAK Mods', icon: Box, mods: pakMods, dotColor: '#818cf8', iconColor: '#6366f1' },
                      ...(unknownMods.length > 0 ? [{ label: t.unknown || 'Other', icon: Box, mods: unknownMods, dotColor: '#94a3b8', iconColor: '#64748b' }] : []),
                    ].filter(g => g.mods.length > 0);

                    return (
                      <div className="grid transition-[grid-template-rows] duration-300 ease-in-out" style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}>
                        <div className="overflow-hidden min-h-0">
                          <div className={`flex flex-col gap-3 ${isExpanded ? 'border-t border-slate-200/60 dark:border-slate-700/60 pt-3 mt-1' : ''}`}>
                            {groups.map(({ label, icon: Icon, mods, dotColor, iconColor }) => (
                              <div key={label}>
                                <div className="flex items-center gap-2 mb-2 px-1">
                                  <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />
                                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{mods.length}</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 px-1">
                                  {mods.map(({ filename, name }) => (
                                    <div key={filename} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50/80 dark:bg-slate-800/50 transition-colors duration-200">
                                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                                      <span className="text-xs text-slate-700 dark:text-slate-300 font-medium truncate" title={filename}>{name}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </GlassCard>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ProfilesTab;
