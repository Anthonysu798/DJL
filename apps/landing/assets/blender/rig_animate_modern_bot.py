import bpy
import math
import os
from mathutils import Vector


# Resolve alongside this script so the rig build works from any checkout. Override with
# DJL_BLENDER_ASSET_ROOT to read and write the .blend and renders somewhere else.
ROOT = os.environ.get("DJL_BLENDER_ASSET_ROOT", os.path.dirname(os.path.abspath(__file__)))
BLEND_PATH = os.path.join(ROOT, "DJL_Enterprise_Bot_Animated.blend")
GLB_PATH = os.path.join(ROOT, "DJL_Enterprise_Bot_Animated.glb")
HERO_PATH = os.path.join(ROOT, "DJL_Enterprise_Bot_Animated_Hero.png")
VIDEO_PATH = os.path.join(ROOT, "DJL_Enterprise_Bot_Animated_Showcase.mp4")
ROBOT_COLLECTIONS = {
    "01_TORSO",
    "02_HEAD",
    "03_NECK",
    "04_LEFT_ARM",
    "05_RIGHT_ARM",
    "06_HANDS",
    "07_HIPS",
    "08_LEGS",
    "09_DETAILS",
}
RIG_COLLECTION = "11_RIG_CONTROLS"


def collection_objects(name):
    collection = bpy.data.collections.get(name)
    return list(collection.objects) if collection else []


def parent_keep_world(child, parent):
    bpy.context.view_layer.update()
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world
    bpy.context.view_layer.update()


def clear_parent_keep_world(obj):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world
    bpy.context.view_layer.update()


def make_empty(name, location, size=0.45, display="CIRCLE"):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.empty_display_size = size
    obj.location = location
    obj.rotation_mode = "XYZ"
    rig_collection.objects.link(obj)
    return obj


def key_rotation(obj, frame, degrees, base):
    obj.rotation_euler = Vector(base) + Vector(tuple(math.radians(value) for value in degrees))
    obj.keyframe_insert(data_path="rotation_euler", frame=frame, group="Enterprise Motion")


def key_location(obj, frame, offset, base):
    obj.location = Vector(base) + Vector(offset)
    obj.keyframe_insert(data_path="location", frame=frame, group="Enterprise Motion")


def key_scale(obj, frame, value):
    obj.scale = value
    obj.keyframe_insert(data_path="scale", frame=frame, group="Expression")


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def set_emission_key(material_name, keys):
    material = bpy.data.materials.get(material_name)
    if not material or not material.use_nodes:
        return
    emission = next((node for node in material.node_tree.nodes if node.type == "EMISSION"), None)
    if emission is None:
        shader = material.node_tree.nodes.get("Principled BSDF")
        if shader and "Emission Strength" in shader.inputs:
            socket = shader.inputs["Emission Strength"]
        else:
            return
    else:
        socket = emission.inputs["Strength"]
    for frame, value in keys:
        socket.default_value = value
        socket.keyframe_insert(data_path="default_value", frame=frame)


def assign(objects, controller, assigned):
    for obj in objects:
        if obj and obj.name not in assigned:
            parent_keep_world(obj, controller)
            assigned.add(obj.name)


def objects_matching(objects, *prefixes):
    return [obj for obj in objects if any(obj.name.startswith(prefix) for prefix in prefixes)]


scene = bpy.context.scene
os.makedirs(ROOT, exist_ok=True)
scene.frame_set(1)
bpy.context.view_layer.update()

# Remove an earlier generated rig without disturbing the handcrafted model.
for obj in list(scene.objects):
    if obj.parent and obj.parent.name.startswith(("CTRL_", "CAM_TARGET_")):
        clear_parent_keep_world(obj)
for obj in list(scene.objects):
    if obj.name.startswith(("CTRL_", "CAM_TARGET_")) or obj.name == "Camera — animated showcase":
        bpy.data.objects.remove(obj, do_unlink=True)

old_rig_collection = bpy.data.collections.get(RIG_COLLECTION)
if old_rig_collection:
    for owner_scene in bpy.data.scenes:
        if old_rig_collection in list(owner_scene.collection.children):
            owner_scene.collection.children.unlink(old_rig_collection)
    for owner_collection in bpy.data.collections:
        if old_rig_collection in list(owner_collection.children):
            owner_collection.children.unlink(old_rig_collection)
    if old_rig_collection.users == 0:
        bpy.data.collections.remove(old_rig_collection)

rig_collection = bpy.data.collections.new(RIG_COLLECTION)
scene.collection.children.link(rig_collection)

robot_objects = []
for collection_name in ROBOT_COLLECTIONS:
    robot_objects.extend(collection_objects(collection_name))
robot_objects = list(dict.fromkeys(robot_objects))

# Convert beveled finger/control curves so the animated GLB retains every visible part.
for obj in list(robot_objects):
    if obj.type == "CURVE":
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target="MESH")

robot_objects = []
for collection_name in ROBOT_COLLECTIONS:
    robot_objects.extend(collection_objects(collection_name))
robot_objects = list(dict.fromkeys(robot_objects))

# Refine the reflective shell to match the supplied polished reference more closely.
chrome_material = bpy.data.materials.get("Liquid Chrome")
if chrome_material and chrome_material.use_nodes:
    chrome_shader = chrome_material.node_tree.nodes.get("Principled BSDF")
    if chrome_shader:
        chrome_shader.inputs["Base Color"].default_value = (0.68, 0.75, 0.84, 1.0)
        chrome_shader.inputs["Metallic"].default_value = 1.0
        chrome_shader.inputs["Roughness"].default_value = 0.055
head_shell = bpy.data.objects.get("Head — chrome pressure shell")
if head_shell:
    head_shell.dimensions = (3.38, 2.0, 2.68)

# Clear stale animation while preserving geometry and material construction.
for obj in scene.objects:
    obj.animation_data_clear()
for material in bpy.data.materials:
    if material.node_tree:
        material.node_tree.animation_data_clear()

# Production control hierarchy. Pivots are placed at the mechanical joint centers.
root = make_empty("CTRL_ROOT", (0.0, 0.0, 0.0), 1.0, "PLAIN_AXES")
hips = make_empty("CTRL_HIPS", (0.0, 0.0, 0.72), 0.65)
torso = make_empty("CTRL_TORSO", (0.0, 0.0, 1.38), 0.8)
head = make_empty("CTRL_HEAD", (0.0, 0.0, 6.78), 0.65)
shoulder_l = make_empty("CTRL_SHOULDER_L", (-2.55, 0.0, 5.42), 0.55)
elbow_l = make_empty("CTRL_ELBOW_L", (-5.02, -0.06, 3.92), 0.45)
wrist_l = make_empty("CTRL_WRIST_L", (-6.02, -0.12, 5.02), 0.34)
shoulder_r = make_empty("CTRL_SHOULDER_R", (2.55, 0.0, 5.42), 0.55)
elbow_r = make_empty("CTRL_ELBOW_R", (5.02, -0.06, 3.92), 0.45)
wrist_r = make_empty("CTRL_WRIST_R", (6.02, -0.12, 5.02), 0.34)
hip_l = make_empty("CTRL_HIP_L", (-1.12, 0.0, 0.42), 0.48)
knee_l = make_empty("CTRL_KNEE_L", (-1.22, -0.03, -1.42), 0.4)
ankle_l = make_empty("CTRL_ANKLE_L", (-1.26, -0.04, -3.2), 0.32)
hip_r = make_empty("CTRL_HIP_R", (1.12, 0.0, 0.42), 0.48)
knee_r = make_empty("CTRL_KNEE_R", (1.22, -0.03, -1.42), 0.4)
ankle_r = make_empty("CTRL_ANKLE_R", (1.26, -0.04, -3.2), 0.32)

parent_keep_world(hips, root)
parent_keep_world(torso, hips)
parent_keep_world(head, torso)
parent_keep_world(shoulder_l, torso)
parent_keep_world(elbow_l, shoulder_l)
parent_keep_world(wrist_l, elbow_l)
parent_keep_world(shoulder_r, torso)
parent_keep_world(elbow_r, shoulder_r)
parent_keep_world(wrist_r, elbow_r)
parent_keep_world(hip_l, hips)
parent_keep_world(knee_l, hip_l)
parent_keep_world(ankle_l, knee_l)
parent_keep_world(hip_r, hips)
parent_keep_world(knee_r, hip_r)
parent_keep_world(ankle_r, knee_r)

assigned = set()
head_objects = collection_objects("02_HEAD") + objects_matching(
    collection_objects("09_DETAILS"), "Face LED", "Face —"
)
assign(head_objects, head, assigned)

left_arm = collection_objects("04_LEFT_ARM")
right_arm = collection_objects("05_RIGHT_ARM")
details = collection_objects("09_DETAILS")
hands = collection_objects("06_HANDS")

assign(objects_matching(left_arm, "Shoulder L", "Upper arm L") + objects_matching(details, "Shoulder L"), shoulder_l, assigned)
assign(objects_matching(left_arm, "Elbow L", "Forearm L") + objects_matching(details, "Forearm L"), elbow_l, assigned)
assign(objects_matching(left_arm, "Wrist L") + objects_matching(hands, "Hand L"), wrist_l, assigned)
assign(objects_matching(right_arm, "Shoulder R", "Upper arm R") + objects_matching(details, "Shoulder R"), shoulder_r, assigned)
assign(objects_matching(right_arm, "Elbow R", "Forearm R") + objects_matching(details, "Forearm R"), elbow_r, assigned)
assign(objects_matching(right_arm, "Wrist R") + objects_matching(hands, "Hand R"), wrist_r, assigned)

legs = collection_objects("08_LEGS")
assign(objects_matching(legs, "Leg L — thigh"), hip_l, assigned)
assign(objects_matching(legs, "Leg L — knee", "Leg L — shin") + objects_matching(details, "Leg L"), knee_l, assigned)
assign(objects_matching(legs, "Leg L — ankle", "Foot L"), ankle_l, assigned)
assign(objects_matching(legs, "Leg R — thigh"), hip_r, assigned)
assign(objects_matching(legs, "Leg R — knee", "Leg R — shin") + objects_matching(details, "Leg R"), knee_r, assigned)
assign(objects_matching(legs, "Leg R — ankle", "Foot R"), ankle_r, assigned)

assign(collection_objects("07_HIPS"), hips, assigned)
assign(collection_objects("01_TORSO") + collection_objects("03_NECK") + objects_matching(details, "Torso —", "Neck —"), torso, assigned)
assign([obj for obj in robot_objects if obj.name not in assigned], root, assigned)

controllers = [
    root, hips, torso, head,
    shoulder_l, elbow_l, wrist_l,
    shoulder_r, elbow_r, wrist_r,
    hip_l, knee_l, ankle_l,
    hip_r, knee_r, ankle_r,
]
base_locations = {obj.name: obj.location.copy() for obj in controllers}
base_rotations = {obj.name: obj.rotation_euler.copy() for obj in controllers}

# Eight-second seamless enterprise motion loop at 24 fps.
scene.frame_start = 1
scene.frame_end = 192
scene.render.fps = 24

for frame, rotation in [(1, (0, 0, 0)), (40, (0.7, 1.2, -2.4)), (72, (-0.8, -1.0, 3.0)), (104, (0.5, 0.8, -1.5)), (144, (-0.6, 0.7, 2.0)), (192, (0, 0, 0))]:
    key_rotation(torso, frame, rotation, base_rotations[torso.name])
for frame, offset in [(1, (0, 0, 0)), (24, (0, 0, 0.035)), (48, (0, 0, 0)), (72, (0, 0, -0.025)), (96, (0, 0, 0)), (120, (0, 0, 0.04)), (144, (0, 0, 0)), (168, (0, 0, -0.02)), (192, (0, 0, 0))]:
    key_location(hips, frame, offset, base_locations[hips.name])

for frame, rotation in [(1, (0, 0, 0)), (32, (-2.5, 3.0, -15.0)), (64, (2.0, -2.5, 16.0)), (92, (0, 0, 0)), (120, (6.0, 2.0, -5.0)), (146, (-3.0, -1.5, 7.0)), (192, (0, 0, 0))]:
    key_rotation(head, frame, rotation, base_rotations[head.name])

# Left arm behaves as a stabilizing counter-gesture.
for frame, rotation in [(1, (0, 0, 0)), (52, (0, 2.5, -1.5)), (96, (0, -2.0, 1.2)), (144, (0, 2.0, -1.0)), (192, (0, 0, 0))]:
    key_rotation(shoulder_l, frame, rotation, base_rotations[shoulder_l.name])
for frame, rotation in [(1, (0, 0, 0)), (64, (0, -4.0, 0)), (112, (0, 3.0, 0)), (160, (0, -2.0, 0)), (192, (0, 0, 0))]:
    key_rotation(elbow_l, frame, rotation, base_rotations[elbow_l.name])
for frame, rotation in [(1, (0, 0, 0)), (72, (-3.0, 1.0, 5.0)), (120, (2.0, -1.0, -4.0)), (192, (0, 0, 0))]:
    key_rotation(wrist_l, frame, rotation, base_rotations[wrist_l.name])

# Right arm performs a confident diagnostic wave.
for frame, rotation in [(1, (0, 0, 0)), (88, (0, 0, 0)), (106, (2.0, -12.0, 7.0)), (154, (2.0, -12.0, 7.0)), (174, (0, 0, 0)), (192, (0, 0, 0))]:
    key_rotation(shoulder_r, frame, rotation, base_rotations[shoulder_r.name])
for frame, rotation in [(1, (0, 0, 0)), (92, (0, 0, 0)), (108, (0, -18.0, 0)), (154, (0, -18.0, 0)), (174, (0, 0, 0)), (192, (0, 0, 0))]:
    key_rotation(elbow_r, frame, rotation, base_rotations[elbow_r.name])
for frame, rotation in [(1, (0, 0, 0)), (96, (0, 0, 0)), (108, (-4, 3, -36)), (120, (4, -3, 38)), (132, (-4, 3, -38)), (144, (4, -3, 34)), (158, (0, 0, 0)), (192, (0, 0, 0))]:
    key_rotation(wrist_r, frame, rotation, base_rotations[wrist_r.name])

# Micro weight shift through the hip and knee mechanisms.
for control, sign in ((hip_l, -1), (hip_r, 1)):
    for frame, rotation in [(1, (0, 0, 0)), (48, (0, sign * 0.8, 0)), (96, (0, -sign * 0.8, 0)), (144, (0, sign * 0.6, 0)), (192, (0, 0, 0))]:
        key_rotation(control, frame, rotation, base_rotations[control.name])
for control, sign in ((knee_l, 1), (knee_r, -1)):
    for frame, rotation in [(1, (0, 0, 0)), (48, (0, sign * 0.45, 0)), (96, (0, -sign * 0.45, 0)), (144, (0, sign * 0.3, 0)), (192, (0, 0, 0))]:
        key_rotation(control, frame, rotation, base_rotations[control.name])

# Two natural eye blinks and a subtly changing mouth/status expression.
eye_objects = objects_matching(collection_objects("09_DETAILS"), "Face LED")
for eye in eye_objects:
    base_scale = eye.scale.copy()
    for frame, factor in [(1, 1.0), (50, 1.0), (54, 0.08), (58, 1.0), (147, 1.0), (151, 0.08), (155, 1.0), (192, 1.0)]:
        key_scale(eye, frame, (base_scale.x, base_scale.y, base_scale.z * factor))

mouth = bpy.data.objects.get("Face — status dash")
if mouth:
    base_scale = mouth.scale.copy()
    for frame, factor in [(1, 1.0), (88, 1.0), (108, 1.35), (148, 1.35), (170, 1.0), (192, 1.0)]:
        key_scale(mouth, frame, (base_scale.x * factor, base_scale.y, base_scale.z))

set_emission_key("White Face LEDs", [(1, 18.0), (50, 18.0), (54, 2.0), (58, 18.0), (147, 18.0), (151, 2.0), (155, 18.0), (192, 18.0)])
set_emission_key("Ice Cyan LEDs", [(1, 9.0), (24, 15.0), (48, 9.0), (72, 13.0), (96, 9.0), (120, 16.0), (144, 9.0), (168, 13.0), (192, 9.0)])

# Premium animated camera with a restrained product-orbit move.
camera_data = bpy.data.cameras.new("Camera — animated showcase")
camera_data.lens = 50
camera_data.sensor_width = 36
camera_data.dof.use_dof = True
camera_data.dof.aperture_fstop = 6.3
camera = bpy.data.objects.new("Camera — animated showcase", camera_data)
rig_collection.objects.link(camera)
target = make_empty("CAM_TARGET_BOT", (0.0, 0.0, 2.75), 0.35, "SPHERE")
camera_data.dof.focus_object = target
track = camera.constraints.new("TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"
for frame, location in [(1, (-3.4, -37.5, 3.05)), (48, (-1.2, -36.8, 3.25)), (96, (3.2, -37.2, 3.0)), (144, (1.0, -36.7, 3.3)), (192, (-3.4, -37.5, 3.05))]:
    camera.location = location
    camera.keyframe_insert(data_path="location", frame=frame, group="Camera Orbit")
for frame, location in [(1, (0.0, 0.0, 2.75)), (96, (0.15, 0.0, 2.95)), (192, (0.0, 0.0, 2.75))]:
    target.location = location
    target.keyframe_insert(data_path="location", frame=frame, group="Camera Aim")
scene.camera = camera

# Smooth all mechanical and camera curves with clamped handles.
for obj in list(scene.objects):
    action = obj.animation_data.action if obj.animation_data and obj.animation_data.action else None
    if action:
        action.name = "DJL_" + obj.name.replace("CTRL_", "").replace("Camera — ", "Camera_")
        for fcurve in action.fcurves:
            for point in fcurve.keyframe_points:
                point.interpolation = "BEZIER"
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"

# Render and color-management settings for a clean enterprise product film.
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = False
scene.render.use_file_extension = True
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.filepath = HERO_PATH

root["asset_name"] = "DJL Enterprise Humanoid Bot"
root["reference_match"] = "modern_bot_reference.png"
root["animation"] = "8-second seamless diagnostic scan and greeting loop"
root["fps"] = 24
root["export_glb"] = GLB_PATH
scene["animated_master"] = BLEND_PATH
scene["showcase_video"] = VIDEO_PATH

# Save the editable master, export an animation-ready GLB, and render the wave hero frame.
scene.frame_set(128)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

bpy.ops.object.select_all(action="DESELECT")
for obj in robot_objects + controllers:
    if obj.name in scene.objects:
        obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(
    filepath=GLB_PATH,
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_frame_range=True,
    export_cameras=False,
    export_lights=False,
)

scene.render.filepath = HERO_PATH
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
print(f"DJL_ENTERPRISE_BOT_ANIMATED::{BLEND_PATH}::{GLB_PATH}::{HERO_PATH}::{len(robot_objects)} robot objects")
