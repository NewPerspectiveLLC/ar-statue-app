import bpy, sys, math
from mathutils import Vector
D='/workspace/ar-statue-app'
frames=[int(x) for x in sys.argv[sys.argv.index('--')+1].split(',')]
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.samples=24; sc.cycles.device='CPU'
sc.render.resolution_x=480; sc.render.resolution_y=640
sc.render.film_transparent=False
w=bpy.data.worlds.new('W'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(0.05,0.05,0.06,1); w.node_tree.nodes['Background'].inputs[1].default_value=1
bpy.ops.mesh.primitive_plane_add(size=30); fl=bpy.context.object
fm=bpy.data.materials.new('floor'); fm.use_nodes=True; fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.35,0.3,0.26,1); fl.data.materials.append(fm)
for x in range(-3,4):  # simple room cue: back wall
    pass
bpy.ops.mesh.primitive_plane_add(size=30, location=(0,9,0), rotation=(math.pi/2,0,0)); wl=bpy.context.object
wm=bpy.data.materials.new('wall'); wm.use_nodes=True; wm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.45,0.45,0.5,1); wl.data.materials.append(wm)
bpy.ops.object.light_add(type='AREA', location=(0,-2,3.5)); L=bpy.context.object; L.data.energy=600; L.data.size=4
cam=bpy.data.cameras.new('C'); cam.lens=22; co=bpy.data.objects.new('C',cam); sc.collection.objects.link(co); sc.camera=co
import os
if os.environ.get('CAM')=='side': co.location=(4.2,-1.2,1.4); d=Vector((0,0.3,1.1))-co.location
else: co.location=(0.3,-3.6,1.55); d=Vector((0,2.5,1.4))-co.location
co.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
for f in frames:
    sc.frame_set(f); sc.render.filepath=f'/tmp/ghostfr/f{f:04d}.png'; bpy.ops.render.render(write_still=True)
