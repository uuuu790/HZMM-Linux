import { FolderOpen, ExternalLink } from 'lucide-react';

// Small icon button rendered next to an entry when keyDef.openPath is declared
// in the schema. Routes the click through window.api.mods.openSchemaPath —
// the main process resolves the path relative to gamePath / the mod folder
// and performs the shell action (reveal in explorer or open with default app).

export default function OpenPathButton({ modFilename, spec, addToast }) {
  if (!spec || typeof spec !== 'object' || !spec.path) return null;
  const action = spec.action === 'reveal' ? 'reveal' : 'open';
  const Icon = action === 'reveal' ? FolderOpen : ExternalLink;
  const title = `${action === 'reveal' ? 'Reveal in folder' : 'Open file'}: ${spec.path}`;
  return (
    <button
      type="button"
      title={title}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          const res = await window.api?.mods?.openSchemaPath?.(modFilename, spec);
          if (res && !res.ok) {
            const msg = res.reason === 'not-found'
              ? `File not found: ${spec.path}`
              : `Cannot open: ${res.reason}`;
            if (addToast) addToast(msg, 'error');
          }
        } catch (err) {
          if (addToast) addToast(`Open failed: ${err.message}`, 'error');
        }
      }}
      className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-90 transition-all duration-200"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
