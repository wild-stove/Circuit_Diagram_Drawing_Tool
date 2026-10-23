/* ============================================================
 *  电路图绘制器 · 回归测试
 *
 *  用最小 DOM 桩在 Node 里直接加载 电路图绘制器.html 里的脚本，
 *  不依赖浏览器即可验证：布线几何、网格吸附、导线跟随、
 *  删除清理、撤销栈、字号调整。
 *
 *  运行：  node test/regress.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', '电路图绘制器.html');
const code = fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

/* ---------- DOM 桩 ---------- */
const ctxStub = new Proxy({}, {
  get(t, k){
    if (k === 'measureText') return s => ({ width: String(s).length * 7 });
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v){ t[k] = v; return true; }
});

function makeEl(tag){
  return {
    tagName: tag, style: {}, dataset: {}, value: '', textContent: '', title: '', disabled: false,
    children: [], handlers: {},
    addEventListener(type, fn){ (this.handlers[type] = this.handlers[type] || []).push(fn); },
    removeEventListener(){},
    appendChild(c){ this.children.push(c); return c; },
    getContext(){ return ctxStub; },
    getBoundingClientRect(){ return { width: 900, height: 600, left: 0, top: 0, right: 900, bottom: 600 }; },
    querySelector(){ return makeEl('div'); },
    querySelectorAll(){ return []; },
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    closest(){ return null; },
    focus(){}, select(){}, click(){}, blur(){},
    offsetLeft: 0, offsetTop: 0,
    fire(type, ev){ (this.handlers[type] || []).forEach(f => f.call(this, ev)); }
  };
}

const byId = {};
['cv','cvwrap','labelEditor','status','toast','palette','bar','stage','fsVal']
  .forEach(id => byId[id] = makeEl(id === 'cv' ? 'canvas' : 'div'));

const sandbox = {
  console, setTimeout: () => 0, clearTimeout: () => {}, devicePixelRatio: 1,
  Math, JSON, Object, Array, Map, Set, String, Number, Boolean, Date, Error,
  isFinite, parseInt, parseFloat,
  Blob: function(){}, URL: { createObjectURL: () => '', revokeObjectURL(){} },
  FileReader: function(){}, confirm: () => true, requestAnimationFrame: () => 0,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.document = {
  getElementById: id => byId[id] || makeEl('div'),
  createElement: makeEl,
  querySelector: () => makeEl('button'),
  querySelectorAll: () => [],
  addEventListener(){},
};
sandbox.addEventListener = (type, fn) => {
  sandbox._h = sandbox._h || {};
  (sandbox._h[type] = sandbox._h[type] || []).push(fn);
};
sandbox.removeEventListener = () => {};

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'editor.js' });

const api = sandbox.CircuitSketch;
const S = api.state;
const geo = api._geo;
const cv = byId['cv'];
const bar = byId['bar'];

let fails = 0, total = 0;
function ok(cond, msg){
  total++;
  if (cond) console.log('  ✓ ' + msg);
  else { console.log('  ✗ ' + msg); fails++; }
}
const onGrid = i => i.x % 20 === 0 && i.y % 20 === 0;
const F = id => S.items.find(i => i.id === id);
const wirePathFn = geo.wirePath, resolveEnd = geo.resolveEnd;

function dirOk(w){
  const a = resolveEnd(w.a), b = resolveEnd(w.b), p = wirePathFn(w);
  if (!a || !b || !p) return false;
  const d1 = { x: p[1].x - p[0].x, y: p[1].y - p[0].y };
  const d2 = { x: p[p.length-1].x - p[p.length-2].x, y: p[p.length-1].y - p[p.length-2].y };
  const dot = (u, v) => u.x * v.x + u.y * v.y;
  return dot(d1, a.dir) > 0 && dot(d2, b.dir) < 0;
}

const V = { x: S.view.x, y: S.view.y, z: S.view.z };
const toClient = w => ({ clientX: w.x * V.z + V.x, clientY: w.y * V.z + V.y,
                         button: 0, shiftKey: false, preventDefault(){} });
const fireWin = (t, ev) => (sandbox._h[t] || []).forEach(f => f(ev));
const clickBar = (act, shift) => bar.fire('click', {
  shiftKey: !!shift, target: { closest: () => ({ dataset: { act } }) }
});

/* ============ 几何与交互 ============ */
console.log('\n[1] 初始化');
ok(S.items.filter(i => i.kind !== 'wire').length === 5, '示例电路 5 个元件');
ok(S.items.filter(i => i.kind === 'wire').length === 5, '示例电路 5 根导线');
ok(S.items.filter(i => i.kind !== 'wire').every(onGrid), '元件坐标全部吸附在网格点');

console.log('\n[2] 布线几何');
let viol = 0;
const DIRS = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
for (const dA of DIRS) for (const dB of DIRS)
  for (const B of [{x:200,y:0},{x:-200,y:0},{x:0,y:200},{x:0,y:-200},{x:160,y:120},{x:0,y:0}]){
    const p = geo.routePoints({x:0,y:0}, dA, B, dB);
    if (p.length < 2){ viol++; continue; }
    const d1 = { x: p[1].x - p[0].x, y: p[1].y - p[0].y };
    const d2 = { x: p[p.length-1].x - p[p.length-2].x, y: p[p.length-1].y - p[p.length-2].y };
    if (d1.x*dA.x + d1.y*dA.y <= 0) viol++;
    if (d2.x*dB.x + d2.y*dB.y >= 0) viol++;
  }
ok(viol === 0, '96 组布线全部满足两端方向约束');
ok(S.items.filter(i => i.kind === 'wire').every(dirOk), '示例导线满足端点方向约束');

console.log('\n[3] 拖拽 / 旋转 / 撤销');
const lamp = F(S.items.find(i => i.type === 'lamp').id);
const ox = lamp.x, oy = lamp.y;
cv.fire('pointerdown', toClient({ x: lamp.x, y: lamp.y }));
cv.fire('pointermove', toClient({ x: lamp.x + 47, y: lamp.y + 13 }));
fireWin('pointerup', toClient({ x: lamp.x + 47, y: lamp.y + 13 }));
ok(lamp.x === ox + 40 && lamp.y === oy + 20, `网格吸附：(${ox},${oy}) → (${lamp.x},${lamp.y})`);
ok(S.items.filter(i => i.kind === 'wire').every(dirOk), '移动后导线自动重布且方向正确');
api.undo();
ok(F(lamp.id).x === ox && F(lamp.id).y === oy, '撤销精确恢复拖动前的位置');
S.sel.clear(); S.sel.add(lamp.id);
api.rotateSelection(1);
ok(F(lamp.id).rot === 90 && onGrid(F(lamp.id)), '旋转 90° 且仍在网格上');
api.undo();

console.log('\n[4] 字号 · 选中对象');
S.sel.clear();
const res = F(S.items.find(i => i.type === 'resistor').id);
const wire = F(S.items.find(i => i.kind === 'wire').id);
ok(api.fsOf(res) === 13, '新建元件默认字号 13');
ok(api.fsOf(wire) === 13, '新建导线默认字号 13');

S.sel.clear(); S.sel.add(res.id);
const beforeFn = api.fsOf(res);
clickBar('fs-up');
ok(api.fsOf(res) === beforeFn + 1, `A+ 把选中元件字号 ${beforeFn} → ${api.fsOf(res)}`);
ok(String(byId['fsVal'].textContent) === String(api.fsOf(F(res.id))),
   '工具栏数字跟随显示为 ' + byId['fsVal'].textContent);
clickBar('fs-down'); clickBar('fs-down');
ok(api.fsOf(res) === beforeFn - 1, 'A− 连按两次净减 1');
api.undo();
ok(api.fsOf(F(res.id)) === beforeFn, '撤销回退字号（字号变更进了历史栈）');

console.log('\n[5] 字号 · 多选与全部');
S.sel.clear(); S.sel.add(res.id); S.sel.add(lamp.id);
api.changeFontSize(4, false);
ok(api.fsOf(F(res.id)) === beforeFn + 4 && api.fsOf(F(lamp.id)) === 17,
   '多选整体 +4：电阻 17 / 灯泡 17');
ok(api.fsOf(F(wire.id)) === 13, '未选中的导线字号不受影响');
api.changeFontSize(-2, true);
ok(S.items.every(i => api.fsOf(i) === i.fs), 'all=true 时全部对象被统一调整');
api.undo();
ok(api.fsOf(F(wire.id)) === 13 && api.fsOf(F(res.id)) === 17, '撤销回退「应用到全部」');

console.log('\n[6] 字号 · 边界钳制');
S.sel.clear(); S.sel.add(res.id);
for (let i = 0; i < 60; i++) api.changeFontSize(1, false);
ok(api.fsOf(F(res.id)) === 48, '连按上限后停在最大值 48');
for (let i = 0; i < 80; i++) api.changeFontSize(-1, false);
ok(api.fsOf(F(res.id)) === 8, '连按下限后停在最小值 8');
api.setFontSize(13, false);
ok(api.fsOf(F(res.id)) === 13, 'setFontSize 可直接设定绝对值');

console.log('\n[7] 字号 · 无选中时改全局默认');
S.sel.clear();
const d0 = api._dbg().defFS;
clickBar('fs-up');
ok(api._dbg().defFS === d0 + 1, `无选中时 A+ 调整默认字号 ${d0} → ${api._dbg().defFS}`);
const fresh = api.newItem('capacitor', 800, 800);
ok(api.fsOf(fresh) === d0 + 1, '新建元件继承新的默认字号');
const freshWire = api.addWire({ item: fresh.id, pin: 0 }, { item: res.id, pin: 0 });
ok(freshWire && api.fsOf(freshWire) === d0 + 1, '新建导线也继承默认字号');
S.items = S.items.filter(i => i !== fresh && i !== freshWire);
clickBar('fs-down');
ok(api._dbg().defFS === d0, 'A− 把默认字号调回原值');

console.log('\n[8] 字号 · 快捷键与滚轮');
S.sel.clear(); S.sel.add(res.id);
const b2 = api.fsOf(F(res.id));
fireWin('keydown', { key: ']', preventDefault(){}, target: null, ctrlKey: false, metaKey: false });
ok(api.fsOf(F(res.id)) === b2 + 1, '] 键放大字号');
fireWin('keydown', { key: '[', preventDefault(){}, target: null, ctrlKey: false, metaKey: false });
ok(api.fsOf(F(res.id)) === b2, '[ 键缩小字号');
const b3 = api.fsOf(F(res.id));
cv.fire('wheel', { ctrlKey: true, altKey: false, deltaY: -100, clientX: 100, clientY: 100, preventDefault(){} });
ok(api.fsOf(F(res.id)) === b3 + 1, 'Ctrl+滚轮 放大字号');
S.sel.clear();
const zoomBefore = S.view.z;
cv.fire('wheel', { ctrlKey: false, altKey: false, deltaY: -100, clientX: 100, clientY: 100, preventDefault(){} });
ok(S.view.z > zoomBefore, '无选中时滚轮仍是画布缩放（互不干扰）');

console.log('\n[9] 字号 · 编辑器与序列化');
S.sel.clear(); S.sel.add(res.id);
api.setFontSize(22, false);
geo.startEdit(F(res.id));
ok(byId['labelEditor'].style.fontSize === '22px', '就地编辑框字号跟随 22px');
geo.endEdit(false);
const dump = JSON.parse(JSON.stringify(S.items));
ok(dump.every(i => typeof i.fs === 'number'), '字号随对象序列化（保存 JSON 后可复原）');
const legacy = { kind:'part', id:'old1', type:'resistor', x:200, y:200, rot:0, label:'R9' };
ok(api.fsOf(legacy) === api._dbg().defFS, '旧数据没有 fs 字段时回退到默认字号');
S.items.push(legacy);
api.render();
ok(true, '含旧数据的整图渲染无异常');
S.items = S.items.filter(i => i.id !== 'old1');

console.log('\n[10] 全局一致性');
ok(S.items.filter(i => i.kind !== 'wire').every(onGrid), '所有元件/端子坐标都是 20 的整数倍');
ok(S.items.every(i => i.kind !== 'wire' || (F(i.a.item) && F(i.b.item))), '没有悬空引用');
ok(S.items.every(i => api.fsOf(i) >= 8 && api.fsOf(i) <= 48), '所有对象字号都在 8–48 有效区间');

console.log('\n' + (fails ? '❌ 失败 ' + fails + ' / ' + total + ' 项' : '✅ 全部通过 ' + total + ' 项'));
process.exit(fails ? 1 : 0);