import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = process.argv[2]
if (!/^[a-f0-9]{64}$/.test(version ?? '')) throw new Error('Для service worker нужен SHA-256 сборки.')
const dist = resolve('dist')
const assets = readdirSync(resolve(dist, 'assets')).filter((name) => /\.(js|css|woff2?)$/.test(name)).map((name) => `assets/${name}`)
const precache = [
  'index.html', 'manifest.webmanifest',
  'icons/education.svg', 'icons/education-180.png', 'icons/education-192.png', 'icons/education-512.png',
  ...assets,
].map((path) => `/education-quizzes/${path}`)
const template = readFileSync(resolve('pwa/sw-template.js'), 'utf8')
const content = template.replace('__CACHE_NAME__', `education-shell-${version.slice(0, 16)}`).replace('__PRECACHE_URLS__', JSON.stringify(precache))
writeFileSync(resolve(dist, 'sw.js'), content)
