/* 画布捲軸
   照 PS：右边直的、下面横的；按住滑块拖＝平移，点轨道空白＝往那边翻一页（视窗的 90%）。
   可卷范围：文件在画面上的大小 ＋ 一个视窗（文件边能卷到视窗正中，同 HandView 不夹边界时常用的那段）。
   以 HandView 的视角中心为准：滑块位置 ＝ (中心·zoom) / (文件·zoom ＋ 视窗)，长度 ＝ 视窗 / (文件·zoom ＋ 视窗)。 */
(function(){
const SB = window.ScrollBars = {
  bars: null,
  ensure(){
    if (this.bars) return this.bars;
    const wrap = HandView.wrap(); if (!wrap) return null;
    const mk = axis => {
      const t = document.createElement('div'); t.className = 'dl-sb dl-sb-' + axis;
      const th = document.createElement('div'); th.className = 'dl-sb-thumb'; t.appendChild(th);
      wrap.appendChild(t);
      t.addEventListener('pointerdown', e => this.down(e, axis));
      t.addEventListener('wheel', e => e.stopPropagation(), {passive:true});
      return {t, th};
    };
    this.bars = {x: mk('x'), y: mk('y')};
    new ResizeObserver(() => this.update()).observe(wrap);
    return this.bars;
  },
  /* 一个轴的几何：total＝可卷总长、view＝视窗长（画面像素）、pos＝视窗左／上缘在可卷范围里的位置 */
  geom(axis){
    const wrap = HandView.wrap(), z = UI.zoom || 1, off = HandView.off || [0, 0];
    // 旋转视图（rotateview.js）转过：照 PS 按旋转后的外接框算（W'＝|W·cos|＋|H·sin|、H'＝|W·sin|＋|H·cos|）；
    // HandView 的平移是画面空间的 ⇒ 外接框正中偏离视窗正中 off·z，跟没转时同一套公式
    const a = (window.RotView && RotView.angle || 0) * Math.PI / 180, cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
    const W = a ? Doc.width * cs + Doc.height * sn : Doc.width, H = a ? Doc.width * sn + Doc.height * cs : Doc.height;
    const ext = axis === 'x' ? W : H;
    const doc = ext * z, view = axis === 'x' ? wrap.clientWidth : wrap.clientHeight;
    const total = doc + view, pos = (ext / 2 - (axis === 'x' ? off[0] : off[1])) * z;   // 中心·z − view/2 ＋ view/2
    return {total, view, pos};
  },
  update(){
    const b = this.ensure(); if (!b || !Doc.width) return;
    ['x', 'y'].forEach(axis => {
      const {total, view, pos} = this.geom(axis), {t, th} = b[axis];
      const len = axis === 'x' ? t.clientWidth : t.clientHeight; if (!len) return;
      const f = Math.min(1, view / total), size = Math.max(24, f * len);
      const u = f >= 1 ? 0 : Math.max(0, Math.min(1, pos / total / (1 - f)));   // 滑块起点在可动范围里的比例
      th.style[axis === 'x' ? 'width' : 'height'] = size + 'px';
      th.style[axis === 'x' ? 'left' : 'top'] = u * (len - size) + 'px';
    });
  },
  /* 画面像素 d（沿捲軸）⇒ 视角中心移动 d·total/len/zoom（文件坐标） */
  move(axis, dScreenOnBar){
    const {total} = this.geom(axis), t = this.bars[axis].t, len = axis === 'x' ? t.clientWidth : t.clientHeight;
    const z = UI.zoom || 1, d = dScreenOnBar * total / Math.max(1, len) / z;
    if (axis === 'x') HandView.panBy(-d * z, 0); else HandView.panBy(0, -d * z);
  },
  down(e, axis){
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const {t, th} = this.bars[axis], key = axis === 'x' ? 'clientX' : 'clientY';
    if (e.target === th){
      let last = e[key]; t.setPointerCapture(e.pointerId); th.classList.add('on');
      const mv = ev => { this.move(axis, ev[key] - last); last = ev[key]; };
      const up = () => { th.classList.remove('on'); t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up); };
      t.addEventListener('pointermove', mv); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
    } else {   // 点轨道：往点的那边翻一页
      const r = th.getBoundingClientRect(), before = e[key] < (axis === 'x' ? r.left : r.top);
      const view = this.geom(axis).view * 0.9 * (before ? 1 : -1);
      if (axis === 'x') HandView.panBy(view, 0); else HandView.panBy(0, view);
    }
  }
};
// 视角／缩放一变就更新：挂在 HandView.apply 与 UI.setZoom 之后
const ap = HandView.apply; HandView.apply = function(){ const r = ap.apply(this, arguments); try { SB.update(); } catch(err){ console.error(err); }
  try { if (window.UI && UI.magnified && UI.ctx && UI.magnified()) UI.drawView(); } catch(err){ console.error(err); }   // 放大模式：叠画层跟着平移重画（ui.js overlayCtx）
  return r; };
// ui.js 比本档晚载 ⇒ UI 等 DOMContentLoaded 才挂（这个监听登记在 UI.init 之前，会先跑）
const hookZoom = () => { if (!window.UI || UI._sbHooked) return; UI._sbHooked = true;
  const sz = UI.setZoom; UI.setZoom = function(){ const r = sz.apply(this, arguments); try { SB.update(); } catch(err){ console.error(err); } return r; }; };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { hookZoom(); setTimeout(() => SB.update(), 0); });
else { hookZoom(); setTimeout(() => SB.update(), 0); }
})();
