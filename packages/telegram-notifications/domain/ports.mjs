/** @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-портов */
export const PORTS = Object.freeze([
  'IdentityRegistryPort', 'ChannelAvailabilityPort', 'FamilyLinkAuthorizationPort', 'MembershipAuthorizationPort',
  'EventLedgerPort', 'DeliveryOutboxPort', 'TelegramDeliveryPort', 'ClockPort', 'LoggerPort',
])

export function assertPort(port, methods) {
  if (!port || methods.some((method) => typeof port[method] !== 'function')) throw new Error('dependency_unavailable')
  return port
}
