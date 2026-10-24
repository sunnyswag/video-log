/* 无 Chromium 的逐帧文字审计。只输出报告；不会重写时间线或画面。 */
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {load,fakeCanvas}=require('./film.test.cjs');
function fontMeasure(){
  // Use the actual embedded subsets, including each fallback face, for measureText.
  // Horizontal shaping/kerning is still approximate; this is not raster acceptance.
  const result=spawnSync('python3',['-B','-c',String.raw`
import base64,io,json,re,sys
from fontTools.ttLib import TTFont
css=open(sys.argv[1]).read()
faces={}
for family,weight,data in re.findall(r"font-family:'([^']+)';font-weight:(\d+);.*?base64,([^)]*)",css):
    f=TTFont(io.BytesIO(base64.b64decode(data)))
    em=f['head'].unitsPerEm
    faces[family+':'+weight]={str(cp):f['hmtx'].metrics[glyph][0]/em for cp,glyph in f.getBestCmap().items()}
print(json.dumps(faces))
`,path.join(__dirname,'fonts.css')],{encoding:'utf8',maxBuffer:10*1024*1024});
  if(result.status!==0)throw Error(result.stderr||'字体度量读取失败');
  const faces=JSON.parse(result.stdout);
  return (text,font)=>{
    const [,weight,size]=font.match(/(\d+) ([\d.]+)px/),families=[...font.matchAll(/"([^"]+)"/g)].map(m=>m[1]);
    return Array.from(text).reduce((sum,char)=>{
      const cp=char.codePointAt(0);if(char==='\u200b')return sum;
      for(const family of families){const face=faces[family+':'+weight]||faces[family+':700']||faces[family+':400'];
        if(face&&face[cp]!=null)return sum+face[cp]*Number(size);}
      throw Error('字体子集缺字：'+char+' '+font);
    },0);
  };
}
function intersection(a,b){
  const x=Math.min(a.right,b.right)-Math.max(a.left,b.left),y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
  return x>.01&&y>.01?{width:x,height:y}:null;
}
function reasonFor(scene,t,a,b){
  // No broad exemption for a whole scene, low opacity, identical text, or a common
  // outer panel. Same-component multiline text has separate baselines and is checked.
  return null;
}
function audit({step=.5,details=false}={}){
  const {FILM:f}=load(),canvas=fakeCanvas(1920,1080,fontMeasure()),groups=new Map();
  let raw=0,allowed=0,frames=0;
  for(let i=0;i<=Math.round(f.duration/step);i++){
    const t=Math.min(f.duration,Number((i*step).toFixed(9)));f.render(canvas,t);frames++;
    const scene=f.scenes.find(s=>s.start<=t&&t<s.start+s.d)?.id||'end';
    const texts=canvas.texts.filter(x=>x.alpha>0&&x.s.trim());
    for(let a=0;a<texts.length;a++)for(let b=a+1;b<texts.length;b++){
      const one=texts[a],two=texts[b],overlap=intersection(one.bounds,two.bounds);if(!overlap)continue;
      raw++;const reason=reasonFor(scene,t,one,two);if(reason)allowed++;
      const pair=[one.s,two.s].sort(),key=JSON.stringify([scene,pair,reason]);
      if(!groups.has(key))groups.set(key,{scene,texts:pair,first:t,last:t,count:0,reason,samples:[]});
      const group=groups.get(key);group.last=t;group.count++;
      if(details)group.samples.push({t,a:one.bounds,b:two.bounds,overlap});
    }
  }
  return {step,frames,box:'measureText width; baseline − 1.10em … + 0.25em; all nonzero alpha',rawIntersections:raw,intentionalIntersections:allowed,remainingIntersections:raw-allowed,groups:[...groups.values()]};
}
if(require.main===module){
 const report=audit({step:process.argv.includes('--full')?1/30:.5,details:process.argv.includes('--details')});
 console.log(JSON.stringify(report,null,2));if(report.remainingIntersections)process.exitCode=1;
}
module.exports={audit,fontMeasure,intersection};
