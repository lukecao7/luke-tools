const count = value => Number.isInteger(value) && value >= 0 ? value : null;

export function processingCounts(task) {
  const body = task.paragraphs?.filter(p => p.translationVisible && !p.figureId && !p.translationContinuationOf);
  return {
    recognizedPages: count(task.recognizedPages) ?? task.recognitionPages?.length ?? count(task.currentPage),
    pageCount: count(task.pageCount),
    translatedParagraphs: body ? body.filter(p => p.status === "done" && (!task.realignExisting || p.translationAligned)).length : count(task.translatedParagraphs),
    totalTranslationParagraphs: body ? body.length : count(task.totalTranslationParagraphs),
    translatedChartLabels: task.figures ? task.figures.flatMap(f => f.labels).filter(l => l.translation).length : count(task.translatedChartLabels),
    totalChartLabels: task.figures ? task.figures.flatMap(f => f.labels).length : count(task.totalChartLabels),
  };
}

export function processingDetails(progress) {
  const stage = progress.processingStage || "recognition";
  const counts = processingCounts(progress);
  const steps = ["识别文档", "分析全文", "翻译内容"];
  const stageIndex = { recognition: 0, analysis: 1, translation: 2, ready: 3 }[stage] ?? 0;
  let title = "正在读取文档", value = "", detail = "读取完成后开始分析全文。", ratio = null;
  if (stage === "recognition") {
    title = progress.ocrActive ? "正在识别扫描页文字" : "正在识别文档";
    if (counts.pageCount > 0 && counts.recognizedPages !== null) {
      value = `已识别 ${counts.recognizedPages}/${counts.pageCount} 页`;
      ratio = Math.min(1, counts.recognizedPages / counts.pageCount);
    }
    detail = "正在读取文字与版面，完成后开始分析全文。";
  } else if (stage === "analysis") {
    title = progress.analysisStep === "evidence" ? "正在精简推荐重点" : progress.analysisStep === "charts" ? "正在核对图表重点" : "正在分析全文";
    const prefix = counts.pageCount > 0 && counts.recognizedPages !== null ? `已识别 ${counts.recognizedPages}/${counts.pageCount} 页 · ` : "文档读取完成 · ";
    detail = prefix + (progress.analysisStep === "charts" ? "正在核对图表中的关键证据。" : "正在筛选正文与重点，完成后开始翻译。");
    if(progress.analysisStep === "evidence") detail = "正在筛选约四分之一的核心证据，保留完整句意并去除重复。";
  } else if (stage === "translation") {
    title = counts.totalChartLabels > 0 ? "正在翻译正文与图表" : "正在翻译正文";
    if (counts.totalTranslationParagraphs > 0 && counts.translatedParagraphs !== null) {
      value = `已翻译 ${counts.translatedParagraphs}/${counts.totalTranslationParagraphs} 段`;
      ratio = Math.min(1, counts.translatedParagraphs / counts.totalTranslationParagraphs);
    }
    detail = counts.totalChartLabels > 0 ? `图表文字已完成 ${counts.translatedChartLabels || 0}/${counts.totalChartLabels} 项；每批完成后更新。`
      : counts.translatedParagraphs === 0 ? "正在生成首批译文，完成后更新段数。" : "正在翻译后续内容，每批完成后更新段数。";
  } else if (stage === "ready") {
    title = "处理完成"; detail = "正在打开阅读页面。"; ratio = 1;
  }
  if (progress.status === "cancelled") {
    title = "已取消处理";
    detail = "已完成的内容已保存，继续处理会从中断处开始。";
  }
  return {
    title, value, detail, ratio, steps, stageIndex,
    compact: value || title,
    startedAt: progress.processingStartedAt || progress.createdAt || progress.stageStartedAt || null,
    timeLabel: "累计已用",
  };
}
