import { Package, Puzzle, Binary } from 'lucide-react';

export const MOD_ICONS = {
  PAK: { icon: Package, color: 'from-indigo-500/20 to-blue-500/20', accent: 'text-indigo-500', iconColor: 'text-indigo-500' },
  UE4SS: { icon: Puzzle, color: 'from-emerald-500/20 to-green-500/20', accent: 'text-emerald-500', iconColor: 'text-emerald-500' },
  CPP: { icon: Binary, color: 'from-amber-500/20 to-orange-500/20', accent: 'text-amber-500', iconColor: 'text-amber-500' },
  default: { icon: Package, color: 'from-slate-500/20 to-slate-600/20', accent: 'text-slate-500', iconColor: 'text-slate-500' }
};

export function getModIcon(mod) {
  if (mod.type === 'UE4SS' && mod.subtype === 'cpp') return MOD_ICONS.CPP;
  return MOD_ICONS[mod.type] || MOD_ICONS.default;
}

export function cleanModName(name) {
  return name.replace(/\.(pak|zip|rar)(\.disabled)?$/i, '').replace(/_P$/, '').replace(/\s+P$/, '');
}
