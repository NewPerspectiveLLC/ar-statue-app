from PIL import Image, ImageDraw
import glob, sys
fs=sorted(glob.glob('/tmp/ghostfr/f*.png')); ims=[Image.open(f) for f in fs]
w,h=ims[0].size; cols=6; rows=(len(ims)+cols-1)//cols
sheet=Image.new('RGB',(cols*w,rows*h)); d=ImageDraw.Draw(sheet)
for i,(f,im) in enumerate(zip(fs,ims)):
    x,y=(i%cols)*w,(i//cols)*h; sheet.paste(im,(x,y)); fr=int(f[-8:-4]); d.text((x+8,y+8),f't={(fr-60)/24:.1f}s after appear',fill=(255,255,0))
sheet.save(sys.argv[1])
