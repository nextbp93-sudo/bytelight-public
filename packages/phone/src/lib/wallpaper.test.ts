import test from 'node:test';
import assert from 'node:assert/strict';
import { isVideoWallpaper } from './wallpaper.js';

test('video wallpapers are recognised through cache-busting URLs', () => {
  assert.equal(isVideoWallpaper('/wallpapers/gift.mp4?v=2#loop'), true);
  assert.equal(isVideoWallpaper('/wallpapers/gift.WEBM'), true);
  assert.equal(isVideoWallpaper('data:video/mp4;base64,AAAA'), true);
});

test('still wallpapers keep the image path', () => {
  assert.equal(isVideoWallpaper('/wallpapers/gift.jpg'), false);
  assert.equal(isVideoWallpaper('data:image/png;base64,AAAA'), false);
  assert.equal(isVideoWallpaper(undefined), false);
});
