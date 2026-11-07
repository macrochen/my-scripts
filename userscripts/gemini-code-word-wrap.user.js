// ==UserScript==
// @name         全平台 AI 大模型代码块自动换行 (AI Code Block Word Wrap)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  让 Gemini、元宝、ChatGPT、Claude、DeepSeek、Kimi 等 AI 大模型输出的代码块自动换行，告别水平滚动条。
// @author       macrochen
// @match        https://gemini.google.com/*
// @match        https://yuanbao.tencent.com/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @match        https://chat.deepseek.com/*
// @match        https://kimi.moonshot.cn/*
// @match        https://yiyan.baidu.com/*
// @match        https://doubao.com/*
// @match        https://www.doubao.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/gemini-code-word-wrap.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/gemini-code-word-wrap.user.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // 针对通用 pre/code 标签及各平台常见代码块容器类名进行强制换行设置
    const css = `
        pre,
        code,
        pre code,
        .code-block,
        [class*="code-block"],
        [class*="highlight"],
        [class*="CodeBlock"] {
            white-space: pre-wrap !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            overflow-x: hidden !important; /* 隐藏水平滚动条 */
        }
    `;

    // 注入样式：优先使用 GM_addStyle，不支持时回退到手动创建 style 标签
    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(css);
    } else {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    console.log('[AI 代码自动换行] 脚本已成功加载');
})();
