import React, { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Legend,
  Tooltip,
  Filler,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { format } from "date-fns";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { createPageUrl, cn } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PatientNlpTrendCharts from "@/components/PatientNlpTrendCharts";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Legend, Tooltip, Filler);

const lineOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { font: { size: 11 } } } },
  scales: {
    x: { ticks: { font: { size: 10 } } },
    y: { ticks: { font: { size: 10 } } },
  },
};

const dualAxisLegend = { labels: { font: { size: 10 } } };

export default function ReportSerialTrends() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reportSource = searchParams.get("source") || "";
  const isPreviousReportVisual = reportSource === "previous-report-visual";
  const patientMrn = searchParams.get("patientId") || "";
  const visitId = searchParams.get("visitId") || "";

  const { data: trendPatient } = useQuery({
    queryKey: ["patient", patientMrn],
    queryFn: async () => {
      const rows = await api.entities.Patient.filter({ medical_record_number: patientMrn });
      return rows[0];
    },
    enabled: !!patientMrn,
  });

  const { data: storedVisitsForNlp = [] } = useQuery({
    queryKey: ["visits", "nlp-trends", patientMrn],
    queryFn: () => api.entities.Visit.filter({ patient_mrn: patientMrn }, "visit_date"),
    enabled: !!patientMrn && !isPreviousReportVisual,
  });

  const snaps = useMemo(() => {
    if (isPreviousReportVisual) return [];
    const toNumOrNull = (value) => {
      if (value == null) return null;
      if (typeof value === "string" && value.trim() === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const faceMetricsFromVisit = (v) => {
      const faceRows = Array.isArray(v?.multimodal_jsonl?.face) ? v.multimodal_jsonl.face : [];
      if (!faceRows.length) {
        return {
          face_avg_confidence: null,
          face_neutral_pct: null,
          face_happy_pct: null,
          face_sad_pct: null,
          face_angry_pct: null,
          face_surprise_pct: null,
        };
      }
      const summary = faceRows.find((r) => r?.type === "summary");
      const windows = faceRows.filter((r) => r?.type === "window");
      const confidences = faceRows.map((r) => r?.confidence).filter((x) => x != null).map(Number);
      const avgConf = confidences.length
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : null;

      const pctFromSummary = summary?.features?.emotion_pct;
      if (pctFromSummary && typeof pctFromSummary === "object") {
        return {
          face_avg_confidence: avgConf,
          face_neutral_pct: Number(pctFromSummary.neutral ?? null),
          face_happy_pct: Number(pctFromSummary.happy ?? null),
          face_sad_pct: Number(pctFromSummary.sad ?? null),
          face_angry_pct: Number(pctFromSummary.angry ?? null),
          face_surprise_pct: Number(pctFromSummary.surprise ?? null),
        };
      }

      if (!windows.length) {
        return {
          face_avg_confidence: avgConf,
          face_neutral_pct: null,
          face_happy_pct: null,
          face_sad_pct: null,
          face_angry_pct: null,
          face_surprise_pct: null,
        };
      }

      const totals = { neutral: 0, happy: 0, sad: 0, angry: 0, surprise: 0 };
      let totalCounts = 0;
      windows.forEach((w) => {
        const ec = w?.features?.emotion_counts || {};
        Object.keys(totals).forEach((k) => {
          const n = Number(ec[k] ?? 0);
          totals[k] += n;
          totalCounts += n;
        });
      });
      const pct = (k) => (totalCounts > 0 ? (totals[k] / totalCounts) * 100 : null);
      return {
        face_avg_confidence: avgConf,
        face_neutral_pct: pct("neutral"),
        face_happy_pct: pct("happy"),
        face_sad_pct: pct("sad"),
        face_angry_pct: pct("angry"),
        face_surprise_pct: pct("surprise"),
      };
    };
    const normVisitNumber = (v, idx) => {
      if (v?.visit_number != null && v.visit_number !== "") return Number(v.visit_number);
      return idx + 1;
    };
    const sentimentScoreOf = (v) => {
      if (v?.sentiment_score != null) return toNumOrNull(v.sentiment_score);
      if (v?.sentiment_analysis?.sentiment_score != null) return toNumOrNull(v.sentiment_analysis.sentiment_score);
      return null;
    };
    const diagnosticPctOf = (v) => {
      if (v?.audio_diagnostic_term_pct != null) return toNumOrNull(v.audio_diagnostic_term_pct);
      if (v?.keyword_analysis?.keyword_percentage != null) {
        const pct = toNumOrNull(v.keyword_analysis.keyword_percentage);
        return pct != null ? pct / 100 : null;
      }
      return null;
    };
    const keywordHitsOf = (v) => {
      if (v?.audio_keyword_hits != null) return Number(v.audio_keyword_hits);
      const dk = v?.keyword_analysis?.diagnostic_keywords;
      if (dk && typeof dk === "object") {
        return Object.values(dk).reduce((sum, n) => sum + (Number(n) || 0), 0);
      }
      return null;
    };
    const wordCountOf = (v) => {
      if (v?.audio_word_count != null) return toNumOrNull(v.audio_word_count);
      if (v?.keyword_analysis?.total_words != null) return toNumOrNull(v.keyword_analysis.total_words);
      return null;
    };
    const gaitSpeedOf = (v) => {
      if (v?.gait_avg_speed_mps != null) return toNumOrNull(v.gait_avg_speed_mps);
      if (v?.gait_summary?.avg_speed_mps != null) return toNumOrNull(v.gait_summary.avg_speed_mps);
      if (v?.gait_summary?.mean_speed_mps != null) return toNumOrNull(v.gait_summary.mean_speed_mps);
      return null;
    };
    const gaitSymOf = (v) => {
      if (v?.gait_avg_symmetry != null) return toNumOrNull(v.gait_avg_symmetry);
      if (v?.gait_summary?.avg_symmetry != null) return toNumOrNull(v.gait_summary.avg_symmetry);
      if (v?.gait_summary?.knee_symmetry_index_percent != null) {
        const idxPct = toNumOrNull(v.gait_summary.knee_symmetry_index_percent);
        return Number.isFinite(idxPct) ? Math.max(0, Math.min(1, 1 - idxPct / 100)) : null;
      }
      return null;
    };
    const gaitStabOf = (v) => {
      if (v?.gait_avg_stability != null) return toNumOrNull(v.gait_avg_stability);
      if (v?.gait_summary?.avg_stability != null) return toNumOrNull(v.gait_summary.avg_stability);
      return null;
    };
    const gaitEventsOf = (v) => {
      if (v?.gait_event_count != null) return toNumOrNull(v.gait_event_count);
      return null;
    };

    return storedVisitsForNlp.map((v, idx) => ({
      ...faceMetricsFromVisit(v),
      visit_id: v.id,
      visit_number: normVisitNumber(v, idx),
      visit_date: v.visit_date,
      chief_complaint: v.chief_complaint,
      bp_systolic: toNumOrNull(v.bp_systolic),
      bp_diastolic: toNumOrNull(v.bp_diastolic),
      heart_rate: toNumOrNull(v.heart_rate),
      respiratory_rate: toNumOrNull(v.respiratory_rate),
      temperature: toNumOrNull(v.temperature),
      temperature_unit: v.temperature_unit || "fahrenheit",
      spo2: toNumOrNull(v.spo2),
      height: toNumOrNull(v.height),
      weight: toNumOrNull(v.weight),
      bmi: toNumOrNull(v.bmi),
      sentiment_score: sentimentScoreOf(v),
      audio_polarity:
        v?.sentiment_analysis?.sentiment_score != null
          ? toNumOrNull(v.sentiment_analysis.sentiment_score)
          : sentimentScoreOf(v),
      audio_diagnostic_term_pct: diagnosticPctOf(v),
      audio_keyword_hits: keywordHitsOf(v),
      audio_word_count: wordCountOf(v),
      gait_avg_speed_mps: gaitSpeedOf(v),
      gait_avg_symmetry: gaitSymOf(v),
      gait_avg_stability: gaitStabOf(v),
      gait_event_count: gaitEventsOf(v),
      ai_assessment: v.ai_assessment || null,
    }));
  }, [storedVisitsForNlp, isPreviousReportVisual]);

  const patientLabel = useMemo(() => {
    return trendPatient ? `${trendPatient.first_name} ${trendPatient.last_name}`.trim() : null;
  }, [isPreviousReportVisual, patientMrn, trendPatient]);

  const patientMrnLabel = useMemo(() => {
    const mrn = trendPatient?.medical_record_number;
    if (typeof mrn === "string" && mrn.trim()) return mrn.trim();
    if (mrn != null && String(mrn).trim()) return String(mrn).trim();
    return patientMrn;
  }, [trendPatient, patientMrn]);

  const labels = useMemo(
    () => snaps.map((s) => format(new Date(s.visit_date), "MMM d, yy")),
    [snaps]
  );

  const vitalsChartBpHr = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Systolic BP",
          data: snaps.map((s) => s.bp_systolic),
          borderColor: "#0f766e",
          backgroundColor: "rgba(15,118,110,0.12)",
          tension: 0.25,
          fill: false,
          yAxisID: "yMmhg",
        },
        {
          label: "Diastolic BP",
          data: snaps.map((s) => s.bp_diastolic),
          borderColor: "#2dd4bf",
          backgroundColor: "rgba(45,212,191,0.1)",
          tension: 0.25,
          fill: false,
          yAxisID: "yMmhg",
        },
        {
          label: "Heart rate",
          data: snaps.map((s) => s.heart_rate),
          borderColor: "#7c3aed",
          backgroundColor: "rgba(124,58,237,0.1)",
          tension: 0.25,
          fill: false,
          yAxisID: "yHr",
        },
      ],
    }),
    [labels, snaps]
  );

  const vitalsChartBpHrOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: dualAxisLegend },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        yMmhg: {
          type: "linear",
          position: "left",
          title: { display: true, text: "BP (mmHg)", font: { size: 10 } },
          ticks: { font: { size: 10 } },
        },
        yHr: {
          type: "linear",
          position: "right",
          title: { display: true, text: "HR (bpm)", font: { size: 10 } },
          ticks: { font: { size: 10 } },
          grid: { drawOnChartArea: false },
        },
      },
    }),
    []
  );

  const vitalsChartRrSpo2 = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Respiratory rate",
          data: snaps.map((s) => s.respiratory_rate),
          borderColor: "#c026d3",
          backgroundColor: "rgba(192,38,211,0.08)",
          tension: 0.25,
          fill: false,
          yAxisID: "yRr",
        },
        {
          label: "SpO₂",
          data: snaps.map((s) => s.spo2),
          borderColor: "#ea580c",
          backgroundColor: "rgba(234,88,12,0.08)",
          tension: 0.25,
          fill: false,
          yAxisID: "ySpo2",
        },
      ],
    }),
    [labels, snaps]
  );

  const vitalsChartRrSpo2Options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: dualAxisLegend },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        yRr: {
          type: "linear",
          position: "left",
          title: { display: true, text: "RR (/min)", font: { size: 10 } },
          ticks: { font: { size: 10 } },
          suggestedMin: 12,
          suggestedMax: 24,
        },
        ySpo2: {
          type: "linear",
          position: "right",
          title: { display: true, text: "SpO₂ (%)", font: { size: 10 } },
          ticks: { font: { size: 10 }, callback: (v) => `${v}%` },
          min: 90,
          max: 100,
          grid: { drawOnChartArea: false },
        },
      },
    }),
    []
  );

  const vitalsChartTempBmi = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Temperature (°F)",
          data: snaps.map((s) => s.temperature),
          borderColor: "#dc2626",
          backgroundColor: "rgba(220,38,38,0.08)",
          tension: 0.25,
          fill: false,
          yAxisID: "yTemp",
        },
        {
          label: "BMI",
          data: snaps.map((s) => s.bmi),
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.08)",
          tension: 0.25,
          fill: false,
          yAxisID: "yBmi",
        },
      ],
    }),
    [labels, snaps]
  );

  const vitalsChartTempBmiOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: dualAxisLegend },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        yTemp: {
          type: "linear",
          position: "left",
          title: { display: true, text: "Temp (°F)", font: { size: 10 } },
          ticks: { font: { size: 10 } },
          suggestedMin: 96,
          suggestedMax: 102,
        },
        yBmi: {
          type: "linear",
          position: "right",
          title: { display: true, text: "BMI", font: { size: 10 } },
          ticks: { font: { size: 10 } },
          suggestedMin: 18,
          suggestedMax: 35,
          grid: { drawOnChartArea: false },
        },
      },
    }),
    []
  );

  const faceChart = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Happy (%)",
          data: snaps.map((s) => s.face_happy_pct),
          borderColor: "#f4a261",
          backgroundColor: "rgba(244,162,97,0.12)",
          tension: 0.25,
        },
        {
          label: "Angry (%)",
          data: snaps.map((s) => s.face_angry_pct),
          borderColor: "#e63946",
          backgroundColor: "rgba(230,57,70,0.1)",
          tension: 0.25,
        },
        {
          label: "Neutral (%)",
          data: snaps.map((s) => s.face_neutral_pct),
          borderColor: "#94a3b8",
          backgroundColor: "rgba(148,163,184,0.1)",
          tension: 0.25,
        },
        {
          label: "Sad (%)",
          data: snaps.map((s) => s.face_sad_pct),
          borderColor: "#457b9d",
          backgroundColor: "rgba(69,123,157,0.1)",
          tension: 0.25,
        },
        {
          label: "Surprise (%)",
          data: snaps.map((s) => s.face_surprise_pct),
          borderColor: "#ffb703",
          backgroundColor: "rgba(255,183,3,0.12)",
          tension: 0.25,
        },
      ],
    }),
    [labels, snaps]
  );

  const audioChart = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Sentiment score",
          data: snaps.map((s) => s.sentiment_score),
          borderColor: "#92400e",
          backgroundColor: "rgba(146,64,14,0.1)",
          yAxisID: "ySent",
          tension: 0.25,
        },
        {
          label: "Diagnostic term %",
          data: snaps.map((s) =>
            s.audio_diagnostic_term_pct != null ? s.audio_diagnostic_term_pct * 100 : null
          ),
          borderColor: "#7c3aed",
          backgroundColor: "rgba(124,58,237,0.08)",
          yAxisID: "yPct",
          tension: 0.25,
        },
      ],
    }),
    [labels, snaps]
  );

  const gaitChart = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Speed (m/s)",
          data: snaps.map((s) => s.gait_avg_speed_mps),
          borderColor: "#0f766e",
          backgroundColor: "rgba(15,118,110,0.1)",
          yAxisID: "ySpeed",
          tension: 0.25,
        },
        {
          label: "Symmetry (%)",
          data: snaps.map((s) => (s.gait_avg_symmetry != null ? s.gait_avg_symmetry * 100 : null)),
          borderColor: "#15803d",
          backgroundColor: "rgba(21,128,61,0.08)",
          yAxisID: "yPct",
          borderDash: [4, 2],
          tension: 0.25,
        },
        {
          label: "Stability (%)",
          data: snaps.map((s) => (s.gait_avg_stability != null ? s.gait_avg_stability * 100 : null)),
          borderColor: "#65a30d",
          backgroundColor: "rgba(101,163,13,0.08)",
          yAxisID: "yPct",
          borderDash: [2, 4],
          tension: 0.25,
        },
      ],
    }),
    [labels, snaps]
  );

  const twoAxisSentimentOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { size: 10 } } } },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        ySent: {
          type: "linear",
          position: "left",
          min: -1,
          max: 1,
          ticks: { font: { size: 10 } },
          title: { display: true, text: "-1 to 1", font: { size: 10 } },
        },
        yPct: {
          type: "linear",
          position: "right",
          min: 0,
          max: 100,
          ticks: { callback: (v) => `${v}%`, font: { size: 10 } },
          title: { display: true, text: "%", font: { size: 10 } },
          grid: { drawOnChartArea: false },
        },
      },
    }),
    []
  );

  const gaitOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { size: 10 } } } },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        ySpeed: {
          type: "linear",
          position: "left",
          ticks: { font: { size: 10 } },
          title: { display: true, text: "m/s", font: { size: 10 } },
        },
        yPct: {
          type: "linear",
          position: "right",
          min: 0,
          max: 100,
          ticks: { callback: (v) => `${v}%`, font: { size: 10 } },
          title: { display: true, text: "%", font: { size: 10 } },
          grid: { drawOnChartArea: false },
        },
      },
    }),
    []
  );

  const latest = snaps[snaps.length - 1];
  const previous = snaps.length > 1 ? snaps[snaps.length - 2] : null;

  const backToReport = () => {
    const q = visitId ? `?visitId=${encodeURIComponent(visitId)}` : "";
    navigate(`${createPageUrl("ReportSummary")}${q}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-8">
      <div className="max-w-7xl mx-auto">
        {!patientMrn ? (
          <Card className="border-teal-200 bg-white/80 backdrop-blur">
            <CardContent className="py-8 text-sm text-teal-700">
              No patient selected for serial trend analysis.
            </CardContent>
          </Card>
        ) : null}

        {patientMrn && snaps.length === 0 ? (
          <Card className="border-teal-200 bg-white/80 backdrop-blur mb-6">
            <CardContent className="py-8 text-sm text-teal-700">
              No visits found for this patient yet.
            </CardContent>
          </Card>
        ) : null}

        {patientMrn && snaps.length > 0 && (
          <>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={backToReport}
              className="border-teal-200 hover:bg-teal-50 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-teal-700 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-teal-900">Serial trend analysis</h1>
                <p className="text-sm text-teal-700">
                  {patientLabel ? (
                    <>
                      <span className="font-medium text-teal-900">{patientLabel}</span>
                      <span className="text-teal-600"> · </span>
                    </>
                  ) : null}
                  Multimodal serial trends · MRN <span className="font-mono">{patientMrnLabel}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <Card className="border-teal-200 bg-white/80 backdrop-blur mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-teal-800">Visits in this demo series</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-teal-200 text-left text-[0.65rem] uppercase tracking-wider text-teal-600">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">BP</th>
                    <th className="py-2 pr-2">HR</th>
                    <th className="py-2 pr-2">RR</th>
                    <th className="py-2 pr-2">Temp</th>
                    <th className="py-2 pr-2">SpO₂</th>
                    <th className="py-2 pr-2">BMI</th>
                    <th className="py-2 pr-2">Sentiment</th>
                    <th className="py-2">Gait m/s</th>
                  </tr>
                </thead>
                <tbody>
                  {snaps.map((s) => (
                    <tr
                      key={s.visit_id}
                      className={cn(
                        "border-b border-teal-100",
                        visitId && s.visit_id === visitId && "bg-teal-50/80"
                      )}
                    >
                      <td className="py-2 pr-2 font-mono">{s.visit_number}</td>
                      <td className="py-2 pr-2">{format(new Date(s.visit_date), "MMM d, yyyy")}</td>
                      <td className="py-2 pr-2 font-mono">
                        {s.bp_systolic != null && s.bp_diastolic != null ? `${s.bp_systolic}/${s.bp_diastolic}` : "—"}
                      </td>
                      <td className="py-2 pr-2 font-mono">{s.heart_rate != null ? s.heart_rate : "—"}</td>
                      <td className="py-2 pr-2 font-mono">{s.respiratory_rate != null ? s.respiratory_rate : "—"}</td>
                      <td className="py-2 pr-2 font-mono">{s.temperature != null ? `${s.temperature.toFixed(1)}°` : "—"}</td>
                      <td className="py-2 pr-2 font-mono">{s.spo2 != null ? `${s.spo2}%` : "—"}</td>
                      <td className="py-2 pr-2 font-mono">{s.bmi != null ? s.bmi.toFixed(1) : "—"}</td>
                      <td className="py-2 pr-2 font-mono">{s.sentiment_score != null ? s.sentiment_score.toFixed(2) : "—"}</td>
                      <td className="py-2 font-mono">{s.gait_avg_speed_mps != null ? s.gait_avg_speed_mps.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {storedVisitsForNlp.length > 0 && (
          <section className="mb-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-teal-900">Transcription &amp; NLP trends</h2>
              <p className="text-sm text-teal-600">
                Derived from stored visit records for this patient (keyword and sentiment fields).
              </p>
            </div>
            <PatientNlpTrendCharts visits={storedVisitsForNlp} />
          </section>
        )}

        <div className="mb-4">
          <h2 className="text-lg font-semibold text-teal-900">Vitals trends across visits</h2>
          <p className="text-sm text-teal-600 mb-4">
            Blood pressure, heart rate, breathing, oxygen saturation, temperature, and BMI from the demo visit series.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="border-teal-200 bg-white/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-teal-600">
                  Blood pressure &amp; heart rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative h-[220px] w-full">
                  <Chart type="line" data={vitalsChartBpHr} options={vitalsChartBpHrOptions} />
                </div>
              </CardContent>
            </Card>
            <Card className="border-teal-200 bg-white/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-teal-600">
                  Respiratory rate &amp; SpO₂
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative h-[220px] w-full">
                  <Chart type="line" data={vitalsChartRrSpo2} options={vitalsChartRrSpo2Options} />
                </div>
              </CardContent>
            </Card>
            <Card className="border-teal-200 bg-white/80 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-teal-600">
                  Temperature &amp; BMI
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative h-[220px] w-full">
                  <Chart type="line" data={vitalsChartTempBmi} options={vitalsChartTempBmiOptions} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <Card className="border-teal-200 bg-white/80 backdrop-blur xl:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-teal-600">
                Latest visit vs prior (quick deltas)
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3">
                <p className="text-[0.65rem] uppercase tracking-wider text-teal-600">BP</p>
                <p className="text-lg font-semibold text-teal-900 font-mono">
                  {latest.bp_systolic != null && latest.bp_diastolic != null ? `${latest.bp_systolic}/${latest.bp_diastolic}` : "—"}
                </p>
                {previous && (
                  <p className="text-xs text-teal-700">
                    Δ sys {latest.bp_systolic != null && previous.bp_systolic != null
                      ? `${latest.bp_systolic - previous.bp_systolic >= 0 ? "+" : ""}${latest.bp_systolic - previous.bp_systolic}`
                      : "—"}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3">
                <p className="text-[0.65rem] uppercase tracking-wider text-teal-600">Heart rate</p>
                <p className="text-lg font-semibold text-teal-900 font-mono">{latest.heart_rate != null ? `${latest.heart_rate} bpm` : "—"}</p>
                {previous && (
                  <p className="text-xs text-teal-700">
                    Δ {latest.heart_rate != null && previous.heart_rate != null
                      ? `${latest.heart_rate - previous.heart_rate >= 0 ? "+" : ""}${latest.heart_rate - previous.heart_rate}`
                      : "—"}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3">
                <p className="text-[0.65rem] uppercase tracking-wider text-teal-600">RR</p>
                <p className="text-lg font-semibold text-teal-900 font-mono">{latest.respiratory_rate != null ? `${latest.respiratory_rate}/min` : "—"}</p>
                {previous && (
                  <p className="text-xs text-teal-700">
                    Δ {latest.respiratory_rate != null && previous.respiratory_rate != null
                      ? `${latest.respiratory_rate - previous.respiratory_rate >= 0 ? "+" : ""}${latest.respiratory_rate - previous.respiratory_rate}`
                      : "—"}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3">
                <p className="text-[0.65rem] uppercase tracking-wider text-teal-600">SpO₂</p>
                <p className="text-lg font-semibold text-teal-900 font-mono">{latest.spo2 != null ? `${latest.spo2}%` : "—"}</p>
                {previous && (
                  <p className="text-xs text-teal-700">
                    Δ {latest.spo2 != null && previous.spo2 != null
                      ? `${latest.spo2 - previous.spo2 >= 0 ? "+" : ""}${latest.spo2 - previous.spo2}%`
                      : "—"}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3">
                <p className="text-[0.65rem] uppercase tracking-wider text-teal-600">Temp</p>
                <p className="text-lg font-semibold text-teal-900 font-mono">{latest.temperature != null ? `${latest.temperature.toFixed(1)} °F` : "—"}</p>
                {previous && (
                  <p className="text-xs text-teal-700">
                    Δ {latest.temperature != null && previous.temperature != null
                      ? `${(latest.temperature - previous.temperature).toFixed(1)} °F`
                      : "—"}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3">
                <p className="text-[0.65rem] uppercase tracking-wider text-teal-600">BMI</p>
                <p className="text-lg font-semibold text-teal-900 font-mono">{latest.bmi != null ? latest.bmi.toFixed(1) : "—"}</p>
                {previous && (
                  <p className="text-xs text-teal-700">
                    Δ {latest.bmi != null && previous.bmi != null
                      ? `${(latest.bmi - previous.bmi).toFixed(1)}`
                      : "—"}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3">
                <p className="text-[0.65rem] uppercase tracking-wider text-teal-600">Audio sentiment</p>
                <p className="text-lg font-semibold text-teal-900 font-mono">{latest.sentiment_score != null ? latest.sentiment_score.toFixed(2) : "—"}</p>
                {previous && (
                  <p className="text-xs text-teal-700">
                    Δ {latest.sentiment_score != null && previous.sentiment_score != null
                      ? `${(latest.sentiment_score - previous.sentiment_score).toFixed(2)}`
                      : "—"}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3">
                <p className="text-[0.65rem] uppercase tracking-wider text-teal-600">Gait speed</p>
                <p className="text-lg font-semibold text-teal-900 font-mono">{latest.gait_avg_speed_mps != null ? `${latest.gait_avg_speed_mps.toFixed(2)} m/s` : "—"}</p>
                {previous && (
                  <p className="text-xs text-teal-700">
                    Δ {latest.gait_avg_speed_mps != null && previous.gait_avg_speed_mps != null
                      ? `${(latest.gait_avg_speed_mps - previous.gait_avg_speed_mps).toFixed(2)}`
                      : "—"}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <section className="mb-8 space-y-8">
          <div>
            <h2 className="text-lg font-semibold text-teal-900">Multimodal subsystem trends</h2>
            <p className="text-sm text-teal-600 mt-1">
              Face, audio, and gait metrics across the demo visit timeline — each chart uses the full width below its title.
            </p>
          </div>

          <Card className="border-teal-200 bg-white/80 backdrop-blur w-full shadow-sm">
            <CardHeader className="border-b border-teal-100 pb-4 pt-6 px-6">
              <CardTitle className="text-xl font-semibold text-teal-900 tracking-tight">
                Face subsystem
              </CardTitle>
              <p className="text-sm text-teal-600 font-normal mt-1">
                Emotion distribution (happy, angry, neutral, sad, surprise) over visits
              </p>
            </CardHeader>
            <CardContent className="px-4 sm:px-6 pb-6 pt-4">
              <div className="relative h-[min(420px,50vh)] min-h-[300px] w-full">
                <Chart type="line" data={faceChart} options={lineOpts} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-teal-200 bg-white/80 backdrop-blur w-full shadow-sm">
            <CardHeader className="border-b border-teal-100 pb-4 pt-6 px-6">
              <CardTitle className="text-xl font-semibold text-teal-900 tracking-tight">
                Audio subsystem
              </CardTitle>
              <p className="text-sm text-teal-600 font-normal mt-1">
                Sentiment score and diagnostic language density over visits
              </p>
            </CardHeader>
            <CardContent className="px-4 sm:px-6 pb-6 pt-4">
              <div className="relative h-[min(420px,50vh)] min-h-[300px] w-full">
                <Chart type="line" data={audioChart} options={twoAxisSentimentOptions} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-teal-200 bg-white/80 backdrop-blur w-full shadow-sm">
            <CardHeader className="border-b border-teal-100 pb-4 pt-6 px-6">
              <CardTitle className="text-xl font-semibold text-teal-900 tracking-tight">
                Gait subsystem
              </CardTitle>
              <p className="text-sm text-teal-600 font-normal mt-1">
                Walking speed, symmetry, and stability over visits
              </p>
            </CardHeader>
            <CardContent className="px-4 sm:px-6 pb-6 pt-4">
              <div className="relative h-[min(420px,50vh)] min-h-[300px] w-full">
                <Chart type="line" data={gaitChart} options={gaitOptions} />
              </div>
            </CardContent>
          </Card>
        </section>

        <Card className="border-teal-200 bg-white/80 backdrop-blur mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-teal-600">
              AI assessment snapshot by visit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {snaps.map((s) => (
              <div
                key={`${s.visit_id}-ai`}
                className={cn(
                  "rounded-lg border border-teal-200 bg-teal-50/60 p-4",
                  visitId && s.visit_id === visitId && "ring-2 ring-teal-300"
                )}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-teal-900">
                    Visit #{s.visit_number} · {format(new Date(s.visit_date), "MMM d, yyyy")}
                  </span>
                  <span
                    className={cn(
                      "text-[0.65rem] uppercase tracking-wide px-2 py-0.5 rounded border",
                      s.ai_assessment?.risk_level === "high"
                        ? "bg-red-100 text-red-800 border-red-200"
                        : "bg-amber-100 text-amber-800 border-amber-200"
                    )}
                  >
                    Risk: {s.ai_assessment?.risk_level ?? "n/a"}
                  </span>
                </div>
                <p className="text-xs text-teal-700 mb-2">{s.chief_complaint}</p>
                <ul className="list-disc pl-5 text-sm text-teal-900 space-y-1">
                  {(s.ai_assessment?.suggested_diagnoses || []).map((dx, i) => (
                    <li key={i}>{dx}</li>
                  ))}
                </ul>
                {s.ai_assessment?.follow_up_recommendations && (
                  <p className="text-sm text-teal-800 mt-3">
                    <span className="font-semibold">Follow-up:</span>{" "}
                    {s.ai_assessment.follow_up_recommendations}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <p className="text-xs text-teal-600">
          Live patient-specific trend view from stored visits.
        </p>
          </>
        )}
      </div>
    </div>
  );
}
