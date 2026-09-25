// ==UserScript==
// @name         B站视频右上角一键Gemini总结
// @namespace    https://space.bilibili.com/398910090
// @version      4.2
// @author       Ace & Macro
// @description  在B站播放器右上角添加快捷按钮，一键抓取字幕、标题并自动跳转专属Gemini Gem自动填入并发送总结，带安全TTL与路径校验防误触。
// @match        *://*.bilibili.com/video/*
// @match        *://*.bilibili.com/bangumi/play/*
// @match        https://gemini.google.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/bilibili-gemini-summary.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/bilibili-gemini-summary.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // 目标 Gem 标识与完整链接
    const GEM_ID = '2666d69cae52';
    const GEMINI_GEM_URL = `https://gemini.google.com/u/0/gem/${GEM_ID}`;

    // ==========================================
    // 逻辑分支 A：在 Gemini 页面自动填入并发送
    // ==========================================
    if (window.location.host === 'gemini.google.com') {
        // 安全拦截 1：非专属总结 Gem 页面（例如普通对话、其它Gem）绝不执行
        if (!window.location.pathname.includes(GEM_ID)) {
            return;
        }

        const taskData = GM_getValue('pending_gemini_task');
        if (taskData && taskData.content && taskData.timestamp) {
            // 立即销毁数据，保证一次性消费
            GM_setValue('pending_gemini_task', null);

            // 安全拦截 2：有效期检查，超过 60 秒的任务直接作废，杜绝历史残留误触发
            const isExpired = (Date.now() - taskData.timestamp) > 60 * 1000;
            if (isExpired) return;

            const pendingPrompt = taskData.content;
            let checkCount = 0;
            const timer = setInterval(() => {
                checkCount++;

                // 查找 Gemini 网页版的核心输入框
                const editable = document.querySelector('rich-textarea div[contenteditable="true"]') ||
                                 document.querySelector('.ql-editor') ||
                                 document.querySelector('div[contenteditable="true"]');

                if (editable) {
                    clearInterval(timer);
                    editable.focus();

                    // 1. 模拟文本插入
                    let success = false;
                    try {
                        success = document.execCommand('insertText', false, pendingPrompt);
                    } catch (e) {
                        success = false;
                    }

                    if (!success) {
                        const pasteEvent = new ClipboardEvent('paste', {
                            bubbles: true,
                            cancelable: true,
                            clipboardData: new DataTransfer()
                        });
                        pasteEvent.clipboardData.setData('text/plain', pendingPrompt);
                        editable.dispatchEvent(pasteEvent);
                    }

                    // 2. 派发输入事件激活内部数据绑定与按钮状态
                    editable.dispatchEvent(new Event('input', { bubbles: true }));

                    // 3. 延迟 500ms 等待发送按钮解除禁用后自动触发
                    setTimeout(() => {
                        const sendBtn = document.querySelector('button[aria-label*="发送"]') ||
                                        document.querySelector('button[aria-label*="Send"]') ||
                                        document.querySelector('button.send-button') ||
                                        document.querySelector('button:has(mat-icon[data-mat-icon-name="send"])') ||
                                        document.querySelector('button:has(span.google-symbols)');

                        if (sendBtn && !sendBtn.disabled) {
                            sendBtn.click();
                        } else {
                            editable.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter',
                                code: 'Enter',
                                keyCode: 13,
                                which: 13,
                                bubbles: true,
                                cancelable: true
                            }));
                        }
                    }, 500);
                }

                // 最长等待 30 秒
                if (checkCount > 60) clearInterval(timer);
            }, 500);
        }
        return;
    }

    // ==========================================
    // 逻辑分支 B：在 B 站页面拦截字幕与注入右上角按钮
    // ==========================================
    let interceptedSubtitleUrls = [];

    function addGlobalStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .bilibili-subtitle-infobar {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background-color: rgba(25, 26, 27, 0.98); border-radius: 8px; padding: 12px 18px;
                color: white; font-size: 14px; z-index: 2147483647;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
                transition: all 0.3s ease; pointer-events: none;
            }
            .bilibili-subtitle-infobar.info { border-left: 4px solid #00a1d6; }
            .bilibili-subtitle-infobar.success { border-left: 4px solid #52c41a; }
            .bilibili-subtitle-infobar.error { border-left: 4px solid #f5222d; }

            .bpx-player-summary-btn {
                position: absolute;
                top: 16px;
                right: 20px;
                z-index: 80;
                background: rgba(0, 0, 0, 0.65);
                color: #ffffff;
                border: 1px solid rgba(255, 255, 255, 0.3);
                padding: 6px 14px;
                border-radius: 20px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 5px;
                backdrop-filter: blur(8px);
                transition: all 0.25s ease;
                user-select: none;
            }
            .bpx-player-summary-btn:hover {
                background: rgba(0, 161, 214, 0.85);
                border-color: #00a1d6;
                transform: scale(1.05);
                box-shadow: 0 4px 15px rgba(0, 161, 214, 0.4);
            }
        `;
        document.head.appendChild(style);
    }

    function showInfoBar(message, type = 'info', duration = 3000) {
        const existingInfoBar = document.querySelector('.bilibili-subtitle-infobar');
        if (existingInfoBar) existingInfoBar.remove();

        const infoBar = document.createElement('div');
        infoBar.className = `bilibili-subtitle-infobar ${type}`;
        infoBar.textContent = message;
        document.body.appendChild(infoBar);

        if (duration > 0) {
            setTimeout(() => { if (infoBar.parentNode) infoBar.remove(); }, duration);
        }
    }

    function setupNetworkInterception() {
        const originalXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            if (url && isSubtitleFileUrl(url)) recordSubtitleUrl(url);
            return originalXHROpen.apply(this, arguments);
        };
        const originalFetch = window.fetch;
        window.fetch = function(input) {
            const url = (typeof input === 'string') ? input : (input && input.url);
            if (url && isSubtitleFileUrl(url)) recordSubtitleUrl(url);
            return originalFetch.apply(this, arguments);
        };
    }

    function recordSubtitleUrl(url) {
        const normalizedUrl = url.replace(/^https?:/, '');
        interceptedSubtitleUrls.push({ url: normalizedUrl });
    }

    function isSubtitleFileUrl(url) {
        if (!url || url.includes('api.bilibili.com') || url.includes('data.bilibili.com')) return false;
        return (url.includes('subtitle') || url.includes('ai_subtitle')) && url.includes('auth_key');
    }

    function mountTopRightButton() {
        const timer = setInterval(() => {
            const playerContainer = document.querySelector('#bilibili-player') ||
                                    document.querySelector('.bpx-player-container') ||
                                    document.querySelector('.bilibili-player-area');

            if (playerContainer) {
                if (playerContainer.querySelector('.bpx-player-summary-btn')) return;

                const summaryBtn = document.createElement('button');
                summaryBtn.className = 'bpx-player-summary-btn';
                summaryBtn.innerHTML = `✨ 总结(Gem)`;
                summaryBtn.title = '提取视频字幕并跳转 Gemini 自动生成总结';

                summaryBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    triggerSummaryProcess();
                });

                playerContainer.appendChild(summaryBtn);
            }
        }, 1000);
    }

    function getSubtitleUrls() {
        const intercepted = interceptedSubtitleUrls.map(item => ({ url: item.url }));
        const scripts = document.querySelectorAll('script');
        const scriptUrls = [];

        scripts.forEach(script => {
            const content = script.textContent;
            if (!content) return;
            const userSubtitleMatch = content.match(/https?:\/\/[^\s"]*subtitle\/[^\s"]*\.json\?auth_key=[^\s"]*/g);
            if (userSubtitleMatch) scriptUrls.push(...userSubtitleMatch);
            const aiSubtitleMatch = content.match(/https?:\/\/[^\s"]*ai_subtitle\/[^\s"]*\?auth_key=[^\s"]*/g);
            if (aiSubtitleMatch) scriptUrls.push(...aiSubtitleMatch);
        });

        const scriptItems = scriptUrls.map(url => ({ url: url.replace(/^https?:/, '') }));
        const all = [...intercepted, ...scriptItems];

        const seen = new Set();
        const unique = [];
        for (const item of all) {
            if (item.url && isSubtitleFileUrl(item.url) && item.url.includes('auth_key') && !seen.has(item.url)) {
                seen.add(item.url);
                unique.push(item);
            }
        }
        return unique;
    }

    function getMediaMetadata() {
        let rawTitle = document.title;
        let title = rawTitle.replace(/(_|-)\s*哔哩哔哩.*/, '').trim();

        try {
            const mainTitle = document.querySelector('h1.video-title, .media-info-title-t')?.textContent?.trim() || '';
            const activePart = document.querySelector('.video-pod__item.is-active .title, .list-box li.on .part, .ep-item.cursor')?.textContent?.trim() || '';

            if (mainTitle && activePart) {
                title = `${mainTitle}_${activePart}`;
            } else if (mainTitle) {
                title = mainTitle;
            }
        } catch (e) {
            title = '未知视频';
        }

        const author = document.querySelector('.up-name, .username, .staff-name')?.textContent?.trim() || '';
        const url = window.location.href;

        return {
            title: title.trim(),
            author: author,
            url: url
        };
    }

    function jsonToTxt(subtitleData) {
        let txt = '';
        let body = null;

        if (subtitleData && subtitleData.body) body = subtitleData.body;
        else if (subtitleData && subtitleData.data && subtitleData.data.body) body = subtitleData.data.body;
        else throw new Error('无法找到字幕主体数据');

        body.forEach(item => {
            if (item.content) {
                txt += item.content.trim() + '\n';
            }
        });
        return txt;
    }

    function triggerSummaryProcess() {
        const urls = getSubtitleUrls();
        if (urls.length === 0) {
            showInfoBar('未检测到字幕，请在播放器底部先开启/切换一次字幕！', 'error');
            return;
        }

        showInfoBar('正在提取字幕并准备跳转...', 'info', 0);
        const subtitleUrl = urls[0].url.startsWith('//') ? 'https:' + urls[0].url : urls[0].url;

        GM_xmlhttpRequest({
            method: 'GET',
            url: subtitleUrl,
            onload: function(response) {
                const loadingInfoBar = document.querySelector('.bilibili-subtitle-infobar.info');
                if (loadingInfoBar) loadingInfoBar.remove();

                try {
                    const subtitleData = JSON.parse(response.responseText);
                    const content = jsonToTxt(subtitleData);
                    const meta = getMediaMetadata();

                    const payload = `【视频标题】：${meta.title}\n【视频链接】：${meta.url}\n【UP主】：${meta.author}\n\n【字幕逐字稿】：\n${content}`;

                    // 1. 存入油猴存储，带上当前时间戳
                    GM_setValue('pending_gemini_task', {
                        content: payload,
                        timestamp: Date.now()
                    });

                    // 2. 剪贴板备份
                    if (typeof GM_setClipboard === 'function') {
                        GM_setClipboard(payload, 'text');
                    } else {
                        navigator.clipboard.writeText(payload);
                    }

                    // 3. 打开专属 Gem 页面
                    if (typeof GM_openInTab === 'function') {
                        GM_openInTab(GEMINI_GEM_URL, { active: true, insert: true });
                    } else {
                        window.open(GEMINI_GEM_URL, '_blank');
                    }

                    showInfoBar('已提取，正在前往 Gem 自动填充发送...', 'success', 2000);
                } catch (error) {
                    showInfoBar('处理失败：' + error.message, 'error');
                }
            },
            onerror: function() {
                const loadingInfoBar = document.querySelector('.bilibili-subtitle-infobar.info');
                if (loadingInfoBar) loadingInfoBar.remove();
                showInfoBar('字幕网络请求失败', 'error');
            }
        });
    }

    function init() {
        addGlobalStyles();
        setupNetworkInterception();
        mountTopRightButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
