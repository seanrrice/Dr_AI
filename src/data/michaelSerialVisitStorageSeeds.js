/**
 * Full Visit-shaped rows for the primary serial-trend demo patient (patient-demo-1),
 * aligned with `demoSerialVisitSnapshots` — same ids and recovery timeline.
 */
import { demoSerialVisitSnapshots } from "@/data/reportSerialTrendDemoData";

const TRANSCRIPTIONS = [
  `Doctor: What breathing changes have you noticed since your symptoms began, and what activities trigger the worst episodes?
Patient: For the last couple of months I get short of breath doing things that used to be easy. Climbing one flight of stairs makes me stop halfway to catch my breath, and carrying groceries in from the car can make me pause for one to two minutes. I notice the breathlessness most in the evening and when I walk quickly. I also have an intermittent dry cough and occasional mild wheeze. Lying flat feels uncomfortable, so I have been sleeping with two pillows. The symptoms are affecting my routine because I avoid stairs, park closer to entrances, and feel anxious when I get winded.
`,
  `Doctor: How are you doing since starting treatment and breathing exercises?
Patient: The inhaler and breathing exercises are helping. I still get shortness of breath on stairs, but I recover faster and the cough is less frequent.`,
  `Doctor: Compared with last visit, what has improved and what still limits you?
Patient: Breathing is noticeably better. I can walk longer distances now and only feel mild shortness of breath if I push myself uphill or carry something heavy.`,
  `Doctor: How close are you to your usual baseline activity now?
Patient: I feel close to normal again. I can manage stairs without stopping most days, and shortness of breath only shows up with heavier exertion.`,
];

const PHYSICIAN_NOTES = [
  "Initial respiratory evaluation: exertional shortness of breath prominent, dry cough and mild wheeze reported. Started treatment plan and close follow-up.",
  "Early improvement noted with fewer shortness-of-breath episodes and better recovery after exertion.",
  "Functional tolerance improving; residual symptoms now limited to heavier exertion.",
  "Recovery-focused follow-up: near-baseline breathing with low residual symptom burden.",
];

const KEYWORD_SERIES = [
  { breathlessness: 10, breath: 8, wheeze: 6, cough: 5 },
  { breathlessness: 6, breath: 5, wheeze: 3, cough: 2 },
  { breathlessness: 3, breath: 2, wheeze: 2, cough: 1 },
  { breathlessness: 1, breath: 1, wheeze: 1, cough: 0 },
];

const TOTAL_WORDS = [146, 52, 38, 31];

function keywordFromSnapshot(_s, idx) {
  const counts = KEYWORD_SERIES[idx] || {};
  const top = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word, count]) => ({
      word,
      count,
      category: word === "cough" ? "RESPIRATORY" : "DYSPNEA",
    }));
  const keywordTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    total_words: TOTAL_WORDS[idx] || 40,
    diagnostic_keywords: counts,
    keyword_percentage: Math.round((keywordTotal / (TOTAL_WORDS[idx] || 40)) * 1000) / 10,
    top_keywords: top,
  };
}

function sentimentFromSnapshot(s) {
  const score = s.sentiment_score;
  return {
    overall_sentiment: score <= -0.3 ? "negative" : score >= 0.2 ? "positive" : "neutral",
    sentiment_score: score,
    distress_level: score <= -0.45 ? "high" : score <= -0.28 ? "medium" : "low",
    emotional_indicators:
      score <= -0.35
        ? ["worry", "fatigue", "air hunger", "activity limitation"]
        : score < 0
          ? ["cautious optimism", "mild fatigue", "symptom monitoring"]
          : ["relief", "confidence", "improving stamina"],
  };
}

function semanticFromSnapshot(s, idx) {
  return {
    key_themes: [
      "shortness of breath on exertion",
      idx <= 1 ? "activity intolerance" : "functional recovery",
      idx <= 1 ? "dry cough" : "improving respiratory symptoms",
      idx >= 2 ? "staged return to activity" : "treatment response",
      "serial monitoring benefit",
    ],
    symptom_severity: idx === 0 ? "moderate" : idx === 1 ? "mild to moderate" : idx === 2 ? "mild" : "minimal",
    functional_impact: idx === 0 ? "stairs and errands limited" : idx === 1 ? "improving exercise tolerance" : idx === 2 ? "mostly preserved with heavier exertion limits" : "near-baseline activity tolerance",
    temporal_patterns: idx <= 1 ? "Improving over weeks after treatment start" : "Continued improvement across serial follow-up",
  };
}

function fullAiAssessment(s) {
  const a = s.ai_assessment;
  return {
    suggested_diagnoses: a.suggested_diagnoses,
    recommended_tests: [
      "Pulse oximetry trend review and ambulatory vitals",
      "Chest imaging or spirometry if symptoms plateau or worsen",
      "CBC, CMP, and targeted respiratory workup as clinically indicated",
      "Functional exercise tolerance assessment",
    ],
    treatment_suggestions: [
      "Continue inhaler regimen and breathing exercises",
      "Structured walking program with gradual activity progression",
      "Reinforce trigger avoidance and pacing strategies",
      "Escalate pulmonary evaluation only if recovery stalls",
    ],
    patient_education: [
      "Track shortness-of-breath episodes, recovery time, and exertion tolerance between visits",
      "Use rescue medications as directed and pace activity increases gradually",
      "Seek urgent care for worsening hypoxia, chest pain, or severe respiratory distress",
    ],
    follow_up_recommendations: a.follow_up_recommendations,
  };
}

export function buildMichaelSerialStorageVisits() {
  return demoSerialVisitSnapshots.map((s, idx) => ({
    id: s.visit_id,
    patient_id: "patient-demo-1",
    visit_number: s.visit_number,
    visit_date: s.visit_date,
    chief_complaint: s.chief_complaint,
    bp_systolic: s.bp_systolic,
    bp_diastolic: s.bp_diastolic,
    heart_rate: s.heart_rate,
    respiratory_rate: s.respiratory_rate,
    temperature: s.temperature,
    temperature_unit: s.temperature_unit || "fahrenheit",
    spo2: s.spo2,
    height: s.height,
    weight: s.weight,
    bmi: s.bmi,
    transcription: TRANSCRIPTIONS[idx],
    physician_notes: PHYSICIAN_NOTES[idx],
    keyword_analysis: keywordFromSnapshot(s, idx),
    sentiment_analysis: sentimentFromSnapshot(s),
    semantic_analysis: semanticFromSnapshot(s, idx),
    ai_assessment: fullAiAssessment(s),
    created_date: `${s.visit_date}T15:00:00.000Z`,
    updated_date: `${s.visit_date}T15:00:00.000Z`,
  }));
}
