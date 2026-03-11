import React, { useState } from "react";
import { api } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Brain, TrendingUp, Activity, AlertCircle, GitCompare, Download } from "lucide-react";
import { format } from "date-fns";
import { generateVisitPDF } from "@/utils/pdfGenerator";

export default function VisitDetails() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const visitId = urlParams.get('id');
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
    queryKey: ['patient', visit?.patient_id],
    queryFn: async () => {
      const patients = await api.entities.Patient.filter({ id: visit.patient_id });
      return patients[0];
    },
    enabled: !!visit?.patient_id
  });

  const handleExportPDF = () => {
    if (visit && patient) {
      generateVisitPDF(visit, patient);
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
              onClick={() => navigate(createPageUrl("Dashboard"))}
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
              {visit.speaker_segments && visit.speaker_segments.length > 0 && (
                <div className="mt-4">
                  <h4 className="font-semibold text-sm mb-2">Speaker Segments Detected:</h4>
                  <div className="space-y-2">
                    {visit.speaker_segments.map((segment, idx) => (
                      <div key={idx} className="text-xs text-slate-600">
                        <Badge variant="outline" className="mr-2">Speaker {segment.speaker}</Badge>
                        {segment.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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

              {/* Inter-word Frequency*/}
              {visit.keyword_analysis.inter_word_frequency && 
               Object.keys(visit.keyword_analysis.inter_word_frequency).length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-3">Symptom Co-occurrence Patterns:</h4>
                  <p className="text-xs text-slate-600 mb-3">
                    Keywords that frequently appear together (within 10 words):
                  </p>
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

        {/* AI Assessment Card  */}
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
                {/* Suggested Diagnoses */}
                {visit.ai_assessment.suggested_diagnoses && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-blue-200">
                      <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                      <h4 className="font-semibold text-base text-slate-800">Differential Diagnosis</h4>
                    </div>
                    <div className="space-y-2 pl-4">
                      {visit.ai_assessment.suggested_diagnoses.map((diagnosis, idx) => (
                        <div key={idx} className="text-slate-700 py-1">
                          {diagnosis}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommended Tests */}
                {visit.ai_assessment.recommended_tests && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-green-200">
                      <div className="w-2 h-2 rounded-full bg-green-600"></div>
                      <h4 className="font-semibold text-base text-slate-800">Recommended Workup</h4>
                    </div>
                    <div className="space-y-2 pl-4">
                      {visit.ai_assessment.recommended_tests.map((test, idx) => (
                        <div key={idx} className="text-slate-700 py-1">
                          {test}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Treatment Suggestions */}
                {visit.ai_assessment.treatment_suggestions && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-purple-200">
                      <div className="w-2 h-2 rounded-full bg-purple-600"></div>
                      <h4 className="font-semibold text-base text-slate-800">Treatment Plan</h4>
                    </div>
                    <div className="space-y-2 pl-4">
                      {visit.ai_assessment.treatment_suggestions.map((treatment, idx) => (
                        <div key={idx} className="text-slate-700 py-1">
                          {treatment}
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
                      <p className="text-slate-700 leading-relaxed">
                        {visit.ai_assessment.follow_up_recommendations}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Physician Notes Card */}
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

        {/* Model Comparison  */}
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
                  {/* OpenAI Results */}
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

                          {visit.ai_comparison.openai.diagnostic.recommended_tests && (
                            <div>
                              <h5 className="font-semibold text-sm text-slate-600 mb-2 uppercase tracking-wide">Tests</h5>
                              <div className="space-y-1 text-sm text-slate-700">
                                {visit.ai_comparison.openai.diagnostic.recommended_tests.map((test, idx) => (
                                  <div key={idx}>{test}</div>
                                ))}
                              </div>
                            </div>
                          )}

                          {visit.ai_comparison.openai.diagnostic.treatment_suggestions && (
                            <div>
                              <h5 className="font-semibold text-sm text-slate-600 mb-2 uppercase tracking-wide">Treatment</h5>
                              <div className="space-y-1 text-sm text-slate-700">
                                {visit.ai_comparison.openai.diagnostic.treatment_suggestions.map((tx, idx) => (
                                  <div key={idx}>{tx}</div>
                                ))}
                              </div>
                            </div>
                          )}

                          {visit.ai_comparison.openai.diagnostic.follow_up_recommendations && (
                            <div>
                              <h5 className="font-semibold text-sm text-slate-600 mb-2 uppercase tracking-wide">Follow-up</h5>
                              <p className="text-sm text-slate-700 leading-relaxed">
                                {visit.ai_comparison.openai.diagnostic.follow_up_recommendations}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Ollama Results */}
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

                          {visit.ai_comparison.ollama.diagnostic.recommended_tests && (
                            <div>
                              <h5 className="font-semibold text-sm text-slate-600 mb-2 uppercase tracking-wide">Tests</h5>
                              <div className="space-y-1 text-sm text-slate-700">
                                {visit.ai_comparison.ollama.diagnostic.recommended_tests.map((test, idx) => (
                                  <div key={idx}>{typeof test === 'string' ? test : test.name || JSON.stringify(test)}</div>
                                ))}
                              </div>
                            </div>
                          )}

                          {visit.ai_comparison.ollama.diagnostic.treatment_suggestions && (
                            <div>
                              <h5 className="font-semibold text-sm text-slate-600 mb-2 uppercase tracking-wide">Treatment</h5>
                              <div className="space-y-1 text-sm text-slate-700">
                                {visit.ai_comparison.ollama.diagnostic.treatment_suggestions.map((tx, idx) => (
                                  <div key={idx}>{typeof tx === 'string' ? tx : tx.name || JSON.stringify(tx)}</div>
                                ))}
                              </div>
                            </div>
                          )}

                          {visit.ai_comparison.ollama.diagnostic.follow_up_recommendations && (
                            <div>
                              <h5 className="font-semibold text-sm text-slate-600 mb-2 uppercase tracking-wide">Follow-up</h5>
                              <p className="text-sm text-slate-700 leading-relaxed">
                                {visit.ai_comparison.ollama.diagnostic.follow_up_recommendations}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Errors */}
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

                  {/* Comparison Note */}
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