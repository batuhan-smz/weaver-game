# Weaver — Block Puzzle Game

A satisfying 10×10 block-placement puzzle with:

- **Smart weighted-random block generation** — grid analysis biases shape/color selection
- **BFS color-cluster clearing** — chains of 6+ same-color cells explode
- **Row & column clearing** — classic line-clear mechanic
- **Combo multiplier scoring** — `Score = (blocks × 10) + (combo² × 50)`
- **Particle FX & elastic tweening** — blocks bounce in, cells burst outward on clear
- **Game-over bitmask check** — fast shape-fitting detection

## Versions

| Tag | Content |
|-----|---------|
| v0.1.0 | Project scaffold (HTML, CSS, .gitignore) |
| v0.2.0 | Grid data structure (Cell, Grid, Observer Pattern, BFS) |
| v0.3.0 | Block shapes, weighted-random generation, color palette |
| v0.4.0 | Renderer — grid canvas, drag-and-drop placement |
| v0.5.0 | Clearing logic — row/col + BFS color clusters |
| v0.6.0 | Score system with combo multiplier + feedback toast |
| v0.7.0 | Smart block generation — grid analysis, color biasing |
| v0.8.0 | Particle FX system + elastic-out tweening |
| v0.9.0 | Game-over detection via bitmask + full game loop |

## Running Locally

```bash
# Serve from project root (any static server works)
npx serve .
# or
python -m http.server
```

Then open `http://localhost:3000` (or whatever port).

## Architecture

```
weaver-game/
├── index.html          # Shell + canvas elements
├── style.css           # Dark-theme UI
└── src/
    ├── main.js         # Game loop + orchestration
    ├── grid.js         # Cell / Grid classes (Observer Pattern)
    ├── blocks.js       # Block shapes + weighted-random tray generator
    ├── renderer.js     # Canvas rendering + drag-and-drop
    ├── clearing.js     # Row/col + BFS cluster clearing
    ├── score.js        # Scoring formula + combo system
    ├── particles.js    # Particle FX + tweening engine
    └── gameover.js     # Bitmask fit-check + game-over logic
```
