import { continuationGroups, sentenceParts } from './document-translation.mjs';

const isNarrative = p => p.translationVisible && !p.figureId && !p.headingLevel;
function coveredLength(ranges, length) {
  let end=0, total=0;
  for (const r of [...ranges].sort((a,b)=>a.start-b.start)) {
    const left=Math.max(end,0,r.start), right=Math.min(length,r.end);
    total+=Math.max(0,right-left); end=Math.max(end,right);
  }
  return total;
}
export function digestStats(task) {
  let characters=0, selected=0;
  for (const p of task.paragraphs.filter(isNarrative)) {
    characters+=p.original.length;
    selected+=coveredLength((p.highlights?.original || []).filter(r=>r.kind==='ai'),p.original.length);
  }
  return {characters, selected, ratio:selected/Math.max(1,characters)};
}
export function needsDigestRefinement(task) {
  const stats=digestStats(task);
  return stats.characters>=1000 && (stats.ratio>.35 || task.highlightDigest?.version===1);
}

// Cover each substantive theme before adding its secondary evidence. A provider
// may list topics/sentences in source order despite being asked for importance;
// trimming that flat list would silently erase the report's later chapters.
export function interleaveDigestTopics(topics) {
  if(!Array.isArray(topics) || !topics.length || topics.some(t=>!t.topic?.trim() || !Array.isArray(t.sentence_ids) || !t.sentence_ids.length)) throw new Error('重点筛选未覆盖报告主题，原有重点已保留');
  const ids=[];
  for(let round=0;round<Math.max(...topics.map(t=>t.sentence_ids.length));round++) {
    for(const topic of topics) if(topic.sentence_ids[round])ids.push(topic.sentence_ids[round]);
  }
  return [...new Set(ids)];
}

// One candidate is a complete sentence, even when the PDF splits it over pages.
// Stable offsets are copied back to each source block; no source text is edited.
export function digestCandidates(task) {
  const body=task.paragraphs.filter(isNarrative);
  const groups=continuationGroups(task.paragraphs), groupByFirst=new Map(groups.map(g=>[g[0].id,g]));
  const continuations=new Set(groups.flatMap(g=>g.slice(1).map(p=>p.id)));
  return body.filter(p=>!continuations.has(p.id)).flatMap(p=>{
    let text='';
    const sources=(groupByFirst.get(p.id) || [p]).map(member=>{
      if(text)text+=' '; const start=text.length; text+=member.original;
      return {paragraphId:member.id,start,end:text.length};
    });
    return sentenceParts(text).map(part=>({
      id:`${p.id}:${part.id}`, page:p.pageNumber, text:part.text,
      sources:sources.filter(s=>s.end>part.start && s.start<part.end).map(s=>({paragraphId:s.paragraphId,start:Math.max(part.start,s.start)-s.start,end:Math.min(part.end,s.end)-s.start})),
    }));
  });
}

export function fitDigest(task, orderedIds) {
  const candidates=digestCandidates(task), byId=new Map(candidates.map(c=>[c.id,c]));
  if (!Array.isArray(orderedIds) || orderedIds.some(id=>!byId.has(id))) throw new Error('重点筛选返回了无法对应原文的句子，原有重点已保留');
  const characters=digestStats(task).characters;
  const max=Math.max(Math.floor(characters*.30),Math.min(...candidates.map(c=>c.text.length)));
  const selected=[]; let count=0;
  for (const id of new Set(orderedIds)) {
    const candidate=byId.get(id), length=candidate.sources.reduce((n,s)=>n+s.end-s.start,0);
    if(count+length>max)continue;
    selected.push(candidate);count+=length;
  }
  if (!selected.length || characters>=2000 && count<characters*.15) throw new Error('筛选出的重点不足以覆盖全文，原有重点已保留');
  return {selected, characters, selectedCharacters:count};
}

export function applyDigest(task, digest, createId) {
  const bodyIds=new Set(task.paragraphs.filter(isNarrative).map(p=>p.id));
  for(const p of task.paragraphs) {
    if (!bodyIds.has(p.id))continue;
    // Preserve user ranges separately, including overlaps. Combining them with
    // AI ranges would turn manual evidence into replaceable recommendations.
    p.highlights.original=p.highlights.original.filter(r=>r.kind!=='ai');
  }
  for(const candidate of digest.selected) for(const source of candidate.sources) {
    const p=task.paragraphs.find(p=>p.id===source.paragraphId);
    p.highlights.original.push({id:createId(),start:source.start,end:source.end,kind:'ai'});
  }
  task.highlightDigest={version:2,characters:digest.characters,selectedCharacters:digest.selectedCharacters,topics:digest.topics || []};
  if(task.summary)task.summary.stale=true;
}
