// ==UserScript==
// @name         微信公众号内联链接自动转换（角标保留+全局URL+交互优化版）
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  保留《科技爱好者周刊》角标转换逻辑，新增全局纯文本URL转超链接，并完善鼠标悬停交互。
// @author       Gemini
// @match        https://mp.weixin.qq.com/s*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/wechat-mp-url-converter.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/wechat-mp-url-converter.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    window.addEventListener('load', () => {
        const contentDiv = document.getElementById('js_content');
        if (!contentDiv) return;

        // ==========================================
        // 模块一：保留原版角标提取与深度绑定逻辑
        // ==========================================
        const refMap = {};
        const pTags = contentDiv.querySelectorAll('p, section, span');
        pTags.forEach(el => {
            const text = el.innerText || '';
            const regex = /\[(\d+)\][^\[\]\n]*?([a-zA-Z]+:\/\/[^\s\u4e00-\u9fa5)）\]】。，]+|mailto:[^\s\u4e00-\u9fa5)）\]】。，]+)/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                refMap[match[1]] = match[2];
            }
        });

        if (Object.keys(refMap).length > 0) {
            const titleRegex = /(?:(《[^》\n]+》)|([^\s，。！？、：“”‘’（）【】《》\[\]\n]+(?:\s+[^\s，。！？、：“”‘’（）【】《》\[\]\n]+)*))\s*$/;
            const resolvedIds = new Set();

            function findTitleBackwardSafe(startNode) {
                let current = startNode;
                while (current) {
                    if (current.previousSibling) {
                        current = current.previousSibling;
                        while (current.nodeType === Node.ELEMENT_NODE && current.lastChild) {
                            if (current.nodeName === 'A') return null;
                            current = current.lastChild;
                        }
                        if (current.nodeType === Node.TEXT_NODE) {
                            const match = current.nodeValue.match(titleRegex);
                            if (match) return { node: current, title: match[0].trim() };
                            if (current.nodeValue.trim() !== '') return null;
                        } else if (current.nodeName === 'A') {
                            return null;
                        }
                    } else {
                        current = current.parentNode;
                        if (!current || current === contentDiv || current.nodeName === 'P' || current.nodeName === 'SECTION') {
                            break;
                        }
                    }
                }
                return null;
            }

            const targetNodes = [];
            const walker = document.createTreeWalker(contentDiv, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                if (/\[\d+\]/.test(walker.currentNode.nodeValue)) {
                    targetNodes.push(walker.currentNode);
                }
            }

            for (let i = 0; i < targetNodes.length; i++) {
                const node = targetNodes[i];
                if (!node.parentNode) continue;

                const text = node.nodeValue;
                const bracketRegex = /\[(\d+)\]/g;
                const nodeMatches = [];
                let match;
                while ((match = bracketRegex.exec(text)) !== null) {
                    nodeMatches.push(match);
                }

                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                let nodeModified = false;

                for (let j = 0; j < nodeMatches.length; j++) {
                    const m = nodeMatches[j];
                    const id = m[1];
                    const url = refMap[id];
                    const bracketStart = m.index;
                    const bracketEnd = bracketRegex.lastIndex;
                    const bracketStr = m[0];

                    if (!url) continue;
                    nodeModified = true;

                    if (resolvedIds.has(id)) {
                        if (bracketStart > lastIndex) {
                            fragment.appendChild(document.createTextNode(text.slice(lastIndex, bracketStart)));
                        }
                        lastIndex = bracketEnd;
                        continue;
                    }

                    const textBefore = text.slice(lastIndex, bracketStart);
                    let titleMatch = textBefore.match(titleRegex);

                    if (titleMatch) {
                        const titleText = titleMatch[0].trim();
                        const titleStartInNode = lastIndex + titleMatch.index;

                        if (titleStartInNode > lastIndex) {
                            fragment.appendChild(document.createTextNode(text.slice(lastIndex, titleStartInNode)));
                        }

                        const a = document.createElement('a');
                        a.href = url;
                        a.textContent = titleText;
                        a.target = '_blank';
                        a.style.color = '#576b95';
                        a.style.textDecoration = 'none';
                        a.style.cursor = 'pointer';
                        fragment.appendChild(a);

                        const spaces = text.slice(titleStartInNode + titleText.length, bracketStart);
                        if (spaces) fragment.appendChild(document.createTextNode(spaces));

                        resolvedIds.add(id);
                        lastIndex = bracketEnd;
                    } else {
                        if (bracketStart === 0 || text.slice(0, bracketStart).trim() === '') {
                            const backwardResult = findTitleBackwardSafe(node);
                            if (backwardResult) {
                                const { node: foundNode, title: titleText } = backwardResult;
                                const val = foundNode.nodeValue;
                                const idx = val.lastIndexOf(titleText);
                                const fragPrev = document.createDocumentFragment();

                                if (idx > 0) fragPrev.appendChild(document.createTextNode(val.slice(0, idx)));

                                const a = document.createElement('a');
                                a.href = url;
                                a.textContent = titleText;
                                a.target = '_blank';
                                a.style.color = '#576b95';
                                a.style.textDecoration = 'none';
                                a.style.cursor = 'pointer';
                                fragPrev.appendChild(a);

                                if (idx + titleText.length < val.length) {
                                    fragPrev.appendChild(document.createTextNode(val.slice(idx + titleText.length)));
                                }
                                foundNode.parentNode.replaceChild(fragPrev, foundNode);

                                if (bracketStart > lastIndex) {
                                    fragment.appendChild(document.createTextNode(text.slice(lastIndex, bracketStart)));
                                }

                                resolvedIds.add(id);
                                lastIndex = bracketEnd;
                                continue;
                            }
                        }

                        if (bracketStart > lastIndex) {
                            fragment.appendChild(document.createTextNode(text.slice(lastIndex, bracketStart)));
                        }
                        const a = document.createElement('a');
                        a.href = url;
                        a.textContent = bracketStr;
                        a.target = '_blank';
                        a.style.color = '#576b95';
                        a.style.textDecoration = 'none';
                        a.style.cursor = 'pointer';
                        fragment.appendChild(a);

                        lastIndex = bracketEnd;
                    }
                }

                if (nodeModified) {
                    if (lastIndex < text.length) {
                        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
                    }
                    node.parentNode.replaceChild(fragment, node);
                }
            }
        }

        // ==========================================
        // 模块二：新增的全局纯文本 URL 自动加链接逻辑
        // ==========================================
        const urlRegex = /https?:\/\/[^\s\u4e00-\u9fa5，。！？；：“”‘’（）【】《》\n]+/g;

        const urlWalker = document.createTreeWalker(contentDiv, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
                const parentName = node.parentNode ? node.parentNode.nodeName : '';
                if (parentName === 'A' || parentName === 'SCRIPT' || parentName === 'STYLE') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const urlNodes = [];
        let currentNode;
        while (currentNode = urlWalker.nextNode()) {
            if (currentNode.nodeValue.includes('http')) {
                urlNodes.push(currentNode);
            }
        }

        urlNodes.forEach(node => {
            const text = node.nodeValue;
            const matches = [...text.matchAll(urlRegex)];
            if (matches.length === 0) return;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            matches.forEach(match => {
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                }

                const url = match[0];
                const a = document.createElement('a');
                a.href = url;
                a.textContent = url;
                a.target = '_blank';
                a.style.color = '#576b95';
                a.style.textDecoration = 'none';
                // 新增：强制覆盖鼠标悬停指针状态
                a.style.cursor = 'pointer';

                fragment.appendChild(a);
                lastIndex = match.index + url.length;
            });

            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            if (node.parentNode) {
                node.parentNode.replaceChild(fragment, node);
            }
        });
    });
})();
