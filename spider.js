(function () {
    'use strict';

    const BODY_R = 26;
    const L1 = 46, L2 = 52;
    const SOFT_EDGE = 5;
    const VIEW_GOAL_PAD = 10;
    const DRAG_LINGER = 0.4;

    const { ipcRenderer } = require('electron');
    const canvas = document.getElementById('__spider_overlay__');
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0;
    let matrixDirty = true;
    const matrixCanvas = document.createElement('canvas');
    const matrixCtx = matrixCanvas.getContext('2d');

    // АДАПТАЦИЯ ЦВЕТА К ТЕМЕ СИСТЕМЫ 
    const colorScheme = window.matchMedia('(prefers-color-scheme: light)');

    function getSpiderColors() {
        if (colorScheme.matches) {
            return {
                body: '#176b32',
                leg: '#315b42',
                legAir: '#5ca376',
                foot: '#176b32',
                glow: '#176b32'
            };
        }
        return {
            body: '#4af626',
            leg: '#3f5878',
            legAir: '#07445c',
            foot: '#4af626',
            glow: '#4af626'
        };
    }

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
        matrixDirty = true;
    }
    window.addEventListener('resize', resize);
    resize();

    let isMuted = localStorage.getItem('__spider_muted__') === 'true';
    let lastCollectedLetter = '';
    let showThoughts = true;
    let glyphs = [];
    let isMatrixVisible = true;

    function rebuildMatrixCache() {
        matrixCanvas.width = W;
        matrixCanvas.height = H;
        matrixCtx.clearRect(0, 0, W, H);
        matrixDirty = false;
        if (!isMatrixVisible || glyphs.length === 0) return;

        matrixCtx.font = 'bold 10px monospace'; 
        matrixCtx.textAlign = 'left';           // Выравнивание по левому краю
        matrixCtx.textBaseline = 'middle';
        matrixCtx.fillStyle = 'rgba(138, 184, 255, 0.05)';
        matrixCtx.shadowBlur = 0;

        for (const g of glyphs) {
            matrixCtx.fillText(g.char, g.x, g.y);
        }
    }

    // УМНАЯ ОХОТА ЗА БУКВАМИ 
    let isProcessingOCR = false;
    let lastScanTime = 0;
    const SCAN_COOLDOWN = 1500;

    async function harvest(force = false) {
        if (isProcessingOCR) return;
        const now = performance.now();
        if (!force && (now - lastScanTime < 1000)) return;

        lastScanTime = now;
        isProcessingOCR = true;
        ipcRenderer.send('capture-screen', force);
    }

    const appSpecificThoughts = {
        'code': [
            'Строка за строкой... В этом есть гармония.',
            'Опять код? Не забывай про пробелы.',
            'Красивая архитектура важнее скорости.'
        ],
        'firefox': [
            'Ищешь ответы в сети? Смотри глубже.',
            'Мир за экраном бесконечен.',
            'Потоки информации... Не утони.',
            'Больше думай сам',
            'Может включишь аниме?'
        ],
        'chrome': [
            'Ищешь ответы в сети? Смотри глубже.',
            'Мир за экраном бесконечен.',
            'Потоки информации... Не утони.'
        ],
        'telegram-desktop': [
            'Слова, слова... Кто-то слишком много пишет.',
            'Слушай тишину между сообщениями.',
            'Общение — это тоже плетение сетей.'
        ],
        'gnome-terminal': [
            'О, чистая консоль. Моя родная стихия.',
            'Команды управляют этим миром.',
            'Будь осторожен с sudo.'
        ],
        'unknown': [
            'Интересное пространство...',
            'Что это за место?',
            'Новые горизонты для созерцания.'
        ],
        'xed': [
            'Суровое редактирование',
            'Что пишешь?',
            'Это код?'
        ],
        'jetbrains-pycharm-ce': [
            'А когда моё обновление?',
            'Это новый проект?',
            'Нужен тестировщик?'
        ],
        'nemo': [
            'Открывай что-нибудь',
            'Ищешь чего? Я найду',
            'Почему не через консоль?'
        ],
        'gnome-screenshot': [
            'Я хорошо получился?',
            'Сфоткаешь?',
            'Я сегодня не фотогеничный...'
        ],
        'site-youtube': [
            'Опять видосики? А код сам себя не напишет.',
            'Вместо работы смотрим мемы...',
            'Музыка для концентрации или прокрастинация?'
        ],
        'site-github': [
            'О, залез в чужие репозитории.',
            'Ищешь готовое решение? Умный ход.',
            'Комментить не забывай, кодер.'
        ],
        'site-stackoverflow': [
            'Что, код не компилируется? Бывает.',
            'Ctrl+C, Ctrl+V спасет этот проект.',
            'Опять ищешь, почему упал продакшн?'
        ],
        'site-habr': [
            'Повышаем квалификацию со сложными статьями?',
            'Интересное чтиво. Не забудь применить в коде.'
        ]
    };

    let currentActiveApp = 'unknown';

    ipcRenderer.on('screen-captured', (event, lettersList, appClass) => {
        try {
            if (lettersList && Array.isArray(lettersList)) {
                glyphs = lettersList;
                matrixDirty = true;
            }
            if (appClass) {
                currentActiveApp = appClass;
            }
        } catch (e) {
            ipcRenderer.send('log-to-terminal', `ОШИБКА ОБНОВЛЕНИЯ МАТРИЦЫ: ${e.message}`);
        } finally {
            isProcessingOCR = false;
        }
    });

    harvest(true);

    // ===== ПАУК =====
    const spider = {
        x: W / 2,
        y: H / 2,
        vx: 0,
        vy: 0,
        angle: 0,
        goal: null,
        walkCycle: 0,
        isFlying: false
    };

    //ЛОГИКА ВЗАИМОДЕЙСТВИЯ 
    let isDraggingSpider = false;
    let isPaused = false;
    let lastRightClickTime = 0;
    let manualGoal = null;

    let waitTimer = 0;
    let idleTimer = 0;
    const IDLE_LIMIT = 45.0;
    let showQuestionMark = false;
    let collectedLetters = [];
    let showCounterTimer = 0;
    const MAX_STRING_LEN = 12;

    // Гистерезис для isFlying
    let flyTimer = 0;
    let walkTimer = 0;

    const knechtThoughts = [
        'Познай себя.',
        'Искусство требует тишины.',
        'Всё связано.',
        'Учись слушать мир.',
        'Порядок рождает свободу.',
        'Мысль — тоже странствие.',
        'Не торопись с ответом.',
        'Красота живёт в гармонии.',
        'Внимание — начало мудрости.'
    ];

    let currentThought = '';
    let thoughtTimer = 15 + Math.random() * 20;
    let thoughtVisibleTimer = 0;
    const mousePos = { x: 0, y: 0 };
    let isHoveringSpider = false;

    window.addEventListener('mousedown', (e) => {
        if (e.target.closest('#__knecht_settings_panel__')) return;
        const clickX = e.clientX;
        const clickY = e.clientY;

        if (showCounterTimer > 0) {
            const muteButtonX = spider.x + 60;
            const muteButtonY = spider.y - 35;
            if (Math.abs(clickX - muteButtonX) < 25 && Math.abs(clickY - muteButtonY) < 12) {
                isMuted = !isMuted;
                localStorage.setItem('__spider_muted__', isMuted);
                e.preventDefault();
                return;
            }
        }

        if (e.button === 0) {
            if (e.detail === 2 && Math.hypot(clickX - spider.x, clickY - spider.y) < 40) {
                collectedLetters = [];
                lastCollectedLetter = '';
                showCounterTimer = 6.0;
                resetIdle();
                return;
            }

            if (Math.hypot(clickX - spider.x, clickY - spider.y) < 40) {
                isDraggingSpider = true;
                manualGoal = null;
                waitTimer = 0;
                spider.vx = 0;
                spider.vy = 0;
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) isDraggingSpider = false;
    });

        ipcRenderer.on('global-mouse-move', (event, point) => {
        const oldX = mousePos.x;
        const oldY = mousePos.y;
        mousePos.x = point.x;
        mousePos.y = point.y;

        if (Math.abs(mousePos.x - oldX) > 1 || Math.abs(mousePos.y - oldY) > 1) {
            resetIdle();
        }
        isHoveringSpider = Math.hypot(mousePos.x - spider.x, mousePos.y - spider.y) < 40;

        // Проверяем, находится ли мышка над панелью настроек (в любом месте экрана)
        if (settingsPanel) {
            const rect = settingsPanel.getBoundingClientRect();
            isHoveringPanel = (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
        }
    });

        ipcRenderer.on('global-activity', () => {
        resetIdle();

    });

    ipcRenderer.on('global-left-double-click', () => {
        collectedLetters = [];
        lastCollectedLetter = '';
        showCounterTimer = 6.0;
        resetIdle();
        harvest(true);
    });

    ipcRenderer.on('global-right-click', (event, point) => {
        const now = performance.now();

        if (now - lastRightClickTime < 400) {
            isPaused = !isPaused;
            lastRightClickTime = 0;
            manualGoal = null;
            spider.goal = null;
            spider.vx = 0;
            spider.vy = 0;
            waitTimer = 0;
            showQuestionMark = false;
            idleTimer = 0;
            flyTimer = 0;
            walkTimer = 0;
            return;
        }

        lastRightClickTime = now;
        if (isPaused) return;

        idleTimer = 0;
        waitTimer = 0;
        showQuestionMark = false;

        glyphs = [];
        matrixDirty = true;
        harvest(true);

        manualGoal = { x: point.x, y: point.y };
        spider.goal = manualGoal;
        resetLegs();
    });

    function resetIdle() {
        idleTimer = 0;
    }

    //ЗВУК
    let audioCtx = null;
    let lastSoundTime = 0;
    const SOUND_COOLDOWN = 420;

    function initAudio() {
        if (!audioCtx) {
            const AudioContextClass = window.AppAudioContext || window.ContextClass || window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) audioCtx = new AudioContextClass();
        }
    }
    document.addEventListener('mousedown', initAudio, { once: true });

    function playStepSound(legIndex, letterObj = null) {
        if (showCounterTimer > 0 && letterObj && letterObj.char) {
            if (letterObj.char !== lastCollectedLetter) {
                lastCollectedLetter = letterObj.char;
                collectedLetters.push(letterObj);
                if (collectedLetters.length > MAX_STRING_LEN) {
                    collectedLetters.shift();
                }
            }
        } else if (showCounterTimer > 0 && !letterObj) {
            lastCollectedLetter = '';
        }

        if (isMuted || !audioCtx) return;

        const now = performance.now();
        if (now - lastSoundTime < SOUND_COOLDOWN) return;
        lastSoundTime = now;
        try {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            const baseFreq = 3200 + (legIndex % 2) * 100;
            osc.frequency.setValueAtTime(baseFreq, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.05, audioCtx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.07);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.07);
        } catch (e) {}
    }

    //ЛАПЫ
    const legs = [];
    const legOffsets = [0.75, 1.05, 1.65, 2.05];
    for (let i = 0; i < 8; i++) {
        const side = i < 4 ? -1 : 1;
        const pairIndex = i % 4;
        // Делим 8 лап на 2 четверки в шахматном порядке (0 и 1)
        const gaitGroup = (pairIndex + (side === 1 ? 1 : 0)) % 2;
        legs.push({
            i,
            side,
            pairIndex,
            gaitGroup,
            baseAngle: side * legOffsets[pairIndex],
            foot: { x: spider.x, y: spider.y },
            target: { x: spider.x, y: spider.y },
            hip: { x: spider.x, y: spider.y },
            planted: false,
            lockedGlyph: null,
            lastStepPos: null,
            stepCooldown: 0,
            stepOffsetX: 0, 
            stepOffsetY: 0  
        });
    }

    let dragTimer = 0;
    let currentSwayAmp = 0;

    function solveIK(hx, hy, fx, fy, a, b, bend) {
        const dx = fx - hx, dy = fy - hy;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) d = 0.01;
        const maxD = a + b - 0.5;
        if (d > maxD) {
            fx = hx + dx / d * maxD;
            fy = hy + dy / d * maxD;
            d = maxD;
        }
        const proj = (a * a - b * b + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, a * a - proj * proj));
        const ux = dx / d, uy = dy / d;
        const mx = hx + ux * proj, my = hy + uy * proj;
        return { x: mx - uy * h * bend, y: my + ux * h * bend };
    }

    function nearestGlyph(x, y, maxDist, legIndex = 0, occupiedList = []) {
        if (!glyphs.length) return null;
        let candidates = [];
        const maxDist2 = maxDist * maxDist;
        const MIN_DIST_FROM_CENTER = 32;
        const offset = (legIndex * 7) % glyphs.length;
        for (let i = 0; i < glyphs.length; i++) {
            const idx = (i + offset) % glyphs.length;
            const g = glyphs[idx];
            const isOccupied = occupiedList.some(occ => occ.x === g.x && occ.y === g.y);
            if (isOccupied) continue;
            const distToCenter = Math.hypot(g.x - spider.x, g.y - spider.y);
            if (distToCenter < MIN_DIST_FROM_CENTER) continue;
            const dx = g.x - x, dy = g.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < maxDist2) {
                candidates.push({ glyph: g, d2: d2 });
            }
        }
        if (!candidates.length) return null;
       candidates.sort((a, b) => a.d2 - b.d2);
        
        // Для передних лап (legIndex 0 и 4) берем более широкий разброс кандидатов
        const isFrontLeg = (legIndex % 4 === 0);
        const poolSize = Math.min(isFrontLeg ? 10 : 4, candidates.length);
        
        // Добавляем случайность или сдвиг, чтобы лапы не шагали синхронно как робот
        const index = isFrontLeg 
            ? Math.floor(Math.random() * poolSize) 
            : legIndex % poolSize;

        const chosenGlyph = candidates[index].glyph;
        occupiedList.push(chosenGlyph);
        return chosenGlyph;

    }

    let currentCornerIndex = 0;

    function pickVisibleGoal() {
        const pad = VIEW_GOAL_PAD + 40;
        if (manualGoal) return manualGoal;

        if (glyphs.length > 0) {
            const nearby = glyphs.filter(g => {
                const d = Math.hypot(g.x - spider.x, g.y - spider.y);
                return d > 60 && d < 400;
            });
            const pool = nearby.length ? nearby : glyphs;
            return pool[Math.floor(Math.random() * pool.length)];
        }

        const corners = [
            { x: pad, y: pad },
            { x: W - pad, y: pad },
            { x: W - pad, y: H - pad },
            { x: pad, y: H - pad }
        ];
        currentCornerIndex = (currentCornerIndex + 1) % corners.length;
        return corners[currentCornerIndex];
    }

        function goalVisible() {
        if (!spider.goal) return false;
        if (manualGoal && spider.goal === manualGoal) return true;
        if (glyphs.length === 0) return true;
        // Проверяем, что буква осталась рядом (в радиусе 15px), а не с точностью до 0.001 пикселя
        return glyphs.some(g => Math.hypot(g.x - spider.goal.x, g.y - spider.goal.y) < 15);
    }


    function resetLegs() {
        for (const leg of legs) {
            leg.foot.x = leg.target.x = spider.x;
            leg.foot.y = leg.target.y = spider.y;
            leg.planted = false;
            leg.lastStepPos = null;
            leg.lockedGlyph = null;
        }
    }
    
    function unplantAllLegs() {
        for (const leg of legs) {
            leg.planted = false;
            leg.lockedGlyph = null;
            leg.stepCooldown = 0;
        }
    }

    function keepOnScreen() {
        let teleported = false;
        if (spider.x < -350 || spider.x > W + 350 || spider.y < -350 || spider.y > H + 350) {
            spider.x = W / 2;
            spider.y = H / 2;
            teleported = true;
        }
        if (teleported) {
            spider.vx = 0;
            spider.vy = 0;
            manualGoal = null;
            waitTimer = 0;
            spider.goal = pickVisibleGoal();
            resetLegs();
        }
        return teleported;
    }

    let lastTime = performance.now();
    let changeGoalTimer = 15.0;
    let running = true;

    function tick(now) {
        if (!running) return;
        const prevSpiderX = spider.x;
        const prevSpiderY = spider.y;
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;
        const teleported = keepOnScreen();

        if (manualGoal || isPaused) {
            idleTimer = 0;
        } else if (!isDraggingSpider) {
            idleTimer += dt;
        }

        const isSleeping = idleTimer >= IDLE_LIMIT;

        //МЫСЛИ 
        if (isSleeping || isPaused) {
            currentThought = '';
            thoughtVisibleTimer = 0;
        } else {
            thoughtTimer -= dt;
            if (thoughtVisibleTimer > 0) {
                thoughtVisibleTimer -= dt;
                if (thoughtVisibleTimer <= 0) currentThought = '';
            }
            if (thoughtTimer <= 0 && !currentThought) {
                let pool = knechtThoughts;
                for (const key in appSpecificThoughts) {
                    if (currentActiveApp.includes(key)) {
                        pool = appSpecificThoughts[key];
                        break;
                    }
                }
                const index = Math.floor(Math.random() * pool.length);
                currentThought = pool[index];
                thoughtVisibleTimer = 6;
                thoughtTimer = 15 + Math.random() * 15;
            }
        }

        if (showCounterTimer > 0) {
            showCounterTimer -= dt;
            if (showCounterTimer <= 0) collectedLetters = [];
        }

        //ВЫБОР И ДОСТИЖЕНИЕ ЦЕЛИ
        if (waitTimer > 0) {
            waitTimer -= dt;
            spider.vx = 0;
            spider.vy = 0;
            if (waitTimer <= 0) {
                showQuestionMark = false;
                spider.goal = pickVisibleGoal();
                unplantAllLegs();
            }
        } else if (!isDraggingSpider) {
            if (!spider.goal || !goalVisible()) {
                manualGoal = null;
                spider.goal = pickVisibleGoal();
            }
            const distToGoal = Math.hypot(spider.goal.x - spider.x, spider.goal.y - spider.y);

            if (!manualGoal) {
                changeGoalTimer -= dt;
            }
            const changedMind = !manualGoal && changeGoalTimer <= 0;

            if (distToGoal < 25 || changedMind) {
                if (manualGoal && spider.goal === manualGoal) {
                    waitTimer = 1.0;
                    showQuestionMark = true;
                    manualGoal = null;
                    spider.goal = null;
                } else {
                    spider.goal = pickVisibleGoal();
                    changeGoalTimer = 11.5 + Math.random() * 8.0;
                    unplantAllLegs();
                }
            }
        }

        // ПЕРЕМЕЩЕНИЕ
        if (isDraggingSpider) {
            const dxMouse = mousePos.x - spider.x;
            const dyMouse = mousePos.y - spider.y;
            if (Math.hypot(dxMouse, dyMouse) > 2) spider.angle = Math.atan2(dyMouse, dxMouse);
            spider.x += dxMouse * 0.25;
            spider.y += dyMouse * 0.25;
            spider.vx = 0;
            spider.vy = 0;
        } else if (isPaused) {
            spider.vx = 0;
            spider.vy = 0;
        } else if (waitTimer <= 0 && spider.goal && !isSleeping) {
            const gx = spider.goal.x - spider.x;
            const gy = spider.goal.y - spider.y;
            const gl = Math.hypot(gx, gy) || 1;

            const WALK_SPEED = 34;
            const FLY_SPEED = 60;
            const speed = spider.isFlying ? FLY_SPEED : WALK_SPEED;

            const targetVx = (gx / gl) * speed;
            const targetVy = (gy / gl) * speed;

            // Асимметричное сглаживание: в полёт — быстро, при посадке — мягко
            const tau = spider.isFlying ? 0.10 : 0.25;
            const k = 1 - Math.exp(-dt / tau);
            spider.vx += (targetVx - spider.vx) * k;
            spider.vy += (targetVy - spider.vy) * k;

            spider.x += spider.vx * dt;
            spider.y += spider.vy * dt;

            if (Math.hypot(spider.vx, spider.vy) > 0.5) {
                const targetAngle = Math.atan2(spider.vy, spider.vx);
                let angleDiff = targetAngle - spider.angle;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                spider.angle += angleDiff * 0.2;
            }
        }

        let clamped = false;
        if (spider.x < SOFT_EDGE) { spider.x = SOFT_EDGE; spider.vx = Math.abs(spider.vx) * 0.5; clamped = true; }
        if (spider.x > W - SOFT_EDGE) { spider.x = W - SOFT_EDGE; spider.vx = -Math.abs(spider.vx) * 0.5; clamped = true; }
        if (spider.y < SOFT_EDGE) { spider.y = SOFT_EDGE; spider.vy = Math.abs(spider.vy) * 0.5; clamped = true; }
        if (spider.y > H - SOFT_EDGE) { spider.y = H - SOFT_EDGE; spider.vy = -Math.abs(spider.vy) * 0.5; clamped = true; }
        if (teleported || clamped) dragTimer = DRAG_LINGER;
        dragTimer = Math.max(0, dragTimer - dt);
        const dragging = (dragTimer > 0) || isSleeping;
                const occupiedGlyphs = [];
        // Сначала записываем в занятые все буквы, на которых УЖЕ стоят лапы
        for (const leg of legs) {
            if (leg.planted) {
                occupiedGlyphs.push({ x: leg.foot.x, y: leg.foot.y });
            }
        }
        let plantedCount = 0;

        // Определяем текущую активную четверку лап по фазе движения (0 или 1)
        const activeGaitGroup = Math.sin(spider.walkCycle * 1.4) >= 0 ? 0 : 1;

        //ЛАПЫ
        const dragLerp = 1 - Math.pow(1 - 0.25, dt * 60);
        const footLerp = 1 - Math.pow(1 - 0.30, dt * 60);

        for (const leg of legs) {
            const hipA = leg.baseAngle + spider.angle;
            const hx = spider.x + Math.cos(hipA) * BODY_R;
            const hy = spider.y + Math.sin(hipA) * BODY_R;
            leg.hip.x = hx;
            leg.hip.y = hy;

            if (dragging) {
                const wideA = leg.baseAngle + spider.angle;
                leg.target.x = hx + Math.cos(wideA) * 55;
                leg.target.y = hy + Math.sin(wideA) * 55;
                leg.foot.x += (leg.target.x - leg.foot.x) * dragLerp;
                leg.foot.y += (leg.target.y - leg.foot.y) * dragLerp;
                leg.planted = false;
                continue;
            }

            if (leg.stepCooldown > 0) leg.stepCooldown -= dt;

            // Дистанция, при которой лапа хочет сделать плановый шаг в свою фазу
            const releaseDistance = leg.pairIndex === 0 ? 58 : (leg.pairIndex === 1 ? 64 : 52);
            const currentLegLength = Math.hypot(leg.foot.x - hx, leg.foot.y - hy);

            // Проверка на залом лапы под туловищем или уход на чужую сторону
            const angleToFoot = Math.atan2(leg.foot.y - hy, leg.foot.x - hx);
            let angleDiff = angleToFoot - hipA;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            const isTwisted = Math.abs(angleDiff) > 1.35 || currentLegLength < 34;

            if (leg.planted) {
                const stillHasLetter = glyphs.some(g => Math.hypot(g.x - leg.foot.x, g.y - leg.foot.y) < 12);
                
                // Плановый шаг: только когда наступила очередь этой четверки лап!
                const isMyTurn = (leg.gaitGroup === activeGaitGroup);
                const plannedStep = isMyTurn && (currentLegLength > releaseDistance) && (leg.stepCooldown <= 0);

                // Экстренный шаг: буква пропала, лапу заломило или она критически растянулась (> 92)
                const emergencyStep = !stillHasLetter || isTwisted || (currentLegLength > 92);

                if (plannedStep || emergencyStep) {
                    leg.planted = false;
                }
            }

            if (leg.planted) {
                leg.lockedGlyph = null;
                plantedCount++;
            } else {
                const pairIndex = leg.pairIndex;
                // Передние лапы (0) тянутся далеко и широко, задние (2, 3) ставятся компактнее
                const reachForward = pairIndex === 0 ? 55 : (pairIndex === 1 ? 26 : 10);
                const sideSpread =   pairIndex === 0 ? 0.55 : (pairIndex === 1 ? 0.28 : 0.35);
                const reachMult =    pairIndex === 0 ? 0.65 : (pairIndex === 1 ? 0.55 : 0.42);

                let g = leg.lockedGlyph;
                if (g) {
                    const stillExists = glyphs.some(gl => gl.x === g.x && gl.y === g.y);
                    const distFromHip = Math.hypot(g.x - hx, g.y - hy);
                    const isTaken = occupiedGlyphs.some(occ => Math.hypot(occ.x - g.x, occ.y - g.y) < 10);
                    
                    if (!stillExists || distFromHip > (L1 + L2) * 0.95 || isTaken) {
                        g = null;
                        leg.lockedGlyph = null;
                    }
                }

                if (!g) {
                    const probeA = hipA + leg.side * sideSpread;
                    const probeX = hx + Math.cos(probeA) * (L1 + L2) * reachMult + Math.cos(spider.angle) * reachForward;
                    const probeY = hy + Math.sin(probeA) * (L1 + L2) * reachMult + Math.sin(spider.angle) * reachForward;
                    g = nearestGlyph(probeX, probeY, L1 + L2, leg.i, occupiedGlyphs);
                    leg.lockedGlyph = g;
                } else {
                    occupiedGlyphs.push(g);
                }

                if (g) {
                    leg.target.x = g.x;
                    leg.target.y = g.y;
                    leg.foot.x += (leg.target.x - leg.foot.x) * footLerp;
                    leg.foot.y += (leg.target.y - leg.foot.y) * footLerp;

                    if (Math.hypot(leg.target.x - leg.foot.x, leg.target.y - leg.foot.y) < 2.0) {
                        if (!leg.planted && !isPaused && !isSleeping) {
                            const movedEnough = !leg.lastStepPos ||
                                Math.hypot(g.x - leg.lastStepPos.x, g.y - leg.lastStepPos.y) > 15;
                            const forwardExtension = (leg.hip.x - spider.x) * Math.cos(spider.angle) + (leg.hip.y - spider.y) * Math.sin(spider.angle);
                            if (movedEnough && (leg.pairIndex < 2 || forwardExtension > 10)) {
                                playStepSound(leg.i, g);
                                leg.lastStepPos = { x: g.x, y: g.y };
                            }
                        }
                        leg.planted = true;
                        leg.lockedGlyph = null;
                        leg.stepCooldown = 0.15;
                        plantedCount++;
                    }
                } else {
                    const flightAngle = leg.baseAngle + spider.angle;
                    leg.target.x = hx + Math.cos(flightAngle) * 58;
                    leg.target.y = hy + Math.sin(flightAngle) * 58;
                    leg.foot.x += (leg.target.x - leg.foot.x) * footLerp;
                    leg.foot.y += (leg.target.y - leg.foot.y) * footLerp;
                    leg.planted = false;
                }
            }
        }


                // ГИСТЕРЕЗИС isFlying
        // Как только ХОТЯ БЫ ОДНА лапа касается матрицы — сразу переключаемся на шаг
        if (plantedCount > 0 && !isSleeping && !isDraggingSpider) {
            spider.isFlying = false;
            flyTimer = 0;
        } 
        // Если лап на матрице нет — включаем полёт (но с небольшой задержкой, чтобы не дёргался)
        else if (plantedCount === 0 && !isSleeping && !isDraggingSpider) {
            if (!spider.isFlying) {
                flyTimer += dt;
                if (flyTimer > 0.2) {
                    spider.isFlying = true;
                    flyTimer = 0;
                }
            }
        }

        // Принудительный сброс в покое/перетаскивании
        if (isSleeping || isDraggingSpider) {
            spider.isFlying = false;
            flyTimer = 0;
        }

        const actualDeltaX = spider.x - prevSpiderX;
        const actualDeltaY = spider.y - prevSpiderY;
        const realPixelsPerFrame = Math.hypot(actualDeltaX, actualDeltaY);
        if (!spider.isFlying) {
            if (realPixelsPerFrame > 0.05 && realPixelsPerFrame < 12.0) {
                spider.walkCycle += realPixelsPerFrame * 0.15;
            } else if (realPixelsPerFrame <= 0.05) {
                spider.walkCycle += dt * 1.5;
            }
        }

                // Если тащим панель или мышка над ней — окно должно ловить клики
        const needsMouse = isDraggingSpider || isHoveringSpider || isHoveringPanel || isDraggingPanel;
        ipcRenderer.send('set-ignore-mouse', !needsMouse);

        if (idleTimer < 1.0 && !isProcessingOCR) harvest(false);

        draw();
        requestAnimationFrame(tick);
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        const colors = getSpiderColors();

        //МАТРИЦА
        if (isMatrixVisible) {
            if (matrixDirty) rebuildMatrixCache();
            ctx.drawImage(matrixCanvas, 0, 0);

            ctx.save();
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const g of glyphs) {
                const dx = g.x - spider.x, dy = g.y - spider.y;
                const distToSpider = Math.hypot(dx, dy);
                if (distToSpider >= 150) continue;

                const alpha = (1.0 - distToSpider / 150) * 0.4;
                ctx.fillStyle = `rgba(74, 246, 38, ${alpha })`;
                ctx.shadowColor = '#4af626';
                ctx.shadowBlur = 6;
                ctx.fillText(g.char, g.x, g.y);
            }
            ctx.restore();
        }

        //ЛАПЫ
        for (const leg of legs) {
            if (leg.planted) {
                ctx.strokeStyle = 'rgba(247, 247, 247, 0.6)';
                ctx.lineWidth = 1;
                ctx.strokeRect(leg.foot.x - 4, leg.foot.y - 4, 20, 20);
            }
            const angleToFoot = Math.atan2(leg.foot.y - leg.hip.y, leg.foot.x - leg.hip.x);
            const idealLegAngle = leg.baseAngle + spider.angle;
            const dynamicBend = Math.cos(angleToFoot - idealLegAngle) < 0 ? -leg.side : leg.side;
            const knee = solveIK(leg.hip.x, leg.hip.y, leg.foot.x, leg.foot.y, L1, L2, dynamicBend);

            ctx.strokeStyle = leg.planted ? colors.leg : colors.legAir;
            ctx.lineWidth = leg.planted ? 1.8 : 1.4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(leg.hip.x, leg.hip.y);
            ctx.lineTo(knee.x, knee.y);
            ctx.lineTo(leg.foot.x, leg.foot.y);
            ctx.stroke();

            ctx.fillStyle = leg.planted ? colors.foot : '#8ab8ff';
            ctx.beginPath();
            ctx.arc(leg.foot.x, leg.foot.y, 2.8, 0, Math.PI * 2);
            ctx.fill();
        }

        //ТУЛОВИЩЕ
        ctx.save();
        const isMoving = Math.hypot(spider.vx, spider.vy) > 0.5;
        const targetAmp = spider.isFlying ? 0 : (isMoving ? 1.2 : 0.4);
        currentSwayAmp += (targetAmp - currentSwayAmp) * 0.08;
        const swayX = Math.sin(spider.walkCycle * 0.7) * 0.6 * currentSwayAmp;
        const swayY = Math.cos(spider.walkCycle * 0.35) * 1.4 * currentSwayAmp;
        ctx.translate(spider.x, spider.y);
        ctx.rotate(spider.angle);
        ctx.translate(swayX, swayY);

        ctx.fillStyle = '#00000000';
        ctx.strokeStyle = colors.body;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(-8, 0, 9, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(2, 0, 5, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = colors.body;
        ctx.beginPath();
        ctx.arc(5, -2, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(5, 2, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // ИМЯ
        if (isHoveringSpider) {
            ctx.save();
            ctx.translate(spider.x, spider.y - 35);
            ctx.font = 'bold 12px sans-serif';
            const textWidth = ctx.measureText('Knecht').width;
            ctx.fillStyle = 'rgba(20, 30, 45, 0.85)';
            ctx.strokeStyle = '#4af626';
            ctx.lineWidth = 1;
            ctx.fillRect(-textWidth / 2 - 8, -11, textWidth + 16, 22);
            ctx.strokeRect(-textWidth / 2 - 8, -11, textWidth + 16, 22);
            ctx.fillStyle = '#4af626';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Knecht', 0, 1);
            ctx.restore();
        }

        //МЫСЛИ 
        if (currentThought && idleTimer < IDLE_LIMIT && showThoughts && !isPaused) {
            ctx.save();
            ctx.translate(spider.x - 35, spider.y - 35);
            ctx.font = 'italic 10px sans-serif';
            const thoughtWidth = ctx.measureText(currentThought).width;
            const boxWidth = Math.min(thoughtWidth + 16, 140);
            ctx.fillStyle = 'rgba(20, 30, 45, 0.9)';
            ctx.strokeStyle = '#4af626';
            ctx.lineWidth = 1;
            ctx.fillRect(-boxWidth, -11, boxWidth, 22);
            ctx.strokeRect(-boxWidth, -11, boxWidth, 22);
            ctx.fillStyle = '#a4ef91';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(currentThought, -8, 1, boxWidth - 12);
            ctx.restore();
        }

        // РУЧНАЯ ЦЕЛЬ
        if (manualGoal) {
            ctx.save();
            ctx.strokeStyle = '#4af626';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(manualGoal.x, manualGoal.y, 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // ВОПРОС 
        if (showQuestionMark) {
            ctx.save();
            ctx.translate(spider.x, spider.y - 35);
            ctx.font = 'bold 14px sans-serif';
            ctx.fillStyle = 'rgba(20, 30, 45, 0.85)';
            ctx.strokeStyle = '#4af626';
            ctx.lineWidth = 1;
            ctx.fillRect(-10, -11, 20, 22);
            ctx.strokeRect(-10, -11, 20, 22);
            ctx.fillStyle = '#4af626';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', 0, 1);
            ctx.restore();
        }

        //СОН
        if (idleTimer >= IDLE_LIMIT) {
            ctx.save();
            ctx.translate(spider.x, spider.y - 35);
            ctx.font = 'italic bold 12px sans-serif';
            const zWidth = ctx.measureText('Zzz').width;
            ctx.fillStyle = 'rgba(20, 30, 45, 0.85)';
            ctx.strokeStyle = '#8ab8ff';
            ctx.lineWidth = 1;
            ctx.fillRect(-zWidth / 2 - 6, -10, zWidth + 12, 20);
            ctx.strokeRect(-zWidth / 2 - 6, -10, zWidth + 12, 20);
            ctx.fillStyle = '#8ab8ff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Zzz', 0, 1);
            ctx.restore();
        }

        //СЧЁТЧИК БУКВ
        if (showCounterTimer > 0 && collectedLetters.length > 0) {
            ctx.save();
            ctx.translate(spider.x, spider.y - 65);
            const textString = collectedLetters.map(g => g.char).join('') + '...';
            ctx.font = 'bold 12px monospace';
            const strWidth = ctx.measureText(textString).width;
            ctx.fillStyle = 'rgba(20, 30, 45, 0.9)';
            ctx.strokeStyle = '#ff007f';
            ctx.lineWidth = 1;
            ctx.fillRect(-strWidth / 2 - 8, -10, strWidth + 16, 20);
            ctx.strokeRect(-strWidth / 2 - 8, -10, strWidth + 16, 20);
            ctx.fillStyle = '#ff007f';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(textString, 0, 1);
            ctx.restore();
        }

        //ПАУЗА
        if (isPaused) {
            ctx.save();
            ctx.translate(spider.x + 50, spider.y - 35);
            ctx.font = 'bold 11px monospace';
            const pWidth = ctx.measureText('II').width;
            ctx.fillStyle = 'rgba(20, 30, 45, 0.85)';
            ctx.strokeStyle = '#ff007f';
            ctx.lineWidth = 1;
            ctx.fillRect(-pWidth / 2 - 7, -10, pWidth + 14, 20);
            ctx.strokeRect(-pWidth / 2 - 7, -10, pWidth + 14, 20);
            ctx.fillStyle = '#ff007f';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('°ロ°', 0, 1);
            ctx.restore();
        }

        ctx.restore();
    }

    requestAnimationFrame(tick);

    //НАСТРОЙКИ
    //ЛОГИКА ПЕРЕТАСКИВАНИЯ ПАНЕЛИ НАСТРОЕК
    const settingsPanel = document.getElementById('__knecht_settings_panel__');
    const settingsTitle = settingsPanel ? settingsPanel.querySelector('.settings-title') : null;
    
    let isHoveringPanel = false;
    let isDraggingPanel = false;
    let panelOffsetX = 0;
    let panelOffsetY = 0;

    // Задаем начальную позицию (справа снизу), когда окно загрузится
    window.addEventListener('load', () => {
        if (settingsPanel) {
            settingsPanel.style.left = (window.innerWidth - settingsPanel.offsetWidth - 20) + 'px';
            settingsPanel.style.top = (window.innerHeight - settingsPanel.offsetHeight - 20) + 'px';
        }
    });

    if (settingsTitle) {
        settingsTitle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Только ЛКМ
            isDraggingPanel = true;
            const rect = settingsPanel.getBoundingClientRect();
            // Запоминаем, за какую точку заголовка мы схватились
            panelOffsetX = e.clientX - rect.left;
            panelOffsetY = e.clientY - rect.top;
            e.stopPropagation(); // Не даем пауку схватиться
        });
    }

    window.addEventListener('mousemove', (e) => {
        if (isDraggingPanel && settingsPanel) {
            let newLeft = e.clientX - panelOffsetX;
            let newTop = e.clientY - panelOffsetY;

            // Не даем панели улететь за края экрана
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - settingsPanel.offsetWidth));
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - settingsPanel.offsetHeight));

            settingsPanel.style.left = newLeft + 'px';
            settingsPanel.style.top = newTop + 'px';
        }
    });

    window.addEventListener('mouseup', () => {
        isDraggingPanel = false;
    });
    const btnMute = document.getElementById('toggle-mute');
    const btnThoughts = document.getElementById('toggle-thoughts');
    const btnMatrix = document.getElementById('toggle-matrix');
    const btnPower = document.getElementById('power-off');

    if (btnMute) btnMute.innerText = isMuted ? 'Quiet' : 'Rustle';
    if (btnMute) {
        btnMute.addEventListener('click', () => {
            isMuted = !isMuted;
            localStorage.setItem('__spider_muted__', isMuted);
            btnMute.innerText = isMuted ? 'Quiet' : 'Rustle';
        });
    }
    if (btnThoughts) {
        btnThoughts.addEventListener('click', () => {
            showThoughts = !showThoughts;
            btnThoughts.innerText = showThoughts ? 'Talk' : 'Silent';
            if (!showThoughts) currentThought = '';
        });
    }
    if (btnMatrix) {
        btnMatrix.addEventListener('click', () => {
            isMatrixVisible = !isMatrixVisible;
            matrixDirty = true;
            btnMatrix.innerText = isMatrixVisible ? 'Matrix' : 'No BG';
        });
    }
    if (btnPower) {
        btnPower.addEventListener('click', () => {
            ipcRenderer.send('shutdown-knecht');
        });
    }
})();
