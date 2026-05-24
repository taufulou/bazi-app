/**
 * Shared zh-TW locale registration for react-datepicker.
 *
 * Single source of truth — import this module FOR SIDE EFFECTS from every
 * component that renders a `<DatePicker locale="zh-TW" />`. Calling
 * `registerLocale` multiple times for the same locale name is benign but
 * smells bad; this file ensures it runs exactly once at app boot.
 *
 * WARNING for future maintainers: if `apps/web/package.json` ever adds
 * `"sideEffects": false`, Next.js + Webpack/Turbopack may tree-shake this
 * side-effect-only import. If that happens, mark this file explicitly via a
 * `"sideEffects": ["./app/lib/date-locale.ts"]` whitelist entry in
 * package.json, or change the import to attach a dummy named export
 * referenced from a render path. As of 2026-05-18 the package.json has no
 * sideEffects field, so the bare side-effect import is safe.
 */
import { registerLocale } from 'react-datepicker';
import { zhTW } from 'date-fns/locale/zh-TW';

registerLocale('zh-TW', zhTW);
