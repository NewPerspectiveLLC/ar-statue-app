import bpy, bmesh, os
D='/workspace/ar-statue-app'
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene; sc.unit_settings.system='METRIC'; sc.unit_settings.scale_length=1.0
img=bpy.data.images.load(D+'/stone.jpg'); rimg=bpy.data.images.load(D+'/stone_rough.jpg'); rimg.colorspace_settings.name='Non-Color'
def mat(name,tint):
    m=bpy.data.materials.new(name); m.use_nodes=True
    nt=m.node_tree; p=nt.nodes['Principled BSDF']
    t=nt.nodes.new('ShaderNodeTexImage'); t.image=img
    nt.links.new(t.outputs['Color'],p.inputs['Base Color'])
    r=nt.nodes.new('ShaderNodeTexImage'); r.image=rimg
    nt.links.new(r.outputs['Color'],p.inputs['Roughness'])
    p.inputs['Metallic'].default_value=0.0
    return m
stone=mat('Stone',1)
def box(name,sx,sy,sz,z0,bev):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o=bpy.context.object; o.name=name
    o.scale=(sx,sy,sz); o.location=(0,0,z0+sz/2)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    m=o.modifiers.new('bev','BEVEL'); m.width=bev; m.segments=3; m.limit_method='ANGLE'
    bpy.ops.object.modifier_apply(modifier='bev')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=1.2)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_auto_smooth(angle=0.6)
    o.data.materials.append(stone)
    return o
parts=[box('Plinth',0.72,0.72,0.16,0.0,0.02),
       box('PlinthStep',0.6,0.6,0.06,0.16,0.012),
       box('Block',0.5,0.5,1.52,0.22,0.015),
       box('Cap',0.56,0.56,0.06,1.74,0.012)]
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active=parts[2]
bpy.ops.object.join()
o=bpy.context.object; o.name='Statue'
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')  # cursor at 0,0,0 = base center
print('DIMS',tuple(round(v,3) for v in o.dimensions),'MINZ',min(v.co.z for v in o.data.vertices))
bpy.ops.wm.save_as_mainfile(filepath=D+'/statue.blend')
bpy.ops.export_scene.gltf(filepath=D+'/statue.glb',export_format='GLB',export_yup=True,export_image_format='JPEG')
bpy.ops.wm.usd_export(filepath=D+'/statue.usdz',export_materials=True,generate_preview_surface=True,export_textures=True,
    convert_orientation=True,export_global_forward_selection='NEGATIVE_Z',export_global_up_selection='Y',
    convert_scene_units='METERS',export_uvmaps=True,triangulate_meshes=False,export_lights=False,export_cameras=False,usdz_downscale_size='KEEP')
