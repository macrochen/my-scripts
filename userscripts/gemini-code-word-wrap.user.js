// ==UserScript==
// @name         Gemini 代码自动换行 (Gemini Code Block Word Wrap)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  让 Gemini 输出的代码块根据窗口宽度自动换行，告别水平滚动条。
// @author       You
// @match        https://gemini.google.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/gemini-code-word-wrap.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/gemini-code-word-wrap.user.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // 这里的 CSS 规则就是让代码乖乖换行的关键
    // white-space: pre-wrap; 保留空格和换行符，但是遇到边界会自动换行
    // overflow-wrap: break-word; 如果一个单词（比如超长哈希值）太长，强制切断换行，防止撑开布局
    const css = `
        pre, code, .code-block, pre > code {
            white-space: pre-wrap !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            overflow-x: hidden !important; /* 隐藏水平滚动条 */
        }
    `;

    // 注入样式
    // 如果 Tampermonkey 支持 GM_addStyle 直接用，不支持则手动创建 style 标签
    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(css);
    } else {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    console.log('Gemini 代码自动换行脚本已加载');
})();
