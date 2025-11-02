import React, { useState } from "react";
import { api } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Brain, TrendingUp, Activity, AlertCircle, GitCompare } from "lucide-react";
import { format } from "date-fns";

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

  const highlightKeywords = (text, keywords) => {
    if (!keywords || Object.keys(keywords).length === 0) return text;
    
    let highlightedText = text;
    Object.keys(keywords).forEach(keyword => {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
      highlightedText = highlightedText.replace(regex, '<mark class="bg-yellow-200 px-1 rounded">$1</mark>');
    });
    return highlightedText;
  };

  const hasComparison = visit.ai_comparison && (
    (visit.ai_comparison.openai && !visit.ai_comparison.errors?.openai) || 
    (visit.ai_comparison.ollama && !visit.ai_comparison.errors?.ollama)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(createPageUrl("Dashboard"))}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-slate-900">Visit Analysis</h1>
            {patient && (
              <p className="text-slate-600">
                {patient.first_name} {patient.last_name} • {format(new Date(visit.visit_date), 'MMMM d, yyyy')} • Visit #{visit.visit_number}
              </p>
            )}
          </div>
          {patient && (
            <Button
              variant="outline"
              onClick={() => navigate(createPageUrl(`PatientAnalysis?id=${patient.id}`))}
            >
              View Patient Trends
            </Button>
          )}
        </div>

        {/* AI Model Comparison Toggle */}
        {hasComparison && (
          <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200 mb-6">
            <CardContent className="pt-6 pb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-purple-900 mb-1">Multi-Model AI Analysis Available</h3>
                  <p className="text-sm text-purple-700">
                    {showComparison ? 'Viewing side-by-side comparison' : 'Viewing consensus result'}
                  </p>
                </div>
                <Button
                  onClick={() => setShowComparison(!showComparison)}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <GitCompare className="w-4 h-4 mr-2" />
                  {showComparison ? 'Show Consensus' : 'Compare AI Models'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        {/* DEBUG */}
        {console.log('Rendering comparison view:', {
          showComparison,
          hasComparison,
          openai: visit.ai_comparison?.openai,
          ollama: visit.ai_comparison?.ollama,
          errors: visit.ai_comparison?.errors
        })}

        {/* AI Model Comparison View */}
        {showComparison && hasComparison && (
          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* OpenAI Results */}
            {visit.ai_comparison.openai && !visit.ai_comparison.errors?.openai && (
              <Card className="bg-white border-blue-200">
                <CardHeader className="bg-blue-50">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Brain className="w-5 h-5 text-blue-600" />
                    OpenAI GPT-4
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  {visit.ai_comparison.openai.diagnostic?.suggested_diagnoses && (
                    <div>
                      <h4 className="font-semibold text-blue-900 mb-2">Suggested Diagnoses</h4>
                      <ul className="space-y-1">
                        {visit.ai_comparison.openai.diagnostic.suggested_diagnoses.map((d, i) => (
                          <li key={i} className="text-sm">
                            • {typeof d === 'string' ? d : d.name || JSON.stringify(d)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {visit.ai_comparison.openai.diagnostic?.recommended_tests && (
                    <div>
                      <h4 className="font-semibold text-blue-900 mb-2">Recommended Tests</h4>
                      <ul className="space-y-1">
                        {visit.ai_comparison.openai.diagnostic.recommended_tests.map((t, i) => (
                          <li key={i} className="text-sm">
                            • {typeof t === 'string' ? t : t.name || JSON.stringify(t)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {visit.ai_comparison.openai.diagnostic?.treatment_suggestions && (
                    <div>
                      <h4 className="font-semibold text-blue-900 mb-2">Treatment Suggestions</h4>
                      <ul className="space-y-1">
                        {visit.ai_comparison.openai.diagnostic.treatment_suggestions.map((t, i) => (
                          <li key={i} className="text-sm">
                            • {typeof t === 'string' ? t : t.name || JSON.stringify(t)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Ollama Results */}
            {visit.ai_comparison.ollama && !visit.ai_comparison.errors?.ollama && (
              <Card className="bg-white border-green-200">
                <CardHeader className="bg-green-50">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Brain className="w-5 h-5 text-green-600" />
                    Ollama Llama
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  {visit.ai_comparison.ollama.diagnostic?.suggested_diagnoses && (
                    <div>
                      <h4 className="font-semibold text-green-900 mb-2">Suggested Diagnoses</h4>
                      <ul className="space-y-1">
                        {visit.ai_comparison.ollama.diagnostic.suggested_diagnoses.map((d, i) => (
                          <li key={i} className="text-sm">
                            • {typeof d === 'string' ? d : d.name || JSON.stringify(d)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {visit.ai_comparison.ollama.diagnostic?.recommended_tests && (
                    <div>
                      <h4 className="font-semibold text-green-900 mb-2">Recommended Tests</h4>
                      <ul className="space-y-1">
                        {visit.ai_comparison.ollama.diagnostic.recommended_tests.map((t, i) => (
                          <li key={i} className="text-sm">
                            • {typeof t === 'string' ? t : t.name || JSON.stringify(t)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {visit.ai_comparison.ollama.diagnostic?.treatment_suggestions && (
                    <div>
                      <h4 className="font-semibold text-green-900 mb-2">Treatment Suggestions</h4>
                      <ul className="space-y-1">
                        {visit.ai_comparison.ollama.diagnostic.treatment_suggestions.map((t, i) => (
                          <li key={i} className="text-sm">
                            • {typeof t === 'string' ? t : t.name || JSON.stringify(t)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Show errors if any model failed */}
            {visit.ai_comparison.errors && Object.keys(visit.ai_comparison.errors).length > 0 && (
              <Card className="bg-white border-red-200">
                <CardHeader className="bg-red-50">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                    Failed Models
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {Object.entries(visit.ai_comparison.errors).map(([model, error]) => (
                    <div key={model} className="text-sm mb-2">
                      <span className="font-semibold capitalize">{model}:</span> {error}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}
        
        {/* Main Analysis Cards (gonna hide this for  now)*/}
        {!showComparison && (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Transcription */}
              <Card className="bg-white border-none shadow-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Patient Transcription
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {visit.chief_complaint && (
                    <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                      <p className="text-sm font-semibold text-blue-900 mb-1">Chief Complaint</p>
                      <p className="text-blue-800">{visit.chief_complaint}</p>
                    </div>
                  )}
                  <div 
                    className="prose max-w-none text-slate-700 leading-relaxed"
                    dangerouslySetInnerHTML={{ 
                      __html: highlightKeywords(
                        visit.transcription, 
                        visit.keyword_analysis?.diagnostic_keywords
                      )
                    }}
                  />
                </CardContent>
              </Card>

              {/* Keyword Analysis */}
              {visit.keyword_analysis && (
                <Card className="bg-white border-none shadow-lg">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="w-5 h-5" />
                      Keyword Frequency Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-sm text-slate-600 mb-1">Total Words</p>
                        <p className="text-2xl font-bold text-slate-900">{visit.keyword_analysis.total_words}</p>
                      </div>
                      <div className="p-4 bg-blue-50 rounded-lg">
                        <p className="text-sm text-blue-600 mb-1">Diagnostic Terms</p>
                        <p className="text-2xl font-bold text-blue-900">
                          {Object.keys(visit.keyword_analysis.diagnostic_keywords || {}).length}
                        </p>
                      </div>
                      <div className="p-4 bg-green-50 rounded-lg">
                        <p className="text-sm text-green-600 mb-1">Keyword %</p>
                        <p className="text-2xl font-bold text-green-900">
                          {visit.keyword_analysis.keyword_percentage?.toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    {visit.keyword_analysis.top_keywords && visit.keyword_analysis.top_keywords.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-slate-900 mb-3">Top Diagnostic Keywords</h4>
                        <div className="space-y-2">
                          {visit.keyword_analysis.top_keywords.map((keyword, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                              <div>
                                <span className="font-medium text-slate-900">{keyword.word}</span>
                                {keyword.category && (
                                  <Badge variant="outline" className="ml-2 text-xs">{keyword.category}</Badge>
                                )}
                              </div>
                              <span className="text-sm font-semibold text-slate-600">{keyword.count}x</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Semantic Analysis */}
              {visit.semantic_analysis && (
                <Card className="bg-white border-none shadow-lg">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="w-5 h-5" />
                      Semantic Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {visit.semantic_analysis.key_themes && visit.semantic_analysis.key_themes.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-slate-900 mb-2">Key Themes</h4>
                        <div className="flex flex-wrap gap-2">
                          {visit.semantic_analysis.key_themes.map((theme, idx) => (
                            <Badge key={idx} variant="secondary" className="bg-purple-100 text-purple-800">
                              {theme}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-4">
                      {visit.semantic_analysis.symptom_severity && (
                        <div>
                          <p className="text-sm text-slate-600 mb-1">Symptom Severity</p>
                          <p className="font-semibold text-slate-900">{visit.semantic_analysis.symptom_severity}</p>
                        </div>
                      )}
                      {visit.semantic_analysis.functional_impact && (
                        <div>
                          <p className="text-sm text-slate-600 mb-1">Functional Impact</p>
                          <p className="font-semibold text-slate-900">{visit.semantic_analysis.functional_impact}</p>
                        </div>
                      )}
                      {visit.semantic_analysis.temporal_patterns && (
                        <div>
                          <p className="text-sm text-slate-600 mb-1">Temporal Pattern</p>
                          <p className="font-semibold text-slate-900">{visit.semantic_analysis.temporal_patterns}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Sentiment Analysis */}
              {visit.sentiment_analysis && (
                <Card className="bg-white border-none shadow-lg">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      Sentiment Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-center p-4 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-600 mb-2">Overall Sentiment</p>
                      <Badge className={`text-lg px-4 py-2 ${
                        visit.sentiment_analysis.overall_sentiment === 'positive' ? 'bg-green-500' :
                        visit.sentiment_analysis.overall_sentiment === 'negative' ? 'bg-red-500' :
                        'bg-yellow-500'
                      }`}>
                        {visit.sentiment_analysis.overall_sentiment}
                      </Badge>
                      {visit.sentiment_analysis.sentiment_score !== undefined && (
                        <p className="text-sm text-slate-500 mt-2">
                          Score: {visit.sentiment_analysis.sentiment_score.toFixed(2)}
                        </p>
                      )}
                    </div>

                    {visit.sentiment_analysis.distress_level && (
                      <div>
                        <p className="text-sm text-slate-600 mb-2">Distress Level</p>
                        <Badge variant="outline" className="text-base">
                          {visit.sentiment_analysis.distress_level}
                        </Badge>
                      </div>
                    )}

                    {visit.sentiment_analysis.emotional_indicators && visit.sentiment_analysis.emotional_indicators.length > 0 && (
                      <div>
                        <p className="text-sm text-slate-600 mb-2">Emotional Indicators</p>
                        <div className="flex flex-wrap gap-2">
                          {visit.sentiment_analysis.emotional_indicators.map((indicator, idx) => (
                            <Badge key={idx} variant="secondary">{indicator}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* AI Assessment (Consensus) */}
              {visit.ai_assessment && (
                <Card className="bg-gradient-to-br from-purple-500 to-purple-600 border-none shadow-lg text-white">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="w-5 h-5" />
                      AI Diagnostic Assessment
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {visit.ai_assessment.suggested_diagnoses && visit.ai_assessment.suggested_diagnoses.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-purple-100 mb-2">Suggested Diagnoses</h4>
                        <ul className="space-y-1">
                          {visit.ai_assessment.suggested_diagnoses.map((diagnosis, idx) => (
                            <li key={idx} className="text-sm">• {diagnosis}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {visit.ai_assessment.recommended_tests && visit.ai_assessment.recommended_tests.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-purple-100 mb-2">Recommended Tests</h4>
                        <ul className="space-y-1">
                          {visit.ai_assessment.recommended_tests.map((test, idx) => (
                            <li key={idx} className="text-sm">• {test}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {visit.ai_assessment.treatment_suggestions && visit.ai_assessment.treatment_suggestions.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-purple-100 mb-2">Treatment Suggestions</h4>
                        <ul className="space-y-1">
                          {visit.ai_assessment.treatment_suggestions.map((treatment, idx) => (
                            <li key={idx} className="text-sm">• {treatment}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {visit.ai_assessment.follow_up_recommendations && (
                      <div>
                        <h4 className="font-semibold text-purple-100 mb-2">Follow-up</h4>
                        <p className="text-sm">{visit.ai_assessment.follow_up_recommendations}</p>
                      </div>
                    )}

                    {visit.ai_assessment.consensus_note && (
                      <div className="pt-3 border-t border-purple-400">
                        <p className="text-xs text-purple-100">{visit.ai_assessment.consensus_note}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Physician Notes */}
              {visit.physician_notes && (
                <Card className="bg-white border-none shadow-lg">
                  <CardHeader>
                    <CardTitle className="text-base">Physician Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-700">{visit.physician_notes}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}