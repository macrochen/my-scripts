// ==UserScript==
// @name         AI 回答发送到 ZenMark (DeepSeek & Kimi & Gemini & 元宝 & Google AI Mode)
// @namespace    https://github.com/macrochen/ZenMark
// @version      1.5.10
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

    // 脚本版本（与头部 @version 保持一致，诊断时用于确认实际运行的是哪一版）
    const ZENMARK_SCRIPT_VERSION = '1.5.10';

    // 线上部署服务地址
    const ZENMARK_API_URL = 'https://zenmark-bxx.pages.dev/api/read';

    // 本次脚本实例 ID（同一页面若被多个副本注入，可通过 __zenmarkInstance 发现）
    const ZENMARK_INSTANCE_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // 当前操作触发的按钮引用
    let currentTriggerBtn = null;
    // 剪贴板拦截标记（沿用全局变量，便于调试）
    window._ai_zenmark_trigger = false;
    window.__zenmarkInstances = (window.__zenmarkInstances || []).concat([{
        id: ZENMARK_INSTANCE_ID,
        version: ZENMARK_SCRIPT_VERSION,
        at: new Date().toISOString()
    }]);
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
     * 统一 HTTP POST：优先 GM_xmlhttpRequest（可绕过 CORS），
     * 缺失时（例如 @grant none 模式）回退到 fetch。
     */
    function httpPostJSON(url, body, handlers) {
        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                data: body,
                timeout: handlers.timeout || 45000,
                onload: r => handlers.onload(r.status, r.responseText),
                onerror: err => handlers.onerror(err),
                ontimeout: () => handlers.ontimeout()
            });
            return;
        }

        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = setTimeout(() => {
            if (controller) controller.abort();
            handlers.ontimeout();
        }, handlers.timeout || 45000);

        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: body,
            signal: controller ? controller.signal : undefined
        })
            .then(r => r.text().then(text => ({ status: r.status, text: text })))
            .then(r => { clearTimeout(timer); handlers.onload(r.status, r.text); })
            .catch(err => {
                clearTimeout(timer);
                if (err && err.name === 'AbortError') return;
                handlers.onerror(err);
            });
    }

    /**
     * 打开新标签页：优先 GM_openInTab，缺失时用 window.open
     */
    function openZenMarkTab(url) {
        if (typeof GM_openInTab === 'function') {
            GM_openInTab(url, { active: true, insert: true });
            return;
        }
        window.open(url, '_blank');
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
        httpPostJSON(ZENMARK_API_URL, JSON.stringify({
            text: text,
            title: title,
            autoRead: false
        }), {
            timeout: 45000,
            onload: function(status, responseText) {
                markTiming('postDone');
                try {
                    const result = JSON.parse(responseText);
                    if (status === 200 && result.success && result.url) {
                        finishStatus(sourceBtn, '✔ 已打开');
                        openZenMarkTab(result.url);
                        markTiming('tabOpened');
                        logTiming({ payloadChars: text.length });
                    } else {
                        throw new Error(result.error || `接口返回异常 (${status})`);
                    }
                } catch (e) {
                    console.error('[ZenMark TM 错误]', e);
                    logTiming({ payloadChars: text.length, error: String(e.message || e) });
                    alert('发送失败：' + (e.message || responseText));
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
        btn.type = 'button';
        // 基础样式在插入时按“行内 / 浮层”两套方案设置（见 INLINE_BTN_CSS / OVERLAY_BTN_CSS）
        btn.style.cssText = `
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            font-size: 12px;
            line-height: 16px;
            height: 22px;
            color: #10b981;
            font-weight: 600;
            user-select: none;
            white-space: nowrap;
            background: rgba(16, 185, 129, 0.08);
            border: 1px solid rgba(16, 185, 129, 0.35);
            border-radius: 6px;
            padding: 0 7px;
            pointer-events: auto;
        `;

        // 悬停只改颜色，不改任何影响盒子尺寸的属性
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
            httpPostJSON(ZENMARK_API_URL, JSON.stringify({
                text: '# ZenMark 网络自测\n\n' + new Date().toISOString(),
                title: 'ZenMark 网络自测',
                autoRead: false
            }), {
                timeout: 60000,
                onload: (status) => resolve({ ok: status === 200, ms: Math.round(performance.now() - started), status: status }),
                onerror: () => resolve({ ok: false, ms: Math.round(performance.now() - started), error: 'network' }),
                ontimeout: () => resolve({ ok: false, ms: Math.round(performance.now() - started), error: 'timeout' })
            });
        });
    };

    /**
     * 分步自检：手动触发一次 AI Mode 注入，并返回每一步的结果。
     * 用于区分“注入没执行”与“执行了但识别不到”。
     */
    window.__zenmarkTryInject = function() {
        const steps = {};
        try {
            steps.isGoogleSearch = isGoogleSearch();
            steps.isAIModePage = isAIModePage();
            steps.urlParams = {
                udm: new URLSearchParams(location.search).get('udm'),
                path: location.pathname,
                host: location.host
            };
            steps.copyButtons = Array.from(document.querySelectorAll('[aria-label]'))
                .filter(el => AI_COPY_LABEL_RE.test(labelOf(el)))
                .map(el => el.getAttribute('aria-label'));
            steps.targets = collectAIModeTargets().map(t => ({
                reason: t.answer.reason,
                copyText: t.copy.text ? labelOf(t.copy.text) : null,
                containerCls: (t.answer.container.className || '').toString().slice(0, 40)
            }));
            steps.buttonsBefore = document.querySelectorAll('.ai-zenmark-btn').length;
            injectAIModeButtons();
            steps.buttonsAfter = document.querySelectorAll('.ai-zenmark-btn').length;
            steps.error = null;
        } catch (e) {
            steps.error = String(e && e.stack || e);
        }
        return steps;
    };

    // 元宝诊断入口：控制台执行 __zenmarkDiag()（AI Mode 的诊断见 __zenmarkAIDiag）
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

    // 按钮基础外观（两种放置方式共用）
    const BTN_BASE_CSS = 'cursor:pointer;display:inline-flex;align-items:center;justify-content:center;' +
        'box-sizing:border-box;font-size:12px;line-height:16px;height:22px;color:#10b981;font-weight:600;' +
        'user-select:none;white-space:nowrap;background:rgba(16,185,129,0.08);' +
        'border:1px solid rgba(16,185,129,0.35);border-radius:6px;padding:0 7px;';

    // 行内放置：参与工具栏布局，但禁止被压缩或换行
    const INLINE_BTN_CSS = BTN_BASE_CSS +
        'flex:0 0 auto;flex-shrink:0;align-self:center;margin-left:8px;vertical-align:middle;pointer-events:auto;';

    // 浮层放置：脱离布局（z-index 保证不被页面元素盖住）
    const OVERLAY_BTN_CSS = BTN_BASE_CSS + 'position:fixed;pointer-events:auto;z-index:2147483000;';

    // 调试开关：改成 true 时强制走「同行浮层」，完全不改动 Google 的工具栏 DOM。
    // 若某次 Google 改版后行内插入导致工具栏被撑开/错位，可临时打开它。
    const AI_MODE_FORCE_OVERLAY = false;

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
        if (AI_MODE_EXTRA_SELECTORS.length) {
            document.querySelectorAll(AI_MODE_EXTRA_SELECTORS.join(',')).forEach(el => {
                if (el.parentElement) map.set(el.parentElement, true);
            });
            return Array.from(map.keys());
        }

        // 真实结构：复制按钮常被单独包一层（如 <div><button aria-label="复制文字"/></div>），
        // 所以把“复制类按钮的父节点”和“父节点的父节点”都作为候选工具栏。
        const anchors = Array.from(document.querySelectorAll('[aria-label]'))
            .filter(el => AI_COPY_LABEL_RE.test(labelOf(el)));
        if (!anchors.length) {
            // 该版 AI Mode 若去掉了复制按钮：退化为“含 2 个以上图标按钮的紧凑按钮组”
            document.querySelectorAll('[aria-label], button, [role="button"]').forEach(el => {
                const p = el.parentElement;
                if (!p) return;
                const kids = Array.from(p.children).filter(isButtonLike);
                if (kids.length < 2) return;
                const labeled = kids.filter(k => AI_TOOLBAR_LABEL_RE.test(labelOf(k)));
                if (labeled.length >= 2) map.set(p, true);
            });
            return Array.from(map.keys());
        }

        anchors.forEach(el => {
            if (el.parentElement) map.set(el.parentElement, true);
            const gp = el.parentElement && el.parentElement.parentElement;
            if (gp && /^(DIV|SECTION|ARTICLE|LI)$/.test(gp.tagName)) map.set(gp, true);
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
            // 硬约束：跨越多条回答的外层容器不能作为回答容器
            if (spansMultipleAnswers(el)) continue;
            if (!hasSubstantialAnswer(el)) continue;
            if (hasOtherToolbar(el, bar)) continue;
            return { container: el, reason: 'depth-' + depth };
        }
        return findSiblingAnswer(bar);
    }

    /**
     * 页面上是否存在「复制文字」按钮（只要回答而不是整轮）
     */
    function hasTextCopyButton() {
        return Array.from(document.querySelectorAll('[aria-label]'))
            .some(x => /^复制文字$|^copy\s+text$/i.test(labelOf(x)));
    }

    /**
     * 统计某元素内“复制类按钮”的数量（用于排除跨回答的外层容器）
     */
    function countCopyButtons(el) {
        let n = 0;
        el.querySelectorAll('[aria-label]').forEach(x => {
            if (AI_COPY_LABEL_RE.test(labelOf(x))) n++;
        });
        return n;
    }

    /**
     * 该容器是否跨越了多条回答。
     * 同一条回答里可能同时有「复制“问题”」和「复制文字」，
     * 所以判定标准是“出现 ≥2 个「复制文字」”或“出现 ≥2 个「复制“问题”」”，
     * 而不是简单地数复制按钮个数。
     */
    function spansMultipleAnswers(el) {
        let textCount = 0;
        let turnCount = 0;
        el.querySelectorAll('[aria-label]').forEach(x => {
            const label = labelOf(x);
            if (/^复制文字$|^copy\s+text$/i.test(label)) textCount++;
            else if (/^复制\s*[“"]/.test(label)) turnCount++;
            else if (AI_COPY_LABEL_RE.test(label)) textCount++;
        });
        return textCount >= 2 || turnCount >= 2;
    }

    /**
     * 判断某个容器是不是“用户提问”区域（而不是 AI 回答）。
     * 提问区特征：文本较短、以问号结尾、没有 AI 回答常见的结构（列表/代码/引用/多段）。
     */
    function looksLikeUserQuestion(container) {
        if (!container) return false;

        // 提问容器里如果已经含 AI 回答的结构，就肯定不是提问区
        if (container.querySelector('ul, ol, table, pre, blockquote, h1, h2, h3, h4')) return false;

        const rawText = (stripChrome(container).textContent || '').replace(/\s+/g, '');
        if (!rawText) return true;

        // ① 以问号结尾的短句 → 提问（提问常带问号，回答很少以问号收尾）
        const endsWithQuestion = /[?？]\s*$/.test(rawText);
        if (endsWithQuestion && rawText.length <= 200) return true;

        // ② 短文本 + 没有多段 → 提问
        const blocks = Array.from(container.querySelectorAll('div, p'))
            .filter(c => (c.textContent || '').replace(/\s+/g, '').length >= 6);
        if (blocks.length <= 1 && rawText.length <= 150) return true;

        // ③ 短文本、段数少 → 提问
        if (blocks.length < 3 && rawText.length <= 120) return true;

        return false;
    }

    /**
     * 判断容器是否“像 AI 回答”：有结构化的回答特征。
     * 用于在提问/回答难以区分时，至少保证不会把提问当成回答注入。
     */
    function looksLikeAIAnswer(container) {
        if (!container) return false;
        // 回答常见结构：列表、代码、表格、引用、多级标题
        if (container.querySelector('ul, ol, table, pre, blockquote, h2, h3, h4')) return true;

        const text = (stripChrome(container).textContent || '').replace(/\s+/g, '');
        // 回答通常较长，且不以问号结尾
        if (text.length >= 200 && !/[?？]$/.test(text)) return true;

        // 多段落（≥3）且总长可观
        const paras = Array.from(container.querySelectorAll('div, p'))
            .filter(c => (c.textContent || '').replace(/\s+/g, '').length >= 12);
        return paras.length >= 3;
    }

    /**
     * 以复制按钮为锚点，找它所属的那条回答容器。
     * 规则：向上找第一个“含实质正文、且不包含其它复制按钮”的祖先，
     * 这样相邻回答不会被合并，也不会取到整页。
     */
    function findAnswerForCopyButton(btn) {
        const container = btn.closest('.ai-zenmark-btn');
        let el = btn.parentElement;
        for (let depth = 0; el && depth < 10; depth++, el = el.parentElement) {
            if (el.tagName === 'BODY' || el.tagName === 'HTML') break;

            // 不能跨越另一条回答
            if (spansMultipleAnswers(el)) continue;

            if (!hasSubstantialAnswer(el)) continue;
            return { container: el, reason: 'copy-anchor-' + depth };
        }
        return null;
    }

    /**
     * 兜底：工具栏与正文不是同一父级时（懒加载 / 浮动布局）。
     * 思路：在整页里收集“实质正文块”，选与工具栏最近（公共祖先最深）的那块。
     */
    function findSiblingAnswer(bar) {
        const main = document.querySelector('[role="main"]') || document.body;

        const candidates = Array.from(main.querySelectorAll('div, section, article'))
            .filter(el => !el.querySelector('.ai-zenmark-btn'))
            .filter(el => !el.contains(bar))
            .filter(el => !spansMultipleAnswers(el))
            .filter(el => hasSubstantialAnswer(el) && !hasOtherToolbar(el, el));

        if (!candidates.length) return null;

        let best = null;
        let bestDepth = -1;
        candidates.forEach(el => {
            const common = lowestCommonAncestor(el, bar);
            if (!common) return;
            const depth = depthOf(common);
            if (depth > bestDepth) {
                bestDepth = depth;
                best = el;
            }
        });

        return best ? { container: best, reason: 'lca-' + bestDepth } : null;
    }

    function lowestCommonAncestor(a, b) {
        const seen = new Set();
        for (let el = a; el; el = el.parentElement) seen.add(el);
        for (let el = b; el; el = el.parentElement) {
            if (seen.has(el)) return el;
        }
        return null;
    }

    function depthOf(el) {
        let d = 0;
        while (el && el.parentElement) { d++; el = el.parentElement; }
        return d;
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
        if (text.length < 8) return false;

        // 任意层级上有 ≥2 个“纯文字块”（div 分段）也算实质正文，
        // 不要求它们是直接子节点（真实结构里正文常被多层包裹）
        const textLeaves = Array.from(el.querySelectorAll('div, p, li, section, article'))
            .filter(c => (c.textContent || '').replace(/\s+/g, '').length >= 4)
            .filter(c => Array.from(c.children).every(k =>
                (k.textContent || '').replace(/\s+/g, '').length === 0 ||
                /^(A|SPAN|STRONG|EM|B|I|CODE)$/.test(k.tagName)));
        if (textLeaves.length >= 2) return true;

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

        // 主路径：以“复制类按钮”本身为锚点（不要求父节点里有一堆按钮）。
        // 真实结构里工具栏行常常只有 1 个真按钮 + 1 个包装 div，父节点并不“全是按钮”。
        const copyButtons = Array.from(document.querySelectorAll('[aria-label]'))
            .filter(el => AI_COPY_LABEL_RE.test(labelOf(el)));

        if (copyButtons.length) {
            // 先把每个复制按钮映射到它所属的回答容器，再按容器去重，
            // 同一回答里的「复制“问题”」和「复制文字」只用一个按钮。
            const byContainer = new Map();

            copyButtons.forEach(el => {
                const bar = el.parentElement;
                if (!bar) return;

                // 「复制“问题”」这类整轮复制按钮只作为补充信息，
                // 不作为独立锚点（提问行也有它，会造成重复注入）。
                // 「复制“问题”」= 整轮复制按钮：只要页面上存在「复制文字」，
                // 就一律不把它作为独立锚点（它紧挨着提问，anchor 会误配到提问区或整页）。
                // 这里不依赖 DOM 兄弟关系，因为真实页面里两者可能分属不同分支。
                const isTurnCopy = /^复制\s*[“"]/.test(labelOf(el));
                if (isTurnCopy && hasTextCopyButton()) return;

                // 先按“工具栏与正文同父级”匹配（旧结构），失败再用复制按钮锚点匹配
                const answer = findAnswerFor(bar, [el]) || findAnswerForCopyButton(el);
                if (!answer) return;

                // 排除用户提问区：先判“像不像回答”，再判“像不像提问”，
                // 避免提问文本较长时被误判为回答。
                if (!looksLikeAIAnswer(answer.container) && looksLikeUserQuestion(answer.container)) return;

                // 容器存在包含关系时视为同一条回答，合并到更大的容器
                let host = null;
                byContainer.forEach((info, key) => {
                    if (host) return;
                    if (key === answer.container || key.contains(answer.container)) {
                        host = info;
                    } else if (answer.container.contains(key)) {
                        // 新容器更大：迁移已有信息
                        info.answer = { container: answer.container, reason: answer.reason };
                        host = info;
                    }
                });

                if (!host) {
                    host = { bar: bar, buttons: [], answer: answer, copy: { turn: null, text: null, best: el } };
                    byContainer.set(answer.container, host);
                } else if (host.answer.container !== answer.container) {
                    // 重新以更大的容器为 key
                    byContainer.delete(host.answer.container);
                    byContainer.set(answer.container, host);
                    host.answer = { container: answer.container, reason: answer.reason };
                }

                host.buttons.push(el);
                if (/^复制文字$|^copy\s+text$/i.test(labelOf(el))) host.copy.text = el;
                else if (/^复制\s*[“"]/.test(labelOf(el))) host.copy.turn = el;
            });

            byContainer.forEach(info => {
                if (!info.copy.text && /^复制文字$|^copy\s+text$/i.test(labelOf(info.copy.best))) {
                    info.copy.text = info.copy.best;
                }
                info.copy.best = info.copy.text || info.copy.turn || info.copy.best;
                results.push(info);
            });
            return results;
        }

        // 兜底：该版 AI Mode 没有复制按钮时，用“含 ≥2 个图标按钮的紧凑按钮组”识别
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

    /**
     * 放置按钮：两条路径都保证与工具栏「同一行」
     * 1) 行内插入：挂到复制/分享/赞/踩/⋮ 那一排的末尾，随原生布局对齐；
     * 2) 同行浮层：fixed 定位到最右图标的右侧并垂直居中，不参与 Google 布局。
     */
    function placeButton(anchor, btn) {
        if (!AI_MODE_FORCE_OVERLAY && tryInlinePlacement(anchor, btn)) {
            watchInlineStability(anchor, btn);
            return;
        }
        placeButtonOverlay(anchor, btn);
    }

    /**
     * 行内放置后的持续监测：
     * Google 会在悬停/重排时重新计算工具栏布局，插入瞬间正常不代表之后也正常。
     * 一旦检测到换行或被压扁，立即改为「同行浮层」。
     */
    function watchInlineStability(anchor, btn) {
        const check = () => {
            if (!document.body.contains(btn) || !document.body.contains(anchor)) {
                cleanup();
                return;
            }
            if (btn.style.position === 'fixed') { cleanup(); return; } // 已转为浮层

            const b = btn.getBoundingClientRect();
            const a = anchor.getBoundingClientRect();
            const squashed = b.width < 55 || b.height < 16;
            // 注意：我们的按钮 22px、原生图标 ~40px，垂直居中时两者 top 天然差约 9px。
            // 旧逻辑用 top 差 >4 判定换行，会在插入后立刻误判并踢回浮层；
            // 这里改为比较「垂直中心」，只有真正掉到下一行（差 ≈ 一个行高）才切换。
            const centerDiff = Math.abs((b.top + b.height / 2) - (a.top + a.height / 2));
            const wrapped = a.height > 0 && centerDiff > Math.max(12, a.height * 0.7);

            if (squashed || wrapped) {
                console.warn('[ZenMark TM] 行内按钮发生换行/压缩，切换为同行浮层', { squashed, wrapped, centerDiff });
                btn.remove();
                cleanup();
                placeButtonOverlay(anchor, btn);
            }
        };

        let timer = 0;
        const onMove = () => {
            clearTimeout(timer);
            timer = setTimeout(check, 120);
        };

        // 悬停、滚动、尺寸变化都会触发重排
        ['mouseenter', 'mouseover', 'pointerenter'].forEach(ev =>
            btn.addEventListener(ev, onMove, true));
        window.addEventListener('resize', onMove, true);
        window.addEventListener('scroll', onMove, true);

        const cleanup = () => {
            clearTimeout(timer);
            btn.removeEventListener('mouseenter', onMove, true);
            btn.removeEventListener('mouseover', onMove, true);
            btn.removeEventListener('pointerenter', onMove, true);
            window.removeEventListener('resize', onMove, true);
            window.removeEventListener('scroll', onMove, true);
        };

        // 每 1.5s 复测一次，覆盖 Google 异步重排；按钮被移除/转浮层后自动停止
        const poll = setInterval(() => {
            if (!document.body.contains(btn) || btn.style.position === 'fixed') {
                clearInterval(poll);
                return;
            }
            check();
        }, 1500);
    }

    /**
     * 找到与锚点（复制按钮）同一排的工具栏行，以及这一排里的图标按钮。
     * 从锚点父级向外逐层找：该层至少含 2 个「和锚点垂直中心接近」的图标按钮。
     * 用「同一水平带」而不是 spansMultipleAnswers 来排除其它回答的工具栏，
     * 因为不同回答的工具栏本来就不在同一水平位置，且后者会把含多个复制按钮的
     * 单行工具栏误判成「跨回答」。
     */
    function findToolbarRow(anchor) {
        const a = anchor.getBoundingClientRect();
        if (!a.height) return null;
        const band = Math.max(14, a.height * 0.6);

        let el = anchor.parentElement;
        for (let depth = 0; el && depth < 5; depth++, el = el.parentElement) {
            if (el.tagName === 'BODY' || el.tagName === 'HTML') break;
            const icons = collectIconButtons(el);
            if (icons.length < 2) continue;
            const sameLine = icons.filter(icon => {
                const r = icon.getBoundingClientRect();
                return Math.abs((r.top + r.height / 2) - (a.top + a.height / 2)) <= band;
            });
            if (sameLine.length >= 2) return { row: el, icons: sameLine };
        }
        return null;
    }

    /**
     * 尝试把按钮插入工具栏行内。
     * 真实 DOM 里工具栏常有「图标按钮 + 包装层」的结构，
     * 所以先找到「同一排的图标组」，把按钮挂到最右一个图标之后，
     * 而不是简单 append 到某个祖先容器的末尾。
     */
    function tryInlinePlacement(anchor, btn) {
        const found = findToolbarRow(anchor);
        if (!found) return false;

        const { row, icons } = found;
        const rectOf = el => el.getBoundingClientRect();
        const rightmost = icons.reduce(
            (best, cur) => rectOf(cur).right > rectOf(best).right ? cur : best,
            icons[0]
        );
        const refRect = rectOf(rightmost);
        const beforeRowH = row.getBoundingClientRect().height;

        btn.style.cssText = INLINE_BTN_CSS;

        // 插到「同一排最后一个图标」的顶层挂载点之后，视觉上紧跟 ⋮ 更多按钮
        let mountAfter = null;
        Array.from(row.children).forEach(child => {
            if (child === rightmost || child.contains(rightmost)) mountAfter = child;
        });
        if (mountAfter) mountAfter.after(btn);
        else row.appendChild(btn);

        const b = rectOf(btn);
        // 「同一行」按垂直中心判定：按钮 22px 与图标 ~40px 都是居中对齐，
        // top 本来就不相等。旧逻辑要求 |btn.top - icon.top| <= 2，
        // 导致行内放置几乎必然被误判为换行，直接掉到下方浮层。
        const centerDiff = Math.abs((b.top + b.height / 2) - (refRect.top + refRect.height / 2));
        const sameRow = centerDiff <= Math.max(8, refRect.height / 2);
        const notSquashed = b.width >= 60 && b.height >= 18 && b.width >= btn.scrollWidth - 2;
        const rowGrew = row.getBoundingClientRect().height > beforeRowH + 2;
        const afterIcons = b.left >= refRect.right - 2; // 没有被挤回行首（换行）

        if (sameRow && notSquashed && !rowGrew && afterIcons) {
            btn.dataset.zmPlace = 'inline';
            return true;
        }

        console.warn('[ZenMark TM] 工具栏容不下按钮，改用同行浮层', {
            sameRow, notSquashed, rowGrew, afterIcons, centerDiff,
            btnW: b.width, btnTop: b.top, refTop: refRect.top
        });
        btn.remove();
        return false;
    }

    /**
     * 收集容器内的图标按钮（排除脚本自己的按钮）
     */
    function collectIconButtons(el) {
        return Array.from(el.querySelectorAll('button, [role="button"]'))
            .filter(b => !b.classList.contains('ai-zenmark-btn'))
            .filter(b => {
                const r = b.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            });
    }

    /**
     * 同行浮层：按钮不参与 Google 的布局（不会被挤到下一行、不会被压扁），
     * 但位置放在「同一排最右侧图标」的右边、垂直居中，视觉上与工具栏处于同一行。
     * 旧实现用 anchor.bottom + 4 定位，等于把按钮放到了下一行，正是本次要修的现象。
     */
    function placeButtonOverlay(anchor, btn) {
        btn.style.cssText = OVERLAY_BTN_CSS;
        btn.dataset.zmPlace = 'overlay';
        document.body.appendChild(btn);

        let raf = 0;
        let loopTimer = 0;
        let alive = true;

        const reposition = () => {
            if (!alive) return;
            if (!document.body.contains(anchor) || !document.body.contains(btn)) {
                stop();
                return;
            }
            const r = anchor.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight || r.width === 0) {
                btn.style.visibility = 'hidden';
                return;
            }
            btn.style.visibility = 'visible';

            // 水平基准：这一排最右边的图标（通常是 ⋮ 更多）
            let rightEdge = r.right;
            const found = findToolbarRow(anchor);
            if (found) {
                found.icons.forEach(icon => {
                    const ir = icon.getBoundingClientRect();
                    if (ir.width && ir.height && ir.right > rightEdge) rightEdge = ir.right;
                });
            }

            const bw = btn.offsetWidth || 90;
            const bh = btn.offsetHeight || 22;
            const maxLeft = window.innerWidth - bw - 8;
            const left = Math.min(rightEdge + 8, Math.max(8, maxLeft));
            const top = Math.max(0, r.top + (r.height - bh) / 2);

            btn.style.left = Math.round(left) + 'px';
            btn.style.top = Math.round(top) + 'px';
        };

        const schedule = () => {
            if (raf || !alive) return;
            raf = requestAnimationFrame(() => { raf = 0; reposition(); });
        };

        const stop = () => {
            alive = false;
            clearTimeout(loopTimer);
            window.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', schedule, true);
        };

        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule, true);
        reposition();

        // 低频自循环：覆盖流式输出 / 异步重排导致的工具栏位移（仅按钮存活时运行）
        const loop = () => {
            if (!alive) return;
            schedule();
            loopTimer = setTimeout(loop, 800);
        };
        loopTimer = setTimeout(loop, 800);

        // 供 injectAIModeButtons 每次重扫时主动刷新位置
        btn.__zmReposition = schedule;
    }

    function injectAIModeButtons() {
        if (!noteAIModeSession()) return;

        const targets = collectAIModeTargets();

        // 清理：已脱离 DOM 的按钮，以及所在回答已不在本次扫描结果里的按钮
        const validContainers = new Set(targets.map(t => t.answer.container));
        document.querySelectorAll('.ai-zenmark-btn').forEach(btn => {
            if (!document.body.contains(btn)) return btn.remove();
            const owner = btn.__zmAnswer;
            // 回答已不在当前扫描结果中（或回答节点已被移除）→ 一并清理浮层
            if (!owner || !validContainers.has(owner)) btn.remove();
        });

        targets.forEach(info => {
            // 浮层按钮已挂在 body 上，改用“是否已存在绑定该回答的按钮”判断
            const exist = Array.from(document.querySelectorAll('.ai-zenmark-btn'))
                .find(b => b.__zmAnswer === info.answer.container);
            if (exist) {
                // 页面重排时顺带刷新浮层位置，避免按钮与工具栏错位
                if (typeof exist.__zmReposition === 'function') exist.__zmReposition();
                return;
            }
            const anchor = info.copy.best || info.buttons[info.buttons.length - 1];

            // 主按钮：优先“复制文字”（只要回答），没有则用整轮复制
            const btn = createZenMarkBtn(function (b) {
                copyAIMode(b, info, true);
            });
            // icon-button 是 Kimi 站点用的类名，Google 页面不需要，留着可能被同名样式污染
            btn.classList.remove('icon-button');
            btn.__zmAnswer = info.answer.container;
            btn.title = info.copy.text
                ? '发送到 ZenMark（只发送回答）'
                : (info.copy.turn ? '发送到 ZenMark（使用 Google 复制本条回答）' : '发送到 ZenMark（自动转换为 Markdown）');

            btn.__zmAnchor = anchor;
            // 优先放回工具栏同一行；失败则退回「同行浮层」（仍在同一水平线）
            placeButton(anchor, btn);
        });
    }

    /**
     * 状态查询：控制台执行 __zenmarkStatus()
     * placements 里 place=inline / overlay 分别表示行内插入与同行浮层。
     */
    window.__zenmarkStatus = function() {
        const host = window.location.hostname;
        let site = 'unknown';
        if (isGoogleSearch()) site = 'google-ai-mode';
        else if (host.indexOf('yuanbao.tencent.com') !== -1) site = 'yuanbao';
        else if (host.indexOf('kimi') !== -1) site = 'kimi';
        else if (host.indexOf('gemini.google.com') !== -1) site = 'gemini';
        else if (host.indexOf('deepseek.com') !== -1) site = 'deepseek';
        return {
            version: ZENMARK_SCRIPT_VERSION,
            site: site,
            url: window.location.href,
            injectedButtons: document.querySelectorAll('.ai-zenmark-btn').length,
            placements: Array.from(document.querySelectorAll('.ai-zenmark-btn')).map(b => ({
                place: b.dataset.zmPlace || 'unknown',
                top: Math.round(b.getBoundingClientRect().top),
                left: Math.round(b.getBoundingClientRect().left)
            })),
            hasGM: typeof GM_xmlhttpRequest === 'function',
            hasUnsafeWindow: typeof unsafeWindow !== 'undefined',
            lastRun: window.__zenmarkLastRun || null
        };
    };

    /**
     * 布局诊断：控制台执行 __zenmarkLayoutDiag()
     * 逐个输出按钮的放置方式，以及它与同一排图标的垂直中心偏差。
     * sameRow=true 且 place 为 inline/overlay 都表示按钮已与工具栏同排。
     */
    window.__zenmarkLayoutDiag = function() {
        return Array.from(document.querySelectorAll('.ai-zenmark-btn')).map(btn => {
            const b = btn.getBoundingClientRect();
            const anchor = btn.__zmAnchor;
            const found = anchor ? findToolbarRow(anchor) : null;
            const icons = found ? found.icons : [];
            const ref = icons.length ? icons[0].getBoundingClientRect() : null;
            const diff = ref
                ? Math.abs((b.top + b.height / 2) - (ref.top + ref.height / 2))
                : null;
            return {
                place: btn.dataset.zmPlace || 'unknown',
                btn: { top: Math.round(b.top), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) },
                iconTop: ref ? Math.round(ref.top) : null,
                iconHeight: ref ? Math.round(ref.height) : null,
                centerDiff: diff === null ? null : Math.round(diff),
                sameRow: diff === null ? null : diff <= Math.max(8, ref.height / 2)
            };
        });
    };

    window.__zenmarkAIDiag = function() {
        if (!isGoogleSearch()) return { note: '当前不是 google.com/search 页面' };
        const targets = collectAIModeTargets();
        return {
            version: ZENMARK_SCRIPT_VERSION,
            url: window.location.href,
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


    /**
     * 结构导出：把候选工具栏及其周围的 DOM 摘要导出，用于校准选择器。
     * 输出不含回答正文内容之外的敏感信息，仅结构与标签。
     */
    function describeNode(el, depth) {
        if (!el || el.nodeType !== 1) return null;
        const cls = (el.className && el.className.toString) ? el.className.toString() : '';
        const info = {
            tag: el.tagName.toLowerCase(),
            cls: cls.split(/\s+/).filter(Boolean).slice(0, 4).join(' '),
            role: el.getAttribute('role') || undefined,
            aria: el.getAttribute('aria-label') || undefined,
            children: el.children.length
        };
        if (depth > 0) {
            info.kids = Array.from(el.children).slice(0, 8).map(c => describeNode(c, depth - 1));
        }
        return info;
    }

    function dumpAIModeDOM() {
        const out = {
            version: ZENMARK_SCRIPT_VERSION,
            url: location.href,
            bodyChildren: document.body ? document.body.children.length : 0,
            labels: [],
            toolbarCandidates: []
        };

        // 所有与复制相关的按钮
        document.querySelectorAll('[aria-label]').forEach(el => {
            const label = el.getAttribute('aria-label') || '';
            if (/复制|copy/i.test(label)) {
                out.labels.push({
                    label: label.slice(0, 60),
                    tag: el.tagName.toLowerCase(),
                    cls: ((el.className || '').toString()).slice(0, 60),
                    parentTag: el.parentElement ? el.parentElement.tagName.toLowerCase() : null,
                    parentCls: el.parentElement ? ((el.parentElement.className || '').toString()).slice(0, 60) : null,
                    parentChildren: el.parentElement ? el.parentElement.children.length : 0,
                    grandCls: el.parentElement && el.parentElement.parentElement
                        ? ((el.parentElement.parentElement.className || '').toString()).slice(0, 60) : null
                });
            }
        });

        // 以“复制文字”按钮为起点，逐级打印祖先链与每层判定（定位匹配失败点）
        out.copyTextTraces = [];
        document.querySelectorAll('[aria-label]').forEach(el => {
            if (!/^复制文字$/.test((el.getAttribute('aria-label') || '').trim())) return;
            if (out.copyTextTraces.length >= 3) return;
            const chain = [];
            let node = el;
            for (let i = 0; node && i < 8; i++, node = node.parentElement) {
                const kids = Array.from(node.children);
                chain.push({
                    depth: i,
                    tag: node.tagName.toLowerCase(),
                    cls: ((node.className || '').toString()).slice(0, 50),
                    childCount: kids.length,
                    childSummary: kids.slice(0, 10).map(k =>
                        k.tagName.toLowerCase() + (k.getAttribute('aria-label') ? '[' + (k.getAttribute('aria-label') || '').slice(0, 14) + ']' : '')
                    ).join(' | '),
                    substantial: hasSubstantialAnswer(node),
                    otherToolbar: hasOtherToolbar(node, el.parentElement || el),
                    textLen: ((node.textContent || '').replace(/\s+/g, '')).slice(0, 0).length
                });
            }
            out.copyTextTraces.push({
                parentCls: el.parentElement ? ((el.parentElement.className || '').toString()).slice(0, 50) : null,
                inCandidates: el.parentElement ? candidateToolbars().indexOf(el.parentElement) : -1,
                chain: chain
            });
        });

        // 候选工具栏：每个“复制”按钮的父节点，以及它的父级链
        candidateToolbars().slice(0, 6).forEach(bar => {
            const chain = [];
            let el = bar;
            for (let i = 0; el && i < 6; i++, el = el.parentElement) {
                chain.push(describeNode(el, 0));
            }
            out.toolbarCandidates.push({
                bar: describeNode(bar, 2),
                chain: chain,
                substantial: hasSubstantialAnswer(bar),
                otherToolbar: hasOtherToolbar(bar, bar),
                matchedAnswer: (function () {
                    try {
                        const r = findAnswerFor(bar, toolbarButtons(bar) || []);
                        return r ? r.reason : null;
                    } catch (e) { return 'err:' + e.message; }
                })()
            });
        });

        return out;
    }

    // ================= 导出到页面主世界（供浏览器控制台使用） ================= //
    // Tampermonkey 在 Chrome MV3 下默认运行在沙箱（isolated world），
    // 脚本里的 window 与 DevTools 控制台里的 window 不是同一个对象，
    // 因此必须显式导出到 unsafeWindow，控制台才能直接调用。

    function exposeDiagnostics() {
        let host = null;
        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow) host = unsafeWindow;
        } catch (e) { /* 某些模式下访问 unsafeWindow 会抛错 */ }
        if (!host || host === window) return false;

        host.__zenmarkScriptVersion = ZENMARK_SCRIPT_VERSION;
        host.__zenmarkStatus = window.__zenmarkStatus;
        host.__zenmarkDiag = window.__zenmarkDiag;
        host.__zenmarkNetTest = window.__zenmarkNetTest;
        host.__zenmarkAIDiag = window.__zenmarkAIDiag;
        host.__zenmarkLayoutDiag = window.__zenmarkLayoutDiag;
        host.__zenmarkInstances = window.__zenmarkInstances;
        host.__zenmarkShowDiag = showDiagOnPage;
        host.__zenmarkDumpDOM = dumpAIModeDOM;
        host.__zenmarkTryInject = window.__zenmarkTryInject;
        return true;
    }

    /**
     * 页面浮层诊断：控制台执行 __zenmarkShowDiag()，结果直接显示在页面上，
     * 完全不依赖控制台上下文。
     */
    function showDiagOnPage() {
        try {
            const parts = [];
            if (typeof window.__zenmarkStatus === 'function') parts.push(window.__zenmarkStatus());
            if (isGoogleSearch() && typeof window.__zenmarkAIDiag === 'function') {
                parts.push(window.__zenmarkAIDiag());
            }
            const text = JSON.stringify(parts.length === 1 ? parts[0] : parts, null, 2);

            let box = document.getElementById('zenmark-diag-box');
            if (!box) {
                box = document.createElement('pre');
                box.id = 'zenmark-diag-box';
                box.style.cssText = 'position:fixed;right:12px;bottom:12px;max-width:420px;max-height:50vh;overflow:auto;' +
                    'background:#111;color:#0f0;font:12px/1.5 monospace;padding:12px;border-radius:8px;z-index:2147483647;' +
                    'white-space:pre-wrap;box-shadow:0 8px 24px rgba(0,0,0,.4);cursor:pointer;';
                box.title = '点击关闭';
                box.addEventListener('click', () => box.remove());
                document.body.appendChild(box);
            }
            box.textContent = text;
            return text;
        } catch (e) {
            console.error('[ZenMark TM] 诊断输出失败', e);
            return String(e && e.message || e);
        }
    }

    window.__zenmarkShowDiag = showDiagOnPage;
    window.__zenmarkDumpDOM = dumpAIModeDOM;

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

    // 把诊断接口导出到页面主世界（在控制台使用前完成）
    exposeDiagnostics();

    // 首次注入 + 兜底延迟注入（页面可能已渲染完成或异步挂载）
    injectButtons();
    setTimeout(injectButtons, 1200);
})();
