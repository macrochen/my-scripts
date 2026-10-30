// ==UserScript==
// @name         视频 AI 总结 (B站/YouTube → 多模型)
// @namespace    https://space.bilibili.com/398910090
// @version      1.3
// @author       Ace & Macro
// @description  在B站/YouTube播放器添加按钮，抓取字幕，在新标签页打开所选 AI（DeepSeek/ChatGPT/Kimi/豆包/千问/元宝）并自动填入发送。
// @match        *://*.bilibili.com/video/*
// @match        *://*.bilibili.com/bangumi/play/*
// @match        https://www.youtube.com/watch*
// @match        https://youtube.com/watch*
// @match        https://chat.deepseek.com/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://www.kimi.com/*
// @match        https://kimi.com/*
// @match        https://kimi.moonshot.cn/*
// @match        https://www.doubao.com/*
// @match        https://doubao.com/*
// @match        https://www.qianwen.com/*
// @match        https://qianwen.com/*
// @match        https://tongyi.aliyun.com/*
// @match        https://yuanbao.tencent.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/video-ai-summary-multi.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/video-ai-summary-multi.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      api.bilibili.com
// @connect      *.bilibili.com
// @connect      aisubtitle.hdslb.com
// @connect      i0.hdslb.com
// @connect      i1.hdslb.com
// @connect      i2.hdslb.com
// @connect      i3.hdslb.com
// @connect      s1.hdslb.com
// @connect      s2.hdslb.com
// @connect      *.hdslb.com
// @run-at       document-start
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const TASK_KEYS = {
        bilibili: 'VIDEO_AI_SUMMARY_TASK_BILIBILI',
        youtube: 'VIDEO_AI_SUMMARY_TASK_YOUTUBE'
    };
    const PROVIDER_KEY = 'VIDEO_AI_SUMMARY_PROVIDER';
    const TASK_TTL = 2 * 60 * 1000; // 待发送内容有效期：2 分钟
    const DEBUG = false;

    // 想新增模型时，只需要在 PROVIDERS 里加一项
    const PROVIDERS = [
        {
            id: 'deepseek',
            name: 'DeepSeek',
            url: 'https://chat.deepseek.com/',
            hosts: ['chat.deepseek.com'],
            inputSelectors: ['textarea#chat-input', '#chat-input', 'textarea', 'div[contenteditable="true"]'],
            sendSelectors: [
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                'button[data-testid="send-button"]',
                'button[type="submit"]'
            ]
        },
        {
            id: 'chatgpt',
            name: 'ChatGPT',
            url: 'https://chatgpt.com/',
            hosts: ['chatgpt.com', 'chat.openai.com'],
            inputSelectors: [
                '#prompt-textarea',
                'textarea#prompt-textarea',
                'div#prompt-textarea[contenteditable="true"]',
                'div.ProseMirror[contenteditable="true"]',
                'textarea'
            ],
            sendSelectors: [
                'button[data-testid="send-button"]',
                'button[aria-label*="Send prompt"]',
                'button[aria-label*="Send"]',
                'button[aria-label*="发送"]',
                'button[type="submit"]'
            ]
        },
        {
            id: 'kimi',
            name: 'Kimi',
            url: 'https://www.kimi.com/',
            hosts: ['kimi.com', 'www.kimi.com', 'kimi.moonshot.cn'],
            inputSelectors: ['div[contenteditable="true"]', '[role="textbox"]', 'textarea'],
            sendSelectors: [
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                'button[type="submit"]',
                '[class*="send"]'
            ]
        },
        {
            id: 'doubao',
            name: '豆包',
            url: 'https://www.doubao.com/chat/',
            hosts: ['doubao.com', 'www.doubao.com'],
            inputSelectors: ['textarea', 'div[contenteditable="true"]', '[role="textbox"]'],
            sendSelectors: [
                'button[data-testid="chat_input_send_button"]',
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                'button[type="submit"]',
                '[class*="send"]'
            ]
        },
        {
            id: 'qianwen',
            name: '通义千问',
            url: 'https://www.qianwen.com/',
            hosts: ['qianwen.com', 'www.qianwen.com', 'tongyi.aliyun.com'],
            inputSelectors: ['textarea', 'div[contenteditable="true"]', '[role="textbox"]'],
            sendSelectors: [
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                'button[type="submit"]',
                '[class*="send"]'
            ]
        },
        {
            id: 'yuanbao',
            name: '元宝',
            url: 'https://yuanbao.tencent.com/chat',
            hosts: ['yuanbao.tencent.com'],
            inputSelectors: [
                '.ql-editor.ql-blank',
                '.ql-editor',
                '.message-input',
                'textarea[placeholder*="输入"]',
                'div[contenteditable="true"]',
                'textarea'
            ],
            sendSelectors: [
                '#yuanbao-send-btn',
                'button[class*="send"]',
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                'button[type="submit"]'
            ]
        }
    ];

    const DEFAULT_PROVIDER_ID = 'deepseek';

    // 让旧的两份单模型脚本自动停用，避免重复按钮
    try { window.__VIDEO_AI_SUMMARY_MULTI__ = true; } catch (e) { /* ignore */ }
    try {
        if (typeof unsafeWindow !== 'undefined') unsafeWindow.__VIDEO_AI_SUMMARY_MULTI__ = true;
    } catch (e) { /* ignore */ }
    try {
        const markMultiScript = () => {
            try {
                if (document.documentElement) document.documentElement.dataset.videoAiSummaryMulti = '1';
            } catch (e) { /* ignore */ }
        };
        markMultiScript();
        whenDomReady(markMultiScript);
    } catch (e) { /* ignore */ }

    const SUMMARY_PROMPT = `请把我给定的内容（文字/视频）总结成一个"读完能记住"的版本。

不是做摘要，是用你自己的话把这个东西重新讲一遍。讲完之后，别人应该能记住核心观点，还能复述出一两个关键细节。

# 怎么写

1. 先找到全文的一条主线。所有内容围绕这条线展开，偏离主线的素材直接扔掉。
2. 沿着主线，挑出几个真正值得记住的点。每个点讲清楚：它在说什么、凭什么值得信。
3. 细节不要全删。有画面感的例子、反常识的事实、作者自己说的原话，如果它能帮人记住观点，就留着。每个重点最多留一个这样的细节，不要贪多。
4. 一段只说一件事。观点是一段，例子是一段，结论是一段。宁可多分段，不要挤成一堵墙。
5. 如果是网页内容，在开头写上标题和原文链接。

# 不要做的事

- 不要加"解释："、"举例："、"关系："、"小结："这类标签。你在讲东西，不是在填表。
- 不要用生硬的栏目标题把内容切成块。可以有结构，但不要让人看到骨架。
- 不要为了工整而凑排比、凑对仗。
- 不要在结尾写"总而言之"然后把前面说过的话再说一遍。
- 不要用这些词："底层逻辑"、"认知升级"、"本质上"（一篇里最多出现1次）、"深度"、"维度"、"赋能"、"颗粒度"。
- 不要用破折号（——）。

# 补一段"但是"（仅在需要时）

如果原文是在表达一个观点、给一个建议、或者论证一件事，总结写完之后，补一小段提醒：
- 这个观点成立的前提是什么？换个场景还成立吗？
- 读者最容易把什么当成绝对真理，但其实是有条件的？

只在确实有值得说的时候写，写两三句就够。不要硬挑刺，不要为了显得"批判性思维"而强行唱反调。

# 抛几个问题

最后扔三四个值得接着想的问题。目的不是考记忆力，而是帮读者把内容接到自己的经验上。

要求很简单：每个问题都得让人真的停下来想一想，不能是搜一下就有答案的。比如：
- 内容里没有明说、但整个论证其实站在上面的那个前提，把它翻出来问
- 把观点放到一个完全相反的场景里，看看还能不能站住
- 跟读者自己正在做的事或正在纠结的决定挂上钩

问的语气随意一点，像聊完天顺嘴说的，不要像出考题。

# 语言

- 简体中文。
- 像在跟人说话，不像在写报告。
- 平实、干净。不用刻意幽默，不用刻意深刻。把事情说清楚就是最好的风格。`;

    const HOST = location.hostname;

    // ================================================================
    //  AI 模型页面分支
    // ================================================================
    const currentProvider = getProviderByHost(HOST);
    if (currentProvider) {
        whenDomReady(() => setTimeout(() => runProviderPage(currentProvider), 0));
        return;
    }

    // ================================================================
    //  B 站分支
    // ================================================================
    if (/(^|\.)bilibili\.com$/.test(HOST)) {
        // 尽早挂上网络拦截，避免自动加载字幕时错过请求
        installNetworkInterception();
        whenDomReady(() => setTimeout(runBilibili, 0));
    }

    // ================================================================
    //  YouTube 分支
    // ================================================================
    if (/(^|\.)youtube\.com$/.test(HOST)) {
        whenDomReady(() => setTimeout(runYouTube, 0));
    }

    // ================================================================
    //  通用工具
    // ================================================================
    function whenDomReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function log(...args) {
        if (DEBUG) console.log('[视频AI]', ...args);
    }

    function getProviderById(id) {
        return PROVIDERS.find(item => item.id === id) || null;
    }

    function getProviderByHost(hostname) {
        return PROVIDERS.find(provider =>
            provider.hosts.some(host => hostname === host || hostname.endsWith('.' + host))
        ) || null;
    }

    function getSelectedProvider() {
        let id = DEFAULT_PROVIDER_ID;
        try { id = GM_getValue(PROVIDER_KEY, DEFAULT_PROVIDER_ID); } catch (e) { /* ignore */ }
        return getProviderById(id) || getProviderById(DEFAULT_PROVIDER_ID);
    }

    function setSelectedProvider(id) {
        if (!getProviderById(id)) return;
        try { GM_setValue(PROVIDER_KEY, id); } catch (e) { /* ignore */ }
    }

    function createProviderSelect(currentId, onChange) {
        const select = document.createElement('select');
        select.className = 'video-ai-summary-select';
        select.title = '选择 AI 模型';

        PROVIDERS.forEach(provider => {
            const option = document.createElement('option');
            option.value = provider.id;
            option.textContent = provider.name;
            select.appendChild(option);
        });

        select.value = currentId;
        const stop = (event) => event.stopPropagation();
        ['click', 'mousedown', 'keydown'].forEach(type => select.addEventListener(type, stop));
        select.addEventListener('change', () => onChange(select.value));
        return select;
    }

    function openProviderTab(provider) {
        if (!provider) return;
        try {
            if (typeof GM_openInTab === 'function') {
                GM_openInTab(provider.url, { active: true, insert: true });
                return;
            }
        } catch (e) {
            log('GM_openInTab 失败，回退 window.open', e);
        }
        // 兜底。注意：异步点击后可能被浏览器拦截。
        window.open(provider.url, '_blank');
    }

    // ================================================================
    //  B 站：网络拦截
    // ================================================================
    let interceptedSubtitleUrls = []; // [{ url, timestamp }]
    let lastPageKey = '';
    let pageKeyStartedAt = 0;
    let summaryButton = null;
    let summaryWrap = null;
    let providerSelect = null;
    let isRunning = false;

    function installNetworkInterception() {
        hookXhr(window);
        hookFetch(window);

        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow !== window) {
                hookXhr(unsafeWindow);
                hookFetch(unsafeWindow);
            }
        } catch (e) { /* ignore */ }
    }

    function hookXhr(win) {
        try {
            const proto = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
            if (!proto || proto.__biliSummaryHooked) return;
            proto.__biliSummaryHooked = true;

            const originalOpen = proto.open;
            proto.open = function (method, url) {
                const urlText = url ? String(url) : '';
                try {
                    this.__biliAiSummaryUrl = urlText;
                    if (urlText && isSubtitleFileUrl(urlText)) {
                        recordSubtitleUrl(urlText);
                    }
                } catch (e) { /* ignore */ }
                return originalOpen.apply(this, arguments);
            };

            const originalSend = proto.send;
            proto.send = function () {
                try {
                    const urlText = this.__biliAiSummaryUrl || '';
                    if (urlText && isSubtitleListApiUrl(urlText)) {
                        this.addEventListener('load', function () {
                            try {
                                extractSubtitleUrlsFromResponse(this.responseText);
                            } catch (e) { /* ignore */ }
                        });
                    }
                } catch (e) { /* ignore */ }
                return originalSend.apply(this, arguments);
            };
        } catch (e) { /* ignore */ }
    }

    function hookFetch(win) {
        try {
            const originalFetch = win.fetch;
            if (typeof originalFetch !== 'function' || originalFetch.__biliSummaryHooked) return;

            const wrapped = function (input) {
                let urlText = '';
                try {
                    urlText = typeof input === 'string'
                        ? input
                        : ((input && input.url) || '');
                    if (urlText && isSubtitleFileUrl(urlText)) {
                        recordSubtitleUrl(urlText);
                    }
                } catch (e) { /* ignore */ }

                const result = originalFetch.apply(this, arguments);

                // 播放器请求字幕列表时，顺便从它的响应里把字幕 CDN 地址捞出来
                if (urlText && isSubtitleListApiUrl(urlText)) {
                    try {
                        return result.then(response => {
                            try {
                                const clone = response.clone();
                                clone.text()
                                    .then(text => extractSubtitleUrlsFromResponse(text))
                                    .catch(() => {});
                            } catch (e) { /* ignore */ }
                            return response;
                        });
                    } catch (e) { /* 返回原始 Promise */ }
                }

                return result;
            };

            wrapped.__biliSummaryHooked = true;
            win.fetch = wrapped;
        } catch (e) { /* ignore */ }
    }

    function recordSubtitleUrl(url) {
        const normalized = String(url || '').replace(/^https?:/, '');
        if (!normalized) return;

        // 去重并把最近出现的移到末尾
        const index = interceptedSubtitleUrls.findIndex(item => item.url === normalized);
        if (index !== -1) interceptedSubtitleUrls.splice(index, 1);

        interceptedSubtitleUrls.push({
            url: normalized,
            timestamp: Date.now(),
            pageKey: location.pathname + location.search
        });
        if (interceptedSubtitleUrls.length > 50) interceptedSubtitleUrls.shift();
    }

    function isSubtitleFileUrl(url) {
        if (!url) return false;
        if (url.includes('api.bilibili.com') || url.includes('data.bilibili.com')) return false;
        const isSubtitle = url.includes('subtitle') || url.includes('aisubtitle');
        return isSubtitle && (url.includes('auth_key') || url.includes('.json') || url.includes('/bfs/'));
    }

    function isAiSubtitleUrl(url) {
        return /(?:ai_subtitle|aisubtitle)/i.test(String(url || ''));
    }

    // B 站 AI 字幕 URL 形如 /ai_subtitle/prod/<aid><cid><hash>?auth_key=...
    // 用当前视频的 aid+cid 过滤掉上一支视频/缓存里残留的字幕地址
    function isSubtitleUrlForCurrentVideo(url, ctx) {
        if (!url) return false;
        if (!isAiSubtitleUrl(url)) return true; // 用户上传字幕没有 aid/cid 前缀，无法按此过滤
        if (!ctx || ctx.epId) return true;      // 番剧 URL 前缀格式未确认，不做强过滤
        if (!ctx.aid || !ctx.cid) return true;  // 缺少 id 时无法判断

        const match = String(url).match(/\/ai_subtitle\/prod\/([^?]+)/i) ||
                      String(url).match(/\/ai_subtitle\/([^?]+)/i);
        if (!match) return true;

        const pathId = match[1];
        if (!/^\d{10,}/.test(pathId)) return true;

        const aid = String(ctx.aid);
        const cid = String(ctx.cid);
        if (pathId.startsWith(aid + cid)) return true;

        // 兼容 aid/cid 之间带分隔符的格式
        return pathId.includes(aid) && pathId.includes(cid);
    }

    function isSubtitleListApiUrl(url) {
        if (!url || !url.includes('api.bilibili.com')) return false;
        return url.includes('/x/v2/subtitle/') ||
            url.includes('/x/player/v2') ||
            url.includes('/x/player/wbi/v2');
    }

    function extractSubtitleUrlsFromResponse(text) {
        if (!text) return;

        let json = null;
        try {
            json = JSON.parse(String(text).replace(/^\uFEFF/, ''));
        } catch (e) {
            return; // 可能是 protobuf / 非 JSON 响应
        }

        const data = json && json.data;
        if (!data) return;

        const subtitles = [];
        if (data.subtitle && Array.isArray(data.subtitle.subtitles)) {
            subtitles.push(...data.subtitle.subtitles);
        }
        if (Array.isArray(data.subtitles)) {
            subtitles.push(...data.subtitles);
        }

        subtitles.forEach(item => {
            if (item && item.subtitle_url) recordSubtitleUrl(item.subtitle_url);
        });
    }

    // 从拦截记录 + 页面内联脚本中收集字幕地址，最新的优先
    function getSubtitleUrls() {
        const result = [];
        const seen = new Set();
        const currentPageKey = location.pathname + location.search;

        const add = (raw) => {
            if (!raw) return;
            const normalized = String(raw).replace(/^https?:/, '');
            if (!normalized || seen.has(normalized) || !isSubtitleFileUrl(normalized)) return;
            seen.add(normalized);
            result.push('https:' + normalized);
        };

        for (let i = interceptedSubtitleUrls.length - 1; i >= 0; i--) {
            const item = interceptedSubtitleUrls[i];
            if (item.pageKey && item.pageKey !== currentPageKey) continue;
            add(item.url);
        }

        // 兜底：浏览器已经请求过的资源里找字幕地址（即使请求发生在脚本注入之前）
        try {
            if (typeof performance !== 'undefined' && performance.getEntriesByType) {
                const entries = performance.getEntriesByType('resource') || [];
                for (let i = entries.length - 1; i >= 0; i--) {
                    const entry = entries[i];
                    const name = entry && entry.name;
                    if (!name) continue;
                    // SPA 切视频后 performance 里仍有上一支视频的资源，按页面切换时间过滤
                    if (pageKeyStartedAt > 0 && Number(entry.startTime) > 0 &&
                        Number(entry.startTime) < pageKeyStartedAt - 1500) {
                        continue;
                    }
                    add(name);
                }
            }
        } catch (e) { /* ignore */ }

        try {
            const scripts = document.querySelectorAll('script');
            scripts.forEach(script => {
                const content = script.textContent;
                if (!content) return;
                const matches = content.match(/https?:\/\/[^\s"']*(?:subtitle|ai_subtitle)[^\s"']*auth_key=[^\s"']*/g);
                if (matches) matches.forEach(add);
            });
        } catch (e) { /* ignore */ }

        return result;
    }

    // ================================================================
    //  B 站：视频信息
    // ================================================================
    function getPageState() {
        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow.__INITIAL_STATE__) {
                return unsafeWindow.__INITIAL_STATE__;
            }
        } catch (e) { /* ignore */ }
        try {
            return window.__INITIAL_STATE__ || null;
        } catch (e) {
            return null;
        }
    }

    function getVideoContext() {
        const ctx = { bvid: '', aid: '', cid: '', epId: '', stateTitle: '', stateAuthor: '' };
        const state = getPageState();
        const p = parseInt(new URLSearchParams(location.search).get('p') || '1', 10) || 1;

        // URL 中的标识优先，避免番剧切集 / 多 P 切换后 __INITIAL_STATE__ 残留旧数据
        const bvidMatch = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
        if (bvidMatch) ctx.bvid = bvidMatch[1];

        const epMatch = location.pathname.match(/\/bangumi\/play\/ep(\d+)/);
        if (epMatch) ctx.epId = epMatch[1];
        if (!ctx.epId) {
            const epQuery = new URLSearchParams(location.search).get('ep_id');
            if (epQuery && /^\d+$/.test(epQuery)) ctx.epId = epQuery;
        }

        try {
            const vd = state && state.videoData;
            const sameVideo = vd && (!ctx.bvid || !vd.bvid || vd.bvid === ctx.bvid);
            if (vd && sameVideo) {
                ctx.bvid = ctx.bvid || vd.bvid || '';
                ctx.aid = vd.aid || '';
                const pages = Array.isArray(vd.pages) ? vd.pages : [];
                const page = pages.find(item => Number(item.page) === p) || pages[0];
                ctx.cid = (page && page.cid) || vd.cid || '';
                ctx.stateTitle = vd.title || '';
                ctx.stateAuthor = (vd.owner && vd.owner.name) || '';
                if (page && page.part && pages.length > 1) {
                    ctx.stateTitle = `${ctx.stateTitle} - P${page.page} ${page.part}`;
                }
            }
        } catch (e) { /* ignore */ }

        try {
            const ep = state && state.epInfo;
            const sameEpisode = ep && (!ctx.epId || !ep.id || String(ep.id) === ctx.epId);
            if (ep && sameEpisode) {
                ctx.bvid = ctx.bvid || ep.bvid || '';
                ctx.aid = ctx.aid || ep.aid || '';
                ctx.cid = ctx.cid || ep.cid || '';
                const media = (state && state.mediaInfo) || {};
                const epTitle = ep.title || ep.long_title || '';
                const mediaTitle = media.title || '';
                if (!ctx.stateTitle) {
                    ctx.stateTitle = (mediaTitle && epTitle)
                        ? `${mediaTitle} - ${epTitle}`
                        : (mediaTitle || epTitle);
                }
                ctx.stateAuthor = ctx.stateAuthor ||
                    (media.upInfo && media.upInfo.uname) ||
                    (ep.upInfo && ep.upInfo.uname) || '';
            }
        } catch (e) { /* ignore */ }

        return ctx;
    }

    function getMediaMetadata(ctx) {
        const pickText = (selectors) => {
            for (const selector of selectors) {
                try {
                    const el = document.querySelector(selector);
                    const text = el && el.textContent ? el.textContent.trim() : '';
                    if (text) return text;
                } catch (e) { /* ignore */ }
            }
            return '';
        };

        let rawTitle = '';
        try { rawTitle = document.title || ''; } catch (e) { /* ignore */ }
        let title = rawTitle.replace(/(_|-)\s*哔哩哔哩.*/, '').trim();

        const mainTitle = pickText(['h1.video-title', '.media-info-title-t', '.video-title']);
        const activePart = pickText([
            '.video-pod__item.is-active .title',
            '.list-box li.on .part',
            '.ep-item.cursor'
        ]);

        if (mainTitle) {
            if (activePart && !mainTitle.includes(activePart)) {
                title = `${mainTitle}_${activePart}`;
            } else if (!activePart && ctx.stateTitle && ctx.stateTitle.length > mainTitle.length) {
                // 番剧/多 P 的选集标题通常比页面主标题更完整
                title = ctx.stateTitle;
            } else {
                title = mainTitle;
            }
        } else if (ctx.stateTitle) {
            title = ctx.stateTitle;
        }

        if (!title || title === 'bilibili' || title === '哔哩哔哩') {
            title = ctx.stateTitle || '未知视频';
        }

        let author = pickText(['.up-name', '.username', '.staff-name', '.up-info--name', '.upname']);
        if (!author) author = ctx.stateAuthor || '';

        return {
            title: title.trim(),
            author: author.trim(),
            url: location.href.split('#')[0]
        };
    }

    // ================================================================
    //  B 站：字幕获取
    // ================================================================
    function gmFetchText(url, timeout = 12000) {
        return new Promise((resolve, reject) => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: timeout,
                    onload: (response) => {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(response.responseText || '');
                        } else {
                            reject(new Error(`HTTP ${response.status}`));
                        }
                    },
                    onerror: () => reject(new Error('网络请求失败')),
                    ontimeout: () => reject(new Error('网络请求超时'))
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    async function gmFetchJson(url, timeout = 12000) {
        const text = await gmFetchText(url, timeout);
        return JSON.parse(String(text).replace(/^\uFEFF/, ''));
    }

    function isMusicOnlyText(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return true;

        const lines = trimmed.split(/\n+/).map(line => line.trim()).filter(Boolean);
        if (!lines.length) return true;

        // “♪ 音乐 ♪”“[音效]”这类纯音乐/音效轨没有总结价值
        return lines.every(line =>
            /^[♪♫\s\[\]()（）]*(?:音乐|音效|music|sound)[♪♫\s\[\]()（）]*$/i.test(line)
        );
    }

    function transcriptScore(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed || isMusicOnlyText(trimmed)) return 0;
        return trimmed.length;
    }

    function pickBestTranscript(candidates) {
        let best = '';
        let bestScore = 0;
        for (const text of candidates) {
            const score = transcriptScore(text);
            if (score > bestScore) {
                best = text;
                bestScore = score;
            }
        }
        return best;
    }

    function pickSubtitleCandidates(subtitles) {
        const list = Array.isArray(subtitles)
            ? subtitles.filter(item => item && item.subtitle_url)
            : [];
        if (!list.length) return [];

        const lanOf = item => String(item.lan || '').toLowerCase();
        const zh = list.filter(item => lanOf(item).includes('zh'));
        const en = list.filter(item => lanOf(item).startsWith('en'));
        const pool = zh.length ? zh : (en.length ? en : list);

        // 同一语言下可能同时有“正文”和“音乐”两条 AI 轨道，全部拉下来按内容选
        return pool.slice(0, 6);
    }

    async function resolveVideoIds(ctx, force = false) {
        if (!ctx || !ctx.bvid) return ctx;
        if (!force && ctx.aid && ctx.cid) return ctx;

        try {
            const view = await gmFetchJson(
                `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(ctx.bvid)}`,
                8000
            );
            const data = view && view.data;
            if (data) {
                ctx.aid = data.aid || ctx.aid || '';
                const p = parseInt(new URLSearchParams(location.search).get('p') || '1', 10) || 1;
                const pages = Array.isArray(data.pages) ? data.pages : [];
                const page = pages.find(item => Number(item.page) === p) || pages[0];
                ctx.cid = (page && page.cid) || data.cid || ctx.cid || '';
                if (!ctx.stateTitle) ctx.stateTitle = data.title || '';
                if (!ctx.stateAuthor) ctx.stateAuthor = (data.owner && data.owner.name) || '';
            }
        } catch (e) { /* 网络失败时保留原 ctx */ }
        return ctx;
    }

    async function tryGetSubtitleFromApi(ctx) {
        const apiUrls = [];

        // 番剧优先用 ep_id：切集后 URL 才是最新标识
        if (ctx.epId) {
            apiUrls.push(`https://api.bilibili.com/x/player/v2?ep_id=${encodeURIComponent(ctx.epId)}`);
            apiUrls.push(`https://api.bilibili.com/x/player/wbi/v2?ep_id=${encodeURIComponent(ctx.epId)}`);
        }

        // 播放器当前实际使用的字幕列表接口（需要登录态，返回 JSON 时可直接拿到 subtitle_url）
        if (ctx.aid) {
            const contextExt = encodeURIComponent(JSON.stringify({ video_type: 1 }));
            apiUrls.push(
                `https://api.bilibili.com/x/v2/subtitle/web/view?oid=${encodeURIComponent(ctx.aid)}` +
                `&pid=${encodeURIComponent(ctx.aid)}&context_ext=${contextExt}` +
                `&type=1&cur_production_type=0&preferred_language=ai-zh&playlist_switch=0`
            );
        }

        if (ctx.bvid) {
            // __INITIAL_STATE__ 偶尔拿不到 cid，用 view 接口补一下
            if (!ctx.cid) {
                try {
                    const view = await gmFetchJson(
                        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(ctx.bvid)}`,
                        8000
                    );
                    const data = view && view.data;
                    if (data) {
                        ctx.aid = ctx.aid || data.aid || '';
                        const p = parseInt(new URLSearchParams(location.search).get('p') || '1', 10) || 1;
                        const pages = Array.isArray(data.pages) ? data.pages : [];
                        const page = pages.find(item => Number(item.page) === p) || pages[0];
                        ctx.cid = (page && page.cid) || data.cid || '';
                        if (!ctx.stateTitle) ctx.stateTitle = data.title || '';
                        if (!ctx.stateAuthor) ctx.stateAuthor = (data.owner && data.owner.name) || '';
                    }
                } catch (e) { /* ignore */ }
            }

            if (ctx.cid) {
                apiUrls.push(`https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(ctx.bvid)}&cid=${encodeURIComponent(ctx.cid)}`);
                apiUrls.push(`https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(ctx.bvid)}&cid=${encodeURIComponent(ctx.cid)}`);
            }
        }

        let bestOverall = '';
        let bestOverallScore = 0;

        for (const apiUrl of apiUrls) {
            try {
                const json = await gmFetchJson(apiUrl, 8000);
                const subtitles = json && json.data && json.data.subtitle && json.data.subtitle.subtitles;
                if (!Array.isArray(subtitles) || !subtitles.length) continue;

                const candidates = pickSubtitleCandidates(subtitles);
                const contents = [];

                for (const track of candidates) {
                    if (!track.subtitle_url) continue;
                    if (!isSubtitleUrlForCurrentVideo(track.subtitle_url, ctx)) {
                        console.warn('[视频AI] 跳过非当前视频的字幕轨道:', track.subtitle_url.split('?')[0]);
                        continue;
                    }
                    // 先记下来：即使下载失败，错误提示和缓存重试也能用上
                    recordSubtitleUrl(track.subtitle_url);
                    try {
                        const content = await fetchSubtitleContent(track.subtitle_url);
                        if (content) contents.push(content);
                    } catch (e) { /* 试下一条轨道 */ }
                }

                const best = pickBestTranscript(contents);
                const score = transcriptScore(best);
                if (score > bestOverallScore) {
                    bestOverall = best;
                    bestOverallScore = score;
                }
                // 已经拿到像样的正文，就不必再试后面的接口
                if (score >= 200) return best;
            } catch (e) { /* 尝试下一个接口 */ }
        }

        return bestOverall;
    }

    async function fetchSubtitleContent(url) {
        let fullUrl = String(url || '');
        if (fullUrl.startsWith('//')) fullUrl = 'https:' + fullUrl;
        if (!/^https?:\/\//i.test(fullUrl)) return '';

        // 优先用页面自己的 fetch：播放器已经成功请求过这个地址，
        // 走页面上下文既带 Referer/Cookie，也不受 Tampermonkey @connect 限制。
        try {
            const pageFetch = (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.fetch === 'function')
                ? unsafeWindow.fetch.bind(unsafeWindow)
                : null;
            if (pageFetch) {
                const response = await pageFetch(fullUrl, { credentials: 'include' });
                if (response && response.ok) {
                    const text = await response.text();
                    const data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
                    return jsonToTxt(data);
                }
            }
        } catch (e) { /* CORS / 权限问题，回退 GM_xmlhttpRequest */ }

        const text = await gmFetchText(fullUrl, 12000);
        const data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
        return jsonToTxt(data);
    }

    function jsonToTxt(subtitleData) {
        let body = null;

        if (subtitleData && Array.isArray(subtitleData.body)) {
            body = subtitleData.body;
        } else if (subtitleData && subtitleData.data && Array.isArray(subtitleData.data.body)) {
            body = subtitleData.data.body;
        }

        if (!body) throw new Error('字幕数据格式异常');

        const lines = [];
        let last = '';
        body.forEach(item => {
            const line = String((item && item.content) || '').trim();
            if (!line || line === last) return;
            lines.push(line);
            last = line;
        });
        return lines.join('\n');
    }

    // 兜底：从已拦截的地址里抓；字幕列表响应可能比点击稍晚，做几次短暂重试
    async function getSubtitleFromCache(ctx, retries = 2) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            const urls = getSubtitleUrls()
                .filter(url => isSubtitleUrlForCurrentVideo(url, ctx))
                .slice(0, 6);
            if (urls.length) {
                const contents = await Promise.all(urls.map(async url => {
                    try {
                        return await fetchSubtitleContent(url);
                    } catch (e) {
                        return '';
                    }
                }));
                const best = pickBestTranscript(contents);
                if (best) return best;
            }
            if (attempt < retries) await sleep(250);
        }
        return '';
    }

    // ================================================================
    //  B 站：主流程
    // ================================================================
    function buildPayload(meta, transcript) {
        const metaLines = [
            `【视频标题】：${meta.title || '未知视频'}`,
            `【视频链接】：${meta.url}`
        ];
        if (meta.author) metaLines.push(`【UP主】：${meta.author}`);

        return `${SUMMARY_PROMPT}\n\n${metaLines.join('\n')}\n\n--- 视频字幕 ---\n${transcript.trim()}`;
    }

    async function triggerSummary() {
        if (isRunning) return;
        isRunning = true;
        syncPageKey();
        setButtonState('loading');
        showInfoBar('正在抓取字幕，请稍候...', 'info', 0);

        try {
            const provider = getSelectedProvider();
            if (!provider) throw new Error('未选择 AI 模型');

            const ctx = getVideoContext();

            // 关键：先按当前 URL 的 bvid 解析出正确的 aid/cid，避免 SPA 切换后沿用上一支视频的 ID
            if (!ctx.epId) {
                await resolveVideoIds(ctx, true).catch(() => {});
            }

            // API 与拦截缓存同时尝试，优先用 API 的结果
            const apiTask = tryGetSubtitleFromApi(ctx).catch(() => '');
            const cacheTask = getSubtitleFromCache(ctx).catch(() => '');

            const apiText = await apiTask;
            const cacheText = apiText ? '' : await cacheTask;
            const transcript = apiText || cacheText;

            const candidateUrls = getSubtitleUrls();
            const matchingUrls = candidateUrls.filter(url => isSubtitleUrlForCurrentVideo(url, ctx));
            const excludedUrls = candidateUrls.filter(url => !isSubtitleUrlForCurrentVideo(url, ctx));
            console.info('[视频AI] 字幕候选:', matchingUrls.map(url => url.split('?')[0]),
                '| 排除非当前视频:', excludedUrls.map(url => url.split('?')[0]),
                '| API 长度:', apiText.length, '| 缓存长度:', cacheText.length);

            if (!transcript || !transcript.trim()) {
                if (matchingUrls.length > 0) {
                    throw new Error(`找到了 ${matchingUrls.length} 条当前视频的字幕地址，但下载失败（可能已过期）：请重新切换一次字幕再试`);
                }
                if (excludedUrls.length > 0) {
                    throw new Error('只找到了其他视频的字幕地址，已自动排除。请在播放器里重新切换一次当前视频的字幕再试');
                }
                throw new Error('未抓取到字幕：请先在播放器底部打开/切换一次字幕，再点总结');
            }

            const trimmedTranscript = transcript.trim();
            if (transcriptScore(trimmedTranscript) === 0) {
                throw new Error('抓到的字幕只有音乐/音效标记，请在播放器底部切换一次“中文”字幕再试');
            }
            if (trimmedTranscript.length < 20) {
                console.info('[视频AI] 字幕较短（' + trimmedTranscript.length + ' 字），仍继续发送');
            }

            const meta = getMediaMetadata(ctx);
            const payload = buildPayload(meta, trimmedTranscript);

            // 1. 存入油猴存储，带上时间戳和模型 id，供新标签页一次性消费
            GM_setValue(TASK_KEYS.bilibili, {
                content: payload,
                timestamp: Date.now(),
                provider: provider.id,
                source: 'bilibili'
            });

            // 2. 剪贴板备份，自动填充失败时还能手动粘贴
            try {
                if (typeof GM_setClipboard === 'function') GM_setClipboard(payload, 'text');
            } catch (e) { /* ignore */ }

            // 3. 给存储一点点同步时间，然后打开新标签页（当前页面保持不变）
            await sleep(120);
            openProviderTab(provider);

            showInfoBar('已打开 ' + provider.name + ' 新标签页，正在自动填入并发送...', 'success', 4000);
            setButtonState('done');
            setTimeout(() => setButtonState('idle'), 2500);
        } catch (err) {
            showInfoBar((err && err.message) ? err.message : String(err), 'error', 6000);
            setButtonState('idle');
        } finally {
            isRunning = false;
        }
    }

    // ================================================================
    //  B 站：界面
    // ================================================================
    function addGlobalStyles() {
        if (document.getElementById('bili-ai-summary-style')) return;
        const style = document.createElement('style');
        style.id = 'bili-ai-summary-style';
        style.textContent = `
            .bilibili-ai-summary-infobar {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                max-width: 80vw;
                background-color: rgba(25, 26, 27, 0.98);
                border-radius: 8px;
                padding: 12px 18px;
                color: #fff;
                font-size: 14px;
                line-height: 1.5;
                z-index: 2147483647;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
                transition: all 0.3s ease;
                pointer-events: none;
            }
            .bilibili-ai-summary-infobar.info { border-left: 4px solid #00a1d6; }
            .bilibili-ai-summary-infobar.success { border-left: 4px solid #52c41a; }
            .bilibili-ai-summary-infobar.error { border-left: 4px solid #f5222d; }

            .bpx-player-ai-summary-wrap {
                position: absolute;
                top: 16px;
                right: 20px;
                z-index: 80;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .bpx-player-ai-summary-btn {
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
            .bpx-player-ai-summary-btn:hover {
                background: rgba(0, 161, 214, 0.85);
                border-color: #00a1d6;
                transform: scale(1.05);
                box-shadow: 0 4px 15px rgba(0, 161, 214, 0.4);
            }
            .bpx-player-ai-summary-btn:disabled {
                cursor: not-allowed;
                opacity: 0.75;
                transform: none;
                box-shadow: none;
            }

            .video-ai-summary-select {
                background: rgba(0, 0, 0, 0.65);
                color: #fff;
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 16px;
                padding: 5px 8px;
                font-size: 12px;
                line-height: 1.4;
                cursor: pointer;
                outline: none;
                max-width: 110px;
                backdrop-filter: blur(8px);
            }
            .video-ai-summary-select:hover { border-color: #00a1d6; }
            .video-ai-summary-select option { color: #000; background: #fff; }

            #yt-ai-summary-wrap {
                position: absolute;
                top: 20px;
                right: 20px;
                z-index: 6000;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            #yt-ai-summary-btn {
                padding: 8px 14px;
                background: linear-gradient(135deg, rgba(102,126,234,0.9) 0%, rgba(118,75,162,0.9) 100%);
                color: #fff;
                border: none;
                border-radius: 20px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                transition: transform 0.2s, background 0.2s;
                backdrop-filter: blur(4px);
            }
            #yt-ai-summary-btn:hover {
                transform: scale(1.05);
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            #yt-ai-summary-btn:disabled {
                background: #999;
                cursor: not-allowed;
                transform: none;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showInfoBar(message, type = 'info', duration = 3000) {
        const existing = document.querySelector('.bilibili-ai-summary-infobar');
        if (existing) existing.remove();

        const infoBar = document.createElement('div');
        infoBar.className = `bilibili-ai-summary-infobar ${type}`;
        infoBar.textContent = message;
        (document.body || document.documentElement).appendChild(infoBar);

        if (duration > 0) {
            setTimeout(() => {
                if (infoBar.parentNode) infoBar.remove();
            }, duration);
        }
    }

    function setButtonState(state) {
        if (!summaryButton) return;

        if (state === 'loading') {
            summaryButton.disabled = true;
            summaryButton.textContent = '⏳ 抓取字幕...';
        } else if (state === 'done') {
            summaryButton.disabled = true;
            summaryButton.textContent = '✅ 已打开新标签页';
        } else {
            summaryButton.disabled = false;
            summaryButton.textContent = '✨ AI 总结';
        }
    }

    function mountButton() {
        const container = document.querySelector('#bilibili-player') ||
            document.querySelector('.bpx-player-container') ||
            document.querySelector('.bilibili-player-area');

        if (!container) return;

        if (!summaryWrap) {
            summaryWrap = document.createElement('div');
            summaryWrap.className = 'bpx-player-ai-summary-wrap';

            summaryButton = document.createElement('button');
            summaryButton.type = 'button';
            summaryButton.className = 'bpx-player-ai-summary-btn';
            summaryButton.textContent = '✨ AI 总结';
            summaryButton.title = '抓取字幕，并在新标签页打开所选 AI 总结';
            summaryButton.addEventListener('click', (event) => {
                event.stopPropagation();
                event.preventDefault();
                triggerSummary();
            });

            providerSelect = createProviderSelect(getSelectedProvider().id, (id) => {
                setSelectedProvider(id);
                console.info('[视频AI] 已切换模型:', getSelectedProvider().name);
            });

            summaryWrap.appendChild(summaryButton);
            summaryWrap.appendChild(providerSelect);
        }

        // 其他标签页改了模型时，顺手同步下拉框（用户正在操作时不打断）
        if (providerSelect && document.activeElement !== providerSelect) {
            const selectedId = getSelectedProvider().id;
            if (providerSelect.value !== selectedId) providerSelect.value = selectedId;
        }

        if (!container.contains(summaryWrap)) {
            container.appendChild(summaryWrap);
        }

        // 清理旧单模型脚本可能残留的按钮，避免同时出现两个
        container.querySelectorAll('.bpx-player-ai-summary-btn').forEach(btn => {
            if (!summaryWrap.contains(btn)) btn.remove();
        });
    }

    // 页面地址变化时清空上一支视频/上一集的字幕缓存
    function syncPageKey() {
        const key = location.pathname + location.search;
        if (key === lastPageKey) return false;
        lastPageKey = key;
        pageKeyStartedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
        interceptedSubtitleUrls = [];
        return true;
    }

    function runBilibili() {
        addGlobalStyles();

        lastPageKey = location.pathname + location.search;
        // 首次加载不过滤 performance 记录；SPA 切页时才记录切换时间
        pageKeyStartedAt = 0;
        setInterval(() => {
            if (syncPageKey()) setButtonState('idle');
        }, 800);

        mountButton();
        setInterval(mountButton, 1000);
    }

    // ================================================================
    //  YouTube：界面 + 字幕抓取
    // ================================================================
    let ytWrap = null;
    let ytButton = null;
    let ytSelect = null;
    let ytRunning = false;

    function runYouTube() {
        // 修复 YouTube Trusted Types
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
            try {
                window.trustedTypes.createPolicy('default', {
                    createHTML: (value) => value,
                    createScriptURL: (value) => value,
                    createScript: (value) => value
                });
            } catch (e) { /* 已存在则忽略 */ }
        }

        addGlobalStyles();

        function createWrap() {
            ytWrap = document.createElement('div');
            ytWrap.id = 'yt-ai-summary-wrap';

            ytButton = document.createElement('button');
            ytButton.id = 'yt-ai-summary-btn';
            ytButton.type = 'button';
            ytButton.textContent = '✨ AI 总结';
            ytButton.title = '抓取字幕，并在新标签页打开所选 AI 总结';
            ytButton.addEventListener('click', onYouTubeClick);

            ytSelect = createProviderSelect(getSelectedProvider().id, (id) => {
                setSelectedProvider(id);
                console.info('[视频AI] 已切换模型:', getSelectedProvider().name);
            });
            ytSelect.id = 'yt-ai-summary-select';

            ytWrap.appendChild(ytButton);
            ytWrap.appendChild(ytSelect);
        }

        async function onYouTubeClick() {
            if (ytRunning) return;
            ytRunning = true;
            setYouTubeButtonState('loading');

            try {
                const provider = getSelectedProvider();
                const transcript = await getYouTubeTranscript();
                if (!transcript || !transcript.trim()) {
                    throw new Error('字幕内容为空。');
                }

                let title = document.title || '';
                title = title.replace(/\s*-\s*YouTube\s*$/, '').trim();

                const payload = SUMMARY_PROMPT +
                    '\n\n【视频标题】：' + title +
                    '\n【视频链接】：' + location.href.split('#')[0] +
                    '\n\n--- 视频字幕 ---\n' + transcript.trim();

                GM_setValue(TASK_KEYS.youtube, {
                    content: payload,
                    timestamp: Date.now(),
                    provider: provider.id,
                    source: 'youtube'
                });

                try {
                    if (typeof GM_setClipboard === 'function') GM_setClipboard(payload, 'text');
                } catch (e) { /* ignore */ }

                await sleep(120);
                openProviderTab(provider);

                setYouTubeButtonState('done');
                setTimeout(() => setYouTubeButtonState('idle'), 2500);
            } catch (err) {
                alert('抓取失败：' + ((err && err.message) ? err.message : String(err)));
                setYouTubeButtonState('idle');
            } finally {
                ytRunning = false;
            }
        }

        function setYouTubeButtonState(state) {
            if (!ytButton) return;
            if (state === 'loading') {
                ytButton.disabled = true;
                ytButton.textContent = '⏳ 抓取字幕...';
            } else if (state === 'done') {
                ytButton.disabled = true;
                ytButton.textContent = '✅ 已打开新标签页';
            } else {
                ytButton.disabled = false;
                ytButton.textContent = '✨ AI 总结';
            }
        }

        function mountYouTubeButton() {
            const player = document.getElementById('movie_player');
            if (!player) {
                if (ytWrap && ytWrap.parentNode) ytWrap.remove();
                return;
            }

            if (!ytWrap) createWrap();

            // 其他标签页改了模型时同步下拉框
            if (ytSelect && document.activeElement !== ytSelect) {
                const selectedId = getSelectedProvider().id;
                if (ytSelect.value !== selectedId) ytSelect.value = selectedId;
            }

            if (!player.contains(ytWrap)) player.appendChild(ytWrap);

            // 清理旧单模型脚本可能残留的按钮，避免重复
            document.querySelectorAll('#yt-ai-summary-btn').forEach(btn => {
                if (!ytWrap.contains(btn)) btn.remove();
            });
        }

        mountYouTubeButton();
        document.addEventListener('yt-navigate-finish', mountYouTubeButton);
        setInterval(mountYouTubeButton, 2000);

        async function getYouTubeTranscript() {
            let playerResponse = null;
            const moviePlayer = document.getElementById('movie_player');
            if (moviePlayer && typeof moviePlayer.getPlayerResponse === 'function') {
                try { playerResponse = moviePlayer.getPlayerResponse(); } catch (e) { /* ignore */ }
            }
            if (!playerResponse) playerResponse = window.ytInitialPlayerResponse;
            if (!playerResponse || !playerResponse.captions) {
                throw new Error('当前视频没有字幕。');
            }

            const tracks = playerResponse.captions.playerCaptionsTracklistRenderer?.captionTracks;
            if (!tracks || tracks.length === 0) throw new Error('当前视频没有字幕轨道。');

            let track = tracks.find(t => t.languageCode === 'zh' || t.languageCode === 'zh-Hans');
            if (!track) track = tracks.find(t => t.languageCode === 'en');
            if (!track) track = tracks[0];

            const baseUrl = track.baseUrl;
            if (!baseUrl) throw new Error('无法获取字幕 URL。');

            const isPoTokenGated = /[?&]exp=xpe\b/.test(baseUrl) && !/[?&]pot=/.test(baseUrl);

            if (!isPoTokenGated) {
                try {
                    const resp = await fetch(baseUrl + '&fmt=json3', { credentials: 'include' });
                    if (resp.ok) {
                        const text = await resp.text();
                        if (text && text.trim().length > 0) return parseYouTubeTranscript(text);
                    }
                } catch (e) { /* 回退到 DOM */ }
            }
            return await scrapeYouTubeTranscriptFromDOM();
        }

        function parseYouTubeTranscript(text) {
            try {
                const data = JSON.parse(text);
                if (data.events) {
                    return data.events
                        .filter(event => event.segs)
                        .map(event => event.segs.map(seg => seg.utf8).join(''))
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                }
            } catch (e) { /* ignore */ }
            return String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }

        async function scrapeYouTubeTranscriptFromDOM() {
            const transcriptBtn = document.querySelector(
                'button[aria-label*="transcript" i], button[aria-label*="字幕" i]'
            );
            if (transcriptBtn) {
                transcriptBtn.click();
            } else {
                const moreBtn = document.querySelector(
                    'button[aria-label*="更多" i], button[aria-label*="More" i]'
                );
                if (moreBtn) {
                    moreBtn.click();
                    await sleep(500);
                    const items = document.querySelectorAll('ytd-menu-service-item-renderer');
                    for (const item of items) {
                        if (item.textContent.includes('字幕') || item.textContent.toLowerCase().includes('transcript')) {
                            item.click();
                            break;
                        }
                    }
                }
            }

            await sleep(2000);
            const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
            if (segments.length === 0) {
                throw new Error('无法抓取字幕，请确认视频包含字幕。');
            }
            return Array.from(segments)
                .map(segment => {
                    const textEl = segment.querySelector('.segment-text, yt-formatted-string');
                    return textEl ? textEl.textContent.trim() : '';
                })
                .filter(Boolean)
                .join(' ');
        }
    }

    // ================================================================
    //  AI 模型页面：自动填入并发送
    // ================================================================
    function normalizeTask(raw, providerId) {
        if (!raw) return null;
        if (typeof raw === 'string') {
            return { content: raw, timestamp: Date.now(), provider: providerId };
        }
        if (raw && raw.content) return raw;
        return null;
    }

    function findTaskForProvider(provider) {
        const matches = [];

        Object.values(TASK_KEYS).forEach(key => {
            let raw = null;
            try { raw = GM_getValue(key, null); } catch (e) { return; }

            const task = normalizeTask(raw, provider.id);
            if (!task) return;

            // 任务指定了别的模型：保留给目标页面，不在这里消费
            if (task.provider && task.provider !== provider.id) return;

            const timestamp = Number(task.timestamp) || 0;
            if (!timestamp || Date.now() - timestamp > TASK_TTL) {
                try { GM_deleteValue(key); } catch (e) { /* ignore */ }
                return;
            }

            matches.push({ key, task });
        });

        // B站和 YouTube 同时有待发送任务时，优先最新的
        matches.sort((a, b) => (Number(b.task.timestamp) || 0) - (Number(a.task.timestamp) || 0));
        return matches[0] || null;
    }

    function runProviderPage(provider) {
        const pending = findTaskForProvider(provider);
        if (!pending) return;

        const { key, task } = pending;
        console.info('[视频AI] 检测到任务:', provider.name, '长度:', task.content.length);

        waitForProviderInput(provider, 20000).then(input => {
            if (!input) {
                console.warn('[视频AI] 未找到输入框:', provider.name);
                try {
                    alert('未能自动填入 ' + provider.name + '：输入框加载失败。总结内容已复制到剪贴板，请手动粘贴发送。');
                } catch (e) { /* ignore */ }
                return;
            }

            // 页面可能发生过跳转/重载，填入前重新确认任务还在
            let latestRaw = null;
            try { latestRaw = GM_getValue(key, null); } catch (e) { latestRaw = null; }

            const latestTask = normalizeTask(latestRaw, provider.id);
            if (!latestTask || !latestTask.content) return;
            if (latestTask.provider && latestTask.provider !== provider.id) return;
            if (latestTask.content !== task.content) return;

            const latestTimestamp = Number(latestTask.timestamp) || 0;
            if (!latestTimestamp || Date.now() - latestTimestamp > TASK_TTL) {
                try { GM_deleteValue(key); } catch (e) { /* ignore */ }
                return;
            }

            // 一次性消费
            try { GM_deleteValue(key); } catch (e) { /* ignore */ }
            setTimeout(() => fillAndSendProvider(provider, input, latestTask.content), 600);
        });
    }

    function isElementVisible(node) {
        if (!node) return false;
        if (node.disabled) return false;
        if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return false;

        const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;

        if (node.offsetParent !== null) return true;

        try {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch (e) {
            return false;
        }
    }

    function pickVisible(nodes) {
        return Array.from(nodes || []).find(node => isElementVisible(node)) || null;
    }

    function findProviderInput(provider) {
        for (const selector of provider.inputSelectors || []) {
            try {
                const picked = pickVisible(document.querySelectorAll(selector));
                if (picked) return picked;
            } catch (e) { /* ignore */ }
        }

        const generic = [
            ...document.querySelectorAll('textarea'),
            ...document.querySelectorAll('[contenteditable="true"]'),
            ...document.querySelectorAll('[role="textbox"]')
        ];
        return pickVisible(generic);
    }

    function waitForProviderInput(provider, timeout = 20000) {
        return new Promise(resolve => {
            const existing = findProviderInput(provider);
            if (existing) {
                resolve(existing);
                return;
            }

            let done = false;
            let timer = null;

            const finish = (element) => {
                if (done) return;
                done = true;
                try { observer.disconnect(); } catch (e) { /* ignore */ }
                if (timer) clearTimeout(timer);
                resolve(element);
            };

            const observer = new MutationObserver(() => {
                const element = findProviderInput(provider);
                if (element) finish(element);
            });

            if (document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
            }

            timer = setTimeout(() => finish(findProviderInput(provider)), timeout);
        });
    }

    function fillProviderInput(input, text) {
        input.focus();

        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            const proto = input.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(input, text);
            else input.value = text;

            input.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: text
            }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            if (input.setSelectionRange) input.setSelectionRange(text.length, text.length);
            return;
        }

        // contenteditable / ProseMirror
        let inserted = false;
        try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(input);
            selection.removeAllRanges();
            selection.addRange(range);
            inserted = document.execCommand('insertText', false, text);
        } catch (e) {
            inserted = false;
        }

        if (!inserted || !(input.textContent || '').trim()) {
            try {
                const dataTransfer = new DataTransfer();
                dataTransfer.setData('text/plain', text);
                input.dispatchEvent(new ClipboardEvent('paste', {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: dataTransfer
                }));
            } catch (e) { /* ignore */ }
        }

        if (!(input.textContent || '').trim()) {
            try {
                input.innerText = text;
                if (!(input.textContent || '').trim()) input.textContent = text;
            } catch (e) {
                input.textContent = text;
            }
        }

        input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text
        }));
    }

    function findProviderSendButton(provider) {
        for (const selector of provider.sendSelectors || []) {
            try {
                const picked = pickVisible(document.querySelectorAll(selector));
                if (picked && picked.getAttribute('aria-disabled') !== 'true') return picked;
            } catch (e) { /* ignore */ }
        }

        const generic = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const node of generic) {
            if (node.disabled || node.getAttribute('aria-disabled') === 'true') continue;
            if (!isElementVisible(node)) continue;
            const label = (
                (node.getAttribute('aria-label') || '') + ' ' +
                (node.getAttribute('title') || '') + ' ' +
                (node.textContent || '')
            ).toLowerCase();
            if (/发送|send|submit/.test(label)) return node;
        }
        return null;
    }

    function fillAndSendProvider(provider, input, text) {
        console.info('[视频AI] 开始填充:', provider.name, '长度:', text.length);
        fillProviderInput(input, text);

        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;

            const sendBtn = findProviderSendButton(provider);
            if (sendBtn) {
                clearInterval(timer);
                sendBtn.click();
                console.info('[视频AI] 已点击发送');
                return;
            }

            if (attempts >= 20) {
                clearInterval(timer);
                pressEnter(input);
                console.info('[视频AI] 未找到发送按钮，尝试回车');
            }
        }, 250);
    }

    function pressEnter(input) {
        const options = {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        };
        input.dispatchEvent(new KeyboardEvent('keydown', options));
        input.dispatchEvent(new KeyboardEvent('keypress', options));
        input.dispatchEvent(new KeyboardEvent('keyup', options));
    }

})();
