/** Aligns with seeded demo IDs in apiClient (`ensureDemoSeed`). */
export const DEMO_REPORT_VISIT_ID = "visit-demo-1";
export const DEMO_REPORT_PATIENT_ID = "patient-demo-1";
export const DEMO_REPORT_VISIT_ID_2 = "visit-demo-2";
export const DEMO_REPORT_PATIENT_ID_2 = "patient-demo-2";

/** Vital signs + visit context (same shape as New Visit / persisted visit fields). */
export const demoVisitSnapshot = {
  visit_date: "2026-03-28",
  chief_complaint: "Breathing easier overall with only mild shortness of breath during heavy exertion",
  bp_systolic: 130,
  bp_diastolic: 78,
  heart_rate: 86,
  respiratory_rate: 18,
  temperature: 98.4,
  temperature_unit: "fahrenheit",
  spo2: 96,
  height: 165,
  weight: 72,
  bmi: 26.4,
};

/** Demo AI assessment for the report tab (matches VisitDetails-style sections). */
export const demoAiAssessment = {
  suggested_diagnoses: [
    "Resolving exertional shortness of breath with strong treatment response",
    "Mild residual airway reactivity",
    "Deconditioning now improving with rehab plan",
  ],
  recommended_tests: [
    "Repeat pulse oximetry and exertional tolerance review",
    "Spirometry if shortness of breath plateaus or worsens",
    "CBC and targeted respiratory labs as clinically indicated",
    "Functional walk assessment for return-to-activity planning",
  ],
  treatment_suggestions: [
    "Continue inhaler regimen and breathing exercises",
    "Progress graded walking program as tolerated",
    "Maintain trigger avoidance and pacing strategies",
    "Use serial multimodal follow-up to confirm continued recovery",
  ],
  patient_education: [
    "Track shortness of breath, stairs tolerance, and recovery time after exertion",
    "Increase activity gradually as symptoms improve",
    "Seek urgent care for severe shortness of breath, chest pain, or new oxygen desaturation",
    "Continue maintenance plan even as symptoms improve",
  ],
  follow_up_recommendations:
    "Respiratory follow-up in 3-4 weeks to confirm sustained recovery and taper monitoring if stable.",
};

/** Sample transcription + NLP when a visit has no saved NLP fields (Report Summary tab). */
export const demoTranscriptionNlp = {
  transcription:
    "Doctor: Since starting treatment, how has your breathing changed?\n\nPatient: My breathing is much better than it was a month ago. I can walk across the parking lot and get up one flight of stairs with only mild shortness of breath now. The breathlessness mostly shows up if I hurry, carry something heavy, or walk uphill. My cough is almost gone, I am sleeping flatter, and I feel less anxious because I recover more quickly when I do get winded.\n\nDoctor: Any chest pain, wheezing, or nighttime symptoms now?\n\nPatient: No chest pain. Occasional mild wheeze, but far less than before. Overall I feel like I am getting back to normal.",
  speaker_segments: [
    { speaker: 0, text: "Improving shortness of breath, better exertional tolerance, cough nearly resolved." },
    { speaker: 1, text: "Focused respiratory follow-up and screening for persistent red flags." },
  ],
  keyword_analysis: {
    total_words: 67,
    diagnostic_keywords: { breathlessness: 3, breath: 2, wheeze: 2, cough: 1 },
    keyword_percentage: 11.9,
    top_keywords: [
      { count: 3, word: "breathlessness", category: "RESPIRATORY" },
      { count: 2, word: "breath", category: "RESPIRATORY" },
      { count: 2, word: "wheeze", category: "RESPIRATORY" },
      { count: 1, word: "cough", category: "RESPIRATORY" },
    ],
    inter_word_frequency: {
      "breathlessness, wheeze": 2,
      "breath, cough": 1,
      "breathlessness, breath": 2,
    },
  },
  sentiment_analysis: {
    overall_sentiment: "positive",
    sentiment_score: 0.12,
    distress_level: "low",
    emotional_indicators: ["relief", "confidence", "improving stamina"],
  },
  semantic_analysis: {
    key_themes: ["breathing recovery", "improved exertional tolerance", "reduced cough burden", "serial monitoring"],
    symptom_severity: "mild",
    functional_impact: "mostly preserved; symptoms only with heavier exertion",
    temporal_patterns: "Improving steadily over serial visits",
  },
  physician_notes: "Objective and subjective metrics both suggest recovery; continue current plan and use serial review to document sustained improvement.",
};

/** Second demo patient (Sarah Martinez) — fibromyalgia / widespread pain theme. */
export const demoVisitSnapshot2 = {
  visit_date: "2025-10-29",
  chief_complaint: "Pain all over entire body",
  bp_systolic: 118,
  bp_diastolic: 76,
  heart_rate: 82,
  respiratory_rate: 18,
  temperature: 98.1,
  temperature_unit: "fahrenheit",
  spo2: 97,
  height: 165,
  weight: 68,
  bmi: 25.0,
};

export const demoAiAssessment2 = {
  suggested_diagnoses: [
    "Fibromyalgia syndrome (ACR 2016 criteria — clinical correlation)",
    "Central sensitization / chronic widespread pain",
    "Hypothyroidism, autoimmune rheumatic disease (less likely without objective inflammation)",
  ],
  recommended_tests: [
    "CBC, CMP, TSH, vitamin D, inflammatory markers (ESR/CRP)",
    "Consider ANA / RF if exam suggests connective tissue disease",
    "Sleep study if prominent non-restorative sleep or suspected apnea",
    "Physical therapy assessment focusing on pacing and graded activity",
  ],
  treatment_suggestions: [
    "Patient education on pacing, sleep hygiene, and stress reduction",
    "Graded exercise / movement program with PT guidance",
    "Trial of FDA-approved fibromyalgia agents as appropriate (e.g., duloxetine, milnacipran, pregabalin)",
    "Cognitive behavioral therapy for pain coping when available",
  ],
  patient_education: [
    "Flares are common; track triggers (sleep, stress, overexertion)",
    "Gentle daily movement often helps more than prolonged bed rest",
    "Keep a brief symptom and activity diary for follow-up visits",
  ],
  follow_up_recommendations:
    "Primary care or rheumatology follow-up in 4–6 weeks to review response and adjust multimodal plan.",
};

export const demoTranscriptionNlp2 = {
  transcription:
    "Patient: The pain is everywhere — shoulders, back, hips, legs. It never fully goes away. I'm exhausted even after sleep, and I can't exercise like I used to without crashing the next day.\n\nClinician: Any joint swelling, fevers, or new weakness?\n\nPatient: No swelling that I can see. No fever. Sometimes my hands feel stiff in the morning for a little while.",
  speaker_segments: [
    { speaker: 0, text: "Widespread pain, fatigue, non-restorative sleep, post-exertional worsening." },
    { speaker: 1, text: "Inflammatory and neurologic red flags screening." },
  ],
  keyword_analysis: {
    total_words: 92,
    diagnostic_keywords: { pain: 9, sleep: 4, fatigue: 6, body: 3, widespread: 2, exercise: 2 },
    keyword_percentage: 19,
    top_keywords: [
      { count: 9, word: "pain", category: "PAIN" },
      { count: 6, word: "fatigue", category: "CONSTITUTIONAL" },
      { count: 4, word: "sleep", category: "SLEEP" },
      { count: 3, word: "body", category: "GENERAL" },
      { count: 2, word: "widespread", category: "PAIN" },
    ],
    inter_word_frequency: {
      "pain, fatigue": 3,
      "sleep, pain": 2,
      "body, pain": 2,
    },
  },
  sentiment_analysis: {
    overall_sentiment: "negative",
    sentiment_score: -0.45,
    distress_level: "high",
    emotional_indicators: ["frustration", "hopelessness", "fatigue", "sleep disturbance"],
  },
  semantic_analysis: {
    key_themes: ["widespread pain", "central sensitization", "sleep dysfunction", "functional limitation"],
    symptom_severity: "moderate to severe",
    functional_impact: "high — work and exercise tolerance reduced",
    temporal_patterns: "Chronic with post-exertional flares",
  },
  physician_notes:
    "2016 fibromyalgia diagnostic criteria screening; multimodal plan; rule out alternative rheumatic and endocrine causes.",
};

/** Demo records for Report Summary (face / audio / gait JSONL-style rows). */
export const demoFace = [
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "face", phase: "encounter", type: "window", t_start: 0, t_end: 5, features: { emotion_counts: { happy: 5, angry: 1, neutral: 5, sad: 2, surprise: 3 } }, confidence: 0.91, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "face", phase: "encounter", type: "window", t_start: 5, t_end: 10, features: { emotion_counts: { happy: 6, angry: 1, neutral: 6, sad: 2, surprise: 4 } }, confidence: 0.9, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "face", phase: "encounter", type: "window", t_start: 10, t_end: 15, features: { emotion_counts: { happy: 5, angry: 1, neutral: 7, sad: 2, surprise: 5 } }, confidence: 0.88, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "face", phase: "encounter", type: "window", t_start: 15, t_end: 20, features: { emotion_counts: { happy: 7, angry: 0, neutral: 6, sad: 1, surprise: 4 } }, confidence: 0.89, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "face", phase: "encounter", type: "window", t_start: 20, t_end: 25, features: { emotion_counts: { happy: 6, angry: 1, neutral: 5, sad: 2, surprise: 4 } }, confidence: 0.9, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "face", phase: "encounter", type: "window", t_start: 25, t_end: 30, features: { emotion_counts: { happy: 6, angry: 0, neutral: 6, sad: 2, surprise: 4 } }, confidence: 0.9, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "face", phase: "encounter", type: "window", t_start: 30, t_end: 35, features: { emotion_counts: { happy: 8, angry: 0, neutral: 5, sad: 1, surprise: 4 } }, confidence: 0.92, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "face", phase: "encounter", type: "window", t_start: 35, t_end: 40, features: { emotion_counts: { happy: 7, angry: 0, neutral: 5, sad: 1, surprise: 3 } }, confidence: 0.91, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "face", phase: "encounter", type: "summary", t_start: 0, t_end: 40, features: { total_samples: 145, emotion_counts: { angry: 4, happy: 50, neutral: 45, sad: 13, surprise: 31 }, emotion_pct: { angry: 2.8, happy: 35.0, neutral: 31.5, sad: 9.1, surprise: 21.7 } }, confidence: 1, valid: true, schema_version: "v0.1", model_version: "resnet34_5class_v3" },
];

export const demoAudio = [
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "audio", phase: "encounter", type: "window", t_start: 0, t_end: 10, features: { word_count: 20, top_words: [["breathlessness", 2], ["breath", 1], ["better", 1], ["walking", 1]], diagnostic_terms: { matches: [["breathlessness", 2], ["breath", 1]], diagnostic_term_pct: 0.15 }, sentiment: { polarity: 0.02 }, topics: [["respiratory_recovery", 0.58], ["functional_status", 0.27], ["general", 0.15]] }, confidence: 0.87, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "audio", phase: "encounter", type: "window", t_start: 10, t_end: 20, features: { word_count: 18, top_words: [["wheeze", 2], ["breath", 1], ["recover", 1], ["mild", 1]], diagnostic_terms: { matches: [["wheeze", 2], ["breath", 1]], diagnostic_term_pct: 0.167 }, sentiment: { polarity: 0.08 }, topics: [["activity_tolerance", 0.56], ["respiratory_recovery", 0.24], ["general", 0.2]] }, confidence: 0.85, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "audio", phase: "encounter", type: "window", t_start: 20, t_end: 30, features: { word_count: 15, top_words: [["cough", 1], ["sleep", 1], ["improving", 1], ["normal", 1]], diagnostic_terms: { matches: [["cough", 1]], diagnostic_term_pct: 0.067 }, sentiment: { polarity: 0.18 }, topics: [["symptom_resolution", 0.52], ["sleep_recovery", 0.22], ["general", 0.26]] }, confidence: 0.84, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "audio", phase: "encounter", type: "window", t_start: 30, t_end: 40, features: { word_count: 14, top_words: [["breathlessness", 1], ["confidence", 1], ["activity", 1], ["better", 1]], diagnostic_terms: { matches: [["breathlessness", 1]], diagnostic_term_pct: 0.071 }, sentiment: { polarity: 0.22 }, topics: [["recovery_confidence", 0.48], ["return_to_activity", 0.31], ["general", 0.21]] }, confidence: 0.86, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "audio", phase: "encounter", type: "summary", t_start: 0, t_end: 40, features: { word_count: 67, top_words: [["breathlessness", 3], ["breath", 2], ["wheeze", 2], ["cough", 1]], diagnostic_terms: { matches: [["breathlessness", 3], ["breath", 2], ["wheeze", 2], ["cough", 1]], diagnostic_term_pct: 0.119 }, sentiment: { polarity: 0.12 }, topics: [["respiratory_recovery", 0.39], ["activity_tolerance", 0.27], ["symptom_resolution", 0.19], ["general", 0.15]] }, confidence: 0.86, valid: true, schema_version: "v0.1" },
];

export const demoGait = [
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "gait", phase: "entry", type: "window", t_start: 0, t_end: 1, features: { speed_mps: 0.99, symmetry: 0.88, stability: 0.83 }, confidence: 0.83, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "gait", phase: "entry", type: "window", t_start: 1, t_end: 2, features: { speed_mps: 1.01, symmetry: 0.89, stability: 0.84 }, confidence: 0.84, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "gait", phase: "entry", type: "window", t_start: 2, t_end: 3, features: { speed_mps: 1.05, symmetry: 0.9, stability: 0.85 }, confidence: 0.86, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "gait", phase: "entry", type: "window", t_start: 3, t_end: 4, features: { speed_mps: 1.08, symmetry: 0.91, stability: 0.86 }, confidence: 0.87, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "gait", phase: "entry", type: "window", t_start: 4, t_end: 5, features: { speed_mps: 1.09, symmetry: 0.91, stability: 0.87 }, confidence: 0.87, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "gait", phase: "entry", type: "window", t_start: 5, t_end: 6, features: { speed_mps: 1.07, symmetry: 0.9, stability: 0.86 }, confidence: 0.85, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "gait", phase: "entry", type: "event", t: 12.4, features: { event: "walk_end" }, confidence: 0.93, valid: true, schema_version: "v0.1" },
  { visit_id: "visit-demo-1", patient_id: "patient-demo-1", subsystem: "gait", phase: "entry", type: "summary", t_start: 0, t_end: 12.4, features: { avg_speed_mps: 1.06, avg_symmetry: 0.9, avg_stability: 0.86 }, confidence: 0.86, valid: true, schema_version: "v0.1", notes: "Walking speed and stability improved, consistent with recovering exercise tolerance." },
];

function cloneSubsystemForVisit(rows, visitId, patientId) {
  return rows.map((r) => ({ ...r, visit_id: visitId, patient_id: patientId }));
}

const demoFaceVisit2 = cloneSubsystemForVisit(demoFace, DEMO_REPORT_VISIT_ID_2, DEMO_REPORT_PATIENT_ID_2);
const demoAudioVisit2 = cloneSubsystemForVisit(demoAudio, DEMO_REPORT_VISIT_ID_2, DEMO_REPORT_PATIENT_ID_2);
const demoGaitVisit2 = cloneSubsystemForVisit(demoGait, DEMO_REPORT_VISIT_ID_2, DEMO_REPORT_PATIENT_ID_2);

const REPORT_PACKAGE_DEFAULT = {
  face: demoFace,
  audio: demoAudio,
  gait: demoGait,
  aiAssessment: demoAiAssessment,
  transcriptionNlp: demoTranscriptionNlp,
  visitSnapshot: demoVisitSnapshot,
};

const REPORT_PACKAGE_VISIT_2 = {
  face: demoFaceVisit2,
  audio: demoAudioVisit2,
  gait: demoGaitVisit2,
  aiAssessment: demoAiAssessment2,
  transcriptionNlp: demoTranscriptionNlp2,
  visitSnapshot: demoVisitSnapshot2,
};

/**
 * Multimodal rows + NLP/AI fallbacks for Report Summary, keyed by persisted visit id.
 * Unknown ids fall back to demo visit 1.
 */
export function getReportDemoPackage(visitId) {
  if (visitId === DEMO_REPORT_VISIT_ID_2) {
    return REPORT_PACKAGE_VISIT_2;
  }
  return REPORT_PACKAGE_DEFAULT;
}
