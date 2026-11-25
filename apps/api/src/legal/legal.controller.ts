import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { webOriginsFromEnv } from '../payments/safe-redirect-url';
import {
  AI_DATA_DISCLOSURE_ZH,
  APP_NAME,
  CONTACT_EMAIL,
  EFFECTIVE_DATE,
  JURISDICTION,
  LEGAL_ENTITY,
} from './legal-constants';

/**
 * Public legal pages: GET /privacy  GET /terms  GET /support
 *
 * ONE source for the text, served from TWO hosts:
 * - this API host — the Google Play listing points at `/privacy` here;
 * - `tianmingapp.com` — the website's route handlers (`apps/web/app/privacy`
 *   etc.) fetch these pages and return them as-is. Those are the URLs for App
 *   Store Connect (1B design, item 1).
 *
 * Because the same HTML is served on both hosts, links to WEBSITE-ONLY routes
 * (sign-in, the subscription page) are absolute, built from the canonical web
 * origin — the first `WEB_ORIGINS` entry. Relative links would 404 on this
 * host. `/privacy`, `/terms` and `/support` stay relative: both hosts serve
 * them. Each page names its canonical copy on the website.
 *
 * `@Public()` is PER METHOD (only `@SkipThrottle` is class-level). A handler
 * without it is 401'd by the global Clerk guard — and the website would then
 * serve its "temporarily unavailable" fallback forever. `legal.controller.spec`
 * asserts the metadata on all three.
 */

function canonicalWebOrigin(): string {
  return webOriginsFromEnv().canonical;
}

function page(title: string, path: string, bodyHtml: string): string {
  const canonical = `${canonicalWebOrigin()}${path}`;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${APP_NAME}</title>
<link rel="canonical" href="${canonical}">
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
  nav.legal { margin-top: 32px; font-size: 0.9rem; }
  footer { margin-top: 48px; color: #8B7355; font-size: 0.85rem; }
</style>
</head>
<body>
${bodyHtml}
<nav class="legal"><a href="/privacy">隱私權政策</a> · <a href="/terms">服務條款</a> · <a href="/support">客服支援</a></nav>
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
      '/privacy',
      `<h1>隱私權政策 Privacy Policy</h1>
<p class="meta">最後更新：${EFFECTIVE_DATE}</p>
<p>${APP_NAME}（下稱「本服務」，包含 iOS／Android App 與網站 tianmingapp.com）是一款以人工智慧提供八字命理解讀與運勢分析的服務。我們重視您的隱私。本政策說明我們收集哪些資料、如何使用，以及您的權利。</p>

<div class="disclaimer">本服務僅供參考與娛樂用途，不構成任何醫療、法律、財務、心理或其他專業建議。</div>

<h2>一、我們收集的資料</h2>
<ul>
  <li><strong>帳戶資料</strong>：透過身分驗證服務（Clerk）建立帳戶時的電子郵件與姓名。您可使用電子郵件、Google 或「使用 Apple 登入」；選擇以 Apple 登入並隱藏電子郵件時，我們只會收到 Apple 提供的轉寄地址。</li>
  <li><strong>命盤資料</strong>：您自行輸入的稱呼、性別、出生日期、出生時間與出生地點。此為命理計算所必需，屬敏感個人資料，僅用於產生您所要求的解讀。</li>
  <li><strong>使用與裝置資料</strong>：網站的操作記錄（PostHog），以及網站與 App 的當機與錯誤診斷資訊（Sentry），用於改善服務。</li>
  <li><strong>購買資料</strong>：訂閱與點數購買的交易識別碼。在 App 內，付款由 Apple App Store／Google Play 處理；在網站上，付款由 Stripe 處理，Stripe 會取得您的姓名與電子郵件以開立帳單。<strong>我們不會接觸或儲存您的信用卡或付款帳戶資料</strong>。</li>
</ul>

<h2>二、我們如何使用資料</h2>
<ul>
  <li>產生您要求的命理解讀與運勢分析。${AI_DATA_DISCLOSURE_ZH}</li>
  <li>在 iOS 與 Android App 中，首次使用 AI 功能前會先徵求您的同意；您可以拒絕，基本命盤排盤功能不受影響。在網站上使用 AI 功能，即表示上述資料將傳送至 Anthropic。</li>
  <li>您可隨時撤回同意：於 App 內設定，或來信 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>。撤回後，我們將停止後續的 AI 處理。</li>
  <li>建立與管理您的帳戶、點數與訂閱權益。</li>
  <li>維運、改善服務品質與診斷技術問題。</li>
</ul>

<h2>三、資料分享與第三方服務</h2>
<p>我們不會出售您的個人資料。為提供服務，我們使用下列受託處理者：</p>
<ul>
  <li>Clerk — 身分驗證</li>
  <li>Anthropic — AI 解讀內容生成</li>
  <li>Stripe — 網站付款處理</li>
  <li>RevenueCat、Apple App Store、Google Play — App 內訂閱與購買處理</li>
  <li>PostHog（網站）、Sentry — 使用分析與錯誤追蹤</li>
  <li>Railway — 伺服器主機代管</li>
</ul>
<p>上述服務提供者可能於您所在國家或地區以外（包括美國）處理您的資料。</p>

<h2>四、資料保存與刪除</h2>
<p>您可隨時於 App 內「我的 → 刪除帳號」永久刪除您的帳戶與個人資料，或來信 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> 要求刪除。若您持有由 App Store／Google Play 管理的有效訂閱，請先於對應商店取消訂閱。部分交易記錄可能因法律或會計義務保留。</p>

<h2>五、資料安全</h2>
<p>資料以加密方式傳輸。惟任何傳輸或儲存方式皆無法保證絕對安全。</p>

<h2>六、兒童</h2>
<p>本服務不面向未滿 13 歲之兒童，亦不會在知情下收集其資料。</p>

<h2>七、您的權利</h2>
<p>您有權查詢、更正或刪除您的個人資料，並可撤回對 AI 處理的同意。如需協助，請來信 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>。</p>

<h2>八、政策變更</h2>
<p>我們可能不時更新本政策，並於本頁公告最新版本與生效日期。</p>`,
    );
  }

  @Public()
  @Get('terms')
  @Header('Content-Type', 'text/html; charset=utf-8')
  terms(): string {
    return page(
      '服務條款',
      '/terms',
      `<h1>服務條款 Terms of Service</h1>
<p class="meta">最後更新：${EFFECTIVE_DATE}</p>
<p>歡迎使用 ${APP_NAME}（包含 iOS／Android App 與網站）。當您使用本服務即表示同意本條款。若不同意，請勿使用。</p>

<div class="disclaimer">本服務所提供之命理解讀、運勢分析與相關內容<strong>僅供參考與娛樂用途，不構成任何醫療、法律、財務、心理或其他專業建議</strong>。任何依據本服務內容所作之決定，概由您自行負責。</div>

<h2>一、服務說明</h2>
<p>本服務運用人工智慧，依據您提供的出生資料產生八字等命理解讀與運勢內容。結果具娛樂性質，不保證準確、完整或適用於特定用途。</p>

<h2>二、帳戶</h2>
<p>您須提供正確資料並妥善保管帳戶。您須對帳戶下之活動負責。</p>

<h2>三、點數、訂閱與付款</h2>
<ul>
  <li>在 App 內的購買與訂閱透過 Apple App Store 或 Google Play 完成，並適用其條款；在網站上的購買與訂閱透過 Stripe 完成。</li>
  <li>訂閱將於每期結束時<strong>自動續訂</strong>，除非您於當期結束至少 24 小時前取消：App 內訂閱請於 App Store／Google Play 帳戶設定中取消；網站訂閱請於網站的「會員方案」頁面取消。</li>
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
<p>如有疑問，請來信 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>。</p>`,
    );
  }

  @Public()
  @Get('support')
  @Header('Content-Type', 'text/html; charset=utf-8')
  support(): string {
    const web = canonicalWebOrigin();
    return page(
      '客服支援',
      '/support',
      `<h1>客服支援 Support</h1>
<p class="meta">最後更新：${EFFECTIVE_DATE}</p>
<p>有任何問題，請來信 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>，我們會以電子郵件回覆。</p>

<h2>如何取消訂閱？</h2>
<ul>
  <li><strong>iPhone／iPad</strong>：開啟「設定」→ 點選您的名字 →「訂閱項目」→ 選擇 ${APP_NAME} → 取消訂閱。</li>
  <li><strong>Android</strong>：開啟 Google Play 商店 → 個人資料 →「付款和訂閱」→「訂閱」→ 選擇 ${APP_NAME} → 取消訂閱。</li>
  <li><strong>網站訂閱</strong>：登入後前往 <a href="${web}/dashboard/subscription">會員方案</a> 頁面取消。</li>
</ul>
<p>取消後，您仍可使用至當期結束。</p>

<h2>換了手機或重新安裝，如何恢復購買？</h2>
<p>在 App 內開啟「商店」，點選「恢復購買」，並使用原本購買時的 Apple／Google 帳號。</p>

<h2>忘記密碼怎麼辦？</h2>
<p>前往 <a href="${web}/sign-in">登入頁面</a>，輸入電子郵件後點選「忘記密碼？」，依照郵件指示重設。</p>

<h2>如何刪除帳號？</h2>
<p>在 App 內前往「我的 → 刪除帳號」，或來信 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> 要求刪除。若有由 App Store／Google Play 管理的有效訂閱，請先在商店取消。</p>

<h2>如何撤回 AI 處理的同意？</h2>
<p>於 App 內設定撤回，或來信告知。撤回後，我們將停止後續的 AI 處理；不使用 AI 的命盤排盤功能仍可使用。</p>

<div class="disclaimer">本服務僅供參考與娛樂用途，不構成任何專業建議。</div>`,
    );
  }
}
