/**
 * jsonlLogger.js
 * Audio subsystem JSONL logger — Doctor AI Subsystem Output Spec v0.1
 *
 * Usage:
 *   import { AudioJsonlLogger } from './jsonlLogger';
 *   const logger = new AudioJsonlLogger({ visitId: 'V123', patientId: 'P001' });
 *
 *   logger.logWindow({ tStart, tEnd, keywordAnalysis, sentimentAnalysis, semanticAnalysis, wordCount });
 *   logger.logSummary();
 *   const blob = logger.toBlob();           // download as audio.jsonl
 *   await logger.flush(backendUrl);         // POST to /api/visits/:id/audio.jsonl
 */

const SCHEMA_VERSION = 'v0.1';
const WINDOW_DURATION_S = 10; // default audio window size

// ─── Mapping helpers ────────────────────────────────────────────────────────

/**
 * Map analyzeKeywords() output → spec diagnostic_terms + top_words
 */
function mapKeywords(keywordAnalysis) {
  if (!keywordAnalysis) return { top_words: [], diagnostic_terms: { matches: [], diagnostic_term_pct: 0 } };

  const topWords = (keywordAnalysis.top_keywords || []).map(({ word, count }) => [word, count]);

  const matches = (keywordAnalysis.top_keywords || []).map(({ word, count }) => [word, count]);
  const totalWords = keywordAnalysis.total_words || 1;
  const matchedCount = (keywordAnalysis.top_keywords || []).reduce((sum, { count }) => sum + count, 0);
  const diagnosticTermPct = parseFloat((matchedCount / totalWords).toFixed(4));

  return {
    top_words: topWords,
    diagnostic_terms: {
      matches,
      diagnostic_term_pct: diagnosticTermPct,
    },
  };
}

/**
 * Map analyzeSentiment() output → spec sentiment.polarity
 * sentiment_score is already -1 to +1
 */
function mapSentiment(sentimentAnalysis) {
  if (!sentimentAnalysis) return { polarity: null };
  return {
    polarity: sentimentAnalysis.sentiment_score ?? null,
    distress_level: sentimentAnalysis.distress_level ?? null,
    emotional_indicators: sentimentAnalysis.emotional_indicators ?? [],
  };
}

/**
 * Map analyzeSemantics() output → spec topics array [[label, weight], ...]
 * Semantic analysis doesn't produce scores, so we assign default weights.
 */
function mapTopics(semanticAnalysis) {
  if (!semanticAnalysis) return [];
  const topics = [];

  if (semanticAnalysis.key_themes?.length) {
    semanticAnalysis.key_themes.forEach((theme) => {
      topics.push([theme.toLowerCase().replace(/\s+/g, '_'), 0.7]);
    });
  }

  if (semanticAnalysis.temporal_patterns) {
    topics.push([`temporal_${semanticAnalysis.temporal_patterns}`, 0.6]);
  }

  if (semanticAnalysis.symptom_severity && semanticAnalysis.symptom_severity !== 'moderate') {
    topics.push([`severity_${semanticAnalysis.symptom_severity}`, 0.65]);
  }

  return topics.slice(0, 5); // cap at 5 topics
}

/**
 * Derive confidence from sentiment + keyword data.
 * Uses sentiment model confidence if available, else estimates from keyword coverage.
 */
function deriveConfidence(sentimentAnalysis, keywordAnalysis) {
  if (sentimentAnalysis?.confidence != null) {
    // confidence is stored as 0–100 from the BERT model
    const raw = sentimentAnalysis.confidence;
    return parseFloat((raw > 1 ? raw / 100 : raw).toFixed(3));
  }
  // fallback: use keyword coverage as a proxy (more keywords → more signal → higher confidence)
  const pct = keywordAnalysis?.keyword_percentage ?? 0;
  return parseFloat(Math.min(0.5 + pct / 100, 0.95).toFixed(3));
}

// ─── AudioJsonlLogger class ──────────────────────────────────────────────────

export class AudioJsonlLogger {
  /**
   * @param {object} opts
   * @param {string} opts.visitId   - unique visit ID (e.g. "V123")
   * @param {string} opts.patientId - patient ID (e.g. "P001")
   * @param {string} [opts.phase]   - "encounter" | "entry" (default: "encounter")
   * @param {number} [opts.t0]      - visit start as Date.now() ms; defaults to construction time
   */
  constructor({ visitId, patientId, phase = 'encounter', t0 = null }) {
    if (!visitId) throw new Error('AudioJsonlLogger: visitId is required');
    if (!patientId) throw new Error('AudioJsonlLogger: patientId is required');

    this.visitId = visitId;
    this.patientId = patientId;
    this.phase = phase;
    this.t0 = t0 ?? Date.now();

    /** @type {object[]} */
    this._records = [];

    // Accumulators for summary
    this._windowCount = 0;
    this._totalWordCount = 0;
    this._sentimentScores = [];
    this._allTopWords = {};
    this._allTopics = {};
    this._firstTStart = null;
    this._lastTEnd = null;
  }

  // ── Core envelope builder ──────────────────────────────────────────────────

  _envelope(type, timeFields) {
    return {
      visit_id: this.visitId,
      patient_id: this.patientId,
      subsystem: 'audio',
      phase: this.phase,
      type,
      schema_version: SCHEMA_VERSION,
      ...timeFields,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Log one analysis window.
   *
   * @param {object} opts
   * @param {number}  opts.tStart           - window start, seconds since visit start
   * @param {number}  opts.tEnd             - window end, seconds since visit start
   * @param {number}  opts.wordCount        - total words transcribed in this window
   * @param {object}  opts.keywordAnalysis  - output of analyzeKeywords()
   * @param {object}  opts.sentimentAnalysis - output of analyzeSentiment()
   * @param {object}  opts.semanticAnalysis  - output of analyzeSemantics()
   * @param {string}  [opts.notes]          - optional warning string
   */
  logWindow({ tStart, tEnd, wordCount = 0, keywordAnalysis, sentimentAnalysis, semanticAnalysis, notes }) {
    const { top_words, diagnostic_terms } = mapKeywords(keywordAnalysis);
    const sentiment = mapSentiment(sentimentAnalysis);
    const topics = mapTopics(semanticAnalysis);
    const confidence = deriveConfidence(sentimentAnalysis, keywordAnalysis);
    const valid = wordCount > 0 && confidence > 0.1;

    const record = {
      ...this._envelope('window', { t_start: tStart, t_end: tEnd }),
      features: {
        word_count: wordCount,
        top_words,
        diagnostic_terms,
        sentiment,
        topics,
        ...(semanticAnalysis?.functional_impact && { functional_impact: semanticAnalysis.functional_impact }),
      },
      confidence,
      valid,
      ...(notes && { notes }),
    };

    this._records.push(record);

    // Accumulate for summary
    this._windowCount++;
    this._totalWordCount += wordCount;
    if (sentimentAnalysis?.sentiment_score != null) {
      this._sentimentScores.push(sentimentAnalysis.sentiment_score);
    }
    top_words.forEach(([word, count]) => {
      this._allTopWords[word] = (this._allTopWords[word] || 0) + count;
    });
    topics.forEach(([label, weight]) => {
      if (!this._allTopics[label]) this._allTopics[label] = { sum: 0, count: 0 };
      this._allTopics[label].sum += weight;
      this._allTopics[label].count++;
    });
    if (this._firstTStart === null || tStart < this._firstTStart) this._firstTStart = tStart;
    if (this._lastTEnd === null || tEnd > this._lastTEnd) this._lastTEnd = tEnd;

    return record;
  }

  /**
   * Log a discrete event (e.g. "keyword_spike_detected", "silence_gap").
   *
   * @param {object} opts
   * @param {number} opts.t       - event time, seconds since visit start
   * @param {string} opts.event   - event label
   * @param {object} [opts.extra] - additional feature fields
   */
  logEvent({ t, event, extra = {} }) {
    const record = {
      ...this._envelope('event', { t }),
      features: { event, ...extra },
      confidence: 1.0,
      valid: true,
    };
    this._records.push(record);
    return record;
  }

  /**
   * Write the phase summary record.
   * Call this once at the end of the encounter.
   *
   * @param {object} [opts]
   * @param {string} [opts.notes]
   */
  logSummary({ notes } = {}) {
    const avgSentiment =
      this._sentimentScores.length > 0
        ? parseFloat(
            (this._sentimentScores.reduce((a, b) => a + b, 0) / this._sentimentScores.length).toFixed(3)
          )
        : null;

    const topWordsSummary = Object.entries(this._allTopWords)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([word, count]) => [word, count]);

    const topTopics = Object.entries(this._allTopics)
      .map(([label, { sum, count }]) => [label, parseFloat((sum / count).toFixed(3))])
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    const record = {
      ...this._envelope('summary', {
        t_start: this._firstTStart,
        t_end: this._lastTEnd,
      }),
      features: {
        total_windows: this._windowCount,
        total_words: this._totalWordCount,
        avg_sentiment_polarity: avgSentiment,
        top_words: topWordsSummary,
        top_topics: topTopics,
      },
      confidence: this._windowCount > 0 ? 1.0 : 0.0,
      valid: this._windowCount > 0,
      ...(notes && { notes }),
    };

    this._records.push(record);
    return record;
  }

  // ── Output helpers ─────────────────────────────────────────────────────────

  /**
   * Return all records as a JSONL string (one JSON object per line).
   */
  toJsonlString() {
    return this._records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }

  /**
   * Return a Blob suitable for download as audio.jsonl
   */
  toBlob() {
    return new Blob([this.toJsonlString()], { type: 'application/x-ndjson' });
  }

  /**
   * Download audio.jsonl directly from the browser.
   */
  download() {
    const url = URL.createObjectURL(this.toBlob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `audio_${this.visitId}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * POST the JSONL file to your Flask backend.
   *
   * @param {string} backendUrl - e.g. 'http://localhost:5001'
   * @returns {Promise<Response>}
   *
   * Backend should accept:
   *   POST /api/visits/:visitId/logs/audio
   *   Content-Type: application/x-ndjson
   */
  async flush(backendUrl) {
    const url = `${backendUrl}/api/visits/${this.visitId}/logs/audio`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: this.toJsonlString(),
    });
    if (!response.ok) {
      throw new Error(`Failed to flush audio JSONL: ${response.status} ${response.statusText}`);
    }
    return response;
  }

  /** How many records have been buffered so far. */
  get recordCount() {
    return this._records.length;
  }
}

// ─── Convenience: seconds-since-visit helper ─────────────────────────────────

/**
 * Create a helper that converts an absolute timestamp (ms) to seconds-since-visit.
 * @param {number} t0Ms - visit start time from Date.now()
 */
export function makeRelativeTimer(t0Ms) {
  return (absMs) => parseFloat(((absMs - t0Ms) / 1000).toFixed(3));
}

// ─── Integration example (remove before production) ──────────────────────────
//
// In your NewVisit.jsx or wherever you call analyzeSentiment / analyzeKeywords:
//
//   import { AudioJsonlLogger, makeRelativeTimer } from '../utils/jsonlLogger';
//   import { analyzeKeywords, analyzeSentiment, analyzeSemantics } from '../services/aiService';
//   import { TRANSCRIPTION_API_URL } from '../services/transcriptionService';
//
//   // On visit start:
//   const t0 = Date.now();
//   const toRel = makeRelativeTimer(t0);
//   const logger = new AudioJsonlLogger({ visitId: visit.id, patientId: visit.patient_id, t0 });
//
//   // For each 10s transcription window:
//   const windowStart = toRel(segmentStartMs);
//   const windowEnd   = toRel(segmentEndMs);
//   const keywordAnalysis  = analyzeKeywords(segmentText);
//   const sentimentAnalysis = await analyzeSentiment(segmentText);
//   const semanticAnalysis  = analyzeSemantics(segmentText);
//   logger.logWindow({ tStart: windowStart, tEnd: windowEnd, wordCount: segmentText.split(/\s+/).length,
//                      keywordAnalysis, sentimentAnalysis, semanticAnalysis });
//
//   // On encounter end:
//   logger.logSummary();
//   await logger.flush(TRANSCRIPTION_API_URL);   // or logger.download() for local testing
