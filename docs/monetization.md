# Monetization & Competitive Strategy

> Extracted from CLAUDE.md to reduce context window usage. Read on demand when working on pricing, payments, or monetization features.

## Competitive Strategy
- **Key differentiator**: Combined Bazi + ZWDS in one platform (most competitors offer only one system)
- **ZWDS school**: Default to 全書派 (Chen Xi-Yi) system — most widely recognized (~60% of apps)
- **Retention flywheel**: Free chart (hook) → chart preview → watch ad or subscribe → monthly notifications → annual renewal → share compatibility → friend joins

## Competitor Pricing Research (Feb 2025)

### 科技紫微網 (Click108) — Taiwan #1, 10M+ members
- 白金會員 經典造命版: **NT$3,600/yr** (~US$110/yr, ~US$9.17/mo)
- 白金會員 親友無限版: **NT$8,800/yr** (~US$269/yr, ~US$22.42/mo)
- App 白金會員一年期 (iOS): **US$99.99/yr** (~US$8.33/mo)
- Live master consultation (30 min): **NT$800** (~US$24)
- New user promotion: 150元 活動幣 free
- Model: Annual subscription + per-reading purchases + virtual coins + web ads + LINE notifications

### 先知命局 (SeerOnNet) — HK-based, 10M+ users (our inspiration)
- Weekly subscription: **HK$88/wk** (~US$11.28/wk)
- Monthly subscription: **HK$148/mo** (~US$19/mo)
- Annual subscription: **HK$288/yr** (~US$37/yr, ~US$3.08/mo!)
- iOS Monthly membership: **US$19.99/mo**
- iOS Annual membership: **US$39.90/yr**
- Point packages: HK$58 (6pt) → HK$7,888 (800pt), bulk discount for larger packages
- Monthly member benefits: 30 AI calculations, 30 八字 reports, 3 unlocked forecast reports, 5 talismans, 30 prayers
- Model: Subscription (weekly/monthly/yearly) + point/credit system + live master marketplace + spiritual products

### 桃桃喜 (TaoTaoXi) — Taiwan, founded by 簡少年
- 2026 全年運勢詳批: **NT$498** (~US$15.24)
- 真愛太歲合盤 / 職場合盤 / 真命天子何時出現: **NT$349** each (~US$10.68)
- 面相AI運勢分析: **NT$349** (~US$10.68)
- Online courses: Feng Shui, ZWDS, numerology (various prices)
- Model: Per-reading one-time purchases + online courses, no refund policy

### 靈機八字 (Linghit Bazi) — HK-based, 100M+ total users across apps
- 福幣 (Fortune Coins) packages: NT$30 (600幣) → NT$3,990 (88,800幣)
- Premium wish tokens: **NT$150** each
- 合婚 Compatibility: **NT$390**
- Model: Virtual currency (福幣) system + per-feature purchases + spiritual products

### 紫薇斗數 App (Independent ZWDS App)
- Per-section unlock: 宮位運勢解析 **NT$120**, 運勢宮位解析 **NT$190**
- 必知必懂問題: **NT$320 – NT$490**
- 健康報告: **NT$320**, 流年/姻緣: **NT$990** each
- 宮位運勢全開卡 (full unlock): **NT$2,990**
- Model: Freemium + per-section unlock + full bundle unlock

## Our Monetization Model (5 Revenue Streams)

### Stream 1: Subscription Plans
| Plan | Monthly (USD) | Annual (USD) | TWD Monthly | TWD Annual |
|------|--------------|-------------|------------|-----------|
| Free | $0 | $0 | $0 | $0 |
| Basic | $4.99 | $39.99 (~$3.33/mo) | NT$160 | NT$1,290 |
| Pro | $9.99 | $79.99 (~$6.67/mo) | NT$330 | NT$2,590 |
| Master | $19.99 | $159.99 (~$13.33/mo) | NT$650 | NT$5,190 |

Positioning: Below Click108 (NT$3,600/yr) at our Pro level, competitive with SeerOnNet monthly

### Stream 2: Per-Reading Credit Purchase (à la carte, non-subscribers)
- Credits purchased via credit packages (see Stream 5)
- Credit costs per reading type defined in `Service.creditCost` (admin-configurable)
- e.g., Basic Bazi = 2 credits, Compatibility = 3 credits, Cross-system = 4 credits

### Stream 3: Per-Section Unlock (granular)
- Unlock just 財運, 愛情, or 健康 section from a reading
- 3 unlock methods: 1 credit, watch 1 rewarded ad, or pay NT$60 (~US$1.99) cash
- Validates: ZWDS apps charge NT$120-990 per section

### Stream 4: Rewarded Video Ads (blue ocean — no competitor does this well)
- Watch ad → unlock 1 section of AI reading
- Watch ad → earn 1 free credit
- Watch ad → view daily ZWDS horoscope
- Watch 3 ads → unlock 1 full basic reading
- Limit: 5 rewarded ad views per day (prevent abuse, maintain premium feel)
- Non-subscribers only (subscribers see no ads)
- Target: Google AdMob (best TW/HK/MY coverage)
- Taiwan eCPM: ~US$11-16 (iOS), ~US$11 (Android)

### Stream 5: Credit/Coin Packages (bulk purchase)
- Virtual currency with bulk discount to encourage larger purchases
- e.g., 5 credits = $4.99, 12 credits = $9.99, 30 credits = $19.99
- All prices admin-configurable from backend (no redeploy needed)

## Content Access Matrix
```
Ways to ACCESS content:
├── Subscriber (Basic/Pro/Master) → included readings based on tier, no ads
├── Credits (à la carte)
│   ├── Buy credit packages with cash (bulk discount)
│   ├── Earn 1 free credit by watching an ad
│   └── Spend credits on full readings (2-4 credits each)
├── Per-section unlock (granular)
│   ├── 1 credit for one section
│   ├── Watch 1 ad to unlock one section (free)
│   └── Pay NT$60 cash for one section
└── Free tier
    └── Chart display only (no AI interpretation)
```

## Ads Revenue Data (Target Markets)
| Market | Rewarded Video eCPM (iOS) | Rewarded Video eCPM (Android) |
|--------|---------------------------|-------------------------------|
| Taiwan | ~US$15.62 | ~US$11.00 |
| Hong Kong | ~US$8-12 (est.) | ~US$6-9 (est.) |
| Malaysia | ~US$4-6 (est.) | ~US$2-4 (est.) |
- Rewarded video completion rates: >95% (vs 60-70% for pre-roll)
- Subscription ARPU ~4.6× higher than ad-only ARPU
