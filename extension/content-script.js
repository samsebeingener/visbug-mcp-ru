/**
 * visbug-mcp — content-script.js
 */

const WS_URL = 'ws://127.0.0.1:4844'
const RECONNECT_DELAY = 2000
const VISBUG_ATTR = ['style', 'class', 'src', 'href', 'alt', 'title', 'contenteditable']

let socket = null
let connected = false

function connect() {
  socket = new WebSocket(WS_URL)

  socket.addEventListener('open', () => {
    connected = true
    console.debug('[visbug-mcp] connected')
  })

  socket.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.event === 'clear-visbug-storage') {
        const removed = Object.keys(localStorage)
          .filter(k => /visbug|vis-bug/i.test(k))
        removed.forEach(k => localStorage.removeItem(k))
        console.debug(`[visbug-mcp] localStorage cleared (${removed.length} key(s))`)
      }
    } catch {}
  })

  socket.addEventListener('close', () => {
    connected = false
    setTimeout(connect, RECONNECT_DELAY)
  })

  socket.addEventListener('error', () => {})
}

function send(payload) {
  if (connected && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload))
  }
  // Mutations pré-connexion ignorées — ce sont des artifacts de rendu page, pas des changements VisBug
}

function getSelector(el) {
  try {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return 'body'
    if (el === document.body || el === document.documentElement) return 'body'
    if (el.id) return `#${CSS.escape(el.id)}`

    const attrs = el.attributes ? Array.from(el.attributes) : []
    const vueAttr = attrs.find(a => a.name.startsWith('data-v-'))
    if (vueAttr) {
      const tag = el.tagName.toLowerCase()
      const cls = el.classList?.length ? '.' + [...el.classList].map(CSS.escape).join('.') : ''
      return `${tag}[${vueAttr.name}]${cls}`
    }

    const tag = el.tagName.toLowerCase()
    const parent = el.parentElement
    if (!parent || parent === document.documentElement) return tag
    const siblings = Array.from(parent?.children || []).filter(c => c.tagName === el.tagName)
    const idx = siblings.indexOf(el) + 1
    const nthPart = siblings.length > 1 ? `:nth-of-type(${idx})` : ''
    const cls = el.classList?.length ? '.' + [...el.classList].map(CSS.escape).join('.') : ''
    return `${getSelector(parent)} > ${tag}${cls}${nthPart}`
  } catch {
    return 'body'
  }
}

function parseCSSChanges(oldStyle, newStyle) {
  const parse = s => {
    const map = {}
    if (!s) return map
    s.split(';').forEach(decl => {
      const [prop, ...rest] = decl.split(':')
      if (prop && rest.length) map[prop.trim()] = rest.join(':').trim()
    })
    return map
  }
  const oldMap = parse(oldStyle)
  const newMap = parse(newStyle)
  const allProps = new Set([...Object.keys(oldMap), ...Object.keys(newMap)])
  const changes = []
  allProps.forEach(prop => {
    if (oldMap[prop] !== newMap[prop]) {
      changes.push({ property: prop, old: oldMap[prop] || null, new: newMap[prop] || null })
    }
  })
  return changes
}

function parseMutation(record) {
  const el = record.target
  const selector = getSelector(el)
  const timestamp = Date.now()

  if (record.type === 'attributes') {
    const attr = record.attributeName
    if (attr === 'style') {
      return parseCSSChanges(record.oldValue, el.getAttribute(attr)).map(c => ({
        type: 'style', selector, property: c.property,
        oldValue: c.old, newValue: c.new, tag: el.tagName.toLowerCase(), timestamp,
      }))
    }
    return [{ type: 'attribute', selector, attribute: attr,
      oldValue: record.oldValue, newValue: el.getAttribute(attr),
      tag: el.tagName.toLowerCase(), timestamp }]
  }

  if (record.type === 'characterData') {
    return [{ type: 'text', selector: getSelector(el.parentElement),
      oldValue: record.oldValue, newValue: el.textContent,
      tag: el.parentElement?.tagName.toLowerCase(), timestamp }]
  }

  if (record.type === 'childList') {
    const mutations = []
    // Detect text edits: one text node removed + one text node added on the same parent
    const removedTexts = [...record.removedNodes].filter(n => n.nodeType === Node.TEXT_NODE)
    const addedTexts = [...record.addedNodes].filter(n => n.nodeType === Node.TEXT_NODE)
    if (removedTexts.length > 0 || addedTexts.length > 0) {
      const oldValue = removedTexts.map(n => n.textContent).join('') || null
      const newValue = addedTexts.map(n => n.textContent).join('') ||
        (el.nodeType === Node.ELEMENT_NODE ? el.textContent : null)
      if (oldValue !== newValue)
        mutations.push({ type: 'text', selector, oldValue, newValue,
          tag: el.tagName?.toLowerCase(), timestamp })
    }
    record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE)
        mutations.push({ type: 'node-added', selector: getSelector(node),
          parentSelector: selector, html: node.outerHTML?.slice(0, 300), timestamp })
    })
    record.removedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE)
        mutations.push({ type: 'node-removed', selector, tag: node.tagName?.toLowerCase(), timestamp })
    })
    return mutations
  }

  return []
}

function isVisBugInternal(record) {
  const tag = record.target?.tagName?.toLowerCase()
  return tag?.startsWith('vis-') || tag?.startsWith('visbug') || tag?.startsWith('eye-') || tag === 'visbug'
}

const observer = new MutationObserver(records => {
  const mutations = []
  records.forEach(record => {
    if (isVisBugInternal(record)) return
    if (record.type === 'attributes' && !VISBUG_ATTR.includes(record.attributeName)) return
    mutations.push(...parseMutation(record))
  })
  if (mutations.length === 0) return
  send({ event: 'mutations', url: location.href, mutations })
})

observer.observe(document.documentElement, {
  attributes: true, attributeOldValue: true,
  characterData: true, characterDataOldValue: true,
  childList: true, subtree: true,
  attributeFilter: VISBUG_ATTR,
})

connect()
console.debug('[visbug-mcp] observer started on', location.href)
