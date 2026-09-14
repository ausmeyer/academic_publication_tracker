import { test, expect, type Page } from '@playwright/test';
import {
  SCHOLAR_CAPTURE_SCRIPT,
  getScholarNextUrl,
  normalizeScholarPage,
} from '../../src/core/scholar';
import { calculateMetrics } from '../../src/core/metrics';

const retrievedAt = '2026-09-14T15:30:00.000Z';
const searchUrl = 'https://scholar.google.com/scholar?hl=en&q=forecasting';
const profileUrl = 'https://scholar.google.com/citations?user=fixture-author&hl=en';

// Every request is intercepted. These are local synthetic fixtures, never live Scholar extraction.
async function fixture(page: Page, html: string, url = searchUrl) {
  const requests: string[] = [];
  await page.route('**/*', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><title>Google Scholar</title></head><body>${html}</body></html>`,
    });
  });
  await page.goto(url);
  return requests;
}

function result(id: string, title: string, count: string | null = 'Cited by 12', extra = '') {
  return `<div class="gs_r gs_or" data-cid="${id}">
    <h3 class="gs_rt"><a href="https://doi.org/10.1234/${id}">${title}</a></h3>
    <div class="gs_a">J Scholar, A Researcher… - Journal of Forecasting, 2023 - Publisher</div>
    <div class="gs_rs">A visible snippet, which may be abbreviated.</div>
    <div class="gs_fl">${count === null ? '' : `<a href="/scholar?cites=${id}&amp;hl=en">${count}</a>`}</div>
    ${extra}</div>`;
}

test('captures rendered results and citation totals without modifying or navigating the page', async ({
  page,
}) => {
  const requests = await fixture(
    page,
    `<div id="gs_ab_md">About 1,000 results</div>` +
      result(
        'one',
        'A prospective forecast evaluation',
        'Cited by 1,234',
        '<div class="gs_or_ggsm"><a href="https://example.org/paper.pdf">[PDF]</a></div>',
      ) +
      result('two', 'A paper with a known zero', 'Cited by 0') +
      result('three', 'A paper with no displayed citation count', null),
  );
  const before = await page.locator('html').innerHTML();
  const captured = await page.evaluate(SCHOLAR_CAPTURE_SCRIPT);
  expect(captured).toMatchObject({ estimatedTotal: 1000 });
  const normalized = normalizeScholarPage(captured, retrievedAt);
  expect(normalized.works).toHaveLength(3);
  expect(normalized.works.map((work) => work.citations)).toEqual([1234, 0, null]);
  expect(calculateMetrics(normalized.works, 'scholar')).toMatchObject({
    papers: 3,
    citations: 1234,
    citationCoverage: 2,
  });
  expect(normalized.works[0]).toMatchObject({
    title: 'A prospective forecast evaluation',
    authors: ['J Scholar', 'A Researcher'],
    year: 2023,
    venue: 'Journal of Forecasting',
    doi: '10.1234/one',
    abstract: '',
    snippet: 'A visible snippet, which may be abbreviated.',
    isOpenAccess: false,
    openAccessUrl: '',
    provenance: [
      { source: 'scholar', sourceId: 'one', citations: 1234, retrievedAt, url: searchUrl },
    ],
  });
  expect(normalized.warning).toMatch(/abbreviate author lists/);
  expect(await page.locator('html').innerHTML()).toBe(before);
  expect(page.url()).toBe(searchUrl);
  expect(requests).toEqual([searchUrl]);
});

test('reads the visible Scholar Next link without following it or inventing pagination', async ({
  page,
}) => {
  const requests = await fixture(
    page,
    result('one', 'A rendered search result') +
      '<div id="gs_n"><a hidden href="/scholar?start=20&amp;q=changed">Next</a>' +
      '<a href="/scholar?start=10&amp;q=forecasting&amp;hl=en"><span class="gs_ico_nav_next">→</span><span>Next</span></a></div>',
  );
  const before = await page.locator('html').innerHTML();
  const raw = (await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)) as { nextUrl: string | null };
  expect(raw.nextUrl).toBe('https://scholar.google.com/scholar?start=10&q=forecasting&hl=en');
  expect(getScholarNextUrl(raw, searchUrl, searchUrl)).toBe(raw.nextUrl);
  expect(await page.locator('html').innerHTML()).toBe(before);
  expect(requests).toEqual([searchUrl]);
  await page.locator('#gs_n').evaluate((node) => node.remove());
  expect(
    ((await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)) as { nextUrl: string | null }).nextUrl,
  ).toBeNull();
  expect(requests).toEqual([searchUrl]);
});

test('preserves a malformed actual Next link for validation instead of silently treating it as the last page', async ({
  page,
}) => {
  await fixture(
    page,
    result('one', 'A rendered search result') +
      '<div id="gs_n"><a href="https://scholar.google.com:443/scholar?start=10&amp;q=forecasting">Next</a></div>',
  );
  const raw = await page.evaluate(SCHOLAR_CAPTURE_SCRIPT);
  expect(() => getScholarNextUrl(raw, searchUrl, searchUrl)).toThrow(/approved Google Scholar/);
});

test('distinguishes interactive verification controls from a text-only unusual-traffic refusal', async ({
  page,
}) => {
  await fixture(
    page,
    '<form id="captcha-form">Our systems have detected unusual traffic from your computer network.</form>',
  );
  const refused = (await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)) as {
    status: string;
    interactiveVerification: boolean;
    nextUrl: string | null;
  };
  expect(refused).toMatchObject({
    status: 'captcha',
    interactiveVerification: false,
    nextUrl: null,
  });
  await page
    .locator('#captcha-form')
    .evaluate((form) =>
      form.insertAdjacentHTML('beforeend', '<input aria-label="Verification code">'),
    );
  expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({
    status: 'captcha',
    interactiveVerification: true,
    nextUrl: null,
  });
});

for (const [name, html] of [
  [
    '403 error',
    '<h1>Error 403</h1><p>Your client does not have permission to access this page.</p>',
  ],
  [
    'unsupported browser',
    '<h1>Could not sign you in</h1><p>This browser or app may not be secure.</p><button>Try again</button>',
  ],
  [
    'unusable controls',
    '<input type="email" hidden><input type="password" disabled><input name="identifier" readonly><div role="link" data-identifier="fixture-account" aria-disabled="true">Account</div>',
  ],
  [
    'unusable account choices',
    '<button data-email="fixture@example.invalid" disabled>Account</button><div inert><div role="link" data-identifier="fixture-account">Account</div></div><div role="button" data-identifier="fixture-account" style="pointer-events:none">Account</div>',
  ],
  [
    'unidentified button',
    '<button data-identifier="">Continue</button><div role="link" data-email=" ">Account</div>',
  ],
] as const) {
  test(`does not pause on an accounts.google.com ${name} page`, async ({ page }) => {
    await fixture(page, html, 'https://accounts.google.com/v3/signin/identifier');
    expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({
      status: 'login',
      interactiveVerification: false,
      nextUrl: null,
      records: [],
    });
  });
}

for (const [name, html] of [
  ['email field', '<input type="email" name="identifier" aria-label="Email or phone">'],
  ['password field', '<input type="password" name="Passwd" aria-label="Password">'],
  ['identifier field', '<input name="identifier" aria-label="Email or phone">'],
  [
    'verification field',
    '<input name="totpPin" inputmode="numeric" aria-label="Verification code">',
  ],
  [
    'account link',
    '<div role="link" tabindex="0" data-identifier="fixture@example.invalid">Fixture account</div>',
  ],
  ['account button', '<button data-email="fixture@example.invalid">Fixture account</button>'],
] as const) {
  test(`recognizes a usable Google sign-in ${name}`, async ({ page }) => {
    await fixture(page, html, 'https://accounts.google.com/v3/signin/identifier');
    expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({
      status: 'login',
      interactiveVerification: true,
      nextUrl: null,
      records: [],
    });
  });
}

test('captures author publication rows, ignoring profile-wide metrics and undisplayed publications', async ({
  page,
}) => {
  await fixture(
    page,
    `<div class="gsc_rsb_std">98,765</div><table>
    <tr class="gsc_a_tr"><td><a class="gsc_a_at" href="/citations?view_op=view_citation&amp;user=fixture-author&amp;citation_for_view=fixture-author:abc">A profile publication</a>
      <div class="gs_gray">J Scholar, A Researcher</div><div class="gs_gray">Forecasting Journal 12 (3), 11-20</div></td>
      <td class="gsc_a_c"><a>27</a></td><td class="gsc_a_y">2021</td></tr>
    <tr class="gsc_a_tr"><td><a class="gsc_a_at" href="/citations?view_op=view_citation&amp;citation_for_view=fixture-author:def">A second profile publication</a>
      <div class="gs_gray">J Scholar</div><div class="gs_gray">Methods Journal</div></td><td class="gsc_a_c"></td><td class="gsc_a_y">2024</td></tr>
    <tr class="gsc_a_tr" style="display:none"><td><a class="gsc_a_at">A hidden publication</a></td><td class="gsc_a_c">9000</td></tr>
    </table>`,
    profileUrl,
  );
  const normalized = normalizeScholarPage(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT), retrievedAt);
  expect(normalized.works).toHaveLength(2);
  expect(normalized.works[0]).toMatchObject({
    id: 'scholar:fixture-author:abc',
    year: 2021,
    citations: 27,
    authors: ['J Scholar', 'A Researcher'],
    venue: 'Forecasting Journal 12 (3), 11-20',
    provenance: [{ source: 'scholar', retrievedAt, url: profileUrl }],
  });
  expect(normalized.works[1].citations).toBeNull();
  expect(calculateMetrics(normalized.works, 'scholar').citations).toBe(27);
});

test('ignores hidden rows and hidden citation counts', async ({ page }) => {
  await fixture(
    page,
    result(
      'visible',
      'A visible record',
      null,
      '<div class="gs_fl" hidden><a href="/scholar?cites=visible">Cited by 999</a></div>',
    ) +
      `<div hidden>${result('hidden', 'Hidden by attribute')}</div>` +
      `<div style="display:none">${result('display', 'Hidden by display')}</div>` +
      `<div style="visibility:hidden">${result('visibility', 'Hidden by visibility')}</div>` +
      `<div style="opacity:0">${result('opacity', 'Hidden by opacity')}</div>`,
  );
  const normalized = normalizeScholarPage(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT));
  expect(normalized.works).toHaveLength(1);
  expect(normalized.works[0].title).toBe('A visible record');
  expect(normalized.works[0].citations).toBeNull();
});

test('reads the reported result estimate without mistaking the page number or hidden text for it', async ({
  page,
}) => {
  await fixture(
    page,
    '<div id="gs_ab_md">Page 2 of about 43 results (0.03 sec)</div>' +
      result('one', 'A visible result'),
  );
  expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({ estimatedTotal: 43 });
  await page.locator('#gs_ab_md').evaluate((element) => {
    element.setAttribute('hidden', '');
  });
  expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({ estimatedTotal: null });
});

test('supports citation-only rows and preserves markup-looking titles as inert text', async ({
  page,
}) => {
  await fixture(
    page,
    `<div class="gs_r gs_or" data-cid="citation-only">
    <h3 class="gs_rt"><span>[CITATION]</span> An unlinked scholarly publication</h3>
    <div class="gs_a">J Scholar - 2018 - University Press</div>
    <div class="gs_fl"><a href="/scholar?cites=citation-only">Cited by 8</a></div></div>` +
      result('literal', '&lt;img src=x onerror=alert(1)&gt; A literal title', null),
  );
  const normalized = normalizeScholarPage(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT));
  expect(normalized.works[0]).toMatchObject({
    title: 'An unlinked scholarly publication',
    type: 'citation',
    year: 2018,
    url: '',
    citations: 8,
  });
  expect(normalized.works[1].title).toBe('<img src=x onerror=alert(1)> A literal title');
  expect(await page.locator('img').count()).toBe(0);
});

test('caps one capture at 200 displayed records without advancing to another page', async ({
  page,
}) => {
  const requests = await fixture(
    page,
    Array.from({ length: 205 }, (_, i) => result(`id${i}`, `Publication ${i}`)).join('') +
      '<a id="next" href="/scholar?start=200">Next</a>',
  );
  const raw = await page.evaluate(SCHOLAR_CAPTURE_SCRIPT);
  const normalized = normalizeScholarPage(raw);
  expect(normalized.works).toHaveLength(200);
  expect(normalized.warning).toMatch(/first 200/);
  expect(requests).toEqual([searchUrl]);
});

test('captures profile publications appended after the first 100 when the user shows more', async ({
  page,
}) => {
  const rows = Array.from(
    { length: 200 },
    (_, index) => `<tr class="gsc_a_tr">
    <td><a class="gsc_a_at" href="/citations?view_op=view_citation&amp;citation_for_view=fixture-author:${index}">Profile publication ${index + 1}</a>
      <div class="gs_gray">J Scholar</div><div class="gs_gray">Methods Journal</div></td>
    <td class="gsc_a_c">${index}</td><td class="gsc_a_y">2024</td></tr>`,
  );
  const requests = await fixture(
    page,
    `<table><tbody>${rows.slice(0, 100).join('')}</tbody></table><button>Show more</button>`,
    profileUrl,
  );
  await page.evaluate((additionalRows) => {
    document.querySelector('button')!.addEventListener(
      'click',
      () => {
        document.querySelector('tbody')!.insertAdjacentHTML('beforeend', additionalRows);
      },
      { once: true },
    );
  }, rows.slice(100).join(''));
  expect(normalizeScholarPage(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).works).toHaveLength(100);
  await page.getByRole('button', { name: 'Show more' }).click();
  const normalized = normalizeScholarPage(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT));
  expect(normalized.works).toHaveLength(200);
  expect(normalized.works.at(-1)).toMatchObject({
    id: 'scholar:fixture-author:199',
    title: 'Profile publication 200',
    citations: 199,
  });
  expect(requests).toEqual([profileUrl]);
});

for (const [name, html, message] of [
  [
    'CAPTCHA',
    '<form id="captcha-form">Our systems have detected unusual traffic from your computer network.</form>',
    /CAPTCHA/,
  ],
  ['sign-in', '<h1>Sign in</h1><input type="password">', /sign-in page/],
  ['unavailable', "<p>Sorry, we can't complete your request.</p>", /unavailable/],
  ['no-results', '<p>Your search did not match any articles.</p>', /no displayed publications/],
  ['unsupported', '<h1>Scholar settings</h1>', /not supported/],
] as const) {
  test(`rejects a rendered ${name} page with a clear message`, async ({ page }) => {
    await fixture(page, html);
    const raw = await page.evaluate(SCHOLAR_CAPTURE_SCRIPT);
    expect(() => normalizeScholarPage(raw)).toThrow(message);
  });
}
