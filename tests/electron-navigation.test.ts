import { describe, expect, it } from 'vitest';
import { isAppLocation } from '../electron/navigation';

const file =
  'file:///Applications/Academic%20Publication%20Tracker.app/Contents/Resources/app.asar/dist/index.html';
const dev = 'http://127.0.0.1:5173/';

describe('navigation the application window may perform', () => {
  it('lets the window reload the application page, with or without a hash', () => {
    expect(isAppLocation(file, file)).toBe(true);
    expect(isAppLocation(`${file}#/library`, file)).toBe(true);
    expect(isAppLocation(file, `${file}#anything`)).toBe(true);
    expect(isAppLocation(dev, dev)).toBe(true);
    expect(isAppLocation('http://127.0.0.1:5173/#x', dev)).toBe(true);
  });

  it.each([
    'https://example.org/',
    'http://127.0.0.1:5173/other',
    'http://127.0.0.1:5174/',
    'http://localhost:5173/',
    'file:///etc/passwd',
    `${file}?x=1`,
    file.replace('index.html', 'other.html'),
    file.replace('dist/index.html', 'dist/../index.html').replace('/dist/..', ''),
    'javascript:alert(1)',
    'about:blank',
    'data:text/html,hi',
    '',
    'not a url',
  ])('still blocks navigation to %s', (url) => {
    expect(isAppLocation(url, file)).toBe(false);
  });

  it('never matches when the application location itself is malformed', () => {
    expect(isAppLocation(file, 'not a url')).toBe(false);
    expect(isAppLocation('not a url', 'not a url')).toBe(false);
  });
});
