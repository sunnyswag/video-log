/* 无浏览器验收：node --test film.test.cjs。测宽只是近似值，不代替真实字体截图。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname,'film.js'),'utf8');
const engine = fs.readFileSync(path.join(__dirname,'../../tools/film-kit/engine.js'),'utf8');
function finite(value) {
  if(typeof value==='number')assert.ok(Number.isFinite(value),'非有限数值：'+value);
  if(Array.isArray(value))value.forEach(finite);
}
function fakeCanvas(width=1920,height=1080,measure) {
  const calls=[],texts=[],stack=[];
  const initial=()=>({globalAlpha:1,font:'10px "FCJK"',fillStyle:'#000000',strokeStyle:'#000000',lineWidth:1,textAlign:'left',textBaseline:'alphabetic',m:[1,0,0,1,0,0]});
  let state=initial();
  const record=(name,args=[])=>{args.forEach(finite);calls.push([name,...args]);};
  const multiply=(b)=>{const a=state.m;state.m=[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];finite(state.m);};
  const methods={
    reset(){assert.equal(stack.length,0,'上一帧状态栈泄漏');state=initial();calls.length=0;texts.length=0;},
    save(){stack.push({...state,m:[...state.m]});record('save');},
    restore(){assert.ok(stack.length>0,'restore 下溢');state=stack.pop();record('restore');},
    setTransform(...v){record('setTransform',v);state.m=[...v];},
    translate(x,y){record('translate',[x,y]);multiply([1,0,0,1,x,y]);},
    scale(x,y){record('scale',[x,y]);multiply([x,0,0,y,0,0]);},
    rotate(a){record('rotate',[a]);multiply([Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]);},
    measureText(s){if(measure)return {width:measure(String(s),state.font)};
      const size=+(state.font.match(/([\d.]+)px/)||[,10])[1],mono=state.font.includes('FMono');
      return {width:Array.from(String(s)).reduce((sum,c)=>sum+size*(c.codePointAt(0)>255?1:mono?.6021:/[ilI.,:;' ]/.test(c)?.3:.62),0)};},
    fillText(s,x,y){record('fillText',[s,x,y,{...state}]);const m=state.m;
      const size=+(state.font.match(/([\d.]+)px/)||[,10])[1],width=methods.measureText(s).width;
      const left=x-(state.textAlign==='center'?width/2:state.textAlign==='right'?width:0);
      // Conservative em box, transformed at all four corners; include fading text.
      const corners=[[left,y-size*1.1],[left+width,y-size*1.1],[left+width,y+size*.25],[left,y+size*.25]]
        .map(([px,py])=>[m[0]*px+m[2]*py+m[4],m[1]*px+m[3]*py+m[5]]);
      texts.push({s,x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5],width:width*Math.hypot(m[0],m[1]),font:state.font,size:size*Math.hypot(m[0],m[1]),align:state.textAlign,alpha:state.globalAlpha,
        bounds:{left:Math.min(...corners.map(p=>p[0])),right:Math.max(...corners.map(p=>p[0])),top:Math.min(...corners.map(p=>p[1])),bottom:Math.max(...corners.map(p=>p[1]))}});},
    drawImage(img,...args){record('drawImage',[img.width,img.height,...args]);},
    arc(x,y,r,...rest){assert.ok(r>=0,'负半径');record('arc',[x,y,r,...rest]);},
    roundRect(x,y,w,h,r){assert.ok(w>=0&&h>=0,'负宽高');record('roundRect',[x,y,w,h,r]);},
  };
  for(const key of ['beginPath','closePath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo','fill','stroke','fillRect','strokeRect','clearRect','clip','rect','setLineDash'])methods[key]=(...args)=>record(key,args);
  const g=new Proxy(methods,{get:(o,k)=>k in o?o[k]:state[k],set:(o,k,v)=>{finite(v);if(k==='globalAlpha')assert.ok(v>=0&&v<=1,'非法透明度 '+v);state[k]=v;record('set',[k,v]);return true;}});
  return {width,height,getContext:()=>g,calls,texts,depth:()=>stack.length,digest:()=>createHash('sha256').update(JSON.stringify(calls)).digest('hex')};
}
function load() {
  const canvases=[];
  const math=Object.create(Math);math.random=()=>{throw Error('禁止未播种随机数');};
  const sandbox={Math:math,Date:class {constructor(){throw Error('禁止真实时钟');}static now(){throw Error('禁止真实时钟');}},performance:{now(){throw Error('禁止真实时钟');}},
    OffscreenCanvas:class {constructor(w,h){const c=fakeCanvas(w,h);canvases.push(c);return c;}}};
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(engine,sandbox,{filename:'engine.js'});vm.runInContext(source,sandbox,{filename:'film.js'});
  return {...sandbox,canvases};
}
const plain=value=>JSON.parse(JSON.stringify(value));
if(require.main===module) {
const BOUNDS=[0,15,22,34,47,61,74,86,100,114,128,140,152,164,176,190,204,218,232,244,256,269,282,294,302,310,318,326,336,338];
const CHAPTER_STARTS=[0,15,22,74,128,176,232,294,326,336];
test('29 幕 / 338 秒 / 84 字幕 / 57 cue，章节与云端输入齐全',()=>{
  const {FILM:f,FILM_STYLE:s}=load();
  assert.equal(f.duration,338);assert.equal(f.W,1920);assert.equal(f.H,1080);assert.equal(f.FPS,30);
  assert.equal(f.scenes.length,29);assert.equal(f.duration*f.FPS,10140);
  assert.deepEqual(plain(f.scenes.map(x=>[x.start,x.d])),BOUNDS.slice(0,-1).map((v,i)=>[v,BOUNDS[i+1]-v]));
  assert.equal(f.captions.length,84);assert.equal(f.cues.length,57);
  assert.deepEqual(plain(f.chapters.map(c=>c.t)),CHAPTER_STARTS);
  for(const c of f.chapterInfo)for(const k of ['zh','en','desc'])assert.ok(c[k]?.trim(),`章节 ${c.n} 缺 ${k}`);
  for(const sc of f.scenes){const data=s.script[sc.id];
    assert.deepEqual(plain(f.captions.filter(c=>c.t0>=sc.start&&c.t0<sc.start+sc.d).map(c=>[+(c.t0-sc.start).toFixed(3),+(c.t1-sc.start).toFixed(3),c.text])),plain(data.captions.map(c=>[c.t,c.end,c.text])));
  }
  assert.equal(s.code.join('\n'),'controls.collect { packet ->\n    if (isNewInvite(packet)) {\n        createCalleeAndWait(packet)\n    } else {\n        routeBySession(packet)\n    }\n}');
  assert.deepEqual(plain(s.series),{title:'工作档案',sub:'把做过的设计，讲成故事',next:''});
  assert.deepEqual(plain(f.fontsNeeded),plain(s.fontsNeeded));
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'render.json'),'utf8'));
  for(const file of [manifest.page,manifest.audio,'fonts.css'])assert.ok(fs.existsSync(path.join(__dirname,file)),`缺少云端输入 ${file}`);
  assert.equal(manifest.fps,30);
  const html=fs.readFileSync(path.join(__dirname,'film.html'),'utf8');assert.match(html,/href="fonts.css"/);assert.match(html,/FILM\.fontsNeeded\.map/);
});
test('可访问当前视频稿时，逐条比较字幕和幕边界；片尾只替换占位文案',t=>{
  const file=process.env.FILM_SCRIPT||'/mnt/c/Users/15211/Documents/notes/Video Log/Kotlin 实现 SIP 通信协议的具体实现/视频稿.md';
  if(!fs.existsSync(file)){t.skip('云端无本机视频稿；独立时长与事件断言仍运行');return;}
  const text=fs.readFileSync(file,'utf8'),{FILM:f}=load();
  const matches=[...text.matchAll(/第(\d+)幕（(\d+)–(\d+) s）｜[^\n]+\n([\s\S]*?)(?=\n第\d+幕（|\n## 唯一上屏代码)/g)];
  assert.equal(matches.length,29);
  const caps=matches.flatMap(m=>[...m[4].matchAll(/\+([\d.]+)–([\d.]+) s「([^」]+)」/g)].map(c=>[+m[2]+ +c[1],+m[2]+ +c[2],m[1]==='29'?'工作档案':c[3]]));
  assert.deepEqual(plain(f.captions.map(c=>[c.t0,c.t1,c.text])),caps);
});
test('每 0.5 秒 + 事件前后 + 720p/4K：无异常、无 NaN、save/restore 平衡',()=>{
  const {FILM:f,canvases}=load();let count=0;
  for(const [w,h] of [[1920,1080],[1280,720],[3840,2160]]){
    const c=fakeCanvas(w,h),times=new Set([0,f.duration]);
    if(w===1920)for(let i=0;i<=f.duration*2;i++)times.add(i/2);
    if(w===1920&&process.env.FULL_FRAMES==='1')for(let i=0;i<f.duration*30;i++)times.add(i/30);
    for(const sc of f.scenes)for(const dt of [0,.001,.1,sc.d/2,sc.d-.001])times.add(sc.start+dt);
    for(const event of [...f.captions.flatMap(c=>[c.t0,c.t1]),...f.cues.map(c=>c.t)])for(const dt of [-.001,0,.001])times.add(Math.max(0,Math.min(f.duration,event+dt)));
    for(const t of times){try{f.render(c,t);}catch(e){e.message=`${w}×${h} t=${t}: ${e.message}`;throw e;}assert.equal(c.depth(),0);count++;}
    f.drawCover(c);assert.equal(c.depth(),0);
  }
  for(const c of canvases)assert.equal(c.depth(),0);console.log(`验证 ${count} 次 render，另含 3 个尺寸封面。`);
});
test('全片半秒采样：顺序/乱序、封面、尺寸切换及独立 VM 的绘图指令一致',()=>{
  const one=load(),other=load(),c=fakeCanvas(),d=fakeCanvas(),hashes=[];
  for(let i=0;i<=676;i++){one.FILM.render(c,i/2);hashes.push(c.digest());}
  // Multiplication by 137 permutes all 677 indices, so every sampled time is checked out of order.
  for(let j=0;j<677;j++){
    const i=j*137%677,t=i/2;
    if(j%47===0){one.FILM.drawCover(c);one.FILM.render(fakeCanvas(3840,2160),t);}
    one.FILM.render(c,t);assert.equal(c.digest(),hashes[i],`乱序 t=${t}`);
    other.FILM.render(d,t);assert.equal(d.digest(),hashes[i],`独立 VM t=${t}`);
  }
});
test('关键接收时刻、半成品会话、两个结束枚举与本地超时',()=>{
  const {FILM:f}=load(),c=fakeCanvas(),words=t=>{f.render(c,t);return c.texts.filter(x=>x.alpha>.01).map(x=>x.s);};
  assert.equal(words(37.99).filter(s=>s==='RINGING').length,0);
  assert.equal(words(38).filter(s=>s==='RINGING').length,1);
  assert.equal(words(39.6).filter(s=>s==='RINGING').length,2);
  assert.equal(words(51.39).filter(s=>s==='CHATTING').length,0);
  assert.equal(words(51.4).filter(s=>s==='CHATTING').length,1);assert.ok(words(51.4).includes('PREPARE_CONFIRM'));
  assert.equal(words(62.49).filter(s=>s==='CHATTING').length,1);
  assert.equal(words(62.5).filter(s=>s==='CHATTING').length,2);
  assert.ok(words(81).includes('S1 = 这次通话的编号（sessionId）'));
  assert.ok(words(99).includes('新会话未就绪'));
  for(const t of [194,198,202]){words(t);const m=c.texts.find(x=>x.s==='TERMINATE_END');assert.ok(m&&m.x<900);assert.ok(c.texts.some(x=>x.s==='新会话未就绪'));}
  assert.ok(!words(242).includes('TERMINATE_END'));
  words(253);assert.ok(c.texts.some(x=>x.s==='TERMINATE_END'&&x.x<900));assert.ok(c.texts.some(x=>x.s==='新会话未就绪'));
  assert.ok(!words(256.99).includes('RINGING'));assert.ok(words(257).includes('RINGING'));
  assert.ok(words(264.59).includes('RINGING'));assert.ok(words(264.6).includes('OTHER_TERMINATED'));assert.ok(!words(264.6).includes('60 s'));assert.ok(words(264.6).includes('响铃计时已停止'));
  assert.ok(words(271).includes('SELF_TERMINATED'));assert.ok(words(271).includes('OTHER_TERMINATED'));
  assert.ok(!words(168.79).includes('RINGING_TIMEOUT'));assert.ok(words(168.8).includes('RINGING_TIMEOUT'));
  for(const t of [16,20.5,336.5]){words(t);assert.ok(!c.texts.some(x=>x.y>890));}
  assert.ok(words(0).includes('已取消'));assert.ok(words(0).includes('演绎'));
});
test('演绎标记及上屏代码范围',()=>{
  const {FILM:f}=load(),c=fakeCanvas();
  const demos=new Set([1,7,8,9,10,13,14,16,18,19,20,21,22,28]);
  for(let i=0;i<29;i++){
    const sc=f.scenes[i];f.render(c,sc.start+sc.d/2);
    assert.equal(c.texts.some(x=>x.s==='演绎'),demos.has(i+1));
    assert.equal(c.texts.some(x=>x.s==='routeBySession'),i===16);
  }
  f.render(c,148.1);assert.ok(c.texts.some(x=>x.s==='演绎'));
});
test('稳定画面字体下限、页眉隔离、字幕呼吸区和封面裁切',()=>{
  const {FILM:f}=load(),c=fakeCanvas();
  for(let t=.5;t<338;t+=.5){
    f.render(c,t);const sc=f.scenes.find(s=>s.start<=t&&s.start+s.d>t),lt=t-sc.start;
    if(lt<.4||lt>sc.d-.4)continue;
    for(const tx of c.texts){if(tx.alpha<.2||!tx.s.trim()||['!','?'].includes(tx.s))continue;
      const why=`t=${t} “${tx.s}”`;
      assert.ok(tx.size>=24-1e-7,`${why} 逻辑字号 ${tx.size}`);
      if(tx.y<110)assert.ok(f.chapterInfo.some(ch=>ch.zh===tx.s)||['演绎','机制演绎'].includes(tx.s),`${why} 侵入页眉`);
      if(tx.y<890)assert.ok(tx.y<=850,`${why} 侵入字幕 40px 呼吸区`);
      const left=tx.x-(tx.align==='center'?tx.width/2:tx.align==='right'?tx.width:0),right=left+tx.width;
      assert.ok(left>=75&&right<=1845,`${why} 横向出安全区 [${left},${right}]`);
    }
  }
  f.drawCover(c);
  for(const tx of c.texts){if(['!','?'].includes(tx.s))continue;
    const left=tx.x-(tx.align==='center'?tx.width/2:tx.align==='right'?tx.width:0);
    assert.ok(left>=192&&left+tx.width<=1728,`封面 ${tx.s} 超出中间80%`);
  }
});
test('第 2 轮：三个候选、选择时变灰、第四句理由、删除导演指令',()=>{
  const {FILM:f}=load(),c=fakeCanvas();
  f.render(c,181.3);
  const titles=['加锁','Handler 同步屏障','Flow 串行消费'].map(s=>c.texts.find(x=>x.s===s));
  assert.ok(titles.every(Boolean),'候选必须同时可见');
  assert.ok(titles[0].x<titles[1].x&&titles[1].x<titles[2].x);
  assert.equal(new Set(titles.map(x=>x.y)).size,1,'候选标题须对齐');
  f.render(c,184.7);
  assert.ok(c.texts.find(x=>x.s==='加锁').alpha<.5);
  assert.ok(c.texts.find(x=>x.s==='Handler 同步屏障').alpha<.5);
  assert.equal(c.texts.find(x=>x.s==='Flow 串行消费').alpha,1);
  assert.ok(!c.texts.some(x=>x.s==='好懂'));
  f.render(c,188.2);assert.ok(['好懂','好维护'].every(s=>c.texts.some(x=>x.s===s)));
  for(const t of [53.7,58.5]){f.render(c,t);assert.ok(c.texts.some(x=>x.s==='网关只转发'));}
  assert.ok(!source.includes('暂停看两边'));
  f.render(c,174);assert.ok(!c.texts.some(x=>x.s==='TERMINATE_END'));
});
test('第 2 轮：实际字体的文字相交、直线/边框接触和后绘底板遮字均为零',()=>{
  const {audit}=require('./film.overlap.cjs'),{auditLayout}=require('./film.layout-check.cjs');
  const options={step:process.env.FULL_FRAMES==='1'?1/30:.5};
  const textReport=audit(options),layoutReport=auditLayout(options);
  assert.equal(textReport.rawIntersections,0,JSON.stringify(textReport.groups));
  assert.equal(layoutReport.contacts,0,JSON.stringify(layoutReport.groups));
  console.log(`文字及边框审计各 ${textReport.frames} 帧；无相交，无豁免。`);
});
}
// Explicit export is useful for read-only geometry audits and timeline export without Chromium.
module.exports={load,fakeCanvas};
