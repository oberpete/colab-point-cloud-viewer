# Collaborative Point Cloud Viewer

Multiple browser tabs load the SoFi Stadium COPC point cloud and share camera position + view direction in real time.

## Prerequisites

- Node.js 22+ (`nvm use 22` if you use nvm)

## Setup

```bash
npm install
npm run setup   # downloads + builds Potree (~2–3 min, runs once)
npm start       # http://localhost:3000
```