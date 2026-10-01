import type { Page } from '@playwright/test';
import type { SearchResponse, Snapshot, Work, Workspace } from '../../src/types';

export const at = '2026-09-14T15:00:00.000Z';

export function work(
  id: string,
  title: string,
  citations: number | null = 10,
  year: number | null = 2022,
  extra: Partial<Work> = {},
): Work {
  return {
    id,
    title,
    authors: ['Jane Scholar', 'Alex Researcher'],
    year,
    venue: 'Journal of Research Methods',
    doi: `10.1234/${id}`,
    abstract: 'A study of methods for academic research and reproducible evidence synthesis.',
    type: 'journal-article',
    url: `https://doi.org/10.1234/${id}`,
    openAccessUrl: '',
    isOpenAccess: false,
    citations,
    provenance: [
      {
        source: 'europepmc',
        sourceId: id,
        citations,
        retrievedAt: at,
        url: 'https://europepmc.org/',
      },
    ],
    included: true,
    notes: '',
    tags: [],
    ...extra,
  };
}

export function snapshotOf(
  id: string,
  name: string,
  works: Work[],
  extra: Partial<Snapshot> = {},
): Snapshot {
  return {
    id,
    name,
    query: { text: name, mode: 'topic', sources: ['europepmc'], limit: 25 },
    works,
    searchedAt: at,
    sourceResults: [{ source: 'europepmc', total: works.length }],
    ...extra,
  };
}

export const workspaceOf = (
  snapshots: Snapshot[],
  activeId: string | null = snapshots[0]?.id ?? null,
): Workspace => ({ version: 2, snapshots, activeId });

/** Puts a workspace into browser-preview storage once (a reload keeps what the app saved). */
export async function seedOnce(page: Page, data: Workspace) {
  await page.addInitScript((data) => {
    if (!localStorage.getItem('apt-workspace-v1'))
      localStorage.setItem('apt-workspace-v1', JSON.stringify(data));
  }, data);
}

export const readStored = (page: Page): Promise<Workspace> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('apt-workspace-v1')!));

export const searchResponse = (
  works: Work[],
  source: 'europepmc' = 'europepmc',
): SearchResponse => ({
  results: [{ source, works, total: works.length }],
  searchedAt: '2026-09-20T12:00:00.000Z',
});

export interface StubOptions {
  /** Workspace already "on disk" when the page first loads. */
  workspace?: Workspace | null;
  /**
   * Build a large workspace inside the page instead of serialising megabytes from the test. With
   * `headroom`, abstracts are lengthened until it is exactly that many bytes below 25 MB.
   */
  bulk?: { snapshots: number; worksPerSnapshot: number; abstractChars: number; headroom?: number };
  recoveryNotice?: string | null;
  /** The first N calls to saveWorkspace reject. */
  failSaves?: number;
  /** Keep the "disk" in memory only (sessionStorage cannot hold tens of megabytes). */
  memoryOnly?: boolean;
  /** Make loadWorkspace reject. */
  failLoad?: boolean;
  failSettings?: boolean;
}

export interface Apt {
  saves: Array<{ activeId: string | null; names: string[] }>;
  last: string | null;
  exports: Array<{ name: string; content: string }>;
  imports: Array<{ name: string; content: string }>;
  opened: string[];
  searches: unknown[];
  flushListener: null | (() => void | Promise<void>);
  releaseSearch: null | ((response: unknown) => void);
  holdSearches: boolean;
  onSearch: null | ((query: unknown) => Promise<unknown>);
  failSaves: number;
  requestFlush: () => Promise<void>;
  /** Every description handed to setUnsavedWork (null: nothing unsaved). */
  unsaved: Array<string | null>;
}

/**
 * Installs a fake desktop bridge (window.desktop) backed by a fake disk, plus window.__apt to
 * inspect and steer it. The disk survives reloads of the page through sessionStorage.
 */
export async function installDesktop(page: Page, options: StubOptions = {}) {
  await page.addInitScript((options: StubOptions) => {
    const w = window as unknown as Record<string, unknown>;
    const diskKey = 'apt-stub-disk';
    let memory: string | null = null;
    const apt = {
      saves: [] as Array<{ activeId: string | null; names: string[] }>,
      last: null as string | null,
      exports: [] as Array<{ name: string; content: string }>,
      imports: [] as Array<{ name: string; content: string }>,
      opened: [] as string[],
      searches: [] as unknown[],
      flushListener: null as null | (() => void | Promise<void>),
      releaseSearch: null as null | ((response: unknown) => void),
      holdSearches: false,
      onSearch: null as null | ((query: unknown) => Promise<unknown>),
      failSaves: options.failSaves ?? 0,
      requestFlush: async () => {
        await apt.flushListener?.();
      },
      unsaved: [] as Array<string | null>,
    };
    w.__apt = apt;
    const read = (): string | null => {
      if (options.memoryOnly) return memory;
      return sessionStorage.getItem(diskKey);
    };
    const write = (text: string) => {
      if (options.memoryOnly) memory = text;
      else sessionStorage.setItem(diskKey, text);
    };
    if (read() === null) {
      if (options.bulk) {
        const { snapshots, worksPerSnapshot, abstractChars } = options.bulk;
        const abstract = 'x'.repeat(abstractChars);
        const made = Array.from({ length: snapshots }, (_, s) => ({
          id: `bulk-${s}`,
          name: `Bulk snapshot ${s + 1}`,
          query: { text: `bulk ${s}`, mode: 'topic', sources: ['europepmc'], limit: 25 },
          works: Array.from({ length: worksPerSnapshot }, (_, i) => ({
            id: `bulk-${s}-${i}`,
            title: `Bulk paper ${s}-${i}`,
            authors: ['Jane Scholar'],
            year: 2020,
            venue: 'Journal',
            doi: `10.1/bulk-${s}-${i}`,
            abstract,
            type: 'journal-article',
            url: '',
            openAccessUrl: '',
            isOpenAccess: false,
            citations: 1,
            provenance: [],
            included: true,
            notes: '',
            tags: [],
          })),
          searchedAt: '2026-09-01T10:00:00.000Z',
          sourceResults: [],
        }));
        const data = { version: 2, snapshots: made, activeId: made[0].id };
        if (options.bulk.headroom !== undefined) {
          let missing =
            25 * 1024 * 1024 -
            options.bulk.headroom -
            new TextEncoder().encode(JSON.stringify(data)).byteLength;
          for (const record of made.flatMap((s) => s.works)) {
            const added = Math.max(0, Math.min(missing, 200_000 - record.abstract.length));
            record.abstract += 'x'.repeat(added);
            missing -= added;
          }
          if (missing !== 0) throw new Error('The bulk workspace cannot reach that headroom.');
        }
        write(JSON.stringify(data));
      } else if (options.workspace) write(JSON.stringify(options.workspace));
    }
    w.desktop = {
      async search(query: unknown) {
        apt.searches.push(query);
        if (apt.holdSearches)
          return new Promise((resolve) => {
            apt.releaseSearch = resolve;
          });
        if (!apt.onSearch) throw new Error('Unexpected API request');
        return apt.onSearch(query);
      },
      async searchScholar() {
        throw new Error('Unexpected Scholar request');
      },
      onScholarProgress: () => () => {},
      async controlScholar() {},
      async loadWorkspace() {
        if (options.failLoad) throw new Error('The workspace file is unreadable.');
        const raw = read();
        return raw ? JSON.parse(raw) : null;
      },
      async saveWorkspace(workspace: {
        activeId: string | null;
        snapshots: Array<{ name: string }>;
      }) {
        if (apt.failSaves > 0) {
          apt.failSaves--;
          throw new Error('The disk is full.');
        }
        const text = JSON.stringify(workspace);
        apt.last = text;
        apt.saves.push({
          activeId: workspace.activeId,
          names: workspace.snapshots.map((s) => s.name),
        });
        write(text);
      },
      async loadSettings() {
        if (options.failSettings) throw new Error('Keychain unavailable.');
        return { email: '', openalexApiKey: '', semanticApiKey: '', ncbiApiKey: '' };
      },
      async saveSettings() {},
      async exportFile(data: { name: string; content: string }) {
        apt.exports.push(data);
        return true;
      },
      async importFile() {
        return apt.imports.shift() ?? null;
      },
      async openExternal(url: string) {
        apt.opened.push(url);
      },
      async copyText() {},
      onFlushRequest(listener: () => void | Promise<void>) {
        apt.flushListener = listener;
        return () => {
          if (apt.flushListener === listener) apt.flushListener = null;
        };
      },
      async recoveryNotice() {
        return options.recoveryNotice ?? null;
      },
      setUnsavedWork(description: string | null) {
        apt.unsaved.push(description);
      },
    };
  }, options);
}

/** Reads window.__apt from the page as plain data. */
export const aptSaves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __apt: Apt }).__apt.saves);
export const aptLast = (page: Page): Promise<Workspace | null> =>
  page.evaluate(() => {
    const last = (window as unknown as { __apt: Apt }).__apt.last;
    return last ? JSON.parse(last) : null;
  });
export const aptExports = (page: Page) =>
  page.evaluate(() => (window as unknown as { __apt: Apt }).__apt.exports);

/** Counts calls to one exported function of a dev-served module by wrapping it in the browser. */
export async function countCalls(page: Page, modulePath: string, exportName: string) {
  await page.route(`**/${modulePath}*`, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const original = `export function ${exportName}(`;
    if (!body.includes(original)) {
      await route.fulfill({ response, body });
      return;
    }
    await route.fulfill({
      response,
      body:
        body.replace(original, `function __original_${exportName}(`) +
        `\nexport function ${exportName}(...args) { window.__calls = window.__calls || {}; ` +
        `window.__calls.${exportName} = (window.__calls.${exportName} || 0) + 1; ` +
        `return __original_${exportName}(...args); }\n`,
    });
  });
  return () =>
    page.evaluate(
      (name) =>
        ((window as unknown as { __calls?: Record<string, number> }).__calls ?? {})[name] ?? 0,
      exportName,
    );
}

/** WCAG relative luminance contrast of two CSS rgb()/rgba() strings. */
export function contrast(foreground: string, background: string): number {
  const parse = (css: string) => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(parse(foreground));
  const b = luminance(parse(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export interface Audit {
  small: Array<{ el: string; size: number; text: string }>;
  contrast: Array<{
    el: string;
    ratio: number;
    fg: string;
    bg: string;
    size: number;
    text: string;
  }>;
  targets: Array<{ el: string; w: number; h: number; text: string; inside: boolean }>;
  overflow: Array<{ el: string; sw: number; cw: number; text: string }>;
  horizontalScroll: boolean;
}

/** Waits until finite animations (a dialog fading in) are done, so the page is measured as it rests. */
export const settled = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity,
      ),
  );

/**
 * Measures the page as it is drawn: text below 11px, text below 4.5:1 contrast (3:1 for large text),
 * interactive targets below 24x24 CSS px and boxes whose content spills out of them. It runs inside
 * the page, so it must not use anything from this module.
 */
export function auditPage(): Audit {
  const out: Audit = {
    small: [],
    contrast: [],
    targets: [],
    overflow: [],
    horizontalScroll: false,
  };
  const parse = (css: string) => (css.match(/[\d.]+/g) ?? []).map(Number);
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.slice(0, 3).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const backgroundOf = (el: Element) => {
    const layers: number[][] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.length >= 3 && (c.length === 3 || c[3] > 0)) {
        layers.push(c);
        if (c.length === 3 || c[3] >= 1) break;
      }
    }
    let base = [255, 255, 255];
    for (const layer of layers.reverse()) {
      const a = layer.length === 4 ? layer[3] : 1;
      base = base.map((v, i) => Math.round(layer[i] * a + v * (1 - a)));
    }
    return base;
  };
  const describe = (el: Element) =>
    `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const judge = (el: Element, fgCss: string, size: number, weight: string, text: string) => {
    if (el.closest('button:disabled, [disabled], [aria-hidden="true"]')) return;
    const fg = parse(fgCss);
    if (fg.length < 3) return;
    const bg = backgroundOf(el);
    // The opacity of the element and of every ancestor fades its text towards the background.
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement)
      opacity *= Number(getComputedStyle(node).opacity);
    const alpha = (fg.length === 4 ? fg[3] : 1) * opacity;
    const blended = fg.slice(0, 3).map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
    const r = ratio(blended, bg);
    const large = size >= 24 || (size >= 18.66 && Number(weight) >= 700);
    if (r < (large ? 3 : 4.5))
      out.contrast.push({
        el: describe(el),
        ratio: Math.round(r * 100) / 100,
        fg: fgCss,
        bg: `rgb(${bg.join(',')})`,
        size,
        text,
      });
  };
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = (walker.currentNode.textContent ?? '').trim();
    const el = walker.currentNode.parentElement;
    if (!text || !el || seen.has(el) || ['SCRIPT', 'STYLE'].includes(el.tagName) || !visible(el))
      continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    if (size < 11) out.small.push({ el: describe(el), size, text: text.slice(0, 40) });
    // SVG text is painted with `fill`, not `color`.
    judge(
      el,
      el instanceof SVGElement ? cs.fill : cs.color,
      size,
      cs.fontWeight,
      text.slice(0, 40),
    );
  }
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.fontSize) < 11)
      out.small.push({
        el: describe(el),
        size: parseFloat(cs.fontSize),
        text: el.getAttribute('aria-label') ?? '',
      });
    if ((el as HTMLInputElement).placeholder)
      judge(
        el,
        getComputedStyle(el, '::placeholder').color,
        parseFloat(cs.fontSize),
        cs.fontWeight,
        `placeholder: ${(el as HTMLInputElement).placeholder}`.slice(0, 40),
      );
  }
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, summary')) {
    if (!visible(el) || el.closest('.sr-only')) continue;
    const isBox = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
    const box = (isBox && el.closest('label') ? el.closest('label')! : el).getBoundingClientRect();
    if (box.width < 24 || box.height < 24)
      out.targets.push({
        el: describe(el),
        w: Math.round(box.width),
        h: Math.round(box.height),
        text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
        // Controls of the Insights panel and links inside a sentence are judged on their own terms.
        inside: Boolean(el.closest('.local-insights, p, li, dd')),
      });
  }
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.overflowX !== 'visible') continue;
    // A few pixels of difference between platforms' fonts is not a spill.
    if (el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 0)
      out.overflow.push({
        el: describe(el),
        sw: el.scrollWidth,
        cw: el.clientWidth,
        text: (el.textContent ?? '').trim().slice(0, 40),
      });
  }
  out.horizontalScroll = document.documentElement.scrollWidth > window.innerWidth;
  return out;
}
