import jsPDF from "jspdf";
import { format } from "date-fns";

const MAX_PAGES = 3;

/** Vertical rhythm (mm) — keep gaps between section bars and blocks consistent */
const PDF_GAP_BEFORE_SECTION_BAR = 4;
const PDF_GAP_AFTER_SECTION_BAR = 10;
const PDF_GAP_AFTER_CONTENT_BOX = 2.5;
/** Breathing room under “Audio & transcription / NLP” before sentiment / charts */
const PDF_GAP_UNDER_AUDIO_SECTION = 3.5;

/** Five-class face model: Happy, Angry, Neutral, Sad, Surprise */
const EMO_COLORS = {
  happy: "#f4a261",
  angry: "#e63946",
  neutral: "#94a3b8",
  sad: "#457b9d",
  surprise: "#ffb703",
};

const EMOTION_CLASS_ORDER = ["happy", "angry", "neutral", "sad", "surprise"];

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [45, 212, 191];
}

function toDateLabel(value) {
  if (!value) return "—";
  try {
    return format(new Date(value), "MMM d, yyyy");
  } catch {
    return String(value);
  }
}

function labelEmo(key) {
  const s = String(key).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function emoColor(key) {
  return EMO_COLORS[key] || "#94a3b8";
}

/** Serial trend PDF line: neutral / happy / sad / angry / surprise (order matches label). */
function formatSerialFaceEmotionPcts(s) {
  const keys = ["face_neutral_pct", "face_happy_pct", "face_sad_pct", "face_angry_pct", "face_surprise_pct"];
  const vals = keys.map((k) => s[k]);
  if (vals.every((v) => v == null)) return "—";
  return vals.map((v) => (v != null ? `${Number(v).toFixed(0)}%` : "—")).join("/");
}

function pageCount(doc) {
  if (typeof doc.getNumberOfPages === "function") return doc.getNumberOfPages();
  return doc.internal.getNumberOfPages();
}

function truncate(s, max) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function fmtMax2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "—");
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function serialGaitSpeedValue(visitRow) {
  const direct = Number(visitRow?.gait_avg_speed_mps);
  if (Number.isFinite(direct)) return direct;
  const gs = visitRow?.gait_summary;
  const candidates = [
    gs?.mean_speed_mps,
    gs?.avg_speed_mps,
    gs?.features?.avg_speed_mps,
    gs?.features?.speed_mps,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function serialFacePctValue(visitRow, emotionKey) {
  const direct = Number(visitRow?.[`face_${emotionKey}_pct`]);
  if (Number.isFinite(direct)) return direct <= 1 ? direct * 100 : direct;
  const faceRows = Array.isArray(visitRow?.multimodal_jsonl?.face) ? visitRow.multimodal_jsonl.face : [];
  const summary = faceRows.find((r) => r?.type === "summary");
  const fromSummary = Number(summary?.features?.emotion_pct?.[emotionKey]);
  if (Number.isFinite(fromSummary)) return fromSummary <= 1 ? fromSummary * 100 : fromSummary;
  return null;
}

function serialDistressLevel(visitRow) {
  const v = String(visitRow?.sentiment_analysis?.distress_level ?? visitRow?.distress_level ?? "").toLowerCase();
  if (v === "high") return 3;
  if (v === "medium") return 2;
  if (v === "low") return 1;
  return null;
}

function serialKeywordCount(visitRow) {
  if (visitRow?.audio_keyword_hits != null) {
    const n = Number(visitRow.audio_keyword_hits);
    if (Number.isFinite(n)) return n;
  }
  const dk = visitRow?.keyword_analysis?.diagnostic_keywords;
  if (dk && typeof dk === "object") {
    return Object.values(dk).reduce((sum, v) => {
      if (typeof v === "number") return sum + v;
      if (v && typeof v === "object") return sum + (Number(v.count) || 0);
      return sum;
    }, 0);
  }
  return null;
}

function serialKeywordPct(visitRow) {
  if (visitRow?.audio_diagnostic_term_pct != null) {
    const n = Number(visitRow.audio_diagnostic_term_pct);
    if (Number.isFinite(n)) return n * 100;
  }
  const pct = Number(visitRow?.keyword_analysis?.keyword_percentage);
  if (Number.isFinite(pct)) return pct;
  return null;
}

/** How many baselines vitals (BP / HR / …) need when wrapping to innerW. */
function measureVitalLineCount(doc, innerW, parts) {
  doc.setFontSize(8);
  let x = 0;
  const x0 = 0;
  const right = innerW;
  let lines = 1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    doc.setFont("helvetica", "bold");
    const kw = doc.getTextWidth(p.k + " ");
    doc.setFont("helvetica", "normal");
    const vw = doc.getTextWidth(String(p.v));
    const sepW = i > 0 ? doc.getTextWidth(" · ") : 0;
    const needSep = i > 0 && x > x0;
    const blockW = (needSep ? sepW : 0) + kw + vw;
    if (x + blockW > right && x > x0) {
      lines++;
      x = x0;
    }
    if (needSep) x += sepW;
    x += kw + vw;
  }
  return lines;
}

/** Draw vitals with bold labels (BP, HR, …); returns Y of last baseline. */
function drawVitalPartsInline(doc, x0, y, innerW, parts) {
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  let x = x0;
  const right = x0 + innerW;
  const lineLead = 3.8;
  let lineY = y;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    doc.setFont("helvetica", "bold");
    const kw = doc.getTextWidth(p.k + " ");
    doc.setFont("helvetica", "normal");
    const vw = doc.getTextWidth(String(p.v));
    const sepW = i > 0 ? doc.getTextWidth(" · ") : 0;
    const needSep = i > 0 && x > x0;
    const blockW = (needSep ? sepW : 0) + kw + vw;
    if (x + blockW > right && x > x0) {
      lineY += lineLead;
      x = x0;
    }
    if (needSep) {
      doc.setFont("helvetica", "normal");
      doc.text(" · ", x, lineY);
      x += doc.getTextWidth(" · ");
    }
    doc.setFont("helvetica", "bold");
    doc.text(p.k + " ", x, lineY);
    x += doc.getTextWidth(p.k + " ");
    doc.setFont("helvetica", "normal");
    doc.text(String(p.v), x, lineY);
    x += doc.getTextWidth(String(p.v));
  }
  return lineY;
}

/** Elapsed seconds string for PDF (2 decimal places). */
function formatElapsedSecForPdf(n) {
  const x = Number(n);
  if (n == null || Number.isNaN(x)) return String(n ?? "");
  return x.toFixed(2);
}

/** Single window e.g. "0.00–10.00s" or "5.00s" for PDF axis */
function windowRangeShort(w) {
  if (!w) return "";
  const a = w.t_start;
  const b = w.t_end;
  if (a != null && b != null && Number(b) !== Number(a))
    return `${formatElapsedSecForPdf(a)}–${formatElapsedSecForPdf(b)}s`;
  if (a != null) return `${formatElapsedSecForPdf(a)}s`;
  return "";
}

/** Subtitle line for charts: span of elapsed time across shown windows */
function chartElapsedCoverageSubtitle(windowsSlice) {
  if (!windowsSlice?.length) return "";
  const first = windowsSlice[0];
  const last = windowsSlice[windowsSlice.length - 1];
  const start = first?.t_start;
  const end = last?.t_end != null ? last.t_end : last?.t_start;
  if (start != null && end != null) {
    return `Elapsed time: ${formatElapsedSecForPdf(start)}s–${formatElapsedSecForPdf(end)}s · ${windowsSlice.length} windows`;
  }
  return `${windowsSlice.length} analysis windows`;
}

/** @param {import('jspdf').default} doc */
function drawFooterOnAllPages(doc, pageWidth, pageHeight) {
  const n = pageCount(doc);
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(110, 120, 118);
    doc.text(`Smart Exam Room · Report summary · Page ${i} of ${n}`, pageWidth / 2, pageHeight - 7, {
      align: "center",
    });
    doc.setTextColor(0, 0, 0);
  }
}

/**
 * @param {import('jspdf').default} doc
 * @returns {boolean} false if no more pages allowed
 */
function newPage(doc, yRef, pageHeight, margin) {
  if (pageCount(doc) >= MAX_PAGES) return false;
  doc.addPage();
  yRef.y = margin;
  return true;
}

function ensureSpace(doc, yRef, need, pageHeight, margin, maxWidth) {
  const bottom = pageHeight - margin - 10;
  if (yRef.y + need <= bottom) return true;
  return newPage(doc, yRef, pageHeight, margin);
}

function setTealHeaderFill(doc) {
  doc.setFillColor(236, 253, 245);
}

function sectionBar(doc, margin, y, maxWidth, title, yRef, pageHeight) {
  if (!ensureSpace(doc, yRef, PDF_GAP_BEFORE_SECTION_BAR + 12, pageHeight, margin, maxWidth)) return;
  yRef.y += PDF_GAP_BEFORE_SECTION_BAR;
  setTealHeaderFill(doc);
  doc.rect(margin, yRef.y - 3, maxWidth, 9, "F");
  doc.setDrawColor(167, 243, 208);
  doc.rect(margin, yRef.y - 3, maxWidth, 9, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(17, 94, 89);
  doc.text(title, margin + 3, yRef.y + 3);
  doc.setTextColor(0, 0, 0);
  yRef.y += PDF_GAP_AFTER_SECTION_BAR;
}

function drawVisitInfoLine(doc, margin, yRef, maxWidth, visitMeta, patient, visit, pageHeight) {
  const visitNum = visit?.visit_number != null && visit.visit_number !== "" ? visit.visit_number : visitMeta?.visitId ?? "—";
  const mrn = String(patient?.medical_record_number || visitMeta?.patientId || "—");
  const nameRaw = patient
    ? `${patient.first_name || ""} ${patient.last_name || ""}`.trim()
    : "Unknown Patient";
  let nameDisp = nameRaw || "—";

  const padX = 4;
  const innerW = maxWidth - padX * 2;
  const lineLead = 4.2;
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);

  const measureRowWidth = (nameTry) => {
    let w = 0;
    const add = (bold, t) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      w += doc.getTextWidth(t);
    };
    add(true, "Patient: ");
    add(false, nameTry);
    add(false, "  ·  ");
    add(true, "MRN: ");
    add(false, mrn);
    add(false, "  ·  ");
    add(true, "Visit number: ");
    add(false, String(visitNum));
    return w;
  };

  while (nameDisp.length > 4 && measureRowWidth(nameDisp) > innerW) {
    nameDisp = nameDisp.slice(0, Math.max(4, Math.floor(nameDisp.length * 0.82))).trimEnd() + "…";
  }

  const boxH = 8 + lineLead;
  if (!ensureSpace(doc, yRef, boxH + 6, pageHeight, margin, maxWidth)) return;
  doc.setDrawColor(153, 246, 228);
  doc.setFillColor(248, 253, 252);
  doc.roundedRect(margin, yRef.y, maxWidth, boxH, 1.5, 1.5, "FD");

  let x = margin + padX;
  const baseY = yRef.y + 6;
  const put = (bold, t) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(t, x, baseY);
    x += doc.getTextWidth(t);
  };
  put(true, "Patient: ");
  put(false, nameDisp);
  put(false, "  ·  ");
  put(true, "MRN: ");
  put(false, mrn);
  put(false, "  ·  ");
  put(true, "Visit number: ");
  put(false, String(visitNum));

  doc.setTextColor(0, 0, 0);
  yRef.y += boxH + PDF_GAP_AFTER_CONTENT_BOX;
}

function drawVitalsGrid(doc, margin, yRef, maxWidth, vitals, visit, pageHeight) {
  const v = vitals || {};
  const textWidth = maxWidth - 8;
  const vitalParts = [
    { k: "BP", v: `${v.bp_systolic ?? "—"}/${v.bp_diastolic ?? "—"}` },
    { k: "HR", v: String(v.heart_rate ?? "—") },
    { k: "RR", v: String(v.respiratory_rate ?? "—") },
    { k: "Temp", v: `${v.temperature ?? "—"}${v.temperature_unit === "celsius" ? "°C" : "°F"}` },
    { k: "SpO₂", v: `${v.spo2 ?? "—"}%` },
    { k: "BMI", v: String(v.bmi ?? "—") },
  ];
  const items = [
    ["Visit date", toDateLabel(v.visit_date || visit?.visit_date), "text"],
    ["Chief complaint", truncate(v.chief_complaint || visit?.chief_complaint || "—", 120), "text"],
    ["Vitals", vitalParts, "vitals"],
  ];

  /** Match the draw loop: top inset, header, then per-item label + wrapped value + gap */
  const lineLead = 3.6;
  const vitalLineLead = 3.8;
  let simY = 5 + 5;
  items.forEach(([, val, kind]) => {
    simY += 3.2;
    if (kind === "vitals") {
      const vLines = measureVitalLineCount(doc, textWidth, val);
      simY += vLines * vitalLineLead + 1.4;
    } else {
      simY += doc.splitTextToSize(val, textWidth).length * lineLead + 1.4;
    }
  });
  const h = simY + 2;

  if (!ensureSpace(doc, yRef, h + 6, pageHeight, margin, maxWidth)) return;
  doc.setDrawColor(153, 246, 228);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, yRef.y, maxWidth, h, 1.5, 1.5, "FD");
  let ly = yRef.y + 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.6);
  doc.setTextColor(13, 148, 136);
  doc.text("VITAL SIGNS", margin + 4, ly);
  ly += 5;
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  items.forEach(([lab, val, kind]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(`${lab}:`, margin + 4, ly);
    ly += 3.2;
    if (kind === "vitals") {
      const endY = drawVitalPartsInline(doc, margin + 4, ly, textWidth, val);
      ly = endY + 1.4;
    } else {
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(val, textWidth);
      doc.text(lines, margin + 4, ly);
      ly += lines.length * lineLead + 1.4;
    }
  });
  yRef.y += h + PDF_GAP_AFTER_CONTENT_BOX;
}

function pctStr(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function drawConfidenceStrip(doc, margin, yRef, maxWidth, multimodal, recordCounts, pageHeight) {
  const rowH = 18;
  if (!ensureSpace(doc, yRef, rowH + PDF_GAP_AFTER_CONTENT_BOX + 2, pageHeight, margin, maxWidth)) return;
  const { co, cf, ca, cg } = multimodal || {};
  const { face = 0, audio = 0, gait = 0 } = recordCounts || {};
  const tiles = [
    ["Overall", pctStr(co), "teal"],
    ["Face", pctStr(cf), "blue"],
    ["Audio", pctStr(ca), "violet"],
    ["Gait", pctStr(cg), "emerald"],
  ];
  const tw = (maxWidth - 9) / 4;
  let x = margin;
  tiles.forEach(([label, val], i) => {
    const top = [15, 118, 110];
    const colors = [
      top,
      [37, 99, 235],
      [109, 40, 217],
      [5, 150, 105],
    ];
    const [r, g, b] = colors[i] || top;
    doc.setDrawColor(204, 251, 241);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, yRef.y, tw, rowH, 1, 1, "FD");
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.8);
    doc.line(x, yRef.y, x + tw, yRef.y);
    doc.setLineWidth(0.2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(13, 148, 136);
    doc.text(label.toUpperCase(), x + 3, yRef.y + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(r, g, b);
    doc.text(val, x + 3, yRef.y + 14);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    const counts = [face + audio + gait, face, audio, gait];
    doc.text(`${counts[i] || 0} records`, x + tw - 3, yRef.y + 14, { align: "right" });
    x += tw + 3;
  });
  doc.setTextColor(0, 0, 0);
  yRef.y += rowH + PDF_GAP_AFTER_CONTENT_BOX;
}

/** Horizontal bar chart — mirrors “Emotion distribution” card */
function drawEmotionBars(doc, margin, yRef, maxWidth, sorted, pageHeight) {
  const rows = (sorted || []).slice(0, 6);
  if (!rows.length) return;
  const itemRows = Math.ceil(rows.length / 2);
  const chartH = 7 + itemRows * 5 + 4;
  if (!ensureSpace(doc, yRef, chartH + 6, pageHeight, margin, maxWidth)) return;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 94, 89);
  doc.text("Emotion distribution", margin, yRef.y);
  yRef.y += 4.5;

  const colW = maxWidth / 2;
  const dotR = 1.2;
  rows.forEach(([key, val], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const baseX = margin + col * colW;
    const baseY = yRef.y + row * 5;
    const pctText = `${Number(val).toFixed(1)}%`;
    const [r, g, b] = hexToRgb(emoColor(key));

    doc.setFillColor(r, g, b);
    doc.circle(baseX + 1.5, baseY + 1.8, dotR, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(15, 118, 110);
    doc.text(truncate(labelEmo(key), 13), baseX + 4.2, baseY + 2.6);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(13, 148, 136);
    doc.text(pctText, baseX + colW - 2, baseY + 2.6, { align: "right" });
  });

  yRef.y += itemRows * 5 + 4;
}

/** Resolve Chart.js-style label to emotion key for colors */
function emotionKeyFromTimelineLabel(lbl, sorted) {
  if (!sorted?.length) return null;
  for (const [k] of sorted) {
    if (labelEmo(k) === String(lbl)) return k;
  }
  return null;
}

/** Build timeline { labels, datasets[{ label, data, key? }] } for PDF — matches Report Summary line chart */
function buildEmotionTimelineForPdf(faceDerived) {
  const tl = faceDerived?.emotionTimeline;
  if (tl?.labels?.length && tl?.datasets?.length) {
    return {
      labels: tl.labels,
      datasets: tl.datasets.map((d) => ({
        label: d.label,
        data: Array.isArray(d.data) ? d.data.map(Number) : [],
        key: emotionKeyFromTimelineLabel(d.label, faceDerived.sorted),
      })),
    };
  }
  const windows = faceDerived?.windows || [];
  if (!windows.length) return null;
  const allEmos = [...new Set(windows.flatMap((w) => Object.keys(w.features?.emotion_counts || {})))].sort(
    (a, b) => {
      const ia = EMOTION_CLASS_ORDER.indexOf(a);
      const ib = EMOTION_CLASS_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
  );
  const labels = windows.map(
    (w) => `${formatElapsedSecForPdf(w.t_start)}s–${formatElapsedSecForPdf(w.t_end)}s`
  );
  const datasets = allEmos.map((emo) => ({
    label: labelEmo(emo),
    key: emo,
    data: windows.map((w) => {
      const ec = w.features?.emotion_counts || {};
      const total = Object.values(ec).reduce((a, v) => a + v, 0) || 1;
      return +(((ec[emo] || 0) / total) * 100).toFixed(1);
    }),
  }));
  return { labels, datasets };
}

/** Multi-line chart — “Emotion frequency over time” (same data as Report Summary) */
function drawEmotionFrequencyOverTime(doc, margin, yRef, maxWidth, faceDerived, pageHeight) {
  const built = buildEmotionTimelineForPdf(faceDerived);
  if (!built?.labels?.length || !built.datasets?.length) return;
  const { labels, datasets: allDs } = built;
  const n = labels.length;
  const ranked = [...allDs]
    .filter((d) => d.data?.length === n)
    .sort((a, b) => Math.max(...b.data) - Math.max(...a.data))
    .slice(0, 6);
  if (!ranked.length) return;

  const lineH = 3.6;
  const plotH = 28;
  const axisW = 8;
  const coverageLines = faceDerived?.windows?.length
    ? doc.splitTextToSize(chartElapsedCoverageSubtitle(faceDerived.windows), maxWidth)
    : [];
  const totalNeed =
    5 +
    coverageLines.length * lineH +
    1 +
    plotH +
    8;
  if (!ensureSpace(doc, yRef, totalNeed, pageHeight, margin, maxWidth)) return;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 94, 89);
  doc.text("Emotion frequency over time", margin, yRef.y);
  yRef.y += 5;
  if (coverageLines.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(80, 100, 98);
    doc.text(coverageLines, margin, yRef.y);
    yRef.y += coverageLines.length * lineH + 1;
  }
  doc.setTextColor(0, 0, 0);

  const plotY = yRef.y;
  const plotX = margin + axisW;
  const plotW = maxWidth - axisW - 4;
  doc.setDrawColor(167, 243, 208);
  doc.setFillColor(252, 253, 252);
  doc.rect(plotX, plotY, plotW, plotH, "FD");
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.15);
  for (let g = 0; g <= 4; g++) {
    const yy = plotY + (g / 4) * (plotH - 4) + 2;
    doc.line(plotX, yy, plotX + plotW, yy);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  doc.text("100%", margin + 1, plotY + 4);
  doc.text("50%", margin + 1, plotY + plotH / 2 + 1);
  doc.text("0%", margin + 1, plotY + plotH - 1);

  const xAt = (i) => (n <= 1 ? plotX + plotW / 2 : plotX + (i / Math.max(1, n - 1)) * plotW);
  const yAt = (pct) => plotY + plotH - 2 - (Math.min(100, Math.max(0, pct)) / 100) * (plotH - 4);

  ranked.forEach((ds) => {
    const key = ds.key || emotionKeyFromTimelineLabel(ds.label, faceDerived.sorted);
    const [R, G, B] = hexToRgb(emoColor(key));
    doc.setDrawColor(R, G, B);
    doc.setLineWidth(0.45);
    for (let i = 0; i < n - 1; i++) {
      doc.line(xAt(i), yAt(ds.data[i]), xAt(i + 1), yAt(ds.data[i + 1]));
    }
    for (let i = 0; i < n; i++) {
      doc.setFillColor(R, G, B);
      doc.circle(xAt(i), yAt(ds.data[i]), 0.75, "F");
    }
  });

  doc.setFontSize(4.5);
  doc.setTextColor(90, 100, 110);
  const tickStep = n <= 6 ? 1 : Math.ceil(n / 6);
  for (let i = 0; i < n; i += tickStep) {
    doc.text(truncate(labels[i], 10), xAt(i), plotY + plotH + 3.2, { align: "center" });
  }
  if ((n - 1) % tickStep !== 0 && n > 1) {
    doc.text(truncate(labels[n - 1], 10), xAt(n - 1), plotY + plotH + 3.2, { align: "center" });
  }

  yRef.y = plotY + plotH + 5;
}

/** Sentiment polarity bars (audio windows) + numeric scale & table */
function drawSentimentMiniChart(doc, margin, yRef, maxWidth, audioDerived, pageHeight) {
  const windows = audioDerived?.windows || [];
  if (!windows.length) return;
  const n = Math.min(windows.length, 14);
  const ws = windows.slice(0, n);
  const axisW = 10;
  const chartH = 32;
  const lineH = 3.6;
  const polarities = ws.map((w) => Number(w?.features?.sentiment?.polarity ?? 0));
  const belowPlotReserve = 14;
  const headerReserve = 5;
  const summaryReserve = 2 * lineH + 4;
  const totalNeed = headerReserve + chartH + belowPlotReserve + summaryReserve;
  if (!ensureSpace(doc, yRef, totalNeed, pageHeight, margin, maxWidth)) return;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 94, 89);
  doc.text("Sentiment polarity over time", margin, yRef.y);
  yRef.y += 5;
  doc.setTextColor(0, 0, 0);
  const plotY = yRef.y;
  const plotH = 22;
  const plotX = margin + axisW;
  const plotW = maxWidth - 4 - axisW;
  const gap = plotW / n;
  const barW = Math.max(1.2, gap - 0.8);

  const polMin = Math.min(...polarities);
  const polMax = Math.max(...polarities);
  const polMean = polarities.reduce((a, v) => a + v, 0) / polarities.length;

  doc.setDrawColor(167, 243, 208);
  doc.setFillColor(248, 253, 252);
  doc.rect(plotX, plotY, plotW, plotH, "FD");
  const midY = plotY + plotH / 2;
  doc.setDrawColor(15, 118, 110);
  doc.setLineWidth(0.2);
  doc.line(plotX, midY, plotX + plotW, midY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  const yForPol = (p) => plotY + plotH - ((p + 1) / 2) * (plotH - 2) - 1;
  doc.text("+1", margin + 1, yForPol(1) + 1);
  doc.text("0", margin + 1, midY + 1);
  doc.text("-1", margin + 1, yForPol(-1) + 1);

  for (let i = 0; i < n; i++) {
    const pol = polarities[i];
    const h = (Math.abs(pol) / 1) * (plotH / 2 - 1);
    const x = plotX + i * gap + (gap - barW) / 2;
    if (pol >= 0) {
      doc.setFillColor(5, 150, 105);
      doc.rect(x, midY - h, barW, h, "F");
    } else {
      doc.setFillColor(220, 38, 38);
      doc.rect(x, midY, barW, h, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.8);
    doc.setTextColor(71, 85, 105);
    const label = pol.toFixed(2);
    const tx = x + barW / 2;
    const ty = pol >= 0 ? midY - h - 1.5 : midY + h + 2.5;
    doc.text(label, tx, ty, { align: "center" });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.6);
  doc.setTextColor(90, 100, 110);
  for (let i = 0; i < n; i++) {
    let lbl = windowRangeShort(ws[i]);
    if (!lbl) lbl = `#${i + 1}`;
    const x = plotX + i * gap + gap / 2;
    doc.text(truncate(lbl, 11), x, plotY + plotH + 3.2, { align: "center" });
  }
  doc.setFontSize(6);
  doc.setTextColor(100, 116, 139);
  doc.text("-1", plotX, plotY + plotH + 7.8);
  doc.text("+1", plotX + plotW - 1, plotY + plotH + 7.8, { align: "right" });
  doc.setFontSize(6.5);
  doc.setTextColor(30, 41, 59);
  let tableY = plotY + plotH + 12;
  doc.text(
    `Summary: min ${polMin.toFixed(2)} · max ${polMax.toFixed(2)} · mean ${polMean.toFixed(2)} (scale -1 … +1)`,
    margin,
    tableY
  );
  yRef.y = tableY + 4;
}

/** Gait speed sparkline + Y-axis scale & numeric table */
function drawGaitSparkline(doc, margin, yRef, maxWidth, gaitDerived, pageHeight) {
  const windows = gaitDerived?.windows || [];
  const gaitWindowsWithSpeed = windows.filter((w) => w.features?.speed_mps != null);
  const speeds = gaitWindowsWithSpeed.map((w) => w.features?.speed_mps);
  if (!speeds.length) return;
  const axisW = 14;
  const plotH = 22;
  const lineH = 3.6;
  const coverageSubtitle = chartElapsedCoverageSubtitle(gaitWindowsWithSpeed);
  const coverageLines = coverageSubtitle
    ? doc.splitTextToSize(coverageSubtitle, maxWidth)
    : [];
  const belowPlotReserve = 12;
  const headerReserve = 5 + coverageLines.length * lineH + 1;
  const summaryReserve = 2 * lineH + 4;
  const totalNeed = headerReserve + plotH + belowPlotReserve + summaryReserve;
  if (!ensureSpace(doc, yRef, totalNeed, pageHeight, margin, maxWidth)) return;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 94, 89);
  doc.text("Gait metrics over time (speed m/s)", margin, yRef.y);
  yRef.y += 5;
  if (coverageLines.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(80, 100, 98);
    doc.text(coverageLines, margin, yRef.y);
    yRef.y += coverageLines.length * lineH + 1;
  }
  doc.setTextColor(0, 0, 0);
  const plotY = yRef.y;
  const plotX = margin + axisW;
  const plotW = maxWidth - 4 - axisW;
  doc.setDrawColor(167, 243, 208);
  doc.setFillColor(255, 255, 255);
  doc.rect(plotX, plotY, plotW, plotH, "FD");
  const minS = Math.min(...speeds);
  const maxS = Math.max(...speeds, minS + 0.01);
  const midS = (minS + maxS) / 2;
  const pts = windows
    .map((w, wIdx) => ({ i: wIdx, s: w.features?.speed_mps, t: w.t_start, w }))
    .filter((p) => p.s != null);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  const yForSpeed = (s) => plotY + plotH - ((s - minS) / (maxS - minS)) * (plotH - 4) - 2;
  doc.text(`${maxS.toFixed(2)}`, margin, yForSpeed(maxS) + 1);
  doc.text(`${midS.toFixed(2)}`, margin, yForSpeed(midS) + 1);
  doc.text(`${minS.toFixed(2)}`, margin, yForSpeed(minS) + 1);

  if (pts.length < 2) {
    doc.setDrawColor(4, 120, 87);
    doc.setLineWidth(0.5);
    const y = plotY + plotH / 2;
    doc.line(plotX + 2, y, plotX + plotW - 2, y);
  } else {
    doc.setDrawColor(4, 120, 87);
    doc.setLineWidth(0.6);
    for (let i = 0; i < pts.length - 1; i++) {
      const x0 = plotX + (pts[i].i / Math.max(1, windows.length - 1)) * plotW;
      const x1 = plotX + (pts[i + 1].i / Math.max(1, windows.length - 1)) * plotW;
      const norm = (v) => plotY + plotH - ((v - minS) / (maxS - minS)) * (plotH - 4) - 2;
      doc.line(x0, norm(pts[i].s), x1, norm(pts[i + 1].s));
    }
    pts.forEach((p) => {
      const x = plotX + (p.i / Math.max(1, windows.length - 1)) * plotW;
      const y = plotY + plotH - ((p.s - minS) / (maxS - minS)) * (plotH - 4) - 2;
      doc.setFillColor(4, 120, 87);
      doc.circle(x, y, 0.9, "F");
    });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.6);
  doc.setTextColor(90, 100, 110);
  pts.forEach((p) => {
    const win = p.w || windows[p.i];
    let lbl = windowRangeShort(win);
    if (!lbl) lbl = `#${p.i + 1}`;
    const x = plotX + (p.i / Math.max(1, windows.length - 1)) * plotW;
    doc.text(truncate(lbl, 11), x, plotY + plotH + 3.2, { align: "center" });
  });

  const meanSpeed = speeds.reduce((a, v) => a + v, 0) / speeds.length;
  let tableY = plotY + plotH + 11;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(30, 41, 59);
  doc.text(
    `Summary: min ${minS.toFixed(2)} · max ${maxS.toFixed(2)} · mean ${meanSpeed.toFixed(2)} m/s`,
    margin,
    tableY
  );
  yRef.y = tableY + 4;
}

/** Serial trend line chart for gait speed across visits */
function drawSerialGaitTrend(doc, margin, yRef, maxWidth, serialVisits, pageHeight) {
  const rows = (serialVisits || [])
    .map((s) => ({ ...s, __gaitSpeed: serialGaitSpeedValue(s) }))
    .filter((s) => s.__gaitSpeed != null)
    .slice(0, 12);
  if (!rows.length) return;

  const lineH = 3.6;
  const axisW = 14;
  const plotH = 28;
  const subtitle = "Gait speed trend over visits";
  const subtitleLines = doc.splitTextToSize(subtitle, maxWidth);
  const totalNeed = 5 + subtitleLines.length * lineH + 1 + plotH + 10;
  if (!ensureSpace(doc, yRef, totalNeed, pageHeight, margin, maxWidth)) return;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 94, 89);
  doc.text("Serial gait trend (m/s)", margin, yRef.y);
  yRef.y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(80, 100, 98);
  doc.text(subtitleLines, margin, yRef.y);
  yRef.y += subtitleLines.length * lineH + 1;
  doc.setTextColor(0, 0, 0);

  const plotY = yRef.y;
  const plotX = margin + axisW;
  const plotW = maxWidth - axisW - 4;
  doc.setDrawColor(167, 243, 208);
  doc.setFillColor(255, 255, 255);
  doc.rect(plotX, plotY, plotW, plotH, "FD");

  const speeds = rows.map((s) => Number(s.__gaitSpeed));
  const minS = Math.min(...speeds);
  const maxS = Math.max(...speeds, minS + 0.01);
  const midS = (minS + maxS) / 2;
  const yFor = (s) => plotY + plotH - ((s - minS) / (maxS - minS)) * (plotH - 4) - 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  doc.text(fmtMax2(maxS), margin, yFor(maxS) + 1);
  doc.text(fmtMax2(midS), margin, yFor(midS) + 1);
  doc.text(fmtMax2(minS), margin, yFor(minS) + 1);

  doc.setDrawColor(4, 120, 87);
  doc.setLineWidth(0.6);
  const xAt = (i) => (rows.length <= 1 ? plotX + plotW / 2 : plotX + (i / Math.max(1, rows.length - 1)) * plotW);
  for (let i = 0; i < rows.length - 1; i++) {
    doc.line(xAt(i), yFor(speeds[i]), xAt(i + 1), yFor(speeds[i + 1]));
  }
  rows.forEach((_, i) => {
    doc.setFillColor(4, 120, 87);
    doc.circle(xAt(i), yFor(speeds[i]), 0.9, "F");
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.6);
  doc.setTextColor(90, 100, 110);
  const tickStep = rows.length <= 6 ? 1 : Math.ceil(rows.length / 6);
  for (let i = 0; i < rows.length; i += tickStep) {
    const lbl = `V${rows[i].visit_number ?? i + 1}`;
    doc.text(lbl, xAt(i), plotY + plotH + 3.2, { align: "center" });
  }
  if ((rows.length - 1) % tickStep !== 0 && rows.length > 1) {
    const j = rows.length - 1;
    const lbl = `V${rows[j].visit_number ?? j + 1}`;
    doc.text(lbl, xAt(j), plotY + plotH + 3.2, { align: "center" });
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.2);
  doc.setTextColor(4, 120, 87);
  doc.text("● Speed (m/s)", margin, plotY + plotH + 8);
  yRef.y = plotY + plotH + 11;
}

/** Serial trend line chart for face emotion percentages across visits */
function drawSerialFaceTrend(doc, margin, yRef, maxWidth, serialVisits, pageHeight) {
  const rows = (serialVisits || []).slice(0, 12);
  const seriesDefs = [
    { key: "neutral", label: "Neutral", color: [148, 163, 184] },
    { key: "happy", label: "Happy", color: [244, 162, 97] },
    { key: "sad", label: "Sad", color: [69, 123, 157] },
    { key: "angry", label: "Angry", color: [230, 57, 70] },
    { key: "surprise", label: "Surprise", color: [255, 183, 3] },
  ];
  const series = seriesDefs
    .map((s) => ({ ...s, vals: rows.map((r) => serialFacePctValue(r, s.key)) }))
    .filter((s) => s.vals.some((v) => v != null));
  if (!series.length) return;

  const plotH = 28;
  const axisW = 10;
  const totalNeed = 5 + plotH + 12;
  if (!ensureSpace(doc, yRef, totalNeed, pageHeight, margin, maxWidth)) return;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 94, 89);
  doc.text("Face subsystem trend (%)", margin, yRef.y);
  yRef.y += 5;

  const plotY = yRef.y;
  const plotX = margin + axisW;
  const plotW = maxWidth - axisW - 4;
  doc.setDrawColor(167, 243, 208);
  doc.setFillColor(255, 255, 255);
  doc.rect(plotX, plotY, plotW, plotH, "FD");

  const n = rows.length;
  const xAt = (i) => (n <= 1 ? plotX + plotW / 2 : plotX + (i / Math.max(1, n - 1)) * plotW);
  const yAt = (v) => plotY + plotH - 2 - (Math.max(0, Math.min(100, v)) / 100) * (plotH - 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  doc.text("100%", margin + 1, yAt(100) + 1);
  doc.text("50%", margin + 1, yAt(50) + 1);
  doc.text("0%", margin + 1, yAt(0) + 1);

  series.forEach((s) => {
    const [R, G, B] = s.color;
    doc.setDrawColor(R, G, B);
    doc.setLineWidth(0.45);
    for (let i = 0; i < n - 1; i++) {
      const a = s.vals[i];
      const b = s.vals[i + 1];
      if (a == null || b == null) continue;
      doc.line(xAt(i), yAt(a), xAt(i + 1), yAt(b));
    }
    for (let i = 0; i < n; i++) {
      const v = s.vals[i];
      if (v == null) continue;
      doc.setFillColor(R, G, B);
      doc.circle(xAt(i), yAt(v), 0.7, "F");
    }
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.6);
  doc.setTextColor(90, 100, 110);
  const tickStep = n <= 6 ? 1 : Math.ceil(n / 6);
  for (let i = 0; i < n; i += tickStep) {
    doc.text(`V${rows[i].visit_number ?? i + 1}`, xAt(i), plotY + plotH + 3.2, { align: "center" });
  }
  if ((n - 1) % tickStep !== 0 && n > 1) {
    doc.text(`V${rows[n - 1].visit_number ?? n}`, xAt(n - 1), plotY + plotH + 3.2, { align: "center" });
  }
  let lx = margin;
  let ly = plotY + plotH + 8;
  series.forEach((s) => {
    const [R, G, B] = s.color;
    if (lx + 26 > margin + maxWidth) {
      lx = margin;
      ly += 3.6;
    }
    doc.setFillColor(R, G, B);
    doc.circle(lx + 1.2, ly - 1, 0.75, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.2);
    doc.setTextColor(71, 85, 105);
    doc.text(s.label, lx + 3.1, ly);
    lx += 3.1 + doc.getTextWidth(s.label) + 6;
  });
  yRef.y = ly + 3;
}

/** Serial trend line chart for audio sentiment + distress across visits */
function drawSerialAudioTrend(doc, margin, yRef, maxWidth, serialVisits, pageHeight) {
  const rows = (serialVisits || []).slice(0, 12);
  const points = rows.map((r) => {
    const sent = Number(r?.sentiment_score ?? r?.sentiment_analysis?.sentiment_score);
    return {
      visit: r,
      sentiment: Number.isFinite(sent) ? sent : null,
      distress: serialDistressLevel(r),
    };
  });
  if (!points.some((p) => p.sentiment != null || p.distress != null)) return;

  const plotH = 28;
  const axisW = 14;
  const totalNeed = 5 + plotH + 12;
  if (!ensureSpace(doc, yRef, totalNeed, pageHeight, margin, maxWidth)) return;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 94, 89);
  doc.text("Audio subsystem trend", margin, yRef.y);
  yRef.y += 5;

  const plotY = yRef.y;
  const plotX = margin + axisW;
  const plotW = maxWidth - axisW - 4;
  doc.setDrawColor(167, 243, 208);
  doc.setFillColor(255, 255, 255);
  doc.rect(plotX, plotY, plotW, plotH, "FD");

  const n = points.length;
  const xAt = (i) => (n <= 1 ? plotX + plotW / 2 : plotX + (i / Math.max(1, n - 1)) * plotW);
  const sentVals = points.map((p) => p.sentiment).filter((v) => v != null);
  const minSent = sentVals.length ? Math.min(...sentVals) : -1;
  const maxSent = sentVals.length ? Math.max(...sentVals, minSent + 0.01) : 1;
  const midSent = (minSent + maxSent) / 2;
  const ySent = (v) => plotY + plotH - ((v - minSent) / (maxSent - minSent)) * (plotH - 4) - 2;
  const yDist = (v) => plotY + plotH - ((v - 1) / 2) * (plotH - 4) - 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.2);
  doc.setTextColor(37, 99, 235);
  doc.text(fmtMax2(maxSent), margin, ySent(maxSent) + 1);
  doc.text(fmtMax2(midSent), margin, ySent(midSent) + 1);
  doc.text(fmtMax2(minSent), margin, ySent(minSent) + 1);
  doc.setTextColor(147, 51, 234);
  doc.text("3", plotX + plotW + 1.2, yDist(3) + 1);
  doc.text("2", plotX + plotW + 1.2, yDist(2) + 1);
  doc.text("1", plotX + plotW + 1.2, yDist(1) + 1);

  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.5);
  for (let i = 0; i < n - 1; i++) {
    const a = points[i].sentiment;
    const b = points[i + 1].sentiment;
    if (a == null || b == null) continue;
    doc.line(xAt(i), ySent(a), xAt(i + 1), ySent(b));
  }
  for (let i = 0; i < n; i++) {
    const v = points[i].sentiment;
    if (v == null) continue;
    doc.setFillColor(37, 99, 235);
    doc.circle(xAt(i), ySent(v), 0.75, "F");
  }

  doc.setDrawColor(147, 51, 234);
  doc.setLineWidth(0.35);
  for (let i = 0; i < n - 1; i++) {
    const a = points[i].distress;
    const b = points[i + 1].distress;
    if (a == null || b == null) continue;
    doc.line(xAt(i), yDist(a), xAt(i + 1), yDist(b));
  }
  for (let i = 0; i < n; i++) {
    const v = points[i].distress;
    if (v == null) continue;
    doc.setFillColor(147, 51, 234);
    doc.circle(xAt(i), yDist(v), 0.65, "F");
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.6);
  doc.setTextColor(90, 100, 110);
  const tickStep = n <= 6 ? 1 : Math.ceil(n / 6);
  for (let i = 0; i < n; i += tickStep) {
    doc.text(`V${points[i].visit.visit_number ?? i + 1}`, xAt(i), plotY + plotH + 3.2, { align: "center" });
  }
  if ((n - 1) % tickStep !== 0 && n > 1) {
    doc.text(`V${points[n - 1].visit.visit_number ?? n}`, xAt(n - 1), plotY + plotH + 3.2, { align: "center" });
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.2);
  doc.setTextColor(37, 99, 235);
  doc.text("Sentiment score", margin, plotY + plotH + 8);
  doc.setTextColor(147, 51, 234);
  doc.text("Distress (1–3)", margin + 24, plotY + plotH + 8);
  yRef.y = plotY + plotH + 11;
}

/** Serial trend line chart for diagnostic keyword count and keyword percentage */
function drawSerialKeywordTrend(doc, margin, yRef, maxWidth, serialVisits, pageHeight) {
  const rows = (serialVisits || []).slice(0, 12);
  const points = rows.map((r) => ({
    visit: r,
    count: serialKeywordCount(r),
    pct: serialKeywordPct(r),
  }));
  if (!points.some((p) => p.count != null || p.pct != null)) return;

  const plotH = 28;
  const axisW = 14;
  const totalNeed = 5 + plotH + 12;
  if (!ensureSpace(doc, yRef, totalNeed, pageHeight, margin, maxWidth)) return;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 94, 89);
  doc.text("Diagnostic keyword trend", margin, yRef.y);
  yRef.y += 5;

  const plotY = yRef.y;
  const plotX = margin + axisW;
  const plotW = maxWidth - axisW - 4;
  doc.setDrawColor(167, 243, 208);
  doc.setFillColor(255, 255, 255);
  doc.rect(plotX, plotY, plotW, plotH, "FD");

  const n = points.length;
  const xAt = (i) => (n <= 1 ? plotX + plotW / 2 : plotX + (i / Math.max(1, n - 1)) * plotW);
  const counts = points.map((p) => p.count).filter((v) => v != null);
  const minC = counts.length ? Math.min(...counts) : 0;
  const maxC = counts.length ? Math.max(...counts, minC + 1) : 1;
  const midC = (minC + maxC) / 2;
  const yCount = (v) => plotY + plotH - ((v - minC) / (maxC - minC)) * (plotH - 4) - 2;
  const yPct = (v) => plotY + plotH - (Math.max(0, Math.min(100, v)) / 100) * (plotH - 4) - 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.2);
  doc.setTextColor(13, 148, 136);
  doc.text(fmtMax2(maxC), margin, yCount(maxC) + 1);
  doc.text(fmtMax2(midC), margin, yCount(midC) + 1);
  doc.text(fmtMax2(minC), margin, yCount(minC) + 1);
  doc.setTextColor(124, 58, 237);
  doc.text("100%", plotX + plotW + 1.2, yPct(100) + 1);
  doc.text("50%", plotX + plotW + 1.2, yPct(50) + 1);
  doc.text("0%", plotX + plotW + 1.2, yPct(0) + 1);

  doc.setDrawColor(13, 148, 136);
  doc.setLineWidth(0.5);
  for (let i = 0; i < n - 1; i++) {
    const a = points[i].count;
    const b = points[i + 1].count;
    if (a == null || b == null) continue;
    doc.line(xAt(i), yCount(a), xAt(i + 1), yCount(b));
  }
  for (let i = 0; i < n; i++) {
    const v = points[i].count;
    if (v == null) continue;
    doc.setFillColor(13, 148, 136);
    doc.circle(xAt(i), yCount(v), 0.75, "F");
  }

  doc.setDrawColor(124, 58, 237);
  doc.setLineWidth(0.35);
  for (let i = 0; i < n - 1; i++) {
    const a = points[i].pct;
    const b = points[i + 1].pct;
    if (a == null || b == null) continue;
    doc.line(xAt(i), yPct(a), xAt(i + 1), yPct(b));
  }
  for (let i = 0; i < n; i++) {
    const v = points[i].pct;
    if (v == null) continue;
    doc.setFillColor(124, 58, 237);
    doc.circle(xAt(i), yPct(v), 0.65, "F");
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.6);
  doc.setTextColor(90, 100, 110);
  const tickStep = n <= 6 ? 1 : Math.ceil(n / 6);
  for (let i = 0; i < n; i += tickStep) {
    doc.text(`V${points[i].visit.visit_number ?? i + 1}`, xAt(i), plotY + plotH + 3.2, { align: "center" });
  }
  if ((n - 1) % tickStep !== 0 && n > 1) {
    doc.text(`V${points[n - 1].visit.visit_number ?? n}`, xAt(n - 1), plotY + plotH + 3.2, { align: "center" });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.2);
  doc.setTextColor(13, 148, 136);
  doc.text("Keyword count", margin, plotY + plotH + 8);
  doc.setTextColor(124, 58, 237);
  doc.text("Keyword ratio", margin + 30, plotY + plotH + 8);
  yRef.y = plotY + plotH + 14;
  doc.setTextColor(0, 0, 0);
}


function addWrapped(doc, yRef, text, size, bold, margin, maxWidth, pageHeight, indent = 0) {
  const line = bold ? 4.4 : 4.2;
  const lines = doc.splitTextToSize(String(text), maxWidth - indent);
  const blockH = lines.length * line + 1;
  if (!ensureSpace(doc, yRef, blockH, pageHeight, margin, maxWidth)) return false;
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.text(lines, margin + indent, yRef.y);
  yRef.y += lines.length * line;
  return true;
}

function bulletLines(doc, yRef, items, margin, maxWidth, pageHeight, maxItems) {
  (items || []).slice(0, maxItems).forEach((item) => {
    if (!addWrapped(doc, yRef, `• ${item}`, 8, false, margin, maxWidth, pageHeight, 2)) return;
  });
}

/** Visit-level sentiment summary from saved transcription / NLP. */
function drawTranscriptSentimentSummary(doc, margin, yRef, maxWidth, pageHeight, nlpVisit) {
  const sa = nlpVisit?.sentiment_analysis;
  if (!sa || (!sa.overall_sentiment && sa.sentiment_score == null && !sa.distress_level)) return false;

  const parts = [];
  if (sa.overall_sentiment) parts.push(`Overall: ${String(sa.overall_sentiment)}`);
  if (sa.sentiment_score != null) parts.push(`Score: ${fmtMax2(sa.sentiment_score)}`);
  if (sa.distress_level) parts.push(`Distress: ${String(sa.distress_level)}`);
  const valueLine = parts.join(" · ");

  if (!addWrapped(doc, yRef, valueLine, 9.5, true, margin, maxWidth, pageHeight)) return false;
  yRef.y += 1.5;
  doc.setTextColor(0, 0, 0);
  return true;
}

/**
 * @param {object} params
 * @param {object} [params.multimodalConfidence] co, cf, ca, cg (0–1)
 * @param {object} [params.recordCounts] face, audio, gait lengths
 * @param {object} [params.nlpVisit] visit-shaped object for transcription / NLP snippet
 */
export function generateCombinedReportPDF({
  patient,
  visit,
  visitMeta,
  vitals,
  faceDerived,
  audioDerived,
  gaitDerived,
  aiAssessment,
  serialVisits = [],
  multimodalConfidence = null,
  recordCounts = null,
  nlpVisit = null,
}) {
  const doc = new jsPDF();
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  const yRef = { y: margin };

  const addText = (text, size = 9, bold = false, indent = 0) =>
    addWrapped(doc, yRef, text, size, bold, margin, maxWidth, pageHeight, indent);

  const section = (title) => sectionBar(doc, margin, 0, maxWidth, title, yRef, pageHeight);

  // --- Title (matches Report Summary header) ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(17, 94, 89);
  doc.text("Doctor AI: Smart Examination Room", pageWidth / 2, yRef.y, { align: "center" });
  yRef.y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(17, 94, 89);
  doc.text("Report summary", pageWidth / 2, yRef.y, { align: "center" });
  yRef.y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(45, 110, 101);
  yRef.y += 2;
  doc.setTextColor(0, 0, 0);

  section("Visit info");
  drawVisitInfoLine(doc, margin, yRef, maxWidth, visitMeta, patient, visit, pageHeight);

  section("Vital signs");
  drawVitalsGrid(doc, margin, yRef, maxWidth, vitals, visit, pageHeight);

  section("Multimodal analysis");
  drawConfidenceStrip(doc, margin, yRef, maxWidth, multimodalConfidence, recordCounts, pageHeight);

  // Face — section + graphic + short text
  section("Facial expression analysis");
  if (faceDerived?.sorted?.length) {
    drawEmotionBars(doc, margin, yRef, maxWidth, faceDerived.sorted, pageHeight);
    drawEmotionFrequencyOverTime(doc, margin, yRef, maxWidth, faceDerived, pageHeight);
  } else {
    addText("No facial expression summary available for this visit.", 9);
  }

  // Audio (per-window) + visit-level transcription / NLP — single section
  section("Audio & transcription / NLP");
  yRef.y += PDF_GAP_UNDER_AUDIO_SECTION;
  const drewSentiment = drawTranscriptSentimentSummary(doc, margin, yRef, maxWidth, pageHeight, nlpVisit);
  if (!drewSentiment) {
    addText("No visit-level sentiment summary saved for this visit (transcription / NLP).", 8);
  }
  if (audioDerived) {
    drawSentimentMiniChart(doc, margin, yRef, maxWidth, audioDerived, pageHeight);
    if (audioDerived.kwSorted?.length) {
      addText("Top keywords (all windows)", 8, true);
      bulletLines(
        doc,
        yRef,
        audioDerived.kwSorted.slice(0, 8).map(([w, c]) => `${w}: ${c}`),
        margin,
        maxWidth,
        pageHeight,
        8
      );
    }
    if (audioDerived.topicRows?.length) {
      addText("Topic distribution", 8, true);
      bulletLines(
        doc,
        yRef,
        audioDerived.topicRows.slice(0, 5).map((r) => `${String(r.topic).replace(/_/g, " ")}: ${(r.avg * 100).toFixed(0)}%`),
        margin,
        maxWidth,
        pageHeight,
        5
      );
    }
  } else {
    addText("No per-window audio / language summary available.", 9);
  }

  // Gait
  section("Gait & motion analysis");
  if (gaitDerived) {
    addText(
      `Avg speed ${gaitDerived.avgSpeed != null ? gaitDerived.avgSpeed.toFixed(2) : "—"} m/s · ` +
        `Symmetry ${gaitDerived.avgSym != null ? `${(gaitDerived.avgSym * 100).toFixed(0)}%` : "—"} · ` +
        `Stability ${gaitDerived.avgStab != null ? `${(gaitDerived.avgStab * 100).toFixed(0)}%` : "—"}`,
      8.5,
      true
    );
    if (gaitDerived.gaitNotes) addText(String(gaitDerived.gaitNotes), 8);
    drawGaitSparkline(doc, margin, yRef, maxWidth, gaitDerived, pageHeight);
    if (gaitDerived.events?.length) {
      addText("Events detected", 8, true);
      const eventsLine = gaitDerived.events
        .slice(0, 8)
        .map((e) => {
          const t = e.t != null ? `${e.t}s` : "—";
          const conf = e.confidence != null ? `${(e.confidence * 100).toFixed(0)}%` : "—";
          return `${t}: ${e.features?.event ?? "unknown"} (${conf})`;
        })
        .join(" · ");
      addText(eventsLine, 7.8);
    }
  } else {
    addText("No gait summary available.", 9);
  }

  // AI — mirror subsection labels from UI
  section("AI diagnostic assessment");
  if (aiAssessment) {
    if (aiAssessment.consensus_note) addText(truncate(aiAssessment.consensus_note, 360), 9, true);
    if (aiAssessment.suggested_diagnoses?.length) {
      addText("Differential diagnosis", 8.5, true);
      bulletLines(doc, yRef, aiAssessment.suggested_diagnoses, margin, maxWidth, pageHeight, 5);
    }
    if (aiAssessment.recommended_tests?.length) {
      addText("Recommended workup", 8.5, true);
      bulletLines(doc, yRef, aiAssessment.recommended_tests, margin, maxWidth, pageHeight, 4);
    }
    if (aiAssessment.treatment_suggestions?.length) {
      addText("Treatment plan", 8.5, true);
      bulletLines(doc, yRef, aiAssessment.treatment_suggestions, margin, maxWidth, pageHeight, 3);
    }
    if (aiAssessment.patient_education?.length) {
      addText("Patient education", 8.5, true);
      bulletLines(doc, yRef, aiAssessment.patient_education, margin, maxWidth, pageHeight, 3);
    }
    if (aiAssessment.follow_up_recommendations) {
      addText("Follow-up", 8.5, true);
      addText(truncate(aiAssessment.follow_up_recommendations, 400), 8);
    }
  } else {
    addText("No AI diagnostic assessment available.", 9);
  }

  section("Serial trend analysis");
  if (serialVisits.length) {
    drawSerialFaceTrend(doc, margin, yRef, maxWidth, serialVisits, pageHeight);
    drawSerialAudioTrend(doc, margin, yRef, maxWidth, serialVisits, pageHeight);
    drawSerialKeywordTrend(doc, margin, yRef, maxWidth, serialVisits, pageHeight);
    drawSerialGaitTrend(doc, margin, yRef, maxWidth, serialVisits, pageHeight);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    addText("AI summary by visit", 8.5, true);
    serialVisits.slice(0, 6).forEach((s) => {
      const line = `Visit #${s.visit_number} (${toDateLabel(s.visit_date)})`;
      if (!addText(line, 8.2, true)) return;
      if (s.ai_assessment?.suggested_diagnoses?.length) {
        bulletLines(
          doc,
          yRef,
          s.ai_assessment.suggested_diagnoses.slice(0, 2).map((d) => `AI: ${d}`),
          margin,
          maxWidth,
          pageHeight,
          2
        );
      }
    });
    if (serialVisits.length > 6) addText(`(+ ${serialVisits.length - 6} more visits in app)`, 7.5);
  } else {
    addText("No serial trend rows included in this export.", 8);
  }

  drawFooterOnAllPages(doc, pageWidth, pageHeight);

  const lastName = patient?.last_name || "Patient";
  const firstName = patient?.first_name || "";
  const datePart = toDateLabel(vitals?.visit_date || visit?.visit_date).replace(/,/g, "").replace(/\s+/g, "-");
  doc.save(`Report_summary_${lastName}_${firstName}_${datePart}.pdf`);
}
