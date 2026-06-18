/**
 * Unit tests for the 繁→簡 display-layer converter (app/lib/zh-convert).
 * Covers: OpenCC tw→cn correctness, isCJK, and convertSubtree's skip-list.
 */
import {
  ensureConverter,
  convertText,
  isCJK,
  convertSubtree,
} from '../app/lib/zh-convert';

describe('zh-convert', () => {
  beforeAll(async () => {
    await ensureConverter();
  });

  test('convertText: engine terms + UI strings', () => {
    // 財→财 differs; 用神 / 干支 are script-identical (must NOT mangle).
    expect(convertText('比劫奪財')).toBe('比劫夺财');
    expect(convertText('傷官見官')).toBe('伤官见官');
    expect(convertText('用神')).toBe('用神');
    expect(convertText('甲子')).toBe('甲子');
    expect(convertText('丙午')).toBe('丙午');
    expect(convertText('繁體中文')).toBe('繁体中文');
    expect(convertText('今日運勢')).toBe('今日运势');
    expect(convertText('裡')).toBe('里'); // Taiwan variant char
  });

  test('convertText: non-CJK / empty are no-ops', () => {
    expect(convertText('Hello 123')).toBe('Hello 123');
    expect(convertText('')).toBe('');
  });

  test('convertText: idempotent on already-Simplified input', () => {
    expect(convertText('比劫夺财')).toBe('比劫夺财');
  });

  test('isCJK', () => {
    expect(isCJK('用神')).toBe(true);
    expect(isCJK('abc')).toBe(false);
    expect(isCJK('123 !@#')).toBe(false);
  });

  test('convertSubtree converts prose but SKIPS inputs / data-no-zh / contenteditable / English', () => {
    document.body.innerHTML = `
      <h1>八字終身運</h1>
      <p>用神為火，比劫奪財</p>
      <input value="陳大文" />
      <textarea>我的名字</textarea>
      <span data-no-zh="">陳大文</span>
      <div contenteditable="true">使用者輸入<b>巢狀</b></div>
      <span class="eng">English only 123</span>`;

    convertSubtree(document.body);

    expect(document.querySelector('h1')!.textContent).toBe('八字终身运');
    expect(document.querySelector('p')!.textContent).toBe('用神为火，比劫夺财');
    // user-generated / inputs untouched:
    expect(document.querySelector('input')!.getAttribute('value')).toBe('陳大文');
    expect(document.querySelector('textarea')!.textContent).toBe('我的名字');
    expect(document.querySelector('[data-no-zh]')!.textContent).toBe('陳大文');
    expect(document.querySelector('[contenteditable]')!.textContent).toBe('使用者輸入巢狀');
    expect(document.querySelector('.eng')!.textContent).toBe('English only 123');
  });
});
