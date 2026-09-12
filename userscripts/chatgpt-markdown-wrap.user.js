// ==UserScript==
// @name         ChatGPT Markdown 自动换行
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  让 ChatGPT 中 Markdown 代码块按容器宽度自动换行
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/chatgpt-markdown-wrap.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/chatgpt-markdown-wrap.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    function enableWrap(viewer) {
        if (!viewer) return;

        const editor = viewer.classList.contains('cm-editor')
            ? viewer
            : viewer.querySelector('.cm-editor');

        if (!editor) return;

        const scroller = editor.querySelector('.cm-scroller');
        const content = editor.querySelector('.cm-content');

        if (!scroller || !content) return;

        // 关键：启用 CodeMirror 的换行类
        content.classList.add('cm-lineWrapping');

        // 关键：补上必要样式
        editor.style.minWidth = '0';
        editor.style.maxWidth = '100%';
        editor.style.width = '100%';

        scroller.style.overflowX = 'auto';
        scroller.style.maxWidth = '100%';
        scroller.style.minWidth = '0';

        content.style.whiteSpace = 'pre-wrap';
        content.style.overflowWrap = 'anywhere';
        content.style.wordBreak = 'break-word';
        content.style.maxWidth = '100%';
        content.style.minWidth = '0';
        content.style.display = 'block';
        content.style.flexShrink = '1';

        // 有些父层是 flex，必须允许收缩
        let p = viewer.parentElement;
        while (p && p !== document.body) {
            const cs = getComputedStyle(p);
            if (cs.display.includes('flex')) {
                p.style.minWidth = '0';
                p.style.maxWidth = '100%';
            }
            p = p.parentElement;
        }
    }

    function scan() {
        document.querySelectorAll('#code-block-viewer, .cm-editor').forEach(enableWrap);
    }

    // 注入一份更稳的样式
    const style = document.createElement('style');
    style.textContent = `
        .cm-editor {
            min-width: 0 !important;
            max-width: 100% !important;
        }

        .cm-editor .cm-scroller {
            min-width: 0 !important;
            max-width: 100% !important;
        }

        .cm-editor .cm-content.cm-lineWrapping {
            white-space: pre-wrap !important;
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
            min-width: 0 !important;
            max-width: 100% !important;
            flex-shrink: 1 !important;
        }

        .cm-editor .cm-content.cm-lineWrapping > * {
            white-space: inherit !important;
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
        }
    `;
    document.head.appendChild(style);

    scan();

    const observer = new MutationObserver(() => {
        scan();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    console.log('ChatGPT Markdown 自动换行脚本已加载');
})();
