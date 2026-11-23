# Knecht Desktop

An interactive desktop spider companion built with Electron that scans your screen for text and physically walks across individual letters using procedural inverse kinematics.

## Features

* **Text-Walking Physics & IK:** Uses a 2-joint inverse kinematics (IK) solver across 8 legs with alternating gait groups so Knecht genuinely steps from character to character on your screen.
* **Screen Glyph Detection:** Captures screen text coordinates in real time, highlighting nearby characters in a subtle Matrix-style glow as the spider explores.
* **Context-Aware Thoughts:** Reacts to what you are doing with philosophical quotes and witty remarks tailored to your active window or website (VS Code, PyCharm, Terminal, GitHub, StackOverflow, YouTube, Telegram, etc.).
* **Procedural Web Audio:** Generates subtle, synthesized rustling footsteps when stepping on letters (can be muted anytime).
* **Adaptive Theme:** Automatically adjusts its color palette to match your OS light or dark mode.
* **Sleep & Idle States:** Falls asleep (`Zzz`) after 45 seconds of inactivity and wakes up as soon as you move your mouse or type.

## Controls

| Action | Effect |
| :--- | :--- |
| **Left Click + Drag** | Pick up and move Knecht anywhere on the screen |
| **Right Click (Anywhere)** | Set a manual target waypoint for the spider to walk toward |
| **Double Right Click** | Pause / Resume Knecht (`°ロ°`) |
| **Double Left Click** | Activate the live collected-letters trail counter (`MAX 12 chars`) |
| **Hover over Spider** | Reveal Knecht's name tag |
| **Floating Control Panel** | Toggle sound (`Rustle`/`Quiet`), thoughts (`Talk`/`Silent`), background glyph matrix (`Matrix`/`No BG`), or shut down |

## Getting Started

### Prerequisites
* [Node.js](https://nodejs.org) (v18 or higher recommended)

### Installation & Run

1. Clone the repository:
   ```bash
   git clone https://github.com
   cd knecht-desktop
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start Knecht:
   ```bash
   npm start
   ```

## Built With

* **Electron** — Transparent, click-through desktop overlay window
* **HTML5 Canvas** — 60 FPS procedural animation & Matrix glyph rendering
* **Web Audio API** — Zero-dependency synthesized footstep audio

## License

This project is open-source and available under the [MIT License](LICENSE).

