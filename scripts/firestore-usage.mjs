#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault } from 'firebase-admin/app'
import { usageWindow } from './firestore-usage-window.mjs'

/** Read Cloud Monitoring aggregates without reading a Firestore document.
 * Usage Insights in Google Cloud is needed for collection-level attribution.
 * @see ../docs/audits/firestore-usage-2026-10-12.md
 */
const credentials = resolve('.local/adc.json')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = credentials
if (!existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) throw new Error('Нет локального доступа Google Cloud.')
const { start, end, mode, alignmentSeconds } = usageWindow(process.argv.slice(2))
const { access_token: token } = await applicationDefault().getAccessToken()
const project = 'education-9d7c6'
const metrics = [
  ['read', 'document/read_count', 'ALIGN_SUM'],
  ['write', 'document/write_count', 'ALIGN_SUM'],
  ['listeners', 'network/snapshot_listeners', 'ALIGN_MAX'],
  ['connections', 'network/active_connections', 'ALIGN_MAX'],
]
const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  ...(alignmentSeconds === 60 ? { minute: '2-digit' } : {}), hourCycle: 'h23' })
const byBucket = new Map()
const totals = {}
for (const [kind, suffix, aligner] of metrics) {
  const query = new URLSearchParams({ filter: `metric.type="firestore.googleapis.com/${suffix}"`,
    'interval.startTime': start.toISOString(), 'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': `${alignmentSeconds}s`, 'aggregation.perSeriesAligner': aligner, pageSize: '1000' })
  let pageToken
  do {
    if (pageToken) query.set('pageToken', pageToken)
    const response = await fetch(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) throw new Error(`Cloud Monitoring: ${response.status} ${response.statusText}`)
    const data = await response.json()
    for (const series of data.timeSeries ?? []) {
      const label = series.metric?.labels?.type ?? series.metric?.labels?.op ?? 'total'
      const key = `${kind}:${label}`
      for (const point of series.points ?? []) {
        const bucket = formatter.format(new Date(point.interval.endTime))
        const row = byBucket.get(bucket) ?? { bucket }
        const value = Number(point.value.int64Value ?? point.value.doubleValue ?? 0)
        row[key] = kind === 'listeners' || kind === 'connections'
          ? Math.max(row[key] ?? 0, value) : (row[key] ?? 0) + value
        byBucket.set(bucket, row)
        totals[key] = kind === 'listeners' || kind === 'connections'
          ? Math.max(totals[key] ?? 0, value) : (totals[key] ?? 0) + value
      }
    }
    pageToken = data.nextPageToken
  } while (pageToken)
}
const buckets = [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket))
console.log(JSON.stringify({ project, from: start.toISOString(), to: end.toISOString(), mode,
  alignmentSeconds, timezone: 'Europe/Moscow', source: 'Cloud Monitoring; estimates, not invoice', totals,
  buckets, ...(mode === 'hours' ? { hours: buckets.map(({ bucket, ...values }) => ({ hour: bucket, ...values })) } : {}) }, null, 2))
