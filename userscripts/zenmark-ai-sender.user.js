// ==UserScript==
// @name         AI 回答发送到 ZenMark (DeepSeek & Kimi & Gemini & 元宝 & Google AI Mode)
// @namespace    https://github.com/macrochen/ZenMark
// @version      1.4.0
// @description  复用 DeepSeek、Kimi、Gemini、腾讯元宝、Google AI Mode 原生复制能力（AI Mode 无复制按钮时自动转 Markdown），一键发送至 ZenMark 阅读
// @author       macrochen
// @match        *://chat.deepseek.com/*
// @match        *://*.kimi.com/*
// @match        *://*.kimi.moonshot.cn/*
// @match        *://gemini.google.com/*
// @match        *://yuanbao.tencent.com/*
// @match        *://www.google.com/search*
// @match        *://www.google.com.hk/search*
// @match        *://www.google.co.jp/search*
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

    // 当前操作触发的按钮引用
    let currentTriggerBtn = null;
    // 剪贴板拦截标记（沿用全局变量，便于调试）
    window._ai_zenmark_trigger = false;
    let interceptTimer = null;

    // ================= 耗时统计（定位“慢在哪一段”） ================= //
    // 记录：点击 -> 菜单就绪 -> 站点完成复制 -> 接口返回 -> 打开阅读器
    let timing = null;

    function startTiming() {
        timing = { start: performance.now(), marks: {} };
        return timing;
    }

    function markTiming(name) {
        if (!timing) startTiming();
        timing.marks[name] = Math.round(performance.now() - timing.start);
    }

    function logTiming(extra) {
        if (!timing) return null;
        const result = Object.assign({}, timing.marks, extra || {});
        result.total = Math.round(performance.now() - timing.start);
        window.__zenmarkLastRun = result;
        console.info('[ZenMark TM] 本次各阶段耗时(ms):', result);
        return result;
    }

    // ================= 按钮状态 ================= //
    // 处理中显示实时秒数，能直观看出卡在“提取”还是“传输”
    let statusTimer = null;

    function clearPendingStatus() {
        clearInterval(statusTimer);
        statusTimer = null;
    }

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
     * 处理中状态：每 200ms 刷新已耗时
     */
    function setPendingStatus(btn, label) {
        if (!btn) return;
        clearPendingStatus();
        const start = performance.now();
        const tick = () => {
            setBtnStatus(btn, `${label} ${((performance.now() - start) / 1000).toFixed(1)}s`, true);
        };
        tick();
        statusTimer = setInterval(tick, 200);
    }

    /**
     * 结束处理中状态
     */
    function finishStatus(btn, text) {
        clearPendingStatus();
        setBtnStatus(btn, text, false);
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

        if (isGoogleSearch()) {
            // Google 结果页标题形如 “二叉树是什么 - Google 搜索”，优先用查询词
            const q = new URLSearchParams(window.location.search).get('q');
            if (q && q.trim()) return q.trim();
            title = title.replace(/\s*-\s*Google\s*(?:搜索|Search)\s*$/i, '').trim();
        }

        if (hostname.includes('yuanbao.tencent.com')) {
            // 元宝的页面标题通常形如 “会话标题 - 元宝” 或直接就是 “元宝”
            title = title
                .replace(/\s*[-–—|]\s*(?:腾讯\s*)?(?:元宝|AI\s*助手|腾讯AI助手)\s*$/i, '')
                .replace(/^(?:腾讯\s*)?(?:元宝|AI\s*助手)$/i, '')
                .trim();
        }

        return title || 'AI 回答摘录';
    }

    /**
     * 将截获的 Markdown 文本发送至 ZenMark 服务
     */
    function sendMarkdownToZenMark(markdownText, sourceBtn) {
        if (!markdownText || !markdownText.trim()) {
            finishStatus(sourceBtn, '📖 内容为空');
            setTimeout(() => setBtnStatus(sourceBtn, '📖 ZenMark'), 2000);
            return;
        }

        const text = markdownText.trim();
        markTiming('captured');

        const title = getContextTitle();
        setPendingStatus(sourceBtn, '⏳ 传输中');

        markTiming('postStart');
        GM_xmlhttpRequest({
            method: 'POST',
            url: ZENMARK_API_URL,
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            },
            data: JSON.stringify({
                text: text,
                title: title,
                autoRead: false
            }),
            timeout: 45000,
            onload: function(response) {
                markTiming('postDone');
                try {
                    const result = JSON.parse(response.responseText);
                    if (response.status === 200 && result.success && result.url) {
                        finishStatus(sourceBtn, '✔ 已打开');
                        // 在新标签页打开 ZenMark
                        GM_openInTab(result.url, { active: true, insert: true });
                        markTiming('tabOpened');
                        logTiming({ payloadChars: text.length });
                    } else {
                        throw new Error(result.error || `接口返回异常 (${response.status})`);
                    }
                } catch (e) {
                    console.error('[ZenMark TM 错误]', e);
                    logTiming({ payloadChars: text.length, error: String(e.message || e) });
                    alert('发送失败：' + (e.message || response.responseText));
                    finishStatus(sourceBtn, '❌ 失败');
                }
                setTimeout(() => setBtnStatus(sourceBtn, '📖 ZenMark'), 2000);
            },
            onerror: function(err) {
                console.error('[ZenMark TM 网络错误]', err);
                logTiming({ payloadChars: text.length, error: 'network', detail: String(err && err.error || err) });
                alert('无法连接到 ZenMark 服务！\n请检查网络连接或 Cloudflare Pages 函数接口是否正常响应。');
                finishStatus(sourceBtn, '❌ 离线');
                setTimeout(() => setBtnStatus(sourceBtn, '📖 ZenMark'), 2000);
            },
            ontimeout: function() {
                console.error('[ZenMark TM 请求超时]');
                logTiming({ payloadChars: text.length, error: 'timeout' });
                alert('ZenMark 接口请求超过 45 秒仍未返回，可能是网络到 Cloudflare Pages 不通。');
                finishStatus(sourceBtn, '❌ 超时');
                setTimeout(() => setBtnStatus(sourceBtn, '📖 ZenMark'), 2000);
            }
        });
    }

    // ================= 剪贴板拦截状态管理 ================= //

    function disarmIntercept() {
        window._ai_zenmark_trigger = false;
        clearTimeout(interceptTimer);
        interceptTimer = null;
    }

    /**
     * 武装拦截：下一次 clipboard 写入将被截获
     */
    function armIntercept(btn, timeout = 6000) {
        window._ai_zenmark_trigger = true;
        currentTriggerBtn = btn;
        clearTimeout(interceptTimer);
        interceptTimer = setTimeout(() => {
            interceptTimer = null;
            if (!window._ai_zenmark_trigger) return;
            window._ai_zenmark_trigger = false;
            logTiming({ error: '未捕获剪贴板写入（站点复制未完成或未走 Clipboard API）' });
            if (btn && btn.textContent.indexOf('⏳') === 0) {
                finishStatus(btn, '❌ 未捕获');
                setTimeout(() => setBtnStatus(btn, '📖 ZenMark'), 2500);
            }
        }, timeout);
    }

    /**
     * 取出本次拦截的目标按钮；返回 undefined 表示当前未武装
     */
    function takeInterceptTarget() {
        if (!window._ai_zenmark_trigger) return undefined;
        const btn = currentTriggerBtn;
        disarmIntercept();
        return btn || null;
    }

    // ================= 拦截 Clipboard 提取原生 Markdown ================= //

    const clipboard = navigator.clipboard;
    const originalWriteText = clipboard && clipboard.writeText;
    if (originalWriteText) {
        clipboard.writeText = function(text) {
            const target = takeInterceptTarget();
            if (target !== undefined) {
                sendMarkdownToZenMark(text, target);
                return Promise.resolve();
            }
            return originalWriteText.apply(this, arguments);
        };
    }

    const originalWrite = clipboard && clipboard.write;
    if (originalWrite) {
        clipboard.write = function(data) {
            const target = takeInterceptTarget();
            if (target === undefined) {
                return originalWrite.apply(this, arguments);
            }

            const items = data ? Array.prototype.slice.call(data) : [];
            const plainItem = items.filter(item =>
                item && item.types && Array.prototype.indexOf.call(item.types, 'text/plain') !== -1
            )[0];

            if (!plainItem) {
                // 没有纯文本内容，交回原生写入，避免误吞数据
                return originalWrite.apply(this, arguments);
            }

            Promise.resolve()
                .then(() => plainItem.getType('text/plain'))
                .then(blob => blob.text())
                .then(text => sendMarkdownToZenMark(text, target))
                .catch(err => {
                    console.error('[ZenMark TM 读取剪贴板内容失败]', err);
                    logTiming({ error: '读取剪贴板 Blob 失败' });
                    finishStatus(target, '❌ 读取失败');
                    setTimeout(() => setBtnStatus(target, '📖 ZenMark'), 2500);
                });

            return Promise.resolve();
        };
    }

    // ================= 构造 ZenMark 按钮 ================= //

    /**
     * trigger 可以是原生复制按钮（点击即可复制），也可以是自定义函数
     */
    function createZenMarkBtn(trigger) {
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
            if (typeof trigger === 'function') {
                trigger(btn);
            } else {
                startNativeCopy(btn, trigger);
            }
        });

        return btn;
    }

    /**
     * 直接触发原生复制按钮（默认复制，纯文本）
     */
    function startNativeCopy(btn, target) {
        if (!target) {
            finishStatus(btn, '❌ 找不到复制按钮');
            setTimeout(() => setBtnStatus(btn, '📖 ZenMark'), 2500);
            return;
        }
        startTiming();
        markTiming('click');
        setPendingStatus(btn, '⏳ 提取中');
        armIntercept(btn);
        markTiming('nativeCopyClick');
        target.click();
    }

    // ================= 元宝（腾讯）专属逻辑 ================= //
    // 元宝的复制按钮是"分裂按钮"：主按钮 = 默认复制，右侧箭头 = 复制选项菜单，
    // 菜单中包含「复制」与「复制为 Markdown」，我们需要点后者。

    const YB_MORE_SELECTOR = '[aria-label="更多复制选项"]';
    const YB_COPY_SELECTOR = '[aria-label="复制"]';
    // 中文为「复制为Markdown」，英文界面为「Copy as Markdown」
    const YB_MARKDOWN_TEXT_RE = /^(?:复制为\s*markdown|copy\s+as\s+markdown)$/i;

    function normalizeText(el) {
        return (el.textContent || '')
            .replace(/[\u200b-\u200d\ufeff]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isVisible(el) {
        if (!el || !el.getClientRects().length) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    /**
     * 在弹出菜单中查找「复制为 Markdown」菜单项
     */
    function findYuanbaoMarkdownItem() {
        const items = document.querySelectorAll('li.t-dropdown__item');
        for (let i = 0; i < items.length; i++) {
            if (YB_MARKDOWN_TEXT_RE.test(normalizeText(items[i])) && isVisible(items[i])) {
                return items[i];
            }
        }

        // 兜底：菜单结构改版时在弹层内按文本精确匹配
        const loose = document.querySelectorAll('.t-dropdown__menu li, .t-dropdown__menu [role="menuitem"], .t-dropdown__menu button');
        for (let i = 0; i < loose.length; i++) {
            if (YB_MARKDOWN_TEXT_RE.test(normalizeText(loose[i])) && isVisible(loose[i])) {
                return loose[i];
            }
        }
        return null;
    }

    /**
     * 轮询等待条件成立
     */
    function waitFor(predicate, timeout = 1200, interval = 50) {
        return new Promise(resolve => {
            const deadline = Date.now() + timeout;
            (function tick() {
                let found = null;
                try {
                    found = predicate();
                } catch (e) {
                    found = null;
                }
                if (found) return resolve(found);
                if (Date.now() >= deadline) return resolve(null);
                setTimeout(tick, interval);
            })();
        });
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 元宝：先打开复制选项菜单，再点击「复制为 Markdown」
     */
    async function copyYuanbaoMarkdown(btn) {
        const container = btn.closest('.agent-chat__conv--ai__toolbar')
            || btn.closest('.agent-chat__toolbar')
            || btn.parentElement;

        const arrow = container ? container.querySelector(YB_MORE_SELECTOR) : null;
        const copyIcon = container ? container.querySelector(YB_COPY_SELECTOR) : null;

        // 移动端 / 没有二级菜单时退回默认复制
        if (!arrow) {
            startNativeCopy(btn, copyIcon);
            return;
        }

        startTiming();
        markTiming('click');

        // 菜单已经展开（例如用户手动点开过）时直接使用，避免多点一次把它关掉
        const openedItem = findYuanbaoMarkdownItem();
        if (openedItem) {
            markTiming('menuFound');
            setPendingStatus(btn, '⏳ 提取中');
            armIntercept(btn);
            markTiming('menuClick');
            openedItem.click();
            return;
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            setPendingStatus(btn, '⏳ 提取中');
            arrow.click();
            markTiming('menuOpenClick' + (attempt + 1));

            // 菜单一般 1~2 帧内就能渲染出来，用 25ms 轮询尽快命中
            const item = await waitFor(findYuanbaoMarkdownItem, 700, 25);
            if (item) {
                markTiming('menuFound');
                armIntercept(btn);
                markTiming('menuClick');
                item.click();
                return;
            }

            // 菜单未出现或没有 Markdown 选项，关闭后重试一次
            arrow.click();
            await sleep(150);
        }

        // 兜底：使用默认复制（纯文本），至少把内容送到 ZenMark
        if (copyIcon) {
            console.warn('[ZenMark TM] 未找到「复制为Markdown」菜单项，已退回默认复制（纯文本）。可运行 __zenmarkDiag() 查看页面结构。');
            markTiming('fallbackPlain');
            setPendingStatus(btn, '⏳ 提取中(纯文本)');
            armIntercept(btn);
            copyIcon.click();
        } else {
            markTiming('failed');
            logTiming({ error: '未找到复制菜单' });
            finishStatus(btn, '❌ 未找到复制菜单');
            setTimeout(() => setBtnStatus(btn, '📖 ZenMark'), 2500);
        }
    }

    /**
     * 元宝：把按钮注入到回答工具栏的复制按钮之后
     */
    function injectYuanbaoButtons() {
        document.querySelectorAll(YB_MORE_SELECTOR).forEach(arrow => {
            const wrapper = arrow.parentElement;
            if (!wrapper) return;
            // 用户提问工具栏没有二级菜单（hideSubMenu），保险起见跳过
            if (arrow.closest('.agent-chat__question-toolbar')) return;

            // 优先挂到 copy-wrapper 之后（工具栏的 flex 行内），保持原生间距
            const host = wrapper.parentElement
                && wrapper.parentElement.classList.contains('agent-chat__question-toolbar__copy-wrapper')
                ? wrapper.parentElement
                : wrapper;

            const container = arrow.closest('.agent-chat__conv--ai__toolbar')
                || arrow.closest('.agent-chat__toolbar')
                || document;

            // 每个工具栏只保留一个按钮，已就位则跳过
            const existing = container === document ? null : container.querySelector('.ai-zenmark-btn');
            if (existing) {
                if (existing.previousElementSibling === host) return;
                existing.remove();
            }

            const btn = createZenMarkBtn(copyYuanbaoMarkdown);
            btn.style.marginLeft = '8px';
            host.after(btn);
        });

        // 清理被 React 重渲染后遗留的失效按钮（所在工具栏已无复制按钮）
        document.querySelectorAll('.ai-zenmark-btn').forEach(btn => {
            const container = btn.closest('.agent-chat__conv--ai__toolbar') || btn.closest('.agent-chat__toolbar');
            if (container && !container.querySelector(YB_COPY_SELECTOR) && !container.querySelector(YB_MORE_SELECTOR)) {
                btn.remove();
            }
        });
    }

    /**
     * 网络自测：控制台执行 await __zenmarkNetTest()
     * 返回本次到 ZenMark 接口的往返毫秒数，用于区分“网络慢”和“页面内慢”
     */
    window.__zenmarkNetTest = function() {
        return new Promise(resolve => {
            const started = performance.now();
            GM_xmlhttpRequest({
                method: 'POST',
                url: ZENMARK_API_URL,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                data: JSON.stringify({
                    text: '# ZenMark 网络自测\n\n' + new Date().toISOString(),
                    title: 'ZenMark 网络自测',
                    autoRead: false
                }),
                timeout: 60000,
                onload: r => resolve({ ok: r.status === 200, ms: Math.round(performance.now() - started), status: r.status }),
                onerror: () => resolve({ ok: false, ms: Math.round(performance.now() - started), error: 'network' }),
                ontimeout: () => resolve({ ok: false, ms: Math.round(performance.now() - started), error: 'timeout' })
            });
        });
    };

    // 便于排查问题的诊断入口：控制台执行 __zenmarkDiag()
    window.__zenmarkAIDiag = function() {
        if (!isGoogleSearch()) return { note: '当前不是 google.com/search 页面' };
        const found = findAIModeActions();
        return {
            url: window.location.href,
            detected: isAIModePage(),
            hasUdm50: new URLSearchParams(window.location.search).get('udm') === '50',
            answers: found.map(f => ({
                reason: f.answer.reason,
                copyButton: !!f.copyBtn,
                className: f.answer.container.className || '',
                preview: domToMarkdown(f.answer.container).slice(0, 120)
            })),
            injectedButtons: document.querySelectorAll('.ai-zenmark-btn').length
        };
    };

    window.__zenmarkDiag = function() {
        const arrows = Array.prototype.slice.call(document.querySelectorAll(YB_MORE_SELECTOR));
        return {
            url: window.location.href,
            title: document.title,
            arrowCount: arrows.length,
            injectedButtons: document.querySelectorAll('.ai-zenmark-btn').length,
            copyWrappers: arrows.map(a => a.parentElement ? a.parentElement.className : null),
            menuItems: Array.prototype.slice
                .call(document.querySelectorAll('li.t-dropdown__item'))
                .map(normalizeText)
        };
    };

    // ================= Google AI Mode ================= //
    // 真实结构（依据线上抓取）：
    //   每个回答块各自带一个工具栏，按钮形如：
    //     button[aria-label='复制“本轮问题原文”']  ← 复制整轮（问题 + 回答）
    //     button[aria-label='复制文字']            ← 只复制文字
    //     div[aria-label='正在复制']               ← 复制中的提示节点
    //     button[aria-label='分享' / '赞' / '踩' / '更多']
    // 因此这里按“工具栏”为单位定位，而不是写死某个类名。

    // 留空；确认结构后可追加精确选择器（例如 '[data-xid="aim-answer"]'）
    const AI_MODE_EXTRA_SELECTORS = [];

    // 复制按钮标签：复制“xxx” / 复制文字 / Copy / Copy text
    const AI_COPY_LABEL_RE = /^(?:复制(?:文字|“|"|$)|copy\b|copy\s+(?:text|link|response))/i;
    // 工具栏里可能出现的其它按钮（用于识别“这是一组操作按钮”）
    const AI_TOOLBAR_LABEL_RE = /^(?:复制|分享|赞|踩|好|差|更多|正在|copy|share|like|dislike|more|thumbs|stop|反馈|引用)/i;

    function isGoogleSearch() {
        const host = window.location.hostname;
        return /^www\.google\.(com|com\.hk|co\.jp)$/.test(host) && window.location.pathname === '/search';
    }

    function isAIModePage() {
        if (!isGoogleSearch()) return false;
        if (/^https?:\/\//i.test(document.title || '')) return false; // 验证码 / 错误页
        const p = new URLSearchParams(window.location.search);
        if (p.get('udm') === '50') return true;
        if (window.__zenmarkAIModeSeen) return true;
        if (AI_MODE_EXTRA_SELECTORS.length &&
            document.querySelector(AI_MODE_EXTRA_SELECTORS.join(','))) return true;
        return false;
    }

    /**
     * 一旦在 udm=50 页面确认过 AI Mode，就记住（SPA 追问时 URL 参数会变）
     */
    function noteAIModeSession() {
        if (isAIModePage()) window.__zenmarkAIModeSeen = true;
        return !!window.__zenmarkAIModeSeen;
    }

    function labelOf(el) {
        return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function isButtonLike(el) {
        if (!el || el.nodeType !== 1) return false;
        const tag = el.tagName;
        if (tag === 'BUTTON') return true;
        if (el.getAttribute('role') === 'button') return true;
        return !!(el.querySelector && el.querySelector('svg, img'));
    }

    /**
     * 收集候选工具栏：以“带 aria-label 的元素”为锚点，取其父节点
     */
    function candidateToolbars() {
        const map = new Map();
        const anchors = AI_MODE_EXTRA_SELECTORS.length
            ? Array.from(document.querySelectorAll(AI_MODE_EXTRA_SELECTORS.join(',')))
            : Array.from(document.querySelectorAll('[aria-label]'));
        anchors.forEach(el => {
            if (!el.parentElement) return;
            map.set(el.parentElement, true);
        });
        return Array.from(map.keys());
    }

    /**
     * 从一个父节点里取出它的按钮列表；不合格返回 null
     */
    function toolbarButtons(bar) {
        const buttons = Array.from(bar.children).filter(isButtonLike);
        if (buttons.length < 2) return null;
        // 工具栏按钮应当是图标/短标签
        const longLabel = buttons.some(b => labelOf(b).replace(/\s+/g, '').length > 60);
        if (longLabel) return null;
        const labeled = buttons.filter(b => AI_TOOLBAR_LABEL_RE.test(labelOf(b)));
        if (labeled.length < 2) return null;
        return buttons;
    }

    /**
     * 区分“整轮复制”（复制“问题”）与“只复制文字”
     */
    function pickCopyButton(buttons) {
        const candidates = buttons.filter(b => AI_COPY_LABEL_RE.test(labelOf(b)));
        if (!candidates.length) return null;
        const turnBtn = candidates.find(b => /^复制\s*[“"]/.test(labelOf(b)));
        const textBtn = candidates.find(b => /^复制文字$/.test(labelOf(b))) ||
            candidates.find(b => /^copy\s+text$/i.test(labelOf(b)));
        // 优先“复制文字”（只要回答），其次“复制整轮”
        return { turn: turnBtn || null, text: textBtn || null, best: textBtn || turnBtn || candidates[0] };
    }

    /**
     * 找到工具栏所属的那条回答容器
     */
    function findAnswerFor(bar, buttons) {
        for (const sel of AI_MODE_EXTRA_SELECTORS) {
            const el = bar.closest(sel);
            if (el) return { container: el, reason: 'selector:' + sel };
        }
        let el = bar.parentElement;
        for (let depth = 0; el && depth < 8; depth++, el = el.parentElement) {
            if (el.tagName === 'BODY' || el.tagName === 'HTML') break;
            if (!hasSubstantialAnswer(el)) continue;
            if (hasOtherToolbar(el, bar)) continue;
            return { container: el, reason: 'depth-' + depth };
        }
        return null;
    }

    function stripChrome(el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('button, [role="button"], svg, img, script, style').forEach(n => n.remove());
        return clone;
    }

    function hasSubstantialAnswer(el) {
        const blocks = el.querySelectorAll('p, li, table, pre, h1, h2, h3, h4, blockquote');
        if (blocks.length >= 2) return true;
        const text = (stripChrome(el).textContent || '').replace(/\s+/g, '');
        return text.length >= 25 && /[。！？.!?，,]/.test(text);
    }

    /**
     * 该容器里是否还嵌着别的工具栏（说明是外层容器）
     */
    function hasOtherToolbar(el, selfBar) {
        for (const child of el.querySelectorAll('*')) {
            if (child === el || child === selfBar || (selfBar && selfBar.contains(child))) continue;
            if (!toolbarButtons(child)) continue;
            return true;
        }
        return false;
    }

    function countButtons(el) {
        return el.querySelectorAll('[role="button"], button').length;
    }

    // ---- DOM → Markdown（回退路径）----

    function isInteractive(el) {
        if (!el || el.nodeType !== 1) return false;
        const tag = el.tagName.toLowerCase();
        if (tag === 'button' || tag === 'svg' || tag === 'script' || tag === 'style') return true;
        const role = el.getAttribute('role');
        return role === 'button' || role === 'tab' || el.getAttribute('aria-hidden') === 'true';
    }

    function inlineMarkdown(node) {
        let out = '';
        node.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                out += child.nodeValue.replace(/\s+/g, ' ');
                return;
            }
            if (child.nodeType !== Node.ELEMENT_NODE) return;
            if (isInteractive(child)) return;
            if (node.tagName && node.tagName.toLowerCase() === 'code') {
                out += child.textContent || '';
                return;
            }
            const tag = child.tagName.toLowerCase();
            switch (tag) {
                case 'br':
                    out += '  \n';
                    return;
                case 'strong':
                case 'b': {
                    const t = inlineMarkdown(child).trim();
                    out += t ? `**${t}**` : '';
                    return;
                }
                case 'em':
                case 'i': {
                    const t = inlineMarkdown(child).trim();
                    out += t ? `*${t}*` : '';
                    return;
                }
                case 'code': {
                    const t = (child.textContent || '').replace(/\s+/g, ' ').trim();
                    out += t ? `\`${t}\`` : '';
                    return;
                }
                case 'a': {
                    const t = inlineMarkdown(child).trim();
                    const href = child.getAttribute('href') || '';
                    if (!t) return;
                    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) out += t;
                    else out += `[${t}](${href})`;
                    return;
                }
                case 'img': {
                    const alt = child.getAttribute('alt') || '图片';
                    const src = child.getAttribute('src') || '';
                    out += src && !src.startsWith('data:') ? `![${alt}](${src})` : `[${alt}]`;
                    return;
                }
                default:
                    out += inlineMarkdown(child);
            }
        });
        return out;
    }

    function cleanInline(text) {
        return text
            .replace(/[ \t]+/g, ' ')
            .replace(/ ?\n ?/g, '\n')
            .replace(/【\d+(?:\s*,\s*\d+)*】/g, '') // Google 的角标引用
            .trim();
    }

    function blockMarkdown(el) {
        const parts = [];
        Array.from(el.children).forEach(child => {
            if (isInteractive(child)) return;
            const md = elementToMarkdown(child);
            if (md) parts.push(md);
        });
        return parts.join('\n\n');
    }

    function elementToMarkdown(el) {
        const tag = el.tagName.toLowerCase();
        switch (tag) {
            case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
                const t = cleanInline(inlineMarkdown(el));
                return t ? `${'#'.repeat(Number(tag[1]))} ${t}` : '';
            }
            case 'p':
                return cleanInline(inlineMarkdown(el));
            case 'ul':
            case 'ol': {
                const items = Array.from(el.querySelectorAll(':scope > li'));
                return items.map((li, i) => {
                    const body = cleanInline(inlineMarkdown(li)).replace(/\n+/g, '\n  ');
                    return tag === 'ol' ? `${i + 1}. ${body}` : `- ${body}`;
                }).filter(Boolean).join('\n');
            }
            case 'pre': {
                const codeEl = el.querySelector('code') || el;
                const raw = (codeEl.textContent || '').replace(/\n+$/, '');
                const lang = /^language-([\w-]+)/.exec(codeEl.getAttribute('class') || '');
                return '```' + (lang ? lang[1] : '') + '\n' + raw + '\n```';
            }
            case 'table': {
                const rows = Array.from(el.querySelectorAll('tr'));
                if (!rows.length) return '';
                const cells = row => Array.from(row.querySelectorAll('th, td'))
                    .map(c => cleanInline(inlineMarkdown(c)).replace(/\|/g, '\\|').replace(/\n/g, ' '));
                const head = cells(rows[0]);
                const out = [
                    '| ' + head.join(' | ') + ' |',
                    '| ' + head.map(() => '---').join(' | ') + ' |'
                ];
                rows.slice(1).forEach(r => {
                    const c = cells(r);
                    out.push('| ' + head.map((_, i) => c[i] || '').join(' | ') + ' |');
                });
                return out.join('\n');
            }
            case 'blockquote':
                return blockMarkdown(el).split('\n').map(l => '> ' + l).join('\n');
            case 'hr':
                return '---';
            case 'script': case 'style': case 'noscript': case 'svg': case 'button':
                return '';
            case 'span': case 'strong': case 'b': case 'em': case 'i': case 'a':
            case 'font': case 'u': case 'sub': case 'sup': case 'time':
                return cleanInline(inlineMarkdown(el));
            default: {
                const hasBlockChild = Array.from(el.children).some(c =>
                    /^(p|div|ul|ol|li|table|pre|h[1-6]|blockquote|section|article|header|footer|figure|details)$/
                        .test(c.tagName.toLowerCase()));
                if (!hasBlockChild) return cleanInline(inlineMarkdown(el));
                return blockMarkdown(el);
            }
        }
    }

    function domToMarkdown(container) {
        return (blockMarkdown(container) || elementToMarkdown(container))
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }

    // ---- 点击处理 ----

    function copyAIMode(btn, info, preferText) {
        startTiming();
        markTiming('click');

        const target = (preferText && info.copy.text) || info.copy.best;
        if (target) {
            setPendingStatus(btn, '⏳ 提取中');
            armIntercept(btn, 4000);
            markTiming('nativeCopyClick');
            target.click();

            // Google 复制通常在 300ms 内完成（复制瞬间还会把按钮切成“正在复制”）。
            // 超过 1.5s 仍未捕获 → 复制按钮失效（节点被 React 替换等），回退本地转换。
            const started = performance.now();
            (function waitFallback() {
                if (!window._ai_zenmark_trigger) return; // 已接管或已超时解除
                if (performance.now() - started < 1600) {
                    setTimeout(waitFallback, 150);
                    return;
                }
                if (window._ai_zenmark_trigger) {
                    window._ai_zenmark_trigger = false;
                    disarmIntercept();
                    markTiming('nativeCopyTimeout');
                    sendAIModeFromDom(btn, info);
                }
            })();
            return;
        }

        sendAIModeFromDom(btn, info);
    }

    function sendAIModeFromDom(btn, info) {
        setPendingStatus(btn, '⏳ 转换 Markdown');
        const markdown = domToMarkdown(info.answer.container);
        markTiming('domConverted');
        if (!markdown) {
            finishStatus(btn, '❌ 内容为空');
            setTimeout(() => setBtnStatus(btn, '📖 ZenMark'), 2000);
            return;
        }
        sendMarkdownToZenMark(markdown, btn);
    }

    /**
     * 扫描页面上的每条回答，为每个工具栏注入一个按钮
     */
    function collectAIModeTargets() {
        const results = [];
        const seen = new Set();
        candidateToolbars().forEach(bar => {
            const buttons = toolbarButtons(bar);
            if (!buttons) return;
            const answer = findAnswerFor(bar, buttons);
            if (!answer) return;
            if (seen.has(answer.container)) return;
            seen.add(answer.container);
            const copy = pickCopyButton(buttons) || { best: null, turn: null, text: null };
            results.push({ bar, buttons, answer, copy });
        });
        return results;
    }

    function injectAIModeButtons() {
        if (!noteAIModeSession()) return;

        const targets = collectAIModeTargets();

        // 清理：已脱离 DOM 的按钮，以及所在回答已不在本次扫描结果里的按钮
        const validContainers = new Set(targets.map(t => t.answer.container));
        document.querySelectorAll('.ai-zenmark-btn').forEach(btn => {
            if (!document.body.contains(btn)) return btn.remove();
            const owner = btn.__zmAnswer;
            if (owner && !validContainers.has(owner)) btn.remove();
        });

        targets.forEach(info => {
            if (info.answer.container.querySelector('.ai-zenmark-btn')) return;
            const anchor = info.copy.best || info.buttons[info.buttons.length - 1];

            // 主按钮：优先“复制文字”（只要回答），没有则用整轮复制
            const btn = createZenMarkBtn(function (b) {
                copyAIMode(b, info, true);
            });
            btn.__zmAnswer = info.answer.container;
            btn.title = info.copy.text
                ? '发送到 ZenMark（只发送回答）'
                : (info.copy.turn ? '发送到 ZenMark（使用 Google 复制本条回答）' : '发送到 ZenMark（自动转换为 Markdown）');

            anchor.insertAdjacentElement('afterend', btn);
        });
    }

    /**
     * 诊断：控制台执行 __zenmarkAIDiag()
     */
    window.__zenmarkAIDiag = function() {
        if (!isGoogleSearch()) return { note: '当前不是 google.com/search 页面' };
        const targets = collectAIModeTargets();
        return {
            detected: isAIModePage(),
            answers: targets.map(t => ({
                reason: t.answer.reason,
                copyText: t.copy.text ? labelOf(t.copy.text) : null,
                copyTurn: t.copy.turn ? labelOf(t.copy.turn).slice(0, 40) : null,
                preview: domToMarkdown(t.answer.container).slice(0, 150)
            })),
            injectedButtons: document.querySelectorAll('.ai-zenmark-btn').length
        };
    };


    // ================= 页面元素查找与注入 ================= //

    function injectButtons() {
        const hostname = window.location.hostname;

        // 1. Google AI Mode（google.com/search，需匹配 udm=50 或 AI Mode DOM）
        if (isGoogleSearch()) {
            injectAIModeButtons();
        }
        // 2. 腾讯元宝
        else if (hostname.includes('yuanbao.tencent.com')) {
            injectYuanbaoButtons();
        }
        // 3. Kimi
        else if (hostname.includes('kimi.com') || hostname.includes('moonshot.cn')) {
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
        // 4. Gemini
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
        // 5. DeepSeek
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

    // 首次注入 + 兜底延迟注入（页面可能已渲染完成或异步挂载）
    injectButtons();
    setTimeout(injectButtons, 1200);
})();
