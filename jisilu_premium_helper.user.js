// ==UserScript==
// @name         集思录-折溢价率新增列 v2.3
// @namespace    http://tampermonkey.net/
// @version      3.1精确
// @description  修正了将“现价涨跌幅”误认为“指数涨幅”的问题。采用严格的标题白名单匹配，保证只有真实的指数涨幅才会参与估算。
// @author       S.L
// @match        *://*.jisilu.cn/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    console.log('[v2.3] 启动');

    const MARK = 'data-jsl23';

    // 判断是否是 QDII 页面
    const isQDII = location.href.includes('/qdii');

    function processDoc(doc) {
        const allRows = Array.from(doc.querySelectorAll('tr'));
        if (allRows.length === 0) return false;

        // ===== 找所有表头行，并独立解析列索引 (基于文档流顺序) =====
        const headers = [];
        allRows.forEach((row, rIdx) => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            const texts = cells.map(c => c.innerText.trim());
            if (texts.some(t => ['基金净值', '净值', 'T-2净值', 'T-1净值'].includes(t))) {
                let priceIdx = -1, navIdx = -1, indexChangeIdx = -1, estIdx = -1;
                cells.forEach((cell, i) => {
                    const txt = cell.innerText.trim();
                    if (txt === '现价' || txt === '最新价') priceIdx = i;
                    if (['基金净值', '净值', 'T-2净值', 'T-1净值'].includes(txt)) navIdx = i;
                    // 极度精确：必须是“指数涨幅”相关的全名，绝不能匹配“涨幅”或“涨跌幅”（这就成了价格涨幅）
                    if (['T-1指数涨幅', 'T-1涨幅', '指数涨幅'].includes(txt)) indexChangeIdx = i;
                    if (txt.includes('实时估值') || txt.includes('估值')) estIdx = i;
                });
                if (navIdx !== -1) {
                    headers.push({ row, rowIdx: rIdx, cells, priceIdx, navIdx, indexChangeIdx, estIdx });
                }
            }
        });

        if (headers.length === 0) return false;

        let processedCount = 0;

        // ===== 遍历文档流中的所有行 =====
        for (let r = 0; r < allRows.length; r++) {
            const row = allRows[r];
            if (row.getAttribute(MARK)) continue;

            const tds = row.querySelectorAll('td, th');
            if (tds.length === 0) continue;

            // 寻找最靠近此行的表头上下文 (解决同一页面多张不同结构的表互相干扰)
            const matchedHeader = headers.slice().reverse().find(h => h.rowIdx <= r);
            if (!matchedHeader) continue;

            const { priceIdx, navIdx, indexChangeIdx, estIdx } = matchedHeader;

            // ===== 1. 如果当前行就是表头本身，进行表头插列 =====
            if (matchedHeader.row === row) {
                const navTh = tds[navIdx];
                if (navTh) {
                    const newTh = doc.createElement(navTh.tagName);
                    newTh.innerText = (isQDII && indexChangeIdx !== -1) ? '折溢价(估)' : '折溢价率';
                    newTh.style.cssText = 'background:#154360;color:#fff;font-weight:bold;padding:3px 8px;text-align:center;white-space:nowrap;border:1px solid #999;';
                    newTh.title = (isQDII && indexChangeIdx !== -1) ? '综合估算' : '基础现价/净值';
                    navTh.after(newTh);
                    row.setAttribute(MARK, '1');
                }
                continue;
            }

            // ===== 2. 普通数据行计算 =====
            if (tds.length <= Math.max(priceIdx, navIdx)) continue;
            if (!tds[navIdx] || tds[navIdx].innerText.trim() === '') continue;

            const getNum = (idx) => {
                if (idx < 0 || idx >= tds.length || !tds[idx]) return null;
                const txt = tds[idx].innerText.trim().replace(/,|%/g, '');
                if (txt === '-' || txt === '') return null;
                const v = parseFloat(txt);
                return isNaN(v) ? null : v;
            };

            const price = getNum(priceIdx);
            const nav = getNum(navIdx);
            const indexChange = getNum(indexChangeIdx);
            const estReal = getNum(estIdx);

            let finalRate = null;

            if (isQDII) {
                let rates = [];
                // T-1 指数估算法 (只有当前表头存在真正的涨幅列时才会触发，商品表这里就是null)
                if (nav !== null && indexChange !== null) {
                    const estNavFromIdx = nav * (1 + indexChange / 100);
                    if (price !== null) rates.push((price - estNavFromIdx) / estNavFromIdx * 100);
                }
                // 实时估值算法
                if (price !== null && estReal !== null && estReal !== 0) {
                    rates.push((price - estReal) / estReal * 100);
                }

                if (rates.length > 0) {
                    finalRate = rates.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a);
                } else if (price !== null && nav !== null && nav !== 0) {
                    // 商品类或无估值数据的直接用基础公式
                    finalRate = (price - nav) / nav * 100;
                }
            } else {
                // LOF
                const baseNav = (estReal !== null && estReal !== 0) ? estReal : nav;
                if (price !== null && baseNav !== null && baseNav !== 0) {
                    finalRate = (price - baseNav) / baseNav * 100;
                }
            }

            const td1 = doc.createElement('td');
            td1.style.cssText = 'text-align:center;padding:2px 6px;white-space:nowrap;border-bottom:1px solid #e8e8e8;';

            if (finalRate !== null) {
                const sign = finalRate >= 0 ? '+' : '';
                const color = finalRate > 0 ? '#cc0000' : (finalRate < 0 ? '#007700' : '#555');
                td1.innerHTML = `<b style="color:${color};font-size:12px;">${sign}${finalRate.toFixed(2)}%</b>`;
            } else {
                td1.innerHTML = '<span style="color:#bbb">-</span>';
            }

            tds[navIdx].after(td1);
            row.setAttribute(MARK, '1');
            processedCount++;
        }

        if (processedCount > 0) {
            console.log(`[v3.0正解] 刷新了 ${processedCount} 行数据`);
        }
        return processedCount > 0;
    }

    function run() {
        if (processDoc(document)) return;
        document.querySelectorAll('iframe').forEach(frame => {
            try {
                const iDoc = frame.contentDocument || frame.contentWindow.document;
                if (iDoc) processDoc(iDoc);
            } catch (e) { }
        });
    }

    setTimeout(run, 4000);
    setInterval(run, 6000);
})();
