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
async function fixture(page: Page, html: string, url = searchUrl, title = 'Google Scholar') {
  const requests: string[] = [];
  await page.route('**/*', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><title>${title}</title></head><body>${html}</body></html>`,
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
    authorsComplete: false,
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

// Byline format: "Authors - Venue, Year - Publisher". Only the trailing year of the middle part is the
// publication year; arXiv identifiers, conference years and volume numbers must never be read as one.
const bylineRow = (byline: string) =>
  `<div class="gs_r gs_or" data-cid="byline"><h3 class="gs_rt"><a href="https://example.org/byline">A title</a></h3>
    <div class="gs_a">${byline}</div><div class="gs_fl"><a href="/scholar?cites=byline&amp;hl=en">Cited by 1</a></div></div>`;

for (const [name, byline, year, venue] of [
  ['a plain venue and year', 'J Doe, A Roe - Nature, 2019 - nature.com', 2019, 'Nature'],
  [
    'an arXiv id that looks like a year (1810.04805)',
    'J Devlin, MW Chang, K Lee, K Toutanova - arXiv preprint arXiv:1810.04805, 2018 - arxiv.org',
    2018,
    'arXiv preprint arXiv:1810.04805',
  ],
  [
    'an arXiv id below the accepted year range (1412.6980)',
    'DP Kingma, J Ba - arXiv preprint arXiv:1412.6980, 2014 - arxiv.org',
    2014,
    'arXiv preprint arXiv:1412.6980',
  ],
  [
    'an arXiv id that looks like a recent year (2010.11929)',
    'A Dosovitskiy, L Beyer - arXiv preprint arXiv:2010.11929, 2020 - arxiv.org',
    2020,
    'arXiv preprint arXiv:2010.11929',
  ],
  [
    'an arXiv id with a different leading number (2005.14165)',
    'TB Brown, B Mann - arXiv preprint arXiv:2005.14165, 2020 - arxiv.org',
    2020,
    'arXiv preprint arXiv:2005.14165',
  ],
  [
    'a conference name that starts with its year',
    'A Graves, A Mohamed, G Hinton - 2013 IEEE international conference on acoustics, speech and signal …, 2013 - ieeexplore.ieee.org',
    2013,
    '2013 IEEE international conference on acoustics, speech and signal …',
  ],
  [
    'a venue that names another year than the publication year',
    'A Author - Proceedings of the 1998 workshop on things, 1999 - acm.org',
    1999,
    'Proceedings of the 1998 workshop on things',
  ],
  ['a preprint server', 'J Doe - medRxiv, 2021 - medrxiv.org', 2021, 'medRxiv'],
  [
    'a volume number before the year',
    'J Doe - Advances in neural information processing systems 30, 2017 - proceedings.neurips.cc',
    2017,
    'Advances in neural information processing systems 30',
  ],
  [
    'a venue with a year of its own',
    'J Doe - IEEE Access 2021, 2021 - ieee.org',
    2021,
    'IEEE Access 2021',
  ],
  ['a publisher but no year', 'J Doe - Springer - books.google.com', null, 'Springer'],
  ['a book with only a year', 'JR Smith - 2001 - Oxford University Press', 2001, ''],
  [
    'a truncated author list',
    'J Doe, A Roe… - Journal of Forecasting, 2023 - Wiley Online Library',
    2023,
    'Journal of Forecasting',
  ],
] as const) {
  test(`reads the publication year and venue from a byline with ${name}`, async ({ page }) => {
    await fixture(page, bylineRow(byline));
    const raw = (await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)) as {
      records: { year: number | null; venue: string }[];
    };
    expect(raw.records[0]).toMatchObject({ year, venue });
    const normalized = normalizeScholarPage(raw, retrievedAt);
    expect(normalized.works[0]).toMatchObject({ year, venue });
  });
}

test('does not let an arXiv identifier stretch the citations-per-year denominator across centuries', async ({
  page,
}) => {
  await fixture(
    page,
    bylineRow('J Devlin, K Toutanova - arXiv preprint arXiv:1810.04805, 2018 - arxiv.org') +
      bylineRow('J Doe - Nature, 2019 - nature.com').replace('byline', 'second'),
  );
  const { works } = normalizeScholarPage(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT), retrievedAt);
  expect(works.map((work) => work.year)).toEqual([2018, 2019]);
});

// Ordinary queries put their words in the page title ("<query> - Google Scholar") and snippets quote
// error messages. Neither is a refusal while result rows are displayed.
for (const query of [
  'error correction',
  'error-prone sequencing',
  'errors in medicine',
  'access denied policies',
  'too many requests rate limiting',
  'service unavailable',
  'sign in behavior',
  'Sign-in security',
]) {
  test(`reads displayed results for the query "${query}" instead of classifying the page title`, async ({
    page,
  }) => {
    await fixture(page, result('one', 'A relevant paper'), searchUrl, `${query} - Google Scholar`);
    const raw = (await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)) as { status: string; records: [] };
    expect(raw.status).toBe('results');
    expect(raw.records).toHaveLength(1);
  });

  test(`reports a zero-result query "${query}" as empty, not as a refusal or sign-in`, async ({
    page,
  }) => {
    await fixture(
      page,
      `<p>Your search - ${query} - did not match any articles.</p>`,
      searchUrl,
      `${query} - Google Scholar`,
    );
    expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({ status: 'empty' });
  });
}

for (const snippet of [
  "Sorry, we can't complete your request appears on many error pages",
  'Our systems have detected unusual traffic from your computer network is a familiar message',
  "To continue, please type the characters below is a phrase from CAPTCHA pages; please show you're not a robot",
  'Your client does not have permission to get the URL appears in server logs',
]) {
  test(`reads a displayed result whose snippet quotes "${snippet.slice(0, 32)}…"`, async ({
    page,
  }) => {
    await fixture(
      page,
      result('one', 'A paper about error pages').replace(
        'A visible snippet, which may be abbreviated.',
        snippet,
      ),
    );
    const raw = (await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)) as {
      status: string;
      records: { snippet: string }[];
    };
    expect(raw.status).toBe('results');
    expect(raw.records[0].snippet).toBe(snippet);
  });
}

for (const [name, title, html, status] of [
  ['an access-denied title', 'Access denied', '<h1>Forbidden</h1>', 'unavailable'],
  [
    'a Google error page title',
    'Error 403 (Forbidden)!!1',
    '<p>That is an error.</p>',
    'unavailable',
  ],
  ['a service error title', 'Service Unavailable', '<p>Try again later.</p>', 'unavailable'],
  ['a rate limit title', 'Too Many Requests', '<p>Slow down.</p>', 'unavailable'],
  ["Google's sign-in title", 'Sign in - Google Accounts', '<p>Continue to Google</p>', 'login'],
  [
    'unusual-traffic text without a form',
    'Google Scholar',
    '<p>Our systems have detected unusual traffic from your computer network.</p>',
    'captcha',
  ],
] as const) {
  test(`still recognizes ${name} when no result rows are displayed`, async ({ page }) => {
    await fixture(page, html, searchUrl, title);
    expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({ status });
  });
}

test('keeps structural CAPTCHA detection even when result-like rows are present', async ({
  page,
}) => {
  await fixture(
    page,
    result('one', 'A paper') + '<form id="captcha-form"><input name="captcha"></form>',
  );
  expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({
    status: 'captcha',
    interactiveVerification: true,
  });
});

// Visitors in some regions (EU/UK) are sent to Google's cookie-consent interstitial before any
// results. Only the user may choose an option there; the collector merely recognizes the page.
const consentForm =
  '<h1>Before you continue to Google</h1><form action="https://consent.google.com/save" method="post"><button>Reject all</button><button>Accept all</button></form>';

for (const host of ['consent.google.com', 'consent.google.de', 'consent.google.co.uk']) {
  test(`recognizes the cookie-consent interstitial on ${host} as a step only the user can take`, async ({
    page,
  }) => {
    await fixture(
      page,
      consentForm,
      `https://${host}/ml?continue=${encodeURIComponent(searchUrl)}`,
    );
    expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({
      status: 'consent',
      interactiveVerification: true,
      nextUrl: null,
      records: [],
    });
  });
}

test('does not pause for a consent page that offers no usable control', async ({ page }) => {
  await fixture(
    page,
    '<h1>Before you continue</h1><button disabled>Accept all</button><div inert><button>Reject all</button></div>',
    'https://consent.google.com/ml?continue=x',
  );
  expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({
    status: 'consent',
    interactiveVerification: false,
    records: [],
  });
});

test('recognizes a consent form shown on the Scholar page itself when no results are displayed', async ({
  page,
}) => {
  await fixture(page, consentForm);
  expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({
    status: 'consent',
    interactiveVerification: true,
  });
});

test('keeps reading displayed results when a page also carries a consent form', async ({
  page,
}) => {
  await fixture(page, result('one', 'A displayed result') + consentForm);
  expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({ status: 'results' });
});

test('does not treat a look-alike consent host as a consent page', async ({ page }) => {
  await fixture(page, consentForm, 'https://consent.google.com.evil.example/ml');
  expect(await page.evaluate(SCHOLAR_CAPTURE_SCRIPT)).toMatchObject({
    status: 'unsupported',
    interactiveVerification: false,
  });
});

test('rejects a rendered consent page with a clear message', async ({ page }) => {
  await fixture(page, consentForm, 'https://consent.google.com/ml?continue=x');
  const raw = await page.evaluate(SCHOLAR_CAPTURE_SCRIPT);
  expect(() => normalizeScholarPage(raw)).toThrow(/cookie consent/);
});
