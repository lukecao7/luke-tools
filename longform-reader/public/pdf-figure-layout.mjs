import { bounds } from './document-translation.mjs';

const identity = [1, 0, 0, 1, 0, 0];
const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const intersection = (a,b) => Math.max(0, Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left)) * Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));

// PDF paths, including Bézier extrema, already carry their full paint bounds.
// Transform those bounds into the same page coordinates as extracted text.
export function pageGraphicBounds(operators, viewport, OPS) {
  let matrix = identity;
  const stack = [], boxes = [];
  const add = box => {
    if (!box) return;
    const m = multiply(viewport.transform, matrix);
    const points = [[box[0],box[1]],[box[2],box[1]],[box[0],box[3]],[box[2],box[3]]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
    const xs = points.map(p=>p[0]/viewport.width), ys = points.map(p=>p[1]/viewport.height);
    const rect = {left:Math.min(...xs),top:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
    if (rect.width > .002 && rect.height > .002 && rect.width * rect.height < .8) boxes.push(rect);
  };
  operators.fnArray.forEach((op,i)=>{
    const args = operators.argsArray[i];
    if (op === OPS.save) stack.push(matrix);
    else if (op === OPS.restore) matrix = stack.pop() || identity;
    else if (op === OPS.transform) matrix = multiply(matrix,args);
    else if (op === OPS.paintFormXObjectBegin) { stack.push(matrix); if (args[0]) matrix = multiply(matrix,args[0]); }
    else if (op === OPS.paintFormXObjectEnd) matrix = stack.pop() || identity;
    else if (op === OPS.constructPath && args[0] !== OPS.endPath) add(args[2]);
    else if ([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(op)) add([0,0,1,1]);
  });
  return boxes;
}

export function completeFigureRect(figure, graphics, paragraphs = []) {
  let crop = figure.rect;
  const obstacles = paragraphs.filter(p=>p.pageNumber === figure.pageNumber && !figure.blockIds.includes(p.id))
    .map(p=>bounds(p.sourceSegments || [])).filter(Boolean);
  const candidates = graphics.filter(box=>!obstacles.some(o=>intersection(box,o) > o.width*o.height*.15));
  for (let pass=0;pass<3;pass++) {
    const connected = candidates.filter(b=>intersection(crop,b) > Math.min(crop.width*crop.height,b.width*b.height)*.08);
    const left = Math.max(0,Math.min(crop.left,...connected.map(b=>b.left-.004)));
    const top = Math.max(0,Math.min(crop.top,...connected.map(b=>b.top-.004)));
    const right = Math.min(1,Math.max(crop.left+crop.width,...connected.map(b=>b.left+b.width+.004)));
    const bottom = Math.min(1,Math.max(crop.top+crop.height,...connected.map(b=>b.top+b.height+.004)));
    crop = {left,top,width:right-left,height:bottom-top};
  }
  return crop;
}

// Paint regions let prose occupy the genuine gap between two charts that were
// extracted as one figure, without treating their enclosing box as solid ink.
export function figurePaintRegions(figure, graphics, paragraphs = []) {
  const crop = completeFigureRect(figure, graphics, paragraphs);
  const obstacles = paragraphs.filter(p => p.pageNumber === figure.pageNumber && !figure.blockIds.includes(p.id))
    .map(p => bounds(p.sourceSegments || [])).filter(Boolean);
  return [...figure.labels.map(l => l.rect), ...graphics.filter(box => intersection(crop, box) > 0 && !obstacles.some(o => intersection(box, o) > o.width * o.height * .15))];
}

export function labelAlignment(label, labels) {
  const box=label.rect, height=Math.max(...label.sourceSegments.map(s=>s.rect.height));
  const peers=labels.filter(l=>l!==label && /[A-Za-z]/.test(l.original) && Math.abs(l.rect.top-box.top)>height*1.2 && Math.abs(Math.max(...l.sourceSegments.map(s=>s.rect.height))-height)<height*.2);
  const anchors=[b=>b.left,b=>b.left+b.width/2,b=>b.left+b.width];
  const scores=anchors.map(anchor=>peers.filter(p=>Math.abs(anchor(p.rect)-anchor(box))<.006).length);
  if (scores[2]>=2 && scores[2]>scores[0] && scores[2]>=scores[1]) return 'right';
  if (scores[1]>=2 && scores[1]>scores[0] && scores[1]>scores[2]) return 'center';
  return 'left';
}
