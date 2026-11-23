(function () {
    'use strict';

    // ===== ПАРАМЕТРЫ КНЕХТА (ИЗ ELECTRON-ВЕРСИИ) =====
    const BODY_R = 26;
    const L1 = 46, L2 = 52;
    const WALK_SPEED = 34;
    const FLY_SPEED = 60;
    const SOFT_EDGE = 5;
    const VIEW_GOAL_PAD = 10;
    const DRAG_LINGER = 0.4;
    const IDLE_LIMIT = 45.0;
    const MAX_GLYPHS = 4000;
    const MAX_STRING_LEN = 12;
    const SOUND_COOLDOWN = 420;

    // ===== СОЗДАНИЕ КАНВАСА =====
    const canvas = document.createElement('canvas');
    canvas.id = '__spider_overlay__';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    let W = 0, H = 0;
    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    // ===== СБОР БУКВ =====
    let glyphs = [];
    const skipTags = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','CODE','PRE']);

    function harvest() {
        const list = [];
        const range = document.createRange();
        const sx = window.scrollX, sy = window.scrollY;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const p = node.parentElement;
                if (!p) return NodeFilter.FILTER_REJECT;
                if (skipTags.has(p.tagName)) return NodeFilter.FILTER_REJECT;
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const r = p.getBoundingClientRect();
                if (r.bottom < -100 || r.top > H + 100 || r.right < -100 || r.left > W + 100) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let node, count = 0;
        while ((node = walker.nextNode()) && count < MAX_GLYPHS) {
            const text = node.nodeValue;
            for (let i = 0; i < text.length && count < MAX_GLYPHS; i++) {
                if (!/[0-9A-Za-zА-Яа-яЁё]/.test(text[i])) continue;
                try {
                    range.setStart(node, i);
                    range.setEnd(node, i + 1);
                    const r = range.getBoundingClientRect();
                    if (r.width > 0 && r.top >= -50 && r.bottom <= H + 50 && r.left >= -50 && r.right <= W + 50) {
                        list.push({ x: r.left + r.width / 2 + sx, y: r.top + r.height / 2 + sy, char: text[i] });
                        count++;
                    }
                } catch(e){}
            }
        }
        glyphs = list;
    }

    // ===== ПАУК =====
    const spider = {
        x: window.scrollX + W / 2,
        y: window.scrollY + H / 2,
        vx: 0, vy: 0, angle: 0, goal: null, walkCycle: 0, isFlying: false
    };

    // ===== ЛОГИКА ВЗАИМОДЕЙСТВИЯ =====
    let isDraggingSpider = false;
    let manualGoal = null;
    let waitTimer = 0;
    let idleTimer = 0;
    let showQuestionMark = false;
    let collectedLetters = [];
    let isMuted = localStorage.getItem('__spider_muted__') === 'true';
    let lastCollectedLetter = '';
    let showCounterTimer = 0;
    let flyTimer = 0;
    let walkTimer = 0;
    const mousePos = { x: 0, y: 0 };
    let isHoveringSpider = false;
    let dragTimer = 0;

    // ===== ЛАПЫ =====
    const legs = [];
    const legOffsets = [0.75, 1.05, 1.65, 2.05];
    for (let i = 0; i < 8; i++) {
        const side = i < 4 ? -1 : 1;
        const pairIndex = i % 4;
        const gaitGroup = (pairIndex + (side === 1 ? 1 : 0)) % 2;
        legs.push({
            i, side, pairIndex, gaitGroup,
            baseAngle: side * legOffsets[pairIndex],
            foot: { x: spider.x, y: spider.y },
            target: { x: spider.x, y: spider.y },
            hip: { x: spider.x, y: spider.y },
            planted: false,
            lockedGlyph: null,
            lastStepPos: null,
            stepCooldown: 0
        });
    }

    // ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
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
        const proj = (a*a - b*b + d*d) / (2*d);
        const h = Math.sqrt(Math.max(0, a*a - proj*proj));
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
        const isFrontLeg = (legIndex % 4 === 0);
        const poolSize = Math.min(isFrontLeg ? 10 : 4, candidates.length);
        const index = isFrontLeg ? Math.floor(Math.random() * poolSize) : legIndex % poolSize;
        return candidates[index].glyph;
    }

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
            { x: pad, y: pad }, { x: W - pad, y: pad },
            { x: W - pad, y: H - pad }, { x: pad, y: H - pad }
        ];
        return corners[Math.floor(Math.random() * corners.length)];
    }

    function goalVisible() {
        if (!spider.goal) return false;
        if (manualGoal && spider.goal === manualGoal) return true;
        if (glyphs.length === 0) return true;
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
        const sx = window.scrollX, sy = window.scrollY;
        if (spider.x < sx - 350 || spider.x > sx + W + 350 || spider.y < sy - 350 || spider.y > sy + H + 350) {
            spider.x = sx + W / 2;
            spider.y = sy + H / 2;
            teleported = true;
        }
        if (teleported) {
            spider.vx = 0; spider.vy = 0;
            manualGoal = null; waitTimer = 0;
            spider.goal = pickVisibleGoal();
            resetLegs();
        }
        return teleported;
    }

    // ===== ЗВУК =====
    let audioCtx = null, lastSoundTime = 0;
    function initAudio() {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) audioCtx = new AC();
        }
    }
    document.addEventListener('click', initAudio, { once: true });

    function playStepSound(legIndex, letterObj = null) {
        if (showCounterTimer > 0 && letterObj && letterObj.char) {
            if (letterObj.char !== lastCollectedLetter) {
                lastCollectedLetter = letterObj.char;
                collectedLetters.push(letterObj);
                if (collectedLetters.length > MAX_STRING_LEN) collectedLetters.shift();
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
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.type = 'sine';
            const baseFreq = 3200 + (legIndex % 2) * 100;
            osc.frequency.setValueAtTime(baseFreq, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.05, audioCtx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.07);
            osc.start(); osc.stop(audioCtx.currentTime + 0.07);
        } catch (e) {}
    }

    // ===== ОБРАБОТЧИКИ =====
    window.addEventListener('mousedown', (e) => {
        const clickX = e.clientX + window.scrollX;
        const clickY = e.clientY + window.scrollY;

        if (showCounterTimer > 0) {
            const muteX = spider.x + 60, muteY = spider.y - 35;
            if (Math.abs(clickX - muteX) < 25 && Math.abs(clickY - muteY) < 12) {
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
                idleTimer = 0;
                return;
            }
            if (Math.hypot(clickX - spider.x, clickY - spider.y) < 40) {
                isDraggingSpider = true;
                manualGoal = null;
                waitTimer = 0;
                spider.vx = 0; spider.vy = 0;
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) isDraggingSpider = false;
    });

    window.addEventListener('mousemove', (e) => {
        mousePos.x = e.clientX + window.scrollX;
        mousePos.y = e.clientY + window.scrollY;
        isHoveringSpider = Math.hypot(mousePos.x - spider.x, mousePos.y - spider.y) < 40;
        idleTimer = 0;
    });

    window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const clickX = e.clientX + window.scrollX;
        const clickY = e.clientY + window.scrollY;
        manualGoal = { x: clickX, y: clickY };
        spider.goal = manualGoal;
        waitTimer = 0;
        unplantAllLegs();
    });

    window.addEventListener('scroll', () => { idleTimer = 0; }, { passive: true });

    // ===== ГЛАВНЫЙ ЦИКЛ =====
    let lastTime = performance.now();
    let changeGoalTimer = 15.0;

    function tick(now) {
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;
        const teleported = keepOnScreen();

        if (manualGoal) idleTimer = 0;
        else if (!isDraggingSpider) idleTimer += dt;

        const isSleeping = idleTimer >= IDLE_LIMIT;

        if (showCounterTimer > 0) {
            showCounterTimer -= dt;
            if (showCounterTimer <= 0) collectedLetters = [];
        }

        // ВЫБОР И ДОСТИЖЕНИЕ ЦЕЛИ
        if (waitTimer > 0) {
            waitTimer -= dt;
            spider.vx = 0; spider.vy = 0;
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

            if (!manualGoal) changeGoalTimer -= dt;
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
            spider.vx = 0; spider.vy = 0;
        } else if (isSleeping) {
            spider.vx = 0; spider.vy = 0;
        } else if (waitTimer <= 0 && spider.goal) {
            const gx = spider.goal.x - spider.x;
            const gy = spider.goal.y - spider.y;
            const gl = Math.hypot(gx, gy) || 1;

            const speed = spider.isFlying ? FLY_SPEED : WALK_SPEED;
            const targetVx = (gx / gl) * speed;
            const targetVy = (gy / gl) * speed;

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

        // КЛАМПЫ
        const sxNow = window.scrollX, syNow = window.scrollY;
        let clamped = false;
        if (spider.x < sxNow + SOFT_EDGE) { spider.x = sxNow + SOFT_EDGE; spider.vx = Math.abs(spider.vx) * 0.5; clamped = true; }
        if (spider.x > sxNow + W - SOFT_EDGE) { spider.x = sxNow + W - SOFT_EDGE; spider.vx = -Math.abs(spider.vx) * 0.5; clamped = true; }
        if (spider.y < syNow + SOFT_EDGE) { spider.y = syNow + SOFT_EDGE; spider.vy = Math.abs(spider.vy) * 0.5; clamped = true; }
        if (spider.y > syNow + H - SOFT_EDGE) { spider.y = syNow + H - SOFT_EDGE; spider.vy = -Math.abs(spider.vy) * 0.5; clamped = true; }
        if (teleported || clamped) dragTimer = DRAG_LINGER;

        dragTimer = Math.max(0, dragTimer - dt);
        const dragging = (dragTimer > 0) || isSleeping;
        const occupiedGlyphs = [];
        for (const leg of legs) {
            if (leg.planted) occupiedGlyphs.push({ x: leg.foot.x, y: leg.foot.y });
        }
        let plantedCount = 0;
        const activeGaitGroup = Math.sin(spider.walkCycle * 1.4) >= 0 ? 0 : 1;

        // ЛАПЫ
        const dragLerp = 1 - Math.pow(1 - 0.25, dt * 60);
        const footLerp = 1 - Math.pow(1 - 0.30, dt * 60);

        for (const leg of legs) {
            const hipA = leg.baseAngle + spider.angle;
            const hx = spider.x + Math.cos(hipA) * BODY_R;
            const hy = spider.y + Math.sin(hipA) * BODY_R;
            leg.hip.x = hx; leg.hip.y = hy;

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

            const releaseDistance = leg.pairIndex === 0 ? 58 : (leg.pairIndex === 1 ? 64 : 52);
            const currentLegLength = Math.hypot(leg.foot.x - hx, leg.foot.y - hy);

            const angleToFoot = Math.atan2(leg.foot.y - hy, leg.foot.x - hx);
            let angleDiff = angleToFoot - hipA;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            const isTwisted = Math.abs(angleDiff) > 1.35 || currentLegLength < 34;

            if (leg.planted) {
                const stillHasLetter = glyphs.some(g => Math.hypot(g.x - leg.foot.x, g.y - leg.foot.y) < 12);
                const isMyTurn = (leg.gaitGroup === activeGaitGroup);
                const plannedStep = isMyTurn && (currentLegLength > releaseDistance) && (leg.stepCooldown <= 0);
                const emergencyStep = !stillHasLetter || isTwisted || (currentLegLength > 92);
                if (plannedStep || emergencyStep) leg.planted = false;
            }

            if (leg.planted) {
                leg.lockedGlyph = null;
                plantedCount++;
            } else {
                const pairIndex = leg.pairIndex;
                const reachForward = pairIndex === 0 ? 55 : (pairIndex === 1 ? 26 : 10);
                const sideSpread = pairIndex === 0 ? 0.55 : (pairIndex === 1 ? 0.28 : 0.35);
                const reachMult = pairIndex === 0 ? 0.65 : (pairIndex === 1 ? 0.55 : 0.42);

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
                        if (!leg.planted && !isSleeping) {
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
        if (plantedCount > 0 && !isSleeping && !isDraggingSpider) {
            spider.isFlying = false;
            flyTimer = 0;
        } else if (plantedCount === 0 && !isSleeping && !isDraggingSpider) {
            if (!spider.isFlying) {
                flyTimer += dt;
                if (flyTimer > 0.2) {
                    spider.isFlying = true;
                    flyTimer = 0;
                }
            }
        }
        if (isSleeping || isDraggingSpider) {
            spider.isFlying = false;
            flyTimer = 0;
        }

        const actualDeltaX = spider.x - (spider._lastX ?? spider.x);
        const actualDeltaY = spider.y - (spider._lastY ?? spider.y);
        spider._lastX = spider.x;
        spider._lastY = spider.y;
        const realPixelsPerFrame = Math.hypot(actualDeltaX, actualDeltaY);
        if (!spider.isFlying) {
            if (realPixelsPerFrame > 0.05 && realPixelsPerFrame < 12.0) spider.walkCycle += realPixelsPerFrame * 0.15;
            else if (realPixelsPerFrame <= 0.05) spider.walkCycle += dt * 1.5;
        }

        if (idleTimer < 1.0) harvest();
        draw();
        requestAnimationFrame(tick);
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.translate(-window.scrollX, -window.scrollY);

        // ЛАПЫ
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

            ctx.strokeStyle = leg.planted ? '#3f5878' : '#07445c';
            ctx.lineWidth = leg.planted ? 1.8 : 1.4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(leg.hip.x, leg.hip.y);
            ctx.lineTo(knee.x, knee.y);
            ctx.lineTo(leg.foot.x, leg.foot.y);
            ctx.stroke();

            ctx.fillStyle = leg.planted ? '#4af626' : '#8ab8ff';
            ctx.beginPath();
            ctx.arc(leg.foot.x, leg.foot.y, 2.8, 0, Math.PI * 2);
            ctx.fill();
        }

        // ТЕЛО
        ctx.save();
        ctx.translate(spider.x, spider.y);
        ctx.rotate(spider.angle);
        ctx.strokeStyle = '#4af626';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(-8, 0, 9, 6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(2, 0, 5, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#4af626';
        ctx.beginPath();
        ctx.arc(5, -2, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(5, 2, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // ПЛАШКИ
        if (isHoveringSpider) {
            ctx.save();
            ctx.translate(spider.x, spider.y - 35);
            const text = "Knecht";
            ctx.font = "bold 12px sans-serif";
            const tw = ctx.measureText(text).width;
            ctx.fillStyle = "rgba(20, 30, 45, 0.85)";
            ctx.strokeStyle = "#4af626";
            ctx.lineWidth = 1;
            ctx.fillRect(-tw/2 - 8, -11, tw + 16, 22);
            ctx.strokeRect(-tw/2 - 8, -11, tw + 16, 22);
            ctx.fillStyle = "#4af626";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, 0, 1);
            ctx.restore();
        }

        if (manualGoal) {
            ctx.save();
            ctx.strokeStyle = '#4af626';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(manualGoal.x, manualGoal.y, 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        if (showQuestionMark) {
            ctx.save();
            ctx.translate(spider.x, spider.y - 35);
            ctx.fillStyle = "rgba(20, 30, 45, 0.85)";
            ctx.strokeStyle = "#4af626";
            ctx.lineWidth = 1;
            ctx.fillRect(-10, -11, 20, 22);
            ctx.strokeRect(-10, -11, 20, 22);
            ctx.fillStyle = "#4af626";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("?", 0, 1);
            ctx.restore();
        }

        if (idleTimer >= IDLE_LIMIT) {
            ctx.save();
            ctx.translate(spider.x, spider.y - 35);
            const zText = "Zzz";
            ctx.font = "italic bold 12px sans-serif";
            const zw = ctx.measureText(zText).width;
            ctx.fillStyle = "rgba(20, 30, 45, 0.85)";
            ctx.strokeStyle = "#8ab8ff";
            ctx.lineWidth = 1;
            ctx.fillRect(-zw/2 - 6, -10, zw + 12, 20);
            ctx.strokeRect(-zw/2 - 6, -10, zw + 12, 20);
            ctx.fillStyle = "#8ab8ff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(zText, 0, 1);
            ctx.restore();
        }

        if (showCounterTimer > 0 && collectedLetters.length > 0) {
            ctx.save();
            ctx.translate(spider.x, spider.y - 65);
            const textString = collectedLetters.map(g => g.char).join('') + "...";
            ctx.font = "bold 12px monospace";
            const sw = ctx.measureText(textString).width;
            ctx.fillStyle = "rgba(20, 30, 45, 0.9)";
            ctx.strokeStyle = "#ff007f";
            ctx.lineWidth = 1;
            ctx.fillRect(-sw/2 - 8, -10, sw + 16, 20);
            ctx.strokeRect(-sw/2 - 8, -10, sw + 16, 20);
            ctx.fillStyle = "#ff007f";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(textString, 0, 1);
            ctx.restore();
        }

        if (showCounterTimer > 0) {
            ctx.save();
            ctx.translate(spider.x + 60, spider.y - 35);
            const muteText = isMuted ? "Sound Off" : "Sound";
            ctx.font = "bold 10px sans-serif";
            ctx.fillStyle = isMuted ? "rgba(45, 20, 20, 0.9)" : "rgba(20, 45, 30, 0.9)";
            ctx.strokeStyle = isMuted ? "#ff007f" : "#4af626";
            ctx.lineWidth = 1;
            ctx.fillRect(-25, -10, 50, 20);
            ctx.strokeRect(-25, -10, 50, 20);
            ctx.fillStyle = isMuted ? "#ff007f" : "#4af626";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(muteText, 0, 1);
            ctx.restore();
        }

        ctx.restore();
    }

    // СТАРТ
    harvest();
    requestAnimationFrame(tick);
})();
