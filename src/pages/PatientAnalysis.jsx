import React, { useMemo } from "react";
import { api } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  User,
  Calendar,
  FileText,
  ChevronRight,
  TrendingUp,
  FileBarChart,
} from "lucide-react";
import { format, differenceInYears } from "date-fns";

export default function PatientAnalysis() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const patientMrn = urlParams.get("mrn");

  const { data: patient, isLoading: patientLoading } = useQuery({
    queryKey: ["patient", patientMrn],
    queryFn: async () => {
      const patients = await api.entities.Patient.filter({ medical_record_number: patientMrn });
      return patients[0];
    },
    enabled: !!patientMrn,
  });

  const { data: visits = [], isLoading: visitsLoading } = useQuery({
    queryKey: ["visits", patientMrn],
    queryFn: () => api.entities.Visit.filter({ patient_mrn: patientMrn }, "-visit_date"),
    enabled: !!patientMrn,
  });

  const visitsChrono = useMemo(() => {
    return [...visits].sort(
      (a, b) => new Date(a.visit_date).getTime() - new Date(b.visit_date).getTime()
    );
  }, [visits]);

  const latestVisitId = visits[0]?.id;

  if (patientLoading || visitsLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-6">
        <div className="text-teal-700">Loading patient data...</div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-6">
        <div className="text-teal-700">Patient not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate(createPageUrl("Patients"))}
              className="border-teal-200 hover:bg-teal-50"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-teal-900">Patient analysis</h1>
              <p className="text-sm text-teal-700">Visit history and links to reports</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-teal-300 text-teal-800 hover:bg-teal-50"
              asChild
            >
              <Link
                to={createPageUrl(
                  `ReportSerialTrends?patientId=${encodeURIComponent(patientMrn || "")}${
                    latestVisitId ? `&visitId=${encodeURIComponent(latestVisitId)}` : ""
                  }`
                )}
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                Serial trend analysis
              </Link>
            </Button>
          </div>
        </div>

        <Card className="border-teal-200 bg-white/80 backdrop-blur shadow-sm mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 bg-gradient-to-br from-teal-600 to-teal-800 rounded-full flex items-center justify-center text-white font-bold text-xl shrink-0">
                {patient.first_name?.[0]}
                {patient.last_name?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-semibold text-teal-900 truncate">
                  {patient.first_name} {patient.last_name}
                </h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-teal-700 mt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    Age {differenceInYears(new Date(), new Date(patient.date_of_birth))}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    DOB {format(new Date(patient.date_of_birth), "MMM d, yyyy")}
                  </span>
                  {patient.medical_record_number && (
                    <span className="inline-flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      MRN {patient.medical_record_number}
                    </span>
                  )}
                </div>
                {patient.primary_diagnosis && (
                  <Badge className="mt-2 bg-teal-100 text-teal-900 border-teal-200">
                    {patient.primary_diagnosis}
                  </Badge>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold text-teal-900">{visits.length}</div>
                <div className="text-xs text-teal-600 uppercase tracking-wide">Visits</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {visits.length === 0 ? (
          <Card className="border-teal-200 bg-white/80 backdrop-blur">
            <CardContent className="text-center py-12">
              <FileText className="w-12 h-12 text-teal-300 mx-auto mb-3" />
              <p className="text-teal-700 mb-4">No visits recorded for this patient yet</p>
              <Link to={createPageUrl("NewVisit")}>
                <Button className="bg-teal-700 hover:bg-teal-800">Record first visit</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-teal-200 bg-white/80 backdrop-blur shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-teal-900">Visit history</CardTitle>
              <p className="text-sm text-teal-600 font-normal">
                Open the full report for any visit. Keyword and sentiment trends across visits live under{" "}
                <span className="font-medium text-teal-800">Serial trend analysis</span>.
              </p>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-teal-100 rounded-lg border border-teal-100 overflow-hidden">
                {visitsChrono
                  .slice()
                  .reverse()
                  .map((visit) => (
                    <li key={visit.id}>
                      <Link
                        to={createPageUrl(
                          `ReportSummary?visitId=${encodeURIComponent(visit.id)}&patientMrn=${encodeURIComponent(patientMrn || "")}`
                        )}
                        className="flex items-center gap-4 p-4 hover:bg-teal-50/80 transition-colors group"
                      >
                        <div className="w-10 h-10 rounded-lg bg-teal-100 flex items-center justify-center shrink-0">
                          <FileBarChart className="w-5 h-5 text-teal-800" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-semibold text-teal-900">
                              Visit #{visit.visit_number ?? "—"}
                            </span>
                            <span className="text-sm text-teal-600">
                              {format(new Date(visit.visit_date), "MMM d, yyyy")}
                            </span>
                          </div>
                          <p className="text-sm text-slate-700 mt-0.5 line-clamp-2">
                            {visit.chief_complaint || "No chief complaint recorded"}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {visit.keyword_analysis && (
                              <Badge variant="outline" className="border-teal-200 text-teal-800 text-xs">
                                {Object.keys(visit.keyword_analysis.diagnostic_keywords || {}).length}{" "}
                                keywords
                              </Badge>
                            )}
                            {visit.sentiment_analysis && (
                              <Badge
                                className={
                                  visit.sentiment_analysis.overall_sentiment === "positive"
                                    ? "bg-emerald-100 text-emerald-900 text-xs"
                                    : visit.sentiment_analysis.overall_sentiment === "negative"
                                      ? "bg-amber-100 text-amber-900 text-xs"
                                      : "bg-teal-100 text-teal-900 text-xs"
                                }
                              >
                                {visit.sentiment_analysis.overall_sentiment}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-teal-400 group-hover:text-teal-700 shrink-0" />
                      </Link>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
