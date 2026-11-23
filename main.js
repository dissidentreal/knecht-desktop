const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { exec, spawn } = require('child_process');
const https = require('https'); // Добавлено для загрузки кода

function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    const win = new BrowserWindow({
        width: width,
        height: height,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        focusable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
            disableHtml5TimerThrottling: true
        }
    });

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });

    // ==========================================
    // 1. ГЛОБАЛЬНЫЕ КООРДИНАТЫ МЫШИ
    // ==========================================
    setInterval(() => {
        if (!win.isDestroyed()) {
            const mousePoint = screen.getCursorScreenPoint();
            win.webContents.send('global-mouse-move', mousePoint);
        }
    }, 30);

    // ==========================================
    // 2. ГЛОБАЛЬНЫЙ ПЕРЕХВАТ КЛИКОВ И КЛАВИАТУРЫ
    // ==========================================
    try {
        const pointerDeviceId = process.env.SPIDER_XINPUT_DEVICE || '9';
        const keyboardDeviceId = process.env.SPIDER_XINPUT_KEYBOARD || '15';

        const inputHook = spawn('xinput', ['test', pointerDeviceId]);
        const keyboardHook = spawn('xinput', ['test', keyboardDeviceId]);

        let buffer = '';
        let lastLeftClick = 0;
        const DOUBLE_CLICK_MS = 400;

        inputHook.stdout.on('data', (data) => {
            if (win.isDestroyed()) return;
            buffer += data.toString();
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) {
                const match = line.match(/button\s+press\s+(\d+)/i);
                if (!match) continue;
                const button = Number(match[1]);
                win.webContents.send('global-activity');

                if (button === 3) {
                    const point = screen.getCursorScreenPoint();
                    win.webContents.send('global-right-click', point);
                } else if (button === 1) {
                    const now = Date.now();
                    if (now - lastLeftClick < DOUBLE_CLICK_MS) {
                        win.webContents.send('global-left-double-click');
                        lastLeftClick = 0;
                    } else {
                        lastLeftClick = now;
                    }
                }
            }
        });

        let keyboardBuffer = '';
        keyboardHook.stdout.on('data', (data) => {
            if (win.isDestroyed()) return;
            keyboardBuffer += data.toString();
            const lines = keyboardBuffer.split(/\r?\n/);
            keyboardBuffer = lines.pop() || '';
            for (const line of lines) {
                if (/key\s+press\s+\d+/i.test(line)) {
                    win.webContents.send('global-activity');
                    break;
                }
            }
        });
    } catch (e) {
        console.log('Ошибка инициализации XInput:', e.message);
    }

    // ==========================================
    // 4. УПРАВЛЕНИЕ ПРОЗРАЧНОСТЬЮ
    // ==========================================
    ipcMain.on('set-ignore-mouse', (event, ignore) => {
        if (!win.isDestroyed()) win.setIgnoreMouseEvents(ignore, { forward: true });
    });

    ipcMain.on('log-to-terminal', (event, message) => {
        console.log(message);
    });

    ipcMain.on('shutdown-knecht', () => {
        if (!win.isDestroyed()) win.close();
    });

    // ==========================================
    // 5. ЗАГРУЗКА ХАКЕРСКОГО КОДА
    // ==========================================
    let currentCodeContent = ""; // Сюда сохраняем скачанный код

    function fetchCodeFromGitHub() {
        // Ссылки на сырые файлы (raw) из крупных open-source проектов
        const urls = [
            'https://raw.githubusercontent.com/torvalds/linux/master/kernel/sched/core.c',
            'https://raw.githubusercontent.com/git/git/master/builtin/add.c',
            'https://raw.githubusercontent.com/python/cpython/main/Python/ceval.c',
            'https://raw.githubusercontent.com/nodejs/node/main/src/node.cc'
        ];
        const url = urls[Math.floor(Math.random() * urls.length)];
        
        https.get(url, { headers: { 'User-Agent': 'Knecht-Spider' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200 && data.length > 1000) {
                    // Берем только строки, где есть текст
                    const lines = data.split('\n').filter(l => l.trim().length > 0);
                    if (lines.length > 100) {
                        currentCodeContent = lines.join('\n');
                        console.log(`[Knecht Eyes] Успешно загружен код: ${url.split('/')[4]}`);
                    }
                }
            });
        }).on('error', (e) => console.log('Ошибка сети GitHub (работаем на бинарном коде):', e.message));
    }

    // Загружаем при старте и обновляем раз в 10 минут
    fetchCodeFromGitHub();
    setInterval(fetchCodeFromGitHub, 10 * 60 * 1000);

    // ==========================================
    // 6. ГЕНЕРАЦИЯ СЕТКИ
    // ==========================================
    let lastActiveWinId = null;
    let lastGridTime = 0;

    ipcMain.on('capture-screen', (event, force) => {
        setTimeout(() => {
            exec('xdotool getactivewindow 2>/dev/null', (err, stdout) => {
                const activeWinId = stdout ? stdout.trim() : null;
                const now = Date.now();
                const isNewWindow = activeWinId !== lastActiveWinId;

                // Обновляем, если: принудительно, сменилось окно, или прошло 5 секунд
                if (force || isNewWindow || (now - lastGridTime > 15000)) {
                    lastActiveWinId = activeWinId;
                    lastGridTime = now;

                    let winX = 50, winY = 50, winW = width - 100, winH = height - 100;
                    let isFirefox = false;
                    let appClass = 'unknown';

                    if (activeWinId && !err) {
                        exec(`xwininfo -id ${activeWinId} && xprop -id ${activeWinId} WM_CLASS && xdotool getwindowname ${activeWinId} 2>/dev/null`, (wErr, wStdout) => {
                            if (!wErr && wStdout) {
                                const output = wStdout.toString();
                                const lowerOutput = output.toLowerCase();

                                if (lowerOutput.includes('youtube')) appClass = 'site-youtube';
                                else if (lowerOutput.includes('github')) appClass = 'site-github';
                                else if (lowerOutput.includes('stackoverflow')) appClass = 'site-stackoverflow';
                                else if (lowerOutput.includes('habr')) appClass = 'site-habr';
                                else if (lowerOutput.includes('firefox') || lowerOutput.includes('navigator')) appClass = 'firefox';
                                else if (lowerOutput.includes('code')) appClass = 'code';
                                else if (lowerOutput.includes('terminal')) appClass = 'gnome-terminal';
                                else if (lowerOutput.includes('telegram')) appClass = 'telegram-desktop';
                                else {
                                    const classMatch = output.match(/WM_CLASS\(STRING\)\s*=\s*"([^"]+)"/);
                                    appClass = classMatch ? classMatch[1].toLowerCase() : 'unknown';
                                }

                                if (appClass === 'firefox' || appClass.startsWith('site-')) isFirefox = true;

                                const xMatch = output.match(/Absolute upper-left X:\s+(-?\d+)/);
                                const yMatch = output.match(/Absolute upper-left Y:\s+(-?\d+)/);
                                const wMatch = output.match(/Width:\s+(\d+)/);
                                const hMatch = output.match(/Height:\s+(\d+)/);

                                if (xMatch && yMatch && wMatch && hMatch) {
                                    winX = parseInt(xMatch[1], 10);
                                    winY = parseInt(yMatch[1], 10);
                                    winW = parseInt(wMatch[1], 10);
                                    winH = parseInt(hMatch[1], 10);
                                }
                            }
                            generateAndSendGrid(winX, winY, winW, winH, isFirefox, appClass, event);
                        });
                    } else {
                        generateAndSendGrid(winX, winY, winW, winH, isFirefox, appClass, event);
                    }
                } else {
                    event.reply('screen-captured', null, null); 
                }
            });
        }, 50);
    });

    function generateAndSendGrid(winX, winY, winW, winH, isFirefox, appClass, event) {
        const list = [];
        
        // Шаг для моноширинного шрифта (10px): 9px по X, 16px по Y
        const stepX = 9; 
        const stepY = 16; 
        
        const startX = winX + 20;
        const startY = winY + (isFirefox ? 110 : 60);
        const endX = winX + winW - 20;
        const endY = winY + winH - 20;

        // Сколько символов влезает в строку и сколько строк на экране
        const charsPerLine = Math.floor((endX - startX) / stepX);
        const linesCount = Math.floor((endY - startY) / stepY);

        // Разбиваем код на строки и отсеиваем пустые
        let realCodeLines = currentCodeContent ? currentCodeContent.split('\n') : [];
        realCodeLines = realCodeLines.filter(l => l.trim().length > 2);

        for (let row = 0; row < linesCount; row++) {
            const y = startY + row * stepY;
            let lineStr = "";

            if (realCodeLines.length > 0) {
                // Если код загружен, берем случайную строку
                let baseLine = realCodeLines[Math.floor(Math.random() * realCodeLines.length)];
                baseLine = baseLine.replace(/\t/g, "    "); // Табы заменяем на пробелы
                lineStr = baseLine;
                // Дополняем строку пробелами и случайными 0/1, если она короткая
                while (lineStr.length < charsPerLine) {
                    lineStr += (Math.random() < 0.5 ? " " : (Math.random() < 0.5 ? "0" : "1"));
                }
            } else {
                // Если интернета нет — генерируем бинарный шум
                for (let i = 0; i < charsPerLine; i++) {
                    const r = Math.random();
                    if (r < 0.4) lineStr += '0';
                    else if (r < 0.8) lineStr += '1';
                    else lineStr += ' ';
                }
            }

            // Заполняем сетку посимвольно
                        // Заполняем сетку посимвольно
            for (let col = 0; col < charsPerLine; col++) {
                const baseX = startX + col * stepX;
                
                // Легкая синусоидальная волна, чтобы строки не были идеально прямыми
                const waveX = Math.sin(y * 0.05 + col * 0.1) * 3;
                
                let char = lineStr[col] || ' ';

                // ПРОПУСКАЕМ ПРОБЕЛЫ (и любые пустые символы)
                // Если символ — пробел, просто идем к следующей колонке
                if (char === ' ' || char === '\t' || char === '') {
                    continue;
                }

                list.push({
                    x: baseX + waveX,
                    y: y,
                    char: char
                });
            }
        }

        event.reply('screen-captured', list, appClass);
    }

    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
