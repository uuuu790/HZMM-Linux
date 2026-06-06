// "Self mod" detection — HZMM itself is published on Nexus as a HumanitZ
// mod, which means it shows up in our own browse UI. We don't hide the
// card (user may want to see it / click through to the Nexus page), but
// we suppress the install buttons because installing the app from inside
// the app is nonsense and would just download HZMM's own release zip.
//
// Matching uses the mod name AND a loose author check (substring of the
// author handle, case-insensitive) so minor upstream changes to the
// author's display name don't silently re-enable the install button.
const SELF_MOD_NAME = 'HumanitZ Mod Manager';
const SELF_MOD_AUTHOR_SUBSTR = 'www98'; // catches "Wwww98" and reasonable variants

export function isSelfMod(mod) {
  if (!mod) return false;
  if (mod.name !== SELF_MOD_NAME) return false;
  const author = String(mod.author || mod.uploaded_by || mod.uploader?.name || '').toLowerCase();
  return author.includes(SELF_MOD_AUTHOR_SUBSTR);
}
