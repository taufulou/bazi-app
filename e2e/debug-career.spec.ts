import { test, expect } from '@playwright/test';

test('debug career submit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`PAGE_ERROR: ${e.message}`));
  page.on('console', msg => {
    if(msg.type() === 'error') errors.push(`CONSOLE_ERROR: ${msg.text()}`);
  });

  await page.route('**/api/bazi-calculate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fourPillars: {
          year: { stem: '庚', branch: '午', hiddenStems: ['丁', '己'], naYin: '路旁土' },
          month: { stem: '壬', branch: '午', hiddenStems: ['丁', '己'], naYin: '楊柳木' },
          day: { stem: '甲', branch: '子', hiddenStems: ['癸'], naYin: '海中金' },
          hour: { stem: '甲', branch: '戌', hiddenStems: ['辛', '丁', '戊'], naYin: '山頭火' },
        },
        dayMaster: { stem: '甲', element: '木', yinYang: '陽' },
        fiveElements: { wood: 2, fire: 3, earth: 2, metal: 1, water: 2 },
        gender: 'male',
      }),
    }),
  );

  await page.goto('/reading/career');
  await page.waitForLoadState('domcontentloaded');

  await page.locator('input[type="text"]').first().fill('測試');
  await page.getByText('♂ 男').click();
  await page.locator('select[aria-label="年"]').selectOption('1990');
  await page.locator('select[aria-label="月"]').selectOption('06');
  await page.locator('select[aria-label="日"]').selectOption('15');
  await page.locator('select[aria-label="時"]').selectOption('8');
  await page.locator('select[aria-label="分"]').selectOption('00');
  await page.locator('select[aria-label="午別"]').selectOption('PM');

  const btn = page.getByRole('button', { name: /開始排盤/ });
  await expect(btn).toBeEnabled({ timeout: 5000 });
  await btn.click();

  // Wait and collect errors
  await page.waitForTimeout(8000);

  // Print errors to stdout
  for (const e of errors) {
    console.log(e);
  }

  const hasOops = await page.getByText('Oops').isVisible().catch(() => false);
  console.log(`HAS_OOPS: ${hasOops}`);

  const hasResult = await page.getByText('查看結果').isVisible().catch(() => false);
  console.log(`HAS_RESULT: ${hasResult}`);

  const hasPaywall = await page.getByText('八字事業詳批完整報告').isVisible().catch(() => false);
  console.log(`HAS_PAYWALL: ${hasPaywall}`);

  // Force fail to see output
  expect(errors.join('\n')).toBe('NO_ERRORS');
});
