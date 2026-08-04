// ==========================================
// Settings
// ==========================================

const GOOGLE_SHEET_ID = '1kNgGyY70sbJBUcfrkrCc2KfJtB05NIAhmMd_IdBs-xw';
const GOOGLE_SHEET_GID = '0';
const SYNC_INTERVAL = 10000;
const RESERVATION_LABEL = '封鎖';

const FALLBACK_CSV = `8/22,部屋,整理番号,予約名（カタカナ）,人数,,8/23,部屋,整理番号,予約名（カタカナ）,人数
10:00－10:15,図書室,１,スズキ,４,,09:00－09:15,図書室,７３,,０
,理科室,２,スズキ,０,,,理科室,７４,,０
,美術室,３,,０,,,美術室,７５,,０
,音楽室,４,,０,,,音楽室,７６,,０
10:20－10:35,図書室,５,,０,,09:20－9:35,図書室,７７,,０
,理科室,６,,０,,,理科室,７８,,０
,美術室,７,,０,,,美術室,７９,,０
,音楽室,８,,０,,,音楽室,８０,,０`;

const CLASSROOM_DIFFICULTY = {
    '図書室': 1,
    '理科室': 2,
    '美術室': 3,
    '音楽室': 5,
};

const CLASSROOM_INFO = {
    '図書室': '古い紙の匂いが沈む部屋。静けさの奥で、ページだけが先にめくられる。',
    '理科室': '曇ったガラス器具の向こうで、まだ形にならない答えが揺れている。',
    '美術室': '色彩が現実を塗り替える場所。見たものだけを信じてはいけない。',
    '音楽室': '途切れた旋律が残る部屋。聞こえない音ほど、近くにいる。',
};

// ==========================================
// App boot
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    fetchDataAndRender();
    renderClassroomIntro();
    initAnomalyCanvas();
    initEerieEvents();
    initGravityWarp();
    startAutoSync();
});

let lastDataHash = '';

async function fetchDataAndRender() {
    let table = tableFromCsv(FALLBACK_CSV);
    let fromSheet = false;
    let fetchError = null;

    try {
        table = await loadGoogleSheetTable();
        fromSheet = table.rows.length > 0;
    } catch (error) {
        fetchError = error;
        console.error('Sheet sync failed. Fallback data will be used.', error);
    }

    const safeTable = sanitizeReservationNames(table);
    const dataHash = JSON.stringify(safeTable);
    const isUpdate = lastDataHash && dataHash !== lastDataHash;
    lastDataHash = dataHash;

    updateSyncStatus(fromSheet, fetchError);
    updateStats(summarizeReservations(table));
    renderSheetTable(safeTable, isUpdate);
    updateMap(summarizeReservations(table));
}

function updateSyncStatus(fromSheet, fetchError) {
    const statusEl = document.getElementById('sync-status');
    if (!statusEl) return;

    const lastFetched = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    if (fromSheet) {
        statusEl.textContent = '同期中 (' + lastFetched + ')';
        statusEl.className = 'text-blood-500';
    } else if (fetchError) {
        statusEl.textContent = '同期失敗: ' + (fetchError.message || 'unknown');
        statusEl.className = 'text-orange-500';
    } else {
        statusEl.textContent = '未同期';
        statusEl.className = 'text-gray-500';
    }
}

function startAutoSync() {
    setInterval(fetchDataAndRender, SYNC_INTERVAL);
    window.addEventListener('focus', fetchDataAndRender);
}

// ==========================================
// Google Sheets loading
// ==========================================

function loadGoogleSheetTable() {
    return new Promise((resolve, reject) => {
        const callbackName = '__festivalSheetCallback_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const script = document.createElement('script');
        const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error('Google Sheets response timed out'));
        }, 15000);

        window[callbackName] = (payload) => {
            cleanup();
            if (!payload || payload.status === 'error') {
                reject(new Error(payload?.errors?.[0]?.detailed_message || 'Google Sheets returned an error'));
                return;
            }
            resolve(tableFromGviz(payload.table));
        };

        script.onerror = () => {
            cleanup();
            reject(new Error('Google Sheets script could not be loaded'));
        };

        const tqx = 'out:json;responseHandler:' + callbackName;
        const params = new URLSearchParams({
            gid: GOOGLE_SHEET_GID,
            headers: '1',
            tqx,
            t: String(Date.now()),
        });
        script.src = 'https://docs.google.com/spreadsheets/d/' + GOOGLE_SHEET_ID + '/gviz/tq?' + params.toString();
        document.head.appendChild(script);

        function cleanup() {
            window.clearTimeout(timeout);
            delete window[callbackName];
            script.remove();
        }
    });
}

function tableFromGviz(gvizTable) {
    if (!gvizTable || !Array.isArray(gvizTable.cols) || !Array.isArray(gvizTable.rows)) {
        return { headers: [], rows: [] };
    }

    const headers = gvizTable.cols.map((col) => cleanCell(col.label || ''));
    const rows = gvizTable.rows
        .map((row) => {
            const cells = row.c || [];
            return headers.map((_, index) => {
                const cell = cells[index];
                if (!cell) return '';
                return cleanCell(cell.f ?? cell.v ?? '');
            });
        })
        .filter((row) => row.some((cell) => cell !== ''));

    return { headers, rows };
}

function tableFromCsv(csvText) {
    const matrix = parseCsvText(csvText);
    if (matrix.length === 0) return { headers: [], rows: [] };

    const headers = matrix[0].map(cleanCell);
    const rows = matrix.slice(1)
        .map((row) => headers.map((_, index) => cleanCell(row[index] || '')))
        .filter((row) => row.some((cell) => cell !== ''));

    return { headers, rows };
}

function parseCsvText(csvText) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const next = csvText[i + 1];

        if (char === '"' && inQuotes && next === '"') {
            cell += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') i++;
            row.push(cell);
            if (row.some((value) => value.trim() !== '')) rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }

    row.push(cell);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    return rows;
}

function cleanCell(value) {
    return String(value ?? '').trim();
}

function findReservationColumns(headers) {
    return headers
        .map((header, index) => ({ header, index }))
        .filter(({ header }) => header.includes('予約名'))
        .map(({ index }) => index);
}

function sanitizeReservationNames(table) {
    const reservationColumns = findReservationColumns(table.headers);
    const rows = table.rows.map((row) => {
        return table.headers.map((_, index) => {
            const value = row[index] || '';
            if (!reservationColumns.includes(index)) return value;
            return value.trim() ? RESERVATION_LABEL : '';
        });
    });

    return { headers: table.headers, rows, reservationColumns };
}

function summarizeReservations(table) {
    const reservationColumns = findReservationColumns(table.headers);
    const lastTimes = {};
    const result = [];

    table.rows.forEach((row) => {
        reservationColumns.forEach((nameIndex) => {
            const timeIndex = nameIndex - 3;
            const roomIndex = nameIndex - 2;
            const countIndex = nameIndex + 1;

            if (timeIndex < 0 || roomIndex < 0 || countIndex >= table.headers.length) return;
            if (row[timeIndex]) lastTimes[nameIndex] = row[timeIndex];

            const classroom = row[roomIndex] || '';
            if (!classroom) return;

            const date = table.headers[timeIndex] || '';
            const time = lastTimes[nameIndex] || '';
            const reserved = row[nameIndex] ? toNumber(row[countIndex]) : 0;

            result.push({
                date,
                time,
                classroom,
                difficulty: CLASSROOM_DIFFICULTY[classroom] || 1,
                reserved,
                sealed: Boolean(row[nameIndex]),
            });
        });
    });

    return result;
}

function toNumber(value) {
    const normalized = String(value ?? '')
        .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/[^\d-]/g, '');
    const number = parseInt(normalized, 10);
    return Number.isFinite(number) ? number : 0;
}

function slotStart(item, referenceDate = new Date()) {
    const [month, day] = item.date.split('/').map(Number);
    const startTime = (item.time || '').split(/[－\-〜～]/)[0].trim();
    const [rawHour, rawMinute] = startTime.split(':').map((part) => toNumber(part));
    if (!month || !day || !startTime) return new Date(0);

    let hour = rawHour || 0;
    const minute = rawMinute || 0;
    if (hour >= 1 && hour <= 6) hour += 12;

    return new Date(referenceDate.getFullYear(), month - 1, day, hour, minute, 0, 0);
}

// ==========================================
// Rendering
// ==========================================

function renderSheetTable(table, isUpdate = false) {
    const scheduleTable = document.querySelector('#schedule-table-wrap table');
    const tbody = document.getElementById('table-body');
    if (!scheduleTable || !tbody) return;

    const thead = scheduleTable.querySelector('thead') || scheduleTable.createTHead();
    const columnMeta = getColumnMeta(table);
    const visibleIndexes = table.headers
        .map((_, index) => index)
        .filter((index) => !columnMeta[index].isCount);

    thead.innerHTML = '';
    const headerRow = document.createElement('tr');
    headerRow.className = 'text-gray-500 text-[10px] tracking-widest border-b border-gray-800 bg-black/30';
    visibleIndexes.forEach((index) => {
        const th = document.createElement('th');
        th.className = columnClass('th', columnMeta[index], index);
        th.textContent = displayHeader(table.headers[index], columnMeta[index]);
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const previousHash = tbody.dataset.renderHash || '';
    const nextHash = JSON.stringify({ headers: table.headers, rows: table.rows, visibleIndexes });
    if (previousHash === nextHash) return;
    tbody.dataset.renderHash = nextHash;

    tbody.innerHTML = '';
    table.rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.className = 'table-row-hover transition-colors duration-300 cursor-default';

        visibleIndexes.forEach((index) => {
            const td = document.createElement('td');
            const value = row[index] || '';
            td.className = columnClass('td', columnMeta[index], index, value);
            td.textContent = value || (columnMeta[index].isGap ? '\u00A0' : '');
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });

    if (isUpdate) {
        tbody.classList.remove('sheet-updated');
        void tbody.offsetWidth;
        tbody.classList.add('sheet-updated');
    }
}

function getColumnMeta(table) {
    const reservationColumns = new Set(table.reservationColumns || findReservationColumns(table.headers));
    return table.headers.map((header, index) => {
        const isGap = !header && table.rows.every((row) => !(row[index] || '').trim());
        const isCount = header.includes('人数');
        return {
            isReservation: reservationColumns.has(index),
            isGap,
            isCount,
            isNumeric: header.includes('番号') || isCount,
            isTime: index === 0 || index === 6 || /^\d{1,2}\/\d{1,2}$/.test(header),
        };
    });
}

function displayHeader(header, meta) {
    if (meta.isReservation) return '予約状況';
    return header;
}

function columnClass(tag, meta, index, value = '') {
    const base = tag === 'th'
        ? 'font-normal whitespace-nowrap'
        : 'text-xs whitespace-nowrap';
    const align = meta.isNumeric || meta.isReservation ? ' text-right' : ' text-left';
    const tone = meta.isReservation
        ? (value ? ' reservation-cell text-blood-500 font-bold tracking-widest' : ' text-gray-700')
        : meta.isGap
            ? ' sheet-gap-cell text-gray-900 px-1'
            : index === 0 || index === 6
                ? ' text-gray-400 font-mono'
                : ' text-gray-300';

    return base + align + tone;
}

function updateStats(data) {
    const { enteredCount, remaining } = calculateStats(data);
    const countElements = document.querySelectorAll('.count-up');

    if (countElements.length >= 2) {
        countElements[0].setAttribute('data-target', enteredCount);
        countElements[1].setAttribute('data-target', remaining);
    }

    countElements.forEach((el) => {
        const target = parseInt(el.getAttribute('data-target'), 10) || 0;
        el.textContent = target;
        if (typeof anime !== 'undefined') {
            anime({ targets: el, innerHTML: [0, target], round: 1, easing: 'easeOutExpo', duration: 1200 });
        }
    });
}

function calculateStats(data, now = new Date()) {
    let totalReserved = 0;
    let entered = 0;

    data.forEach((item) => {
        totalReserved += item.reserved;
        if (item.reserved > 0 && slotStart(item, now) <= now) {
            entered += item.reserved;
        }
    });

    const enteredCount = Math.min(entered, totalReserved);
    return {
        enteredCount,
        remaining: Math.max(0, totalReserved - enteredCount),
        totalReserved,
    };
}

function updateMap(data) {
    const classroomDifficulty = {};
    data.forEach((item) => {
        if (!classroomDifficulty[item.classroom]) classroomDifficulty[item.classroom] = item.difficulty;
    });

    document.querySelectorAll('.map-cell[data-classroom]').forEach((cell) => {
        const classroomName = cell.dataset.classroom;
        const difficulty = classroomDifficulty[classroomName] || CLASSROOM_DIFFICULTY[classroomName] || 1;
        const starsEl = cell.querySelector('.difficulty-stars');
        if (starsEl) starsEl.textContent = '★'.repeat(difficulty);

        const bloodLevel = Math.min(1, difficulty / 5);
        cell.style.setProperty('--blood', bloodLevel.toFixed(2));
        cell.classList.remove('warped');
        cell.style.setProperty('--warp-x', '0px');
        cell.style.setProperty('--warp-y', '0px');
    });
}

function renderClassroomIntro() {
    const container = document.getElementById('classroom-list');
    if (!container) return;

    container.innerHTML = '';
    Object.keys(CLASSROOM_INFO).forEach((name) => {
        const difficulty = CLASSROOM_DIFFICULTY[name] || 1;
        const div = document.createElement('div');
        div.className = 'classroom-item';
        div.style.opacity = 0;
        div.style.transform = 'translateY(12px)';
        div.innerHTML = `
            <div class="classroom-name">${name}</div>
            <div class="classroom-difficulty">難度 ${'★'.repeat(difficulty)}</div>
            <div class="classroom-description">${CLASSROOM_INFO[name]}</div>
        `;
        container.appendChild(div);
    });

    const items = container.querySelectorAll('.classroom-item');
    if (typeof anime !== 'undefined') {
        anime({
            targets: items,
            opacity: [0, 1],
            translateY: [12, 0],
            easing: 'easeOutCubic',
            duration: 900,
            delay: anime.stagger(120),
        });
    } else {
        items.forEach((item) => {
            item.style.opacity = 1;
            item.style.transform = 'translateY(0)';
        });
    }
}

function initScrollAnimations() {
    const elements = document.querySelectorAll('.fade-in');
    const reveal = (el) => {
        if (typeof anime !== 'undefined') {
            anime({ targets: el, opacity: [0, 1], translateY: [10, 0], easing: 'easeOutCubic', duration: 1000 });
        } else {
            el.style.opacity = 1;
            el.style.transform = 'translateY(0)';
        }
    };

    if (!('IntersectionObserver' in window)) {
        elements.forEach(reveal);
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                reveal(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    elements.forEach((el) => observer.observe(el));
}

// ==========================================
// Visual effects
// ==========================================

function initAnomalyCanvas() {
    const canvas = document.getElementById('anomaly-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const anomalies = Array.from({ length: 8 }, createAnomaly); // 15から8に削減

    function createAnomaly() {
        const type = Math.random();
        return {
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            targetX: Math.random() * canvas.width,
            targetY: Math.random() * canvas.height,
            size: 1 + Math.random() * 3,
            opacity: 0,
            maxOpacity: 0.05 + Math.random() * 0.15,
            color: type < 0.6 ? '153, 27, 27' : type < 0.85 ? '100, 116, 139' : '200, 200, 255',
            speed: 0.1 + Math.random() * 0.4,
            phase: Math.random() * Math.PI * 2,
            phaseSpeed: 0.002 + Math.random() * 0.008,
            driftAngle: Math.random() * Math.PI * 2,
            driftSpeed: 0.1 + Math.random() * 0.3,
            life: 0,
            lifespan: 300 + Math.random() * 600,
            drawType: type < 0.3 ? 'dot' : type < 0.5 ? 'line' : type < 0.7 ? 'ring' : type < 0.85 ? 'cross' : 'blur',
            lineLength: 10 + Math.random() * 40,
            lineAngle: Math.random() * Math.PI * 2,
        };
    }

    function updateAnomaly(a) {
        a.life++;
        a.phase += a.phaseSpeed;

        const fadeInDuration = 60;
        const fadeOutStart = a.lifespan - 60;
        if (a.life < fadeInDuration) {
            a.opacity = a.maxOpacity * (a.life / fadeInDuration);
        } else if (a.life > fadeOutStart) {
            a.opacity = a.maxOpacity * ((a.lifespan - a.life) / 60);
        } else {
            a.opacity = a.maxOpacity * (0.7 + 0.3 * Math.sin(a.phase));
        }

        if (a.life >= a.lifespan) {
            Object.assign(a, createAnomaly());
            return;
        }

        const dx = a.targetX - a.x;
        const dy = a.targetY - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) {
            a.x += (dx / dist) * a.speed;
            a.y += (dy / dist) * a.speed;
        } else {
            a.targetX = Math.random() * canvas.width;
            a.targetY = Math.random() * canvas.height;
        }

        a.driftAngle += (Math.random() - 0.5) * 0.05;
        a.x += Math.cos(a.driftAngle) * a.driftSpeed * 0.3;
        a.y += Math.sin(a.driftAngle) * a.driftSpeed * 0.3;
    }

    function drawAnomaly(a) {
        if (a.opacity <= 0.001) return;
        const color = 'rgba(' + a.color + ', ' + a.opacity.toFixed(3) + ')';
        ctx.save();

        if (a.drawType === 'dot') {
            ctx.beginPath();
            ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        } else if (a.drawType === 'line') {
            const angle = a.lineAngle + Math.sin(a.phase) * 0.3;
            const len = a.lineLength * (0.5 + 0.5 * Math.sin(a.phase * 1.3));
            ctx.beginPath();
            ctx.moveTo(a.x - Math.cos(angle) * len / 2, a.y - Math.sin(angle) * len / 2);
            ctx.lineTo(a.x + Math.cos(angle) * len / 2, a.y + Math.sin(angle) * len / 2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.5;
            ctx.stroke();
        } else if (a.drawType === 'ring') {
            const radius = a.size * 3 + Math.sin(a.phase) * 2;
            ctx.beginPath();
            ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.5;
            ctx.stroke();
        } else if (a.drawType === 'cross') {
            const size = a.size * 2;
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(a.x - size, a.y);
            ctx.lineTo(a.x + size, a.y);
            ctx.moveTo(a.x, a.y - size);
            ctx.lineTo(a.x, a.y + size);
            ctx.stroke();
        } else {
            const gradient = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.size * 8);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.fillRect(a.x - a.size * 8, a.y - a.size * 8, a.size * 16, a.size * 16);
        }

        ctx.restore();
    }

    function loop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        anomalies.forEach((a) => {
            updateAnomaly(a);
            drawAnomaly(a);
        });
        requestAnimationFrame(loop);
    }
    loop();
}

function initEerieEvents() {
    const flashOverlay = document.createElement('div');
    flashOverlay.style.position = 'fixed';
    flashOverlay.style.top = 0;
    flashOverlay.style.left = 0;
    flashOverlay.style.width = '100vw';
    flashOverlay.style.height = '100vh';
    flashOverlay.style.zIndex = 9999;
    flashOverlay.style.pointerEvents = 'none';
    flashOverlay.style.opacity = 0;
    document.body.appendChild(flashOverlay);

    function triggerRandomEvent() {
        const redFlash = Math.random() > 0.5;
        flashOverlay.style.backgroundColor = redFlash ? '#991b1b' : '#000';
        flashOverlay.style.mixBlendMode = redFlash ? 'color-burn' : 'normal';
        flashOverlay.style.opacity = redFlash ? 0.35 : 0.8;
        setTimeout(() => {
            flashOverlay.style.opacity = 0;
            flashOverlay.style.mixBlendMode = 'normal';
        }, 70);
        setTimeout(triggerRandomEvent, 5000 + Math.random() * 7000);
    }

    setTimeout(triggerRandomEvent, 2000);
}

function initGravityWarp() {
    const warpElements = document.querySelectorAll('.gravity-warp');
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    warpElements.forEach((el) => {
        const updateWarpCenter = (clientX, clientY) => {
            const rect = el.getBoundingClientRect();
            const x = ((clientX - rect.left) / rect.width) * 100;
            const y = ((clientY - rect.top) / rect.height) * 100;
            el.style.setProperty('--mouse-x', x + '%');
            el.style.setProperty('--mouse-y', y + '%');

            if (el.id === 'schedule-table-wrap') warpTableRows(el, clientX, clientY);
            if (el.id === 'map-panel') warpMapCells(el, clientX, clientY);
            if (el.id === 'stat-entered' || el.id === 'stat-remaining') warpStatCard(el, x, y);
        };

        const resetWarp = () => {
            el.style.setProperty('--mouse-x', '50%');
            el.style.setProperty('--mouse-y', '50%');
            resetWarpedChildren(el);
            if (el.id === 'stat-entered' || el.id === 'stat-remaining') resetStatCard(el);
        };

        if (isTouch) {
            el.addEventListener('touchstart', () => el.classList.add('active-warp'), { passive: true });
            el.addEventListener('touchmove', (event) => {
                if (event.touches.length > 0) updateWarpCenter(event.touches[0].clientX, event.touches[0].clientY);
            }, { passive: true });
            el.addEventListener('touchend', () => {
                setTimeout(() => {
                    el.classList.remove('active-warp');
                    resetWarp();
                }, 400);
            }, { passive: true });
        } else {
            el.addEventListener('mouseenter', () => el.classList.add('active-warp'));
            el.addEventListener('mousemove', (event) => updateWarpCenter(event.clientX, event.clientY));
            el.addEventListener('mouseleave', () => {
                resetWarp();
                setTimeout(() => el.classList.remove('active-warp'), 800);
            });
        }
    });
}

function warpTableRows(container, mouseX, mouseY) {
    container
        .querySelectorAll('tbody td:not(.reservation-cell):not(.sheet-gap-cell)')
        .forEach((cell) => warpElement(cell, mouseX, mouseY, 360, 2.1));
}

function warpMapCells(container, mouseX, mouseY) {
    container.querySelectorAll('.map-cell').forEach((cell) => warpElement(cell, mouseX, mouseY, 250, 1.5));
}

function warpElement(el, mouseX, mouseY, radius, strength) {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = mouseX - centerX;
    const dy = mouseY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const influence = Math.max(0, 1 - dist / radius);
    const warpStrength = influence * strength;

    el.style.setProperty('--warp-x', (dx / dist) * warpStrength + 'px');
    el.style.setProperty('--warp-y', (dy / dist) * warpStrength + 'px');
    el.classList.add('warped');
}

function resetWarpedChildren(container) {
    container.querySelectorAll('td.warped, tr.warped, .map-cell').forEach((el) => {
        el.classList.remove('warped');
        el.style.setProperty('--warp-x', '0px');
        el.style.setProperty('--warp-y', '0px');
    });
}

function warpStatCard(el, x, y) {
    const rotateX = (y - 50) * 0.016;
    const rotateY = (x - 50) * -0.016;
    const scale = 1 + Math.abs(x - 50) / 50 * 0.004;
    el.style.transform = 'perspective(400px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) scale(' + scale + ')';
}

function resetStatCard(el) {
    el.style.transform = 'perspective(400px) rotateX(0deg) rotateY(0deg) scale(1)';
}
