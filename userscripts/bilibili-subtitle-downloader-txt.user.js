// ==UserScript==
// @name         B站字幕下载器 (纯文本+极简标题版)
// @namespace    https://space.bilibili.com/398910090
// @version      2.2
// @author       Ace (Simplified)
// @description  极简版：一键下载B站视频字幕纯文本(TXT)，无时间轴，纯净视频标题命名。
// @match        *://*.bilibili.com/video/*
// @match        *://*.bilibili.com/bangumi/play/*
// @icon         https://www.bilibili.com/favicon.ico
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/bilibili-subtitle-downloader-txt.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/bilibili-subtitle-downloader-txt.user.js
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // 存储拦截到的字幕URL
    let interceptedSubtitleUrls = [];

    // 添加简单的提示框样式
    function addGlobalStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .bilibili-subtitle-infobar {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background-color: rgba(25, 26, 27, 0.98); border-radius: 8px; padding: 12px 16px;
                color: white; font-size: 14px; z-index: 2147483647;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
                transition: all 0.3s ease;
            }
            .bilibili-subtitle-infobar.info { border-left: 4px solid #00a1d6; }
            .bilibili-subtitle-infobar.success { border-left: 4px solid #52c41a; }
            .bilibili-subtitle-infobar.error { border-left: 4px solid #f5222d; }
        `;
        document.head.appendChild(style);
    }

    // 显示提示信息
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

    function init() {
        addGlobalStyles();
        setupNetworkInterception();
        waitForSubtitleSelector();
    }

    // 等待播放器字幕面板出现
    function waitForSubtitleSelector() {
        let timeoutId;
        const checkInterval = setInterval(() => {
            const subtitlePanel = document.querySelector('.bpx-player-ctrl-subtitle-menu-left') ||
                                document.querySelector('.bpx-player-ctrl-subtitle-menu-origin') ||
                                document.querySelector('.bpx-player-ctrl-subtitle-language-item');

            if (subtitlePanel) {
                clearInterval(checkInterval);
                clearTimeout(timeoutId);
                const actualPanel = subtitlePanel.closest('.bpx-player-ctrl-subtitle-menu-left') ||
                                  subtitlePanel.closest('.bpx-player-ctrl-subtitle-menu-origin') ||
                                  subtitlePanel.parentElement;
                createDownloadInterface(actualPanel);
            }
        }, 500);

        timeoutId = setTimeout(() => clearInterval(checkInterval), 30000);
    }

    // 拦截网页请求，获取字幕地址
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

    // 监听DOM注入下载按钮
    function createDownloadInterface(subtitlePanel) {
        addDownloadButtons();
        const observer = new MutationObserver(() => {
            addDownloadButtons();
        });
        observer.observe(subtitlePanel, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 15000);
    }

    function addDownloadButtons() {
        const subtitleItems = document.querySelectorAll('.bpx-player-ctrl-subtitle-language-item');
        subtitleItems.forEach(item => {
            if (item.querySelector('.bilibili-subtitle-download-btn')) return;

            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'bilibili-subtitle-download-btn';
            downloadBtn.textContent = '下载纯文本';
            downloadBtn.style.cssText = `
                background: transparent; border: none; color: white; cursor: pointer;
                font-size: 0.85em; padding: 0.1em 0.5em; margin: 0 0 0 0.6em;
                transition: all 0.2s ease;
            `;

            downloadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                downloadSubtitle();
            });

            downloadBtn.addEventListener('mouseenter', () => downloadBtn.style.color = '#00a1d6');
            downloadBtn.addEventListener('mouseleave', () => downloadBtn.style.color = 'white');

            item.appendChild(downloadBtn);
        });
    }

    // 合并并去重所有字幕地址
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

    // 获取当前视频标题（兼容多P选集切换）
    function getVideoTitle() {
        let rawTitle = document.title;
        let title = rawTitle.replace(/(_|-)\s*哔哩哔哩.*/, '').trim();

        if (!title || title === 'bilibili' || title === '哔哩哔哩') {
            try {
                const mainTitle = document.querySelector('h1.video-title, .media-info-title-t')?.textContent?.trim() || '';
                const activePart = document.querySelector('.video-pod__item.is-active .title, .list-box li.on .part, .ep-item.cursor')?.textContent?.trim() || '';

                if (mainTitle && activePart) {
                    title = `${mainTitle}_${activePart}`;
                } else {
                    title = mainTitle || activePart || '未知视频';
                }
            } catch (e) {
                title = '未知视频';
            }
        }

        // 过滤操作系统文件名的非法字符 \ / : * ? " < > |
        return title.replace(/[\\/:*?"<>|\n\r]/g, '_').trim();
    }

    // 提取纯文本逻辑
    function jsonToTxt(subtitleData) {
        let txt = '';
        let body = null;

        if (subtitleData && subtitleData.body) body = subtitleData.body;
        else if (subtitleData && subtitleData.data && subtitleData.data.body) body = subtitleData.data.body;
        else throw new Error('无法找到字幕主体数据');

        body.forEach(item => {
            if(item.content) {
                txt += item.content.trim() + '\n';
            }
        });
        return txt;
    }

    // 触发下载
    function downloadSubtitle() {
        const urls = getSubtitleUrls();
        if (urls.length === 0) {
            showInfoBar('未找到字幕，请先在视频播放器中切换/开启一下字幕重试', 'error');
            return;
        }

        showInfoBar('正在下载字幕数据...', 'info', 0);
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

                    const videoTitle = getVideoTitle();

                    // 最极简的文件名拼接，只保留标题
                    const filename = `${videoTitle}.txt`;

                    // 直接触发下载
                    const blob = new Blob([content], { type: 'text/plain' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = filename;
                    link.style.display = 'none';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    setTimeout(() => URL.revokeObjectURL(link.href), 100);
                    showInfoBar(`字幕 "${filename}" 下载完成！`, 'success');
                } catch (error) {
                    showInfoBar('处理字幕数据时出错：' + error.message, 'error');
                }
            },
            onerror: function() {
                const loadingInfoBar = document.querySelector('.bilibili-subtitle-infobar.info');
                if (loadingInfoBar) loadingInfoBar.remove();
                showInfoBar('下载字幕网络请求失败', 'error');
            }
        });
    }

    // 启动脚本
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
