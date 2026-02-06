/**
 * Tests for BaziChart component.
 * Validates that chart renders correctly with various data structures.
 */
import { render, screen } from '@testing-library/react';
import BaziChart from '../app/components/BaziChart';

// ============================================================
// Sample chart data (mimics Python engine output)
// ============================================================

const SAMPLE_CHART_DATA = {
  fourPillars: {
    year: {
      stem: '庚',
      branch: '午',
      stemElement: '金',
      branchElement: '火',
      hiddenStems: ['丁', '己'],
      tenGod: '比肩',
      naYin: '路旁土',
      shenSha: [],
      lifeStage: '沐浴',
    },
    month: {
      stem: '辛',
      branch: '巳',
      stemElement: '金',
      branchElement: '火',
      hiddenStems: ['丙', '庚', '戊'],
      tenGod: '劫財',
      naYin: '白蠟金',
      shenSha: ['文昌'],
      lifeStage: '長生',
    },
    day: {
      stem: '庚',
      branch: '辰',
      stemElement: '金',
      branchElement: '土',
      hiddenStems: ['戊', '乙', '癸'],
      tenGod: null,
      naYin: '白蠟金',
      shenSha: ['華蓋'],
      lifeStage: '養',
    },
    hour: {
      stem: '癸',
      branch: '未',
      stemElement: '水',
      branchElement: '土',
      hiddenStems: ['己', '丁', '乙'],
      tenGod: '傷官',
      naYin: '楊柳木',
      shenSha: [],
      lifeStage: '衰',
    },
  },
  dayMaster: {
    element: '金',
    yinYang: '陽',
    strength: 'neutral',
    strengthScore: 55,
    pattern: '食神格',
    sameParty: 39,
    oppositeParty: 61,
    favorableGod: '土',
    usefulGod: '金',
    idleGod: '水',
    tabooGod: '火',
    enemyGod: '木',
  },
  dayMasterStem: '庚',
  fiveElementsBalanceZh: {
    '木': 10.0,
    '火': 25.0,
    '土': 25.0,
    '金': 25.0,
    '水': 15.0,
  },
  fiveElementsBalance: {
    wood: 10.0,
    fire: 25.0,
    earth: 25.0,
    metal: 25.0,
    water: 15.0,
  },
  trueSolarTime: {
    clock_time: '14:30',
    true_solar_time: '14:24',
    total_adjustment: -6.0,
  },
  lunarDate: {
    year: 1990,
    month: 4,
    day: 21,
    isLeapMonth: false,
  },
  luckPeriods: [
    {
      startAge: 5,
      endAge: 14,
      startYear: 1995,
      endYear: 2004,
      stem: '壬',
      branch: '午',
      tenGod: '食神',
      isCurrent: false,
    },
    {
      startAge: 15,
      endAge: 24,
      startYear: 2005,
      endYear: 2014,
      stem: '癸',
      branch: '未',
      tenGod: '傷官',
      isCurrent: false,
    },
    {
      startAge: 35,
      endAge: 44,
      startYear: 2025,
      endYear: 2034,
      stem: '乙',
      branch: '酉',
      tenGod: '正財',
      isCurrent: true,
    },
  ],
  allShenSha: [
    { name: '文昌', pillar: 'month', branch: '巳' },
    { name: '華蓋', pillar: 'day', branch: '辰' },
  ],
  kongWang: ['寅', '卯'],
};

// ============================================================
// Tests
// ============================================================

describe('BaziChart', () => {
  describe('Profile Header', () => {
    it('should display name when provided', () => {
      render(
        <BaziChart
          data={SAMPLE_CHART_DATA}
          name="王小明"
          birthDate="1990-05-15"
          birthTime="14:30"
        />,
      );
      expect(screen.getByText('王小明 的八字命盤')).toBeInTheDocument();
    });

    it('should display birth date and time', () => {
      render(
        <BaziChart
          data={SAMPLE_CHART_DATA}
          name="王小明"
          birthDate="1990-05-15"
          birthTime="14:30"
        />,
      );
      expect(screen.getByText(/公曆：1990-05-15/)).toBeInTheDocument();
    });

    it('should display lunar date', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText(/1990年/)).toBeInTheDocument();
      expect(screen.getByText(/4月21日/)).toBeInTheDocument();
    });

    it('should display true solar time with adjustment', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText(/真太陽時：14:24/)).toBeInTheDocument();
      expect(screen.getByText(/校正/)).toBeInTheDocument();
    });
  });

  describe('Four Pillars Table', () => {
    it('should display section title', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('四柱排盤')).toBeInTheDocument();
    });

    it('should display pillar labels', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('時柱')).toBeInTheDocument();
      expect(screen.getByText('日柱')).toBeInTheDocument();
      expect(screen.getByText('月柱')).toBeInTheDocument();
      expect(screen.getByText('年柱')).toBeInTheDocument();
    });

    it('should display heavenly stems', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // Year stem 庚, month 辛, day 庚, hour 癸
      const gengCells = screen.getAllByText('庚');
      expect(gengCells.length).toBeGreaterThanOrEqual(2); // Day + Year both have 庚
      expect(screen.getByText('辛')).toBeInTheDocument();
      // 癸 appears in stem cell AND hidden stems, so use getAllByText
      const guiCells = screen.getAllByText('癸');
      expect(guiCells.length).toBeGreaterThanOrEqual(1);
    });

    it('should display earthly branches', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('午')).toBeInTheDocument();
      expect(screen.getByText('巳')).toBeInTheDocument();
      expect(screen.getByText('辰')).toBeInTheDocument();
      expect(screen.getByText('未')).toBeInTheDocument();
    });

    it('should display ten gods', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // Ten gods may appear in both pillar row and luck periods
      const biJianCells = screen.getAllByText('比肩');
      expect(biJianCells.length).toBeGreaterThanOrEqual(1);
      const jeCaiCells = screen.getAllByText('劫財');
      expect(jeCaiCells.length).toBeGreaterThanOrEqual(1);
      const shangGuanCells = screen.getAllByText('傷官');
      expect(shangGuanCells.length).toBeGreaterThanOrEqual(1);
    });

    it('should display "—" for day pillar ten god (null)', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // Day pillar tenGod is null, should show —
      const dashCells = screen.getAllByText('—');
      expect(dashCells.length).toBeGreaterThanOrEqual(1);
    });

    it('should display hidden stems', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // Hidden stems 丁 appears in year and hour hidden stems
      const dingCells = screen.getAllByText('丁');
      expect(dingCells.length).toBeGreaterThanOrEqual(2);
    });

    it('should display na yin', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('路旁土')).toBeInTheDocument();
      expect(screen.getByText('楊柳木')).toBeInTheDocument();
    });

    it('should display shen sha for pillars', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // 文昌 appears in pillar row and allShenSha section
      const wenchangCells = screen.getAllByText('文昌');
      expect(wenchangCells.length).toBeGreaterThanOrEqual(1);
      const huagaiCells = screen.getAllByText('華蓋');
      expect(huagaiCells.length).toBeGreaterThanOrEqual(1);
    });

    it('should display day master badge', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // 日主 appears as badge in table AND as label in day master section
      const riZhuCells = screen.getAllByText('日主');
      expect(riZhuCells.length).toBeGreaterThanOrEqual(2);
    });

    it('should display life stage row when available', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // 長生 is both the life stage label (row header) and a life stage value
      const changShengCells = screen.getAllByText('長生');
      expect(changShengCells.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('沐浴')).toBeInTheDocument();
    });
  });

  describe('Five Elements Balance', () => {
    it('should display section title', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('五行能量')).toBeInTheDocument();
    });

    it('should display all five elements', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('Wood')).toBeInTheDocument();
      expect(screen.getByText('Fire')).toBeInTheDocument();
      expect(screen.getByText('Earth')).toBeInTheDocument();
      expect(screen.getByText('Metal')).toBeInTheDocument();
      expect(screen.getByText('Water')).toBeInTheDocument();
    });

    it('should display percentages', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('10.0%')).toBeInTheDocument();
      // 25.0% appears 3 times (fire, earth, metal)
      const twentyFivePcts = screen.getAllByText('25.0%');
      expect(twentyFivePcts.length).toBe(3);
      expect(screen.getByText('15.0%')).toBeInTheDocument();
    });
  });

  describe('Day Master Analysis', () => {
    it('should display section title', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('日主分析')).toBeInTheDocument();
    });

    it('should display day master stem and element', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText(/庚（金陽）/)).toBeInTheDocument();
    });

    it('should display strength', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText(/中和/)).toBeInTheDocument();
      expect(screen.getByText(/55分/)).toBeInTheDocument();
    });

    it('should display pattern', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      const patternCells = screen.getAllByText('食神格');
      expect(patternCells.length).toBeGreaterThanOrEqual(1);
    });

    it('should display same/opposite party percentages', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('39%')).toBeInTheDocument();
      expect(screen.getByText('61%')).toBeInTheDocument();
    });

    it('should display five gods', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText(/喜神：土/)).toBeInTheDocument();
      expect(screen.getByText(/用神：金/)).toBeInTheDocument();
      expect(screen.getByText(/閒神：水/)).toBeInTheDocument();
      expect(screen.getByText(/忌神：火/)).toBeInTheDocument();
      expect(screen.getByText(/仇神：木/)).toBeInTheDocument();
    });
  });

  describe('Luck Periods', () => {
    it('should display section title', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('大運')).toBeInTheDocument();
    });

    it('should display luck period cards', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('5–14歲')).toBeInTheDocument();
      expect(screen.getByText('35–44歲')).toBeInTheDocument();
    });

    it('should display year ranges', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('1995–2004')).toBeInTheDocument();
      expect(screen.getByText('2025–2034')).toBeInTheDocument();
    });

    it('should display stem-branch pairs', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('壬午')).toBeInTheDocument();
      expect(screen.getByText('乙酉')).toBeInTheDocument();
    });

    it('should highlight current period', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText('← 目前')).toBeInTheDocument();
    });

    it('should not render when luckPeriods is empty', () => {
      const dataWithoutLuck = {
        ...SAMPLE_CHART_DATA,
        luckPeriods: [],
      };
      render(<BaziChart data={dataWithoutLuck} />);
      expect(screen.queryByText('大運')).not.toBeInTheDocument();
    });
  });

  describe('Shen Sha & Kong Wang', () => {
    it('should display shen sha tags', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(
        screen.getByText('文昌（month·巳）'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('華蓋（day·辰）'),
      ).toBeInTheDocument();
    });

    it('should display kong wang', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText(/空亡/)).toBeInTheDocument();
      // Kong wang branches are rendered with separator
      // 寅 and 卯 are in spans within the kong wang text
      expect(screen.getByText(/寅/)).toBeInTheDocument();
      expect(screen.getByText('卯')).toBeInTheDocument();
    });

    it('should handle empty shen sha', () => {
      const dataNoShenSha = {
        ...SAMPLE_CHART_DATA,
        allShenSha: [],
      };
      render(<BaziChart data={dataNoShenSha} />);
      expect(
        screen.getByText('此命盤無特殊神煞'),
      ).toBeInTheDocument();
    });
  });
});
