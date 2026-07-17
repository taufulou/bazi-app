import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';

/**
 * Public legal pages served straight off the API domain so the mobile app +
 * Google Play / App Store / RevenueCat have a stable privacy-policy + terms URL
 * without needing the web app deployed:
 *   GET /privacy   GET /terms
 *
 * Owner-provided details (set 2026-07-17). Update here if they change.
 */
const CONTACT_EMAIL = 'TAPPER.FUN@gmail.com';
const LEGAL_ENTITY = 'Roger Lim Shau Xiong';
const JURISDICTION = '馬來西亞';
const EFFECTIVE_DATE = '2026年7月17日';
const APP_NAME = '天命 BaziApp';

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${APP_NAME}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif;
    line-height: 1.75; max-width: 760px; margin: 0 auto; padding: 32px 20px 80px;
    color: #3C2415; background: #FFF3E0; }
  @media (prefers-color-scheme: dark) { body { color: #f0e6d8; background: #1a1512; } }
  h1 { font-size: 1.6rem; border-bottom: 2px solid #E23D28; padding-bottom: 8px; }
  h2 { font-size: 1.15rem; margin-top: 2em; color: #C41E3A; }
  @media (prefers-color-scheme: dark) { h2 { color: #ff8a7a; } }
  a { color: #C41E3A; } ul { padding-left: 1.3em; }
  .meta { color: #8B7355; font-size: 0.9rem; }
  .disclaimer { background: rgba(226,61,40,0.08); border-left: 3px solid #E23D28;
    padding: 12px 16px; border-radius: 8px; margin: 24px 0; }
  footer { margin-top: 48px; color: #8B7355; font-size: 0.85rem; }
</style>
</head>
<body>
${bodyHtml}
<footer>${APP_NAME} · 營運者：${LEGAL_ENTITY} · 聯絡：<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a><br>生效日期：${EFFECTIVE_DATE}</footer>
</body>
</html>`;
}

@SkipThrottle()
@Controller()
export class LegalController {
  @Public()
  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacy(): string {
    return page(
      '隱私權政策',
      `<h1>隱私權政策 Privacy Policy</h1>
<p class="meta">最後更新：${EFFECTIVE_DATE}</p>
<p>${APP_NAME}（下稱「本服務」）是一款以人工智慧提供八字命理解讀與運勢分析的應用程式。我們重視您的隱私。本政策說明我們收集哪些資料、如何使用，以及您的權利。</p>

<div class="disclaimer">本服務僅供參考與娛樂用途，不構成任何醫療、法律、財務、心理或其他專業建議。</div>

<h2>一、我們收集的資料</h2>
<ul>
  <li><strong>帳戶資料</strong>：透過身分驗證服務（Clerk）建立帳戶時的電子郵件、姓名或第三方登入識別碼。</li>
  <li><strong>命盤資料</strong>：您自行輸入的姓名、性別、出生日期、出生時間與出生地點。此為命理計算所必需，屬敏感個人資料，僅用於產生您所要求的解讀。</li>
  <li><strong>使用與裝置資料</strong>：操作記錄、裝置型號、當機與錯誤診斷資訊，用於改善服務（透過 PostHog、Sentry）。</li>
  <li><strong>購買資料</strong>：訂閱與點數購買的交易識別碼。付款由 Apple App Store／Google Play 處理，<strong>我們不會接觸或儲存您的信用卡或付款帳戶資料</strong>。</li>
</ul>

<h2>二、我們如何使用資料</h2>
<ul>
  <li>產生您要求的命理解讀與運勢分析（部分內容由第三方 AI 服務 Anthropic 生成，過程中會傳送必要的命盤衍生資料）。</li>
  <li>建立與管理您的帳戶、點數與訂閱權益。</li>
  <li>維運、改善服務品質與診斷技術問題。</li>
</ul>

<h2>三、資料分享與第三方服務</h2>
<p>我們不會出售您的個人資料。為提供服務，我們使用下列受託處理者：</p>
<ul>
  <li>Clerk — 身分驗證</li>
  <li>Anthropic — AI 解讀內容生成</li>
  <li>RevenueCat、Apple App Store、Google Play — 訂閱與購買處理</li>
  <li>PostHog、Sentry — 使用分析與錯誤追蹤</li>
  <li>Railway — 伺服器主機代管</li>
</ul>

<h2>四、資料保存與刪除</h2>
<p>您可隨時於 App 內「我的 → 刪除帳號」永久刪除您的帳戶與個人資料。若您持有由 App Store／Google Play 管理的有效訂閱，請先於對應商店取消訂閱。部分交易記錄可能因法律或會計義務保留。</p>

<h2>五、資料安全</h2>
<p>資料以加密方式傳輸。惟任何傳輸或儲存方式皆無法保證絕對安全。</p>

<h2>六、兒童</h2>
<p>本服務不面向未滿 13 歲之兒童，亦不會在知情下收集其資料。</p>

<h2>七、您的權利</h2>
<p>您有權查詢、更正或刪除您的個人資料。如需協助，請來信 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>。</p>

<h2>八、政策變更</h2>
<p>我們可能不時更新本政策，並於本頁公告最新版本與生效日期。`,
    );
  }

  @Public()
  @Get('terms')
  @Header('Content-Type', 'text/html; charset=utf-8')
  terms(): string {
    return page(
      '服務條款',
      `<h1>服務條款 Terms of Service</h1>
<p class="meta">最後更新：${EFFECTIVE_DATE}</p>
<p>歡迎使用 ${APP_NAME}。當您使用本服務即表示同意本條款。若不同意，請勿使用。</p>

<div class="disclaimer">本服務所提供之命理解讀、運勢分析與相關內容<strong>僅供參考與娛樂用途，不構成任何醫療、法律、財務、心理或其他專業建議</strong>。任何依據本服務內容所作之決定，概由您自行負責。</div>

<h2>一、服務說明</h2>
<p>本服務運用人工智慧，依據您提供的出生資料產生八字等命理解讀與運勢內容。結果具娛樂性質，不保證準確、完整或適用於特定用途。</p>

<h2>二、帳戶</h2>
<p>您須提供正確資料並妥善保管帳戶。您須對帳戶下之活動負責。</p>

<h2>三、點數、訂閱與付款</h2>
<ul>
  <li>購買與訂閱透過 Apple App Store 或 Google Play 完成，並適用其條款。</li>
  <li>訂閱將於每期結束時<strong>自動續訂</strong>，除非您於當期結束至少 24 小時前於商店帳戶設定中取消。您可於 App Store／Google Play 管理或取消訂閱。</li>
  <li>點數為虛擬項目，用於解鎖解讀內容；除法律另有強制規定或商店政策要求外，<strong>已購買之點數與訂閱不予退款、不可轉讓、不可兌換現金</strong>。</li>
</ul>

<h2>四、可接受使用</h2>
<p>您同意不濫用、干擾、逆向工程本服務，或將其用於非法用途，亦不侵害他人之隱私（例如未經同意輸入他人之敏感個人資料）。</p>

<h2>五、免責聲明與責任限制</h2>
<p>本服務依「現況」提供，不提供任何明示或默示之擔保。在法律允許之最大範圍內，${LEGAL_ENTITY} 對於因使用或無法使用本服務所生之任何間接、附帶或衍生性損害不負責任。</p>

<h2>六、智慧財產權</h2>
<p>本服務之軟體、設計、角色卡與內容之權利屬 ${LEGAL_ENTITY} 或其授權人所有。</p>

<h2>七、條款變更</h2>
<p>我們可能修訂本條款，並於本頁公告。持續使用即視為接受修訂後之條款。</p>

<h2>八、準據法</h2>
<p>本條款受 ${JURISDICTION} 法律管轄。</p>

<h2>九、聯絡我們</h2>
<p>如有疑問，請來信 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>。`,
    );
  }
}
