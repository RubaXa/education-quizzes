/** Exact comparable intervals for read-only Cloud Monitoring reports.
 * @see ../docs/audits/firestore-usage-2026-10-12.md#сопоставимые-окна */
export function usageWindow(args, now = new Date()) {
  let start, end, mode
  if (args[0] === '--minutes' && args.length === 2) {
    const minutes = Number(args[1])
    if (!Number.isInteger(minutes) || minutes < 2 || minutes > 120) throw new Error('Укажите 2–120 минут.')
    end = new Date(now)
    start = new Date(end.getTime() - minutes * 60_000)
    mode = 'minutes'
  } else if (args[0] === '--window' && args.length === 3) {
    if (![args[1], args[2]].every((value) => /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value))) {
      throw new Error('Для точного окна нужны два ISO-времени с часовым поясом.')
    }
    start = new Date(args[1])
    end = new Date(args[2])
    mode = 'fixed'
  } else if (args.length <= 1 && (args.length === 0 || !args[0].startsWith('--'))) {
    const hours = Number(args[0] ?? 24)
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('Укажите 1–168 часов.')
    end = new Date(now)
    start = new Date(end.getTime() - hours * 3_600_000)
    mode = 'hours'
  } else throw new Error('Используйте [часы], --minutes N или --window ISO_FROM ISO_TO.')
  const duration = end.getTime() - start.getTime()
  if (!Number.isFinite(duration) || duration < 120_000 || duration > 168 * 3_600_000 || end > now) {
    throw new Error('Окно должно закончиться не позднее текущего времени и длиться от 2 минут до 7 суток.')
  }
  return { start, end, mode, alignmentSeconds: mode === 'hours' || duration > 2 * 3_600_000 ? 3600 : 60 }
}
