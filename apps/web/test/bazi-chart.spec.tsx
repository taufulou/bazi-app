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
      // The profile name is wrapped in a <span data-no-zh> (skip-list for the
      // 繁/簡 converter — user-entered names must never convert), so the heading
      // text spans two nodes. Match on the container's concatenated textContent.
      expect(
        screen.getByText(
          (_content, element) => element?.textContent === '王小明 的八字命盤',
        ),
      ).toBeInTheDocument();
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

  });

  describe('Four Pillars Table', () => {
    it('should display section title', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      expect(screen.getByText(/八字命格/)).toBeInTheDocument();
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

    it('should display 日元 for day pillar ten god', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // Day pillar shows 日元 instead of tenGod value
      expect(screen.getByText('日元')).toBeInTheDocument();
    });

    it('should display hidden stems', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // Hidden stems now render as stem+element (e.g., 丁火), use regex partial match
      const dingCells = screen.getAllByText(/丁/);
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

    it('should display day master label in analysis section', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // 日主 appears as label in day master analysis section
      const riZhuCells = screen.getAllByText('日主');
      expect(riZhuCells.length).toBeGreaterThanOrEqual(1);
    });

    it('should display life stage row when available', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // Row label is now 十二運; 長生 appears as a data value in the cell
      expect(screen.getByText('十二運')).toBeInTheDocument();
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
      // Elements shown as CJK characters inside SVG ring overlays
      expect(screen.getAllByText('木').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('火').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('土').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('金').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('水').length).toBeGreaterThanOrEqual(1);
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

  /**
   * The standalone 神煞 & 空亡 section is OFF — see SHOW_SHENSHA_SECTION in
   * BaziChart.tsx. It duplicated the 神煞 row of the pillars table.
   *
   * These assert its ABSENCE rather than being deleted, so that turning the flag
   * back on FAILS here and whoever does it is told to restore the original
   * render assertions (they are in git history, on the commit that hid this).
   * A deleted test would have let the section come back untested instead.
   */
  /**
   * The 藏干 cell has TWO render paths and SAMPLE_CHART_DATA only exercises one:
   * with no `hiddenStemGods`, every other test in this file falls through to the
   * legacy bare-stem branch. So the ten-god-prominent layout — the thing that was
   * actually changed — had no coverage at all until these.
   */
  describe('藏干 hidden-stem cell — ten god is prominent and uniform', () => {
    const withGods = {
      ...SAMPLE_CHART_DATA,
      fourPillars: {
        ...SAMPLE_CHART_DATA.fourPillars,
        month: {
          ...SAMPLE_CHART_DATA.fourPillars.month,
          // Three stems, so 本氣/中氣/餘氣 are all present and any per-rank styling
          // would show up as a difference between them.
          hiddenStemGods: [
            { stem: '丙', element: '火', tenGod: '正官' },
            { stem: '庚', element: '金', tenGod: '劫財' },
            { stem: '戊', element: '土', tenGod: '正印' },
          ],
        },
      },
    };

    it('renders the ten god BEFORE its stem+element', () => {
      const { container } = render(<BaziChart data={withGods} />);
      const god = container.querySelector('[class*="hiddenStemGod"]');
      const element = container.querySelector('[class*="hiddenStemElement"]');
      expect(god).toBeTruthy();
      expect(element).toBeTruthy();
      expect(god!.textContent).toBe('正官');
      expect(element!.textContent).toBe('丙火');
      // DOCUMENT_POSITION_FOLLOWING === the god comes first in the DOM.
      expect(god!.compareDocumentPosition(element!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('styles every ten god identically regardless of 本氣/中氣/餘氣 rank', () => {
      const { container } = render(<BaziChart data={withGods} />);
      const gods = Array.from(container.querySelectorAll('[class*="hiddenStemGod"]'));
      expect(gods.map((g) => g.textContent)).toEqual(['正官', '劫財', '正印']);
      // Rank is carried by ORDER alone. Two earlier attempts encoded it in the
      // type instead — an opacity fade (which put 庚金 at 2.21:1) and then a size
      // step — and both only made the lower rows harder to read. A single shared
      // class, and no inline style on any of them, is what keeps that out.
      const classes = new Set(gods.map((g) => g.getAttribute('class')));
      expect(classes.size).toBe(1);
      expect(gods.every((g) => !g.getAttribute('style'))).toBe(true);
    });
  });

  describe('Shen Sha & Kong Wang — standalone section is hidden', () => {
    it('does not render the 神煞 tags of the standalone section', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // The pillars table still shows bare 神煞 names; only THIS section renders
      // them with the 「name（pillar·branch）」 form, so it is the precise probe.
      //
      // ⚠️ The pillar is TRANSLATED — `PILLAR_LABELS[sha.pillar] || sha.pillar`
      // turns the fixture's `month`/`day` into 月柱/日柱. Asserting on the raw
      // English key (as this did before) can never match, so the assertion holds
      // whatever the component does — it was passing vacuously.
      expect(screen.queryByText('文昌（月柱·巳）')).not.toBeInTheDocument();
      expect(screen.queryByText('華蓋（日柱·辰）')).not.toBeInTheDocument();
    });

    it('does not render the 空亡 line of the standalone section', () => {
      render(<BaziChart data={SAMPLE_CHART_DATA} />);
      // Probe the section's own 「空亡：」 label (note the full-width colon), NOT a
      // bare /空亡/. The engine can return 空亡 as one of a pillar's 神煞 names, in
      // which case it renders in the 神煞 ROW of the pillars table and is expected
      // to survive — that row was not part of what was hidden. A bare match would
      // pass or fail on fixture data rather than on this behaviour.
      expect(screen.queryByText(/空亡：/)).not.toBeInTheDocument();
    });

    it('does not render the empty-state copy', () => {
      const dataNoShenSha = { ...SAMPLE_CHART_DATA, allShenSha: [] };
      render(<BaziChart data={dataNoShenSha} />);
      expect(screen.queryByText('此命盤無特殊神煞')).not.toBeInTheDocument();
    });
  });
});
