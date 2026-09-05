// VerdaAI Cookie 导出助手 —— popup 逻辑
// 关键：用 chrome.cookies.getAll 读取全部 Cookie（含 httpOnly），普通 document.cookie 读不到 httpOnly 字段。
// v1.1.0：复制前先清洗（丢弃非法/过期片段、同名去重）+ 登录态校验，粘出来的串无需再手工处理。

// ── 各平台关键字段 ───────────────────────────────────────
// core：登录态核心字段，缺失即拦截（但仍可通过「仍要复制」兜底复制）。
// whitelist：仅在勾选「仅保留关键字段」时用于裁剪。
// 字段来源对齐 frontend/src/pages/SettingsPage.tsx 的 COOKIE_GUIDE，
// 额外补 ttwid（实测抖音 Cookie 中存在，但 COOKIE_GUIDE 未列）。
const KEY_FIELDS = {
  douyin: {
    label: '抖音',
    core: 'sessionid',
    whitelist: [
      'sessionid',
      'sid_tt',
      'sid_ucp_v1',
      'passport_csrf_token',
      'odin_tt',
      's_v_web_id',
      'ttwid',
    ],
  },
  xiaohongshu: {
    label: '小红书',
    core: 'web_session',
    whitelist: ['web_session', 'a1', 'webId', 'gid'],
  },
  bilibili: {
    label: 'B站',
    core: 'SESSDATA',
    whitelist: ['SESSDATA', 'bili_jct', 'buvid3', 'DedeUserID'],
  },
}

// Cookie 名/值里不允许出现的字符：空白、控制字符、引号、分号、逗号（名里再加等号）。
// 这些字符会让 http.cookiejar / SimpleCookie 截断或抛错，宁可整条丢弃也不静默改值。
const BAD_NAME = /[\s\x00-\x1F\x7F";,=]/
const BAD_VALUE = /[\s\x00-\x1F\x7F";,]/

/** 按 host 匹配平台配置；未知站点返回 null（不校验、不裁剪）。 */
function platformOf(host) {
  for (const key of Object.keys(KEY_FIELDS)) {
    if (host.includes(key)) return KEY_FIELDS[key]
  }
  return null
}

/**
 * 清洗 Cookie 列表：只保留能被标准 Cookie 解析器安全消费的项。
 * @param {object[]} cookies chrome.cookies.Cookie[]
 * @returns {{list: object[], dropped: number}}
 */
function sanitize(cookies) {
  const now = Date.now() / 1000
  const byName = new Map()
  let dropped = 0
  for (const c of cookies) {
    const name = c.name == null ? '' : String(c.name).trim()
    const value = c.value == null ? '' : String(c.value)
    // 空名（DevTools 偶发混入的 "=douyin.com"）/ 非法字符 / 已过期 → 丢弃
    if (!name || BAD_NAME.test(name) || (value && BAD_VALUE.test(value))) {
      dropped++
      continue
    }
    if (c.expirationDate && c.expirationDate < now) {
      dropped++
      continue
    }
    const prev = byName.get(name)
    if (!prev) {
      byName.set(name, c)
      continue
    }
    // 同名去重：非空值优先 → 过期更晚优先 → 完全相同则后写覆盖（与浏览器语义一致）
    const expNew = c.expirationDate || 0
    const expPrev = prev.expirationDate || 0
    if ((!prev.value && value) || expNew > expPrev || expNew === expPrev) {
      byName.set(name, c)
    }
    dropped++
  }
  return { list: Array.from(byName.values()), dropped }
}

/** 最早过期时间提示：全部无 expirationDate 即视为会话 Cookie。 */
function expiryHint(list) {
  const dated = list
    .filter((c) => c.expirationDate)
    .map((c) => c.expirationDate)
  if (!dated.length) return '会话 Cookie，关闭浏览器即失效'
  const hours = (Math.min.apply(null, dated) - Date.now() / 1000) / 3600
  if (hours <= 0) return '存在已过期项，建议重新登录后导出'
  if (hours < 24) return '最早 ' + Math.max(1, Math.round(hours)) + ' 小时后过期'
  return '最早 ' + Math.round(hours / 24) + ' 天后过期'
}

/** 拼成 Cookie 请求头格式：name1=v1; name2=v2 */
function toCookieStr(list) {
  return list
    .map((c) => c.name + '=' + c.value)
    .join('; ')
}

// ── 界面交互 ────────────────────────────────────────────
const btn = document.getElementById('copy')
const onlyKey = document.getElementById('onlyKey')
const status = document.getElementById('status')
const forceBtn = document.getElementById('force')
// 被拦截时暂存的待复制列表（点「仍要复制」才真正写入剪贴板）
let pending = []

function setStatus(text, kind, meta) {
  status.textContent = text
  if (meta) {
    const span = document.createElement('span')
    span.className = 'meta'
    span.textContent = meta
    status.appendChild(span)
  }
  status.className = kind // 'ok' | 'err' | 'risk'
}

function hideForce() {
  forceBtn.hidden = true
  pending = []
}

async function doCopy(list) {
  await navigator.clipboard.writeText(toCookieStr(list))
  const httpOnlyCount = list.filter((c) => c.httpOnly).length
  setStatus(
    '已复制 ' + list.length + ' 个 Cookie（含 ' + httpOnlyCount + ' 个 httpOnly）✓',
    'ok',
    expiryHint(list),
  )
  hideForce()
}

btn.addEventListener('click', async () => {
  hideForce()
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab || !tab.url) {
      setStatus('无法读取当前标签页，请保持在目标页面。', 'err')
      return
    }
    const url = new URL(tab.url)
    const cookies = await chrome.cookies.getAll({ url: url.origin })
    if (!cookies.length) {
      setStatus('该站点（' + url.origin + '）无 Cookie，请先登录对应平台。', 'err')
      return
    }

    const { list } = sanitize(cookies)
    const plat = platformOf(url.hostname)
    // 「仅保留关键字段」仅在已知平台生效，未知站点一律全量复制
    const final =
      plat && onlyKey && onlyKey.checked
        ? list.filter((c) => plat.whitelist.indexOf(c.name) !== -1)
        : list

    // 登录态核心字段缺失 → 拦截（不写剪贴板），由用户点「仍要复制」兜底
    if (plat && !final.some((c) => c.name === plat.core && c.value)) {
      setStatus('未检测到 ' + plat.core + '，可能未登录' + plat.label + '。', 'risk')
      pending = final
      forceBtn.hidden = false
      return
    }

    await doCopy(final)
  } catch (e) {
    setStatus('复制失败：' + (e && e.message ? e.message : String(e)), 'err')
  }
})

forceBtn.addEventListener('click', async () => {
  try {
    await doCopy(pending)
  } catch (e) {
    setStatus('复制失败：' + (e && e.message ? e.message : String(e)), 'err')
  }
})
