"use strict";
/* DXF parsing + scene building (shared by the app UI and the CI tests) */
/* ============================== DXF PARSER ============================== */
function parseDXF(text){
  const L = text.split(/\r\n|\r|\n/);
  const P = [];
  for(let i=0;i+1<L.length;i+=2){
    const c = parseInt(L[i], 10);
    if(isNaN(c)){ i--; continue; }
    P.push([c, L[i+1].replace(/\s+$/,'')]);
  }
  const out = {layers:{}, blocks:{}, entities:[], header:{}};
  let i = 0;
  const isZero = (k, v) => P[k] && P[k][0]===0 && P[k][1].trim()===v;

  function readEnt(k){
    const ent = {type:P[k][1].trim(), c:[], f:{}};
    k++;
    while(k<P.length && P[k][0]!==0){
      const pr=P[k]; ent.c.push(pr);
      if(!(pr[0] in ent.f)) ent.f[pr[0]] = pr[1];
      k++;
    }
    ent.layer = (ent.f[8]!==undefined ? ent.f[8].trim() : '0') || '0';
    ent.color = ent.f[62]!==undefined ? parseInt(ent.f[62],10) : 256;
    if(ent.f[420]!==undefined) ent.tc = parseInt(ent.f[420],10);
    return [ent, k];
  }
  function readEntities(k, list, stops){
    while(k<P.length){
      if(P[k][0]!==0){ k++; continue; }
      const t = P[k][1].trim();
      if(stops.includes(t) || t==='EOF') return k;
      let e; [e,k] = readEnt(k);
      if(e.type==='POLYLINE'){
        e.verts=[];
        while(k<P.length && P[k][0]===0 && P[k][1].trim()==='VERTEX'){ let v; [v,k]=readEnt(k); e.verts.push(v); }
        if(isZero(k,'SEQEND')){ let s; [s,k]=readEnt(k); }
      } else if(e.type==='INSERT'){
        e.attribs=[];
        while(k<P.length && P[k][0]===0 && P[k][1].trim()==='ATTRIB'){ let a; [a,k]=readEnt(k); e.attribs.push(a); }
        if(isZero(k,'SEQEND')){ let s; [s,k]=readEnt(k); }
      }
      list.push(e);
    }
    return k;
  }

  while(i<P.length){
    if(isZero(i,'SECTION') && P[i+1]){
      const name = P[i+1][1].trim(); i+=2;
      if(name==='ENTITIES'){ i = readEntities(i, out.entities, ['ENDSEC']); }
      else if(name==='TABLES'){
        while(i<P.length && !isZero(i,'ENDSEC')){
          if(P[i][0]===0){
            let e; [e,i]=readEnt(i);
            if(e.type==='LAYER'){
              const nm = (e.f[2]||'0').trim();
              const col = e.f[62]!==undefined ? parseInt(e.f[62],10) : 7;
              const fl = parseInt(e.f[70]||'0',10);
              out.layers[nm] = {name:nm, aci:Math.abs(col)||7, tc:e.f[420]!==undefined?parseInt(e.f[420],10):null, visible: col>=0 && !(fl&1)};
            }
          } else i++;
        }
      }
      else if(name==='BLOCKS'){
        while(i<P.length && !isZero(i,'ENDSEC')){
          if(isZero(i,'BLOCK')){
            let b; [b,i]=readEnt(i);
            const blk = {name:(b.f[2]||'').trim(), bx:+b.f[10]||0, by:+b.f[20]||0, entities:[]};
            i = readEntities(i, blk.entities, ['ENDBLK','ENDSEC']);
            if(isZero(i,'ENDBLK')){ let x; [x,i]=readEnt(i); }
            out.blocks[blk.name]=blk;
          } else i++;
        }
      }
      else if(name==='HEADER'){
        while(i<P.length && !isZero(i,'ENDSEC')){
          if(P[i][0]===9 && P[i][1].trim()==='$INSUNITS' && P[i+1]) out.header.units = parseInt(P[i+1][1],10);
          i++;
        }
      }
      else { while(i<P.length && !isZero(i,'ENDSEC')) i++; }
    } else i++;
  }
  return out;
}

/* ============================== COLORS ============================== */
function hsv(h,s,v){
  const f=(n)=>{const k=(n+h/60)%6; return v - v*s*Math.max(0,Math.min(k,4-k,1));};
  return rgbHex(f(5)*255,f(3)*255,f(1)*255);
}
function rgbHex(r,g,b){ return '#'+[r,g,b].map(x=>Math.round(x).toString(16).padStart(2,'0')).join(''); }
const ACI_BASE={1:'#ff0000',2:'#ffff00',3:'#00ff00',4:'#00ffff',5:'#0000ff',6:'#ff00ff',7:'FG',8:'#808080',9:'#c0c0c0'};
function aci(i){
  i = Math.abs(i);
  if(ACI_BASE[i]) return ACI_BASE[i];
  if(i>=250 && i<=255){ const g=[51,91,132,173,214,255][i-250]; return rgbHex(g,g,g); }
  if(i>=10 && i<=249){
    const h=Math.floor((i-10)/10)*15, k=i%10;
    const v=[1,1,.8,.8,.6,.6,.5,.5,.3,.3][k], s=(k%2)?0.5:1;
    return hsv(h,s,v);
  }
  return 'FG';
}
const tcHex = n => '#'+(n & 0xffffff).toString(16).padStart(6,'0');

/* ============================== GEOMETRY ============================== */
const TAU = Math.PI*2, D2R = Math.PI/180;
const mul=(A,B)=>[A[0]*B[0]+A[2]*B[1], A[1]*B[0]+A[3]*B[1], A[0]*B[2]+A[2]*B[3], A[1]*B[2]+A[3]*B[3], A[0]*B[4]+A[2]*B[5]+A[4], A[1]*B[4]+A[3]*B[5]+A[5]];
const T=(x,y)=>[1,0,0,1,x,y], S=(x,y)=>[x,0,0,y,0,0], R=(a)=>[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0];
const MIRX=[-1,0,0,1,0,0];

function ellPts(cx,cy,mx,my,ratio,t0,t1,out){
  const nx=-my*ratio, ny=mx*ratio;
  const sweep=t1-t0, n=Math.max(4, Math.ceil(Math.abs(sweep)/TAU*96));
  for(let k=0;k<=n;k++){ const t=t0+sweep*k/n, c=Math.cos(t), s=Math.sin(t); out.push(cx+mx*c+nx*s, cy+my*c+ny*s); }
  return out;
}
function bulgeTo(x1,y1,x2,y2,b,out){ // pushes intermediate points (excl. endpoints)
  const th=4*Math.atan(b), dx=x2-x1, dy=y2-y1, d=Math.hypot(dx,dy);
  if(d<1e-12) return;
  const r=d/(2*Math.sin(th/2)), h=r*Math.cos(th/2);
  const cx=(x1+x2)/2 - dy/d*h, cy=(y1+y2)/2 + dx/d*h;
  const a0=Math.atan2(y1-cy,x1-cx), rr=Math.abs(r);
  const n=Math.max(2, Math.ceil(Math.abs(th)/TAU*96));
  for(let k=1;k<n;k++){ const a=a0+th*k/n; out.push(cx+rr*Math.cos(a), cy+rr*Math.sin(a)); }
}
function polyBulge(vs, closed, out){
  const n=vs.length;
  for(let k=0;k<n;k++){
    const v=vs[k]; out.push(v[0],v[1]);
    const nx = k<n-1 ? vs[k+1] : (closed ? vs[0] : null);
    if(nx && v[2]) bulgeTo(v[0],v[1],nx[0],nx[1],v[2],out);
  }
  if(closed && n>1) out.push(vs[0][0],vs[0][1]);
  return out;
}
function splinePts(ctrl, knots, p, w){
  const n=ctrl.length, out=[];
  if(n<2) return out;
  if(!p || knots.length!==n+p+1){ ctrl.forEach(c=>out.push(c[0],c[1])); return out; }
  const u0=knots[p], u1=knots[n], steps=Math.min(2000, Math.max(16, n*12));
  for(let s=0;s<=steps;s++){
    const u = u0+(u1-u0)*s/steps;
    let k=p; while(k<n-1 && u>=knots[k+1]) k++;
    const d=[];
    for(let j=0;j<=p;j++){ const c=ctrl[j+k-p], ww=w?w[j+k-p]:1; d.push([c[0]*ww,c[1]*ww,ww]); }
    for(let r=1;r<=p;r++) for(let j=p;j>=r;j--){
      const den=knots[j+1+k-r]-knots[j+k-p], a = den ? (u-knots[j+k-p])/den : 0;
      d[j]=[(1-a)*d[j-1][0]+a*d[j][0],(1-a)*d[j-1][1]+a*d[j][1],(1-a)*d[j-1][2]+a*d[j][2]];
    }
    out.push(d[p][0]/d[p][2], d[p][1]/d[p][2]);
  }
  return out;
}
function cleanText(s){
  return s.replace(/%%[cC]/g,'⌀').replace(/%%[dD]/g,'°').replace(/%%[pP]/g,'±').replace(/%%[uUoOkK]/g,'')
          .replace(/%%(\d{3})/g,(m,n)=>String.fromCharCode(+n)).replace(/\\U\+([0-9a-fA-F]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
}
function cleanMText(s){
  s = s.replace(/\\P/g,'\n').replace(/\\U\+([0-9a-fA-F]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16)))
       .replace(/\\S([^;]*?)[\^#\/]([^;]*?);/g,'$1/$2')
       .replace(/\\[ACcFfHhQqTtWwp][^;\\]*;/g,'')
       .replace(/\\[LlOoKkNX]/g,'').replace(/\\~/g,' ').replace(/[{}]/g,'').replace(/\\\\/g,'\\');
  return cleanText(s);
}

/* ============================== SCENE BUILD ============================== */
let scene=null;
const OCS = new Set(['ARC','CIRCLE','LWPOLYLINE','POLYLINE','INSERT','TEXT','ATTRIB','SOLID','TRACE','HATCH']);

function buildScene(dxf){
  const prims=[], texts=[], points=[], snaps=[], layers=dxf.layers, counts={}, unsupported={};
  let total=0;
  const num=(e,c,d)=>{ const v=e.f[c]; if(v===undefined) return d; const x=parseFloat(v); return isNaN(x)?d:x; };
  const getLayer=(nm)=>{ if(!layers[nm]) layers[nm]={name:nm,aci:7,tc:null,visible:true}; return layers[nm]; };
  const layerColor=(L)=> L.tc!=null ? tcHex(L.tc) : aci(L.aci);
  const tp=(M,x,y)=>[M[0]*x+M[2]*y+M[4], M[1]*x+M[3]*y+M[5]];
  const xf=(M,pts)=>{ const o=new Array(pts.length); for(let k=0;k<pts.length;k+=2){ o[k]=M[0]*pts[k]+M[2]*pts[k+1]+M[4]; o[k+1]=M[1]*pts[k]+M[3]*pts[k+1]+M[5]; } return o; };
  const snap=(M,x,y)=>{ const q=tp(M,x,y); snaps.push(q[0],q[1]); };

  function emit(e, M, pLayer, pColor, depth){
    const lname = (e.layer==='0' && pLayer!=null) ? pLayer : e.layer;
    const L = getLayer(lname);
    let color;
    if(e.tc!==undefined && !isNaN(e.tc)) color=tcHex(e.tc);
    else if(e.color===256 || isNaN(e.color)) color=layerColor(L);
    else if(e.color===0) color = pColor || 'FG';
    else color=aci(e.color);
    if(depth===0){ counts[lname]=(counts[lname]||0)+1; total++; }
    const Mo = (OCS.has(e.type) && num(e,230,1)<0) ? mul(M,MIRX) : M;
    const line=(pts,closed)=>{ if(pts.length>=4) prims.push({L:lname,C:color,pts:xf(Mo,pts),closed}); };
    const fill=(loops,alpha)=>{ const ls=loops.filter(l=>l.length>=6).map(l=>xf(Mo,l)); if(ls.length) prims.push({L:lname,C:color,loops:ls,fill:alpha}); };

    switch(e.type){
      case 'LINE': {
        const x1=num(e,10,0),y1=num(e,20,0),x2=num(e,11,0),y2=num(e,21,0);
        line([x1,y1,x2,y2]); snap(Mo,x1,y1); snap(Mo,x2,y2); break; }
      case 'CIRCLE': {
        const cx=num(e,10,0),cy=num(e,20,0),r=num(e,40,0);
        line(ellPts(cx,cy,r,0,1,0,TAU,[]),true); snap(Mo,cx,cy);
        [0,90,180,270].forEach(a=>snap(Mo,cx+r*Math.cos(a*D2R),cy+r*Math.sin(a*D2R))); break; }
      case 'ARC': {
        const cx=num(e,10,0),cy=num(e,20,0),r=num(e,40,0); let a0=num(e,50,0)*D2R, a1=num(e,51,360)*D2R;
        while(a1<=a0) a1+=TAU;
        line(ellPts(cx,cy,r,0,1,a0,a1,[])); snap(Mo,cx,cy);
        snap(Mo,cx+r*Math.cos(a0),cy+r*Math.sin(a0)); snap(Mo,cx+r*Math.cos(a1),cy+r*Math.sin(a1)); break; }
      case 'ELLIPSE': {
        const cx=num(e,10,0),cy=num(e,20,0),mx=num(e,11,1),my=num(e,21,0),ra=num(e,40,1);
        let t0=num(e,41,0), t1=num(e,42,TAU); while(t1<=t0) t1+=TAU;
        const ME = num(e,230,1)<0 ? mul(M,MIRX) : M;
        const pts=ellPts(cx,cy,mx,my,ra,t0,t1,[]);
        prims.push({L:lname,C:color,pts:xf(ME,pts),closed:Math.abs(t1-t0-TAU)<1e-6});
        snap(ME,cx,cy); break; }
      case 'LWPOLYLINE': {
        const vs=[]; for(const [c,v] of e.c){ if(c===10) vs.push([+v,0,0]); else if(c===20&&vs.length) vs[vs.length-1][1]=+v; else if(c===42&&vs.length) vs[vs.length-1][2]=+v; }
        const closed=!!(num(e,70,0)&1);
        line(polyBulge(vs,closed,[]),closed); vs.forEach(v=>snap(Mo,v[0],v[1])); break; }
      case 'POLYLINE': {
        const fl=num(e,70,0);
        if(fl&64){ // polyface mesh
          const pos=e.verts.filter(v=>!(num(v,70,0)&128)).map(v=>[num(v,10,0),num(v,20,0)]);
          e.verts.filter(v=>num(v,70,0)&128).forEach(v=>{
            const idx=[71,72,73,74].map(c=>Math.abs(num(v,c,0))).filter(x=>x>0 && x<=pos.length);
            const pts=[]; idx.forEach(x=>pts.push(pos[x-1][0],pos[x-1][1])); if(idx.length>1) pts.push(pos[idx[0]-1][0],pos[idx[0]-1][1]);
            line(pts,true);
          });
        } else {
          const vs=e.verts.filter(v=>!(num(v,70,0)&16)).map(v=>[num(v,10,0),num(v,20,0),num(v,42,0)]);
          const closed=!!(fl&1);
          line(polyBulge(vs,closed,[]),closed); vs.forEach(v=>snap(Mo,v[0],v[1]));
        }
        break; }
      case 'SPLINE': {
        const ctrl=[],fit=[],knots=[],w=[];
        for(const [c,v] of e.c){
          if(c===10) ctrl.push([+v,0]); else if(c===20&&ctrl.length) ctrl[ctrl.length-1][1]=+v;
          else if(c===11) fit.push([+v,0]); else if(c===21&&fit.length) fit[fit.length-1][1]=+v;
          else if(c===40) knots.push(+v); else if(c===41) w.push(+v);
        }
        let pts;
        if(ctrl.length) pts=splinePts(ctrl,knots,num(e,71,3), w.length===ctrl.length?w:null);
        else { pts=[]; fit.forEach(f=>pts.push(f[0],f[1])); }
        line(pts, !!(num(e,70,0)&1));
        if(pts.length>=2){ snap(M,pts[0],pts[1]); snap(M,pts[pts.length-2],pts[pts.length-1]); }
        break; }
      case 'LEADER': {
        const pts=[]; for(const [c,v] of e.c){ if(c===10) pts.push(+v,0); else if(c===20) pts[pts.length-1]=+v; }
        line(pts); break; }
      case 'SOLID': case 'TRACE': {
        const p=[[10,20],[11,21],[13,23],[12,22]].map(([a,b])=>[num(e,a,0),num(e,b,0)]);
        const loop=[]; p.forEach(q=>loop.push(q[0],q[1])); fill([loop],1); break; }
      case '3DFACE': {
        const pts=[]; [[10,20],[11,21],[12,22],[13,23]].forEach(([a,b])=>pts.push(num(e,a,0),num(e,b,0)));
        line(pts,true); break; }
      case 'POINT': { const q=tp(Mo,num(e,10,0),num(e,20,0)); points.push({L:lname,C:color,x:q[0],y:q[1]}); snaps.push(q[0],q[1]); break; }
      case 'TEXT': case 'ATTRIB': {
        if(e.type==='ATTRIB' && (num(e,70,0)&1)) break;
        const str=cleanText(e.f[1]||''); if(!str.trim()) break;
        const ha=num(e,72,0), va=num(e,e.type==='ATTRIB'?74:73,0);
        const useAlign = ha!==0 || va!==0;
        const x = useAlign && e.f[11]!==undefined ? num(e,11,0) : num(e,10,0);
        const y = useAlign && e.f[21]!==undefined ? num(e,21,0) : num(e,20,0);
        const q=tp(Mo,x,y), sc=Math.hypot(Mo[2],Mo[3]);
        texts.push({L:lname,C:color,x:q[0],y:q[1],h:num(e,40,1)*sc,rot:num(e,50,0)*D2R+Math.atan2(Mo[1],Mo[0]),wf:num(e,41,1),
          lines:[str], align:[ 'left','center','right','center','center','center'][ha]||'left',
          base:['alphabetic','bottom','middle','top'][va]||'alphabetic'});
        snaps.push(q[0],q[1]); break; }
      case 'MTEXT': {
        let raw=''; for(const [c,v] of e.c){ if(c===3) raw+=v; } raw+=(e.f[1]||'');
        const str=cleanMText(raw); if(!str.trim()) break;
        const q=tp(Mo,num(e,10,0),num(e,20,0)), sc=Math.hypot(Mo[2],Mo[3]);
        let rot = e.f[11]!==undefined ? Math.atan2(num(e,21,0),num(e,11,1)) : num(e,50,0)*D2R;
        const ap=num(e,71,1);
        texts.push({L:lname,C:color,x:q[0],y:q[1],h:num(e,40,1)*sc,rot:rot+Math.atan2(Mo[1],Mo[0]),wf:1,lines:str.split('\n'),
          align:['left','center','right'][(ap-1)%3]||'left', vpos:Math.floor((ap-1)/3), mtext:true});
        snaps.push(q[0],q[1]); break; }
      case 'INSERT': {
        const blk=dxf.blocks[(e.f[2]||'').trim()];
        if(blk && depth<16){
          const ix=num(e,10,0),iy=num(e,20,0),sx=num(e,41,1),sy=num(e,42,1),rot=num(e,50,0)*D2R;
          const cols=Math.max(1,num(e,70,1)),rows=Math.max(1,num(e,71,1)),cs=num(e,44,0),rs=num(e,45,0);
          for(let r=0;r<rows&&r<100;r++) for(let c=0;c<cols&&c<100;c++){
            const Mi=mul(Mo,mul(T(ix,iy),mul(R(rot),mul(T(c*cs,r*rs),mul(S(sx,sy),T(-blk.bx,-blk.by))))));
            for(const be of blk.entities) emit(be, Mi, lname, color, depth+1);
          }
          snap(Mo,ix,iy);
        }
        (e.attribs||[]).forEach(a=>emit(a, M, lname, color, depth+1));
        break; }
      case 'DIMENSION': {
        const blk=dxf.blocks[(e.f[2]||'').trim()];
        if(blk && depth<16) for(const be of blk.entities) emit(be, M, lname, color, depth+1);
        break; }
      case 'HATCH': {
        const loops=e.loops||parseHatch(e);
        fill(loops, num(e,70,0)===1 ? 0.55 : 0.18); break; }
      case 'ATTDEF': case 'VIEWPORT': case 'SEQEND': case 'XLINE': case 'RAY': case 'WIPEOUT': case 'VERTEX': break;
      default: unsupported[e.type]=(unsupported[e.type]||0)+1;
    }
  }
  const I=[1,0,0,1,0,0];
  for(const e of dxf.entities) emit(e, I, null, null, 0);

  // extents
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const ext=(x,y)=>{ if(!isFinite(x)||!isFinite(y)) return; if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; };
  for(const p of prims){ if(p.pts) for(let k=0;k<p.pts.length;k+=2) ext(p.pts[k],p.pts[k+1]); else p.loops.forEach(l=>{ for(let k=0;k<l.length;k+=2) ext(l[k],l[k+1]); }); }
  texts.forEach(t=>ext(t.x,t.y)); points.forEach(p=>ext(p.x,p.y));
  if(!isFinite(minX)){ minX=minY=-50; maxX=maxY=50; }
  const ox=(minX+maxX)/2, oy=(minY+maxY)/2;

  // group into Path2D batches by layer + colour
  const groups=new Map();
  const grp=(L,C,fill)=>{ const k=L+'\u0000'+C+'\u0000'+fill; let g=groups.get(k); if(!g){ g={L,C,fill,path:new Path2D()}; groups.set(k,g);} return g; };
  for(const p of prims){
    if(p.pts){
      const g=grp(p.L,p.C,0), a=p.pts;
      g.path.moveTo(a[0]-ox,a[1]-oy); for(let k=2;k<a.length;k+=2) g.path.lineTo(a[k]-ox,a[k+1]-oy);
      if(p.closed) g.path.closePath();
    } else {
      const g=grp(p.L,p.C,p.fill);
      p.loops.forEach(a=>{ g.path.moveTo(a[0]-ox,a[1]-oy); for(let k=2;k<a.length;k+=2) g.path.lineTo(a[k]-ox,a[k+1]-oy); g.path.closePath(); });
    }
  }
  texts.forEach(t=>{t.x-=ox;t.y-=oy;}); points.forEach(p=>{p.x-=ox;p.y-=oy;});
  for(let k=0;k<snaps.length;k+=2){ snaps[k]-=ox; snaps[k+1]-=oy; }
  const fills=[...groups.values()].filter(g=>g.fill).sort((a,b)=>b.fill-a.fill);
  const strokes=[...groups.values()].filter(g=>!g.fill);
  return {fills,strokes,texts,points,snaps,layers,counts,unsupported,total,ox,oy,
    bbox:[minX-ox,minY-oy,maxX-ox,maxY-oy], units:dxf.header.units};
}

function parseHatch(e){
  const c=e.c; let i=0;
  const find=(code)=>{ while(i<c.length && c[i][0]!==code) i++; if(i>=c.length) return null; return parseFloat(c[i++][1]); };
  const peek=(code)=> i<c.length && c[i][0]===code;
  const loops=[], np=find(91); if(np==null) return loops;
  for(let p=0;p<np;p++){
    const flags=find(92); if(flags==null) break;
    const pts=[];
    if(flags&2){
      const hasB=find(72), closed=find(73), n=find(93)||0, vs=[];
      for(let k=0;k<n;k++){ const x=find(10), y=find(20); let b=0; if(hasB && peek(42)){ b=parseFloat(c[i][1]); i++; } vs.push([x,y,b]); }
      polyBulge(vs,true,pts);
    } else {
      const ne=find(93)||0;
      for(let k=0;k<ne;k++){
        const t=find(72);
        if(t===1){ pts.push(find(10),find(20),find(11),find(21)); }
        else if(t===2||t===3){
          const cx=find(10),cy=find(20);
          let mx,my,ra;
          if(t===2){ mx=find(40); my=0; ra=1; } else { mx=find(11); my=find(21); ra=find(40); }
          let a0=find(50)*D2R, a1=find(51)*D2R; const ccw=find(73);
          if(ccw){ while(a1<=a0) a1+=TAU; } else { a0=-a0; a1=-a1; while(a1>=a0) a1-=TAU; }
          ellPts(cx,cy,mx,my,ra,a0,a1,pts);
        }
        else if(t===4){
          const deg=find(94), rat=find(73); find(74); const nk=find(95)||0, nc=find(96)||0;
          const kn=[]; for(let q=0;q<nk;q++) kn.push(find(40));
          const ct=[], w=[]; for(let q=0;q<nc;q++){ ct.push([find(10),find(20)]); if(rat && peek(42)){ w.push(parseFloat(c[i][1])); i++; } }
          splinePts(ct,kn,deg,w.length===nc?w:null).forEach(v=>pts.push(v));
        }
      }
    }
    loops.push(pts);
  }
  return loops;
}


/* ============================== FILE HELPERS ============================== */
// DWG files start with "AC10xx" / "AC1.xx" version magic (e.g. AC1015 = R2000, AC1032 = R2018)
const DWG_VERSIONS={AC1012:'R13',AC1014:'R14',AC1015:'2000',AC1018:'2004',AC1021:'2007',AC1024:'2010',AC1027:'2013',AC1032:'2018+'};
function isDWG(buf){ return buf.length>6 && buf[0]===0x41 && buf[1]===0x43 && buf[2]===0x31 && buf[3]>=0x30 && buf[3]<=0x39; }
function dwgVersionName(buf){ const v=String.fromCharCode(...buf.slice(0,6)); return DWG_VERSIONS[v]?'AutoCAD '+DWG_VERSIONS[v]:v; }
function decodeText(buf){
  let text=new TextDecoder('utf-8').decode(buf);
  if(text.includes('�')) text=new TextDecoder('windows-1252').decode(buf);
  return text;
}
/* ============================== DWG -> internal model ==============================
 * LibreDWG (WebAssembly) reads the DWG and returns a JSON "DwgDatabase". We translate it into the
 * same {layers, blocks, entities} model that parseDXF() produces, so DWG and DXF share one renderer.
 */
function readDWG(lib, dwgFileType, buf){
  const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const ptr=lib.dwg_read_data(ab, dwgFileType);
  if(ptr===undefined||ptr===null||ptr===0) throw new Error('the DWG reader could not open this file');
  let db;
  try{ db=lib.convert(ptr); }
  finally{ try{ lib.dwg_free(ptr); }catch(_){ } }
  return dwgDbToModel(db);
}
function dwgDbToModel(db){
  const R2D=180/Math.PI;
  const out={layers:{}, blocks:{}, entities:[], header:{}};
  const T=db.tables||{};
  const ents=(t)=>(t&&(t.entries||t))||[];
  for(const L of ents(T.LAYER)){
    const ci=typeof L.colorIndex==='number'?L.colorIndex:7;
    out.layers[L.name]={name:L.name, aci:Math.abs(ci)||7, tc:null, visible: ci>=0 && !L.off && !L.frozen};
  }
  const byHandle={};
  for(const B of ents(T.BLOCK_RECORD)) if(B.handle) byHandle[B.handle]=B.name;
  try{ const u=db.header&&db.header.INSUNITS; if(typeof u==='number') out.header.units=u; }catch(_){}

  const P=(p)=>p||{x:0,y:0,z:0};
  function mk(src,type,pairs){
    const e={type, c:pairs, f:{}};
    for(const pr of pairs) if(!(pr[0] in e.f)) e.f[pr[0]]=pr[1];
    e.layer=(src&&src.layer)||'0';
    const ci=src&&src.colorIndex;
    if(typeof ci==='number' && ci>=0 && ci<=256) e.color=ci;
    else if(src && typeof src.color==='number' && src.color>=0){ e.color=256; e.tc=src.color; }
    else e.color=256;
    return e;
  }
  const ez=(o)=>{ const d=o&&(o.extrusionDirection||o.normal); return (d&&typeof d.z==='number'&&d.z<0)?-1:1; };
  function textPairs(src,t,type){
    const sp=P(t.startPoint), ep=P(t.endPoint);
    return mk(src,type,[[1,String(t.text||'')],[10,sp.x],[20,sp.y],[11,ep.x],[21,ep.y],[40,t.textHeight||1],
      [50,(t.rotation||0)*R2D],[41,t.xScale||1],[72,t.halign||0],[73,t.valign||0],[74,t.valign||0],
      [70,(src&&src.flags)||0],[230,ez(t)]]);
  }
  function hatchLoops(h){
    const loops=[];
    for(const bp of (h.boundaryPaths||[])){
      const pts=[];
      if(bp.vertices){ polyBulge(bp.vertices.map(v=>[v.x,v.y,v.bulge||0]),true,pts); }
      else for(const ed of (bp.edges||[])){
        if(ed.type===1){ pts.push(ed.start.x,ed.start.y,ed.end.x,ed.end.y); }
        else if(ed.type===2||ed.type===3){
          let mx,my,ra;
          if(ed.type===2){ mx=ed.radius; my=0; ra=1; }
          else { mx=ed.end.x; my=ed.end.y; const len=Math.hypot(mx,my)||1; ra=ed.lengthOfMinorAxis>1.0001?ed.lengthOfMinorAxis/len:ed.lengthOfMinorAxis; }
          let a0=ed.startAngle||0, a1=ed.endAngle||0;
          if(ed.isCCW===false){ a0=-a0; a1=-a1; while(a1>=a0) a1-=TAU; } else { while(a1<=a0) a1+=TAU; }
          ellPts(ed.center.x,ed.center.y,mx,my,ra||1,a0,a1,pts);
        } else if(ed.type===4){
          const cp=(ed.controlPoints||[]).map(q=>[q.x,q.y]);
          const w=(ed.controlPoints||[]).map(q=>q.weight); const hasW=w.every(x=>typeof x==='number');
          splinePts(cp,ed.knots||[],ed.degree||3,hasW?w:null).forEach(v=>pts.push(v));
        }
      }
      loops.push(pts);
    }
    return loops;
  }
  function conv(s){
    if(!s||s.isInPaperSpace) return null;
    switch(s.type){
      case 'LINE': return mk(s,'LINE',[[10,P(s.startPoint).x],[20,P(s.startPoint).y],[11,P(s.endPoint).x],[21,P(s.endPoint).y]]);
      case 'CIRCLE': return mk(s,'CIRCLE',[[10,P(s.center).x],[20,P(s.center).y],[40,s.radius],[230,ez(s)]]);
      case 'ARC': return mk(s,'ARC',[[10,P(s.center).x],[20,P(s.center).y],[40,s.radius],[50,(s.startAngle||0)*R2D],[51,(s.endAngle||0)*R2D],[230,ez(s)]]);
      case 'ELLIPSE': return mk(s,'ELLIPSE',[[10,P(s.center).x],[20,P(s.center).y],[11,P(s.majorAxisEndPoint).x],[21,P(s.majorAxisEndPoint).y],
        [40,s.axisRatio||1],[41,s.startAngle||0],[42,s.endAngle==null?TAU:s.endAngle],[230,ez(s)]]);
      case 'LWPOLYLINE': {
        const pr=[[70,(s.flag&512)?1:0],[230,ez(s)]];
        for(const v of (s.vertices||[])) pr.push([10,v.x],[20,v.y],[42,v.bulge||0]);
        return mk(s,'LWPOLYLINE',pr); }
      case 'POLYLINE2D': case 'POLYLINE3D': case 'POLYLINE': {
        const e=mk(s,'POLYLINE',[[70,s.flag||0],[230,ez(s)]]);
        e.verts=(s.vertices||[]).map(v=>mk(s,'VERTEX',[[10,v.x],[20,v.y],[42,v.bulge||0],[70,v.flag&16?16:0]]));
        return e; }
      case 'SPLINE': {
        const pr=[[70,s.flag||0],[71,s.degree||3]];
        (s.knots||[]).forEach(k=>pr.push([40,k]));
        (s.controlPoints||[]).forEach(q=>pr.push([10,q.x],[20,q.y]));
        (s.weights||[]).forEach(w=>pr.push([41,w]));
        (s.fitPoints||[]).forEach(q=>pr.push([11,q.x],[21,q.y]));
        return mk(s,'SPLINE',pr); }
      case 'TEXT': return textPairs(s,s,'TEXT');
      case 'ATTRIB': {
        if(s.flags&1) return null;
        const t=s.text&&typeof s.text==='object'?s.text:s;
        return textPairs(s,t,'ATTRIB'); }
      case 'MTEXT': {
        const ip=P(s.insertionPoint), d=s.direction;
        const pr=[[1,String(s.text||'')],[10,ip.x],[20,ip.y],[40,s.textHeight||1],[71,s.attachmentPoint||1],[50,(s.rotation||0)*R2D]];
        if(d&&(d.x||d.y)) pr.push([11,d.x],[21,d.y]);
        return mk(s,'MTEXT',pr); }
      case 'INSERT': {
        const ip=P(s.insertionPoint);
        const e=mk(s,'INSERT',[[2,String(s.name||'')],[10,ip.x],[20,ip.y],[41,s.xScale||1],[42,s.yScale||1],[50,(s.rotation||0)*R2D],
          [70,Math.max(1,s.columnCount||1)],[71,Math.max(1,s.rowCount||1)],[44,s.columnSpacing||0],[45,s.rowSpacing||0],[230,ez(s)]]);
        e.attribs=(s.attribs||[]).map(conv).filter(Boolean);
        return e; }
      case 'DIMENSION': return mk(s,'DIMENSION',[[2,String(s.name||'')]]);
      case 'ACAD_TABLE': { const nm=byHandle[s.blockRecordHandle]; return nm?mk(s,'DIMENSION',[[2,nm]]):null; }
      case 'SOLID': case 'TRACE': {
        const k=[s.corner1,s.corner2,s.corner3,s.corner4||s.corner3].map(P);
        return mk(s,s.type,[[10,k[0].x],[20,k[0].y],[11,k[1].x],[21,k[1].y],[12,k[2].x],[22,k[2].y],[13,k[3].x],[23,k[3].y],[230,ez(s)]]); }
      case '3DFACE': {
        const k=[s.corner1,s.corner2,s.corner3,s.corner4||s.corner3].map(P);
        return mk(s,'3DFACE',[[10,k[0].x],[20,k[0].y],[11,k[1].x],[21,k[1].y],[12,k[2].x],[22,k[2].y],[13,k[3].x],[23,k[3].y]]); }
      case 'POINT': return mk(s,'POINT',[[10,P(s.position).x],[20,P(s.position).y]]);
      case 'LEADER': { const pr=[]; (s.vertices||[]).forEach(q=>pr.push([10,q.x],[20,q.y])); return mk(s,'LEADER',pr); }
      case 'MLINE': { const pr=[]; (s.vertices||[]).forEach(v=>{ const q=P(v.vertex); pr.push([10,q.x],[20,q.y]); }); return mk(s,'LEADER',pr); }
      case 'HATCH': { const e=mk(s,'HATCH',[[70,s.solidFill?1:0],[230,ez(s)]]); e.loops=hatchLoops(s); return e; }
      case 'XLINE': case 'RAY': case 'WIPEOUT': case 'VIEWPORT': case 'ATTDEF': return null;
      default: return mk(s,s.type,[]);   // reported as "skipped" by buildScene
    }
  }
  const safe=(s)=>{ try{ return conv(s); }catch(err){ return null; } };
  for(const B of ents(T.BLOCK_RECORD)){
    if(!B.name || /^\*(Model|Paper)_Space/i.test(B.name)) continue;
    const bp=P(B.basePoint);
    out.blocks[B.name]={name:B.name, bx:bp.x||0, by:bp.y||0, entities:(B.entities||[]).filter(e=>e.type!=='ATTRIB').map(safe).filter(Boolean)};
  }
  // top-level ATTRIBs are drawn through their INSERT, so skip them here
  out.entities=(db.entities||[]).filter(e=>e.type!=='ATTRIB').map(safe).filter(Boolean);
  return out;
}
