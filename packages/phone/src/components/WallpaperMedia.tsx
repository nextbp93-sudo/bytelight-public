import React from 'react';
import { isVideoWallpaper } from '../lib/wallpaper';

interface WallpaperMediaProps {
  src: string;
  className?: string;
  alt?: string;
}

/** One decorative wallpaper surface for stills and tiny ambient video loops. */
export function WallpaperMedia({ src, className, alt = 'Wallpaper' }: WallpaperMediaProps) {
  if (isVideoWallpaper(src)) {
    return (
      <video
        className={className}
        src={src}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        disablePictureInPicture
        controls={false}
        onCanPlay={(event) => { void event.currentTarget.play().catch(() => undefined); }}
      />
    );
  }

  return <img className={className} src={src} alt={alt} referrerPolicy="no-referrer" />;
}
