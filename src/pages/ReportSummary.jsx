import React, { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { api } from "@/api/apiClient";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Legend,
  Tooltip,
  Filler,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { ArrowLeft, FileBarChart, Activity, TrendingUp, Brain, Download, MessageSquareText } from "lucide-react";
import { createPageUrl, cn } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { generateCombinedReportPDF } from "@/utils/combinedReportPdf";
import {
  DEMO_REPORT_VISIT_ID,
  getReportDemoPackage,
} from "@/data/reportSummaryDemoData";
import { buildMichaelSerialStorageVisits } from "@/data/michaelSerialVisitStorageSeeds";
import VisitTranscriptionNlpPanel from "@/components/VisitTranscriptionNlpPanel";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Legend,
  Tooltip,
  Filler
);

/** Five-class face model: Happy, Angry, Neutral, Sad, Surprise (keys lowercase). */
const EMO_COLORS = {
  happy: "#f4a261",
  angry: "#e63946",
  neutral: "#94a3b8",
  sad: "#457b9d",
  surprise: "#ffb703",
};

const EMOTION_CLASS_ORDER = ["happy", "angry", "neutral", "sad", "surprise"];

function emoColor(key) {
  return EMO_COLORS[key] || "#94a3b8";
}

function pct(v) {
  return `${(v * 100).toFixed(0)}%`;
}

function fmtConf(v) {
  return v != null ? `${(v * 100).toFixed(0)}%` : "—";
}

function avgConf(recs) {
  const v = recs.filter((r) => r.confidence != null && r.valid !== false);
  return v.length ? v.reduce((a, r) => a + r.confidence, 0) / v.length : null;
}

function labelEmo(key) {
  const s = String(key).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function qualLabel(v, low, mid) {
  if (v == null) return "—";
  if (v >= mid) return "Good";
  if (v >= low) return "Fair";
  return "Low";
}

const chartBox = "relative h-[180px] w-full";
const chartBoxTall = "relative h-[220px] w-full";
const MAX_GAIT_CHART_POINTS = 25;

function summarizeGaitWindows(windows, maxPoints = MAX_GAIT_CHART_POINTS) {
  if (!Array.isArray(windows) || windows.length <= maxPoints) return windows || [];

  const bucketSize = windows.length / maxPoints;
  const summarized = [];

  for (let i = 0; i < maxPoints; i += 1) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(windows.length, Math.floor((i + 1) * bucketSize));
    const bucket = windows.slice(start, end);
    if (!bucket.length) continue;

    const mean = (vals) => {
      const nums = vals.filter((v) => v != null);
      if (!nums.length) return null;
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    };

    summarized.push({
      t_start: mean(bucket.map((w) => w.t_start)),
      t_end: mean(bucket.map((w) => w.t_end)),
      features: {
        speed_mps: mean(bucket.map((w) => w.features?.speed_mps)),
        symmetry: mean(bucket.map((w) => w.features?.symmetry)),
        stability: mean(bucket.map((w) => w.features?.stability)),
      },
    });
  }

  return summarized;
}

function smoothSeries(values, radius = 1) {
  if (!Array.isArray(values) || values.length === 0 || radius <= 0) return values || [];
  return values.map((_, idx) => {
    const start = Math.max(0, idx - radius);
    const end = Math.min(values.length, idx + radius + 1);
    const slice = values.slice(start, end).filter((v) => v != null);
    if (!slice.length) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function AiDiagnosticAssessmentPanel({ assessment }) {
  const dx = assessment?.suggested_diagnoses;
  const tests = assessment?.recommended_tests;
  const treatments = assessment?.treatment_suggestions;
  const education = assessment?.patient_education;
  const followUp = assessment?.follow_up_recommendations;
  const note = assessment?.consensus_note;

  const hasContent =
    (dx && dx.length > 0) ||
    (tests && tests.length > 0) ||
    (treatments && treatments.length > 0) ||
    (education && education.length > 0) ||
    (followUp && String(followUp).trim());

  if (!hasContent) {
    return (
      <p className="text-sm text-teal-700 py-6">
        No AI diagnostic assessment is available for this visit yet. Run analysis on a new visit or use demo data.
      </p>
    );
  }

  return (
    <Card className="border-teal-200 bg-white/80 backdrop-blur shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-teal-900">
          <Brain className="w-5 h-5 text-teal-700" />
          AI Diagnostic Assessment
        </CardTitle>
        {note ? <p className="text-xs text-teal-600 mt-1 font-normal">{note}</p> : null}
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {dx && dx.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-blue-200">
                <div className="w-2 h-2 rounded-full bg-blue-600" />
                <h4 className="font-semibold text-base text-teal-900">Differential Diagnosis</h4>
              </div>
              <div className="space-y-2 pl-4">
                {dx.map((diagnosis, idx) => (
                  <div key={idx} className="text-teal-900 py-1">
                    {diagnosis}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tests && tests.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-emerald-200">
                <div className="w-2 h-2 rounded-full bg-emerald-600" />
                <h4 className="font-semibold text-base text-teal-900">Recommended Workup</h4>
              </div>
              <div className="space-y-2 pl-4">
                {tests.map((test, idx) => (
                  <div key={idx} className="text-teal-900 py-1">
                    {test}
                  </div>
                ))}
              </div>
            </div>
          )}

          {treatments && treatments.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-violet-200">
                <div className="w-2 h-2 rounded-full bg-violet-600" />
                <h4 className="font-semibold text-base text-teal-900">Treatment Plan</h4>
              </div>
              <div className="space-y-2 pl-4">
                {treatments.map((treatment, idx) => (
                  <div key={idx} className="text-teal-900 py-1">
                    {treatment}
                  </div>
                ))}
              </div>
            </div>
          )}

          {education && education.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-teal-300">
                <div className="w-2 h-2 rounded-full bg-teal-600" />
                <h4 className="font-semibold text-base text-teal-900">Patient Education</h4>
              </div>
              <div className="space-y-2 pl-4">
                {education.map((item, idx) => (
                  <div key={idx} className="text-teal-900 py-1">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {followUp && String(followUp).trim() && (
            <div>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-amber-200">
                <div className="w-2 h-2 rounded-full bg-amber-600" />
                <h4 className="font-semibold text-base text-teal-900">Follow-up</h4>
              </div>
              <div className="pl-4">
                <p className="text-teal-900 leading-relaxed">{followUp}</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportSummary() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const visitIdParam = searchParams.get("visitId") || DEMO_REPORT_VISIT_ID;
  const reportSource = searchParams.get("source") || "";
  const isPreviousReportVisual = reportSource === "previous-report-visual";

  const { data: loadedVisit } = useQuery({
    queryKey: ["visit", visitIdParam],
    queryFn: async () => {
      const rows = await api.entities.Visit.filter({ id: visitIdParam });
      return rows[0];
    },
    enabled: !!visitIdParam && !isPreviousReportVisual,
  });

  const reportPkg = useMemo(() => getReportDemoPackage(visitIdParam), [visitIdParam]);
  const michaelSerialSeededVisits = useMemo(() => buildMichaelSerialStorageVisits(), []);
  const seededVisit = useMemo(
    () => michaelSerialSeededVisits.find((v) => v.id === visitIdParam),
    [michaelSerialSeededVisits, visitIdParam]
  );
  const face = isPreviousReportVisual
    ? reportPkg.face
    : (loadedVisit?.multimodal_jsonl?.face || []);
  const audio = isPreviousReportVisual
    ? reportPkg.audio
    : (loadedVisit?.multimodal_jsonl?.audio || []);
  const gait = isPreviousReportVisual
    ? reportPkg.gait
    : (loadedVisit?.multimodal_jsonl?.gait || []);
  const [showFaceRaw, setShowFaceRaw] = useState(false);
  const [showAudioRaw, setShowAudioRaw] = useState(false);
  const [showGaitRaw, setShowGaitRaw] = useState(false);
  const [reportTab, setReportTab] = useState("multimodal");
  const [keywordView, setKeywordView] = useState("diagnostic");

  const patientIdForTrends = isPreviousReportVisual
    ? (loadedVisit?.patient_id ?? seededVisit?.patient_id ?? reportPkg.face?.[0]?.patient_id ?? "")
    : (loadedVisit?.patient_id ?? "");

  const { data: patient } = useQuery({
    queryKey: ["patient", patientIdForTrends],
    queryFn: async () => {
      const rows = await api.entities.Patient.filter({ id: patientIdForTrends });
      return rows[0];
    },
    enabled: !!patientIdForTrends && !isPreviousReportVisual,
  });

  const { data: patientVisits = [] } = useQuery({
    queryKey: ["patient-visits-for-pdf", patientIdForTrends],
    queryFn: async () => {
      if (!patientIdForTrends) return [];
      const rows = await api.entities.Visit.filter({ patient_id: patientIdForTrends });
      return Array.isArray(rows) ? rows : [];
    },
    enabled: !!patientIdForTrends && !isPreviousReportVisual,
  });

  const serialVisitsForPdf = useMemo(() => {
    if (isPreviousReportVisual) return [];
    if (!Array.isArray(patientVisits) || patientVisits.length === 0) return [];

    const sortable = [...patientVisits];
    sortable.sort((a, b) => {
      const na = Number(a?.visit_number);
      const nb = Number(b?.visit_number);
      const aHasNum = Number.isFinite(na);
      const bHasNum = Number.isFinite(nb);
      if (aHasNum && bHasNum && na !== nb) return na - nb;
      const da = a?.visit_date ? new Date(a.visit_date).getTime() : 0;
      const db = b?.visit_date ? new Date(b.visit_date).getTime() : 0;
      return da - db;
    });
    return sortable;
  }, [isPreviousReportVisual, patientVisits]);

  const patientDisplayName = useMemo(() => {
    if (isPreviousReportVisual) {
      if (patientIdForTrends === "patient-demo-1") return "Michael Reyes";
      if (patientIdForTrends === "patient-demo-2") return "Sarah Martinez";
    }
    const visitPatientName =
      loadedVisit?.patient_name;
    if (!patient) return visitPatientName || "Unknown Patient";
    const fullName = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
    return fullName || visitPatientName || "Unknown Patient";
  }, [patient, patientIdForTrends, isPreviousReportVisual, loadedVisit]);

  const patientMrn = useMemo(() => {
    const mrn = patient?.medical_record_number;
    if (typeof mrn === "string" && mrn.trim()) return mrn.trim();
    if (mrn != null && String(mrn).trim()) return String(mrn).trim();
    return "—";
  }, [patient]);

  const aiAssessment = useMemo(() => {
    if (isPreviousReportVisual) {
      if (seededVisit?.ai_assessment && typeof seededVisit.ai_assessment === "object") return seededVisit.ai_assessment;
      return reportPkg.aiAssessment;
    }
    const a = loadedVisit?.ai_assessment;
    if (a && typeof a === "object") return a;
    return null;
  }, [isPreviousReportVisual, loadedVisit, seededVisit, reportPkg.aiAssessment]);

  const { nlpVisit, nlpUsingDemoFallback } = useMemo(() => {
    if (isPreviousReportVisual) {
      if (seededVisit) {
        return { nlpVisit: seededVisit, nlpUsingDemoFallback: false };
      }
      return { nlpVisit: reportPkg.transcriptionNlp, nlpUsingDemoFallback: false };
    }
    return { nlpVisit: loadedVisit || {}, nlpUsingDemoFallback: false };
  }, [isPreviousReportVisual, loadedVisit, seededVisit, reportPkg.transcriptionNlp]);

  const vitalsDisplay = useMemo(() => {
    if (isPreviousReportVisual) {
      const v = loadedVisit;
      if (v && (v.bp_systolic || v.heart_rate)) {
        return {
          visit_date: v.visit_date,
          chief_complaint: v.chief_complaint,
          bp_systolic: v.bp_systolic,
          bp_diastolic: v.bp_diastolic,
          heart_rate: v.heart_rate,
          respiratory_rate: v.respiratory_rate,
          temperature: v.temperature,
          temperature_unit: v.temperature_unit || "fahrenheit",
          spo2: v.spo2,
          height: v.height,
          weight: v.weight,
          bmi: v.bmi,
        };
      }
      if (seededVisit && (seededVisit.bp_systolic || seededVisit.heart_rate)) {
        return {
          visit_date: seededVisit.visit_date,
          chief_complaint: seededVisit.chief_complaint,
          bp_systolic: seededVisit.bp_systolic,
          bp_diastolic: seededVisit.bp_diastolic,
          heart_rate: seededVisit.heart_rate,
          respiratory_rate: seededVisit.respiratory_rate,
          temperature: seededVisit.temperature,
          temperature_unit: seededVisit.temperature_unit || "fahrenheit",
          spo2: seededVisit.spo2,
          height: seededVisit.height,
          weight: seededVisit.weight,
          bmi: seededVisit.bmi,
        };
      }
      return { ...reportPkg.visitSnapshot };
    }
    const v = loadedVisit;
    if (v && (v.bp_systolic || v.heart_rate)) {
      return {
        visit_date: v.visit_date,
        chief_complaint: v.chief_complaint,
        bp_systolic: v.bp_systolic,
        bp_diastolic: v.bp_diastolic,
        heart_rate: v.heart_rate,
        respiratory_rate: v.respiratory_rate,
        temperature: v.temperature,
        temperature_unit: v.temperature_unit || "fahrenheit",
        spo2: v.spo2,
        height: v.height,
        weight: v.weight,
        bmi: v.bmi,
      };
    }
    return {};
  }, [isPreviousReportVisual, loadedVisit, seededVisit, reportPkg.visitSnapshot]);
  const visitMeta = useMemo(() => {
    const allRecs = [...face, ...audio, ...gait];
    if (!allRecs.length) {
      if (loadedVisit) {
        return {
          visitId: visitIdParam,
          patientId: loadedVisit.patient_id ?? "—",
        };
      }
      return null;
    }
    const first = allRecs[0];
    return {
      visitId: visitIdParam,
      patientId: loadedVisit?.patient_id ?? (isPreviousReportVisual ? seededVisit?.patient_id : null) ?? first.patient_id ?? "—",
    };
  }, [face, audio, gait, visitIdParam, loadedVisit, seededVisit, isPreviousReportVisual]);

  const { cf, ca, cg, co } = useMemo(() => {
    const f = avgConf(face);
    const a = avgConf(audio);
    const g = avgConf(gait);
    const all = [f, a, g].filter((x) => x != null);
    const o = all.length ? all.reduce((x, y) => x + y, 0) / all.length : null;
    return { cf: f, ca: a, cg: g, co: o };
  }, [face, audio, gait]);
  const faceDerived = useMemo(() => {
    if (!face.length) return null;
    const summary = face.find((r) => r.type === "summary");
    const windows = face.filter((r) => r.type === "window");
    const anyInvalid = face.some((r) => r.valid === false);

    let emotionPct = {};
    if (summary?.features?.emotion_pct) {
      emotionPct = { ...summary.features.emotion_pct };
    } else if (windows.length) {
      const emotionCounts = {};
      windows.forEach((w) => {
        const ec = w.features?.emotion_counts || {};
        Object.entries(ec).forEach(([k, v]) => {
          emotionCounts[k] = (emotionCounts[k] || 0) + v;
        });
      });
      const total = Object.values(emotionCounts).reduce((a, v) => a + v, 0) || 1;
      Object.entries(emotionCounts).forEach(([k, v]) => {
        emotionPct[k] = +((v / total) * 100).toFixed(2);
      });
    }

    const sorted = Object.entries(emotionPct).sort((a, b) => b[1] - a[1]);
    const allEmos = [...new Set(windows.flatMap((w) => Object.keys(w.features?.emotion_counts || {})))].sort(
      (a, b) => {
        const ia = EMOTION_CLASS_ORDER.indexOf(a);
        const ib = EMOTION_CLASS_ORDER.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      }
    );
    const timelineLabels = windows.map((w) => `${w.t_start}s–${w.t_end}s`);
    const timelineDatasets = allEmos.map((emo) => ({
      label: labelEmo(emo),
      data: windows.map((w) => {
        const ec = w.features?.emotion_counts || {};
        const total = Object.values(ec).reduce((a, v) => a + v, 0) || 1;
        return +(((ec[emo] || 0) / total) * 100).toFixed(1);
      }),
      borderColor: emoColor(emo),
      backgroundColor: "transparent",
      tension: 0.25,
      pointRadius: 2,
      pointHoverRadius: 3,
      borderWidth: 2,
    }));

    return {
      anyInvalid,
      sorted,
      windows,
      doughnutData: {
        labels: sorted.map(([k]) => labelEmo(k)),
        datasets: [
          {
            data: sorted.map(([, v]) => v),
            backgroundColor: sorted.map(([k]) => emoColor(k)),
            borderWidth: 2,
            borderColor: "#f0fdfa",
          },
        ],
      },
      emotionTimeline:
        timelineDatasets.length > 0
          ? {
              labels: timelineLabels,
              datasets: timelineDatasets,
            }
          : null,
    };
  }, [face]);

  const audioDerived = useMemo(() => {
    if (!audio.length) return null;
    const windows = audio.filter((r) => r.type === "window");
    const summary = audio.find((r) => r.type === "summary");
    const anyInvalid = audio.some((r) => r.valid === false);
    const sentLabels = windows.map((w) => `${w.t_start}s`);
    const sentData = windows.map((w) => w.features?.sentiment?.polarity ?? 0);
    const pointColors = sentData.map((v) => (v >= 0 ? "#059669" : "#dc2626"));

    const kwMap = {};
    const diagSet = new Set();
    windows.forEach((w) => {
      (w.features?.top_words || []).forEach(([word, count]) => {
        kwMap[word] = (kwMap[word] || 0) + count;
      });
      (w.features?.diagnostic_terms?.matches || []).forEach(([word]) => diagSet.add(word));
    });

    const topicMap = {};
    windows.forEach((w) => {
      (w.features?.topics || []).forEach(([topic, score]) => {
        if (!topicMap[topic]) topicMap[topic] = [];
        topicMap[topic].push(score);
      });
    });
    if (!Object.keys(topicMap).length && summary?.features?.topics) {
      summary.features.topics.forEach(([t, s]) => {
        topicMap[t] = [s];
      });
    }
    const topicRows = Object.entries(topicMap)
      .map(([topic, scores]) => ({
        topic,
        avg: scores.reduce((x, y) => x + y, 0) / scores.length,
      }))
      .filter(({ topic }) => !/^temporal_|^severity_/i.test(String(topic)))
      .sort((a, b) => b.avg - a.avg);

    return {
      anyInvalid,
      windows,
      summary,
      sentiment: {
        labels: sentLabels,
        datasets: [
          {
            label: "Sentiment polarity",
            data: sentData,
            borderColor: "#7c3aed",
            backgroundColor: "rgba(124,58,237,0.1)",
            pointBackgroundColor: pointColors,
            pointBorderColor: "#ffffff",
            pointBorderWidth: 1.5,
            pointRadius: 4,
            pointHoverRadius: 5,
            tension: 0.25,
            fill: false,
          },
        ],
      },
      wordCount: {
        labels: sentLabels,
        datasets: [
          {
            label: "Word count",
            data: windows.map((w) => w.features?.word_count ?? 0),
            borderColor: "#6d28d9",
            backgroundColor: "rgba(109, 40, 217, 0.08)",
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: "#6d28d9",
          },
        ],
      },
      kwSorted: Object.entries(kwMap).sort((a, b) => b[1] - a[1]),
      diagSet,
      topicRows,
    };
  }, [audio]);

  const gaitDerived = useMemo(() => {
    if (!gait.length) return null;
    const windows = gait.filter((r) => r.type === "window");
    const events = gait.filter((r) => r.type === "event");
    const summary = gait.find((r) => r.type === "summary");
    const anyInvalid = gait.some((r) => r.valid === false);

    let avgSpeed =
      summary?.features?.avg_speed_mps ?? summary?.features?.speed_mps ?? null;
    let avgSym = summary?.features?.avg_symmetry ?? summary?.features?.symmetry ?? null;
    let avgStab = summary?.features?.avg_stability ?? summary?.features?.stability ?? null;

    if (avgSpeed == null && windows.length) {
      const sp = windows.map((w) => w.features?.speed_mps).filter((x) => x != null);
      avgSpeed = sp.reduce((a, v) => a + v, 0) / sp.length;
    }
    if (avgSym == null && windows.length) {
      const sy = windows.map((w) => w.features?.symmetry).filter((x) => x != null);
      avgSym = sy.reduce((a, v) => a + v, 0) / sy.length;
    }
    if (avgStab == null && windows.length) {
      const st = windows.map((w) => w.features?.stability).filter((x) => x != null);
      avgStab = st.reduce((a, v) => a + v, 0) / st.length;
    }

    const gaitNotes = summary?.notes;

    const chartWindows = summarizeGaitWindows(windows, MAX_GAIT_CHART_POINTS);

    const speedSeries = chartWindows.map((w) => w.features?.speed_mps ?? null);
    const symmetrySeries = chartWindows.map((w) => w.features?.symmetry ?? null);
    const stabilitySeries = chartWindows.map((w) => w.features?.stability ?? null);

    const speedSmoothed = smoothSeries(speedSeries, 1);
    const symmetrySmoothed = smoothSeries(symmetrySeries, 1);
    const stabilitySmoothed = smoothSeries(stabilitySeries, 1);

    const speedVals = speedSmoothed.filter((v) => v != null);
    const speedMin = speedVals.length ? Math.min(...speedVals) : null;
    const speedMax = speedVals.length ? Math.max(...speedVals) : null;
    const speedRange = speedMin != null && speedMax != null ? speedMax - speedMin : null;
    const speedPad =
      speedRange != null
        ? Math.max(0.2, speedRange * 0.6) // larger pad for smoother-looking visual range
        : 0.2;

    const gaitChart =
      windows.length > 0
        ? {
            labels: chartWindows.map((w) => `${(w.t_start ?? 0).toFixed(1)}s`),
            datasets: [
              {
                label: "Speed (m/s)",
                data: speedSmoothed,
                borderColor: "#047857",
                backgroundColor: "transparent",
                tension: 0.3,
                yAxisID: "ySpeed",
                pointRadius: 3,
              },
              {
                label: "Symmetry",
                data: symmetrySmoothed,
                borderColor: "#10b981",
                backgroundColor: "transparent",
                tension: 0.3,
                yAxisID: "yRatio",
                borderDash: [4, 2],
                pointRadius: 3,
              },
              {
                label: "Stability",
                data: stabilitySmoothed,
                borderColor: "#6ee7b7",
                backgroundColor: "transparent",
                tension: 0.3,
                yAxisID: "yRatio",
                borderDash: [2, 4],
                pointRadius: 3,
              },
            ],
            speedAxis: {
              min: speedMin != null ? Math.max(0, speedMin - speedPad) : undefined,
              max: speedMax != null ? speedMax + speedPad : undefined,
            },
          }
        : null;

    return {
      anyInvalid,
      windows,
      events,
      summary,
      avgSpeed,
      avgSym,
      avgStab,
      gaitNotes,
      gaitChart,
    };
  }, [gait]);

  const doughnutOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "right", labels: { padding: 8, boxWidth: 12, font: { size: 11 } } },
      },
    }),
    []
  );

  const faceTimelineOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { size: 11 } } } },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (v) => `${v}%`, font: { size: 10 } },
        },
      },
    }),
    []
  );

  const sentimentOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: {
          min: -1,
          max: 1,
          ticks: { font: { size: 10 } },
          grid: {
            color: (ctx) =>
              ctx.tick.value === 0 ? "rgba(15, 118, 110, 0.35)" : "rgba(15, 118, 110, 0.08)",
          },
        },
      },
    }),
    []
  );

  const wordCountOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } },
      },
    }),
    []
  );

  const gaitChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { size: 11 } } } },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        ySpeed: {
          type: "linear",
          position: "left",
          title: { display: true, text: "m/s", font: { size: 10 } },
          ticks: { font: { size: 10 } },
        },
        yRatio: {
          type: "linear",
          position: "right",
          min: 0,
          max: 1,
          title: { display: true, text: "0–1", font: { size: 10 } },
          ticks: { font: { size: 10 } },
          grid: { drawOnChartArea: false },
        },
      },
    }),
    []
  );

  if (!visitMeta) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-8 flex items-center justify-center">
        <p className="text-teal-700 text-sm">No report data loaded.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate(createPageUrl("Dashboard"))}
              className="border-teal-200 hover:bg-teal-50 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-teal-600 flex items-center justify-center">
                <FileBarChart className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-teal-900">Report summary</h1>
                <p className="text-sm text-teal-700">
                  Visit review · multimodal, transcription &amp; AI
                </p>
              </div>
            </div>
          </div>
          <div className="text-right text-xs font-mono text-teal-800/80 sm:pr-2">
            <div className="font-semibold">{patientDisplayName}</div>
            <div>MRN {patientMrn}</div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-6">
          <Button
            type="button"
            variant="default"
            className="bg-teal-700 hover:bg-teal-800 text-white w-full sm:w-auto"
            onClick={() => {
              setReportTab("nlp");
              document.getElementById("report-main-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <MessageSquareText className="w-4 h-4 mr-2 shrink-0" />
            Visit Details
          </Button>
          <Link
            to={createPageUrl(
              `ReportSerialTrends?patientId=${encodeURIComponent(patientIdForTrends)}&visitId=${encodeURIComponent(visitIdParam)}${
                isPreviousReportVisual ? "&source=previous-report-visual" : ""
              }`
            )}
            className="inline-flex"
          >
            <Button variant="outline" className="border-teal-300 text-teal-800 hover:bg-teal-50 w-full sm:w-auto">
              <TrendingUp className="w-4 h-4 mr-2 shrink-0" />
              Serial Trend Analysis
            </Button>
          </Link>
          <Button
            variant="outline"
            className="border-teal-300 text-teal-800 hover:bg-teal-50 w-full sm:w-auto"
            onClick={() =>
              generateCombinedReportPDF({
                patient,
                visit: loadedVisit || null,
                visitMeta,
                vitals: vitalsDisplay,
                faceDerived,
                audioDerived,
                gaitDerived,
                aiAssessment,
                serialVisits: serialVisitsForPdf,
                multimodalConfidence: { co, cf, ca, cg },
                recordCounts: { face: face.length, audio: audio.length, gait: gait.length },
                nlpVisit,
              })
            }
          >
            <Download className="w-4 h-4 mr-2 shrink-0" />
            Download full report PDF
          </Button>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <aside className="w-full lg:w-72 shrink-0 space-y-4">
            <Card className="border-teal-200 bg-white/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-teal-600">
                  Visit info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md bg-teal-900 text-teal-50 p-4 space-y-3 text-sm">
                  {loadedVisit?.visit_number != null && loadedVisit.visit_number !== "" && (
                    <div>
                      <p className="text-[0.65rem] uppercase tracking-wider text-teal-300/90">Visit #</p>
                      <p className="font-mono font-semibold">{loadedVisit.visit_number}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[0.65rem] uppercase tracking-wider text-teal-300/90">Patient Name</p>
                    <p className="font-semibold">{patientDisplayName}</p>
                  </div>
                  <div>
                    <p className="text-[0.65rem] uppercase tracking-wider text-teal-300/90">MRN</p>
                    <p className="font-mono font-semibold">{patientMrn}</p>
                  </div>
                  {patient?.primary_diagnosis ? (
                    <div>
                      <p className="text-[0.65rem] uppercase tracking-wider text-teal-300/90">Primary diagnosis</p>
                      <p className="leading-snug">{patient.primary_diagnosis}</p>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-teal-200 bg-white/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-teal-600 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" />
                  Vital signs
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                {vitalsDisplay.visit_date && (
                  <div>
                    <p className="text-[0.65rem] uppercase tracking-wider text-teal-600">Visit date</p>
                    <p className="font-medium text-teal-900">
                      {format(new Date(vitalsDisplay.visit_date), "MMM d, yyyy")}
                    </p>
                  </div>
                )}
                {vitalsDisplay.chief_complaint ? (
                  <div>
                    <p className="text-[0.65rem] uppercase tracking-wider text-teal-600">Chief complaint</p>
                    <p className="text-teal-900 leading-snug">{vitalsDisplay.chief_complaint}</p>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2 items-stretch">
                  <div className="rounded-md bg-teal-50 border border-teal-100 px-2 py-2.5 flex flex-col items-center justify-center gap-1 min-h-[4.5rem] min-w-0 text-center">
                    <p className="text-[0.6rem] text-teal-600 uppercase tracking-wide leading-tight">BP mmHg</p>
                    <p className="text-lg font-bold text-teal-900 font-mono tabular-nums leading-tight">
                      {vitalsDisplay.bp_systolic != null && vitalsDisplay.bp_diastolic != null
                        ? `${vitalsDisplay.bp_systolic}/${vitalsDisplay.bp_diastolic}`
                        : "-"}
                    </p>
                  </div>
                  <div className="rounded-md bg-teal-50 border border-teal-100 px-2 py-2.5 flex flex-col items-center justify-center gap-1 min-h-[4.5rem] min-w-0 text-center">
                    <p className="text-[0.6rem] text-teal-600 uppercase tracking-wide leading-tight">HR bpm</p>
                    <p className="text-lg font-bold text-teal-900 font-mono tabular-nums leading-tight">
                      {vitalsDisplay.heart_rate != null && vitalsDisplay.heart_rate !== "" ? vitalsDisplay.heart_rate : "-"}
                    </p>
                  </div>
                  <div className="rounded-md bg-teal-50 border border-teal-100 px-2 py-2.5 flex flex-col items-center justify-center gap-1 min-h-[4.5rem] min-w-0 text-center">
                    <p className="text-[0.6rem] text-teal-600 uppercase tracking-wide leading-tight">RR /min</p>
                    <p className="text-lg font-bold text-teal-900 font-mono tabular-nums leading-tight">
                      {vitalsDisplay.respiratory_rate != null && vitalsDisplay.respiratory_rate !== "" ? vitalsDisplay.respiratory_rate : "-"}
                    </p>
                  </div>
                  <div className="rounded-md bg-teal-50 border border-teal-100 px-2 py-2.5 flex flex-col items-center justify-center gap-1 min-h-[4.5rem] min-w-0 text-center">
                    <p className="text-[0.6rem] text-teal-600 uppercase tracking-wide leading-tight">Temp</p>
                    <p className="text-lg font-bold text-teal-900 font-mono tabular-nums leading-tight">
                      {vitalsDisplay.temperature != null && vitalsDisplay.temperature !== ""
                        ? `${vitalsDisplay.temperature}${vitalsDisplay.temperature_unit === "celsius" ? " °C" : " °F"}`
                        : "-"}
                    </p>
                  </div>
                  <div className="rounded-md bg-teal-50 border border-teal-100 px-2 py-2.5 flex flex-col items-center justify-center gap-1 min-h-[4.5rem] min-w-0 text-center">
                    <p className="text-[0.6rem] text-teal-600 uppercase tracking-wide leading-tight">SpO₂</p>
                    <p className="text-lg font-bold text-teal-900 font-mono tabular-nums leading-tight">
                      {vitalsDisplay.spo2 != null && vitalsDisplay.spo2 !== "" ? `${vitalsDisplay.spo2}%` : "-"}
                    </p>
                  </div>
                  <div className="rounded-md bg-teal-50 border border-teal-100 px-2 py-2.5 flex flex-col items-center justify-center gap-1 min-h-[4.5rem] min-w-0 text-center">
                    <p className="text-[0.6rem] text-teal-600 uppercase tracking-wide leading-tight">H cm</p>
                    <p className="text-lg font-bold text-teal-900 font-mono tabular-nums leading-tight">
                      {vitalsDisplay.height != null && vitalsDisplay.height !== "" ? vitalsDisplay.height : "-"}
                    </p>
                  </div>
                  <div className="rounded-md bg-teal-50 border border-teal-100 px-2 py-2.5 flex flex-col items-center justify-center gap-1 min-h-[4.5rem] min-w-0 text-center">
                    <p className="text-[0.6rem] text-teal-600 uppercase tracking-wide leading-tight">W kg</p>
                    <p className="text-lg font-bold text-teal-900 font-mono tabular-nums leading-tight">
                      {vitalsDisplay.weight != null && vitalsDisplay.weight !== "" ? vitalsDisplay.weight : "-"}
                    </p>
                  </div>
                  <div className="rounded-md bg-teal-50 border border-teal-100 px-2 py-2.5 flex flex-col items-center justify-center gap-1 min-h-[4.5rem] min-w-0 text-center">
                    <p className="text-[0.6rem] text-teal-600 uppercase tracking-wide leading-tight">BMI</p>
                    <p className="text-lg font-bold text-teal-900 font-mono tabular-nums leading-tight">
                      {vitalsDisplay.bmi != null && vitalsDisplay.bmi !== "" ? vitalsDisplay.bmi : "-"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

          </aside>

          <main id="report-main-tabs" className="flex-1 min-w-0 space-y-8 scroll-mt-8">
            <div className="flex flex-wrap gap-2 border-b border-teal-200 pb-2">
              <button
                type="button"
                onClick={() => setReportTab("multimodal")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors",
                  reportTab === "multimodal"
                    ? "border-teal-600 text-teal-900 bg-white/50"
                    : "border-transparent text-teal-600 hover:text-teal-800"
                )}
              >
                Multimodal analysis
              </button>
              <button
                type="button"
                onClick={() => setReportTab("nlp")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5",
                  reportTab === "nlp"
                    ? "border-teal-600 text-teal-900 bg-white/50"
                    : "border-transparent text-teal-600 hover:text-teal-800"
                )}
              >
                <MessageSquareText className="w-3.5 h-3.5 opacity-80" />
                Transcription &amp; NLP
              </button>
              <button
                type="button"
                onClick={() => setReportTab("ai")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors",
                  reportTab === "ai"
                    ? "border-teal-600 text-teal-900 bg-white/50"
                    : "border-transparent text-teal-600 hover:text-teal-800"
                )}
              >
                AI diagnostic assessment
              </button>
            </div>

            {reportTab === "ai" && (
              <div className="space-y-3">
                <AiDiagnosticAssessmentPanel assessment={aiAssessment} />
              </div>
            )}

            {reportTab === "nlp" && (
              <VisitTranscriptionNlpPanel visit={nlpVisit} usingDemoFallback={nlpUsingDemoFallback} />
            )}

            {reportTab === "multimodal" && (
              <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <Card className="border-teal-200 bg-white/80 backdrop-blur overflow-hidden border-t-4 border-t-teal-900">
                <CardContent className="pt-4">
                  <p className="text-[0.65rem] font-mono uppercase tracking-wider text-teal-600 mb-1">
                    Overall confidence
                  </p>
                  <p className="text-3xl font-bold text-teal-900">{co != null ? pct(co) : "—"}</p>
                  <p className="text-xs text-teal-600 mt-1">Across all subsystems</p>
                </CardContent>
              </Card>
              <Card className="border-teal-200 bg-white/80 backdrop-blur overflow-hidden border-t-4 border-t-blue-600">
                <CardContent className="pt-4">
                  <p className="text-[0.65rem] font-mono uppercase tracking-wider text-teal-600 mb-1">
                    Face · confidence
                  </p>
                  <p className="text-3xl font-bold text-blue-700">{cf != null ? pct(cf) : "—"}</p>
                  <p className="text-xs text-teal-600 mt-1">{face.length} records</p>
                </CardContent>
              </Card>
              <Card className="border-teal-200 bg-white/80 backdrop-blur overflow-hidden border-t-4 border-t-violet-600">
                <CardContent className="pt-4">
                  <p className="text-[0.65rem] font-mono uppercase tracking-wider text-teal-600 mb-1">
                    Audio · confidence
                  </p>
                  <p className="text-3xl font-bold text-violet-700">{ca != null ? pct(ca) : "—"}</p>
                  <p className="text-xs text-teal-600 mt-1">{audio.length} records</p>
                </CardContent>
              </Card>
              <Card className="border-teal-200 bg-white/80 backdrop-blur overflow-hidden border-t-4 border-t-emerald-600">
                <CardContent className="pt-4">
                  <p className="text-[0.65rem] font-mono uppercase tracking-wider text-teal-600 mb-1">
                    Gait · confidence
                  </p>
                  <p className="text-3xl font-bold text-emerald-700">{cg != null ? pct(cg) : "—"}</p>
                  <p className="text-xs text-teal-600 mt-1">{gait.length} records</p>
                </CardContent>
              </Card>
            </div>

            {faceDerived && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold text-teal-900">Facial expression analysis</h2>
                  <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">Face</Badge>
                  <div className="hidden sm:block flex-1 h-px bg-teal-200 min-w-[4rem]" />
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[0.65rem]",
                      faceDerived.anyInvalid
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800"
                    )}
                  >
                    {faceDerived.anyInvalid ? "● Issues" : "● Valid"}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="border-teal-200 bg-white/80 backdrop-blur">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-mono uppercase tracking-wider text-teal-600">
                        Emotion distribution
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {faceDerived.sorted.map(([key, val]) => (
                          <div key={key} className="flex items-center gap-3">
                            <span className="w-24 shrink-0 text-sm text-teal-900 capitalize">
                              {labelEmo(key)}
                            </span>
                            <div className="flex-1 h-3.5 rounded bg-teal-100 overflow-hidden">
                              <div
                                className="h-full rounded transition-all duration-500"
                                style={{ width: `${val}%`, backgroundColor: emoColor(key) }}
                              />
                            </div>
                            <span className="w-12 text-right font-mono text-xs text-teal-600">
                              {val.toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-teal-200 bg-white/80 backdrop-blur">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-mono uppercase tracking-wider text-teal-600">
                        Emotion breakdown
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className={chartBox}>
                        <Chart
                          key={faceDerived.sorted.map(([k]) => k).join("-")}
                          type="doughnut"
                          data={faceDerived.doughnutData}
                          options={doughnutOptions}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>
                {faceDerived.emotionTimeline && (
                  <Card className="border-teal-200 bg-white/80 backdrop-blur">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-mono uppercase tracking-wider text-teal-600">
                        Emotion frequency over time (all emotions)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className={chartBoxTall}>
                        <Chart
                          type="line"
                          data={faceDerived.emotionTimeline}
                          options={faceTimelineOptions}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs font-mono text-teal-600 underline p-0 h-auto"
                    onClick={() => setShowFaceRaw((s) => !s)}
                  >
                    {showFaceRaw ? "Hide raw records" : "Show raw records"}
                  </Button>
                  {showFaceRaw && (
                    <pre className="mt-2 rounded-md bg-slate-900 text-sky-100/90 font-mono text-[0.65rem] p-4 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                      {face.map((r) => JSON.stringify(r, null, 2)).join("\n\n")}
                    </pre>
                  )}
                </div>
              </section>
            )}

            {audioDerived && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold text-teal-900">Audio &amp; language analysis</h2>
                  <Badge className="bg-violet-100 text-violet-800 border-violet-200 hover:bg-violet-100">
                    Audio
                  </Badge>
                  <div className="hidden sm:block flex-1 h-px bg-teal-200 min-w-[4rem]" />
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[0.65rem]",
                      audioDerived.anyInvalid
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800"
                    )}
                  >
                    {audioDerived.anyInvalid ? "● Issues" : "● Valid"}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="border-teal-200 bg-white/80 backdrop-blur">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-mono uppercase tracking-wider text-teal-600">
                        Sentiment polarity over time
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className={chartBox}>
                        <Chart type="line" data={audioDerived.sentiment} options={sentimentOptions} />
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-teal-200 bg-white/80 backdrop-blur">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-mono uppercase tracking-wider text-teal-600">
                        Word count over time
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className={chartBox}>
                        <Chart type="line" data={audioDerived.wordCount} options={wordCountOptions} />
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="border-teal-200 bg-white/80 backdrop-blur">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-mono uppercase tracking-wider text-teal-600">
                        Top keywords (all windows)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2 mb-3 border-b border-teal-100 pb-2">
                        <button
                          type="button"
                          onClick={() => setKeywordView("diagnostic")}
                          className={cn(
                            "text-xs px-2.5 py-1 rounded border transition-colors",
                            keywordView === "diagnostic"
                              ? "bg-amber-100 text-amber-900 border-amber-200"
                              : "bg-white text-teal-700 border-teal-200 hover:bg-teal-50"
                          )}
                        >
                          Diagnostic terms
                        </button>
                        <button
                          type="button"
                          onClick={() => setKeywordView("all")}
                          className={cn(
                            "text-xs px-2.5 py-1 rounded border transition-colors",
                            keywordView === "all"
                              ? "bg-teal-100 text-teal-900 border-teal-200"
                              : "bg-white text-teal-700 border-teal-200 hover:bg-teal-50"
                          )}
                        >
                          Include non-diagnostic
                        </button>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-teal-200">
                            <th className="text-left py-2 text-[0.65rem] font-mono uppercase tracking-wider text-teal-600">
                              Word
                            </th>
                            <th className="text-left py-2 text-[0.65rem] font-mono uppercase tracking-wider text-teal-600">
                              Diagnostic
                            </th>
                            <th className="text-right py-2 text-[0.65rem] font-mono uppercase tracking-wider text-teal-600">
                              Count
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(keywordView === "diagnostic"
                            ? audioDerived.kwSorted.filter(([word]) => audioDerived.diagSet.has(word))
                            : audioDerived.kwSorted
                          ).map(([word, count]) => (
                            <tr key={word} className="border-b border-teal-100">
                              <td className="py-1.5 text-teal-900">{word}</td>
                              <td className="py-1.5">
                                {audioDerived.diagSet.has(word) ? (
                                  <span className="inline-block rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[0.65rem] font-mono font-semibold">
                                    diagnostic
                                  </span>
                                ) : null}
                              </td>
                              <td className="py-1.5 text-right font-mono font-semibold text-teal-800">
                                {count}
                              </td>
                            </tr>
                          ))}
                          {keywordView === "diagnostic" &&
                            audioDerived.kwSorted.filter(([word]) => audioDerived.diagSet.has(word)).length === 0 && (
                              <tr>
                                <td colSpan={3} className="py-3 text-center text-xs text-teal-600">
                                  No diagnostic terms detected in this sample window set.
                                </td>
                              </tr>
                            )}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                  <Card className="border-teal-200 bg-white/80 backdrop-blur">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-mono uppercase tracking-wider text-teal-600">
                        Topic strength
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-[0.65rem] text-teal-600">
                        Ranked relevance score (0 to 1)
                      </p>
                      {audioDerived.topicRows.map(({ topic, avg }) => (
                        <div key={topic} className="flex items-center gap-2">
                          <span className="w-40 shrink-0 text-sm text-teal-900 truncate">
                            {topic.replace(/_/g, " ")}
                          </span>
                          <div className="flex-1 h-2.5 rounded bg-teal-100 overflow-hidden">
                            <div
                              className="h-full rounded bg-violet-600 transition-all"
                              style={{ width: `${(avg * 100).toFixed(0)}%` }}
                            />
                          </div>
                          <span className="w-12 text-right font-mono text-xs text-teal-600">
                            {avg.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs font-mono text-teal-600 underline p-0 h-auto"
                    onClick={() => setShowAudioRaw((s) => !s)}
                  >
                    {showAudioRaw ? "Hide raw records" : "Show raw records"}
                  </Button>
                  {showAudioRaw && (
                    <pre className="mt-2 rounded-md bg-slate-900 text-sky-100/90 font-mono text-[0.65rem] p-4 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                      {audio.map((r) => JSON.stringify(r, null, 2)).join("\n\n")}
                    </pre>
                  )}
                </div>
              </section>
            )}

            {gaitDerived && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold text-teal-900">Gait &amp; motion analysis</h2>
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">
                    Gait
                  </Badge>
                  <div className="hidden sm:block flex-1 h-px bg-teal-200 min-w-[4rem]" />
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[0.65rem]",
                      gaitDerived.anyInvalid
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800"
                    )}
                  >
                    {gaitDerived.anyInvalid ? "● Issues" : "● Valid"}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card className="border-teal-200 bg-teal-50/80 text-center p-4">
                    <p className="text-3xl font-bold text-emerald-700 font-serif">
                      {gaitDerived.avgSpeed != null ? gaitDerived.avgSpeed.toFixed(2) : "—"}
                    </p>
                    <p className="text-[0.65rem] font-mono uppercase tracking-wider text-teal-600 mt-2">
                      Avg speed (m/s)
                    </p>
                    <p className="text-xs text-teal-600 mt-1">
                      Normal: 1.0–1.4 m/s · {qualLabel(gaitDerived.avgSpeed, 0.7, 1.0)}
                    </p>
                  </Card>
                  <Card className="border-teal-200 bg-teal-50/80 text-center p-4">
                    <p className="text-3xl font-bold text-emerald-700 font-serif">
                      {gaitDerived.avgSym != null ? `${(gaitDerived.avgSym * 100).toFixed(0)}%` : "—"}
                    </p>
                    <p className="text-[0.65rem] font-mono uppercase tracking-wider text-teal-600 mt-2">
                      Avg symmetry
                    </p>
                    <p className="text-xs text-teal-600 mt-1">
                      Normal: &gt;85% · {qualLabel(gaitDerived.avgSym, 0.7, 0.85)}
                    </p>
                  </Card>
                  <Card className="border-teal-200 bg-teal-50/80 text-center p-4">
                    <p className="text-3xl font-bold text-emerald-700 font-serif">
                      {gaitDerived.avgStab != null ? `${(gaitDerived.avgStab * 100).toFixed(0)}%` : "—"}
                    </p>
                    <p className="text-[0.65rem] font-mono uppercase tracking-wider text-teal-600 mt-2">
                      Avg stability
                    </p>
                    <p className="text-xs text-teal-600 mt-1">
                      Normal: &gt;80% · {qualLabel(gaitDerived.avgStab, 0.65, 0.8)}
                    </p>
                  </Card>
                </div>
                {gaitDerived.gaitNotes && (
                  <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 text-amber-900 text-sm px-4 py-3">
                    {gaitDerived.gaitNotes}
                  </div>
                )}
                {gaitDerived.gaitChart && (
                  <Card className="border-teal-200 bg-white/80 backdrop-blur">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-mono uppercase tracking-wider text-teal-600">
                        Gait metrics over time
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className={chartBoxTall}>
                        <Chart
                          type="line"
                          data={gaitDerived.gaitChart}
                          options={{
                            ...gaitChartOptions,
                            scales: {
                              ...gaitChartOptions.scales,
                              ySpeed: {
                                ...gaitChartOptions.scales.ySpeed,
                                min: gaitDerived.gaitChart?.speedAxis?.min,
                                max: gaitDerived.gaitChart?.speedAxis?.max,
                              },
                            },
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}
                <Card className="border-teal-200 bg-white/80 backdrop-blur">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-mono uppercase tracking-wider text-teal-600">
                      Events detected
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {gaitDerived.events.length === 0 ? (
                      <p className="text-sm text-teal-600">No events detected.</p>
                    ) : (
                      gaitDerived.events.map((e, i) => (
                        <div
                          key={`${e.t}-${i}`}
                          className="flex items-center gap-3 rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2 text-sm"
                        >
                          <span className="font-mono text-xs text-teal-600 w-12 shrink-0">
                            {e.t != null ? `${e.t}s` : "—"}
                          </span>
                          <span className="flex-1 font-medium text-teal-900">
                            {e.features?.event ?? "unknown"}
                          </span>
                          <span className="font-mono text-xs text-teal-600">
                            conf: {fmtConf(e.confidence)}
                          </span>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs font-mono text-teal-600 underline p-0 h-auto"
                    onClick={() => setShowGaitRaw((s) => !s)}
                  >
                    {showGaitRaw ? "Hide raw records" : "Show raw records"}
                  </Button>
                  {showGaitRaw && (
                    <pre className="mt-2 rounded-md bg-slate-900 text-sky-100/90 font-mono text-[0.65rem] p-4 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                      {gait.map((r) => JSON.stringify(r, null, 2)).join("\n\n")}
                    </pre>
                  )}
                </div>
              </section>
            )}

              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
