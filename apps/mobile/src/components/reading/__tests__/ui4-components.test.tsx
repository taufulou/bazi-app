import { render, screen, fireEvent, act } from '@testing-library/react-native';
import StepIndicator from '../StepIndicator';
import PaywallCTA from '../PaywallCTA';
import CrossSellGrid from '../CrossSellGrid';
import TechRefCard from '../TechRefCard';
import { SECTION_TECH_BUILDERS } from '../techRefBuilders';

describe('StepIndicator', () => {
  it('input step → 輸入資料 numbered 1, 查看結果 numbered 2', async () => {
    await render(<StepIndicator current="input" />);
    expect(screen.getByText('輸入資料')).toBeTruthy();
    expect(screen.getByText('查看結果')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('result step → 輸入資料 marked completed (✓)', async () => {
    await render(<StepIndicator current="result" />);
    expect(screen.getByText('✓')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('1')).toBeNull();
  });
});

describe('PaywallCTA', () => {
  it('lifetime → title + all 9 feature bullets + unlock button when credits suffice', async () => {
    await render(
      <PaywallCTA
        readingType="lifetime"
        creditCost={3}
        currentCredits={10}
        onUnlock={() => {}}
        onBuyCredits={() => {}}
      />,
    );
    expect(screen.getByText('八字終身運完整報告')).toBeTruthy();
    for (const b of ['性格特質', '日主分析', '五行平衡', '十神分布', '大運流年', '神煞解析', '六親關係', '人生指引', '財運分析']) {
      expect(screen.getByText(b)).toBeTruthy();
    }
    expect(screen.getByText('解鎖完整報告')).toBeTruthy();
  });

  it('insufficient credits → 額度不足 + 購買點數, no unlock', async () => {
    await render(
      <PaywallCTA
        readingType="career"
        creditCost={3}
        currentCredits={1}
        onUnlock={() => {}}
        onBuyCredits={() => {}}
      />,
    );
    expect(screen.getByText('八字事業詳批完整報告')).toBeTruthy();
    expect(screen.getByText(/額度不足/)).toBeTruthy();
    expect(screen.getByText(/購買點數/)).toBeTruthy();
    expect(screen.queryByText('解鎖完整報告')).toBeNull();
  });

  it('unknown type → renders nothing', async () => {
    const { toJSON } = await render(
      <PaywallCTA readingType="zwds" creditCost={3} currentCredits={9} onUnlock={() => {}} onBuyCredits={() => {}} />,
    );
    expect(toJSON()).toBeNull();
  });
});

describe('CrossSellGrid', () => {
  it('filters out the current reading type', async () => {
    await render(<CrossSellGrid readingType="lifetime" />);
    expect(screen.queryByText('八字終身運')).toBeNull(); // current type excluded
    expect(screen.getByText('八字流年運勢')).toBeTruthy();
    expect(screen.getByText('合盤比較')).toBeTruthy();
  });
});

describe('TechRefCard', () => {
  // buildChartIdentity needs dayMaster → yields 【日主概要】.
  const chartData = { dayMaster: { element: '土', yinYang: '陽', strength: 'weak' }, dayMasterStem: '戊' };

  it('the copied builder yields 【日主概要】 groups for chart_identity', () => {
    const groups = SECTION_TECH_BUILDERS['chart_identity'](chartData);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.map((g) => g.category)).toContain('【日主概要】');
    // 戊（土陽） value survives the empty-item filter
    const daySummary = groups.find((g) => g.category === '【日主概要】');
    expect(daySummary?.items[0].value).toBe('戊（土陽）');
  });

  it('renders the 專業命理依據 toggle; group content hidden until expanded', async () => {
    await render(<TechRefCard sectionKey="chart_identity" chartData={chartData} />);
    expect(screen.getByText('專業命理依據')).toBeTruthy();
    expect(screen.queryByText('【日主概要】')).toBeNull();
    // React 19 + jest-expo defers the setState flush → wrap in async act (repo
    // pattern, CLAUDE.md M4 test notes).
    await act(async () => {
      fireEvent.press(screen.getByTestId('techref-toggle'));
    });
    expect(screen.getByText('【日主概要】')).toBeTruthy();
  });

  it('returns null when no builder groups (unknown section or no chart)', async () => {
    const { toJSON: a } = await render(<TechRefCard sectionKey="nonexistent_key" chartData={chartData} />);
    expect(a()).toBeNull();
    const { toJSON: b } = await render(<TechRefCard sectionKey="chart_identity" chartData={null} />);
    expect(b()).toBeNull();
  });
});
