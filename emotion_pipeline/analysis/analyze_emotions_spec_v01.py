import json
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import time
from pathlib import Path

# ==========================
# CONFIG
# ==========================
RUNS_DIR = "../runs"  # Doctor AI spec directory
EMOTION_LABELS = ["angry", "disgust", "happy", "low_affect", "arousal"]  # Lowercase per spec

# ==========================
# LOAD DATA FROM SPEC-COMPLIANT JSONL
# ==========================

def load_all_visits(runs_dir):
    """
    Load all face.jsonl files from runs directory (Doctor AI spec v0.1).
    Returns a pandas DataFrame with all visits.
    
    Reads from: runs/visit_*/face.jsonl
    """
    runs_path = Path(runs_dir)
    
    if not runs_path.exists():
        raise FileNotFoundError(f"Runs directory not found: {runs_dir}")
    
    records = []
    
    # Find all visit_* directories
    visit_dirs = sorted(runs_path.glob("visit_*"))
    
    if not visit_dirs:
        raise RuntimeError(f"No visit directories found in {runs_dir}")
    
    print(f"Found {len(visit_dirs)} visit directories")
    
    for visit_dir in visit_dirs:
        face_file = visit_dir / "face.jsonl"
        
        if not face_file.exists():
            print(f"[WARN] No face.jsonl in {visit_dir.name}, skipping")
            continue
        
        # Read JSONL file (may have multiple records per visit, we want summary)
        with open(face_file, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    record = json.loads(line)
                    
                    # Only process summary records (per spec)
                    if record.get("type") != "summary":
                        continue
                    
                    # Flatten for DataFrame
                    flat_record = {
                        "visit_id": record["visit_id"],
                        "patient_id": record["patient_id"],
                        "subsystem": record["subsystem"],
                        "phase": record["phase"],
                        "type": record["type"],
                        "t_start": record.get("t_start"),
                        "t_end": record.get("t_end"),
                        "confidence": record["confidence"],
                        "valid": record["valid"],
                        "schema_version": record.get("schema_version", "unknown"),
                        "model_version": record.get("model_version", "unknown"),
                    }
                    
                    # Extract features
                    features = record.get("features", {})
                    flat_record["total_samples"] = features.get("total_samples", 0)
                    flat_record["timestamp"] = features.get("timestamp", "")
                    flat_record["visit_label"] = features.get("visit_label", "")
                    
                    # Add emotion counts and percentages
                    emotion_counts = features.get("emotion_counts", {})
                    emotion_pct = features.get("emotion_pct", {})
                    
                    for emo in EMOTION_LABELS:
                        flat_record[f"{emo}_count"] = emotion_counts.get(emo, 0)
                        flat_record[f"{emo}_pct"] = emotion_pct.get(emo, 0.0)
                    
                    records.append(flat_record)
    
    if not records:
        raise RuntimeError("No valid summary records found in face.jsonl files")
    
    df = pd.DataFrame(records)
    return df

# Load all visits
print(f"Loading data from {RUNS_DIR}...")
df = load_all_visits(RUNS_DIR)
print(f"\nLoaded {len(df)} visits from {df['patient_id'].nunique()} patient(s)")
print(f"Schema versions: {df['schema_version'].unique()}")
print(f"Model versions: {df['model_version'].unique()}")

# Preview
print("\nFirst few records:")
print(df[["visit_id", "patient_id", "total_samples", "t_end"]].head())

# ==========================
# 2. Visualize a single visit
# ==========================

# Pick latest visit for a patient
patient_id = input("\nPatient ID (or MRN / initials): ").strip()
patient_visits = df[df["patient_id"] == patient_id].sort_values("timestamp")

if len(patient_visits) == 0:
    print(f"No visits found for patient: {patient_id}")
    exit()

visit = patient_visits.iloc[-1]  # Get latest visit

# Extract the values
emotion_labels = EMOTION_LABELS
counts = [visit[f"{emo}_count"] for emo in emotion_labels]
percents = [visit[f"{emo}_pct"] for emo in emotion_labels]

print(f"\nAnalyzing visit: {visit['visit_id']}")
print(f"  Visit label: {visit['visit_label']}")
print(f"  Total samples: {visit['total_samples']}")
print(f"  Duration: {visit['t_end'] if visit['t_end'] else 'unknown'}s")
print(f"  Confidence: {visit['confidence']}")
print(f"  Valid: {visit['valid']}")
print(f"  Model: {visit['model_version']}")

# ==========================
# Pie chart (percentage distribution)
# ==========================

lat1_start = time.time()

# Make labels prettier for display
display_labels = [emo.replace('_', ' ').title() for emo in emotion_labels]

plt.figure(figsize=(6,6))
plt.pie(
    percents,
    labels=display_labels,
    autopct="%1.1f%%",
    startangle=90,
    textprops={'fontsize': 14}
)
plt.title(f"Emotional Distribution for Visit\nPatient: {patient_id}, Visit: {visit['visit_label']}", fontsize=20)

lat1_end = time.time()
print(f"\nLatency 1 (Pie chart): {(lat1_end-lat1_start)*1000:.2f} ms")

# ==========================
# Bar chart
# ==========================

lat2_start = time.time()

plt.figure(figsize=(8,5))
plt.bar(display_labels, percents, color=['#e74c3c', '#9b59b6', '#f39c12', '#3498db', '#2ecc71'])
plt.ylabel("Percentage (%)", fontsize=20)
plt.title(f"Emotion Breakdown for Patient {patient_id}", fontsize=24)
plt.xticks(fontsize=14, rotation=15)
plt.yticks(fontsize=16)
plt.grid(axis='y', alpha=0.3)

lat2_end = time.time()
print(f"Latency 2 (Bar chart): {(lat2_end-lat2_start)*1000:.2f} ms")

# ==========================
# 3. Serial Trend analysis (Across visit history)
# ==========================

lat3_start = time.time()

# Sort visits for one patient
patient_df = df[df["patient_id"] == patient_id].sort_values("timestamp").copy()
patient_df["visit_number"] = range(1, len(patient_df) + 1)

print(f"\nFound {len(patient_df)} visits for patient {patient_id}")

if len(patient_df) > 1:
    # Plot emotion trends over visits
    plt.figure(figsize=(10,6))

    colors = ['#e74c3c', '#9b59b6', '#f39c12', '#3498db', '#2ecc71']
    for emo, display_label, color in zip(emotion_labels, display_labels, colors):
        plt.plot(
            patient_df["visit_number"],
            patient_df[f"{emo}_pct"],
            marker="o",
            label=display_label,
            color=color,
            linewidth=2
        )

    plt.title(f"Emotion Trends Across Visits — Patient {patient_id}", fontsize=24)
    plt.xlabel("Visit Number", fontsize=18)
    plt.ylabel("Percentage (%)", fontsize=18)
    plt.legend(fontsize=14)
    plt.xticks(fontsize=16)
    plt.yticks(fontsize=16)
    plt.grid(True, alpha=0.3)

lat3_end = time.time()
print(f"Latency 3 (Trend line): {(lat3_end-lat3_start)*1000:.2f} ms")

# ==========================
# 4. Map a dominant emotion per visit
# ==========================

lat4_start = time.time()

pct_cols = [f"{emo}_pct" for emo in emotion_labels]
patient_df["dominant_emotion"] = (
    patient_df[pct_cols]
    .idxmax(axis=1)
    .str.replace("_pct", "")
    .str.replace("_", " ")
    .str.title()
)

print("\nDominant emotion per visit:")
print(patient_df[["visit_number", "visit_label", "dominant_emotion", "t_end"]])

lat4_end = time.time()
print(f"\nLatency 4 (Dominant emotion): {(lat4_end-lat4_start)*1000:.2f} ms")

print(f"\nTotal latency for report generation: {(lat4_end-lat1_start)*1000:.2f} ms")

# Show all plots
plt.show()
