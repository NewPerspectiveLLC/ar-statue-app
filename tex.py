import numpy as np
from PIL import Image
rng=np.random.default_rng(7); N=1024
def fbm(n,oct=6):
    out=np.zeros((n,n));amp=1;tot=0
    for o in range(oct):
        s=2**(o+2)
        g=rng.random((s+1,s+1))
        x=np.linspace(0,s,n,endpoint=False); i=x.astype(int); f=x-i; f=f*f*(3-2*f)
        a=g[i][:,i]; b=g[i][:,i+1]; c=g[i+1][:,i]; d=g[i+1][:,i+1]
        fx=f[None,:]; fy=f[:,None]
        v=(a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy
        out+=v*amp; tot+=amp; amp*=0.5
    return out/tot
n=fbm(N); n2=fbm(N,4)
y,x=np.mgrid[0:N,0:N]/N
veins=np.abs(np.sin((x*3+y*5+n*4)*np.pi))**0.15
v=0.80+0.10*(n-0.5)-0.18*(1-veins)+0.04*(n2-0.5)
grain=rng.normal(0,0.015,(N,N))
v=np.clip(v+grain,0,1)
base=np.array([0.86,0.83,0.77])
img=np.clip(v[...,None]*base[None,None,:]*1.05,0,1)
Image.fromarray((img*255).astype(np.uint8)).save('stone.png')
# roughness: mostly rough
r=np.clip(0.65+0.2*(n2-0.5),0,1)
Image.fromarray((r*255).astype(np.uint8)).convert('RGB').save('stone_rough.png')
