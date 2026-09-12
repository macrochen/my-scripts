// ==UserScript==
// @name         AI 助手回答 Markdown 下载器 (DeepSeek & Kimi & Gemini)
// @namespace    http://tampermonkey.net/
// @version      1.12
// @description  重用 DeepSeek、Kimi 和 Gemini 原生的复制功能，将回答原样下载为 Markdown 文件
// @author       You
// @match        *://chat.deepseek.com/*
// @match        *://*.kimi.com/*
// @match        *://*.kimi.moonshot.cn/*
// @match        *://gemini.google.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/ai-md-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/ai-md-downloader.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    console.log("[AI MD Downloader] 脚本已加载...");
    window._ai_is_downloading = false;

    // 拦截剪贴板
    const originalWriteText = navigator.clipboard.writeText;
    if (originalWriteText) {
        navigator.clipboard.writeText = function(text) {
            if (window._ai_is_downloading) {
                window._ai_is_downloading = false;
                downloadAsMarkdown(text);
                return Promise.resolve();
            }
            return originalWriteText.apply(this, arguments);
        };
    }

    const originalWrite = navigator.clipboard.write;
    if (originalWrite) {
        navigator.clipboard.write = function(data) {
            if (window._ai_is_downloading) {
                window._ai_is_downloading = false;
                if (data && data.length > 0) {
                    const item = data[0];
                    if (item.types.includes('text/plain')) {
                        item.getType('text/plain').then(blob => {
                            blob.text().then(text => {
                                downloadAsMarkdown(text);
                            });
                        });
                        return Promise.resolve();
                    }
                }
            }
            return originalWrite.apply(this, arguments);
        };
    }

    // 本地文件生成
    function downloadAsMarkdown(content) {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
        
        const hostname = window.location.hostname;
        const isKimi = hostname.includes('kimi') || hostname.includes('moonshot');
        const isGemini = hostname.includes('gemini');
        const platform = isKimi ? 'kimi' : (isGemini ? 'gemini' : 'deepseek');

        let filename = `${platform}-${timestamp}.md`;

        if (isGemini) {
            let title = document.title.trim();
            // 如果标题不是一个 URL
            if (title && !/^https?:\/\//i.test(title) && !/^[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+(\/.*)?$/.test(title)) {
                // 能够匹配 " - Gemini", " - Google Gemini", " – Google Gemini" 甚至 "Google Gemini"
                let cleanTitle = title.replace(/(?:\s*[-–—]\s*)?(?:Google\s*)?Gemini$/i, '').trim();

                // 如果去掉后缀之后还有内容，才使用它作为文件名（这就保证了原名只是 Google Gemini 就会因为为空而走到下面使用时间戳后缀的兜底逻辑）
                if (cleanTitle) {
                    // 去除文件名中的非法字符
                    cleanTitle = cleanTitle.replace(/[\\/:*?"<>|]/g, '_').substring(0, 100);
                    filename = `${cleanTitle}.md`;
                }
            }
        }

        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // 构造下载按钮
    function createDownloadBtn(copyBtn) {
        const downloadBtn = document.createElement('button');
        // 为了兼容 Gemini 的 Trusted Types CSP，不能使用 innerHTML
        downloadBtn.textContent = '📥 MD';
        downloadBtn.className = 'ai-md-download-btn icon-button';
        downloadBtn.style.cssText = `
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            color: var(--text-secondary, #888);
            margin-left: 8px;
            font-weight: 600;
            user-select: none;
            white-space: nowrap;
            background: transparent;
            border: 1px solid rgba(136, 136, 136, 0.2);
            border-radius: 6px;
            padding: 4px 8px;
            z-index: 99;
        `;

        downloadBtn.onmouseenter = () => {
            downloadBtn.style.color = '#1890ff';
            downloadBtn.style.borderColor = '#1890ff';
        };
        downloadBtn.onmouseleave = () => {
            downloadBtn.style.color = 'var(--text-secondary, #888)';
            downloadBtn.style.borderColor = 'rgba(136, 136, 136, 0.2)';
        };

        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            window._ai_is_downloading = true;
            copyBtn.click();
        });

        return downloadBtn;
    }

    // 动态化注入逻辑
    function injectDownloadButtons() {
        const hostname = window.location.hostname;

        if (hostname.includes('kimi.com') || hostname.includes('moonshot.cn')) {
            const actionBars = document.querySelectorAll('div.segment-assistant-actions-content');

            actionBars.forEach(actionBar => {
                if (!actionBar.querySelector('.ai-md-download-btn')) {
                    const copySvg = actionBar.querySelector('svg[name="Copy"]');
                    if (copySvg) {
                        const copyBtn = copySvg.closest('.icon-button') || copySvg.parentElement;
                        actionBar.appendChild(createDownloadBtn(copyBtn));
                    }
                }
            });
        }
        else if (hostname.includes('gemini.google.com')) {
            // Gemini 采用包裹在 message-actions 下的 buttons-container-v2
            const actionBars = document.querySelectorAll('message-actions .buttons-container-v2, message-actions');

            actionBars.forEach(actionBar => {
                if (!actionBar.querySelector('.ai-md-download-btn')) {
                    // 尝试找到 copy-button 节点
                    const copyBtn = actionBar.querySelector('copy-button, button[aria-label*="Copy" i], button[aria-label*="复制" i], [data-test-id="copy-button"]');
                    if (copyBtn) {
                        const realClickTarget = copyBtn.querySelector('button') || copyBtn;
                        const btn = createDownloadBtn(realClickTarget);
                        // 把按钮插入到 copyBtn 后面
                        copyBtn.after(btn);
                        console.log("[AI MD Downloader] 成功在 Gemini 页面注入按钮", btn);
                    }
                }
            });
        }
        else if (hostname.includes('deepseek.com')) {
            const svgs = document.querySelectorAll('svg');
            svgs.forEach(svg => {
                const btn = svg.closest('[role="button"], button, a');
                if (!btn) return;

                const actionBar = btn.parentElement;
                if (actionBar && !actionBar.querySelector('.ai-md-download-btn')) {
                    const actionBtns = Array.from(actionBar.children).filter(child =>
                        child.tagName === 'BUTTON' ||
                        child.getAttribute('role') === 'button' ||
                        child.querySelector('svg')
                    );
                    if (actionBtns.length >= 3) {
                        actionBar.appendChild(createDownloadBtn(actionBtns[0]));
                    }
                }
            });
        }
    }

    // DOM 变动防抖监听
    let timeout;
    const observer = new MutationObserver(() => {
        clearTimeout(timeout);
        timeout = setTimeout(injectDownloadButtons, 300);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
