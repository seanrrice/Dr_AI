import jsPDF from 'jspdf';
import { format } from 'date-fns';

const safeNum = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

const getGaitFromStoredData = (visit, report) => {
  const reportGait = report?.sections?.gait || null;

  if (reportGait?.summary && typeof reportGait.summary === 'object') {
    return reportGait.summary;
  }
  if (reportGait && reportGait.type === 'summary') {
    return reportGait;
  }

  const gaitRows = Array.isArray(visit?.multimodal_jsonl?.gait) ? visit.multimodal_jsonl.gait : [];
  const mmSummary = gaitRows.find((r) => r?.type === 'summary');
  if (mmSummary) return mmSummary;

  if (visit?.gait_summary && typeof visit.gait_summary === 'object') {
    return visit.gait_summary;
  }
  return null;
};

const getAudioFromStoredData = (visit, report) => {
  const reportAudio = report?.sections?.audio;
  if (reportAudio?.summary && typeof reportAudio.summary === 'object') {
    return reportAudio.summary;
  }
  const audioRows = Array.isArray(visit?.multimodal_jsonl?.audio) ? visit.multimodal_jsonl.audio : [];
  return audioRows.find((r) => r?.type === 'summary') || null;
};

const getFaceFromStoredData = (visit, report) => {
  const reportFace = report?.sections?.face;
  if (reportFace && typeof reportFace === 'object') return reportFace;
  const faceRows = Array.isArray(visit?.multimodal_jsonl?.face) ? visit.multimodal_jsonl.face : [];
  return faceRows.find((r) => r?.type === 'summary') || null;
};

export const generateVisitPDF = (visit, patient, report = null) => {
  const doc = new jsPDF();
  let yPosition = 20;
  const lineHeight = 7;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - (2 * margin);

  const addText = (text, size = 11, isBold = false) => {
    if (yPosition > 270) {
      doc.addPage();
      yPosition = 20;
    }

    doc.setFontSize(size);
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');

    const lines = doc.splitTextToSize(text, contentWidth);
    doc.text(lines, margin, yPosition);
    yPosition += (lines.length * lineHeight);
  };

  const addSection = (title) => {
    yPosition += 5;
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPosition - 5, contentWidth, 8, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(title, margin + 2, yPosition);
    yPosition += 10;
  };

  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('PATIENT VISIT REPORT', pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 15;

  // Patient Info
  addSection('PATIENT INFORMATION');
  addText(`Name: ${patient.first_name} ${patient.last_name}`);
  addText(`Date of Birth: ${format(new Date(patient.date_of_birth), 'MMM d, yyyy')}`);

  if (patient.medical_record_number) addText(`MRN: ${patient.medical_record_number}`);
  if (patient.primary_diagnosis) addText(`Primary Diagnosis: ${patient.primary_diagnosis}`);

  // Visit Details
  addSection('VISIT DETAILS');
  addText(`Visit Number: ${visit.visit_number}`);
  addText(`Date: ${format(new Date(visit.visit_date), 'MMM d, yyyy')}`);

  if (visit.chief_complaint) addText(`Chief Complaint: ${visit.chief_complaint}`);

  // Vital Signs
  if (visit.bp_systolic || visit.heart_rate) {
    addSection('VITAL SIGNS');

    if (visit.bp_systolic && visit.bp_diastolic)
      addText(`Blood Pressure: ${visit.bp_systolic}/${visit.bp_diastolic} mmHg`);

    if (visit.heart_rate) addText(`Heart Rate: ${visit.heart_rate} bpm`);
    if (visit.respiratory_rate) addText(`Respiratory Rate: ${visit.respiratory_rate} /min`);
    if (visit.temperature) addText(`Temperature: ${visit.temperature}°F`);
    if (visit.spo2) addText(`SpO2: ${visit.spo2}%`);
  }

  const gaitSummary = getGaitFromStoredData(visit, report);
  if (gaitSummary) {
    addSection('GAIT ANALYSIS');

    const gaitFeatures = gaitSummary.features || {};
    const summaryText = visit.gait_summary_text || gaitSummary.summary_text || gaitSummary.notes;
    if (summaryText) {
      addText(`Summary: ${summaryText}`);
    }

    const meanSpeed =
      safeNum(gaitSummary.mean_speed_mps) ??
      safeNum(gaitFeatures.avg_speed_mps) ??
      safeNum(gaitFeatures.speed_mps);
    if (meanSpeed != null) addText(`Mean Gait Speed: ${meanSpeed.toFixed(2)} m/s`);

    const cadence = safeNum(gaitSummary.cadence_spm);
    if (cadence != null) addText(`Cadence: ${cadence.toFixed(1)} steps/min`);

    const steps = gaitSummary.num_steps_est ?? gaitSummary.num_steps;
    if (steps != null) addText(`Estimated Steps: ${steps}`);

    const symmetryPct =
      safeNum(gaitSummary.knee_symmetry_index_percent) ??
      (safeNum(gaitFeatures.avg_symmetry) != null ? safeNum(gaitFeatures.avg_symmetry) * 100 : null);
    if (symmetryPct != null) addText(`Knee Symmetry Index: ${symmetryPct.toFixed(1)}%`);

    if (safeNum(gaitSummary.stability_ap_rms_m) != null)
      addText(`AP Stability RMS: ${Number(gaitSummary.stability_ap_rms_m).toFixed(3)} m`);

    if (safeNum(gaitSummary.stability_ml_rms_m) != null)
      addText(`ML Stability RMS: ${Number(gaitSummary.stability_ml_rms_m).toFixed(3)} m`);

    if (gaitSummary.sit_to_stand_detected != null)
      addText(`Sit-to-Stand Detected: ${gaitSummary.sit_to_stand_detected ? 'Yes' : 'No'}`);

    const sts =
      safeNum(gaitSummary.sit_to_stand_time_s) ??
      safeNum(gaitSummary.sit_to_stand_duration_s);
    if (sts != null) addText(`Sit-to-Stand Time: ${sts.toFixed(2)} s`);
  }

  const faceSummary = getFaceFromStoredData(visit, report);
  if (faceSummary?.features) {
    const emotionPct = faceSummary.features.emotion_pct || {};
    const topEmotion = Object.entries(emotionPct).sort((a, b) => b[1] - a[1])[0];
    addSection('FACIAL ANALYSIS');
    if (topEmotion) {
      addText(`Dominant emotion: ${topEmotion[0]} (${Number(topEmotion[1]).toFixed(1)}%)`);
    }
    if (faceSummary.features.total_samples != null) {
      addText(`Samples analyzed: ${faceSummary.features.total_samples}`);
    }
  }

  const audioSummary = getAudioFromStoredData(visit, report);
  if (audioSummary?.features) {
    addSection('AUDIO / LANGUAGE ANALYSIS');
    const sent = audioSummary.features.sentiment || audioSummary.features.sentiment_analysis || {};
    const polarity = safeNum(sent.polarity ?? sent.sentiment_score);
    if (polarity != null) addText(`Mean sentiment polarity: ${polarity.toFixed(2)}`);
    const topWords = audioSummary.features.top_words || [];
    if (Array.isArray(topWords) && topWords.length) {
      const line = topWords.slice(0, 6).map((w) => `${w[0]} (${w[1]})`).join(', ');
      addText(`Top words: ${line}`);
    }
  }

  // AI Assessment
  if (visit.ai_assessment) {
    addSection('AI DIAGNOSTIC ASSESSMENT');

    if (visit.ai_assessment.suggested_diagnoses) {
      addText('Suggested Diagnoses:', 11, true);
      visit.ai_assessment.suggested_diagnoses.forEach((dx, idx) => {
        addText(`  ${idx + 1}. ${dx}`);
      });
    }
  }

  // Footer
  yPosition = doc.internal.pageSize.getHeight() - 15;
  doc.setFontSize(8);
  doc.text(
    `Generated on ${format(new Date(), 'MMM d, yyyy h:mm a')}`,
    pageWidth / 2,
    yPosition,
    { align: 'center' }
  );

  doc.save(`Visit_${patient.last_name}.pdf`);
};