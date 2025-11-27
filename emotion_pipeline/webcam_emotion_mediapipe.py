import cv2
import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image
import time
import mediapipe as mp
import torch.nn.functional as F
from collections import deque, Counter
import csv
from datetime import datetime
from pathlib import Path
from emotion_logger import EmotionVisitLogger


# ==========================
# CONFIG
# ==========================

CHECKPOINT_PATH = "best_model.pth"
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

label_history = deque(maxlen=10)     #last 10 predictions

# must match validation/test transforms 
inference_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

# ==========================
# MODEL
# ==========================

def build_model(num_classes: int):
    model = models.resnet18(weights=None)       #We'll load our own trained weights
    in_features = model.fc.in_features
    model.fc = nn.Sequential(
        nn.Dropout(0.3),
        nn.Linear(model.fc.in_features, num_classes)
    )
    return model

print(" INFO: Loading model checkpoint...")

state_dict = torch.load(CHECKPOINT_PATH, map_location=DEVICE) 
model = build_model(num_classes=7)
model.load_state_dict(state_dict)
model.to(DEVICE)
model.eval()

EMOTION_LABELS = ['angry', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise']

print("[INFO] Model loaded and ready.")

# ==========================
# MEDIAPIPE FACE DETECTION
# ==========================

mp_face_detection = mp.solutions.face_detection
mp_drawing = mp.solutions.drawing_utils

def predict_emotion_from_face(face_bgr):
    # 
    # face_bgr: cropped face region (H x W x 3, BGR)
    # returns: (label, confidence)
    # 

     # Convert BGR -> RGB
    face_rgb = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB)
    img = Image.fromarray(face_rgb)

    #Preprocess
    img_t = inference_transform(img).unsqueeze(0).to(DEVICE) # (1, C, H, W)

    with torch.no_grad():
        logits = model(img_t)
        probs = F.softmax(logits, dim=1)[0] #num_classes
        pred_idx = torch.argmax(probs).item()
        pred_label = EMOTION_LABELS[pred_idx]
        pred_conf = probs[pred_idx].item()

    return pred_label, pred_conf

def get_smoothed_label(label_history):
    if not label_history:
        return None
    counts = Counter(label_history)
    return counts.most_common(1)[0][0]

def main():

    log_interval = 0.5         #seconds
    last_log_time = time.time()

    cap = cv2.VideoCapture(0)  # change to 1 if you have multiple cameras
    if not cap.isOpened():
        print("[Error] Could not open webcam. ")
        return
    
    # You can reduce resolution a bit for speed
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    prev_time = time.time()

    #for logging emotion data
    emotion_counts = Counter()
    total_samples = 0
    CONF_THRESHOLD = 0.5

    # Create a logger that knows about patient_id and visit_label
    logger = EmotionVisitLogger(
        emotion_labels=EMOTION_LABELS,
        metadata_fields=["patient_id", "visit_label"],
    )

    #ask who this is for
    patient_id = input("Patient ID (or MRN / initials): ").strip()
    if not patient_id:
        patient_id = "Unknown"
    
    #define visit_label
    from datetime import datetime
    visit_label = datetime.now().date().isoformat()


    #mediapipe face detector
    with mp_face_detection.FaceDetection(
        model_selection = 0,    # 0: short-range, 1: full-range
        min_detection_confidence=0.5
    ) as face_detection:
    
        while True:
            ret, frame = cap.read()
            if not ret:
                print("[WARN] Failed to grab frame")
                break
            
            # frame is BGR (OpenCV default)
            h, w, _ = frame.shape
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)  #CHECK

            # Run mediapipe face detection
            results = face_detection.process(frame_rgb)

            if results.detections:
                for detection in results.detections:
                    #Get relative bounding box
                    bbox = detection.location_data.relative_bounding_box
                    x_min = int(bbox.xmin * w)
                    y_min = int(bbox.ymin*h)
                    box_width = int(bbox.width * w)
                    box_height = int(bbox.height * h)

                    #Clamp coords to frame
                    x_min = max(0, x_min)
                    y_min = max(0, y_min)
                    x_max = min(w, x_min + box_width)
                    y_max = min(h, y_min + box_height)

                    if x_max <= x_min or y_max <= y_min:
                        continue

                    #Crop face region
                    face_roi = frame[y_min:y_max, x_min:x_max]

                    #Run emotion prediction
                    label, conf = predict_emotion_from_face(face_roi)
                   
                    #for smoothing real time display
                    if conf > CONF_THRESHOLD:
                        label_history.append(label)

                    #log smoothed emotion data
                    now = time.time()
                    if now - last_log_time >= log_interval:
                        smoothed_label = get_smoothed_label(label_history)
                        if smoothed_label is not None:
                            emotion_counts[smoothed_label] += 1
                            total_samples += 1
                        last_log_time = now


                    #Draw bounding box & label
                    cv2.rectangle(frame, (x_min, y_min), (x_max, y_max), 
                                  (0, 255, 0), 2)
                    #percent = int(conf*100)
                    #text = f"{label} {conf*percent}%
                    text = smoothed_label
                    cv2.putText(frame, text, (x_min, y_min - 10), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            
            # #FPS calculation
            # curr_time = time.time()
            # fps = 1.0 / (curr_time - prev_time)
            # prev_time = curr_time

            # cv2.putText(frame, f"FPS: {fps:.1f}", (10, 30),
            #             cv2.FONT_HERSHEY_SIMPLEX, 0.7, 
            #             (0, 255, 0), 2)
            
            cv2.imshow("Webcam Emotion (Mediapipe + ResNet18)", frame)

            #Quit on 'q'
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

        cap.release()
        cv2.destroyAllWindows()

        #--------VISIT SUMMARY LOGGING----------------------
        logger.log_visit(
            emotion_counts=emotion_counts,
            total_samples = total_samples,
            meta={
                "patient_id": patient_id,
                "visit_label": visit_label,
            }
             # you could also pass an explicit visit_id if you want
             # visit_id="patient123_visit3"
        )



if __name__ == "__main__":
    main()

                    


            








    
