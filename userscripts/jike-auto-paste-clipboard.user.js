// ==UserScript==
// @name         即刻自动粘贴剪贴板（去格式版）
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  点击发布动态时自动粘贴并去除剪贴板中的Markdown格式
// @author       You
// @match        https://web.okjike.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/jike-auto-paste-clipboard.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/jike-auto-paste-clipboard.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 清洗 Markdown 格式的函数
    function stripMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/(\*\*|__)(.*?)\1/g, '$2') // 粗体
            .replace(/(\*|_)(.*?)\1/g, '$2')     // 斜体
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')  // 链接，仅保留文本
            .replace(/~~(.*?)~~/g, '$1')         // 删除线
            .replace(/`(.*?)`/g, '$1')           // 行内代码
            .replace(/^#+\s+/gm, '')             // 标题
            .replace(/^>\s+/gm, '');             // 引用
    }

    async function injectTextToEditor(text) {
        if (!text) return;

        let editor = null;
        for (let i = 0; i < 20; i++) {
            editor = document.querySelector('div[data-lexical-editor="true"]');
            if (editor) break;
            await new Promise(r => setTimeout(r, 100));
        }

        if (editor) {
            editor.focus();

            // 构造真实的粘贴事件，让 Lexical 引擎原生处理换行
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', text);
            const pasteEvent = new ClipboardEvent('paste', {
                clipboardData: dataTransfer,
                bubbles: true,
                cancelable: true
            });
            editor.dispatchEvent(pasteEvent);
        }
    }

    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[aria-label="创建动态"]');
        if (btn) {
            try {
                const clipboardText = await navigator.clipboard.readText();
                const plainText = stripMarkdown(clipboardText);
                await injectTextToEditor(plainText);
            } catch (err) {
                console.error('剪贴板读取或处理失败', err);
            }
        }
    }, true);
})();
