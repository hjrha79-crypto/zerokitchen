const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 8080
const DATA_DIR = __dirname
const CLUSTERS_PATH = path.join(DATA_DIR, '.album_reset', 'face_clusters.json')
const UNIFIED_PATH = path.join(DATA_DIR, '.album_reset', 'media_index_unified.json')

app.use(express.json({ limit: '100mb' }))
app.use(express.static(DATA_DIR))

// ── /save-clusters (전체 저장 — 호환용 유지) ──
app.post('/save-clusters', (req, res) => {
  const data = req.body
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid JSON body' })
  const backupPath = CLUSTERS_PATH + '.bak'
  if (fs.existsSync(CLUSTERS_PATH)) fs.copyFileSync(CLUSTERS_PATH, backupPath)
  const json = JSON.stringify(data, null, 2)
  fs.writeFile(CLUSTERS_PATH, json, 'utf-8', (err) => {
    if (err) return res.status(500).json({ error: err.message })
    console.log(`[저장 완료] face_clusters.json (${(json.length / 1024).toFixed(1)}KB)`)
    res.json({ ok: true })
  })
})

// ── /save-cluster (단일 클러스터 저장 — 빠른 저장) ──
app.post('/save-cluster', (req, res) => {
  const { cluster_id, name, excluded } = req.body
  if (!cluster_id) return res.status(400).json({ error: 'cluster_id required' })

  fs.readFile(CLUSTERS_PATH, 'utf-8', (err, raw) => {
    if (err) return res.status(500).json({ error: err.message })
    let data
    try { data = JSON.parse(raw) } catch(e) { return res.status(500).json({ error: 'parse error' }) }

    const cluster = data.clusters.find(c => c.cluster_id === cluster_id)
    if (!cluster) return res.status(404).json({ error: 'cluster not found' })

    if (name !== undefined) cluster.name = name
    if (excluded !== undefined) cluster.excluded = excluded
    cluster.updated_at = new Date().toISOString()

    fs.writeFile(CLUSTERS_PATH, JSON.stringify(data, null, 2), 'utf-8', (err2) => {
      if (err2) return res.status(500).json({ error: err2.message })
      console.log(`[단일 저장] ${cluster_id} name="${name}" excluded=${excluded}`)
      res.json({ ok: true })
    })
  })
})

// ── 이미지 경로 공통 검증 ──
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const ALLOWED_DRIVES = /^[CDE]:[\\\/]/i
const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }

function resolveImagePath(raw) {
  if (!raw) return null
  const filePath = raw.replace(/\//g, '\\')
  const ext = path.extname(filePath).toLowerCase()
  if (!ALLOWED_IMAGE_EXT.has(ext)) return null
  if (!ALLOWED_DRIVES.test(filePath)) return null
  return { filePath, ext }
}

// ── /image (원본 서빙) ──
app.get('/image', (req, res) => {
  const result = resolveImagePath(req.query.path)
  if (!result) return res.status(403).send('Invalid path')
  const { filePath, ext } = result

  fs.access(filePath, fs.constants.R_OK, (err) => {
    if (err) return res.status(404).send('File not found')
    res.setHeader('Content-Type', IMAGE_MIME[ext] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    fs.createReadStream(filePath).pipe(res)
  })
})

// ── /thumb (썸네일 — sharp 리사이즈) ──
let sharp
try { sharp = require('sharp') } catch(e) { sharp = null; console.warn('[sharp 없음] /thumb 엔드포인트 비활성화') }

app.get('/thumb', async (req, res) => {
  const result = resolveImagePath(req.query.path)
  if (!result) return res.status(403).send('Invalid path')
  const { filePath } = result
  const w = Math.min(parseInt(req.query.w) || 220, 400)

  if (!sharp) {
    // sharp 없으면 원본 서빙 fallback
    fs.access(filePath, fs.constants.R_OK, (err) => {
      if (err) return res.status(404).send('File not found')
      res.setHeader('Cache-Control', 'public, max-age=604800')
      fs.createReadStream(filePath).pipe(res)
    })
    return
  }

  try {
    const buffer = await sharp(filePath)
      .resize(w, w, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 75 })
      .toBuffer()
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=604800') // 7일 캐시
    res.send(buffer)
  } catch(e) {
    console.error('[thumb 실패]', filePath, e.message)
    res.status(500).send('Resize failed')
  }
})

// ── /exclude-month ──
app.post('/exclude-month', (req, res) => {
  const { year, month } = req.body
  if (!year || !month) return res.status(400).json({ error: 'year and month required' })
  fs.readFile(UNIFIED_PATH, 'utf-8', (err, raw) => {
    if (err) return res.status(500).json({ error: err.message })
    let data
    try { data = JSON.parse(raw) } catch(e) { return res.status(500).json({ error: 'parse error' }) }
    let count = 0
    data.forEach(item => { if (item.taken_year === year && item.taken_month === month) { item.action = 'excluded'; count++ } })
    if (count === 0) return res.json({ ok: true, changed: 0 })
    fs.copyFileSync(UNIFIED_PATH, UNIFIED_PATH + '.bak')
    fs.writeFile(UNIFIED_PATH, JSON.stringify(data, null, 2), 'utf-8', (writeErr) => {
      if (writeErr) return res.status(500).json({ error: writeErr.message })
      res.json({ ok: true, changed: count })
    })
  })
})

app.listen(PORT, () => {
  console.log(`Album Reset 서버 실행 중: http://localhost:${PORT}`)
  console.log(`썸네일 엔드포인트: ${sharp ? '활성화 ✓' : '비활성화 (npm install sharp 필요)'}`)
})
