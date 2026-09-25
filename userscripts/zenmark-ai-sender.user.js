// ==UserScript==
// @name         AI 回答发送到 ZenMark (DeepSeek & Kimi & Gemini)
// @namespace    https://github.com/macrochen/ZenMark
// @version      1.1.0
// @description  复用 DeepSeek、Kimi 和 Gemini 原生复制能力，提取 Markdown 内容并一键发送至 ZenMark 新标签页阅读
// @author       macrochen
// @match        *://chat.deepseek.com/*
// @match        *://*.kimi.com/*
// @match        *://*.kimi.moonshot.cn/*
// @match        *://gemini.google.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/zenmark-ai-sender.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/zenmark-ai-sender.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      zenmark-bxx.pages.dev
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 线上部署服务地址
    const ZENMARK_API_URL = 'https://zenmark-bxx.pages.dev/api/read';

    // 状态标记与当前操作触发的按钮引用
    window._ai_zenmark_trigger = false;
    let currentTriggerBtn = null;

    /**
     * 更新按钮文本与状态
     */
    function setBtnStatus(btn, text, disabled = false) {
        if (!btn) return;
        btn.textContent = text;
        btn.style.pointerEvents = disabled ? 'none' : 'auto';
        btn.style.opacity = disabled ? '0.6' : '1';
    }

    /**
     * 获取当前对话或页面的标题
     */
    function getContextTitle() {
        const hostname = window.location.hostname;
        let title = document.title ? document.title.trim() : '';

        if (hostname.includes('gemini.google.com')) {
            if (title && !/^https?:\/\//i.test(title)) {
                title = title.replace(/(?:\s*[-–—]\s*)?(?:Google\s*)?Gemini$/i, '').trim();
            }
        }
        return title || 'AI 回答摘录';
    }

    /**
     * 将截获的 Markdown 文本发送至 ZenMark 服务
     */
    function sendMarkdownToZenMark(markdownText, sourceBtn) {
        if (!markdownText || !markdownText.trim()) {
            setBtnStatus(sourceBtn, '📖 内容为空');
            setTimeout(() => setBtnStatus(sourceBtn, '📖 ZenMark'), 2000);
            return;
        }

        const title = getContextTitle();
        setBtnStatus(sourceBtn, '⏳ 传输中...', true);

        GM_xmlhttpRequest({
            method: 'POST',
            url: ZENMARK_API_URL,
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            },
            data: JSON.stringify({
                text: markdownText.trim(),
                title: title,
                autoRead: false
            }),
            onload: function(response) {
                try {
                    const result = JSON.parse(response.responseText);
                    if (response.status === 200 && result.success && result.url) {
                        setBtnStatus(sourceBtn, '✔ 已打开');
                        // 在新标签页打开 ZenMark
                        GM_openInTab(result.url, { active: true, insert: true });
                    } else {
                        throw new Error(result.error || `接口返回异常 (${response.status})`);
                    }
                } catch (e) {
                    console.error('[ZenMark TM 错误]', e);
                    alert('发送失败：' + (e.message || response.responseText));
                    setBtnStatus(sourceBtn, '❌ 失败');
                }
                setTimeout(() => setBtnStatus(sourceBtn, '📖 ZenMark'), 2000);
            },
            onerror: function(err) {
                console.error('[ZenMark TM 网络错误]', err);
                alert('无法连接到 ZenMark 服务！\n请检查网络连接或 Cloudflare Pages 函数接口是否正常响应。');
                setBtnStatus(sourceBtn, '❌ 离线');
                setTimeout(() => setBtnStatus(sourceBtn, '📖 ZenMark'), 2000);
            }
        });
    }

    // ================= 拦截 Clipboard 提取原生 Markdown ================= //

    const originalWriteText = navigator.clipboard.writeText;
    if (originalWriteText) {
        navigator.clipboard.writeText = function(text) {
            if (window._ai_zenmark_trigger) {
                window._ai_zenmark_trigger = false;
                sendMarkdownToZenMark(text, currentTriggerBtn);
                return Promise.resolve();
            }
            return originalWriteText.apply(this, arguments);
        };
    }

    const originalWrite = navigator.clipboard.write;
    if (originalWrite) {
        navigator.clipboard.write = function(data) {
            if (window._ai_zenmark_trigger) {
                window._ai_zenmark_trigger = false;
                if (data && data.length > 0) {
                    const item = data[0];
                    if (item.types.includes('text/plain')) {
                        item.getType('text/plain').then(blob => {
                            blob.text().then(text => {
                                sendMarkdownToZenMark(text, currentTriggerBtn);
                            });
                        });
                        return Promise.resolve();
                    }
                }
            }
            return originalWrite.apply(this, arguments);
        };
    }

    // ================= 构造 ZenMark 按钮 ================= //

    function createZenMarkBtn(copyBtn) {
        const btn = document.createElement('button');
        btn.textContent = '📖 ZenMark';
        btn.className = 'ai-zenmark-btn icon-button';
        btn.style.cssText = `
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            color: #10b981;
            margin-left: 8px;
            font-weight: 600;
            user-select: none;
            white-space: nowrap;
            background: rgba(16, 185, 129, 0.08);
            border: 1px solid rgba(16, 185, 129, 0.35);
            border-radius: 6px;
            padding: 3px 8px;
            z-index: 99;
            transition: all 0.2s ease;
        `;

        btn.onmouseenter = () => {
            btn.style.backgroundColor = 'rgba(16, 185, 129, 0.18)';
            btn.style.borderColor = '#10b981';
        };
        btn.onmouseleave = () => {
            btn.style.backgroundColor = 'rgba(16, 185, 129, 0.08)';
            btn.style.borderColor = 'rgba(16, 185, 129, 0.35)';
        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            window._ai_zenmark_trigger = true;
            currentTriggerBtn = btn;
            setBtnStatus(btn, '⏳ 提取中...', true);
            // 触发原生复制按钮，进入 clipboard 拦截器
            copyBtn.click();
        });

        return btn;
    }

    // ================= 页面元素查找与注入 ================= //

    function injectButtons() {
        const hostname = window.location.hostname;

        // 1. Kimi
        if (hostname.includes('kimi.com') || hostname.includes('moonshot.cn')) {
            const actionBars = document.querySelectorAll('div.segment-assistant-actions-content');
            actionBars.forEach(actionBar => {
                if (!actionBar.querySelector('.ai-zenmark-btn')) {
                    const copySvg = actionBar.querySelector('svg[name="Copy"]');
                    if (copySvg) {
                        const copyBtn = copySvg.closest('.icon-button') || copySvg.parentElement;
                        actionBar.appendChild(createZenMarkBtn(copyBtn));
                    }
                }
            });
        }
        // 2. Gemini
        else if (hostname.includes('gemini.google.com')) {
            const actionBars = document.querySelectorAll('message-actions .buttons-container-v2, message-actions');
            actionBars.forEach(actionBar => {
                if (!actionBar.querySelector('.ai-zenmark-btn')) {
                    const copyBtn = actionBar.querySelector('copy-button, button[aria-label*="Copy" i], button[aria-label*="复制" i], [data-test-id="copy-button"]');
                    if (copyBtn) {
                        const realClickTarget = copyBtn.querySelector('button') || copyBtn;
                        const btn = createZenMarkBtn(realClickTarget);
                        copyBtn.after(btn);
                    }
                }
            });
        }
        // 3. DeepSeek
        else if (hostname.includes('deepseek.com')) {
            const svgs = document.querySelectorAll('svg');
            svgs.forEach(svg => {
                const btn = svg.closest('[role="button"], button, a');
                if (!btn) return;

                const actionBar = btn.parentElement;
                if (actionBar && !actionBar.querySelector('.ai-zenmark-btn')) {
                    const actionBtns = Array.from(actionBar.children).filter(child =>
                        child.tagName === 'BUTTON' ||
                        child.getAttribute('role') === 'button' ||
                        child.querySelector('svg')
                    );
                    if (actionBtns.length >= 3) {
                        actionBar.appendChild(createZenMarkBtn(actionBtns[0]));
                    }
                }
            });
        }
    }

    // DOM 变化监听防抖
    let debounceTimer;
    const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(injectButtons, 300);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
