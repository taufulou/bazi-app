'use client';

/**
 * ElementExplanation — Bottom sheet component for Bazi chart element explanations.
 *
 * Rendered via React Portal at document.body to avoid z-index/overflow clipping.
 * Shows Layer A (free) always + Layers B/C/D (paid) based on isSubscriber.
 * When API returns an error (no template yet), shows "coming soon" fallback.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './ElementExplanation.module.css';
import {
  fetchElementExplanation,
  extractGodRoles,
  type ElementExplanationData,
  type ElementType,
  type GodRoles,
  type FourPillarsPayload,
  type InteractionData,
  type PillarContextData,
} from '../lib/element-explanation-api';

// ── Types ──

export interface ElementClickInfo {
  elementType: ElementType;
  value: string;
  pillar: 'year' | 'month' | 'day' | 'hour';
  pillarLabel: string;
}

interface ElementExplanationProps {
  isOpen: boolean;
  onClose: () => void;
  elementType: ElementType;
  value: string;
  pillar: 'year' | 'month' | 'day' | 'hour';
  pillarLabel: string;
  godRoles: GodRoles;
  fourPillars?: FourPillarsPayload;
  isSubscriber: boolean;
  gender: string;
}

// ── Category display names ──
const CATEGORY_LABELS: Record<string, string> = {
  ten_god: '十神',
  stem: '天干',
  branch: '地支',
  hidden_stem: '藏干',
  life_stage: '十二運',
  nayin: '納音',
  shensha: '神煞',
  seasonal_state: '旺相休囚死',
  kong_wang: '空亡',
};

// God role display labels for kong_wang collapsed keys
const GOD_ROLE_DISPLAY: Record<string, string> = {
  '喜神': '喜神',
  '用神': '用神',
  '閒神': '閒神',
  '忌神': '忌神',
  '仇神': '仇神',
  'favorable': '有利',
  'unfavorable': '不利',
  'neutral': '中性',
};

// Interaction badge labels (neutral strength descriptors, not fortune)
const NATURE_BADGE: Record<string, string> = {
  'manifest': '強',
  'latent': '隱',
  'strong_root': '強',
  'moderate_root': '中',
  'weak_root': '弱',
  'floating': '虛浮',
};

export default function ElementExplanation({
  isOpen,
  onClose,
  elementType,
  value,
  pillar,
  pillarLabel,
  godRoles,
  fourPillars,
  isSubscriber,
  gender,
}: ElementExplanationProps) {
  const [data, setData] = useState<ElementExplanationData | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef(new Map<string, ElementExplanationData>());

  // Fetch explanation when opened
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoading(true);

    fetchElementExplanation(
      {
        elementType,
        value,
        pillar,
        godRoles,
        gender,
        fourPillars,
      },
      cacheRef.current,
    ).then((result) => {
      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setData(null);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [isOpen, elementType, value, pillar, gender, godRoles]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  // ── Expandable sheet state ──
  const [expanded, setExpanded] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Reset expanded when element changes
  useEffect(() => setExpanded(false), [elementType, value, pillar]);

  // ── Swipe on drag handle only (not content area) ──
  const touchStartY = useRef(0);
  const touchDeltaY = useRef(0);

  const handleDragTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  }, []);

  const handleDragTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === 0) return;
    e.preventDefault(); // Prevent page scroll while dragging handle
    const delta = e.touches[0].clientY - touchStartY.current;
    touchDeltaY.current = delta;
    // Visual feedback: translate sheet as user drags up OR down
    if (sheetRef.current) {
      const baseTranslate = expanded ? 0 : 35;
      // Clamp: don't let sheet go above 0 (fully expanded) or below 100vh
      const newTranslate = Math.max(0, baseTranslate + (delta / window.innerHeight * 100));
      sheetRef.current.style.transform = `translateY(${newTranslate}vh)`;
      sheetRef.current.style.transition = 'none';
    }
  }, [expanded]);

  const handleDragTouchEnd = useCallback(() => {
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
      sheetRef.current.style.transition = '';
    }
    const delta = touchDeltaY.current;

    if (delta < -40) {
      // Swiped UP → expand
      setExpanded(true);
    } else if (delta > 60) {
      if (expanded) {
        // Swiped DOWN while expanded → collapse
        setExpanded(false);
      } else {
        // Swiped DOWN while collapsed → close
        onClose();
      }
    }

    touchStartY.current = 0;
    touchDeltaY.current = 0;
  }, [expanded, onClose]);

  // Portal target — only available client-side
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  if (!isOpen || !portalTarget) return null;

  const categoryLabel = CATEGORY_LABELS[elementType] || elementType;

  // ── Render content ──
  const renderContent = () => {
    if (loading) {
      return <div className={styles.loading}>載入中...</div>;
    }

    // Coming soon fallback (no template for this type yet)
    if (!data || data.error) {
      return (
        <div className={styles.comingSoon}>
          <div className={styles.comingSoonIcon}>📖</div>
          此項目的詳細解讀即將推出，敬請期待。
        </div>
      );
    }

    const { generic, personalized } = data;

    return (
      <div className={styles.content}>
        {/* Layer A — Free, always shown */}
        <p className={styles.meaningText}>{generic.meaning}</p>

        {generic.keywords && generic.keywords.length > 0 && (
          <div className={styles.keywordsRow}>
            {generic.keywords.map((kw) => (
              <span key={kw} className={styles.keyword}>{kw}</span>
            ))}
          </div>
        )}

        {generic.liuQin && (
          <div className={styles.liuQinRow}>
            <span className={styles.liuQinLabel}>六親：</span>
            男命→{generic.liuQin.male} ／ 女命→{generic.liuQin.female}
          </div>
        )}

        {/* Day Pillar Combo — Free tier teaser (only for day stem) */}
        {!isSubscriber && data.dayPillarCombo && (
          <div className={styles.comboTeaser}>
            <div className={styles.comboHeader}>
              <span className={styles.comboTitle}>
                你的日柱：{value}{fourPillars?.day?.branch || ''}日
              </span>
              <span
                className={styles.gradeBadge}
                data-grade={data.dayPillarCombo.grade}
              >
                {data.dayPillarCombo.grade}
              </span>
            </div>
            <p className={styles.comboTeaserText}>{data.dayPillarCombo.teaser}</p>
            <div className={styles.teaserCta}>
              <button className={styles.teaserBtn} onClick={() => window.location.href = '/pricing'}>🔓 解鎖日柱組合完整解讀</button>
            </div>
          </div>
        )}

        {elementType !== 'seasonal_state' && <hr className={styles.divider} />}

        {/* Pillar context — free tier teaser (skip for seasonal_state) */}
        {!isSubscriber && elementType !== 'seasonal_state' && data.pillarContext?.free && (
          <div className={styles.pillarContextFree}>
            <span className={styles.pillarContextIcon}>📍</span>
            <p className={styles.pillarContextText}>{data.pillarContext.free}</p>
          </div>
        )}

        {/* Paid section — skip for seasonal_state (free tier only) */}
        {elementType === 'seasonal_state' ? null : isSubscriber ? (
          // ── Subscriber: show all personalized layers ──
          <>
            <div className={styles.personalizedHeader}>
              個人化解讀
              {personalized.godRole && (
                <span
                  className={styles.godRoleBadge}
                  data-role={personalized.godRole}
                >
                  {GOD_ROLE_DISPLAY[personalized.godRole] || personalized.godRole}
                </span>
              )}
            </div>

            {/* Pillar context — paid tier full explanation */}
            {data.pillarContext?.paid && (
              <div className={styles.pillarContextPaid}>
                <div className={styles.sectionLabel}>柱位解析</div>
                <p className={styles.sectionText}>{data.pillarContext.paid}</p>
              </div>
            )}

            {personalized.pillarMeaning && (
              <div className={styles.personalizedSection}>
                <div className={styles.sectionLabel}>宮位解讀</div>
                <p className={styles.sectionText}>{personalized.pillarMeaning}</p>
              </div>
            )}

            {/* Day Pillar Combo — Paid tier full (only for day stem) */}
            {data.dayPillarCombo && (
              <div className={styles.personalizedSection}>
                <div className={styles.sectionLabel}>日柱組合</div>
                <div className={styles.comboCard}>
                  <div className={styles.comboHeader}>
                    <span className={styles.comboTitle}>
                      {value}{fourPillars?.day?.branch || ''}日
                    </span>
                    <span
                      className={styles.gradeBadge}
                      data-grade={data.dayPillarCombo.grade}
                    >
                      {data.dayPillarCombo.grade}
                    </span>
                    {data.dayPillarCombo.specialLabels.map((label) => (
                      <span
                        key={label}
                        className={styles.specialLabel}
                        data-label-type={
                          ['六秀日', '金神日'].includes(label) ? 'auspicious' :
                          label === '魁罡日' ? 'power' : 'cautionary'
                        }
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className={styles.comboMeta}>
                    坐{data.dayPillarCombo.lifeStageSeat}
                    {data.dayPillarCombo.gradeReason && ` · ${data.dayPillarCombo.gradeReason}`}
                  </div>
                  <p className={styles.sectionText}>{data.dayPillarCombo.summary}</p>
                </div>
              </div>
            )}

            {/* Cross-pillar interactions — between Layer B and Layer C */}
            {data.interactions && data.interactions.length > 0 && (
              <div className={styles.personalizedSection}>
                <div className={styles.sectionLabel}>命盤互動</div>
                {data.interactions.map((interaction, idx) => (
                  <div
                    key={idx}
                    className={styles.interactionCard}
                    data-nature={interaction.nature}
                  >
                    <div className={styles.interactionHeader}>
                      <span className={styles.interactionIcon}>{interaction.icon}</span>
                      <span className={styles.interactionName}>{interaction.name}</span>
                      <span
                        className={styles.interactionBadge}
                        data-nature={interaction.nature}
                      >
                        {NATURE_BADGE[interaction.nature] || '·'}
                      </span>
                    </div>
                    <div className={styles.interactionDesc}>
                      {interaction.description.split('\n\n').map((paragraph, pIdx) => (
                        <p key={pIdx} style={{ margin: pIdx > 0 ? '0.5rem 0 0' : '0' }}>{paragraph}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {personalized.godRoleMeaning && (
              <div className={styles.personalizedSection}>
                <div className={styles.sectionLabel}>{elementType === 'shensha' ? '對你的影響' : '喜忌分析'}</div>
                <p className={styles.sectionText}>{personalized.godRoleMeaning}</p>
              </div>
            )}

            {personalized.genderMeaning && (
              <div className={styles.personalizedSection}>
                <div className={styles.sectionLabel}>六親關係</div>
                <p className={styles.sectionText}>{personalized.genderMeaning}</p>
              </div>
            )}
          </>
        ) : (
          // ── Non-subscriber: show teaser + CTA ──
          <div className={styles.teaserSection}>
            {personalized.pillarMeaning && (
              <div className={styles.teaserBlur}>
                {personalized.pillarMeaning}
              </div>
            )}
            <div className={styles.teaserCta}>
              <button className={styles.teaserBtn} onClick={() => window.location.href = '/pricing'}>
                🔓 解鎖個人化解讀
              </button>
              <span className={styles.teaserCount}>
                訂閱即可查看所有命盤元素的個人化解讀
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Portal render ──
  const sheetClasses = [
    styles.sheet,
    styles.safeArea,
    expanded ? styles.sheetExpanded : '',
  ].filter(Boolean).join(' ');

  const contentClasses = [
    styles.sheetContent,
    expanded ? styles.sheetContentExpanded : '',
  ].filter(Boolean).join(' ');

  const sheetContent = (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        ref={sheetRef}
        className={sheetClasses}
      >
        {/* Drag handle — touch events ONLY here (not content area) */}
        <div
          className={styles.dragHandle}
          onClick={() => setExpanded(!expanded)}
          onTouchStart={handleDragTouchStart}
          onTouchMove={handleDragTouchMove}
          onTouchEnd={handleDragTouchEnd}
        />
        <div className={styles.header}>
          <div>
            <span className={styles.headerTitle}>{value}</span>
            <span className={styles.headerPillar}>· {pillarLabel}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </div>
        <span className={styles.categoryBadge}>{categoryLabel}</span>
        {/* Inner scrollable content area */}
        <div className={contentClasses}>
          {renderContent()}
        </div>
      </div>
    </>
  );

  return createPortal(sheetContent, portalTarget) as unknown as React.ReactElement;
}
