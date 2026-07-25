import bpy
import math
import os
from mathutils import Vector


ROOT = os.path.dirname(os.path.abspath(__file__))
BLEND_PATH = os.path.join(ROOT, "DJL_Modern_Bot.blend")
HERO_RENDER = os.path.join(ROOT, "DJL_Modern_Bot_Hero.png")
FULL_RENDER = os.path.join(ROOT, "DJL_Modern_Bot_Full.png")
REFERENCE_RENDER = os.path.join(ROOT, "DJL_Modern_Bot_ReferenceMatch.png")
REFERENCE_PATH = os.path.join(ROOT, "modern_bot_reference.png")
COLLECTION_NAMES = [
    "00_REFERENCE",
    "01_TORSO",
    "02_HEAD",
    "03_NECK",
    "04_LEFT_ARM",
    "05_RIGHT_ARM",
    "06_HANDS",
    "07_HIPS",
    "08_LEGS",
    "09_DETAILS",
    "10_STAGE",
]


def move_to_collection(obj, collection):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    collection.objects.link(obj)


def material_principled(name, base, metallic=0.0, roughness=0.4):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (*base, 1.0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def material_emission(name, color, strength):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (*color, 1.0)
    emission.inputs["Strength"].default_value = strength
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def material_carbon(name="Carbon Weave"):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    links = material.node_tree.links
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Metallic"].default_value = 0.55
    shader.inputs["Roughness"].default_value = 0.26
    texcoord = nodes.new("ShaderNodeTexCoord")
    wave_a = nodes.new("ShaderNodeTexWave")
    wave_a.wave_type = "BANDS"
    wave_a.bands_direction = "X"
    wave_a.inputs["Scale"].default_value = 82.0
    wave_a.inputs["Distortion"].default_value = 2.0
    wave_b = nodes.new("ShaderNodeTexWave")
    wave_b.wave_type = "BANDS"
    wave_b.bands_direction = "Y"
    wave_b.inputs["Scale"].default_value = 82.0
    wave_b.inputs["Distortion"].default_value = 2.0
    mix = nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 0.7
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.004, 0.006, 0.008, 1)
    ramp.color_ramp.elements[1].color = (0.055, 0.065, 0.075, 1)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.18
    bump.inputs["Distance"].default_value = 0.035
    links.new(texcoord.outputs["Generated"], wave_a.inputs["Vector"])
    links.new(texcoord.outputs["Generated"], wave_b.inputs["Vector"])
    links.new(wave_a.outputs["Color"], mix.inputs[1])
    links.new(wave_b.outputs["Color"], mix.inputs[2])
    links.new(mix.outputs["Color"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    links.new(mix.outputs["Color"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def assign_material(obj, material):
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.clear()
        obj.data.materials.append(material)


def smooth(obj):
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True


def rounded_box(name, location, dimensions, bevel, material, collection, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = rotation
    modifier = obj.modifiers.new("Precision edge radii", "BEVEL")
    modifier.width = bevel
    modifier.segments = 6
    modifier.limit_method = "ANGLE"
    smooth(obj)
    assign_material(obj, material)
    move_to_collection(obj, collection)
    return obj


def ellipsoid(name, location, dimensions, material, collection, rotation=(0, 0, 0), segments=48):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=24, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = rotation
    smooth(obj)
    assign_material(obj, material)
    move_to_collection(obj, collection)
    return obj


def cylinder(name, location, radius, depth, material, collection, rotation=(0, 0, 0), vertices=48, bevel=0.05):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    if bevel:
        modifier = obj.modifiers.new("Machined edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 4
    smooth(obj)
    assign_material(obj, material)
    move_to_collection(obj, collection)
    return obj


def torus(name, location, major_radius, minor_radius, material, collection, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=64,
        minor_segments=16,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    smooth(obj)
    assign_material(obj, material)
    move_to_collection(obj, collection)
    return obj


def cylinder_between(name, start, end, radius, material, collection, bevel=0.04, vertices=40):
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    midpoint = (start_v + end_v) * 0.5
    obj = cylinder(name, midpoint, radius, direction.length, material, collection, vertices=vertices, bevel=bevel)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    return obj


def capsule_between(name, start, end, radius, material, collection):
    cylinder_between(name + " core", start, end, radius, material, collection, bevel=radius * 0.2)
    ellipsoid(name + " start cap", start, (radius * 2, radius * 2, radius * 2), material, collection, segments=32)
    ellipsoid(name + " end cap", end, (radius * 2, radius * 2, radius * 2), material, collection, segments=32)


def tube_curve(name, points, radius, material, collection, resolution=4):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = radius
    curve.bevel_resolution = 4
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for bezier_point, coordinate in zip(spline.bezier_points, points):
        bezier_point.co = coordinate
        bezier_point.handle_left_type = "AUTO"
        bezier_point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    assign_material(obj, material)
    return obj


def torso_loft(name, rings, material, collection):
    segments = 64
    vertices = []
    faces = []
    for z, width, depth in rings:
        for index in range(segments):
            theta = 2 * math.pi * index / segments
            x = width * math.cos(theta)
            y = depth * math.sin(theta)
            vertices.append((x, y, z))
    for ring_index in range(len(rings) - 1):
        base = ring_index * segments
        upper = (ring_index + 1) * segments
        for index in range(segments):
            next_index = (index + 1) % segments
            faces.append((base + index, base + next_index, upper + next_index, upper + index))
    faces.append(tuple(reversed(range(segments))))
    top_start = (len(rings) - 1) * segments
    faces.append(tuple(top_start + index for index in range(segments)))
    mesh = bpy.data.meshes.new(name + " Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    smooth(obj)
    assign_material(obj, material)
    bevel = obj.modifiers.new("Sculpted shell softness", "BEVEL")
    bevel.width = 0.11
    bevel.segments = 5
    return obj


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area_light(name, location, energy, size, color, collection, target=(0, 0, 3)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)
    return obj


# Preserve the user's currently open work by building in a separate scene.
previous_scene = bpy.context.window.scene
scene_name = "DJL Modern Bot — Reference Build"
existing_scene = bpy.data.scenes.get(scene_name)
if existing_scene:
    for old_obj in list(existing_scene.objects):
        bpy.data.objects.remove(old_obj, do_unlink=True)
    bpy.data.scenes.remove(existing_scene)

# Remove only orphaned collections from earlier runs of this generator so the
# visible hierarchy keeps stable, clean names on every rebuild.
for stale_collection in list(bpy.data.collections):
    is_ours = any(
        stale_collection.name == base or stale_collection.name.startswith(base + ".")
        for base in COLLECTION_NAMES
    )
    if is_ours and stale_collection.users == 0:
        bpy.data.collections.remove(stale_collection)

scene = bpy.data.scenes.new(scene_name)
bpy.context.window.scene = scene

root = scene.collection
collections = {}
for collection_name in COLLECTION_NAMES:
    collection = bpy.data.collections.new(collection_name)
    root.children.link(collection)
    collections[collection_name] = collection


# Materials — graphite shell, carbon composite, chrome mechanics, and cool LEDs.
black_gloss = material_principled("Obsidian Gloss", (0.008, 0.012, 0.018), 0.72, 0.12)
graphite = material_principled("Graphite Armor", (0.025, 0.035, 0.045), 0.78, 0.2)
joint_mat = material_principled("Joint Gunmetal", (0.055, 0.07, 0.085), 0.9, 0.24)
chrome = material_principled("Liquid Chrome", (0.45, 0.53, 0.6), 1.0, 0.08)
rubber = material_principled("Soft Black Rubber", (0.008, 0.01, 0.012), 0.05, 0.43)
carbon = material_carbon()
cyan = material_emission("Ice Cyan LEDs", (0.22, 0.85, 1.0), 12.0)
white_led = material_emission("White Face LEDs", (0.82, 0.95, 1.0), 18.0)
floor_mat = material_principled("Studio White", (0.32, 0.35, 0.39), 0.05, 0.34)
dark_floor = material_principled("Backdrop", (0.018, 0.025, 0.035), 0.15, 0.38)
light_backdrop = material_principled("Reference Light Backdrop", (0.72, 0.75, 0.79), 0.0, 0.42)


# Reference image, packed into the blend file and hidden from final renders.
if os.path.exists(REFERENCE_PATH):
    image = bpy.data.images.load(REFERENCE_PATH, check_existing=True)
    image.pack()
    reference = bpy.data.objects.new("ORIGINAL REFERENCE — front hero", None)
    reference.empty_display_type = "IMAGE"
    reference.data = image
    reference.location = (-11.5, 1.8, 3.2)
    reference.rotation_euler = (math.radians(90), 0, 0)
    reference.empty_display_size = 8.0
    reference.color[3] = 0.65
    reference.hide_render = True
    collections["00_REFERENCE"].objects.link(reference)


# Piece 1: tapered torso shell and floating carbon breastplate.
torso = torso_loft(
    "Torso — tapered monocoque shell",
    [
        (1.7, 1.42, 0.66),
        (2.1, 1.75, 0.88),
        (3.2, 1.95, 1.02),
        (4.5, 2.25, 1.12),
        (5.55, 2.56, 1.05),
        (6.0, 2.15, 0.82),
    ],
    graphite,
    collections["01_TORSO"],
)
chest = rounded_box(
    "Torso — carbon front shield",
    (0, -1.045, 4.22),
    (3.55, 0.16, 3.0),
    0.38,
    carbon,
    collections["01_TORSO"],
)
rounded_box("Torso — sternum light", (0, -1.155, 4.62), (0.13, 0.07, 1.55), 0.055, cyan, collections["09_DETAILS"])
for side in (-1, 1):
    rounded_box(
        f"Torso — side intake {'L' if side < 0 else 'R'}",
        (side * 1.7, -0.94, 4.45),
        (0.13, 0.08, 1.15),
        0.045,
        chrome,
        collections["09_DETAILS"],
        rotation=(0, 0, math.radians(-side * 9)),
    )


# Piece 2: articulated waist and pelvic bridge.
cylinder("Waist — flexible core", (0, 0, 1.38), 0.66, 0.72, rubber, collections["07_HIPS"])
for z, radius, depth in ((1.67, 0.83, 0.15), (1.29, 0.7, 0.12), (1.05, 0.79, 0.16)):
    cylinder(f"Waist — chrome ring {z}", (0, 0, z), radius, depth, chrome, collections["07_HIPS"])
rounded_box("Pelvis — central bridge", (0, 0, 0.72), (2.65, 1.35, 0.85), 0.27, graphite, collections["07_HIPS"])
for side in (-1, 1):
    cylinder(
        f"Pelvis — hip rotary {'L' if side < 0 else 'R'}",
        (side * 1.22, 0, 0.62),
        0.58,
        0.52,
        joint_mat,
        collections["07_HIPS"],
        rotation=(0, math.pi / 2, 0),
    )
    torus(
        f"Pelvis — hip trim {'L' if side < 0 else 'R'}",
        (side * 1.48, 0, 0.62),
        0.47,
        0.08,
        chrome,
        collections["07_HIPS"],
        rotation=(0, math.pi / 2, 0),
    )


# Piece 3: neck pedestal, support struts, and a polished collar.
cylinder("Neck — central actuator", (0, 0, 6.57), 0.59, 1.15, joint_mat, collections["03_NECK"])
cylinder("Neck — upper chrome sleeve", (0, 0, 6.82), 0.51, 0.72, chrome, collections["03_NECK"])
cylinder("Neck — lower collar", (0, 0, 6.08), 0.93, 0.22, graphite, collections["03_NECK"])
torus("Neck — cyan status ring", (0, 0, 6.18), 0.7, 0.045, cyan, collections["09_DETAILS"])
for side in (-1, 1):
    cylinder_between(
        f"Neck — lateral strut {'L' if side < 0 else 'R'}",
        (side * 0.8, 0.12, 5.9),
        (side * 0.55, 0.1, 7.0),
        0.09,
        chrome,
        collections["03_NECK"],
        bevel=0.025,
    )


# Piece 4: rounded display head, visor, side loops, and dot-matrix eyes.
head = rounded_box("Head — chrome pressure shell", (0, 0, 8.15), (3.12, 1.92, 2.52), 0.52, chrome, collections["02_HEAD"])
visor = rounded_box("Head — seamless black visor", (0, -0.985, 8.12), (2.78, 0.13, 2.15), 0.42, black_gloss, collections["02_HEAD"])
rounded_box("Head — crown insert", (0, -0.08, 9.38), (1.55, 1.4, 0.13), 0.06, graphite, collections["02_HEAD"])
for side in (-1, 1):
    torus(
        f"Head — side acoustic loop {'L' if side < 0 else 'R'}",
        (side * 1.49, -0.02, 8.1),
        0.66,
        0.105,
        chrome,
        collections["02_HEAD"],
        rotation=(0, math.pi / 2, 0),
    )
    ellipsoid(
        f"Head — side acoustic inset {'L' if side < 0 else 'R'}",
        (side * 1.49, 0, 8.1),
        (0.12, 0.67, 1.05),
        black_gloss,
        collections["02_HEAD"],
    )

for eye_side in (-1, 1):
    for row in range(3):
        for column in range(5):
            if row in (0, 2) and column in (0, 4):
                continue
            x = eye_side * 0.7 + (column - 2) * 0.115
            z = 8.18 + (1 - row) * 0.115
            ellipsoid(
                f"Face LED {'L' if eye_side < 0 else 'R'} {row}-{column}",
                (x, -1.075, z),
                (0.07, 0.045, 0.07),
                white_led,
                collections["09_DETAILS"],
                segments=20,
            )
rounded_box("Face — status dash", (0, -1.08, 7.62), (0.5, 0.04, 0.055), 0.025, cyan, collections["09_DETAILS"])


# Piece 5: shoulder mechanisms and layered upper-arm armor.
for side, collection_key in ((-1, "04_LEFT_ARM"), (1, "05_RIGHT_ARM")):
    coll = collections[collection_key]
    label = "L" if side < 0 else "R"
    cylinder(f"Shoulder {label} — inner rotary", (side * 2.55, 0.0, 5.42), 0.67, 0.48, joint_mat, coll, rotation=(0, math.pi / 2, 0))
    torus(f"Shoulder {label} — exposed bearing", (side * 2.78, -0.02, 5.42), 0.56, 0.085, chrome, coll, rotation=(0, math.pi / 2, 0))
    ellipsoid(
        f"Shoulder {label} — carbon armor",
        (side * 3.27, 0.03, 5.42),
        (2.1, 1.72, 2.35),
        carbon,
        coll,
        rotation=(0, math.radians(side * 13), math.radians(side * 5)),
    )
    shoulder_start = (side * 3.55, 0.0, 5.1)
    elbow = (side * 5.02, -0.06, 3.92)
    capsule_between(f"Upper arm {label} — structural core", shoulder_start, elbow, 0.42, joint_mat, coll)
    upper_mid = tuple((Vector(shoulder_start) + Vector(elbow)) * 0.5)
    angle = math.atan2(elbow[0] - shoulder_start[0], elbow[2] - shoulder_start[2])
    ellipsoid(f"Upper arm {label} — floating armor", upper_mid, (1.2, 1.32, 2.15), carbon, coll, rotation=(0, angle, 0))
    cylinder(f"Elbow {label} — rotary hub", elbow, 0.61, 0.55, joint_mat, coll, rotation=(math.pi / 2, 0, 0))
    torus(f"Elbow {label} — chrome bearing", (elbow[0], -0.34, elbow[2]), 0.49, 0.085, chrome, coll, rotation=(math.pi / 2, 0, 0))
    wrist = (side * 6.02, -0.12, 5.02)
    capsule_between(f"Forearm {label} — actuator", elbow, wrist, 0.39, joint_mat, coll)
    forearm_mid = tuple((Vector(elbow) + Vector(wrist)) * 0.5)
    forearm_angle = math.atan2(wrist[0] - elbow[0], wrist[2] - elbow[2])
    ellipsoid(f"Forearm {label} — shell", forearm_mid, (1.36, 1.42, 2.05), graphite, coll, rotation=(0, forearm_angle, 0))
    rounded_box(
        f"Forearm {label} — cyan seam",
        (forearm_mid[0], -0.79, forearm_mid[2]),
        (0.08, 0.035, 0.92),
        0.03,
        cyan,
        collections["09_DETAILS"],
        rotation=(0, forearm_angle, 0),
    )
    cylinder(f"Wrist {label} — swivel", wrist, 0.43, 0.38, chrome, coll, rotation=(math.pi / 2, 0, 0))
    tube_curve(
        f"Shoulder {label} — braided control line",
        [(side * 2.3, 0.65, 5.5), (side * 2.8, 0.83, 5.1), (side * 3.35, 0.72, 4.75)],
        0.055,
        rubber,
        collections["09_DETAILS"],
    )


# Piece 6: expressive open hands, each finger built as an individual articulated tube.
for side in (-1, 1):
    label = "L" if side < 0 else "R"
    palm_x = side * 6.18
    rounded_box(
        f"Hand {label} — palm",
        (palm_x, -0.47, 5.36),
        (0.9, 0.46, 1.03),
        0.23,
        black_gloss,
        collections["06_HANDS"],
        rotation=(math.radians(-5), 0, math.radians(-side * 16)),
    )
    for finger in range(4):
        base_x = side * (5.98 + finger * 0.15)
        base_z = 5.67 + finger * 0.015
        tip_x = side * (5.9 + finger * 0.36)
        tip_z = 6.35 - finger * 0.075
        points = [
            (base_x, -0.72, base_z),
            (side * ((abs(base_x) + abs(tip_x)) * 0.5), -0.75, (base_z + tip_z) * 0.5 + 0.08),
            (tip_x, -0.72, tip_z),
        ]
        tube_curve(f"Hand {label} — finger {finger + 1}", points, 0.10, black_gloss, collections["06_HANDS"])
        ellipsoid(f"Hand {label} — fingertip {finger + 1}", points[-1], (0.2, 0.2, 0.2), black_gloss, collections["06_HANDS"], segments=24)
    thumb_points = [
        (side * 5.91, -0.7, 5.28),
        (side * 5.6, -0.75, 5.45),
        (side * 5.45, -0.72, 5.72),
    ]
    tube_curve(f"Hand {label} — thumb", thumb_points, 0.115, black_gloss, collections["06_HANDS"])
    ellipsoid(f"Hand {label} — thumb tip", thumb_points[-1], (0.23, 0.23, 0.23), black_gloss, collections["06_HANDS"], segments=24)


# Piece 7: complete lower body with armored legs, exposed knee rings, and stable feet.
for side in (-1, 1):
    label = "L" if side < 0 else "R"
    hip = (side * 1.12, 0, 0.42)
    knee = (side * 1.22, -0.03, -1.42)
    ankle = (side * 1.26, -0.04, -3.2)
    capsule_between(f"Leg {label} — thigh actuator", hip, knee, 0.38, joint_mat, collections["08_LEGS"])
    ellipsoid(f"Leg {label} — thigh carbon armor", (side * 1.16, 0, -0.42), (1.15, 1.32, 2.0), carbon, collections["08_LEGS"], rotation=(0, math.radians(-side * 3), 0))
    cylinder(f"Leg {label} — knee hub", knee, 0.59, 0.58, joint_mat, collections["08_LEGS"], rotation=(math.pi / 2, 0, 0))
    torus(f"Leg {label} — knee chrome ring", (knee[0], -0.32, knee[2]), 0.47, 0.09, chrome, collections["08_LEGS"], rotation=(math.pi / 2, 0, 0))
    capsule_between(f"Leg {label} — shin actuator", knee, ankle, 0.34, joint_mat, collections["08_LEGS"])
    ellipsoid(f"Leg {label} — shin shell", (side * 1.25, -0.02, -2.35), (1.08, 1.22, 2.05), graphite, collections["08_LEGS"])
    rounded_box(f"Leg {label} — shin cyan seam", (side * 1.25, -0.65, -2.32), (0.07, 0.035, 0.95), 0.025, cyan, collections["09_DETAILS"])
    cylinder(f"Leg {label} — ankle swivel", ankle, 0.42, 0.42, chrome, collections["08_LEGS"])
    rounded_box(
        f"Foot {label} — grounded shell",
        (side * 1.26, -0.47, -3.72),
        (1.42, 2.05, 0.62),
        0.25,
        rubber,
        collections["08_LEGS"],
    )
    rounded_box(
        f"Foot {label} — carbon instep",
        (side * 1.26, -0.64, -3.57),
        (1.12, 1.45, 0.42),
        0.18,
        carbon,
        collections["08_LEGS"],
    )


# Stage, cameras, and studio lighting.
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -4.05))
ground = bpy.context.object
ground.name = "Studio — ground"
assign_material(ground, floor_mat)
move_to_collection(ground, collections["10_STAGE"])

bpy.ops.mesh.primitive_plane_add(size=36, location=(0, 5.5, 5.0), rotation=(math.pi / 2, 0, 0))
backdrop = bpy.context.object
backdrop.name = "Studio — back wall"
assign_material(backdrop, dark_floor)
move_to_collection(backdrop, collections["10_STAGE"])

add_area_light("Studio — key softbox", (-7.5, -10.5, 12.5), 1650, 5.5, (1.0, 0.94, 0.88), collections["10_STAGE"], (0, 0, 3.2))
add_area_light("Studio — cyan fill", (8.5, -7.5, 8.5), 1250, 4.0, (0.28, 0.68, 1.0), collections["10_STAGE"], (0, 0, 3.5))
add_area_light("Studio — crown rim", (0, 4.0, 12.0), 1900, 3.5, (0.65, 0.82, 1.0), collections["10_STAGE"], (0, 0, 4.0))
add_area_light("Studio — low front fill", (0, -10, 0.5), 700, 4.0, (0.75, 0.82, 1.0), collections["10_STAGE"], (0, 0, 1.0))

camera_data = bpy.data.cameras.new("Camera — reference hero")
camera_hero = bpy.data.objects.new("Camera — reference hero", camera_data)
collections["10_STAGE"].objects.link(camera_hero)
camera_hero.location = (0, -25.5, 4.7)
camera_data.lens = 63
look_at(camera_hero, (0, 0, 4.2))

camera_full_data = bpy.data.cameras.new("Camera — full body")
camera_full = bpy.data.objects.new("Camera — full body", camera_full_data)
collections["10_STAGE"].objects.link(camera_full)
camera_full.location = (0, -28.5, 2.8)
camera_full_data.lens = 54
look_at(camera_full, (0, 0, 2.4))

camera_reference_data = bpy.data.cameras.new("Camera — supplied-reference match")
camera_reference = bpy.data.objects.new("Camera — supplied-reference match", camera_reference_data)
collections["10_STAGE"].objects.link(camera_reference)
camera_reference.location = (0, -31.0, 4.45)
camera_reference_data.lens = 70
look_at(camera_reference, (0, 0, 4.45))

scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = False
scene.render.image_settings.color_depth = "8"
scene.render.resolution_percentage = 100
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.filepath = HERO_RENDER
scene.camera = camera_hero
scene.render.film_transparent = False

scene.world = bpy.data.worlds.new("DJL Studio World")
scene.world.use_nodes = True
world_bg = scene.world.node_tree.nodes.get("Background")
world_bg.inputs["Color"].default_value = (0.012, 0.018, 0.028, 1)
world_bg.inputs["Strength"].default_value = 0.22

scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.filepath = HERO_RENDER

# Helpful custom metadata for handoff and future editing.
scene["reference_image"] = REFERENCE_PATH
scene["build_notes"] = "Modular humanoid built piece-by-piece from the supplied front-view reference. Collections preserve each assembly."
scene["units"] = "meters-like design units"

# Save before rendering, then produce both the matching hero crop and full-body proof.
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
scene.camera = camera_hero
scene.render.filepath = HERO_RENDER
bpy.ops.render.render(write_still=True)
scene.camera = camera_full
scene.render.filepath = FULL_RENDER
bpy.ops.render.render(write_still=True)

# Match the supplied 1856×1333 framing and pale product-visualization background.
assign_material(backdrop, light_backdrop)
scene.render.resolution_x = 1856
scene.render.resolution_y = 1333
scene.camera = camera_reference
scene.render.filepath = REFERENCE_RENDER
bpy.ops.render.render(write_still=True)

# Leave Blender in the reference-matching camera with the reference render visible.
scene.camera = camera_reference
scene.render.filepath = REFERENCE_RENDER
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

# Leave the finished model selected as a whole via the torso and print a concise completion marker.
bpy.context.view_layer.objects.active = torso
torso.select_set(True)
print(f"DJL_MODERN_BOT_COMPLETE::{BLEND_PATH}::{len(scene.objects)} objects")
