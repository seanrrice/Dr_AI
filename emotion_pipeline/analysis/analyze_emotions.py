import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

#1. Load emotion log file into data frame
df = pd.read_csv("../emotion_logs/visit_emotions.csv")  #df stands for "Data Frame"
#preview logged data
df.head()

# 2. Visualize a single visit

#pick latest visit for a patient
patient_id = "Tony"
visit = df[df["patient_id"] == patient_id].sort_values("timestamp").iloc[-1]

#Extract the values
emotion_labels = ['angry', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise']
counts = [visit[f"{emo}_count"] for emo in emotion_labels]
percents = [visit[f"{emo}_pct"] for emo in emotion_labels]

#Pie chart (percentage distribution)

plt.figure(figsize=(6,6))
plt.pie(
    percents,
    labels=emotion_labels,
    autopct="%1.1f%%",
    startangle = 90,
)
plt.title(f"Emotional Distribution for Visit\nPatient: {patient_id}, Visit: {visit['visit_label']}")
plt.show()

#Bar chart
plt.figure(figsize=(8,5))
plt.bar(emotion_labels, percents)
plt.ylabel("Percentage(%)")
plt.title(f"Emotion Breakdown for Patient {patient_id}, Visit {visit['visit_label']}")
plt.show()

# 3. Serial Trend analysis (Accross visit history)

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
plt.title(f"Emotion Trends Across Visits — Patient {patient_id}")
plt.xlabel("Visit Number")
plt.ylabel("Percentage (%)")
plt.legend()
plt.grid(True)
plt.show()

# 4. Map a dominant emotion per visit


pct_cols = [f"{emo}_pct" for emo in emotion_labels]
patient_df["dominant_emotion"] = (
    patient_df[pct_cols]
    .idxmax(axis=1)
    .str.replace("_pct", "")
)
   
patient_df[["visit_number", "visit_label", "dominant_emotion"]]
