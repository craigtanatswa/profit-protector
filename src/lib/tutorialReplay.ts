export type TutorialScreen = 'product' | 'sales' | 'reports' | 'customers' | 'settings'

const ALL_SCREENS: TutorialScreen[] = [
  'product',
  'sales',
  'reports',
  'customers',
  'settings',
]

const queued = new Set<TutorialScreen>()
const listeners = new Set<(screen: TutorialScreen) => void>()

export function subscribeQueuedTutorial(
  listener: (screen: TutorialScreen) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(screen: TutorialScreen) {
  listeners.forEach((listener) => listener(screen))
}

export function queueTutorial(screen: TutorialScreen): void {
  queued.add(screen)
  notify(screen)
}

export function queueAllTutorials(): void {
  for (const screen of ALL_SCREENS) {
    queued.add(screen)
    notify(screen)
  }
}

export function consumeQueuedTutorial(screen: TutorialScreen): boolean {
  if (!queued.has(screen)) return false
  queued.delete(screen)
  return true
}
