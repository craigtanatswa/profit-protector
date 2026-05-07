import type { AlertButton, AlertOptions } from 'react-native'

export type QueuedAlert = {
  title: string
  message?: string
  buttons: AlertButton[]
  options?: AlertOptions
  fallback: () => void
}

const queue: QueuedAlert[] = []
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

export function subscribeAlertQueue(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function enqueueAlert(item: QueuedAlert) {
  queue.push(item)
  notify()
}

export function peekAlert(): QueuedAlert | undefined {
  return queue[0]
}

export function shiftAlert(): QueuedAlert | undefined {
  const item = queue.shift()
  notify()
  return item
}
