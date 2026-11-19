/** Media URLs the wallpaper layer should play instead of handing to an img. */
export function isVideoWallpaper(src: string | null | undefined): boolean {
  if (!src) return false;
  if (/^data:video\//i.test(src)) return true;
  const path = src.split(/[?#]/, 1)[0].toLowerCase();
  return /\.(mp4|m4v|mov|webm|ogv)$/.test(path);
}
