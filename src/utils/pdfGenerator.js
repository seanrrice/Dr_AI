import jsPDF from 'jspdf';
import { format } from 'date-fns';

export const generateVisitPDF = (visit, patient) => {
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

  // Patient Information
  addSection('PATIENT INFORMATION');
  addText(`Name: ${patient.first_name} ${patient.last_name}`);
  addText(`Date of Birth: ${format(new Date(patient.date_of_birth), 'MMM d, yyyy')}`);
  if (patient.medical_record_number) {
    addText(`MRN: ${patient.medical_record_number}`);
  }
  if (patient.primary_diagnosis) {
    addText(`Primary Diagnosis: ${patient.primary_diagnosis}`);
  }

  // Visit Details
  addSection('VISIT DETAILS');
  addText(`Visit Number: ${visit.visit_number}`);
  addText(`Date: ${format(new Date(visit.visit_date), 'MMM d, yyyy')}`);
  if (visit.chief_complaint) {
    addText(`Chief Complaint: ${visit.chief_complaint}`);
  }

  // Vital Signs
  if (visit.bp_systolic || visit.heart_rate) {
    addSection('VITAL SIGNS');
    if (visit.bp_systolic && visit.bp_diastolic) {
      addText(`Blood Pressure: ${visit.bp_systolic}/${visit.bp_diastolic} mmHg`);
    }
    if (visit.heart_rate) {
      addText(`Heart Rate: ${visit.heart_rate} bpm`);
    }
    if (visit.respiratory_rate) {
      addText(`Respiratory Rate: ${visit.respiratory_rate} /min`);
    }
    if (visit.temperature) {
      addText(`Temperature: ${visit.temperature}°F`);
    }
    if (visit.spo2) {
      addText(`SpO2: ${visit.spo2}%`);
    }
  }

  // Physical Measurements
  if (visit.height || visit.weight) {
    addSection('PHYSICAL MEASUREMENTS');
    if (visit.height) {
      addText(`Height: ${visit.height} cm`);
    }
    if (visit.weight) {
      addText(`Weight: ${visit.weight} kg`);
    }
    if (visit.bmi) {
      addText(`BMI: ${visit.bmi}`);
    }
  }

  // Patient Transcription ?? will ewmovw later
  if (visit.transcription) {
    addSection('PATIENT TRANSCRIPTION');
    addText(visit.transcription, 10);
  }

  // Keyword Analysis 
  if (visit.keyword_analysis) {
    addSection('KEYWORD ANALYSIS');
    addText(`Total Words: ${visit.keyword_analysis.total_words}`);
    addText(`Keyword Density: ${visit.keyword_analysis.keyword_percentage}%`);
    
    if (visit.keyword_analysis.top_keywords && visit.keyword_analysis.top_keywords.length > 0) {
      yPosition += 3;
      addText('Top Diagnostic Keywords:', 11, true);
      visit.keyword_analysis.top_keywords.slice(0, 10).forEach(kw => {
        addText(`  • ${kw.word} (${kw.count}x) - ${kw.category}`);
      });
    }

    // Inter-word frequency 
    if (visit.keyword_analysis.inter_word_frequency) {
      yPosition += 3;
      addText('Symptom Co-occurrence Patterns:', 11, true);
      const topPairs = Object.entries(visit.keyword_analysis.inter_word_frequency)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);
      
      topPairs.forEach(([pair, count]) => {
        addText(`  • ${pair}: ${count} times`);
      });
    }
  }

  // Sentiment Analysis ?? might not be needed here
  if (visit.sentiment_analysis) {
    addSection('SENTIMENT & EMOTIONAL ANALYSIS');
    addText(`Overall Sentiment: ${visit.sentiment_analysis.overall_sentiment.toUpperCase()}`);
    addText(`Sentiment Score: ${visit.sentiment_analysis.sentiment_score}`);
    addText(`Distress Level: ${visit.sentiment_analysis.distress_level.toUpperCase()}`);
    
    if (visit.sentiment_analysis.emotional_indicators) {
      yPosition += 3;
      addText('Emotional Indicators:', 11, true);
      addText(`  ${visit.sentiment_analysis.emotional_indicators.join(', ')}`);
    }
  }

  // Semantic Analysis ?? remove later debug
  if (visit.semantic_analysis) {
    addSection('SEMANTIC ANALYSIS');
    if (visit.semantic_analysis.key_themes) {
      addText('Key Themes:', 11, true);
      visit.semantic_analysis.key_themes.forEach(theme => {
        addText(`  • ${theme}`);
      });
    }
    if (visit.semantic_analysis.symptom_severity) {
      yPosition += 3;
      addText(`Symptom Severity: ${visit.semantic_analysis.symptom_severity}`);
    }
    if (visit.semantic_analysis.functional_impact) {
      addText(`Functional Impact: ${visit.semantic_analysis.functional_impact}`);
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

    if (visit.ai_assessment.recommended_tests) {
      yPosition += 3;
      addText('Recommended Tests:', 11, true);
      visit.ai_assessment.recommended_tests.forEach((test, idx) => {
        addText(`  ${idx + 1}. ${test}`);
      });
    }

    if (visit.ai_assessment.treatment_suggestions) {
      yPosition += 3;
      addText('Treatment Suggestions:', 11, true);
      visit.ai_assessment.treatment_suggestions.forEach((tx, idx) => {
        addText(`  ${idx + 1}. ${tx}`);
      });
    }

    if (visit.ai_assessment.follow_up_recommendations) {
      yPosition += 3;
      addText('Follow-up Recommendations:', 11, true);
      addText(`  ${visit.ai_assessment.follow_up_recommendations}`);
    }
  }

  // Physician Notes
  if (visit.physician_notes) {
    addSection('PHYSICIAN NOTES');
    addText(visit.physician_notes, 10);
  }
  yPosition = doc.internal.pageSize.getHeight() - 15;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text(
    `Generated on ${format(new Date(), 'MMM d, yyyy h:mm a')}`,
    pageWidth / 2,
    yPosition,
    { align: 'center' }
  );

  // Save PDF
  const fileName = `Visit_${patient.last_name}_${patient.first_name}_${format(new Date(visit.visit_date), 'yyyy-MM-dd')}.pdf`;
  doc.save(fileName);
};

export const generatePatientSummaryPDF = (patient, visits) => {
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
  doc.text('PATIENT SUMMARY REPORT', pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 15;

  // Patient Information
  addSection('PATIENT INFORMATION');
  addText(`Name: ${patient.first_name} ${patient.last_name}`);
  addText(`Date of Birth: ${format(new Date(patient.date_of_birth), 'MMM d, yyyy')}`);
  if (patient.medical_record_number) {
    addText(`MRN: ${patient.medical_record_number}`);
  }
  if (patient.primary_diagnosis) {
    addText(`Primary Diagnosis: ${patient.primary_diagnosis}`);
  }
  addText(`Total Visits: ${visits.length}`);

  // Visit History Summary
  addSection('VISIT HISTORY');
  visits.forEach((visit, idx) => {
    addText(`Visit #${visit.visit_number} - ${format(new Date(visit.visit_date), 'MMM d, yyyy')}`, 11, true);
    if (visit.chief_complaint) {
      addText(`  Chief Complaint: ${visit.chief_complaint}`);
    }
    if (visit.sentiment_analysis) {
      addText(`  Sentiment: ${visit.sentiment_analysis.overall_sentiment} (${visit.sentiment_analysis.sentiment_score})`);
    }
    yPosition += 2;
  });

  // Aggregate keyword analysis across all visits
  const allKeywords = {};
  visits.forEach(visit => {
    if (visit.keyword_analysis && visit.keyword_analysis.diagnostic_keywords) {
      Object.entries(visit.keyword_analysis.diagnostic_keywords).forEach(([word, data]) => {
        const count = typeof data === 'object' ? data.count : data;
        allKeywords[word] = (allKeywords[word] || 0) + count;
      });
    }
  });

  if (Object.keys(allKeywords).length > 0) {
    addSection('MOST FREQUENT SYMPTOMS (ALL VISITS)');
    const topKeywords = Object.entries(allKeywords)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15);
    
    topKeywords.forEach(([word, count]) => {
      addText(`  • ${word}: ${count} times`);
    });
  }

  // Footer
  yPosition = doc.internal.pageSize.getHeight() - 15;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text(
    `Generated on ${format(new Date(), 'MMM d, yyyy h:mm a')}`,
    pageWidth / 2,
    yPosition,
    { align: 'center' }
  );

  const fileName = `Patient_Summary_${patient.last_name}_${patient.first_name}.pdf`;
  doc.save(fileName);
};
