# Generates public/plans/sample.json and public/plans/test-two-storey.json (schema: plan-schema.json)
import json
EXT, INT = 0.23, 0.11
def r3(v): return round(v, 3)
def shift(p, dx, dy): return [r3(p[0] + dx), r3(p[1] + dy)]
def rect(x0, y0, x1, y1): return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

# ---------------- sample: cozy single-storey 3-bed, hip roof, pool + garden
DX, DY = 3, 7
walls = [
 ("E1", (0,0), (12,0), EXT, True, "plaster_white"), ("E2", (12,0), (12,9), EXT, True, "plaster_white"),
 ("E3", (12,9), (0,9), EXT, True, "face_brick"), ("E4", (0,9), (0,0), EXT, True, "plaster_white"),
 ("I1", (4.2,0), (4.2,9), INT, False, None), ("I2", (5.4,0), (5.4,9), INT, False, None),
 ("I3", (0,3.6), (4.2,3.6), INT, False, None), ("I4", (0,5.4), (4.2,5.4), INT, False, None),
 ("I5", (5.4,3.6), (8.4,3.6), INT, False, None), ("I6", (8.4,0), (8.4,3.6), INT, False, None),
]
openings = [
 ("WIN-BED2-S","E1","window",1.2,1.5,1.2,0.9), ("D-FRONT","E1","door",4.3,1.0,2.1,0), ("WIN-BED3-S","E1","window",6.2,1.5,1.2,0.9), ("WIN-KIT-S","E1","window",9.3,1.6,0.9,1.1),
 ("WIN-KIT-E","E2","window",1.2,1.2,0.9,1.1), ("WIN-LIV-E","E2","window",5.0,1.8,1.2,0.9),
 ("SD-LIVING","E3","sliding_door",1.0,4.0,2.2,0), ("WIN-HALL-N","E3","window",6.75,0.6,1.2,0.9), ("WIN-MAIN-N","E3","window",9.0,1.8,1.2,0.9),
 ("WIN-MAIN-W","E4","window",1.5,1.2,1.2,0.9), ("WIN-BATH-W","E4","window",4.0,0.6,0.6,1.5), ("WIN-BED2-W","E4","window",6.9,1.2,1.2,0.9),
 ("D-BED2","I1","door",2.5,0.8,2.1,0), ("D-BATH","I1","door",4.1,0.8,2.1,0), ("D-MAIN","I1","door",5.8,0.8,2.1,0),
 ("D-BED3","I2","door",2.5,0.8,2.1,0), ("OP-LIVING","I2","opening",4.4,2.6,2.3,0),
]
rooms = [
 ("bed2","Bedroom 2","bedroom",rect(0.115,0.115,4.145,3.545),"carpet"),
 ("bath","Bathroom","bathroom",rect(0.115,3.655,4.145,5.345),"tile"),
 ("main","Main Bedroom","bedroom",rect(0.115,5.455,4.145,8.885),"wood"),
 ("hall","Hall","passage",rect(4.255,0.115,5.345,8.885),"tile"),
 ("bed3","Bedroom 3","bedroom",rect(5.455,0.115,8.345,3.545),"carpet"),
 ("kitchen","Kitchen","kitchen",rect(8.455,0.115,11.885,3.655),"tile"),
 ("living","Living / Dining","living",rect(5.455,3.655,11.885,8.885),"wood"),
]
furn = [
 ("bed_double","main",(2.1,7.6),0,[1.6,2.0,0.5]), ("wardrobe","main",(2.4,5.8),0,[1.8,0.6,2.2]),
 ("bed_single","bed2",(1.2,2.4),0,None), ("desk","bed2",(3.2,0.5),0,None),
 ("bed_single","bed3",(7.6,2.3),0,None), ("wardrobe","bed3",(6.6,0.45),0,[1.6,0.6,2.2]),
 ("toilet","bath",(0.5,4.5),270,None), ("basin","bath",(2.0,5.08),180,None), ("bath","bath",(3.2,4.5),90,[1.7,0.75,0.55]),
 ("kitchen_counter","kitchen",(10.2,0.44),0,[3.4,0.6,0.9]), ("island","kitchen",(10.2,2.4),0,[2.0,0.9,0.9]),
 ("dining_table","living",(10.2,5.0),0,[1.8,0.9,0.75]), ("sofa","living",(7.4,7.3),0,[2.4,0.9,0.8]), ("tv_unit","living",(7.4,4.0),0,None),
]
site_features = [
 {"id":"fence","type":"fence","name":"Timber boundary fence","polygon":rect(0,0,18,30),"height":1.6},
 {"id":"front-lawn","type":"lawn","name":"Front lawn","polygon":rect(0.5,0.5,6.9,6.6)},
 {"id":"front-garden","type":"garden","name":"Front garden","polygon":rect(8.7,0.5,14.7,6.6)},
 {"id":"path","type":"paving","name":"Front path","polygon":rect(7.2,0,8.4,6.89),"material":"concrete slabs"},
 {"id":"drive","type":"driveway","name":"Driveway","polygon":rect(15.3,0,17.5,8),"material":"pavers"},
 {"id":"garden","type":"garden","name":"Back garden","polygon":rect(0.5,16.2,17.5,29.5)},
 {"id":"deck","type":"deck","name":"Timber deck","polygon":rect(6.0,16.115,15.3,18.6),"elevation":0.05,"material":"timber_deck"},
 {"id":"pool","type":"pool","name":"Pool","polygon":rect(8.5,19.0,14.0,22.4),"depth":1.4},
 {"id":"planter","type":"planter","name":"Herb planter","polygon":rect(0.5,17.0,1.5,24.0),"height":0.45},
]
plan = {
 "version":"1.0",
 "meta":{"name":"Sample: cozy single-storey 3-bed with pool","units":"m","origin":"south-west corner of site","northAngleDeg":0},
 "site":{"boundary":rect(0,0,18,30),"features":site_features},
 "levels":[{"id":"ground","name":"Ground floor","elevation":0.0,"height":2.7,"slabThickness":0.2}],
 "walls":[{"id":i,"level":"ground","start":shift(a,DX,DY),"end":shift(b,DX,DY),"thickness":t,"exterior":e, **({"material":m} if m else {})} for i,a,b,t,e,m in walls],
 "openings":[{"id":i,"wall":w,"type":ty,"offset":o,"width":wd,"height":h,"sill":s} for i,w,ty,o,wd,h,s in openings],
 "rooms":[{"id":i,"level":"ground","name":n,"type":ty,"polygon":[shift(p,DX,DY) for p in poly],"floorMaterial":fm} for i,n,ty,poly,fm in rooms],
 "stairs":[],
 "roof":{"type":"hip","pitchDeg":25,"overhang":0.6,"material":"concrete_tile"},
 "furniture":[{"type":t,"room":r,"position":shift(p,DX,DY),"rotation":rot, **({"size":s} if s else {})} for t,r,p,rot,s in furn],
}
json.dump(plan, open("public/plans/sample.json","w"), indent=1)

# ---------------- test: small two-storey with stairs and gable roof
walls2, ops2, rooms2 = [], [], []
for lvl in ("ground","first"):
    p = "G" if lvl=="ground" else "F"
    for i,(a,b) in enumerate([((0,0),(8,0)),((8,0),(8,7)),((8,7),(0,7)),((0,7),(0,0))]):
        walls2.append({"id":f"{p}{i+1}","level":lvl,"start":list(a),"end":list(b),"thickness":EXT,"exterior":True,"material":"face_brick" if (lvl=="ground" and i==2) else "plaster_white"})
walls2 += [
 {"id":"FI1","level":"first","start":[5.6,0],"end":[5.6,7],"thickness":INT},
 {"id":"FI2","level":"first","start":[0,3.5],"end":[5.6,3.5],"thickness":INT},
 {"id":"GI1","level":"ground","start":[5.0,4.6],"end":[8,4.6],"thickness":INT},
]
ops2 = [
 {"id":"D-FRONT","wall":"G1","type":"door","offset":3.0,"width":1.0},
 {"id":"GW1","wall":"G1","type":"window","offset":0.8,"width":1.6},
 {"id":"GSD","wall":"G3","type":"sliding_door","offset":2.0,"width":3.2},
 {"id":"GW2","wall":"G4","type":"window","offset":2.5,"width":1.4},
 {"id":"GW3","wall":"G2","type":"window","offset":5.3,"width":1.0},
 {"id":"D-STORE","wall":"GI1","type":"door","offset":0.3,"width":0.8},
 {"id":"FW1","wall":"F1","type":"window","offset":1.5,"width":1.6},
 {"id":"FW2","wall":"F3","type":"window","offset":4.0,"width":1.6},
 {"id":"FW3","wall":"F2","type":"window","offset":5.2,"width":1.0},
 {"id":"FD1","wall":"FI1","type":"door","offset":1.4,"width":0.8},
 {"id":"FD2","wall":"FI1","type":"door","offset":5.0,"width":0.8},
]
rooms2 = [
 {"id":"living","level":"ground","name":"Living / Kitchen","type":"living","polygon":[[0.115,0.115],[7.885,0.115],[7.885,4.545],[4.945,4.545],[4.945,6.885],[0.115,6.885]],"floorMaterial":"tile"},
 {"id":"store","level":"ground","name":"Study","type":"study","polygon":rect(5.055,4.655,7.885,6.885),"floorMaterial":"wood"},
 {"id":"landing","level":"first","name":"Landing","type":"passage","polygon":rect(5.655,0.115,7.885,6.885),"floorMaterial":"wood"},
 {"id":"bed1","level":"first","name":"Bedroom 1","type":"bedroom","polygon":rect(0.115,3.555,5.545,6.885),"floorMaterial":"carpet"},
 {"id":"bed2","level":"first","name":"Bedroom 2","type":"bedroom","polygon":rect(0.115,0.115,5.545,3.445),"floorMaterial":"carpet"},
]
plan2 = {
 "version":"1.0",
 "meta":{"name":"Test: small two-storey (stairs, gable roof)","units":"m","origin":"south-west corner of house"},
 "site":{"features":[{"id":"lawn","type":"lawn","name":"Lawn","polygon":rect(-4,-4,12,11)},{"id":"patio","type":"patio","name":"Patio","polygon":rect(1,7.115,7,9.5)}]},
 "levels":[{"id":"ground","name":"Ground floor","elevation":0,"height":2.8},{"id":"first","name":"First floor","elevation":3.0,"height":2.6}],
 "walls":walls2, "openings":ops2, "rooms":rooms2,
 "stairs":[{"id":"S1","fromLevel":"ground","toLevel":"first","start":[7.3,0.6],"direction":0,"width":0.9,"run":3.9,"steps":16}],
 "roof":{"type":"gable","pitchDeg":35,"overhang":0.5,"ridgeDirection":"x","material":"concrete_tile"},
 "furniture":[
  {"type":"sofa","room":"living","position":[2.5,5.8],"rotation":180},{"type":"tv_unit","room":"living","position":[2.5,3.6]},
  {"type":"kitchen_counter","room":"living","position":[0.44,1.6],"rotation":270,"size":[2.6,0.6,0.9]},{"type":"dining_table","room":"living","position":[3.5,1.5],"size":[1.6,0.9,0.75]},
  {"type":"desk","room":"store","position":[6.5,6.5]},
  {"type":"bed_double","room":"bed1","position":[2.8,5.8]},{"type":"bed_single","room":"bed2","position":[1.0,1.5]},{"type":"wardrobe","room":"bed2","position":[3.5,3.1],"rotation":180}
 ]
}
json.dump(plan2, open("public/plans/test-two-storey.json","w"), indent=1)
print("ok")
