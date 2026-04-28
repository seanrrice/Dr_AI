import jsPDF from "jspdf";
import { format } from "date-fns";

const MAX_PAGES = 3;

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

/** Single window e.g. "0–10s" or "5s" for PDF axis */
function windowRangeShort(w) {
  if (!w) return "";
  const a = w.t_start;
  const b = w.t_end;
  if (a != null && b != null && Number(b) !== Number(a)) return `${a}–${b}s`;
  if (a != null) return `${a}s`;
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
    return `Elapsed time: ${start}s–${end}s · ${windowsSlice.length} windows`;
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
  if (!ensureSpace(doc, yRef, 14, pageHeight, margin, maxWidth)) return;
  yRef.y += 2;
  setTealHeaderFill(doc);
  doc.rect(margin, yRef.y - 3, maxWidth, 9, "F");
  doc.setDrawColor(167, 243, 208);
  doc.rect(margin, yRef.y - 3, maxWidth, 9, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(17, 94, 89);
  doc.text(title, margin + 3, yRef.y + 3);
  doc.setTextColor(0, 0, 0);
  yRef.y += 10;
}

function drawVisitInfoTwoCol(doc, margin, yRef, maxWidth, visitMeta, patient, pageHeight) {
  const boxH = 24;
  if (!ensureSpace(doc, yRef, boxH + 4, pageHeight, margin, maxWidth)) return;
  doc.setDrawColor(153, 246, 228);
  doc.setFillColor(248, 253, 252);
  doc.roundedRect(margin, yRef.y, maxWidth, boxH, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const colW = maxWidth / 2 - 6;
  const leftX = margin + 4;
  const rightX = margin + maxWidth / 2 + 2;
  let ty = yRef.y + 5;
  const row = (label, val, x) => {
    doc.setTextColor(13, 148, 136);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.text(String(label).toUpperCase(), x, ty);
    ty += 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(17, 94, 89);
    doc.text(truncate(val || "—", 42), x, ty);
    ty += 5.2;
  };
  row("Visit ID", visitMeta?.visitId, leftX);
  ty = yRef.y + 5;
  row("MRN", patient?.medical_record_number || visitMeta?.patientId, rightX);
  ty = yRef.y + 15.2;
  const name = patient ? `${patient.first_name || ""} ${patient.last_name || ""}`.trim() : "Unknown Patient";
  row("Patient name", name || "—", leftX);
  doc.setTextColor(0, 0, 0);
  yRef.y += boxH + 3;
}

function drawVitalsGrid(doc, margin, yRef, maxWidth, vitals, visit, pageHeight) {
  const v = vitals || {};
  const textWidth = maxWidth - 8;
  const items = [
    ["Visit date", toDateLabel(v.visit_date || visit?.visit_date)],
    ["Chief complaint", truncate(v.chief_complaint || visit?.chief_complaint || "—", 120)],
    [
      "Vitals",
      `BP ${v.bp_systolic ?? "—"}/${v.bp_diastolic ?? "—"} · HR ${v.heart_rate ?? "—"} · RR ${v.respiratory_rate ?? "—"} · ` +
        `Temp ${v.temperature ?? "—"}${v.temperature_unit === "celsius" ? "°C" : "°F"} · SpO₂ ${v.spo2 ?? "—"}% · BMI ${v.bmi ?? "—"}`,
    ],
  ];

  /** Match the draw loop: top inset, header, then per-item label + wrapped value + gap */
  const lineLead = 3.6;
  let simY = 5 + 5;
  items.forEach(([, val]) => {
    simY += 3.2;
    simY += doc.splitTextToSize(val, textWidth).length * lineLead + 1.4;
  });
  const h = simY + 3;

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
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  items.forEach(([lab, val]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(`${lab}:`, margin + 4, ly);
    ly += 3.2;
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(val, textWidth);
    doc.text(lines, margin + 4, ly);
    ly += lines.length * lineLead + 1.4;
  });
  yRef.y += h + 1.5;
}

function pctStr(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function drawConfidenceStrip(doc, margin, yRef, maxWidth, multimodal, recordCounts, pageHeight) {
  const rowH = 18;
  if (!ensureSpace(doc, yRef, rowH + 4, pageHeight, margin, maxWidth)) return;
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
  yRef.y += rowH + 4;
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

    doc.setFont("helvetica", "normal");
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
  const labels = windows.map((w) => `${w.t_start}s–${w.t_end}s`);
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
  const coverageSubtitle = chartElapsedCoverageSubtitle(ws);
  const coverageLines = coverageSubtitle
    ? doc.splitTextToSize(coverageSubtitle, maxWidth)
    : [];
  const belowPlotReserve = 14;
  const headerReserve = 5 + coverageLines.length * lineH + 1;
  const summaryReserve = 2 * lineH + 4;
  const totalNeed = headerReserve + chartH + belowPlotReserve + summaryReserve;
  if (!ensureSpace(doc, yRef, totalNeed, pageHeight, margin, maxWidth)) return;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 94, 89);
  doc.text("Sentiment polarity over time", margin, yRef.y);
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
    doc.setFontSize(4.8);
    doc.setTextColor(4, 120, 87);
    const only = pts[0];
    const x = plotX + plotW / 2;
    doc.text(`${Number(only.s).toFixed(2)}`, x, y - 2, { align: "center" });
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
      doc.setFont("helvetica", "normal");
      doc.setFontSize(4.8);
      doc.setTextColor(71, 85, 105);
      doc.text(String(Number(p.s).toFixed(2)), x, y - 2.2, { align: "center" });
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

function buildNlpSnippet(nlpVisit) {
  if (!nlpVisit) return null;
  const chunks = [];
  const sa = nlpVisit.sentiment_analysis;
  if (sa?.overall_sentiment || sa?.sentiment_score != null) {
    const parts = [];
    if (sa.overall_sentiment) parts.push(String(sa.overall_sentiment));
    if (sa.sentiment_score != null) parts.push(`score ${sa.sentiment_score}`);
    if (sa.distress_level) parts.push(`distress ${sa.distress_level}`);
    chunks.push(`Sentiment: ${parts.join(" · ")}`);
  }
  const ka = nlpVisit.keyword_analysis;
  if (ka?.top_keywords?.length) {
    const top = ka.top_keywords
      .slice(0, 6)
      .map((kw) => `${kw.word} (${kw.count}${kw.category ? `, ${kw.category}` : ""})`);
    chunks.push(`Top keywords: ${top.join(", ")}`);
  } else if (ka?.diagnostic_keywords && typeof ka.diagnostic_keywords === "object") {
    const top = Object.entries(ka.diagnostic_keywords)
      .map(([w, d]) => ({ w, c: typeof d === "object" ? d.count : d }))
      .sort((a, b) => b.c - a.c)
      .slice(0, 6)
      .map(({ w, c }) => `${w} (${c})`);
    if (top.length) chunks.push(`Diagnostic keywords: ${top.join(", ")}`);
  }
  return chunks.length ? chunks.join("\n\n") : null;
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
  doc.setFontSize(17);
  doc.setTextColor(17, 94, 89);
  doc.text("Report summary", pageWidth / 2, yRef.y, { align: "center" });
  yRef.y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(45, 110, 101);
  doc.text("Visit review · multimodal, transcription & AI", pageWidth / 2, yRef.y, { align: "center" });
  yRef.y += 6;
  doc.setTextColor(80, 90, 88);
  doc.setFontSize(8);
  doc.text(`Generated ${format(new Date(), "MMM d, yyyy h:mm a")}`, pageWidth / 2, yRef.y, { align: "center" });
  yRef.y += 8;
  doc.setTextColor(0, 0, 0);

  section("Visit info");
  drawVisitInfoTwoCol(doc, margin, yRef, maxWidth, visitMeta, patient, pageHeight);

  section("Vital signs");
  drawVitalsGrid(doc, margin, yRef, maxWidth, vitals, visit, pageHeight);

  section("Multimodal analysis");
  drawConfidenceStrip(doc, margin, yRef, maxWidth, multimodalConfidence, recordCounts, pageHeight);

  // Face — section + graphic + short text
  section("Facial expression analysis");
  if (faceDerived?.sorted?.length) {
    drawEmotionBars(doc, margin, yRef, maxWidth, faceDerived.sorted, pageHeight);
    drawEmotionFrequencyOverTime(doc, margin, yRef, maxWidth, faceDerived, pageHeight);
    addText(`Data quality: ${faceDerived.anyInvalid ? "Issues flagged in pipeline" : "Valid"}`, 8, false);
  } else {
    addText("No facial expression summary available for this visit.", 9);
  }

  // Audio
  section("Audio & language analysis");
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
    addText(`Data quality: ${audioDerived.anyInvalid ? "Issues flagged" : "Valid"}`, 8);
  } else {
    addText("No audio / language summary available.", 9);
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
    addText(`Data quality: ${gaitDerived.anyInvalid ? "Issues flagged" : "Valid"}`, 8);
  } else {
    addText("No gait summary available.", 9);
  }

  // NLP
  section("Transcription & NLP");
  const nlp = buildNlpSnippet(nlpVisit);
  if (nlp) addText(nlp, 8);
  else addText("No saved transcription or NLP fields for this visit.", 8);

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
    serialVisits.slice(0, 6).forEach((s) => {
      const line =
        `Visit #${s.visit_number} (${toDateLabel(s.visit_date)}) — ` +
        `BP ${s.bp_systolic}/${s.bp_diastolic}, HR ${s.heart_rate}, ` +
        `sentiment ${s.sentiment_score != null ? s.sentiment_score.toFixed(2) : "—"}, ` +
        `face (N/H/Sa/A/Su) ${formatSerialFaceEmotionPcts(s)}, ` +
        `gait ${s.gait_avg_speed_mps != null ? `${s.gait_avg_speed_mps.toFixed(2)} m/s` : "—"}`;
      if (!addText(line, 8)) return;
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
