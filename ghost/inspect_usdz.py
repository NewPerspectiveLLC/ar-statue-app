import sys
from pxr import Usd, UsdSkel, UsdShade, UsdUtils, Sdf
path = sys.argv[sys.argv.index('--') + 1]
st = Usd.Stage.Open(path)
print('upAxis', st.GetMetadata('upAxis'), 'mpu', st.GetMetadata('metersPerUnit'), 'time', st.GetStartTimeCode(), st.GetEndTimeCode(), 'tcps', st.GetTimeCodesPerSecond())
print('defaultPrim', st.GetDefaultPrim().GetPath())
for p in st.Traverse():
    t = p.GetTypeName()
    if t in ('SkelAnimation', 'Skeleton', 'SkelRoot', 'Mesh', 'Material', 'Shader', 'Xform'):
        extra = ''
        if t == 'SkelAnimation':
            a = UsdSkel.Animation(p)
            extra = 'joints=%d trans samples=%d rot samples=%d scale samples=%d' % (len(a.GetJointsAttr().Get()), a.GetTranslationsAttr().GetNumTimeSamples(), a.GetRotationsAttr().GetNumTimeSamples(), a.GetScalesAttr().GetNumTimeSamples())
        if t == 'Shader':
            sh = UsdShade.Shader(p); vals = {}
            for i in sh.GetInputs():
                v = i.Get(); 
                if i.GetBaseName() in ('opacity', 'emissiveColor', 'diffuseColor', 'opacityThreshold') : vals[i.GetBaseName()] = v if v is not None else ('connected' if i.HasConnectedSource() else None)
            extra = str(sh.GetIdAttr().Get()) + ' ' + str(vals)
        if t == 'Mesh':
            extra = 'doubleSided=%s' % p.GetAttribute('doubleSided').Get()
        if t == 'Xform':
            ops = [a.GetName() for a in p.GetAttributes() if a.GetName().startswith('xformOp') and a.GetNumTimeSamples() > 0]
            if ops: extra = 'ANIMATED xform ' + str(ops)
        print(t, p.GetPath(), extra)
c = UsdUtils.ComplianceChecker(arkit=True, skipARKitRootLayerCheck=False, rootPackageOnly=False, skipVariants=False, verbose=False)
c.CheckCompliance(path)
print('ERRORS', c.GetErrors()); print('FAILED', c.GetFailedChecks()); print('WARNINGS', c.GetWarnings())
