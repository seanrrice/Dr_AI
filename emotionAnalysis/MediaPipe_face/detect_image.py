from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import mediapipe as mp

IMAGE_PATH = "face_sample.jpg"          # put a test image here
MODEL_PATH = "face_landmarker.task"

BaseOptions = python.BaseOptions
FaceLandmarker = vision.FaceLandmarker
FaceLandmarkerOptions = vision.FaceLandmarkerOptions

image = mp.Image.create_from_file(IMAGE_PATH)

options = FaceLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=MODEL_PATH),
    output_face_blendshapes=True,
    output_facial_transformation_matrixes=True,
    num_faces=1
)

with FaceLandmarker.create_from_options(options) as landmarker:
    results = landmarker.detect(image)

print("Faces:", len(results.face_landmarks))
if results.face_landmarks:
    print("Landmarks on first face:", len(results.face_landmarks[0]))
if results.face_blendshapes:
    print("Blendshapes:", len(results.face_blendshapes[0]))
