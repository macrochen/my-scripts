// ==UserScript==
// @name         范凯说AI简报 - 全板块结构化元数据终极版
// @namespace    http://tampermonkey.net/
// @version      5.6
// @description  今日优先看全要素结构化：首句精准分标题、拆解形式与状态为底部执行条、事实聚焦与琥珀黄外链
// @match        *://news.fankai.me/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/fankai-news-structured-meta.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/fankai-news-structured-meta.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1. 注入排版样式
    const style = document.createElement('style');
    style.id = 'fk-unified-style';
    style.textContent = `
        /* 消除原有列表的默认点与多余缩进 */
        article ul, main ul, .content ul, .vp-doc ul {
            list-style: none !important;
            padding-left: 0 !important;
        }

        /* 强制隐藏项 */
        .fk-hide-item {
            display: none !important;
        }

        /* 标题超链接：对齐站点原生的琥珀金黄与下划线 */
        .fk-inline-link {
            font-weight: inherit !important;
            color: #facc15 !important;
            text-decoration: underline !important;
            text-decoration-color: rgba(250, 204, 21, 0.45) !important;
            text-underline-offset: 4px !important;
            text-decoration-thickness: 1.5px !important;
            transition: color 0.15s ease !important;
        }
        .fk-inline-link:hover {
            color: #fde047 !important;
            text-decoration-color: #fde047 !important;
        }
        html:not(.dark) .fk-inline-link {
            color: #b45309 !important;
            text-decoration-color: rgba(180, 83, 9, 0.45) !important;
        }

        /* ---------------- 今日优先看 专属结构化卡片 ---------------- */
        .fk-priority-card {
            background: rgba(30, 41, 59, 0.5) !important;
            border: 1px solid rgba(148, 163, 184, 0.25) !important;
            border-radius: 10px !important;
            padding: 16px 20px !important;
            margin: 16px 0 24px 0 !important;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2) !important;
            list-style: none !important;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .fk-priority-card:hover {
            border-color: rgba(148, 163, 184, 0.45) !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
        }
        html:not(.dark) .fk-priority-card {
            background: #ffffff !important;
            border: 1px solid #e2e8f0 !important;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04) !important;
        }

        /* 优先看：独立加粗标题行 */
        .fk-priority-title-row {
            display: flex !important;
            align-items: center !important;
            flex-wrap: wrap !important;
            gap: 10px !important;
            font-size: 16px !important;
            font-weight: 700 !important;
            color: #f8fafc !important;
            line-height: 1.5 !important;
            margin-bottom: 12px !important;
            padding-bottom: 8px !important;
            border-bottom: 1px solid rgba(148, 163, 184, 0.18) !important;
        }
        html:not(.dark) .fk-priority-title-row {
            color: #0f172a !important;
            border-bottom-color: #e2e8f0 !important;
        }

        .fk-tag-top {
            background: linear-gradient(135deg, #ef4444, #f97316) !important;
            color: #ffffff !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
            letter-spacing: 0.5px !important;
            flex-shrink: 0 !important;
        }
        .fk-tag-sub {
            background: rgba(56, 189, 248, 0.2) !important;
            color: #38bdf8 !important;
            border: 1px solid rgba(56, 189, 248, 0.5) !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
            flex-shrink: 0 !important;
        }
        html:not(.dark) .fk-tag-sub {
            background: #e0f2fe !important;
            color: #0369a1 !important;
        }

        /* 优先看：正文核心看点 */
        .fk-priority-reason {
            font-size: 14.5px !important;
            line-height: 1.75 !important;
            color: #e2e8f0 !important;
            margin-bottom: 12px !important;
        }
        html:not(.dark) .fk-priority-reason {
            color: #334155 !important;
        }

        /* 优先看：切入角度/落地框架面板 */
        .fk-priority-angle {
            background: rgba(15, 23, 42, 0.5) !important;
            border-left: 3px solid #facc15 !important;
            padding: 10px 14px !important;
            border-radius: 0 6px 6px 0 !important;
            font-size: 14px !important;
            line-height: 1.65 !important;
            color: #cbd5e1 !important;
            margin-top: 10px !important;
            margin-bottom: 12px !important;
        }
        html:not(.dark) .fk-priority-angle {
            background: #f8fafc !important;
            border-left: 3px solid #d97706 !important;
            color: #475569 !important;
        }

        /* 优先看：底部元数据栏（形式与状态） */
        .fk-meta-footer {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 12px !important;
            margin-top: 12px !important;
            padding-top: 10px !important;
            border-top: 1px dashed rgba(148, 163, 184, 0.2) !important;
            font-size: 13px !important;
            line-height: 1.6 !important;
        }
        html:not(.dark) .fk-meta-footer {
            border-top-color: #e2e8f0 !important;
        }

        .fk-meta-item {
            display: inline-flex !important;
            align-items: baseline !important;
            background: rgba(15, 23, 42, 0.4) !important;
            border: 1px solid rgba(148, 163, 184, 0.2) !important;
            border-radius: 6px !important;
            padding: 4px 10px !important;
            color: #94a3b8 !important;
        }
        html:not(.dark) .fk-meta-item {
            background: #f1f5f9 !important;
            border-color: #cbd5e1 !important;
            color: #475569 !important;
        }

        .fk-meta-label {
            font-weight: 700 !important;
            color: #38bdf8 !important;
            margin-right: 6px !important;
            flex-shrink: 0 !important;
        }
        html:not(.dark) .fk-meta-label {
            color: #0284c7 !important;
        }

        .fk-meta-val {
            color: #e2e8f0 !important;
        }
        html:not(.dark) .fk-meta-val {
            color: #1e293b !important;
        }

        /* ---------------- 候选话题板块：高清晰度排版 ---------------- */
        .fk-item-fact {
            display: block !important;
            font-size: 15px !important;
            line-height: 1.8 !important;
            color: #e2e8f0 !important;
            margin: 10px 0 10px 0 !important;
            list-style: none !important;
        }
        html:not(.dark) .fk-item-fact {
            color: #1e293b !important;
        }

        .fk-item-value, .fk-observation-panel {
            display: block !important;
            background: rgba(30, 41, 59, 0.65) !important;
            border-left: 3.5px solid #38bdf8 !important;
            border-radius: 0 8px 8px 0 !important;
            padding: 12px 16px !important;
            font-size: 14.5px !important;
            line-height: 1.7 !important;
            color: #f1f5f9 !important;
            margin: 10px 0 26px 0 !important;
            list-style: none !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
        }
        html:not(.dark) .fk-item-value, html:not(.dark) .fk-observation-panel {
            background: #f0f9ff !important;
            border-left: 3.5px solid #0284c7 !important;
            color: #0f172a !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03) !important;
        }

        /* ---------------- Badge 徽标（高对比度） ---------------- */
        .fk-badge-fact {
            display: inline-block !important;
            background: #064e3b !important;
            color: #6ee7b7 !important;
            border: 1px solid #059669 !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
            margin-right: 8px !important;
            vertical-align: 1px !important;
            letter-spacing: 0.5px !important;
        }
        html:not(.dark) .fk-badge-fact {
            background: #dcfce7 !important;
            color: #15803d !important;
            border-color: #86efac !important;
        }

        .fk-badge-value {
            display: inline-block !important;
            background: #0c4a6e !important;
            color: #7dd3fc !important;
            border: 1px solid #0284c7 !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
            margin-right: 8px !important;
            vertical-align: 1px !important;
            letter-spacing: 0.5px !important;
        }
        html:not(.dark) .fk-badge-value {
            background: #e0f2fe !important;
            color: #0369a1 !important;
            border-color: #7dd3fc !important;
        }

        .fk-badge-reason {
            display: inline-block !important;
            background: #581c87 !important;
            color: #e9d5ff !important;
            border: 1px solid #9333ea !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
            margin-right: 8px !important;
            vertical-align: 1px !important;
        }

        .fk-badge-guide {
            display: inline-block !important;
            background: #713f12 !important;
            color: #fde047 !important;
            border: 1px solid #ca8a04 !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
            margin-right: 8px !important;
            vertical-align: 1px !important;
        }
    `;
    if (!document.getElementById('fk-unified-style')) {
        document.head.appendChild(style);
    }

    const OBS_REGEX = /看点\s*[(（]\s*观察\s*[)）][：:]\s*|看点观察[：:]\s*/;

    function formatHeadingLink(heading, href) {
        if (heading.dataset.fkLinked) return;
        heading.dataset.fkLinked = 'true';

        const anchor = heading.querySelector('.header-anchor');
        const cleanText = heading.textContent.replace('¶', '').trim();
        const match = cleanText.match(/^(\d+[\.、\s]+)(.*)/);

        if (match) {
            heading.innerHTML = `${match[1]}<a href="${href}" target="_blank" rel="noopener noreferrer" class="fk-inline-link" title="点击查看原帖">${match[2]}</a>`;
        } else {
            heading.innerHTML = `<a href="${href}" target="_blank" rel="noopener noreferrer" class="fk-inline-link" title="点击查看原帖">${cleanText}</a>`;
        }
        if (anchor) heading.appendChild(anchor);
    }

    // 格式化【今日优先看】：支持首句切分标题、切入角度、形式与状态元数据拆解
    function formatPriorityItem(li) {
        if (li.dataset.fkPriorityDone) return;
        li.dataset.fkPriorityDone = 'true';
        li.classList.add('fk-priority-card');

        let rawHtml = li.innerHTML;

        // 1. 提取标签：【首推】或【备选】
        let tagHtml = '';
        if (rawHtml.includes('【首推】') || rawHtml.includes('[首推]')) {
            tagHtml = '<span class="fk-tag-top">🔥 首推</span>';
            rawHtml = rawHtml.replace(/【首推】|[首推]/g, '');
        } else if (rawHtml.includes('【备选】') || rawHtml.includes('[备选]')) {
            tagHtml = '<span class="fk-tag-sub">备选</span>';
            rawHtml = rawHtml.replace(/【备选】|[备选]/g, '');
        } else if (/【(.*?)】/.test(rawHtml)) {
            const m = rawHtml.match(/【(.*?)】/);
            tagHtml = `<span class="fk-tag-sub">${m[1]}</span>`;
            rawHtml = rawHtml.replace(/【.*?】/, '');
        }

        // 2. 剥离底部元数据：形式 与 状态
        let formVal = '';
        let statusVal = '';

        // 匹配 形式：xxx 或 内容形式：xxx
        const formMatch = rawHtml.match(/(?:内容形式|形式)[：:](.*?)(?=(?:状态|选题状态)[：:]|$|<br|\n)/);
        if (formMatch) {
            formVal = formMatch[1].replace(/[；;。]\s*$/, '').trim();
            rawHtml = rawHtml.replace(formMatch[0], '');
        }

        // 匹配 状态：xxx 或 选题状态：xxx
        const statusMatch = rawHtml.match(/(?:选题状态|状态)[：:](.*?)(?=(?:内容形式|形式)[：:]|$|<br|\n)/);
        if (statusMatch) {
            statusVal = statusMatch[1].replace(/[；;。]\s*$/, '').trim();
            rawHtml = rawHtml.replace(statusMatch[0], '');
        }

        // 3. 剥离可能存在的“切入角度 / 落地框架”
        let anglePart = '';
        const hasAngle = /(可写角度|切入角度|建议框架|落地角度|角度)[：:]\s*/.test(rawHtml);
        if (hasAngle) {
            const angleSplit = rawHtml.split(/(可写角度|切入角度|建议框架|落地角度|角度)[：:]\s*/);
            if (angleSplit.length >= 3) {
                anglePart = angleSplit[2].trim();
                rawHtml = angleSplit[0].trim();
            }
        }

        // 4. 严格以第一个句号作为切分点截取标题
        let titlePart = '';
        let reasonPart = '';

        rawHtml = rawHtml.replace(/^(\d+[\.、\s]+)/, '').trim();

        const dotMatch = rawHtml.match(/(。|\.\s+)/);

        if (dotMatch) {
            const splitIdx = dotMatch.index;
            titlePart = rawHtml.substring(0, splitIdx).trim();
            reasonPart = rawHtml.substring(splitIdx + dotMatch[0].length).trim();
        } else {
            const colonMatch = rawHtml.match(/[：:]/);
            if (colonMatch) {
                titlePart = rawHtml.substring(0, colonMatch.index).trim();
                reasonPart = rawHtml.substring(colonMatch.index + 1).trim();
            } else {
                titlePart = rawHtml;
            }
        }

        titlePart = titlePart.replace(/<br\s*\/?>/gi, ' ').trim();

        // 组装底部元数据条 HTML
        let metaFooterHtml = '';
        if (formVal || statusVal) {
            metaFooterHtml = `
                <div class="fk-meta-footer">
                    ${formVal ? `<div class="fk-meta-item"><span class="fk-meta-label">📝 形式</span><span class="fk-meta-val">${formVal}</span></div>` : ''}
                    ${statusVal ? `<div class="fk-meta-item"><span class="fk-meta-label">⚡ 状态</span><span class="fk-meta-val">${statusVal}</span></div>` : ''}
                </div>
            `;
        }

        li.innerHTML = `
            <div class="fk-priority-title-row">
                ${tagHtml}
                <span>${titlePart}</span>
            </div>
            ${reasonPart ? `<div class="fk-priority-reason"><span class="fk-badge-reason">🎯 核心看点</span>${reasonPart}</div>` : ''}
            ${anglePart ? `<div class="fk-priority-angle"><span class="fk-badge-guide">📐 切入框架</span>${anglePart}</div>` : ''}
            ${metaFooterHtml}
        `;
    }

    function optimizePage() {
        const root = document.querySelector('article, main, .content, .vp-doc') || document.body;

        // 1. 为所有 H2/H3 挂载首个原帖外链
        const headings = root.querySelectorAll('h2, h3');
        headings.forEach(h => {
            let next = h.nextElementSibling;
            while (next && !['H2', 'H3'].includes(next.tagName)) {
                const link = next.querySelector('a[href^="http"]');
                const text = next.textContent.trim();
                if (link && (text.includes('原贴') || text.includes('原帖') || text.includes('@') || text.includes('作者'))) {
                    formatHeadingLink(h, link.getAttribute('href'));
                    break;
                }
                next = next.nextElementSibling;
            }
        });

        // 2. 定位并优化【今日优先看】板块
        headings.forEach(h => {
            if (h.textContent.includes('今日优先看') || h.textContent.includes('优先看')) {
                let next = h.nextElementSibling;
                while (next && !['H2', 'H3'].includes(next.tagName)) {
                    if (next.tagName === 'UL' || next.tagName === 'OL') {
                        const items = next.querySelectorAll('li');
                        items.forEach(li => {
                            formatPriorityItem(li);
                        });
                    }
                    next = next.nextElementSibling;
                }
            }
        });

        // 3. 遍历其余正文段落与列表项
        const textNodes = root.querySelectorAll('li, p');

        textNodes.forEach(el => {
            if (el.closest('.fk-priority-card')) return;

            const fullText = el.textContent.trim();

            // 3.1 针对「热点选题简报」：内容与关注点
            if (fullText.includes('内容与关注点：') || fullText.includes('内容与关注点:')) {
                if (el.querySelector('p')) return;
                el.classList.remove('fk-hide-item');
                el.classList.add('fk-item-fact');
                if (!el.dataset.fkBadge) {
                    el.innerHTML = el.innerHTML.replace(
                        /(^|[\s\S]*?)内容与关注点[：:]\s*/,
                        '<span class="fk-badge-fact">事实聚焦</span>'
                    );
                    el.dataset.fkBadge = 'true';
                }
                return;
            }

            // 3.2 针对「热点选题简报」：为什么值得做
            if (fullText.includes('为什么值得做／可写角度') || fullText.includes('为什么值得做/可写角度') || fullText.includes('为什么值得做')) {
                if (el.querySelector('p')) return;
                el.classList.remove('fk-hide-item');
                el.classList.add('fk-item-value');
                if (!el.dataset.fkBadge) {
                    el.innerHTML = el.innerHTML.replace(
                        /(^|[\s\S]*?)为什么值得做[／/]?可写角度[：:]\s*/,
                        '<span class="fk-badge-value">选题价值</span>'
                    );
                    el.dataset.fkBadge = 'true';
                }
                return;
            }

            // 3.3 针对「高流量发现」：看点（观察）切分
            if (OBS_REGEX.test(fullText)) {
                if (el.querySelector('p')) return;
                if (!el.dataset.fkObsSplit) {
                    el.dataset.fkObsSplit = 'true';
                    el.classList.add('fk-item-fact');

                    const rawHtml = el.innerHTML;
                    const parts = rawHtml.split(OBS_REGEX);

                    if (parts.length >= 2) {
                        const factContent = parts[0].trim();
                        const observationContent = parts.slice(1).join('').trim();

                        el.innerHTML = factContent;

                        const obsCard = document.createElement('div');
                        obsCard.className = 'fk-observation-panel';
                        obsCard.innerHTML = `<span class="fk-badge-value">💡 看点观察</span>${observationContent}`;
                        el.parentNode.insertBefore(obsCard, el.nextSibling);
                    }
                }
                return;
            }

            // 3.4 排除无用元数据
            if (!el.querySelector('ul, ol')) {
                const isNoise =
                    fullText.startsWith('@') ||
                    fullText.startsWith('作者：') ||
                    fullText.startsWith('作者:') ||
                    fullText.startsWith('原帖与热度') ||
                    fullText.startsWith('时效与核验') ||
                    fullText.startsWith('讨论样本') ||
                    fullText.startsWith('深度整理') ||
                    fullText.startsWith('角度样本') ||
                    fullText.startsWith('反向样本') ||
                    fullText.startsWith('质疑样本') ||
                    fullText.startsWith('条款澄清') ||
                    fullText.startsWith('主帖：') ||
                    fullText.startsWith('主帖:');

                if (isNoise) {
                    el.classList.add('fk-hide-item');
                }
            }
        });
    }

    optimizePage();
    window.addEventListener('load', optimizePage);

    let timer = null;
    const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            optimizePage();
        }, 80);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
