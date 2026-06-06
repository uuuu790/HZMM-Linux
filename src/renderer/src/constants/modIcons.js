import { Package, Puzzle } from 'lucide-react';

export const MOD_ICONS = {
  PAK: { icon: Package, color: 'from-indigo-500/20 to-blue-500/20', accent: 'text-indigo-500', iconColor: 'text-indigo-500' },
  UE4SS: { icon: Puzzle, color: 'from-emerald-500/20 to-green-500/20', accent: 'text-emerald-500', iconColor: 'text-emerald-500' },
  default: { icon: Package, color: 'from-slate-500/20 to-slate-600/20', accent: 'text-slate-500', iconColor: 'text-slate-500' }
};

export function getModIcon(mod) {
  return MOD_ICONS[mod.type] || MOD_ICONS.default;
}

export function cleanModName(name) {
  return name.replace(/\.(pak|zip|rar)(\.disabled)?$/i, '').replace(/_P$/, '').replace(/\s+P$/, '');
}
