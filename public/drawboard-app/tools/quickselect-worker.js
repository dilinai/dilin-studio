/* Selection algorithms share their source with the UI. This worker owns pixels only, never DOM/document/history. */
'use strict';
self.window=self; self.__segWorker=true;
self.CMD={map:{},_depth:0,reg(id,meta,run){this.map[id]={...meta,run};}};
self.Lang={add(){},t:k=>k};
self.Doc={width:0,height:0,sel:null};
importScripts('quickselect.js','../menus/impl/ps-select.js');
const S=SmartSeg;
function quick(q){
  const k=S.selectKey(q),c=S.regCache;
  let reg;
  if(c&&c.has(k.key))reg=c.get(k.key);
  else{reg=S.quickSelect(S.makeSampler(__segPixels,Doc.width,Doc.height),[0,0,Doc.width,Doc.height],k.pts,k.size,S.WORK_PX,k.tip);S.cachePut(k.key,reg);}
  // Cache the raw segmentation. Enhancement belongs to this invocation, not to the shared key.
  return q.enhanceEdge&&reg?S.enhanceRegion(reg,__segPixels,Doc.width,Doc.height):reg;
}
self.__segApply=function(mask,st,all){
  let reg;
  if(st.tool==='quickSelect'){
    const q={points:st.pts,size:st.size,sampleAllLayers:all};for(const k of ['spacing','spacingEnabled','angle','roundness','sizeControl'])if(st[k]!==undefined)q[k]=st[k];if(st.hardness!==undefined)q.hardness=st.hardness*100;
    reg=quick(q);
  }else if(st.tool==='objectSelect'&&st.rect){const r=st.rect;reg=S.objectSelect(S.makeSampler(__segPixels,Doc.width,Doc.height),[0,0,Doc.width,Doc.height],[r[0],r[1],r[0]+r[2],r[1]+r[3]]);
  }else if(st.pts&&st.pts.length>=3){
    const c=new OffscreenCanvas(Doc.width,Doc.height),x=c.getContext('2d');x.beginPath();st.pts.forEach((p,i)=>i?x.lineTo(p[0],p[1]):x.moveTo(p[0],p[1]));x.closePath();x.fill();
    const px=x.getImageData(0,0,Doc.width,Doc.height).data,a=new Uint8Array(Doc.width*Doc.height);for(let i=0;i<a.length;i++)a[i]=px[i*4+3];reg=S.trimRegion({bbox:[0,0,Doc.width,Doc.height],mask:a});
  }
  if(reg){const out=S.combineRegion(mask,reg,st.subtract?'subtract':'add',Doc.width,Doc.height);out?mask.set(out):mask.fill(0);}
};
self.onmessage=function(e){
  const d=e.data,t=performance.now(); Doc.width=d.w;Doc.height=d.h;self.__segPixels=d.src;S.regCache=new Map(d.cache||[]);
  try{
    let out;
    if(d.kind==='coarse'){const k=S.selectKey(d.q),st=S.liveInit(d.src,d.w,d.h);st.acc=d.acc||null;st.done=d.done||0;st.box=d.box||null;const U=S.liveGrow(st,k.pts,k.size,k.tip);out={acc:st.acc,box:st.box,U,n:k.pts.length};}
    else if(d.kind==='quick')out={reg:quick(d.q)};
    else if(d.kind==='sequence'){
      let a=d.base,before=[];
      for(const q of d.steps){self.__segPixels=d.sources&&d.sources[String(q.sampleAllLayers===true)]||d.src;before.push(a);a=S.combineRegion(a,quick(q),q.mode||'add',d.w,d.h);}
      out={out:a,before,outline:a?S.outlineTiles({W:d.w,H:d.h,tiles:new Map()},a,[0,0,d.w,d.h]):[]};
    }else if(d.kind==='sam'){
      const pr=PsSelect.algo.refinePrep(d.p,d.base),r=PsSelect.algo.refineCompute(d.p,d.base,pr);
      out={region:r.region||new Uint8Array(d.w*d.h),prep:{mask:pr.mask,ref:pr.ref,ov:pr.ov,maxR:pr.maxR},cache:[...S.regCache]};
    }else throw new Error('Unknown selection job');
    out.cost=+(performance.now()-t).toFixed(1);
    const buffers=new Set();function collect(v){if(ArrayBuffer.isView(v)){buffers.add(v.buffer);return;}if(v&&typeof v==='object')for(const x of Object.values(v))collect(x);}collect(out);
    postMessage(out,[...buffers]);
  }catch(e){postMessage({error:String(e&&e.message||e)});}
};
