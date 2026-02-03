import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import time

# ==========================
# CONFIG
# ==========================
CSV_PATH = "../emotion_logs/visit_emotions_5classes.csv"
EMOTION_LABELS = ["Angry", "Disgust", "Happy", "LowAffect", "Arousal"]

#1. Load emotion log file into data frame
df = pd.read_csv(CSV_PATH)  #df stands for "Data Frame"
#preview logged data
df.head()

# 2. Visualize a single visit

#pick latest visit for a patient
patient_id = input("Patient ID (or MRN / initials): ").strip()                          
visit = df[df["patient_id"] == patient_id].sort_values("timestamp").iloc[-1]

#Extract the values
emotion_labels = EMOTION_LABELS
counts = [visit[f"{emo}_count"] for emo in emotion_labels]
percents = [visit[f"{emo}_pct"] for emo in emotion_labels]

#for measureing latency
lat1_start = time.time()

#Pie chart (percentage distribution)

plt.figure(figsize=(6,6))
plt.pie(
    percents,
    labels=emotion_labels,
    autopct="%1.1f%%",
    startangle = 90,
    textprops={'fontsize': 14}
)
plt.title(f"Emotional Distribution for Visit\nPatient: {patient_id}, Visit: {visit['visit_label']}", fontsize = 20)
#plt.show()

lat1_end = time.time()
print(f"Latency 1: {(lat1_end-lat1_start)*1000:.2f}")

lat2_start = time.time()

#Bar chart
plt.figure(figsize=(8,5))
plt.bar(emotion_labels, percents)
plt.ylabel("Percentage(%)", fontsize = 20)
plt.title(f"Emotion Breakdown for Patient {patient_id}, Visit {visit['visit_label']}", fontsize=24)

plt.xticks(fontsize=16)   # category labels
plt.yticks(fontsize=16)

#plt.show()


lat2_end = time.time()
print(f"Latency 2: {(lat2_end-lat2_start)*1000:.2f}")

# 3. Serial Trend analysis (Accross visit history)

lat3_start = time.time()

#Sort visits for one patient
patient_df = df[df["patient_id"]== patient_id].sort_values("timestamp").copy()
patient_df["visit_number"] = range(1, len(patient_df) +1 )

#Plot emotion trends over visits
plt.figure(figsize=(10,6))

for emo in emotion_labels:
    plt.plot(
        patient_df["visit_number"],
        patient_df[f"{emo}_pct"],
        marker="o",
        label=emo
    )
plt.title(f"Emotion Trends Across Visits — Patient {patient_id}", fontsize=24)
plt.xlabel("Visit Number", fontsize=18)
plt.ylabel("Percentage (%)", fontsize=18)
plt.legend(fontsize=16)
plt.xticks(fontsize=16)
plt.yticks(fontsize=16)
plt.grid(True)
#plt.show()

lat3_end = time.time()
print(f"Latency 3: {(lat3_end-lat3_start)*1000:.2f}")

# 4. Map a dominant emotion per visit



lat4_start = time.time()

pct_cols = [f"{emo}_pct" for emo in emotion_labels]
patient_df["dominant_emotion"] = (
    patient_df[pct_cols]
    .idxmax(axis=1)
    .str.replace("_pct", "")
)
   
patient_df[["visit_number", "visit_label", "dominant_emotion"]]


#
lat4_end = time.time()
print(f"Latency 4: {(lat4_end-lat4_start)*1000:.2f}")

print(f"Toal Latency for report generation: {(lat4_end-lat1_start)*1000:.2f} ms")

