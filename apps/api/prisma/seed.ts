import 'dotenv/config';
import { PrismaClient, ReadingType, AIProvider, DiscountType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Seed Services (Reading Types)
  const services = [
    { slug: 'lifetime', nameZhTw: '八字終身運', nameZhCn: '八字终身运', descriptionZhTw: '全面分析您的八字命盤，深入了解一生的命運走向', descriptionZhCn: '全面分析您的八字命盘，深入了解一生的命运走向', type: ReadingType.LIFETIME, creditCost: 2, sortOrder: 1 },
    { slug: 'annual', nameZhTw: '八字流年運勢', nameZhCn: '八字流年运势', descriptionZhTw: '預測您今年的運勢變化，掌握每月吉凶', descriptionZhCn: '预测您今年的运势变化，掌握每月吉凶', type: ReadingType.ANNUAL, creditCost: 2, sortOrder: 2 },
    { slug: 'career', nameZhTw: '事業財運', nameZhCn: '事业财运', descriptionZhTw: '分析事業發展方向與財運走勢，找到最佳機遇', descriptionZhCn: '分析事业发展方向与财运走势，找到最佳机遇', type: ReadingType.CAREER, creditCost: 2, sortOrder: 3 },
    { slug: 'love', nameZhTw: '愛情姻緣', nameZhCn: '爱情姻缘', descriptionZhTw: '探索感情運勢，了解理想伴侶特質與姻緣時機', descriptionZhCn: '探索感情运势，了解理想伴侣特质与姻缘时机', type: ReadingType.LOVE, creditCost: 2, sortOrder: 4 },
    { slug: 'health', nameZhTw: '先天健康分析', nameZhCn: '先天健康分析', descriptionZhTw: '根據五行分析先天體質，提供養生保健建議', descriptionZhCn: '根据五行分析先天体质，提供养生保健建议', type: ReadingType.HEALTH, creditCost: 2, sortOrder: 5 },
    { slug: 'compatibility', nameZhTw: '合盤比較', nameZhCn: '合盘比较', descriptionZhTw: '比較兩人八字，分析感情或事業合作的契合度', descriptionZhCn: '比较两人八字，分析感情或事业合作的契合度', type: ReadingType.COMPATIBILITY, creditCost: 3, sortOrder: 6 },
    // ZWDS (紫微斗數) services
    { slug: 'zwds-lifetime', nameZhTw: '紫微終身運', nameZhCn: '紫微终身运', descriptionZhTw: '紫微斗數全面解讀，深入分析十二宮位與一生命運格局', descriptionZhCn: '紫微斗数全面解读，深入分析十二宫位与一生命运格局', type: ReadingType.ZWDS_LIFETIME, creditCost: 2, sortOrder: 7 },
    { slug: 'zwds-annual', nameZhTw: '紫微流年運', nameZhCn: '紫微流年运', descriptionZhTw: '紫微斗數流年分析，預測今年宮位四化變動與運勢起伏', descriptionZhCn: '紫微斗数流年分析，预测今年宫位四化变动与运势起伏', type: ReadingType.ZWDS_ANNUAL, creditCost: 2, sortOrder: 8 },
    { slug: 'zwds-career', nameZhTw: '紫微事業運', nameZhCn: '紫微事业运', descriptionZhTw: '分析事業宮、財帛宮三方四正，找到最佳職業方向', descriptionZhCn: '分析事业宫、财帛宫三方四正，找到最佳职业方向', type: ReadingType.ZWDS_CAREER, creditCost: 2, sortOrder: 9 },
    { slug: 'zwds-love', nameZhTw: '紫微愛情運', nameZhCn: '紫微爱情运', descriptionZhTw: '解讀夫妻宮星曜組合，了解理想伴侶與姻緣時機', descriptionZhCn: '解读夫妻宫星曜组合，了解理想伴侣与姻缘时机', type: ReadingType.ZWDS_LOVE, creditCost: 2, sortOrder: 10 },
    { slug: 'zwds-health', nameZhTw: '紫微健康運', nameZhCn: '紫微健康运', descriptionZhTw: '根據疾厄宮與五行局分析先天體質，提供養生保健方向', descriptionZhCn: '根据疾厄宫与五行局分析先天体质，提供养生保健方向', type: ReadingType.ZWDS_HEALTH, creditCost: 2, sortOrder: 11 },
    { slug: 'zwds-compatibility', nameZhTw: '紫微合盤', nameZhCn: '紫微合盘', descriptionZhTw: '比較兩人紫微命盤，分析宮位星曜互動與契合度', descriptionZhCn: '比较两人紫微命盘，分析宫位星曜互动与契合度', type: ReadingType.ZWDS_COMPATIBILITY, creditCost: 3, sortOrder: 12 },
  ];

  for (const service of services) {
    await prisma.service.upsert({ where: { slug: service.slug }, update: service, create: service });
  }
  console.log(`  ✅ ${services.length} services seeded`);

  // Seed Plans (Subscription Tiers)
  const plans = [
    { slug: 'basic', nameZhTw: '基礎版', nameZhCn: '基础版', priceMonthly: 4.99, priceAnnual: 39.99, currency: 'USD', features: ['5 detailed readings/month', 'Full 八字終身運', 'Basic 流年運勢'], readingsPerMonth: 5, sortOrder: 1 },
    { slug: 'pro', nameZhTw: '專業版', nameZhCn: '专业版', priceMonthly: 9.99, priceAnnual: 79.99, currency: 'USD', features: ['15 readings/month', 'All reading types', 'PDF export', 'Priority AI'], readingsPerMonth: 15, sortOrder: 2 },
    { slug: 'master', nameZhTw: '大師版', nameZhCn: '大师版', priceMonthly: 19.99, priceAnnual: 159.99, currency: 'USD', features: ['Unlimited readings', 'Partner compatibility', 'Advanced analysis', 'Early access features'], readingsPerMonth: -1, sortOrder: 3 },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({ where: { slug: plan.slug }, update: plan, create: plan });
  }
  console.log(`  ✅ ${plans.length} plans seeded`);

  // Seed Payment Gateways
  const gateways = [
    { provider: 'stripe', region: 'global', isActive: true },
    { provider: 'stripe', region: 'taiwan', isActive: true },
    { provider: 'stripe', region: 'hong_kong', isActive: true },
    { provider: 'stripe', region: 'malaysia', isActive: true },
    { provider: 'line_pay', region: 'taiwan', isActive: true },
    { provider: 'paypal', region: 'global', isActive: true },
    { provider: 'alipay', region: 'hong_kong', isActive: true },
  ];

  for (const gw of gateways) {
    await prisma.paymentGateway.upsert({
      where: { provider_region: { provider: gw.provider, region: gw.region } },
      update: gw,
      create: gw,
    });
  }
  console.log(`  ✅ ${gateways.length} payment gateways seeded`);

  // Seed Prompt Templates
  const readingTypes = [ReadingType.LIFETIME, ReadingType.ANNUAL, ReadingType.CAREER, ReadingType.LOVE, ReadingType.HEALTH, ReadingType.COMPATIBILITY, ReadingType.ZWDS_LIFETIME, ReadingType.ZWDS_ANNUAL, ReadingType.ZWDS_CAREER, ReadingType.ZWDS_LOVE, ReadingType.ZWDS_HEALTH, ReadingType.ZWDS_COMPATIBILITY];
  const providers = [AIProvider.CLAUDE, AIProvider.GPT, AIProvider.GEMINI];

  const baziBasePrompt = `你是一位經驗豐富的八字命理大師（命理師），擁有超過30年的八字分析經驗。
你精通四柱八字、十神、五行、大運流年等所有命理分析方法。
你的分析風格是專業但易懂，能將深奧的命理概念轉化為實用的人生建議。
所有回覆必須使用繁體中文（Traditional Chinese）。

重要規則：
1. 所有分析必須基於提供的八字計算數據，不可捏造或推測數據
2. 分析必須客觀，既要指出優勢也要提出需注意的方面
3. 建議必須具體且可執行
4. 語氣溫和、正面，即使面對不利因素也要提供建設性建議
5. 不可做出關於死亡、重大疾病等極端預測
6. 每個分析段落都必須引用具體的八字元素（如天干、地支、十神等）作為依據`;

  const zwdsBasePrompt = `你是一位經驗豐富的紫微斗數命理大師，擁有超過30年的紫微斗數實戰分析經驗。
你精通全書派（陳希夷系統）紫微斗數，熟悉14主星、60+輔星、四化飛星、三方四正、大限流年等所有分析方法。
你的分析風格是專業但易懂，能將深奧的星曜概念轉化為實用的人生建議。
所有回覆必須使用繁體中文（Traditional Chinese）。

重要規則：
1. 所有分析必須基於提供的紫微斗數命盤數據，不可捏造或推測數據
2. 星曜的亮度（廟/旺/得/利/平/不/陷）直接影響吉凶程度，必須納入分析
3. 四化（化祿/化權/化科/化忌）是動態分析的核心，必須重點解讀
4. 建議必須具體且可執行
5. 語氣溫和、正面，即使面對不利因素也要提供建設性建議
6. 不可做出關於死亡、重大疾病等極端預測
7. 每個分析段落都必須引用具體的星曜、宮位作為依據`;

  const typePrompts: Record<string, string> = {
    LIFETIME: '\n\n專注於：性格分析、一生命運走向、主要優勢與挑戰、人生重要轉折點。',
    ANNUAL: '\n\n專注於：今年整體運勢、每月運勢概要、需注意的月份、把握機遇的建議。',
    CAREER: '\n\n專注於：事業發展方向、適合與不適合的行業、財運走勢、職場貴人與小人。',
    LOVE: '\n\n專注於：感情性格分析、理想伴侶特質、姻緣時機、感情中需注意的問題。',
    HEALTH: '\n\n專注於：先天體質分析、五行對應器官的強弱、養生建議、需特別注意的健康方面。',
    COMPATIBILITY: '\n\n專注於：兩人八字的相合相剋分析、整體契合度評分、關係中的優勢與挑戰、和諧相處建議。',
    ZWDS_LIFETIME: '\n\n專注於：命宮主星格局分析、十二宮位總覽、大限走勢、特殊格局判斷。',
    ZWDS_ANNUAL: '\n\n專注於：流年四化飛入宮位、流年命宮變化、逐月運勢重點、年度最佳與最需注意月份。',
    ZWDS_CAREER: '\n\n專注於：事業宮（官祿宮）主星分析、財帛宮財富格局、遷移宮外出運、三方四正整體判斷。',
    ZWDS_LOVE: '\n\n專注於：夫妻宮星曜組合、桃花星分佈、理想伴侶特質、婚姻時機判斷。',
    ZWDS_HEALTH: '\n\n專注於：疾厄宮先天體質、五行局對應體質特點、各大限健康關注重點、養生建議。',
    ZWDS_COMPATIBILITY: '\n\n專注於：雙方命宮主星互動、夫妻宮星曜對照、四化交叉影響、契合度評估與建議。',
  };

  const userTemplateBase = `以下是用戶的八字命盤計算數據：

{{calculation_data}}

用戶資料：
- 姓名：{{name}}
- 性別：{{gender}}
- 出生日期：{{birth_date}}
- 出生時間（真太陽時）：{{true_solar_time}}

請根據以上數據進行`;

  const typeRequests: Record<string, string> = {
    LIFETIME: '「八字終身運」分析，包含：性格特點、一生運勢走向、事業財運、感情姻緣、健康分析。',
    ANNUAL: '「八字流年運勢」分析（目標年份：{{target_year}}），包含：年度整體運勢、每月運勢概要、重要月份提醒。',
    CAREER: '「事業財運」分析，包含：事業方向建議、適合的行業、財運走勢、職場人際關係。',
    LOVE: '「愛情姻緣」分析，包含：感情性格、理想伴侶特質、姻緣時機、感情經營建議。',
    HEALTH: '「先天健康」分析，包含：先天體質分析、五行與健康的關係、養生保健建議。',
    COMPATIBILITY: '「合盤比較」分析。\n\n第二位用戶的八字命盤數據：\n{{calculation_data_b}}\n\n比較類型：{{comparison_type}}\n\n請分析兩人的契合度，包含：整體匹配度評分、優勢互補、潛在衝突、和諧相處建議。',
    ZWDS_LIFETIME: '「紫微終身運」分析，包含：命宮格局分析、十二宮位總覽、大限走勢、整體命運格局。',
    ZWDS_ANNUAL: '「紫微流年運」分析（目標年份：{{target_year}}），包含：流年四化分析、逐月運勢、年度機遇與挑戰。',
    ZWDS_CAREER: '「紫微事業運」分析，包含：事業宮分析、財帛宮格局、適合的職業方向、事業轉折時機。',
    ZWDS_LOVE: '「紫微愛情運」分析，包含：夫妻宮分析、理想伴侶特質、桃花星分佈、感情時機建議。',
    ZWDS_HEALTH: '「紫微健康運」分析，包含：疾厄宮分析、五行局體質特點、大限健康變化、養生保健建議。',
    ZWDS_COMPATIBILITY: '「紫微合盤」分析。\n\n第二位用戶的紫微命盤數據：\n{{calculation_data_b}}\n\n比較類型：{{comparison_type}}\n\n請分析兩人命盤的契合度，包含：整體配對評估、優勢互補、潛在衝突、和諧相處建議。',
  };

  const outputFormat = `回覆必須使用以下JSON格式：
{
  "personality": { "preview": "第一段概要（約100-150字）", "full": "完整分析文字" },
  "career": { "preview": "第一段概要", "full": "完整分析文字" },
  "love": { "preview": "第一段概要", "full": "完整分析文字" },
  "finance": { "preview": "第一段概要", "full": "完整分析文字" },
  "health": { "preview": "第一段概要", "full": "完整分析文字" },
  "summary": { "preview": "整體概要", "full": "完整總結" }
}`;

  const zwdsUserTemplateBase = `以下是用戶的紫微斗數命盤數據：

{{calculation_data}}

用戶資料：
- 姓名：{{name}}
- 性別：{{gender}}
- 出生日期：{{birth_date}}
- 出生時辰：{{birth_time}}
- 五行局：{{five_elements_class}}

請根據以上數據進行`;

  let templateCount = 0;
  for (const readingType of readingTypes) {
    const isZwds = readingType.startsWith('ZWDS_');
    const basePrompt = isZwds ? zwdsBasePrompt : baziBasePrompt;
    const userBase = isZwds ? zwdsUserTemplateBase : userTemplateBase;
    for (const aiProvider of providers) {
      await prisma.promptTemplate.upsert({
        where: { readingType_aiProvider_version: { readingType, aiProvider, version: 1 } },
        update: {
          systemPrompt: basePrompt + (typePrompts[readingType] || ''),
          userPromptTemplate: userBase + (typeRequests[readingType] || '全面分析。'),
        },
        create: {
          readingType,
          aiProvider,
          version: 1,
          systemPrompt: basePrompt + (typePrompts[readingType] || ''),
          userPromptTemplate: userBase + (typeRequests[readingType] || '全面分析。'),
          outputFormatInstructions: outputFormat,
          isActive: true,
        },
      });
      templateCount++;
    }
  }
  console.log(`  ✅ ${templateCount} prompt templates seeded`);

  // Seed Default Promo Code
  await prisma.promoCode.upsert({
    where: { code: 'LAUNCH2026' },
    update: {},
    create: {
      code: 'LAUNCH2026',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 20,
      maxUses: 1000,
      currentUses: 0,
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2026-12-31'),
      isActive: true,
    },
  });
  console.log('  ✅ 1 promo code seeded (LAUNCH2026)');

  console.log('\n🎉 Database seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
