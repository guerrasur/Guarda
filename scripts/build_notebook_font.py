"""Build the bundled, fixed-width handwritten font (optional asset build).

Requires fonttools. Usage: python scripts/build_notebook_font.py SOURCE.ttf
Source: google/fonts, ofl/patrickhand/PatrickHand-Regular.ttf (SIL OFL 1.1).
The derived family has its own name and keeps Spanish letters and punctuation.
No font download or generation runs in the app or during ordinary builds.
"""
import hashlib
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools import subset

source = Path(sys.argv[1])
font = TTFont(source, recalcTimestamp=False)
glyphs = font.getGlyphSet()
outlines = {}
advance = 560
for name in font.getGlyphOrder():
    width, _ = font['hmtx'][name]
    scale = min(1, 520 / max(width, 1))
    recording = DecomposingRecordingPen(glyphs)
    glyphs[name].draw(recording)
    pen = TTGlyphPen(None)
    recording.replay(TransformPen(pen, (scale, 0, 0, 1, (advance-width*scale)/2, 0)))
    outlines[name] = pen.glyph()
for name, outline in outlines.items():
    font['glyf'][name] = outline
    outline.recalcBounds(font['glyf'])
    font['hmtx'][name] = (advance, getattr(outline, 'xMin', 0))
for table in ['GPOS', 'GSUB', 'GDEF', 'kern', 'DSIG']:
    if table in font:
        del font[table]
for name_id, value in {1:'Guarda Hand', 2:'Regular', 3:'Guarda Hand Regular 1.0',
                       4:'Guarda Hand Regular', 6:'GuardaHand-Regular',
                       16:'Guarda Hand', 17:'Regular'}.items():
    font['name'].setName(value, name_id, 3, 1, 0x409)
    font['name'].setName(value, name_id, 1, 0, 0)
font['post'].isFixedPitch = 1
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=list(range(0x250))+list(range(0x300,0x370))+
                   list(range(0x2000,0x2070))+[0x20ac, 0x2212])
subsetter.subset(font)
font.flavor = 'woff'
output = Path(__file__).resolve().parents[1]/'public/fonts/guarda-hand.woff'
font.save(output)
print('Source SHA256:', hashlib.sha256(source.read_bytes()).hexdigest())
print('Bundled font:', output.stat().st_size, 'bytes')
