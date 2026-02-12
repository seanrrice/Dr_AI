# test_transcription_accuracy.py
import numpy as np
import wave
import os
import tempfile
import string
from faster_whisper import WhisperModel
from app import normalize_audio, save_wav_file, SAMPLE_RATE, format_timestamp
import difflib

# Helper function to normalize words by removing punctuation
def normalize_word(word):
    """Remove punctuation from a word for comparison purposes"""
    return word.strip(string.punctuation).lower()

def normalize_words_for_comparison(words):
    """Normalize a list of words by removing punctuation"""
    return [normalize_word(word) for word in words]

def merge_compound_words(words1, words2):
    """
    Try to merge adjacent words in words1 if their concatenation matches a word in words2.
    Returns normalized sequences that handle compound word splitting/merging.
    """
    # Normalize both sequences
    norm1 = normalize_words_for_comparison(words1)
    norm2 = normalize_words_for_comparison(words2)
    
    # Create a set of all words in sequence 2 (for quick lookup)
    words2_set = set(norm2)
    
    # Try to merge adjacent words in sequence 1
    merged1 = []
    merged1_original = []
    i = 0
    while i < len(norm1):
        # Try merging with next word(s)
        merged = False
        for j in range(i + 1, min(i + 3, len(norm1) + 1)):  # Try up to 2-word merges
            merged_word = ''.join(norm1[i:j])
            if merged_word in words2_set:
                # Found a match! Merge these words
                merged1.append(merged_word)
                merged1_original.append(' '.join(words1[i:j]))
                i = j
                merged = True
                break
        
        if not merged:
            # No merge found, keep original word
            merged1.append(norm1[i])
            merged1_original.append(words1[i])
            i += 1
    
    # Do the same for sequence 2
    words1_set = set(norm1)
    merged2 = []
    merged2_original = []
    i = 0
    while i < len(norm2):
        merged = False
        for j in range(i + 1, min(i + 3, len(norm2) + 1)):
            merged_word = ''.join(norm2[i:j])
            if merged_word in words1_set:
                merged2.append(merged_word)
                merged2_original.append(' '.join(words2[i:j]))
                i = j
                merged = True
                break
        
        if not merged:
            merged2.append(norm2[i])
            merged2_original.append(words2[i])
            i += 1
    
    return merged1, merged1_original, merged2, merged2_original

# Use the EXACT same model initialization as app.py
def create_model():
    """Create model with identical settings to app.py"""
    try:
        return WhisperModel("small.en", device="cpu", compute_type="int8")
    except Exception as e:
        print(f"Failed to load Whisper model: {e}")
        return None

def load_audio_file(audio_path, target_sr=SAMPLE_RATE):
    """Load audio file and resample to target sample rate if needed.
    Supports WAV, FLAC, and other formats via librosa or soundfile.
    """
    try:
        import librosa
        # Load audio file with librosa (handles resampling properly and supports FLAC)
        audio, sr = librosa.load(audio_path, sr=target_sr, mono=True)
        return audio.astype(np.float32)
    except ImportError:
        # Try soundfile as fallback (supports FLAC)
        try:
            import soundfile as sf
            audio, sr = sf.read(audio_path)
            # Convert to mono if stereo
            if audio.ndim > 1:
                audio = np.mean(audio, axis=1)
            # Resample if needed
            if sr != target_sr:
                try:
                    from scipy import signal
                    num_samples = int(len(audio) * target_sr / sr)
                    audio = signal.resample(audio, num_samples)
                except ImportError:
                    # Fallback to simple interpolation if scipy not available
                    num_samples = int(len(audio) * target_sr / sr)
                    audio = np.interp(
                        np.linspace(0, len(audio), num_samples),
                        np.arange(len(audio)),
                        audio
                    )
            return audio.astype(np.float32)
        except ImportError:
            # Final fallback: wave (WAV only)
            print("⚠️  librosa/soundfile not installed. Using wave (WAV files only)")
            if not audio_path.lower().endswith('.wav'):
                raise ValueError(f"FLAC/other formats require librosa or soundfile. File: {audio_path}")
            with wave.open(audio_path, 'rb') as wf:
                frames = wf.getnframes()
                sample_rate = wf.getframerate()
                audio_bytes = wf.readframes(frames)
                audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32767.0
                
                # Simple resampling (not ideal, but works)
                if sample_rate != target_sr:
                    num_samples = int(len(audio) * target_sr / sample_rate)
                    audio = np.interp(
                        np.linspace(0, len(audio), num_samples),
                        np.arange(len(audio)),
                        audio
                    )
            return audio.astype(np.float32)

def transcribe_audio_identical_to_app(audio_array, model):
    """
    Transcribe audio using IDENTICAL logic to app.py's transcribe_audio method.
    
    This function replicates the exact steps:
    1. normalize_audio(audio)
    2. save_wav_file(audio, SAMPLE_RATE, 1)
    3. model.transcribe(wav_path)
    4. " ".join([seg.text for seg in segments]).strip()
    """
    # Step 1: Normalize (identical to app.py line 188)
    audio = normalize_audio(audio_array)
    
    # Step 2: Save WAV file (identical to app.py line 189)
    wav_path = save_wav_file(audio, SAMPLE_RATE, 1)
    
    # Step 3 & 4: Transcribe (identical to app.py lines 194-195)
    try:
        if model:
            segments, _ = model.transcribe(wav_path)  # No additional parameters
            text = " ".join([seg.text for seg in segments]).strip()
        else:
            text = "Simulated transcription"
        return text
    except Exception as e:
        print(f"Transcription error: {e}")
        return ""
    finally:
        # Cleanup (identical to app.py lines 207-210)
        try:
            os.remove(wav_path)
        except Exception:
            pass

def calculate_word_error_rate(reference, hypothesis):
    """Calculate Word Error Rate (WER) using proper edit distance
    Returns: (wer, total_errors, total_ref, differences_dict)
    differences_dict contains: substitutions, insertions, deletions
    """
    if not reference and not hypothesis:
        return 0.0, 0, 0, {'substitutions': [], 'insertions': [], 'deletions': []}
    if not reference:
        return 1.0, len(hypothesis.split()), 0, {'substitutions': [], 'insertions': hypothesis.split(), 'deletions': []}
    if not hypothesis:
        return 1.0, len(reference.split()), len(reference.split()), {'substitutions': [], 'insertions': [], 'deletions': reference.split()}
    
    # Keep original words for display
    ref_words_original = reference.split()
    hyp_words_original = hypothesis.split()
    
    # Try to merge compound words (e.g., "camp fire" -> "campfire")
    ref_words_merged, ref_words_merged_original, hyp_words_merged, hyp_words_merged_original = merge_compound_words(
        ref_words_original, hyp_words_original
    )
    
    # Use SequenceMatcher to get edit operations (using merged/normalized words)
    d = difflib.SequenceMatcher(None, ref_words_merged, hyp_words_merged)
    
    # Get the edit operations (opcodes)
    # 'equal', 'delete', 'insert', 'replace'
    substitutions = 0
    insertions = 0
    deletions = 0
    
    # Track actual word differences
    substitutions_list = []
    insertions_list = []
    deletions_list = []
    
    for tag, i1, i2, j1, j2 in d.get_opcodes():
        if tag == 'replace':
            # Count substitutions (max of the two lengths)
            sub_count = max(i2 - i1, j2 - j1)
            substitutions += sub_count
            # Store the actual original words that differ (for display)
            ref_sub = ref_words_merged_original[i1:i2]
            hyp_sub = hyp_words_merged_original[j1:j2]
            substitutions_list.append({
                'reference': ' '.join(ref_sub),
                'hypothesis': ' '.join(hyp_sub)
            })
        elif tag == 'delete':
            deletions += i2 - i1
            deletions_list.append(' '.join(ref_words_merged_original[i1:i2]))
        elif tag == 'insert':
            insertions += j2 - j1
            insertions_list.append(' '.join(hyp_words_merged_original[j1:j2]))
    
    total_ref = len(ref_words_original)
    total_errors = substitutions + insertions + deletions
    
    wer = total_errors / total_ref if total_ref > 0 else 0.0
    
    differences = {
        'substitutions': substitutions_list,
        'insertions': insertions_list,
        'deletions': deletions_list
    }
    
    return wer, total_errors, total_ref, differences

def calculate_character_error_rate(reference, hypothesis):
    """Calculate Character Error Rate (CER) using proper edit distance"""
    if not reference and not hypothesis:
        return 0.0, 0, 0
    if not reference:
        return 1.0, len(hypothesis.replace(" ", "")), 0
    if not hypothesis:
        return 1.0, len(reference.replace(" ", "")), len(reference.replace(" ", ""))
    
    ref_chars = list(reference.lower().replace(" ", ""))
    hyp_chars = list(hypothesis.lower().replace(" ", ""))
    
    # Use SequenceMatcher to get edit operations
    d = difflib.SequenceMatcher(None, ref_chars, hyp_chars)
    
    # Get the edit operations (opcodes)
    substitutions = 0
    insertions = 0
    deletions = 0
    
    for tag, i1, i2, j1, j2 in d.get_opcodes():
        if tag == 'replace':
            # Count substitutions (max of the two lengths)
            substitutions += max(i2 - i1, j2 - j1)
        elif tag == 'delete':
            deletions += i2 - i1
        elif tag == 'insert':
            insertions += j2 - j1
    
    total_ref = len(ref_chars)
    total_errors = substitutions + insertions + deletions
    
    cer = total_errors / total_ref if total_ref > 0 else 0.0
    return cer, total_errors, total_ref

def test_transcription_accuracy(audio_file, ground_truth_text):
    """Test transcription accuracy for a single audio file"""
    print(f"\n{'='*60}")
    print(f"Testing: {audio_file}")
    print(f"{'='*60}")
    
    # Load model (identical to app.py)
    model = create_model()
    if not model:
        print("❌ Failed to load model")
        return None
    
    # Load audio file
    print("Loading audio file...")
    try:
        audio = load_audio_file(audio_file, target_sr=SAMPLE_RATE)
        print(f"Audio loaded: {len(audio)} samples at {SAMPLE_RATE}Hz")
    except Exception as e:
        print(f"❌ Error loading audio: {e}")
        return None
    
    # Transcribe using IDENTICAL logic to app.py
    print("Transcribing (using app.py logic)...")
    transcribed_text = transcribe_audio_identical_to_app(audio, model)
    
    print(f"\nGround Truth: {ground_truth_text}")
    print(f"Transcribed:  {transcribed_text}")
    
    # Calculate metrics
    wer, wer_errors, wer_total, differences = calculate_word_error_rate(ground_truth_text, transcribed_text)
    cer, cer_errors, cer_total = calculate_character_error_rate(ground_truth_text, transcribed_text)
    
    wer_accuracy = (1 - wer) * 100
    cer_accuracy = (1 - cer) * 100
    
    print(f"\n{'='*60}")
    print("ACCURACY METRICS:")
    print(f"{'='*60}")
    print(f"Word Error Rate (WER):     {wer:.4f} ({wer_errors}/{wer_total} errors)")
    print(f"Word Accuracy:             {wer_accuracy:.2f}%")
    print(f"Character Error Rate (CER): {cer:.4f} ({cer_errors}/{cer_total} errors)")
    print(f"Character Accuracy:        {cer_accuracy:.2f}%")
    
    # Display word differences
    print(f"\n{'='*60}")
    print("WORD DIFFERENCES:")
    print(f"{'='*60}")
    
    if differences['substitutions']:
        print(f"\nSubstitutions ({len(differences['substitutions'])}):")
        for i, sub in enumerate(differences['substitutions'], 1):
            print(f"  {i}. '{sub['reference']}' → '{sub['hypothesis']}'")
    else:
        print("\nSubstitutions: None")
    
    if differences['deletions']:
        print(f"\nDeletions (missing words, {len(differences['deletions'])}):")
        for i, deletion in enumerate(differences['deletions'], 1):
            print(f"  {i}. '{deletion}'")
    else:
        print("\nDeletions: None")
    
    if differences['insertions']:
        print(f"\nInsertions (extra words, {len(differences['insertions'])}):")
        for i, insertion in enumerate(differences['insertions'], 1):
            print(f"  {i}. '{insertion}'")
    else:
        print("\nInsertions: None")
    
    print(f"{'='*60}\n")
    
    return {
        'wer': wer,
        'wer_accuracy': wer_accuracy,
        'wer_errors': wer_errors,
        'wer_total': wer_total,
        'cer': cer,
        'cer_accuracy': cer_accuracy,
        'cer_errors': cer_errors,
        'cer_total': cer_total,
        'transcribed': transcribed_text,
        'differences': differences
    }

# Example usage
if __name__ == "__main__":
    # Test with your audio files - using os.path.join to avoid Windows path issues
    # 134 test cases
    test_cases = [
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0000.flac"),
            "ground_truth": "CHAPTER FOUR THE FIRST NIGHT IN CAMP"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0001.flac"),
            "ground_truth": "EVEN IF I CAN'T SING I CAN BEAT THAT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0002.flac"),
            "ground_truth": "NOT ON THE RANGE WHY NOT DEMANDED THE BOY"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0003.flac"),
            "ground_truth": "A LOUD LAUGH FOLLOWED AT CHUNKY'S EXPENSE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0004.flac"),
            "ground_truth": "THE PONY DID MOST OF IT ADMITTED THE LAD I JUST GAVE HIM HIS HEAD AND THAT'S ALL THERE WAS TO IT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0005.flac"),
            "ground_truth": "WALTER HAD GONE OUT WITH THE SECOND GUARD AND THE OTHERS HAD GATHERED AROUND THE CAMP FIRE FOR THEIR NIGHTLY STORY TELLING"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0006.flac"),
            "ground_truth": "NONE OF YOU WILL BE FIT FOR DUTY TO MORROW"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0007.flac"),
            "ground_truth": "WE'VE GOT A HARD DRIVE BEFORE US AND EVERY MAN MUST BE FIT AS A FIDDLE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0008.flac"),
            "ground_truth": "HUMPH GRUNTED CURLEY ADAMS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0009.flac"),
            "ground_truth": "THE COWBOY DID THIS VERY THING BUT WITHIN AN HOUR HE FOUND HIMSELF ALONE THE OTHERS HAVING TURNED IN ONE BY ONE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0010.flac"),
            "ground_truth": "THE LADS FOUND THAT A PAIR OF BLANKETS HAD BEEN ASSIGNED TO EACH OF THEM WITH AN ORDINARY WAGON SHEET DOUBLED FOR A TARPAULIN"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0011.flac"),
            "ground_truth": "THESE THEY SPREAD OUT ON THE GROUND USING BOOTS WRAPPED IN COATS FOR PILLOWS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0012.flac"),
            "ground_truth": "STACY BROWN PROVED THE ONLY GRUMBLER IN THE LOT DECLARING THAT HE COULD NOT SLEEP A WINK ON SUCH A BED AS THAT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0013.flac"),
            "ground_truth": "THE HORSES OF THE OUTFIT SAVE THOSE THAT WERE ON NIGHT DUTY AND TWO OR THREE OTHERS THAT HAD DEVELOPED A HABIT OF STRAYING HAD BEEN TURNED LOOSE EARLY IN THE EVENING FOR ANIMALS ON THE TRAIL ARE SELDOM STAKED DOWN"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0014.flac"),
            "ground_truth": "IN SPITE OF THEIR HARD COUCHES THE PONY RIDERS SLEPT SOUNDLY EVEN PROFESSOR ZEPPLIN HIMSELF NEVER WAKING THE WHOLE NIGHT THROUGH"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0015.flac"),
            "ground_truth": "STACY GRUMBLED TURNED OVER AND WENT TO SLEEP AGAIN"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0016.flac"),
            "ground_truth": "YOU WON'T BE SO FAST TO WAKE UP HARD WORKING COWBOYS AFTER THAT I RECKON"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0017.flac"),
            "ground_truth": "LUMPY BATES CAME RUNNING TOWARD HIM NOT DARING TO CALL OUT FOR FEAR OF WAKING THE CAMP"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0018.flac"),
            "ground_truth": "HI THERE HISSED LUMPY FILLED WITH INDIGNATION THAT ANYONE SHOULD ATTEMPT TO MOUNT A PONY FROM THE RIGHT SIDE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0019.flac"),
            "ground_truth": "STACY BROWN'S LEFT LEG SWUNG OVER THE SADDLE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0020.flac"),
            "ground_truth": "WHERE ARE THEY ASKED THE BOY"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0021.flac"),
            "ground_truth": "KEEP A GOING AND IF YOU'RE LUCKY YOU'LL RUN PLUMB INTO THEM WAS THE JEERING ANSWER AS THE SLEEPY COWMEN SPURRED THEIR PONIES ON TOWARD CAMP MUTTERING THEIR DISAPPROVAL OF TAKING ALONG A BUNCH OF BOYS ON A CATTLE DRIVE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0022.flac"),
            "ground_truth": "ALMOST BEFORE THE ECHOES OF HIS VOICE HAD DIED AWAY A SHRILL VOICE PIPED UP FROM THE TAIL END OF THE CHUCK WAGON"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0023.flac"),
            "ground_truth": "GRUB PI LE GRUB PI LE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0024.flac"),
            "ground_truth": "WHO IS THE WRANGLER THIS MORNING ASKED THE FOREMAN GLANCING ABOUT AT HIS MEN"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0025.flac"),
            "ground_truth": "A WRANGLER'S A WRANGLER ANSWERED BIG FOOT STOLIDLY"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0026.flac"),
            "ground_truth": "HE'S A FELLOW WHO'S ALL THE TIME MAKING TROUBLE ISN'T HE ASKED STACY INNOCENTLY"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0027.flac"),
            "ground_truth": "OH NO THIS KIND OF A WRANGLER ISN'T LAUGHED THE FOREMAN"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0028.flac"),
            "ground_truth": "HE'S A TROUBLE CURER NOT A TROUBLEMAKER EXCEPT FOR HIMSELF"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0029.flac"),
            "ground_truth": "PONG TELL THE YOUNG GENTLEMEN WHAT WOULD BECOME OF YOU IF YOU WERE TO SERVE BAD MEALS TO THIS OUTFIT OF COWPUNCHERS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0030.flac"),
            "ground_truth": "HOW ASKED TAD"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "6313-76958-0031.flac"),
            "ground_truth": "WE HAD BETTER START THE DRIVE THIS MORNING"
        },
                {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0000.flac"),
            "ground_truth": "THE PLACE SEEMED FRAGRANT WITH ALL THE RICHES OF GREEK THOUGHT AND SONG SINCE THE DAYS WHEN PTOLEMY PHILADELPHUS WALKED THERE WITH EUCLID AND THEOCRITUS CALLIMACHUS AND LYCOPHRON"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0001.flac"),
            "ground_truth": "THE ROOM HAD NEITHER CARPET NOR FIREPLACE AND THE ONLY MOVABLES IN IT WERE A SOFA BED A TABLE AND AN ARM CHAIR ALL OF SUCH DELICATE AND GRACEFUL FORMS AS MAY BE SEEN ON ANCIENT VASES OF A FAR EARLIER PERIOD THAN THAT WHEREOF WE WRITE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0002.flac"),
            "ground_truth": "BUT MOST PROBABLY HAD ANY OF US ENTERED THAT ROOM THAT MORNING WE SHOULD NOT HAVE BEEN ABLE TO SPARE A LOOK EITHER FOR THE FURNITURE OR THE GENERAL EFFECT OR THE MUSEUM GARDENS OR THE SPARKLING MEDITERRANEAN BEYOND BUT WE SHOULD HAVE AGREED THAT THE ROOM WAS QUITE RICH ENOUGH FOR HUMAN EYES FOR THE SAKE OF ONE TREASURE WHICH IT POSSESSED AND BESIDE WHICH NOTHING WAS WORTH A MOMENT'S GLANCE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0003.flac"),
            "ground_truth": "SHE HAS LIFTED HER EYES OFF HER MANUSCRIPT SHE IS LOOKING OUT WITH KINDLING COUNTENANCE OVER THE GARDENS OF THE MUSEUM HER RIPE CURLING GREEK LIPS SUCH AS WE NEVER SEE NOW EVEN AMONG HER OWN WIVES AND SISTERS OPEN"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0004.flac"),
            "ground_truth": "IF THEY HAVE CEASED TO GUIDE NATIONS THEY HAVE NOT CEASED TO SPEAK TO THEIR OWN ELECT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0005.flac"),
            "ground_truth": "IF THEY HAVE CAST OFF THE VULGAR HERD THEY HAVE NOT CAST OFF HYPATIA"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0006.flac"),
            "ground_truth": "TO BE WELCOMED INTO THE CELESTIAL RANKS OF THE HEROIC TO RISE TO THE IMMORTAL GODS TO THE INEFFABLE POWERS ONWARD UPWARD EVER THROUGH AGES AND THROUGH ETERNITIES TILL I FIND MY HOME AT LAST AND VANISH IN THE GLORY OF THE NAMELESS AND THE ABSOLUTE ONE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0007.flac"),
            "ground_truth": "I TO BELIEVE AGAINST THE AUTHORITY OF PORPHYRY HIMSELF TOO IN EVIL EYES AND MAGIC"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0008.flac"),
            "ground_truth": "WHAT DO I CARE FOR FOOD"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0009.flac"),
            "ground_truth": "HOW CAN HE WHOSE SPHERE LIES ABOVE THE STARS STOOP EVERY MOMENT TO EARTH"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0010.flac"),
            "ground_truth": "AY SHE ANSWERED HALF BITTERLY AND WOULD THAT WE COULD LIVE WITHOUT FOOD AND IMITATE PERFECTLY THE IMMORTAL GODS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0011.flac"),
            "ground_truth": "THERE IS FRUIT WITH LENTILS AND RICE WAITING FOR YOU IN THE NEXT ROOM AND BREAD UNLESS YOU DESPISE IT TOO MUCH"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0012.flac"),
            "ground_truth": "STRANGE THAT MEN SHOULD BE CONTENT TO GROVEL AND BE MEN WHEN THEY MIGHT RISE TO THE RANK OF GODS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0013.flac"),
            "ground_truth": "NOT THAT SUCH A CREATURE AS THAT DISTURBS ME NO CREATED THING I HOPE CAN MOVE MY EQUANIMITY BUT IF I COULD STOOP TO HATE I SHOULD HATE HER HATE HER"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0014.flac"),
            "ground_truth": "AND HER VOICE TOOK A TONE WHICH MADE IT SOMEWHAT UNCERTAIN WHETHER IN SPITE OF ALL THE LOFTY IMPASSIBILITY WHICH SHE FELT BOUND TO POSSESS SHE DID NOT HATE PELAGIA WITH A MOST HUMAN AND MUNDANE HATRED"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0015.flac"),
            "ground_truth": "HIS EXCELLENCY MADAM THE PREFECT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2902-9008-0016.flac"),
            "ground_truth": "AND WHY SHOULD THAT DISTURB ME LET HIM ENTER"
        },
                {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0000.flac"),
            "ground_truth": "A MAN SAID TO THE UNIVERSE SIR I EXIST"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0001.flac"),
            "ground_truth": "SWEAT COVERED BRION'S BODY TRICKLING INTO THE TIGHT LOINCLOTH THAT WAS THE ONLY GARMENT HE WORE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0002.flac"),
            "ground_truth": "THE CUT ON HIS CHEST STILL DRIPPING BLOOD THE ACHE OF HIS OVERSTRAINED EYES EVEN THE SOARING ARENA AROUND HIM WITH THE THOUSANDS OF SPECTATORS WERE TRIVIALITIES NOT WORTH THINKING ABOUT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0003.flac"),
            "ground_truth": "HIS INSTANT OF PANIC WAS FOLLOWED BY A SMALL SHARP BLOW HIGH ON HIS CHEST"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0004.flac"),
            "ground_truth": "ONE MINUTE A VOICE SAID AND THE TIME BUZZER SOUNDED"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0005.flac"),
            "ground_truth": "A MINUTE IS NOT A VERY LARGE MEASURE OF TIME AND HIS BODY NEEDED EVERY FRACTION OF IT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0006.flac"),
            "ground_truth": "THE BUZZER'S WHIRR TRIGGERED HIS MUSCLES INTO COMPLETE RELAXATION"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0007.flac"),
            "ground_truth": "ONLY HIS HEART AND LUNGS WORKED ON AT A STRONG MEASURED RATE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0008.flac"),
            "ground_truth": "HE WAS IN REVERIE SLIDING ALONG THE BORDERS OF CONSCIOUSNESS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0009.flac"),
            "ground_truth": "THE CONTESTANTS IN THE TWENTIES NEEDED UNDISTURBED REST THEREFORE NIGHTS IN THE DORMITORIES WERE AS QUIET AS DEATH"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0010.flac"),
            "ground_truth": "PARTICULARLY SO ON THIS LAST NIGHT WHEN ONLY TWO OF THE LITTLE CUBICLES WERE OCCUPIED THE THOUSANDS OF OTHERS STANDING WITH DARK EMPTY DOORS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0011.flac"),
            "ground_truth": "THE OTHER VOICE SNAPPED WITH A HARSH URGENCY CLEARLY USED TO COMMAND"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0012.flac"),
            "ground_truth": "I'M HERE BECAUSE THE MATTER IS OF UTMOST IMPORTANCE AND BRANDD IS THE ONE I MUST SEE NOW STAND ASIDE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0013.flac"),
            "ground_truth": "THE TWENTIES"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0014.flac"),
            "ground_truth": "HE MUST HAVE DRAWN HIS GUN BECAUSE THE INTRUDER SAID QUICKLY PUT THAT AWAY YOU'RE BEING A FOOL OUT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0015.flac"),
            "ground_truth": "THERE WAS SILENCE THEN AND STILL WONDERING BRION WAS ONCE MORE ASLEEP"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0016.flac"),
            "ground_truth": "TEN SECONDS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0017.flac"),
            "ground_truth": "HE ASKED THE HANDLER WHO WAS KNEADING HIS ACHING MUSCLES"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0018.flac"),
            "ground_truth": "A RED HAIRED MOUNTAIN OF A MAN WITH AN APPARENTLY INEXHAUSTIBLE STORE OF ENERGY"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0019.flac"),
            "ground_truth": "THERE COULD BE LITTLE ART IN THIS LAST AND FINAL ROUND OF FENCING"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0020.flac"),
            "ground_truth": "JUST THRUST AND PARRY AND VICTORY TO THE STRONGER"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0021.flac"),
            "ground_truth": "EVERY MAN WHO ENTERED THE TWENTIES HAD HIS OWN TRAINING TRICKS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0022.flac"),
            "ground_truth": "THERE APPEARED TO BE AN IMMEDIATE ASSOCIATION WITH THE DEATH TRAUMA AS IF THE TWO WERE INEXTRICABLY LINKED INTO ONE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0023.flac"),
            "ground_truth": "THE STRENGTH THAT ENABLES SOMEONE IN A TRANCE TO HOLD HIS BODY STIFF AND UNSUPPORTED EXCEPT AT TWO POINTS THE HEAD AND HEELS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0024.flac"),
            "ground_truth": "THIS IS PHYSICALLY IMPOSSIBLE WHEN CONSCIOUS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0025.flac"),
            "ground_truth": "OTHERS HAD DIED BEFORE DURING THE TWENTIES AND DEATH DURING THE LAST ROUND WAS IN SOME WAYS EASIER THAN DEFEAT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0026.flac"),
            "ground_truth": "BREATHING DEEPLY BRION SOFTLY SPOKE THE AUTO HYPNOTIC PHRASES THAT TRIGGERED THE PROCESS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0027.flac"),
            "ground_truth": "WHEN THE BUZZER SOUNDED HE PULLED HIS FOIL FROM HIS SECOND'S STARTLED GRASP AND RAN FORWARD"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0028.flac"),
            "ground_truth": "IROLG LOOKED AMAZED AT THE SUDDEN FURY OF THE ATTACK THEN SMILED"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0029.flac"),
            "ground_truth": "HE THOUGHT IT WAS A LAST BURST OF ENERGY HE KNEW HOW CLOSE THEY BOTH WERE TO EXHAUSTION"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0030.flac"),
            "ground_truth": "BRION SAW SOMETHING CLOSE TO PANIC ON HIS OPPONENT'S FACE WHEN THE MAN FINALLY RECOGNIZED HIS ERROR"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0031.flac"),
            "ground_truth": "A WAVE OF DESPAIR ROLLED OUT FROM IROLG BRION SENSED IT AND KNEW THE FIFTH POINT WAS HIS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "1272-141231-0032.flac"),
            "ground_truth": "THEN THE POWERFUL TWIST THAT THRUST IT ASIDE IN AND UNDER THE GUARD"
        },
                {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0000.flac"),
            "ground_truth": "KIRKLEATHAM YEAST"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0001.flac"),
            "ground_truth": "SEVENTEEN SEVENTEEN"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0002.flac"),
            "ground_truth": "TO MAKE GOOD HOME MADE BREAD"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0003.flac"),
            "ground_truth": "SEVENTEEN EIGHTEEN"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0004.flac"),
            "ground_truth": "MODE PUT THE FLOUR INTO A LARGE EARTHENWARE BOWL OR DEEP PAN THEN WITH A STRONG METAL OR WOODEN SPOON HOLLOW OUT THE MIDDLE BUT DO NOT CLEAR IT ENTIRELY AWAY FROM THE BOTTOM OF THE PAN AS IN THAT CASE THE SPONGE OR LEAVEN AS IT WAS FORMERLY TERMED WOULD STICK TO IT WHICH IT OUGHT NOT TO DO"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0005.flac"),
            "ground_truth": "NEXT TAKE EITHER A LARGE TABLESPOONFUL OF BREWER'S YEAST WHICH HAS BEEN RENDERED SOLID BY MIXING IT WITH PLENTY OF COLD WATER AND LETTING IT AFTERWARDS STAND TO SETTLE FOR A DAY AND NIGHT OR NEARLY AN OUNCE OF GERMAN YEAST PUT IT INTO A LARGE BASIN AND PROCEED TO MIX IT SO THAT IT SHALL BE AS SMOOTH AS CREAM WITH THREE QUARTERS PINT OF WARM MILK AND WATER OR WITH WATER ONLY THOUGH EVEN A VERY LITTLE MILK WILL MUCH IMPROVE THE BREAD"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0006.flac"),
            "ground_truth": "LOOK AT IT FROM TIME TO TIME WHEN IT HAS BEEN LAID FOR NEARLY AN HOUR AND WHEN THE YEAST HAS RISEN AND BROKEN THROUGH THE FLOUR SO THAT BUBBLES APPEAR IN IT YOU WILL KNOW THAT IT IS READY TO BE MADE UP INTO DOUGH"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0007.flac"),
            "ground_truth": "THEN PLACE THE PAN ON A STRONG CHAIR OR DRESSER OR TABLE OF CONVENIENT HEIGHT POUR INTO THE SPONGE THE REMAINDER OF THE WARM MILK AND WATER STIR INTO IT AS MUCH OF THE FLOUR AS YOU CAN WITH THE SPOON THEN WIPE IT OUT CLEAN WITH YOUR FINGERS AND LAY IT ASIDE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0008.flac"),
            "ground_truth": "TURN IT THEN ON TO A PASTE BOARD OR VERY CLEAN DRESSER AND WITH A LARGE SHARP KNIFE DIVIDE IT IN TWO MAKE IT UP QUICKLY INTO LOAVES AND DISPATCH IT TO THE OVEN MAKE ONE OR TWO INCISIONS ACROSS THE TOPS OF THE LOAVES AS THEY WILL RISE MORE EASILY IF THIS BE DONE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0009.flac"),
            "ground_truth": "ILLUSTRATION ITALIAN MILLET"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0010.flac"),
            "ground_truth": "ITALIAN MILLET OR GREAT INDIAN MILLET IS CULTIVATED IN EGYPT AND NUBIA WHERE IT IS CALLED DHOURRA AND IS USED AS HUMAN FOOD AS WELL AS FOR THE FERMENTATION OF BEER"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0011.flac"),
            "ground_truth": "IT WILL GROW ON POOR SOILS AND IS EXTREMELY PRODUCTIVE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0012.flac"),
            "ground_truth": "IT HAS BEEN INTRODUCED INTO ITALY WHERE THEY MAKE A COARSE BREAD FROM IT AND IT IS ALSO EMPLOYED IN PASTRY AND PUDDINGS THEY ALSO USE IT FOR FEEDING HORSES AND DOMESTIC FOWLS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0013.flac"),
            "ground_truth": "A YELLOW VARIETY CALLED GOLDEN MILLET IS SOLD IN THE GROCERS SHOPS FOR MAKING PUDDINGS AND IS VERY DELICATE AND WHOLESOME"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0014.flac"),
            "ground_truth": "ANOTHER ADVANTAGE THE RED WHEATS POSSESS IS THEIR COMPARATIVE IMMUNITY FROM THE ATTACKS OF MILDEW AND FLY"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0015.flac"),
            "ground_truth": "MODE BOIL THE RICE IN WATER UNTIL IT IS QUITE TENDER POUR OFF THE WATER AND PUT THE RICE BEFORE IT IS COLD TO THE FLOUR"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0016.flac"),
            "ground_truth": "ILLUSTRATION MAIZE PLANT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0017.flac"),
            "ground_truth": "MAIZE NEXT TO WHEAT AND RICE MAIZE IS THE GRAIN MOST USED IN THE NOURISHMENT OF MAN"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0018.flac"),
            "ground_truth": "IF CARRIED ANY DISTANCE IT SHOULD BE STORED AWAY IN AIR TIGHT VESSELS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0019.flac"),
            "ground_truth": "SOME OF THE PREPARATIONS OF MAIZE FLOUR ARE VERY GOOD AND WHEN PARTAKEN IN MODERATION SUITABLE FOOD FOR ALMOST EVERYBODY"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0020.flac"),
            "ground_truth": "MODE LET THE TARTARIC ACID AND SALT BE REDUCED TO THE FINEST POSSIBLE POWDER THEN MIX THEM WELL WITH THE FLOUR"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0021.flac"),
            "ground_truth": "SOUR MILK OR BUTTERMILK MAY BE USED BUT THEN A LITTLE LESS ACID WILL BE NEEDED"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0022.flac"),
            "ground_truth": "EXCELLENT ROLLS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0023.flac"),
            "ground_truth": "HOT ROLLS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0024.flac"),
            "ground_truth": "SEVENTEEN TWENTY FOUR"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0025.flac"),
            "ground_truth": "WHEN THEY ARE QUITE HOT DIVIDE THEM LENGTHWISE INTO THREE PUT SOME THIN FLAKES OF GOOD BUTTER BETWEEN THE SLICES PRESS THE ROLLS TOGETHER AND PUT THEM IN THE OVEN FOR A MINUTE OR TWO BUT NOT LONGER OR THE BUTTER WOULD OIL TAKE THEM OUT OF THE OVEN SPREAD THE BUTTER EQUALLY OVER DIVIDE THE ROLLS IN HALF AND PUT THEM ON TO A VERY HOT CLEAN DISH AND SEND THEM INSTANTLY TO TABLE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0026.flac"),
            "ground_truth": "TO MAKE DRY TOAST"
        },
                {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0027.flac"),
            "ground_truth": "NEVER USE NEW BREAD FOR MAKING ANY KIND OF TOAST AS IT EATS HEAVY AND BESIDES IS VERY EXTRAVAGANT"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0028.flac"),
            "ground_truth": "MOVE IT BACKWARDS AND FORWARDS UNTIL THE BREAD IS NICELY COLOURED THEN TURN IT AND TOAST THE OTHER SIDE AND DO NOT PLACE IT SO NEAR THE FIRE THAT IT BLACKENS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0029.flac"),
            "ground_truth": "TO MAKE HOT BUTTERED TOAST SEVENTEEN TWENTY SIX"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0030.flac"),
            "ground_truth": "A LOAF OF HOUSEHOLD BREAD ABOUT TWO DAYS OLD ANSWERS FOR MAKING TOAST BETTER THAN COTTAGE BREAD THE LATTER NOT BEING A GOOD SHAPE AND TOO CRUSTY FOR THE PURPOSE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0031.flac"),
            "ground_truth": "CUT AS MANY NICE EVEN SLICES AS MAY BE REQUIRED RATHER MORE THAN ONE QUARTER INCH IN THICKNESS AND TOAST THEM BEFORE A VERY BRIGHT FIRE WITHOUT ALLOWING THE BREAD TO BLACKEN WHICH SPOILS THE APPEARANCE AND FLAVOUR OF ALL TOAST"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0032.flac"),
            "ground_truth": "SOYER RECOMMENDS THAT EACH SLICE SHOULD BE CUT INTO PIECES AS SOON AS IT IS BUTTERED AND WHEN ALL ARE READY THAT THEY SHOULD BE PILED LIGHTLY ON THE DISH THEY ARE INTENDED TO BE SERVED ON"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0033.flac"),
            "ground_truth": "HE SAYS THAT BY CUTTING THROUGH FOUR OR FIVE SLICES AT A TIME ALL THE BUTTER IS SQUEEZED OUT OF THE UPPER ONES WHILE THE BOTTOM ONE IS SWIMMING IN FAT LIQUID"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0034.flac"),
            "ground_truth": "MUFFINS AND CRUMPETS SHOULD ALWAYS BE SERVED ON SEPARATE DISHES AND BOTH TOASTED AND SERVED AS EXPEDITIOUSLY AS POSSIBLE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0035.flac"),
            "ground_truth": "SUFFICIENT ALLOW TWO CRUMPETS TO EACH PERSON"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0036.flac"),
            "ground_truth": "PLAIN BUNS SEVENTEEN TWENTY NINE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0037.flac"),
            "ground_truth": "MODE PUT THE FLOUR INTO A BASIN MIX THE SUGAR WELL WITH IT MAKE A HOLE IN THE CENTRE AND STIR IN THE YEAST AND MILK WHICH SHOULD BE LUKEWARM WITH ENOUGH OF THE FLOUR TO MAKE IT THE THICKNESS OF CREAM"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0038.flac"),
            "ground_truth": "FROM FIFTEEN TO TWENTY MINUTES WILL BE REQUIRED TO BAKE THEM NICELY"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0039.flac"),
            "ground_truth": "THESE BUNS MAY BE VARIED BY ADDING A FEW CURRANTS CANDIED PEEL OR CARAWAY SEEDS TO THE OTHER INGREDIENTS AND THE ABOVE MIXTURE ANSWERS FOR HOT CROSS BUNS BY PUTTING IN A LITTLE GROUND ALLSPICE AND BY PRESSING A TIN MOULD IN THE FORM OF A CROSS IN THE CENTRE OF THE BUN"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0040.flac"),
            "ground_truth": "SUFFICIENT TO MAKE TWELVE BUNS SEASONABLE AT ANY TIME LIGHT BUNS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0041.flac"),
            "ground_truth": "ILLUSTRATION BUNS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0042.flac"),
            "ground_truth": "VICTORIA BUNS SEVENTEEN THIRTY TWO"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0043.flac"),
            "ground_truth": "MODE WHISK THE EGG STIR IN THE SUGAR AND BEAT THESE INGREDIENTS WELL TOGETHER BEAT THE BUTTER TO A CREAM STIR IN THE GROUND RICE CURRANTS AND CANDIED PEEL AND AS MUCH FLOUR AS WILL MAKE IT OF SUCH A CONSISTENCY THAT IT MAY BE ROLLED INTO SEVEN OR EIGHT BALLS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0044.flac"),
            "ground_truth": "ITALIAN RUSKS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0045.flac"),
            "ground_truth": "THEY SHOULD BE KEPT IN A CLOSED TIN CANISTER IN A DRY PLACE TO PRESERVE THEIR CRISPNESS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0046.flac"),
            "ground_truth": "IT IS NOT CULTIVATED IN ENGLAND BEING PRINCIPALLY CONFINED TO THE EAST"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0047.flac"),
            "ground_truth": "WHEN WE TAKE INTO ACCOUNT THAT THE ARABIANS ARE FOND OF LIZARDS AND LOCUSTS AS ARTICLES OF FOOD THEIR CUISINE ALTOGETHER IS SCARCELY A TEMPTING ONE"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0048.flac"),
            "ground_truth": "SEVENTEEN THIRTY FOUR"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0049.flac"),
            "ground_truth": "ILLUSTRATION RUSKS"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0050.flac"),
            "ground_truth": "MODE PUT THE MILK AND BUTTER INTO A SAUCEPAN AND KEEP SHAKING IT ROUND UNTIL THE LATTER IS MELTED"
        },
        {
            "audio_file": os.path.join("TestAudioFiles", "2078-142845-0051.flac"),
            "ground_truth": "WHEN COLD THEY SHOULD BE PUT INTO TIN CANISTERS TO KEEP THEM DRY AND IF INTENDED FOR THE CHEESE COURSE THE SIFTED SUGAR SHOULD BE OMITTED"
        },
    ]
    
    results = []
    for test_case in test_cases:
        try:
            result = test_transcription_accuracy(
                test_case["audio_file"],
                test_case["ground_truth"]
            )
            if result:
                results.append(result)
        except FileNotFoundError:
            print(f"⚠️  Audio file not found: {test_case['audio_file']}")
        except Exception as e:
            print(f"❌ Error testing {test_case['audio_file']}: {e}")
            import traceback
            traceback.print_exc()
    
    # Summary - Calculate overall accuracy from total words/errors across all tests
    if results:
        # Calculate total errors and total words/characters across all tests
        total_wer_errors = sum(r.get('wer_errors', 0) for r in results)
        total_wer_words = sum(r.get('wer_total', 0) for r in results)
        total_cer_errors = sum(r.get('cer_errors', 0) for r in results)
        total_cer_chars = sum(r.get('cer_total', 0) for r in results)
        
        overall_wer = total_wer_errors / total_wer_words if total_wer_words > 0 else 0.0
        overall_cer = total_cer_errors / total_cer_chars if total_cer_chars > 0 else 0.0
        
        print(f"\n{'='*60}")
        print("SUMMARY (Overall accuracy across all tests):")
        print(f"{'='*60}")
        print(f"Total Words:                {total_wer_words}")
        print(f"Total Word Errors:          {total_wer_errors}")
        print(f"Overall Word Error Rate:    {overall_wer:.4f}")
        print(f"Overall Word Accuracy:      {(1-overall_wer)*100:.2f}%")
        print(f"Total Characters:           {total_cer_chars}")
        print(f"Total Character Errors:     {total_cer_errors}")
        print(f"Overall Character Error Rate: {overall_cer:.4f}")
        print(f"Overall Character Accuracy: {(1-overall_cer)*100:.2f}%")
        
        # Summary of all errors across all tests
        print(f"\n{'='*60}")
        print("ERROR SUMMARY (All errors across all tests):")
        print(f"{'='*60}")
        
        # Collect all errors
        all_substitutions = []
        all_deletions = []
        all_insertions = []
        
        for r in results:
            if 'differences' in r:
                all_substitutions.extend(r['differences'].get('substitutions', []))
                all_deletions.extend(r['differences'].get('deletions', []))
                all_insertions.extend(r['differences'].get('insertions', []))
        
        # Display substitutions
        if all_substitutions:
            print(f"\nAll Substitutions ({len(all_substitutions)}):")
            for i, sub in enumerate(all_substitutions, 1):
                print(f"  {i}. '{sub['reference']}' → '{sub['hypothesis']}'")
        else:
            print("\nSubstitutions: None")
        
        # Display deletions
        if all_deletions:
            print(f"\nAll Deletions (missing words, {len(all_deletions)}):")
            for i, deletion in enumerate(all_deletions, 1):
                print(f"  {i}. '{deletion}'")
        else:
            print("\nDeletions: None")
        
        # Display insertions
        if all_insertions:
            print(f"\nAll Insertions (extra words, {len(all_insertions)}):")
            for i, insertion in enumerate(all_insertions, 1):
                print(f"  {i}. '{insertion}'")
        else:
            print("\nInsertions: None")
        
        print(f"{'='*60}")
