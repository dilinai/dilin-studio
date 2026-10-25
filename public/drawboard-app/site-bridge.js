/* ── 命令参数规格（网站自有·begin cmd-spec）──────────────────────────────────────────────
   画板每条命令的 params 是一段给人看的说明（「{layerId?: 层 id, radius?: 0..250=5, mode?:"a|b"} 说明 → 回传」）。
   这里把开头那个 {…} 拆成正式规格：参数名、可省与否、型别（boolean／number／string／enum／array／object／any）、范围 a..b、预设 =x、选项 "a|b"。
   拆得干净（每一项都认得出参数名、没写「也可平铺」这类开放说法）⇒ closed：没列的参数一律报 unknown parameter。
   给 agent 走的那条路（网站 drawboard_run／batch、单机 MCP）先过 check 再跑；人在画面上按的不经这里。
   纯函数·不碰画板物件（node 单测直接载这一段）。 */
(function (root) {
  var OPEN = { '(': ')', '（': '）', '{': '}', '[': ']', '「': '」', '“': '”' }
  var CLOSE = { ')': 1, '）': 1, '}': 1, ']': 1, '」': 1, '”': 1 }
  /* 开头 {…}（照括号配对）·没有 ⇒ null */
  function headBlock(text) {
    var s = String(text || '').replace(/^\s+/, '')
    if (s.charAt(0) !== '{') return null
    var depth = 0, q = null
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i)
      if (q) { if (c === q) q = null; continue }
      if (c === '"' || c === '`') { q = c; continue }
      if (OPEN[c]) depth++
      else if (CLOSE[c]) { depth--; if (depth === 0) return { inner: s.slice(1, i), rest: s.slice(i + 1) } }
    }
    return null
  }
  /* 按最外层逗号切（括号、引号里的不切；中文逗号「，」也算分隔） */
  function splitTop(s) {
    var out = [], depth = 0, q = null, cur = ''
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i)
      if (q) { cur += c; if (c === q) q = null; continue }
      if (c === '"' || c === '`') { q = c; cur += c; continue }
      if (OPEN[c]) depth++
      else if (CLOSE[c]) depth--
      if (depth === 0 && (c === ',' || c === '，')) { out.push(cur); cur = ''; continue }
      cur += c
    }
    if (cur.trim()) out.push(cur)
    return out.map(function (x) { return x.trim() }).filter(Boolean)
  }
  var NAME = '[A-Za-z_$][\\w$]*'
  var KEY = new RegExp('^(' + NAME + ')\\s*(\\?)?(?=\\s|[:：=（(]|$)')
  /* 「width?/height?」「id?|ids?:[…]」「x?/y?（…）」＝几个参数共用一段说明 */
  var ALTS = new RegExp('^(' + NAME + '\\??(?:\\s*[/|]\\s*' + NAME + '\\??)+)(?=\\s|[:：=（(]|$)')
  var RANGE = /(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)/
  /* 括号里的（巢状物件、说明）拿掉，只看这个参数自己那一层 */
  function flat(v) {
    var out = '', depth = 0, q = null
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i)
      if (q) { if (depth === 0) out += c; if (c === q) q = null; continue }
      if (c === '"') { q = c; if (depth === 0) out += c; continue }
      if (OPEN[c]) { depth++; if (depth === 1) out += c === '{' ? '{}' : c === '[' ? '[]' : ' '; continue }
      if (CLOSE[c]) { depth = Math.max(0, depth - 1); continue }
      if (depth === 0) out += c
    }
    return out
  }
  function one(name, optional, val) {
    var f = flat(val).trim(), body = f.replace(/^[:：]\s*/, '')
    var p = { name: name, optional: optional }
    var en = /^"([^"]*\|[^"]*)"/.exec(body) || /^'([^']*\|[^']*)'/.exec(body)
    if (en) { p.type = 'enum'; p.values = en[1].split('|').map(function (x) { return x.trim() }).filter(Boolean) }
    else if (/^(bool|boolean)\b/i.test(body)) p.type = 'boolean'
    else if (/^(number|int|integer|float)\b/i.test(body)) p.type = 'number'
    else if (/^\[\]/.test(body)) p.type = 'array'
    else if (/^\{\}/.test(body)) p.type = 'object'
    else if (/^(string|str)\b/i.test(body)) p.type = 'string'
    else p.type = 'any'
    var r = RANGE.exec(f)
    if (r && (p.type === 'number' || p.type === 'any')) { p.type = 'number'; p.min = +r[1]; p.max = +r[2] }
    var d = /(?:^|[^=<>!])=\s*("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false|null|#[0-9a-fA-F]{3,8})/.exec(f)
    if (d) {
      var dv = d[1]
      p.default = /^["']/.test(dv) ? dv.slice(1, -1) : dv === 'true' ? true : dv === 'false' ? false : dv === 'null' ? null : +dv
      p.optional = true
      var alt = f.slice(d.index + d[0].length).replace(/^\s+/, '').charAt(0) === '|'
      if (p.type === 'any' && !alt) p.type = typeof p.default === 'boolean' ? 'boolean' : typeof p.default === 'number' ? 'number' : typeof p.default === 'string' ? 'string' : 'any'
    }
    var doc = val.replace(/^\s*[:：]?\s*/, '').trim()
    if (doc) p.doc = doc.slice(0, 200)
    return p
  }
  /* 一条命令的 params 说明 ⇒ 规格 */
  function parse(text) {
    var h = headBlock(text)
    if (!h) return { params: [], closed: false, note: 'no {…} parameter list' }
    var items = splitTop(h.inner), params = [], closed = true, seen = {}
    var add = function (p) { if (!seen[p.name]) { seen[p.name] = 1; params.push(p) } }
    for (var i = 0; i < items.length; i++) {
      var it = items[i], a = ALTS.exec(it)
      if (a) {
        var rest = it.slice(a[0].length)
        a[1].split(/\s*[/|]\s*/).forEach(function (n) { add(one(n.replace(/\?$/, ''), true, rest)) })
        var more2 = flat(rest), re2 = new RegExp('\\|\\s*(' + NAME + ')\\?', 'g'), m2
        while ((m2 = re2.exec(more2))) add({ name: m2[1], optional: true, type: 'any' })
        continue
      }
      var m = KEY.exec(it)
      if (!m) { closed = false; continue }
      var val = it.slice(m[0].length)
      add(one(m[1], !!m[2], val))
      // 「width?/height?（…）| scale?（…）」：说明后面再用 | 接另一个可省参数
      var more = flat(val), re = new RegExp('\\|\\s*(' + NAME + ')\\?', 'g'), mm
      while ((mm = re.exec(more))) add({ name: mm[1], optional: true, type: 'any' })
    }
    // 「也可平铺」＝params 里那包的键也能直接放外层·「其余」「…」＝没列全 ⇒ 不收紧
    if (/平铺|平鋪|其余|其餘|其他参数|直接给/.test(h.inner) || /\.\.\.|…/.test(flat(h.inner))) closed = false
    return { params: params, closed: closed }
  }
  var UNIVERSAL = { ui: 1 }
  /* 处理函数自己读的参数名（说明漏写的也算数：照程式真能收的放行，免得挡掉本来能用的）。
     看第一个参数叫什么（p／params／o…），收 p.x、p?.x、p['x']、{a, b} = p 这几种写法 */
  function readKeys(src) {
    var s = String(src || ''), out = {}
    var m = /^\s*(?:async\s*)?(?:function\s*[\w$]*\s*)?\(?\s*(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))/.exec(s)
    if (!m) return []
    if (m[1]) { m[1].split(',').forEach(function (x) { var k = /^\s*([A-Za-z_$][\w$]*)/.exec(x); if (k) out[k[1]] = 1 }); return Object.keys(out) }
    var v = m[2].replace(/[$]/g, '\\$'), re
    re = new RegExp('\\b' + v + '\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)', 'g'); while ((m = re.exec(s))) out[m[1]] = 1
    re = new RegExp('\\b' + v + '\\s*\\[\\s*[\'"]([A-Za-z_$][\\w$]*)[\'"]\\s*\\]', 'g'); while ((m = re.exec(s))) out[m[1]] = 1
    re = new RegExp('\\{([^{}]*)\\}\\s*=\\s*' + v + '\\b', 'g')
    while ((m = re.exec(s))) m[1].split(',').forEach(function (x) { var k = /^\s*([A-Za-z_$][\w$]*)/.exec(x); if (k) out[k[1]] = 1 })
    return Object.keys(out).filter(function (k) { return !/^(hasOwnProperty|toString|length|constructor)$/.test(k) })
  }
  var cache = {}
  function specOf(id, text) {
    var k = id + '\u0000' + text
    return cache[k] || (cache[k] = parse(text))
  }
  /* 这次叫法对不对：回 null＝没问题；回 {error, message, known} ＝不跑 */
  function check(id, text, params, extra) {
    var sp = specOf(id, text), p = params || {}
    var also = {}
    ;(extra || []).forEach(function (k) { also[k] = 1 })
    var by = {}
    for (var i = 0; i < sp.params.length; i++) by[sp.params[i].name] = sp.params[i]
    var known = sp.params.map(function (x) { return x.name })
    for (var k in p) {
      if (!Object.prototype.hasOwnProperty.call(p, k)) continue
      if (k.charAt(0) === '_' || UNIVERSAL[k]) continue
      var d = by[k], v = p[k]
      if (!d) {
        if (!sp.closed || also[k]) continue
        var near = known.filter(function (n) { return n.toLowerCase() === k.toLowerCase() || n.toLowerCase().indexOf(k.toLowerCase()) >= 0 || k.toLowerCase().indexOf(n.toLowerCase()) >= 0 })
        return { error: 'unknown_parameter', parameter: k, known: known,
          message: "unknown parameter '" + k + "' for " + id + (near.length ? " (did you mean '" + near[0] + "'?)" : '') + '. Parameters: ' + (known.length ? known.join(', ') : '(none)') }
      }
      if (v === undefined || v === null) continue
      if (d.type === 'boolean' && typeof v !== 'boolean') return { error: 'bad_parameter', parameter: k, message: "parameter '" + k + "' of " + id + ' must be true or false, got ' + JSON.stringify(v) }
      if (d.type === 'number') {
        if (typeof v !== 'number' || !isFinite(v)) return { error: 'bad_parameter', parameter: k, message: "parameter '" + k + "' of " + id + ' must be a number' + (d.min !== undefined ? ' (' + d.min + '..' + d.max + ')' : '') + ', got ' + JSON.stringify(v) }
        if (d.min !== undefined && (v < d.min || v > d.max)) return { error: 'bad_parameter', parameter: k, message: "parameter '" + k + "' of " + id + ' must be within ' + d.min + '..' + d.max + ', got ' + v }
      }
      if (d.type === 'enum' && typeof v === 'string' && d.values.indexOf(v) < 0) return { error: 'bad_parameter', parameter: k, message: "parameter '" + k + "' of " + id + ' must be one of ' + d.values.join(', ') + ', got ' + JSON.stringify(v) }
    }
    return null
  }
  /* 不需要开着的文件也能跑的命令（开新档、开档、切分页、看说明、操作网页本身） */
  var NO_DOC = /^(file\.(new|open|openProject|recent)|ps\.document\.(new|list|activate)|ps\.file\.(new|open)|ui\.|preview\.|help\.|app\.|page\.list|doc\.inspect)/
  function availability(id, docOpen) {
    if (!docOpen && !NO_DOC.test(id)) return { available: false, disabledReason: 'no document is open — run file.new (or open one) first' }
    return { available: true }
  }
  var api = { parse: parse, check: check, specOf: specOf, readKeys: readKeys, availability: availability }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.__dlCmdSpec = api
})(typeof window !== 'undefined' ? window : this);
/* ── end cmd-spec ── */

/* 堤麟网站接线（网站自有·⛔ 不属上游画板本体）——同步画板时插在 index.html 末尾（ui.js 之后）。
   画板的 CMD／UI／Lang… 是顶层 const（不挂 window）·外面的网页拿不到 ⇒ 这里收成一包挂到 window.__dlSite，
   网站页的宿主接线从同源 iframe 拿去改命令（存档进云盘、导出进云盘）、加标签页与 logo。
   接线保持上游对象独立；多分頁的網站存讀必須固定宿主那份，不能跟著目前暫存頁走。 */
(function () {
  function pick(get) { try { return get() } catch (e) { return null } }
  window.__dlSite = {
    CMD: pick(function () { return CMD }),
    UI: pick(function () { return UI }),
    Lang: pick(function () { return Lang }),
    Menubar: pick(function () { return Menubar }),
    Toolbar: pick(function () { return Toolbar }),
    // 上游 Docs 的宿主保護在 DilinCanvas.serialize，原 Project 仍代表目前頁。
    // 網站自存有延遲，使用者可能已切到 PSD／智慧物件暫存頁；只能經宿主 API 取內容。
    Project: pick(function () { return new Proxy(Project, {
      get: function (target, key) {
        if (key === 'serialize') return function (opts) { return window.DilinCanvas ? window.DilinCanvas.serialize(opts) : target.serialize(opts) }
        if (key === 'serializeAsync') return function (opts) { return window.DilinCanvas && window.DilinCanvas.serializeAsync ? window.DilinCanvas.serializeAsync(opts) : target.serializeAsync ? target.serializeAsync(opts) : Promise.resolve(target.serialize(opts)) }
        if (key === 'load') return async function (json) {
          var docs = window.Docs, host = docs && docs.list.find(function (d) { return d.host })
          if (host && docs.activeId() !== host.id) {
            var switched = await CMD.run('ps.document.activate', { document: host.id })
            if (!switched || switched.ok === false || docs.activeId() !== host.id) throw new Error(Lang.cur === 'en' ? 'Close the drawboard dialog before opening another cloud file.' : Lang.cur === 'zh-Hans' ? '请先关闭画板对话框，再打开另一份云端文件。' : '請先關閉畫板對話框，再開啟另一份雲端文件。')
          }
          // 空雲檔也須先切宿主：原網站直接 file.new，會把目前暫存頁重置、存回卻仍取舊宿主。
          if (json && Array.isArray(json.layers) && json.layers.length === 0) {
            var created = await CMD.run('file.new', { width: json.width, height: json.height, background: '#ffffff' })
            if (!created || created.ok === false) throw new Error(Lang.cur === 'en' ? 'The drawboard could not be opened. Close any open dialog and try again.' : Lang.cur === 'zh-Hans' ? '画板没打开，请先关闭画板对话框后再试。' : '畫板沒開啟，請先關閉畫板對話框後再試。')
          } else await target.load(json)
          if (docs && docs.render) docs.render()
        }
        // 其餘屬性與方法照原 Project（含 this），不把上游介面縮成三項。
        var value = target[key]
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) }),
    // History 是各分頁共用；讓網站在歷史作用當下識別宿主，暫存頁不排雲檔自存。
    isHostActive: function () { var docs = window.Docs; return !docs || !docs.list.length || docs.isHostActive() },
    History: pick(function () { return History }),
    Doc: pick(function () { return Doc }),
    composite: typeof composite === 'function' ? composite : null,
    // 每份雲端畫板各佔一個分頁。上游 Docs 的 host 旗標＝「網站雲檔那份」——
    //   雲檔分頁一律掛 host（可以不只一份）⇒ 收起時留 hostJSON、在前面時報改動、Ctrl+S 存回雲端；上游自己開的（開舊檔、新建、智慧物件內容）照舊是暫存分頁。
    Tabs: pick(function () {
      var docs = window.Docs
      if (!docs || !CMD.map['ps.document.new']) return null
      // 換上 host 旗標的當下若正是前面那份：上游 syncSuspend 只在換頁時算 ⇒ 這裡補解開「不報改動」
      function setHost(d, on) {
        d.host = !!on
        if (docs.active() !== d) return
        if (on && docs._susp) { SiteHooks._suspend = Math.max(0, SiteHooks._suspend - 1); docs._susp = false }
        else if (!on && !docs._susp) { SiteHooks._suspend++; docs._susp = true }
      }
      var api = {
        activeId: function () { return docs.activeId() },
        has: function (id) { return !!docs.byId(id) },
        ids: function () { return docs.list.map(function (d) { return d.id }) },
        /** 分頁序號或 id ⇒ id */
        resolve: function (ref) { var d = typeof ref === 'string' ? docs.byId(ref) : docs.list[+ref]; return d ? d.id : null },
        activate: function (id) { var r = CMD.run('ps.document.activate', { document: id }); return !!r && r.ok !== false && docs.activeId() === id },
        host: function (id, on) { var d = docs.byId(id); if (d) setHost(d, on) },
        /** 不在前面那份收起時留的工程檔（在前面／沒留＝null）·深拷一份 */
        json: function (id) { var d = docs.byId(id); return d && d !== docs.active() && d.hostJSON ? JSON.parse(JSON.stringify(d.hostJSON)) : null },
        /** 新分頁載入一份雲檔（空檔＝白底；bg 給 null＝透明·多頁的新增一頁用）·分頁名＝雲端檔名 ⇒ 回分頁 id */
        open: async function (json, name, bg) {
          var w = json && json.width > 0 ? json.width : 1200, h = json && json.height > 0 ? json.height : 675
          var made = await CMD.run('ps.document.new', { width: w, height: h, background: bg === undefined ? '#ffffff' : bg })
          if (!made || made.ok === false) throw new Error(Lang.cur === 'en' ? 'The drawboard could not be opened. Close any open dialog and try again.' : Lang.cur === 'zh-Hans' ? '画板没打开，请先关闭画板对话框后再试。' : '畫板沒開啟，請先關閉畫板對話框後再試。')
          var d = docs.active()
          setHost(d, true)
          if (json && Array.isArray(json.layers) && json.layers.length) {
            try { await Project.load(json) } catch (e) {
              // 載壞了 ⇒ 半份分頁拿掉（先摘 host：上游關宿主＝換成空白、不會拿掉）
              if (docs.byId(d.id)) { setHost(d, false); await CMD.run('ps.document.close', { document: d.id, ui: false }) }
              throw e
            }
          }
          api.name(name)
          if (window.PsFile) PsFile.markSaved()
          History.clear()
          return d.id
        },
        /** 前面那份的分頁名（＝雲端檔名·分得出是哪份） */
        name: function (name) {
          var st = window.PsFile && PsFile._st
          if (st && name) st.name = String(name)
          if (docs.render) docs.render()
        },
        /** 多頁：改任一分頁的名字（在前面＝改 PsFile 那份；收起的＝改收起時留的那份，換回來時照新名） */
        label: function (id, name) {
          var d = docs.byId(id)
          if (!d || !name) return false
          if (docs.active() === d) { var st = window.PsFile && PsFile._st; if (st) st.name = String(name) }
          else { d.name = String(name); if (d.state && d.state.st) d.state.st.name = String(name) }
          if (docs.render) docs.render()
          return true
        },
        /** 多頁：刪掉一頁＝把那個分頁靜靜拿掉（先摘 host：上游關宿主＝換成空白·⛔ 拿掉）；_page 讓網站包的關閉命令放行、⛔ 再問存不存 ⇒ 拿掉了回 true */
        close: async function (id) {
          var d = docs.byId(id)
          if (!d) return true
          var wasHost = d.host
          setHost(d, false)
          await CMD.run('ps.document.close', { document: id, ui: false, save: false, _page: true })
          if (docs.byId(id)) { setHost(d, wasHost); return false }
          return true
        },
      }
      // 多頁：分頁列尾巴一顆「＋」（新增一頁＝網站的 page.new）、雲檔分頁按右鍵＝改名／刪這一頁（網站的 page.rename／page.delete）·上游每次重畫整條 ⇒ 包 render 每次補上
      var L3 = function (a, b, c) { return Lang.cur === 'en' ? c : Lang.cur === 'zh-Hans' ? b : a }
      var render0 = docs.render
      if (render0 && !render0.__dlPages) {
        docs.render = function () {
          var r = render0.apply(this, arguments)
          var bar = document.getElementById('docTabs')
          if (bar && CMD.map['page.new'] && docs.isHostActive()) {
            var plus = document.createElement('div')
            plus.className = 'doctab-add'; plus.textContent = '＋'; plus.title = L3('在這份畫板新增一頁', '在这份画板新增一页', 'Add a page to this drawboard')
            plus.setAttribute('data-testid', 'drawboard-page-add')
            plus.style.cssText = 'display:flex;align-items:center;padding:0 10px;cursor:pointer;color:#bbb;background:#262626'
            plus.onclick = function (e) { e.stopPropagation(); CMD.run('page.new', { ui: true }) }
            bar.appendChild(plus)
          }
          if (bar && !bar.__dlPageMenu) {
            bar.__dlPageMenu = true
            bar.addEventListener('contextmenu', function (e) {
              var t = e.target && e.target.closest ? e.target.closest('.doctab') : null
              var d = t && docs.byId(t.dataset.doc)
              if (!d || !d.host || !CMD.map['page.rename']) return
              e.preventDefault()
              var old = document.getElementById('dlPageMenu'); if (old) old.remove()
              var m = document.createElement('div'); m.id = 'dlPageMenu'
              m.style.cssText = 'position:fixed;z-index:10060;background:#2b2b2b;border:1px solid #111;box-shadow:0 4px 16px rgba(0,0,0,.5);font:12px sans-serif;color:#ddd;min-width:120px'
              m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'
              ;[['page.rename', L3('重新命名這一頁', '重命名这一页', 'Rename page')], ['page.delete', L3('刪掉這一頁', '删掉这一页', 'Delete page')]].forEach(function (it) {
                var b = document.createElement('div'); b.textContent = it[1]; b.style.cssText = 'padding:6px 12px;cursor:pointer'
                b.onmouseenter = function () { b.style.background = '#3d5a80' }; b.onmouseleave = function () { b.style.background = '' }
                b.onclick = function () { m.remove(); CMD.run(it[0], { doc: d.id, ui: true }) }
                m.appendChild(b)
              })
              document.body.appendChild(m)
              setTimeout(function () { document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off, true) } }, true) }, 0)
            })
          }
          return r
        }
        docs.render.__dlPages = true
      }
      return api
    }),
  }
  // ui.js 的 UI.init 也挂在 DOMContentLoaded、而且先挂 ⇒ 这里跑时画板已经起好
  window.addEventListener('DOMContentLoaded', function () { window.__dlSiteReady = true })
})();

/* 命令参数规格接到 __dlSite.spec（网站自有）：给 agent 走的那条路（网站 drawboard_run／batch／list_commands、单机 MCP）用。
   check(id, params)：命令不存在、参数名不认得、型别／范围／选项不对 ⇒ 回 {error, message}（不跑）；
   说明列得全但处理函数是包了一层看不出读哪些键的 ⇒ 不认得的参数只回 warnings（照跑）。
   list(filter)：命令清单每条多带 spec（参数名、可省、型别、范围、预设、选项）、strict、available／disabledReason。 */
(function () {
  var S = window.__dlCmdSpec, site = window.__dlSite
  if (!S || !site || !site.CMD) return
  var CMDS = site.CMD
  function entry(id) { return CMDS.map[id] || null }
  function keysOf(e) { try { return S.readKeys(String(e.run)) } catch (x) { return [] } }
  /* 包了一层（p => fn(p || {})）⇒ 看不出处理函数读哪些参数 */
  function opaque(e) { var s = String(e.run); return !keysOf(e).length && s.length < 120 }
  function docOpen() { var D = site.Doc; return !!(D && D.width && D.height) }
  /* 编辑距离（拼错一两个字的命令名也找得回来） */
  function dist(a, b) {
    var d = [], i, j
    for (i = 0; i <= a.length; i++) d[i] = [i]
    for (j = 1; j <= b.length; j++) d[0][j] = j
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1))
    return d[a.length][b.length]
  }
  function near(id) {
    var low = id.toLowerCase(), tail = low.split('.').pop()
    return Object.keys(CMDS.map).map(function (x) {
      var l = x.toLowerCase(), t = l.split('.').pop()
      var score = l === low ? 0 : t === tail ? 1 : dist(l, low) <= 2 ? 2 : (t.indexOf(tail) >= 0 || tail.indexOf(t) >= 0) && t.length > 2 ? 3 : 99
      return [score, x]
    }).filter(function (a) { return a[0] < 99 }).sort(function (a, b) { return a[0] - b[0] }).slice(0, 5).map(function (a) { return a[1] })
  }
  site.spec = {
    check: function (id, params) {
      var e = entry(id)
      if (!e) { var n = near(id); return { error: 'unknown_command', message: 'unknown command: ' + id + (n.length ? ' (similar: ' + n.join(', ') + ')' : '') + '. List them with drawboard_list_commands.' } }
      var p = params || {}, sp = S.specOf(id, e.params || ''), hidden = opaque(e)
      var given = Object.keys(p).filter(function (k) { return k.charAt(0) !== '_' && k !== 'ui' })
      var bad = S.check(id, e.params || '', p, hidden ? given : keysOf(e))
      if (bad) return bad
      var documented = {}
      sp.params.forEach(function (x) { documented[x.name] = 1 })
      var w = sp.closed && hidden ? given.filter(function (k) { return !documented[k] }) : []
      var av = S.availability(id, docOpen())
      if (!av.available) return { error: 'not_available', message: id + ': ' + av.disabledReason }
      return w.length ? { warnings: w.map(function (k) { return "parameter '" + k + "' is not in the documented parameters of " + id + ' (' + (sp.params.map(function (x) { return x.name }).join(', ') || 'none') + '); it may be ignored' }) } : null
    },
    describe: function (id) {
      var e = entry(id)
      if (!e) return null
      var sp = S.specOf(id, e.params || ''), av = S.availability(id, docOpen())
      var o = { spec: sp.params, strict: sp.closed && !opaque(e), available: av.available }
      if (!av.available) o.disabledReason = av.disabledReason
      return o
    },
    list: function (filter) {
      var self = this
      return CMDS.list(filter).map(function (c) { var d = self.describe(c.id); return d ? Object.assign({}, c, d) : c })
    },
  }
})();

/* 不抢外层输入框的焦点
   画板是网站页里的同源 iframe；iframe 里任何 el.focus（文字工具的隐藏输入框、AI 游标点到的输入框、对话框首栏…）
   都会把焦点从外层对话框抢进来。角色下指令改画时用户正在右边打字 ⇒ 每改一笔就被打断一次。
   规矩：外层页面的焦点停在别的输入框（不是这个 iframe）、且最近 1.5 秒画板里没有真人按键／点击 ⇒ 这次 focus 不做。
   真人点进画板时 iframe 自己会拿到焦点、也有真人事件 ⇒ 照常聚焦。 */
;(function(){
  let frame = null, pdoc = null;
  try { frame = window.frameElement; pdoc = frame && frame.ownerDocument; } catch (_){ return; }
  if (!frame || !pdoc) return;
  const HUMAN_MS = 1500;
  let lastHuman = 0;
  const mark = e => { if (e.isTrusted) lastHuman = Date.now(); };
  for (const t of ['pointerdown', 'mousedown', 'keydown', 'touchstart']) window.addEventListener(t, mark, true);
  const editable = el => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable === true);
  const outsideTyping = () => { const a = pdoc.activeElement; return !!a && a !== frame && editable(a); };
  const allow = () => !outsideTyping() || Date.now() - lastHuman < HUMAN_MS;
  const orig = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function(opts){ if (allow()) return orig.call(this, opts); };
  window.DilinFocusGuard = {allow, HUMAN_MS};
})();
