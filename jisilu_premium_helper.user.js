// ==UserScript==
// @name         集思录-折溢价率新增列 v2.3
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  LOF: (现价-净值)/净值。QDII: 先用T-2净值×(1+T-1涨幅)估算净值再算折溢价率。
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

        // ===== 找表头行 =====
        let headerRow = null;
        let headerCells = [];

        for (const row of allRows) {
            const cells = Array.from(row.querySelectorAll('td, th'));
            const texts = cells.map(c => c.innerText.trim());

            // LOF 找"净值"或"基金净值"；QDII 找"T-2净值"
            const hasNav = texts.some(t => t === '基金净值' || t === '净值' || t.includes('T-2净值'));
            if (hasNav) {
                headerRow = row;
                headerCells = cells;
                break;
            }
        }

        if (!headerRow) {
            console.log('[v2.3] 未找到表头行');
            return false;
        }

        // ===== 定位列索引 =====
        let priceIdx = -1, navIdx = -1, indexChangeIdx = -1, estIdx = -1;

        headerCells.forEach((td, i) => {
            const txt = td.innerText.trim();
            if (txt.includes('现价') || txt.includes('最新价')) priceIdx = i;
            if (txt === '基金净值' || txt === '净值') navIdx = i;
            if (txt.includes('T-2净值')) navIdx = i;      // QDII
            if (txt.includes('T-1指数涨幅') || txt.includes('指数涨幅')) indexChangeIdx = i; // QDII
            if (txt.includes('实时估值') || txt.includes('估值')) estIdx = i;
        });

        console.log(`[v2.3] 模式=${isQDII ? 'QDII' : 'LOF'} | 现价=${priceIdx} 净值=${navIdx} 涨幅=${indexChangeIdx} 估值=${estIdx}`);

        if (priceIdx === -1 || navIdx === -1) return false;

        // ===== 插入表头新列（仅一次）=====
        if (!headerRow.getAttribute(MARK)) {
            const refTh = headerCells[navIdx];
            const newTh = doc.createElement(refTh.tagName);
            newTh.innerText = isQDII ? '折溢价率(估)' : '折溢价率';
            newTh.title = isQDII
                ? '(现价 - T-2净值×(1+T-1涨幅)) / T-2净值×(1+T-1涨幅) × 100%'
                : '(现价 - 净值) / 净值 × 100%';
            newTh.style.cssText = 'background:#154360;color:#fff;font-weight:bold;padding:3px 8px;text-align:center;white-space:nowrap;border:1px solid #999;';
            refTh.after(newTh);
            headerRow.setAttribute(MARK, '1');
            console.log('[v2.3] 表头列已插入');
        }

        // ===== 遍历数据行，插入计算值 =====
        const headerRowIdx = allRows.indexOf(headerRow);
        let count = 0;

        for (let r = headerRowIdx + 1; r < allRows.length; r++) {
            const row = allRows[r];
            if (row.getAttribute(MARK)) continue;

            const tds = row.querySelectorAll('td');
            if (tds.length <= Math.max(priceIdx, navIdx)) continue;

            const getNum = (idx) => {
                if (idx < 0 || !tds[idx]) return null;
                const s = tds[idx].innerText.trim().replace(/,|%/g, '');
                const v = parseFloat(s);
                return isNaN(v) ? null : v;
            };

            const price = getNum(priceIdx);
            const nav = getNum(navIdx);    // LOF: 净值; QDII: T-2净值

            let estimatedNav = null;

            if (isQDII && nav !== null) {
                // QDII: 用 T-2净值 × (1 + T-1指数涨幅%) 估算净值
                const indexChange = getNum(indexChangeIdx);
                if (indexChange !== null) {
                    estimatedNav = nav * (1 + indexChange / 100);
                    console.log(`[v2.3] T-2净值=${nav}, T-1涨幅=${indexChange}%, 估算净值=${estimatedNav.toFixed(4)}`);
                } else {
                    estimatedNav = nav; // 没有涨幅数据就直接用 T-2净值
                }
            } else {
                estimatedNav = nav; // LOF 直接用基金净值
            }

            const td1 = doc.createElement('td');
            td1.style.cssText = 'text-align:center;padding:2px 6px;white-space:nowrap;border-bottom:1px solid #e8e8e8;';

            if (price !== null && estimatedNav !== null && estimatedNav !== 0) {
                const rate = (price - estimatedNav) / estimatedNav * 100;
                const sign = rate >= 0 ? '+' : '';
                const color = rate > 0 ? '#cc0000' : (rate < 0 ? '#007700' : '#555');
                td1.innerHTML = `<b style="color:${color};font-size:12px;">${sign}${rate.toFixed(2)}%</b>`;
            } else {
                td1.innerHTML = '<span style="color:#bbb">-</span>';
            }

            tds[navIdx].after(td1);
            row.setAttribute(MARK, '1');
            count++;
        }

        console.log(`[v2.3] 完成，插入 ${count} 行`);
        return count > 0;
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
