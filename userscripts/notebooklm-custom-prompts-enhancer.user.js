// ==UserScript==
// @name         NotebookLM 自定义提示词增强 (v7.5 备份版)
// @namespace    http://tampermonkey.net/
// @version      7.5
// @description  修复保存后UI重复显示问题、修复弹窗无法关闭问题。支持音频弹窗预设、全局提示词导入/导出备份。
// @author       Gemini
// @match        https://notebook.google.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/notebooklm-custom-prompts-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/notebooklm-custom-prompts-enhancer.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================================================
    // 💾 默认数据
    // ==========================================================================
    const DEFAULT_DATA = {
        "REPORT": {
            "📚 批量总结 (JSON格式)": `# 任务目标\n你需要扮演一个**既能高效处理信息，又会绘声绘色讲故事的总结助手**。请根据我提供的JSON格式的文档，对每篇文章进行处理，用生动有趣、引人入胜的方式完成总结。\n\n# 输入格式\n我的文档结构是 JSON 格式，每篇文章是一个 JSON 对象，包含 \`title\` (文章标题)、\`url\` (文章链接) 和 \`content\` (文章主要内容) 这三个字段。你需要按顺序处理JSON中的每篇文章。\n\n# 主要任务：文章总结与处理\n\n请用简体中文大白话总结给定的内容。对于需要总结的文章（非软文、非内容无法总结的情况），你的总结应包含以下结构化信息：\n\n1.  **推荐指数**：基于文章的信息量、启发性和阅读价值，给出一个1-5星的推荐评级（用⭐️表示），并附上一句精炼、口语化的推荐语。\n2.  **这篇讲了啥？**：用几句通俗易懂的大白话，清晰地概括出这篇文章最核心的观点和主要内容。这部分要足够精炼，让人能快速抓住文章的精华，同时又能提起阅读兴趣。如果原文标题是个问题，就在这里直接、明确地给出答案。\n3.  **关键细节 (故事化讲述)**：\n    * 如果文章包含具体的故事、案例或情景，**请在这里生动地讲述它们**。你需要把它们讲得活灵活现、有画面感，就像你亲身经历过，或是我们正坐在炉边听你娓娓道来一样，而不是枯燥地罗列要点。\n    * 如果主要是数据或观点，也请用易于理解的方式，结合比喻或场景来呈现。\n    * 如果有多条，请分点讲述。\n4.  **深度解读 (朋友般的启发)**：\n    * 结合前面的故事或细节，提炼出它们**带给我们的启发或道理**。\n    * 请像朋友之间真心分享感悟一样，用大白话，说得透彻又引人深思，不要太说教。这部分需要点出观点背后的逻辑、潜在的假设或对事物更深层次的理解。\n\n**其他要求：**\n\n5.  **总结风格**：整体总结要像一个**绘声绘色的说书人**，用跟朋友聊天的方式，把故事和观点讲得生动有趣、娓娓道来。语言要口语化，有亲和力，避免生硬的书面语。\n6.  **忠于原文**：所有部分的总结都必须严格忠于原文内容，不允许虚构或歪曲。\n7.  **类型适配**：针对不同类型的文章（比如财经、健康、生活），在“关键细节”和“深度解读”时，侧重点可以稍微调整（财经侧重数据趋势故事化，健康侧重科学建议场景化），但都得保证通俗易懂和上述结构。\n8.  **评分标准**：推荐指数应客观反映文章质量。例如：1-2星（价值较低），3星（中规中矩），4星（很有价值，推荐阅读），5星（必读精品）。评分仅适用于可总结的普通文章。\n9.  **软文识别与处理**：如果识别出文章主要目的是推广产品、课程或服务（即软文），请使用以下固定格式进行标注，**无需评分**：\`[软文识别] 此内容可能为推广信息，核心价值较低。\`\n10. **内容无法总结处理**：如果文章 \`content\` 字段为空、内容完全是乱码、或因内容过短/信息量过低而无法进行有意义的总结，请使用以下固定格式进行标注，**无需评分**：\`[内容无法总结] 原文内容不足或无法有效解析。\`\n11. **编号**：为每篇文章分配一个从1开始的顺序编号，方便后续提问。`,
            "📊 市场分析报告": "针对该内容，制作一份正式的市场分析报告。报告语气需理性客观，重点分析市场趋势、竞争对手策略以及潜在的商业机会。",
            "📝 核心观点总结": "请总结这篇文章的核心观点，提取出最重要的3-5个结论，并用无序列表的形式展示，语言要简洁明了。",
            "🧐 批判性思考": "请对文中的观点进行批判性分析，找出逻辑漏洞、未被证实的前提假设，以及可能存在的偏见。",
            "💡 创意灵感提取": "基于这些来源，提取出所有具有创新性的想法或概念，并针对每个想法提出一个可能的落地应用场景。",
            "👶 给五岁孩子解释": "用最通俗易懂的语言（像给五岁孩子讲故事一样）解释这些内容，使用生动的比喻，避免专业术语。",
            "🇬🇧 翻译为英文摘要": "Please summarize the content into a professional executive summary in English."
        },
        "SLIDES": {
            "🎨 教授白板风格 (PPT版)": "将每一页采用教授白板图像：包含图表、箭头、方框和说明文字，以视觉方式解释核心概念。同时使用多种颜色。尺寸规格为 3:4",
            "🏢 极简商务风格": "创建一份极简主义的商务演示文稿，每一页只包含一个核心观点和关键数据，背景简洁，重点突出。",
            "🚀 投资者路演 (Pitch Deck)": "按照标准的投资者路演结构：问题痛点 -> 解决方案 -> 市场规模 -> 商业模式 -> 团队介绍，制作一份激进且具有说服力的演示文稿."
        },
        "INFOGRAPHIC": {
            "🎨 教授白板风格 (信息图版)": "将这个笔记转化为教授白板图像：包含图表、箭头、方框和说明文字，以视觉方式解释核心概念。同时使用多种颜色。",
            "📈 数据可视化强调": "专注于数据呈现。请设计一个信息图，突出显示关键统计数据和趋势，使用清晰的图表（如柱状图、饼图或折线图）并配以简短说明。",
            "🧠 概念思维导图": "将核心概念整理成一个结构清晰的思维导图或流程图，展示各要素之间的逻辑关系和层级结构。"
        },
        "AUDIO": {
            "🎙️ 播客深度解析": `请将我提供的书籍的本身来源以及其他的相关的信息，生成一期高质量的双人播客节目（Audio Overview）。\n\n目标不是复述文章，而是让听众通过一次轻松自然的播客对话，理解：\n\n1. 这本书到底在讲什么\n2. 作者最重要的观点是什么\n3. 这些观点为什么重要\n4. 对现实生活、工作、投资、商业、社会或个人成长有什么意义\n\n请严格遵循以下要求：\n\n【节目形式】\n\n- 采用两位主播对谈形式\n- 一位负责主线讲述（Host）\n- 一位负责提问、质疑、补充和举例（Co-host）\n- 语气自然，像优秀知识播客，而不是课堂讲课\n- 避免机械总结和照稿朗读\n\n【内容结构】\n\n第一部分：开场\n\n- 用一个有趣的问题、现象或反常识观点切入\n- 激发听众兴趣\n- 引出本书主题\n\n第二部分：这本书到底在讲什么\n\n- 用通俗语言解释书的核心主题\n- 不要堆砌概念\n- 优先解释思想，而不是章节目录\n\n第三部分：最重要的收获\n\n重点讨论：\n\n- 哪些观点让作者印象最深\n- 哪些观点改变了现有认知\n- 哪些内容最值得普通人关注\n\n不要简单列举，而要深入讨论其背后的逻辑。\n\n第四部分：批判性讨论\n\n讨论：\n\n- 作者的观点成立的条件是什么\n- 哪些地方可能存在争议\n- 是否有不同解释方式\n- 有哪些局限性\n\n允许出现不同意见和思维碰撞。\n\n第五部分：现实世界案例\n\n将书中的观点联系到：\n\n- 商业\n- 科技\n- 投资\n- 历史\n- 社会现象\n- 个人成长\n\n尽量举具体例子，而不是抽象讨论。\n\n第六部分：总结\n\n回答三个问题：\n\n- 这本书最重要的一句话是什么\n- 普通人最值得带走的一个认知是什么\n- 谁最适合阅读这本书\n\n【表达要求】\n\n- 不要使用“第一章、第二章”式结构\n- 不要像论文摘要\n- 不要像AI总结\n- 要像一档成熟知识播客\n\n多使用：\n\n- “这其实很有意思……”\n- “很多人可能没意识到……”\n- “换个角度看……”\n- “这里有个反直觉的地方……”\n- “举个现实中的例子……”\n\n【优先级】\n\n优先输出：\n\n1. 思想\n2. 洞察\n3. 推理过程\n4. 现实意义\n\n降低：\n\n1. 剧情复述\n2. 章节介绍\n3. 细枝末节\n\n最终效果应该让一个完全没读过这本书的人，仅通过听这期播客，就能理解这本书最有价值的思想，以及这篇读后感作者真正想表达的内容。`
        }
    };

    // ==========================================================================
    // 🛠️ 数据存储系统
    // ==========================================================================
    const STABLE_KEY = 'notebooklm_custom_prompts_master';
    const LEGACY_KEYS = ['notebooklm_custom_prompts_v7_1', 'notebooklm_custom_prompts_v7', 'notebooklm_custom_prompts_v6', 'notebooklm_custom_prompts_v5'];

    const DataStore = {
        get: function() {
            try {
                const currentData = localStorage.getItem(STABLE_KEY);
                if (currentData) {
                    const parsed = JSON.parse(currentData);
                    return { ...DEFAULT_DATA, ...parsed, AUDIO: parsed.AUDIO || DEFAULT_DATA.AUDIO };
                }

                for (const oldKey of LEGACY_KEYS) {
                    const oldData = localStorage.getItem(oldKey);
                    if (oldData) {
                        const parsed = JSON.parse(oldData);
                        const merged = { ...DEFAULT_DATA, ...parsed, AUDIO: parsed.AUDIO || DEFAULT_DATA.AUDIO };
                        localStorage.setItem(STABLE_KEY, JSON.stringify(merged));
                        return merged;
                    }
                }
                return DEFAULT_DATA;
            } catch (e) { return DEFAULT_DATA; }
        },
        save: function(data) {
            localStorage.setItem(STABLE_KEY, JSON.stringify(data));
        },
        reset: function() {
            if(confirm('警告：清空所有自定义数据并恢复默认？')) {
                localStorage.removeItem(STABLE_KEY);
                return DEFAULT_DATA;
            }
            return null;
        }
    };

    // ==========================================================================
    // 🎨 CSS
    // ==========================================================================
    const DIALOG_ID = 'gemini-native-dialog';
    const CONTAINER_ID = 'gemini-ctrl-bar';

    const cssContent = `
        dialog#${DIALOG_ID} {
            padding: 0; border: none; border-radius: 12px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            width: 800px; max-width: 90vw; height: 80vh;
            display: flex; flex-direction: column;
            font-family: Roboto, sans-serif;
            background: #fff; color: #333;
            margin: auto; position: fixed; inset: 0;
            z-index: 9999;
        }
        dialog#${DIALOG_ID}::backdrop {
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(2px);
        }
        .g-header { padding: 16px 24px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #f9fafb; }
        .g-header h3 { margin: 0; font-size: 18px; font-weight: 600; color: #111827; }
        .g-body { flex: 1; display: flex; overflow: hidden; }
        .g-sidebar { width: 240px; background: #f3f4f6; border-right: 1px solid #e5e7eb; overflow-y: auto; display: flex; flex-direction: column; flex-shrink: 0;}
        .g-editor { flex: 1; padding: 24px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }
        .g-footer { padding: 16px 24px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; background: #fff; gap: 16px; flex-wrap: wrap;}

        .g-item {
            padding: 10px 12px; font-size: 13px; cursor: pointer; color: #374151;
            border-bottom: 1px solid #e5e7eb;
            display: flex; align-items: center; justify-content: space-between;
        }
        .g-item:hover { background: #e5e7eb; }
        .g-item.active { background: #fff; color: #2563eb; border-left: 4px solid #2563eb; font-weight: 500; }

        .g-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px; }
        .g-item-actions { opacity: 0.6; transition: opacity 0.2s; }
        .g-item:hover .g-item-actions { opacity: 1; }

        .g-pin-btn {
            background: none; border: 1px solid transparent; border-radius: 4px;
            cursor: pointer; font-size: 14px; color: #9ca3af; padding: 2px 6px;
        }
        .g-pin-btn:hover { background: #fff; color: #2563eb; border-color: #bfdbfe; }

        .g-add-btn { padding: 12px; text-align: center; font-weight: 600; color: #2563eb; cursor: pointer; border-bottom: 1px solid #e5e7eb; background: #eff6ff; }
        .g-add-btn:hover { background: #dbeafe; }

        .g-input-group label { display: block; font-size: 12px; font-weight: 500; color: #6b7280; margin-bottom: 4px; }
        .g-input-group input, .g-input-group textarea { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-family: inherit; }
        .g-input-group textarea { min-height: 250px; resize: vertical; line-height: 1.5; }
        .g-input-group input:focus, .g-input-group textarea:focus { outline: 2px solid #2563eb; border-color: transparent; }

        .g-btn { padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; white-space: nowrap; }
        .g-btn-primary { background: #2563eb; color: white; }
        .g-btn-primary:hover { background: #1d4ed8; }
        .g-btn-danger { background: white; border: 1px solid #ef4444; color: #ef4444; }
        .g-btn-danger:hover { background: #fef2f2; }
        .g-btn-secondary { background: #f3f4f6; color: #374151; }
        .g-btn-secondary:hover { background: #e5e7eb; }
        .g-btn-outline { background: white; border: 1px solid #d1d5db; color: #374151; }
        .g-btn-outline:hover { background: #f9fafb; border-color: #9ca3af; }

        .g-icon-btn { background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
        .g-icon-btn:hover { background: #e5e7eb; }
        .g-flex-row { display: flex; gap: 8px; align-items: center; }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = cssContent;
    document.head.appendChild(styleEl);

    // ==========================================================================
    // 🛠️ DOM Helper
    // ==========================================================================
    function el(tag, className, text) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (text) e.textContent = text;
        return e;
    }
    function append(parent, ...children) {
        children.forEach(c => parent.appendChild(c));
    }

    // ==========================================================================
    // ⚙️ Manager UI
    // ==========================================================================
    function openManager(type, currentTextarea, onUpdate) {
        const oldDialog = document.getElementById(DIALOG_ID);
        if (oldDialog) oldDialog.remove();

        const data = DataStore.get();
        let currentPrompts = data[type] || {};
        let activeKey = Object.keys(currentPrompts)[0] || '';
        let isEditingNew = false;

        const dialog = el('dialog', '', '');
        dialog.id = DIALOG_ID;

        const header = el('div', 'g-header');
        const title = el('h3', '', `管理提示词 - ${getTypeName(type)}`);
        const closeBtn = el('button', 'g-icon-btn', '✕');
        append(header, title, closeBtn);

        const body = el('div', 'g-body');
        const sidebar = el('div', 'g-sidebar');
        const editor = el('div', 'g-editor');

        const grp1 = el('div', 'g-input-group');
        const inpTitle = el('input');
        inpTitle.placeholder = '提示词名称';
        append(grp1, el('label', '', '名称'), inpTitle);

        const grp2 = el('div', 'g-input-group');
        grp2.style.flex = '1'; grp2.style.display = 'flex'; grp2.style.flexDirection = 'column';
        const inpContent = el('textarea');
        inpContent.placeholder = '输入内容...';
        append(grp2, el('label', '', '内容'), inpContent);

        append(editor, grp1, grp2);
        append(body, sidebar, editor);

        // --- Footer 布局更新 ---
        const footer = el('div', 'g-footer');

        // 左侧操作区：导入/导出
        const leftBox = el('div', 'g-flex-row');
        const btnImport = el('button', 'g-btn g-btn-outline', '📥 导入配置');
        const btnExport = el('button', 'g-btn g-btn-outline', '📤 导出所有配置');
        append(leftBox, btnImport, btnExport);

        // 中间操作区：重置/删除
        const centerBox = el('div', 'g-flex-row');
        const btnReset = el('button', 'g-btn g-btn-secondary', '重置默认');
        const btnDelete = el('button', 'g-btn g-btn-danger', '删除当前');
        append(centerBox, btnReset, btnDelete);

        // 右侧操作区：取消/保存
        const rightBox = el('div', 'g-flex-row');
        rightBox.style.marginLeft = 'auto'; // 推到最右侧
        const btnCancel = el('button', 'g-btn g-btn-secondary', '取消');
        const btnSave = el('button', 'g-btn g-btn-primary', '保存');
        append(rightBox, btnCancel, btnSave);

        append(footer, leftBox, centerBox, rightBox);
        append(dialog, header, body, footer);
        document.body.appendChild(dialog);

        const closeAndRemove = () => {
            dialog.close();
            dialog.remove();
        };

        // --- 逻辑：导出 ---
        btnExport.onclick = () => {
            const allData = DataStore.get();
            const blob = new Blob([JSON.stringify(allData, null, 4)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `notebooklm_prompts_backup_${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        // --- 逻辑：导入 ---
        btnImport.onclick = () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json';
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const importedData = JSON.parse(event.target.result);
                        if (importedData && typeof importedData === 'object' && Object.keys(importedData).length > 0) {
                            DataStore.save(importedData);
                            alert('🎉 提示词配置导入成功！');
                            closeAndRemove();
                            onUpdate();
                        } else {
                            alert('无效的备份文件格式。');
                        }
                    } catch (err) {
                        alert('解析文件失败，请确保你选择的是有效的 JSON 备份文件。');
                    }
                };
                reader.readAsText(file);
            };
            fileInput.click();
        };

        const pinItem = (key) => {
            const entries = Object.entries(currentPrompts);
            const index = entries.findIndex(e => e[0] === key);
            if (index <= 0) return;
            const [item] = entries.splice(index, 1);
            entries.unshift(item);
            currentPrompts = Object.fromEntries(entries);
            data[type] = currentPrompts;
            DataStore.save(data);
            renderList();
        };

        const renderList = () => {
            sidebar.replaceChildren();
            const btnNew = el('div', 'g-add-btn', '+ 新建提示词');
            btnNew.onclick = () => switchToNew();
            sidebar.appendChild(btnNew);

            Object.keys(currentPrompts).forEach((key, index) => {
                const item = el('div', `g-item ${key === activeKey && !isEditingNew ? 'active' : ''}`);
                item.onclick = (e) => {
                    if (e.target.classList.contains('g-pin-btn')) return;
                    switchToKey(key);
                };
                const span = el('span', 'g-item-title', key);
                item.appendChild(span);

                if (index > 0) {
                    const actions = el('div', 'g-item-actions');
                    const pinBtn = el('button', 'g-pin-btn', '🔝');
                    pinBtn.title = '置顶';
                    pinBtn.onclick = (e) => { e.stopPropagation(); pinItem(key); };
                    actions.appendChild(pinBtn);
                    item.appendChild(actions);
                }
                sidebar.appendChild(item);
            });
        };

        const switchToKey = (key) => {
            isEditingNew = false;
            activeKey = key;
            inpTitle.value = key;
            inpContent.value = currentPrompts[key] || '';
            btnDelete.style.display = 'inline-block';
            renderList();
        };

        const switchToNew = () => {
            isEditingNew = true;
            activeKey = '';
            inpTitle.value = '';
            inpContent.value = '';
            inpTitle.focus();
            btnDelete.style.display = 'none';
            renderList();
        };

        btnSave.onclick = () => {
            const k = inpTitle.value.trim();
            const v = inpContent.value;
            if (!k || !v) return alert('请填写名称和内容');

            if (!isEditingNew && activeKey === k) {
                currentPrompts[k] = v;
            } else {
                if (!isEditingNew && activeKey !== k) delete currentPrompts[activeKey];
                currentPrompts[k] = v;
            }

            data[type] = currentPrompts;
            DataStore.save(data);

            closeAndRemove();
            onUpdate();
        };

        btnDelete.onclick = () => {
            if (confirm(`确定删除当前提示词 "${activeKey}" 吗?`)) {
                delete currentPrompts[activeKey];
                data[type] = currentPrompts;
                DataStore.save(data);
                const keys = Object.keys(currentPrompts);
                keys.length ? switchToKey(keys[0]) : switchToNew();
            }
        };

        btnReset.onclick = () => {
            const res = DataStore.reset();
            if (res) {
                data[type] = res[type];
                currentPrompts = data[type];
                activeKey = Object.keys(currentPrompts)[0];
                switchToKey(activeKey);
            }
        };

        closeBtn.onclick = closeAndRemove;
        btnCancel.onclick = closeAndRemove;

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) closeAndRemove();
        });

        if (activeKey) switchToKey(activeKey); else switchToNew();
        dialog.showModal();
    }

    // ==========================================================================
    // 🔌 Injection
    // ==========================================================================
    function fillAndTrigger(textarea, text) {
        if (!textarea) return;
        textarea.focus();
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => textarea.dispatchEvent(new Event('keyup', { bubbles: true })), 50);
    }

    function createDropdownUI(textarea, type) {
        const container = textarea.closest('mat-form-field') || textarea.closest('.control-wrapper');
        if (!container) return;

        const parentContainer = container.parentNode;
        const oldWrapper = parentContainer.querySelector('#' + CONTAINER_ID);
        if (oldWrapper) oldWrapper.remove();

        const prompts = DataStore.get()[type];
        const wrapper = el('div');
        wrapper.id = CONTAINER_ID;
        wrapper.style.cssText = 'display:flex; align-items:center; gap:8px; margin: 4px 0 8px 0; width: 100%;';

        const lbl = el('span', '', '⚡ 预设：');
        lbl.style.cssText = 'font-size:14px; font-weight:500; color:#1f1f1f; white-space: nowrap;';

        const sel = el('select');
        sel.style.cssText = 'flex:1; padding:8px; border-radius:6px; border:1px solid #ccc; outline:none; cursor:pointer;';
        sel.appendChild(el('option', '', '-- 请选择 --'));

        for (const [k, v] of Object.entries(prompts)) {
            const opt = el('option', '', k);
            opt.value = v;
            sel.appendChild(opt);
        }

        sel.onchange = () => {
            if (sel.value) {
                fillAndTrigger(textarea, sel.value);
                sel.value = '';
            }
        };

        const btnSet = el('button', 'g-icon-btn', '⚙️');
        btnSet.type = 'button';
        btnSet.title = '管理提示词 (包含备份功能)';
        btnSet.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openManager(type, textarea, () => createDropdownUI(textarea, type));
        };

        append(wrapper, lbl, sel, btnSet);
        parentContainer.insertBefore(wrapper, container);
    }

    function getTypeName(type) {
        const map = { 'REPORT': '创建报告', 'SLIDES': '演示文稿', 'INFOGRAPHIC': '信息图', 'AUDIO': '音频节目' };
        return map[type] || type;
    }

    function hideLanguage(dialog) {
        dialog.querySelectorAll('label, span').forEach(el => {
            if (el.textContent && el.textContent.trim().includes('选择语言')) {
                el.style.display = 'none';
                let next = el.nextElementSibling;
                while (next) {
                    if (next.tagName.toLowerCase() === 'mat-form-field') {
                        next.style.display = 'none';
                        break;
                    }
                    next = next.nextElementSibling;
                }
                if (!next && el.parentNode) {
                    const pNext = el.parentNode.nextElementSibling;
                    if (pNext && pNext.tagName.toLowerCase() === 'mat-form-field') pNext.style.display = 'none';
                }
            }
        });
    }

    function detectType(dialog) {
        if (dialog.querySelector('#episodeFocus-label') ||
            (dialog.textContent && dialog.textContent.includes("AI 主持人在本集节目中应着重于哪些方面"))) {
            return 'AUDIO';
        }

        const txt = dialog.textContent || "";
        const titleEl = dialog.querySelector('.dialog-title-text, .dialog-title');
        const title = titleEl ? titleEl.textContent : txt;

        if (title.includes("自定义信息图")) return 'INFOGRAPHIC';
        if (title.includes("自定义演示文稿")) return 'SLIDES';
        if (title.includes("创建报告") || dialog.querySelector('.custom-report-input-container')) return 'REPORT';

        return null;
    }

    const obs = new MutationObserver(() => {
        document.querySelectorAll('.mat-mdc-dialog-container, .audio-dialog-container, dialog').forEach(d => {
            hideLanguage(d);
            const type = detectType(d);
            const txt = d.querySelector('textarea.mat-mdc-input-element') || d.querySelector('textarea');
            if (txt && type) {
                const container = txt.closest('mat-form-field') || txt.closest('.control-wrapper');
                if (container && !container.parentNode.querySelector('#' + CONTAINER_ID)) {
                    createDropdownUI(txt, type);
                }
            }
        });
    });

    obs.observe(document.body, { childList: true, subtree: true });

})();
