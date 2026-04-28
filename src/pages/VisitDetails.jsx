import React, { useState, useEffect } from "react";
import { api } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Brain, TrendingUp, Activity, AlertCircle, GitCompare, Download, Mic, Eye, PersonStanding } from "lucide-react";
import { format } from "date-fns";
import { generateVisitPDF } from "@/utils/pdfGenerator";

const FLASK_URL = "http://localhost:5000";

// ── Subsystem Report Section ──────────────────────────────────────────────────
function SubsystemReport({ visitId }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("audio");
  const pollRef = React.useRef(null);

  const fetchReport = React.useCallback(async (triggerIntegrate = false) => {
    if (!visitId) return;
    try {
      if (triggerIntegrate) {
        await fetch(`${FLASK_URL}/api/visits/${visitId}/integrate`, { method: 'POST' });
      }
      const r = await fetch(`${FLASK_URL}/api/visits/${visitId}/report`);
      const data = await r.json();
      setReport(data);
      setLoading(false);
      return data;
    } catch {
      setLoading(false);
      return null;
    }
  }, [visitId]);

  useEffect(() => {
    if (!visitId) return;
    // Load report on mount
    fetchReport(false);

    // Poll manifest every 4s — when face or gait flips to available,
    // re-run integration and update the report automatically
    let lastFaceStatus = null;
    let lastGaitStatus = null;

    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${FLASK_URL}/api/visits/${visitId}/status`);
        if (!r.ok) return;
        const manifest = await r.json();
        const faceStatus = manifest?.status?.face;
        const gaitStatus = manifest?.status?.gait;

        const faceJustDone = faceStatus === 'done' && lastFaceStatus !== 'done';
        const gaitJustDone = gaitStatus === 'done' && lastGaitStatus !== 'done';

        if (faceJustDone || gaitJustDone) {
          console.log('[AutoUpdate] New subsystem data detected — regenerating report');
          await fetchReport(true);
        }

        lastFaceStatus = faceStatus;
        lastGaitStatus = gaitStatus;
      } catch {}
    }, 4000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [visitId, fetchReport]);

  if (loading) {
    return (
      <Card className="bg-white border-none shadow-lg mb-6">
        <CardContent className="pt-6 text-center text-sm text-slate-500 py-8">
          Loading subsystem data...
        </CardContent>
      </Card>
    );
  }

  const availability = report ? (report.availability || {}) : {};
  const sections = report ? (report.sections || {}) : {};

  const tabs = [
    { id: "audio", label: "🎤 Audio", status: availability.audio },
    { id: "face",  label: "😐 Facial", status: availability.face },
    { id: "gait",  label: "🚶 Gait",  status: availability.gait },
  ];

  return (
    <Card className="bg-white border-none shadow-lg mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Multimodal Subsystem Analysis
          </CardTitle>
          <button
            onClick={() => fetchReport(true)}
            className="text-xs text-slate-400 hover:text-teal-600 rounded px-2 py-1 border border-slate-200 hover:border-teal-300"
            title="Manually refresh if auto-update hasn't triggered"
          >
            ↻
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-1">Combined results from audio, facial, and gait subsystems</p>
        <div className="mt-3 bg-slate-50 border border-slate-200 rounded p-3">
          <p className="text-xs font-semibold text-slate-700 mb-1">Visit ID :</p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-white border border-slate-200 rounded px-2 py-1 flex-1 select-all text-teal-700 font-mono">
              {visitId}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(visitId)}
              className="text-xs border border-slate-300 rounded px-2 py-1 hover:bg-slate-100"
            >
              Copy
            </button>
          </div>
          <p className="text-xs font-semibold text-slate-700 mt-2 mb-1">Manual fallback:</p>
          <p className="text-xs text-slate-500 mt-2">
            Normally, face analysis should be started from the New Visit page.
          </p>
          <pre className="text-xs bg-white border border-slate-200 rounded px-2 py-1 text-slate-600 whitespace-pre-wrap select-all">
{`python emotion_pipeline/webcam_emotion_mediapipe.py --visit_id ${visitId} --patient_mrn <patient_mrn> --runs_dir DrAITranscription/runs`}
          </pre>
          <p className="text-xs text-slate-400 mt-1"></p>
        </div>
      </CardHeader>
      <CardContent>

        {/* Tab Bar */}
        <div className="flex gap-2 mb-6 border-b border-slate-200 pb-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-t text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === tab.id
                  ? "bg-teal-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                tab.status === "available"
                  ? "bg-green-200 text-green-800"
                  : "bg-slate-200 text-slate-500"
              }`}>
                {tab.status === "available" ? "✓" : "pending"}
              </span>
            </button>
          ))}
        </div>

        {/* ── Audio Tab ── */}
        {activeTab === "audio" && (
          availability.audio === "available" && sections.audio ? (
            <AudioTab data={sections.audio} />
          ) : (
            <PendingTab name="Audio" hint="Audio JSONL is saved automatically when you analyze a visit." />
          )
        )}

        {/* ── Face Tab ── */}
        {activeTab === "face" && (
          availability.face === "available" && sections.face ? (
            <FaceTab data={sections.face} />
          ) : (
            <PendingTab
              name="Facial"
              hint={`Face teammate needs to run:\npython webcam_emotion_mediapipe.py --visit_id ${visitId} --patient_mrn <patient_mrn> --runs_dir ../DrAITranscription/runs`}
            />
          )
        )}

        {/* ── Gait Tab ── */}
        {activeTab === "gait" && (
          availability.gait === "available" && sections.gait ? (
            <GaitTab data={sections.gait} />
          ) : (
            <PendingTab name="Gait" hint="Gait subsystem integration coming soon." />
          )
        )}

      </CardContent>
    </Card>
  );
}

function PendingTab({ name, hint }) {
  return (
    <div className="text-center py-10 text-slate-500">
      <AlertCircle className="w-10 h-10 mx-auto mb-3 text-slate-300" />
      <p className="font-medium text-slate-600 mb-2">{name} data not yet available</p>
      {hint && (
        <pre className="text-xs bg-slate-50 rounded p-3 text-left max-w-xl mx-auto whitespace-pre-wrap text-slate-500 mt-3">
          {hint}
        </pre>
      )}
    </div>
  );
}

function AudioTab({ data }) {
  const summary = data.summary || {};
  const features = summary.features || {};
  const sentiment = features.sentiment_analysis || {};
  const keywords = features.keyword_analysis || {};
  const windows = data.windows || [];

  // Use integrator-processed fields if available, fallback to window-level fields
  const distressLevel = data.distress_level || sentiment.distress_level || "—";
  const trajectory = data.distress_trajectory || "stable";
  const emotionalIndicators = data.emotional_indicators || sentiment.emotional_indicators || [];
  const avgSentiment = data.avg_sentiment_polarity ?? sentiment.sentiment_score;
  const totalWords = data.total_words || keywords.total_words || features.word_count || "—";
  const topWords = data.top_words || keywords.top_keywords || [];
  const diagnosticTerms = data.diagnostic_terms || [];

  const trajectoryColor = trajectory === "improving" ? "text-green-600" : trajectory === "worsening" ? "text-red-600" : "text-slate-500";
  const trajectoryArrow = trajectory === "improving" ? "↓" : trajectory === "worsening" ? "↑" : "→";

  return (
    <div className="space-y-5">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox
          label="Avg Sentiment"
          value={avgSentiment != null ? avgSentiment.toFixed(2) : "—"}
          color={avgSentiment < -0.5 ? "red" : avgSentiment < 0 ? "yellow" : "green"}
        />
        <StatBox
          label="Distress Level"
          value={distressLevel.toUpperCase()}
          color={distressLevel === "high" ? "red" : distressLevel === "medium" ? "yellow" : "green"}
        />
        <StatBox label="Total Words" value={totalWords} color="slate" />
        <StatBox label="Windows" value={windows.length || data.total_windows || "—"} color="blue" />
      </div>

      {/* Sentiment Trajectory */}
      <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
        <span className="text-xs text-slate-600 font-medium">Sentiment Trajectory:</span>
        <span className={`text-sm font-semibold capitalize ${trajectoryColor}`}>
          {trajectoryArrow} {trajectory}
        </span>
        <span className="text-xs text-slate-400 ml-auto">{windows.length} audio windows analyzed</span>
      </div>

      {/* Emotional Indicators */}
      {emotionalIndicators.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Emotional Indicators Detected</h4>
          <div className="flex flex-wrap gap-2">
            {emotionalIndicators.map((ind, i) => (
              <span key={i} className="text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded-full px-2 py-1 capitalize">
                {ind.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top Diagnostic Words */}
      {topWords.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Top Diagnostic Keywords</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {topWords.slice(0, 9).map((kw, i) => {
              const word = Array.isArray(kw) ? kw[0] : kw.word;
              const count = Array.isArray(kw) ? kw[1] : kw.count;
              const cat = Array.isArray(kw) ? "" : kw.category;
              return (
                <div key={i} className="flex items-center justify-between p-2 bg-slate-50 rounded text-sm">
                  <span className="font-medium capitalize">{word}</span>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-xs">{count}x</Badge>
                    {cat && <span className="text-xs text-slate-400">{cat.split("_")[0]}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Diagnostic Terms from windows */}
      {diagnosticTerms.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Clinical Terms Detected</h4>
          <div className="flex flex-wrap gap-2">
            {diagnosticTerms.slice(0, 12).map(([term, category], i) => (
              <span key={i} className="text-xs bg-teal-50 border border-teal-200 text-teal-700 rounded-full px-2 py-1">
                {term} <span className="text-teal-400">· {category}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FaceTab({ data }) {
  const features = data.features || {};
  const emotionPct = features.emotion_pct || {};
  const emotionCounts = features.emotion_counts || {};
  const dominant = emotionPct
    ? Object.entries(emotionPct).sort((a, b) => b[1] - a[1])[0]
    : null;

  const emotionColors = {
    angry: "bg-red-400",
    happy: "bg-yellow-400",
    sad: "bg-blue-400",
    surprise: "bg-green-400",
    neutral: "bg-slate-400",
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatBox label="Dominant Emotion" value={dominant ? dominant[0].replace("_", " ").toUpperCase() : "—"} color="blue" />
        <StatBox label="Dominant %" value={dominant ? `${dominant[1].toFixed(1)}%` : "—"} color="teal" />
        <StatBox label="Total Samples" value={features.total_samples ?? "—"} color="slate" />
      </div>

      {/* Emotion Bar Chart */}
      {Object.keys(emotionPct).length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Emotion Distribution</h4>
          <div className="space-y-2">
            {Object.entries(emotionPct)
              .sort((a, b) => b[1] - a[1])
              .map(([emotion, pct]) => (
                <div key={emotion} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 w-24 capitalize">{emotion.replace("_", " ")}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${emotionColors[emotion] || "bg-teal-400"} transition-all`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-slate-700 w-12 text-right">{pct.toFixed(1)}%</span>
                </div>
              ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Model: {data.model_version || "resnet34_5class"} · Visit label: {features.visit_label || "—"}
      </p>
    </div>
  );
}

function GaitTab({ data }) {
  const features = data.features || {};
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {features.speed_ms    && <StatBox label="Walking Speed" value={`${features.speed_ms} m/s`} color="blue" />}
        {features.symmetry    && <StatBox label="Symmetry" value={`${features.symmetry}%`} color="teal" />}
        {features.stability   && <StatBox label="Stability" value={features.stability} color="green" />}
        {features.sit_to_stand && <StatBox label="Sit-to-Stand" value={`${features.sit_to_stand}s`} color="slate" />}
      </div>
      {Object.keys(features).length === 0 && (
        <p className="text-sm text-slate-500">Gait features not yet available.</p>
      )}
    </div>
  );
}

function StatBox({ label, value, color = "slate" }) {
  const colors = {
    red:   "bg-red-50 text-red-900",
    yellow:"bg-yellow-50 text-yellow-900",
    green: "bg-green-50 text-green-900",
    blue:  "bg-blue-50 text-blue-900",
    teal:  "bg-teal-50 text-teal-900",
    slate: "bg-slate-50 text-slate-900",
  };
  return (
    <div className={`text-center p-3 rounded-lg ${colors[color] || colors.slate}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs mt-1 opacity-70">{label}</div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function VisitDetails() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const visitId = urlParams.get('id');
  const fromReport = urlParams.get('from') === 'report';
  const [showComparison, setShowComparison] = useState(false);

  const { data: visit, isLoading } = useQuery({
    queryKey: ['visit', visitId],
    queryFn: async () => {
      const visits = await api.entities.Visit.filter({ id: visitId });
      return visits[0];
    },
    enabled: !!visitId
  });

  const { data: patient } = useQuery({
    queryKey: ['patient', visit?.patient_mrn],
    queryFn: async () => {
      const patients = await api.entities.Patient.filter({ medical_record_number: visit.patient_mrn });
      return patients[0];
    },
    enabled: !!visit?.patient_mrn
  });

  const handleExportPDF = async () => {
    if (!(visit && patient)) return;
    try {
      const r = await fetch(`${FLASK_URL}/api/visits/${visit.id}/report`);
      const report = r.ok ? await r.json() : null;
      generateVisitPDF(visit, patient, report);
    } catch {
      generateVisitPDF(visit, patient, null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-6">
        <div className="text-slate-500">Loading visit details...</div>
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-6">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Visit not found</p>
        </div>
      </div>
    );
  }

  const tempUnit = visit.temperature_unit || 'fahrenheit';
  const tempSymbol = tempUnit === 'celsius' ? '°C' : '°F';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                fromReport && visitId
                  ? navigate(createPageUrl(`ReportSummary?visitId=${visitId}`))
                  : navigate(createPageUrl("Dashboard"))
              }
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Visit Details</h1>
              <p className="text-slate-600">Complete analysis and assessment</p>
            </div>
          </div>
          <Button
            onClick={handleExportPDF}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Download className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
        </div>

        {/* Patient and Visit Info Card */}
        <Card className="bg-white border-none shadow-lg mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-600 mb-3">Patient Information</h3>
                {patient && (
                  <div className="space-y-2 text-sm">
                    <div><span className="font-medium">Name:</span> {patient.first_name} {patient.last_name}</div>
                    {patient.medical_record_number && (
                      <div><span className="font-medium">MRN:</span> {patient.medical_record_number}</div>
                    )}
                    {patient.primary_diagnosis && (
                      <div><span className="font-medium">Diagnosis:</span> {patient.primary_diagnosis}</div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-600 mb-3">Visit Information</h3>
                <div className="space-y-2 text-sm">
                  <div><span className="font-medium">Visit #:</span> {visit.visit_number}</div>
                  <div><span className="font-medium">Date:</span> {format(new Date(visit.visit_date), 'MMM d, yyyy')}</div>
                  {visit.chief_complaint && (
                    <div><span className="font-medium">Chief Complaint:</span> {visit.chief_complaint}</div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Vital Signs Card */}
        {(visit.bp_systolic || visit.heart_rate) && (
          <Card className="bg-white border-none shadow-lg mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Vital Signs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {visit.bp_systolic && visit.bp_diastolic && (
                  <div className="text-center p-4 bg-slate-50 rounded-lg">
                    <div className="text-2xl font-bold text-slate-900">{visit.bp_systolic}/{visit.bp_diastolic}</div>
                    <div className="text-xs text-slate-600 mt-1">BP (mmHg)</div>
                  </div>
                )}
                {visit.heart_rate && (
                  <div className="text-center p-4 bg-slate-50 rounded-lg">
                    <div className="text-2xl font-bold text-slate-900">{visit.heart_rate}</div>
                    <div className="text-xs text-slate-600 mt-1">HR (bpm)</div>
                  </div>
                )}
                {visit.respiratory_rate && (
                  <div className="text-center p-4 bg-slate-50 rounded-lg">
                    <div className="text-2xl font-bold text-slate-900">{visit.respiratory_rate}</div>
                    <div className="text-xs text-slate-600 mt-1">RR (/min)</div>
                  </div>
                )}
                {visit.temperature && (
                  <div className="text-center p-4 bg-slate-50 rounded-lg">
                    <div className="text-2xl font-bold text-slate-900">{visit.temperature}</div>
                    <div className="text-xs text-slate-600 mt-1">Temp ({tempSymbol})</div>
                  </div>
                )}
                {visit.spo2 && (
                  <div className="text-center p-4 bg-slate-50 rounded-lg">
                    <div className="text-2xl font-bold text-slate-900">{visit.spo2}%</div>
                    <div className="text-xs text-slate-600 mt-1">SpO2</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Gait Analysis Card */}
        {visit.gait_summary && (
          <Card className="bg-white border-none shadow-lg mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Gait Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                <div className="p-4 bg-slate-50 rounded-lg">
                  <div className="text-sm text-slate-500">Speed</div>
                  <div className="text-xl font-semibold">
                    {visit.gait_summary.mean_speed_mps != null ? `${Number(visit.gait_summary.mean_speed_mps).toFixed(2)} m/s` : 'N/A'}
                  </div>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <div className="text-sm text-slate-500">Cadence</div>
                  <div className="text-xl font-semibold">
                    {visit.gait_summary.cadence_spm != null ? `${Number(visit.gait_summary.cadence_spm).toFixed(1)} spm` : 'N/A'}
                  </div>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <div className="text-sm text-slate-500">Steps</div>
                  <div className="text-xl font-semibold">
                    {visit.gait_summary.num_steps_est ?? 'N/A'}
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div><span className="font-medium">Summary:</span> {visit.gait_summary_text || visit.gait_summary.summary_text || 'N/A'}</div>
                <div><span className="font-medium">Knee symmetry index:</span> {visit.gait_summary.knee_symmetry_index_percent != null ? `${Number(visit.gait_summary.knee_symmetry_index_percent).toFixed(1)}%` : 'N/A'}</div>
                <div><span className="font-medium">AP stability RMS:</span> {visit.gait_summary.stability_ap_rms_m != null ? `${Number(visit.gait_summary.stability_ap_rms_m).toFixed(3)} m` : 'N/A'}</div>
                <div><span className="font-medium">ML stability RMS:</span> {visit.gait_summary.stability_ml_rms_m != null ? `${Number(visit.gait_summary.stability_ml_rms_m).toFixed(3)} m` : 'N/A'}</div>
                <div><span className="font-medium">Sit-to-stand:</span> {visit.gait_summary.sit_to_stand_detected ? 'Detected' : 'Not detected'}</div>
              </div>

              {visit.gait_overlay_video_url && (
                <video
                  controls
                  className="w-full mt-4 rounded-lg border"
                  src={visit.gait_overlay_video_url}
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* Transcription Card */}
        {visit.transcription && (
          <Card className="bg-white border-none shadow-lg mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Patient Transcription
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-slate-50 p-4 rounded-lg font-mono text-sm whitespace-pre-wrap">
                {visit.transcription}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Keyword Analysis Card */}
        {visit.keyword_analysis && (
          <Card className="bg-white border-none shadow-lg mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Keyword Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-900">{visit.keyword_analysis.total_words}</div>
                  <div className="text-sm text-blue-700">Total Words</div>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-900">
                    {Object.keys(visit.keyword_analysis.diagnostic_keywords || {}).length}
                  </div>
                  <div className="text-sm text-green-700">Diagnostic Keywords</div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-900">
                    {visit.keyword_analysis.keyword_percentage}%
                  </div>
                  <div className="text-sm text-purple-700">Keyword Density</div>
                </div>
              </div>

              {visit.keyword_analysis.top_keywords && visit.keyword_analysis.top_keywords.length > 0 && (
                <div className="mb-6">
                  <h4 className="font-semibold text-sm mb-3">Top Diagnostic Keywords:</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {visit.keyword_analysis.top_keywords.map((kw, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{kw.count}x</Badge>
                          <span className="font-medium text-sm">{kw.word}</span>
                        </div>
                        <span className="text-xs text-slate-500">{kw.category}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {visit.keyword_analysis.inter_word_frequency &&
               Object.keys(visit.keyword_analysis.inter_word_frequency).length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-3">Symptom Co-occurrence Patterns:</h4>
                  <div className="space-y-2">
                    {Object.entries(visit.keyword_analysis.inter_word_frequency)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 10)
                      .map(([pair, count], idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                          <span className="font-medium text-sm text-amber-900">{pair}</span>
                          <Badge className="bg-amber-200 text-amber-900">{count} times</Badge>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Sentiment Analysis Card */}
        {visit.sentiment_analysis && (
          <Card className="bg-white border-none shadow-lg mb-6">
            <CardHeader>
              <CardTitle>Sentiment & Emotional Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="text-center p-4 bg-slate-50 rounded-lg">
                  <Badge className={
                    visit.sentiment_analysis.overall_sentiment === 'positive' ? 'bg-green-100 text-green-800' :
                    visit.sentiment_analysis.overall_sentiment === 'negative' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }>
                    {visit.sentiment_analysis.overall_sentiment.toUpperCase()}
                  </Badge>
                  <div className="text-sm text-slate-600 mt-2">Overall Sentiment</div>
                </div>
                <div className="text-center p-4 bg-slate-50 rounded-lg">
                  <div className="text-2xl font-bold text-slate-900">{visit.sentiment_analysis.sentiment_score}</div>
                  <div className="text-sm text-slate-600">Sentiment Score</div>
                </div>
                <div className="text-center p-4 bg-slate-50 rounded-lg">
                  <Badge className={
                    visit.sentiment_analysis.distress_level === 'high' ? 'bg-red-500' :
                    visit.sentiment_analysis.distress_level === 'medium' ? 'bg-yellow-500' :
                    'bg-green-500'
                  }>
                    {visit.sentiment_analysis.distress_level.toUpperCase()}
                  </Badge>
                  <div className="text-sm text-slate-600 mt-2">Distress Level</div>
                </div>
              </div>

              {visit.sentiment_analysis.emotional_indicators &&
               visit.sentiment_analysis.emotional_indicators.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">Emotional Indicators:</h4>
                  <div className="flex flex-wrap gap-2">
                    {visit.sentiment_analysis.emotional_indicators.map((indicator, idx) => (
                      <Badge key={idx} variant="outline">{indicator}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Semantic Analysis Card */}
        {visit.semantic_analysis && (
          <Card className="bg-white border-none shadow-lg mb-6">
            <CardHeader>
              <CardTitle>Semantic Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {visit.semantic_analysis.key_themes && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Key Themes:</h4>
                    <div className="flex flex-wrap gap-2">
                      {visit.semantic_analysis.key_themes.map((theme, idx) => (
                        <Badge key={idx} className="bg-blue-100 text-blue-800">{theme}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {visit.semantic_analysis.symptom_severity && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-xs text-slate-600">Symptom Severity</div>
                      <div className="font-semibold text-slate-900">{visit.semantic_analysis.symptom_severity}</div>
                    </div>
                  )}
                  {visit.semantic_analysis.functional_impact && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-xs text-slate-600">Functional Impact</div>
                      <div className="font-semibold text-slate-900">{visit.semantic_analysis.functional_impact}</div>
                    </div>
                  )}
                  {visit.semantic_analysis.temporal_patterns && (
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-xs text-slate-600">Temporal Pattern</div>
                      <div className="font-semibold text-slate-900">{visit.semantic_analysis.temporal_patterns}</div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Assessment Card */}
        {visit.ai_assessment && (
          <Card className="bg-white border-none shadow-lg mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                AI Diagnostic Assessment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {visit.ai_assessment.suggested_diagnoses && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-blue-200">
                      <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                      <h4 className="font-semibold text-base text-slate-800">Differential Diagnosis</h4>
                    </div>
                    <div className="space-y-2 pl-4">
                      {visit.ai_assessment.suggested_diagnoses.map((diagnosis, idx) => (
                        <div key={idx} className="text-slate-700 py-1">{diagnosis}</div>
                      ))}
                    </div>
                  </div>
                )}
                {visit.ai_assessment.recommended_tests && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-green-200">
                      <div className="w-2 h-2 rounded-full bg-green-600"></div>
                      <h4 className="font-semibold text-base text-slate-800">Recommended Workup</h4>
                    </div>
                    <div className="space-y-2 pl-4">
                      {visit.ai_assessment.recommended_tests.map((test, idx) => (
                        <div key={idx} className="text-slate-700 py-1">{test}</div>
                      ))}
                    </div>
                  </div>
                )}
                {visit.ai_assessment.treatment_suggestions && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-purple-200">
                      <div className="w-2 h-2 rounded-full bg-purple-600"></div>
                      <h4 className="font-semibold text-base text-slate-800">Treatment Plan</h4>
                    </div>
                    <div className="space-y-2 pl-4">
                      {visit.ai_assessment.treatment_suggestions.map((treatment, idx) => (
                        <div key={idx} className="text-slate-700 py-1">{treatment}</div>
                      ))}
                    </div>
                  </div>
                )}

                {visit.ai_assessment.patient_education && visit.ai_assessment.patient_education.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-teal-200">
                      <div className="w-2 h-2 rounded-full bg-teal-600"></div>
                      <h4 className="font-semibold text-base text-slate-800">Patient Education</h4>
                    </div>
                    <div className="space-y-2 pl-4">
                      {visit.ai_assessment.patient_education.map((item, idx) => (
                        <div key={idx} className="text-slate-700 py-1">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Follow-up */}
                {visit.ai_assessment.follow_up_recommendations && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-amber-200">
                      <div className="w-2 h-2 rounded-full bg-amber-600"></div>
                      <h4 className="font-semibold text-base text-slate-800">Follow-up</h4>
                    </div>
                    <div className="pl-4">
                      <p className="text-slate-700 leading-relaxed">{visit.ai_assessment.follow_up_recommendations}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── MULTIMODAL SUBSYSTEM REPORT (NEW) ── */}
        <SubsystemReport visitId={visitId} />

        {/* Physician Notes */}
        {visit.physician_notes && (
          <Card className="bg-white border-none shadow-lg mb-6">
            <CardHeader>
              <CardTitle>Physician Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-slate-50 p-4 rounded-lg">
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{visit.physician_notes}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Model Comparison */}
        {visit.ai_comparison && (
          <Card className="bg-white border-none shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <GitCompare className="w-5 h-5" />
                  AI Model Comparison
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowComparison(!showComparison)}
                >
                  {showComparison ? 'Hide' : 'Show'} Comparison
                </Button>
              </div>
            </CardHeader>
            {showComparison && (
              <CardContent>
                <div className="space-y-6">
                  {visit.ai_comparison.openai && !visit.ai_comparison.errors?.openai && (
                    <div className="border border-blue-200 rounded-lg overflow-hidden">
                      <div className="bg-blue-100 px-4 py-3 border-b border-blue-200">
                        <h4 className="font-semibold text-blue-900">OpenAI GPT-4</h4>
                      </div>
                      <div className="p-5 bg-blue-50/30">
                        <div className="space-y-5">
                          {visit.ai_comparison.openai.diagnostic.suggested_diagnoses && (
                            <div>
                              <h5 className="font-semibold text-sm text-slate-600 mb-2 uppercase tracking-wide">Diagnoses</h5>
                              <div className="space-y-1 text-sm text-slate-700">
                                {visit.ai_comparison.openai.diagnostic.suggested_diagnoses.map((dx, idx) => (
                                  <div key={idx}>{dx}</div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {visit.ai_comparison.ollama && !visit.ai_comparison.errors?.ollama && (
                    <div className="border border-green-200 rounded-lg overflow-hidden">
                      <div className="bg-green-100 px-4 py-3 border-b border-green-200">
                        <h4 className="font-semibold text-green-900">Ollama Llama2</h4>
                      </div>
                      <div className="p-5 bg-green-50/30">
                        <div className="space-y-5">
                          {visit.ai_comparison.ollama.diagnostic.suggested_diagnoses && (
                            <div>
                              <h5 className="font-semibold text-sm text-slate-600 mb-2 uppercase tracking-wide">Diagnoses</h5>
                              <div className="space-y-1 text-sm text-slate-700">
                                {visit.ai_comparison.ollama.diagnostic.suggested_diagnoses.map((dx, idx) => (
                                  <div key={idx}>{typeof dx === 'string' ? dx : dx.name || JSON.stringify(dx)}</div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {visit.ai_comparison.errors && Object.keys(visit.ai_comparison.errors).length > 0 && (
                    <div className="border border-red-200 rounded-lg overflow-hidden">
                      <div className="bg-red-100 px-4 py-3 border-b border-red-200">
                        <h4 className="font-semibold text-red-900">Errors</h4>
                      </div>
                      <div className="p-4 bg-red-50">
                        {Object.entries(visit.ai_comparison.errors).map(([model, error]) => (
                          <div key={model} className="mb-2">
                            <span className="font-semibold text-sm capitalize">{model}:</span>
                            <span className="text-sm text-slate-700 ml-2">{error}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <p className="text-sm text-slate-600">
                      <strong>Note:</strong> The main assessment shown above uses consensus from both models.
                      This comparison shows individual model outputs for transparency.
                    </p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}