// ==UserScript==
// @name         网页 AI 总结 (页面内容 → 多模型)
// @namespace    https://github.com/macrochen/my-scripts
// @version      1.1.0
// @author       Macro
// @description  屏幕右侧中间添加悬浮按钮：抓取当前网页正文（Readability + Turndown，做法参考 EasyCopy；有选中内容时优先用选中内容），转成 Markdown 后打开所选 AI（DeepSeek/ChatGPT/Kimi/豆包/千问/元宝）并自动填入提示词、自动发送。
// @match        *://*/*
// @exclude      *://chat.deepseek.com/*
// @exclude      *://chatgpt.com/*
// @exclude      *://chat.openai.com/*
// @exclude      *://*.kimi.com/*
// @exclude      *://kimi.moonshot.cn/*
// @exclude      *://*.doubao.com/*
// @exclude      *://*.qianwen.com/*
// @exclude      *://tongyi.aliyun.com/*
// @exclude      *://yuanbao.tencent.com/*
// @exclude      *://www.google.com/search*
// @exclude      *://accounts.*/*
// @exclude      *://login.*/*
// @exclude      *://*/oauth*
// @exclude      *://*/login*
// @exclude      *://*/signin*
// @exclude      *://*/passport*
// @exclude      *://*/checkout*
// @exclude      *://*/pay*
// @require      https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js
// @require      https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9C%A8%3C/text%3E%3C/svg%3E
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/page-ai-summary.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/page-ai-summary.user.js
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    if (window.top !== window.self) return;

    // ================================================================
    //  配置
    // ================================================================
    const PROVIDER_KEY = 'PAGE_AI_SUMMARY_PROVIDER';
    const AUTOSEND_KEY = 'PAGE_AI_SUMMARY_AUTOSEND';
    const HIDDEN_KEY = 'PAGE_AI_SUMMARY_HIDDEN_SITES';
    const TASK_KEY = 'PAGE_AI_SUMMARY_TASK';
    const TASK_TTL = 5 * 60 * 1000;        // 待发送任务有效期：5 分钟
    const MAX_CONTENT_CHARS = 120000;      // 正文最大字符数，超出截断（约 3~6 万汉字）
    const MIN_CONTENT_CHARS = 30;          // 少于这个字符数认为没抓到内容
    const DEBUG = false;

    // 想新增模型时，只需要在 PROVIDERS 里加一项，并同步加 @exclude / @connect
    const PROVIDERS = [
        {
            id: 'deepseek',
            hosts: ['chat.deepseek.com'],
            name: 'DeepSeek',
            url: 'https://chat.deepseek.com/',
            inputSelectors: ['textarea#chat-input', '#chat-input', 'textarea', 'div[contenteditable="true"]'],
            sendSelectors: [
                'div[role="button"][aria-label*="发送"]',
                'div[role="button"][aria-label*="Send"]',
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                'button[type="submit"]'
            ]
        },
        {
            id: 'chatgpt',
            hosts: ['chatgpt.com', 'chat.openai.com'],
            name: 'ChatGPT',
            url: 'https://chatgpt.com/',
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
            hosts: ['kimi.com', 'www.kimi.com', 'kimi.moonshot.cn'],
            name: 'Kimi',
            url: 'https://www.kimi.com/',
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
            hosts: ['doubao.com', 'www.doubao.com'],
            name: '豆包',
            url: 'https://www.doubao.com/chat/',
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
            hosts: ['qianwen.com', 'www.qianwen.com', 'tongyi.aliyun.com'],
            name: '通义千问',
            url: 'https://www.qianwen.com/',
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
            hosts: ['yuanbao.tencent.com'],
            name: '元宝',
            url: 'https://yuanbao.tencent.com/chat',
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

    // 总结提示词：直接复用「视频 AI 总结」里打磨过的版本
    const SUMMARY_PROMPT = `请把我给定的网页内容总结成一个"读完能记住"的版本。

不是做摘要，是用你自己的话把这个东西重新讲一遍。讲完之后，别人应该能记住核心观点，还能复述出一两个关键细节。

# 怎么写

1. 先找到全文的一条主线。所有内容围绕这条线展开，偏离主线的素材直接扔掉。
2. 沿着主线，挑出几个真正值得记住的点。每个点讲清楚：它在说什么、凭什么值得信。
3. 细节不要全删。有画面感的例子、反常识的事实、作者自己说的原话，如果它能帮人记住观点，就留着。每个重点最多留一个这样的细节，不要贪多。
4. 一段只说一件事。观点是一段，例子是一段，结论是一段。宁可多分段，不要挤成一堵墙。
5. 开头写上标题和原文链接。

# 不要做的事

- 不要加"解释："、"举例："、"关系："、"小结："这类标签。你在讲东西，不是在填表。
- 不要用生硬的栏目标题把内容切成块。可以有结构，但不要让人看到骨架。
- 不要为了工整而凑排比、凑对仗。
- 不要在结尾写"总而言之"然后把前面说过的话再说一遍。
- 不要用这些词："底层逻辑"、"认知升级"、"本质上"（一篇里最多出现1次）、"深度"、"维度"、"赋能"、"颗粒度"。
- 不要用破折号（——）。
- 如果内容明显被截断了，按已给部分总结，不要编造结尾。

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

    // ================================================================
    //  状态
    // ================================================================
    const HOST = location.hostname;
    let fabWrap = null;
    let providerSelect = null;
    let fabButton = null;
    let infoTimer = null;
    let fabState = 'idle';
    let lastClickAt = 0;
    let lastUrl = location.href;

    const INFO_BAR_CSS = `
            .page-ai-summary-infobar {
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
                pointer-events: none;
            }
            .page-ai-summary-infobar.info { border-left: 4px solid #00a1d6; }
            .page-ai-summary-infobar.success { border-left: 4px solid #52c41a; }
            .page-ai-summary-infobar.error { border-left: 4px solid #f5222d; }
        `;

    // ================================================================
    //  通用工具
    // ================================================================
    function log(...args) {
        if (DEBUG) console.info('[网页AI]', ...args);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function whenDomReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    }

    function getProviderById(id) {
        return PROVIDERS.find(p => p.id === id) || PROVIDERS[0];
    }

    // ---------- 设置读写 ----------
    function getSelectedProvider() {
        let id = DEFAULT_PROVIDER_ID;
        try { id = GM_getValue(PROVIDER_KEY, DEFAULT_PROVIDER_ID); } catch (e) { /* ignore */ }
        return getProviderById(id);
    }

    function setSelectedProvider(id) {
        try { GM_setValue(PROVIDER_KEY, id); } catch (e) { /* ignore */ }
    }

    function isAutoSend() {
        try { return GM_getValue(AUTOSEND_KEY, true) !== false; } catch (e) { return true; }
    }

    function setAutoSend(on) {
        try { GM_setValue(AUTOSEND_KEY, !!on); } catch (e) { /* ignore */ }
    }

    function getHiddenSites() {
        try {
            const raw = GM_getValue(HIDDEN_KEY, '');
            return String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
        } catch (e) { return []; }
    }

    function isSiteHidden() {
        return getHiddenSites().includes(HOST);
    }

    function setSiteHidden(hidden) {
        const list = getHiddenSites().filter(h => h !== HOST);
        if (hidden) list.push(HOST);
        try { GM_setValue(HIDDEN_KEY, list.join(',')); } catch (e) { /* ignore */ }
    }

    function notify(title, text) {
        try {
            if (typeof GM_notification === 'function') {
                GM_notification({ title: title, text: text, timeout: 8000 });
                return;
            }
        } catch (e) { /* ignore */ }
        console.info('[网页AI]', title, text);
    }

    function openUrl(url) {
        try {
            if (typeof GM_openInTab === 'function') {
                // 让切回原页面时新标签页仍保留，便于对照原文
                GM_openInTab(url, { active: true, insert: true, setParent: true });
                return;
            }
        } catch (e) {
            log('GM_openInTab 失败，回退 window.open', e);
        }
        window.open(url, '_blank', 'noopener');
    }

    // ────────────────────────────────────────────────────────────────
    //  正文抓取：做法参考 ~/workspace/easycopy/content-script.js
    //  1) 有选区 → 取选区 HTML
    //  2) 否则 → 移除导航/侧栏/广告等噪音 → Readability 提取正文
    //  3) Turndown 转 Markdown（去图片、去链接，保留加粗与换行）
    // ────────────────────────────────────────────────────────────────

    // 站点专属清洗：SPA 站点 Readability 容易抓错，做点兜底
    const SITE_RULES = [
        {
            test: host => /(^|\.)(twitter|x)\.com$/.test(host),
            // Twitter/X：只保留主栏文章，避免把侧栏趋势抓进来
            remove: ['header', 'footer', 'nav', 'aside', '[data-testid="sidebarColumn"]',
                '[data-testid="BottomBar"]', '[role="navigation"]'],
            preProcess: clone => {
                const article = clone.querySelector('article[data-testid="tweet"]') ||
                    clone.querySelector('article');
                if (article) {
                    // 用主推文替换整个 body，避免推荐推文混入
                    const holder = clone.createElement('div');
                    holder.appendChild(article.cloneNode(true));
                    clone.body.innerHTML = '';
                    clone.body.appendChild(holder);
                }
            }
        },
        {
            test: host => /(^|\.)(reddit)\.com$/.test(host),
            remove: ['shreddit-header', 'shreddit-sidebar', '[slot="sidebar"]', 'nav', 'aside']
        },
        {
            test: host => /(^|\.)(weibo)\.com$/.test(host),
            remove: ['.gn_header', '.card-wrap[class*="side"]', 'aside', 'nav', 'footer']
        }
    ];

    // 通用的噪音选择器（与 EasyCopy 一致，并做了少量补充）
    const NOISE_SELECTORS = [
        'header', 'footer', 'nav', 'aside',
        '[data-testid="sidebarColumn"]', '[data-testid="primaryColumn"] > div > div:first-child',
        '.sidebar', '.widget', '.ad', '.ads', '.advertisement', '#right-sidebar', '#left-sidebar',
        'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
        // ARIA 语义明确属于导航/广告/弹窗的块
        '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
        '[role="dialog"]', '[role="alertdialog"]', '[role="toolbar"]',
        '[aria-hidden="true"]'
    ];

    function getSelectionHtml() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return '';
        if (!selection.toString().trim()) return '';
        // 选区横跨整个页面时通常不是用户的真实意图，退回 Readability
        if (selection.toString().trim().length > 200000) return '';

        const container = document.createElement('div');
        for (let i = 0, len = selection.rangeCount; i < len; ++i) {
            container.appendChild(selection.getRangeAt(i).cloneContents());
        }
        return container.innerHTML;
    }

    function getArticleFromReadability() {
        if (typeof Readability !== 'function') {
            throw new Error('Readability 未加载（CDN 可能被拦截），请在油猴设置里检查 @require 是否下载成功');
        }

        const documentClone = document.cloneNode(true);
        const rule = SITE_RULES.find(r => r.test(HOST));

        if (rule && typeof rule.preProcess === 'function') {
            try { rule.preProcess(documentClone); } catch (e) { log('站点预处理失败', e); }
        }

        (rule ? rule.remove || [] : []).concat(NOISE_SELECTORS).forEach(selector => {
            try {
                documentClone.querySelectorAll(selector).forEach(el => el.remove());
            } catch (e) { /* 无效选择器忽略 */ }
        });

        const article = new Readability(documentClone, {
            charThreshold: 200,
            keepClasses: false
        }).parse();

        if (!article || !article.content) {
            throw new Error('无法提取页面正文（可能是动态渲染页面，或正文还没加载完）');
        }
        return article;
    }

    function createTurndown() {
        if (typeof TurndownService !== 'function') {
            throw new Error('Turndown 未加载（CDN 可能被拦截），请在油猴设置里检查 @require 是否下载成功');
        }

        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            bulletListMarker: '-'
        });

        // 识别带有加粗样式的标签（微信公众号等常用方式）
        turndownService.addRule('inlineBold', {
            filter: function (node) {
                return node.nodeType === 1 && node.style && node.style.fontWeight &&
                    (node.style.fontWeight === 'bold' || node.style.fontWeight === 'bolder' ||
                        parseInt(node.style.fontWeight, 10) >= 600) &&
                    node.nodeName !== 'STRONG' && node.nodeName !== 'B' && !/^H[1-6]$/.test(node.nodeName);
            },
            replacement: function (content, node) {
                if (!content.trim()) return content;
                const isBlock = node.nodeName === 'P' || node.nodeName === 'SECTION' || node.nodeName === 'DIV';
                const formatted = '**' + content.trim() + '**';
                return isBlock ? '\n\n' + formatted + '\n\n' : formatted;
            }
        });

        // 过滤图片（避免整篇都是图床链接，浪费 token）
        turndownService.addRule('removeImage', {
            filter: ['img', 'picture', 'figure', 'figcaption'],
            replacement: function () {
                return '';
            }
        });

        // 过滤超链接，只保留文字（同 EasyCopy：去掉后不会剩一堆裸 URL）
        turndownService.addRule('removeLink', {
            filter: ['a'],
            replacement: function (content) {
                return content;
            }
        });

        // div / section 等块级元素在 Markdown 中也能换行
        turndownService.addRule('blockElements', {
            filter: ['div', 'section', 'article', 'main', 'header', 'footer', 'aside'],
            replacement: function (content) {
                if (!content.trim()) return '';
                return '\n\n' + content + '\n\n';
            }
        });

        // 修复 br 换行（富文本和推特里常见）
        turndownService.addRule('br', {
            filter: 'br',
            replacement: function () {
                return '\n\n';
            }
        });

        // 表格：整表转成紧凑的 Markdown 表格（比默认 GFM 输出更省 token）
        turndownService.addRule('table', {
            filter: 'table',
            replacement: function (content, node) {
                const rows = Array.from(node.querySelectorAll('tr'))
                    .map(tr => Array.from(tr.children)
                        .filter(td => /^(TD|TH)$/.test(td.nodeName))
                        .map(td => {
                            // 单元格里的段落/换行压平，避免撑破表格
                            const text = turndownService.turndown(td.innerHTML)
                                .replace(/\|/g, '\\|')
                                .replace(/\s*\n+\s*/g, ' ')
                                .trim();
                            return text || ' ';
                        }))
                    .filter(cells => cells.length > 0);

                if (rows.length === 0) return '';

                const cols = Math.max(...rows.map(r => r.length));
                const line = cells => {
                    const padded = cells.concat(new Array(cols - cells.length).fill(' '));
                    return '| ' + padded.join(' | ') + ' |';
                };

                const out = [line(rows[0]), '|' + new Array(cols).fill(' --- ').join('|') + '|'];
                rows.slice(1).forEach(cells => out.push(line(cells)));
                return '\n\n' + out.join('\n') + '\n\n';
            }
        });

        return turndownService;
    }

    function extractPageContent() {
        let title = (document.title || '').trim();
        let html = getSelectionHtml();
        let fromSelection = false;

        if (html) {
            fromSelection = true;
            // 选区时优先用文章标题（document.title 常带站名后缀）
            try {
                const article = new Readability(document.cloneNode(true)).parse();
                if (article && article.title) title = article.title.trim();
            } catch (e) { /* ignore */ }
        } else {
            const article = getArticleFromReadability();
            if (article.title) title = article.title.trim();
            html = article.content;
        }

        // 动态页面兜底：Readability 失败或内容太少时，退化为 body 文本
        let markdown = createTurndown().turndown(html).trim();
        markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

        if (markdown.length < MIN_CONTENT_CHARS) {
            const fallback = (document.body ? document.body.innerText : '').trim();
            if (fallback.length > markdown.length) {
                markdown = fallback.replace(/\n{3,}/g, '\n\n').trim();
                fromSelection = false;
                log('Readability 结果过短，回退到 innerText');
            }
        }

        if (markdown.length < MIN_CONTENT_CHARS) {
            throw new Error('没有抓到有意义的正文，可以先手动选中一段内容再点按钮');
        }

        let truncated = false;
        if (markdown.length > MAX_CONTENT_CHARS) {
            markdown = markdown.slice(0, MAX_CONTENT_CHARS) + '\n\n[内容过长，以上为前半部分]';
            truncated = true;
        }

        return {
            title: title || document.title || location.hostname,
            url: location.href,
            markdown,
            fromSelection,
            truncated,
            length: markdown.length
        };
    }

    function buildPayload(page) {
        const metaLines = [
            `【网页标题】：${page.title}`,
            `【网页链接】：${page.url}`,
            `【内容来源】：${page.fromSelection ? '用户选中的片段' : '页面正文提取'}${page.truncated ? '（已截断）' : ''}`
        ];
        return `${SUMMARY_PROMPT}\n\n${metaLines.join('\n')}\n\n--- 网页内容 ---\n${page.markdown}`;
    }

    // ────────────────────────────────────────────────────────────────
    //  主流程：抓取 → 存任务 → 打开 AI → 自动填入发送
    // ────────────────────────────────────────────────────────────────
    async function triggerSummary() {
        // 快速连点保护（不是状态锁）：每次点击结束后按钮都会立刻恢复可用
        const now = Date.now();
        if (now - lastClickAt < 800) return;
        lastClickAt = now;

        setFabState('loading');

        try {
            const provider = getSelectedProvider();

            const page = extractPageContent();
            const payload = buildPayload(page);
            log('抓取完成', page.length, page.fromSelection ? '(选区)' : '(正文)');

            // 1. 写入油猴存储，供 AI 页面一次性消费
            try {
                GM_setValue(TASK_KEY, {
                    content: payload,
                    timestamp: Date.now(),
                    provider: provider.id,
                    autoSend: isAutoSend(),
                    title: page.title
                });
            } catch (e) { /* ignore */ }
            // 便于联调：window.__PAGE_AI_SUMMARY_LAST__ 里能看到最近一次提取结果
            try { window.__PAGE_AI_SUMMARY_LAST__ = page; } catch (e) { /* ignore */ }

            // 2. 剪贴板备份：自动填入失败时可以直接粘贴
            try {
                if (typeof GM_setClipboard === 'function') GM_setClipboard(payload, 'text');
            } catch (e) { /* ignore */ }

            // 3. 给存储一点同步时间，再打开新标签页
            await sleep(120);
            openUrl(provider.url);

            showInfoBar(`已提取 ${page.length} 字，正在 ${provider.name} 自动填入${isAutoSend() ? '并发送' : ''}…`, 'success', 4000);
            setFabState('idle');
        } catch (err) {
            const msg = (err && err.message) ? err.message : String(err);
            console.warn('[网页AI]', err);
            showInfoBar(msg, 'error', 6000);
            setFabState('idle');
        }
    }

    // ================================================================
    //  页面侧 UI：屏幕中间右侧悬浮按钮
    // ================================================================
    function injectStyles(id, css) {
        if (document.getElementById(id)) return;
        const style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    // 内联 SVG 图标，不依赖图标库
    const ICON_SPARK = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2.2l1.9 5.1a4.6 4.6 0 0 0 2.8 2.8l5.1 1.9-5.1 1.9a4.6 4.6 0 0 0-2.8 2.8L12 21.8l-1.9-5.1a4.6 4.6 0 0 0-2.8-2.8L2.2 12l5.1-1.9a4.6 4.6 0 0 0 2.8-2.8L12 2.2z"/><path fill="currentColor" opacity=".75" d="M19.2 2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z"/></svg>';
    const ICON_SPIN = '<svg class="page-ai-summary-spin" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="40 20"/></svg>';

    function addGlobalStyles() {
        injectStyles('page-ai-summary-style', `
            #page-ai-summary-fab-wrap {
                position: fixed;
                top: 50%;
                right: 0;
                transform: translateY(-50%) translateX(4px);
                z-index: 2147483646;
                box-sizing: border-box;
                width: 58px;
                padding: 10px 6px 8px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                border-radius: 22px 0 0 22px;
                background: linear-gradient(180deg, rgba(124, 108, 240, 0.94) 0%, rgba(91, 76, 214, 0.94) 100%);
                border: 2px solid rgba(255, 255, 255, 0.88);
                border-right: none;
                box-shadow: -6px 8px 24px rgba(80, 60, 200, 0.28), 0 2px 6px rgba(0, 0, 0, 0.12);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
                user-select: none;
                opacity: 0.86;
                transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
            }
            #page-ai-summary-fab-wrap.page-ai-summary-has-selection::before {
                content: '';
                position: absolute;
                left: 8px;
                top: 12px;
                bottom: 12px;
                width: 3px;
                border-radius: 2px;
                background: rgba(255, 255, 255, 0.85);
            }
            #page-ai-summary-fab-wrap:hover,
            #page-ai-summary-fab-wrap:focus-within {
                opacity: 1;
                transform: translateY(-50%) translateX(0);
                box-shadow: -8px 10px 30px rgba(80, 60, 200, 0.38), 0 2px 6px rgba(0, 0, 0, 0.14);
            }
            #page-ai-summary-fab-wrap *,
            #page-ai-summary-fab-wrap *::before,
            #page-ai-summary-fab-wrap *::after { box-sizing: border-box; }

            /* 圆形图标按钮：白色描边 + 柔和阴影，卡通感 */
            #page-ai-summary-fab {
                flex: none;
                width: 42px;
                height: 42px;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 2px solid #ffffff;
                border-radius: 50%;
                background: #ffffff;
                color: #6d5ef0;
                cursor: pointer;
                box-shadow: 0 3px 10px rgba(40, 25, 120, 0.28);
                transition: transform 0.16s ease, box-shadow 0.16s ease;
                -webkit-tap-highlight-color: transparent;
            }
            #page-ai-summary-fab:hover {
                transform: translateY(-1px) scale(1.07);
                box-shadow: 0 5px 16px rgba(40, 25, 120, 0.36);
            }
            #page-ai-summary-fab:active { transform: scale(0.94); }
            #page-ai-summary-fab:disabled { cursor: progress; }
            #page-ai-summary-fab:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
            #page-ai-summary-fab svg { display: block; }
            #page-ai-summary-fab .page-ai-summary-spin { animation: page-ai-summary-rotate 0.9s linear infinite; }
            @keyframes page-ai-summary-rotate { to { transform: rotate(360deg); } }

            /* 模型选择：白底胶囊，短名单行显示（DeepSeek 走短名 DS 才不会溢出） */
            .page-ai-summary-select {
                flex: none;
                width: 42px;
                height: 24px;
                padding: 0;
                background-color: rgba(255, 255, 255, 0.96);
                background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5L6 8l3.5-3.5' fill='none' stroke='%235b4cd6' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
                background-repeat: no-repeat;
                background-position: right 2px center;
                background-size: 9px 9px;
                border: none;
                border-radius: 12px;
                color: #4c3fc4;
                font-family: inherit;
                font-size: 10px;
                font-weight: 800;
                line-height: 1;
                text-align: center;
                text-align-last: center;
                text-indent: -4px;
                cursor: pointer;
                appearance: none;
                -webkit-appearance: none;
                box-shadow: 0 1px 3px rgba(40, 25, 120, 0.25);
                transition: transform 0.16s ease, box-shadow 0.16s ease;
            }
            .page-ai-summary-select:hover { transform: scale(1.05); box-shadow: 0 2px 6px rgba(40, 25, 120, 0.32); }
            .page-ai-summary-select:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
            .page-ai-summary-select option { color: #1f2430; background: #ffffff; font-size: 13px; text-indent: 0; }

            .page-ai-summary-hide {
                flex: none;
                width: 24px;
                height: 22px;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background: none;
                border: none;
                border-radius: 6px;
                color: rgba(255, 255, 255, 0.55);
                font-size: 13px;
                line-height: 1;
                cursor: pointer;
                transition: color 0.16s ease, background 0.16s ease;
            }
            .page-ai-summary-hide:hover { color: #ffffff; background: rgba(255, 70, 70, 0.65); }
            .page-ai-summary-hide:focus-visible { outline: 1px solid rgba(255, 255, 255, 0.6); }

            ${INFO_BAR_CSS}
        `);
    }

    function showInfoBar(message, type = 'info', duration = 3000) {
        document.querySelectorAll('.page-ai-summary-infobar').forEach(el => el.remove());

        const infoBar = document.createElement('div');
        infoBar.className = `page-ai-summary-infobar ${type}`;
        infoBar.textContent = message;
        (document.body || document.documentElement).appendChild(infoBar);

        if (infoTimer) clearTimeout(infoTimer);
        if (duration > 0) {
            infoTimer = setTimeout(() => {
                if (infoBar.parentNode) infoBar.remove();
            }, duration);
        }
    }

    function setFabState(state) {
        fabState = state;
        if (!fabButton) return;

        if (state === 'loading') {
            fabButton.disabled = true;
            fabButton.innerHTML = ICON_SPIN;
        } else {
            fabButton.disabled = false;
            fabButton.innerHTML = ICON_SPARK;
        }
        updateFabTitle();
    }

    function updateFabTitle() {
        if (!fabButton) return;
        const provider = getSelectedProvider();

        let hasSelection = false;
        if (fabState === 'idle') {
            try {
                const sel = window.getSelection();
                hasSelection = !!(sel && sel.toString().trim());
            } catch (e) { hasSelection = false; }
        }

        if (fabState === 'loading') {
            fabButton.title = '正在提取页面内容…';
            fabButton.setAttribute('aria-label', '正在提取页面内容');
        } else {
            const tip = hasSelection
                ? `把选中的内容发给 ${provider.name} 总结`
                : `把整个网页正文发给 ${provider.name} 总结`;
            fabButton.title = tip;
            fabButton.setAttribute('aria-label', tip);
        }

        if (fabWrap) fabWrap.classList.toggle('page-ai-summary-has-selection', hasSelection);
    }


    function mountFab() {
        if (!document.body) return;
        if (isSiteHidden()) {
            if (fabWrap && fabWrap.parentNode) fabWrap.remove();
            return;
        }

        if (!fabWrap) {
            fabWrap = document.createElement('div');
            fabWrap.id = 'page-ai-summary-fab-wrap';

            fabButton = document.createElement('button');
            fabButton.type = 'button';
            fabButton.id = 'page-ai-summary-fab';
            fabButton.setAttribute('role', 'button');
            fabButton.addEventListener('click', (event) => {
                event.stopPropagation();
                event.preventDefault();
                triggerSummary();
            });

            // 模型选择：原生下拉框放在竖排面框里，白底胶囊，读起来最清楚
            providerSelect = document.createElement('select');
            providerSelect.className = 'page-ai-summary-select';
            providerSelect.setAttribute('aria-label', '选择要发送到的 AI 模型');
            PROVIDERS.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                // 下拉框只有 42px：显示短名，完整名字放 title 和右键菜单
                option.textContent = p.id === 'deepseek' ? 'DS' : p.name;
                option.title = p.name;
                providerSelect.appendChild(option);
            });
            providerSelect.value = getSelectedProvider().id;
            providerSelect.addEventListener('change', () => {
                setSelectedProvider(providerSelect.value);
                updateFabTitle();
                const p = getSelectedProvider();
                showInfoBar(`已切换到 ${p.name}`, 'info', 1200);
            });

            const hideBtn = document.createElement('button');
            hideBtn.type = 'button';
            hideBtn.className = 'page-ai-summary-hide';
            hideBtn.title = `在本站（${HOST}）隐藏按钮，可从油猴菜单恢复`;
            hideBtn.setAttribute('aria-label', '在本站隐藏按钮');
            hideBtn.textContent = '✕';
            hideBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                event.preventDefault();
                setSiteHidden(true);
                showInfoBar('已在本站隐藏，可通过油猴菜单「恢复本站按钮」重新显示', 'info', 3000);
                if (fabWrap && fabWrap.parentNode) fabWrap.remove();
            });

            fabWrap.appendChild(fabButton);
            fabWrap.appendChild(providerSelect);
            fabWrap.appendChild(hideBtn);

            if (fabState === 'loading') setFabState('loading');
            else setFabState('idle');

            // 有选中内容时更新提示文案
            document.addEventListener('selectionchange', () => {
                if (fabState === 'idle') updateFabTitle();
            });
        }

        // 其他标签页改了模型时同步显示
        if (providerSelect && document.activeElement !== providerSelect) {
            const selectedId = getSelectedProvider().id;
            if (providerSelect.value !== selectedId) providerSelect.value = selectedId;
        }

        if (fabWrap.parentNode !== document.body) {
            document.body.appendChild(fabWrap);
        }
    }

    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        try {
            GM_registerMenuCommand(isAutoSend() ? '自动发送：开（点击关闭）' : '自动发送：关（点击开启）', () => {
                setAutoSend(!isAutoSend());
                showInfoBar(isAutoSend() ? '已开启自动发送' : '已关闭：只填提示词，需手动点发送', 'info', 3000);
            });
        } catch (e) { /* ignore */ }

        try {
            GM_registerMenuCommand(isSiteHidden() ? `恢复本站按钮（${HOST}）` : `在本站隐藏按钮（${HOST}）`, () => {
                setSiteHidden(!isSiteHidden());
                location.reload();
            });
        } catch (e) { /* ignore */ }

        try {
            GM_registerMenuCommand('把当前页面内容发到 AI 总结', () => triggerSummary());
        } catch (e) { /* ignore */ }
    }

    function watchUrlChanges() {
        setInterval(() => {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            // SPA 换页后把按钮状态复位
            if (fabState !== 'idle') setFabState('idle');
        }, 1000);
    }

    function runPage() {
        addGlobalStyles();
        registerMenuCommands();
        mountFab();
        // SPA 有时会重绘 body，隔一段时间检查一次
        setInterval(mountFab, 1500);
        watchUrlChanges();
    }

    // ================================================================
    //  AI 页面分支：读取任务 → 填入 → 发送
    // ================================================================
    // 去掉 www. 后再比对，兼容 www./m./wap. 等子域名
    function normalizeHost(host) {
        return String(host || '').toLowerCase().replace(/^www\./, '');
    }

    function getProviderByHost(host) {
        const h = normalizeHost(host);
        return PROVIDERS.find(p => (p.hosts || []).some(x => normalizeHost(x) === h || h.endsWith('.' + normalizeHost(x)))) ||
            PROVIDERS.find(p => {
                try {
                    return normalizeHost(new URL(p.url).hostname) === h;
                } catch (e) { return false; }
            }) || null;
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
            if (existing) return resolve(existing);

            let done = false;
            let timer = null;
            let observer = null;

            const finish = (element) => {
                if (done) return;
                done = true;
                try { if (observer) observer.disconnect(); } catch (e) { /* ignore */ }
                if (timer) clearTimeout(timer);
                resolve(element);
            };

            observer = new MutationObserver(() => {
                const element = findProviderInput(provider);
                if (element) finish(element);
            });
            if (document.body) observer.observe(document.body, { childList: true, subtree: true });

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

    function fillAndSendProvider(provider, input, text, autoSend) {
        console.info('[网页AI] 开始填充:', provider.name, '长度:', text.length);
        fillProviderInput(input, text);

        if (!autoSend) {
            showInfoBar('内容已填入（自动发送已关闭），请检查后手动发送', 'info', 4000);
            return;
        }

        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;

            const sendBtn = findProviderSendButton(provider);
            if (sendBtn) {
                clearInterval(timer);
                sendBtn.click();
                showInfoBar('已发送', 'success', 2000);
                console.info('[网页AI] 已点击发送');
                return;
            }

            if (attempts >= 20) {
                clearInterval(timer);
                pressEnter(input);
                showInfoBar('未找到发送按钮，已尝试回车', 'info', 3000);
                console.info('[网页AI] 未找到发送按钮，尝试回车');
            }
        }, 250);
    }

    function readTask(provider) {
        let raw = null;
        try { raw = GM_getValue(TASK_KEY, null); } catch (e) { return null; }
        if (!raw) return null;

        const task = typeof raw === 'string' ? { content: raw, timestamp: Date.now() } : raw;
        if (!task || !task.content) return null;

        // 任务指定了别的模型：留给目标页面
        if (task.provider && task.provider !== provider.id) return null;

        const timestamp = Number(task.timestamp) || 0;
        if (!timestamp || Date.now() - timestamp > TASK_TTL) {
            try { GM_deleteValue(TASK_KEY); } catch (e) { /* ignore */ }
            return null;
        }
        return task;
    }

    // 本标签页一次性消费任务的记录，避免刷新页面后反复报"没有收到任务"
    function consumedMarkKey(provider) {
        return TASK_KEY + '_CONSUMED_' + provider.id;
    }
    function hasConsumedInThisPage(provider) {
        try { return sessionStorage.getItem(consumedMarkKey(provider)) === '1'; } catch (e) { return true; }
    }
    function markConsumedInThisPage(provider) {
        try { sessionStorage.setItem(consumedMarkKey(provider), '1'); } catch (e) { /* ignore */ }
    }

    function runProviderPage(provider) {
        const pending = readTask(provider);
        if (!pending) {
            // 只在"刚打开"时提示一次：如果用户是手动打开 AI 页面，就不打扰
            if (!hasConsumedInThisPage(provider) && !window.__pageAiSummaryNoTaskHinted) {
                window.__pageAiSummaryNoTaskHinted = true;
                log('当前标签页没有待发送任务');
                setTimeout(() => {
                    // 3.5 秒后还没收到任务才提示，给"任务刚写入"的情况留出窗口
                    if (hasConsumedInThisPage(provider)) return;
                    if (document.hasFocus && !document.hasFocus()) return;
                    notify('网页 AI 总结', '这个标签页没有收到待发送内容。请在原文页面点右侧的「AI 总结」按钮，脚本会在你刚点选的那个模型里自动填入。');
                }, 3500);
            }
            return;
        }

        console.info('[网页AI] 检测到待发送任务:', provider.name, '长度:', pending.content.length);

        waitForProviderInput(provider, 20000).then(input => {
            if (!input) {
                console.warn('[网页AI] 未找到输入框:', provider.name);
                try {
                    alert('未能自动填入 ' + provider.name + '：输入框加载失败。总结内容已复制到剪贴板，请手动粘贴发送。');
                } catch (e) { /* ignore */ }
                return;
            }

            // 页面可能发生过跳转/重载，填入前重新确认任务还在
            const latest = readTask(provider);
            if (!latest || latest.content !== pending.content) return;

            // 一次性消费
            try { GM_deleteValue(TASK_KEY); } catch (e) { /* ignore */ }
            markConsumedInThisPage(provider);

            setTimeout(() => {
                fillAndSendProvider(provider, input, latest.content, latest.autoSend !== false);
            }, 600);
        });
    }

    // ================================================================
    //  入口
    // ================================================================
    // 同源的其他标签页里，存储变化会广播过来；用来处理"AI 标签页早就开着，之后才点击发送"的情况
    function watchTaskFromOtherTabs(provider) {
        if (typeof GM_addValueChangeListener !== 'function') return;
        try {
            GM_addValueChangeListener(TASK_KEY, (name, oldValue, newValue, remote) => {
                if (!remote || !newValue) return;
                log('收到其他标签页的任务');
                runProviderPage(provider);
            });
        } catch (e) { /* ignore */ }
    }

    const currentProvider = getProviderByHost(HOST);
    if (currentProvider) {
        // AI 页面：只负责接收任务，不给页面加按钮
        whenDomReady(() => {
            injectStyles('page-ai-summary-infobar-style', INFO_BAR_CSS);
            setTimeout(() => {
                runProviderPage(currentProvider);
                // 任务 1 秒后才写入时，首次检测会扑空，再补一次
                if (TASK_KEY) setTimeout(() => runProviderPage(currentProvider), 1500);
            }, 0);
            watchTaskFromOtherTabs(currentProvider);
        });
    // 便于排查：AI 页面里执行 __PAGE_AI_SUMMARY_E2E__ 可重新读取任务
    try {
        window.__PAGE_AI_SUMMARY_E2E__ = () => runProviderPage(currentProvider);
    } catch (e) { /* ignore */ }
        return;
    }

    // 普通网页
    whenDomReady(() => {
        addGlobalStyles();
        setTimeout(runPage, 0);
    });

})();
