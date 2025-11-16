import os, csv, time
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# ---------- settings ----------
MODEL_PATH = "face_landmarker.task"
CAM_INDEX = 0                 # try 1 if you have multiple cameras
SAVE_DIR = "session_out"
SAVE_EVERY_N_FRAMES = 1       # save each frame; increase to thin the data
NUM_FACES = 1

# ---------- setup i/o ----------
os.makedirs(SAVE_DIR, exist_ok=True)
tstamp = time.strftime("%Y%m%d-%H%M%S")
landmarks_csv_path = os.path.join(SAVE_DIR, f"landmarks_{tstamp}.csv")
blendshapes_csv_path = os.path.join(SAVE_DIR, f"blendshapes_{tstamp}.csv")

landmarks_f = open(landmarks_csv_path, "w", newline="")
blendshapes_f = open(blendshapes_csv_path, "w", newline="")
landmarks_writer = csv.writer(landmarks_f)
blendshapes_writer = csv.writer(blendshapes_f)

# headers
# landmarks: frame_index, time_s, face_index, lm_index, x, y, z
landmarks_writer.writerow(["frame","time_s","face","landmark","x","y","z"])
# blendshapes: frame_index, time_s, face_index, name, score
blendshapes_writer.writerow(["frame","time_s","face","name","score"])

# ---------- mediapipe setup ----------
BaseOptions = python.BaseOptions
FaceLandmarker = vision.FaceLandmarker
FaceLandmarkerOptions = vision.FaceLandmarkerOptions
VisionRunningMode = vision.RunningMode

options = FaceLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=MODEL_PATH),
    output_face_blendshapes=True,
    output_facial_transformation_matrixes=False,
    num_faces=NUM_FACES,
    running_mode=VisionRunningMode.VIDEO
)

landmarker = FaceLandmarker.create_from_options(options)

# ---------- video loop ----------
cap = cv2.VideoCapture(CAM_INDEX)
if not cap.isOpened():
    raise RuntimeError("Could not open camera. Try a different CAM_INDEX or check permissions.")

frame_idx = 0
start_time = time.time()

def draw_landmarks(frame_bgr, face_landmarks):
    h, w = frame_bgr.shape[:2]
    for lm in face_landmarks:
        cx, cy = int(lm.x * w), int(lm.y * h)
        cv2.circle(frame_bgr, (cx, cy), 1, (0, 255, 0), -1)

try:
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        frame_idx += 1
        now_s = time.time() - start_time

        # convert to MediaPipe Image (expects RGB)
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)

        # MP Tasks 'VIDEO' mode requires a timestamp in ms (monotonic)
        results = landmarker.detect_for_video(mp_image, int(now_s * 1000))

        # visualize + save
        if results.face_landmarks:
            for fidx, lm_list in enumerate(results.face_landmarks):
                # draw
                draw_landmarks(frame, lm_list)

                # save landmarks
                if frame_idx % SAVE_EVERY_N_FRAMES == 0:
                    for li, lm in enumerate(lm_list):
                        landmarks_writer.writerow([frame_idx, f"{now_s:.3f}", fidx, li, lm.x, lm.y, lm.z])

            # save blendshapes
            if results.face_blendshapes and frame_idx % SAVE_EVERY_N_FRAMES == 0:
                for fidx, shapes in enumerate(results.face_blendshapes):
                    for cat in shapes:
                        blendshapes_writer.writerow([frame_idx, f"{now_s:.3f}", fidx, cat.category_name, f"{cat.score:.6f}"])

        # show preview
        cv2.imshow("MediaPipe Face Landmarker (q to quit)", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

finally:
    cap.release()
    cv2.destroyAllWindows()
    landmarker.close()
    landmarks_f.close()
    blendshapes_f.close()
    print("Saved:", landmarks_csv_path)
    print("Saved:", blendshapes_csv_path)
