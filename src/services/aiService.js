const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OLLAMA_BASE_URL = import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434';

import { pipeline } from '@xenova/transformers';


let sentimentClassifier = null;
let isInitializing = false;
let initializationPromise = null;


async function initializeSentimentClassifier() {
  if (sentimentClassifier) return sentimentClassifier;
  
  if (isInitializing) {
    return initializationPromise;
  }
  
  isInitializing = true;
  console.log('Loading Transformers.js sentiment model (one-time, ~10 seconds)...');
  
  initializationPromise = (async () => {
    try {
      sentimentClassifier = await pipeline(
        'sentiment-analysis',
        'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
      );
      console.log('Sentiment model loaded successfully!');
      return sentimentClassifier;
    } catch (error) {
      console.error('Failed to load sentiment model:', error);
      isInitializing = false;
      throw error;
    }
  })();
  
  return initializationPromise;
}


const DIAGNOSTIC_KEYWORDS = {
  CARDIOVASCULAR: {
    phrases: ['chest pain', 'shortness of breath', 'short of breath', 'out of breath'],
    words: ['chest', 'heart', 'palpitations', 'swollen', 'edema', 'syncope']
  },
  RESPIRATORY: {
    phrases: ['catching my breath', 'hard to breathe', 'trouble breathing'],
    words: ['cough', 'wheezing', 'breathless', 'sputum', 'gasping']
  },
  GASTROINTESTINAL: {
    phrases: ['stomach pain', 'abdominal pain', 'feel sick'],
    words: ['nausea', 'vomiting', 'diarrhea', 'constipation', 'bloated']
  },
  NEUROLOGICAL: {
    phrases: ['bad headache', 'head hurts', 'feel dizzy'],
    words: ['headache', 'seizure', 'numbness', 'tingling', 'confusion']
  },
  MUSCULOSKELETAL: {
    phrases: ['joint pain', 'muscle pain', 'back pain', 'knee pain'],
    words: ['joint', 'muscle', 'pain', 'ache', 'sore', 'stiff', 'weak']
  },
  CONSTITUTIONAL: {
    phrases: ['feel tired', 'no energy', 'weight loss'],
    words: ['fever', 'chills', 'fatigue', 'exhausted', 'sweats']
  },
  PSYCHIATRIC: {
    phrases: ['feel anxious', 'feel depressed', 'can\'t sleep'],
    words: ['anxiety', 'depression', 'stress', 'worried', 'mood']
  }
};



/*export const analyzeKeywords = (text) => {
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
};*/
export const analyzeKeywords = (text) => {
  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);
  const totalWords = words.length;
  const diagnosticKeywords = {};
  
  // Find phrases first 
  Object.entries(DIAGNOSTIC_KEYWORDS).forEach(([category, data]) => {
    data.phrases?.forEach(phrase => {
      const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
      const matches = lowerText.match(regex);
      if (matches) {
        diagnosticKeywords[phrase] = {
          count: matches.length,
          category: category
        };
      }
    });
  });
  
  // Find single words (exclude if already in phrase)
  const phrasesFound = Object.keys(diagnosticKeywords).join(' ').toLowerCase();
  
  words.forEach(word => {
    // Skip if word is part of a phrase we already found
    if (phrasesFound.includes(word)) return;
    
    // Check if word is in any category
    Object.entries(DIAGNOSTIC_KEYWORDS).forEach(([category, data]) => {
      if (data.words?.includes(word)) {
        if (!diagnosticKeywords[word]) {
          diagnosticKeywords[word] = {
            count: 0,
            category: category
          };
        }
        diagnosticKeywords[word].count++;
      }
    });
  });
  
  // Calculate percentage
  const keywordCount = Object.values(diagnosticKeywords).reduce((sum, item) => sum + item.count, 0);
  const keywordPercentage = totalWords > 0 ? (keywordCount / totalWords) * 100 : 0;
  
  // Get top keywords
  const topKeywords = Object.entries(diagnosticKeywords)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([keyword, data]) => ({
      word: keyword,
      count: data.count,
      category: data.category
    }));
  
  return {
    total_words: totalWords,
    diagnostic_keywords: diagnosticKeywords,
    keyword_percentage: parseFloat(keywordPercentage.toFixed(1)),
    top_keywords: topKeywords
  };
};


export const analyzeSentiment = async (text) => {
  try {
    // Trying to use advanced Transformers.js model
    const classifier = await initializeSentimentClassifier();
    
    // Analyze sentiment with BERT
    const result = await classifier(text);
    
    // Extract result
    const label = result[0].label.toLowerCase(); // 'positive' or 'negative'
    const confidence = result[0].score; // 0-1 confidence score
    
    // Convert to sentiment score (-1 to +1)
    const sentimentScore = label === 'positive' ? confidence : -confidence;
    
    // Determine distress level based on negative sentiment strength
    let distressLevel = 'low';
    if (label === 'negative') {
      if (confidence > 0.9) distressLevel = 'high';
      else if (confidence > 0.7) distressLevel = 'medium';
    }
    
    // Extract emotional indicators using keyword analysis
    const emotionalIndicators = extractEmotionalIndicators(text);
    
    return {
      // Core sentiment 
      overall_sentiment: label,
      sentiment_score: parseFloat(sentimentScore.toFixed(2)),
      distress_level: distressLevel,
      emotional_indicators: emotionalIndicators,
      
      // metadata
      confidence: Math.round(confidence * 100),
      analysis_type: 'transformers_bert',
      model: 'distilbert-base-uncased-finetuned-sst-2'
    };
    
  } catch (error) {
    console.warn('Transformers.js not available, using fallback sentiment analysis:', error.message);
    
    // Use simple rule-based analysis if model fails to load
    return analyzeSentimentFallback(text);
  }
};


 //Fallback sentiment analysis (rule-based)/Used when Transformers.js model is not available

function analyzeSentimentFallback(text) {
  const lowerText = text.toLowerCase();
  
  // Simple sentiment indicators
  const negativeWords = ['pain', 'hurt', 'severe', 'terrible', 'awful', 'can\'t', 'unable', 'difficult', 'worse', 'bad', 'throbbing'];
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
    emotional_indicators: emotionalIndicators,
    analysis_type: 'rule_based_fallback'
  };
}

/**
 * Extract emotional indicators from text
 * Provides specific flags for clinical relevance
 */
function extractEmotionalIndicators(text) {
  const indicators = [];
  const lowerText = text.toLowerCase();
  
  // Pain indicators
  if (lowerText.match(/\b(pain|hurt|ache|sore|throbbing)\b/i)) {
    indicators.push('pain');
  }
  
  // Severity indicators
  if (lowerText.match(/\b(severe|extreme|terrible|unbearable|constant|always|chronic)\b/i)) {
    indicators.push('high_severity');
  }
  
  // Functional limitations
  if (lowerText.match(/\b(can't|cannot|unable|difficult|hard to|struggle|struggling)\b/i)) {
    indicators.push('functional_limitation');
  }
  
  // Anxiety indicators
  if (lowerText.match(/\b(worried|anxious|scared|nervous|afraid|frightened|panic)\b/i)) {
    indicators.push('anxiety');
  }
  
  // Depression indicators
  if (lowerText.match(/\b(sad|depressed|hopeless|down|miserable|worthless)\b/i)) {
    indicators.push('depression');
  }
  
  // Urgency indicators
  if (lowerText.match(/\b(emergency|urgent|immediate|sudden|worst)\b/i)) {
    indicators.push('urgency');
  }
  
  // Improvement indicators
  if (lowerText.match(/\b(better|improved|improving|relief|relieved|easier)\b/i)) {
    indicators.push('improvement');
  }
  
  return indicators;
}



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


export const getConsensusResult = async (results, transcription) => {
  const successfulModels = [];
  
  if (results.openai && !results.errors.openai) successfulModels.push('openai');
  if (results.ollama && !results.errors.ollama) successfulModels.push('ollama');
  
  if (successfulModels.length === 0) {
    return null; // All models failed
  }
  
  // Use first successful model as base (prefer OpenAI)
  // Note: Add 3rd model preference here if needed
  const baseModel = successfulModels.includes('openai') ? 'openai' : 'ollama';
  const baseResult = results[baseModel].diagnostic;
  
  // Generate local analysis for consensus
  const keywordAnalysis = analyzeKeywords(transcription);
  const sentimentAnalysis = await analyzeSentiment(transcription); 
  const semanticAnalysis = analyzeSemantics(transcription);
  
  return {
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


export const preloadSentimentModel = async () => {
  try {
    console.log('Pre-loading sentiment model in background...');
    await initializeSentimentClassifier();
    console.log('Sentiment model pre-loaded successfully!');
    return true;
  } catch (error) {
    console.error('Failed to pre-load sentiment model:', error);
    return false;
  }
};