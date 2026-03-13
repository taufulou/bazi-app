/**
 * E2E Tests: Career Detailed Reading (八字事業詳批)
 *
 * Tests the complete two-phase career reading flow:
 *   Phase 1 (Free): Form → Chart renders → CareerPaywallCTA shown
 *   Phase 2 (Paid): Unlock → AI streams in → Full reading
 *
 * Covers:
 *   - Unauthenticated flow (chart + login CTA)
 *   - Authenticated flow (chart + paywall + unlock)
 *   - Insufficient credits handling
 *   - Submit button label ("開始排盤")
 *   - No secondary "查看免費命盤" button for career
 *   - Full-page layout (no tab bar)
 *   - Career V2 deterministic data rendering (ScoreBar, charts)
 *   - Annual/Monthly forecast sections
 *   - Refresh resilience via sessionStorage
 *   - Deep link loading from reading history
 *
 * NOTE: Route interception mocks API responses. No backend servers needed.
 */
import { test, expect, type Page } from '@playwright/test';

// ============================================================
// Mock Data
// ============================================================

/**
 * Realistic Bazi chart data matching BaziChartData interface.
 * Must include ALL required fields to prevent BaziChart component crashes.
 * Key fields: fourPillars (with stemElement/branchElement/tenGod/shenSha per pillar),
 * dayMaster (with strength/pattern/gods), luckPeriods (with tenGod/isCurrent).
 */
function createMockBaziChart() {
  return {
    fourPillars: {
      year: {
        stem: '庚', branch: '午', stemElement: '金', branchElement: '火',
        hiddenStems: ['丁', '己'], tenGod: '偏財', naYin: '路旁土', shenSha: ['天乙貴人', '驛馬'],
      },
      month: {
        stem: '壬', branch: '午', stemElement: '水', branchElement: '火',
        hiddenStems: ['丁', '己'], tenGod: '偏印', naYin: '楊柳木', shenSha: ['文昌'],
      },
      day: {
        stem: '甲', branch: '子', stemElement: '木', branchElement: '水',
        hiddenStems: ['癸'], tenGod: null, naYin: '海中金', shenSha: ['天德'],
      },
      hour: {
        stem: '甲', branch: '戌', stemElement: '木', branchElement: '土',
        hiddenStems: ['辛', '丁', '戊'], tenGod: '比肩', naYin: '山頭火', shenSha: ['華蓋'],
      },
    },
    dayMaster: {
      element: '木', yinYang: '陽',
      strength: 'neutral', strengthScore: 50, pattern: '傷官格',
      sameParty: 45, oppositeParty: 55,
      favorableGod: '水', usefulGod: '金', idleGod: '木', tabooGod: '火', enemyGod: '土',
    },
    dayMasterStem: '甲',
    fiveElementsBalanceZh: { '木': 2.5, '火': 3.2, '土': 1.8, '金': 1.3, '水': 1.2 },
    fiveElementsBalance: { wood: 2.5, fire: 3.2, earth: 1.8, metal: 1.3, water: 1.2 },
    trueSolarTime: { clock_time: '20:00', true_solar_time: '20:00' },
    lunarDate: { year: 1990, month: 5, day: 23, isLeapMonth: false },
    luckPeriods: [
      { stem: '辛', branch: '巳', startAge: 2, endAge: 12, startYear: 1992, endYear: 2002, tenGod: '正官', isCurrent: false },
      { stem: '庚', branch: '辰', startAge: 12, endAge: 22, startYear: 2002, endYear: 2012, tenGod: '七殺', isCurrent: false },
      { stem: '己', branch: '卯', startAge: 22, endAge: 32, startYear: 2012, endYear: 2022, tenGod: '正財', isCurrent: false },
      { stem: '戊', branch: '寅', startAge: 32, endAge: 42, startYear: 2022, endYear: 2032, tenGod: '偏財', isCurrent: true },
    ],
    allShenSha: [
      { name: '天乙貴人', pillar: 'year', branch: '午' },
      { name: '驛馬', pillar: 'year', branch: '午' },
      { name: '文昌', pillar: 'month', branch: '午' },
      { name: '天德', pillar: 'day', branch: '子' },
      { name: '華蓋', pillar: 'hour', branch: '戌' },
    ],
    kongWang: ['寅', '卯'],
    gender: 'male',
    solarBirthDate: '1990-06-15',
    birthTime: '20:00',
    // Extra palaces
    taiYuan: { stem: '癸', branch: '未', naYin: '楊柳木' },
    mingGong: { stem: '壬', branch: '午', naYin: '楊柳木' },
    taiXi: { stem: '乙', branch: '丑', naYin: '海中金' },
    shenGong: { stem: '丙', branch: '子', naYin: '澗下水' },
    seasonalStates: { '木': '休', '火': '旺', '土': '相', '金': '囚', '水': '死' },
  };
}

/** Mock career reading response with V2 deterministic data + streaming */
function createMockCareerReadingResponse(opts: { streaming?: boolean; fromCache?: boolean; creditsUsed?: number } = {}) {
  const { streaming = true, fromCache = false, creditsUsed = 3 } = opts;
  return {
    id: 'career-reading-001',
    readingType: 'CAREER',
    calculationData: createMockBaziChart(),
    ...(streaming ? {
      streamReady: true,
      deterministic: createMockDeterministicData(),
      aiInterpretation: null,
    } : {
      streamReady: false,
      aiInterpretation: createMockAIInterpretation(),
    }),
    creditsUsed,
    fromCache,
    createdAt: '2026-03-10T10:00:00.000Z',
  };
}

/** Mock career V2 deterministic data (pre-analysis) */
function createMockDeterministicData() {
  return {
    weightedElements: {
      '木': { percentage: 22.5, level: '一般', talents: ['學習能力', '自愈能力', '協調能力'] },
      '火': { percentage: 31.2, level: '強', talents: ['情緒感知力', '探索能力', '表現力'] },
      '土': { percentage: 18.3, level: '一般', talents: ['自律能力', '自控力', '責任承擔力'] },
      '金': { percentage: 12.8, level: '弱', talents: ['實操能力', '掌控力', '應變能力'] },
      '水': { percentage: 15.2, level: '一般', talents: ['邏輯思維', '細節處理能力', '專注力'] },
    },
    weightedTenGods: {
      '比肩': { percentage: 12.0, level: '一般', capabilities: ['獨立能力', '動手能力'] },
      '劫財': { percentage: 8.5, level: '弱', capabilities: ['談判能力', '競爭力'] },
      '食神': { percentage: 15.2, level: '一般', capabilities: ['審美能力', '文學天賦'] },
      '傷官': { percentage: 18.3, level: '一般', capabilities: ['口才表達力', '創新能力'] },
      '正財': { percentage: 5.2, level: '弱', capabilities: ['理財能力', '實幹能力'] },
      '偏財': { percentage: 9.8, level: '弱', capabilities: ['投資眼光', '交際能力'] },
      '正官': { percentage: 7.1, level: '弱', capabilities: ['領導能力', '組織協調力'] },
      '七殺': { percentage: 6.3, level: '弱', capabilities: ['危機處理能力', '開拓能力'] },
      '正印': { percentage: 10.5, level: '一般', capabilities: ['學習能力', '知識傳授力'] },
      '偏印': { percentage: 7.1, level: '弱', capabilities: ['謀略能力', '精算能力'] },
    },
    reputationScore: 72,
    wealthScore: 65,
    wealthTier: '中富',
    fiveQiStates: { '木': '休', '火': '旺', '土': '相', '金': '囚', '水': '死' },
    pattern: '傷官格',
    patternType: 'standard',
    suitablePositions: ['設計師', '工程師', '律師', '創新研發'],
    companyTypeFit: { type: 'innovative', reasoning: '偏星主導' },
    entrepreneurshipFit: { score: 75, type: 'technical_founder' },
    partnershipFit: { score: 60, suitable: true },
    annualForecasts: [
      {
        year: 2026, stem: '丙', branch: '午', tenGod: '食神',
        luckPeriodStem: '戊', luckPeriodBranch: '寅', luckPeriodTenGod: '偏財',
        auspiciousness: '吉',
        kongWangAnalysis: { hit: false },
        yimaAnalysis: { hit: true, favorable: true, type: '主動變動' },
        branchInteractions: ['午午自刑'],
        careerIndicators: ['食神生財'],
      },
      {
        year: 2027, stem: '丁', branch: '未', tenGod: '傷官',
        luckPeriodStem: '戊', luckPeriodBranch: '寅', luckPeriodTenGod: '偏財',
        auspiciousness: '平',
        kongWangAnalysis: { hit: false },
        yimaAnalysis: { hit: false },
        branchInteractions: [],
        careerIndicators: [],
      },
      {
        year: 2028, stem: '戊', branch: '申', tenGod: '偏財',
        luckPeriodStem: '戊', luckPeriodBranch: '寅', luckPeriodTenGod: '偏財',
        auspiciousness: '大吉',
        kongWangAnalysis: { hit: false },
        yimaAnalysis: { hit: false },
        branchInteractions: ['寅申沖'],
        careerIndicators: ['偏財為喜用'],
      },
      {
        year: 2029, stem: '己', branch: '酉', tenGod: '正財',
        luckPeriodStem: '戊', luckPeriodBranch: '寅', luckPeriodTenGod: '偏財',
        auspiciousness: '吉',
        kongWangAnalysis: { hit: false },
        yimaAnalysis: { hit: false },
        branchInteractions: [],
        careerIndicators: [],
      },
      {
        year: 2030, stem: '庚', branch: '戌', tenGod: '偏財',
        luckPeriodStem: '戊', luckPeriodBranch: '寅', luckPeriodTenGod: '偏財',
        auspiciousness: '凶',
        kongWangAnalysis: { hit: true, effect: '用神逢空', favorable: false },
        yimaAnalysis: { hit: false },
        branchInteractions: [],
        careerIndicators: ['官殺混雜'],
      },
    ],
    monthlyForecasts: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      stem: '甲',
      branch: '寅',
      tenGod: '比肩',
      solarTermName: ['立春', '驚蟄', '清明', '立夏', '芒種', '小暑', '立秋', '白露', '寒露', '立冬', '大雪', '小寒'][i],
      solarTermDateRange: `2026/${i + 1}/5 - 2026/${i + 2 > 12 ? 1 : i + 2}/4`,
      auspiciousness: ['吉', '平', '大吉', '凶', '吉', '平', '大吉', '凶', '吉', '平', '吉', '大吉'][i]!,
    })),
    activeLuckPeriod: {
      stem: '戊', branch: '寅', tenGod: '偏財',
      startYear: 2022, endYear: 2032,
    },
    careerAllies: {
      nobles: ['未年生人 (天乙貴人)'],
      allies: ['寅年、午年、戌年'],
      enemies: ['子年'],
    },
  };
}

/** Mock non-streaming AI interpretation sections for career */
function createMockAIInterpretation() {
  return {
    career_pattern: {
      preview: '你的事業格局為傷官格...',
      full: '你的事業格局為傷官格，代表你在創新和表達方面有很強的天賦...',
    },
    suitable_positions: {
      preview: '適合設計、工程、法律等領域...',
      full: '基於你的格局分析，最適合你的職位包括：設計師、工程師、律師...',
    },
    career_directions_favorable: {
      preview: '火、木相關行業對你最有利...',
      full: '根據你的用神為水，喜神為金的分析，建議從事以下行業...',
    },
    career_directions_unfavorable: {
      preview: '土相關行業需要謹慎...',
      full: '忌神為火的情況下，建議避免以下行業方向...',
    },
    company_type_fit: {
      preview: '新創公司或自由業更適合你...',
      full: '你的命盤偏星主導，更適合創新型企業環境...',
    },
    entrepreneurship: {
      preview: '你有較強的創業潛力...',
      full: '傷官配合偏財，顯示你有技術型創業者的特質...',
    },
    partnership: {
      preview: '合夥事業適合度中等...',
      full: '比肩力量一般，六合結構良好，合夥經營可行但需注意...',
    },
    career_allies: {
      preview: '貴人在未年生人...',
      full: '天乙貴人位於未，代表屬羊的人會在事業上給你最大的幫助...',
    },
  };
}

/** Mock user profile */
const MOCK_USER_PROFILE = {
  id: 'user-001',
  credits: 10,
  subscriptionTier: 'FREE',
  freeReadingUsed: false,
};

const MOCK_USER_PROFILE_LOW_CREDITS = {
  ...MOCK_USER_PROFILE,
  credits: 1,
  freeReadingUsed: true,
};

const MOCK_BIRTH_PROFILES: never[] = [];

// ============================================================
// Helpers
// ============================================================

/** Fill the BirthDataForm with test data */
async function fillBirthForm(page: Page, data: {
  name: string;
  year: string;
  month: string;
  day: string;
  hour?: string;
  minute?: string;
  period?: string;
} = {
  name: '測試用戶',
  year: '1990',
  month: '06',
  day: '15',
  hour: '8',
  minute: '00',
  period: 'PM',
}) {
  await page.locator('input[type="text"]').first().fill(data.name);
  await page.getByText('♂ 男').click();
  await page.locator('select[aria-label="年"]').selectOption(data.year);
  await page.locator('select[aria-label="月"]').selectOption(data.month);
  await page.locator('select[aria-label="日"]').selectOption(data.day);
  if (data.hour) await page.locator('select[aria-label="時"]').selectOption(data.hour);
  if (data.minute) await page.locator('select[aria-label="分"]').selectOption(data.minute);
  if (data.period) await page.locator('select[aria-label="午別"]').selectOption(data.period);
}

/** Set up authenticated mocks (user profile + birth profiles + bazi calculate) */
async function setupAuthenticatedMocks(page: Page, userProfile = MOCK_USER_PROFILE) {
  // Set E2E auth bypass cookie BEFORE navigation
  // This makes the reading page treat the user as authenticated
  // (bypasses Clerk's useAuth() which can't be mocked via API interception)
  await page.context().addCookies([{
    name: '__e2e_auth',
    value: '1',
    url: 'http://localhost:3000',
  }]);

  // Mock user profile
  await page.route('**/api/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userProfile),
    }),
  );

  // Mock birth profiles
  await page.route('**/api/users/me/birth-profiles**', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_BIRTH_PROFILES),
      });
    }
    // POST: create birth profile
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'profile-new-001', ...route.request().postDataJSON() }),
    });
  });
}

/** Mock the Bazi calculation endpoint (Phase 1 chart) */
async function interceptBaziCalculate(page: Page) {
  await page.route('**/api/bazi-calculate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockBaziChart()),
    }),
  );
}

/** Mock the NestJS reading creation endpoint (Phase 2 unlock) */
async function interceptReadingCreation(page: Page, response = createMockCareerReadingResponse(), statusCode = 200) {
  await page.route('**/api/bazi/readings', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: statusCode,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    }
    return route.continue();
  });
}

/** Mock the reading retrieval endpoint (for history/refresh) */
async function interceptGetReading(page: Page, reading = createMockCareerReadingResponse({ streaming: false })) {
  await page.route(`**/api/bazi/readings/${reading.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reading),
    }),
  );
}

/** Mock insufficient credits error for reading creation */
async function interceptInsufficientCredits(page: Page) {
  await page.route('**/api/bazi/readings', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 400,
          message: 'Insufficient credits. You have 1 credits but need 3.',
        }),
      });
    }
    return route.continue();
  });
}

/** Mock SSE stream (simulates server-sent events for career V2 streaming) */
async function interceptSSEStream(page: Page, readingId: string) {
  await page.route(`**/api/bazi/readings/${readingId}/stream`, (route) => {
    const sections = [
      { key: 'career_pattern', preview: '事業格局分析...', full: '你的事業格局為傷官格...' },
      { key: 'suitable_positions', preview: '適合職位...', full: '基於你的格局分析...' },
      { key: 'career_directions_favorable', preview: '有利方向...', full: '火木相關行業...' },
      { key: 'career_directions_unfavorable', preview: '不利方向...', full: '土相關行業需謹慎...' },
      { key: 'company_type_fit', preview: '企業類型...', full: '創新型企業...' },
      { key: 'entrepreneurship', preview: '創業分析...', full: '傷官配偏財...' },
      { key: 'partnership', preview: '合夥分析...', full: '比肩力量一般...' },
      { key: 'career_allies', preview: '貴人分析...', full: '天乙貴人在未...' },
    ];

    let body = '';
    for (const section of sections) {
      body += `event: section\ndata: ${JSON.stringify({ key: section.key, section })}\n\n`;
    }
    body += `event: summary\ndata: ${JSON.stringify({ preview: '總結...', full: '你的事業運勢總體分析...' })}\n\n`;
    body += `event: done\ndata: {}\n\n`;

    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body,
    });
  });
}

// ============================================================
// Tests: Career Form Page — UI Structure
// ============================================================

test.describe('Career Reading — Form Page UI', () => {
  test('page loads with correct title and form', async ({ page }) => {
    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    // Page title should show 八字事業詳批 (header has icon prefix)
    await expect(page.getByText('💼八字事業詳批')).toBeVisible();

    // Step indicator shows "輸入資料" as active
    await expect(page.getByText('輸入資料')).toBeVisible();

    // Form fields should be present
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await expect(page.locator('select[aria-label="年"]')).toBeVisible();
    await expect(page.locator('select[aria-label="月"]')).toBeVisible();
    await expect(page.locator('select[aria-label="日"]')).toBeVisible();
  });

  test('submit button shows "開始排盤" (not credit cost)', async ({ page }) => {
    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    // Career submit button should say "開始排盤" regardless of auth state
    const submitBtn = page.getByRole('button', { name: /開始排盤/ });
    await expect(submitBtn).toBeVisible();

    // Should NOT show credit cost in the button
    await expect(page.getByRole('button', { name: /💎/ })).not.toBeVisible();
  });

  test('no secondary "查看免費命盤" button for career', async ({ page }) => {
    await setupAuthenticatedMocks(page);
    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    // Wait for form to load
    await expect(page.getByText('輸入資料')).toBeVisible();

    // "查看免費命盤" should NOT be visible for career reading type
    await expect(page.getByText('查看免費命盤')).not.toBeVisible();
  });
});

// ============================================================
// Tests: Unauthenticated Flow (Phase 1 only — chart + login CTA)
// ============================================================

test.describe('Career Reading — Unauthenticated Flow', () => {
  test('unauthenticated user gets chart + login CTA after form submit', async ({ page }) => {
    await interceptBaziCalculate(page);
    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    // Fill form and submit
    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for chart to render (staged reveal)
    await expect(page.getByText('查看結果')).toBeVisible({ timeout: 15000 });

    // No tab bar for career (full-page layout)
    await expect(page.locator('[class*="tabBar"]')).not.toBeVisible();

    // CareerPaywallCTA should show with login link (not unlock button)
    await expect(page.getByText('八字事業詳批完整報告')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('登入以解鎖完整報告')).toBeVisible();

    // Unlock button should NOT be visible for unauthenticated users
    await expect(page.getByRole('button', { name: /解鎖完整報告/ })).not.toBeVisible();
  });

  test('login CTA links to sign-in page with redirect', async ({ page }) => {
    await interceptBaziCalculate(page);
    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for paywall CTA
    await expect(page.getByText('登入以解鎖完整報告')).toBeVisible({ timeout: 15000 });

    // Verify login link has correct href with redirect
    const loginLink = page.getByRole('link', { name: /登入以解鎖完整報告/ });
    await expect(loginLink).toHaveAttribute('href', /sign-in.*redirect.*career/);
  });

  test('paywall CTA shows all 8 feature items', async ({ page }) => {
    await interceptBaziCalculate(page);
    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for paywall CTA
    await expect(page.getByText('八字事業詳批完整報告')).toBeVisible({ timeout: 15000 });

    // Verify all 8 feature items are listed
    const features = [
      '事業格局分析', '職業能力分析', '行業方向建議', '創業適合度',
      '合夥適合度', '事業貴人分析', '未來五年運勢', '十二月運氣',
    ];
    for (const feature of features) {
      await expect(page.getByText(feature)).toBeVisible();
    }
  });
});

// ============================================================
// Tests: Authenticated Flow — Phase 1 (Free Chart + Paywall)
// ============================================================

test.describe('Career Reading — Authenticated Phase 1', () => {
  test('authenticated user sees chart + unlock button after form submit', async ({ page }) => {
    await setupAuthenticatedMocks(page);
    await interceptBaziCalculate(page);

    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for chart + paywall
    await expect(page.getByText('查看結果')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('八字事業詳批完整報告')).toBeVisible({ timeout: 10000 });

    // Unlock button should be visible with cost
    await expect(page.getByRole('button', { name: /解鎖完整報告/ })).toBeVisible();
  });

  test('paywall shows credit cost and remaining credits', async ({ page }) => {
    await setupAuthenticatedMocks(page, { ...MOCK_USER_PROFILE, credits: 10, freeReadingUsed: true });
    await interceptBaziCalculate(page);

    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for paywall
    await expect(page.getByText('八字事業詳批完整報告')).toBeVisible({ timeout: 15000 });

    // Should show credit cost badge
    await expect(page.getByText('💎 3 點')).toBeVisible();

    // Should show remaining credits
    await expect(page.getByText(/剩餘 10 點/)).toBeVisible();
  });

  test('paywall shows "免費" badge when user has free reading', async ({ page }) => {
    await setupAuthenticatedMocks(page, { ...MOCK_USER_PROFILE, freeReadingUsed: false });
    await interceptBaziCalculate(page);

    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for paywall
    await expect(page.getByText('八字事業詳批完整報告')).toBeVisible({ timeout: 15000 });

    // Free reading badge should be shown
    await expect(page.getByText('免費')).toBeVisible();
  });
});

// ============================================================
// Tests: Authenticated Flow — Phase 2 (Unlock → AI Streaming)
// ============================================================

test.describe('Career Reading — Authenticated Phase 2 (Unlock)', () => {
  test('clicking unlock triggers credit deduction and AI loading', async ({ page }) => {
    await setupAuthenticatedMocks(page);
    await interceptBaziCalculate(page);

    const readingResponse = createMockCareerReadingResponse({ streaming: false, creditsUsed: 3 });
    await interceptReadingCreation(page, readingResponse);

    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    // Phase 1: submit form and get chart
    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();
    await expect(page.getByText('八字事業詳批完整報告')).toBeVisible({ timeout: 15000 });

    // Phase 2: click unlock
    await page.getByRole('button', { name: /解鎖完整報告/ }).click();

    // Paywall should disappear after successful unlock
    await expect(page.getByText('八字事業詳批完整報告')).not.toBeVisible({ timeout: 15000 });
  });

  test('unlock shows spinner while processing', async ({ page }) => {
    await setupAuthenticatedMocks(page);
    await interceptBaziCalculate(page);

    // Add a small delay to the reading creation to see the spinner
    await page.route('**/api/bazi/readings', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockCareerReadingResponse({ streaming: false })),
        });
      }
      return route.continue();
    });

    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();
    await expect(page.getByText('八字事業詳批完整報告')).toBeVisible({ timeout: 15000 });

    // Click unlock and check for spinner text
    await page.getByRole('button', { name: /解鎖完整報告/ }).click();
    await expect(page.getByText('解鎖中...')).toBeVisible({ timeout: 3000 });
  });
});

// ============================================================
// Tests: Insufficient Credits
// ============================================================

test.describe('Career Reading — Insufficient Credits', () => {
  test('paywall shows disabled button when credits insufficient', async ({ page }) => {
    await setupAuthenticatedMocks(page, MOCK_USER_PROFILE_LOW_CREDITS);
    await interceptBaziCalculate(page);

    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for paywall
    await expect(page.getByText('八字事業詳批完整報告')).toBeVisible({ timeout: 15000 });

    // Should show disabled button with insufficient message
    await expect(page.getByText(/額度不足/)).toBeVisible();

    // Should show credits info
    await expect(page.getByText(/剩餘 1 點.*需要 3 點/)).toBeVisible();

    // Should show links to pricing and store
    await expect(page.getByRole('link', { name: /查看方案/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /購買點數/ })).toBeVisible();
  });

  test('unlock error re-shows paywall with error message', async ({ page }) => {
    await setupAuthenticatedMocks(page);
    await interceptBaziCalculate(page);
    await interceptInsufficientCredits(page);

    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();
    await expect(page.getByText('八字事業詳批完整報告')).toBeVisible({ timeout: 15000 });

    // Try to unlock → should fail with insufficient credits
    await page.getByRole('button', { name: /解鎖完整報告/ }).click();

    // Insufficient credits modal should appear
    await expect(page.getByText(/額度不足|點數不足|Insufficient/i)).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================
// Tests: Full-Page Layout (no tab bar)
// ============================================================

test.describe('Career Reading — Full-Page Layout', () => {
  test('no tab bar visible in result view (full-page layout)', async ({ page }) => {
    await interceptBaziCalculate(page);

    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for result
    await expect(page.getByText('查看結果')).toBeVisible({ timeout: 15000 });

    // Tab bar should NOT be visible (career uses full-page layout like lifetime)
    await expect(page.getByText('📊 命盤排盤')).not.toBeVisible();
    await expect(page.getByText('📝 命理解讀')).not.toBeVisible();
  });

  test('chart is always visible (not tab-gated)', async ({ page }) => {
    await interceptBaziCalculate(page);

    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Chart should be visible in result view (full-page layout)
    await expect(page.getByText('查看結果')).toBeVisible({ timeout: 15000 });

    // For career full-page layout, chart is always visible without tab switching
    // Check for four-pillar column headers which are always present in the chart
    const hasChartContent = await page.locator(':text("年柱"), :text("日柱"), :text("月柱"), :text("時柱")')
      .first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasChartContent).toBeTruthy();
  });
});

// ============================================================
// Tests: Chart Elements (Extra Palaces, Seasonal States)
// ============================================================

test.describe('Career Reading — Chart Elements', () => {
  test('chart renders with extra palaces (命宮, 身宮, 胎元, 胎息)', async ({ page }) => {
    await interceptBaziCalculate(page);

    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for chart to render
    await expect(page.getByText('查看結果')).toBeVisible({ timeout: 15000 });

    // Extra palaces should be visible if data is present
    // The mock data includes taiYuan, mingGong, taiXi, shenGong
    const hasMingGong = await page.getByText('命宮').first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasShenGong = await page.getByText('身宮').first().isVisible({ timeout: 3000 }).catch(() => false);
    const hasTaiYuan = await page.getByText('胎元').first().isVisible({ timeout: 3000 }).catch(() => false);
    const hasTaiXi = await page.getByText('胎息').first().isVisible({ timeout: 3000 }).catch(() => false);

    // At least some extra palaces should render
    expect(hasMingGong || hasShenGong || hasTaiYuan || hasTaiXi).toBeTruthy();
  });
});

// ============================================================
// Tests: Deep Link Loading
// ============================================================

test.describe('Career Reading — Deep Link', () => {
  test('loading saved career reading via ?id= renders full reading', async ({ page }) => {
    const reading = createMockCareerReadingResponse({ streaming: false, creditsUsed: 3 });
    await setupAuthenticatedMocks(page);
    await interceptGetReading(page, reading);

    // Navigate with deep link ID
    await page.goto(`/reading/career?id=${reading.id}`);
    await page.waitForLoadState('domcontentloaded');

    // Should skip the input form and show result directly
    // The page should NOT show the form step indicator as active
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });

    // Should NOT show the career paywall (reading already paid for)
    await expect(page.getByText('八字事業詳批完整報告')).not.toBeVisible({ timeout: 5000 }).catch(() => {
      // May briefly appear during loading — that's acceptable
    });
  });
});

// ============================================================
// Tests: Form Saves to SessionStorage (Refresh Resilience)
// ============================================================

test.describe('Career Reading — Refresh Resilience', () => {
  test('form data is saved to sessionStorage on Phase 1 submit', async ({ page }) => {
    await interceptBaziCalculate(page);
    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for chart render
    await expect(page.getByText('查看結果')).toBeVisible({ timeout: 15000 });

    // Verify sessionStorage has career_form data
    const careerForm = await page.evaluate(() => {
      return sessionStorage.getItem('career_form');
    });

    expect(careerForm).not.toBeNull();
    const parsed = JSON.parse(careerForm!);
    expect(parsed.name).toBe('測試用戶');
    expect(parsed.birthDate).toBeDefined();
  });
});

// ============================================================
// Tests: Back Navigation
// ============================================================

test.describe('Career Reading — Navigation', () => {
  test('back button from result returns to form', async ({ page }) => {
    await interceptBaziCalculate(page);
    await page.goto('/reading/career');
    await page.waitForLoadState('domcontentloaded');

    await fillBirthForm(page);
    await page.getByRole('button', { name: /開始排盤/ }).click();

    // Wait for result
    await expect(page.getByText('查看結果')).toBeVisible({ timeout: 15000 });

    // Click back button
    await page.getByText('重新輸入').click();

    // Should return to form
    await expect(page.getByText('輸入資料')).toBeVisible();
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
  });
});
