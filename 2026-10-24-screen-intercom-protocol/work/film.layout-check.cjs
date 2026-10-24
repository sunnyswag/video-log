/* Supplement to fillText pair checks: straight strokes, card edges, and later
 * opaque card fills. Rounded corners/arc strokes are not rasterized here. */
const {load,fakeCanvas}=require('./film.test.cjs');
const {fontMeasure,intersection}=require('./film.overlap.cjs');
function clipSegment(a,b,rect){
  const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
  for(const [p,q]of [[-dx,a[0]-rect.left],[dx,rect.right-a[0]],[-dy,a[1]-rect.top],[dy,rect.bottom-a[1]]]){
    if(Math.abs(p)<1e-10){if(q<0)return null;continue;}
    const r=q/p;if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);if(lo>hi)return null;
  }
  return [[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]];
}
function contains(r,p){return p[0]>=r.left&&p[0]<=r.right&&p[1]>=r.top&&p[1]<=r.bottom;}
function geometry(canvas){
  let state={m:[1,0,0,1,0,0],globalAlpha:1,lineWidth:1,clip:null},stack=[],path={segments:[],rects:[]},point=null,first=null,textIndex=0;
  const strokes=[],fills=[],texts=[];
  const xy=(x,y)=>[state.m[0]*x+state.m[2]*y+state.m[4],state.m[1]*x+state.m[3]*y+state.m[5]];
  const rectangle=(x,y,w,h)=>{const pts=[xy(x,y),xy(x+w,y),xy(x+w,y+h),xy(x,y+h)];return {left:Math.min(...pts.map(p=>p[0])),right:Math.max(...pts.map(p=>p[0])),top:Math.min(...pts.map(p=>p[1])),bottom:Math.max(...pts.map(p=>p[1]))};};
  const mul=b=>{const a=state.m;state.m=[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];};
  canvas.calls.forEach(([name,...args],order)=>{
    if(name==='save')stack.push({...state,m:[...state.m]});
    else if(name==='restore')state=stack.pop();
    else if(name==='set')state[args[0]]=args[1];
    else if(name==='setTransform')state.m=args;
    else if(name==='translate')mul([1,0,0,1,...args]);
    else if(name==='scale')mul([args[0],0,0,args[1],0,0]);
    else if(name==='rotate'){const a=args[0];mul([Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]);}
    else if(name==='beginPath'){path={segments:[],rects:[]};point=null;first=null;}
    else if(name==='moveTo'){point=xy(...args);first=point;}
    else if(name==='lineTo'){const next=xy(...args);if(point)path.segments.push([point,next]);point=next;}
    else if(name==='closePath'){if(point&&first)path.segments.push([point,first]);}
    else if(name==='roundRect'||name==='rect'){
      const [x,y,w,h,r=0]=args,rect=rectangle(x,y,w,h);path.rects.push(rect);
      // Only the straight portion of each rounded edge, avoiding false corner hits.
      for(const [a,b]of [[[x+r,y],[x+w-r,y]],[[x+w,y+r],[x+w,y+h-r]],[[x+w-r,y+h],[x+r,y+h]],[[x,y+h-r],[x,y+r]]])path.segments.push([xy(...a),xy(...b)]);
    }else if(name==='clip'&&path.rects.length)state.clip=path.rects.at(-1);
    else if(name==='fillRect')fills.push({order,alpha:state.globalAlpha,rect:rectangle(...args)});
    else if(name==='fill')for(const rect of path.rects)fills.push({order,alpha:state.globalAlpha,rect});
    else if(name==='stroke'){
      for(let [a,b]of path.segments){if(state.clip){const clipped=clipSegment(a,b,state.clip);if(!clipped)continue;[a,b]=clipped;}
        strokes.push({order,alpha:state.globalAlpha,a,b,width:state.lineWidth*Math.hypot(...state.m.slice(0,2))});}
    }else if(name==='fillText')texts.push({...canvas.texts[textIndex++],order});
  });return {strokes,fills,texts};
}
function auditLayout({step=.5}={}){
 const f=load().FILM,c=fakeCanvas(1920,1080,fontMeasure()),groups=new Map();let count=0,frames=0;
 for(let i=0;i<=Math.round(f.duration/step);i++){
  const t=+(i*step).toFixed(9);f.render(c,t);frames++;const {strokes,fills,texts}=geometry(c);
  for(const tx of texts){if(tx.alpha<=0||!tx.s.trim()||tx.y>=890)continue;
   for(const stroke of strokes){if(stroke.alpha<=0)continue;
    const w=stroke.width/2,r={left:tx.bounds.left-w,right:tx.bounds.right+w,top:tx.bounds.top-w,bottom:tx.bounds.bottom+w};
    const crossing=clipSegment(stroke.a,stroke.b,r);if(!crossing)continue;
    // Later card/label fills hide the connector beneath them. The alpha test uses
    // the enclosing fade, so a scene-wide fade does not resurrect covered strokes.
    if(fills.some(f=>f.order>stroke.order&&f.alpha>=stroke.alpha-1e-8&&crossing.every(p=>contains(f.rect,p))))continue;
    const key=tx.s+' / stroke';if(!groups.has(key))groups.set(key,{text:tx.s,kind:'stroke',first:t,last:t,count:0,example:{a:stroke.a,b:stroke.b,box:tx.bounds}});
    const group=groups.get(key);group.last=t;group.count++;count++;
   }
   for(const fill of fills){if(fill.order<=tx.order||fill.alpha<=0)continue;
    const hit=intersection(tx.bounds,fill.rect);if(!hit)continue;
    // Ignore < 1 px edge contacts, which belong to the conservative em estimate.
    if(hit.width<=1||hit.height<=1)continue;
    const key=tx.s+' / later fill';if(!groups.has(key))groups.set(key,{text:tx.s,kind:'later fill',first:t,last:t,count:0,example:{rect:fill.rect,box:tx.bounds}});
    const group=groups.get(key);group.last=t;group.count++;count++;
   }
  }
 }
 return {frames,step,contacts:count,groups:[...groups.values()]};
}
if(require.main===module){const result=auditLayout({step:process.argv.includes('--full')?1/30:.5});console.log(JSON.stringify(result,null,2));if(result.contacts)process.exitCode=1;}
module.exports={auditLayout,geometry};
