const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OLLAMA_BASE_URL = import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434';

// Diagnostic keywords ROS (??)
const DIAGNOSTIC_KEYWORDS = {
  CARDIOVASCULAR: ['chest pain', 'palpitations', 'shortness of breath', 'dyspnea', 'edema', 'syncope'],
  RESPIRATORY: ['cough', 'wheezing', 'breathless', 'sputum', 'hemoptysis'],
  GASTROINTESTINAL: ['nausea', 'vomiting', 'diarrhea', 'constipation', 'abdominal pain', 'bloated', 'stomach'],
  NEUROLOGICAL: ['headache', 'dizzy', 'dizziness', 'seizure', 'numbness', 'tingling', 'confusion'],
  MUSCULOSKELETAL: ['pain', 'joint', 'joints', 'muscle', 'muscles', 'stiff', 'sore', 'weakness', 'ache'],
  CONSTITUTIONAL: ['fatigue', 'fever', 'chills', 'weight loss', 'weight gain', 'sweats'],
  PSYCHIATRIC: ['anxiety', 'depression', 'sleep', 'insomnia', 'mood', 'stress']
};

// Keyword analysis
export const analyzeKeywords = (text) => {
  const words = text.toLowerCase().split(/\s+/);
  const totalWords = words.length;
  const diagnosticKeywords = {};
  
  // Lowercase all keywords
  const allKeywords = Object.values(DIAGNOSTIC_KEYWORDS).flat();
  
  // Count occurrences
  words.forEach(word => {
    if (allKeywords.includes(word)) {
      diagnosticKeywords[word] = (diagnosticKeywords[word] || 0) + 1;
    }
  });
  
  // Calculate percentage
  const keywordCount = Object.values(diagnosticKeywords).reduce((sum, count) => sum + count, 0);
  const keywordPercentage = totalWords > 0 ? (keywordCount / totalWords) * 100 : 0;
  
  // Get top keywords
  const topKeywords = Object.entries(diagnosticKeywords)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([word, count]) => {
      // Find category
      let category = 'OTHER';
      for (const [cat, keywords] of Object.entries(DIAGNOSTIC_KEYWORDS)) {
        if (keywords.includes(word)) {
          category = cat;
          break;
        }
      }
      return { word, count, category };
    });
  
  return {
    total_words: totalWords,
    diagnostic_keywords: diagnosticKeywords,
    keyword_percentage: parseFloat(keywordPercentage.toFixed(1)),
    top_keywords: topKeywords
  };
};

// Sentiment analysis
export const analyzeSentiment = (text) => {
  const lowerText = text.toLowerCase();
  
  // Simple sentiment indicators
  const negativeWords = ['pain', 'hurt', 'severe', 'terrible', 'awful', 'can\'t', 'unable', 'difficult', 'worse', 'bad'];
  const positiveWords = ['better', 'improved', 'good', 'fine', 'well', 'easy', 'comfortable'];
  const distressWords = ['severe', 'extreme', 'terrible', 'unbearable', 'constant', 'always'];
  
  let negativeCount = 0;
  let positiveCount = 0;
  let distressCount = 0;
  
  negativeWords.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) negativeCount += matches.length;
  });
  
  positiveWords.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) positiveCount += matches.length;
  });
  
  distressWords.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) distressCount += matches.length;
  });
  
  const sentimentScore = (positiveCount - negativeCount) / Math.max(positiveCount + negativeCount, 1);
  const overallSentiment = sentimentScore > 0.2 ? 'positive' : sentimentScore < -0.2 ? 'negative' : 'neutral';
  const distressLevel = distressCount > 2 ? 'high' : distressCount > 0 ? 'medium' : 'low';
  
  // Extract emotional indicators from keywords
  const keywordAnalysis = analyzeKeywords(text);
  const emotionalIndicators = Object.keys(keywordAnalysis.diagnostic_keywords).slice(0, 7);
  
  return {
    overall_sentiment: overallSentiment,
    sentiment_score: parseFloat(sentimentScore.toFixed(2)),
    distress_level: distressLevel,
    emotional_indicators: emotionalIndicators
  };
};

// Semantic analysis
export const analyzeSemantics = (text) => {
  const keywordAnalysis = analyzeKeywords(text);
  const topWords = Object.keys(keywordAnalysis.diagnostic_keywords);
  
  // Determine key themes
  const themes = [];
  if (topWords.some(w => ['pain', 'ache', 'sore'].includes(w))) themes.push('widespread pain');
  if (topWords.includes('fatigue')) themes.push('fatigue');
  if (topWords.includes('nausea')) themes.push('nausea');
  if (topWords.includes('sleep') || topWords.includes('insomnia')) themes.push('sleep disturbances');
  if (topWords.includes('stomach') || topWords.includes('bloated')) themes.push('gastrointestinal issues');
  if (topWords.includes('dizzy') || topWords.includes('dizziness')) themes.push('dizziness');
  
  // Severity assessment
  const severeWords = text.toLowerCase().match(/\b(severe|extreme|terrible|unbearable)\b/g);
  const symptomSeverity = severeWords && severeWords.length > 1 ? 'severe' : 'moderate';
  
  const functionalWords = text.toLowerCase().match(/\b(can't|unable|difficult|hard)\b/g);
  const functionalImpact = functionalWords && functionalWords.length > 1 ? 'severe' : 'moderate';
  
  const chronicWords = text.toLowerCase().match(/\b(constantly|always|chronic|ongoing)\b/g);
  const temporalPatterns = chronicWords ? 'chronic' : 'acute';
  
  return {
    key_themes: themes,
    symptom_severity: symptomSeverity,
    functional_impact: functionalImpact,
    temporal_patterns: temporalPatterns
  };
};

// OpenAI API call
const callOpenAI = async (transcription) => {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }
  
  const prompt = `You are a medical AI assistant. Analyze this patient transcription and provide:
1. Suggested diagnoses (up to 3)
2. Recommended diagnostic tests (up to 5)
3. Treatment suggestions (up to 5)
4. Follow-up recommendations

Patient transcription: "${transcription}"

Respond in JSON format:
{
  "suggested_diagnoses": ["diagnosis1", "diagnosis2", "diagnosis3"],
  "recommended_tests": ["test1", "test2", "test3", "test4", "test5"],
  "treatment_suggestions": ["treatment1", "treatment2", "treatment3", "treatment4", "treatment5"],
  "follow_up_recommendations": "follow-up text"
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a medical diagnostic AI assistant. Respond only in valid JSON format.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    })
  });
  
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  const content = data.choices[0].message.content;
  
  // Parse JSON response
  return JSON.parse(content);
};

// Ollama API call
const callOllama = async (transcription) => {
  const prompt = `You are a medical AI assistant. Analyze this patient transcription and provide:
1. Suggested diagnoses (up to 3)
2. Recommended diagnostic tests (up to 5)
3. Treatment suggestions (up to 5)
4. Follow-up recommendations

Patient transcription: "${transcription}"

Respond in JSON format:
{
  "suggested_diagnoses": ["diagnosis1", "diagnosis2", "diagnosis3"],
  "recommended_tests": ["test1", "test2", "test3", "test4", "test5"],
  "treatment_suggestions": ["treatment1", "treatment2", "treatment3", "treatment4", "treatment5"],
  "follow_up_recommendations": "follow-up text"
}`;

  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama2',
      prompt: prompt,
      stream: false,
      format: 'json'
    })
  });
  
  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return JSON.parse(data.response);
};

// Compare all AI models
export const compareAllModels = async (transcription, onProgress) => {
  const results = {
    openai: null,
    ollama: null,
    errors: {}
  };
  
  // Try OpenAI
  try {
    if (onProgress) onProgress('openai', 'running');
    const diagnostic = await callOpenAI(transcription);
    results.openai = { diagnostic };
    if (onProgress) onProgress('openai', 'complete');
  } catch (error) {
    console.error('OpenAI error:', error);
    results.errors.openai = error.message;
    if (onProgress) onProgress('openai', 'error');
  }
  
  // Try Ollama
  try {
    if (onProgress) onProgress('ollama', 'running');
    const diagnostic = await callOllama(transcription);
    results.ollama = { diagnostic };
    if (onProgress) onProgress('ollama', 'complete');
  } catch (error) {
    console.error('Ollama error:', error);
    results.errors.ollama = error.message;
    if (onProgress) onProgress('ollama', 'error');
  }
  
  return results;
};

// Get consensus result from multiple models
/*export const getConsensusResult = (results) => {
  const successfulModels = [];
  
  if (results.openai && !results.errors.openai) successfulModels.push('openai');
  if (results.ollama && !results.errors.ollama) successfulModels.push('ollama');
  
  if (successfulModels.length === 0) {
    return null; // All models failed
  }
  
  // Use first successful model as base (prefer OpenAI)
  const baseModel = successfulModels.includes('openai') ? 'openai' : 'ollama';
  const baseResult = results[baseModel].diagnostic;
  
  return {
    ...baseResult,
    consensus_note: `Based on ${successfulModels.length} AI model(s): ${successfulModels.join(', ')}`
  };*/
  // Get consensus result from multiple models
export const getConsensusResult = (results, transcription) => {
  const successfulModels = [];
  
  if (results.openai && !results.errors.openai) successfulModels.push('openai');
  if (results.ollama && !results.errors.ollama) successfulModels.push('ollama');
  
  if (successfulModels.length === 0) {
    return null; // All models failed
  }
  
  // Use first successful model as base (i prefer OpenAI)
  const baseModel = successfulModels.includes('openai') ? 'openai' : 'ollama';
  const baseResult = results[baseModel].diagnostic;
  
  // Generate local analysis for consensus
  const keywordAnalysis = analyzeKeywords(transcription);
  const sentimentAnalysis = analyzeSentiment(transcription);
  const semanticAnalysis = analyzeSemantics(transcription);
  
  return {
    // Local analysis 
    keyword_analysis: keywordAnalysis,
    sentiment_analysis: sentimentAnalysis,
    semantic_analysis: semanticAnalysis,
    // AI diagnostic assessment
    ai_assessment: {
      ...baseResult,
      consensus_note: `Based on ${successfulModels.length} AI model(s): ${successfulModels.join(', ')}`
    }
  };
};