import React, { useMemo } from "react";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown, TrendingUp } from "lucide-react";

/**
 * Keyword + sentiment trend charts built from stored Visit rows (transcription / NLP fields).
 */
export default function PatientNlpTrendCharts({ visits }) {
  const TOP_DIAGNOSTIC_WORDS = 4;
  const wordLineColors = ["#0d9488", "#2563eb", "#7c3aed", "#dc2626", "#ea580c", "#16a34a"];

  const keywordTrendData = useMemo(
    () =>
      (visits || []).map((visit) => ({
        visit: `Visit ${visit.visit_number ?? "—"}`,
        date: format(new Date(visit.visit_date), "MMM d"),
        keywords: Object.keys(visit.keyword_analysis?.diagnostic_keywords || {}).length,
        keywordPercentage: visit.keyword_analysis?.keyword_percentage || 0,
      })),
    [visits]
  );

  const sentimentTrendData = useMemo(
    () =>
      (visits || []).map((visit) => ({
        visit: `Visit ${visit.visit_number ?? "—"}`,
        date: format(new Date(visit.visit_date), "MMM d"),
        sentiment: visit.sentiment_analysis?.sentiment_score || 0,
        distress:
          visit.sentiment_analysis?.distress_level === "high"
            ? 3
            : visit.sentiment_analysis?.distress_level === "medium"
              ? 2
              : 1,
      })),
    [visits]
  );

  const topKeywords = useMemo(() => {
    const allKeywords = {};
    (visits || []).forEach((visit) => {
      const keywords = visit.keyword_analysis?.diagnostic_keywords || {};
      Object.entries(keywords).forEach(([word, data]) => {
        const count = typeof data === "object" && data !== null ? data.count : data;
        allKeywords[word] = (allKeywords[word] || 0) + (typeof count === "number" ? count : 0);
      });
    });
    return Object.entries(allKeywords)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));
  }, [visits]);

  const diagnosticWordTrend = useMemo(() => {
    if (!visits?.length) return { words: [], data: [] };

    const totals = {};
    (visits || []).forEach((visit) => {
      const keywords = visit.keyword_analysis?.diagnostic_keywords || {};
      Object.entries(keywords).forEach(([word, data]) => {
        const count = typeof data === "object" && data !== null ? data.count : data;
        totals[word] = (totals[word] || 0) + (typeof count === "number" ? count : 0);
      });
    });

    const words = Object.entries(totals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_DIAGNOSTIC_WORDS)
      .map(([w]) => w);

    const data = (visits || []).map((visit) => {
      const keywords = visit.keyword_analysis?.diagnostic_keywords || {};
      const row = {
        date: format(new Date(visit.visit_date), "MMM d"),
        visit: `Visit ${visit.visit_number ?? "—"}`,
      };
      words.forEach((w) => {
        const v = keywords[w];
        const count = typeof v === "object" && v !== null ? v.count : v;
        row[w] = typeof count === "number" ? count : 0;
      });
      return row;
    });

    return { words, data };
  }, [visits]);

  if (!visits?.length) return null;

  const hasKeywordSeries = visits.some((v) => v.keyword_analysis);
  const hasSentimentSeries = visits.some((v) => v.sentiment_analysis);

  if (
    !hasKeywordSeries &&
    !hasSentimentSeries &&
    topKeywords.length === 0 &&
    diagnosticWordTrend.words.length === 0
  ) {
    return (
      <p className="text-sm text-teal-700 py-2">
        No keyword or sentiment fields on stored visits yet — charts will appear when visit NLP data exists.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {diagnosticWordTrend.words.length > 0 && (
        <Card className="border-teal-200 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-teal-900 text-base">
              <TrendingUp className="w-5 h-5 text-teal-700" />
              Top diagnostic words over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={diagnosticWordTrend.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ccfbf1" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                {diagnosticWordTrend.words.map((w, idx) => (
                  <Line
                    key={w}
                    type="monotone"
                    dataKey={w}
                    stroke={wordLineColors[idx % wordLineColors.length]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-teal-600 mt-3 text-center">
              Tracks the most frequent diagnostic keywords (across all visits) and how often they appear per visit
            </p>
          </CardContent>
        </Card>
      )}

      {hasKeywordSeries && (
        <Card className="border-teal-200 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-teal-900 text-base">
              <TrendingUp className="w-5 h-5 text-teal-700" />
              Diagnostic keyword trends (stored visits)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={keywordTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ccfbf1" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="keywords" stroke="#0d9488" strokeWidth={2} name="Keyword count" />
                <Line
                  type="monotone"
                  dataKey="keywordPercentage"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  name="Keyword %"
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-teal-600 mt-3 text-center">
              Frequency of diagnostic terms captured during visits
            </p>
          </CardContent>
        </Card>
      )}

      {hasSentimentSeries && (
        <Card className="border-teal-200 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-teal-900 text-base">
              <TrendingDown className="w-5 h-5 text-teal-700" />
              Sentiment &amp; distress trends (stored visits)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={sentimentTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ccfbf1" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sentiment" stroke="#7c3aed" strokeWidth={2} name="Sentiment score" />
                <Line type="monotone" dataKey="distress" stroke="#dc2626" strokeWidth={2} name="Distress (1–3)" />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-teal-600 mt-3 text-center">
              Sentiment score and coarse distress level over time
            </p>
          </CardContent>
        </Card>
      )}

      {topKeywords.length > 0 && (
        <Card className="border-teal-200 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-teal-900 text-base">Most frequent diagnostic keywords (all visits)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topKeywords}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ccfbf1" />
                <XAxis dataKey="word" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
