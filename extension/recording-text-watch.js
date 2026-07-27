/**
 * Наблюдатель текста только во время записи.
 * Дополняет snapshot: ловит правки в contenteditable и вложенных text-узлах.
 */

const RECORDING_TEXT_WATCH_VERSION = '0.5.2'

if (globalThis.VisbugMcpRecordingTextWatch?.version !== RECORDING_TEXT_WATCH_VERSION) {
  globalThis.VisbugMcpRecordingTextWatch?.stop?.()

  const watch = {
    root: null,
    observer: null,
    baseline: new Map(),
    changes: new Map(),
    getSelector: null,
    url: '',

    reset() {
      this.baseline.clear()
      this.changes.clear()
    },

    lookupBeforeText(selector) {
      const entry = globalThis.__visbugMcpRecordingBefore?.find((e) => e.selector === selector)
      return entry?.text ?? null
    },

    recordElement(el) {
      const snap = globalThis.VisbugMcpSnapshot
      if (!el || !snap || typeof this.getSelector !== 'function') return

      const owner = snap.findTextOwnerElement(el)
      if (!owner || !this.root?.contains(owner)) return

      const selector = this.getSelector(owner)
      const newValue = snap.captureElementText(owner) ?? snap.normalizeText(owner.textContent)
      if (!newValue) return

      if (!this.baseline.has(selector)) {
        const fromBefore = this.lookupBeforeText(selector)
        this.baseline.set(selector, fromBefore)
      }

      const oldValue = this.baseline.get(selector) ?? null
      if (oldValue === newValue) {
        this.changes.delete(selector)
        return
      }

      this.changes.set(selector, {
        type: 'text',
        selector,
        oldValue,
        newValue,
        tag: owner.tagName.toLowerCase(),
        url: this.url,
        timestamp: Date.now(),
        applied: false,
        source: 'text-watch',
      })
    },

    onInput(event) {
      const target = event.target
      if (target instanceof HTMLElement) this.recordElement(target)
    },

    onMutation(records) {
      for (const record of records) {
        if (record.type === 'characterData') {
          const parent = record.target?.parentElement
          if (parent) this.recordElement(parent)
          continue
        }

        if (record.type === 'childList') {
          if (record.target instanceof HTMLElement) this.recordElement(record.target)
          for (const node of record.addedNodes) {
            if (node.parentElement) this.recordElement(node.parentElement)
          }
        }
      }
    },

    start(root, getSelector, { url = location.href } = {}) {
      this.stop()
      if (!root || typeof getSelector !== 'function') return

      this.root = root
      this.getSelector = getSelector
      this.url = url
      this.reset()

      this.onInputBound = (e) => this.onInput(e)
      this.onMutationBound = (records) => this.onMutation(records)

      root.addEventListener('input', this.onInputBound, true)
      document.addEventListener('input', this.onInputBound, true)

      this.observer = new MutationObserver(this.onMutationBound)
      this.observer.observe(root, {
        characterData: true,
        characterDataOldValue: true,
        childList: true,
        subtree: true,
      })
    },

    stop() {
      this.observer?.disconnect()
      this.observer = null
      if (this.onInputBound) {
        this.root?.removeEventListener('input', this.onInputBound, true)
        document.removeEventListener('input', this.onInputBound, true)
      }
      this.onInputBound = null
      this.onMutationBound = null
      this.root = null
      this.getSelector = null
    },

    drainChanges() {
      const snap = globalThis.VisbugMcpSnapshot
      const list = [...this.changes.values()]
      this.reset()
      return snap?.dedupeNestedTextChanges ? snap.dedupeNestedTextChanges(list) : list
    },
  }

  globalThis.VisbugMcpRecordingTextWatch = {
    version: RECORDING_TEXT_WATCH_VERSION,
    start: (root, getSelector, opts) => watch.start(root, getSelector, opts),
    stop: () => watch.stop(),
    drainChanges: () => watch.drainChanges(),
  }
}
